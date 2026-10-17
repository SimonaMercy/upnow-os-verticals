'use client';
/* eslint-disable react-hooks/set-state-in-effect -- fetch-on-select and reset-on-change effects, the same pattern as the page this replaces */

/**
 * Admin › Listing approval · Gate 3 (Genspark split panel). Used by /dashboard/admin/listings/rental-providers
 * (mode 'rp' — Spaces unit listings) and /dashboard/admin/listings/service-providers (mode 'sp' — Services,
 * grouped one row per provider). Admin verifies and decides; it never edits or creates a provider's listing.
 *
 * Parity with previous page (all kept, same endpoints):
 *  Data
 *   - GET /admin/unit-listings?limit=25&offset=N[&spaceCategory=a,b][&status=]          (rp queue, total)
 *   - GET /admin/service-listing-providers?limit=25&offset=N[&category=a,b][&status=]   (sp queue, total; silent refresh after decisions)
 *   - GET /admin/listings/:propertyId/units/:unitId → { unit, media, documents }  (AbortController guarded)
 *   - GET /admin/kyc/service-providers/:id  (provider context: profile, checklist, services, operationalProfile)
 *   - GET /admin/kyc/service-providers/:id/capabilities  ·  …/capabilities/categories  (SP-248 / SP-268 tool checklists)
 *  Actions
 *   - PATCH /admin/listings/:propertyId/units/:unitId/approve | reject | expire
 *   - PATCH /admin/service-listings/:id/approve | reject   (single, and "all pending" bulk loop)
 *   - POST  /admin/service-listings/:id/capabilities/verify            { requirementIds, verified }  (listing extras)
 *   - POST  /admin/kyc/service-providers/:id/capabilities/verify       { requirementIds, verified }  (category tools)
 *   - Ask for changes / Reject now REQUIRE a reason (modal). The reason is sent as { reason } on the existing reject
 *     endpoint; these endpoints previously took {} — if the API refuses the field (400) the decision is retried with {}
 *     so the verdict still lands. "Ask for changes" uses the reject endpoint (there is no changes-requested state).
 *   - Approve / Expire keep their confirm step (modal instead of window.confirm).
 *  UI
 *   - Status tabs Pending (default) / Approved / Rejected / Expired (rp only); Types multi-select dropdown (space
 *     categories or service categories); ?category= deep link; pagination 25/page; refresh; loading / empty / error
 *   - RERA rental-index filter chip "Exceeds RERA index (n)" + per-item badge (restored from the SCRUM-594 split; same
 *     caps; ≥ 20% above cap) — filters the current page, pagination suppressed while on
 *   - Unit detail: photo carousel, location (Makani, map link), specs (beds/baths residential only), pricing, amenities,
 *     description, documents (view-only, in-portal viewer), "Open full page" → /dashboard/admin/units/:id
 *   - Provider detail: identity & key facts, Profile → /dashboard/admin/users/:userId, compliance documents, operational
 *     profile (team, coverage, fleet, hours, rules), services by category with category tools + per-listing extra tools
 *     (photos, verify / withdraw, verify all declared), "No qualified lead" flag, compliant-gate on approve, bulk actions
 *   - NEW: Gate 3 checklist per record (derived from the same payloads).
 *  Decision model (blueprint "three gates, one decision model") — added, nothing removed:
 *   - Ask for changes / Reject (units, single service, "all pending" bulk) now take Gate 3 reason codes from
 *     src/lib/os/reasonCodes.ts + an optional note, with a statement-of-reasons preview. The text sent in the
 *     SAME { reason } field (same 400 → {} fallback, same "Changes requested: " prefix) is
 *     "[CODE] Explanation To fix: … — note". Approve / Expire keep their confirm step; the expire endpoint
 *     takes no reason ({}), so Expire carries no reason code (backend gap, said in the modal).
 *   - Queue SLA: GET /admin/unit-listings and /admin/service-listing-providers rows carry no submitted /
 *     created / updated timestamp, so the queue lists cannot show waiting time or sort oldest-first (backend
 *     gap — order stays as the API returns it). The unit detail shows an SLA pill from the detail payload's
 *     real updatedAt ("since last change") for pending / in-review listings.
 */
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { openDocViewer } from '@/lib/docViewer';
import { SPACE_CATEGORIES, categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { ReasonPicker, SlaPill, StatementPreview, useReasonCodes } from '@/components/upnow/GateDecision';
import { composeReasonText } from '@/lib/os/reasonCodes';
import {
  Btn, Callout, Card, Checklist, Evid, KV, Modal, OsPage, PageHead, Pill, ScopeStrip, Seg, fmtAed, fmtDate, type Tone,
} from '@/components/os/kit';

// ─── Types ────────────────────────────────────────────────────────────────────

type ListingStatus = 'draft' | 'pending' | 'in_review' | 'published' | 'approved' | 'rejected' | 'expired';

interface UnitListing {
  id: number; unitNumber: string; unitName: string | null; unitType: string; listingStatus: ListingStatus; annualRent: number | null;
  property: { id: number; buildingName: string; fullAddress: string | null; rentalProviderId: number; spaceCategory: string } | null;
}
interface UnitMedia { id: number; url: string; caption: string | null; mediaType: string; sortOrder: number }
interface ListingDoc { id: number; documentKey: string; fileUrl: string | null; status: string | null; expiryDate: string | null }
interface UnitDetail {
  id: number; unitNumber: string; unitName: string | null; floor: string | null; unitType: string; unitTier: string;
  unitSizeSqft: number | null; unitSizeSqm: number | null; bedrooms: number | null; bathrooms: number | null;
  kitchenType: string | null; numBalconies: number; view: string | null; numAcs: number; rentalPrice: number | null;
  serviceCharges: number | null; securityDeposit: number | null; adminFee: number | null; ejariFeeFils: number | null;
  commission: number | null; availability: string; description: string | null; listingStatus: ListingStatus;
  createdAt?: string | null; updatedAt?: string | null;
  property: {
    id: number; buildingName: string; fullAddress: string | null; spaceCategory: string; rentalProviderId: number;
    numberOfFloors: string | null; hasGym: boolean; hasPool: boolean; hasParking: boolean; propertyDescription: string | null;
    makaniNumber: string | null; mapLink: string | null;
    emirate?: { name: string } | null; community?: { name: string } | null; subCommunity?: { name: string } | null;
  };
}
interface SpChecklistItem { key: string; displayName: string; category: string; required: boolean; uploaded: boolean; status: string | null; fileUrl: string | null; expiryDate: string | null }
interface SpContextService { id: number; category: string; name: string; basePrice: number | null; priceUnit: string | null; pricingMode: string; isEmergency: boolean; listingStatus: string; isAvailable: boolean }
/** SP-248 — one listing's capability checklist as the drawer reads it. */
interface CapabilityRow {
  requirementId: number; key: string; label: string; description: string | null; requirementType: string;
  isMandatory: boolean; evidenceRequired: boolean; declared: boolean; declaredAt: string | null; note: string | null;
  /** SP-268 — authored on the category (shared) or this one template (extra). */
  scope?: 'category' | 'template';
  /** SP-267 — signed view URL of the provider's photo of this tool (null = none). */
  photoUrl?: string | null; photoUploadedAt?: string | null;
  verifiedAt: string | null; verifiedByName: string | null;
}
interface CapabilitySummary {
  total: number; mandatory: number; declared: number; declaredMandatory: number; verified: number; verifiedMandatory: number;
  declarationComplete: boolean; verificationComplete: boolean; withPhoto: number; photosMissing: number;
}
interface ListingChecklist { serviceCatalogId: number; templateId: number | null; serviceName: string; summary: CapabilitySummary; rows: CapabilityRow[] }
/** SP-268 — the provider's tools per CATEGORY (declared once; verified once). */
interface CategoryChecklist { categoryId: number; categoryCode: string; categoryName: string; listingCount: number; summary: CapabilitySummary; rows: CapabilityRow[] }
interface OperationalProfile {
  jobReady: boolean; jobReadyAt: string | null;
  cards: {
    coverage: { complete: boolean; zoneCount: number };
    team: { complete: boolean; adoptedCategories: string[]; coveredCategories: string[]; missingCategories: string[]; uncoveredServices: { id: number; name: string; category: string }[]; activeTechnicians: number; leadCapable: number };
    fleet: { complete: boolean; vehicles: number; effectiveMaxConcurrentJobs: number };
    hours: { complete: boolean; daysConfigured: number };
    rules: { complete: boolean; acceptedAt: string | null; minNoticeHours: number; dispatchLogic: string | null; emergencyResponse: boolean };
  };
  /** SP-254: 'solo' = the individual is the provider AND the one technician. */
  supplyType?: 'solo' | 'company';
  team: { id: number; name: string; isSelf?: boolean; status: string; isLeadCapable: boolean; hasPhoto: boolean; complianceStatus: string | null; specialization: string | null; categorySkills: string[]; serviceSkills: string[] }[];
  coverageZones: string[];
  fleet: { type: string; label: string | null }[];
  weeklyHours: { weekday: number; opensAt: string; closesAt: string }[];
  timeOff: { startsOn: string; endsOn: string; reason: string | null }[];
}
interface SpContext {
  profile: {
    id: number; userId: number; businessName: string | null; companyName: string | null; ownerName: string | null; entityType: string | null;
    isGovernment: boolean; tradeLicenseNumber: string | null; vatTrn: string | null; emiratesServed: string | null; serviceCategories: string | null;
    complianceStatus: string; jobReadyAt: string | null; averageRating: number | null; totalReviews: number; emergencyResponse: boolean;
    opsContactName: string | null; opsContactPhone: string | null; createdAt: string;
    user?: { name: string | null; email: string | null; phone: string | null } | null;
  };
  checklist: SpChecklistItem[]; completionScore: number; services: SpContextService[];
  /** Evidence behind the Job-ready chip (SP-247). */
  operationalProfile?: OperationalProfile | null;
}
/** One row per provider in the grouped moderation queue — GET /admin/service-listing-providers. */
interface SpProviderRow {
  id: number; userId: number; name: string | null; entityType: string | null; complianceStatus: string; serviceCategories: string | null;
  jobReady: boolean; total: number; pending: number; approved: number; rejected: number;
}

type Decision = 'approve' | 'changes' | 'reject' | 'expire';
type ChkItem = { l: string; sub?: string; state: 'pass' | 'fail' | 'wait' };

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

// v2 service taxonomy — mirrors service_categories codes owned by the Service Catalog console.
const SERVICE_CATEGORIES: { id: string; label: string }[] = [
  { id: 'home_cleaning', label: 'Home Cleaning' }, { id: 'ac_services', label: 'AC Services' }, { id: 'plumbing', label: 'Plumbing' },
  { id: 'electrical', label: 'Electrical' }, { id: 'handyman', label: 'Handyman' }, { id: 'painting', label: 'Painting' },
  { id: 'pest_control', label: 'Pest Control' }, { id: 'car_vehicle', label: 'Car & Vehicle' },
  { id: 'landscaping_outdoor', label: 'Landscaping & Outdoor' }, { id: 'commercial_services', label: 'Commercial Services' },
];
const serviceCategoryLabel = (id: string) => SERVICE_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

// sp_working_hours.weekday: 0 = Sunday … 6 = Saturday.
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_TABS: { id: string; label: string; rpOnly?: boolean }[] = [
  { id: 'pending', label: 'Pending' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' },
  // A service listing never ages out, so Expired is rental-only.
  { id: 'expired', label: 'Expired', rpOnly: true },
];

const LISTING: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, pending: { label: 'Pending', tone: 'amber' }, in_review: { label: 'In review', tone: 'info' },
  published: { label: 'Published', tone: 'primary' }, approved: { label: 'Approved', tone: 'primary' }, rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Expired', tone: 'danger' },
  // Auto-set when the provider loses their last qualified lead technician for the service (SP-249); Approve restores.
  suspended_no_qualified_technician: { label: 'Suspended — no lead', tone: 'amber' },
};
const ListingPill = ({ s }: { s: string }) => { const c = LISTING[s] ?? LISTING.draft; return <Pill tone={c.tone}>{c.label}</Pill>; };

const COMPLIANCE: Record<string, { label: string; tone: Tone }> = {
  compliant: { label: 'Compliant', tone: 'primary' }, pending_review: { label: 'Pending review', tone: 'amber' },
  action_required: { label: 'Action required', tone: 'danger' }, expired: { label: 'Expired', tone: 'danger' }, paused: { label: 'Paused', tone: 'neutral' },
};
const CompliancePill = ({ s }: { s: string }) => { const c = COMPLIANCE[s] ?? COMPLIANCE.pending_review; return <Pill tone={c.tone}>{c.label}</Pill>; };

// ─── RERA rental index (restored from the pre-SCRUM-594 listings page) ────────
// Indicative Q1 2026 RERA index caps (AED/yr) by space category. Units priced ≥ 20% above are flagged.
const RERA_INDEX_CAP: Record<string, number> = { residential: 145000, commercial: 270000, industrial: 160000, land: 220000, mixed_use: 240000 };
const reraCap = (category: string | null | undefined) => RERA_INDEX_CAP[category ?? ''] ?? 200000;
function indexDeviation(rentAed: number | null | undefined, category: string | null | undefined): number | null {
  const rent = rentAed != null ? Number(rentAed) : null;
  if (!rent) return null;
  const cap = reraCap(category);
  const pct = Math.round(((rent - cap) / cap) * 100);
  return pct >= 20 ? pct : null;
}

const PRICE_UNIT_SUFFIX: Record<string, string> = { fixed: '', per_hour: '/hr', per_unit: '/unit', per_area: '/m²', per_period: '/period', quote_after_callout: '' };
function ctxSvcPrice(s: SpContextService): string {
  if (s.pricingMode === 'quote' || s.priceUnit === 'quote_after_callout') return 'Quote';
  if (s.basePrice == null) return '—';
  return `${fmtAed(s.basePrice)}${PRICE_UNIT_SUFFIX[s.priceUnit ?? ''] ?? ''}`;
}
const csvToList = (s: string | null | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const titleize = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ');

/** Contact details that would take the customer off-platform (phone, email, link, messenger). */
const OFF_PLATFORM: { re: RegExp; l: string }[] = [
  { re: /\+?\d[\d\s-]{7,}\d/, l: 'phone number' },
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, l: 'email address' },
  { re: /https?:\/\/|www\./i, l: 'web link' },
  { re: /\b(whats ?app|wa\.me|telegram|call me|dm me)\b/i, l: 'messenger / call-me' },
];
const offPlatformHits = (text: string) => OFF_PLATFORM.filter((o) => o.re.test(text)).map((o) => o.l);
const PERMIT_KEY = /permit|trakheesi|title_deed|ejari|rera|dtcm|noc|oqood|affection/i;

/**
 * The existing decision endpoints took {}. A reason is now always collected for reject / changes and sent as
 * { reason }; if the API refuses the extra field (400) the verdict is retried with {} so it still lands.
 */
async function patchDecision(path: string, reason?: string) {
  if (!reason) return apiPatch(path, {});
  try {
    return await apiPatch(path, { reason });
  } catch (e) {
    if ((e as { status?: number }).status === 400) return apiPatch(path, {});
    throw e;
  }
}

// ─── Small parts ─────────────────────────────────────────────────────────────

function TypesDropdown({ options, selected, onChange, labelFor }: {
  options: { id: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void; labelFor: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const label = selected.length === 0 ? 'All types' : selected.length === 1 ? labelFor(selected[0]) : `${selected.length} types`;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="gx-btn sm" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Types: {label} <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <div role="group" aria-label="Types" style={{ position: 'absolute', zIndex: 30, top: 30, left: 0, minWidth: 230, background: 'var(--ms-surface)', border: '1px solid var(--ms-border)', borderRadius: 10, boxShadow: 'var(--ms-shadow-md)', padding: 6 }}>
          <div className="flex items-center" style={{ padding: '4px 6px 6px', borderBottom: '1px solid var(--ms-surface-3)' }}>
            <span className="gx-lb" style={{ margin: 0, flex: 1 }}>Types</span>
            {selected.length > 0 && <Btn size="xs" variant="ghost" onClick={() => onChange([])}>Clear</Btn>}
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', paddingTop: 4 }}>
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2" style={{ padding: '5px 6px', fontSize: 12, cursor: 'pointer', borderRadius: 6 }}>
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2" style={{ padding: '9px 12px', borderTop: '1px solid var(--ms-surface-3)', fontSize: 11, color: 'var(--ms-ink-3)', position: 'sticky', bottom: 0, background: 'var(--ms-surface-2)' }}>
      <span style={{ flex: 1 }}>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}</span>
      <Btn size="xs" onClick={() => onChange(page - 1)} disabled={page === 0}>Previous</Btn>
      <span>{page + 1}/{totalPages}</span>
      <Btn size="xs" onClick={() => onChange(page + 1)} disabled={page >= totalPages - 1}>Next</Btn>
    </div>
  );
}

function DetailHead({ title, pills, right, sub }: { title: ReactNode; pills?: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--ms-surface-3)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>{title}</h2>
        {pills}
        {right && <div className="flex items-center gap-2 flex-wrap" style={{ marginLeft: 'auto' }}>{right}</div>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
const gap = { marginTop: 12 } as const;
const muted = { fontSize: 11.5, color: 'var(--ms-ink-3)' } as const;

function PanelSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" style={{ display: 'grid', gap: 10, padding: '6px 0' }}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="gx-skel" style={{ height: 14, width: `${90 - (i % 3) * 18}%` }} />)}
    </div>
  );
}

/** Sticky decision footer inside the detail column. */
function DecisionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div style={{ position: 'sticky', bottom: -16, margin: '16px -18px -16px', padding: '12px 18px', background: 'var(--ms-surface)', borderTop: '1px solid var(--ms-border)', zIndex: 2 }}>
      {note && <div style={{ fontSize: 11, color: 'var(--ms-ink-3)', marginBottom: 8 }}>{note}</div>}
      <div className="gx-btn-row">{children}</div>
    </div>
  );
}

/** Confirm (approve / expire) or reason-coded (changes / reject) dialog. */
function DecisionModal({ open, kind, subject, busy, error, onClose, onConfirm }: {
  open: boolean; kind: Decision | null; subject: string; busy: boolean; error: string | null;
  onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const reasons = useReasonCodes();
  const { reset } = reasons;
  useEffect(() => { if (open) reset(); }, [open, kind, subject, reset]);
  if (!kind) return null;
  const needsReason = kind === 'reject' || kind === 'changes';
  const verb = kind === 'approve' ? 'Approve' : kind === 'expire' ? 'Expire' : kind === 'reject' ? 'Reject' : 'Ask for changes';
  const submit = () => {
    if (needsReason) {
      reasons.setTouched(true);
      if (reasons.error) return;
      onConfirm(composeReasonText(reasons.selected, reasons.text));
      return;
    }
    onConfirm('');
  };
  return (
    <Modal open={open} onClose={() => !busy && onClose()} width={needsReason ? 580 : 480} title={`${verb} — ${subject}`}
      footer={<>
        <span className="sp" />
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant={kind === 'approve' ? 'primary' : kind === 'changes' ? 'amber' : 'danger'} onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : kind === 'changes' ? 'Send request' : verb}
        </Btn>
      </>}>
      {kind === 'approve' && <div style={{ fontSize: 12.5 }}>The listing goes live and becomes visible to customers.</div>}
      {kind === 'expire' && (
        <>
          <div style={{ fontSize: 12.5 }}>It comes off the market and stops showing to customers. Use this for a listing that was legitimately live and has aged out — not as a rejection.</div>
          <div style={{ fontSize: 11, color: 'var(--ms-ink-3)', marginTop: 8 }}>The expire endpoint takes no reason, so no reason code or message is sent to the provider.</div>
        </>
      )}
      {needsReason && (
        <>
          <div style={{ fontSize: 12, marginBottom: 10, color: 'var(--ms-ink-2)' }}>
            {kind === 'changes'
              ? 'The listing goes back to the provider (recorded as Rejected) with this message, and they resubmit.'
              : 'The listing cannot go live. The provider sees this message.'}
          </div>
          <ReasonPicker gate={3} decision={kind} state={reasons} idPrefix="gate3" />
          <StatementPreview decisionLabel={kind === 'changes' ? 'Request changes (Gate 3)' : 'Reject listing (Gate 3)'}
            state={reasons} sentAs="the rejection reason" prefix={kind === 'changes' ? 'Changes requested: ' : ''} />
        </>
      )}
      {error && <div className="gx-err" role="alert">{error}</div>}
    </Modal>
  );
}

// ─── Right column: unit listing ───────────────────────────────────────────────

function UnitDetailPanel({ row, acting, lastDecision, onDecide }: {
  row: UnitListing; acting: boolean; lastDecision: { id: number; kind: Decision; reason: string } | null;
  onDecide: (u: UnitListing, kind: Decision) => void;
}) {
  const [detail, setDetail] = useState<UnitDetail | null>(null);
  const [media, setMedia] = useState<UnitMedia[]>([]);
  const [docs, setDocs] = useState<ListingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [nonce, setNonce] = useState(0);
  const propertyId = row.property?.id;

  useEffect(() => {
    setDetail(null); setMedia([]); setDocs([]); setPhotoIdx(0); setLoading(true); setErr(null);
    if (propertyId == null) { setLoading(false); return; }
    const controller = new AbortController();
    apiGet<{ unit: UnitDetail; media: UnitMedia[]; documents: ListingDoc[] }>(`/admin/listings/${propertyId}/units/${row.id}`, { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) { setDetail(r.unit); setMedia(r.media ?? []); setDocs(r.documents ?? []); } })
      .catch((e) => { if (!controller.signal.aborted) setErr((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [row.id, propertyId, nonce]);

  const photos = media.filter((m) => m.mediaType === 'photo');
  const p = detail?.property;
  const locationParts = [p?.emirate?.name, p?.community?.name, p?.subCommunity?.name].filter(Boolean);
  const canApprove = row.listingStatus !== 'published';
  const canReject = row.listingStatus !== 'rejected';
  // Only a listing that actually reached the market can expire.
  const canExpire = ['published', 'approved'].includes(row.listingStatus);
  const residential = detail ? isResidentialUnitType(detail.unitType) : false;

  // ── Gate 3 checklist ──
  const gate: ChkItem[] = [];
  if (detail) {
    gate.push(photos.length > 0
      ? { l: 'Photos', sub: `${photos.length} photo${photos.length === 1 ? '' : 's'} uploaded`, state: 'pass' }
      : { l: 'Photos', sub: 'No photos uploaded', state: 'fail' });
    const basics = [!detail.rentalPrice && 'rent', !detail.unitType && 'unit type', !detail.description && 'description'].filter(Boolean) as string[];
    gate.push(basics.length === 0
      ? { l: 'Title, details & price', sub: `Unit ${detail.unitNumber}${detail.unitName ? ` — ${detail.unitName}` : ''} · ${fmtAed(detail.rentalPrice)}/yr`, state: 'pass' }
      : { l: 'Title, details & price', sub: `Missing: ${basics.join(', ')}`, state: 'fail' });
    const permit = docs.find((d) => PERMIT_KEY.test(d.documentKey) && d.fileUrl);
    gate.push(permit
      ? { l: 'Permit / title document', sub: `${titleize(permit.documentKey)} linked${permit.status ? ` · ${titleize(permit.status)}` : ''}`, state: 'pass' }
      : docs.length > 0
        ? { l: 'Permit / title document', sub: `${docs.length} document${docs.length === 1 ? '' : 's'} linked — none looks like a permit; open them to confirm`, state: 'wait' }
        : { l: 'Permit / title document', sub: 'No permit or title document linked to the unit or its property', state: 'fail' });
    const hits = offPlatformHits(`${detail.description ?? ''} ${p?.propertyDescription ?? ''}`);
    gate.push(hits.length === 0
      ? { l: 'No off-platform contact', sub: 'Descriptions carry no phone, email, link or messenger handle', state: 'pass' }
      : { l: 'No off-platform contact', sub: `Description contains a ${hits.join(', ')}`, state: 'fail' });
    const dev = indexDeviation(detail.rentalPrice, p?.spaceCategory);
    gate.push(!detail.rentalPrice
      ? { l: 'Price within range', sub: 'No rent to compare', state: 'wait' }
      : dev == null
        ? { l: 'Price within range', sub: `Within 20% of the RERA index cap (${fmtAed(reraCap(p?.spaceCategory))}/yr ${categoryDisplayLabel(p?.spaceCategory ?? '')})`, state: 'pass' }
        : { l: 'Price within range', sub: `${dev}% above the RERA index cap (${fmtAed(reraCap(p?.spaceCategory))}/yr) — check the rental index`, state: 'fail' });
    const fields = [
      !detail.unitTier && 'tier', !detail.floor && 'floor', !(detail.unitSizeSqft || detail.unitSizeSqm) && 'size',
      !detail.availability && 'availability',
      residential && detail.bedrooms == null && 'bedrooms', residential && detail.bathrooms == null && 'bathrooms',
    ].filter(Boolean) as string[];
    gate.push(fields.length === 0
      ? { l: 'Subcategory fields completed', sub: `${categoryDisplayLabel(p?.spaceCategory ?? '')} · ${titleize(detail.unitType)}`, state: 'pass' }
      : { l: 'Subcategory fields completed', sub: `Missing: ${fields.join(', ')}`, state: 'fail' });
  }
  const passing = gate.filter((g) => g.state === 'pass').length;
  const decided = lastDecision?.id === row.id ? lastDecision : null;

  return (
    <>
      <DetailHead title={`Unit ${row.unitNumber}`}
        pills={<><ListingPill s={row.listingStatus} />{['pending', 'in_review'].includes(row.listingStatus) && detail?.updatedAt && <SlaPill iso={detail.updatedAt} what="Waiting" title="Time since the listing was last changed (the queue has no submitted-at)" />}</>}
        right={<Btn size="sm" href={`/dashboard/admin/units/${row.id}`}>Open full page</Btn>}
        sub={`${row.property?.buildingName ?? '—'}${row.property ? ` · RP #${row.property.rentalProviderId} · ${categoryDisplayLabel(row.property.spaceCategory)}` : ''}`} />

      {loading && <PanelSkeleton />}
      {!loading && err && <Callout tone="bad" title="Couldn't load this listing.">{err} <Btn size="xs" onClick={() => setNonce((n) => n + 1)}>Try again</Btn></Callout>}
      {decided && <Evid tone={decided.kind === 'approve' ? 'ok' : decided.kind === 'expire' ? 'warn' : 'bad'}>Decision recorded: {decided.kind === 'changes' ? 'Changes requested' : decided.kind === 'approve' ? 'Approved' : decided.kind === 'expire' ? 'Expired' : 'Rejected'}{decided.reason ? ` — ${decided.reason}` : ''}</Evid>}

      {!loading && detail && (
        <>
          {photos.length > 0 ? (
            <div style={{ position: 'relative', height: 200, borderRadius: 12, overflow: 'hidden', background: 'var(--ms-surface-3)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[photoIdx]?.url} alt={photos[photoIdx]?.caption ?? `Photo ${photoIdx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {photos.length > 1 && (
                <div className="flex items-center gap-2" style={{ position: 'absolute', bottom: 8, right: 8 }}>
                  <Btn size="xs" onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}><ChevronLeft size={12} aria-hidden /> Previous</Btn>
                  <Pill tone="dark" dot={false}>{photoIdx + 1}/{photos.length}</Pill>
                  <Btn size="xs" onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}>Next <ChevronRight size={12} aria-hidden /></Btn>
                </div>
              )}
            </div>
          ) : <Callout tone="bad">No photos uploaded.</Callout>}

          <div style={gap}>
            <Card title="Gate 3 · Listing review" sub={`${passing}/${gate.length} checks passing`} pad>
              <Checklist items={gate} />
            </Card>
          </div>

          <div style={gap} className="gx-two">
            <Card title="Location" pad>
              <KV items={[
                { k: 'Building', v: p?.buildingName },
                { k: 'Area', v: locationParts.length ? locationParts.join(' › ') : undefined },
                { k: 'Address', v: p?.fullAddress },
                { k: 'Makani', v: p?.makaniNumber },
                { k: 'Map', v: p?.mapLink ? <a href={p.mapLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ms-primary)' }}>Open map</a> : undefined },
              ]} />
            </Card>
            <Card title="Pricing" pad>
              <KV items={[
                { k: 'Annual rent', v: <span style={{ color: 'var(--ms-primary-dark)', fontSize: 15, fontWeight: 800 }}>{fmtAed(detail.rentalPrice)}</span> },
                { k: 'Security deposit', v: fmtAed(detail.securityDeposit) },
                { k: 'Service charges', v: fmtAed(detail.serviceCharges) },
                { k: 'Admin fee', v: fmtAed(detail.adminFee) },
                { k: 'Commission', v: fmtAed(detail.commission) },
              ]} />
            </Card>
          </div>

          <div style={gap}>
            <Card title="Unit specs" pad>
              <KV items={[
                { k: 'Type', v: titleize(detail.unitType) },
                { k: 'Floor', v: detail.floor },
                { k: 'Available', v: titleize(detail.availability) },
                { k: 'Tier', v: titleize(detail.unitTier) },
                ...(residential ? [
                  { k: 'Beds', v: detail.bedrooms != null ? (detail.bedrooms === 0 ? 'Studio' : String(detail.bedrooms)) : undefined },
                  { k: 'Baths', v: detail.bathrooms != null ? String(detail.bathrooms) : undefined },
                ] : []),
                { k: 'sqft', v: detail.unitSizeSqft ? Number(detail.unitSizeSqft).toLocaleString('en-AE') : undefined },
                { k: 'sqm', v: detail.unitSizeSqm ? Number(detail.unitSizeSqm).toLocaleString('en-AE') : undefined },
              ]} />
              <div className="gx-btn-row" style={{ marginTop: 12 }}>
                {[{ l: 'Gym', on: p?.hasGym }, { l: 'Pool', on: p?.hasPool }, { l: 'Parking', on: p?.hasParking }].map((a) => (
                  <Pill key={a.l} tone={a.on ? 'primary' : 'neutral'}>{a.l}{a.on ? '' : ' — no'}</Pill>
                ))}
                {detail.view && <Pill tone="info" dot={false}>{detail.view} view</Pill>}
              </div>
            </Card>
          </div>

          {(detail.description || p?.propertyDescription) && (
            <div style={gap}>
              <Card title="Description" pad>
                {detail.description && <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{detail.description}</div>}
                {p?.propertyDescription && <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ms-ink-3)', marginTop: 6 }}>{p.propertyDescription}</div>}
              </Card>
            </div>
          )}

          <div style={gap}>
            <Card title={`Documents (${docs.length})`} sub="Unit + property — view only" pad>
              {docs.length === 0 ? <div style={muted}>No documents linked to this unit or its property.</div> : docs.map((doc) => {
                const ok = ['processed', 'complete', 'approved'].includes(String(doc.status).toLowerCase());
                return (
                  <div key={doc.id} className="flex items-center gap-2" style={{ padding: '8px 0', borderBottom: '1px solid var(--ms-surface-3)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{titleize(doc.documentKey)}</div>
                      {doc.expiryDate && <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>Expires {fmtDate(doc.expiryDate)}</div>}
                    </div>
                    <Pill tone={ok ? 'primary' : 'amber'}>{titleize(String(doc.status ?? 'pending').toLowerCase())}</Pill>
                    {doc.fileUrl
                      ? <Btn size="xs" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: titleize(doc.documentKey) })}>View</Btn>
                      : <Pill tone="outline" dot={false}>Requested</Pill>}
                  </div>
                );
              })}
            </Card>
          </div>
        </>
      )}

      {(canApprove || canReject || canExpire) && (
        <DecisionBar note={detail && passing < gate.length ? `${gate.length - passing} check${gate.length - passing === 1 ? '' : 's'} not passing — approving over them is allowed, but deliberate.` : undefined}>
          {canApprove && <Btn variant="primary" disabled={acting} onClick={() => onDecide(row, 'approve')}>Approve</Btn>}
          {canReject && <Btn variant="amber" disabled={acting} onClick={() => onDecide(row, 'changes')}>Ask for changes</Btn>}
          {canReject && <Btn variant="danger" disabled={acting} onClick={() => onDecide(row, 'reject')}>Reject</Btn>}
          {/* Expire — for a listing that was legitimately live and has aged out (SCRUM-663). */}
          {canExpire && <Btn disabled={acting} onClick={() => onDecide(row, 'expire')}>Expire</Btn>}
        </DecisionBar>
      )}
    </>
  );
}

// ─── Right column: service provider (all their listings) ──────────────────────

function ToolsList({ rows, busy, onVerify, verifyAllLabel, onVerifyAll, title }: {
  rows: CapabilityRow[]; busy: boolean; title: string; verifyAllLabel: string;
  onVerify: (r: CapabilityRow) => void; onVerifyAll: (() => void) | null;
}) {
  return (
    <div style={{ margin: '6px 0 8px', padding: '9px 11px', border: '1px dashed var(--ms-border-strong)', borderRadius: 8, background: 'var(--ms-surface-2)' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span className="gx-lb" style={{ margin: 0, flex: 1 }}>{title}</span>
        <Btn size="xs" disabled={busy || !onVerifyAll} onClick={() => onVerifyAll?.()}>{busy ? 'Verifying…' : verifyAllLabel}</Btn>
      </div>
      {rows.map((r) => (
        <div key={r.requirementId} className="flex items-start gap-2" style={{ padding: '5px 0', fontSize: 11.5 }}>
          <Pill tone={r.declared ? 'primary' : r.isMandatory ? 'amber' : 'neutral'} dot={false}>{r.declared ? 'Declared' : 'Not declared'}</Pill>
          <div style={{ flex: 1, minWidth: 0, color: r.declared ? 'var(--ms-ink)' : 'var(--ms-ink-3)' }}>
            {r.label}{!r.isMandatory && <span style={{ color: 'var(--ms-ink-3)' }}> (optional)</span>}
            <span style={{ marginLeft: 5, fontSize: 9.5, textTransform: 'uppercase', color: 'var(--ms-ink-3)' }}>{r.requirementType}</span>
            {r.note && <div style={{ fontStyle: 'italic', color: 'var(--ms-ink-3)' }}>“{r.note}”</div>}
            {!r.declared && r.isMandatory && <div style={{ color: 'var(--ms-amber-text)' }}>Mandatory — not declared</div>}
            {r.declared && !r.photoUrl && <div style={{ color: 'var(--ms-amber-text)' }}>No photo of this tool yet</div>}
          </div>
          {r.declared && r.photoUrl && (
            <a href={r.photoUrl} target="_blank" rel="noreferrer" title={`Open the provider's photo of ${r.label}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.photoUrl} alt={`Photo of ${r.label}`} style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--ms-border)', display: 'block' }} />
            </a>
          )}
          {r.declared && (
            <Btn size="xs" variant={r.verifiedAt ? 'primary' : undefined} disabled={busy} onClick={() => onVerify(r)}
              title={r.verifiedAt ? `Verified by ${r.verifiedByName ?? 'admin'} — click to withdraw` : 'Mark as verified'}>
              {r.verifiedAt ? 'Verified — withdraw' : 'Verify'}
            </Btn>
          )}
        </div>
      ))}
    </div>
  );
}

function ProviderReviewPanel({ providerId, onChanged }: { providerId: number; onChanged: () => void }) {
  const [ctx, setCtx] = useState<SpContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);
  const [checklists, setChecklists] = useState<Record<number, ListingChecklist>>({});
  const [catChecklists, setCatChecklists] = useState<Record<string, CategoryChecklist>>({});
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [openChecklist, setOpenChecklist] = useState<number | null>(null);
  const [verifying, setVerifying] = useState<Set<number>>(new Set());
  const [verifyingCat, setVerifyingCat] = useState<string | null>(null);
  // Decision dialog: one service (id) or every pending one ('bulk').
  const [ask, setAsk] = useState<{ kind: Decision; target: number | 'bulk'; subject: string } | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const loadChecklists = useCallback((signal?: AbortSignal) =>
    Promise.all([
      apiGet<ListingChecklist[]>(`/admin/kyc/service-providers/${providerId}/capabilities`, { signal })
        .then((rows) => { if (!signal?.aborted) setChecklists(Object.fromEntries(rows.map((r) => [r.serviceCatalogId, r]))); }),
      apiGet<CategoryChecklist[]>(`/admin/kyc/service-providers/${providerId}/capabilities/categories`, { signal })
        .then((rows) => { if (!signal?.aborted) setCatChecklists(Object.fromEntries(rows.map((r) => [r.categoryCode, r]))); }),
    ]).catch(() => { /* checklist is advisory — the panel still works without it */ }),
  [providerId]);

  /** SP-268 — verify at the PROVIDER level: counts for every service in the category. */
  async function verifyCategoryLines(code: string, requirementIds: number[], verified: boolean) {
    if (!requirementIds.length) return;
    setActErr(null); setVerifyingCat(code);
    try {
      await apiPost(`/admin/kyc/service-providers/${providerId}/capabilities/verify`, { requirementIds, verified });
      await loadChecklists();
    } catch (e) { setActErr((e as Error).message); } finally { setVerifyingCat(null); }
  }
  async function verifyLines(listingId: number, requirementIds: number[], verified: boolean) {
    if (!requirementIds.length) return;
    setActErr(null);
    setVerifying((v) => new Set(v).add(listingId));
    try {
      await apiPost<ListingChecklist>(`/admin/service-listings/${listingId}/capabilities/verify`, { requirementIds, verified });
      await loadChecklists();
    } catch (e) { setActErr((e as Error).message); } finally {
      setVerifying((v) => { const n = new Set(v); n.delete(listingId); return n; });
    }
  }

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true); setErr(null);
    void loadChecklists(signal);
    return apiGet<SpContext>(`/admin/kyc/service-providers/${providerId}`, { signal })
      .then((r) => { if (!signal?.aborted) setCtx(r); })
      .catch((e) => { if (!signal?.aborted) setErr((e as Error).message); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [providerId, loadChecklists]);

  useEffect(() => {
    setCtx(null); setActErr(null); setBusy(new Set()); setNotes({});
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [providerId, load]);

  async function actOne(id: number, kind: Decision, reason: string) {
    const action = kind === 'approve' ? 'approve' : 'reject';
    setActErr(null);
    setBusy((b) => new Set(b).add(id));
    try {
      await patchDecision(`/admin/service-listings/${id}/${action}`, action === 'reject' ? (kind === 'changes' ? `Changes requested: ${reason}` : reason) : undefined);
      setCtx((prev) => (prev ? { ...prev, services: prev.services.map((s) => (s.id === id ? { ...s, listingStatus: action === 'approve' ? 'approved' : 'rejected' } : s)) } : prev));
      if (reason) setNotes((n) => ({ ...n, [id]: `${kind === 'changes' ? 'Changes requested' : 'Rejected'} — ${reason}` }));
      onChanged();
      setAsk(null);
    } catch (e) { setActErr((e as Error).message); } finally {
      setBusy((b) => { const n = new Set(b); n.delete(id); return n; });
    }
  }
  async function actAllPending(kind: Decision, reason: string) {
    if (!ctx) return;
    const action = kind === 'approve' ? 'approve' : 'reject';
    const pending = ctx.services.filter((s) => s.listingStatus === 'pending');
    if (pending.length === 0) return;
    setActErr(null); setBulking(true);
    try {
      for (const s of pending) {
        await patchDecision(`/admin/service-listings/${s.id}/${action}`, action === 'reject' ? (kind === 'changes' ? `Changes requested: ${reason}` : reason) : undefined);
      }
      await load();
      onChanged();
      setAsk(null);
    } catch (e) {
      setActErr((e as Error).message);
      await load();
    } finally { setBulking(false); }
  }

  if (loading && !ctx) return <PanelSkeleton />;
  if (err || !ctx) return <Callout tone="bad" title="Couldn't load this provider.">{err ?? ''} <Btn size="xs" onClick={() => void load()}>Try again</Btn></Callout>;

  const p = ctx.profile;
  const compliant = p.complianceStatus === 'compliant';
  const emirates = csvToList(p.emiratesServed);
  const categories = csvToList(p.serviceCategories);
  const businessName = p.businessName || p.companyName || p.ownerName || p.user?.name || 'Unnamed provider';
  const phone = p.user?.phone ?? p.opsContactPhone ?? null;
  const jobReady = p.jobReadyAt != null;
  const groups = Object.values(ctx.services.reduce((acc, sv) => {
    (acc[sv.category] ??= { category: sv.category, items: [] }).items.push(sv);
    return acc;
  }, {} as Record<string, { category: string; items: SpContextService[] }>)).sort((a, b) => b.items.length - a.items.length);
  const approvedCount = ctx.services.filter((s) => s.listingStatus === 'approved').length;
  const pendingCount = ctx.services.filter((s) => s.listingStatus === 'pending').length;
  const rejectedCount = ctx.services.filter((s) => s.listingStatus === 'rejected').length;
  const requiredMissing = ctx.checklist.filter((c) => c.required && !c.uploaded);
  const op = ctx.operationalProfile ?? null;
  // Adopted services with no lead-capable technician skilled in that EXACT service — flagged, not blocked (SP-247).
  const uncoveredIds = new Set((op?.cards.team.uncoveredServices ?? []).map((u) => u.id));

  // ── Gate 3 checklist ──
  const cats = Object.values(catChecklists).filter((c) => c.summary.total > 0);
  const unpriced = ctx.services.filter((s) => s.pricingMode !== 'quote' && s.priceUnit !== 'quote_after_callout' && s.basePrice == null);
  const photosMissing = cats.reduce((n, c) => n + c.summary.photosMissing, 0);
  const notDeclared = cats.filter((c) => !c.summary.declarationComplete);
  const notVerified = cats.filter((c) => !c.summary.verificationComplete);
  const gate: ChkItem[] = [
    compliant ? { l: 'Provider verified (Gate 1)', sub: 'Compliant — business verification decision on file (the API returns no decision date)', state: 'pass' } : { l: 'Provider verified (Gate 1)', sub: `${COMPLIANCE[p.complianceStatus]?.label ?? titleize(p.complianceStatus)} — listings cannot be approved until KYC is compliant`, state: 'fail' },
    requiredMissing.length === 0 ? { l: 'Licence & compliance documents', sub: 'All required present', state: 'pass' } : { l: 'Licence & compliance documents', sub: `Missing: ${requiredMissing.map((c) => c.displayName).join(', ')}`, state: 'fail' },
    unpriced.length === 0 ? { l: 'Title, details & price', sub: `${ctx.services.length} service${ctx.services.length === 1 ? '' : 's'} priced or quote-based`, state: 'pass' } : { l: 'Title, details & price', sub: `No price: ${unpriced.map((s) => s.name).join(', ')}`, state: 'fail' },
    cats.length === 0 ? { l: 'Subcategory fields (tools & materials)', sub: 'No tool checklist for these categories', state: 'wait' } : notDeclared.length === 0 ? { l: 'Subcategory fields (tools & materials)', sub: 'Every mandatory tool declared', state: 'pass' } : { l: 'Subcategory fields (tools & materials)', sub: `Not fully declared: ${notDeclared.map((c) => c.categoryName).join(', ')}`, state: 'fail' },
    cats.length === 0 ? { l: 'Tool photos', sub: '—', state: 'wait' } : photosMissing === 0 ? { l: 'Tool photos', sub: 'A photo for every declared tool', state: 'pass' } : { l: 'Tool photos', sub: `${photosMissing} declared tool${photosMissing === 1 ? '' : 's'} without a photo`, state: 'wait' },
    cats.length === 0 ? { l: 'Tools verified', sub: '—', state: 'wait' } : notVerified.length === 0 ? { l: 'Tools verified', sub: 'Every mandatory tool verified', state: 'pass' } : { l: 'Tools verified', sub: `Still to verify: ${notVerified.map((c) => c.categoryName).join(', ')}`, state: 'wait' },
    uncoveredIds.size === 0 ? { l: 'Qualified lead technician', sub: 'Every service has a lead-capable technician', state: 'pass' } : { l: 'Qualified lead technician', sub: `${uncoveredIds.size} service${uncoveredIds.size === 1 ? '' : 's'} without one`, state: 'wait' },
    jobReady ? { l: 'Job-ready', sub: `Since ${fmtDate(p.jobReadyAt)}`, state: 'pass' } : { l: 'Job-ready', sub: 'Setup guide not complete', state: 'wait' },
  ];

  const subjectOf = (target: number | 'bulk') => target === 'bulk' ? `all ${pendingCount} pending services` : ctx.services.find((s) => s.id === target)?.name ?? `Service #${target}`;
  const open = (kind: Decision, target: number | 'bulk') => { setActErr(null); setAsk({ kind, target, subject: subjectOf(target) }); };

  return (
    <>
      <DetailHead title={businessName}
        pills={<>
          <CompliancePill s={p.complianceStatus} />
          <Pill tone={jobReady ? 'primary' : 'amber'}>{jobReady ? 'Job-ready' : 'Not job-ready'}</Pill>
          {p.averageRating != null && p.totalReviews > 0 && <Pill tone="amber" dot={false}>★ {Number(p.averageRating).toFixed(1)} ({p.totalReviews})</Pill>}
          {p.emergencyResponse && <Pill tone="danger" dot={false}>Emergency</Pill>}
          {p.isGovernment && <Pill tone="info" dot={false}>Government</Pill>}
        </>}
        right={<Btn size="sm" href={`/dashboard/admin/users/${p.userId}`}>Open profile</Btn>}
        sub={[`SP #${p.id}`, p.user?.email, phone].filter(Boolean).join(' · ')} />

      <Card title="Gate 3 · Listing review" sub={`${gate.filter((g) => g.state === 'pass').length}/${gate.length} checks passing`} pad>
        <Checklist items={gate} />
      </Card>

      <div style={gap}>
        <Card title="Provider" pad>
          <KV items={[
            { k: 'Owner', v: p.ownerName }, { k: 'Entity', v: titleize(p.entityType) || undefined },
            { k: 'Trade licence', v: p.tradeLicenseNumber }, { k: 'VAT TRN', v: p.vatTrn },
            { k: 'KYC completion', v: `${ctx.completionScore}%` }, { k: 'Member since', v: fmtDate(p.createdAt) },
            { k: 'Emirates', v: emirates.length ? emirates.map((e) => titleize(e).replace(/\b\w/g, (m) => m.toUpperCase())).join(', ') : undefined },
            { k: 'Categories', v: categories.length ? categories.map(serviceCategoryLabel).join(', ') : undefined },
          ]} />
        </Card>
      </div>

      <div style={gap}>
        <Card title="Compliance documents" sub={requiredMissing.length ? `${requiredMissing.length} required missing` : 'All required present'} pad>
          {ctx.checklist.map((doc) => {
            const ok = ['processed', 'complete', 'approved', 'attached'].includes(String(doc.status).toLowerCase());
            return (
              <div key={doc.key} className="flex items-center gap-2" style={{ padding: '8px 0', borderBottom: '1px solid var(--ms-surface-3)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{doc.displayName}{doc.required && <span style={{ color: 'var(--ms-danger)', fontSize: 10.5 }}> · required</span>}</div>
                  {doc.expiryDate && <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>Expires {fmtDate(doc.expiryDate)}</div>}
                </div>
                {doc.uploaded ? <Pill tone={ok ? 'primary' : 'amber'}>{titleize(String(doc.status ?? 'uploaded').toLowerCase())}</Pill> : <Pill tone="danger">Missing</Pill>}
                {doc.fileUrl && <Btn size="xs" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.displayName })}>View</Btn>}
              </div>
            );
          })}
        </Card>
      </div>

      {/* Operational profile — the evidence behind the Job-ready chip (SP-247). Read-only. */}
      <div style={gap}>
        <Card title="Operational profile" pad>
          {!op ? <div style={muted}>No operational profile yet — the provider has not started the Get Job-Ready setup.</div> : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div className="gx-lb">{op.supplyType === 'solo' ? 'Solo operator · person = provider = technician' : `Team · ${op.cards.team.activeTechnicians} active · ${op.cards.team.leadCapable} lead-capable`}</div>
                {op.team.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--ms-danger)' }}>No technicians on the roster.</div> : op.team.map((t) => (
                  <div key={t.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--ms-surface-3)', fontSize: 11.5 }}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <strong>{t.name}</strong>
                      {t.isSelf && <Pill tone="info" dot={false} title="Compliance mirrors the provider's verdict — one KYC set">The provider themself</Pill>}
                      {t.isLeadCapable && <Pill tone="primary" dot={false}>Lead</Pill>}
                      {t.status !== 'active' && <Pill tone="danger" dot={false}>{titleize(t.status)}</Pill>}
                      {t.complianceStatus && t.complianceStatus !== 'compliant' && <Pill tone="amber" dot={false}>{titleize(t.complianceStatus)}</Pill>}
                      {!t.hasPhoto && <span style={{ color: 'var(--ms-ink-3)', fontSize: 10.5 }}>no photo</span>}
                    </div>
                    {(t.serviceSkills.length > 0 || t.categorySkills.length > 0) && (
                      <div style={{ color: 'var(--ms-ink-3)', marginTop: 2 }}>{t.serviceSkills.length > 0 ? t.serviceSkills.join(' · ') : t.categorySkills.map(serviceCategoryLabel).join(' · ')}</div>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <div className="gx-lb">Coverage · {op.cards.coverage.zoneCount} zone{op.cards.coverage.zoneCount === 1 ? '' : 's'}</div>
                {op.coverageZones.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--ms-danger)' }}>No coverage zones picked.</div> : (
                  <div className="gx-btn-row">
                    {op.coverageZones.slice(0, 14).map((z) => <Pill key={z} tone="neutral" dot={false}>{z}</Pill>)}
                    {op.coverageZones.length > 14 && <span style={muted}>+{op.coverageZones.length - 14} more</span>}
                  </div>
                )}
              </div>
              <div className="gx-two">
                <div>
                  <div className="gx-lb">Fleet · {op.cards.fleet.effectiveMaxConcurrentJobs} concurrent crew{op.cards.fleet.effectiveMaxConcurrentJobs === 1 ? '' : 's'}</div>
                  {op.fleet.length === 0 ? <div style={muted}>No vehicles.</div> : op.fleet.map((v, i) => <div key={i} style={{ fontSize: 11.5 }}>{titleize(v.type)}{v.label ? ` · ${v.label}` : ''}</div>)}
                </div>
                <div>
                  <div className="gx-lb">Hours · {op.cards.hours.daysConfigured} day{op.cards.hours.daysConfigured === 1 ? '' : 's'}</div>
                  {op.weeklyHours.length === 0 ? <div style={muted}>Not configured.</div> : op.weeklyHours.map((h, i) => (
                    <div key={i} style={{ fontSize: 11.5 }}>{WEEKDAY_LABELS[h.weekday] ?? h.weekday} {String(h.opensAt).slice(0, 5)}–{String(h.closesAt).slice(0, 5)}</div>
                  ))}
                  {op.timeOff.length > 0 && <div style={{ fontSize: 11, color: 'var(--ms-amber-text)', marginTop: 4 }}>Time off: {op.timeOff.map((t) => `${t.startsOn} → ${t.endsOn}`).join(', ')}</div>}
                </div>
              </div>
              <div style={muted}>
                Job rules: {op.cards.rules.minNoticeHours}h min notice
                {op.cards.rules.dispatchLogic ? ` · ${titleize(op.cards.rules.dispatchLogic)}` : ''}
                {op.cards.rules.emergencyResponse ? ' · emergency response' : ''}
                {op.cards.rules.acceptedAt ? ` · rules accepted ${fmtDate(op.cards.rules.acceptedAt)}` : ' · rules NOT acknowledged'}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Services — every listing, each decided inline */}
      <div style={gap}>
        <Card title={`Services (${ctx.services.length})`} sub={`${approvedCount} approved · ${pendingCount} pending · ${rejectedCount} rejected`} pad>
          {!compliant && pendingCount > 0 && <div style={{ marginBottom: 10 }}><Callout tone="warn">Provider must be compliant before their listings can be approved. Complete the Gate 1 review first.</Callout></div>}
          {groups.map((g) => {
            const cl = catChecklists[g.category];
            const sm = cl?.summary;
            const catTone: Tone = sm?.verificationComplete ? 'primary' : sm?.declarationComplete ? 'info' : 'amber';
            return (
              <div key={g.category} style={{ marginBottom: 12 }}>
                <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 5 }}>
                  <span className="gx-lb" style={{ margin: 0 }}>{serviceCategoryLabel(g.category)}</span>
                  <Pill tone="neutral" dot={false}>{g.items.length}</Pill>
                  {cl && sm && sm.total > 0 && (
                    <span style={{ marginLeft: 'auto' }} className="flex items-center gap-1.5">
                      <Pill tone={catTone} dot={false} title="Tools & materials for this category — declared once by the provider, verified once here, counts for every service in it">
                        Tools {sm.declaredMandatory}/{sm.mandatory} declared · {sm.withPhoto} photo{sm.withPhoto === 1 ? '' : 's'} · {sm.verifiedMandatory} verified
                      </Pill>
                      <Btn size="xs" onClick={() => setOpenCategory((o) => (o === g.category ? null : g.category))}>{openCategory === g.category ? 'Hide tools' : 'Review tools'}</Btn>
                    </span>
                  )}
                </div>
                {openCategory === g.category && cl && (() => {
                  const declaredUnverified = cl.rows.filter((r) => r.declared && !r.verifiedAt).map((r) => r.requirementId);
                  return (
                    <ToolsList rows={cl.rows} busy={verifyingCat === g.category}
                      title={`Tools & materials · declared once for all ${cl.listingCount} service${cl.listingCount === 1 ? '' : 's'}`}
                      verifyAllLabel={`Verify all declared (${declaredUnverified.length})`}
                      onVerifyAll={declaredUnverified.length ? () => void verifyCategoryLines(g.category, declaredUnverified, true) : null}
                      onVerify={(r) => void verifyCategoryLines(g.category, [r.requirementId], !r.verifiedAt)} />
                  );
                })()}
                {g.items.map((sv) => {
                  const isBusy = busy.has(sv.id) || bulking;
                  const lcl = checklists[sv.id];
                  // SP-268: the category list is on the header — a listing chip only for its own EXTRAS.
                  const extras = (lcl?.rows ?? []).filter((r) => r.scope === 'template');
                  const mand = extras.filter((r) => r.isMandatory);
                  const exDeclared = mand.filter((r) => r.declared).length;
                  const exVerified = mand.filter((r) => r.declared && r.verifiedAt).length;
                  const exTone: Tone = mand.every((r) => r.declared && r.verifiedAt) ? 'primary' : mand.every((r) => r.declared) ? 'info' : 'amber';
                  return (
                    <Fragment key={sv.id}>
                      <div className="flex items-center gap-2 flex-wrap" style={{ padding: '8px 10px', border: '1px solid var(--ms-surface-3)', borderRadius: 8, marginBottom: 5 }}>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{sv.name}{sv.isEmergency && <span style={{ color: 'var(--ms-danger)', fontSize: 10.5 }}> · 24/7</span>}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>{ctxSvcPrice(sv)}</div>
                          {notes[sv.id] && <div style={{ fontSize: 10.5, color: '#8d2f2a' }}>{notes[sv.id]}</div>}
                        </div>
                        {uncoveredIds.has(sv.id) && <Pill tone="amber" dot={false} title="No lead-capable technician is skilled in this exact service">No qualified lead</Pill>}
                        {lcl && extras.length > 0 && (
                          <Btn size="xs" onClick={() => setOpenChecklist((o) => (o === sv.id ? null : sv.id))}
                            title={mand.every((r) => r.declared) ? 'Provider declared every mandatory extra — verify' : 'Provider has NOT declared every mandatory extra'}>
                            <Pill tone={exTone} dot={false}>Extras {exDeclared}/{mand.length} · {exVerified} verified</Pill>{openChecklist === sv.id ? 'Hide' : 'Review'}
                          </Btn>
                        )}
                        <ListingPill s={sv.listingStatus} />
                        {sv.listingStatus !== 'approved' && (
                          <Btn size="xs" variant="primary" disabled={isBusy || !compliant} title={!compliant ? 'Provider not compliant' : undefined} onClick={() => open('approve', sv.id)}>Approve</Btn>
                        )}
                        {sv.listingStatus !== 'rejected' && <>
                          <Btn size="xs" variant="amber" disabled={isBusy} onClick={() => open('changes', sv.id)}>Ask for changes</Btn>
                          <Btn size="xs" variant="danger" disabled={isBusy} onClick={() => open('reject', sv.id)}>Reject</Btn>
                        </>}
                      </div>
                      {openChecklist === sv.id && lcl && (() => {
                        const declaredUnverified = extras.filter((r) => r.declared && !r.verifiedAt).map((r) => r.requirementId);
                        return (
                          <ToolsList rows={extras} busy={verifying.has(sv.id)} title="Extra tools only this service needs · provider's declaration"
                            verifyAllLabel={`Verify all declared (${declaredUnverified.length})`}
                            onVerifyAll={declaredUnverified.length ? () => void verifyLines(sv.id, declaredUnverified, true) : null}
                            onVerify={(r) => void verifyLines(sv.id, [r.requirementId], !r.verifiedAt)} />
                        );
                      })()}
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
        </Card>
      </div>

      {actErr && <div style={gap}><Callout tone="bad">{actErr}</Callout></div>}

      {pendingCount > 0 && (
        <DecisionBar note={`${pendingCount} pending listing${pendingCount === 1 ? '' : 's'} for this provider`}>
          <Btn variant="primary" disabled={bulking || !compliant} title={!compliant ? 'Provider not compliant' : undefined} onClick={() => open('approve', 'bulk')}>Approve all pending</Btn>
          <Btn variant="amber" disabled={bulking} onClick={() => open('changes', 'bulk')}>Ask for changes on all</Btn>
          <Btn variant="danger" disabled={bulking} onClick={() => open('reject', 'bulk')}>Reject all pending</Btn>
        </DecisionBar>
      )}

      <DecisionModal open={!!ask} kind={ask?.kind ?? null} subject={ask?.subject ?? ''}
        busy={bulking || (typeof ask?.target === 'number' && busy.has(ask.target))} error={actErr}
        onClose={() => setAsk(null)}
        onConfirm={(reason) => {
          if (!ask) return;
          if (ask.target === 'bulk') void actAllPending(ask.kind, reason);
          else void actOne(ask.target, ask.kind, reason);
        }} />
    </>
  );
}

// ─── View — single mode (RP or SP). One per route page. ───────────────────────

export function AdminListingsView({ mode }: { mode: 'rp' | 'sp' }) {
  const [rpData, setRpData] = useState<UnitListing[]>([]);
  const [rpTotal, setRpTotal] = useState(0);
  const [rpPage, setRpPage] = useState(0);
  const [rpCategory, setRpCategory] = useState<string[]>([]);
  const [rpStatus, setRpStatus] = useState('pending');
  const [rpLoading, setRpLoading] = useState(false);
  const [rpLoaded, setRpLoaded] = useState(false);
  const [rpSel, setRpSel] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState(false);

  const [spData, setSpData] = useState<SpProviderRow[]>([]);
  const [spTotal, setSpTotal] = useState(0);
  const [spPage, setSpPage] = useState(0);
  const [spCategory, setSpCategory] = useState<string[]>([]);
  const [spStatus, setSpStatus] = useState('pending');
  const [spLoading, setSpLoading] = useState(false);
  const [spLoaded, setSpLoaded] = useState(false);
  const [spSel, setSpSel] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [ask, setAsk] = useState<{ kind: Decision; unit: UnitListing } | null>(null);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<{ id: number; kind: Decision; reason: string } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Deep link: seed the category filter from ?category= (Overview drill-downs).
  useEffect(() => {
    const cat = new URLSearchParams(window.location.search).get('category');
    if (cat) { if (mode === 'sp') setSpCategory([cat]); else setRpCategory([cat]); }
  }, [mode]);

  const fetchRp = useCallback(async (page: number, categories: string[], status: string) => {
    setRpLoading(true); setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE),
        ...(categories.length ? { spaceCategory: categories.join(',') } : {}),
        ...(status ? { status } : {}),
      });
      const resp = await apiGet<{ data: UnitListing[]; total: number }>(`/admin/unit-listings?${params}`);
      setRpData(resp.data ?? []);
      setRpTotal(resp.total ?? 0);
    } catch (err) { setError((err as Error).message); } finally { setRpLoading(false); setRpLoaded(true); }
  }, []);

  const fetchProviders = useCallback(async (page: number, categories: string[], status: string) => {
    setSpLoading(true); setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE),
        ...(categories.length ? { category: categories.join(',') } : {}),
        ...(status ? { status } : {}),
      });
      const resp = await apiGet<{ data: SpProviderRow[]; total: number }>(`/admin/service-listing-providers?${params}`);
      setSpData(resp.data ?? []);
      setSpTotal(resp.total ?? 0);
    } catch (err) { setError((err as Error).message); } finally { setSpLoading(false); setSpLoaded(true); }
  }, []);

  useEffect(() => { if (mode === 'rp') void fetchRp(rpPage, rpCategory, rpStatus); }, [mode, rpPage, rpCategory, rpStatus, fetchRp]);
  useEffect(() => { if (mode === 'sp') void fetchProviders(spPage, spCategory, spStatus); }, [mode, spPage, spCategory, spStatus, fetchProviders]);
  useEffect(() => { detailRef.current?.scrollTo({ top: 0 }); }, [rpSel, spSel]);

  const handleRpCategory = (c: string[]) => { setRpCategory(c); setRpPage(0); setRpSel(null); };
  const handleRpStatus = (s: string) => { setRpStatus(s); setRpPage(0); setRpSel(null); };
  const handleSpCategory = (c: string[]) => { setSpCategory(c); setSpPage(0); setSpSel(null); };
  const handleSpStatus = (s: string) => { setSpStatus(s); setSpPage(0); setSpSel(null); };

  async function actOnUnit(u: UnitListing, kind: Decision, reason: string) {
    if (!u.property) return;
    const action = kind === 'changes' ? 'reject' : kind;
    setActing(true); setAskErr(null);
    try {
      await patchDecision(`/admin/listings/${u.property.id}/units/${u.id}/${action}`,
        action === 'reject' ? (kind === 'changes' ? `Changes requested: ${reason}` : reason) : undefined);
      setLastDecision({ id: u.id, kind, reason });
      setAsk(null);
      await fetchRp(rpPage, rpCategory, rpStatus);
    } catch (err) { setAskErr((err as Error).message); } finally { setActing(false); }
  }

  // Silent refresh of the provider list after a decision inside the panel (counts stay in sync, no spinner).
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

  const loading = mode === 'sp' ? spLoading : rpLoading;
  const loaded = mode === 'sp' ? spLoaded : rpLoaded;
  const overIndexCount = rpData.filter((u) => indexDeviation(u.annualRent, u.property?.spaceCategory) != null).length;
  const visibleUnits = overIndex ? rpData.filter((u) => indexDeviation(u.annualRent, u.property?.spaceCategory) != null) : rpData;
  const listLen = mode === 'sp' ? spData.length : visibleUnits.length;
  const isEmpty = !loading && loaded && listLen === 0;
  const total = mode === 'sp' ? spTotal : rpTotal;
  const page = mode === 'sp' ? spPage : rpPage;
  const selectedUnit = mode === 'rp' && rpSel != null ? rpData.find((u) => u.id === rpSel) ?? null : null;
  const selectedProvider = mode === 'sp' && spSel != null ? spData.find((s) => s.id === spSel) ?? null : null;
  const status = mode === 'rp' ? rpStatus : spStatus;
  const selCats = mode === 'rp' ? rpCategory : spCategory;
  const refresh = () => (mode === 'sp' ? void fetchProviders(spPage, spCategory, spStatus) : void fetchRp(rpPage, rpCategory, rpStatus));

  return (
    <OsPage>
      <PageHead
        eyebrow="Listing approval · Gate 3"
        title={mode === 'sp' ? 'Services listings' : 'Spaces listings'}
        lede="Review what providers submit before it goes live — photos, details, price, permit and contact rules. Approve, ask for changes or reject. Admin decides; it never edits or creates a listing for a provider."
        actions={<>
          <Btn size="sm" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Btn>
          <Btn size="sm" href={mode === 'sp' ? '/dashboard/admin/listings/rental-providers' : '/dashboard/admin/listings/service-providers'}>
            {mode === 'sp' ? 'Spaces listings' : 'Services listings'}
          </Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Gate', value: 'Gate 3 · Listing approval' },
        { label: 'Vertical', value: mode === 'sp' ? 'Services' : 'Spaces' },
        { label: 'Status', value: STATUS_TABS.find((s) => s.id === status)?.label ?? 'All' },
        { label: mode === 'sp' ? 'Providers' : 'Listings', value: total },
        { label: 'Data', value: 'Live' },
      ]} />

      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <Seg label="Listing status" value={status} onChange={mode === 'rp' ? handleRpStatus : handleSpStatus}
          options={STATUS_TABS.filter((s) => mode === 'rp' || !s.rpOnly).map((s) => ({ v: s.id, l: s.label, ...(s.id === status && loaded ? { n: total } : {}) }))} />
        <TypesDropdown
          options={mode === 'rp' ? SPACE_CATEGORIES.map((c) => ({ id: c.id, label: categoryDisplayLabel(c.id) })) : SERVICE_CATEGORIES}
          selected={selCats}
          onChange={mode === 'rp' ? handleRpCategory : handleSpCategory}
          labelFor={mode === 'rp' ? categoryDisplayLabel : serviceCategoryLabel} />
        {mode === 'rp' && (
          <div className="gx-chips">
            <button type="button" className="gx-chip" aria-pressed={overIndex} onClick={() => { setOverIndex((v) => !v); setRpSel(null); }}
              title="Units priced 20% or more above the indicative RERA rental-index cap for their category (this page)">
              Exceeds RERA index ({overIndexCount})
            </button>
          </div>
        )}
      </div>

      {error && <div style={{ marginBottom: 12 }}><Callout tone="bad" title="Couldn't load the queue.">{error} <Btn size="xs" onClick={refresh}>Try again</Btn></Callout></div>}

      <div className="gx-split">
        <div className="gx-split-l">
          <div role="listbox" aria-label={mode === 'sp' ? 'Providers with service listings' : 'Unit listings'}>
            {loading && (
              <div aria-busy="true" style={{ padding: 12, display: 'grid', gap: 12 }}>
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="gx-skel" style={{ height: 44 }} />)}
              </div>
            )}
            {isEmpty && (
              <div className="gx-empty"><b>No listings found</b>
                {overIndex ? 'No listings on this page exceed the RERA rental index — turn the chip off to see them all.'
                  : mode === 'sp' ? 'No providers with listings match these filters. Try another status or clear Types.' : 'No unit listings match these filters. Try another status or clear Types.'}
              </div>
            )}
            {!loading && mode === 'rp' && visibleUnits.map((u) => {
              const dev = indexDeviation(u.annualRent, u.property?.spaceCategory);
              return (
                <button key={u.id} type="button" role="option" className="gx-qitem" aria-selected={rpSel === u.id} onClick={() => setRpSel(u.id)}>
                  <span className="t">Unit {u.unitNumber}{u.unitName ? ` — ${u.unitName}` : ''}</span>
                  <span className="s">{u.property?.buildingName ?? '—'} · {u.property ? categoryDisplayLabel(u.property.spaceCategory) : '—'} · {u.annualRent != null ? `${fmtAed(u.annualRent)}/yr` : 'no rent'}</span>
                  <span className="f">
                    <ListingPill s={u.listingStatus} />
                    {dev != null && <Pill tone={dev >= 50 ? 'danger' : 'amber'} dot={false} title="Above the indicative RERA rental-index cap">RERA +{dev}%</Pill>}
                  </span>
                </button>
              );
            })}
            {!loading && mode === 'sp' && spData.map((sp) => {
              const cats = csvToList(sp.serviceCategories);
              return (
                <button key={sp.id} type="button" role="option" className="gx-qitem" aria-selected={spSel === sp.id} onClick={() => setSpSel(sp.id)}>
                  <span className="t">{sp.name ?? `SP #${sp.id}`}</span>
                  <span className="s">{cats.length ? cats.slice(0, 2).map(serviceCategoryLabel).join(', ') + (cats.length > 2 ? ` +${cats.length - 2}` : '') : '—'}</span>
                  <span className="f">
                    <CompliancePill s={sp.complianceStatus} />
                    <Pill tone="outline" dot={false}>{sp.total} service{sp.total === 1 ? '' : 's'}</Pill>
                    {sp.pending > 0 && <Pill tone="amber" dot={false}>{sp.pending} pending</Pill>}
                    {sp.approved > 0 && <Pill tone="primary" dot={false}>{sp.approved} approved</Pill>}
                    {sp.rejected > 0 && <Pill tone="danger" dot={false}>{sp.rejected} rejected</Pill>}
                    {!sp.jobReady && <Pill tone="neutral" dot={false}>Not job-ready</Pill>}
                  </span>
                </button>
              );
            })}
          </div>
          {!(mode === 'rp' && overIndex) && (
            <Pagination page={page} total={total} pageSize={PAGE_SIZE}
              onChange={(pp) => { if (mode === 'rp') { setRpPage(pp); setRpSel(null); } else { setSpPage(pp); setSpSel(null); } }} />
          )}
        </div>

        <div className="gx-split-r" ref={detailRef}>
          {selectedUnit ? (
            <UnitDetailPanel row={selectedUnit} acting={acting} lastDecision={lastDecision}
              onDecide={(u, kind) => { setAskErr(null); setAsk({ kind, unit: u }); }} />
          ) : selectedProvider ? (
            <ProviderReviewPanel providerId={selectedProvider.id} onChanged={refreshProviderCounts} />
          ) : (
            <div className="gx-empty"><b>Nothing selected</b>
              {isEmpty ? 'Nothing to review with these filters.' : mode === 'sp' ? 'Pick a provider on the left to review their listings.' : 'Pick a listing on the left to review it.'}
            </div>
          )}
          {lastDecision && mode === 'rp' && !selectedUnit && (
            <div style={gap}><Evid>Last decision: Unit #{lastDecision.id} — {lastDecision.kind === 'changes' ? 'changes requested' : lastDecision.kind}. <Link href={`/dashboard/admin/units/${lastDecision.id}`} style={{ color: 'var(--ms-primary)' }}>Open unit</Link></Evid></div>
          )}
        </div>
      </div>

      <DecisionModal open={!!ask} kind={ask?.kind ?? null}
        subject={ask ? `Unit ${ask.unit.unitNumber}${ask.unit.property ? ` at ${ask.unit.property.buildingName}` : ''}` : ''}
        busy={acting} error={askErr} onClose={() => setAsk(null)}
        onConfirm={(reason) => { if (ask) void actOnUnit(ask.unit, ask.kind, reason); }} />
    </OsPage>
  );
}
