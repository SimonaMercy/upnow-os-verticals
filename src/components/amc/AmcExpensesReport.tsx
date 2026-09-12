'use client';

/**
 * Month-end expenses report (owner, 10 Sep 2026: "make sure we will have a
 * clear report at month end"). The Expenses sheet, read straight off the
 * contracts book: one row per contract, Jan…Dec, YTD — grouped by property,
 * then category. Two bases: what fell DUE in the month (bills and installments
 * dated in it) and what was PAID (by payment date). Cells carry their state:
 * paid, overdue, bill awaited, upcoming.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Download } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { kindMeta, kindMetaFromRow, type KindMeta } from './AmcView';

interface MonthCell { due: number; paid: number; count: number; unbilled: number; overdue: number; paidCount: number }
interface Row {
  contractId: number; kind: string; categoryLabel: string | null; vendorName: string; propertyName: string | null;
  startDate: string | null; endDate: string | null; annualValueAed: number | null; frequency: string | null; cancelled: boolean;
  spread?: boolean; recoverable?: boolean;
  months: MonthCell[]; ytdDue: number; ytdPaid: number;
}
interface Report { year: number; categories?: Array<{ id: number; name: string; defaultKind: string; sortOrder: number; isActive: boolean }>; kinds?: Array<{ key: string; label: string; color: string | null; hasVisits: boolean; schedule: string; isActive: boolean }>; rows: Row[]; totals: { due: number[]; paid: number[]; recoverableDue?: number[]; recoverablePaid?: number[] } }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtN = (n: number) => n === 0 ? '' : n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
const scoped = (base: string, rp: number | null | undefined, path: string) => rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;

export function AmcExpensesReport({ base, rp, listHref, detailHrefOf }: { base: string; rp?: number | null; listHref: string; detailHrefOf: (id: number) => string }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [basis, setBasis] = useState<'due' | 'paid'>('due');
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
  const curMonth = Number(today.slice(5, 7)) - 1;

  const load = useCallback(() => {
    void apiGet<Report>(scoped(base, rp, `/reports/expenses?year=${year}`)).then(d => { setData(d); setErr(null); }).catch(() => setErr('Could not load the report.'));
  }, [base, rp, year]);
  useEffect(() => { load(); }, [load]);

  // Property → rows, with a subtotal line per property and a grand total.
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of data?.rows ?? []) { const k = r.propertyName ?? 'No property on the contract'; m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()].map(([name, rows]) => ({
      name, rows,
      sub: MONTHS.map((_, i) => rows.reduce((n, r) => n + r.months[i][basis], 0)),
      ytd: rows.reduce((n, r) => n + (basis === 'due' ? r.ytdDue : r.ytdPaid), 0),
    }));
  }, [data, basis]);
  const grand = data ? (basis === 'due' ? data.totals.due : data.totals.paid) : [];
  // The landlord's own kind labels and colours, when the report carries them.
  const kindOf = (k: string): KindMeta => { const r = data?.kinds?.find(x => x.key === k); return r ? kindMetaFromRow({ id: 0, key: r.key, label: r.label, hint: null, color: r.color, hasVisits: r.hasVisits, schedule: r.schedule, sortOrder: 0, isActive: r.isActive, isBuiltin: false }) : kindMeta(k); };
  const grandYtd = grand.reduce((n, x) => n + x, 0);
  // Recoverable rows (rebilled to tenants) are split out so they never mix with the landlord's own cost.
  const grandRec = data ? ((basis === 'due' ? data.totals.recoverableDue : data.totals.recoverablePaid) ?? Array(12).fill(0)) : [];
  const grandRecYtd = grandRec.reduce((n, x) => n + x, 0);
  const anyRec = (data?.rows ?? []).some(r => r.recoverable);

  /** The cell's state colours: paid green, overdue red, bill awaited amber, upcoming grey. */
  const cellStyle = (c: MonthCell, i: number): { color: string; title: string; text: string } => {
    const v = basis === 'due' ? c.due : c.paid;
    if (basis === 'paid') return { color: v ? '#1a7a52' : '#b9bdba', title: v ? `${c.paidCount} paid` : '', text: fmtN(v) };
    if (c.count === 0) return { color: '#b9bdba', title: '', text: '' };
    if (c.unbilled && !c.due) return { color: '#c47a00', title: `${c.unbilled} bill${c.unbilled === 1 ? '' : 's'} awaited`, text: 'bill?' };
    if (c.overdue) return { color: '#b42318', title: `${c.overdue} overdue`, text: fmtN(v) };
    if (c.paidCount && c.paidCount >= c.count - c.unbilled) return { color: '#1a7a52', title: 'paid', text: fmtN(v) };
    return { color: i <= curMonth ? '#1c1f1d' : '#8a8f8c', title: 'due', text: fmtN(v) };
  };

  const exportCsv = () => {
    if (!data) return;
    const head = ['Property', 'Category', 'Kind', 'Vendor', 'Contract start', 'Contract end', 'Annual value', 'Frequency', ...MONTHS.map(m => `${m} ${year}`), 'YTD'];
    const lines = [head.join(',')];
    for (const g of groups) {
      for (const r of g.rows) lines.push([g.name, r.categoryLabel ?? '', kindOf(r.kind).label, r.vendorName, r.startDate ?? '', r.endDate ?? '', r.annualValueAed ?? '', r.frequency ?? '', ...r.months.map(c => c[basis] || ''), basis === 'due' ? r.ytdDue : r.ytdPaid].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      lines.push([`${g.name} — subtotal`, '', '', '', '', '', '', '', ...g.sub.map(x => x || ''), g.ytd].map(v => `"${v}"`).join(','));
    }
    lines.push(['Total', '', '', '', '', '', '', '', ...grand.map(x => x || ''), grandYtd].map(v => `"${v}"`).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `expenses-${year}-${basis}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const th = 'text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] px-2 py-2 whitespace-nowrap';
  const td = 'px-2 py-1.5 text-[11.5px] whitespace-nowrap tabular-nums';
  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-7 py-6 text-[#1c1f1d]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] text-[#8a8f8c]"><Link href={listHref} className="hover:underline">AMC Contracts</Link> › Month-end report</p>
          <h1 className="text-[22px] font-bold tracking-[-.01em] mt-0.5">Operating expenses · {year}</h1>
          <p className="text-[12px] text-[#5b615e] mt-1">Every contract and expense on the book, by property and category, month by month. {basis === 'due' ? 'Amounts are what fell due in the month; a cell reads "bill?" while the bill is still awaited.' : 'Amounts are what was actually paid in the month.'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-lg bg-white">
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="flex border border-[#e6e8e6] rounded-lg overflow-hidden bg-white">
            {(['due', 'paid'] as const).map(b => (
              <button key={b} type="button" onClick={() => setBasis(b)} className="text-[11px] font-semibold px-3 py-[7px] cursor-pointer"
                style={basis === b ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e' }}>{b === 'due' ? 'Due in month' : 'Paid in month'}</button>
            ))}
          </div>
          <button type="button" onClick={exportCsv} disabled={!data} className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[7px] rounded-lg border border-[#d9ddda] bg-white hover:bg-[#f6f7f6] cursor-pointer disabled:opacity-40"><Download size={12} /> CSV</button>
        </div>
      </div>

      <div className="flex gap-3.5 text-[10.5px] text-[#8a8f8c] mt-3 flex-wrap">
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#1a7a52] align-middle mr-1" />Paid</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#b42318] align-middle mr-1" />Overdue</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#c47a00] align-middle mr-1" />Bill awaited</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#8a8f8c] align-middle mr-1" />Upcoming</span>
      </div>

      {err ? <p className="text-sm text-[#b42318] mt-6">{err}</p> : !data ? (
        <div className="flex items-center gap-2 py-16 justify-center text-sm text-[#8a8f8c]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-[#8a8f8c] mt-6">Nothing on the book for {year}.</p>
      ) : (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full border-collapse">
              <thead>
                <tr className="border-b border-[#eef0ee]">
                  <th className={th + ' text-left sticky left-0 bg-white z-10'}>CATEGORY · SUB-CATEGORY · VENDOR</th>
                  <th className={th + ' text-left'}>TERM</th>
                  <th className={th + ' text-right'}>VALUE / YR</th>
                  {MONTHS.map((m, i) => <th key={m} className={th + ' text-right'} style={i === curMonth && year === thisYear ? { color: '#1c1f1d' } : undefined}>{m.toUpperCase()}</th>)}
                  <th className={th + ' text-right'}>YTD</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <GroupRows key={g.name} g={g} cellStyle={cellStyle} td={td} detailHrefOf={detailHrefOf} kindOf={kindOf} />
                ))}
                {anyRec && (
                  <>
                    <tr className="border-t border-[#eef0ee] bg-[#fafbfa]">
                      <td className={td + ' font-bold text-[#5b615e] sticky left-0 bg-[#fafbfa] z-10'} colSpan={3}>Recoverable from tenants</td>
                      {grandRec.map((x, i) => <td key={i} className={td + ' text-right font-bold text-[#5b615e]'}>{fmtN(x)}</td>)}
                      <td className={td + ' text-right font-bold text-[#5b615e]'}>{fmtN(grandRecYtd)}</td>
                    </tr>
                    <tr className="bg-[#fafbfa]">
                      <td className={td + ' font-bold text-[#5b615e] sticky left-0 bg-[#fafbfa] z-10'} colSpan={3}>Landlord&apos;s own cost</td>
                      {grand.map((x, i) => <td key={i} className={td + ' text-right font-bold text-[#5b615e]'}>{fmtN(x - (grandRec[i] ?? 0))}</td>)}
                      <td className={td + ' text-right font-bold text-[#5b615e]'}>{fmtN(grandYtd - grandRecYtd)}</td>
                    </tr>
                  </>
                )}
                <tr className="border-t-2 border-[#1c1f1d] bg-[#f6f7f6]">
                  <td className={td + ' font-extrabold sticky left-0 bg-[#f6f7f6] z-10'} colSpan={3}>Total {basis === 'due' ? 'due' : 'paid'} · {year}</td>
                  {grand.map((x, i) => <td key={i} className={td + ' text-right font-extrabold'}>{fmtN(x)}</td>)}
                  <td className={td + ' text-right font-extrabold'}>{fmtN(grandYtd)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRows({ g, cellStyle, td, detailHrefOf, kindOf }: {
  g: { name: string; rows: Row[]; sub: number[]; ytd: number };
  cellStyle: (c: MonthCell, i: number) => { color: string; title: string; text: string };
  td: string; detailHrefOf: (id: number) => string; kindOf: (k: string) => KindMeta;
}) {
  return (
    <>
      <tr className="bg-[#fafbfa] border-t border-[#eef0ee]">
        <td className={td + ' font-bold sticky left-0 bg-[#fafbfa] z-10'} colSpan={16}>{g.name} <span className="text-[#8a8f8c] font-semibold">· {g.rows.length} contract{g.rows.length === 1 ? '' : 's'}</span></td>
      </tr>
      {g.rows.map(r => {
        const km = kindOf(r.kind);
        return (
          <tr key={r.contractId} className="border-t border-[#f1f3f1] hover:bg-[#fafbfa]">
            <td className={td + ' sticky left-0 bg-white z-10 max-w-[280px]'}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded-full shrink-0" style={{ background: km.bg, color: km.fg }} title={km.label}>{km.short}</span>
                <span className="font-semibold truncate">{r.categoryLabel ?? <span className="text-[#c47a00]">Uncategorised</span>}</span>
                {r.cancelled && <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded-full bg-[#f1f3f1] text-[#5b615e] shrink-0">Cancelled</span>}
                {r.spread && <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded-full bg-[#e9effc] text-[#2a5bd7] shrink-0" title="Read as one part per month of the term">spread</span>}
                {r.recoverable && <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded-full bg-[#fdf3e3] text-[#c47a00] shrink-0" title="Rebilled to tenants">recoverable</span>}
              </div>
              <Link href={detailHrefOf(r.contractId)} className="text-[10.5px] text-[#5b615e] hover:text-[#1a7a52] truncate block">{r.vendorName} · AMC-{r.contractId}</Link>
            </td>
            <td className={td + ' text-[#5b615e]'}>{r.startDate ? `${fmtD(r.startDate)} → ${fmtD(r.endDate)}` : '—'}{r.frequency ? <span className="text-[#8a8f8c]"> · {r.frequency.replace(/_/g, ' ')}</span> : null}</td>
            <td className={td + ' text-right'}>{r.annualValueAed != null ? fmtN(r.annualValueAed) : <span className="text-[#b9bdba]">variable</span>}</td>
            {r.months.map((c, i) => { const st = cellStyle(c, i); return <td key={i} className={td + ' text-right'} style={{ color: st.color }} title={st.title}>{st.text}</td>; })}
            <td className={td + ' text-right font-bold'}>{fmtN(r.months.reduce((n, c) => n + c.due, 0)) || fmtN(r.ytdPaid)}</td>
          </tr>
        );
      })}
      <tr className="border-t border-[#eef0ee] bg-[#fafbfa]">
        <td className={td + ' text-[11px] font-bold text-[#5b615e] sticky left-0 bg-[#fafbfa] z-10'} colSpan={3}>{g.name} subtotal</td>
        {g.sub.map((x, i) => <td key={i} className={td + ' text-right font-bold text-[#5b615e]'}>{fmtN(x)}</td>)}
        <td className={td + ' text-right font-bold text-[#5b615e]'}>{fmtN(g.ytd)}</td>
      </tr>
    </>
  );
}
