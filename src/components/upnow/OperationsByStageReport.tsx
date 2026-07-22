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
import { ArrowLeft, Printer, Loader2, AlertCircle, Download } from 'lucide-react';
import { REPORT_YEARS, CURRENT_YEAR } from '@/components/upnow/reportsYear';

/* ── payload types (subset of ReportsService.OperationsByStageReport) ──────── */
interface ManagerSheet { userId: number; name: string; monthly: number[][]; monthlyTotals: number[] }
interface Payload {
  generatedAt: string; from: string | null; to: string | null; scoped: boolean; year: number;
  stageMatrix: { stages: string[] };
  monthly: number[][];        // [12][stages]
  monthlyTotals: number[];    // [stages]
  perManager: ManagerSheet[]; // one month × stage grid per manager
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
}: {
  endpointBase?: string;
  extraQuery?: string;
  backHref?: string;
  onBack?: () => void;
  /** kept for call-site compatibility (unused in the month-sheet layout) */
  contractsBase?: string;
  leadsBase?: string;
}) {
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams(extraQuery);
    q.set('from', `${year}-01-01`);
    q.set('to', `${year}-12-31`);
    fetch(`${endpointBase}/operations-by-stage?${q.toString()}`)
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, endpointBase, extraQuery]);

  const stages = data?.stageMatrix.stages ?? [];
  const yy = useMemo(() => String(year).slice(2), [year]);

  // Sheets to render — one per manager. Idle people are dropped from the team
  // view; the self-view always shows the single manager (even if empty).
  const sheets = useMemo(
    () => (data?.perManager ?? []).filter((p, _i, arr) => arr.length === 1 || p.monthlyTotals.some(v => v > 0)),
    [data],
  );

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
    a.download = `operations-by-stage-${year}.csv`;
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
          <h1 className="text-2xl font-bold text-[#1a1916] mt-1.5">Operations by Stage</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-[80ch]">
            {data?.scoped
              ? 'The records you progressed at each stage, month by month — your own activity and operation pipeline. Signatures marked “on file” are never counted.'
              : 'Records each manager progressed at each stage, month by month — one sheet per manager. Signatures marked “on file” are never counted.'}
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
                            {v || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#faf9f6] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
                      <td className="px-2 py-1.5 text-left whitespace-nowrap">Year total</td>
                      {sheet.monthlyTotals.map((v, i) => (
                        <td key={i} className="px-1.5 py-1.5 text-right tabular-nums">{v || 0}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
