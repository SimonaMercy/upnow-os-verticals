/**
 * Bounced Cheques — the accountant's own sheet, read straight off the system.
 *
 * Three tables in the sheet's shape — Date · Unit · Instalment · Cheque No. ·
 * Party's Name · Amount · remark — with a total under each:
 *   1. BOUNCED CHEQUES – <year>   every rent cheque that bounced (by the
 *                                  cheque's own date), the remark saying what
 *                                  came back, Paid / Pending, Move out, case.
 *   2. HOLD CHEQUES – <year>      cheques the customer swapped before they were
 *                                  banked (cancelled, reason 'replaced').
 *   3. BOUNCE FEES – <year>       the fee raised for each bounce, on its own.
 *
 * "Paid" = the replacement money has itself cleared in full; anything less is
 * Pending. The All / Pending / Cleared pills filter all three tables.
 *
 * Data: GET {endpointBase}/bounced-cheques?year=YYYY|all&buildings=…
 * See ReportsService.getBouncedChequesReport for the coverage rule.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Loader2, AlertCircle, Download, CalendarRange } from 'lucide-react';
import { useReportsYear, setReportsYear, REPORT_YEARS } from '@/components/upnow/reportsYear';
import { contractHref } from '@/lib/contractHref';

/* ── payload (mirror of ReportsService.BouncedChequesReport) ───────────────── */
type State = 'pending' | 'cleared';
interface Recovery {
  paymentId: number; amount: number; status: 'cleared' | 'pending' | 'bounced';
  method: string | null; chequeNumber: string | null; date: string | null;
}
interface Fee { paymentId: number; amount: number; status: 'cleared' | 'pending' | 'bounced' | 'cancelled'; date: string | null }
interface Row {
  paymentId: number; contractId: number; customer: string | null;
  propertyId: number | null; buildingName: string | null; unitLabel: string | null;
  instalment: number | null;
  chequeNumber: string | null; bankName: string | null; replacesChequeNumber: string | null; chequeDate: string | null;
  markedBouncedOn: string | null; amount: number;
  recoveredBanked: number; recoveredDue: number; undatedBalance: number; balance: number;
  state: State; inSettlement: boolean; leaseEnded: boolean;
  legalCase: { type: string; stage: string } | null;
  recoveries: Recovery[]; fees: Fee[];
}
interface Payload {
  generatedAt: string;
  year: number | null;
  buildings: { id: number; name: string }[];
  totals: {
    bounced: number; bouncedAmount: number;
    cleared: number; clearedAmount: number;
    pending: number; pendingAmount: number;
    feesPaid: number; feesPaidAmount: number;
    feesPending: number; feesPendingAmount: number;
    hold: number; holdAmount: number;
    undated: number;
  };
  rows: Row[];
  holdRows: Row[];
}
type View = 'all' | 'pending' | 'cleared';
type FeeRow = Fee & { cheque: Row };

const fmtAed = (n: number | null | undefined): string =>
  new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));
const fmtInt = (n: number): string => new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n);
/** 01-Feb-26 — the sheet's date. */
const fmtSheet = (s: string | null): string => {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  return `${String(d.getDate()).padStart(2, '0')}-${mon}-${String(d.getFullYear()).slice(2)}`;
};
const fmtShort = (s: string | null): string =>
  s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'no date';
const METHOD: Record<string, string> = { bank_transfer: 'online', cheque: 'cheque', cash: 'cash', card: 'card', online: 'online' };
const methodWord = (m: string | null) => (m ? (METHOD[m] ?? m.replace(/_/g, ' ')) : 'payment');
const DISPUTE_TYPE: Record<string, string> = {
  rent_increase: 'rent increase', maintenance: 'maintenance', eviction: 'eviction', non_payment: 'non-payment', deposit: 'deposit', other: 'other',
};
const STAGE: Record<string, string> = {
  notice_sent: 'notice sent', case_filed: 'case filed', settlement: 'settlement', decision: 'decision', enforcement: 'enforcement',
};
const toCsvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The sheet's remark column, built from the ledger. */
function remarkOf(r: Row, kind: 'bounced' | 'hold'): { chip: { label: string; tone: Tone }; notes: string[] } {
  const notes: string[] = [];
  if (r.state === 'pending' && r.balance > 0 && r.recoveries.length > 0) notes.push(`bal. ${fmtInt(r.balance)}`);
  if (r.replacesChequeNumber) notes.push(`replacement for #${r.replacesChequeNumber}`);
  if (r.leaseEnded) notes.push('Move out');
  if (r.inSettlement) notes.push('in final settlement');
  if (r.legalCase) notes.push(`${STAGE[r.legalCase.stage] ?? r.legalCase.stage} · ${DISPUTE_TYPE[r.legalCase.type] ?? r.legalCase.type} case`);
  if (kind === 'bounced' && r.markedBouncedOn) notes.push(`marked bounced ${fmtShort(r.markedBouncedOn)}`);
  let chip: { label: string; tone: Tone };
  if (r.state === 'cleared') chip = { label: 'Paid', tone: 'green' };
  else if (r.recoveredBanked > 0) chip = { label: 'Part-paid', tone: 'amber' };
  else if (kind === 'hold') chip = { label: 'Not yet paid', tone: 'amber' };
  else chip = { label: 'Pending', tone: 'red' };
  return { chip, notes };
}

/** The Replacement column — one line per cheque or transfer recorded against this cheque. */
function replacementOf(r: Row): string[] {
  return r.recoveries.map(x => {
    const what = x.method === 'cheque' ? `Cheque${x.chequeNumber ? ` #${x.chequeNumber}` : ''}` : methodWord(x.method).replace(/^./, c => c.toUpperCase());
    const when = x.date ? fmtSheet(x.date) : 'no date';
    const st = x.status === 'cleared' ? 'Cleared' : x.status === 'bounced' ? 'Bounced' : 'Pending';
    return `${what} · ${when} · ${fmtInt(x.amount)} · ${st}`;
  });
}

export function BouncedChequesReport({
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
  const [view, setView] = useState<View>('all');
  const [property, setProperty] = useState<string>('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams(extraQuery);
    q.set('year', year === 'all' ? 'all' : String(year));
    if (property) q.set('buildings', property);
    fetch(`${endpointBase}/bounced-cheques?${q.toString()}`, { credentials: 'include' })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpointBase, extraQuery, year, property]);

  const byView = (rows: Row[]) => (view === 'all' ? rows : rows.filter(r => r.state === view));
  const bounced = useMemo(() => (data ? byView(data.rows) : []), [data, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const hold = useMemo(() => (data ? byView(data.holdRows) : []), [data, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const fees = useMemo<FeeRow[]>(() => {
    if (!data) return [];
    const all = data.rows.flatMap(r => r.fees.filter(f => f.status !== 'cancelled').map(f => ({ ...f, cheque: r })));
    if (view === 'all') return all;
    return all.filter(f => (view === 'cleared' ? f.status === 'cleared' : f.status !== 'cleared'));
  }, [data, view]);
  const total = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const owed = bounced.reduce((s, r) => s + r.balance, 0);
  const feesOwed = fees.filter(f => f.status !== 'cleared').reduce((s, f) => s + f.amount, 0);
  const label = data?.year ? String(data.year) : 'All years';
  const lease = (r: Row) => contractHref(r.contractId, 'lease', managerRp ? { rp: managerRp } : undefined);

  const downloadCsv = () => {
    if (!data) return;
    const L: string[] = [];
    const H = ['Date', 'Unit', 'Instalment', 'Cheque No.', "Party's Name", 'Amount', 'Replacement', 'Remark'];
    const push = (xs: unknown[]) => L.push(xs.map(toCsvCell).join(','));
    const block = (title: string, rows: Row[], kind: 'bounced' | 'hold') => {
      push([`${title} - ${label} (${VIEW_LABEL[view]})`]);
      push(H);
      for (const r of rows) {
        const m = remarkOf(r, kind);
        push([r.chequeDate, r.unitLabel, r.instalment, r.chequeNumber, r.customer, r.amount.toFixed(2), replacementOf(r).join(' | '), [m.chip.label, ...m.notes].join(' · ')]);
      }
      push(['', '', '', '', 'Total', total(rows).toFixed(2), '', '']);
      L.push('');
    };
    block('BOUNCED CHEQUES', bounced, 'bounced');
    block('HOLD CHEQUES', hold, 'hold');
    push([`BOUNCE FEES - ${label} (${VIEW_LABEL[view]})`]);
    push(['Fee date', 'Unit', 'Instalment', 'For Cheque No.', "Party's Name", 'Amount', 'Remark']);
    for (const f of fees) push([f.date, f.cheque.unitLabel, f.cheque.instalment, f.cheque.chequeNumber, f.cheque.customer, f.amount.toFixed(2), f.status === 'cleared' ? 'Paid' : 'Pending']);
    push(['', '', '', '', 'Total', total(fees).toFixed(2), '']);
    const url = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `bounced-cheques-${data.year ?? 'all'}-${view}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6 print:py-0 text-[#1c1f1d]">
      {/* ── header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4 print:mb-2">
        <div>
          {onBack ? (
            <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#2e9f82] mb-2 print:hidden">
              <ArrowLeft size={14} /> All Reports
            </button>
          ) : (
            <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#2e9f82] mb-2 print:hidden">
              <ArrowLeft size={14} /> All Reports
            </Link>
          )}
          <h1 className="text-2xl font-bold">Bounced Cheques</h1>
          <p className="text-[12.5px] text-[#6b6860] mt-1">
            The bounced-cheque sheet for {label}, by the cheque&rsquo;s own date. <strong className="font-semibold text-[#3d3b35]">Paid</strong> = the replacement
            money has cleared in full; anything less is <strong className="font-semibold text-[#3d3b35]">Pending</strong>. Hold cheques are the ones swapped before they were banked.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <label className="inline-flex items-center gap-2 bg-white border border-[#e8e6e0] rounded-xl pl-3 pr-2 py-1.5">
            <CalendarRange size={15} className="text-[#2e9f82]" />
            <span className="text-xs font-medium text-[#6b6860]">Year</span>
            <select
              value={year === 'all' ? 'all' : String(year)}
              onChange={e => setReportsYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="text-sm font-semibold bg-transparent focus:outline-none cursor-pointer pr-1"
              aria-label="Report year">
              {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              <option value="all">All years</option>
            </select>
          </label>
          <button onClick={downloadCsv} disabled={!data} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm font-medium text-[#3d3b35] hover:border-[#2e9f82] disabled:opacity-50">
            <Download size={15} /> CSV
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#1a7a5a]">
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {loading && !data && <div className="flex items-center gap-2 text-[#6b6860] py-20 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>}
      {error && !loading && <div className="flex items-center gap-2 text-red-700 py-16 justify-center"><AlertCircle size={16} /> {error}</div>}

      {data && (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          {/* ── filter row ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 mb-5 print:hidden">
            <select
              value={property}
              onChange={e => setProperty(e.target.value)}
              className="text-sm bg-white border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none"
              aria-label="Property">
              <option value="">All properties</option>
              {data.buildings.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
            <span className="text-[12.5px] text-[#6b6860] ml-1">
              {data.totals.bounced} bounced · {data.totals.cleared} paid · {data.totals.pending} pending
              {data.totals.pending > 0 && <> — <span className="font-semibold text-[#b4532a]">AED {fmtInt(data.totals.pendingAmount)}</span> still to collect</>}
              {data.totals.hold > 0 && <> · {data.totals.hold} on hold</>}
            </span>
            <div className="ml-auto inline-flex rounded-xl border border-[#e8e6e0] bg-white p-0.5">
              {(['all', 'pending', 'cleared'] as View[]).map(v => {
                const n = v === 'all' ? data.totals.bounced : v === 'pending' ? data.totals.pending : data.totals.cleared;
                const on = view === v;
                return (
                  <button key={v} type="button" onClick={() => setView(v)}
                    className={`px-3.5 py-1.5 rounded-[10px] text-xs font-semibold transition-colors ${on ? 'bg-[#1c1f1d] text-white' : 'text-[#3d3b35] hover:bg-[#f4f3ef]'}`}>
                    {VIEW_LABEL[v]} <span className={on ? 'text-white/70' : 'text-[#8a8780]'}>· {n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 1. BOUNCED CHEQUES ─────────────────────────────────────────── */}
          <Sheet title={`Bounced Cheques – ${label}`} count={bounced.length} empty={`No ${VIEW_LABEL[view].toLowerCase()} bounced cheques ${data.year ? `in ${data.year}` : ''}.`}>
            {bounced.length > 0 && (
              <SheetTable
                rows={bounced.map(r => {
                  const m = remarkOf(r, 'bounced');
                  return { key: r.paymentId, date: r.chequeDate, unit: r.unitLabel, building: r.buildingName, instalment: r.instalment, cheque: r.chequeNumber, party: r.customer, href: lease(r), amount: r.amount, replacement: replacementOf(r), chip: m.chip, notes: m.notes };
                })}
                withReplacement
                total={total(bounced)}
                totalNote={owed > 0 ? `AED ${fmtAed(owed)} still to collect` : undefined}
              />
            )}
          </Sheet>

          {/* ── 2. HOLD CHEQUES ────────────────────────────────────────────── */}
          <Sheet title={`Hold Cheques – ${label}`} count={hold.length}
            hint="Cheques the customer asked to hold and replaced before they were banked."
            empty={`No ${VIEW_LABEL[view].toLowerCase()} hold cheques ${data.year ? `in ${data.year}` : ''}.`}>
            {hold.length > 0 && (
              <SheetTable
                rows={hold.map(r => {
                  const m = remarkOf(r, 'hold');
                  return { key: r.paymentId, date: r.chequeDate, unit: r.unitLabel, building: r.buildingName, instalment: r.instalment, cheque: r.chequeNumber, party: r.customer, href: lease(r), amount: r.amount, replacement: replacementOf(r), chip: m.chip, notes: m.notes };
                })}
                withReplacement
                total={total(hold)}
              />
            )}
          </Sheet>

          {/* ── 3. BOUNCE FEES ─────────────────────────────────────────────── */}
          <Sheet title={`Bounce Fees – ${label}`} count={fees.length}
            hint="The fee raised for each bounced cheque, separate from the cheque. Pending = the customer has not paid the fee."
            empty={`No ${VIEW_LABEL[view].toLowerCase()} bounce fees ${data.year ? `in ${data.year}` : ''}.`}>
            {fees.length > 0 && (
              <SheetTable
                dateHeader="Fee date"
                chequeHeader="For Cheque No."
                rows={fees.map(f => ({
                  key: f.paymentId, date: f.date, unit: f.cheque.unitLabel, building: f.cheque.buildingName, instalment: f.cheque.instalment,
                  cheque: f.cheque.chequeNumber, party: f.cheque.customer, href: lease(f.cheque), amount: f.amount,
                  chip: f.status === 'cleared' ? { label: 'Paid', tone: 'green' as Tone } : { label: 'Pending', tone: 'amber' as Tone },
                  notes: [`cheque dated ${fmtSheet(f.cheque.chequeDate)}`],
                }))}
                total={total(fees)}
                totalNote={feesOwed > 0 ? `AED ${fmtAed(feesOwed)} still to collect` : undefined}
              />
            )}
            <p className="text-[11px] text-[#8a8780] mt-2">
              A fee is listed under its cheque when the ledger links the two or the fee names the cheque number; a fee that names no cheque is not shown.
            </p>
          </Sheet>

          {data.totals.undated > 0 && data.year === null && (
            <p className="text-[11px] text-[#8a8780]">{data.totals.undated} bounced row{data.totals.undated === 1 ? '' : 's'} carry no cheque date and appear only under “All years”.</p>
          )}
        </div>
      )}
    </div>
  );
}

const VIEW_LABEL: Record<View, string> = { all: 'All', pending: 'Pending', cleared: 'Cleared' };
type Tone = 'green' | 'amber' | 'red' | 'grey';

/* ── the sheet blocks ──────────────────────────────────────────────────────── */
function Sheet({ title, count, hint, empty, children }: { title: string; count: number; hint?: string; empty: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-[#e8e6e0] bg-white px-4 sm:px-6 py-5 mb-5 print:border-0 print:px-0 print:mb-6 print:break-inside-avoid">
      <div className="text-center mb-3">
        <div className="text-[15px] font-extrabold tracking-wide uppercase">{title}</div>
        {hint && <div className="text-[11.5px] text-[#8a8780] mt-0.5">{hint}</div>}
      </div>
      {count === 0 ? <p className="text-[12.5px] text-[#8a8780] py-5 text-center">{empty}</p> : children}
    </div>
  );
}

interface SheetRow {
  key: number; date: string | null; unit: string | null; building: string | null; instalment: number | null;
  cheque: string | null; party: string | null; href: string; amount: number;
  replacement?: string[];
  chip: { label: string; tone: Tone }; notes: string[];
}
const CHIP: Record<Tone, string> = {
  green: 'bg-[#e6f4ef] text-[#1f6f5a]',
  amber: 'bg-[#fbeedd] text-[#9a5a14]',
  red:   'bg-[#fbe6e2] text-[#9c3a2a]',
  grey:  'bg-[#f1efe9] text-[#6b6860]',
};
function SheetTable({ rows, total, totalNote, dateHeader = 'Date', chequeHeader = 'Cheque No.', withReplacement = false }: {
  rows: SheetRow[]; total: number; totalNote?: string; dateHeader?: string; chequeHeader?: string; withReplacement?: boolean;
}) {
  const cell = 'border border-[#c9c6bd] px-2.5 py-2 align-top';
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed min-w-[880px] text-[12.5px] border-collapse">
        {withReplacement ? (
          <colgroup>
            <col style={{ width: '8%' }} /><col style={{ width: '11%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} />
            <col style={{ width: '19%' }} /><col style={{ width: '10%' }} /><col style={{ width: '20%' }} /><col style={{ width: '16%' }} />
          </colgroup>
        ) : (
          <colgroup>
            <col style={{ width: '9%' }} /><col style={{ width: '13%' }} /><col style={{ width: '8%' }} /><col style={{ width: '10%' }} />
            <col style={{ width: '25%' }} /><col style={{ width: '11%' }} /><col style={{ width: '24%' }} />
          </colgroup>
        )}
        <thead>
          <tr className="bg-[#f1efe9] text-[11px] font-bold uppercase tracking-wide">
            <th className={`${cell} text-left`}>{dateHeader}</th>
            <th className={`${cell} text-left`}>Unit</th>
            <th className={`${cell} text-center`}>Instalment</th>
            <th className={`${cell} text-left`}>{chequeHeader}</th>
            <th className={`${cell} text-left`}>Party&rsquo;s Name</th>
            <th className={`${cell} text-right`}>Amount</th>
            {withReplacement && <th className={`${cell} text-left`}>Replacement</th>}
            <th className={`${cell} text-left`}>Remark</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="hover:bg-[#fafaf7]">
              <td className={`${cell} tabular-nums whitespace-nowrap`}>{fmtSheet(r.date)}</td>
              <td className={cell}>
                <div className="font-medium">{r.unit ?? '—'}</div>
                {r.building && <div className="text-[10.5px] text-[#8a8780]">{r.building}</div>}
              </td>
              <td className={`${cell} text-center tabular-nums`}>{r.instalment ?? '—'}</td>
              <td className={`${cell} tabular-nums`}>{r.cheque ?? '—'}</td>
              <td className={cell}>
                <Link href={r.href} className="font-medium hover:text-[#2e9f82]">{r.party ?? 'Lease'}</Link>
              </td>
              <td className={`${cell} text-right tabular-nums font-semibold whitespace-nowrap`}>{fmtAed(r.amount)}</td>
              {withReplacement && (
                <td className={`${cell} text-[11.5px]`}>
                  {r.replacement && r.replacement.length > 0
                    ? r.replacement.map((line, i) => <div key={i} className="leading-snug">{line}</div>)
                    : <span className="text-[#8a8780]">—</span>}
                </td>
              )}
              <td className={`${cell} text-[11.5px]`}>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP[r.chip.tone]}`}>{r.chip.label}</span>
                {r.notes.length > 0 && <div className="text-[#6b6860] mt-0.5 leading-snug">{r.notes.join(' · ')}</div>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className={`${cell} border-r-0`} colSpan={4} />
            <td className={`${cell} border-l-0 text-right`}>Total</td>
            <td className={`${cell} text-right tabular-nums whitespace-nowrap`}>{fmtAed(total)}</td>
            <td className={`${cell} text-[11.5px] font-normal text-[#b4532a]`} colSpan={withReplacement ? 2 : 1}>{totalNote ?? ''}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
