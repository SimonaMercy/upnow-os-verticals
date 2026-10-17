/**
 * Move-out Reasons — why customers left, from the coded reason captured at
 * move-out (migration 0198).
 *
 * The report answers three questions in order, and the order is the point:
 *   1. WHY they left      — reason counts, biggest first.
 *   2. WHO drove it       — customer-driven / landlord-driven / breach. A wall
 *                           of "customer" is churn to compete with; a wall of
 *                           "landlord" is self-inflicted; "breach" is a
 *                           screening problem. Different problem, different fix.
 *   3. HOW it ended       — terminated / renewal declined / term ran out.
 * Then the leases themselves, with length of stay and the rent that walked.
 *
 * HONESTY: leases that ended before 0198 (and every plain expiry) carry no
 * code. They are counted as "Not recorded" and stay IN the denominator, so a
 * reason's % never flatters itself by quietly shrinking the base. The coverage
 * bar at the top says exactly how much of the answer is real.
 *
 * Data: GET {endpointBase}/move-out-reasons?year=YYYY|all
 * See ReportsService.getMoveOutReasonsReport for what counts as a move-out.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Printer, Loader2, AlertCircle, Download, LogOut,
  CalendarRange, Clock, HelpCircle,
} from 'lucide-react';
import { DirhamSign } from '@/components/ui/DirhamSign';
import { useReportsYear, setReportsYear, REPORT_YEARS } from '@/components/upnow/reportsYear';
import { contractHref } from '@/lib/contractHref';

/* ── payload (mirror of ReportsService.MoveOutReasonsReport) ───────────────── */
type Side = 'customer' | 'landlord' | 'breach';
type Path = 'termination' | 'renewal_declined' | 'expired';

interface ReasonCount {
  code: string | null;
  label: string;
  side: Side | null;
  count: number;
  pct: number;
  annualRentFils: number;
}
interface Row {
  contractId: number;
  customer: string | null;
  propertyId: number | null;
  buildingName: string | null;
  unitLabel: string | null;
  moveOutDate: string;
  path: Path;
  initiatedBy: 'tenant' | 'rental_provider' | null;
  reasonCode: string | null;
  reasonLabel: string;
  reasonSide: Side | null;
  reasonNote: string | null;
  tenancyStart: string | null;
  tenancyMonths: number | null;
  annualRentFils: number;
}
interface Payload {
  generatedAt: string;
  year: number | null;
  totals: {
    moveOuts: number; coded: number; notRecorded: number; codedRate: number;
    annualRentFils: number; avgTenancyMonths: number | null;
  };
  byReason: ReasonCount[];
  bySide: ReasonCount[];
  byPath: { path: Path; label: string; count: number }[];
  byMonth: { month: number; label: string; total: number; byCode: Record<string, number> }[];
  rows: Row[];
}

/* ── colour ────────────────────────────────────────────────────────────────
 * The reason bars are ONE series (magnitude, not identity) so they are one
 * hue — colour carries no meaning there and the label does the work.
 *
 * The side rollup IS identity, so it gets three hues, validated with the
 * dataviz palette checker against a white surface (worst adjacent pair:
 * deutan ΔE 18.9 / normal ΔE 23.0 — comfortably clear of the floors).
 * "Not recorded" is deliberately grey and hatched: it is the ABSENCE of a
 * category, not a fourth one, and should never read as a peer of the others. */
const JADE = '#047246';
const SIDE_FILL: Record<Side, string> = {
  customer: '#047246',
  landlord: '#6b6ad8',
  breach: '#c9553f',
};
const NULL_FILL = '#8a948d';

/* ── formatting ────────────────────────────────────────────────────────────── */
const fmtAed = (fils: number | null | undefined): string =>
  new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Number(fils ?? 0) / 100);
const fmtDate = (s: string | null): string =>
  s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtStay = (months: number | null): string => {
  if (months === null) return '—';
  if (months < 12) return `${months} mo`;
  const y = Math.floor(months / 12), m = months % 12;
  return m ? `${y}y ${m}m` : `${y}y`;
};
const toCsvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const PATH_HINT: Record<Path, string> = {
  termination: 'An accepted termination — mutual or direct.',
  renewal_declined: 'The customer declined the renewal and vacated at term end.',
  expired: 'The term ran out and nothing continued it.',
};

export function MoveOutReasonsReport({
  endpointBase = '/api/reports',
  extraQuery,
  backHref = '/rental-provider/dashboard/reports',
  onBack,
  managerRp,
}: {
  endpointBase?: string;
  /** e.g. `rp=12` — the manager portal scopes every report to one landlord. */
  extraQuery?: string;
  backHref?: string;
  /** The manager hub navigates in place rather than by route. */
  onBack?: () => void;
  /** Set in the manager portal so lease links carry the landlord scope. */
  managerRp?: number;
}) {
  const year = useReportsYear();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Clicking a reason bar filters the lease table to that reason. */
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams(extraQuery);
    q.set('year', year === 'all' ? 'all' : String(year));
    fetch(`${endpointBase}/move-out-reasons?${q.toString()}`, { credentials: 'include' })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then(d => { if (alive) { setData(d); setFocus(null); } })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpointBase, extraQuery, year]);

  const shown = useMemo(() => {
    if (!data) return [];
    if (focus === null) return data.rows;
    return data.rows.filter(r => (r.reasonCode ?? '__none__') === focus);
  }, [data, focus]);

  const downloadCsv = () => {
    if (!data) return;
    const period = data.year ? String(data.year) : 'All years';
    const lines: string[] = [];
    lines.push([`Move-out Reasons — ${period}`].map(toCsvCell).join(','));
    lines.push([`${data.totals.moveOuts} move-outs · ${data.totals.coded} with a recorded reason (${data.totals.codedRate}%)`].map(toCsvCell).join(','));
    lines.push('');
    lines.push(['Reason', 'Side', 'Move-outs', 'Share %', 'Annual Rent (AED)'].map(toCsvCell).join(','));
    for (const r of data.byReason) {
      lines.push([r.label, r.side ? SIDE_LABEL[r.side] : '—', r.count, r.pct, fmtAed(r.annualRentFils)].map(toCsvCell).join(','));
    }
    lines.push(['Total', '', data.totals.moveOuts, 100, fmtAed(data.totals.annualRentFils)].map(toCsvCell).join(','));
    lines.push('');
    lines.push(['Who drove it', 'Move-outs', 'Share %'].map(toCsvCell).join(','));
    for (const s of data.bySide) lines.push([s.label, s.count, s.pct].map(toCsvCell).join(','));
    lines.push('');
    lines.push(['Customer', 'Unit', 'Property', 'Move-out date', 'How it ended', 'Reason', 'Who drove it', 'Details', 'Tenancy started', 'Length of stay', 'Annual Rent (AED)'].map(toCsvCell).join(','));
    for (const r of data.rows) {
      lines.push([
        r.customer, r.unitLabel, r.buildingName, r.moveOutDate,
        PATH_LABEL[r.path], r.reasonLabel, r.reasonSide ? SIDE_LABEL[r.reasonSide] : '—',
        r.reasonNote, r.tenancyStart, fmtStay(r.tenancyMonths), fmtAed(r.annualRentFils),
      ].map(toCsvCell).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `move-out-reasons-${data.year ?? 'all'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const maxCount = data ? Math.max(1, ...data.byReason.map(r => r.count)) : 1;
  const maxMonth = data ? Math.max(1, ...data.byMonth.map(m => m.total)) : 1;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 print:py-0">
      {/* ── header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5 print:mb-3">
        <div>
          {onBack ? (
            <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#5f6b63] hover:text-[#047246] mb-2 print:hidden">
              <ArrowLeft size={14} /> All Reports
            </button>
          ) : (
            <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-[#5f6b63] hover:text-[#047246] mb-2 print:hidden">
              <ArrowLeft size={14} /> All Reports
            </Link>
          )}
          <h1 className="text-2xl font-bold text-[#26241f] flex items-center gap-2">
            <LogOut size={22} className="text-[#047246]" /> Move-out Reasons
          </h1>
          <p className="text-sm text-[#5f6b63] mt-1 max-w-3xl">
            Why customers left, from the reason recorded when the tenancy ended. A move-out is an accepted
            termination, a renewal declined to vacate, or a term that ran out with nothing continuing it —
            voided leases and tenancies that simply renewed are not move-outs and are excluded.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <label className="inline-flex items-center gap-2 bg-white border border-[#e4e9e5] rounded-xl pl-3 pr-2 py-1.5">
            <CalendarRange size={15} className="text-[#047246]" />
            <span className="text-xs font-medium text-[#5f6b63]">Year</span>
            <select
              value={year === 'all' ? 'all' : String(year)}
              onChange={e => setReportsYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="text-sm font-semibold text-[#14201a] bg-transparent focus:outline-none cursor-pointer pr-1"
              aria-label="Report year">
              {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              <option value="all">All years</option>
            </select>
          </label>
          <button onClick={downloadCsv} disabled={!data} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#e4e9e5] bg-white text-sm font-medium text-[#46534c] hover:border-[#047246] disabled:opacity-50">
            <Download size={15} /> CSV
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#047246] text-white text-sm font-semibold hover:bg-[#1a7a5a]">
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {loading && <div className="flex items-center gap-2 text-[#5f6b63] py-20 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>}
      {error && !loading && <div className="flex items-center gap-2 text-red-700 py-16 justify-center"><AlertCircle size={16} /> {error}</div>}

      {data && !loading && data.totals.moveOuts === 0 && (
        <div className="rounded-2xl border border-dashed border-[#e4e9e5] bg-white p-10 text-center">
          <p className="text-sm font-semibold text-[#26241f]">No move-outs {data.year ? `in ${data.year}` : 'on record'}.</p>
          <p className="text-xs text-[#8a8780] mt-1">Nobody left in this period — try another year.</p>
        </div>
      )}

      {data && !loading && data.totals.moveOuts > 0 && (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Kpi label="Move-outs" value={String(data.totals.moveOuts)} sub={data.year ? `in ${data.year}` : 'all years'} Icon={LogOut} />
            <Kpi label="Reason recorded" value={`${data.totals.codedRate}%`} sub={`${data.totals.coded} of ${data.totals.moveOuts}`} Icon={HelpCircle} tone={data.totals.codedRate < 60 ? 'warn' : undefined} />
            <Kpi label="Annual rent that left" value={fmtAed(data.totals.annualRentFils)} sub="contracted rent of the leases that ended" Icon={DirhamSign} />
            <Kpi label="Average stay" value={fmtStay(data.totals.avgTenancyMonths === null ? null : Math.round(data.totals.avgTenancyMonths))} sub="first day in the unit → move-out" Icon={Clock} />
          </div>

          {/* Coverage bar — how much of everything below is actually recorded. */}
          {data.totals.notRecorded > 0 && (
            <div className="rounded-2xl border border-[#e4e9e5] bg-white p-4 mb-6">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs font-semibold text-[#26241f]">Reason coverage</span>
                <span className="text-xs text-[#8a8780]">
                  {data.totals.notRecorded} move-out{data.totals.notRecorded === 1 ? '' : 's'} with no recorded reason
                </span>
              </div>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-[#f1efe9]" role="img"
                aria-label={`${data.totals.codedRate}% of move-outs have a recorded reason`}>
                <div style={{ width: `${data.totals.codedRate}%`, background: JADE }} className="rounded-l-full" />
              </div>
              <p className="text-[11px] text-[#8a8780] mt-2">
                Uncoded move-outs stay in every total below as “Not recorded”, so no percentage is inflated by
                leaving them out. Leases that ended before reasons were captured will never fill in.
              </p>
            </div>
          )}

          {/* ── 1. Why they left ───────────────────────────────────────────── */}
          <Section
            title="Why they left"
            subtitle="One series — bar length is the count. Click a reason to filter the leases below; click again to clear.">
            <div className="grid gap-1.5">
              {data.byReason.filter(r => r.count > 0).map(r => {
                const key = r.code ?? '__none__';
                const on = focus === key;
                const isNull = r.code === null;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFocus(on ? null : key)}
                    title={`${r.label} — ${r.count} move-out${r.count === 1 ? '' : 's'} (${r.pct}%), ${fmtAed(r.annualRentFils)} AED annual rent`}
                    className={`grid grid-cols-[minmax(140px,190px)_1fr_auto] items-center gap-3 text-left rounded-lg px-2 py-1.5 -mx-2 transition-colors ${on ? 'bg-[#eef7f3]' : 'hover:bg-[#f7f6f2]'}`}
                  >
                    <span className={`text-xs truncate ${isNull ? 'text-[#8a8780] italic' : 'text-[#46534c]'}`}>{r.label}</span>
                    <span className="h-5 bg-[#eef1ef] rounded-[4px] overflow-hidden">
                      <span
                        className="block h-full rounded-[4px]"
                        style={{
                          width: `${Math.max(2, (r.count / maxCount) * 100)}%`,
                          background: isNull ? NULL_FILL : JADE,
                          opacity: isNull ? 0.55 : 1,
                        }}
                      />
                    </span>
                    <span className="text-xs tabular-nums text-[#26241f] font-semibold w-[86px] text-right">
                      {r.count} <span className="text-[#8a8780] font-normal">· {r.pct}%</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {data.byReason.every(r => r.count === 0 || r.code === null) && (
              <p className="text-xs text-[#8a8780] mt-3">
                No coded reasons yet — every move-out here predates the reason picker. New terminations will populate this.
              </p>
            )}
          </Section>

          {/* ── 2. Who drove it ────────────────────────────────────────────── */}
          <Section
            title="Who drove it"
            subtitle="The same move-outs read by whose decision ended the tenancy. Customer-driven is churn to compete with; landlord-driven is your own doing; breach is a screening problem.">
            <div className="flex h-7 rounded-[4px] overflow-hidden gap-[2px] mb-3">
              {data.bySide.filter(s => s.count > 0).map(s => (
                <div
                  key={s.label}
                  title={`${s.label} — ${s.count} (${s.pct}%)`}
                  style={{
                    width: `${s.pct}%`,
                    background: s.side ? SIDE_FILL[s.side] : NULL_FILL,
                    // Hatch marks the null slot so it is legible as "absent"
                    // without colour, in print and for CVD readers alike.
                    backgroundImage: s.side ? undefined
                      : 'repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0 3px, transparent 3px 6px)',
                  }}
                  className="first:rounded-l-[4px] last:rounded-r-[4px]"
                />
              ))}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {data.bySide.map(s => (
                <div key={s.label} className="flex items-baseline gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-[3px] shrink-0 translate-y-[1px]"
                    style={{
                      background: s.side ? SIDE_FILL[s.side] : NULL_FILL,
                      backgroundImage: s.side ? undefined
                        : 'repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0 2px, transparent 2px 4px)',
                    }}
                  />
                  <span className="text-xs text-[#46534c]">{s.label}</span>
                  <span className="text-xs tabular-nums font-semibold text-[#26241f] ml-auto">{s.count}</span>
                  <span className="text-xs tabular-nums text-[#8a8780] w-11 text-right">{s.pct}%</span>
                </div>
              ))}
            </div>
          </Section>

          {/* ── 3. How it ended + when ─────────────────────────────────────── */}
          <div className="grid lg:grid-cols-2 gap-4 mb-6">
            <div className="rounded-2xl border border-[#e4e9e5] bg-white p-4 sm:p-5">
              <div className="text-base font-semibold text-[#26241f] mb-1">How the tenancy ended</div>
              <div className="text-xs text-[#8a8780] mb-3">The mechanism, not the reason.</div>
              <div className="grid gap-1.5">
                {data.byPath.map(p => (
                  <div key={p.path} className="grid grid-cols-[minmax(120px,150px)_1fr_auto] items-center gap-3" title={PATH_HINT[p.path]}>
                    <span className="text-xs text-[#46534c]">{p.label}</span>
                    <span className="h-5 bg-[#eef1ef] rounded-[4px] overflow-hidden">
                      <span className="block h-full rounded-[4px]" style={{ width: `${Math.max(2, (p.count / data.totals.moveOuts) * 100)}%`, background: JADE }} />
                    </span>
                    <span className="text-xs tabular-nums font-semibold text-[#26241f] w-8 text-right">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {data.byMonth.length > 0 && (
              <div className="rounded-2xl border border-[#e4e9e5] bg-white p-4 sm:p-5">
                <div className="text-base font-semibold text-[#26241f] mb-1">When they left</div>
                <div className="text-xs text-[#8a8780] mb-3">Move-outs per month of {data.year}.</div>
                <div className="flex items-end gap-[2px] h-28">
                  {data.byMonth.map(m => (
                    <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${m.label} — ${m.total} move-out${m.total === 1 ? '' : 's'}`}>
                      <span className="text-[10px] tabular-nums text-[#8a8780]">{m.total || ''}</span>
                      <span
                        className="w-full rounded-t-[4px]"
                        style={{ height: `${m.total ? Math.max(4, (m.total / maxMonth) * 84) : 2}px`, background: m.total ? JADE : '#f1efe9' }}
                      />
                      <span className="text-[10px] text-[#8a8780]">{m.label.slice(0, 1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── 4. The leases themselves ───────────────────────────────────── */}
          <Section
            title={focus === null ? 'Move-outs' : `Move-outs — ${data.byReason.find(r => (r.code ?? '__none__') === focus)?.label ?? ''}`}
            subtitle="Click a customer to open the lease."
            action={focus !== null
              ? <button onClick={() => setFocus(null)} className="text-xs text-[#047246] font-semibold hover:underline">Show all {data.totals.moveOuts}</button>
              : undefined}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-left text-[#5f6b63] border-b border-[#e4e9e5]">
                    <th className="py-2.5 pr-4 font-medium">Customer</th>
                    <th className="py-2.5 px-3 font-medium">Unit</th>
                    <th className="py-2.5 px-3 font-medium">Moved out</th>
                    <th className="py-2.5 px-3 font-medium">Reason</th>
                    <th className="py-2.5 px-3 font-medium">How it ended</th>
                    <th className="py-2.5 px-3 font-medium text-right">Stay</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Annual Rent</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.contractId} className="border-b border-[#f1efe9] hover:bg-[#f7f6f2] group align-top">
                      <td className="py-2.5 pr-4">
                        <Link href={contractHref(r.contractId, 'lease', managerRp ? { rp: managerRp } : undefined)} className="font-medium text-[#26241f] group-hover:text-[#047246]">
                          {r.customer ?? `Lease #${r.contractId}`}
                        </Link>
                      </td>
                      <td className="py-2.5 px-3 text-[#46534c]">
                        {r.unitLabel ?? '—'}
                        {r.buildingName && <div className="text-xs text-[#8a8780]">{r.buildingName}</div>}
                      </td>
                      <td className="py-2.5 px-3 text-[#5f6b63] text-xs">{fmtDate(r.moveOutDate)}</td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-[2px] shrink-0"
                            style={{ background: r.reasonSide ? SIDE_FILL[r.reasonSide] : NULL_FILL }} />
                          <span className={r.reasonCode ? 'text-[#26241f]' : 'text-[#8a8780] italic'}>{r.reasonLabel}</span>
                        </span>
                        {r.reasonNote && (
                          <div className="text-xs text-[#8a8780] mt-0.5 max-w-[280px] whitespace-normal">{r.reasonNote}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-[#5f6b63]" title={PATH_HINT[r.path]}>
                        {PATH_LABEL[r.path]}
                        {r.initiatedBy && (
                          <div className="text-[#8a8780]">by {r.initiatedBy === 'tenant' ? 'customer' : 'you'}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-[#46534c] text-xs">{fmtStay(r.tenancyMonths)}</td>
                      <td className="py-2.5 pl-3 text-right tabular-nums font-semibold text-[#26241f]">{fmtAed(r.annualRentFils)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[#8a8780] mt-3">
              All amounts in AED. “Stay” runs from the customer&rsquo;s first day in that unit, so a renewed
              tenancy counts its whole length, not just the final term.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}

const SIDE_LABEL: Record<Side, string> = {
  customer: 'Customer-driven',
  landlord: 'Landlord-driven',
  breach: 'Breach',
};
const PATH_LABEL: Record<Path, string> = {
  termination: 'Terminated',
  renewal_declined: 'Renewal declined',
  expired: 'Term ended',
};

/* ── small presentational helpers (same shapes as the other report views) ──── */
function Kpi({ label, value, sub, Icon, tone }: {
  label: string; value: string; sub?: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  tone?: 'warn';
}) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-[#e4e9e5] bg-white'}`}>
      <div className="flex items-center gap-1.5 text-xs text-[#5f6b63]"><Icon size={13} /> {label}</div>
      <div className="text-xl font-bold text-[#26241f] mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[#8a8780] mt-0.5">{sub}</div>}
    </div>
  );
}
function Section({ title, subtitle, action, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#e4e9e5] bg-white p-4 sm:p-5 mb-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-[#26241f]">{title}</div>
          {subtitle && <div className="text-xs text-[#8a8780] mt-0.5">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
