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
  BarChart2, AlertCircle, TrendingUp, TrendingDown, Minus, ChevronRight, X, ExternalLink,
} from 'lucide-react';

type ReportSlug = 'occupancy' | 'receivables' | 'lease-expiry' | 'renewal-pipeline' | 'renewal-forecast' | 'security-deposits' | 'cheque-register' | 'collection-rate' | 'tenant-ledger' | 'portfolio-overview' | 'vacancy-analysis' | 'leasing-activity';

interface DrilldownSpec {
  /** Row field holding the array of child items. */
  childKey: string;
  /** Row field used for the modal title (e.g. the month label). */
  titleKey: string;
  /** Plural noun for the count, e.g. "leases". */
  countLabel: string;
  columns: Column[];
  /** Item field whose value is a contract id → row links to the contract. */
  contractIdKey?: string;
}

interface ReportDef {
  title: string;
  description: string;
  endpoint: string;
  columns: Column[];
  totals: TotalSpec[];
  /** Optional control rendered above the table (e.g. window-days for lease expiry). */
  controlKey?: 'leaseExpiryWindow' | 'dateRange';
  /** When set, table rows expand into a modal listing their child items. */
  drilldown?: DrilldownSpec;
  /**
   * 'table' (default) = one flat table. 'grouped' = render each row as a
   * section (using its summary columns as the header) with its drilldown
   * children listed inline beneath — everything on one page, no modal.
   */
  layout?: 'table' | 'grouped';
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

const RENEWAL_FORECAST_DEF: ReportDef = {
  title: 'Renewal Forecast',
  description: 'Leases coming up for renewal each month — count, annual rent at stake, and how many are already in progress. Lapsed leases on occupied units show as Overdue.',
  endpoint: '/api/reports/renewal-forecast',
  layout: 'grouped',
  columns: [
    { key: 'monthLabel', label: 'Month' },
    { key: 'leases', label: 'Leases up for renewal', align: 'right', type: 'number' },
    { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
    { key: 'inProgress', label: 'In progress', align: 'right', type: 'number' },
    { key: 'notStarted', label: 'Not started', align: 'right', type: 'number' },
  ],
  totals: [
    { key: 'overdue', label: 'Overdue', type: 'number' },
    { key: 'next90', label: 'Next 90 days', type: 'number' },
    { key: 'next12mo', label: 'Next 12 months', type: 'number' },
    { key: 'totalLeases', label: 'Total leases', type: 'number' },
    { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
    { key: 'notStarted', label: 'Not started', type: 'number' },
  ],
  drilldown: {
    childKey: 'items',
    titleKey: 'monthLabel',
    countLabel: 'leases',
    contractIdKey: 'contractId',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'endDate', label: 'Lease ends', type: 'date' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      { key: 'stage', label: 'Renewal', type: 'stage' },
    ],
  },
};

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
    endpoint: '/api/reports/lease-expiry',
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
  // Both slugs resolve to the same forecast (renewal-forecast is canonical;
  // renewal-pipeline kept so older links/bookmarks still work).
  'renewal-forecast': RENEWAL_FORECAST_DEF,
  'renewal-pipeline': RENEWAL_FORECAST_DEF,
  'security-deposits': {
    title: 'Security Deposits Report',
    description: 'Deposit register with full lifecycle — held, returned, partial-return and forfeited — with cheque/receipt reference and the net refund liability. A deposit is collected at lease start and refundable at lease end; the date range filters by when it was taken.',
    endpoint: '/api/reports/security-deposits',
    controlKey: 'dateRange',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'depositFils', label: 'Deposit', align: 'right', type: 'aed' },
      { key: 'reference', label: 'Cheque / Ref' },
      { key: 'status', label: 'Status', type: 'stage' },
      { key: 'takenOn', label: 'Taken on', type: 'date' },
      { key: 'leaseEnd', label: 'Refundable at', type: 'date' },
    ],
    totals: [
      { key: 'held', label: 'Held (count)', type: 'number' },
      { key: 'heldFils', label: 'Held', type: 'aed' },
      { key: 'returnedFils', label: 'Returned', type: 'aed' },
      { key: 'forfeitedFils', label: 'Forfeited', type: 'aed' },
      { key: 'netHeldFils', label: 'Net liability (held)', type: 'aed' },
      { key: 'totalFils', label: 'Total', type: 'aed' },
    ],
  },

  'cheque-register': {
    title: 'PDC / Cheque Register',
    description: 'Every cheque on file with its lifecycle — pending, cleared, bounced or cancelled. Post-dated cheques are simply those with a future cheque date. The date range filters by cheque date.',
    endpoint: '/api/reports/cheque-register',
    controlKey: 'dateRange',
    columns: [
      { key: 'chequeDate', label: 'Cheque date', type: 'date' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'chequeNumber', label: 'Cheque #' },
      { key: 'paymentType', label: 'Type', type: 'stage' },
      { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
      { key: 'status', label: 'Status', type: 'stage' },
    ],
    totals: [
      { key: 'cheques', label: 'Cheques', type: 'number' },
      { key: 'clearedFils', label: 'Cleared', type: 'aed' },
      { key: 'pendingFils', label: 'Pending', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'cancelledFils', label: 'Cancelled', type: 'aed' },
      { key: 'totalFils', label: 'Total', type: 'aed' },
    ],
  },

  'collection-rate': {
    title: 'Collection Rate Report',
    description: 'Monthly rent collection performance — cheques due each month, how much cleared (collected), what is still pending, what bounced, and the collection rate. Anchored on the cheque date; use the date range to scope the period.',
    endpoint: '/api/reports/collection-rate',
    controlKey: 'dateRange',
    columns: [
      { key: 'label', label: 'Month' },
      { key: 'scheduled', label: 'Cheques due', align: 'right', type: 'number' },
      { key: 'scheduledFils', label: 'Scheduled', align: 'right', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', align: 'right', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', align: 'right', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', align: 'right', type: 'aed' },
      { key: 'collectionRate', label: 'Collection %', align: 'right', type: 'rate' },
    ],
    totals: [
      { key: 'scheduled', label: 'Cheques due', type: 'number' },
      { key: 'scheduledFils', label: 'Scheduled', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'collectionRate', label: 'Collection rate', type: 'rate' },
    ],
  },

  'tenant-ledger': {
    title: 'Customer Ledger',
    description: 'Per-customer rent cashflow — what was scheduled, collected, is still outstanding and bounced, with each customer\'s collection rate and last payment. Sorted by who owes the most. Use the date range to scope the period.',
    endpoint: '/api/reports/tenant-ledger',
    controlKey: 'dateRange',
    columns: [
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'cheques', label: 'Cheques', align: 'right', type: 'number' },
      { key: 'scheduledFils', label: 'Scheduled', align: 'right', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', align: 'right', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', align: 'right', type: 'aed' },
      { key: 'collectionRate', label: 'Collection %', align: 'right', type: 'rate' },
      { key: 'lastPaymentDate', label: 'Last payment', type: 'date' },
    ],
    totals: [
      { key: 'customers', label: 'Customers', type: 'number' },
      { key: 'scheduledFils', label: 'Scheduled', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'collectionRate', label: 'Collection rate', type: 'rate' },
    ],
  },

  'portfolio-overview': {
    title: 'Portfolio Overview',
    description: 'Portfolio composition by unit type — how many units of each type, how many are occupied, and the annual asking rent they represent, split by residential / commercial. A current snapshot of what you own and what it\'s worth.',
    endpoint: '/api/reports/portfolio-overview',
    columns: [
      { key: 'spaceCategory', label: 'Category', type: 'stage' },
      { key: 'unitType', label: 'Unit type', type: 'stage' },
      { key: 'units', label: 'Units', align: 'right', type: 'number' },
      { key: 'occupied', label: 'Occupied', align: 'right', type: 'number' },
      { key: 'vacant', label: 'Vacant', align: 'right', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', align: 'right', type: 'rate' },
      { key: 'askingRentFils', label: 'Annual asking rent', align: 'right', type: 'aed' },
      { key: 'avgAskingFils', label: 'Avg / unit', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'properties', label: 'Properties', type: 'number' },
      { key: 'units', label: 'Units', type: 'number' },
      { key: 'occupied', label: 'Occupied', type: 'number' },
      { key: 'vacant', label: 'Vacant', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', type: 'rate' },
      { key: 'askingRentFils', label: 'Annual asking rent', type: 'aed' },
    ],
  },

  'vacancy-analysis': {
    title: 'Vacancy Analysis',
    description: 'Vacant units to action — each available unit with its annual asking rent (revenue at stake) and listing status, plus overall portfolio occupancy. A current snapshot; time-on-market is not tracked yet.',
    endpoint: '/api/reports/vacancy-analysis',
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'unitType', label: 'Type', type: 'stage' },
      { key: 'bedrooms', label: 'Beds', align: 'right', type: 'number' },
      { key: 'listingStatus', label: 'Listing', type: 'stage' },
      { key: 'askingRentFils', label: 'Asking rent / yr', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'vacant', label: 'Vacant units', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', type: 'rate' },
      { key: 'listed', label: 'Listed', type: 'number' },
      { key: 'unlisted', label: 'Unlisted', type: 'number' },
      { key: 'vacantAskingFils', label: 'Rent at stake / yr', type: 'aed' },
    ],
  },

  'leasing-activity': {
    title: 'Leasing Activity',
    description: 'Monthly leasing velocity — new leases commencing each month, the annual rent they represent, and Ejari registration status. Anchored on the lease start date. Note: historical renewals were imported without a renewal link, so they appear here as new leases.',
    endpoint: '/api/reports/leasing-activity',
    controlKey: 'dateRange',
    columns: [
      { key: 'label', label: 'Month' },
      { key: 'newLeases', label: 'New leases', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent signed', align: 'right', type: 'aed' },
      { key: 'ejariRegistered', label: 'Ejari registered', align: 'right', type: 'number' },
      { key: 'ejariPending', label: 'Ejari pending', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'newLeases', label: 'New leases', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent signed', type: 'aed' },
      { key: 'ejariRegistered', label: 'Ejari registered', type: 'number' },
      { key: 'ejariPending', label: 'Ejari pending', type: 'number' },
    ],
  },
};

// Local-date YYYY-MM-DD (no UTC shift) for the date-range control presets.
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RANGE_PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: 'All',        range: () => ({ from: '', to: '' }) },
  { label: 'This month', range: () => { const n = new Date(); return { from: isoLocal(new Date(n.getFullYear(), n.getMonth(), 1)), to: isoLocal(n) }; } },
  { label: '3 months',   range: () => { const n = new Date(); const f = new Date(n); f.setMonth(f.getMonth() - 3); return { from: isoLocal(f), to: isoLocal(n) }; } },
  { label: '6 months',   range: () => { const n = new Date(); const f = new Date(n); f.setMonth(f.getMonth() - 6); return { from: isoLocal(f), to: isoLocal(n) }; } },
  { label: 'This year',  range: () => { const n = new Date(); return { from: isoLocal(new Date(n.getFullYear(), 0, 1)), to: isoLocal(n) }; } },
];

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
  const [from, setFrom] = useState<string>(sp?.get('from') ?? '');
  const [to, setTo]     = useState<string>(sp?.get('to') ?? '');
  const [drill, setDrill] = useState<Record<string, unknown> | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!def) return;
    setLoading(true); setError(null);
    let url = def.endpoint;
    if (def.controlKey === 'leaseExpiryWindow') {
      url = `${def.endpoint}?window=${leaseWindow}`;
    } else if (def.controlKey === 'dateRange') {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if ([...qs.keys()].length) url = `${def.endpoint}?${qs.toString()}`;
    }
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [def, leaseWindow, from, to]);

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

  function toggleGroup(key: string) {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  // Grouped layout: each row is a month bucket; filter its child leases by the
  // search needle and drop buckets with no matching leases.
  const groups = useMemo(() => {
    const dd = def?.drilldown;
    if (def?.layout !== 'grouped' || !dd || !data?.rows) return [];
    const needle = search.trim().toLowerCase();
    return data.rows
      .map(row => {
        const items = (row[dd.childKey] as Record<string, unknown>[] | undefined) ?? [];
        const matched = !needle ? items : items.filter(it =>
          dd.columns.some(c => String(it[c.key] ?? '').toLowerCase().includes(needle)));
        return { row, items: matched };
      })
      .filter(g => g.items.length > 0);
  }, [def, data, search]);

  function handleCsv() {
    if (!data) return;
    const datestamp = new Date(data.generatedAt).toISOString().slice(0, 10);
    const fmtCell = (raw: unknown, type?: Column['type']) => {
      if (type === 'aed') return raw == null ? '' : (Number(raw) / 100).toFixed(2);
      if (type === 'date') return raw ? new Date(String(raw)).toISOString().slice(0, 10) : '';
      return raw ?? '';
    };

    // Grouped layout: export one row per child lease, prefixed with its group.
    if (def.layout === 'grouped' && def.drilldown) {
      const dd = def.drilldown;
      const headers = ['Month', ...dd.columns.map(c => c.label)];
      const rows = groups.flatMap(g =>
        g.items.map(it => [String(g.row[dd.titleKey] ?? ''), ...dd.columns.map(c => fmtCell(it[c.key], c.type))]),
      );
      downloadCsv(`${slug}-${datestamp}.csv`, headers, rows);
      return;
    }

    const headers = def.columns.map(c => c.label);
    const rows = sorted.map(row => def.columns.map(c => fmtCell(row[c.key], c.type)));
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

      {/* Date-range control (day / month / 3-6 mo / year / custom) */}
      {def.controlKey === 'dateRange' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap print:hidden">
          <span className="text-xs text-[#6b6860] font-medium">Period:</span>
          {RANGE_PRESETS.map(p => {
            const r = p.range();
            const active = from === r.from && to === r.to;
            return (
              <button key={p.label} onClick={() => { setFrom(r.from); setTo(r.to); }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${active ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
                {p.label}
              </button>
            );
          })}
          <span className="text-xs text-[#9b9890] ml-1">Custom:</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-xs border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82]" />
          <span className="text-xs text-[#9b9890]">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-xs border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82]" />
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
      ) : (def.layout === 'grouped' ? groups.length === 0 : sorted.length === 0) ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
          <BarChart2 size={32} className="mx-auto text-[#c8c6c0] mb-3" />
          <p className="text-sm font-semibold text-[#1a1916]">No data</p>
          <p className="text-xs text-[#9b9890] mt-1">{search ? 'Nothing matches your search.' : 'No matching records found.'}</p>
        </div>
      ) : def.layout === 'grouped' && def.drilldown ? (
        <div className="space-y-3">
          {groups.map((g, gi) => {
            const dd = def.drilldown!;
            const key = String(g.row[dd.titleKey] ?? gi);
            const isCollapsed = collapsed.has(key);
            const isOverdue = g.row['month'] === 'overdue';
            return (
              <div key={key} className={`bg-white rounded-2xl border overflow-hidden ${isOverdue ? 'border-[#fca5a5]' : 'border-[#e8e6e0]'} print:break-inside-avoid`}>
                {/* Month header */}
                <button
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-[#fafaf8] print:hover:bg-transparent">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ChevronRight size={16} className={`text-[#9b9890] transition-transform print:hidden ${isCollapsed ? '' : 'rotate-90'}`} />
                    <span className={`text-sm font-bold ${isOverdue ? 'text-[#b91c1c]' : 'text-[#1a1916]'}`}>{String(g.row[dd.titleKey] ?? '')}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {def.columns.filter(c => c.key !== dd.titleKey).map(c => (
                      <span key={c.key} className="text-xs whitespace-nowrap hidden sm:inline">
                        <span className="text-[#9b9890]">{c.label}: </span>
                        <span className="font-semibold text-[#1a1916]"><CellValue value={g.row[c.key]} type={c.type} /></span>
                      </span>
                    ))}
                  </div>
                </button>
                {/* Leases in this month */}
                {!isCollapsed && (
                  <div className="overflow-x-auto border-t border-[#f0ede8]">
                    <table className="w-full text-sm">
                      <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                        <tr>
                          {dd.columns.map(c => (
                            <th key={c.key} className={`px-4 py-2.5 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                          ))}
                          {dd.contractIdKey && <th className="px-3 py-2.5 print:hidden" aria-hidden />}
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((it, idx) => (
                          <tr key={idx} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                            {dd.columns.map(c => (
                              <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
                                <CellValue value={it[c.key]} type={c.type} />
                              </td>
                            ))}
                            {dd.contractIdKey && (
                              <td className="px-3 py-2.5 text-right print:hidden">
                                {it[dd.contractIdKey] != null && (
                                  <Link
                                    href={`/rental-provider/dashboard/contracts/${it[dd.contractIdKey]}/v2`}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline"
                                    title="Open contract">
                                    Open <ExternalLink size={12} />
                                  </Link>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
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
                  {def.drilldown && <th className="px-3 py-3 print:hidden" aria-hidden />}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const items = def.drilldown ? (row[def.drilldown.childKey] as unknown[] | undefined) : undefined;
                  const canDrill = !!def.drilldown && Array.isArray(items) && items.length > 0;
                  return (
                    <tr
                      key={i}
                      onClick={canDrill ? () => setDrill(row) : undefined}
                      className={`border-t border-[#f0ede8] hover:bg-[#fafaf8] ${canDrill ? 'cursor-pointer print:cursor-auto' : ''}`}>
                      {def.columns.map(c => (
                        <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left'} text-[#1a1916]`}>
                          <CellValue value={row[c.key]} type={c.type} />
                        </td>
                      ))}
                      {def.drilldown && (
                        <td className="px-3 py-3 text-right text-[#c8c6c0] print:hidden">
                          {canDrill && <ChevronRight size={15} className="inline" />}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && (
        <p className="text-[11px] text-[#9b9890] mt-3 print:mt-4">
          {def.layout === 'grouped'
            ? `${groups.reduce((n, g) => n + g.items.length, 0)} leases across ${groups.length} month${groups.length === 1 ? '' : 's'}`
            : `${sorted.length} row${sorted.length === 1 ? '' : 's'}`} · Generated {new Date(data.generatedAt).toLocaleString('en-AE')}
        </p>
      )}

      {/* Drill-down modal — lists the child items of the clicked row */}
      {def.drilldown && drill && (() => {
        const dd = def.drilldown;
        const items = (drill[dd.childKey] as Record<string, unknown>[] | undefined) ?? [];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={() => setDrill(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
                <div>
                  <h3 className="text-base font-bold text-[#1a1916]">{String(drill[dd.titleKey] ?? '')}</h3>
                  <p className="text-xs text-[#6b6860] mt-0.5">{items.length} {dd.countLabel} up for renewal</p>
                </div>
                <button onClick={() => setDrill(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef]">
                  <X size={16} />
                </button>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890] sticky top-0">
                    <tr>
                      {dd.columns.map(c => (
                        <th key={c.key} className={`px-4 py-2.5 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                      ))}
                      {dd.contractIdKey && <th className="px-3 py-2.5" aria-hidden />}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                        {dd.columns.map(c => (
                          <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
                            <CellValue value={it[c.key]} type={c.type} />
                          </td>
                        ))}
                        {dd.contractIdKey && (
                          <td className="px-3 py-2.5 text-right">
                            {it[dd.contractIdKey] != null && (
                              <Link
                                href={`/rental-provider/dashboard/contracts/${it[dd.contractIdKey]}/v2`}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline"
                                title="Open contract">
                                Open <ExternalLink size={12} />
                              </Link>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
