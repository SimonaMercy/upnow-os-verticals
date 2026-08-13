'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Building2, RefreshCw, Wrench,
  CheckCircle2, XCircle, Clock, AlertCircle, EyeOff,
  ChevronLeft, ChevronRight, ChevronDown, ImageOff, MapPin, Info, Tag,
  MousePointerClick, FileText, ExternalLink, Inbox,
  Star, Mail, Phone, ShieldCheck, Layers, Zap, Store, Users,
} from 'lucide-react';
import { DirhamSign } from '@/components/ui/DirhamSign';
import { apiGet, apiPatch } from '@/lib/api';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { BackLink } from '@/components/dashboard/DashboardWidgets';
import { openDocViewer } from '@/lib/docViewer';
import { SPACE_CATEGORIES, categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type ListingStatus = 'draft' | 'pending' | 'in_review' | 'published' | 'approved' | 'rejected' | 'expired';

interface UnitListing {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  listingStatus: ListingStatus;
  annualRent: number | null;
  property: {
    id: number;
    buildingName: string;
    fullAddress: string | null;
    rentalProviderId: number;
    spaceCategory: string;
  } | null;
}

interface UnitMedia {
  id: number;
  url: string;
  caption: string | null;
  mediaType: string;
  sortOrder: number;
}

interface ListingDoc {
  id: number;
  documentKey: string;
  fileUrl: string | null;
  status: string | null;
  expiryDate: string | null;
}

interface UnitDetail {
  id: number;
  unitNumber: string;
  unitName: string | null;
  floor: string | null;
  unitType: string;
  unitTier: string;
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  kitchenType: string | null;
  numBalconies: number;
  view: string | null;
  numAcs: number;
  rentalPrice: number | null;
  serviceCharges: number | null;
  securityDeposit: number | null;
  adminFee: number | null;
  ejariFeeFils: number | null;
  commission: number | null;
  availability: string;
  description: string | null;
  listingStatus: ListingStatus;
  property: {
    id: number;
    buildingName: string;
    fullAddress: string | null;
    spaceCategory: string;
    rentalProviderId: number;
    numberOfFloors: string | null;
    hasGym: boolean;
    hasPool: boolean;
    hasParking: boolean;
    propertyDescription: string | null;
    makaniNumber: string | null;
    mapLink: string | null;
    emirate?: { name: string } | null;
    community?: { name: string } | null;
    subCommunity?: { name: string } | null;
  };
}

// Full provider context for the review panel — GET /admin/kyc/service-providers/:id
interface SpChecklistItem {
  key: string;
  displayName: string;
  category: string;
  required: boolean;
  uploaded: boolean;
  status: string | null;
  fileUrl: string | null;
  expiryDate: string | null;
}
interface SpContextService {
  id: number;
  category: string;
  name: string;
  basePrice: number | null;
  priceUnit: string | null;
  pricingMode: string;
  isEmergency: boolean;
  listingStatus: string;
  isAvailable: boolean;
}
interface SpContext {
  profile: {
    id: number;
    userId: number;
    businessName: string | null;
    companyName: string | null;
    ownerName: string | null;
    entityType: string | null;
    isGovernment: boolean;
    tradeLicenseNumber: string | null;
    vatTrn: string | null;
    emiratesServed: string | null;
    serviceCategories: string | null;
    complianceStatus: string;
    jobReadyAt: string | null;
    averageRating: number | null;
    totalReviews: number;
    emergencyResponse: boolean;
    opsContactName: string | null;
    opsContactPhone: string | null;
    createdAt: string;
    user?: { name: string | null; email: string | null; phone: string | null } | null;
  };
  checklist: SpChecklistItem[];
  completionScore: number;
  services: SpContextService[];
  /** Evidence behind the Job-ready chip (SP-247) — GET /admin/kyc/service-providers/:id. */
  operationalProfile?: OperationalProfile | null;
}

interface OperationalProfile {
  jobReady: boolean;
  jobReadyAt: string | null;
  cards: {
    coverage: { complete: boolean; zoneCount: number };
    team: {
      complete: boolean;
      adoptedCategories: string[];
      coveredCategories: string[];
      missingCategories: string[];
      uncoveredServices: { id: number; name: string; category: string }[];
      activeTechnicians: number;
      leadCapable: number;
    };
    fleet: { complete: boolean; vehicles: number; effectiveMaxConcurrentJobs: number };
    hours: { complete: boolean; daysConfigured: number };
    rules: {
      complete: boolean;
      acceptedAt: string | null;
      minNoticeHours: number;
      dispatchLogic: string | null;
      emergencyResponse: boolean;
    };
  };
  team: {
    id: number;
    name: string;
    status: string;
    isLeadCapable: boolean;
    hasPhoto: boolean;
    complianceStatus: string | null;
    specialization: string | null;
    categorySkills: string[];
    serviceSkills: string[];
  }[];
  coverageZones: string[];
  fleet: { type: string; label: string | null }[];
  weeklyHours: { weekday: number; opensAt: string; closesAt: string }[];
  timeOff: { startsOn: string; endsOn: string; reason: string | null }[];
}

// One row per provider in the grouped moderation queue — GET /admin/service-listing-providers
interface SpProviderRow {
  id: number;
  userId: number;
  name: string | null;
  entityType: string | null;
  complianceStatus: string;
  serviceCategories: string | null;
  jobReady: boolean;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

// v2 service taxonomy — mirrors service_categories codes owned by the
// Service Catalog console (dashboard/admin/catalog).
const SERVICE_CATEGORIES: { id: string; label: string }[] = [
  { id: 'home_cleaning',       label: 'Home Cleaning' },
  { id: 'ac_services',         label: 'AC Services' },
  { id: 'plumbing',            label: 'Plumbing' },
  { id: 'electrical',          label: 'Electrical' },
  { id: 'handyman',            label: 'Handyman' },
  { id: 'painting',            label: 'Painting' },
  { id: 'pest_control',        label: 'Pest Control' },
  { id: 'car_vehicle',         label: 'Car & Vehicle' },
  { id: 'landscaping_outdoor', label: 'Landscaping & Outdoor' },
  { id: 'commercial_services', label: 'Commercial Services' },
];

function serviceCategoryLabel(id: string): string {
  return SERVICE_CATEGORIES.find((c) => c.id === id)?.label
    ?? id.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// sp_working_hours.weekday: 0 = Sunday … 6 = Saturday (mirrors SpJobReady).
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// All / Pending / Approved / Rejected — the backend maps these buckets onto each
// side's underlying status values.
const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: '',         label: 'All' },
  { id: 'pending',  label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  // Without this bucket an expired listing vanishes from every tab but All.
  { id: 'expired',  label: 'Expired' },
];

const categoryColor: Record<string, { bg: string; color: string }> = {
  residential: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  commercial:  { bg: '#eff6ff', color: '#3b82f6' },
  industrial:  { bg: '#f5f3ff', color: '#8b5cf6' },
  land:        { bg: '#f0fdf4', color: '#16a34a' },
  mixed_use:   { bg: '#fffbeb', color: '#d97706' },
  workspaces:  { bg: '#ecfeff', color: '#0891b2' },
  venues:      { bg: '#fdf2f8', color: '#db2777' },
};

const statusCfg: Record<string, { label: string; className: string; Icon: React.ElementType }> = {
  draft:     { label: 'Draft',      className: 'bg-gray-100 text-gray-600',       Icon: EyeOff },
  pending:   { label: 'Pending',    className: 'bg-amber-100 text-amber-700',     Icon: Clock },
  in_review: { label: 'In Review',  className: 'bg-blue-100 text-blue-700',       Icon: AlertCircle },
  published: { label: 'Published',  className: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 },
  approved:  { label: 'Approved',   className: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 },
  rejected:  { label: 'Rejected',   className: 'bg-red-100 text-red-700',         Icon: XCircle },
  expired:   { label: 'Expired',    className: 'bg-orange-100 text-orange-700',   Icon: XCircle },
  // Auto-set when the provider loses their last qualified lead technician for
  // the service (SP-249); Approve is the admin's restore action.
  suspended_no_qualified_technician: { label: 'Suspended — no lead', className: 'bg-amber-100 text-amber-700', Icon: AlertCircle },
};

// ─── Small helpers ──────────────────────────────────────────────────────────

function aed(v: number | null | undefined) {
  if (v == null) return '—';
  return `AED ${Number(v).toLocaleString('en-AE')}`;
}

function StatusBadge({ s }: { s: string }) {
  const cfg = statusCfg[s] ?? statusCfg.draft;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      <Icon size={10} />{cfg.label}
    </span>
  );
}

// Multi-select "Types" dropdown — replaces the category pill row. `selected` is
// an array of category ids; empty = all types.
function TypesDropdown({ options, selected, onChange, labelFor }: {
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  labelFor: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const label = selected.length === 0 ? 'All types' : selected.length === 1 ? labelFor(selected[0]) : `${selected.length} types`;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
        style={{
          backgroundColor: selected.length ? 'var(--color-primary-50)' : '#fff',
          color: selected.length ? 'var(--color-primary)' : 'var(--color-neutral-600)',
          borderColor: selected.length ? 'var(--color-primary)' : 'var(--color-base-200)',
        }}>
        <Tag size={12} /> {label}
        <ChevronDown size={13} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 rounded-xl border bg-white py-1 shadow-lg"
          style={{ minWidth: 220, borderColor: 'var(--color-base-200)' }}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-neutral-400)' }}>Types</span>
            {selected.length > 0 && (
              <button onClick={() => onChange([])} className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>Clear</button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {options.map((opt) => {
              const checked = selected.includes(opt.id);
              return (
                <button key={opt.id} onClick={() => toggle(opt.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-stone-50"
                  style={{ color: 'var(--color-neutral-700)' }}>
                  <span className="w-4 h-4 rounded grid place-items-center shrink-0"
                    style={{ border: `1.5px solid ${checked ? 'var(--color-primary)' : 'var(--color-base-200)'}`, backgroundColor: checked ? 'var(--color-primary)' : '#fff' }}>
                    {checked && <CheckCircle2 size={11} style={{ color: '#fff' }} />}
                  </span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Status as tabs (Pending / Approved / Rejected / Expired) — the primary filter.
// Expired is rental-only: a service listing is never taken off the market for
// ageing out, so the bucket would always be empty on the SP side.
function StatusTabs({ value, onChange, mode }: { value: string; onChange: (s: string) => void; mode: 'rp' | 'sp' }) {
  return (
    <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--color-base-200)' }}>
      {STATUS_FILTERS.filter((s) => s.id && (mode === 'rp' || s.id !== 'expired')).map((st) => (
        <button key={st.id} onClick={() => onChange(st.id)}
          className="px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors"
          style={value === st.id
            ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }
            : { borderColor: 'transparent', color: 'var(--color-neutral-500)' }}>
          {st.label}
        </button>
      ))}
    </div>
  );
}

// ─── Left-column cards (master list) ──────────────────────────────────────────

function UnitCard({ u, selected, onClick }: { u: UnitListing; selected: boolean; onClick: () => void }) {
  const cc = categoryColor[u.property?.spaceCategory ?? ''] ?? { bg: 'var(--color-base-100)', color: 'var(--color-neutral-500)' };
  return (
    <button onClick={onClick}
      className="w-full text-left px-4 py-3.5 border-b transition-colors"
      style={{
        borderColor: 'var(--color-base-100)',
        backgroundColor: selected ? 'var(--color-primary-50)' : '#fff',
        borderLeft: selected ? '3px solid var(--color-primary)' : '3px solid transparent',
      }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>
          Unit {u.unitNumber}
        </span>
        <StatusBadge s={u.listingStatus} />
      </div>
      <p className="text-xs truncate mb-1" style={{ color: 'var(--color-neutral-500)' }}>{u.property?.buildingName ?? '—'}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: cc.bg, color: cc.color }}>
          {u.property ? categoryDisplayLabel(u.property.spaceCategory) : '—'}
        </span>
        <span className="text-xs font-medium" style={{ color: 'var(--color-neutral-700)' }}>
          {u.annualRent != null ? `${aed(u.annualRent)}/yr` : '—'}
        </span>
      </div>
    </button>
  );
}

// One provider per row — the grouped moderation queue. Shows who the vendor is
// and the shape of their queue (pending / approved / rejected) at a glance.
function ProviderCard({ p, selected, onClick }: { p: SpProviderRow; selected: boolean; onClick: () => void }) {
  const cc = complianceCfg[p.complianceStatus] ?? complianceCfg.pending_review;
  const cats = csvToList(p.serviceCategories);
  const catSummary = cats.length ? cats.slice(0, 2).map(serviceCategoryLabel).join(', ') + (cats.length > 2 ? ` +${cats.length - 2}` : '') : '—';
  return (
    <button onClick={onClick}
      className="w-full text-left px-4 py-3.5 border-b transition-colors"
      style={{
        borderColor: 'var(--color-base-100)',
        backgroundColor: selected ? 'var(--color-primary-50)' : '#fff',
        borderLeft: selected ? '3px solid var(--color-primary)' : '3px solid transparent',
      }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>{p.name ?? `SP #${p.id}`}</span>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: cc.bg, color: cc.color }}>{cc.label}</span>
      </div>
      <p className="text-xs truncate mb-1.5" style={{ color: 'var(--color-neutral-500)' }}>{catSummary}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>{p.total} service{p.total === 1 ? '' : 's'}</span>
        {p.pending > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>{p.pending} pending</span>}
        {p.approved > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>{p.approved} approved</span>}
        {p.rejected > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>{p.rejected} rejected</span>}
      </div>
    </button>
  );
}

// ─── Right-column detail panels ───────────────────────────────────────────────

function ActionBar({ canApprove, canReject, canExpire, acting, onApprove, onReject, onExpire }: {
  canApprove: boolean; canReject: boolean; canExpire: boolean; acting: boolean;
  onApprove: () => void; onReject: () => void; onExpire: () => void;
}) {
  if (!canApprove && !canReject && !canExpire) return null;
  return (
    <div className="shrink-0 border-t px-4 py-3 flex gap-2" style={{ borderColor: 'var(--color-base-200)', backgroundColor: '#fff' }}>
      {canApprove && (
        <button onClick={onApprove} disabled={acting}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
          <CheckCircle2 size={15} /> Approve
        </button>
      )}
      {canReject && (
        <button onClick={onReject} disabled={acting}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          <XCircle size={15} /> Reject
        </button>
      )}
      {/* Expire — for a listing that was legitimately live and has simply aged
          out. Rejecting one of those would be the wrong verdict (SCRUM-663). */}
      {canExpire && (
        <button onClick={onExpire} disabled={acting}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}
          title="Take this listing off the market as expired">
          <Clock size={15} /> Expire
        </button>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-200)' }}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={12} style={{ color: 'var(--color-primary)' }} />
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-neutral-500)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
      <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>{label}</span>
      <span className="text-xs font-semibold" style={{ color: value ? 'var(--color-neutral-800)' : 'var(--color-neutral-300)' }}>{value ?? '—'}</span>
    </div>
  );
}

function UnitDetailPanel({ row, acting, onApprove, onReject, onExpire }: {
  row: UnitListing; acting: boolean;
  onApprove: (u: UnitListing) => void; onReject: (u: UnitListing) => void; onExpire: (u: UnitListing) => void;
}) {
  const [detail, setDetail] = useState<UnitDetail | null>(null);
  const [media, setMedia] = useState<UnitMedia[]>([]);
  const [docs, setDocs] = useState<ListingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const propertyId = row.property?.id;

  useEffect(() => {
    setDetail(null); setMedia([]); setDocs([]); setPhotoIdx(0); setLoading(true); setErr(null);
    scrollRef.current?.scrollTo({ top: 0 });
    if (propertyId == null) { setLoading(false); return; }
    const controller = new AbortController();
    apiGet<{ unit: UnitDetail; media: UnitMedia[]; documents: ListingDoc[] }>(`/admin/listings/${propertyId}/units/${row.id}`, { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) { setDetail(r.unit); setMedia(r.media ?? []); setDocs(r.documents ?? []); } })
      .catch((e) => { if (!controller.signal.aborted) setErr((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [row.id, propertyId]);

  const photos = media.filter((m) => m.mediaType === 'photo');
  const p = detail?.property;
  const locationParts = [p?.emirate?.name, p?.community?.name, p?.subCommunity?.name].filter(Boolean);
  const canApprove = row.listingStatus !== 'published';
  const canReject  = row.listingStatus !== 'rejected';
  // Only a listing that actually reached the market can expire.
  const canExpire  = ['published', 'approved'].includes(row.listingStatus);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 pb-3 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
              Unit {row.unitNumber}
            </h2>
            <StatusBadge s={row.listingStatus} />
            <Link href={`/dashboard/admin/units/${row.id}`} className="ml-auto text-xs" style={{ color: 'var(--color-primary)' }}>
              Full page ↗
            </Link>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>
            {row.property?.buildingName}{row.property ? ` · RP #${row.property.rentalProviderId}` : ''}
          </p>
        </div>

        {loading && <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--color-neutral-400)' }}>Loading details…</div>}
        {!loading && err && <div className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>{err}</div>}

        {!loading && detail && (
          <div className="space-y-3">
            {photos.length > 0 ? (
              <div className="relative rounded-xl overflow-hidden bg-gray-100" style={{ height: 160 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photos[photoIdx]?.url} alt={photos[photoIdx]?.caption ?? ''} className="w-full h-full object-cover" />
                {photos.length > 1 && (
                  <>
                    <button onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/40 text-white hover:bg-black/60"><ChevronLeft size={13} /></button>
                    <button onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/40 text-white hover:bg-black/60"><ChevronRight size={13} /></button>
                    <span className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-full bg-black/40 text-white">{photoIdx + 1}/{photos.length}</span>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl p-3" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
                <ImageOff size={14} style={{ color: '#dc2626' }} />
                <p className="text-xs font-medium" style={{ color: '#dc2626' }}>No photos uploaded</p>
              </div>
            )}

            <Section icon={MapPin} title="Location">
              <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{p?.buildingName ?? '—'}</p>
              {locationParts.length > 0 && <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>{locationParts.join(' › ')}</p>}
              {p?.fullAddress && <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-400)' }}>{p.fullAddress}</p>}
              {(p?.makaniNumber || p?.mapLink) && (
                <div className="flex flex-wrap gap-x-3 mt-1.5">
                  {p?.makaniNumber && <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Makani: {p.makaniNumber}</span>}
                  {p?.mapLink && <a href={p.mapLink} target="_blank" rel="noopener noreferrer" className="text-xs" style={{ color: 'var(--color-primary)' }}>Map ↗</a>}
                </div>
              )}
            </Section>

            <Section icon={Info} title="Unit Specs">
              <div className="grid grid-cols-2 gap-x-3">
                <Field label="Type" value={detail.unitType?.replace(/_/g, ' ')} />
                <Field label="Floor" value={detail.floor} />
                <Field label="Available" value={detail.availability?.replace(/_/g, ' ')} />
                <Field label="Tier" value={detail.unitTier?.replace(/_/g, ' ')} />
                <Field label="Beds" value={isResidentialUnitType(detail.unitType) && detail.bedrooms != null ? String(detail.bedrooms) : null} />
                <Field label="Baths" value={isResidentialUnitType(detail.unitType) && detail.bathrooms != null ? String(detail.bathrooms) : null} />
                <Field label="sqft" value={detail.unitSizeSqft ? Number(detail.unitSizeSqft).toLocaleString() : null} />
                <Field label="sqm" value={detail.unitSizeSqm ? Number(detail.unitSizeSqm).toLocaleString() : null} />
              </div>
            </Section>

            <Section icon={DirhamSign} title="Pricing">
              <div className="rounded-lg p-2.5 mb-2.5" style={{ backgroundColor: 'var(--color-primary-50)' }}>
                <p className="text-xs" style={{ color: 'var(--color-primary)' }}>Annual Rent</p>
                <p className="text-lg font-bold" style={{ color: 'var(--color-primary)' }}>{aed(detail.rentalPrice)}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                <Field label="Security deposit" value={aed(detail.securityDeposit)} />
                <Field label="Service charges" value={aed(detail.serviceCharges)} />
                <Field label="Admin fee" value={aed(detail.adminFee)} />
                <Field label="Commission" value={aed(detail.commission)} />
              </div>
            </Section>

            <Section icon={Tag} title="Amenities">
              <div className="flex flex-wrap gap-1.5">
                {[{ label: 'Gym', active: p?.hasGym }, { label: 'Pool', active: p?.hasPool }, { label: 'Parking', active: p?.hasParking }].map(({ label, active }) => (
                  <span key={label} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
                    style={active ? { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' } : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-400)' }}>
                    {active ? <CheckCircle2 size={10} /> : <XCircle size={10} />}{label}
                  </span>
                ))}
                {detail.view && <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ backgroundColor: '#eff6ff', color: '#3b82f6' }}>{detail.view} view</span>}
              </div>
            </Section>

            {(detail.description || p?.propertyDescription) && (
              <Section icon={Info} title="Description">
                {detail.description && <p className="text-xs leading-relaxed" style={{ color: 'var(--color-neutral-700)' }}>{detail.description}</p>}
                {p?.propertyDescription && <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--color-neutral-600)' }}>{p.propertyDescription}</p>}
              </Section>
            )}

            {/* Documents linked to the unit + its parent property (view-only). */}
            <Section icon={FileText} title={`Documents (${docs.length})`}>
              {docs.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>No documents linked to this unit or its property.</p>
              ) : (
                <div className="space-y-1.5">
                  {docs.map((doc) => {
                    const ok = ['processed', 'complete', 'approved'].includes(String(doc.status).toLowerCase());
                    return (
                      <div key={doc.id} className="flex items-center justify-between gap-2 py-1.5 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate capitalize" style={{ color: 'var(--color-neutral-700)' }}>
                            {doc.documentKey.replace(/_/g, ' ')}
                          </p>
                          {doc.expiryDate && (
                            <p className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Exp: {new Date(doc.expiryDate).toLocaleDateString('en-AE')}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: ok ? '#dcfce7' : '#fef3c7', color: ok ? '#15803d' : '#b45309' }}>
                            {String(doc.status ?? 'pending').toLowerCase()}
                          </span>
                          {doc.fileUrl
                            ? <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.documentKey.replace(/_/g, ' ') })} className="cursor-pointer">
                                <ExternalLink size={12} style={{ color: 'var(--color-primary)' }} />
                              </button>
                            : <span className="text-xs" style={{ color: 'var(--color-neutral-300)' }}>requested</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
      <ActionBar canApprove={canApprove} canReject={canReject} canExpire={canExpire} acting={acting}
        onApprove={() => onApprove(row)} onReject={() => onReject(row)} onExpire={() => onExpire(row)} />
    </div>
  );
}

// Compliance status → colour + label. Compliant is the gate for approval.
const complianceCfg: Record<string, { bg: string; color: string; label: string }> = {
  compliant:       { bg: '#f0fdf4', color: '#16a34a', label: 'Compliant' },
  pending_review:  { bg: '#eff6ff', color: '#1e40af', label: 'Pending review' },
  action_required: { bg: '#fef2f2', color: '#dc2626', label: 'Action required' },
  expired:         { bg: '#fef2f2', color: '#dc2626', label: 'Expired' },
  paused:          { bg: '#f5f5f4', color: '#78716c', label: 'Paused' },
};
const PRICE_UNIT_SUFFIX: Record<string, string> = {
  fixed: '', per_hour: '/hr', per_unit: '/unit', per_area: '/m²', per_period: '/period', quote_after_callout: '',
};
function ctxSvcPrice(s: SpContextService): string {
  if (s.pricingMode === 'quote' || s.priceUnit === 'quote_after_callout') return 'Quote';
  if (s.basePrice == null) return '—';
  return `${aed(s.basePrice)}${PRICE_UNIT_SUFFIX[s.priceUnit ?? ''] ?? ''}`;
}
function csvToList(s: string | null | undefined): string[] {
  return (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

/** Vendor key-facts + full catalogue + compliance docs — the context an admin
 *  needs to judge a single service listing. Fetched per selected provider. */
/** One provider's full review surface: vendor facts, compliance docs, and every
 *  service they offer — each approvable/rejectable inline, plus bulk actions.
 *  Reuses GET /admin/kyc/service-providers/:id (profile + checklist + services). */
function ProviderReviewPanel({ providerId, onChanged }: { providerId: number; onChanged: () => void }) {
  const [ctx, setCtx] = useState<SpContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  // Which service ids are mid-action (or 'bulk' while a batch runs).
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true); setErr(null);
    return apiGet<SpContext>(`/admin/kyc/service-providers/${providerId}`, { signal })
      .then((r) => { if (!signal?.aborted) setCtx(r); })
      .catch((e) => { if (!signal?.aborted) setErr((e as Error).message); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [providerId]);

  useEffect(() => {
    setCtx(null); setActErr(null); setBusy(new Set());
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [providerId, load]);

  async function actOne(id: number, action: 'approve' | 'reject') {
    setActErr(null);
    setBusy((b) => new Set(b).add(id));
    try {
      await apiPatch(`/admin/service-listings/${id}/${action}`, {});
      setCtx((prev) => prev ? { ...prev, services: prev.services.map((s) => s.id === id ? { ...s, listingStatus: action === 'approve' ? 'approved' : 'rejected' } : s) } : prev);
      onChanged();
    } catch (e) {
      setActErr((e as Error).message);
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(id); return n; });
    }
  }

  async function actAllPending(action: 'approve' | 'reject') {
    if (!ctx) return;
    const pending = ctx.services.filter((s) => s.listingStatus === 'pending');
    if (pending.length === 0) return;
    if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} all ${pending.length} pending service${pending.length === 1 ? '' : 's'} for this provider?`)) return;
    setActErr(null); setBulking(true);
    try {
      for (const s of pending) {
        await apiPatch(`/admin/service-listings/${s.id}/${action}`, {});
      }
      await load();
      onChanged();
    } catch (e) {
      setActErr((e as Error).message);
      await load();
    } finally {
      setBulking(false);
    }
  }

  if (loading && !ctx) return <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--color-neutral-400)' }}>Loading provider…</div>;
  if (err || !ctx) return <div className="m-4 rounded-xl p-3 text-sm" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>Couldn&apos;t load provider{err ? `: ${err}` : ''}.</div>;

  const p = ctx.profile;
  const cc = complianceCfg[p.complianceStatus] ?? complianceCfg.pending_review;
  const compliant = p.complianceStatus === 'compliant';
  const emirates = csvToList(p.emiratesServed);
  const categories = csvToList(p.serviceCategories);
  const businessName = p.businessName || p.companyName || p.ownerName || p.user?.name || 'Unnamed provider';
  const email = p.user?.email ?? null;
  const phone = p.user?.phone ?? p.opsContactPhone ?? null;
  const jobReady = p.jobReadyAt != null;
  const memberSince = p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-AE', { year: 'numeric', month: 'short' }) : null;

  const groups: { category: string; items: SpContextService[] }[] = Object.values(
    ctx.services.reduce((acc, sv) => {
      (acc[sv.category] ??= { category: sv.category, items: [] }).items.push(sv);
      return acc;
    }, {} as Record<string, { category: string; items: SpContextService[] }>),
  ).sort((a, b) => b.items.length - a.items.length);

  const approvedCount = ctx.services.filter((s) => s.listingStatus === 'approved').length;
  const pendingCount = ctx.services.filter((s) => s.listingStatus === 'pending').length;
  const rejectedCount = ctx.services.filter((s) => s.listingStatus === 'rejected').length;
  const requiredMissing = ctx.checklist.filter((c) => c.required && !c.uploaded).length;
  const op = ctx.operationalProfile ?? null;
  // Adopted services with no lead-capable technician skilled in that EXACT
  // service — flagged (not blocked) on the approve row (SP-247).
  const uncoveredIds = new Set((op?.cards.team.uncoveredServices ?? []).map((u) => u.id));

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Vendor identity + key facts */}
        <div className="rounded-xl p-3.5" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-200)' }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-11 h-11 rounded-xl grid place-items-center shrink-0" style={{ backgroundColor: 'var(--color-base-100)' }}>
              <Store size={18} style={{ color: 'var(--color-primary)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold truncate" style={{ color: 'var(--color-neutral-900)' }}>{businessName}</h3>
                <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>SP #{p.id}</span>
                <Link href={`/dashboard/admin/users/${p.userId}`} className="text-xs" style={{ color: 'var(--color-primary)' }}>Profile ↗</Link>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: cc.bg, color: cc.color }}>{cc.label}</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1" style={jobReady ? { backgroundColor: '#f0fdf4', color: '#16a34a' } : { backgroundColor: '#fef9eb', color: '#b45309' }}>
                  {jobReady ? <><CheckCircle2 size={10} /> Job-ready</> : <><Clock size={10} /> Not job-ready</>}
                </span>
                {p.averageRating != null && p.totalReviews > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: '#fffbeb', color: '#b45309' }}>
                    <Star size={10} fill="currentColor" /> {Number(p.averageRating).toFixed(1)} ({p.totalReviews})
                  </span>
                )}
                {p.emergencyResponse && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: '#fff7ed', color: '#c2410c' }}><Zap size={10} /> Emergency</span>}
                {p.isGovernment && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#eff6ff', color: '#1e40af' }}>Government</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4">
            <Field label="Owner" value={p.ownerName} />
            <Field label="Entity" value={p.entityType?.replace(/_/g, ' ')} />
            <Field label="Trade licence" value={p.tradeLicenseNumber} />
            <Field label="VAT TRN" value={p.vatTrn} />
            <Field label="KYC completion" value={`${ctx.completionScore}%`} />
            <Field label="Member since" value={memberSince} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            {email && <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-600)' }}><Mail size={12} style={{ color: 'var(--color-neutral-400)' }} /> {email}</span>}
            {phone && <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-600)' }}><Phone size={12} style={{ color: 'var(--color-neutral-400)' }} /> {phone}</span>}
          </div>
          {emirates.length > 0 && (
            <div className="flex items-start gap-1.5 mt-2">
              <MapPin size={12} className="mt-0.5 shrink-0" style={{ color: 'var(--color-neutral-400)' }} />
              <span className="text-xs" style={{ color: 'var(--color-neutral-600)' }}>{emirates.map((e) => e.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())).join(', ')}</span>
            </div>
          )}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {categories.map((c) => (
                <span key={c} className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>{serviceCategoryLabel(c)}</span>
              ))}
            </div>
          )}
        </div>

        {/* Compliance documents — the reviewer's evidence */}
        <Section icon={ShieldCheck} title={`Compliance documents${requiredMissing > 0 ? ` · ${requiredMissing} required missing` : ' · all required present'}`}>
          <div className="space-y-1.5">
            {ctx.checklist.map((doc) => {
              const ok = ['processed', 'complete', 'approved', 'attached'].includes(String(doc.status).toLowerCase());
              return (
                <div key={doc.key} className="flex items-center justify-between gap-2 py-1.5 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-neutral-700)' }}>
                      {doc.displayName}
                      {doc.required && <span className="ml-1 text-[10px]" style={{ color: '#dc2626' }}>*</span>}
                    </p>
                    {doc.expiryDate && <p className="text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>Exp: {new Date(doc.expiryDate).toLocaleDateString('en-AE')}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {doc.uploaded ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: ok ? '#dcfce7' : '#fef3c7', color: ok ? '#15803d' : '#b45309' }}>{String(doc.status ?? 'uploaded').toLowerCase()}</span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>missing</span>
                    )}
                    {doc.fileUrl
                      ? <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.displayName })} className="cursor-pointer"><ExternalLink size={12} style={{ color: 'var(--color-primary)' }} /></button>
                      : <span className="w-3" />}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Operational profile — the evidence behind the Job-ready chip (SP-247).
            Read-only: corrections happen on the provider's own Setup Guide. */}
        <Section icon={Users} title="Operational profile">
          {!op ? (
            <p className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>No operational profile yet — the provider has not started the Get Job-Ready setup.</p>
          ) : (
            <div className="space-y-3">
              {/* Team + per-technician skills */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-neutral-400)' }}>
                  Team · {op.cards.team.activeTechnicians} active · {op.cards.team.leadCapable} lead-capable
                </p>
                {op.team.length === 0 ? (
                  <p className="text-xs" style={{ color: '#dc2626' }}>No technicians on the roster.</p>
                ) : (
                  <div className="space-y-1">
                    {op.team.map((t) => (
                      <div key={t.id} className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-100)' }}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium" style={{ color: 'var(--color-neutral-800)' }}>{t.name}</span>
                          {t.isLeadCapable && <span className="text-[10px] font-semibold px-1.5 rounded-full" style={{ backgroundColor: '#f0fdf4', color: '#16a34a' }}>Lead</span>}
                          {t.status !== 'active' && <span className="text-[10px] font-semibold px-1.5 rounded-full" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>{t.status}</span>}
                          {t.complianceStatus && t.complianceStatus !== 'compliant' && (
                            <span className="text-[10px] font-semibold px-1.5 rounded-full" style={{ backgroundColor: '#fef9eb', color: '#b45309' }}>{t.complianceStatus.replace(/_/g, ' ')}</span>
                          )}
                          {!t.hasPhoto && <span className="text-[10px]" style={{ color: 'var(--color-neutral-400)' }}>no photo</span>}
                        </div>
                        {(t.serviceSkills.length > 0 || t.categorySkills.length > 0) && (
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
                            {t.serviceSkills.length > 0 ? t.serviceSkills.join(' · ') : t.categorySkills.map(serviceCategoryLabel).join(' · ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Coverage — the named communities, not the emirates CSV */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-neutral-400)' }}>
                  Coverage · {op.cards.coverage.zoneCount} zone{op.cards.coverage.zoneCount === 1 ? '' : 's'}
                </p>
                {op.coverageZones.length === 0 ? (
                  <p className="text-xs" style={{ color: '#dc2626' }}>No coverage zones picked.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {op.coverageZones.slice(0, 14).map((z) => (
                      <span key={z} className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>{z}</span>
                    ))}
                    {op.coverageZones.length > 14 && (
                      <span className="text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>+{op.coverageZones.length - 14} more</span>
                    )}
                  </div>
                )}
              </div>

              {/* Fleet + hours + rules, compact */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    Fleet · {op.cards.fleet.effectiveMaxConcurrentJobs} concurrent crew{op.cards.fleet.effectiveMaxConcurrentJobs === 1 ? '' : 's'}
                  </p>
                  {op.fleet.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>No vehicles.</p>
                  ) : (
                    op.fleet.map((v, i) => (
                      <p key={i} className="text-xs" style={{ color: 'var(--color-neutral-600)' }}>
                        {v.type.replace(/_/g, ' ')}{v.label ? ` · ${v.label}` : ''}
                      </p>
                    ))
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    Hours · {op.cards.hours.daysConfigured} day{op.cards.hours.daysConfigured === 1 ? '' : 's'}
                  </p>
                  {op.weeklyHours.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Not configured.</p>
                  ) : (
                    op.weeklyHours.map((h, i) => (
                      <p key={i} className="text-xs" style={{ color: 'var(--color-neutral-600)' }}>
                        {WEEKDAY_LABELS[h.weekday] ?? h.weekday} {String(h.opensAt).slice(0, 5)}–{String(h.closesAt).slice(0, 5)}
                      </p>
                    ))
                  )}
                  {op.timeOff.length > 0 && (
                    <p className="text-[11px] mt-1" style={{ color: '#b45309' }}>
                      Time off: {op.timeOff.map((t) => `${t.startsOn} → ${t.endsOn}`).join(', ')}
                    </p>
                  )}
                </div>
              </div>

              <p className="text-[11px]" style={{ color: 'var(--color-neutral-500)' }}>
                Job rules: {op.cards.rules.minNoticeHours}h min notice
                {op.cards.rules.dispatchLogic ? ` · ${op.cards.rules.dispatchLogic.replace(/_/g, ' ')}` : ''}
                {op.cards.rules.emergencyResponse ? ' · emergency response' : ''}
                {op.cards.rules.acceptedAt ? ` · rules accepted ${new Date(op.cards.rules.acceptedAt).toLocaleDateString('en-AE')}` : ' · rules NOT acknowledged'}
              </p>
            </div>
          )}
        </Section>

        {/* Services — every listing, each approvable/rejectable inline */}
        <Section icon={Layers} title={`Services (${ctx.services.length}) · ${approvedCount} approved · ${pendingCount} pending · ${rejectedCount} rejected`}>
          {!compliant && pendingCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 mb-2 text-[11px]" style={{ backgroundColor: '#fffbeb', color: '#b45309' }}>
              <AlertCircle size={13} /> Provider must be compliant before their listings can be approved. Complete KYC review first.
            </div>
          )}
          <div className="space-y-2.5">
            {groups.map((g) => (
              <div key={g.category}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-neutral-400)' }}>{serviceCategoryLabel(g.category)}</span>
                  <span className="text-[10px] px-1.5 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-400)' }}>{g.items.length}</span>
                </div>
                <div className="space-y-1">
                  {g.items.map((sv) => {
                    const isBusy = busy.has(sv.id) || bulking;
                    return (
                      <div key={sv.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-100)' }}>
                        <Wrench size={12} className="shrink-0" style={{ color: 'var(--color-neutral-400)' }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate" style={{ color: 'var(--color-neutral-800)' }}>
                            {sv.name}
                            {sv.isEmergency && <Zap size={9} className="inline ml-1" style={{ color: '#c2410c' }} />}
                          </p>
                          <p className="text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>{ctxSvcPrice(sv)}</p>
                        </div>
                        {uncoveredIds.has(sv.id) && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" title="No lead-capable technician is skilled in this exact service"
                            style={{ backgroundColor: '#fef9eb', color: '#b45309' }}>
                            No qualified lead
                          </span>
                        )}
                        <StatusBadge s={sv.listingStatus} />
                        <div className="flex items-center gap-1 shrink-0">
                          {sv.listingStatus !== 'approved' && (
                            <button type="button" disabled={isBusy || !compliant} title={!compliant ? 'Provider not compliant' : 'Approve'}
                              onClick={() => void actOne(sv.id, 'approve')}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-40"
                              style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                              <CheckCircle2 size={12} /> Approve
                            </button>
                          )}
                          {sv.listingStatus !== 'rejected' && (
                            <button type="button" disabled={isBusy} title="Reject"
                              onClick={() => void actOne(sv.id, 'reject')}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-40"
                              style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                              <XCircle size={12} /> Reject
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {actErr && <div className="rounded-xl p-2.5 text-xs" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>{actErr}</div>}
      </div>

      {/* Bulk action bar — approve / reject every pending listing at once */}
      {pendingCount > 0 && (
        <div className="shrink-0 border-t px-4 py-3 flex items-center gap-2" style={{ borderColor: 'var(--color-base-200)', backgroundColor: '#fff' }}>
          <span className="text-xs mr-auto" style={{ color: 'var(--color-neutral-500)' }}>{pendingCount} pending listing{pendingCount === 1 ? '' : 's'}</span>
          <button type="button" disabled={bulking || !compliant} title={!compliant ? 'Provider not compliant' : ''}
            onClick={() => void actAllPending('approve')}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
            <CheckCircle2 size={15} /> Approve all pending
          </button>
          <button type="button" disabled={bulking}
            onClick={() => void actAllPending('reject')}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
            <XCircle size={15} /> Reject all pending
          </button>
        </div>
      )}
    </div>
  );
}

function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-t" style={{ borderColor: 'var(--color-base-100)' }}>
      <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page === 0} className="p-1 rounded disabled:opacity-30 hover:bg-base-100">
          <ChevronLeft size={14} style={{ color: 'var(--color-neutral-500)' }} />
        </button>
        <span className="text-xs" style={{ color: 'var(--color-neutral-600)' }}>{page + 1}/{totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages - 1} className="p-1 rounded disabled:opacity-30 hover:bg-base-100">
          <ChevronRight size={14} style={{ color: 'var(--color-neutral-500)' }} />
        </button>
      </div>
    </div>
  );
}

// ─── View — single mode (RP or SP), no toggle. One per route page. ────────────

export function AdminListingsView({ mode }: { mode: 'rp' | 'sp' }) {
  // RP unit listings
  const [rpData, setRpData]         = useState<UnitListing[]>([]);
  const [rpTotal, setRpTotal]       = useState(0);
  const [rpPage, setRpPage]         = useState(0);
  const [rpCategory, setRpCategory] = useState<string[]>([]);
  const [rpStatus, setRpStatus]     = useState('pending');
  const [rpLoading, setRpLoading]   = useState(false);
  const [rpLoaded, setRpLoaded]     = useState(false);
  const [rpSel, setRpSel]           = useState<number | null>(null);

  // SP providers (grouped: one row per provider, all their services inside)
  const [spData, setSpData]         = useState<SpProviderRow[]>([]);
  const [spTotal, setSpTotal]       = useState(0);
  const [spPage, setSpPage]         = useState(0);
  const [spCategory, setSpCategory] = useState<string[]>([]);
  const [spStatus, setSpStatus]     = useState('pending');
  const [spLoading, setSpLoading]   = useState(false);
  const [spLoaded, setSpLoaded]     = useState(false);
  const [spSel, setSpSel]           = useState<number | null>(null);

  const [error, setError]   = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // Deep-link: seed the category filter from ?category= for Overview drill-downs.
  useEffect(() => {
    const cat = new URLSearchParams(window.location.search).get('category');
    if (cat) { if (mode === 'sp') setSpCategory([cat]); else setRpCategory([cat]); }
  }, [mode]);

  const fetchRp = useCallback(async (page: number, categories: string[], status: string) => {
    setRpLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE),
        ...(categories.length ? { spaceCategory: categories.join(',') } : {}),
        ...(status ? { status } : {}),
      });
      const resp = await apiGet<{ data: UnitListing[]; total: number }>(`/admin/unit-listings?${params}`);
      setRpData(resp.data ?? []);
      setRpTotal(resp.total ?? 0);
    } catch (err) { setError((err as Error).message); }
    finally { setRpLoading(false); setRpLoaded(true); }
  }, []);

  const fetchProviders = useCallback(async (page: number, categories: string[], status: string) => {
    setSpLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE),
        ...(categories.length ? { category: categories.join(',') } : {}),
        ...(status ? { status } : {}),
      });
      const resp = await apiGet<{ data: SpProviderRow[]; total: number }>(`/admin/service-listing-providers?${params}`);
      setSpData(resp.data ?? []);
      setSpTotal(resp.total ?? 0);
    } catch (err) { setError((err as Error).message); }
    finally { setSpLoading(false); setSpLoaded(true); }
  }, []);

  useEffect(() => { if (mode === 'rp') void fetchRp(rpPage, rpCategory, rpStatus); }, [mode, rpPage, rpCategory, rpStatus, fetchRp]);
  useEffect(() => { if (mode === 'sp') void fetchProviders(spPage, spCategory, spStatus); }, [mode, spPage, spCategory, spStatus, fetchProviders]);

  function handleRpCategory(c: string[]) { setRpCategory(c); setRpPage(0); setRpSel(null); }
  function handleRpStatus(s: string)     { setRpStatus(s); setRpPage(0); setRpSel(null); }
  function handleSpCategory(c: string[]) { setSpCategory(c); setSpPage(0); setSpSel(null); }
  function handleSpStatus(s: string)     { setSpStatus(s); setSpPage(0); setSpSel(null); }

  async function actOnUnit(u: UnitListing, action: 'approve' | 'reject' | 'expire') {
    if (!u.property) return;
    const verb = action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Expire';
    const suffix = action === 'expire' ? ' It comes off the market and stops showing to customers.' : '';
    if (!confirm(`${verb} unit ${u.unitNumber} at ${u.property.buildingName}?${suffix}`)) return;
    setActing(true);
    try {
      await apiPatch(`/admin/listings/${u.property.id}/units/${u.id}/${action}`, {});
      await fetchRp(rpPage, rpCategory, rpStatus);
    } catch (err) { setError((err as Error).message); }
    finally { setActing(false); }
  }

  const loading = mode === 'sp' ? spLoading : rpLoading;
  const listLen = mode === 'sp' ? spData.length : rpData.length;
  const loaded = mode === 'sp' ? spLoaded : rpLoaded;
  // "Nothing here" only after a settled fetch — an in-flight first load is the
  // spinner state, not an empty one.
  const isEmpty = !loading && loaded && listLen === 0;
  const total = mode === 'sp' ? spTotal : rpTotal;
  const page = mode === 'sp' ? spPage : rpPage;
  const selectedUnit = mode === 'rp' && rpSel != null ? rpData.find((u) => u.id === rpSel) ?? null : null;
  const selectedProvider = mode === 'sp' && spSel != null ? spData.find((s) => s.id === spSel) ?? null : null;
  const hasSelection = !!(selectedUnit || selectedProvider);
  const title = mode === 'sp' ? 'Service Provider Listings' : 'Rental Provider Listings';
  const TitleIcon = mode === 'sp' ? Wrench : Building2;

  function refresh() {
    if (mode === 'sp') void fetchProviders(spPage, spCategory, spStatus);
    else void fetchRp(rpPage, rpCategory, rpStatus);
  }
  // Silent refresh of the provider list (after an approve/reject inside the panel)
  // so the left-list counts stay in sync without a spinner flash.
  const refreshProviderCounts = useCallback(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE), offset: String(spPage * PAGE_SIZE),
      ...(spCategory.length ? { category: spCategory.join(',') } : {}),
      ...(spStatus ? { status: spStatus } : {}),
    });
    apiGet<{ data: SpProviderRow[]; total: number }>(`/admin/service-listing-providers?${params}`)
      .then((resp) => { setSpData(resp.data ?? []); setSpTotal(resp.total ?? 0); })
      .catch(() => { /* keep stale counts on transient error */ });
  }, [spPage, spCategory, spStatus]);

  return (
    <div className="flex flex-col h-full" style={{ padding: '12px 20px 16px' }}>
      <BackLink />

      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b flex-shrink-0" style={{ borderColor: 'var(--color-base-200)' }}>
        <TitleIcon size={16} style={{ color: 'var(--color-primary)' }} />
        <span className="text-sm font-bold" style={{ color: 'var(--color-neutral-900)' }}>{title}</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto p-1.5 rounded-lg transition-colors hover:bg-base-100"
          style={{ border: '1px solid var(--color-base-200)' }} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--color-neutral-500)' }} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-2 mt-2 text-sm flex-shrink-0" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>{error}</div>
      )}

      {/* Filters + split panel */}
      <div className="flex flex-col flex-1 min-h-0 mt-2">
        <div className="flex items-end justify-between gap-3 mb-2 flex-shrink-0">
          <StatusTabs mode={mode} value={mode === 'rp' ? rpStatus : spStatus} onChange={mode === 'rp' ? handleRpStatus : handleSpStatus} />
          <TypesDropdown
            options={mode === 'rp'
              ? SPACE_CATEGORIES.map((c) => ({ id: c.id, label: categoryDisplayLabel(c.id) }))
              : SERVICE_CATEGORIES}
            selected={mode === 'rp' ? rpCategory : spCategory}
            onChange={mode === 'rp' ? handleRpCategory : handleSpCategory}
            labelFor={mode === 'rp' ? categoryDisplayLabel : serviceCategoryLabel}
          />
        </div>

        {/* The split panel is always mounted — loading and "nothing here" are
            states *inside* the layout, not replacements for it, so the page
            never collapses to a bare message. */}
        <div className="flex rounded-2xl overflow-hidden border flex-1 min-h-0"
          style={{ borderColor: 'var(--color-base-200)', boxShadow: 'var(--shadow-sm)' }}>

          {/* LEFT — master list (RP: units · SP: one row per provider) */}
          <div className="flex flex-col shrink-0 border-r overflow-hidden"
            style={{ width: 300, borderColor: 'var(--color-base-200)', backgroundColor: '#fff' }}>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center" style={{ color: 'var(--color-neutral-400)' }}>
                  <RefreshCw size={22} strokeWidth={1.5} className="animate-spin" />
                  <p className="text-sm">Loading…</p>
                </div>
              ) : isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full gap-1.5 px-5 text-center" style={{ color: 'var(--color-neutral-400)' }}>
                  <Inbox size={28} strokeWidth={1.5} />
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-600)' }}>No listings found</p>
                  <p className="text-xs">{mode === 'sp' ? 'No providers with listings match these filters.' : 'No unit listings match these filters.'}</p>
                </div>
              ) : mode === 'rp' ? (
                rpData.map((u) => <UnitCard key={u.id} u={u} selected={rpSel === u.id} onClick={() => setRpSel(u.id)} />)
              ) : (
                spData.map((sp) => <ProviderCard key={sp.id} p={sp} selected={spSel === sp.id} onClick={() => setSpSel(sp.id)} />)
              )}
            </div>
            <Pagination page={page} total={total} pageSize={PAGE_SIZE}
              onChange={(pp) => { if (mode === 'rp') { setRpPage(pp); setRpSel(null); } else { setSpPage(pp); setSpSel(null); } }} />
          </div>

          {/* RIGHT — detail */}
          <div className="flex-1 overflow-hidden" style={{ backgroundColor: '#fafafa' }}>
            {!hasSelection ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center" style={{ color: 'var(--color-neutral-400)' }}>
                <MousePointerClick size={32} strokeWidth={1.5} />
                <p className="text-sm">
                  {isEmpty
                    ? 'Nothing to review with these filters'
                    : mode === 'sp' ? 'Select a provider to review their listings' : 'Select a listing to review'}
                </p>
              </div>
            ) : selectedUnit ? (
              <UnitDetailPanel row={selectedUnit} acting={acting}
                onApprove={(u) => void actOnUnit(u, 'approve')} onReject={(u) => void actOnUnit(u, 'reject')}
                onExpire={(u) => void actOnUnit(u, 'expire')} />
            ) : selectedProvider ? (
              <ProviderReviewPanel providerId={selectedProvider.id} onChanged={refreshProviderCounts} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
