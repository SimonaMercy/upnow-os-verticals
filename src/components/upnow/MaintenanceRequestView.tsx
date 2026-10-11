/**
 * MaintenanceRequestView — one maintenance request: what it is, where it
 * stands, and every action the landlord side can take on it. Shared by the RP
 * page (base '/maintenance') and the manager mirror (base
 * '/manager/maintenance' + ?rp=), the same way AmcView is shared.
 *
 * The stage is DERIVED server-side (maintenance-stage.util.ts); this view only
 * renders it and offers the action the current holder owes:
 *   requested + no_rule        → triage (cover / charge / decline, save-as-rule)
 *   requested + no provider    → reassign to a linked provider
 *   awaiting_approval (covered)→ approve / reject the quote
 *   sign_off                   → sign the work off (customer normally does this)
 *   close_out                  → allocate the cost + record the invoice
 * Spec: MAINTENANCE_ROUTING_SPEC_2026-08-30 §5.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle2, XCircle, RefreshCw, ShieldCheck,
  Clock, FileText, AlertTriangle, Play,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { InHouseJobPanel, type InHouseBill, type InHouseTask } from './InHouseJobPanel';
import { PhotoLightbox, type GalleryPhoto } from './PhotoGallery';
import { isVideoUrl } from '@/lib/media';
import { tenantDisplayName } from '@/lib/tenantName';
import { SCOPE_LABEL, maintenanceLocation, maintenanceNoCustomerLabel, type MaintenanceScope } from '@/lib/maintenanceScope';

interface Cat { id: number; name: string }
interface LinkRow {
  serviceProviderId: number; name: string; relationship: string; isDefault: boolean;
  /** The backend's own routing rule. `selfManaged` = picking this one runs the
   *  job on THIS page (no portal for them, nothing emailed); otherwise the
   *  vendor accepted an invite and works the job from their own portal. */
  assignable?: boolean; selfManaged?: boolean; kind?: string; inviteStatus?: string;
}
interface Detail {
  id: number; ref: string; title: string; description: string | null;
  stage: string; stageNote: string | null; holdReason: string | null;
  coverage: string | null; approvalRequired: boolean;
  category: Cat | null;
  /** 0267 — where the work is: a unit, or a named common area / building system. */
  scope?: MaintenanceScope | null; locationLabel?: string | null;
  unit: { id: number; unitNumber: string | null; unitName: string | null } | null;
  property: { id: number; buildingName: string | null } | null;
  customer: { id: number; name: string | null; companyName: string | null; entityType: string | null } | null;
  provider: { id: number; name: string; relationship: string | null } | null;
  booking: { id: number; status: string; scheduledAt: string | null; payer: string; totalAed: number | null; pricingMode?: string | null; catalogItemId?: number | null } | null;
  quote: {
    status: string; totalAed: number; laborAed: number; materialsAed: number;
    discountAed?: number | null; submittedAt?: string | null; summary: string | null; validUntil: string | null;
    items?: { name: string; description: string | null; quantity: number; unitPriceAed: number; totalAed: number }[];
  } | null;
  quoteAttachments?: { id: number; caption: string | null; viewUrl: string }[];
  customerSignOff: boolean;
  costAllocation: string | null;
  invoiceTotalAed: number | null; invoiceVatAed: number | null; invoiceRef: string | null;
  raisedByRole: string | null; preferredAt: string | null; approvedAt: string | null;
  declinedAt: string | null; declinedReason: string | null;
  cancelledAt: string | null; closedAt: string | null;
  createdAt: string; updatedAt: string;
  timeline: { id: number; type: string; actorRole: string | null; payload: Record<string, unknown> | null; at: string }[];
  photos?: { id: number; kind?: string; mediaType?: 'photo' | 'video'; caption: string | null; viewUrl: string; createdAt: string }[];
  /** 0298 — the landlord's own team's job: run from this page (photos, bills, mark done). */
  inHouse?: boolean;
  bills?: InHouseBill[];
  /** 0301 — a restoration job's task list. */
  tasks?: InHouseTask[];
  billCategories?: string[];
}

const STAGE_META: Record<string, { label: string; bg: string; fg: string }> = {
  requested:         { label: 'Requested',         bg: '#f4f3ef', fg: '#6b6860' },
  awaiting_approval: { label: 'Awaiting approval', bg: '#fef3c7', fg: '#92400e' },
  in_progress:       { label: 'In progress',       bg: '#e0f2fe', fg: '#0369a1' },
  sign_off:          { label: 'Sign-off',          bg: '#ede9fe', fg: '#6d28d9' },
  close_out:         { label: 'Close-out',         bg: '#dcfce7', fg: '#15803d' },
  closed:            { label: 'Closed',            bg: '#dcfce7', fg: '#15803d' },
  declined:          { label: 'Declined',          bg: '#fee2e2', fg: '#b91c1c' },
  cancelled:         { label: 'Cancelled',         bg: '#f4f3ef', fg: '#9b9890' },
};
const COVER_META: Record<string, { label: string; bg: string; fg: string }> = {
  covered:     { label: 'Covered — landlord pays', bg: '#d8f2e8', fg: '#1a7a5a' },
  chargeable:  { label: 'Chargeable — customer pays', bg: '#e0f2fe', fg: '#0369a1' },
  not_offered: { label: 'Not offered', bg: '#fee2e2', fg: '#b91c1c' },
};
const EVENT_LABEL: Record<string, string> = {
  received: 'Request received', held: 'Held', routed: 'Routed to the provider',
  triaged: 'Triage decision', declined: 'Declined', approved: 'Quote approved',
  auto_approved: 'Quote auto-approved (under the threshold)',
  approval_needed: 'Quote needs approval', quote_rejected: 'Quote rejected',
  reassigned: 'Reassigned', provider_declined: 'Provider declined',
  verified: 'Work signed off', closed: 'Closed out', cancelled: 'Cancelled', note: 'Note', comment: 'Comment',
  own_team_engaged: 'Own team — engaged on routing, no quote needed',
  own_team_assigned: 'Given to your own team — no routing or quote needed',
  photo_removed: 'Photo removed',
  bill_added: 'Bill recorded',
  bill_removed: 'Bill removed',
  task_done: 'Task marked done',
  task_reopened: 'Task opened again',
  task_added: 'Task added',
  task_items_added: 'Items added under a task',
  task_item_removed: 'Item removed from a task',
  task_removed: 'Task removed',
  bill_file_attached: 'Bill attachment added',
  vendor_engaged: 'Vendor engaged — their rate card needs no quote',
  en_route: 'Technician on the way', work_started: 'Work started on site',
  work_completed: 'Work completed — awaiting sign-off', photo_added: 'Photo added',
  paid: 'Customer paid the fixed price', price_rejected: 'Catalog price passed on — provider to quote',
  provider_chosen: 'Customer chose the provider (chargeable work)',
  cost_recovered: 'Cost charged to the lease as a maintenance fee',
  landlord_pays: 'No occupant — the landlord\'s own work, routed as covered',
  one_time_used: 'One-time allowance already used on this tenancy — routed as chargeable',
};

/** Timeline wording for a hold / a landlord-pays reason code. */
const HOLD_TEXT: Record<string, string> = {
  no_rule: 'No coverage rule — waiting for your decision',
  no_provider: 'No linked provider to route to',
  provider_declined: 'The provider declined — reassign',
  vacant_unit: 'Held with no occupant (before 0267)',
  amc_vendor: 'The AMC vendor for this system is not on UpNow yet — invite them, or reassign',
  no_occupant: 'No occupant — your own work, so you pay',
  landlord_only_category: 'Your own work (building / restoration item), so you pay',
};

const fmtDt = (d?: string | null) =>
  d ? new Date(d).toLocaleString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const aed = (n?: number | null) => (n != null ? `AED ${Number(n).toLocaleString('en-AE')}` : '—');
const scoped = (base: string, rp: number | null | undefined, path: string) =>
  rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;

export function MaintenanceRequestView({ base, rp, id, backHref }: {
  base: string; rp?: number | null; id: number; backHref: string;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ photos: GalleryPhoto[]; start: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // triage form
  // Coverage rules live per PROPERTY TYPE (owner, 31 Aug) — a triage answer is
  // saved for this unit's type, or for this one property.
  const [saveAsRule, setSaveAsRule] = useState<'no' | 'type' | 'property'>('type');
  const [threshold, setThreshold] = useState('');
  // reject-quote form — a rejection always carries the landlord's reason
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // reassign form
  const [reassignTo, setReassignTo] = useState('');
  const [changingProvider, setChangingProvider] = useState(false);
  // close-out form
  const [allocation, setAllocation] = useState<'property_expense' | 'owner' | 'tenant'>('property_expense');
  const [invoiceRef, setInvoiceRef] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<Detail>(scoped(base, rp, `/requests/${id}`)).catch(() => null),
      apiGet<LinkRow[]>(scoped(base, rp, '/links')).catch(() => []),
    ]).then(([detail, ls]) => { setD(detail); setLinks(Array.isArray(ls) ? ls : []); })
      .finally(() => setLoading(false));
  }, [base, rp, id]);
  useEffect(() => { load(); }, [load]);

  const act = async (label: string, path: string, body?: unknown) => {
    setBusy(label); setErr(null);
    try { await apiPost(scoped(base, rp, `/requests/${id}${path}`), body ?? {}); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'That did not work — try again.'); }
    finally { setBusy(null); }
  };

  if (loading && !d) return <div className="p-8 text-sm text-[#9b9890]">Loading request…</div>;
  if (!d) return (
    <div className="p-8">
      <p className="text-sm text-[#6b6860]">Maintenance request not found.</p>
      <Link href={backHref} className="text-sm text-[#1a7a5a] font-medium mt-2 inline-block">← Back to Operations</Link>
    </div>
  );

  const stage = STAGE_META[d.stage] ?? STAGE_META.requested;
  const cover = d.coverage ? COVER_META[d.coverage] : null;
  const custName = tenantDisplayName({ name: d.customer?.name ?? null, entityType: d.customer?.entityType, companyName: d.customer?.companyName });
  const open = !d.closedAt && !d.declinedAt && !d.cancelledAt;
  const showTriage = open && d.holdReason === 'no_rule' && !d.booking;
  // Routing is a STEP only when it is missing; a routed job that hasn't started
  // can still be moved, but that is an option, not a task (owner, 31 Aug).
  const needsRouting = open && ['no_provider', 'provider_declined', 'vacant_unit', 'amc_vendor'].includes(d.holdReason ?? '');
  const canChangeProvider = open && !needsRouting && !!d.provider && d.booking?.status === 'booked';
  const showReassign = needsRouting || (canChangeProvider && changingProvider);
  // Only vendors the backend will accept. `assignable` absent = an older
  // payload — offer the row rather than hide it. Every vendor the landlord
  // recorded is in here: the ones who accepted work the job from their own
  // portal, the rest are run from this page (owner, 29 Sep 2026 — "there must
  // be an option to select a vendor").
  const assignable = links.filter(l => l.assignable !== false);
  const picked = links.find(l => String(l.serviceProviderId) === reassignTo) ?? null;
  const vendorsHref = rp != null ? `/dashboard/manager/vendors?rp=${rp}` : '/rental-provider/dashboard/vendors';
  const showApprove = open && d.stage === 'awaiting_approval' && d.coverage === 'covered';
  // Phase B: priced at intake from the provider's own catalog — no quote exists.
  const prePriced = !!d.booking && d.booking.pricingMode === 'fixed' && d.booking.totalAed != null && !d.quote;
  const showSignOff = open && d.stage === 'sign_off';
  const showClose = open && d.stage === 'close_out';
  const canCancel = open && !['en_route', 'in_progress'].includes(d.booking?.status ?? '');

  // The page follows its neighbour, the AMC contract page: ONE header card (back, title + chips, actions,
  // a fact strip), then the work in a main column and the closing + timeline in a side column.
  const card = 'bg-white border border-[#e6e8e6] rounded-[14px] p-[18px]';
  const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer disabled:opacity-50';
  const btnLine = 'text-[12px] font-semibold px-3 py-2 rounded-lg border border-[#d9ddda] bg-white text-[#1c1f1d] hover:bg-[#f6f7f6] cursor-pointer disabled:opacity-40';
  const field = 'border border-[#e6e8e6] rounded-lg px-3 py-2 text-[12.5px] bg-white focus:outline-none focus:border-[#1a7a52]';
  const lbl = 'text-[10px] font-bold tracking-[.08em] text-[#8a8f8c]';
  const RAISED_BY: Record<string, string> = { rental_provider: 'the landlord', manager: 'a manager', customer: 'the customer', tenant: 'the customer', system: 'the system' };

  return (
    <div className="max-w-[1040px] mx-auto px-4 sm:px-7 py-6 pb-10 text-[#1c1f1d]">
      {/* ── header ── */}
      <div className="bg-white border border-[#e6e8e6] rounded-[14px] px-5 py-[18px]">
        <div className="flex items-start justify-between gap-4 flex-wrap lg:flex-nowrap">
          <div className="flex items-start gap-3.5 min-w-0 flex-1">
            <Link href={backHref} title="Back to maintenance requests"
              className="w-9 h-9 rounded-full border border-[#e6e8e6] flex items-center justify-center text-[#5b615e] hover:bg-[#f6f7f6] shrink-0"><ArrowLeft size={15} /></Link>
            <div className="min-w-0">
              <p className="text-[11px] text-[#8a8f8c]">Maintenance requests › {d.ref}</p>
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                <h1 className="text-[19px] font-bold tracking-[-.01em]">{d.title}</h1>
                <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap" style={{ background: stage.bg, color: stage.fg }}>{stage.label}</span>
                {cover && <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap" style={{ background: cover.bg, color: cover.fg }}>{cover.label}</span>}
                {d.inHouse && (
                  <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap bg-[#e7f4ee] text-[#1a7a52]">
                    {d.provider?.relationship === 'internal_team' ? 'Own team' : 'You run this job'}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[#5b615e] mt-1">
                {[d.category?.name, custName ?? maintenanceNoCustomerLabel(d.scope)].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center shrink-0">
            {canCancel && (
              <button type="button" disabled={!!busy}
                onClick={() => { if (window.confirm('Cancel this maintenance request?')) void act('cancel', '/cancel'); }}
                className={btnLine + ' text-[#b42318] border-[#f1c8c4] hover:bg-[#fff8f7]'}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel request'}</button>
            )}
            {/* "Send to a vendor" on an own-team job is REMOVED for now (owner, 21 Sep 2026). As built it was a one-way
                door: the task list, before/after photos and bills vanished from this page, the job could not come back
                in-house, and the vendor close-out overwrote the bills' total. To bring it back: keep those sections on
                a vendor job, add the vendor's invoice as a bill, and offer "Take back in-house". */}
            <button type="button" onClick={load} className={btnLine + ' !px-2.5'} title="Refresh"><RefreshCw size={13} /></button>
          </div>
        </div>
        {d.stageNote && !d.inHouse && (
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#8a5a00] bg-[#fdf3dc] rounded-lg px-2.5 py-1.5 mt-3 w-fit">
            <AlertTriangle size={12} /> {d.stageNote}
          </p>
        )}
        {/* A restoration's description opens with an auto-written "Tasks: …" line — the task list below says it better. */}
        {(() => {
          const note = (d.tasks?.length ? (d.description ?? '').replace(/^Tasks:[^\n]*\n*/, '') : (d.description ?? '')).trim();
          return note ? <p className="text-[12px] text-[#5b615e] mt-3 whitespace-pre-wrap">{note}</p> : null;
        })()}
        {/* fact strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 mt-[18px] border-t border-[#eef0ee] pt-3.5 gap-y-3">
          <div className="sm:pr-[18px] sm:border-r border-[#eef0ee]">
            <div className={lbl}>{(d.scope ?? 'unit') === 'unit' ? 'UNIT' : SCOPE_LABEL[d.scope as MaintenanceScope].toUpperCase()}</div>
            <div className="text-[13px] font-semibold mt-[3px]">{maintenanceLocation(d)}</div>
          </div>
          <div className="sm:px-[18px] sm:border-r border-[#eef0ee]">
            <div className={lbl}>PROVIDER</div>
            <div className="text-[13px] font-semibold mt-[3px]">{d.provider ? d.provider.name : <span className="text-[#c47a00]">Not assigned</span>}</div>
            <div className="text-[10.5px] text-[#8a8f8c] mt-0.5">{d.provider?.relationship === 'internal_team' ? 'Own team — no routing or quotation' : d.booking ? `Job BK-${d.booking.id} · ${d.booking.status.replace(/_/g, ' ')}` : d.inHouse ? 'Vendor — you run this job, no quotation' : d.provider ? 'Vendor' : 'Waiting to be routed'}</div>
          </div>
          <div className="sm:px-[18px] sm:border-r border-[#eef0ee]">
            <div className={lbl}>RAISED</div>
            <div className="text-[13px] font-semibold mt-[3px]">{fmtDt(d.createdAt)}</div>
            <div className="text-[10.5px] text-[#8a8f8c] mt-0.5">{d.raisedByRole ? `by ${RAISED_BY[d.raisedByRole] ?? d.raisedByRole.replace(/_/g, ' ')}` : ''}{d.preferredAt ? ` · visit ${fmtDt(d.preferredAt)}` : ''}</div>
          </div>
          <div className="sm:px-[18px]">
            <div className={lbl}>{d.closedAt ? 'COST' : 'COST SO FAR'}</div>
            <div className="text-[13px] font-semibold mt-[3px]">{d.invoiceTotalAed ? aed(d.invoiceTotalAed) : <span className="text-[#8a8f8c] font-normal">No bills yet</span>}</div>
            {!!d.invoiceVatAed && <div className="text-[10.5px] text-[#8a8f8c] mt-0.5">incl. VAT {aed(d.invoiceVatAed)}</div>}
          </div>
        </div>
      </div>

      {err && <p className="text-[12.5px] text-red-700 bg-[#fef2f2] border border-[#fecaca] rounded-xl px-4 py-2.5 mt-4">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 mt-5 items-start">
      <div className="space-y-4 min-w-0">
      {/* ── photos and videos from the customer ── */}
      {!d.inHouse && (d.photos?.length ?? 0) > 0 && (
        <div className={card}>
          <h2 className="text-[14px] font-bold text-[#1c1f1d]">{d.photos!.some(p => isVideoUrl(p.viewUrl)) ? 'Photos & videos' : 'Photos'} from the customer · {d.photos!.length}</h2>
          <p className="text-xs text-[#6b6860] mt-1">The same pictures brief the provider on their job page.</p>
          <ul className="flex gap-2 flex-wrap mt-3">
            {d.photos!.map((p, k) => (
              <li key={p.id}>
                <button type="button" title={p.caption ?? (isVideoUrl(p.viewUrl) ? 'Play video' : 'View photo')} className="block cursor-pointer relative"
                  onClick={() => setGallery({ photos: d.photos!.map(r => ({ id: r.id, url: r.viewUrl, caption: r.caption ?? (isVideoUrl(r.viewUrl) ? 'Customer video' : 'Customer photo') })), start: k })}>
                  {isVideoUrl(p.viewUrl) ? (
                    <>
                      <video src={p.viewUrl} muted playsInline preload="metadata" className="w-24 h-24 object-cover rounded-xl border border-[#e8e6e0] bg-black hover:opacity-90" />
                      <span className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"><Play size={14} fill="currentColor" /></span></span>
                    </>
                  ) : (
                    <img src={p.viewUrl} alt={p.caption ?? 'Customer photo'} className="w-24 h-24 object-cover rounded-xl border border-[#e8e6e0] hover:opacity-90" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── a job you run yourself (own crew or a vendor you phone): before/after photos, bills, mark done ── */}
      {d.inHouse && (
        <InHouseJobPanel
          url={(path) => scoped(base, rp, `/requests/${id}${path}`)}
          open={open}
          photos={d.photos ?? []}
          bills={d.bills ?? []}
          tasks={d.tasks ?? []}
          canAddTasks={(d.scope ?? 'unit') === 'unit' && !!d.unit}
          billCategories={d.billCategories ?? []}
          totalAed={d.invoiceTotalAed}
          vatAed={d.invoiceVatAed}
          onChanged={load}
          onError={setErr}
          section="work"
        />
      )}

      {/* ── quote — presented as the quotation document it is ── */}
      {d.quote && (() => {
        const qs = d.quote.status;
        const qMeta =
          qs === 'submitted' ? { label: showApprove ? 'Awaiting your approval' : 'Submitted', bg: '#fef3c7', fg: '#92400e' }
          : qs === 'approved' ? { label: 'Approved', bg: '#d1fae5', fg: '#065f46' }
          : qs === 'rejected' ? { label: 'Rejected — provider to re-quote', bg: '#fee2e2', fg: '#991b1b' }
          : { label: qs, bg: '#f4f3ef', fg: '#6b6860' };
        const discount = d.quote.discountAed ?? 0;
        const line = 'flex items-baseline justify-between gap-4 py-2';
        return (
        <div className={card}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2"><FileText size={14} /> Quotation</h2>
              <p className="text-xs text-[#6b6860] mt-0.5">
                From <span className="font-semibold text-[#1a1916]">{d.provider?.name ?? 'the provider'}</span>
                {d.quote.submittedAt ? <> · submitted {fmtDt(d.quote.submittedAt)}</> : null}
                {d.quote.validUntil ? <> · valid until {fmtDt(d.quote.validUntil)}</> : null}
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ background: qMeta.bg, color: qMeta.fg }}>{qMeta.label}</span>
          </div>

          <div className="mt-3 rounded-xl border border-[#e8e6e0] bg-[#fbfaf7] px-4 py-1 max-w-md">
            {(d.quote.items?.length ?? 0) > 0 ? (
              d.quote.items!.map((it, i) => (
                <div key={i} className={line + ' border-b border-[#f0eee8]'}>
                  <span className="text-sm text-[#4a4842] min-w-0">
                    {it.name}
                    {it.description && <span className="block text-[11px] text-[#9b9890]">{it.description}</span>}
                    {(it.quantity !== 1 || it.unitPriceAed * it.quantity !== it.totalAed) && (
                      <span className="block text-[11px] text-[#9b9890] tabular-nums">{it.quantity} × {aed(it.unitPriceAed)}</span>
                    )}
                  </span>
                  <span className="text-sm font-medium text-[#1a1916] tabular-nums shrink-0">{aed(it.totalAed)}</span>
                </div>
              ))
            ) : (
              <>
                <div className={line + ' border-b border-[#f0eee8]'}>
                  <span className="text-sm text-[#6b6860]">Labor</span>
                  <span className="text-sm font-medium text-[#1a1916] tabular-nums">{aed(d.quote.laborAed)}</span>
                </div>
                <div className={line}>
                  <span className="text-sm text-[#6b6860]">Materials</span>
                  <span className="text-sm font-medium text-[#1a1916] tabular-nums">{aed(d.quote.materialsAed)}</span>
                </div>
              </>
            )}
            {discount > 0 && (
              <div className={line}>
                <span className="text-sm text-[#6b6860]">Discount</span>
                <span className="text-sm font-medium text-[#1a7a5a] tabular-nums">− {aed(discount)}</span>
              </div>
            )}
            <div className={line + ' border-t-2 border-[#e8e6e0]'}>
              <span className="text-sm font-bold text-[#1a1916]">Total <span className="font-normal text-[#9b9890] text-xs">incl. VAT</span></span>
              <span className="text-lg font-bold text-[#1a7a5a] tabular-nums">{aed(d.quote.totalAed)}</span>
            </div>
          </div>

          {d.quote.summary && (
            <div className="mt-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9b9890]">Scope of work</p>
              <p className="text-sm text-[#4a4842] mt-1 whitespace-pre-wrap">{d.quote.summary}</p>
            </div>
          )}

          {(d.quoteAttachments?.length ?? 0) > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9b9890]">Attached quotations · {d.quoteAttachments!.length}</p>
              <div className="flex gap-2 flex-wrap mt-1.5">
                {d.quoteAttachments!.map((a, k) => (
                  <button key={a.id} type="button" title={a.caption ?? 'View quotation'} className="block cursor-pointer"
                    onClick={() => setGallery({ photos: d.quoteAttachments!.map(r => ({ id: r.id, url: r.viewUrl, caption: r.caption ?? 'Supplier quotation' })), start: k })}>
                    <img src={a.viewUrl} alt={a.caption ?? 'Supplier quotation'} className="w-20 h-20 object-cover rounded-xl border border-[#e8e6e0] hover:opacity-90" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {showApprove && !rejecting && (
            <>
              <div className="flex items-center gap-2 mt-4">
                <button type="button" disabled={!!busy} onClick={() => act('approve', '/approve')} className={btn + ' text-white'} style={{ background: '#1a7a52' }}>
                  <CheckCircle2 size={14} /> {busy === 'approve' ? 'Approving…' : `Approve — ${aed(d.quote.totalAed)}`}
                </button>
                <button type="button" disabled={!!busy} onClick={() => { setRejecting(true); setRejectReason(''); }} className={btn + ' border border-[#e8e6e0] text-[#b91c1c] bg-white'}>
                  <XCircle size={14} /> Reject — ask to re-quote
                </button>
              </div>
              <p className="text-xs text-[#9b9890] mt-2">Approving tells {d.provider?.name ?? 'the provider'} to start the work. You settle with them directly — the cost lands on this request at close-out.</p>
            </>
          )}
          {showApprove && rejecting && (
            <div className="mt-4 rounded-xl border border-[#fecaca] bg-[#fffbfa] p-3">
              <p className="text-xs font-semibold text-[#991b1b]">Why are you rejecting this quote?</p>
              <p className="text-[11.5px] text-[#9b9890] mt-0.5">The provider reads this word for word — say what should change (price, scope, timing) so the revised quote comes back right.</p>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} autoFocus
                placeholder="e.g. AED 325 is high for a cartridge swap — re-quote labor at one hour, or itemise the extra time."
                className="w-full mt-2 border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#b91c1c]" />
              <div className="flex items-center gap-2 mt-2">
                <button type="button" disabled={!!busy || !rejectReason.trim()}
                  onClick={() => { void act('reject', '/reject-quote', { reason: rejectReason.trim() }).then(() => setRejecting(false)); }}
                  className={btn + ' text-white'} style={{ background: '#b91c1c' }}>
                  {busy === 'reject' ? 'Sending…' : 'Send rejection'}
                </button>
                <button type="button" disabled={!!busy} onClick={() => setRejecting(false)} className={btn + ' border border-[#e8e6e0] text-[#6b6860] bg-white'}>
                  Keep the quote
                </button>
              </div>
            </div>
          )}
          {open && d.stage === 'awaiting_approval' && d.coverage === 'chargeable' && (
            <p className="text-xs text-[#6b6860] mt-3">Chargeable work — the customer approves this quote from their own portal.</p>
          )}
        </div>
        );
      })()}

      {/* ── fixed price (Phase B) ── */}
      {prePriced && d.booking && (
        <div className={card}>
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2"><FileText size={14} /> Fixed price · from the provider's catalog</h2>
          <div className="grid sm:grid-cols-3 gap-2 mt-3 text-sm">
            <div><p className="text-[11px] text-[#9b9890]">Total (incl. VAT)</p><p className="font-bold text-[#1a7a5a]">{aed(d.booking.totalAed)}</p></div>
            <div><p className="text-[11px] text-[#9b9890]">Who pays</p><p className="font-medium">{d.booking.payer === 'customer' ? 'Customer' : 'Landlord'}</p></div>
            <div><p className="text-[11px] text-[#9b9890]">Job</p><p className="font-medium">BK-{d.booking.id} · {d.booking.status}</p></div>
          </div>
          <p className="text-xs text-[#6b6860] mt-2">
            No quote round-trip: the provider's own catalog priced this category.{' '}
            {d.coverage === 'covered'
              ? 'Approve to start the work, or pass and the provider quotes after a visit.'
              : 'The customer pays this price from their lease page to confirm; work starts once paid.'}
          </p>
          {showApprove && (
            <div className="flex items-center gap-2 mt-4">
              <button type="button" disabled={!!busy} onClick={() => act('approve', '/approve')} className={btn + ' text-white'} style={{ background: '#1a7a52' }}>
                <CheckCircle2 size={14} /> {busy === 'approve' ? 'Approving…' : 'Approve price'}
              </button>
              <button type="button" disabled={!!busy} onClick={() => act('reject', '/reject-quote')} className={btn + ' border border-[#e8e6e0] text-[#b91c1c] bg-white'}>
                <XCircle size={14} /> {busy === 'reject' ? 'Passing…' : 'Pass — ask for a quote'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── triage ── */}
      {showTriage && (
        <div className={card}>
          <h2 className="text-[14px] font-bold text-[#1c1f1d]">No coverage rule for {d.category?.name ?? 'this category'} — your call</h2>
          <div className="flex items-center gap-3 mt-3 flex-wrap text-sm">
            <label className="flex items-center gap-1.5">Save as
              <select value={saveAsRule} onChange={e => setSaveAsRule(e.target.value as typeof saveAsRule)} className={field}>
                <option value="no">this request only</option>
                <option value="type">a rule for this property type</option>
                <option value="property">a rule for {d.property?.buildingName ?? 'this property'}</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">Auto-approve up to
              <input type="number" min={0} placeholder="AED" value={threshold} onChange={e => setThreshold(e.target.value)} className={field + ' w-24'} />
            </label>
          </div>
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {(['cover', 'charge', 'decline'] as const).map(a => (
              <button key={a} type="button" disabled={!!busy}
                onClick={() => act(a, '/triage', {
                  action: a,
                  ...(saveAsRule !== 'no' ? { saveAsRule } : {}),
                  ...(threshold && a === 'cover' ? { approvalThresholdAed: Number(threshold) } : {}),
                })}
                className={btn + (a === 'cover' ? ' text-white' : a === 'charge' ? ' text-white' : ' border border-[#e8e6e0] text-[#b91c1c] bg-white')}
                style={a === 'cover' ? { background: '#2e9f82' } : a === 'charge' ? { background: '#0369a1' } : undefined}>
                {busy === a ? 'Saving…' : a === 'cover' ? 'Cover it' : a === 'charge' ? 'Charge the customer' : 'Decline'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── change provider (routed, not started) — a link, not a card ── */}
      {canChangeProvider && !changingProvider && (
        <p className="text-xs text-[#6b6860] px-1">
          Routed to <span className="font-semibold text-[#1a1916]">{d.provider!.name}</span> per your settings.{' '}
          <button type="button" onClick={() => setChangingProvider(true)} className="underline font-semibold text-[#1a7a5a] cursor-pointer">Change provider</button>
        </p>
      )}

      {/* ── reassign ── */}
      {showReassign && (
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-bold text-[#1c1f1d]">{needsRouting ? 'Route to a linked provider' : 'Change provider'}</h2>
            {!needsRouting && (
              <button type="button" onClick={() => setChangingProvider(false)} className="text-xs text-[#9b9890] hover:text-[#1a1916] cursor-pointer">Keep {d.provider?.name}</button>
            )}
          </div>
          {assignable.length === 0 ? (
            <div className="mt-2">
              <p className="text-sm text-[#6b6860]">
                You have no vendor recorded yet. Add your own crew or a contractor on the Vendors page and
                they can take this job straight away — no invitation, no email.
              </p>
              <Link href={vendorsHref} className={btn + ' text-white mt-3'} style={{ background: '#1a7a52' }}>Open Vendors</Link>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <select value={reassignTo} onChange={e => setReassignTo(e.target.value)} className={field}>
                <option value="">Choose a provider…</option>
                {assignable.map(l => (
                  <option key={l.serviceProviderId} value={l.serviceProviderId}>
                    {l.name}{l.relationship === 'internal_team' ? ' · own team' : l.selfManaged !== false ? ' · you run it' : ''}{l.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!!busy || !reassignTo}
                onClick={() => act('reassign', '/reassign', { serviceProviderId: Number(reassignTo) })}
                className={btn + ' text-white'} style={{ background: '#1a7a52' }}>
                {busy === 'reassign' ? 'Routing…' : 'Route job'}
              </button>
              {picked && (
                <p className="basis-full text-[11px] text-[#6b6860]">
                  {picked.selfManaged !== false
                    ? <>This job runs on this page — task list, before and after photos, bills and mark-as-done.
                        {picked.relationship === 'internal_team' ? ' Your crew' : ` ${picked.name}`} is recorded as
                        who did it. Nothing is emailed to them.</>
                    : <>{picked.name} accepted your invitation, so this goes to their own portal as a job they
                        action and price there.</>}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── sign-off ── */}
      {showSignOff && (
        <div className={card}>
          <h2 className="text-[14px] font-bold text-[#1c1f1d]">Provider marked the job complete</h2>
          <p className="text-xs text-[#6b6860] mt-1">{d.customer ? 'The customer normally confirms from their portal; sign off here on their behalf.' : 'No occupant on this request — you confirm the work yourself.'}</p>
          <button type="button" disabled={!!busy} onClick={() => act('sign-off', '/sign-off')} className={btn + ' text-white mt-3'} style={{ background: '#1a7a52' }}>
            <ShieldCheck size={14} /> {busy === 'sign-off' ? 'Signing…' : 'Sign work off'}
          </button>
        </div>
      )}

      {/* ── close-out ── */}
      {showClose && (
        <div className={card}>
          <h2 className="text-[14px] font-bold text-[#1c1f1d]">Close out — where does the cost land?</h2>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <select value={allocation} onChange={e => setAllocation(e.target.value as typeof allocation)} className={field}>
              <option value="property_expense">Property expense</option>
              <option value="owner">Owner</option>
              {d.customer && <option value="tenant">Customer (recover as a lease charge)</option>}
            </select>
            <input placeholder="Invoice ref (optional)" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} className={field + ' w-44'} />
            {allocation === 'tenant' && (
              <p className="basis-full text-[11px] text-[#6b6860]">
                Raises a pending maintenance-fee row on the customer's lease payments for the invoice total — unless the customer already paid the provider directly, in which case nothing is charged twice.
              </p>
            )}
            <button type="button" disabled={!!busy}
              onClick={() => act('close', '/close', { costAllocation: allocation, ...(invoiceRef.trim() ? { invoiceRef: invoiceRef.trim() } : {}) })}
              className={btn + ' text-white'} style={{ background: '#1a7a52' }}>
              {busy === 'close' ? 'Closing…' : `Close out${d.quote ? ` · ${aed(d.quote.totalAed)}` : d.booking?.totalAed != null ? ` · ${aed(d.booking.totalAed)}` : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ── closed summary ── */}
      {d.closedAt && (
        <div className={card}>
          <h2 className="text-sm font-bold text-[#15803d] flex items-center gap-2"><CheckCircle2 size={14} /> Closed {fmtDt(d.closedAt)}</h2>
          <div className="grid sm:grid-cols-3 gap-2 mt-3 text-sm">
            <div><p className="text-[11px] text-[#9b9890]">Cost allocation</p><p className="font-medium">{d.costAllocation?.replace(/_/g, ' ') ?? '—'}</p></div>
            <div><p className="text-[11px] text-[#9b9890]">Invoice</p><p className="font-medium">{aed(d.invoiceTotalAed)}{d.invoiceRef ? ` · ${d.invoiceRef}` : ''}</p></div>
            <div><p className="text-[11px] text-[#9b9890]">of which VAT</p><p className="font-medium">{aed(d.invoiceVatAed)}</p></div>
          </div>
        </div>
      )}
      {d.declinedAt && (
        <div className={card}>
          <h2 className="text-sm font-bold text-[#b91c1c]">Declined {fmtDt(d.declinedAt)}</h2>
          {d.declinedReason && <p className="text-sm text-[#6b6860] mt-1">{d.declinedReason}</p>}
        </div>
      )}

      </div>

      {/* ── side column: closing the job, then what happened ── */}
      <div className="space-y-4 min-w-0">
        {d.inHouse && (
          <InHouseJobPanel
            url={(path) => scoped(base, rp, `/requests/${id}${path}`)}
            open={open}
            photos={d.photos ?? []}
            bills={d.bills ?? []}
            tasks={d.tasks ?? []}
            billCategories={d.billCategories ?? []}
            totalAed={d.invoiceTotalAed}
            vatAed={d.invoiceVatAed}
            onChanged={load}
            onError={setErr}
            section="finish"
          />
        )}
      {/* ── timeline ── */}
      <div className={card}>
        <h2 className="text-[14px] font-bold text-[#1c1f1d] flex items-center gap-2"><Clock size={14} /> Timeline</h2>
        <ol className="mt-3 space-y-2">
          {d.timeline.map(e => (
            <li key={e.id} className="flex items-start gap-2.5 text-[12px]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1a7a52] mt-[5px] shrink-0" />
              <div className="min-w-0">
                <span className="font-medium text-[#1a1916]">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="block text-[10.5px] text-[#8a8f8c]">{fmtDt(e.at)}{e.actorRole ? ` · ${RAISED_BY[e.actorRole]?.replace(/^(the|a) /, '') ?? e.actorRole.replace(/_/g, ' ')}` : ''}</span>
                {e.payload?.reason != null && <p className="text-xs text-[#6b6860]">{HOLD_TEXT[String(e.payload.reason)] ?? String(e.payload.reason)}{e.payload?.vendorName ? ` — ${String(e.payload.vendorName)}` : ''}</p>}
                {e.type === 'cost_recovered' && e.payload?.amountAed != null && (
                  <p className="text-xs text-[#6b6860]">{aed(Number(e.payload.amountAed))} · payment #{String(e.payload.paymentId)}</p>
                )}
                {e.type === 'note' && e.payload?.note != null && <p className="text-xs text-[#6b6860]">{String(e.payload.note)}</p>}
                {e.type === 'comment' && e.payload?.text != null && (
                  <p className="text-xs text-[#3d423f] whitespace-pre-wrap">{e.payload?.by != null && <span className="font-semibold">{String(e.payload.by)}: </span>}{String(e.payload.text)}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      </div>
      </div>
      {gallery && <PhotoLightbox photos={gallery.photos} start={gallery.start} onClose={() => setGallery(null)} />}
    </div>
  );
}
