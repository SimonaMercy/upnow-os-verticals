'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPatch } from '@/lib/api';

const PRIMARY = '#2e9f82';
const INK = '#1a1916';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
const BORDER = '1px solid #ececea';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 16, ...extra });
const aed = (n: number | string | null) => (n == null ? '—' : `AED ${Number(n).toLocaleString('en-AE')}`);

interface Booking {
  id: number; status: string; pricingMode: string | null; serviceName: string | null;
  scheduledAt: string; createdAt: string; totalAmount: number | string | null; serviceProviderId: number | null;
  tenant?: { user?: { name?: string | null } | null } | null;
  // Enriched by the admin branch of GET /bookings so the board can show what is
  // actually happening on a job, not just its status word.
  category?: string | null;
  addressText?: string | null;
  emirate?: string | null;
  technicianName?: string | null;
  stageSince?: string | null;
  escrowStatus?: string | null;
}
interface Provider { id: number; businessName: string; compliant: boolean; jobReady: boolean; technicians: { id: number; name: string }[] }

const HOUR = 3_600_000;
const TONE = {
  stale: { bg: '#fee2e2', fg: '#991b1b' },
  warn: { bg: '#fef3c7', fg: '#92400e' },
  fresh: { bg: '#f3f4f6', fg: '#6b7280' },
} as const;
const ageLabel = (hours: number) => {
  const h = Math.abs(hours);
  if (h < 1) return '<1h';
  if (h < 24) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d`;
};
// A booking is "overdue" once its slot has passed and it isn't done or cancelled.
/**
 * How long this job has been sitting at its current stage.
 *
 * A job in motion moves through assigned -> on the way -> in progress; a stalled
 * one just accumulates hours in one of them. Finished states are not "waiting",
 * so they read as a dash rather than an ever-growing number.
 */
const stageAge = (b: Booking, now: number) => {
  if (['completed', 'cancelled'].includes(b.status)) return '—';
  if (!b.stageSince) return '—';
  return ageLabel((now - new Date(b.stageSince).getTime()) / HOUR);
};

const isOverdue = (b: Booking, now: number) =>
  new Date(b.scheduledAt).getTime() < now && !['completed', 'cancelled'].includes(b.status);
// Urgency of an unplaced booking: how long it has waited + how close the slot is.
const placementInfo = (b: Booking, now: number) => {
  const waited = (now - new Date(b.createdAt).getTime()) / HOUR;
  const toSlot = (new Date(b.scheduledAt).getTime() - now) / HOUR;
  const tone: keyof typeof TONE = waited >= 24 || toSlot <= 6 ? 'stale' : waited >= 6 || toSlot <= 24 ? 'warn' : 'fresh';
  return { waited, toSlot, tone };
};

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  booked: { label: 'Booked', bg: '#fef3c7', fg: '#92400e' },
  confirmed: { label: 'Paid · unassigned', bg: '#fee2e2', fg: '#991b1b' },
  assigned: { label: 'Assigned', bg: '#e0f2fe', fg: '#0369a1' },
  en_route: { label: 'On the way', bg: '#e0f2fe', fg: '#0369a1' },
  in_progress: { label: 'In progress', bg: '#e0e7ff', fg: '#4338ca' },
  completed: { label: 'Completed', bg: '#d8f2e8', fg: '#1a7a5a' },
  cancelled: { label: 'Cancelled', bg: '#f3f4f6', fg: '#6b7280' },
};
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' }) + ' · ' + new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

export default function AdminOperationsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignId, setAssignId] = useState<number | null>(null);
  const [spId, setSpId] = useState<number | ''>('');
  const [techId, setTechId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([
        apiGet<Booking[] | { data?: Booking[] }>('/bookings'),
        apiGet<Provider[]>('/bookings/providers'),
      ]);
      setBookings(Array.isArray(b) ? b : (b?.data ?? []));
      setProviders(p ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load operations');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const providerName = useMemo(() => {
    const m = new Map(providers.map((p) => [p.id, p.businessName]));
    return (id: number | null) => (id ? m.get(id) ?? `Provider #${id}` : null);
  }, [providers]);

  const now = Date.now();

  // Paid-but-unplaced jobs AND quote-priced bookings still awaiting a callout
  // provider — both are things the auto-matcher couldn't place and Ops must
  // action. A callout (BOOKED quote) is placed provider-only (no technician).
  const needsAssignment = bookings.filter((b) => b.status === 'confirmed' && !b.serviceProviderId);
  const needsCallout = bookings.filter((b) => b.status === 'booked' && b.pricingMode === 'quote' && !b.serviceProviderId);
  // Most time-critical first: soonest (or already-passed) slot at the top.
  const needsPlacement = [...needsAssignment, ...needsCallout].sort(
    (a, b) => placementInfo(a, now).toSlot - placementInfo(b, now).toSlot,
  );
  // Jobs already placed but stalled past their slot (assigned/en-route/in-progress
  // that never completed) — the other half of "stuck".
  const overdue = bookings.filter((b) => isOverdue(b, now));
  const chosenProvider = providers.find((p) => p.id === spId);
  const assignBooking = assignId != null ? bookings.find((b) => b.id === assignId) ?? null : null;
  const isCallout = assignBooking?.status === 'booked';

  const openAssign = (id: number) => { setAssignId(id); setSpId(''); setTechId(''); };
  const submitAssign = async () => {
    if (!assignId || !spId || (!isCallout && !techId)) return;
    setBusy(true);
    try {
      await apiPatch(`/bookings/${assignId}/assign`, isCallout ? { serviceProviderId: spId } : { serviceProviderId: spId, technicianId: techId });
      setAssignId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign');
    } finally { setBusy(false); }
  };

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading operations…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 4px 48px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: PRIMARY }}>Operations</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Booking dispatch</h1>
        {/* Breadth view (SP-260): stage-grouped boards across every provider + area. */}
        <Link href="/dashboard/admin/operations/pipelines" style={{ fontSize: 13, fontWeight: 600, color: PRIMARY }}>Pipeline boards →</Link>
      </div>
      <p style={{ color: MUTE, fontSize: 14, marginTop: 4 }}>Place the jobs the auto-matcher couldn&apos;t — most time-critical first — and catch anything that&apos;s overdue.</p>

      {error && <div style={{ marginTop: 12, background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      {/* Needs-placement queue: paid-unassigned + quote callouts the matcher couldn't place */}
      <div style={card({ marginTop: 18, overflow: 'hidden', borderColor: needsPlacement.length ? '#f3c6c6' : '#ececea' })}>
        <div style={{ padding: '13px 18px', borderBottom: BORDER, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>Needs assignment</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: needsPlacement.length ? '#991b1b' : PRIMARY, background: needsPlacement.length ? '#fee2e2' : '#e7f3ec', borderRadius: 999, padding: '2px 9px' }}>{needsPlacement.length}</span>
          <span style={{ fontSize: 12.5, color: FAINT, marginLeft: 'auto' }}>Bookings the auto-matcher couldn&apos;t place</span>
        </div>
        {needsPlacement.length === 0 ? (
          <div style={{ padding: '22px 18px', color: FAINT, fontSize: 14 }}>Every booking is placed. 🎉</div>
        ) : needsPlacement.map((b) => {
          const callout = b.status === 'booked';
          const info = placementInfo(b, now);
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: '1px solid #f6f6f4' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: INK, fontSize: 14 }}>{b.serviceName ?? 'Service'} <span style={{ color: FAINT, fontWeight: 400, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>BK-{b.id}</span>{callout && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 999, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Quote callout</span>}</div>
                <div style={{ fontSize: 12.5, color: MUTE, marginTop: 2 }}>{b.tenant?.user?.name ?? 'Customer'} · {fmtWhen(b.scheduledAt)} · {callout ? 'Quote on assessment' : aed(b.totalAmount)}</div>
              </div>
              <span title={`Waiting ${ageLabel(info.waited)} since booked`} style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap', background: TONE[info.tone].bg, color: TONE[info.tone].fg }}>
                {ageLabel(info.waited)} waiting{info.toSlot < 0 ? ' · slot passed' : info.toSlot <= 24 ? ` · slot in ${ageLabel(info.toSlot)}` : ''}
              </span>
              <button onClick={() => openAssign(b.id)} style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{callout ? 'Place callout' : 'Assign'}</button>
            </div>
          );
        })}
      </div>

      {/* All bookings */}
      <div style={card({ marginTop: 18, overflow: 'hidden' })}>
        <div style={{ padding: '13px 18px', borderBottom: BORDER, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>All bookings <span style={{ color: FAINT, fontWeight: 400 }}>({bookings.length})</span></span>
          {overdue.length > 0 && <span title="Slot passed, not completed or cancelled" style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', background: '#fee2e2', borderRadius: 999, padding: '2px 9px' }}>{overdue.length} overdue</span>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ color: FAINT, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {['Booking', 'Category', 'Customer', 'When', 'Status', 'In stage', 'Provider · Technician', 'Value', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 18px', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b, i) => {
                const st = STATUS[b.status] ?? STATUS.booked;
                const pName = providerName(b.serviceProviderId);
                const canAssign = ['confirmed', 'assigned'].includes(b.status) || (b.status === 'booked' && b.pricingMode === 'quote');
                return (
                  <tr key={b.id} style={{ borderTop: i === 0 ? BORDER : '1px solid #f6f6f4', color: INK }}>
                    <td style={{ padding: '11px 18px' }}>
                      {/* Drill-down (SP-257): the job's full story — trail, money, people. */}
                      <Link href={`/dashboard/admin/operations/${b.id}`} style={{ fontWeight: 600, color: INK, textDecoration: 'none' }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.color = PRIMARY; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.color = INK; }}>
                        {b.serviceName ?? 'Service'}
                      </Link>{' '}
                      <span style={{ color: FAINT, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>BK-{b.id}</span>
                      {b.addressText && <div style={{ color: FAINT, fontSize: 11.5, marginTop: 2 }}>{b.emirate ? `${b.emirate} · ` : ''}{b.addressText}</div>}
                    </td>
                    <td style={{ padding: '11px 18px', color: MUTE, whiteSpace: 'nowrap' }}>
                      {b.category ?? '—'}
                      {b.pricingMode === 'quote' && <span title="Quote-priced job" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#6d28d9', background: '#ede9fe', borderRadius: 999, padding: '2px 6px' }}>QUOTE</span>}
                    </td>
                    <td style={{ padding: '11px 18px', color: MUTE }}>{b.tenant?.user?.name ?? '—'}</td>
                    <td style={{ padding: '11px 18px', color: MUTE, whiteSpace: 'nowrap' }}>{fmtWhen(b.scheduledAt)}</td>
                    <td style={{ padding: '11px 18px', whiteSpace: 'nowrap' }}><span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: st.bg, color: st.fg }}>{st.label}</span>{isOverdue(b, now) && <span title="Slot passed, not completed" style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: '#991b1b', background: '#fee2e2', borderRadius: 999, padding: '2px 7px' }}>Overdue</span>}</td>
                    {/* How long the job has sat at this stage — a job in motion moves
                        through stages; a stalled one accumulates hours here. */}
                    <td style={{ padding: '11px 18px', color: MUTE, whiteSpace: 'nowrap' }}>{stageAge(b, now)}</td>
                    <td style={{ padding: '11px 18px', color: pName ? INK : FAINT }}>
                      {pName ?? 'Unassigned'}
                      <div style={{ color: b.technicianName ? MUTE : FAINT, fontSize: 11.5, marginTop: 2 }}>
                        {b.technicianName ?? (b.serviceProviderId ? 'No technician' : '—')}
                      </div>
                    </td>
                    <td style={{ padding: '11px 18px', color: MUTE, whiteSpace: 'nowrap' }}>
                      {aed(b.totalAmount)}
                      {b.escrowStatus && <div style={{ color: FAINT, fontSize: 11.5, marginTop: 2, textTransform: 'capitalize' }}>{b.escrowStatus}</div>}
                    </td>
                    <td style={{ padding: '11px 18px', textAlign: 'right' }}>
                      {canAssign && <button onClick={() => openAssign(b.id)} style={{ background: 'none', border: BORDER, borderRadius: 8, padding: '5px 11px', fontSize: 12.5, fontWeight: 600, color: PRIMARY, cursor: 'pointer' }}>{b.serviceProviderId ? 'Reassign' : (b.status === 'booked' ? 'Place callout' : 'Assign')}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assign modal */}
      {assignId != null && (
        <div onClick={() => setAssignId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,18,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={card({ width: 440, maxWidth: '100%', padding: 22 })}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{isCallout ? 'Place a callout provider' : 'Assign a provider'}</div>
            <p style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>{isCallout ? `BK-${assignId} — the provider assesses the job and sends the customer a quote. A technician is chosen later, at quote approval.` : `BK-${assignId} — pick a provider and one of their technicians.`}</p>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: MUTE, marginTop: 16 }}>Provider</label>
            <select value={spId} onChange={(e) => { setSpId(Number(e.target.value)); setTechId(''); }} style={{ width: '100%', marginTop: 6, border: BORDER, borderRadius: 9, padding: '9px 11px', fontSize: 14, color: INK, background: '#fff' }}>
              <option value="" disabled>Select a provider…</option>
              {/* A callout needs no technician, so tech-less providers are eligible; the paid path still requires one. */}
              {providers.filter((p) => isCallout || p.technicians.length > 0).map((p) => (
                <option key={p.id} value={p.id}>{p.businessName}{p.jobReady ? '' : ' · not job-ready'}{p.compliant ? '' : ' · non-compliant'}</option>
              ))}
            </select>

            {!isCallout && (
              <>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: MUTE, marginTop: 14 }}>Technician</label>
                <select value={techId} onChange={(e) => setTechId(Number(e.target.value))} disabled={!chosenProvider} style={{ width: '100%', marginTop: 6, border: BORDER, borderRadius: 9, padding: '9px 11px', fontSize: 14, color: INK, background: '#fff', opacity: chosenProvider ? 1 : 0.5 }}>
                  <option value="" disabled>{chosenProvider ? 'Select a technician…' : 'Pick a provider first'}</option>
                  {chosenProvider?.technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </>
            )}

            {chosenProvider && (!chosenProvider.jobReady || !chosenProvider.compliant) && (
              <p style={{ fontSize: 12, color: '#92400e', background: '#fef6e7', borderRadius: 8, padding: '8px 10px', marginTop: 12 }}>
                Heads up: this provider is {[!chosenProvider.compliant && 'not compliant', !chosenProvider.jobReady && 'not job-ready'].filter(Boolean).join(' and ')}. Assign only as an ops override.
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setAssignId(null)} style={{ background: 'none', border: BORDER, borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 600, color: MUTE, cursor: 'pointer' }}>Cancel</button>
              <button onClick={submitAssign} disabled={busy || !spId || (!isCallout && !techId)} style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 17px', fontSize: 13, fontWeight: 600, opacity: busy || !spId || (!isCallout && !techId) ? 0.5 : 1, cursor: 'pointer' }}>{busy ? (isCallout ? 'Placing…' : 'Assigning…') : (isCallout ? 'Place callout' : 'Assign')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
