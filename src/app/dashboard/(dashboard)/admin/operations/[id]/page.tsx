'use client';

/**
 * Admin booking drill-down (SP-257) — the per-job answer to "what is going on
 * with this booking": facts, the SP-145 activity trail (actor + elapsed),
 * the money trail (escrow + transactions incl. SP-259 refund reasons),
 * the people on the job, any dispute/review, and inline reassign.
 * Reached by clicking a row on the dispatch board (admin/operations).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { MediaThumb } from '@/components/upnow/PhotoGallery';

const INK = '#141412';
const MUTE = '#5f5f5a';
const FAINT = '#9b9b94';
const BORDER = '1px solid #e8e8e4';
const PRIMARY = '#0B7A4E';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });

/** GET /bookings/:id/cancel-preview (SP-135/138). */
interface CancelPreview {
  status: string; canCancel: boolean; paid: boolean; hoursBefore: number; feePct: number; fee: number; refund: number; total: number;
  policy: { source: 'platform' | 'service'; cancel: { minHoursBefore: number; feePct: number }[]; noShowFeePct: number; noShowGraceMinutes: number; retainedFeeTo: 'provider' | 'platform' };
  noShow: { windowOpen: boolean; opensAt: string; fee: number; customerCanReport: boolean; providerCanReport: boolean };
}
type CancelOutcome = 'per_policy' | 'full_refund' | 'customer_no_show' | 'provider_no_show';

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  booked:      { bg: '#fef3c7', fg: '#92400e', label: 'Booked' },
  confirmed:   { bg: '#e0f2fe', fg: '#0369a1', label: 'Confirmed' },
  assigned:    { bg: '#ede9fe', fg: '#6d28d9', label: 'Assigned' },
  en_route:    { bg: '#e0f2fe', fg: '#0369a1', label: 'En route' },
  in_progress: { bg: '#e0e7ff', fg: '#4338ca', label: 'In progress' },
  completed:   { bg: '#d8f2e8', fg: '#1a7a5a', label: 'Completed' },
  dispute:     { bg: '#fee2e2', fg: '#991b1b', label: 'Dispute' },
  cancelled:   { bg: '#f3f4f6', fg: '#6b7280', label: 'Cancelled' },
};

const REFUND_REASON_LABELS: Record<string, string> = {
  customer_cancelled: 'Customer cancelled', provider_cancelled: 'Provider cancelled',
  provider_no_show: 'Provider no-show', customer_no_show: 'Customer no-show', work_not_to_standard: 'Work not to standard',
  duplicate_booking: 'Duplicate booking', platform_error: 'Platform error',
  dispute_upheld: 'Dispute upheld', goodwill: 'Goodwill',
};
/** Mirrors RefundReasonCode (SP-259 + customer_no_show from SP-138). */
const REFUND_REASONS = Object.entries(REFUND_REASON_LABELS).map(([code, label]) => ({ code, label }));

interface TrailEvent { id: number; fromStatus: string | null; toStatus: string; reason: string | null; actorName: string | null; createdAt: string }
interface MoneyTxn { id: number; type: string; amount: number | string; notes: string | null; refundReasonCode: string | null; refundReasonNote: string | null; actorName: string | null; createdAt: string }
interface AdminDetail {
  booking: {
    id: number; status: string; serviceName: string | null; packageName: string | null;
    pricingMode: string | null; scheduledAt: string | null; createdAt: string;
    addressText: string | null; emirate: string | null; specialInstructions: string | null;
    hours: number | null; quantity: number | null;
    totalAmount: number | string | null; cancellationReason: string | null;
  };
  category: string | null;
  assignment: { technicianId: number | null; jobStatus: string | null; assignedAt: string | null; acceptedAt: string | null; startedAt: string | null; completedAt: string | null; customerSignOff: boolean } | null;
  people: {
    customer: { name: string | null; email: string | null; phone: string | null };
    provider: { id: number; businessName: string | null; complianceStatus: string; jobReady: boolean } | null;
    technician: { id: number; name: string } | null;
  };
  events: TrailEvent[];
  money: {
    pricing: { total: number | string | null; vat: number | string | null; addonsAmount: number | string | null; commissionPercent: number | string | null; cancellationFee: number | string | null };
    escrow: { status: string; heldAmount: number | string; releasedAmount: number | string; refundedAmount: number | string; fundedAt: string | null; releasedAt: string | null; refundedAt: string | null } | null;
    transactions: MoneyTxn[];
  };
  dispute: { id: number; status: string; title: string; resolutionSummary: string | null; providerResponse: string | null; openedAt: string | null; resolvedAt: string | null } | null;
  review: { rating: number; title: string | null; body: string | null; technicianId: number | null; hidden: boolean; createdAt: string } | null;
  /** Evidence photos (SP-258) — both sides' proof, grouped by kind. */
  media: { problem: EvidencePhoto[]; before: EvidencePhoto[]; after: EvidencePhoto[] };
}
interface EvidencePhoto { id: number; kind: string; caption: string | null; viewUrl: string; createdAt: string }
interface Provider { id: number; businessName: string; compliant: boolean; jobReady: boolean; technicians: { id: number; name: string }[] }

const aed = (n: number | string | null | undefined) => (n == null ? '—' : `AED ${Number(n).toLocaleString('en-AE')}`);
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const elapsed = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

function Section({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={card({ overflow: 'hidden' })}>
      <div style={{ padding: '11px 16px', borderBottom: BORDER, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{title}</span>
        {extra}
      </div>
      <div style={{ padding: '12px 16px' }}>{children}</div>
    </div>
  );
}
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: FAINT }}>{label}</div>
      <div style={{ fontSize: 13.5, color: INK, marginTop: 2, overflowWrap: 'anywhere' }}>{value ?? '—'}</div>
    </div>
  );
}

export default function AdminBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [data, setData] = useState<AdminDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [reassigning, setReassigning] = useState(false);
  const [spId, setSpId] = useState<number | ''>('');
  const [techId, setTechId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  // SP-138: cancel & refund on behalf. Preview comes from the same endpoint the
  // customer sees, so the admin decides on the exact numbers the policy yields.
  const [cancelling, setCancelling] = useState(false);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [outcome, setOutcome] = useState<CancelOutcome>('per_policy');
  const [reasonCode, setReasonCode] = useState<string>('customer_cancelled');
  const [cancelNote, setCancelNote] = useState('');

  const load = useCallback(
    () => apiGet<AdminDetail>(`/bookings/${id}/admin`)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e?.message ?? 'Could not load booking')),
    [id],
  );
  useEffect(() => { if (Number.isFinite(id)) void load(); }, [id, load]);

  const chosen = useMemo(() => providers.find((p) => p.id === spId) ?? null, [providers, spId]);

  const openReassign = async () => {
    setReassigning(true);
    setActErr(null);
    if (!providers.length) {
      try { setProviders(await apiGet<Provider[]>('/bookings/providers')); } catch { setActErr('Could not load providers'); }
    }
  };
  const openCancel = async () => {
    setCancelling((v) => !v);
    setActErr(null);
    if (!preview) {
      try { setPreview(await apiGet<CancelPreview>(`/bookings/${id}/cancel-preview`)); } catch (e) { setActErr((e as Error)?.message ?? 'Could not load the cancellation preview'); }
    }
  };
  const submitCancel = async () => {
    setBusy(true);
    setActErr(null);
    try {
      await apiPost(`/bookings/${id}/admin/cancel`, { outcome, reasonCode, note: cancelNote.trim() || undefined });
      setCancelling(false); setPreview(null); setCancelNote('');
      await load();
    } catch (e) {
      setActErr((e as Error)?.message ?? 'Cancellation failed');
    } finally {
      setBusy(false);
    }
  };
  const submitReassign = async (callout: boolean) => {
    if (!spId) return;
    setBusy(true);
    setActErr(null);
    try {
      // The paid path needs a technician; a quote callout attaches provider-only
      // (the backend's callout branch ignores technicianId — never send one).
      await apiPatch(`/bookings/${id}/assign`, callout ? { serviceProviderId: spId } : { serviceProviderId: spId, technicianId: techId });
      setReassigning(false); setSpId(''); setTechId('');
      await load();
    } catch (e) {
      setActErr((e as Error)?.message ?? 'Assignment failed');
    } finally {
      setBusy(false);
    }
  };

  // A hand-typed bad id (e.g. pasting "BK-31") must dead-end honestly, not
  // sit on the loading placeholder forever.
  if (!Number.isFinite(id)) {
    return (
      <div style={{ margin: 24, padding: 14, borderRadius: 12, background: '#fef2f2', color: '#dc2626', fontSize: 13.5 }}>
        Not a valid booking id. <Link href="/dashboard/admin/operations" style={{ color: PRIMARY, fontWeight: 600 }}>← Operations board</Link>
      </div>
    );
  }
  // Full-page error only when there is nothing to show — a transient refresh
  // failure on an already-rendered page becomes an inline banner instead.
  if (error && !data) {
    return (
      <div style={{ margin: 24, padding: 14, borderRadius: 12, background: '#fef2f2', color: '#dc2626', fontSize: 13.5 }}>
        {error}{' '}
        <button onClick={() => void load()} style={{ marginLeft: 8, background: 'none', border: 'none', color: PRIMARY, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Retry</button>
        <Link href="/dashboard/admin/operations" style={{ marginLeft: 8, color: PRIMARY, fontWeight: 600 }}>← Operations board</Link>
      </div>
    );
  }
  if (!data) return <div style={{ padding: 24, color: FAINT, fontSize: 13.5 }}>Loading booking…</div>;

  const b = data.booking;
  const st = STATUS[b.status] ?? { bg: '#f3f4f6', fg: '#6b7280', label: b.status };
  const p = data.money.pricing;
  const isCallout = b.status === 'booked' && b.pricingMode === 'quote';
  const canReassign = ['confirmed', 'assigned'].includes(b.status) || isCallout;
  // Admin may cancel until the crew has started; a job under way is dispute territory (SP-138).
  const canCancel = ['booked', 'confirmed', 'assigned', 'en_route'].includes(b.status);
  const OUTCOMES: { key: CancelOutcome; label: string; hint: string; defaultReason: string }[] = [
    { key: 'per_policy', label: 'Per policy', hint: preview ? `${preview.feePct}% fee · AED ${preview.fee} retained · AED ${preview.refund} back` : 'charged by the snapshot tiers', defaultReason: 'customer_cancelled' },
    { key: 'full_refund', label: 'Full refund', hint: preview ? `AED ${preview.total} back to the customer` : 'everything back to the customer', defaultReason: 'provider_cancelled' },
    { key: 'customer_no_show', label: 'Customer no-show', hint: preview ? `${preview.policy.noShowFeePct}% fee · AED ${preview.noShow.fee} retained → ${preview.policy.retainedFeeTo}` : 'no-show fee retained', defaultReason: 'customer_no_show' },
    { key: 'provider_no_show', label: 'Provider no-show', hint: 'full refund; counted against the provider', defaultReason: 'provider_no_show' },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '4px 2px 40px' }}>
      <Link href="/dashboard/admin/operations" style={{ fontSize: 12.5, color: PRIMARY, fontWeight: 600 }}>← Operations board</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>{b.serviceName ?? 'Service'}</h1>
        <span style={{ color: FAINT, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>BK-{b.id}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '4px 11px', background: st.bg, color: st.fg }}>{st.label}</span>
        {data.category && <span style={{ fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '4px 11px', background: '#f3f4f6', color: MUTE }}>{data.category}</span>}
        {b.pricingMode === 'quote' && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#6d28d9', background: '#ede9fe', borderRadius: 999, padding: '3px 8px' }}>QUOTE</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canReassign && (
            <button onClick={() => (reassigning ? setReassigning(false) : void openReassign())}
              style={{ background: 'none', border: BORDER, borderRadius: 9, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, color: PRIMARY, cursor: 'pointer' }}>
              {data.people.provider ? 'Reassign' : 'Assign provider'}
            </button>
          )}
          {canCancel && (
            <button onClick={() => void openCancel()}
              style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 9, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, color: '#b91c1c', cursor: 'pointer' }}>
              Cancel &amp; refund
            </button>
          )}
        </span>
      </div>

      {cancelling && (
        <div style={card({ marginTop: 12, padding: 14 })}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Cancel &amp; refund on behalf</div>
          {preview ? (
            <div style={{ fontSize: 12, color: MUTE, marginBottom: 10 }}>
              {preview.paid ? `Paid AED ${preview.total} · ` : 'Unpaid · '}slot in {preview.hoursBefore}h · policy: {preview.policy.source === 'service' ? 'this service\u2019s own terms' : 'platform matrix'} ·
              {' '}tiers {preview.policy.cancel.map((t) => `≥${t.minHoursBefore}h ${t.feePct}%`).join(' / ')} · no-show {preview.policy.noShowFeePct}% after {preview.policy.noShowGraceMinutes} min grace
            </div>
          ) : <div style={{ fontSize: 12, color: FAINT, marginBottom: 10 }}>Loading preview…</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
            {OUTCOMES.map((o) => (
              <label key={o.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', border: outcome === o.key ? `1px solid ${PRIMARY}` : BORDER, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', background: outcome === o.key ? '#f0faf5' : '#fff' }}>
                <input type="radio" name="outcome" checked={outcome === o.key} onChange={() => { setOutcome(o.key); setReasonCode(o.defaultReason); }} style={{ marginTop: 3 }} />
                <span>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: INK }}>{o.label}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: MUTE }}>{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}
              style={{ height: 36, border: BORDER, borderRadius: 9, padding: '0 10px', fontSize: 13, color: INK }}>
              {REFUND_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <input value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="Note for the trail (optional)"
              style={{ flex: 1, minWidth: 220, height: 36, border: BORDER, borderRadius: 9, padding: '0 10px', fontSize: 13, color: INK }} />
            <button onClick={() => void submitCancel()} disabled={busy || !preview}
              style={{ height: 36, padding: '0 16px', borderRadius: 9, background: '#b91c1c', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Cancelling…' : 'Confirm cancellation'}
            </button>
            <button onClick={() => setCancelling(false)} disabled={busy}
              style={{ height: 36, padding: '0 12px', borderRadius: 9, background: 'none', color: MUTE, fontSize: 13, border: BORDER, cursor: 'pointer' }}>Keep booking</button>
          </div>
          {actErr && <div style={{ fontSize: 12.5, color: '#dc2626', marginTop: 8 }}>{actErr}</div>}
        </div>
      )}

      {error && <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#fef2f2', color: '#dc2626', fontSize: 12.5 }}>Refresh failed: {error} <button onClick={() => void load()} style={{ background: 'none', border: 'none', color: PRIMARY, fontWeight: 600, cursor: 'pointer', fontSize: 12.5 }}>Retry</button></div>}

      {reassigning && (
        <div style={card({ marginTop: 12, padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })}>
          <select value={spId} onChange={(e) => { setSpId(e.target.value ? Number(e.target.value) : ''); setTechId(''); }}
            style={{ height: 36, border: BORDER, borderRadius: 9, padding: '0 10px', fontSize: 13, color: INK }}>
            <option value="">Choose provider…</option>
            {/* Paid path requires a technician, so tech-less providers are only
                offered on the callout path (mirrors the board modal's filter). */}
            {providers.filter((pr) => isCallout || pr.technicians.length > 0).map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.businessName}{pr.compliant ? '' : ' · not compliant'}{pr.jobReady ? '' : ' · not job-ready'}</option>
            ))}
          </select>
          {/* A callout attaches the provider only — the backend ignores any
              technician here (it lands later at quote approval), so don't offer one. */}
          {!isCallout && (
            <select value={techId} onChange={(e) => setTechId(e.target.value ? Number(e.target.value) : '')} disabled={!chosen}
              style={{ height: 36, border: BORDER, borderRadius: 9, padding: '0 10px', fontSize: 13, color: INK }}>
              <option value="">Choose technician…</option>
              {(chosen?.technicians ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button onClick={() => void submitReassign(isCallout)} disabled={busy || !spId || (!isCallout && !techId)}
            style={{ height: 36, padding: '0 16px', borderRadius: 9, background: PRIMARY, color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Assigning…' : isCallout ? 'Place callout' : 'Confirm'}
          </button>
          {actErr && <span style={{ fontSize: 12.5, color: '#dc2626' }}>{actErr}</span>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginTop: 14 }}>
        <Section title="Facts">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
            <Fact label="Customer" value={data.people.customer.name} />
            <Fact label="Contact" value={[data.people.customer.email, data.people.customer.phone].filter(Boolean).join(' · ') || '—'} />
            <Fact label="Slot" value={when(b.scheduledAt)} />
            <Fact label="Booked" value={when(b.createdAt)} />
            <Fact label="Address" value={b.addressText ? `${b.emirate ? `${b.emirate} · ` : ''}${b.addressText}` : '—'} />
            <Fact label="Package" value={[b.packageName, b.hours ? `${b.hours}h` : null, b.quantity ? `×${b.quantity}` : null].filter(Boolean).join(' · ') || '—'} />
          </div>
          {b.specialInstructions && (
            <p style={{ fontSize: 13, color: MUTE, marginTop: 10, padding: '8px 10px', background: '#fafaf8', borderRadius: 8 }}>{b.specialInstructions}</p>
          )}
          {b.cancellationReason && (
            <p style={{ fontSize: 12.5, color: '#991b1b', marginTop: 8 }}>Cancellation reason: {b.cancellationReason}</p>
          )}
        </Section>

        <Section title="People">
          <div style={{ display: 'grid', gap: 10 }}>
            <Fact label="Provider" value={data.people.provider
              ? <>{data.people.provider.businessName ?? `SP #${data.people.provider.id}`}
                  <span style={{ marginLeft: 8, fontSize: 11, color: data.people.provider.complianceStatus === 'compliant' ? '#1a7a5a' : '#b45309' }}>
                    {data.people.provider.complianceStatus}{data.people.provider.jobReady ? ' · job-ready' : ' · not job-ready'}
                  </span></>
              : 'Unassigned'} />
            <Fact label="Technician" value={data.people.technician?.name ?? (data.people.provider ? 'No technician' : '—')} />
            {data.assignment && (
              <Fact label="Job clock" value={
                ['assigned ' + when(data.assignment.assignedAt),
                 data.assignment.startedAt ? 'started ' + when(data.assignment.startedAt) : null,
                 data.assignment.completedAt ? 'completed ' + when(data.assignment.completedAt) : null,
                 data.assignment.customerSignOff ? 'customer signed off' : null,
                ].filter(Boolean).join(' → ')} />
            )}
          </div>
        </Section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginTop: 14 }}>
        <Section title="Activity trail" extra={<span style={{ fontSize: 11, color: FAINT }}>{data.events.length} event{data.events.length === 1 ? '' : 's'}</span>}>
          {data.events.length === 0 ? (
            <p style={{ fontSize: 13, color: FAINT }}>No events recorded — this booking predates the trail (migr 0208).</p>
          ) : (
            <div>
              {data.events.map((e, i) => (
                <div key={e.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i === 0 ? 'none' : '1px solid #f4f4f1' }}>
                  <div style={{ width: 7, height: 7, borderRadius: 999, background: PRIMARY, marginTop: 6, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, color: INK }}>
                      <b style={{ textTransform: 'capitalize' }}>{e.toStatus.replace(/_/g, ' ')}</b>
                      {e.fromStatus && <span style={{ color: FAINT }}> (from {e.fromStatus.replace(/_/g, ' ')})</span>}
                      {e.actorName && <span style={{ color: MUTE }}> · {e.actorName}</span>}
                      {!e.actorName && <span style={{ color: FAINT }}> · system</span>}
                    </div>
                    {e.reason && <div style={{ fontSize: 12, color: MUTE, marginTop: 1 }}>{e.reason}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11.5, color: MUTE, whiteSpace: 'nowrap' }}>{when(e.createdAt)}</div>
                    {i > 0 && (
                      <div style={{ fontSize: 10.5, color: FAINT }}>
                        +{elapsed(new Date(e.createdAt).getTime() - new Date(data.events[i - 1].createdAt).getTime())}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Money trail">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
            <Fact label="Total (VAT incl.)" value={aed(p.total)} />
            <Fact label="VAT" value={p.vat != null ? aed(p.vat) : '—'} />
            <Fact label="Commission pin" value={p.commissionPercent != null ? `${Number(p.commissionPercent)}%` : 'legacy (live rate)'} />
            <Fact label="Escrow" value={data.money.escrow
              ? <span style={{ textTransform: 'capitalize' }}>{data.money.escrow.status.replace(/_/g, ' ')} · held {aed(data.money.escrow.heldAmount)}</span>
              : 'Not funded'} />
            {p.cancellationFee != null && Number(p.cancellationFee) > 0 && <Fact label="Cancellation fee" value={aed(p.cancellationFee)} />}
          </div>
          {data.money.transactions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {data.money.transactions.map((t) => (
                <div key={t.id} style={{ padding: '7px 0', borderTop: '1px solid #f4f4f1' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 13, color: INK, fontWeight: 600, textTransform: 'capitalize' }}>
                      {t.type.replace(/_/g, ' ')}
                      {t.refundReasonCode && (
                        <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#b45309', background: '#fef9eb', borderRadius: 999, padding: '2px 8px' }}>
                          {REFUND_REASON_LABELS[t.refundReasonCode] ?? t.refundReasonCode}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 13, color: MUTE, whiteSpace: 'nowrap' }}>{aed(t.amount)} · {when(t.createdAt)}</span>
                  </div>
                  {(t.notes || t.refundReasonNote || t.actorName) && (
                    <div style={{ fontSize: 12, color: MUTE, marginTop: 1 }}>
                      {[t.notes, t.refundReasonNote, t.actorName ? `by ${t.actorName}` : null].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Evidence (SP-258): the customer's problem photos vs the provider's
          before/after — what dispute resolution actually looks at. */}
      {(data.media.problem.length > 0 || data.media.before.length > 0 || data.media.after.length > 0) && (
        <div style={{ marginTop: 14 }}>
          <Section title="Evidence photos">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              {([['problem', 'Problem — customer'], ['before', 'Before — provider'], ['after', 'After — provider']] as const).map(([kind, label]) => (
                <div key={kind}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: FAINT }}>
                    {label} · {data.media[kind].length}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    {data.media[kind].length === 0 && <span style={{ fontSize: 12, color: FAINT }}>None</span>}
                    {data.media[kind].map((p) => (
                      <a key={p.id} href={p.viewUrl} target="_blank" rel="noreferrer" title={p.caption ?? label}>
                        <MediaThumb url={p.viewUrl} alt={p.caption ?? label} className="block w-[84px] h-[84px] object-cover rounded-[10px] border border-[#e8e8e4]" />
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {(data.dispute || data.review) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginTop: 14 }}>
          {data.dispute && (
            <Section title="Dispute" extra={<Link href="/dashboard/admin/disputes" style={{ fontSize: 11.5, color: PRIMARY, fontWeight: 600 }}>Open disputes console →</Link>}>
              <div style={{ fontSize: 13.5, color: INK, fontWeight: 600 }}>{data.dispute.title}
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: data.dispute.resolvedAt ? '#1a7a5a' : '#991b1b', textTransform: 'capitalize' }}>{data.dispute.status.replace(/_/g, ' ')}</span>
              </div>
              {data.dispute.providerResponse && <p style={{ fontSize: 12.5, color: MUTE, marginTop: 6 }}><b>Provider:</b> {data.dispute.providerResponse}</p>}
              {data.dispute.resolutionSummary && <p style={{ fontSize: 12.5, color: MUTE, marginTop: 6 }}><b>Resolution:</b> {data.dispute.resolutionSummary}</p>}
            </Section>
          )}
          {data.review && (
            <Section title="Review">
              <div style={{ fontSize: 13.5, color: INK }}>
                <span style={{ color: '#E8A317', letterSpacing: 1 }}>{'★★★★★'.slice(0, data.review.rating)}<span style={{ color: '#e5e5e0' }}>{'★★★★★'.slice(data.review.rating)}</span></span>
                {data.review.title && <b style={{ marginLeft: 8 }}>{data.review.title}</b>}
                {data.review.hidden && <span style={{ marginLeft: 8, fontSize: 11, color: '#991b1b' }}>hidden by moderation</span>}
              </div>
              {data.review.body && <p style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>{data.review.body}</p>}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
