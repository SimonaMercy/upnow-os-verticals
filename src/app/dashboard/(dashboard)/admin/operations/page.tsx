'use client';

/**
 * Admin › Operations › Dispatch — Genspark OS rebuild of the booking dispatch page.
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET /api/bookings (array or { data }) — every booking (admin branch enriches category,
 *    addressText, emirate, technicianName, stageSince, escrowStatus).
 *  - GET /api/bookings/providers — providers + technicians (solo, compliant, jobReady,
 *    technician complianceStatus/assignable).
 *  - GET /api/admin/reliability?days=90 — SP-229 reliability ledgers (deferred one tick);
 *    failure → no reliability hints. Appended to each provider option + shown under the pick.
 *  - Needs-assignment queue: confirmed & no provider (paid · unassigned) + booked quote
 *    callouts with no provider; sorted soonest slot first; waited / slot-in urgency pill
 *    (stale ≥24h waited or slot ≤6h; warn ≥6h or ≤24h); "Assign" / "Place callout" button.
 *  - Overdue count (slot passed, not completed/cancelled) + per-row "Overdue" pill.
 *  - All-bookings table: service + BK id link → /dashboard/admin/operations/:id (SP-257),
 *    address/emirate, category + QUOTE tag, customer, when, status label, in-stage age,
 *    provider · technician, value (AED number, not fils) + escrow status, and the
 *    Assign / Reassign / Place callout action (confirmed, assigned, or booked quote).
 *  - Assign modal: provider select (callout → tech-less providers allowed; flags solo,
 *    not job-ready, non-compliant, reliability), solo operator auto-picks the self technician
 *    (SP-254), technician select with verified / not verified, Gate-1 unverified warning,
 *    reliability callout, non-compliant / not-job-ready override warning, Cancel / Assign.
 *    PATCH /api/bookings/:id/assign with { serviceProviderId } (callout) or
 *    { serviceProviderId, technicianId } (paid), then reload.
 *  - "Pipeline boards" link → /dashboard/admin/operations/pipelines (SP-260).
 *  - Loading and error states (error now has Try again).
 * New in this layout: KPIs, a live job board (Board / Table via Seg; board cards link to the
 * job drill-down), a search box, and a read-only Drawer per booking (KV) whose footer has
 * "Open job" and the same Assign action. No new endpoints.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { STANDING_UI, type ReliabilityLedger } from '@/components/upnow/SpReliabilityCard';
import { apiGet, apiPatch } from '@/lib/api';
import {
  Attn, AttnCard, Board, BoardCard, BoardCol, Btn, Callout, Card, Drawer, EmptyRow, ErrorRow, Field, KV, Kpi, Kpis,
  Modal, OsPage, PageHead, Pill, ScopeStrip, SearchField, Seg, SkeletonRows, TableWrap, fmtAed, type Tone,
} from '@/components/os/kit';

interface Booking {
  id: number; status: string; pricingMode: string | null; serviceName: string | null;
  scheduledAt: string; createdAt: string; totalAmount: number | string | null; serviceProviderId: number | null;
  tenant?: { user?: { name?: string | null } | null } | null;
  category?: string | null;
  addressText?: string | null;
  emirate?: string | null;
  technicianName?: string | null;
  stageSince?: string | null;
  escrowStatus?: string | null;
}
interface ProviderTechnician {
  id: number; name: string;
  /** SP-254 solo self-row (the owner). */
  isSelf?: boolean;
  /** SP-129: technician half of Gate 1. */
  complianceStatus?: string; assignable?: boolean;
}
interface Provider { id: number; businessName: string; compliant: boolean; jobReady: boolean; solo?: boolean; technicians: ProviderTechnician[] }

const HOUR = 3_600_000;
const ageLabel = (hours: number) => {
  const h = Math.abs(hours);
  if (h < 1) return '<1h';
  if (h < 24) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d`;
};
/** How long this job has been sitting at its current stage (finished states read as a dash). */
const stageAge = (b: Booking, now: number) => {
  if (['completed', 'cancelled'].includes(b.status)) return '—';
  if (!b.stageSince) return '—';
  return ageLabel((now - new Date(b.stageSince).getTime()) / HOUR);
};
const isOverdue = (b: Booking, now: number) =>
  new Date(b.scheduledAt).getTime() < now && !['completed', 'cancelled'].includes(b.status);
/** Urgency of an unplaced booking: how long it has waited + how close the slot is. */
const placementInfo = (b: Booking, now: number) => {
  const waited = (now - new Date(b.createdAt).getTime()) / HOUR;
  const toSlot = (new Date(b.scheduledAt).getTime() - now) / HOUR;
  const tone: Tone = waited >= 24 || toSlot <= 6 ? 'danger' : waited >= 6 || toSlot <= 24 ? 'amber' : 'neutral';
  return { waited, toSlot, tone };
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  booked: { label: 'Booked', tone: 'amber' },
  confirmed: { label: 'Paid · unassigned', tone: 'danger' },
  assigned: { label: 'Assigned', tone: 'info' },
  en_route: { label: 'On the way', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'primary' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
const BOARD_COLS = ['booked', 'confirmed', 'assigned', 'en_route', 'in_progress', 'completed', 'cancelled'] as const;
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })
  + ' · ' + new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
const canAssignOf = (b: Booking) => ['confirmed', 'assigned'].includes(b.status) || (b.status === 'booked' && b.pricingMode === 'quote');
const assignLabel = (b: Booking) => (b.serviceProviderId ? 'Reassign' : b.status === 'booked' ? 'Place callout' : 'Assign');
const human = (s: string | undefined) => (s ?? 'pending review').replace(/_/g, ' ');

const jobHref = (id: number) => `/dashboard/admin/operations/${id}`;

export default function AdminOperationsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [reliability, setReliability] = useState<Record<number, ReliabilityLedger>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignId, setAssignId] = useState<number | null>(null);
  const [spId, setSpId] = useState<number | ''>('');
  const [techId, setTechId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [assignErr, setAssignErr] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'table'>('board');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  // Clock for the age labels — stamped on every (re)load.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([
        apiGet<Booking[] | { data?: Booking[] }>('/bookings'),
        apiGet<Provider[]>('/bookings/providers'),
      ]);
      setBookings(Array.isArray(b) ? b : (b?.data ?? []));
      setProviders(p ?? []);
      setNow(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load operations');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      apiGet<ReliabilityLedger[]>('/admin/reliability?days=90')
        .then((rows) => setReliability(Object.fromEntries(rows.map((r) => [r.serviceProviderId, r]))))
        .catch(() => setReliability({}));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const providerName = useMemo(() => {
    const m = new Map(providers.map((p) => [p.id, p.businessName]));
    return (id: number | null) => (id ? m.get(id) ?? `Provider #${id}` : null);
  }, [providers]);


  const needsAssignment = bookings.filter((b) => b.status === 'confirmed' && !b.serviceProviderId);
  const needsCallout = bookings.filter((b) => b.status === 'booked' && b.pricingMode === 'quote' && !b.serviceProviderId);
  const needsPlacement = [...needsAssignment, ...needsCallout].sort(
    (a, b) => placementInfo(a, now).toSlot - placementInfo(b, now).toSlot,
  );
  const overdue = bookings.filter((b) => isOverdue(b, now));
  const inFlight = bookings.filter((b) => ['assigned', 'en_route', 'in_progress'].includes(b.status));
  const completed = bookings.filter((b) => b.status === 'completed');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return bookings;
    return bookings.filter((b) => [
      b.serviceName, `bk-${b.id}`, b.category, b.tenant?.user?.name, b.addressText, b.emirate,
      providerName(b.serviceProviderId), b.technicianName, STATUS[b.status]?.label,
    ].some((x) => (x ?? '').toLowerCase().includes(s)));
  }, [bookings, q, providerName]);

  const relTag = (id: number) => {
    const r = reliability[id];
    if (!r || r.standing === 'insufficient_data') return '';
    return ` · ${STANDING_UI[r.standing].label.toLowerCase()} · accept ${r.offers.acceptancePct ?? '—'}% · on-time ${r.arrivals.onTimePct ?? '—'}%`;
  };
  const chosenProvider = providers.find((p) => p.id === spId);
  const chosenTech = chosenProvider?.technicians.find((t) => t.id === techId);
  const chosenRel = spId ? reliability[Number(spId)] : undefined;
  const assignBooking = assignId != null ? bookings.find((b) => b.id === assignId) ?? null : null;
  const isCallout = assignBooking?.status === 'booked';
  const openBooking = openId != null ? bookings.find((b) => b.id === openId) ?? null : null;

  const openAssign = (id: number) => { setAssignId(id); setSpId(''); setTechId(''); setAssignErr(null); };
  const submitAssign = async () => {
    if (!assignId || !spId || (!isCallout && !techId)) return;
    setBusy(true);
    try {
      await apiPatch(`/bookings/${assignId}/assign`, isCallout ? { serviceProviderId: spId } : { serviceProviderId: spId, technicianId: techId });
      setAssignId(null);
      await load();
    } catch (e) {
      setAssignErr(e instanceof Error ? e.message : 'Could not assign');
    } finally { setBusy(false); }
  };

  const statusPill = (b: Booking) => {
    const st = STATUS[b.status] ?? STATUS.booked;
    return <Pill tone={st.tone}>{st.label}</Pill>;
  };

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Operations"
        title="Booking dispatch"
        lede="Place the jobs the auto-matcher couldn't — most time-critical first — and catch anything that's overdue."
        actions={<>
          <Btn onClick={() => { setLoading(true); void load(); }}>Refresh</Btn>
          <Btn variant="primary" href="/dashboard/admin/operations/pipelines">Pipeline boards</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Home services' },
        { label: 'Bookings', value: loading ? '…' : bookings.length },
      ]} />

      {error && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="bad" title="Couldn't load operations.">{error} <Btn size="xs" onClick={() => { setLoading(true); void load(); }}>Try again</Btn></Callout>
        </div>
      )}

      {!loading && (needsPlacement.length > 0 || overdue.length > 0) && (
        <Attn>
          {needsPlacement.length > 0 && <AttnCard tone="bad" n={needsPlacement.length} t="Need assignment" s="Paid jobs and quote callouts the matcher couldn't place" href="#needs-assignment" />}
          {overdue.length > 0 && <AttnCard tone="warn" n={overdue.length} t="Overdue" s="Slot passed, not completed or cancelled" href="#job-board" />}
        </Attn>
      )}

      <Kpis>
        <Kpi k="All bookings" v={loading ? '…' : bookings.length} />
        <Kpi k="Needs assignment" v={loading ? '…' : needsPlacement.length} d={`${needsAssignment.length} paid · ${needsCallout.length} callouts`} dark />
        <Kpi k="In flight" v={loading ? '…' : inFlight.length} d="Assigned · on the way · in progress" />
        <Kpi k="Overdue" v={loading ? '…' : overdue.length} d="Slot passed" />
        <Kpi k="Completed" v={loading ? '…' : completed.length} />
      </Kpis>

      <div id="needs-assignment" style={{ marginBottom: 14 }}>
        <Card title="Needs assignment" sub="Bookings the auto-matcher couldn't place — soonest slot first"
          right={<Pill tone={needsPlacement.length ? 'danger' : 'primary'}>{needsPlacement.length}</Pill>}>
          <div className="gx-tbl-scroll">
            <table className="gx-tbl">
              <thead><tr><th>Booking</th><th>Customer</th><th>When</th><th>Value</th><th>Waiting</th><th className="act">Action</th></tr></thead>
              {loading ? <SkeletonRows rows={3} cols={6} /> : error && !bookings.length ? <ErrorRow cols={6} onRetry={() => { setLoading(true); void load(); }} />
                : needsPlacement.length === 0 ? <EmptyRow cols={6} title="Every booking is placed." text="New unplaced bookings appear here as soon as the matcher gives up." />
                  : (
                    <tbody>
                      {needsPlacement.map((b) => {
                        const callout = b.status === 'booked';
                        const info = placementInfo(b, now);
                        return (
                          <tr key={b.id}>
                            <td className="strong">{b.serviceName ?? 'Service'} <span className="mono sub">BK-{b.id}</span>
                              {callout && <> <Pill tone="amber" dot={false}>Quote callout</Pill></>}</td>
                            <td>{b.tenant?.user?.name ?? 'Customer'}</td>
                            <td className="nowrap">{fmtWhen(b.scheduledAt)}</td>
                            <td className="num nowrap">{callout ? 'Quote on assessment' : fmtAed(b.totalAmount)}</td>
                            <td className="nowrap"><Pill tone={info.tone} title={`Waiting ${ageLabel(info.waited)} since booked`}>
                              {ageLabel(info.waited)} waiting{info.toSlot < 0 ? ' · slot passed' : info.toSlot <= 24 ? ` · slot in ${ageLabel(info.toSlot)}` : ''}
                            </Pill></td>
                            <td className="act"><span className="gx-btn-row">
                              <Btn size="sm" onClick={() => setOpenId(b.id)}>Open</Btn>
                              <Btn size="sm" variant="primary" onClick={() => openAssign(b.id)}>{callout ? 'Place callout' : 'Assign'}</Btn>
                            </span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  )}
            </table>
          </div>
        </Card>
      </div>

      <div id="job-board">
        <TableWrap toolbar={<>
          <Seg label="Job view" value={view} onChange={setView} options={[{ v: 'board', l: 'Board' }, { v: 'table', l: 'Table', n: filtered.length }]} />
          <SearchField value={q} onChange={setQ} placeholder="Search service, BK id, customer, area, provider" />
          <span className="sp" />
          {overdue.length > 0 && <Pill tone="danger" title="Slot passed, not completed or cancelled">{overdue.length} overdue</Pill>}
        </>}>
          {view === 'board' ? (
            loading ? <div className="gx-pad"><div className="gx-skel" style={{ height: 120 }} /></div> : (
              <div className="gx-pad">
                <Board>
                  {BOARD_COLS.map((s) => {
                    const col = filtered.filter((b) => b.status === s);
                    return (
                      <BoardCol key={s} title={STATUS[s].label} count={col.length}>
                        {col.map((b) => (
                          <BoardCard key={b.id} href={jobHref(b.id)}
                            t={<>{b.serviceName ?? 'Service'} <span className="mono">BK-{b.id}</span></>}
                            m={<>{b.tenant?.user?.name ?? 'Customer'} · {fmtWhen(b.scheduledAt)}<br />
                              {providerName(b.serviceProviderId) ?? 'Unassigned'}{b.technicianName ? ` · ${b.technicianName}` : ''}
                              {stageAge(b, now) !== '—' ? ` · ${stageAge(b, now)} in stage` : ''}</>}
                            tag={isOverdue(b, now) ? <Pill tone="danger">Overdue</Pill> : b.pricingMode === 'quote' ? <Pill tone="info" dot={false}>Quote</Pill> : undefined}
                            amt={b.pricingMode === 'quote' && b.totalAmount == null ? undefined : fmtAed(b.totalAmount)} />
                        ))}
                      </BoardCol>
                    );
                  })}
                </Board>
              </div>
            )
          ) : (
            <table className="gx-tbl">
              <thead><tr><th>Booking</th><th>Category</th><th>Customer</th><th>When</th><th>Status</th><th>In stage</th><th>Provider · Technician</th><th className="num">Value</th><th className="act">Actions</th></tr></thead>
              {loading ? <SkeletonRows cols={9} /> : error && !bookings.length ? <ErrorRow cols={9} onRetry={() => { setLoading(true); void load(); }} />
                : filtered.length === 0 ? <EmptyRow cols={9} title={bookings.length ? 'No bookings match' : 'No bookings yet'} text={bookings.length ? 'Clear the search to see every booking.' : 'Bookings appear here once customers book a service.'} />
                  : (
                    <tbody>
                      {filtered.map((b) => {
                        const pName = providerName(b.serviceProviderId);
                        return (
                          <tr key={b.id} className="click" onClick={() => setOpenId(b.id)}>
                            <td className="strong">{b.serviceName ?? 'Service'} <span className="mono sub">BK-{b.id}</span>
                              {b.addressText && <div className="sub">{b.emirate ? `${b.emirate} · ` : ''}{b.addressText}</div>}</td>
                            <td className="nowrap">{b.category ?? '—'}{b.pricingMode === 'quote' && <> <Pill tone="info" dot={false} title="Quote-priced job">Quote</Pill></>}</td>
                            <td>{b.tenant?.user?.name ?? '—'}</td>
                            <td className="nowrap">{fmtWhen(b.scheduledAt)}</td>
                            <td className="nowrap">{statusPill(b)}{isOverdue(b, now) && <> <Pill tone="danger" title="Slot passed, not completed">Overdue</Pill></>}</td>
                            <td className="nowrap">{stageAge(b, now)}</td>
                            <td>{pName ?? 'Unassigned'}<div className="sub">{b.technicianName ?? (b.serviceProviderId ? 'No technician' : '—')}</div></td>
                            <td className="num nowrap">{fmtAed(b.totalAmount)}{b.escrowStatus && <div className="sub">{b.escrowStatus}</div>}</td>
                            <td className="act" onClick={(e) => e.stopPropagation()}><span className="gx-btn-row">
                              <Btn size="sm" href={jobHref(b.id)}>Open</Btn>
                              {canAssignOf(b) && <Btn size="sm" onClick={() => openAssign(b.id)}>{assignLabel(b)}</Btn>}
                            </span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  )}
            </table>
          )}
        </TableWrap>
      </div>

      {/* Booking quick view */}
      <Drawer open={openBooking != null} onClose={() => setOpenId(null)}
        title={openBooking ? `${openBooking.serviceName ?? 'Service'} · BK-${openBooking.id}` : ''}
        sub={openBooking ? <>{statusPill(openBooking)}{isOverdue(openBooking, now) && <> <Pill tone="danger">Overdue</Pill></>}</> : undefined}
        footer={openBooking && <>
          <Btn href={jobHref(openBooking.id)} variant="primary">Open job</Btn>
          {canAssignOf(openBooking) && <Btn onClick={() => { const id = openBooking.id; setOpenId(null); openAssign(id); }}>{assignLabel(openBooking)}</Btn>}
        </>}>
        {openBooking && (
          <KV items={[
            { k: 'Customer', v: openBooking.tenant?.user?.name ?? '—' },
            { k: 'When', v: fmtWhen(openBooking.scheduledAt) },
            { k: 'Category', v: openBooking.category ?? '—' },
            { k: 'Pricing', v: openBooking.pricingMode === 'quote' ? 'Quote' : 'Fixed' },
            { k: 'Area', v: [openBooking.emirate, openBooking.addressText].filter(Boolean).join(' · ') || '—' },
            { k: 'In stage', v: stageAge(openBooking, now) },
            { k: 'Provider', v: providerName(openBooking.serviceProviderId) ?? 'Unassigned' },
            { k: 'Technician', v: openBooking.technicianName ?? (openBooking.serviceProviderId ? 'No technician' : '—') },
            { k: 'Value', v: openBooking.status === 'booked' && openBooking.pricingMode === 'quote' && openBooking.totalAmount == null ? 'Quote on assessment' : fmtAed(openBooking.totalAmount) },
            { k: 'Escrow', v: openBooking.escrowStatus ?? '—' },
          ]} />
        )}
      </Drawer>

      {/* Assign modal */}
      <Modal open={assignId != null} onClose={() => setAssignId(null)} title={isCallout ? 'Place a callout provider' : 'Assign a provider'}
        footer={<>
          <Btn onClick={() => setAssignId(null)}>Cancel</Btn>
          <Btn variant="primary" onClick={submitAssign} disabled={busy || !spId || (!isCallout && !techId)}>
            {busy ? (isCallout ? 'Placing…' : 'Assigning…') : (isCallout ? 'Place callout' : 'Assign')}
          </Btn>
        </>}>
        <p className="gx-hint" style={{ marginBottom: 12 }}>{isCallout
          ? `BK-${assignId} — the provider assesses the job and sends the customer a quote. A technician is chosen later, at quote approval.`
          : `BK-${assignId} — pick a provider and one of their technicians.`}</p>
        <Field label="Provider" htmlFor="op-sp">
          <select id="op-sp" className="gx-sel" value={spId} onChange={(e) => {
            const id = Number(e.target.value);
            setSpId(id);
            // SP-254: a solo operator IS the technician — one pick, not two.
            const p = providers.find((x) => x.id === id);
            const self = p?.solo ? (p.technicians.find((t) => t.isSelf) ?? p.technicians[0]) : undefined;
            setTechId(self ? self.id : '');
          }}>
            <option value="" disabled>Select a provider…</option>
            {/* A callout needs no technician, so tech-less providers are eligible; the paid path still requires one. */}
            {providers.filter((p) => isCallout || p.technicians.length > 0).map((p) => (
              <option key={p.id} value={p.id}>{p.businessName}{p.solo ? ' · solo' : ''}{p.jobReady ? '' : ' · not job-ready'}{p.compliant ? '' : ' · non-compliant'}{relTag(p.id)}</option>
            ))}
          </select>
        </Field>

        {!isCallout && chosenProvider?.solo ? (
          <Callout tone="info" title="Solo operator.">
            The job goes to <b>{chosenTech?.name ?? 'the operator'}</b> themselves; there is no crew to pick from.
            {chosenTech && chosenTech.assignable === false ? ` Not verified (${human(chosenTech.complianceStatus)}).` : ''}
          </Callout>
        ) : !isCallout && (
          <Field label="Technician" htmlFor="op-tech">
            <select id="op-tech" className="gx-sel" value={techId} onChange={(e) => setTechId(Number(e.target.value))} disabled={!chosenProvider}>
              <option value="" disabled>{chosenProvider ? 'Select a technician…' : 'Pick a provider first'}</option>
              {chosenProvider?.technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.assignable === false ? ` · not verified (${human(t.complianceStatus)})` : t.assignable === true ? ' · verified' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {!isCallout && chosenTech?.assignable === false && (
            <Callout tone="warn" title="Unverified technician.">
              This technician has not been verified by UpNow (compliance: {human(chosenTech.complianceStatus ?? 'pending_review')}). Once Gate 1 is enforced the API will refuse this assignment — verify them under KYC → Technicians first.
            </Callout>
          )}
          {chosenRel && chosenRel.standing !== 'insufficient_data' && (
            <Callout tone={chosenRel.standing === 'good' ? 'info' : 'warn'} title={`Reliability (90 d): ${STANDING_UI[chosenRel.standing].label}.`}>
              Acceptance {chosenRel.offers.acceptancePct ?? '—'}% · on-time {chosenRel.arrivals.onTimePct ?? '—'}% · passes {chosenRel.passes.used}/{chosenRel.passes.allowance} this month · SLA breaches {chosenRel.sla.total}
              {chosenRel.flags.length ? ` — ${chosenRel.flags.join('; ')}` : ''}
            </Callout>
          )}
          {chosenProvider && (!chosenProvider.jobReady || !chosenProvider.compliant) && (
            <Callout tone="warn" title="Heads up:">
              this provider is {[!chosenProvider.compliant && 'not compliant', !chosenProvider.jobReady && 'not job-ready'].filter(Boolean).join(' and ')}. Assign only as an ops override.
            </Callout>
          )}
          {assignErr && <Callout tone="bad" title="Could not assign.">{assignErr}</Callout>}
        </div>
      </Modal>
    </OsPage>
  );
}
