/**
 * Manager Operations Report — manager evaluation in the merged-stage format:
 *
 *   1. Operations by stage — manager-performance-style table: one row per
 *      manager (plus the landlord's own account), one column per merged
 *      workflow stage (Lead Attended → KYC → Payment Plan → Payment Advice →
 *      Customer/Landlord Signature → Registration → Utility → Move-in →
 *      Termination → Move-out → Bill Clearance → Settlement Issued/Accepted),
 *      cells = records progressed. Every number CLICKS THROUGH to the records
 *      behind it with their full history and step durations.
 *   2. Average working day — per-manager daily output/presence scorecard.
 *   3. Stage timing — avg days to close each stage, managers side by side,
 *      customer wait separated.
 *   4. Manager actions, date by date — each person's individual operations
 *      actions grouped per day, each linking to the record.
 *
 * Data: GET /api/reports/manager-operations (landlord-only). Signatures marked
 * "on file" are never counted. Custom component (not ReportDetailView) because
 * the manager columns are dynamic.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Loader2, AlertCircle, Download, ExternalLink, X } from 'lucide-react';
import { DateRangePicker } from '@/components/upnow/DateRangePicker';
import { getReportsYear, yearToRange } from '@/components/upnow/reportsYear';
import { APP_TIME_ZONE } from '@/lib/datetime';

/* ── payload types (mirror ReportsService.ManagerOperationsReport) ─────────── */
interface ActorRow { actor: string; completed: number; avgDays: number | null; medianDays: number | null; slowestDays: number | null }
interface StageRow { stageLabel: string; side: 'manager' | 'customer' | 'landlord'; completed: number; avgDays: number | null; medianDays: number | null; items: ActorRow[] }
interface DailyRow {
  userId: number; name: string; daysInPeriod: number; activeDays: number; idleDays: number;
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
interface RecordEvent { at: string; actorUserId: number | null; actor: string; label: string; gapDays: number | null }
interface RecordLog {
  type: 'lead' | 'contract'; id: number; label: string; kind: string;
  contractId: number | null; leadId: number | null;
  firstAt: string; lastAt: string; spanDays: number;
  actorUserIds: number[]; events: RecordEvent[];
}
interface Payload {
  generatedAt: string; from: string | null; to: string | null; attributionSince: string;
  managers: Array<{ userId: number; name: string }>;
  stageMatrix: StageMatrix;
  managerActions: ManagerAction[]; managerActionsCapped: boolean;
  daily: DailyRow[]; rows: StageRow[];
  records: RecordLog[]; recordsCapped: boolean;
  totals: { stagesMeasured: number; managerAvgDays: number; customerAvgDays: number; landlordAvgDays: number };
}

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
// Step-duration tone — long waits should jump out in the history view.
const gapTone = (d: number | null) =>
  d == null ? '' : d >= 14 ? 'bg-[#fee2e2] text-[#991b1b]' : d >= 7 ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f4f3ef] text-[#6b6860]';
const actorChip = (name: string) =>
  name === 'Customer' ? 'bg-[#fef3c7] text-[#854d0e]'
    : name === 'Landlord' ? 'bg-[#d8f2e8] text-[#1a7a5a]'
      : name === '—' ? 'bg-[#f4f3ef] text-[#9b9890]'
        : 'bg-[#e0f2fe] text-[#0369a1]';

const fmtDays = (v: number | null | undefined) => (v == null ? '—' : `${v}d`);
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

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ManagerOperationsReport({
  backHref = '/rental-provider/dashboard/reports',
  contractsBase = '/rental-provider/dashboard/contracts',
  leadsBase = '/rental-provider/dashboard/leads',
}: { backHref?: string; contractsBase?: string; leadsBase?: string }) {
  const initial = yearToRange(getReportsYear());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Cell drill-down: which manager × stage the user clicked (null userId = team total). */
  const [drill, setDrill] = useState<{ userId: number | null; who: string; stage: string; count: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    fetch(`/api/reports/manager-operations${q.size ? `?${q}` : ''}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`); return r.json(); })
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to]);

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

  /* Date-wise log: person → day → actions (newest first). Uses the matrix
     rows so the landlord's own operations work shows too. */
  const managerDays = useMemo(() => {
    if (!data) return [] as Array<{ userId: number; name: string; total: number; days: Array<{ day: string; actions: ManagerAction[] }> }>;
    return data.stageMatrix.rows.map(m => {
      const mine = data.managerActions.filter(a => a.actorUserId === m.userId);
      const byDay = new Map<string, ManagerAction[]>();
      for (const a of mine) {
        const day = fmtDay(a.at);
        const arr = byDay.get(day) ?? [];
        arr.push(a);
        byDay.set(day, arr);
      }
      return { userId: m.userId, name: m.name, total: mine.length, days: [...byDay.entries()].map(([day, actions]) => ({ day, actions })) };
    });
  }, [data]);

  /* Drill-down: the records behind one clicked matrix number, each with the
     person's action time(s) at that stage and the record's full history. */
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
    return [...byRec.values()].map(r => ({
      ...r,
      journey: data.records.find(j =>
        (r.contractId != null && j.contractId === r.contractId)
        || (r.leadId != null && j.type === 'lead' && j.leadId === r.leadId)) ?? null,
    }));
  }, [drill, data]);

  const downloadCsv = () => {
    if (!data) return;
    // Their format: managers down, the merged stages across.
    const headers = ['Manager', ...data.stageMatrix.stages];
    const lines = [
      ['Team total', ...data.stageMatrix.totals.map(v => v ?? '—')],
      ...data.stageMatrix.rows.map(r => [r.name, ...r.cells.map(v => v ?? '—')]),
    ];
    const csv = [headers, ...lines].map(row => row.map(toCsvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `manager-operations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
            One row per manager across every operations stage, their average working day, stage timing —
            and each manager’s actions date by date. Signatures marked “on file” are never counted.
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

      {/* ── period ── */}
      <div className="flex items-center gap-3 mt-4 flex-wrap print:hidden">
        <span className="text-sm text-[#6b6860] font-medium">Period:</span>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        {data && (
          <span className="text-xs text-[#9b9890]">
            Detailed tracking since {fmtDate(data.attributionSince)} — in-system work only.
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6b6860] py-20 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-700 py-16 justify-center"><AlertCircle size={16} /> {error}</div>
      ) : !data ? null : (
        <>
          {/* ── 1. Operations by stage — one full row per person ── */}
          <section className="mt-6 bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
            <div className="px-5 py-3.5 border-b border-[#f0ede8]">
              <h2 className="text-sm font-bold text-[#1a1916]">Operations by stage — records each manager progressed</h2>
              <p className="text-xs text-[#6b6860] mt-0.5">
                Common stages merged across pipelines; customer and landlord signatures kept separate.
                Every stage is now individually logged (bill clearance from 15 Jul 2026 onward). Click any
                number to see the records behind it with their history.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm min-w-full">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr>
                    <th className="sticky left-0 z-10 bg-[#fafaf8] px-5 py-2.5 text-left font-semibold min-w-[170px]">Manager</th>
                    {data.stageMatrix.stages.map(s => (
                      <th key={s} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-[#1a1916]">
                  {data.stageMatrix.rows.map(r => (
                    <tr key={r.userId} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <td className="sticky left-0 z-10 bg-white px-5 py-2.5 font-semibold whitespace-nowrap">{r.name}</td>
                      {r.cells.map((v, i) => (
                        <td key={i} className={`px-3 py-2.5 text-right tabular-nums ${v ? '' : 'text-[#c8c6c0]'}`}>
                          {v == null ? '—' : v === 0 ? 0 : (
                            <button
                              onClick={() => setDrill({ userId: r.userId, who: r.name, stage: data.stageMatrix.stages[i], count: v })}
                              className="font-semibold text-[#1a7a5a] underline decoration-dotted underline-offset-2 hover:text-[#2e9f82] cursor-pointer"
                              title="See the records behind this number">
                              {v}
                            </button>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[#fafaf8] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
                  <tr>
                    <td className="sticky left-0 z-10 bg-[#fafaf8] px-5 py-2.5">Team total</td>
                    {data.stageMatrix.totals.map((v, i) => (
                      <td key={i} className={`px-3 py-2.5 text-right tabular-nums ${v ? '' : 'text-[#c8c6c0]'}`}>
                        {v == null ? '—' : v === 0 ? 0 : (
                          <button
                            onClick={() => setDrill({ userId: null, who: 'Team', stage: data.stageMatrix.stages[i], count: v })}
                            className="underline decoration-dotted underline-offset-2 hover:text-[#2e9f82] cursor-pointer"
                            title="See the records behind this number">
                            {v}
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── 2. Average working day ── */}
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

          {/* ── 3. Stage timing — managers side by side ── */}
          <section className="mt-5 bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
            <div className="px-5 py-3.5 border-b border-[#f0ede8] flex items-baseline justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#1a1916]">Stage timing — managers side by side</h2>
                <p className="text-xs text-[#6b6860] mt-0.5">Average days to close each workflow stage (count in brackets). A manager is only measured on stages whose clock is theirs.</p>
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
                              title={c ? `median ${fmtDays(c.medianDays)} · slowest ${fmtDays(c.slowestDays)}` : undefined}>
                              {c ? <><b>{fmtDays(c.avgDays)}</b> <span className="text-[#9b9890] text-xs">({c.completed})</span></> : <span className="text-[#d4d2cc]">·</span>}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap"
                          title={cust ? `median ${fmtDays(cust.medianDays)} · slowest ${fmtDays(cust.slowestDays)}` : undefined}>
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

          {/* ── 4. Manager actions, date by date ── */}
          <section className="mt-5">
            <div className="bg-white rounded-2xl border border-[#e8e6e0] px-5 py-3.5">
              <h2 className="text-sm font-bold text-[#1a1916]">Manager actions — date by date</h2>
              <p className="text-xs text-[#6b6860] mt-0.5">
                Each person’s individual operations actions, grouped per day, newest first — every row names
                the record and links to it{data.managerActionsCapped ? ' (showing the most recent — narrow the period for the rest)' : ''}.
              </p>
            </div>
            {managerDays.map(m => (
              <div key={m.userId} className="bg-white rounded-2xl border border-[#e8e6e0] mt-3 overflow-hidden print:break-inside-avoid">
                <div className="px-5 py-3 border-b border-[#f0ede8] bg-[#fafaf8] flex items-baseline justify-between">
                  <h3 className="text-sm font-bold text-[#1a1916]">{m.name}</h3>
                  <span className="text-xs text-[#9b9890]">{m.total} operations action{m.total === 1 ? '' : 's'} in this period</span>
                </div>
                {m.days.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-[#9b9890]">No operations actions in this period.</p>
                ) : m.days.map(({ day, actions }) => (
                  <div key={day}>
                    <div className="px-5 py-1.5 bg-[#fafaf8] border-t border-[#f0ede8] flex items-baseline justify-between">
                      <span className="text-xs font-bold text-[#3d3b35]">{day}</span>
                      <span className="text-[11px] text-[#9b9890]">{actions.length} action{actions.length === 1 ? '' : 's'}</span>
                    </div>
                    {actions.map((a, i) => (
                      <div key={i} className="px-5 py-2 flex items-center gap-3 border-t border-[#f7f5f1] text-sm">
                        <span className="text-[11px] text-[#9b9890] tabular-nums w-16 shrink-0">{fmtTime(a.at)}</span>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${stageTint(a.stage)}`}>{a.stage}</span>
                        <span className="text-[#1a1916] truncate">{a.record ?? '—'}</span>
                        {(a.contractId ?? a.leadId) != null && (
                          <Link
                            href={a.contractId != null ? `${contractsBase}/${a.contractId}/v2` : `${leadsBase}/${a.leadId}`}
                            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline print:hidden shrink-0">
                            Open <ExternalLink size={11} />
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </section>

          <p className="text-[11px] text-[#9b9890] mt-3">
            Generated {new Date(data.generatedAt).toLocaleString('en-AE', { timeZone: APP_TIME_ZONE })}. Only in-system work is measurable —
            calls and site visits leave no trace. Landlord-only report.
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
                      {drillData.length < drill.count ? ` shown of ${drill.count} — narrow the period for the rest` : ''} · full history with step durations
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
                    {r.journey ? r.journey.events.map((e, i) => {
                      const mine = r.times.some(t2 => Math.abs(new Date(t2).getTime() - new Date(e.at).getTime()) < 60_000);
                      return (
                        <div key={i} className={`px-5 py-2 flex items-center gap-3 border-t border-[#f7f5f1] text-sm ${mine ? 'bg-[#f0faf6]' : ''}`}>
                          <span className="text-[11px] text-[#9b9890] tabular-nums w-28 shrink-0">{fmtStamp(e.at)}</span>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${actorChip(e.actor)}`}>{e.actor}</span>
                          <span className="text-[#1a1916] font-medium">{e.label}</span>
                          {e.gapDays != null && (
                            <span className={`ml-auto inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums shrink-0 ${gapTone(e.gapDays)}`}
                              title="Days since the previous step on this record">
                              +{e.gapDays}d
                            </span>
                          )}
                        </div>
                      );
                    }) : (
                      <div className="px-5 py-2.5 text-sm text-[#6b6860]">
                        Worked at {r.times.map(t2 => fmtStamp(t2)).join(' · ')} — open the record for its full history.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
