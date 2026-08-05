/**
 * Manager Operations Report — the CEO view of manager performance across the
 * four operations pipelines (Lead · New Lease · Renewal · Terminated):
 *
 *   1. Bottom line — plain-English conclusions for the chosen period.
 *   2. Scoreboard — output + delivered outcomes, each compared against the
 *      previous period (this week vs last week, this month vs last month…).
 *   3. Where the time goes — manager vs customer vs landlord days, compared.
 *   4. Operations by stage — one row per person, stages grouped under their
 *      pipeline, plus leases delivered. Every number clicks through to the
 *      records behind it with their full history and step durations.
 *   5. Waiting too long right now — live stuck records with who's holding
 *      them (manager / customer / landlord).
 *   6. Stage timing + average working day (evaluation sections).
 *   7. Manager activity. EVERY audited action, not just the
 *      four pipelines (create/update/delete across properties, units, listings,
 *      documents, AMC, templates, team, settings, notes …). Repeated identical
 *      actions on one record collapse into a single "×N" line; page-view
 *      (reading) counts show per day; only genuinely-attributed actions appear
 *      (nothing system-generated reads "by Landlord"). Paginated per person.
 *
 * Data: GET /api/reports/manager-operations for the current AND previous
 * period (deltas are computed client-side), plus GET
 * /api/reports/operations-pipeline for the live stuck list. Signatures marked
 * "on file" are never counted. Landlord-only report.
 */
'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Loader2, AlertCircle, Download, ExternalLink, X, Eye } from 'lucide-react';
import { DateRangePicker } from '@/components/upnow/DateRangePicker';
import { APP_TIME_ZONE } from '@/lib/datetime';

/* ── payload types (mirror ReportsService.ManagerOperationsReport) ─────────── */
interface ActorRow { actor: string; completed: number; avgDays: number | null; medianDays: number | null; slowestDays: number | null }
interface StageRow { stageLabel: string; side: 'manager' | 'customer' | 'landlord'; completed: number; avgDays: number | null; medianDays: number | null; items: ActorRow[] }
interface DailyRow {
  userId: number; name: string; daysInPeriod: number; activeDays: number; activeDayList?: string[]; idleDays: number;
  avgActionsPerDay: number | null; avgTasksPerDay: number | null; avgSpanMinutes: number | null;
  mix: { leads: number; leases: number; documents: number; reports: number; other: number };
}
interface StageMatrix {
  stages: string[];
  totals: Array<number | null>;
  rows: Array<{ userId: number; name: string; cells: Array<number | null> }>;
}
interface ManagerAction {
  at: string; actorUserId: number; stage: string; record: string | null;
  contractId: number | null; leadId: number | null;
}
interface FieldChange { field: string; from: string | null; to: string | null }
interface ActivityAction {
  at: string; firstAt: string; count: number; actorUserId: number;
  category: string; kind: string; label: string; detail: string | null;
  changes: FieldChange[] | null; record: string | null;
  contractId: number | null; leadId: number | null;
}
interface ActivityViews { actorUserId: number; day: string; pages: number; reports: number }
interface RecordEvent { at: string; actorUserId: number | null; actor: string; label: string; gapDays: number | null }
interface RecordLog {
  type: 'lead' | 'contract'; id: number; label: string; kind: string;
  contractId: number | null; leadId: number | null;
  firstAt: string; lastAt: string; spanDays: number;
  actorUserIds: number[]; events: RecordEvent[];
}
interface DayMatrixRow { day: string; rows: Array<{ userId: number; cells: number[] }> }
interface CompletionRow { userId: number | null; name: string; newLeases: number; renewals: number; settlements: number; refunds: number }
interface CompletionItem {
  kind: 'new' | 'renewal' | 'settlement'; contractId: number; label: string;
  at: string; actorUserId: number; actor: string; refund: boolean;
}
interface Completions { rows: CompletionRow[]; items?: CompletionItem[]; totals: { newLeases: number; renewals: number; settlements: number; refunds: number } }
interface Payload {
  generatedAt: string; from: string | null; to: string | null; attributionSince: string;
  managers: Array<{ userId: number; name: string }>;
  stageMatrix: StageMatrix;
  managerActions: ManagerAction[]; managerActionsCapped: boolean;
  activity: ActivityAction[]; activityCapped: boolean; activityViews: ActivityViews[];
  daily: DailyRow[]; dayMatrix?: DayMatrixRow[]; completions?: Completions;
  window?: { from: string; to: string };
  rows: StageRow[];
  records: RecordLog[]; recordsCapped: boolean;
  totals: { stagesMeasured: number; managerAvgDays: number; customerAvgDays: number; landlordAvgDays: number };
}
/* live stuck list — subset of the operations-pipeline report payload */
interface PipeItem {
  contractId: number | null; ref: string | null; tenantName: string | null; unitLabel: string | null;
  buildingName: string | null; annualRentFils: number;
  tenantSignature: 'signed' | 'pending' | 'on_file' | null;
  landlordSignature: 'signed' | 'pending' | 'on_file' | null;
  progress: string; ageDays: number | null;
}
interface PipePayload { rows: Array<{ stageLabel: string; records: number; items: PipeItem[] }> }

/* ── period presets — Dubai calendar, compared against the previous period ── */
type Preset = 'today' | 'week' | 'month' | 'custom';
const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];
const dubaiToday = () => new Date().toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const daySpan = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
interface Range { from: string; to: string }
/** Current period + the like-for-like previous period (same span, aligned). */
function rangesFor(preset: Preset, customFrom: string, customTo: string): { cur: Range; prev: Range; vsLabel: string } {
  const today = dubaiToday();
  if (preset === 'today') {
    return { cur: { from: today, to: today }, prev: { from: addDays(today, -1), to: addDays(today, -1) }, vsLabel: 'yesterday' };
  }
  if (preset === 'week') {
    const start = mondayOf(today);
    return { cur: { from: start, to: today }, prev: { from: addDays(start, -7), to: addDays(today, -7) }, vsLabel: 'last week' };
  }
  if (preset === 'month') {
    const start = `${today.slice(0, 8)}01`;
    const pmEnd = addDays(start, -1);
    const pmStart = `${pmEnd.slice(0, 8)}01`;
    const dom = Math.min(Number(today.slice(8, 10)), Number(pmEnd.slice(8, 10)));
    return { cur: { from: start, to: today }, prev: { from: pmStart, to: `${pmStart.slice(0, 8)}${String(dom).padStart(2, '0')}` }, vsLabel: 'last month' };
  }
  const len = Math.max(1, daySpan(customFrom, customTo));
  const prevTo = addDays(customFrom, -1);
  return { cur: { from: customFrom, to: customTo }, prev: { from: addDays(prevTo, -(len - 1)), to: prevTo }, vsLabel: 'the previous period' };
}

/* ── house palette (validated in ReportCharts) — fixed order per person ───── */
const PALETTE = ['#2e9f82', '#1e5fae', '#b45309', '#8250df'];
const OTHERS = '#9b9890';

const SIDE_STYLE: Record<StageRow['side'], string> = {
  manager: 'bg-[#e0f2fe] text-[#0369a1]',
  customer: 'bg-[#fef3c7] text-[#854d0e]',
  landlord: 'bg-[#d8f2e8] text-[#1a7a5a]',
};
// Stage chip tint by journey area — leads/setup sky, signatures indigo,
// wind-down red, the rest green.
const stageTint = (stage: string): string => {
  if (stage.startsWith('Lead') || stage === 'KYC' || stage.startsWith('Payment')) return 'bg-[#e0f2fe] text-[#0369a1]';
  if (stage.includes('Signature')) return 'bg-[#ede9fe] text-[#5b21b6]';
  if (stage.startsWith('Termination') || stage.startsWith('Move-out') || stage.startsWith('Deposit') || stage === 'Bill Clearance') return 'bg-[#fee2e2] text-[#b91c1c]';
  return 'bg-[#d8f2e8] text-[#1a7a5a]';
};
// Activity category chip tint — grouped into the same journey-area colours the
// stage chips use, so the feed reads consistently across sections.
const CATEGORY_TINT: Record<string, string> = {
  Leads: 'bg-[#e0f2fe] text-[#0369a1]', Customers: 'bg-[#e0f2fe] text-[#0369a1]',
  Signature: 'bg-[#ede9fe] text-[#5b21b6]',
  Termination: 'bg-[#fee2e2] text-[#b91c1c]', Settlement: 'bg-[#fee2e2] text-[#b91c1c]',
  Payments: 'bg-[#fef3c7] text-[#92400e]', Registration: 'bg-[#fef3c7] text-[#92400e]',
  Properties: 'bg-[#d8f2e8] text-[#1a7a5a]', Units: 'bg-[#d8f2e8] text-[#1a7a5a]', Listings: 'bg-[#d8f2e8] text-[#1a7a5a]',
  Contracts: 'bg-[#d1f0ea] text-[#0f766e]', Inspection: 'bg-[#d1f0ea] text-[#0f766e]', Renewal: 'bg-[#d1f0ea] text-[#0f766e]',
  Documents: 'bg-[#eef2f7] text-[#475569]',
  Team: 'bg-[#f3eefe] text-[#6d28d9]', Templates: 'bg-[#f3eefe] text-[#6d28d9]', AMC: 'bg-[#f3eefe] text-[#6d28d9]', Settings: 'bg-[#f3eefe] text-[#6d28d9]',
  Viewing: 'bg-[#f4f3ef] text-[#9b9890]', Session: 'bg-[#eef2f7] text-[#475569]',
};
const categoryTint = (c: string) => CATEGORY_TINT[c] ?? 'bg-[#f4f3ef] text-[#6b6860]';

// Step-duration tone — long waits should jump out in the history view.
const gapTone = (d: number | null) =>
  d == null ? '' : d >= 14 ? 'bg-[#fee2e2] text-[#991b1b]' : d >= 7 ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f4f3ef] text-[#6b6860]';
const actorChip = (name: string) =>
  name === 'Customer' ? 'bg-[#fef3c7] text-[#854d0e]'
    : name === 'Landlord' ? 'bg-[#d8f2e8] text-[#1a7a5a]'
      : name === '—' ? 'bg-[#f4f3ef] text-[#9b9890]'
        : 'bg-[#e0f2fe] text-[#0369a1]';

/** Who a stuck record is waiting on — same sides the stage-timing table uses. */
const blameOf = (stageLabel: string): 'Customer' | 'Landlord' | 'Manager' => {
  if (stageLabel.includes('Signature by Customer')) return 'Customer';
  if (stageLabel.includes('Signature by Landlord')) return 'Landlord';
  if (stageLabel.includes('Utility')) return 'Customer';
  if (stageLabel.startsWith('Lead') && stageLabel.includes('Payment plan')) return 'Customer';
  return 'Manager';
};
const BLAME_STYLE: Record<'Customer' | 'Landlord' | 'Manager', string> = {
  Customer: 'bg-[#fef3c7] text-[#854d0e]',
  Landlord: 'bg-[#d8f2e8] text-[#1a7a5a]',
  Manager: 'bg-[#e0f2fe] text-[#0369a1]',
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const fmtDays = (v: number | null | undefined) => (v == null ? '—' : v === 0 ? 'same day' : `${v}d`);
const fmtSpan = (min: number | null | undefined) => {
  if (min == null) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AE', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
/** 'YYYY-MM-DD' → '14 Jul' (the string is already a Dubai calendar day). */
const fmtDayShort = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AE', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const dubaiDayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ── comparison chip — colored by whether the move is good ─────────────────── */
function Delta({ cur, prev, vsLabel, goodDown = false, unit = '' }: {
  cur: number; prev: number | null; vsLabel: string; goodDown?: boolean; unit?: string;
}) {
  if (prev == null) return null;
  const diff = round1(cur - prev);
  if (diff === 0) {
    return <span className="text-[11px] font-medium text-[#9b9890]">same as {vsLabel} ({round1(prev)}{unit})</span>;
  }
  const up = diff > 0;
  const good = goodDown ? !up : up;
  return (
    <span className={`text-[11px] font-semibold ${good ? 'text-[#1a7a5a]' : 'text-[#b91c1c]'}`}>
      {up ? '▲' : '▼'} {round1(Math.abs(diff))}{unit} vs {vsLabel} ({round1(prev)}{unit})
    </span>
  );
}

function Tile({ label, value, sub, delta, onClick }: {
  label: string; value: string; sub?: string; delta?: React.ReactNode; onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">{label}</p>
      <p className="text-2xl font-bold text-[#1a1916] mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[#6b6860] mt-0.5">{sub}</p>}
      {delta && <p className="mt-1">{delta}</p>}
    </>
  );
  if (!onClick) return <div className="bg-white rounded-2xl border border-[#e8e6e0] px-5 py-4">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title="See the details behind this number"
      className="bg-white rounded-2xl border border-[#e8e6e0] px-5 py-4 text-left cursor-pointer transition-colors hover:border-[#2e9f82] focus:outline-none focus:border-[#2e9f82]">
      {body}
    </button>
  );
}

const EMPTY_COMPLETIONS: Completions = { rows: [], items: [], totals: { newLeases: 0, renewals: 0, settlements: 0, refunds: 0 } };

export function ManagerOperationsReport({
  backHref = '/rental-provider/dashboard/reports',
  contractsBase = '/rental-provider/dashboard/contracts',
  leadsBase = '/rental-provider/dashboard/leads',
}: { backHref?: string; contractsBase?: string; leadsBase?: string }) {
  const [preset, setPreset] = useState<Preset>('today');
  const [customFrom, setCustomFrom] = useState(() => addDays(dubaiToday(), -29));
  const [customTo, setCustomTo] = useState(() => dubaiToday());
  const [data, setData] = useState<Payload | null>(null);
  const [prevData, setPrevData] = useState<Payload | null>(null);
  const [pipe, setPipe] = useState<PipePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Cell drill-down: which manager × stage the user clicked (null userId = team total). */
  const [drill, setDrill] = useState<{ userId: number | null; who: string; stage: string; count: number } | null>(null);
  /** Which people have "view all" expanded in the activity feed (userId set). */
  const [expandedActivity, setExpandedActivity] = useState<Set<number>>(new Set());
  /** Activity row drill-down: the clicked action, to show what changed. */
  const [activityDrill, setActivityDrill] = useState<{ action: ActivityAction; who: string } | null>(null);
  /** Scoreboard tile drill-down: the details behind each headline number. */
  const [tileDrill, setTileDrill] = useState<'steps' | 'delivered' | 'settlements' | 'idle' | null>(null);

  const { cur, prev, vsLabel } = useMemo(
    () => rangesFor(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const get = async (r: Range): Promise<Payload> => {
      const res = await fetch(`/api/reports/manager-operations?from=${r.from}&to=${r.to}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
      return res.json();
    };
    Promise.all([
      get(cur),
      get(prev).catch(() => null),                                   // deltas are optional
      fetch('/api/reports/operations-pipeline').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([d, p, pl]) => { if (alive) { setData(d); setPrevData(p); setPipe(pl); } })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cur.from, cur.to, prev.from, prev.to]);

  /* ── derived: scoreboard, daily figures, stuck list ─────────────────────── */
  const completions = data?.completions ?? EMPTY_COMPLETIONS;
  const prevCompletions = prevData?.completions ?? null;
  const progressedOf = (p: Payload | null) =>
    p ? p.stageMatrix.totals.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  const progressed = progressedOf(data) ?? 0;
  const prevProgressed = progressedOf(prevData);
  const idleOf = (p: Payload | null) => (p ? p.daily.reduce((s, d) => s + d.idleDays, 0) : null);
  const idleDays = idleOf(data) ?? 0;

  /** People in matrix-row order (managers, then the landlord) — colors and
   *  columns follow this order everywhere so a person keeps their hue. */
  const people = data?.stageMatrix.rows ?? [];
  const colorOf = (idx: number) => (idx < PALETTE.length ? PALETTE[idx] : OTHERS);

  const deliveredOf = (c: Completions | null) => (c ? c.totals.newLeases + c.totals.renewals : null);
  const delivered = deliveredOf(completions) ?? 0;

  /** Live stuck records — in the pipeline, no movement for 7+ days. */
  const stuck = useMemo(() => {
    if (!pipe) return null;
    const items = pipe.rows.flatMap(r =>
      r.items
        .filter(i => (i.ageDays ?? 0) >= 7)
        .map(i => ({ ...i, stageLabel: r.stageLabel, blame: blameOf(r.stageLabel) })));
    items.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
    return items;
  }, [pipe]);

  /* ── bottom line — the sentences the CEO reads first ────────────────────── */
  const bottomLine = useMemo(() => {
    if (!data) return [];
    const out: React.ReactNode[] = [];
    const cmp = (curV: number, prevV: number | null) =>
      prevV == null ? '' : curV === prevV ? ` — same as ${vsLabel}` : curV > prevV ? ` — up from ${prevV} ${vsLabel}` : ` — down from ${prevV} ${vsLabel}`;
    out.push(<>The team moved <b>{progressed}</b> pipeline step{progressed === 1 ? '' : 's'}{cmp(progressed, prevProgressed)}.</>);
    const prevDelivered = prevCompletions ? deliveredOf(prevCompletions) : null;
    out.push(
      <>
        Delivered: <b>{completions.totals.newLeases}</b> new lease{completions.totals.newLeases === 1 ? '' : 's'} and{' '}
        <b>{completions.totals.renewals}</b> renewal{completions.totals.renewals === 1 ? '' : 's'} activated
        {cmp(delivered, prevDelivered)}; <b>{completions.totals.settlements}</b> deposit settlement
        {completions.totals.settlements === 1 ? '' : 's'} paid
        {completions.totals.refunds ? <> ({completions.totals.refunds} with a refund back to the customer)</> : null}.
      </>,
    );
    const slowest = [...data.rows].filter(r => r.completed > 0 && r.avgDays != null).sort((a, b) => (b.avgDays ?? 0) - (a.avgDays ?? 0))[0];
    if (slowest) {
      out.push(<>Slowest stage this period: <b>{slowest.stageLabel}</b> — avg <b>{slowest.avgDays}d</b>, and that clock is on the <b>{slowest.side}</b>&apos;s side.</>);
    }
    if (stuck) {
      if (stuck.length === 0) {
        out.push(<>Nothing in the pipeline has been sitting for more than 7 days right now.</>);
      } else {
        const n = (w: 'Customer' | 'Landlord' | 'Manager') => stuck.filter(s => s.blame === w).length;
        out.push(
          <>
            <b>{stuck.length}</b> record{stuck.length === 1 ? ' is' : 's are'} waiting 7+ days right now —{' '}
            {n('Customer')} on customers, {n('Landlord')} on the landlord signature, {n('Manager')} on managers.
          </>,
        );
      }
    }
    if (preset !== 'today') {
      const worstIdle = [...data.daily].sort((a, b) => b.idleDays - a.idleDays)[0];
      if (worstIdle && worstIdle.idleDays > 0) {
        out.push(<><b>{worstIdle.name}</b> had <b>{worstIdle.idleDays}</b> idle day{worstIdle.idleDays === 1 ? '' : 's'} (no in-system activity) out of {worstIdle.daysInPeriod} tracked.</>);
      }
    }
    return out;
  }, [data, progressed, prevProgressed, completions, prevCompletions, delivered, stuck, vsLabel, preset]);

  /* Stage-timing matrix columns: managers + extra actors, Customer kept
     separate so customer wait never colours a manager. */
  const actorCols = useMemo(() => {
    if (!data) return [] as string[];
    const base = data.managers.map(m => m.name);
    const extras = new Set<string>();
    for (const r of data.rows) for (const it of r.items) {
      if (it.actor !== 'Customer' && !it.actor.startsWith('No completed') && !base.includes(it.actor)) extras.add(it.actor);
    }
    const ordered = [...base];
    if (extras.has('Landlord')) ordered.push('Landlord');
    for (const e of [...extras].sort()) if (e !== 'Landlord') ordered.push(e);
    return ordered;
  }, [data]);

  const cellOf = (r: StageRow, actor: string): ActorRow | null =>
    r.items.find(i => i.actor === actor) ?? null;

  /** Leases delivered per person (new + renewals), for the matrix column. */
  const deliveredBy = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of completions.rows) if (r.userId != null) m.set(r.userId, r.newLeases + r.renewals);
    return m;
  }, [completions]);

  /* Date-wise activity log: person → day → actions (newest first). Uses the
     full activity feed (all areas, repeats collapsed) and the matrix rows so
     the landlord's own operations work shows too. Each day also carries the
     page-view (reading) counts for that person. */
  const managerDays = useMemo(() => {
    if (!data) return [] as Array<{
      userId: number; name: string; total: number;
      days: Array<{ day: string; actions: ActivityAction[]; views: { pages: number; reports: number } | null }>;
    }>;
    // person → Dubai-day → { pages, reports }
    const viewsByPersonDay = new Map<string, { pages: number; reports: number }>();
    for (const v of data.activityViews ?? []) viewsByPersonDay.set(`${v.actorUserId}:${v.day}`, { pages: v.pages, reports: v.reports });
    return data.stageMatrix.rows.map(m => {
      const mine = (data.activity ?? []).filter(a => a.actorUserId === m.userId);
      const byDay = new Map<string, ActivityAction[]>();
      for (const a of mine) {
        const day = fmtDay(a.at);
        const arr = byDay.get(day) ?? [];
        arr.push(a);
        byDay.set(day, arr);
      }
      const days = [...byDay.entries()].map(([day, actions]) => {
        const isoDay = dubaiDayOf(actions[0].at);
        return { day, actions, views: viewsByPersonDay.get(`${m.userId}:${isoDay}`) ?? null };
      });
      const collapsed = mine.reduce((s, a) => s + a.count, 0);
      return { userId: m.userId, name: m.name, total: collapsed, days };
    });
  }, [data]);

  /* Drill-down: the records behind one clicked matrix number, each with the
     person's action time(s) at that stage and the record's history. A specific
     person's cell shows ONLY that person's own steps on the record; the Team
     ("all") cell shows every party's steps — the full history. */
  const drillData = useMemo(() => {
    if (!drill || !data) return null;
    const acts = data.managerActions.filter(a =>
      (drill.userId == null || a.actorUserId === drill.userId) && a.stage === drill.stage);
    const byRec = new Map<string, { label: string; contractId: number | null; leadId: number | null; times: string[] }>();
    for (const a of acts) {
      const key = a.contractId != null ? `c${a.contractId}` : a.leadId != null ? `l${a.leadId}` : (a.record ?? `x${a.at}`);
      const e = byRec.get(key) ?? { label: a.record ?? '—', contractId: a.contractId, leadId: a.leadId, times: [] };
      e.times.push(a.at);
      byRec.set(key, e);
    }
    return [...byRec.values()].map(r => {
      const journey = data.records.find(j =>
        (r.contractId != null && j.contractId === r.contractId)
        || (r.leadId != null && j.type === 'lead' && j.leadId === r.leadId)) ?? null;
      const allEvents = journey?.events ?? [];
      const scoped = drill.userId == null ? allEvents : allEvents.filter(e => e.actorUserId === drill.userId);
      // Re-time each gap against the previous VISIBLE step so durations stay
      // truthful after filtering (not a hidden full-history neighbour).
      const visibleEvents = scoped.map((e, i) => ({
        ...e,
        gapDays: i === 0 ? null
          : Math.round(Math.max(0, (new Date(e.at).getTime() - new Date(scoped[i - 1].at).getTime()) / 86_400_000) * 10) / 10,
      }));
      return { ...r, journey, visibleEvents };
    });
  }, [drill, data]);

  const downloadCsv = () => {
    if (!data) return;
    // Their format: managers down, the merged stages across, delivered last.
    const headers = ['Manager', ...data.stageMatrix.stages, 'Leases Activated'];
    const lines = [
      ['Team total', ...data.stageMatrix.totals.map(v => v ?? '—'), completions.totals.newLeases + completions.totals.renewals],
      ...data.stageMatrix.rows.map(r => [r.name, ...r.cells.map(v => v ?? '—'), deliveredBy.get(r.userId) ?? 0]),
    ];
    const csv = [headers, ...lines].map(row => row.map(toCsvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `manager-operations-${cur.from}-to-${cur.to}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const grouped14 = data?.stageMatrix.stages.length === 14;

  return (
    <div className="p-6 print:p-0 max-w-[1250px]">
      {/* ── header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href={backHref} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-sm print:hidden">
            <ArrowLeft size={14} /> All Reports
          </Link>
          <h1 className="text-2xl font-bold text-[#1a1916] mt-1.5">Manager Operations Report</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-[72ch]">
            What each manager moved through the Lead, New Lease, Renewal and Terminated pipelines —
            compared against {vsLabel}, day by day, with every delay attributed to the manager, the
            customer or the landlord. Signatures marked “on file” are never counted.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={downloadCsv} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm font-medium text-[#3d3b35] hover:border-[#2e9f82]">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#1a7a5a]">
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      {/* ── period presets ── */}
      <div className="flex items-center gap-2 mt-4 flex-wrap print:hidden">
        {PRESETS.map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            aria-pressed={preset === p.key}
            className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
              preset === p.key
                ? 'bg-[#1a1916] text-white border-[#1a1916]'
                : 'bg-white text-[#3d3b35] border-[#e8e6e0] hover:border-[#2e9f82]'
            }`}>
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <DateRangePicker from={customFrom} to={customTo} onChange={(f, t) => { if (f && t) { setCustomFrom(f); setCustomTo(t); } }} />
        )}
        <span className="text-xs text-[#9b9890]">
          {fmtDate(cur.from)} – {fmtDate(cur.to)} · compared to {fmtDate(prev.from)} – {fmtDate(prev.to)}
        </span>
      </div>
      <p className="hidden print:block text-xs text-[#6b6860] mt-2">
        Period {fmtDate(cur.from)} – {fmtDate(cur.to)}, compared to {fmtDate(prev.from)} – {fmtDate(prev.to)}.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6b6860] py-20 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-700 py-16 justify-center"><AlertCircle size={16} /> {error}</div>
      ) : !data ? null : (
        <>
          {/* ── 1. Bottom line ── */}
          <section className="mt-5 bg-[#1a1916] text-white rounded-2xl px-5 py-4 print:break-inside-avoid">
            <h2 className="text-[11px] uppercase tracking-wide font-semibold text-[#c8c6c0]">Bottom line</h2>
            <ul className="mt-2 space-y-1.5">
              {bottomLine.map((b, i) => (
                <li key={i} className="text-sm leading-relaxed flex gap-2">
                  <span className="text-[#2e9f82] shrink-0">•</span>
                  <span className="[&>b]:font-bold [&>b]:text-white text-[#e8e6e0]">{b}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ── 2. Scoreboard vs previous period — every tile clicks into its details ── */}
          <section className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 print:break-inside-avoid">
            <Tile
              label="Pipeline steps moved"
              value={String(progressed)}
              sub="records progressed across all stages"
              delta={<Delta cur={progressed} prev={prevProgressed} vsLabel={vsLabel} />}
              onClick={() => setTileDrill('steps')}
            />
            <Tile
              label="Leases delivered"
              value={String(delivered)}
              sub={`${completions.totals.newLeases} new · ${completions.totals.renewals} renewal${completions.totals.renewals === 1 ? '' : 's'} activated`}
              delta={<Delta cur={delivered} prev={prevCompletions ? deliveredOf(prevCompletions) : null} vsLabel={vsLabel} />}
              onClick={() => setTileDrill('delivered')}
            />
            <Tile
              label="Settlements paid"
              value={String(completions.totals.settlements)}
              sub={completions.totals.refunds ? `${completions.totals.refunds} refund${completions.totals.refunds === 1 ? '' : 's'} issued to customers` : 'terminations closed out'}
              delta={<Delta cur={completions.totals.settlements} prev={prevCompletions?.totals.settlements ?? null} vsLabel={vsLabel} />}
              onClick={() => setTileDrill('settlements')}
            />
            <Tile
              label="Idle manager-days"
              value={String(idleDays)}
              sub="days with no in-system activity · Fridays don't count"
              delta={<Delta cur={idleDays} prev={idleOf(prevData)} vsLabel={vsLabel} goodDown />}
              onClick={() => setTileDrill('idle')}
            />
          </section>

          {/* ── 3. Where the time goes ── */}
          <section className="mt-3 bg-white rounded-2xl border border-[#e8e6e0] px-5 py-4 print:break-inside-avoid">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <h2 className="text-sm font-bold text-[#1a1916]">Where the waiting time goes</h2>
              <span className="text-[11px] text-[#9b9890]">sum of average stage waits — lower is better</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              {([
                ['Managers', data.totals.managerAvgDays, prevData?.totals.managerAvgDays ?? null, SIDE_STYLE.manager],
                ['Customers', data.totals.customerAvgDays, prevData?.totals.customerAvgDays ?? null, SIDE_STYLE.customer],
                ['Landlord', data.totals.landlordAvgDays, prevData?.totals.landlordAvgDays ?? null, SIDE_STYLE.landlord],
              ] as Array<[string, number, number | null, string]>).map(([who, v, pv, chip]) => (
                <div key={who} className="rounded-xl border border-[#f0ede8] px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${chip}`}>{who}</span>
                  <p className="text-xl font-bold text-[#1a1916] mt-1.5 tabular-nums">{round1(v)}d</p>
                  <p className="mt-0.5"><Delta cur={v} prev={pv} vsLabel={vsLabel} goodDown unit="d" /></p>
                </div>
              ))}
            </div>
          </section>

          {/* ── 5. Operations by stage — stages down, managers across. Transposed
                 so the whole matrix fits on screen without horizontal scroll:
                 the long axis (14 stages) runs vertically, the short axis (a
                 few people) horizontally — same reading direction as the
                 stage-timing table below. ── */}
          <section className="mt-5 bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
            <div className="px-5 py-3.5 border-b border-[#f0ede8]">
              <h2 className="text-sm font-bold text-[#1a1916]">Operations by stage — records each manager progressed</h2>
              <p className="text-xs text-[#6b6860] mt-0.5">
                Stages down the side grouped by pipeline (KYC → Payment Confirmation serve both the Lead intake
                and lease setup); customer and landlord signatures kept separate. Click any number to see
                the records behind it with their history.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-semibold min-w-[210px]">Stage</th>
                    {people.map((p, i) => (
                      <th key={p.userId} className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: colorOf(i) }} />
                        {p.name}
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-right font-semibold border-l border-[#e8e6e0]">Team</th>
                  </tr>
                </thead>
                <tbody className="text-[#1a1916]">
                  {data.stageMatrix.stages.map((stage, i) => {
                    const band = grouped14
                      ? (i === 0 ? { label: 'Lead intake', cls: 'text-[#0369a1] bg-[#f0f9ff]' }
                        : i === 4 ? { label: 'New lease & renewal', cls: 'text-[#5b21b6] bg-[#f5f3ff]' }
                          : i === 9 ? { label: 'Termination', cls: 'text-[#b91c1c] bg-[#fef2f2]' } : null)
                      : null;
                    const total = data.stageMatrix.totals[i];
                    return (
                      <Fragment key={stage}>
                        {band && (
                          <tr>
                            <td colSpan={people.length + 2} className={`px-5 py-1.5 text-[10px] font-bold uppercase tracking-wide ${band.cls}`}>{band.label}</td>
                          </tr>
                        )}
                        <tr className="border-t border-[#f7f5f1] hover:bg-[#fafaf8]">
                          <td className="px-5 py-2 font-medium">{stage}</td>
                          {people.map(p => {
                            const v = p.cells[i];
                            return (
                              <td key={p.userId} className={`px-4 py-2 text-right tabular-nums ${v ? '' : 'text-[#c8c6c0]'}`}>
                                {v == null ? '—' : v === 0 ? 0 : (
                                  <button
                                    onClick={() => setDrill({ userId: p.userId, who: p.name, stage, count: v })}
                                    className="font-semibold text-[#1a7a5a] underline decoration-dotted underline-offset-2 hover:text-[#2e9f82] cursor-pointer"
                                    title="See the records behind this number">
                                    {v}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                          <td className={`px-4 py-2 text-right tabular-nums font-bold border-l border-[#f0ede8] ${total ? '' : 'text-[#c8c6c0]'}`}>
                            {total == null ? '—' : total === 0 ? 0 : (
                              <button
                                onClick={() => setDrill({ userId: null, who: 'Team', stage, count: total })}
                                className="underline decoration-dotted underline-offset-2 hover:text-[#2e9f82] cursor-pointer"
                                title="See the records behind this number">
                                {total}
                              </button>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-[#f0faf6] border-t-2 border-[#e8e6e0] font-bold text-[#1a7a5a]">
                  <tr>
                    <td className="px-5 py-2.5">Leases Activated (delivered)</td>
                    {people.map(p => (
                      <td key={p.userId} className={`px-4 py-2.5 text-right tabular-nums ${deliveredBy.get(p.userId) ? '' : 'text-[#9fcfbf]'}`}>
                        {deliveredBy.get(p.userId) ?? 0}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right tabular-nums border-l border-[#e8e6e0]">
                      {completions.totals.newLeases + completions.totals.renewals}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── 6. Waiting too long right now (live, not period-scoped) ── */}
          {stuck && stuck.length > 0 && (
            <section className="mt-5 bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
              <div className="px-5 py-3.5 border-b border-[#f0ede8]">
                <h2 className="text-sm font-bold text-[#1a1916]">Waiting too long right now — 7+ days without movement</h2>
                <p className="text-xs text-[#6b6860] mt-0.5">
                  Live snapshot of the pipelines (not limited to the period above). “Waiting on” follows the
                  same rules as stage timing — a customer or landlord wait is not the manager&apos;s clock.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-semibold">Record</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Pipeline · stage</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Waiting on</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Stuck for</th>
                    <th className="px-3 py-2.5 print:hidden" />
                  </tr>
                </thead>
                <tbody className="text-[#1a1916]">
                  {stuck.slice(0, 12).map((s, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <td className="px-5 py-2.5 font-semibold">
                        {s.tenantName ?? '—'}
                        <span className="text-[#9b9890] font-normal"> {s.unitLabel ? `· ${s.unitLabel}` : ''}{s.buildingName ? ` · ${s.buildingName}` : ''}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{s.stageLabel}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${BLAME_STYLE[s.blame]}`}>{s.blame}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${gapTone(s.ageDays)}`}>{s.ageDays}d</span>
                      </td>
                      <td className="px-3 py-2.5 text-right print:hidden">
                        {s.contractId != null && (
                          <Link href={`${contractsBase}/${s.contractId}/v2`} className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">
                            Open <ExternalLink size={11} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stuck.length > 12 && (
                <p className="px-5 py-2.5 text-xs text-[#9b9890] border-t border-[#f0ede8]">
                  +{stuck.length - 12} more — see the Operations page for the full pipeline.
                </p>
              )}
            </section>
          )}

          {/* ── 7. Stage timing — managers side by side ── */}
          <section className="mt-5 bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
            <div className="px-5 py-3.5 border-b border-[#f0ede8] flex items-baseline justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#1a1916]">Stage timing — managers side by side</h2>
                <p className="text-xs text-[#6b6860] mt-0.5">
                  Average time to close each stage; the bracket is how many records that average comes
                  from — “2.5d (4)” = 4 records closed, 2.5 days each on average. Hover for median and
                  slowest. A manager is only measured on stages whose clock is theirs.
                </p>
              </div>
              <span className="text-xs text-[#6b6860]">
                Σ stage avgs — Manager <b>{data.totals.managerAvgDays}d</b> · Customer <b>{data.totals.customerAvgDays}d</b> · Landlord <b>{data.totals.landlordAvgDays}d</b>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-semibold min-w-[230px]">Stage</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Side</th>
                    {actorCols.map(a => <th key={a} className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">{a}</th>)}
                    <th className="px-4 py-2.5 text-right font-semibold">Customer</th>
                    <th className="px-4 py-2.5 text-right font-semibold border-l border-[#e8e6e0]">Overall</th>
                  </tr>
                </thead>
                <tbody className="text-[#1a1916]">
                  {data.rows.map(r => {
                    const cust = cellOf(r, 'Customer');
                    return (
                      <tr key={r.stageLabel} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                        <td className="px-5 py-2.5 font-medium">{r.stageLabel}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${SIDE_STYLE[r.side]}`}>{r.side}</span>
                        </td>
                        {actorCols.map(a => {
                          const c = cellOf(r, a);
                          return (
                            <td key={a} className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap"
                              title={c ? `average of ${c.completed} record${c.completed === 1 ? '' : 's'} · median ${fmtDays(c.medianDays)} · slowest ${fmtDays(c.slowestDays)}` : undefined}>
                              {c ? <><b>{fmtDays(c.avgDays)}</b> <span className="text-[#9b9890] text-xs">({c.completed})</span></> : <span className="text-[#d4d2cc]">·</span>}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap"
                          title={cust ? `average of ${cust.completed} record${cust.completed === 1 ? '' : 's'} · median ${fmtDays(cust.medianDays)} · slowest ${fmtDays(cust.slowestDays)}` : undefined}>
                          {cust ? <><b>{fmtDays(cust.avgDays)}</b> <span className="text-[#9b9890] text-xs">({cust.completed})</span></> : <span className="text-[#d4d2cc]">·</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-[#f0ede8]">
                          {r.completed ? <><b>{fmtDays(r.avgDays)}</b> <span className="text-[#9b9890] text-xs">({r.completed})</span></> : <span className="text-[#d4d2cc]">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 8. Average working day ── */}
          <section className="mt-5 bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
            <div className="px-5 py-3.5 border-b border-[#f0ede8]">
              <h2 className="text-sm font-bold text-[#1a1916]">Average working day</h2>
              <p className="text-xs text-[#6b6860] mt-0.5">Everything each manager does in the system per day — output, breadth, presence.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-semibold w-56">Metric</th>
                    {data.daily.map(d => <th key={d.userId} className="px-4 py-2.5 text-right font-semibold">{d.name}</th>)}
                  </tr>
                </thead>
                <tbody className="text-[#1a1916]">
                  {([
                    ['Days active', (d: DailyRow) => `${d.activeDays} of ${d.daysInPeriod}`],
                    ['Idle days (no activity)', (d: DailyRow) => String(d.idleDays)],
                    ['Avg actions / working day', (d: DailyRow) => d.avgActionsPerDay == null ? '—' : String(d.avgActionsPerDay)],
                    ['Avg records touched / day', (d: DailyRow) => d.avgTasksPerDay == null ? '—' : String(d.avgTasksPerDay)],
                    ['Avg time in system / day', (d: DailyRow) => fmtSpan(d.avgSpanMinutes)],
                    ['Work mix (actions)', (d: DailyRow) =>
                      `${d.mix.leads} leads · ${d.mix.leases} leases · ${d.mix.documents} docs · ${d.mix.reports} report checks`],
                  ] as Array<[string, (d: DailyRow) => string]>).map(([label, pick]) => (
                    <tr key={label} className="border-t border-[#f0ede8]">
                      <td className="px-5 py-2.5 text-[#6b6860] font-medium">{label}</td>
                      {data.daily.map(d => (
                        <td key={d.userId} className="px-4 py-2.5 text-right tabular-nums font-semibold">{pick(d)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 9. Manager activity ── */}
          <section className="mt-5">
            <div className="bg-white rounded-2xl border border-[#e8e6e0] px-5 py-3.5">
              <h2 className="text-sm font-bold text-[#1a1916]">Manager activity</h2>
              <p className="text-xs text-[#6b6860] mt-0.5">
                The full day for each person, newest first — signing in, pages opened, and every create/edit/delete
                across leads, contracts, payments, listings, documents, templates and settings. Repeated saves of the
                same thing roll up into one “×5” line; <b>click any row to see exactly what changed</b>. Only
                genuinely-attributed actions appear — system-generated entries (receipts, plan numbers) are never
                credited to a person.
                {data.activityCapped ? ' Showing the most recent activity — narrow the period for the rest.' : ''}
              </p>
            </div>
            {managerDays.map(m => {
              const totalEntries = m.days.reduce((s, d) => s + d.actions.length, 0);
              const expanded = expandedActivity.has(m.userId);
              const INITIAL = 12;
              // Truncate to the first INITIAL entries (across days) unless expanded.
              let shown = 0;
              const visibleDays = expanded ? m.days : m.days.reduce<typeof m.days>((out, d) => {
                if (shown >= INITIAL) return out;
                const acts = d.actions.slice(0, INITIAL - shown);
                shown += acts.length;
                out.push({ ...d, actions: acts });
                return out;
              }, []);
              return (
                <div key={m.userId} className="bg-white rounded-2xl border border-[#e8e6e0] mt-3 overflow-hidden print:break-inside-avoid">
                  <div className="px-5 py-3 border-b border-[#f0ede8] bg-[#fafaf8] flex items-baseline justify-between">
                    <h3 className="text-sm font-bold text-[#1a1916]">{m.name}</h3>
                    <span className="text-xs text-[#9b9890]">{m.total} action{m.total === 1 ? '' : 's'} in this period</span>
                  </div>
                  {m.days.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-[#9b9890]">No recorded activity in this period.</p>
                  ) : (
                    <>
                      {visibleDays.map(({ day, actions, views }) => (
                        <div key={day}>
                          <div className="px-5 py-1.5 bg-[#fafaf8] border-t border-[#f0ede8] flex items-baseline justify-between gap-3 flex-wrap">
                            <span className="text-xs font-bold text-[#3d3b35]">{day}</span>
                            <span className="text-[11px] text-[#9b9890] flex items-center gap-2">
                              {(() => {
                                const acts = actions.filter(a => a.category !== 'Viewing').reduce((s, a) => s + a.count, 0);
                                return <span>{acts} action{acts === 1 ? '' : 's'}</span>;
                              })()}
                              {views && views.pages > 0 && (
                                <span className="inline-flex items-center gap-1 text-[#9b9890]">
                                  <Eye size={11} /> {views.pages} page{views.pages === 1 ? '' : 's'}{views.reports ? ` · ${views.reports} report${views.reports === 1 ? '' : 's'}` : ''}
                                </span>
                              )}
                            </span>
                          </div>
                          {actions.map((a, i) => (
                            <div key={i} className="px-5 py-2 flex items-center gap-3 border-t border-[#f7f5f1] text-sm hover:bg-[#fafaf8]">
                              <button
                                type="button"
                                onClick={() => setActivityDrill({ action: a, who: m.name })}
                                title="See what changed"
                                className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer">
                                <span className="text-[11px] text-[#9b9890] tabular-nums w-24 shrink-0">
                                  {a.count > 1 ? `${fmtTime(a.firstAt)}–${fmtTime(a.at)}` : fmtTime(a.at)}
                                </span>
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${categoryTint(a.category)}`}>{a.category}</span>
                                <span className="text-[#1a1916] shrink-0 font-medium">{a.label}</span>
                                {a.detail && <span className="text-[#b45309] shrink-0 tabular-nums truncate" title={a.detail}>— {a.detail}</span>}
                                {a.count > 1 && (
                                  <span className="inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums bg-[#f4f3ef] text-[#6b6860] shrink-0" title={`${a.count} times`}>×{a.count}</span>
                                )}
                                {a.record && <span className="text-[#6b6860] truncate">· {a.record}</span>}
                              </button>
                              {(a.contractId ?? a.leadId) != null && (
                                <Link
                                  href={a.contractId != null ? `${contractsBase}/${a.contractId}/v2` : `${leadsBase}/${a.leadId}`}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline print:hidden shrink-0">
                                  Open <ExternalLink size={11} />
                                </Link>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                      {totalEntries > INITIAL && (
                        <button
                          type="button"
                          onClick={() => setExpandedActivity(prev => {
                            const next = new Set(prev);
                            if (next.has(m.userId)) next.delete(m.userId); else next.add(m.userId);
                            return next;
                          })}
                          className="w-full px-5 py-2.5 border-t border-[#f0ede8] text-xs font-semibold text-[#2e9f82] hover:bg-[#fafaf8] print:hidden">
                          {expanded ? 'Show less' : `View all ${totalEntries} entries`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </section>

          <p className="text-[11px] text-[#9b9890] mt-3">
            Generated {new Date(data.generatedAt).toLocaleString('en-AE', { timeZone: APP_TIME_ZONE })}. Detailed stage
            tracking since {fmtDate(data.attributionSince)} — periods before that under-count. Only in-system work is
            measurable — calls and site visits leave no trace. Landlord-only report.
          </p>

          {/* ── cell drill-down: the records behind a number + their history ── */}
          {drill && drillData && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 sm:p-8 print:hidden" onClick={() => setDrill(null)}>
              <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b border-[#f0ede8] px-5 py-3.5 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#1a1916]">{drill.who} — {drill.stage}</h3>
                    <p className="text-xs text-[#6b6860] mt-0.5">
                      {drillData.length} record{drillData.length === 1 ? '' : 's'}
                      {drillData.length < drill.count ? ` shown of ${drill.count} — narrow the period for the rest` : ''}
                      {drill.userId == null ? ' · full history with step durations' : ` · ${drill.who}’s own steps — click Team for full history`}
                    </p>
                  </div>
                  <button onClick={() => setDrill(null)} className="w-7 h-7 rounded-lg grid place-items-center text-[#9b9890] hover:bg-[#f4f3ef] hover:text-[#1a1916]">
                    <X size={15} />
                  </button>
                </div>
                {drillData.length === 0 ? (
                  <p className="px-5 py-10 text-sm text-[#9b9890] text-center">
                    The detail behind this number is older than the loaded window — narrow the period to see it.
                  </p>
                ) : drillData.map((r, ri) => (
                  <div key={ri} className="border-t border-[#f0ede8] first:border-t-0">
                    <div className="px-5 py-2.5 bg-[#fafaf8] flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-bold text-[#1a1916]">{r.label}</span>
                      {r.journey && <span className="text-xs text-[#9b9890]">{r.journey.kind} · {r.journey.spanDays}d start to latest</span>}
                      {(r.contractId ?? r.leadId) != null && (
                        <Link
                          href={r.contractId != null ? `${contractsBase}/${r.contractId}/v2` : `${leadsBase}/${r.leadId}`}
                          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">
                          Open <ExternalLink size={11} />
                        </Link>
                      )}
                    </div>
                    {/* Why this record counts: the person's own action time(s) at this
                        stage — visible even when the journey milestones are other
                        people's (in-progress work has no milestone yet). */}
                    {drill.userId != null && r.times.length > 0 && (
                      <div className="px-5 py-1.5 text-[11px] bg-[#f0faf6] text-[#1a7a5a] border-t border-[#f7f5f1]">
                        Counted for {drill.who} — worked this stage {r.times.map(t2 => fmtStamp(t2)).join(' · ')}
                      </div>
                    )}
                    {r.visibleEvents.length > 0 ? r.visibleEvents.map((e, i) => {
                      const mine = r.times.some(t2 => Math.abs(new Date(t2).getTime() - new Date(e.at).getTime()) < 60_000);
                      return (
                        <div key={i} className={`px-5 py-2 flex items-center gap-3 border-t border-[#f7f5f1] text-sm ${mine ? 'bg-[#f0faf6]' : ''}`}>
                          <span className="text-[11px] text-[#9b9890] tabular-nums w-28 shrink-0">{fmtStamp(e.at)}</span>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${actorChip(e.actor)}`}>{e.actor}</span>
                          <span className="text-[#1a1916] font-medium">{e.label}</span>
                          {e.gapDays != null && (
                            <span className={`ml-auto inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums shrink-0 ${gapTone(e.gapDays)}`}
                              title="Days since the previous step shown">
                              +{e.gapDays}d
                            </span>
                          )}
                        </div>
                      );
                    }) : (
                      <div className="px-5 py-2.5 text-sm text-[#6b6860]">
                        Worked at {r.times.map(t2 => fmtStamp(t2)).join(' · ')}
                        {(r.contractId ?? r.leadId) != null ? ' — open the record for its full history.' : '.'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── tile drill-down: the details behind each scoreboard number ── */}
          {tileDrill && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 sm:p-8 print:hidden" onClick={() => setTileDrill(null)}>
              <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b border-[#f0ede8] px-5 py-3.5 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#1a1916]">
                      {tileDrill === 'steps' ? `Pipeline steps moved — ${progressed}`
                        : tileDrill === 'delivered' ? `Leases delivered — ${delivered}`
                          : tileDrill === 'settlements' ? `Settlements paid — ${completions.totals.settlements}`
                            : `Idle manager-days — ${idleDays}`}
                    </h3>
                    <p className="text-xs text-[#6b6860] mt-0.5">
                      {tileDrill === 'steps' ? 'Where the steps happened — click a stage for the records behind it.'
                        : tileDrill === 'delivered' ? 'The leases activated in this period, and who activated them.'
                          : tileDrill === 'settlements' ? 'The deposit settlements paid out in this period.'
                            : 'Days with no in-system activity, per manager. Fridays are the day off and never count.'}
                    </p>
                  </div>
                  <button onClick={() => setTileDrill(null)} className="w-7 h-7 rounded-lg grid place-items-center text-[#9b9890] hover:bg-[#f4f3ef] hover:text-[#1a1916]">
                    <X size={15} />
                  </button>
                </div>

                {tileDrill === 'steps' && (
                  data.stageMatrix.stages.every((_, i) => !(data.stageMatrix.totals[i])) ? (
                    <p className="px-5 py-8 text-sm text-[#9b9890] text-center">No stage activity in this period.</p>
                  ) : data.stageMatrix.stages.map((stage, i) => {
                    const total = data.stageMatrix.totals[i];
                    if (!total) return null;
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => { setTileDrill(null); setDrill({ userId: null, who: 'Team', stage, count: total }); }}
                        className="w-full px-5 py-2.5 flex items-center gap-3 border-t border-[#f7f5f1] first:border-t-0 text-sm hover:bg-[#fafaf8] cursor-pointer text-left">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${stageTint(stage)}`}>{stage}</span>
                        <span className="ml-auto font-bold tabular-nums text-[#1a7a5a]">{total}</span>
                      </button>
                    );
                  })
                )}

                {(tileDrill === 'delivered' || tileDrill === 'settlements') && (() => {
                  const items = (completions.items ?? []).filter(i =>
                    tileDrill === 'delivered' ? i.kind !== 'settlement' : i.kind === 'settlement');
                  if (!items.length) {
                    return <p className="px-5 py-8 text-sm text-[#9b9890] text-center">None in this period.</p>;
                  }
                  return items.map((it, i) => (
                    <div key={i} className="px-5 py-2.5 flex items-center gap-3 border-t border-[#f7f5f1] first:border-t-0 text-sm">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                        it.kind === 'new' ? 'bg-[#d8f2e8] text-[#1a7a5a]' : it.kind === 'renewal' ? 'bg-[#e0f2fe] text-[#0369a1]' : 'bg-[#fee2e2] text-[#b91c1c]'}`}>
                        {it.kind === 'new' ? 'New lease' : it.kind === 'renewal' ? 'Renewal' : it.refund ? 'Settled · refund issued' : 'Settled'}
                      </span>
                      <span className="text-[#1a1916] truncate">{it.label}</span>
                      <span className="text-[11px] text-[#9b9890] whitespace-nowrap ml-auto">{it.actor} · {fmtStamp(it.at)}</span>
                      <Link href={`${contractsBase}/${it.contractId}/v2`} className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline shrink-0">
                        Open <ExternalLink size={11} />
                      </Link>
                    </div>
                  ));
                })()}

                {tileDrill === 'idle' && (
                  data.daily.length === 0 ? (
                    <p className="px-5 py-8 text-sm text-[#9b9890] text-center">No managers on this account.</p>
                  ) : data.daily.map(d => {
                    const idle: string[] | null = d.activeDayList && data.window
                      ? (() => {
                          const today = dubaiToday();
                          const end = data.window!.to > today ? today : data.window!.to;
                          const active = new Set(d.activeDayList);
                          const out: string[] = [];
                          for (let x = data.window!.from; x <= end; x = addDays(x, 1)) {
                            if (new Date(`${x}T00:00:00Z`).getUTCDay() === 5) continue; // Friday = day off
                            if (!active.has(x)) out.push(x);
                          }
                          return out;
                        })()
                      : null;
                    return (
                      <div key={d.userId} className="px-5 py-3 border-t border-[#f7f5f1] first:border-t-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-bold text-[#1a1916]">{d.name}</span>
                          <span className="text-xs text-[#6b6860]">{d.idleDays} idle of {d.daysInPeriod} tracked day{d.daysInPeriod === 1 ? '' : 's'}</span>
                        </div>
                        {idle && idle.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {idle.map(x => (
                              <span key={x} className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fee2e2] text-[#b91c1c]">{fmtDayShort(x)}</span>
                            ))}
                          </div>
                        )}
                        {idle && idle.length === 0 && (
                          <p className="text-xs text-[#1a7a5a] mt-1.5">Active every tracked day.</p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ── activity drill-down: exactly what one action changed ── */}
          {activityDrill && (() => {
            const a = activityDrill.action;
            return (
              <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 sm:p-8 print:hidden" onClick={() => setActivityDrill(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="sticky top-0 bg-white border-b border-[#f0ede8] px-5 py-3.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${categoryTint(a.category)}`}>{a.category}</span>
                        <h3 className="text-sm font-bold text-[#1a1916] truncate">{a.label}</h3>
                      </div>
                      <p className="text-xs text-[#6b6860] mt-1">
                        {activityDrill.who} · {a.count > 1 ? `${a.count}× between ${fmtStamp(a.firstAt)} – ${fmtStamp(a.at)}` : fmtStamp(a.at)}
                        {a.record ? <> · {a.record}</> : null}
                      </p>
                    </div>
                    <button onClick={() => setActivityDrill(null)} className="w-7 h-7 rounded-lg grid place-items-center text-[#9b9890] hover:bg-[#f4f3ef] hover:text-[#1a1916] shrink-0">
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-4">
                    {a.changes && a.changes.length > 0 ? (
                      <>
                        <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold mb-2">What changed</p>
                        <div className="rounded-xl border border-[#f0ede8] overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold">Field</th>
                                <th className="px-3 py-2 text-left font-semibold">Before</th>
                                <th className="px-3 py-2 text-left font-semibold">After</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.changes.map((c, i) => (
                                <tr key={i} className="border-t border-[#f0ede8]">
                                  <td className="px-3 py-2 font-medium text-[#3d3b35] capitalize whitespace-nowrap">{c.field}</td>
                                  <td className="px-3 py-2 text-[#9b9890] tabular-nums">{c.from ?? <span className="text-[#c8c6c0]">—</span>}</td>
                                  <td className="px-3 py-2 text-[#1a1916] font-semibold tabular-nums">{c.to ?? <span className="text-[#b91c1c]">removed</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : a.detail ? (
                      <p className="text-sm text-[#1a1916]">{a.detail}</p>
                    ) : a.category === 'Viewing' ? (
                      <p className="text-sm text-[#6b6860]">Opened this page{a.count > 1 ? ` ${a.count} times` : ''}.</p>
                    ) : null}
                    {(a.contractId ?? a.leadId) != null && (
                      <Link
                        href={a.contractId != null ? `${contractsBase}/${a.contractId}/v2` : `${leadsBase}/${a.leadId}`}
                        className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#2e9f82] hover:underline">
                        Open the record <ExternalLink size={12} />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
