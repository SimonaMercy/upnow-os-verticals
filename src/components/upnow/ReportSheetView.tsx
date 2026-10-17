/**
 * Report month-sheets — the two headline reports rendered as spreadsheet-style
 * month × metric sheets, EACH ON ITS OWN VIEW (own slug, own permission):
 *   lease-activity     → Lease Activity sheet    + CSV export
 *   executive-cashflow → Executive Cashflow sheet + Excel export (Dashboard
 *                        sheet with the YTD Expected / Received block)
 * Column layout matches the CEO's reference files (lease-activity CSV and
 * Unibuild_Executive_Cashflow_Dashboard.xlsx) column for column.
 *
 * Portal-aware like ReportDetailView — RP passes the defaults; the manager
 * portal passes endpointBase '/api/manager/reports' + extraQuery 'rp=N', and
 * the manager per-report allow-list gates each slug server-side (a manager
 * without access gets the error card, never the numbers).
 *
 * Signature columns count real online signatures only ("on file" / paper
 * marks are never activity). The cashflow sheet requests scope=all — it is
 * the complete year's money, including customers who have since moved out.
 */
'use client';

import { useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, ArrowLeft, Download, CalendarRange, Building2,
} from 'lucide-react';
import { downloadCsv } from '@/lib/csv';
import {
  useReportsYear, setReportsYear, yearForMatrix, REPORT_YEARS,
} from '@/components/upnow/reportsYear';

// ─── report row shapes (as returned by the endpoints) ─────────────────────────
interface DrillItem { [k: string]: unknown }
interface LeaseRow {
  label: string; due: number; newLeases: number; deposits: number;
  renewalNotices: number; renewalContracts: number; tenantSigns: number;
  landlordSigns: number; ejariRegistered: number; ejariPending: number;
  moveOuts: number; avgDaysToSign: number | null;
  items?: DrillItem[];   // the new leases behind this month (drill-down)
}
interface BuildingOpt { id: number; name: string; leasingType: 'direct' | 'sub' | 'management'; contracts: number; }
interface LeaseReport { year: number; rows: LeaseRow[]; totals: Omit<LeaseRow, 'label'>; buildings?: BuildingOpt[]; }

interface CashRow {
  // Expected is Cleared + Pending — a bounced cheque is reported in its own
  // column and never inside it (the Cash Management rule).
  label: string; expectedFils: number; receivedFils: number; pendingFils: number;
  // Penalty is the fee CHARGED that month — read like Bounced, not like
  // Received; how much of it has actually cleared is carried separately.
  bouncedFils: number; penaltyFils: number; penaltyCollectedFils: number;
  clearedCount: number; pendingCount: number; bouncedCount: number;
  items?: DrillItem[];   // the rent cheques behind this month (drill-down)
}
interface CashTotalsShape extends Omit<CashRow, 'label'> {
  /** Occupied units + contracted annual rent — the whole book, not the selected
   *  year, and identical to the Cash Management sheet's own pair. */
  units: number; annualRentFils: number;
  bouncedOwedFils: number; bouncedReplacedFils: number;
  ytdExpectedFils: number; ytdReceivedFils: number;
  lateFils: number; notYetDueFils: number; receivableFils: number;
  collectionRate: number;
}
interface CashReport {
  year: number; rows: CashRow[]; buildings?: BuildingOpt[]; totals: CashTotalsShape;
}

// A cell drill-down: the records behind one sheet figure.
interface SheetDrillCol {
  key: string; label: string; money?: boolean; date?: boolean;
  /** Second, muted line under the value — the pairs that belong together read as
   *  one thing (customer + its unit, cheque number + its date) instead of as
   *  four separate columns to scan across. */
  sub?: string;
  /** With `date`, renders `key → rangeEnd` as one span (a contract term). */
  rangeEnd?: string;
  /** Shown when `key` is empty — a penalty has no cheque number, so its charge
   *  name stands in rather than leaving a dash. */
  fallback?: string;
  /** Status pill rather than plain text. */
  status?: boolean;
  /** Sets this column's own value larger and bolder than its second line — the
   *  unit is what a landlord scans down, the customer under it is context. */
  emphasis?: boolean;
}
interface SheetDrill {
  title: string; countLabel: string; columns: SheetDrillCol[]; items: DrillItem[];
  /** Records are grouped under this field's value (a building), each group
   *  carrying its own count and subtotal. */
  groupKey?: string;
}

interface FunnelRow {
  label: string; leadReceived: number; viewingDone: number; kycVerified: number;
  depositCollected: number; renewalNoticeSent: number; customerSigned: number;
  landlordSigned: number; registrationPending: number; registrationDone: number;
  activated: number; moveOutInspection: number; settlementSigned: number;
}
interface FunnelReport { year: number; rows: FunnelRow[]; totals: Omit<FunnelRow, 'label'>; buildings?: BuildingOpt[]; }

function useReport<T>(endpointBase: string, slug: string, extraQuery: string, year: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true); setError(null);
    const q = new URLSearchParams(extraQuery);
    q.set('year', String(year));
    fetch(`${endpointBase}/${slug}?${q.toString()}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [endpointBase, slug, extraQuery, year]);
  return { data, loading, error };
}

// ─── column layouts (mirroring the reference files) ───────────────────────────
const LEASE_COLS: { key: keyof LeaseRow; label: string }[] = [
  { key: 'label', label: 'Month' },
  { key: 'due', label: 'Due for renewal' },
  { key: 'newLeases', label: 'New contracts' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'renewalNotices', label: 'Renewal notices' },
  { key: 'renewalContracts', label: 'Renewal contracts' },
  { key: 'tenantSigns', label: 'Customer signs' },
  { key: 'landlordSigns', label: 'Landlord signs' },
  { key: 'ejariRegistered', label: 'Registration done' },
  { key: 'ejariPending', label: 'Registration pending' },
  { key: 'moveOuts', label: 'Move-outs' },
  { key: 'avgDaysToSign', label: 'Avg days to sign' },
];
// The leasing funnel — the CEO's month × stage sheet, lead through settlement.
const FUNNEL_COLS: { key: keyof FunnelRow; label: string }[] = [
  { key: 'label', label: 'Month' },
  { key: 'leadReceived', label: 'Lead Received' },
  { key: 'viewingDone', label: 'Viewing Done' },
  { key: 'kycVerified', label: 'KYC Verified' },
  { key: 'depositCollected', label: 'Deposit Collected' },
  { key: 'renewalNoticeSent', label: 'Renewal Notice Sent' },
  { key: 'customerSigned', label: 'Customer Signed' },
  { key: 'landlordSigned', label: 'Landlord Signed' },
  { key: 'registrationPending', label: 'Registration Pending' },
  { key: 'registrationDone', label: 'Registration Done' },
  { key: 'activated', label: 'Activated' },
  { key: 'moveOutInspection', label: 'Move-out Inspection' },
  { key: 'settlementSigned', label: 'Settlement Signed' },
];
const CASH_COLS: { key: keyof CashRow; label: string; money?: boolean }[] = [
  { key: 'label', label: 'Month' },
  { key: 'expectedFils', label: 'Expected', money: true },
  { key: 'receivedFils', label: 'Received', money: true },
  { key: 'pendingFils', label: 'Pending', money: true },
  { key: 'bouncedFils', label: 'Bounced', money: true },
  { key: 'penaltyFils', label: 'Penalty', money: true },
];

/** What each clickable figure in a cashflow month opens — the subset of that
 *  month's records that produced it, and what to call them. A month's records
 *  arrive as one list (rent cheques + penalty charges); these are the same
 *  partitions the backend sums, so the popup always adds up to the cell. */
const isRent = (it: DrillItem) => it.kind !== 'penalty';
const CASH_DRILL: Record<string, { title: string; countLabel: string; match: (it: DrillItem) => boolean }> = {
  label:        { title: 'All records',      countLabel: 'record', match: () => true },
  expectedFils: { title: 'Expected — rent cleared + pending', countLabel: 'cheque',
                  match: it => isRent(it) && (it.status === 'cleared' || it.status === 'pending') },
  receivedFils: { title: 'Received',         countLabel: 'cheque', match: it => isRent(it) && it.status === 'cleared' },
  pendingFils:  { title: 'Pending',          countLabel: 'cheque', match: it => isRent(it) && it.status === 'pending' },
  bouncedFils:  { title: 'Bounced cheques',  countLabel: 'cheque', match: it => isRent(it) && it.status === 'bounced' },
  penaltyFils:  { title: 'Penalties charged', countLabel: 'charge', match: it => it.kind === 'penalty' },
};

/** '2026-07-01' → '1 Jul 2026'. A popup full of ISO strings is a wall of digits;
 *  the same dates read at a glance this way. */
const fmtDate = (v: unknown) => {
  const s = v == null ? '' : String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
  const [y, m, d] = s.split('-');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${MON[Number(m) - 1] ?? m} ${y}`;
};

/** Unit order inside a building — 'Unit 2' before 'Unit 10', which a plain string
 *  sort gets backwards. Digits compare as numbers, everything else as text, so
 *  '1A' / 'G-02' / 'Shop 3' all land where the eye expects them. */
const unitRank = (v: unknown) =>
  String(v ?? '').toLowerCase().replace(/^unit\s*/, '').match(/\d+|\D+/g) ?? [];
function byUnit(a: DrillItem, b: DrillItem) {
  const ra = unitRank(a.unitLabel), rb = unitRank(b.unitLabel);
  // A record with no unit at all goes last rather than heading the block.
  if (!ra.length !== !rb.length) return ra.length ? -1 : 1;
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    const x = ra[i], y = rb[i];
    if (x == null) return -1;
    if (y == null) return 1;
    const nx = Number(x), ny = Number(y);
    const both = !Number.isNaN(nx) && !Number.isNaN(ny);
    const d = both ? nx - ny : x.localeCompare(y);
    if (d) return d;
  }
  // Same unit — a lease can carry several records in one month (rent plus the
  // fee charged against it); keep those in date order.
  return String(a.dueDate ?? a.startDate ?? '').localeCompare(String(b.dueDate ?? b.startDate ?? ''));
}

/** The popup's records, blocked by building (or one unnamed block when the drill
 *  sets no groupKey) and ordered by unit within each block. Blocks are ordered by
 *  size — the property carrying most of the figure first — and each carries its
 *  own money subtotal. */
function groupDrillItems(drill: SheetDrill): { key: string; items: DrillItem[]; totalFils: number }[] {
  const total = (items: DrillItem[]) => items.reduce((s, it) => s + Number(it.amountFils ?? it.annualRentFils ?? 0), 0);
  if (!drill.groupKey) return [{ key: '', items: [...drill.items].sort(byUnit), totalFils: total(drill.items) }];
  const by = new Map<string, DrillItem[]>();
  for (const it of drill.items) {
    const k = String(it[drill.groupKey] ?? '') || 'Unassigned property';
    (by.get(k) ?? by.set(k, []).get(k)!).push(it);
  }
  return [...by.entries()]
    .map(([key, items]) => ({ key, items: items.sort(byUnit), totalFils: total(items) }))
    .sort((a, b) => b.totalFils - a.totalFils || b.items.length - a.items.length || a.key.localeCompare(b.key));
}

const fmtAed = (fils: number | null | undefined) =>
  new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(Number(fils ?? 0) / 100));
const aed = (fils: number | null | undefined) => Math.round(Number(fils ?? 0) / 100);
const datestamp = () => new Date().toISOString().slice(0, 10);

// ─── the sheet table — compact enough that a full year never scrolls ──────────
function SheetTable<R extends { label: string; items?: DrillItem[] }>({ cols, rows, totals, render, drillKeys, onDrill }: {
  cols: { key: keyof R; label: string }[];
  rows: R[];
  totals: Record<string, unknown>;
  render: (row: R | null, key: keyof R) => string;
  /** These columns' cells become buttons opening the records behind THAT figure
   *  — one clickable month name left the reader with a mixed list and no way to
   *  find the two cheques behind a Bounced total. */
  drillKeys?: (keyof R)[];
  onDrill?: (row: R, key: keyof R) => void;
}) {
  return (
    <div className="rounded-xl border border-[#e4e9e5] bg-white overflow-x-auto">
      <table className="w-full border-collapse text-[11px] leading-tight">
        <thead>
          <tr className="bg-[#faf9f6] border-b border-[#e4e9e5]">
            {cols.map((c, i) => (
              <th key={String(c.key)} className={`px-2 py-1.5 font-semibold text-[10px] uppercase tracking-wide text-[#8a948d] leading-[1.15] align-bottom ${i === 0 ? 'text-left' : 'text-right'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-b border-[#f0ede8] last:border-0 hover:bg-[#f6f8f6]">
              {cols.map((c, i) => {
                const v = render(r, c.key);
                const canDrill = !!drillKeys?.includes(c.key) && onDrill && (r.items?.length ?? 0) > 0 && v !== '' && v !== '0';
                return (
                  <td key={String(c.key)} className={`px-2 py-[5px] whitespace-nowrap tabular-nums ${i === 0 ? 'text-left font-semibold text-[#14201a]' : `text-right ${v === '0' || v === '' ? 'text-[#c8c6c0]' : 'text-[#4a4742]'}`}`}>
                    {canDrill ? (
                      <button
                        onClick={() => onDrill!(r, c.key)}
                        className="font-semibold text-[#1a7a5a] underline decoration-dotted underline-offset-2 hover:text-[#047246] cursor-pointer print:no-underline print:text-[#4a4742]"
                        title="See the records behind this number">
                        {v}
                      </button>
                    ) : v === '' && i > 0 ? '—' : v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#faf9f6] border-t-2 border-[#e4e9e5] font-bold text-[#14201a]">
            {cols.map((c, i) => (
              <td key={String(c.key)} className={`px-2 py-1.5 whitespace-nowrap tabular-nums ${i === 0 ? 'text-left' : 'text-right'}`}>
                {i === 0 ? 'Year total' : render(totals as unknown as R | null, c.key)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── the cashflow header + reconciliation ─────────────────────────────────────
/** The pair every collection report opens with (Occupied units · Annual rent),
 *  then the selected year's money. Occupied units and Annual rent span the whole
 *  book — whole lease terms, not one calendar year — so they read the same here
 *  as on Cash Management, Cheques Management and Rent vs Asking. */
function CashTotals({ totals, year }: { totals: CashTotalsShape; year: number }) {
  const tiles: { label: string; value: string; sub?: string; green?: boolean }[] = [
    { label: 'Occupied units', value: String(totals.units ?? 0) },
    { label: 'Annual rent', value: `AED ${fmtAed(totals.annualRentFils)}` },
    { label: `Expected ${year}`, value: `AED ${fmtAed(totals.expectedFils)}` },
    { label: `Received ${year}`, value: `AED ${fmtAed(totals.receivedFils)}`, green: true },
    { label: 'Late — chase this', value: `AED ${fmtAed(totals.lateFils)}` },
    // The fee charged, with what has cleared beneath it — a penalty raised and
    // not yet paid is still owed, and showing only the collected part left the
    // figure at zero on a book where every fee of the year was still pending.
    {
      label: `Penalty ${year}`,
      value: `AED ${fmtAed(totals.penaltyFils)}`,
      sub: `AED ${fmtAed(totals.penaltyCollectedFils)} collected`,
      green: true,
    },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
      {tiles.map(t => (
        <div key={t.label} className="bg-white rounded-xl border border-[#e4e9e5] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">{t.label}</p>
          <p className={`text-sm font-bold tabular-nums mt-0.5 ${t.green ? 'text-[#1a7a5a]' : 'text-[#14201a]'}`}>{t.value}</p>
          {t.sub && <p className="text-[10px] text-[#8a948d] tabular-nums">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/** The arithmetic stated under the sheet — the same three panels the Cash
 *  Management sheet carries, so the two pages can be read against each other
 *  line by line. */
function CashPanels({ totals, year }: { totals: CashTotalsShape; year: number }) {
  const panels: { title: string; note: string; rows: { label: string; value: number; total?: boolean; note?: string }[] }[] = [
    {
      title: 'What is actually late',
      note: 'A single “outstanding” figure adds these together and reads far worse than reality. Only the first line is money to chase; Expected is cheques already held for dates that have not arrived. Same cut-off as the Cash Management sheet.',
      rows: [
        { label: 'Fallen due so far', value: totals.ytdExpectedFils },
        { label: 'Collected against it', value: totals.ytdReceivedFils },
        { label: 'Late — chase this', value: totals.lateFils, total: true },
        { label: 'Expected — post-dated cheques ahead of us', value: totals.notYetDueFils },
      ],
    },
    {
      title: 'Bounced cheques',
      note: 'A bounce that was made good is reported but never added into Expected — its replacement cheque already sits inside Received, so counting both would count the money twice. A bounce nobody replaced is still owed, and is added back below.',
      rows: [
        { label: 'Bounced and replaced', value: totals.bouncedReplacedFils, note: 'already inside Received — excluded' },
        { label: 'Bounced, never replaced', value: totals.bouncedOwedFils, total: true, note: 'still owed — chase alongside the late rent' },
      ],
    },
    {
      title: `${year} against the book`,
      note: 'Annual rent is what the leases are contracted at across their whole terms, so it is deliberately NOT one calendar year of cheques — a lease starting in August is paid across two years. The Cash Management sheet imposes no year at all; add its years together and they come back to that figure.',
      rows: [
        { label: `Expected ${year} — received + pending`, value: totals.expectedFils },
        { label: 'Bounced, never replaced', value: totals.bouncedOwedFils },
        { label: `Everything receivable in ${year}`, value: totals.receivableFils, total: true },
        { label: 'Annual rent contracted (whole book)', value: totals.annualRentFils },
      ],
    },
  ];
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 mt-5 print:break-inside-avoid">
      {panels.map(panel => (
        <div key={panel.title}>
          <div className="text-[12px] font-bold text-[#14201a] mb-2">{panel.title}</div>
          <table className="w-full text-[12px] border border-[#e4e9e5] rounded-lg overflow-hidden bg-white">
            <tbody>
              {panel.rows.map(r => (
                <tr key={r.label} className={`border-b border-[#f0ede8] last:border-b-0 ${r.total ? 'bg-[#eef1ef] font-bold text-[#14201a]' : 'text-[#5f6b63]'}`}>
                  <td className="px-3 py-2 text-left">
                    {r.label}
                    {r.note && <span className="block text-[10.5px] text-[#8a948d] font-normal">{r.note}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-[#14201a]">{fmtAed(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-[#5f6b63] mt-2 leading-relaxed">{panel.note}</p>
        </div>
      ))}
    </div>
  );
}

function StateCard({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-[#e4e9e5] p-10 flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-[#047246]" />
        <span className="ml-2 text-sm text-[#5f6b63]">Loading…</span>
      </div>
    );
  }
  const denied = error && /\b40[13]\b/.test(error);
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-700">
      <AlertCircle size={14} />
      {denied
        ? 'You don’t have access to this report.'
        : <>Could not load this report{error ? ` (${error})` : ''}.</>}
    </div>
  );
}

// ─── exports — reproduce the reference files ──────────────────────────────────
function exportLeaseCsv(report: LeaseReport) {
  const rows = report.rows.map(r => [
    r.label, ...LEASE_COLS.slice(1).map(c => {
      const v = r[c.key];
      return v == null ? '' : String(v);
    }),
  ]);
  downloadCsv(`lease-activity-${datestamp()}.csv`, LEASE_COLS.map(c => c.label), rows);
}

function exportFunnelCsv(report: FunnelReport) {
  const rows = report.rows.map(r => [
    r.label, ...FUNNEL_COLS.slice(1).map(c => String(r[c.key] ?? 0)),
  ]);
  rows.push(['Year total', ...FUNNEL_COLS.slice(1).map(c => String(report.totals[c.key as keyof Omit<FunnelRow, 'label'>] ?? 0))]);
  downloadCsv(`leasing-funnel-${report.year}.csv`, FUNNEL_COLS.map(c => c.label), rows);
}

async function exportCashXlsx(report: CashReport) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UpNow';
  const ws = wb.addWorksheet('Dashboard');
  const money = '#,##0';

  const head = ws.addRow(CASH_COLS.map(c => c.label));
  head.font = { bold: true };
  for (const r of report.rows) {
    const row = ws.addRow(CASH_COLS.map(c =>
      c.key === 'label' ? r.label : c.money ? aed(r[c.key] as number) : Number(r[c.key] ?? 0)));
    CASH_COLS.forEach((c, i) => { if (c.money) row.getCell(i + 1).numFmt = money; });
  }
  // The footer is every month of the year added up, post-dated cheques included
  // — it is the year total, and calling it YTD contradicted the YTD block beside
  // it, which stops at the current month.
  const tot = ws.addRow(CASH_COLS.map(c =>
    c.key === 'label' ? 'Year total' : c.money ? aed(report.totals[c.key] as number) : Number(report.totals[c.key] ?? 0)));
  tot.font = { bold: true };
  CASH_COLS.forEach((c, i) => { if (c.money) tot.getCell(i + 1).numFmt = money; });

  // The reference file's side block, one blank column clear of the sheet — YTD
  // Expected / YTD Received first (the year-to-date figures that tie to Cash
  // Management), then the reconciliation the page states under the table, so the
  // file says what the report says. Positioned off CASH_COLS so dropping a
  // column from the sheet never leaves a gulf between the two.
  const labelCol = CASH_COLS.length + 2;
  const valueCol = labelCol + 1;
  const put = (row: number, label: string, value: number, count = false) => {
    const lc = ws.getRow(row).getCell(labelCol);
    const vc = ws.getRow(row).getCell(valueCol);
    lc.value = label;
    vc.value = count ? Number(value ?? 0) : aed(value);
    if (!count) vc.numFmt = money;
  };
  put(2, 'YTD Expected', report.totals.ytdExpectedFils);
  put(3, 'YTD Received', report.totals.ytdReceivedFils);
  ws.getRow(2).getCell(labelCol).font = { bold: true };
  ws.getRow(3).getCell(labelCol).font = { bold: true };

  const side: [string, number][] = [
    ['Late — chase this', report.totals.lateFils],
    ['Expected — post-dated cheques ahead', report.totals.notYetDueFils],
    ['Penalty charged', report.totals.penaltyFils],
    ['Penalty collected', report.totals.penaltyCollectedFils],
    ['Bounced and replaced', report.totals.bouncedReplacedFils],
    ['Bounced, never replaced', report.totals.bouncedOwedFils],
    ['Everything receivable', report.totals.receivableFils],
    ['Annual rent contracted (whole book)', report.totals.annualRentFils],
    ['Occupied units', report.totals.units],
  ];
  side.forEach(([label, value], i) => put(5 + i, label, value, label === 'Occupied units'));
  ws.getColumn(1).width = 8;
  for (let i = 2; i <= CASH_COLS.length; i++) ws.getColumn(i).width = 12;
  // Wide enough for the reconciliation labels sitting in the side block.
  ws.getColumn(labelCol).width = 34;
  ws.getColumn(valueCol).width = 14;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Executive_Cashflow_Dashboard-${report.year}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── the two sheet views ──────────────────────────────────────────────────────
const SHEETS = {
  'lease-activity': {
    title: 'Lease Activity',
    subtitle: 'The leasing year, month by month. Signature columns count real online signatures only.',
    exportLabel: 'Export CSV',
  },
  'executive-cashflow': {
    title: 'Executive Cashflow',
    subtitle: 'Rent expected vs received, pending, bounced and the penalty income collected, month by month. Expected is received + pending on the earning leases — a bounce is reported beside it, never inside it, so this is the selected year of the Cash Management sheet.',
    exportLabel: 'Export Excel',
  },
  'leasing-funnel': {
    title: 'Leasing Funnel by Manager',
    subtitle: 'Contracts reaching each stage of the leasing journey — lead to settlement — month by month. Signature columns count real online signatures only.',
    exportLabel: 'Export CSV',
  },
} as const;
export type SheetSlug = keyof typeof SHEETS;
export const SHEET_SLUGS = Object.keys(SHEETS) as SheetSlug[];

export default function ReportSheetView({
  slug,
  endpointBase = '/api/reports',
  extraQuery = '',
  onBack,
}: {
  slug: SheetSlug;
  endpointBase?: string;
  extraQuery?: string;
  onBack: () => void;
}) {
  const hubYear = useReportsYear();
  const year = yearForMatrix(hubYear);
  const [exporting, setExporting] = useState(false);
  // Property / leasing-model filters ('all' = no filter).
  const [buildingId, setBuildingId] = useState<number | 'all'>('all');
  const [leaseType, setLeaseType] = useState<'all' | 'direct' | 'sub' | 'management'>('all');
  const isCash = slug === 'executive-cashflow';
  const isFunnel = slug === 'leasing-funnel';
  // Cell drill-down popup (records behind a sheet figure).
  const [drill, setDrill] = useState<SheetDrill | null>(null);
  // "Open contract" base — matches the portal (RP vs manager) via the endpoint.
  const contractsBase = endpointBase.includes('manager')
    ? '/dashboard/manager/contracts'
    : '/rental-provider/dashboard/contracts';

  // Compose the query — portal scope (rp=N), whole-portfolio money on the cashflow
  // sheet (scope=all), plus the property + leasing-model filters.
  const params = new URLSearchParams(extraQuery);
  if (isCash) params.set('scope', 'all');
  if (buildingId !== 'all') params.set('buildings', String(buildingId));
  if (leaseType !== 'all') params.set('leaseTypes', leaseType);
  const query = params.toString();
  const { data, loading, error } = useReport<LeaseReport | CashReport | FunnelReport>(endpointBase, slug, query, year);
  const cfg = SHEETS[slug];
  // Property options are filter-independent (the backend always returns the full
  // set), so the picker stays stable while the figures narrow.
  const buildingOpts = data?.buildings ?? [];

  const doExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      if (isCash) await exportCashXlsx(data as CashReport);
      else if (isFunnel) exportFunnelCsv(data as FunnelReport);
      else exportLeaseCsv(data as LeaseReport);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#5f6b63] hover:text-[#14201a] mb-4">
        <ArrowLeft size={15} /> All reports
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-[#14201a]">{cfg.title}</h1>
          <p className="text-xs text-[#5f6b63] mt-0.5">{cfg.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Property filter — options come from the report (filter-independent). */}
          <label className="inline-flex items-center gap-1.5 bg-white border border-[#e4e9e5] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
            <Building2 size={14} className="text-[#047246]" />
            <select
              value={String(buildingId)}
              onChange={e => setBuildingId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="text-sm font-semibold text-[#14201a] bg-transparent focus:outline-none cursor-pointer pr-1 max-w-[170px]"
              aria-label="Property">
              <option value="all">All properties</option>
              {buildingOpts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {/* Leasing model — Lease (direct) / Sub-lease / Management. */}
          <label className="inline-flex items-center gap-1.5 bg-white border border-[#e4e9e5] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
            <select
              value={leaseType}
              onChange={e => setLeaseType(e.target.value as typeof leaseType)}
              className="text-sm font-semibold text-[#14201a] bg-transparent focus:outline-none cursor-pointer pr-1"
              aria-label="Lease type">
              <option value="all">All lease types</option>
              <option value="direct">Lease</option>
              <option value="sub">Sub-lease</option>
              <option value="management">Management</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 bg-white border border-[#e4e9e5] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
            <CalendarRange size={14} className="text-[#047246]" />
            <select
              value={String(year)}
              onChange={e => setReportsYear(Number(e.target.value))}
              className="text-sm font-semibold text-[#14201a] bg-transparent focus:outline-none cursor-pointer pr-1"
              aria-label="Year">
              {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button
            onClick={doExport}
            disabled={exporting || loading || !!error}
            className="inline-flex items-center gap-1.5 bg-[#047246] hover:bg-[#278a71] disabled:opacity-50 text-white text-sm font-semibold rounded-xl px-3.5 py-2">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {cfg.exportLabel}
          </button>
        </div>
      </div>

      {loading || error || !data ? <StateCard loading={loading} error={error} /> : isFunnel ? (
        <SheetTable
          cols={FUNNEL_COLS}
          rows={(data as FunnelReport).rows}
          totals={(data as FunnelReport).totals as unknown as Record<string, unknown>}
          render={(row, key) => {
            if (!row) return '';
            const v = row[key];
            return v == null ? '' : String(v);
          }}
        />
      ) : !isCash ? (
        <SheetTable
          cols={LEASE_COLS}
          rows={(data as LeaseReport).rows}
          totals={(data as LeaseReport).totals as unknown as Record<string, unknown>}
          drillKeys={['newLeases']}
          onDrill={row => setDrill({
            title: `${row.label} · New contracts`,
            countLabel: 'lease',
            groupKey: 'buildingName',
            columns: [
              { key: 'unitLabel', label: 'Unit · Customer', sub: 'tenantName', emphasis: true },
              { key: 'contractRef', label: 'Contract' },
              { key: 'startDate', label: 'Contract term', date: true, rangeEnd: 'endDate' },
              { key: 'annualRentFils', label: 'Annual rent', money: true },
            ],
            items: row.items ?? [],
          })}
          render={(row, key) => {
            if (!row) return '';
            const v = row[key];
            return v == null ? '' : String(v);
          }}
        />
      ) : (
        <>
          {/* Opens with the pair every collection report opens with — Occupied
              units, Annual rent — then the year's own money. The two chips here
              used to be labelled YTD and carried the FULL-YEAR figures, which
              contradicted the YTD block in the exported file. */}
          <CashTotals totals={(data as CashReport).totals} year={(data as CashReport).year} />
          <SheetTable
            cols={CASH_COLS}
            rows={(data as CashReport).rows}
            totals={(data as CashReport).totals as unknown as Record<string, unknown>}
            // Every figure in the row opens its OWN records — clicking Bounced
            // lists the bounced cheques, Penalty lists the fees. The month name
            // still opens everything.
            drillKeys={['label', 'expectedFils', 'receivedFils', 'pendingFils', 'bouncedFils', 'penaltyFils']}
            onDrill={(row, key) => {
              const f = CASH_DRILL[key as keyof typeof CASH_DRILL];
              const items = (row.items ?? []).filter(f.match);
              setDrill({
                title: `${row.label} · ${f.title}`,
                countLabel: f.countLabel,
                groupKey: 'buildingName',
                columns: [
                  // Unit leads — it is what the landlord scans for; the customer
                  // (the company name where the lease is to a company) sits under
                  // it. Long trade names would otherwise crowd out the unit.
                  { key: 'unitLabel', label: 'Unit · Customer', sub: 'tenantName', emphasis: true },
                  { key: 'contractStart', label: 'Contract term', date: true, rangeEnd: 'contractEnd' },
                  // A penalty carries no cheque number, so the charge names
                  // itself here — the Type column is gone, and a fee still has
                  // to be tellable from rent in the all-records view.
                  { key: 'chequeNumber', label: 'Cheque', sub: 'dueDate', fallback: 'typeLabel' },
                  { key: 'amountFils', label: 'Amount', money: true },
                  { key: 'status', label: 'Status', status: true },
                ],
                items,
              });
            }}
            render={(row, key) => {
              if (!row) return '';
              const col = CASH_COLS.find(c => c.key === key);
              const v = row[key];
              if (col?.money) return fmtAed(v as number);
              return v == null ? '' : String(v);
            }}
          />
          <p className="text-[10px] text-[#8a948d] mt-2">All amounts in AED. Anchored on the cheque date; cancelled cheques excluded; includes customers who have since moved out. Expected is Received + Pending — a bounced cheque is reported beside it, never inside it. Penalty is the penalty / late fee charged in the month — bounced-cheque, replacement and deferral charges plus the late/early lifecycle penalties — read like Bounced: reported beside the rent, never inside it, whether or not it has been collected yet. The header tile says how much of the year’s penalties actually cleared. Click any figure in a month — Expected, Received, Pending, Bounced or Penalty — for the records behind that number; the month name opens all of them.</p>
          <CashPanels totals={(data as CashReport).totals} year={(data as CashReport).year} />
        </>
      )}

      {/* Cell drill-down: the records behind a sheet figure */}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={() => setDrill(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
              <div>
                <h3 className="text-base font-bold text-[#14201a]">{drill.title}</h3>
                {/* The subset's own total, so the popup can be checked against
                    the cell that opened it without adding the rows up by hand. */}
                <p className="text-xs text-[#5f6b63] mt-0.5">
                  {drill.items.length} {drill.countLabel}{drill.items.length === 1 ? '' : 's'}
                  {drill.items.some(it => it.amountFils != null) && (
                    <> · <span className="font-semibold text-[#14201a] tabular-nums">
                      AED {fmtAed(drill.items.reduce((s, it) => s + Number(it.amountFils ?? 0), 0))}
                    </span></>
                  )}
                </p>
              </div>
              <button onClick={() => setDrill(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5f6b63] hover:bg-[#eef1ef]">✕</button>
            </div>
            <div className="overflow-auto">
              {drill.items.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-[#8a948d]">No records for this period.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-[#f6f8f6] text-[10px] uppercase tracking-wide text-[#8a948d] sticky top-0 z-10">
                    <tr>
                      {drill.columns.map(c => (
                        <th key={c.key} className={`px-4 py-2.5 font-semibold ${c.money ? 'text-right' : 'text-left'}`}>{c.label}</th>
                      ))}
                      <th className="px-4 py-2.5" aria-hidden />
                    </tr>
                  </thead>
                  {/* One block per building — a flat list of thirty cheques from
                      six properties is unreadable, and the landlord thinks by
                      building. Each block states its own count and subtotal. */}
                  {groupDrillItems(drill).map(g => (
                    <tbody key={g.key}>
                      {drill.groupKey && (
                        <tr className="bg-[#eef1ef] border-t border-[#e3e0d9]">
                          <td colSpan={drill.columns.length + 1} className="px-4 py-2">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-[#14201a]">{g.key}</span>
                              <span className="text-[10px] text-[#5f6b63] tabular-nums">
                                {g.items.length} {drill.countLabel}{g.items.length === 1 ? '' : 's'}
                                {g.totalFils > 0 && <> · <span className="font-semibold text-[#14201a]">AED {fmtAed(g.totalFils)}</span></>}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {g.items.map((it, idx) => (
                        <tr key={idx} className="border-t border-[#f0ede8] hover:bg-[#f6f8f6] align-top">
                          {drill.columns.map(c => {
                            const raw = it[c.key];
                            // A bounce has to be findable in a mixed month list —
                            // thirty cleared cheques and two bounced ones read as
                            // "all cleared" when every row looks the same.
                            if (c.status) {
                              const s = String(raw ?? '');
                              const tone = s === 'bounced' ? 'bg-[#fee2e2] text-[#b91c1c]'
                                : s === 'cleared' ? 'bg-[#dcf5ec] text-[#1a7a5a]'
                                : s === 'pending' ? 'bg-[#fef3c7] text-[#92400e]'
                                : 'bg-[#eef1ef] text-[#5f6b63]';
                              return (
                                <td key={c.key} className="px-4 py-2.5 text-left">
                                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${tone}`}>{s || '—'}</span>
                                </td>
                              );
                            }
                            // A contract term is one fact, so it reads as one
                            // span rather than two date columns to line up.
                            if (c.rangeEnd) {
                              const end = it[c.rangeEnd];
                              return (
                                <td key={c.key} className="px-4 py-2.5 text-left whitespace-nowrap text-[#14201a] tabular-nums">
                                  {raw == null && end == null ? '—' : <>{fmtDate(raw)} <span className="text-[#8a948d]">→</span> {fmtDate(end)}</>}
                                </td>
                              );
                            }
                            const val = raw == null || String(raw) === ''
                              ? (c.fallback ? it[c.fallback] : null)
                              : raw;
                            const text = val == null || String(val) === '' ? '—'
                              : c.money ? `AED ${fmtAed(Number(val))}`
                              : c.date ? fmtDate(val)
                              : String(val);
                            const sub = c.sub ? it[c.sub] : null;
                            return (
                              <td key={c.key} className={`px-4 py-2.5 ${c.money ? 'text-right tabular-nums font-semibold' : 'text-left'} text-[#14201a]`}>
                                <div className={c.emphasis ? 'text-[13px] font-bold whitespace-nowrap' : undefined}>{text}</div>
                                {sub != null && String(sub) !== '' && (
                                  <div className={`text-[10px] text-[#8a948d] mt-0.5 leading-tight ${c.emphasis ? 'max-w-[210px]' : ''}`}>
                                    {c.sub === 'dueDate' || /date$/i.test(c.sub ?? '') ? fmtDate(sub) : String(sub)}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2.5 text-right">
                            {it.contractId != null && (
                              <a href={`${contractsBase}/${it.contractId}/v2`} className="inline-flex items-center gap-1 text-xs font-medium text-[#047246] hover:underline whitespace-nowrap">Open ↗</a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
