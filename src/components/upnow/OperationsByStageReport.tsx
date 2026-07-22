/**
 * Operations by Stage — month-sheet layout. Months down the side (Jan→Dec of a
 * chosen year), our operations stages across the top, plus a "Total (Year)" row
 * that sums each stage. Each cell = how many records reached that stage that
 * month.
 *
 * Two audiences, one component:
 *   • Landlord (RP hub)        → team totals per month.
 *   • Manager (manager portal) → scoped server-side to their OWN activity, so
 *     they see just their own operation pipeline, per landlord.
 *
 * Data: GET {endpointBase}/operations-by-stage?from=YYYY-01-01&to=YYYY-12-31
 * (+ any extraQuery like rp=N). The backend returns `monthly` (12 × stages) and
 * `monthlyTotals`. "On file" signatures are never counted (backend-enforced).
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Loader2, AlertCircle, Download, ExternalLink, X } from 'lucide-react';
import { REPORT_YEARS, CURRENT_YEAR } from '@/components/upnow/reportsYear';
import { APP_TIME_ZONE } from '@/lib/datetime';

/* ── payload types (subset of ReportsService.OperationsByStageReport) ──────── */
interface ManagerSheet { userId: number; name: string; isLandlord?: boolean; monthly: number[][]; monthlyTotals: number[] }
/** One dated stage action by a person — the drill-down source behind a cell. */
interface ManagerAction {
  at: string; actorUserId: number; stage: string; record: string | null;
  contractId: number | null; leadId: number | null;
}
interface RecordEvent { at: string; actorUserId: number | null; actor: string; label: string; gapDays: number | null }
/** One contract/lead with its stage-by-stage journey (the record history). */
interface RecordLog {
  type: 'lead' | 'contract'; id: number; label: string; kind: string;
  contractId: number | null; leadId: number | null;
  firstAt: string; lastAt: string; spanDays: number;
  actorUserIds: number[]; events: RecordEvent[];
}
interface Payload {
  generatedAt: string; from: string | null; to: string | null; scoped: boolean; year: number;
  stageMatrix: { stages: string[] };
  monthly: number[][];        // [12][stages]
  monthlyTotals: number[];    // [stages]
  perManager: ManagerSheet[]; // one month × stage grid per manager
  managerActions: ManagerAction[]; // every dated stage action (capped) — cell drill-down
  records: RecordLog[];            // per-record journey/history, for the drill-down history
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dubai calendar year-month of an ISO timestamp, so cell drill-down buckets
 *  actions into the same months the server-side counts use. */
const dubaiYm = (iso: string): { year: number; month: number } => {
  const s = new Date(iso).toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE }); // YYYY-MM-DD
  return { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) - 1 };
};
const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const gapTone = (d: number | null) =>
  d == null ? '' : d >= 14 ? 'bg-[#fee2e2] text-[#991b1b]' : d >= 7 ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f4f3ef] text-[#6b6860]';
const actorChip = (name: string) =>
  name === 'Customer' ? 'bg-[#fef3c7] text-[#854d0e]'
    : name === 'Landlord' ? 'bg-[#d8f2e8] text-[#1a7a5a]'
      : name === '—' ? 'bg-[#f4f3ef] text-[#9b9890]'
        : 'bg-[#e0f2fe] text-[#0369a1]';

/** A clicked cell: which sheet (person or Overall), stage, and month (null = the
 *  year-total column). `userId` null = the Overall/whole-account sheet (all
 *  actors); a real id scopes the drill to that person's own steps. */
interface CellDrill { userId: number | null; who: string; stage: string; month: number | null; count: number }

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function OperationsByStageReport({
  endpointBase = '/api/reports',
  extraQuery,
  backHref,
  onBack,
  contractsBase = '/rental-provider/dashboard/contracts',
  leadsBase = '/rental-provider/dashboard/leads',
  reportPath = 'operations-by-stage',
  title = 'Operations by Stage',
  subtitleTeam,
  subtitleScoped,
  csvBase,
}: {
  endpointBase?: string;
  extraQuery?: string;
  backHref?: string;
  onBack?: () => void;
  /** Base for the "Open" links in the cell drill-down. */
  contractsBase?: string;
  leadsBase?: string;
  /** Report slug to fetch (default operations-by-stage). The Leasing Funnel
   *  reuses this same per-manager month-sheet + drill-down with its own slug. */
  reportPath?: string;
  title?: string;
  subtitleTeam?: string;
  subtitleScoped?: string;
  csvBase?: string;
}) {
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Cell drill-down: the records behind a clicked stage number, or null. */
  const [drill, setDrill] = useState<CellDrill | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams(extraQuery);
    q.set('from', `${year}-01-01`);
    q.set('to', `${year}-12-31`);
    q.set('year', String(year));
    fetch(`${endpointBase}/${reportPath}?${q.toString()}`)
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, endpointBase, extraQuery, reportPath]);

  const stages = data?.stageMatrix.stages ?? [];
  const yy = useMemo(() => String(year).slice(2), [year]);

  // Sheets to render.
  //  • Manager self-view: the single manager's own sheet (even if empty).
  //  • Landlord/team view: an "Overall" sheet for the whole account first, then
  //    one sheet per manager. The account owner's own-activity row is folded
  //    into Overall, never shown separately. Idle managers are dropped.
  const sheets = useMemo<ManagerSheet[]>(() => {
    if (!data) return [];
    if (data.scoped) {
      return data.perManager.filter((p, _i, arr) => arr.length === 1 || p.monthlyTotals.some(v => v > 0));
    }
    const list: ManagerSheet[] = [];
    if (data.monthlyTotals.some(v => v > 0)) {
      list.push({ userId: -1, name: 'Overall — whole account', monthly: data.monthly, monthlyTotals: data.monthlyTotals });
    }
    list.push(...data.perManager.filter(p => !p.isLandlord && p.monthlyTotals.some(v => v > 0)));
    return list;
  }, [data]);

  /* Drill-down: the records behind one clicked cell. Filter the dated stage
     actions to the clicked stage, month (Dubai calendar) and — for a person's
     sheet — that person; a null userId (Overall sheet) keeps every actor. Group
     by record and join each to its journey so the popup shows step-by-step
     history with per-step durations, mirroring the Manager Operations report. */
  const drillData = useMemo(() => {
    if (!drill || !data) return null;
    const acts = data.managerActions.filter(a => {
      if (a.stage !== drill.stage) return false;
      if (drill.userId != null && a.actorUserId !== drill.userId) return false;
      const ym = dubaiYm(a.at);
      if (ym.year !== data.year) return false;
      return drill.month == null || ym.month === drill.month;
    });
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
      // truthful after filtering to one person.
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
    const lines: unknown[][] = [];
    for (const sheet of sheets) {
      if (!data.scoped) lines.push([sheet.name]);
      lines.push(['Month', ...stages]);
      sheet.monthly.forEach((cells, m) => lines.push([`${MONTHS[m]}-${yy}`, ...cells]));
      lines.push(['Year total', ...sheet.monthlyTotals]);
      lines.push([]);
    }
    const csv = lines.map(row => row.map(toCsvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${csvBase ?? reportPath}-${year}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 print:p-0 w-full">
      {/* ── header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {onBack ? (
            <button onClick={onBack} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-sm print:hidden">
              <ArrowLeft size={14} /> All Reports
            </button>
          ) : (
            <Link href={backHref ?? '/rental-provider/dashboard/reports'} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-sm print:hidden">
              <ArrowLeft size={14} /> All Reports
            </Link>
          )}
          <h1 className="text-2xl font-bold text-[#1a1916] mt-1.5">{title}</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-[80ch]">
            {data?.scoped
              ? (subtitleScoped ?? 'The records you progressed at each stage, month by month — your own activity and operation pipeline. Signatures marked “on file” are never counted.')
              : (subtitleTeam ?? 'Records progressed at each stage, month by month — an overall sheet for your whole account, then one per manager. Signatures marked “on file” are never counted.')}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {/* year selector */}
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            aria-label="Year"
            className="px-3 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm font-semibold text-[#1a1916] focus:outline-none focus:border-[#2e9f82] cursor-pointer">
            {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={downloadCsv} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm font-medium text-[#3d3b35] hover:border-[#2e9f82]">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#1a7a5a]">
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6b6860] py-20 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-700 py-16 justify-center"><AlertCircle size={16} /> {error}</div>
      ) : !data ? null : sheets.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl border border-[#e8e6e0] px-5 py-16 text-center text-sm text-[#9b9890]">
          No operations activity recorded for {year}.
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {sheets.map(sheet => (
            <section key={sheet.userId} className="print:break-inside-avoid">
              {/* One sheet per manager. */}
              <h2 className="text-sm font-bold text-[#1a1916] mb-2">{sheet.name}</h2>
              {/* table-fixed keeps every stage column on one page — no scroll —
                  and the long headers wrap; styling matches the other report sheets. */}
              <div className="rounded-xl border border-[#e8e6e0] bg-white">
                <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
                  <colgroup>
                    <col style={{ width: '58px' }} />
                    {stages.map((_, i) => <col key={i} />)}
                  </colgroup>
                  <thead>
                    <tr className="bg-[#faf9f6] border-b border-[#e8e6e0]">
                      <th className="px-2 py-1.5 font-semibold text-[10px] uppercase tracking-wide text-[#9b9890] leading-[1.15] align-bottom text-left">Month</th>
                      {stages.map(s => (
                        <th key={s} className="px-1.5 py-1.5 font-semibold text-[10px] uppercase tracking-wide text-[#9b9890] leading-[1.15] align-bottom text-right break-words">
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.monthly.map((cells, m) => (
                      <tr key={m} className="border-b border-[#f0ede8] last:border-0 hover:bg-[#fafaf8]">
                        <td className="px-2 py-[5px] text-left font-semibold text-[#1a1916] whitespace-nowrap">{MONTHS[m]}-{yy}</td>
                        {cells.map((v, i) => (
                          <td key={i} className={`px-1.5 py-[5px] text-right tabular-nums ${v ? 'text-[#4a4742]' : 'text-[#c8c6c0]'}`}>
                            {v ? (
                              <button
                                onClick={() => setDrill({ userId: sheet.userId < 0 ? null : sheet.userId, who: sheet.userId < 0 ? 'Overall' : sheet.name, stage: stages[i], month: m, count: v })}
                                className="font-semibold text-[#1a7a5a] underline decoration-dotted underline-offset-2 hover:text-[#2e9f82] cursor-pointer print:no-underline print:text-[#4a4742]"
                                title="See the records behind this number">
                                {v}
                              </button>
                            ) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#faf9f6] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
                      <td className="px-2 py-1.5 text-left whitespace-nowrap">Year total</td>
                      {sheet.monthlyTotals.map((v, i) => (
                        <td key={i} className="px-1.5 py-1.5 text-right tabular-nums">
                          {v ? (
                            <button
                              onClick={() => setDrill({ userId: sheet.userId < 0 ? null : sheet.userId, who: sheet.userId < 0 ? 'Overall' : sheet.name, stage: stages[i], month: null, count: v })}
                              className="underline decoration-dotted underline-offset-2 hover:text-[#2e9f82] cursor-pointer print:no-underline"
                              title="See the records behind this number">
                              {v}
                            </button>
                          ) : 0}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── cell drill-down: the records behind a clicked number + their history ── */}
      {drill && drillData && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 sm:p-8 print:hidden" onClick={() => setDrill(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#f0ede8] px-5 py-3.5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#1a1916]">
                  {drill.who} — {drill.stage}
                  <span className="text-[#9b9890] font-medium"> · {drill.month == null ? year : `${MONTHS[drill.month]} ${year}`}</span>
                </h3>
                <p className="text-xs text-[#6b6860] mt-0.5">
                  {drillData.length} record{drillData.length === 1 ? '' : 's'}
                  {drillData.length < drill.count ? ` · behind ${drill.count} action${drill.count === 1 ? '' : 's'} (a record worked on more than one day counts each time)` : ''}
                  {drill.userId == null ? ' · full history with step durations' : ` · ${drill.who}’s own steps`}
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
                {/* The person's own action time(s) at this stage — visible even when
                    the journey milestones are other people's steps. */}
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
    </div>
  );
}
