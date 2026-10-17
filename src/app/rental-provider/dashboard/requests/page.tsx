'use client';

/**
 * Demand › All demand — ONE inbox for everything a customer asked for:
 *   • Long-term leads — READ-ONLY from the real API (GET /api/leads, the same call the Leads page
 *     makes; nothing is written). Each row shows the stage, the age, a 15-minute first-reply clock
 *     while the lead is 'new' (MarketSpace demand.js SLA = 15) and "Open lead" → the existing
 *     lead page, where it is worked.
 *   • Short stays, venues, courts and yachts — the PREVIEW booking engine (no backend). These are
 *     actionable here: the right pane is the full booking record with the engine's buttons.
 *
 * "Put a clock on every customer intent" (reports/Short stay venue court booking flows.md): every
 * row has one deadline and one owner; the list is sorted by the clock that runs out first —
 * provider-owned timers (overdue → under 25% left → ok), then items waiting on the customer, then
 * the rest. Filters: source (All / Long-term leads / Short stays / Venues / Courts / Yachts),
 * channel (Form / Call / WhatsApp / Email), status and payment model. ?id=<booking id> or
 * ?id=L-<lead id> opens that row (links from the Today queue).
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Btn, Callout, Card, Evid, KV, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, PreviewPill, type Tone } from '@/components/os/kit';
import { BookingDetail, BookingDrawer } from '@/components/os/bookings/BookingDrawer';
import { BookingsPreview } from '@/components/os/bookings/DemoClock';
import {
  CALENDAR_HREF, DEMAND_STATES, ModelPill, PayModePill, SourcePill, StatePill, TimerChip, boardHref, byUrgency, fmtDT, guestsText,
  isDemand, urgencyKey, useIsNarrow, useOwn, whenText,
} from '@/components/os/bookings/shared';
import { HOUR_MS, MIN_MS, RULES, formatAED, formatDuration, modeOf, ms, respondHoursFor, sourceOf, timerOf } from '@/lib/os/bookings/engine';
import { useNow } from '@/lib/os/bookings/store';
import type { Booking, BookingModel, LeadSource, PaymentMode } from '@/lib/os/bookings/types';
import { STAGE_LABELS, leadDisplayName, type ApiLead } from '@/lib/leadJourney';

const RP = '/rental-provider/dashboard';
const LEAD_SLA_MS = RULES.enquiryFirstReplyMin * MIN_MS;

type Status = 'reply' | 'accept' | 'offers' | 'holds' | 'payment' | 'open';
const STATUS: { v: Status; l: string; test: (b: Booking) => boolean; lead: (x: ApiLead) => boolean }[] = [
  { v: 'reply', l: 'Needs reply', test: (b) => b.state === 'enquiry' && !!b.respondBy, lead: (x) => x.stage === 'new' },
  { v: 'accept', l: 'Requests to accept', test: (b) => b.state === 'requested', lead: () => false },
  { v: 'offers', l: 'Offers out', test: (b) => b.state === 'offer_sent', lead: () => false },
  { v: 'holds', l: 'Holds & provisional', test: (b) => b.state === 'held' || b.state === 'provisional', lead: () => false },
  { v: 'payment', l: 'Awaiting payment', test: (b) => b.state === 'awaiting_payment', lead: () => false },
  { v: 'open', l: 'All open', test: (b) => DEMAND_STATES.includes(b.state), lead: () => true },
];
type Source = 'all' | 'leads' | BookingModel;
const SOURCES: { v: Source; l: string }[] = [
  { v: 'all', l: 'All' }, { v: 'leads', l: 'Long-term leads' }, { v: 'shortstay', l: 'Short stays' }, { v: 'venue', l: 'Venues' }, { v: 'court', l: 'Courts' }, { v: 'charter', l: 'Yachts' },
];
const CHANNELS: { v: LeadSource | 'all'; l: string }[] = [
  { v: 'all', l: 'All channels' }, { v: 'form', l: 'Form' }, { v: 'call', l: 'Call' }, { v: 'whatsapp', l: 'WhatsApp' }, { v: 'email', l: 'Email' },
];
/** Long-term lead source → channel (null = walk-in, agent, portal listing sites… — shown under All channels only). */
function leadChannel(x: ApiLead): LeadSource | null {
  switch (x.source) {
    case 'phone': return 'call';
    case 'whatsapp': return 'whatsapp';
    case 'email': return 'email';
    case 'portal': return 'form';
    default: return null;
  }
}
const LEAD_SOURCE_LABEL: Record<string, string> = {
  walk_in: 'Walk-in', phone: 'Phone', whatsapp: 'WhatsApp', email: 'Email', referral: 'Referral', agent: 'Agent', property_finder: 'Property Finder',
  bayut: 'Bayut', dubizzle: 'Dubizzle', social_media: 'Social media', other: 'Other', portal: 'Marketplace',
};
const liveLead = (x: ApiLead) => x.stage !== 'converted' && x.stage !== 'rejected';
const leadKey = (x: ApiLead) => `L-${x.id}`;

/** The 15-minute first-reply clock on a 'new' lead (null for every other stage). */
function leadSla(x: ApiLead, now: number): { label: string; tone: Tone; overdue: boolean; due: number } | null {
  if (x.stage !== 'new') return null;
  const due = ms(x.createdAt) + LEAD_SLA_MS;
  if (!Number.isFinite(due)) return null;
  const left = due - now;
  if (left < 0) return { label: `Reply overdue ${formatDuration(-left)}`, tone: 'danger', overdue: true, due };
  return { label: `Reply within ${formatDuration(left)}`, tone: left < LEAD_SLA_MS * 0.25 ? 'amber' : 'info', overdue: false, due };
}
function leadUrgency(x: ApiLead, now: number): [number, number, number] {
  const s = leadSla(x, now);
  if (s) return [0, s.overdue ? 0 : s.tone === 'amber' ? 1 : 2, s.due];
  return [3, 0, ms(x.updatedAt)];
}

type Row = { kind: 'booking'; key: string; b: Booking } | { kind: 'lead'; key: string; x: ApiLead };

export default function RequestsPage() {
  return (
    <Suspense fallback={<OsPage><PageHead eyebrow="Demand" title="All demand" /></OsPage>}>
      <Inbox />
    </Suspense>
  );
}

/** How the provider answered: first provider event after the request was received. */
function firstResponse(b: Booking): { kind: 'enquiry' | 'requested'; receivedAt: number; deadline: number; repliedAt: number | null } | null {
  const opening = b.events.find((e) => ['enquiry', 'requested', 'held', 'confirmed'].includes(e.type));
  if (!opening || (opening.type !== 'enquiry' && opening.type !== 'requested')) return null;
  const receivedAt = ms(opening.at);
  const window = opening.type === 'enquiry' ? LEAD_SLA_MS : respondHoursFor(b.model, modeOf(b)) * HOUR_MS;
  const reply = b.events.find((e) => e.actor === 'provider' && ms(e.at) >= receivedAt);
  return { kind: opening.type, receivedAt, deadline: receivedAt + window, repliedAt: reply ? ms(reply.at) : null };
}

/** READ-ONLY: the long-term leads list, exactly as the Leads page loads it (GET /api/leads). */
function useLongTermLeads() {
  const [leads, setLeads] = useState<ApiLead[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/leads', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load long-term leads (${res.status})`);
        const data = await res.json();
        if (!cancelled) { setLeads(Array.isArray(data) ? data : []); setState('ok'); setError(null); }
      })
      .catch((e) => { if (!cancelled) { setState('error'); setError(e instanceof Error ? e.message : 'Could not load long-term leads'); } });
    return () => { cancelled = true; };
  }, [tick]);
  return { leads, state, error, reload: () => { setState('loading'); setTick((t) => t + 1); } };
}

function Inbox() {
  const { bookings, byId, listings } = useOwn();
  const lt = useLongTermLeads();
  const now = useNow(30_000);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const narrow = useIsNarrow();
  const urlId = params.get('id');
  const [status, setStatus] = useState<Status>('open');
  const [source, setSource] = useState<Source>('all');
  const [channel, setChannel] = useState<LeadSource | 'all'>('all');
  const [pay, setPay] = useState<PaymentMode | 'all'>('all');
  const [picked, setPicked] = useState<string | null>(null);

  const open = useMemo(() => bookings.filter(isDemand), [bookings]);
  const liveLeads = useMemo(() => lt.leads.filter(liveLead), [lt.leads]);

  const bookingOk = (b: Booking, st: Status, src: Source = source) =>
    STATUS.find((x) => x.v === st)!.test(b) && (src === 'all' || src === b.model) && (channel === 'all' || sourceOf(b) === channel) && (pay === 'all' || modeOf(b) === pay);
  const leadOk = (x: ApiLead, st: Status, src: Source = source) =>
    STATUS.find((s) => s.v === st)!.lead(x) && (src === 'all' || src === 'leads') && (channel === 'all' || leadChannel(x) === channel) && pay === 'all';

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [
      ...open.filter((b) => bookingOk(b, status)).map((b) => ({ kind: 'booking' as const, key: b.id, b })),
      ...liveLeads.filter((x) => leadOk(x, status)).map((x) => ({ kind: 'lead' as const, key: leadKey(x), x })),
    ];
    const key = (r: Row) => (r.kind === 'booking' ? urgencyKey(r.b, now) : leadUrgency(r.x, now));
    const cmpB = byUrgency(now);
    return out.sort((a, b) => {
      if (a.kind === 'booking' && b.kind === 'booking') return cmpB(a.b, b.b);
      const ka = key(a), kb = key(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.key.localeCompare(b.key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the filter helpers read the filter state listed here
  }, [open, liveLeads, status, source, channel, pay, now]);

  // Selection: ?id wins, then a click, then (wide screens) the most urgent row.
  const selectedKey = urlId ?? picked ?? (narrow ? null : rows[0]?.key ?? null);
  const selBooking = selectedKey && !selectedKey.startsWith('L-') ? bookings.find((b) => b.id === selectedKey) ?? null : null;
  const selLead = selectedKey?.startsWith('L-') ? lt.leads.find((x) => leadKey(x) === selectedKey) ?? null : null;
  const select = (key: string | null) => {
    setPicked(key);
    const q = new URLSearchParams(params.toString());
    if (key) q.set('id', key); else q.delete('id');
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
  };

  const kpis = useMemo(() => {
    const rs = bookings.map(firstResponse).filter((x): x is NonNullable<typeof x> => !!x);
    const delays = rs.filter((r) => r.repliedAt != null).map((r) => (r.repliedAt as number) - r.receivedAt).sort((a, b) => a - b);
    const median = delays.length ? (delays.length % 2 ? delays[(delays.length - 1) / 2] : (delays[delays.length / 2 - 1] + delays[delays.length / 2]) / 2) : null;
    const decided = rs.filter((r) => r.repliedAt != null || r.deadline < now);
    const inTime = decided.filter((r) => r.repliedAt != null && r.repliedAt <= r.deadline).length;
    const expiring = open.filter((b) => { const t = timerOf(b, now); return t && ms(t.deadline) >= now && ms(t.deadline) - now < 2 * HOUR_MS; }).length;
    const newLeads = liveLeads.filter((x) => x.stage === 'new');
    const leadsLate = newLeads.filter((x) => leadSla(x, now)?.overdue).length;
    const yourTurn = open.filter((b) => timerOf(b, now)?.whose === 'provider').length + newLeads.length;
    return { median, rate: decided.length ? Math.round((inTime / decided.length) * 100) : null, decided: decided.length, inTime, expiring, yourTurn, leadsLate };
  }, [bookings, open, liveLeads, now]);

  const statusCount = (st: Status) => open.filter((b) => bookingOk(b, st)).length + liveLeads.filter((x) => leadOk(x, st)).length;
  const sourceCount = (src: Source) => open.filter((b) => bookingOk(b, status, src)).length + liveLeads.filter((x) => leadOk(x, status, src)).length;

  return (
    <OsPage>
      <PageHead
        eyebrow="Demand"
        title="All demand"
        lede={`Every enquiry, lead and booking request in one place — long-term rental leads plus short stays, venues, courts and yachts — sorted by the clock that runs out first. First replies are due within ${RULES.enquiryFirstReplyMin} minutes. Calls, WhatsApp messages and emails from your listings land here too.`}
        actions={<>
          <Btn href={`${RP}/leads`}>Leads pipeline</Btn>
          <Btn href={CALENDAR_HREF}>Bookings calendar</Btn>
          <Btn href={boardHref('shortstay')}>Boards</Btn>
        </>}
      />
      <BookingsPreview />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Demand' },
        { label: 'Business', value: 'Coastline Hospitality' },
        { label: 'Long-term leads', value: lt.state === 'ok' ? `${liveLeads.length} open (live data, read-only)` : lt.state === 'loading' ? 'Loading…' : 'Not loaded' },
        { label: 'Bookings', value: <>{listings.length} listings · <PreviewPill /></> },
      ]} />

      <Kpis>
        <Kpi dark k="Open demand" v={open.length + liveLeads.length} d={`${kpis.yourTurn} waiting on you`} />
        <Kpi k="New leads past 15 min" v={lt.state === 'ok' ? kpis.leadsLate : '—'} d="Long-term leads still on stage New" />
        <Kpi k="Median first reply" v={kpis.median == null ? '—' : formatDuration(kpis.median)} d={`Bookings · ${kpis.rate == null ? 'no answers yet' : `${kpis.rate}% on time (${kpis.inTime}/${kpis.decided})`}`} />
        <Kpi k="Expiring < 2h" v={kpis.expiring} d="Bookings — act or chase" />
      </Kpis>

      {lt.state === 'error' && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="warn" title="Long-term leads could not be loaded.">
            {lt.error}. Bookings below still work. <Btn size="xs" onClick={lt.reload}>Try again</Btn>
          </Callout>
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
        <div className="gx-chips" role="group" aria-label="Filter by source">
          {SOURCES.map((x) => (
            <button key={x.v} type="button" className="gx-chip" aria-pressed={source === x.v} onClick={() => setSource(x.v)}>{x.l} · {sourceCount(x.v)}</button>
          ))}
        </div>
        <div className="gx-btn-row" style={{ justifyContent: 'space-between' }}>
          <div className="gx-chips" role="group" aria-label="Filter by status">
            {STATUS.map((f) => (
              <button key={f.v} type="button" className="gx-chip" aria-pressed={status === f.v} onClick={() => setStatus(f.v)}>{f.l} · {statusCount(f.v)}</button>
            ))}
          </div>
          <div className="gx-btn-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
              <span className="gx-lb" style={{ margin: 0 }}>Channel</span>
              <select className="gx-sel" style={{ width: 140 }} value={channel} onChange={(e) => setChannel(e.target.value as LeadSource | 'all')} aria-label="Filter by channel">
                {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
              <span className="gx-lb" style={{ margin: 0 }}>Payment</span>
              <select className="gx-sel" style={{ width: 140 }} value={pay} onChange={(e) => setPay(e.target.value as PaymentMode | 'all')} aria-label="Filter by payment model">
                <option value="all">All</option>
                <option value="platform">On UpNow</option>
                <option value="direct">Direct</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="gx-split">
        <div className="gx-split-l" role="listbox" aria-label="All demand">
          {rows.length === 0 ? (
            <div className="gx-empty"><b>Nothing here</b>No {STATUS.find((x) => x.v === status)!.l.toLowerCase()}{source === 'all' ? '' : ` in ${SOURCES.find((x) => x.v === source)!.l.toLowerCase()}`}{channel === 'all' ? '' : ` via ${CHANNELS.find((c) => c.v === channel)!.l}`}.{source === 'leads' && lt.state === 'loading' ? ' Loading leads…' : ''}</div>
          ) : rows.map((r) => r.kind === 'booking' ? (
            <BookingRow key={r.key} b={r.b} now={now} title={byId.get(r.b.listingId)?.title ?? r.b.listingId} when={whenText(r.b, byId.get(r.b.listingId))} selected={r.key === selectedKey} onClick={() => select(r.key)} />
          ) : (
            <LeadRow key={r.key} x={r.x} now={now} selected={r.key === selectedKey} onClick={() => select(r.key)} />
          ))}
        </div>
        {!narrow && (
          <div className="gx-split-r">
            {selBooking ? <BookingDetail booking={selBooking} /> : selLead ? <LeadSummary x={selLead} now={now} /> : (
              <Card pad><div className="gx-empty"><b>Select a row</b>Pick a lead or a booking to see the details and what to do next.</div></Card>
            )}
          </div>
        )}
      </div>

      {narrow && <BookingDrawer bookingId={selBooking?.id ?? null} onClose={() => select(null)} />}
      {narrow && selLead && (
        <div style={{ marginTop: 12 }}><LeadSummary x={selLead} now={now} onClose={() => select(null)} /></div>
      )}
    </OsPage>
  );
}

function BookingRow({ b, now, title, when, selected, onClick }: { b: Booking; now: number; title: string; when: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" role="option" className="gx-qitem" aria-selected={selected} onClick={onClick}>
      <span className="t" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0 }}>{b.customer.name}</span>
        <span style={{ fontWeight: 800 }}>{b.totalFils ? formatAED(b.totalFils) : '—'}</span>
      </span>
      <span className="s">{title}</span>
      <span className="s">{when} · {guestsText(b)}</span>
      <span className="f"><ModelPill model={b.model} /><StatePill b={b} /><PayModePill b={b} /><SourcePill b={b} /><TimerChip timer={timerOf(b, now)} /></span>
    </button>
  );
}

function LeadRow({ x, now, selected, onClick }: { x: ApiLead; now: number; selected: boolean; onClick: () => void }) {
  const sla = leadSla(x, now);
  const unit = x.unit ? `${x.unit.unitName || x.unit.unitNumber}${x.unit.property?.buildingName ? ` · ${x.unit.property.buildingName}` : ''}` : 'No unit assigned';
  return (
    <button type="button" role="option" className="gx-qitem" aria-selected={selected} onClick={onClick}>
      <span className="t" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0 }}>{leadDisplayName(x)}</span>
        <span className="mono" style={{ fontWeight: 600, fontSize: 11 }}>L-{x.id}</span>
      </span>
      <span className="s">{unit}</span>
      <span className="s">Received {formatDuration(now - ms(x.createdAt))} ago · {x.source ? LEAD_SOURCE_LABEL[x.source] ?? x.source : 'Source not recorded'}</span>
      <span className="f">
        <Pill tone="outline" dot={false}>Long-term</Pill>
        <Pill tone={x.stage === 'new' ? 'info' : 'neutral'}>{STAGE_LABELS[x.stage] ?? x.stage}</Pill>
        {sla && <Pill tone={sla.tone}>{sla.label} · Your turn</Pill>}
      </span>
    </button>
  );
}

function LeadSummary({ x, now, onClose }: { x: ApiLead; now: number; onClose?: () => void }) {
  const sla = leadSla(x, now);
  const href = `${RP}/leads/${x.id}`;
  return (
    <Card title={leadDisplayName(x)} sub={`L-${x.id} · long-term rental lead (live data — read-only here)`} right={onClose ? <Btn size="xs" variant="ghost" onClick={onClose}>Close</Btn> : undefined}>
      <div className="gx-pad" style={{ display: 'grid', gap: 12 }}>
        <div className="gx-btn-row">
          <Pill tone={x.stage === 'new' ? 'info' : 'neutral'}>{STAGE_LABELS[x.stage] ?? x.stage}</Pill>
          {sla && <Pill tone={sla.tone}>{sla.label}</Pill>}
        </div>
        <KV items={[
          { k: 'Unit', v: x.unit ? `${x.unit.unitName || x.unit.unitNumber}${x.unit.property?.buildingName ? ` · ${x.unit.property.buildingName}` : ''}` : 'No unit assigned' },
          { k: 'Source', v: x.source ? LEAD_SOURCE_LABEL[x.source] ?? x.source : 'Not recorded' },
          { k: 'Phone', v: x.leadPhone || '—' },
          { k: 'Email', v: x.leadEmail || '—' },
          { k: 'Received', v: `${fmtDT(x.createdAt)} (${formatDuration(now - ms(x.createdAt))} ago)` },
          { k: 'Last update', v: fmtDT(x.updatedAt) },
        ]} />
        {sla && <Evid tone={sla.overdue ? 'bad' : 'warn'}>New lead — the first reply is due within {RULES.enquiryFirstReplyMin} minutes of arrival. Open it to reply, schedule a viewing or move the stage.</Evid>}
        <div className="gx-btn-row">
          <Btn variant="primary" href={href}>Open lead</Btn>
          <Btn href={`${RP}/leads`}>Leads pipeline</Btn>
        </div>
      </div>
    </Card>
  );
}
