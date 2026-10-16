'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from '../toast';
import {
  ExternalLink, KeyRound, FileSignature, Receipt, Wrench, Scale, Building, BarChart3, Users, Inbox, Repeat, Plus, Ship, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto, useWork } from '../store';
import { COURTS, COURT_HOURS, STAY_UNITS, TODAY, VESSELS, WEEK_START } from '../seed';
import { addDays, dayDiff } from '../datasets';
import {
  Badge, Button, Card, Chips, Drawer, Field, Modal, ProtoNote, SectionTitle, SelectInput, Stat, StatusBadge, Stepper, Table, Td,
  TextInput, fmtAed, fmtDate, hourLabel,
} from '../ui';
import { ModuleHeader, PipelineBoard } from './common';
import { isBridged, toBridge } from '../nav';
import type { WorkItem } from '../types';

// ── Long-term leasing (production, unchanged) ─────────────────────────────
const PROD = [
  { label: 'Leads & viewings', href: '/rental-provider/dashboard/leads', icon: Inbox, body: 'Viewing → interested → documents → payment plan → cheques → converted' },
  { label: 'Leases', href: '/rental-provider/dashboard/orders', icon: KeyRound, body: 'One current lease per unit, ended leases, renewals' },
  { label: 'Contract lifecycle', href: '/rental-provider/dashboard/contracts', icon: FileSignature, body: 'Issue, sign, Ejari, utility, move-in, termination, settlement' },
  { label: 'Payments & deposits', href: '/rental-provider/dashboard/payments', icon: Receipt, body: 'PDC cheques, bounced-cheque replacement, deposits' },
  { label: 'Properties & units', href: '/rental-provider/dashboard/portfolio', icon: Building, body: 'Portfolio, unit pricing, listing submission' },
  { label: 'Maintenance, vendors & AMC', href: '/rental-provider/dashboard/maintenance', icon: Wrench, body: 'Requests, vendor roster, AMC contracts, inspections' },
  { label: 'Breaches & legal', href: '/rental-provider/dashboard/legal', icon: Scale, body: 'Breach notices, disputes, case files' },
  { label: 'Reports', href: '/rental-provider/dashboard/reports', icon: BarChart3, body: '29 lease, collections and portfolio reports' },
  { label: 'Manager portal', href: '/dashboard/manager', icon: Users, body: 'Same modules, scoped per landlord with 41 permission flags' },
];

const LANES = [
  { lane: 'Lead', stages: [['Interested', 3], ['KYC / documents', 2], ['Payment plan', 1], ['Payment confirmation', 1]] },
  { lane: 'New lease', stages: [['Signatures', 1], ['Ejari registration', 1], ['Utility', 0], ['Move-in', 1]] },
  { lane: 'Renewal', stages: [['Notice sent', 2], ['KYC', 1], ['Cheques / PDC', 1], ['Signatures', 0], ['Ejari', 1]] },
  { lane: 'Terminated', stages: [['Requested', 1], ['Move-out inspection', 1], ['Bills cleared', 0], ['Deposit settlement', 1]] },
] as const;

export function SpacesLeasing() {
  return (
    <div>
      <ModuleHeader v="spaces" title="Long-term leasing" model="Long-term lease"
        subtitle="Residential, commercial, industrial and land leases keep running on the existing production lease engine. In the target OS it simply sits inside the Spaces pack — no change to its screens, data or workflow." />
      <div className="mb-6"><ProtoNote kind="info">The cards below open the <strong>real production modules inside this shell</strong>, with real data (sign in as a rental provider). The prototype does not re-implement or modify them.</ProtoNote></div>
      <div className="mb-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PROD.map((p) => {
          const Icon = p.icon;
          return (
            <Link key={p.href} href={toBridge(p.href)} target={isBridged(p.href) ? undefined : '_blank'} className="group flex flex-col gap-1.5 rounded-[var(--r)] border border-[var(--g2)] bg-[var(--g1)] p-4 hover:border-[var(--g5)] hover:shadow-[var(--sh)]">
              <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-[var(--g7)]" aria-hidden /><Badge tone="green">Production</Badge></div>
              <div className="font-bold text-[var(--ink)] group-hover:text-[var(--g7)]">{p.label}</div>
              <div className="text-[13px] text-[var(--ink2)]">{p.body}</div>
              <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--g7)]">{isBridged(p.href) ? 'Open inside UpNow OS' : <>Manager portal (separate login) <ExternalLink className="h-3 w-3" aria-hidden /></>}</span>
            </Link>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionTitle right={<Badge tone="amber">Illustrative counts</Badge>}>Lease operations board (existing lanes)</SectionTitle>
          <div className="flex flex-col gap-3">
            {LANES.map((l) => (
              <div key={l.lane}>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[var(--ink3)]">{l.lane}</div>
                <div className="flex flex-wrap gap-1.5">
                  {l.stages.map(([s, n]) => (
                    <span key={s} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kc)] px-2.5 py-1 text-[12.5px]">{s}<span className="rounded bg-white px-1.5 font-bold">{n}</span></span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle>Why leases are not bookings</SectionTitle>
          <ul className="flex flex-col gap-2 text-[13.5px] text-[var(--ink2)]">
            {[
              'A lease is a registered legal tenancy (Ejari, RERA rules), not a calendar slot.',
              'Rent is a 1–12 cheque PDC schedule with bounce and replacement handling, not a checkout.',
              'KYC covers every occupant; renewal creates a child contract; termination needs notice and settlement.',
              'Availability is a lease boundary (vacant from / let until), so the unit cannot take nightly stays while let.',
              'Merging it with short-term booking would put the most-used production flow at risk.',
            ].map((t) => <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g6)]" aria-hidden />{t}</li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ── Portfolio: assets with an operating mode ──────────────────────────────
type Mode = 'Long-term lease' | 'Short stay' | 'Venue' | 'Courts' | 'Charter';
interface Asset { id: string; name: string; type: string; mode: Mode; status: string; vacant: boolean }
const ASSETS: Asset[] = [
  { id: 'A1', name: 'Marina Gate 1 · Unit 1804', type: '2BR apartment', mode: 'Long-term lease', status: 'Vacant from 1 Nov', vacant: true },
  { id: 'A2', name: 'Bloom Towers · Unit 911', type: '1BR apartment', mode: 'Long-term lease', status: 'Let until 30 Apr 2027', vacant: false },
  { id: 'A3', name: 'Bay Square 7 · Office 402', type: 'Fitted office', mode: 'Long-term lease', status: 'Vacant', vacant: true },
  { id: 'A4', name: 'Al Quoz WH-3', type: 'Warehouse', mode: 'Long-term lease', status: 'Let until 31 Dec 2026', vacant: false },
  { id: 'A5', name: 'Sadaf 4 · Studio 2203', type: 'Studio', mode: 'Short stay', status: '78% booked next 30 days', vacant: true },
  { id: 'A6', name: 'Marina Gate 2 · 1BR 905', type: '1BR apartment', mode: 'Short stay', status: '64% booked next 30 days', vacant: true },
  { id: 'A7', name: 'Jumeirah Villa 12', type: '3BR villa', mode: 'Short stay', status: 'Awaiting DTCM permit', vacant: true },
  { id: 'A8', name: 'Bay Square 7 · Rooftop', type: 'Rooftop terrace · 180 guests', mode: 'Venue', status: '3 events booked', vacant: true },
  { id: 'A9', name: 'Marina Sports Club · Courts 1–4', type: '4 covered padel courts', mode: 'Courts', status: '58% utilised today', vacant: true },
  ...VESSELS.map((v, i) => ({ id: `V${i}`, name: v.name, type: `${v.type} · ${v.capacity} guests`, mode: 'Charter' as Mode, status: v.crew, vacant: true })),
];

export function SpacesPortfolio() {
  const [mf, setMf] = useState<'all' | Mode>('all');
  const [assets, setAssets] = useState(ASSETS);
  const [switching, setSwitching] = useState<Asset | null>(null);
  const rows = assets.filter((a) => mf === 'all' || a.mode === mf);
  const modes: Mode[] = ['Long-term lease', 'Short stay', 'Venue', 'Courts', 'Charter'];
  return (
    <div>
      <ModuleHeader v="spaces" title="Portfolio" subtitle="Every asset this business operates in Spaces. An asset has one operating mode for a given period; long-term units remain managed by the production Properties & Units module." />
      <div className="mb-4"><Chips value={mf} onChange={setMf} items={[{ id: 'all', label: `All (${assets.length})` }, ...modes.map((m) => ({ id: m, label: `${m} (${assets.filter((a) => a.mode === m).length})` }))]} /></div>
      <Table head={['Asset', 'Type', 'Operating mode', 'Status', '']}>
        {rows.map((a) => (
          <tr key={a.id}>
            <Td className="font-semibold">{a.name}</Td>
            <Td className="text-[var(--ink2)]">{a.type}</Td>
            <Td><Badge tone={a.mode === 'Long-term lease' ? 'green' : a.mode === 'Short stay' ? 'violet' : a.mode === 'Charter' ? 'blue' : 'amber'}>{a.mode}</Badge></Td>
            <Td className="text-[13px]">{a.status}</Td>
            <Td>
              {(a.mode === 'Long-term lease' || a.mode === 'Short stay') && (
                <Button size="sm" variant="secondary" onClick={() => setSwitching(a)}>Change mode</Button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      <Modal open={!!switching} onClose={() => setSwitching(null)} title="Change operating mode" subtitle={switching?.name}
        footer={switching && (switching.vacant ? (
          <><Button variant="secondary" onClick={() => setSwitching(null)}>Cancel</Button>
            <Button onClick={() => {
              const to: Mode = switching.mode === 'Long-term lease' ? 'Short stay' : 'Long-term lease';
              setAssets(assets.map((x) => (x.id === switching.id ? { ...x, mode: to, status: to === 'Short stay' ? 'Calendar open — needs DTCM permit per unit' : 'Ready to list for lease' } : x)));
              toast.success(`${switching.name} switched to ${to}`, { description: 'Simulated — prototype data only' });
              setSwitching(null);
            }}>Switch to {switching.mode === 'Long-term lease' ? 'short stay' : 'long-term lease'}</Button></>
        ) : <Button variant="secondary" onClick={() => setSwitching(null)}>Close</Button>)}>
        {switching && (switching.vacant
          ? <p className="text-sm text-[var(--ink2)]">The unit is vacant, so it can change mode. Short stays need a DTCM holiday home permit for this unit before its listing can go live.</p>
          : <ProtoNote kind="info">This unit is under an active lease ({switching.status}). It cannot take nightly stays or change mode until the lease ends — lease occupancy always wins over short-stay availability.</ProtoNote>)}
      </Modal>
    </div>
  );
}

// ── Holiday stays: nightly availability timeline ──────────────────────────
const DAYS = 14;

export function SpacesStays() {
  const items = useWork('stays');
  const { patch, add, nextId, context } = useProto();
  const [block, setBlock] = useState(false);
  const [bu, setBu] = useState(STAY_UNITS[0].id);
  const [bd, setBd] = useState('2026-10-20');
  const [bn, setBn] = useState(2);

  const overlaps = (w: WorkItem) => items.some((o) => o.id !== w.id && o.meta.unit === w.meta.unit && ['confirmed', 'checked_in', 'blocked'].includes(o.stage)
    && dayDiff(o.date!, w.date!) < Number(o.meta.nights) && dayDiff(w.date!, o.date!) < Number(w.meta.nights));

  function confirm(w: WorkItem) {
    if (overlaps(w)) { toast.error('Dates overlap an existing stay or block', { description: 'Availability check (simulated) prevented a double booking.' }); return; }
    patch('work', w.id, { stage: 'confirmed' }, 'Stay confirmed');
  }

  const color: Record<string, string> = { requested: 'var(--amber)', confirmed: 'var(--g6)', checked_in: 'var(--g9)', checked_out: '#65716a', blocked: 'var(--line2)', cancelled: 'transparent' };
  const booked = items.filter((w) => ['confirmed', 'checked_in', 'checked_out'].includes(w.stage)).reduce((a, w) => a + Number(w.meta.nights), 0);

  return (
    <div>
      <ModuleHeader v="spaces" title="Holiday stays" model="Nightly stay"
        subtitle="Nightly availability per unit. Requests are held until the host confirms; confirmation runs an overlap check so the same night is never sold twice."
        actions={<Button variant="secondary" onClick={() => setBlock(true)}><Plus className="h-4 w-4" aria-hidden />Block dates</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Units on short stay" value={STAY_UNITS.length} sub="DTCM permit HH-55120 expires 20 Nov" tone="warn" />
        <Stat label="Nights booked (14 days)" value={booked} sub={`of ${STAY_UNITS.length * DAYS} available`} />
        <Stat label="Pending requests" value={items.filter((w) => w.stage === 'requested').length} sub="Respond within 24h" />
        <Stat label="In house today" value={items.filter((w) => w.stage === 'checked_in').length} sub="Guests checked in" />
      </div>
      <Card className="mb-5 overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid" style={{ gridTemplateColumns: `200px repeat(${DAYS}, 1fr)` }}>
            <div />
            {Array.from({ length: DAYS }).map((_, i) => {
              const d = addDays(WEEK_START, i);
              return <div key={d} className={cn('pb-2 text-center text-[11px] font-semibold', d === TODAY ? 'text-[var(--g7)]' : 'text-[var(--ink3)]')}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i % 7]}<br />{Number(d.slice(8))}</div>;
            })}
            {STAY_UNITS.map((u) => (
              <div key={u.id} className="contents">
                <div className="flex flex-col justify-center border-t border-[#eef0ef] py-3 pr-2 text-[13px] font-semibold leading-tight">{u.name}<span className="mt-0.5 text-xs font-normal text-[var(--ink3)]">{fmtAed(u.rate)} / night</span></div>
                <div className="relative border-t border-[#eef0ef]" style={{ gridColumn: `span ${DAYS}` }}>
                  <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
                    {Array.from({ length: DAYS }).map((_, i) => <div key={i} className={cn('border-l border-[var(--kc)]', addDays(WEEK_START, i) === TODAY && 'bg-[var(--g1)]')} />)}
                  </div>
                  {items.filter((w) => w.meta.unit === u.id && w.stage !== 'cancelled').map((w) => {
                    const start = Math.max(0, dayDiff(WEEK_START, w.date!));
                    const end = Math.min(DAYS, dayDiff(WEEK_START, w.date!) + Number(w.meta.nights));
                    if (end <= 0 || start >= DAYS) return null;
                    return (
                      <div key={w.id} title={`${w.customer} · ${w.title} · ${w.stage}`}
                        className="absolute top-2 flex h-7 items-center overflow-hidden rounded-md px-2 text-[11px] font-semibold text-white"
                        style={{ left: `calc(${(start / DAYS) * 100}% + 2px)`, width: `calc(${((end - start) / DAYS) * 100}% - 4px)`, background: color[w.stage] ?? '#65716a', color: w.stage === 'blocked' ? 'var(--ink2)' : '#fff' }}>
                        <span className="truncate">{w.stage === 'blocked' ? 'Owner block' : w.customer}</span>
                      </div>
                    );
                  })}
                  <div className="h-11" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--ink2)]">
            {[['Requested', 'var(--amber)'], ['Confirmed', 'var(--g6)'], ['Checked in', 'var(--g9)'], ['Checked out', '#65716a'], ['Blocked', 'var(--line2)']].map(([l, c]) => (
              <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: c }} />{l}</span>
            ))}
          </div>
        </div>
      </Card>
      <Table head={['Reservation', 'Guest', 'Unit', 'Check-in', 'Nights', 'Total', 'Status', '']}>
        {items.filter((w) => w.stage !== 'blocked').map((w) => (
          <tr key={w.id}>
            <Td className="font-semibold">{w.id}</Td>
            <Td>{w.customer}<div className="text-xs text-[var(--ink3)]">{w.meta.guests ?? 2} guests</div></Td>
            <Td className="text-[13px]">{STAY_UNITS.find((u) => u.id === w.meta.unit)?.name}</Td>
            <Td className="whitespace-nowrap">{fmtDate(w.date)}</Td>
            <Td>{w.meta.nights}</Td>
            <Td className="font-semibold">{w.amount ? fmtAed(w.amount) : '—'}</Td>
            <Td><StatusBadge status={w.stage} /></Td>
            <Td>
              <div className="flex justify-end gap-1.5">
                {w.stage === 'requested' && <><Button size="sm" variant="subtle" onClick={() => confirm(w)}>Confirm</Button><Button size="sm" variant="ghost" onClick={() => patch('work', w.id, { stage: 'cancelled' }, 'Stay request declined')}>Decline</Button></>}
                {w.stage === 'confirmed' && <Button size="sm" variant="subtle" onClick={() => patch('work', w.id, { stage: 'checked_in' }, 'Guest checked in')}>Check in</Button>}
                {w.stage === 'checked_in' && <Button size="sm" variant="subtle" onClick={() => patch('work', w.id, { stage: 'checked_out' }, 'Guest checked out')}>Check out</Button>}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      <Modal open={block} onClose={() => setBlock(false)} title="Block dates" subtitle="Owner use, maintenance or deep clean"
        footer={<><Button variant="secondary" onClick={() => setBlock(false)}>Cancel</Button><Button onClick={() => {
          const w: WorkItem = { id: nextId('BL'), orgId: context, dataset: 'stays', title: 'Blocked', customer: 'Owner block', stage: 'blocked', date: bd, meta: { unit: bu, nights: bn } };
          if (overlaps(w)) { toast.error('Those dates overlap an existing stay'); return; }
          add('work', w, 'Dates blocked'); setBlock(false);
        }}>Block</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Unit"><SelectInput value={bu} onChange={(e) => setBu(e.target.value)} options={STAY_UNITS.map((u) => ({ value: u.id, label: u.name }))} /></Field>
          <Field label="From"><TextInput type="date" value={bd} onChange={(e) => setBd(e.target.value)} /></Field>
          <Field label="Nights"><TextInput type="number" min={1} value={bn} onChange={(e) => setBn(Math.max(1, Number(e.target.value)))} /></Field>
        </div>
      </Modal>
    </div>
  );
}

// ── Venues: quoted event pipeline ─────────────────────────────────────────
export function SpacesVenues() {
  const { patch } = useProto();
  const [quoteFor, setQuoteFor] = useState<WorkItem | null>(null);
  const [hours, setHours] = useState(4);
  const [rate, setRate] = useState(1800);
  const [guests, setGuests] = useState(120);
  const [catering, setCatering] = useState(150);
  const total = hours * rate + guests * catering;

  return (
    <div>
      <ModuleHeader v="spaces" title="Venues & events" model="Quoted event booking"
        subtitle="Events are quoted, not instantly booked: enquiry → site visit → quote → deposit → event day. The venue calendar is held only once a deposit is received." />
      <PipelineBoard
        dataset="venue_events"
        stages={[{ id: 'enquiry', label: 'Enquiry' }, { id: 'site_visit', label: 'Site visit' }, { id: 'quote_sent', label: 'Quote sent' }, { id: 'deposit_paid', label: 'Deposit paid' }, { id: 'completed', label: 'Event done' }]}
        next={{
          enquiry: { to: 'site_visit', label: 'Book site visit', msg: 'Site visit booked' },
          quote_sent: { to: 'deposit_paid', label: 'Record 30% deposit', msg: 'Deposit recorded (simulated)' },
          deposit_paid: { to: 'completed', label: 'Mark event done', msg: 'Event completed' },
        }}
        custom={(w) => w.stage === 'site_visit' ? <Button size="sm" variant="subtle" onClick={() => { setGuests(120); setQuoteFor(w); }}>Build quote</Button> : null}
        exit={{ from: ['enquiry', 'site_visit', 'quote_sent'], to: 'cancelled', label: 'Lost', msg: 'Event enquiry marked lost' }}
        body={(w) => <div className="mt-1 text-xs text-[var(--ink3)]">{w.meta.venue} · {w.meta.slot}</div>}
      />
      <Modal open={!!quoteFor} onClose={() => setQuoteFor(null)} title="Build event quote" subtitle={quoteFor ? `${quoteFor.customer} · ${quoteFor.title}` : ''}
        footer={<><Button variant="secondary" onClick={() => setQuoteFor(null)}>Cancel</Button><Button onClick={() => { patch('work', quoteFor!.id, { stage: 'quote_sent', amount: total }, `Quote sent · ${fmtAed(total)}`); setQuoteFor(null); }}>Send quote</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hours"><TextInput type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></Field>
          <Field label="Hire rate (AED / hour)"><TextInput type="number" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></Field>
          <Field label="Guests"><TextInput type="number" value={guests} onChange={(e) => setGuests(Number(e.target.value))} /></Field>
          <Field label="Catering (AED / head)"><SelectInput value={String(catering)} onChange={(e) => setCatering(Number(e.target.value))} options={[{ value: '0', label: 'External caterer (0)' }, { value: '150', label: 'Canapés (150)' }, { value: '250', label: 'Seated dinner (250)' }]} /></Field>
        </div>
        <div className="mt-4 rounded-xl bg-[var(--bg)] p-3 text-sm">
          <div className="flex justify-between"><span>Venue hire</span><span>{fmtAed(hours * rate)}</span></div>
          <div className="flex justify-between"><span>Catering</span><span>{fmtAed(guests * catering)}</span></div>
          <div className="mt-1 flex justify-between border-t border-[var(--line)] pt-1 font-bold"><span>Total</span><span>{fmtAed(total)}</span></div>
          <div className="flex justify-between text-[var(--ink3)]"><span>Deposit to confirm (30%)</span><span>{fmtAed(Math.round(total * 0.3))}</span></div>
        </div>
      </Modal>
    </div>
  );
}

// ── Courts: hourly slot grid ──────────────────────────────────────────────
export function SpacesCourts() {
  const items = useWork('courts').filter((w) => w.date === TODAY && w.stage !== 'cancelled');
  const { add, patch, nextId, context } = useProto();
  const [newSlot, setNewSlot] = useState<{ court: string; hour: number } | null>(null);
  const [sel, setSel] = useState<WorkItem | null>(null);
  const [name, setName] = useState('');
  const [recurring, setRecurring] = useState('One-off');
  const [hold, setHold] = useState(false);
  const total = COURTS.length * COURT_HOURS.length;

  return (
    <div>
      <ModuleHeader v="spaces" title="Courts" model="Time-slot reservation"
        subtitle="Hourly slots per court for Marina Sports Club. Click a free slot to book, or a booked slot to manage it. Weekly recurring bookings repeat automatically." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={fmtDate(TODAY)} sub="Thursday" />
        <Stat label="Slots booked" value={`${items.length}/${total}`} sub={`${Math.round((items.length / total) * 100)}% utilisation`} />
        <Stat label="Peak (18:00–22:00)" value={`${items.filter((w) => Number(w.meta.hour) >= 18).length}/${COURTS.length * 5}`} sub="Evening slots" />
        <Stat label="Holds expiring" value={items.filter((w) => w.stage === 'held').length} sub="Released after 15 min if unpaid" tone="warn" />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-1 text-sm">
          <thead><tr><th className="w-16" />{COURTS.map((c) => <th key={c} className="pb-1 text-left text-xs font-bold text-[var(--ink3)]">{c}</th>)}</tr></thead>
          <tbody>
            {COURT_HOURS.map((h) => (
              <tr key={h}>
                <td className="pr-2 text-right text-xs font-semibold tabular-nums text-[var(--ink3)]">{hourLabel(h)}</td>
                {COURTS.map((c) => {
                  const b = items.find((w) => w.meta.court === c && Number(w.meta.hour) === h);
                  return (
                    <td key={c}>
                      {b ? (
                        <button type="button" onClick={() => setSel(b)} className={cn('flex h-11 w-full flex-col justify-center rounded-lg px-2 text-left text-[12px]', b.stage === 'held' ? 'bg-[#fbf0dc] text-[#8a5a14] ring-1 ring-[#efdcb4]' : 'bg-[var(--g1)] text-[var(--g9)]')}>
                          <span className="flex items-center gap-1 truncate font-semibold">{b.meta.recurring === 'Weekly' && <Repeat className="h-3 w-3 shrink-0" aria-label="Weekly" />}{b.customer}</span>
                          <span className="truncate text-[11px] opacity-75">{b.stage === 'held' ? 'Held · awaiting payment' : b.title}</span>
                        </button>
                      ) : (
                        <button type="button" aria-label={`Book ${c} at ${hourLabel(h)}`} onClick={() => { setName(''); setRecurring('One-off'); setHold(false); setNewSlot({ court: c, hour: h }); }}
                          className="h-11 w-full rounded-lg border border-dashed border-[var(--line2)] text-xs text-[#8a958e] hover:border-[var(--g6)] hover:bg-[var(--g1)] hover:text-[var(--g7)]">Free</button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Modal open={!!newSlot} onClose={() => setNewSlot(null)} title="Book court" subtitle={newSlot ? `${newSlot.court} · ${hourLabel(newSlot.hour)} – ${hourLabel(newSlot.hour + 1)} · ${fmtAed(240)}` : ''}
        footer={<><Button variant="secondary" onClick={() => setNewSlot(null)}>Cancel</Button><Button disabled={!name} onClick={() => {
          add('work', { id: nextId('CB'), orgId: context, dataset: 'courts', title: 'Padel · 4 players', customer: name, stage: hold ? 'held' : 'confirmed', date: TODAY, amount: 240, meta: { court: newSlot!.court, hour: newSlot!.hour, recurring } }, hold ? 'Slot held for 15 minutes' : 'Court booked');
          setNewSlot(null);
        }}>{hold ? 'Hold slot' : 'Confirm booking'}</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Customer"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name or member" /></Field>
          <Field label="Repeat"><SelectInput value={recurring} onChange={(e) => setRecurring(e.target.value)} options={['One-off', 'Weekly']} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />Hold for 15 minutes until paid (customer self-checkout)</label>
          <ProtoNote>In production the server must lock the slot to prevent two people booking the same court at the same time.</ProtoNote>
        </div>
      </Modal>
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.meta.court} · ${hourLabel(Number(sel.meta.hour))}` : ''} subtitle={sel?.customer}
        footer={sel && <>
          <Button variant="danger" size="sm" onClick={() => { patch('work', sel.id, { stage: 'cancelled' }, 'Court booking cancelled'); setSel(null); }}>Cancel booking</Button>
          {sel.stage === 'held' && <Button size="sm" onClick={() => { patch('work', sel.id, { stage: 'confirmed' }, 'Payment received — slot confirmed'); setSel(null); }}>Mark paid & confirm</Button>}
        </>}>
        {sel && (
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-[var(--ink3)]">Status</dt><dd><StatusBadge status={sel.stage === 'held' ? 'held_slot' : sel.stage} /></dd>
            <dt className="text-[var(--ink3)]">Booking</dt><dd>{sel.title}</dd>
            <dt className="text-[var(--ink3)]">Repeat</dt><dd>{sel.meta.recurring}</dd>
            <dt className="text-[var(--ink3)]">Price</dt><dd>{fmtAed(240)} / hour</dd>
          </dl>
        )}
      </Drawer>
    </div>
  );
}

// ── Yacht charters ────────────────────────────────────────────────────────
export function SpacesCharters() {
  const items = useWork('charters');
  const { patch } = useProto();
  const [manifestFor, setManifestFor] = useState<WorkItem | null>(null);
  const [settleFor, setSettleFor] = useState<WorkItem | null>(null);
  const [extras, setExtras] = useState(650);
  const steps = ['Enquiry', 'Deposit', 'Guest manifest', 'Trip', 'Settlement'];
  const idx: Record<string, number> = { enquiry: 0, deposit_paid: 1, manifest_complete: 2, completed: 3, settled: 4 };

  return (
    <div>
      <ModuleHeader v="spaces" title="Yacht charters" model="Charter"
        subtitle="A charter needs a vessel and a crew, a deposit, a complete guest manifest before departure, and a settlement for extras after the trip." />
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {VESSELS.map((v) => {
          const nextTrip = items.filter((w) => w.meta.vessel === v.name && ['deposit_paid', 'manifest_complete', 'enquiry'].includes(w.stage)).sort((a, b) => a.date!.localeCompare(b.date!))[0];
          return (
            <Card key={v.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 font-bold"><Ship className="h-4 w-4 text-[#1f5a8c]" aria-hidden />{v.name}</div>
              <div className="text-xs text-[var(--ink3)]">{v.type} · up to {v.capacity} guests · {fmtAed(v.rate)}/hour</div>
              <div className="text-xs text-[var(--ink3)]">Crew: {v.crew}</div>
              <div className="mt-1 text-[13px]">{nextTrip ? <>Next: <strong>{fmtDate(nextTrip.date)}</strong> · {nextTrip.customer}</> : <span className="text-[var(--ink3)]">No upcoming trips</span>}</div>
            </Card>
          );
        })}
      </div>
      <Table head={['Charter', 'Vessel', 'Date', 'Manifest', 'Value', 'Progress', '']}>
        {items.map((w) => (
          <tr key={w.id}>
            <Td><div className="font-semibold">{w.title}</div><div className="text-xs text-[var(--ink3)]">{w.customer}</div></Td>
            <Td>{w.meta.vessel}</Td>
            <Td className="whitespace-nowrap">{fmtDate(w.date)} · {w.time}</Td>
            <Td><span className={cn('font-semibold', Number(w.meta.manifest) < Number(w.meta.guests) ? 'text-[#8a5a14]' : 'text-[var(--g7)]')}>{w.meta.manifest}/{w.meta.guests}</span></Td>
            <Td className="font-semibold">{w.amount ? fmtAed(w.amount) : '—'}</Td>
            <Td className="min-w-[280px]"><Stepper steps={steps} current={idx[w.stage] ?? 0} /></Td>
            <Td>
              {w.stage === 'enquiry' && <Button size="sm" variant="subtle" onClick={() => patch('work', w.id, { stage: 'deposit_paid' }, 'Charter deposit recorded (simulated)')}>Record deposit</Button>}
              {w.stage === 'deposit_paid' && <Button size="sm" variant="subtle" onClick={() => setManifestFor(w)}>Manifest</Button>}
              {w.stage === 'manifest_complete' && <Button size="sm" variant="subtle" onClick={() => patch('work', w.id, { stage: 'completed' }, 'Trip completed')}>Trip done</Button>}
              {w.stage === 'completed' && <Button size="sm" variant="subtle" onClick={() => { setExtras(650); setSettleFor(w); }}>Settle</Button>}
            </Td>
          </tr>
        ))}
      </Table>
      <Modal open={!!manifestFor} onClose={() => setManifestFor(null)} title="Guest manifest" subtitle={manifestFor ? `${manifestFor.meta.vessel} · ${fmtDate(manifestFor.date)} · ${manifestFor.meta.guests} guests` : ''}
        footer={manifestFor && <><Button variant="secondary" onClick={() => setManifestFor(null)}>Close</Button>
          <Button onClick={() => { patch('work', manifestFor.id, { stage: 'manifest_complete', meta: { ...manifestFor.meta, manifest: manifestFor.meta.guests } }, 'Manifest complete'); setManifestFor(null); }}>Mark all guests received</Button></>}>
        {manifestFor && (
          <div className="flex flex-col gap-3 text-sm">
            <p>{manifestFor.meta.manifest} of {manifestFor.meta.guests} guests have submitted name and ID. Departure is blocked until the manifest is complete.</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {Array.from({ length: Number(manifestFor.meta.guests) }).map((_, i) => (
                <li key={i} className={cn('rounded-lg px-2.5 py-1.5', i < Number(manifestFor.meta.manifest) ? 'bg-[var(--g1)] text-[var(--g7)]' : 'bg-[var(--bg)] text-[#8a958e]')}>Guest {i + 1} {i < Number(manifestFor.meta.manifest) ? '· ID received' : '· pending'}</li>
              ))}
            </ul>
            <ProtoNote>Guest IDs are personal data; the manifest would be shared with the captain and the maritime authority only.</ProtoNote>
          </div>
        )}
      </Modal>
      <Modal open={!!settleFor} onClose={() => setSettleFor(null)} title="Charter settlement" subtitle={settleFor?.title}
        footer={settleFor && <><Button variant="secondary" onClick={() => setSettleFor(null)}>Cancel</Button><Button onClick={() => { patch('work', settleFor.id, { stage: 'settled' }, 'Charter settled'); setSettleFor(null); }}>Settle</Button></>}>
        {settleFor && (
          <div className="flex flex-col gap-3 text-sm">
            <Field label="Extras (fuel surcharge, catering, overtime) AED"><TextInput type="number" value={extras} onChange={(e) => setExtras(Number(e.target.value))} /></Field>
            <div className="rounded-xl bg-[var(--bg)] p-3">
              <div className="flex justify-between"><span>Charter</span><span>{fmtAed(settleFor.amount ?? 0)}</span></div>
              <div className="flex justify-between"><span>Extras</span><span>{fmtAed(extras)}</span></div>
              <div className="flex justify-between text-[var(--ink3)]"><span>Deposit held</span><span>−{fmtAed(3000)}</span></div>
              <div className="mt-1 flex justify-between border-t border-[var(--line)] pt-1 font-bold"><span>Balance due</span><span>{fmtAed((settleFor.amount ?? 0) + extras - 3000)}</span></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
