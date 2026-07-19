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
interface LeaseRow {
  label: string; due: number; newLeases: number; deposits: number;
  renewalNotices: number; renewalContracts: number; tenantSigns: number;
  landlordSigns: number; ejariRegistered: number; ejariPending: number;
  moveOuts: number; avgDaysToSign: number | null;
}
interface BuildingOpt { id: number; name: string; leasingType: 'direct' | 'sub' | 'management'; contracts: number; }
interface LeaseReport { year: number; rows: LeaseRow[]; totals: Omit<LeaseRow, 'label'>; buildings?: BuildingOpt[]; }

interface CashRow {
  label: string; expectedFils: number; receivedFils: number; pendingFils: number;
  bouncedFils: number; penaltyFils: number; netIncomeFils: number;
  clearedCount: number; pendingCount: number; bouncedCount: number;
}
interface CashReport { year: number; rows: CashRow[]; totals: Omit<CashRow, 'label'>; buildings?: BuildingOpt[]; }

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
const CASH_COLS: { key: keyof CashRow; label: string; money?: boolean }[] = [
  { key: 'label', label: 'Month' },
  { key: 'expectedFils', label: 'Expected', money: true },
  { key: 'receivedFils', label: 'Received', money: true },
  { key: 'pendingFils', label: 'Pending', money: true },
  { key: 'bouncedFils', label: 'Bounced', money: true },
  { key: 'penaltyFils', label: 'Penalty', money: true },
  { key: 'netIncomeFils', label: 'Net Income', money: true },
  { key: 'clearedCount', label: 'Cleared Cnt' },
  { key: 'pendingCount', label: 'Pending Cnt' },
  { key: 'bouncedCount', label: 'Bounced Cnt' },
];

const fmtAed = (fils: number | null | undefined) =>
  new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(Number(fils ?? 0) / 100));
const aed = (fils: number | null | undefined) => Math.round(Number(fils ?? 0) / 100);
const datestamp = () => new Date().toISOString().slice(0, 10);

// ─── the sheet table — compact enough that a full year never scrolls ──────────
function SheetTable<R extends { label: string }>({ cols, rows, totals, render }: {
  cols: { key: keyof R; label: string }[];
  rows: R[];
  totals: Record<string, unknown>;
  render: (row: R | null, key: keyof R) => string;
}) {
  return (
    <div className="rounded-xl border border-[#e8e6e0] bg-white overflow-x-auto">
      <table className="w-full border-collapse text-[11px] leading-tight">
        <thead>
          <tr className="bg-[#faf9f6] border-b border-[#e8e6e0]">
            {cols.map((c, i) => (
              <th key={String(c.key)} className={`px-2 py-1.5 font-semibold text-[10px] uppercase tracking-wide text-[#9b9890] leading-[1.15] align-bottom ${i === 0 ? 'text-left' : 'text-right'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-b border-[#f0ede8] last:border-0 hover:bg-[#fafaf8]">
              {cols.map((c, i) => {
                const v = render(r, c.key);
                return (
                  <td key={String(c.key)} className={`px-2 py-[5px] whitespace-nowrap tabular-nums ${i === 0 ? 'text-left font-semibold text-[#1a1916]' : `text-right ${v === '0' || v === '' ? 'text-[#c8c6c0]' : 'text-[#4a4742]'}`}`}>
                    {v === '' && i > 0 ? '—' : v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#faf9f6] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
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

function StateCard({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-[#e8e6e0] p-10 flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-[#2e9f82]" />
        <span className="ml-2 text-sm text-[#6b6860]">Loading…</span>
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
  const tot = ws.addRow(CASH_COLS.map(c =>
    c.key === 'label' ? 'YTD' : c.money ? aed(report.totals[c.key] as number) : Number(report.totals[c.key] ?? 0)));
  tot.font = { bold: true };
  CASH_COLS.forEach((c, i) => { if (c.money) tot.getCell(i + 1).numFmt = money; });

  // The reference file's side block: YTD Expected / YTD Received at L2:M3.
  ws.getCell('L2').value = 'YTD Expected';
  ws.getCell('M2').value = aed(report.totals.expectedFils);
  ws.getCell('M2').numFmt = money;
  ws.getCell('L3').value = 'YTD Received';
  ws.getCell('M3').value = aed(report.totals.receivedFils);
  ws.getCell('M3').numFmt = money;
  ws.getCell('L2').font = { bold: true };
  ws.getCell('L3').font = { bold: true };

  ws.getColumn(1).width = 8;
  for (let i = 2; i <= 10; i++) ws.getColumn(i).width = 12;
  ws.getColumn(12).width = 14;

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
    subtitle: 'Rent expected vs received, pending, bounced, penalties and Net Income, month by month.',
    exportLabel: 'Export Excel',
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
  const isLease = slug === 'lease-activity';

  // Compose the query — portal scope (rp=N), whole-portfolio money on the cashflow
  // sheet (scope=all), plus the property + leasing-model filters.
  const params = new URLSearchParams(extraQuery);
  if (!isLease) params.set('scope', 'all');
  if (buildingId !== 'all') params.set('buildings', String(buildingId));
  if (leaseType !== 'all') params.set('leaseTypes', leaseType);
  const query = params.toString();
  const { data, loading, error } = useReport<LeaseReport | CashReport>(endpointBase, slug, query, year);
  const cfg = SHEETS[slug];
  // Property options are filter-independent (the backend always returns the full
  // set), so the picker stays stable while the figures narrow.
  const buildingOpts = data?.buildings ?? [];

  const doExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      if (isLease) exportLeaseCsv(data as LeaseReport);
      else await exportCashXlsx(data as CashReport);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4">
        <ArrowLeft size={15} /> All reports
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-[#1a1916]">{cfg.title}</h1>
          <p className="text-xs text-[#6b6860] mt-0.5">{cfg.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Property filter — options come from the report (filter-independent). */}
          <label className="inline-flex items-center gap-1.5 bg-white border border-[#e8e6e0] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
            <Building2 size={14} className="text-[#2e9f82]" />
            <select
              value={String(buildingId)}
              onChange={e => setBuildingId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="text-sm font-semibold text-[#1a1916] bg-transparent focus:outline-none cursor-pointer pr-1 max-w-[170px]"
              aria-label="Property">
              <option value="all">All properties</option>
              {buildingOpts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {/* Leasing model — Lease (direct) / Sub-lease / Management. */}
          <label className="inline-flex items-center gap-1.5 bg-white border border-[#e8e6e0] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
            <select
              value={leaseType}
              onChange={e => setLeaseType(e.target.value as typeof leaseType)}
              className="text-sm font-semibold text-[#1a1916] bg-transparent focus:outline-none cursor-pointer pr-1"
              aria-label="Lease type">
              <option value="all">All lease types</option>
              <option value="direct">Lease</option>
              <option value="sub">Sub-lease</option>
              <option value="management">Management</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 bg-white border border-[#e8e6e0] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
            <CalendarRange size={14} className="text-[#2e9f82]" />
            <select
              value={String(year)}
              onChange={e => setReportsYear(Number(e.target.value))}
              className="text-sm font-semibold text-[#1a1916] bg-transparent focus:outline-none cursor-pointer pr-1"
              aria-label="Year">
              {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button
            onClick={doExport}
            disabled={exporting || loading || !!error}
            className="inline-flex items-center gap-1.5 bg-[#2e9f82] hover:bg-[#278a71] disabled:opacity-50 text-white text-sm font-semibold rounded-xl px-3.5 py-2">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {cfg.exportLabel}
          </button>
        </div>
      </div>

      {loading || error || !data ? <StateCard loading={loading} error={error} /> : isLease ? (
        <SheetTable
          cols={LEASE_COLS}
          rows={(data as LeaseReport).rows}
          totals={(data as LeaseReport).totals as unknown as Record<string, unknown>}
          render={(row, key) => {
            if (!row) return '';
            const v = row[key];
            return v == null ? '' : String(v);
          }}
        />
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <span className="inline-flex items-baseline gap-1.5 bg-white border border-[#e8e6e0] rounded-xl px-3 py-1.5 text-xs text-[#6b6860]">
              YTD Expected <strong className="text-sm text-[#1a1916] tabular-nums">AED {fmtAed((data as CashReport).totals.expectedFils)}</strong>
            </span>
            <span className="inline-flex items-baseline gap-1.5 bg-white border border-[#e8e6e0] rounded-xl px-3 py-1.5 text-xs text-[#6b6860]">
              YTD Received <strong className="text-sm text-[#1a7a5a] tabular-nums">AED {fmtAed((data as CashReport).totals.receivedFils)}</strong>
            </span>
          </div>
          <SheetTable
            cols={CASH_COLS}
            rows={(data as CashReport).rows}
            totals={(data as CashReport).totals as unknown as Record<string, unknown>}
            render={(row, key) => {
              if (!row) return '';
              const col = CASH_COLS.find(c => c.key === key);
              const v = row[key];
              if (col?.money) return fmtAed(v as number);
              return v == null ? '' : String(v);
            }}
          />
          <p className="text-[10px] text-[#9b9890] mt-2">All amounts in AED. Anchored on the cheque date; cancelled cheques excluded; includes customers who have since moved out. Net Income = received rent + penalty income.</p>
        </>
      )}
    </div>
  );
}
