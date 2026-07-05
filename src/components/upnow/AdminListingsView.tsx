'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Building2, RefreshCw, Wrench,
  CheckCircle2, XCircle, Clock, AlertCircle, EyeOff,
  ChevronLeft, ChevronRight, ChevronDown, ImageOff, MapPin, DollarSign, Info, Tag,
  MousePointerClick, FileText, ExternalLink,
} from 'lucide-react';
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
  marketPrice: number | null;
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

interface ServiceListing {
  id: number;
  name: string;
  description: string | null;
  category: string;
  basePrice: number | null;
  priceUnit: string | null;
  estimatedDuration: number | null;
  isAvailable: boolean;
  listingStatus: string;
  imageUrl: string | null;
  createdAt: string;
  provider: {
    id: number;
    userId: number;
    name: string | null;
    complianceStatus: string;
  } | null;
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

// All / Pending / Approved / Rejected — the backend maps these buckets onto each
// side's underlying status values.
const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: '',         label: 'All' },
  { id: 'pending',  label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
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

// Status as tabs (Pending / Approved / Rejected) — the primary filter.
function StatusTabs({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--color-base-200)' }}>
      {STATUS_FILTERS.filter((s) => s.id).map((st) => (
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
          Unit {u.unitNumber}{u.unitName ? ` — ${u.unitName}` : ''}
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

function ServiceCard({ s, selected, onClick }: { s: ServiceListing; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full text-left px-4 py-3.5 border-b transition-colors"
      style={{
        borderColor: 'var(--color-base-100)',
        backgroundColor: selected ? 'var(--color-primary-50)' : '#fff',
        borderLeft: selected ? '3px solid var(--color-primary)' : '3px solid transparent',
      }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>{s.name}</span>
        <StatusBadge s={s.listingStatus} />
      </div>
      <p className="text-xs truncate mb-1" style={{ color: 'var(--color-neutral-500)' }}>{s.provider?.name ?? 'Unknown provider'}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#ecfeff', color: '#0891b2' }}>
          {serviceCategoryLabel(s.category)}
        </span>
        <span className="text-xs font-medium" style={{ color: 'var(--color-neutral-700)' }}>
          {s.basePrice != null ? aed(s.basePrice) : '—'}
        </span>
      </div>
    </button>
  );
}

// ─── Right-column detail panels ───────────────────────────────────────────────

function ActionBar({ canApprove, canReject, acting, onApprove, onReject }: {
  canApprove: boolean; canReject: boolean; acting: boolean;
  onApprove: () => void; onReject: () => void;
}) {
  if (!canApprove && !canReject) return null;
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

function UnitDetailPanel({ row, acting, onApprove, onReject }: {
  row: UnitListing; acting: boolean;
  onApprove: (u: UnitListing) => void; onReject: (u: UnitListing) => void;
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

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 pb-3 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
              Unit {row.unitNumber}{row.unitName ? ` — ${row.unitName}` : ''}
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

            <Section icon={DollarSign} title="Pricing">
              <div className="rounded-lg p-2.5 mb-2.5" style={{ backgroundColor: 'var(--color-primary-50)' }}>
                <p className="text-xs" style={{ color: 'var(--color-primary)' }}>Annual Rent</p>
                <p className="text-lg font-bold" style={{ color: 'var(--color-primary)' }}>{aed(detail.rentalPrice)}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                <Field label="Security deposit" value={aed(detail.securityDeposit)} />
                <Field label="Service charges" value={aed(detail.serviceCharges)} />
                <Field label="Admin fee" value={aed(detail.adminFee)} />
                <Field label="Commission" value={aed(detail.commission)} />
                <Field label="Market price" value={aed(detail.marketPrice)} />
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
      <ActionBar canApprove={canApprove} canReject={canReject} acting={acting}
        onApprove={() => onApprove(row)} onReject={() => onReject(row)} />
    </div>
  );
}

function ServiceDetailPanel({ row, acting, onApprove, onReject }: {
  row: ServiceListing; acting: boolean;
  onApprove: (s: ServiceListing) => void; onReject: (s: ServiceListing) => void;
}) {
  const canApprove = row.listingStatus !== 'approved';
  const canReject  = row.listingStatus !== 'rejected';
  const price = row.basePrice != null ? `${aed(row.basePrice)}${row.priceUnit ? ` · ${row.priceUnit}` : ''}` : 'Price on request';

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 pb-3 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{row.name}</h2>
            <StatusBadge s={row.listingStatus} />
            {row.provider?.userId && (
              <Link href={`/dashboard/admin/users/${row.provider.userId}`} className="ml-auto text-xs" style={{ color: 'var(--color-primary)' }}>
                Provider ↗
              </Link>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>
            {row.provider?.name ?? 'Unknown provider'}{row.provider ? ` · SP #${row.provider.id}` : ''}
          </p>
        </div>

        <div className="space-y-3">
          {row.imageUrl && (
            <div className="rounded-xl overflow-hidden bg-gray-100" style={{ height: 160 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={row.imageUrl} alt={row.name} className="w-full h-full object-cover" />
            </div>
          )}

          <Section icon={Wrench} title="Service">
            <Field label="Category" value={serviceCategoryLabel(row.category)} />
            <Field label="Price" value={price} />
            <Field label="Duration" value={row.estimatedDuration != null ? `${row.estimatedDuration} min` : null} />
            <Field label="Availability" value={row.isAvailable ? 'Available' : 'Unavailable'} />
            <Field label="Provider compliance" value={row.provider?.complianceStatus?.replace(/_/g, ' ')} />
          </Section>

          {row.description && (
            <Section icon={Info} title="Description">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-neutral-700)' }}>{row.description}</p>
            </Section>
          )}
        </div>
      </div>
      <ActionBar canApprove={canApprove} canReject={canReject} acting={acting}
        onApprove={() => onApprove(row)} onReject={() => onReject(row)} />
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

  // SP service listings
  const [svcData, setSvcData]         = useState<ServiceListing[]>([]);
  const [svcTotal, setSvcTotal]       = useState(0);
  const [svcPage, setSvcPage]         = useState(0);
  const [svcCategory, setSvcCategory] = useState<string[]>([]);
  const [svcStatus, setSvcStatus]     = useState('pending');
  const [svcLoading, setSvcLoading]   = useState(false);
  const [svcLoaded, setSvcLoaded]     = useState(false);
  const [svcSel, setSvcSel]           = useState<number | null>(null);

  const [error, setError]   = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // Deep-link: seed the category filter from ?category= for Overview drill-downs.
  useEffect(() => {
    const cat = new URLSearchParams(window.location.search).get('category');
    if (cat) { if (mode === 'sp') setSvcCategory([cat]); else setRpCategory([cat]); }
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

  const fetchServices = useCallback(async (page: number, categories: string[], status: string) => {
    setSvcLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE),
        ...(categories.length ? { category: categories.join(',') } : {}),
        ...(status ? { status } : {}),
      });
      const resp = await apiGet<{ data: ServiceListing[]; total: number }>(`/admin/service-listings?${params}`);
      setSvcData(resp.data ?? []);
      setSvcTotal(resp.total ?? 0);
    } catch (err) { setError((err as Error).message); }
    finally { setSvcLoading(false); setSvcLoaded(true); }
  }, []);

  useEffect(() => { if (mode === 'rp') void fetchRp(rpPage, rpCategory, rpStatus); }, [mode, rpPage, rpCategory, rpStatus, fetchRp]);
  useEffect(() => { if (mode === 'sp') void fetchServices(svcPage, svcCategory, svcStatus); }, [mode, svcPage, svcCategory, svcStatus, fetchServices]);

  function handleRpCategory(c: string[]) { setRpCategory(c); setRpPage(0); setRpSel(null); }
  function handleRpStatus(s: string)     { setRpStatus(s); setRpPage(0); setRpSel(null); }
  function handleSvcCategory(c: string[]) { setSvcCategory(c); setSvcPage(0); setSvcSel(null); }
  function handleSvcStatus(s: string)     { setSvcStatus(s); setSvcPage(0); setSvcSel(null); }

  async function actOnUnit(u: UnitListing, action: 'approve' | 'reject') {
    if (!u.property) return;
    if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} unit ${u.unitNumber} at ${u.property.buildingName}?`)) return;
    setActing(true);
    try {
      await apiPatch(`/admin/listings/${u.property.id}/units/${u.id}/${action}`, {});
      await fetchRp(rpPage, rpCategory, rpStatus);
    } catch (err) { setError((err as Error).message); }
    finally { setActing(false); }
  }

  async function actOnService(s: ServiceListing, action: 'approve' | 'reject') {
    if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} service "${s.name}"?`)) return;
    setActing(true);
    try {
      await apiPatch(`/admin/service-listings/${s.id}/${action}`, {});
      await fetchServices(svcPage, svcCategory, svcStatus);
    } catch (err) { setError((err as Error).message); }
    finally { setActing(false); }
  }

  const loading = mode === 'sp' ? svcLoading : rpLoading;
  const list = mode === 'sp' ? svcData : rpData;
  const loaded = mode === 'sp' ? svcLoaded : rpLoaded;
  const total = mode === 'sp' ? svcTotal : rpTotal;
  const page = mode === 'sp' ? svcPage : rpPage;
  const selectedUnit = mode === 'rp' && rpSel != null ? rpData.find((u) => u.id === rpSel) ?? null : null;
  const selectedSvc  = mode === 'sp' && svcSel != null ? svcData.find((s) => s.id === svcSel) ?? null : null;
  const hasSelection = !!(selectedUnit || selectedSvc);
  const title = mode === 'sp' ? 'Service Provider Listings' : 'Rental Provider Listings';
  const TitleIcon = mode === 'sp' ? Wrench : Building2;

  function refresh() {
    if (mode === 'sp') void fetchServices(svcPage, svcCategory, svcStatus);
    else void fetchRp(rpPage, rpCategory, rpStatus);
  }

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
          <StatusTabs value={mode === 'rp' ? rpStatus : svcStatus} onChange={mode === 'rp' ? handleRpStatus : handleSvcStatus} />
          <TypesDropdown
            options={mode === 'rp'
              ? SPACE_CATEGORIES.map((c) => ({ id: c.id, label: categoryDisplayLabel(c.id) }))
              : SERVICE_CATEGORIES}
            selected={mode === 'rp' ? rpCategory : svcCategory}
            onChange={mode === 'rp' ? handleRpCategory : handleSvcCategory}
            labelFor={mode === 'rp' ? categoryDisplayLabel : serviceCategoryLabel}
          />
        </div>

        {loading && (
          <div className="rounded-2xl p-8 bg-white text-center text-sm flex-shrink-0" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>
            Loading…
          </div>
        )}

        {!loading && loaded && !error && list.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-2" style={{ color: 'var(--color-neutral-400)' }}>
            <MousePointerClick size={28} strokeWidth={1.5} />
            <p className="text-sm">{mode === 'sp' ? 'No service listings match these filters.' : 'No unit listings match these filters.'}</p>
          </div>
        )}

        {!loading && list.length > 0 && (
          <div className="flex rounded-2xl overflow-hidden border flex-1 min-h-0"
            style={{ borderColor: 'var(--color-base-200)', boxShadow: 'var(--shadow-sm)' }}>

            {/* LEFT — master list */}
            <div className="flex flex-col shrink-0 border-r overflow-hidden"
              style={{ width: 300, borderColor: 'var(--color-base-200)', backgroundColor: '#fff' }}>
              <div className="flex-1 overflow-y-auto">
                {mode === 'rp'
                  ? rpData.map((u) => <UnitCard key={u.id} u={u} selected={rpSel === u.id} onClick={() => setRpSel(u.id)} />)
                  : svcData.map((s) => <ServiceCard key={s.id} s={s} selected={svcSel === s.id} onClick={() => setSvcSel(s.id)} />)}
              </div>
              <Pagination page={page} total={total} pageSize={PAGE_SIZE}
                onChange={(pp) => { if (mode === 'rp') { setRpPage(pp); setRpSel(null); } else { setSvcPage(pp); setSvcSel(null); } }} />
            </div>

            {/* RIGHT — detail */}
            <div className="flex-1 overflow-hidden" style={{ backgroundColor: '#fafafa' }}>
              {!hasSelection ? (
                <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--color-neutral-400)' }}>
                  <MousePointerClick size={32} strokeWidth={1.5} />
                  <p className="text-sm">Select a listing to review</p>
                </div>
              ) : selectedUnit ? (
                <UnitDetailPanel row={selectedUnit} acting={acting}
                  onApprove={(u) => void actOnUnit(u, 'approve')} onReject={(u) => void actOnUnit(u, 'reject')} />
              ) : selectedSvc ? (
                <ServiceDetailPanel row={selectedSvc} acting={acting}
                  onApprove={(s) => void actOnService(s, 'approve')} onReject={(s) => void actOnService(s, 'reject')} />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
