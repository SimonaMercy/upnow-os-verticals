/**
 * Report detail page — interactive table with sort/filter, CSV download, and
 * print-friendly PDF (via window.print). Handles all four report types:
 *
 *   /reports/occupancy
 *   /reports/receivables
 *   /reports/lease-expiry
 *   /reports/renewal-pipeline
 *
 * Backend endpoints live at /api/reports/<slug>.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Search, Download, Printer, Loader2, FileSpreadsheet,
  BarChart2, AlertCircle, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';

type ReportSlug = 'occupancy' | 'receivables' | 'lease-expiry' | 'renewal-pipeline';

interface ReportDef {
  title: string;
  description: string;
  endpoint: string;
  columns: Column[];
  totals: TotalSpec[];
  /** Optional control rendered above the table (e.g. window-days for lease expiry). */
  controlKey?: 'leaseExpiryWindow';
}

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

const REPORTS: Record<ReportSlug, ReportDef> = {
  occupancy: {
    title: 'Occupancy Report',
    description: 'Snapshot of how each property is performing — units, occupied counts, and contracted rent.',
    endpoint: '/api/reports/occupancy',
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
    endpoint: '/api/reports/receivables',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Tenant' },
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
    endpoint: '/api/reports/lease-expiry',
    controlKey: 'leaseExpiryWindow',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Tenant' },
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
    endpoint: '/api/reports/renewal-pipeline',
    columns: [
      { key: 'parentRef', label: 'Original' },
      { key: 'childRef', label: 'Renewal' },
      { key: 'tenantName', label: 'Tenant' },
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

export default function ReportDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const slug = params.slug as ReportSlug;
  const def = REPORTS[slug];

  const [data, setData] = useState<{ generatedAt: string; totals: Record<string, number>; rows: Record<string, unknown>[]; windowDays?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [leaseWindow, setLeaseWindow] = useState<number>(() => Number(sp?.get('window') ?? 90));

  useEffect(() => {
    if (!def) return;
    setLoading(true); setError(null);
    const url = def.controlKey === 'leaseExpiryWindow'
      ? `${def.endpoint}?window=${leaseWindow}`
      : def.endpoint;
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [def, leaseWindow]);

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

  if (!def) {
    return (
      <div className="p-6">
        <Link href="/rental-provider/dashboard/reports" className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-sm">
          <ArrowLeft size={14} /> Back to Reports
        </Link>
        <div className="mt-8 text-center text-[#6b6860]">Unknown report: {slug}</div>
      </div>
    );
  }

  return (
    <div className="p-6 print:p-0">
      {/* Sticky header — hidden on print */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4 print:hidden">
        <div>
          <Link href="/rental-provider/dashboard/reports" className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
            <ArrowLeft size={12} /> All Reports
          </Link>
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
              onClick={() => { setLeaseWindow(w); router.replace(`/rental-provider/dashboard/reports/lease-expiry?window=${w}`); }}
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
