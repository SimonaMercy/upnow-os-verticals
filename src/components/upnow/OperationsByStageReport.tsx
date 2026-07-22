/**
 * Operations by Stage — the stage × person matrix ("records each manager
 * progressed") lifted out of the full Manager Operations report into a report
 * of its own. Just this one section: stages down the side grouped by pipeline,
 * people across the top, every number clickable into the records behind it with
 * their history.
 *
 * Two audiences, one component:
 *   • Landlord (RP hub)      → the whole team, every person a column.
 *   • Manager (manager portal) → scoped server-side to their OWN row, so they
 *     see just their own activity and operation pipeline.
 *
 * Data: GET {endpointBase}/operations-by-stage (+ from/to, + any extraQuery like
 * rp=N). The backend decides the scope; the FE just renders whatever rows it
 * gets. "On file" signatures are never counted (enforced backend-side).
 */
'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Loader2, AlertCircle, Download, ExternalLink, X } from 'lucide-react';
import { DateRangePicker } from '@/components/upnow/DateRangePicker';
import { APP_TIME_ZONE } from '@/lib/datetime';

/* ── payload types (subset of ReportsService.OperationsByStageReport) ──────── */
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
interface CompletionRow { userId: number | null; name: string; newLeases: number; renewals: number; settlements: number; refunds: number }
interface Completions { rows: CompletionRow[]; totals: { newLeases: number; renewals: number; settlements: number; refunds: number } }
interface Payload {
  generatedAt: string; from: string | null; to: string | null; scoped: boolean;
  managers: Array<{ userId: number; name: string }>;
  stageMatrix: StageMatrix;
  managerActions: ManagerAction[];
  records: RecordLog[];
  completions: Completions;
}

/* ── period presets — Dubai calendar ──────────────────────────────────────── */
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
interface Range { from: string; to: string }
function rangeFor(preset: Preset, customFrom: string, customTo: string): Range {
  const today = dubaiToday();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: mondayOf(today), to: today };
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: customFrom, to: customTo };
}

/* ── house palette (validated in ReportCharts) — fixed order per person ───── */
const PALETTE = ['#2e9f82', '#1e5fae', '#b45309', '#8250df'];
const OTHERS = '#9b9890';

const gapTone = (d: number | null) =>
  d == null ? '' : d >= 14 ? 'bg-[#fee2e2] text-[#991b1b]' : d >= 7 ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f4f3ef] text-[#6b6860]';
const actorChip = (name: string) =>
  name === 'Customer' ? 'bg-[#fef3c7] text-[#854d0e]'
    : name === 'Landlord' ? 'bg-[#d8f2e8] text-[#1a7a5a]'
      : name === '—' ? 'bg-[#f4f3ef] text-[#9b9890]'
        : 'bg-[#e0f2fe] text-[#0369a1]';

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });

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
}: {
  endpointBase?: string;
  extraQuery?: string;
  backHref?: string;
  onBack?: () => void;
  contractsBase?: string;
  leadsBase?: string;
}) {
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState(() => addDays(dubaiToday(), -29));
  const [customTo, setCustomTo] = useState(() => dubaiToday());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Cell drill-down: which person × stage the user clicked (null userId = team total). */
  const [drill, setDrill] = useState<{ userId: number | null; who: string; stage: string; count: number } | null>(null);

  const cur = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams(extraQuery);
    q.set('from', cur.from);
    q.set('to', cur.to);
    fetch(`${endpointBase}/operations-by-stage?${q.toString()}`)
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cur.from, cur.to, endpointBase, extraQuery]);

  /** People in matrix-row order — colours follow this order so a person keeps their hue. */
  const people = data?.stageMatrix.rows ?? [];
  const colorOf = (idx: number) => (idx < PALETTE.length ? PALETTE[idx] : OTHERS);
  const grouped14 = data?.stageMatrix.stages.length === 14;

  /** Leases delivered per person (new + renewals), for the matrix footer. */
  const deliveredBy = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of data?.completions.rows ?? []) if (r.userId != null) m.set(r.userId, r.newLeases + r.renewals);
    return m;
  }, [data]);

  /* Drill-down: the records behind one clicked matrix number, each with the
     person's action time(s) at that stage and the record's history. A specific
     person's cell shows ONLY their own steps; the Team cell shows every party's. */
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
    const headers = ['Person', ...data.stageMatrix.stages, 'Leases Activated'];
    const lines = [
      ...data.stageMatrix.rows.map(r => [r.name, ...r.cells.map(v => v ?? '—'), deliveredBy.get(r.userId) ?? 0]),
    ];
    if (!data.scoped) {
      lines.unshift(['Team total', ...data.stageMatrix.totals.map(v => v ?? '—'), data.completions.totals.newLeases + data.completions.totals.renewals]);
    }
    const csv = [headers, ...lines].map(row => row.map(toCsvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `operations-by-stage-${cur.from}-to-${cur.to}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 print:p-0 max-w-[1250px]">
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
          <h1 className="text-2xl font-bold text-[#1a1916] mt-1.5">Operations by Stage</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-[72ch]">
            {data?.scoped
              ? 'The records you progressed, stage by stage — your own activity and operation pipeline for the period. Click any number to see the records behind it with their history.'
              : 'Records each manager progressed, stage by stage. Click any number to see the records behind it with their history. Signatures marked “on file” are never counted.'}
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
        <span className="text-xs text-[#9b9890]">{fmtDate(cur.from)} – {fmtDate(cur.to)}</span>
      </div>
      <p className="hidden print:block text-xs text-[#6b6860] mt-2">Period {fmtDate(cur.from)} – {fmtDate(cur.to)}.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6b6860] py-20 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-700 py-16 justify-center"><AlertCircle size={16} /> {error}</div>
      ) : !data ? null : people.length === 0 ? (
        <div className="mt-6 bg-white rounded-2xl border border-[#e8e6e0] px-5 py-16 text-center text-sm text-[#9b9890]">
          No operations activity recorded in this period.
        </div>
      ) : (
        <>
          {/* ── Operations by stage — stages down, people across ── */}
          <section className="mt-5 bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
            <div className="px-5 py-3.5 border-b border-[#f0ede8]">
              <h2 className="text-sm font-bold text-[#1a1916]">Operations by stage — records each manager progressed</h2>
              <p className="text-xs text-[#6b6860] mt-0.5">
                Stages down the side grouped by pipeline (KYC → Payment Advice serve both the Lead intake
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
                    {!data.scoped && <th className="px-4 py-2.5 text-right font-semibold border-l border-[#e8e6e0]">Team</th>}
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
                            <td colSpan={people.length + (data.scoped ? 1 : 2)} className={`px-5 py-1.5 text-[10px] font-bold uppercase tracking-wide ${band.cls}`}>{band.label}</td>
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
                          {!data.scoped && (
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
                          )}
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
                    {!data.scoped && (
                      <td className="px-4 py-2.5 text-right tabular-nums border-l border-[#e8e6e0]">
                        {data.completions.totals.newLeases + data.completions.totals.renewals}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── cell drill-down: the records behind one clicked number ── */}
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
        </>
      )}
    </div>
  );
}
