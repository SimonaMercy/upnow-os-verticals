'use client';

/**
 * Manager — Reports.
 *
 * Mirrors the landlord Reports experience EXACTLY, but for the landlord the
 * manager has selected (via the LandlordSwitcher → ?rp=<id>) and gated behind
 * the `canViewReports` permission.
 *
 * The landlord side is two pages:
 *   • /rental-provider/dashboard/reports          — the report-card grid
 *   • /rental-provider/dashboard/reports/[slug]   — inline table for one report
 *
 * A manager can't navigate into /rental-provider/*, so this single page folds
 * both together: the same card grid for picking a report, then the SAME inline
 * table (search / sort / totals / CSV / Print) rendered in place. The card UI
 * and the table UI are copied verbatim from the two landlord pages so the
 * design is identical — only the data source changes to the manager endpoint:
 *
 *     apiGet('/manager/reports/<slug>?rp=' + effectiveRp)
 *
 * which returns the identical shape as /api/reports/<slug> (same backend
 * service). lease-expiry additionally takes &windowDays=. Read-only: links that
 * pointed at /rental-provider/* are removed.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Search, X, FileText, BarChart2, Building2, AlertCircle, CalendarClock,
  RefreshCw, MapPin, Wallet, ShieldCheck, Users, Wrench, FileBarChart,
  ArrowLeft, Download, Printer, Loader2, FileSpreadsheet,
  TrendingUp, TrendingDown, Minus, Lock,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

// ────────────────────────────────────────────────────────────────────────────
// Report-card grid (mirrors the landlord reports landing page)
// ────────────────────────────────────────────────────────────────────────────

interface ReportTile {
  slug: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  available: boolean;
}

const REPORTS_TILES: ReportTile[] = [
  { slug: 'occupancy',          title: 'Occupancy Report',         description: 'Units, occupied counts, and contracted rent per property.',           Icon: Building2,    available: true  },
  { slug: 'receivables',        title: 'Receivables Summary',      description: 'Outstanding cheques aged 0-30 / 31-60 / 61-90 / 90+.',                Icon: Wallet,       available: true  },
  { slug: 'lease-expiry',       title: 'Lease Expiry Report',      description: 'Active contracts ending within 30 / 60 / 90 / 180 / 365 days.',       Icon: CalendarClock, available: true },
  { slug: 'renewal-pipeline',   title: 'Renewal Pipeline Report',  description: 'Renewals by stage with annual rent delta.',                           Icon: RefreshCw,    available: true  },
  { slug: 'collection-rate',    title: 'Collection Rate Report',   description: 'Collected vs scheduled rent, by period.',                              Icon: BarChart2,    available: false },
  { slug: 'security-deposits',  title: 'Security Deposits Report', description: 'Deposits held, status, and refund obligations.',                       Icon: ShieldCheck,  available: false },
  { slug: 'vacancy-analysis',   title: 'Vacancy Analysis',         description: 'Time-on-market, turnover, and listing price changes.',                 Icon: MapPin,       available: false },
  { slug: 'tenant-ledger',      title: 'Customer Ledger',          description: 'Per-customer payment history and balance.',                            Icon: FileText,     available: false },
  { slug: 'portfolio-overview', title: 'Portfolio Overview',       description: 'Properties, units, types, and emirate breakdown.',                     Icon: FileBarChart, available: false },
  { slug: 'income-statement',   title: 'Income Statement',         description: 'Revenue by stream — rent, admin, ejari, deposits.',                    Icon: BarChart2,    available: false },
  { slug: 'amc-vendor-spend',   title: 'AMC & Vendor Spend',       description: 'Vendor invoices and AMC contract costs.',                              Icon: Wrench,       available: false },
  { slug: 'manager-performance', title: 'Manager Performance Report', description: 'Per-asset-manager activity and deal velocity.',                     Icon: Users,        available: false },
];

// ────────────────────────────────────────────────────────────────────────────
// Report detail definitions (mirrors the landlord [slug] page)
// ────────────────────────────────────────────────────────────────────────────

type ReportSlug = 'occupancy' | 'receivables' | 'lease-expiry' | 'renewal-pipeline';

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  type?: 'aed' | 'date' | 'number' | 'bucket' | 'stage' | 'rate' | 'delta';
  width?: string;
}

interface TotalSpec {
  key: string;
  label: string;
  type?: 'aed' | 'number' | 'rate';
}

interface ReportDef {
  title: string;
  description: string;
  columns: Column[];
  totals: TotalSpec[];
  /** Optional control rendered above the table (e.g. window-days for lease expiry). */
  controlKey?: 'leaseExpiryWindow';
}

const REPORTS: Record<ReportSlug, ReportDef> = {
  occupancy: {
    title: 'Occupancy Report',
    description: 'Snapshot of how each property is performing — units, occupied counts, and contracted rent.',
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'community', label: 'Community' },
      { key: 'emirate', label: 'Emirate' },
      { key: 'totalUnits', label: 'Units', align: 'right', type: 'number' },
      { key: 'occupiedUnits', label: 'Occupied', align: 'right', type: 'number' },
      { key: 'vacantUnits', label: 'Vacant', align: 'right', type: 'number' },
      { key: 'maintenanceUnits', label: 'Maintenance', align: 'right', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', align: 'right', type: 'rate' },
      { key: 'contractedRentFils', label: 'Contracted Rent', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'properties', label: 'Properties', type: 'number' },
      { key: 'units', label: 'Units', type: 'number' },
      { key: 'occupied', label: 'Occupied', type: 'number' },
      { key: 'vacant', label: 'Vacant', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', type: 'rate' },
      { key: 'contractedRentFils', label: 'Contracted Rent', type: 'aed' },
    ],
  },
  receivables: {
    title: 'Receivables Summary',
    description: 'Outstanding rent and admin-fee cheques, aged into buckets so you see what is overdue and by how long.',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'description', label: 'Description' },
      { key: 'chequeNumber', label: 'Cheque #' },
      { key: 'dueDate', label: 'Due', type: 'date' },
      { key: 'ageDays', label: 'Age (days)', align: 'right', type: 'number' },
      { key: 'bucket', label: 'Bucket', type: 'bucket' },
      { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'upcomingFils', label: 'Upcoming', type: 'aed' },
      { key: 'currentFils', label: 'Due today', type: 'aed' },
      { key: 'overdue30Fils', label: 'Overdue 1-30', type: 'aed' },
      { key: 'overdue60Fils', label: 'Overdue 31-60', type: 'aed' },
      { key: 'overdue90Fils', label: 'Overdue 61-90', type: 'aed' },
      { key: 'overdue90PlusFils', label: 'Overdue 90+', type: 'aed' },
      { key: 'totalOutstandingFils', label: 'Total outstanding', type: 'aed' },
    ],
  },
  'lease-expiry': {
    title: 'Lease Expiry Report',
    description: 'Active contracts whose end date is approaching, with their current renewal state.',
    controlKey: 'leaseExpiryWindow',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'startDate', label: 'Start', type: 'date' },
      { key: 'endDate', label: 'End', type: 'date' },
      { key: 'daysUntilExpiry', label: 'Days left', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      { key: 'renewalStatus', label: 'Renewal', type: 'stage' },
    ],
    totals: [
      { key: 'expiring', label: 'Expiring', type: 'number' },
      { key: 'renewedOrAccepted', label: 'Renewed / Accepted', type: 'number' },
      { key: 'awaitingDecision', label: 'Awaiting Decision', type: 'number' },
      { key: 'rejected', label: 'Rejected', type: 'number' },
      { key: 'contractedRentFils', label: 'Contracted Rent', type: 'aed' },
    ],
  },
  'renewal-pipeline': {
    title: 'Renewal Pipeline Report',
    description: 'Every renewal in flight — proposed, accepted, signed, active — with the change in annual rent.',
    columns: [
      { key: 'parentRef', label: 'Original' },
      { key: 'childRef', label: 'Renewal' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'originalEndDate', label: 'Original ends', type: 'date' },
      { key: 'proposedStart', label: 'New start', type: 'date' },
      { key: 'proposedEnd', label: 'New end', type: 'date' },
      { key: 'oldRentFils', label: 'Old rent', align: 'right', type: 'aed' },
      { key: 'newRentFils', label: 'New rent', align: 'right', type: 'aed' },
      { key: 'rentDeltaFils', label: 'Δ', align: 'right', type: 'delta' },
      { key: 'stage', label: 'Stage', type: 'stage' },
    ],
    totals: [
      { key: 'proposed', label: 'Proposed', type: 'number' },
      { key: 'accepted', label: 'Accepted', type: 'number' },
      { key: 'signed', label: 'Signed', type: 'number' },
      { key: 'active', label: 'Active', type: 'number' },
      { key: 'rejected', label: 'Rejected', type: 'number' },
      { key: 'pipelineRentFils', label: 'Pipeline Rent', type: 'aed' },
    ],
  },
};

function isReportSlug(s: string): s is ReportSlug {
  return s === 'occupancy' || s === 'receivables' || s === 'lease-expiry' || s === 'renewal-pipeline';
}

// ────────────────────────────────────────────────────────────────────────────
// Cell formatting (mirrors the landlord [slug] page)
// ────────────────────────────────────────────────────────────────────────────

function fmtAed(fils: number | null | undefined): string {
  const n = Number(fils ?? 0);
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n / 100);
}
function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-AE').format(n);
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const BUCKET_STYLE: Record<string, string> = {
  upcoming: 'bg-[#e8f4fd] text-[#1e3a8a]',
  current:  'bg-[#fef3c7] text-[#854d0e]',
  '1-30':   'bg-[#fed7aa] text-[#9a3412]',
  '31-60':  'bg-[#fdba74] text-[#7c2d12]',
  '61-90':  'bg-[#fca5a5] text-[#7f1d1d]',
  '90+':    'bg-[#dc2626] text-white',
};
const STAGE_STYLE: Record<string, string> = {
  not_started: 'bg-[#f4f3ef] text-[#6b6860]',
  proposed:    'bg-[#fef3c7] text-[#854d0e]',
  accepted:    'bg-[#dcfce7] text-[#166534]',
  signed:      'bg-[#dbeafe] text-[#1e40af]',
  active:      'bg-[#d8f2e8] text-[#1a7a5a]',
  rejected:    'bg-[#fee2e2] text-[#b91c1c]',
};

function CellValue({ value, type }: { value: unknown; type?: Column['type'] }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-[#c8c6c0]">—</span>;
  }
  if (type === 'aed') return <span>{fmtAed(Number(value))}</span>;
  if (type === 'number') return <span>{fmtNumber(Number(value))}</span>;
  if (type === 'date') return <span>{fmtDate(String(value))}</span>;
  if (type === 'rate') return <span>{Number(value).toFixed(1)}%</span>;
  if (type === 'delta') {
    const v = Number(value);
    if (v === 0) return <span className="text-[#6b6860] inline-flex items-center gap-1"><Minus size={11} /> {fmtAed(0)}</span>;
    return v > 0
      ? <span className="text-[#1a7a5a] inline-flex items-center gap-1"><TrendingUp size={11} /> {fmtAed(v)}</span>
      : <span className="text-red-600 inline-flex items-center gap-1"><TrendingDown size={11} /> {fmtAed(v)}</span>;
  }
  if (type === 'bucket') {
    const cls = BUCKET_STYLE[String(value)] ?? 'bg-[#f4f3ef] text-[#6b6860]';
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${cls}`}>{String(value)}</span>;
  }
  if (type === 'stage') {
    const cls = STAGE_STYLE[String(value)] ?? 'bg-[#f4f3ef] text-[#6b6860]';
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${cls}`}>{String(value).replace('_', ' ')}</span>;
  }
  return <span>{String(value)}</span>;
}

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers.map(toCsvCell).join(','), ...rows.map(r => r.map(toCsvCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface ReportData {
  generatedAt: string;
  totals: Record<string, number>;
  rows: Record<string, unknown>[];
  windowDays?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Inline report detail (mirrors the landlord [slug] page, data via /manager)
// ────────────────────────────────────────────────────────────────────────────

function ReportDetail({
  slug, effectiveRp, onBack,
}: { slug: ReportSlug; effectiveRp: number; onBack: () => void }) {
  const def = REPORTS[slug];

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [leaseWindow, setLeaseWindow] = useState<number>(90);

  useEffect(() => {
    setLoading(true); setError(null);
    // Manager endpoint mirrors /api/reports/<slug>; scoped to the selected
    // landlord via ?rp=. lease-expiry additionally takes &windowDays=.
    const base = `/manager/reports/${slug}?rp=${effectiveRp}`;
    const path = def.controlKey === 'leaseExpiryWindow'
      ? `${base}&windowDays=${leaseWindow}`
      : base;
    let cancelled = false;
    apiGet<ReportData>(path)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, effectiveRp, def.controlKey, leaseWindow]);

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.rows;
    return data.rows.filter(row =>
      def.columns.some(c => String(row[c.key] ?? '').toLowerCase().includes(needle)),
    );
  }, [data, search, def]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function handleCsv() {
    if (!data) return;
    const headers = def.columns.map(c => c.label);
    const rows = sorted.map(row => def.columns.map(c => {
      const raw = row[c.key];
      if (c.type === 'aed') return raw == null ? '' : (Number(raw) / 100).toFixed(2);
      if (c.type === 'date') return raw ? new Date(String(raw)).toISOString().slice(0, 10) : '';
      return raw ?? '';
    }));
    const datestamp = new Date(data.generatedAt).toISOString().slice(0, 10);
    downloadCsv(`${slug}-${datestamp}.csv`, headers, rows);
  }

  return (
    <div className="print:p-0">
      {/* Sticky header — hidden on print */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4 print:hidden">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2"
          >
            <ArrowLeft size={12} /> All Reports
          </button>
          <h1 className="text-2xl font-bold text-[#1a1916]">{def.title}</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-2xl">{def.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCsv}
            disabled={!data || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] disabled:opacity-50 transition-colors bg-white">
            <FileSpreadsheet size={14} /> CSV
          </button>
          <button
            onClick={() => window.print()}
            disabled={!data || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: '#2e9f82' }}>
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold">{def.title}</h1>
        <p className="text-sm text-gray-600">{def.description}</p>
        {data && <p className="text-xs text-gray-500 mt-1">Generated {new Date(data.generatedAt).toLocaleString('en-AE')}</p>}
      </div>

      {/* Lease-expiry window control */}
      {def.controlKey === 'leaseExpiryWindow' && (
        <div className="flex items-center gap-2 mb-4 print:hidden">
          <span className="text-xs text-[#6b6860] font-medium">Window:</span>
          {[30, 60, 90, 180, 365].map(w => (
            <button
              key={w}
              onClick={() => setLeaseWindow(w)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${leaseWindow === w ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {w} days
            </button>
          ))}
        </div>
      )}

      {/* Totals */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
          {def.totals.map(t => {
            const raw = data.totals[t.key];
            return (
              <div key={t.key} className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{t.label}</p>
                <p className="text-base font-bold text-[#1a1916] mt-1">
                  {t.type === 'aed' ? fmtAed(raw) : t.type === 'rate' ? `${Number(raw).toFixed(1)}%` : fmtNumber(raw)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm mb-4 print:hidden">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rows…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm focus:outline-none focus:border-[#2e9f82]"
        />
      </div>

      {/* Table */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-[#2e9f82]" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
          <BarChart2 size={32} className="mx-auto text-[#c8c6c0] mb-3" />
          <p className="text-sm font-semibold text-[#1a1916]">No data</p>
          <p className="text-xs text-[#9b9890] mt-1">{search ? 'Nothing matches your search.' : 'No matching records found.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:border-none print:rounded-none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                <tr>
                  {def.columns.map(c => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className={`px-4 py-3 font-semibold cursor-pointer hover:text-[#1a1916] transition-colors select-none ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}>
                      {c.label}
                      {sortKey === c.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                    {def.columns.map(c => (
                      <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left'} text-[#1a1916]`}>
                        <CellValue value={row[c.key]} type={c.type} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && (
        <p className="text-[11px] text-[#9b9890] mt-3 print:mt-4">
          {sorted.length} row{sorted.length === 1 ? '' : 's'} · Generated {new Date(data.generatedAt).toLocaleString('en-AE')}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main page — card grid + permission gate + LandlordSwitcher
// ────────────────────────────────────────────────────────────────────────────

export default function ManagerReportsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  // Effective landlord = the one chosen in the LandlordSwitcher, else the first
  // managed landlord that delegated reports access.
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canViewReports)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canViewReports', effectiveRp);

  const [search, setSearch] = useState('');
  const [openSlug, setOpenSlug] = useState<ReportSlug | null>(null);

  // If the selected landlord changes, drop back to the grid (the open report was
  // for the previous landlord).
  useEffect(() => { setOpenSlug(null); }, [effectiveRp]);

  // Per-landlord permission gate — mirrors the lock the nav enforces.
  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-[460px] text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-10">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn’t granted you the <strong>View Reports</strong> permission, so their reports aren’t available.
          </p>
        </div>
      </div>
    );
  }

  // Drill-down: the selected report rendered inline (no /rental-provider route).
  if (openSlug && effectiveRp != null) {
    return (
      <div className="p-6 print:p-0">
        <ReportDetail slug={openSlug} effectiveRp={effectiveRp} onBack={() => setOpenSlug(null)} />
      </div>
    );
  }

  const filtered = REPORTS_TILES.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase())
    || r.description.toLowerCase().includes(search.toLowerCase()),
  );
  const available = filtered.filter(r => r.available);
  const upcoming = filtered.filter(r => !r.available);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Reports</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Interactive portfolio reports — view inline, download CSV, or print as PDF.</p>
        </div>
      </div>

      <div className="relative max-w-sm mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
        <input
          type="text"
          placeholder="Search reports…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm focus:outline-none focus:border-[#2e9f82]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9b9890] hover:text-[#1a1916]">
            <X size={12} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <BarChart2 size={32} className="mx-auto text-[#c8c6c0] mb-3" />
          <p className="text-sm text-[#6b6860]">No reports match your search.</p>
        </div>
      ) : (
        <>
          {available.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase tracking-wide font-semibold text-[#9b9890] mb-3">Available now</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {available.map(r => (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={() => { if (isReportSlug(r.slug)) setOpenSlug(r.slug); }}
                    className="group text-left bg-white rounded-2xl border border-[#e8e6e0] p-5 shadow-sm hover:border-[#2e9f82] hover:shadow-md transition-all">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0 group-hover:bg-[#2e9f82] transition-colors">
                        <r.Icon size={18} className="text-[#2e9f82] group-hover:text-white transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-[#1a1916] leading-tight">{r.title}</h3>
                        <p className="text-xs text-[#6b6860] mt-1 line-clamp-2">{r.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {upcoming.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase tracking-wide font-semibold text-[#9b9890] mb-3 mt-4 flex items-center gap-1.5">
                <AlertCircle size={11} /> Coming soon — needs additional data tracking
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {upcoming.map(r => (
                  <div key={r.slug} className="bg-white rounded-2xl border border-[#e8e6e0] p-5 opacity-60">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#f4f3ef] flex items-center justify-center shrink-0">
                        <r.Icon size={18} className="text-[#9b9890]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-[#6b6860] leading-tight">{r.title}</h3>
                        <p className="text-xs text-[#9b9890] mt-1 line-clamp-2">{r.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
