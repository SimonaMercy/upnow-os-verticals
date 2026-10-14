/**
 * Leases - Monthly (slug `leases-by-year`) — the year's lease register grouped by
 * commencement month, as its own page rather than a ReportDetailView table.
 *
 * Same data, filters and exports as the generic view it replaces, laid out for
 * reading: a "book" card (annual rent contracted, split into what commenced this
 * year vs earlier, still running), a 12-month bar chart that filters the list,
 * then a searchable register with collapsible month groups, sortable columns,
 * a term-progress bar per lease and a direct link into each contract.
 *
 * Data: GET {endpointBase}/leases-by-year?year=YYYY (+ buildings, leaseTypes,
 * + any extraQuery like rp=N). Backend returns { generatedAt, year, totals,
 * rows: [{ monthLabel, leases, annualRentFils, items[] }], buildings,
 * availableYears }. All money is in fils; the view converts.
 *
 * Opening a lease shows its record (LeaseRecordPanel — payments, documents,
 * notes, breaches, all live data) INSIDE the report,
 * under a report nav bar: breadcrumb, previous / next lease in the list's order
 * (J / K), Esc back. The lease id rides in the address (?lease=) so a refresh,
 * a shared link and the browser's Back button all behave.
 *
 * The CSV keeps the exact shape the generic view exported (detail lines, the
 * per-month summary and the "year's share of the book" panel) so anything that
 * consumes the file keeps working.
 */
'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, ArrowRight, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Banknote, Building2, CalendarClock, Check, Download, ExternalLink, FileSpreadsheet, Info, Loader2, Printer, RefreshCw, Rows3, Rows4, Search, X,
  ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BasisNote } from '@/components/upnow/reportCatalog';
import { getReportsYear, useReportsYear, yearForMatrix, REPORT_YEARS } from '@/components/upnow/reportsYear';

import dynamic from 'next/dynamic';

// The lease opened inside the report is the REAL lease record — the same view as
// the contract page, with every action (payment status, add/edit, deposit
// settle, document upload/request, notes, emails, breaches, renew, terminate).
// Loaded only when a lease is opened.
const ContractV2View = dynamic(
  () => import('@/app/rental-provider/dashboard/contracts/[id]/v2/page').then(m => m.ContractV2View),
  { ssr: false, loading: () => <div className="py-24 grid place-items-center text-[#6f7a73]"><Loader2 size={20} className="animate-spin" /></div> },
);
import { leasesThemeClass, LeasesThemeStyles } from '@/components/upnow/leasesTheme';
import { LeasesViewSwitch } from '@/components/upnow/LeasesViewSwitch';

/* ── payload types ─────────────────────────────────────────────────────────── */
interface LeaseItem {
  contractId: number | null;
  contractRef: string | null;
  tenantName: string | null;
  unitLabel: string | null;
  buildingName: string | null;
  startDate: string | null;
  endDate: string | null;
  annualRentFils: number | null;
  status: string | null;
}
interface MonthRow { monthLabel: string; leases: number; annualRentFils: number; items?: LeaseItem[] }
export type LeaseType = 'direct' | 'sub' | 'management';
export interface BuildingOption { id: number; name: string; leasingType: LeaseType; contracts: number }
interface Payload {
  generatedAt: string;
  year?: number;
  totals: Record<string, number>;
  rows: MonthRow[];
  buildings?: BuildingOption[];
  availableYears?: number[];
}

const ALL_LEASE_TYPES: LeaseType[] = ['direct', 'sub', 'management'];
const LEASE_TYPE_LABEL: Record<LeaseType, string> = { direct: 'Lease', sub: 'Sub-lease', management: 'Management' };
const LEASE_TYPE_HINT: Record<LeaseType, string> = {
  direct: 'Buildings you lease out directly', sub: 'Buildings you sub-lease', management: 'Buildings you manage for an owner',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// v2: the default became "3 most recent months open" — a new key so choices saved
// under the old all-expanded default don't hide it.
const COLLAPSED_KEY = 'upnow.leasesMonthly.collapsed.v2';
/** A running lease this close to its end is flagged, matching the renewal-notice window. */
const ENDING_SOON_DAYS = 120;
const DENSITY_KEY = 'upnow.leasesMonthly.density';

/** Quick status views over the register — counted live, so each tab says how
 *  many leases it holds under the other filters. "Ending soon" and "Not started"
 *  are read off the term dates; the rest are the lease's own status. */
type StatusTab = 'all' | 'active' | 'ending' | 'upcoming' | 'renewed' | 'expired' | 'terminated' | 'other';
const STATUS_TABS: { key: StatusTab; label: string; hint?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'ending', label: 'Ending soon', hint: `Running leases that end within ${ENDING_SOON_DAYS} days — the renewal-notice window` },
  { key: 'upcoming', label: 'Not started', hint: 'Commencement date is still ahead' },
  { key: 'renewed', label: 'Renewed' },
  { key: 'expired', label: 'Expired' },
  { key: 'terminated', label: 'Terminated' },
  { key: 'other', label: 'In progress', hint: 'Issued, signed or pending — not yet active' },
];
const KNOWN_STATUSES = new Set(['active', 'renewed', 'expired', 'terminated']);

/** Annual-rent bands (AED) for a quick price cut of the register. */
type RentBand = 'all' | 'lt50' | '50to100' | '100to200' | 'gt200';
const RENT_BANDS: { key: RentBand; label: string; min: number; max: number }[] = [
  { key: 'all', label: 'Any rent', min: 0, max: Infinity },
  { key: 'lt50', label: 'Under AED 50k', min: 0, max: 50_000 },
  { key: '50to100', label: 'AED 50k – 100k', min: 50_000, max: 100_000 },
  { key: '100to200', label: 'AED 100k – 200k', min: 100_000, max: 200_000 },
  { key: 'gt200', label: 'AED 200k +', min: 200_000, max: Infinity },
];

function inStatusTab(it: { status: string | null; startDate: string | null; endDate: string | null }, tab: StatusTab, today: Date): boolean {
  if (tab === 'all') return true;
  const s = String(it.status ?? '').toLowerCase();
  if (tab === 'upcoming') { const st = toDate(it.startDate); return !!st && st > today; }
  if (tab === 'ending') {
    const end = toDate(it.endDate);
    const left = end ? daysBetween(today, end) : null;
    return (s === 'active' || s === 'renewed') && left !== null && left >= 0 && left <= ENDING_SOON_DAYS;
  }
  if (tab === 'other') return !KNOWN_STATUSES.has(s);
  return s === tab;
}
/** Compact band names for the pill and the menu (AED implied). */
const RENT_SHORT: Record<RentBand, string> = { all: 'Any rent', lt50: 'Under 50k', '50to100': '50k – 100k', '100to200': '100k – 200k', gt200: '200k +' };
const inRentBand = (fils: number | null, band: RentBand) => {
  if (band === 'all') return true;
  const b = RENT_BANDS.find(x => x.key === band)!;
  const aed = Number(fils ?? 0) / 100;
  return aed >= b.min && aed < b.max;
};

/* ── formatting helpers ────────────────────────────────────────────────────── */
const fmtAed = (fils: number | null | undefined): string =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(fils ?? 0) / 100);
/** Compact axis label — 60k, 1.2M. */
const fmtShort = (fils: number): string => {
  const n = fils / 100;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};
/** Date-only part of an ISO string, parsed as a local date (no UTC day shift). */
const toDate = (s: string | null): Date | null => {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
const fmtDate = (s: string | null): string => {
  const d = toDate(s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
};
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
const toCsvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvMoney = (fils: unknown) => (fils == null ? '' : (Number(fils) / 100).toFixed(2));
const csvDate = (s: unknown) => (s ? new Date(String(s)).toISOString().slice(0, 10) : '');

/** Month index (0–11) a row stands for — from its leases' start date, else its label. */
function monthOf(row: MonthRow): number {
  const d = toDate(row.items?.find(i => i.startDate)?.startDate ?? null);
  if (d) return d.getMonth();
  const label = row.monthLabel.toLowerCase();
  return MONTHS_L.findIndex(m => label.startsWith(m.toLowerCase()) || label.startsWith(m.slice(0, 3).toLowerCase()));
}

/** The API's unit label may already read "Unit 113" — never print "Unit Unit 113". */
const unitText = (label: string | null) => (!label ? '—' : /^unit\b/i.test(label.trim()) ? label.trim() : `Unit ${label.trim()}`);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const AVATAR_HUES = [
  'bg-[#eef7f2] text-[#047246]', 'bg-[#e8eefc] text-[#2b4fa8]', 'bg-[#fbeee4] text-[#9a4a12]',
  'bg-[#f1e9fb] text-[#6a3cb0]', 'bg-[#fdf3dc] text-[#8a5a00]', 'bg-[#e6f4f6] text-[#1c6670]',
];
const hueFor = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 997; return AVATAR_HUES[h % AVATAR_HUES.length]; };

/** Same status palette as the generic report's stage pills, so a status reads the same everywhere. */
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-[#eef7f2] text-[#047246]',
  renewed: 'bg-[#dcfce7] text-[#166534]',
  issued: 'bg-[#dbeafe] text-[#1e40af]',
  signed: 'bg-[#dbeafe] text-[#1e40af]',
  expired: 'bg-[#edf1ee] text-[#46534c]',
  terminated: 'bg-[#fee2e2] text-[#b91c1c]',
};

type SortKey = 'start' | 'tenant' | 'rent' | 'end';
type Group = { month: number; row: MonthRow; items: LeaseItem[] };

export function LeasesMonthlyReport({
  endpointBase = '/api/reports',
  extraQuery,
  backHref,
  onBack,
  contractsBase = '/rental-provider/dashboard/contracts',
  onSwitchView,
}: {
  endpointBase?: string;
  extraQuery?: string;
  backHref?: string;
  onBack?: () => void;
  contractsBase?: string;
  /** Monthly | Yearly switch — overrides route navigation (manager portal). */
  onSwitchView?: (slug: string, query: URLSearchParams) => void;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openLeaseId = Number(sp?.get('lease')) || null;
  const listScrollRef = useRef(0);

  /* ── filters (seeded from the address, like the generic view) ── */
  const [year, setYear] = useState<number>(() => Number(sp?.get('year')) || yearForMatrix(getReportsYear()));
  const [selectedBuildings, setSelectedBuildings] = useState<number[]>(
    () => (sp?.get('buildings') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0),
  );
  const [selectedLeaseTypes, setSelectedLeaseTypes] = useState<LeaseType[]>(() => {
    const picked = (sp?.get('leaseTypes') ?? '').split(',').filter(t => (ALL_LEASE_TYPES as string[]).includes(t)) as LeaseType[];
    return picked.length ? picked : [...ALL_LEASE_TYPES];
  });
  const [search, setSearch] = useState(() => sp?.get('q') ?? '');
  const [month, setMonth] = useState<number | null>(() => {
    const m = Number(sp?.get('month'));
    return Number.isInteger(m) && m >= 1 && m <= 12 ? m - 1 : null;
  });
  const [statusTab, setStatusTab] = useState<StatusTab>(() => {
    const s = sp?.get('status');
    return STATUS_TABS.some(t => t.key === s) ? (s as StatusTab) : 'all';
  });
  const [rentBand, setRentBand] = useState<RentBand>(() => {
    const r = sp?.get('rent');
    return RENT_BANDS.some(b => b.key === r) ? (r as RentBand) : 'all';
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(() => {
    const k = sp?.get('sort') as SortKey | null;
    // Default: the most recent month on top.
    if (!k || !['start', 'tenant', 'rent', 'end'].includes(k)) return { key: 'start', dir: sp?.get('dir') === 'asc' ? 1 : -1 };
    return { key: k, dir: sp?.get('dir') === 'desc' ? -1 : 1 };
  });
  // Row density — a per-viewer convenience only.
  const [compact, setCompact] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(DENSITY_KEY) === 'compact'; } catch { return false; }
  });
  const toggleDensity = () => setCompact(c => {
    try { window.localStorage.setItem(DENSITY_KEY, c ? 'comfortable' : 'compact'); } catch { /* ignore */ }
    return !c;
  });
  // Collapsed months survive a reload — a per-viewer convenience only.
  // The viewer's own expand / collapse choice; null until they make one, and
  // then the default applies (the 3 most recent months open, older ones folded).
  const [collapsedPref, setCollapsedPref] = useState<Set<number> | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      return raw ? new Set((JSON.parse(raw) as number[]).filter(n => Number.isInteger(n))) : null;
    } catch { return null; } // storage unavailable — use the default
  });
  const [showAbout, setShowAbout] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const [reloadKey, setReloadKey] = useState(0);

  // Follow the hub-wide Reports year unless the address pinned one.
  const hubYear = useReportsYear();
  const yearPinned = useRef(!!sp?.get('year'));
  useEffect(() => { if (!yearPinned.current) setYear(yearForMatrix(hubYear)); }, [hubYear]);

  // While a filter or search narrows the list, every matching month opens — the
  // saved "Collapse all" must never hide the leases a filter was asked to show.
  // Collapsing while filtered lasts only for that filter.
  const [filterCollapsed, setFilterCollapsed] = useState<{ key: string; months: Set<number> }>({ key: '', months: new Set() });
  const saveCollapsed = (next: Set<number>) => {
    setCollapsedPref(next);
    try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  };

  const url = useMemo(() => {
    const q = new URLSearchParams(extraQuery);
    q.set('year', String(year));
    if (selectedBuildings.length) q.set('buildings', selectedBuildings.join(','));
    // Send lease types only for a strict subset; all or none means all.
    if (selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length)
      q.set('leaseTypes', selectedLeaseTypes.join(','));
    return `${endpointBase}/leases-by-year?${q.toString()}`;
  }, [endpointBase, extraQuery, year, selectedBuildings, selectedLeaseTypes]);
  const reqKey = `${url}#${reloadKey}`;

  // The last answer, tagged with the request it answers. Loading = the current
  // request hasn't answered yet; the previous data stays on screen meanwhile.
  const [result, setResult] = useState<{ key: string; data?: Payload; error?: string } | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(url, { credentials: 'include' })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then(d => {
        if (!alive) return;
        setResult({ key: reqKey, data: d });
        setData(d);
        // Only years that hold data are offered; snap to the latest if this one has none.
        const ys = d.availableYears;
        if (ys?.length && !ys.includes(year)) setYear(Math.max(...ys));
      })
      .catch(e => { if (alive) setResult({ key: reqKey, error: String(e?.message ?? e) }); });
    return () => { alive = false; };
  }, [url, reqKey, year]);
  const loading = result?.key !== reqKey;
  const error = !loading ? result?.error ?? null : null;

  const yearOptions = data?.availableYears?.length ? [...data.availableYears].sort((a, b) => b - a) : REPORT_YEARS;

  // Changing the scope drops the month filter — the month may not exist in the new data.
  const pickYear = (y: number) => { yearPinned.current = true; setYear(y); setMonth(null); };
  const pickBuildings = (b: number[]) => { setSelectedBuildings(b); setMonth(null); };
  const pickLeaseTypes = (lt: LeaseType[]) => { setSelectedLeaseTypes(lt); setSelectedBuildings([]); setMonth(null); };

  const buildingOptions = data?.buildings ?? [];
  const propertyOptions = selectedLeaseTypes.length === 1
    ? buildingOptions.filter(b => b.leasingType === selectedLeaseTypes[0])
    : buildingOptions;

  /* ── derived: month groups after search (+ chart totals before the month filter) ── */
  const today = useMemo(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }, []);
  /** Search + rent band — the filters the status tabs count under. */
  const passesBase = useCallback((it: LeaseItem) => {
    const needle = search.trim().toLowerCase();
    if (!inRentBand(it.annualRentFils, rentBand)) return false;
    return !needle || [it.contractRef, it.tenantName, it.unitLabel, it.unitLabel ? `unit ${it.unitLabel}` : '', it.buildingName, it.status]
      .some(v => String(v ?? '').toLowerCase().includes(needle));
  }, [search, rentBand]);

  const statusCounts = useMemo(() => {
    const out = Object.fromEntries(STATUS_TABS.map(t => [t.key, 0])) as Record<StatusTab, number>;
    for (const row of data?.rows ?? []) for (const it of row.items ?? []) {
      if (!passesBase(it)) continue;
      for (const t of STATUS_TABS) if (inStatusTab(it, t.key, today)) out[t.key] += 1;
    }
    return out;
  }, [data, passesBase, today]);

  /** Leases per rent band under the other filters — the rent menu shows the spread. */
  const rentCounts = useMemo(() => {
    const out = Object.fromEntries(RENT_BANDS.map(b => [b.key, 0])) as Record<RentBand, number>;
    const needle = search.trim().toLowerCase();
    for (const row of data?.rows ?? []) for (const it of row.items ?? []) {
      if (!inStatusTab(it, statusTab, today)) continue;
      if (needle && ![it.contractRef, it.tenantName, it.unitLabel, it.unitLabel ? `unit ${it.unitLabel}` : '', it.buildingName, it.status]
        .some(v => String(v ?? '').toLowerCase().includes(needle))) continue;
      for (const b of RENT_BANDS) if (inRentBand(it.annualRentFils, b.key)) out[b.key] += 1;
    }
    return out;
  }, [data, search, statusTab, today]);

  const searched: Group[] = useMemo(() => {
    const narrowed = !!search.trim() || rentBand !== 'all' || statusTab !== 'all';
    return (data?.rows ?? [])
      .map(row => {
        const items = row.items ?? [];
        const matched = !narrowed ? items : items.filter(it => passesBase(it) && inStatusTab(it, statusTab, today));
        // With a filter active the month's figures describe the rows shown beneath it.
        const summary = narrowed
          ? { ...row, leases: matched.length, annualRentFils: matched.reduce((s, it) => s + Number(it.annualRentFils ?? 0), 0) }
          : row;
        return { month: monthOf(row), row: summary, items: matched };
      })
      .filter(g => g.items.length > 0);
  }, [data, search, rentBand, statusTab, passesBase, today]);

  const groups = useMemo(() => (month === null ? searched : searched.filter(g => g.month === month)), [searched, month]);

  const byMonth = useMemo(() => {
    const out = MONTHS.map(() => ({ count: 0, rentFils: 0 }));
    for (const g of searched) if (g.month >= 0) { out[g.month].count += g.row.leases; out[g.month].rentFils += Number(g.row.annualRentFils ?? 0); }
    return out;
  }, [searched]);
  const maxMonth = Math.max(1, ...byMonth.map(m => m.rentFils));
  // The busiest month (most rent commenced) — highlighted in gold in the chart and the register.
  const peakMonth = byMonth.some(m => m.rentFils > 0) ? byMonth.reduce((b, m, i) => (m.rentFils > byMonth[b].rentFils ? i : b), 0) : -1;

  const visibleItems = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const visibleRent = visibleItems.reduce((s, it) => s + Number(it.annualRentFils ?? 0), 0);

  const sortedFlat = useMemo(() => {
    const val = (it: LeaseItem): string | number => {
      if (sort.key === 'tenant') return (it.tenantName ?? '').toLowerCase();
      if (sort.key === 'rent') return Number(it.annualRentFils ?? 0);
      if (sort.key === 'end') return it.endDate ?? '';
      return it.startDate ?? '';
    };
    return [...visibleItems].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [visibleItems, sort]);

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'rent' || key === 'start' ? -1 : 1 }));

  /** Months in display order, each with its leases in display order. */
  const orderedGroups = useMemo(() => [...groups]
    .sort((a, b) => (a.month - b.month) * sort.dir)
    .map(g => ({ ...g, items: [...g.items].sort((a, b) => ((a.startDate ?? '') > (b.startDate ?? '') ? 1 : -1) * sort.dir) })),
  [groups, sort.dir]);
  /** Every lease in the order the list shows it — what previous / next walk through. */
  const ordered = useMemo(
    () => (sort.key === 'start' ? orderedGroups.flatMap(g => g.items) : sortedFlat).filter(it => it.contractId != null),
    [sort.key, orderedGroups, sortedFlat],
  );
  const openPos = openLeaseId == null ? -1 : ordered.findIndex(it => it.contractId === openLeaseId);
  const openItem = openPos >= 0 ? ordered[openPos] : (data?.rows ?? []).flatMap(r => r.items ?? []).find(it => it.contractId === openLeaseId) ?? null;

  const leaseHref = useCallback((id: number | null) => {
    const q = new URLSearchParams(sp?.toString() ?? '');
    if (id == null) q.delete('lease'); else q.set('lease', String(id));
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [sp, pathname]);
  // The view lives in the address — a reload, a shared link and Back all keep it.
  // history.replaceState (not router.replace) so typing in search never waits on
  // a navigation; Next keeps useSearchParams in step with it.
  useEffect(() => {
    if (openLeaseId != null) return;
    const id = window.setTimeout(() => {
      const q = new URLSearchParams(window.location.search);
      const put = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k));
      put('year', yearPinned.current ? String(year) : null);
      put('buildings', selectedBuildings.length ? selectedBuildings.join(',') : null);
      put('leaseTypes', selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length ? selectedLeaseTypes.join(',') : null);
      put('status', statusTab !== 'all' ? statusTab : null);
      put('rent', rentBand !== 'all' ? rentBand : null);
      put('month', month !== null ? String(month + 1) : null);
      put('q', search.trim() || null);
      put('sort', sort.key !== 'start' ? sort.key : null);
      put('dir', sort.key === 'start' ? (sort.dir > 0 ? 'asc' : null) : (sort.dir < 0 ? 'desc' : null));
      const qs = q.toString();
      if (qs !== window.location.search.replace(/^\?/, '')) window.history.replaceState(window.history.state, '', qs ? `${pathname}?${qs}` : pathname);
    }, 250);
    return () => window.clearTimeout(id);
  }, [openLeaseId, year, selectedBuildings, selectedLeaseTypes, statusTab, rentBand, month, search, sort, pathname]);

  const openLease = (id: number) => {
    if (openLeaseId == null) listScrollRef.current = window.scrollY;
    router.push(leaseHref(id), { scroll: false });
    window.scrollTo(0, 0);
  };
  // For buttons that carry their lease id in data-lease (the renewals band).
  const openLeaseFromData = (e: React.MouseEvent<HTMLElement>) => {
    const id = Number(e.currentTarget.dataset.lease);
    if (id) openLease(id);
  };
  const closeLease = useCallback(() => {
    router.push(leaseHref(null), { scroll: false });
    const y = listScrollRef.current;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [router, leaseHref]);
  const stepLease = useCallback((delta: number) => {
    const next = ordered[openPos + delta];
    if (openPos >= 0 && next?.contractId != null) { router.replace(leaseHref(next.contractId), { scroll: false }); window.scrollTo(0, 0); }
  }, [ordered, openPos, router, leaseHref]);

  /* ── keyboard: "/" focuses search, Esc clears it; on a lease J / K step, Esc returns ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        || (el instanceof HTMLElement && el.isContentEditable);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (openLeaseId != null) {
        // A dialog inside the lease record owns the keyboard while it is open.
        if (typing || document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
        if (e.key === 'Escape') closeLease();
        if (e.key === 'j') stepLease(1);
        if (e.key === 'k') stepLease(-1);
        return;
      }
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape' && el === searchRef.current) { setSearch(''); searchRef.current?.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLeaseId, closeLease, stepLease]);

  /* ── CSV — same layout the generic view exported ── */
  const handleCsv = useCallback(() => {
    if (!data) return;
    const headers = ['Month', 'Contract', 'Customer', 'Unit', 'Property', 'Start', 'End', 'Annual rent', 'Status'];
    const rows: string[][] = groups.flatMap(g => g.items.map(it => [
      g.row.monthLabel, it.contractRef ?? '', it.tenantName ?? '', it.unitLabel ?? '', it.buildingName ?? '',
      csvDate(it.startDate), csvDate(it.endDate), csvMoney(it.annualRentFils), it.status ?? '',
    ]));
    rows.push([]);
    rows.push(['Summary by month']);
    rows.push(['Commenced', 'Leases', 'Rent commenced']);
    for (const g of groups) rows.push([g.row.monthLabel, String(g.row.leases ?? 0), csvMoney(g.row.annualRentFils)]);
    rows.push(['Total', String(groups.reduce((s, g) => s + (Number(g.row.leases) || 0), 0)),
      (groups.reduce((s, g) => s + (Number(g.row.annualRentFils) || 0), 0) / 100).toFixed(2)]);
    rows.push([]);
    rows.push(['The year’s share of the book']);
    rows.push(['Annual rent contracted', csvMoney(data.totals?.annualRentFils)]);
    rows.push(['Commenced in this year', csvMoney(data.totals?.commencedRentFils)]);
    rows.push(['Commenced earlier, still running', csvMoney(data.totals?.carriedRentFils)]);
    rows.push([]);
    // The byte-order mark tells Excel the file is UTF-8, so ’ and – don't come out garbled.
    const csv = '\uFEFF' + [headers.map(toCsvCell).join(','), ...rows.map(r => r.map(toCsvCell).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `leases-by-year-${new Date(data.generatedAt).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data, groups]);

  /* ── figures ── */
  const t = data?.totals ?? {};
  const annualFils = Number(t.annualRentFils ?? 0);
  const commencedFils = Number(t.commencedRentFils ?? 0);
  const carriedFils = Number(t.carriedRentFils ?? 0);
  const leasesCommenced = Number(t.leases ?? 0);
  const splitBase = Math.max(annualFils, commencedFils + carriedFils, 1);
  const allMonths = searched.map(g => g.month);
  // Default view: the 3 most recent months with leases open, the rest folded to
  // their one-line summary — until the viewer expands or collapses something.
  const RECENT_OPEN = 3;
  const recentOpen = new Set([...allMonths].sort((a, b) => b - a).slice(0, RECENT_OPEN));
  const collapsed = collapsedPref ?? new Set(allMonths.filter(m => !recentOpen.has(m)));
  const narrowing = statusTab !== 'all' || !!search.trim() || month !== null || rentBand !== 'all';
  const filterKey = `${statusTab}|${search.trim()}|${month}|${rentBand}|${year}`;
  const shownCollapsed = narrowing ? (filterCollapsed.key === filterKey ? filterCollapsed.months : new Set<number>()) : collapsed;
  const setShownCollapsed = (next: Set<number>) => (narrowing ? setFilterCollapsed({ key: filterKey, months: next }) : saveCollapsed(next));
  const allCollapsed = allMonths.length > 0 && allMonths.every(m => shownCollapsed.has(m));
  const filtersNarrowed = selectedBuildings.length > 0 || (selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length);
  const anyFilter = filtersNarrowed || rentBand !== 'all' || statusTab !== 'all' || month !== null || !!search.trim();
  const clearAll = () => { pickLeaseTypes([...ALL_LEASE_TYPES]); setRentBand('all'); setStatusTab('all'); setSearch(''); };
  const ending = statusCounts.ending;

  const backCls = 'w-8 h-8 shrink-0 grid place-items-center rounded-full border border-[#e4e9e5] bg-white text-[#46534c] hover:text-[#14201a] hover:border-[#d3dad5]';
  const BackLink = onBack ? (
    <button type="button" onClick={onBack} className={backCls} title="All Reports" aria-label="Back to all reports">
      <ArrowLeft size={15} />
    </button>
  ) : (
    <Link href={backHref ?? '/rental-provider/dashboard/reports'} className={backCls} title="All Reports" aria-label="Back to all reports">
      <ArrowLeft size={15} />
    </Link>
  );

  if (openLeaseId != null) {
    const prev = openPos > 0 ? ordered[openPos - 1] : null;
    const next = openPos >= 0 ? ordered[openPos + 1] ?? null : null;
    return (
      <div className={cn('min-h-screen bg-[#f6f8f6] text-[14px] text-[#14201a]', leasesThemeClass)}>
        <LeasesThemeStyles />
        <div className="sticky top-0 z-30 border-b border-[#e4e9e5] bg-[#f6f8f6]/90 backdrop-blur print:hidden">
          <div className="max-w-[1240px] mx-auto px-7 h-12 flex items-center gap-2 text-[13px]">
            <nav className="flex items-center gap-1.5 min-w-0 text-[#6f7a73]" aria-label="Breadcrumb">
              <button onClick={onBack ?? (() => router.push(backHref ?? '/rental-provider/dashboard/reports'))} className="hover:text-[#14201a] hidden sm:inline">Reports</button>
              <ChevronRight size={12} className="hidden sm:inline" />
              <button onClick={closeLease} className="hover:text-[#14201a] inline-flex items-center gap-1"><ArrowLeft size={13} className="sm:hidden" />Leases – Monthly</button>
              <ChevronRight size={12} />
              <span className="font-medium text-[#14201a] truncate">{openItem?.contractRef ?? `CID-${openLeaseId}`}</span>
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
              {openPos >= 0 && <span className="text-xs text-[#6f7a73] tabular-nums mr-1 hidden sm:inline">{openPos + 1} of {ordered.length}</span>}
              <button onClick={() => stepLease(-1)} disabled={!prev} title={prev ? `Previous: ${prev.tenantName ?? prev.contractRef} (K)` : 'No previous lease'}
                className="w-8 h-8 grid place-items-center rounded-lg border border-[#e4e9e5] bg-white text-[#46534c] hover:border-[#d3dad5] disabled:opacity-40"><ChevronLeft size={15} /></button>
              <button onClick={() => stepLease(1)} disabled={!next} title={next ? `Next: ${next.tenantName ?? next.contractRef} (J)` : 'No next lease'}
                className="w-8 h-8 grid place-items-center rounded-lg border border-[#e4e9e5] bg-white text-[#46534c] hover:border-[#d3dad5] disabled:opacity-40"><ChevronRight size={15} /></button>
              <Link href={`${contractsBase}/${openLeaseId}/v2${sp?.get('rp') ? `?rp=${sp.get('rp')}` : ''}`} title="Open on its own page"
                className="ml-1 h-8 px-2.5 rounded-lg text-xs font-medium text-[#46534c] hover:text-[#14201a] hover:bg-white inline-flex items-center gap-1">
                <ExternalLink size={13} /><span className="hidden md:inline">Full page</span>
              </Link>
            </div>
          </div>
        </div>
        <ContractV2View key={openLeaseId} contractId={openLeaseId} view="record" onBack={closeLease} />
      </div>
    );
  }

  return (
    <div className={cn('min-h-full bg-[#f6f8f6] text-[14px] text-[#14201a] print:bg-white', leasesThemeClass)}>
    <LeasesThemeStyles />
    <div className="px-4 sm:px-8 pt-5 pb-16 print:p-0 max-w-[1360px] mx-auto">
      {/* ── Header — one toolbar: back · title · year · filters · actions.
          The subtitle and the counting basis live behind the ⓘ. ── */}
      <div className="flex items-center gap-2 mb-3 print:hidden">
        {BackLink}
        <h1 className="ms-serif m-0 text-[30px] leading-none text-[#0b3d2a] whitespace-nowrap !font-[700]">Leases – Monthly</h1>
        <LeasesViewSwitch current="monthly" year={year} buildings={selectedBuildings} leaseTypes={selectedLeaseTypes}
          allLeaseTypes={ALL_LEASE_TYPES.length} reportsBase={backHref} onSwitch={onSwitchView} />
        <button type="button" onClick={() => setShowAbout(v => !v)} aria-expanded={showAbout}
          className={cn('w-7 h-7 grid place-items-center rounded-full transition-colors', showAbout ? 'bg-[#eef7f2] text-[#047246]' : 'text-[#6f7a73] hover:text-[#047246] hover:bg-white')}
          title="What this report shows and how it counts" aria-label="About this report">
          <Info size={15} />
        </button>
        <span className="hidden lg:inline text-[13px] text-[#6f7a73] truncate">New leases by the month they commenced in {year}</span>
      </div>

      {/* Filters + export — one line; wraps only on narrow screens. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3 print:hidden">

        <div className="inline-flex rounded-full border border-[#e4e9e5] bg-white p-0.5" role="tablist" aria-label="Year">
          {yearOptions.slice(0, 4).map(y => (
            <button key={y} role="tab" aria-selected={year === y} onClick={() => pickYear(y)}
              className={cn('h-7 px-2.5 rounded-full text-[13px] font-semibold tabular-nums transition-colors',
                year === y ? 'bg-[#e6f4ed] text-[#0b3d2a] ring-1 ring-inset ring-[#9fd3bd]' : 'text-[#46534c] hover:text-[#14201a] hover:bg-[#f9fbf9]')}>
              {y}
            </button>
          ))}
          {yearOptions.length > 4 && (
            <PillSelect variant="inset" label="Earlier years" active={!yearOptions.slice(0, 4).includes(year)}
              value={String(year)} display={yearOptions.slice(0, 4).includes(year) ? 'Earlier' : String(year)}
              onChange={v => pickYear(Number(v))}
              options={yearOptions.slice(4).map(y => ({ value: String(y), label: String(y) }))} />
          )}
        </div>
        {/* Lease type — four short choices, so a one-click segmented switch, not a menu. */}
        <div className="inline-flex rounded-full border border-[#e4e9e5] bg-white p-0.5" role="radiogroup" aria-label="Lease type">
          {(['all', ...ALL_LEASE_TYPES] as const).map(lt => {
            const on = lt === 'all' ? selectedLeaseTypes.length !== 1 : selectedLeaseTypes.length === 1 && selectedLeaseTypes[0] === lt;
            return (
              <button key={lt} type="button" role="radio" aria-checked={on}
                title={lt === 'all' ? 'Every lease type' : LEASE_TYPE_HINT[lt]}
                onClick={() => pickLeaseTypes(lt === 'all' ? [...ALL_LEASE_TYPES] : [lt])}
                className={cn('h-7 px-2.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all duration-150',
                  on ? 'bg-[#e6f4ed] text-[#0b3d2a] ring-1 ring-inset ring-[#9fd3bd]' : 'text-[#46534c] hover:text-[#14201a] hover:bg-[#f4faf7]')}>
                {lt === 'all' ? 'All types' : LEASE_TYPE_LABEL[lt]}
              </button>
            );
          })}
        </div>
        <PropertyPicker options={propertyOptions} selected={selectedBuildings} onChange={pickBuildings} />
        <PillSelect label="Annual rent" active={rentBand !== 'all'} value={rentBand}
          onChange={v => { setRentBand(v as RentBand); setMonth(null); }}
          icon={<Banknote size={13} className={rentBand !== 'all' ? 'text-[#047246]' : 'text-[#6f7a73]'} />}
          display={RENT_SHORT[rentBand]}
          options={RENT_BANDS.map(b => ({ value: b.key, label: b.key === 'all' ? 'Any rent' : `AED ${RENT_SHORT[b.key]}`, count: rentCounts[b.key] }))}
          footnote="Annual rent · number of leases" />
        {loading && data && <Loader2 size={15} className="animate-spin text-[#6f7a73] ml-1" aria-label="Updating" />}

        <div className="ml-auto">
          <ExportMenu disabled={!data || loading} rows={visibleItems.length} onCsv={handleCsv} onPrint={() => window.print()} />
        </div>
      </div>

      {showAbout && (
        <div className="mb-4 rounded-2xl border border-[#d8efe3] bg-[#eef7f2] px-4 py-3 text-[13px] leading-relaxed text-[#46534c] print:hidden">
          <p className="m-0 font-semibold text-[#14201a]">New leases grouped by the month they commenced in {year}.</p>
          <p className="m-0 mt-1">
            Each unit’s <b>current</b> lease is listed once, under the month it <b>commenced</b> in the selected year — a renewed unit is
            never double-counted, so the totals reconcile with Lease Revenue and the Portfolio page. <b>Annual rent contracted</b> is the
            whole earning book and doesn’t move with the year (the same figure Cash Management opens with); what the year changes is how
            much of it commenced inside the year. Rent <i>falling due</i> in a year is Cash Management’s question.
          </p>
          <BasisNote slug="leases-by-year" className="mt-2" />
        </div>
      )}
      {/* Print-only header */}
      <div className="hidden print:block mb-5">
        <h1 className="text-xl font-bold">Leases – Monthly · {year}</h1>
        {data && <p className="text-xs text-[#46534c]">Generated {new Date(data.generatedAt).toLocaleString('en-AE', { timeZone: 'Asia/Dubai' })}</p>}
        {anyFilter && (
          <p className="text-xs text-[#46534c]">
            Filtered: {[
              selectedLeaseTypes.length < ALL_LEASE_TYPES.length ? selectedLeaseTypes.map(lt => LEASE_TYPE_LABEL[lt]).join(', ') : null,
              selectedBuildings.length ? selectedBuildings.map(id => buildingOptions.find(b => b.id === id)?.name ?? `#${id}`).join(', ') : null,
              rentBand !== 'all' ? RENT_BANDS.find(b => b.key === rentBand)!.label : null,
              statusTab !== 'all' ? STATUS_TABS.find(x => x.key === statusTab)!.label : null,
              month !== null ? MONTHS_L[month] : null,
              search.trim() ? `“${search.trim()}”` : null,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {/* ── Active filters — every narrowing in one place, each removable ── */}
      {anyFilter && (
        <div className="flex items-center gap-1.5 flex-wrap -mt-1 mb-4 print:hidden" aria-label="Active filters">
          <span className="text-[12px] font-medium text-[#6f7a73] mr-0.5">Filtered by</span>
          {selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length && (
            <FilterChip label="Type" value={selectedLeaseTypes.map(lt => LEASE_TYPE_LABEL[lt]).join(', ')} onClear={() => pickLeaseTypes([...ALL_LEASE_TYPES])} />
          )}
          {selectedBuildings.length > 0 && (
            <FilterChip label="Property"
              value={selectedBuildings.length <= 2
                ? selectedBuildings.map(id => buildingOptions.find(b => b.id === id)?.name ?? `#${id}`).join(', ')
                : `${buildingOptions.find(b => b.id === selectedBuildings[0])?.name ?? `#${selectedBuildings[0]}`} +${selectedBuildings.length - 1}`}
              onClear={() => pickBuildings([])} />
          )}
          {rentBand !== 'all' && <FilterChip label="Rent" value={RENT_BANDS.find(b => b.key === rentBand)!.label} onClear={() => setRentBand('all')} />}
          {statusTab !== 'all' && <FilterChip label="Status" value={STATUS_TABS.find(t => t.key === statusTab)!.label} onClear={() => setStatusTab('all')} />}
          {month !== null && <FilterChip label="Month" value={`${MONTHS_L[month]} ${year}`} onClear={() => setMonth(null)} />}
          {search.trim() && <FilterChip label="Search" value={`“${search.trim()}”`} onClear={() => setSearch('')} />}
          <button onClick={clearAll} className="ml-1 h-7 px-2 rounded-lg text-[12.5px] font-semibold text-[#047246] hover:bg-[#eef7f2]">Clear all</button>
        </div>
      )}

      {error ? (
        <div className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] p-5 flex items-start gap-3 text-sm text-[#991b1b]">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1"><b>Couldn’t load this report.</b><div className="text-[#b91c1c] mt-0.5">{error}</div></div>
          <button onClick={() => setReloadKey(k => k + 1)}
            className="h-8 px-3 rounded-lg border border-[#fecaca] bg-white text-[#991b1b] inline-flex items-center gap-1.5 text-xs font-medium">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : !data ? (
        <Skeleton />
      ) : (
        <div className={cn('transition-opacity', loading && 'opacity-60')}>
          {/* ── Overview — the book in one sentence, the things to act on, then
              rent by month (a bar filters the list). ── */}
          {(() => {
            const occupied = Number(t.occupiedUnits ?? 0);
            // One basis for the ring, its % label and the Earlier share, so they always agree.
            const share = annualFils ? Math.round((commencedFils / splitBase) * 100) : 0;
            const earlierShare = annualFils ? Math.round((carriedFils / splitBase) * 100) : 0;
            const avgNew = leasesCommenced ? commencedFils / leasesCommenced : 0;
            const avgBook = occupied ? annualFils / occupied : 0;
            const vsBook = avgNew && avgBook ? Math.round(((avgNew - avgBook) / avgBook) * 100) : null;
            // Leases in the renewal window, soonest first — the next one is named.
            const endingList = (data.rows ?? []).flatMap(r => r.items ?? [])
              .filter(it => inStatusTab(it, 'ending', today))
              .sort((a, b) => String(a.endDate ?? '').localeCompare(String(b.endDate ?? '')));
            const nextEnd = endingList[0];
            const peak = byMonth.reduce((best, m, i) => (m.rentFils > (best ? byMonth[best.i].rentFils : 0) ? { i } : best), null as { i: number } | null);
            const activeMonths = byMonth.filter(m => m.rentFils > 0);
            const avgMonth = activeMonths.length ? activeMonths.reduce((s, m) => s + m.rentFils, 0) / activeMonths.length : 0;
            const nowMonth = year === today.getFullYear() ? today.getMonth() : -1;
            // Strip under the chart — what needs attention, in counts.
            const endingAtStake = endingList.reduce((sum, it) => sum + Number(it.annualRentFils ?? 0), 0);
            const ended = statusCounts.expired + statusCounts.terminated;
            const notStarted = statusCounts.upcoming;
            // Months of the year so far with no new lease (a future year has none yet).
            const monthsSoFar = year < today.getFullYear() ? 12 : year === today.getFullYear() ? today.getMonth() + 1 : 0;
            const quietMonths = byMonth.slice(0, monthsSoFar).filter(m => m.rentFils === 0).length;
            const pickMonth = (i: number) => {
              const on = month === i;
              setMonth(on ? null : i);
              if (!on && collapsed.has(i)) { const n = new Set(collapsed); n.delete(i); saveCollapsed(n); }
            };
            return (
              <div className="mb-4 space-y-2.5 print:break-inside-avoid">
                {/* Renewals to act on — only when something is due. The count, then
                    the soonest leases themselves (each opens its record), then the
                    filter. Urgency is carried by each lease's day count, not the card. */}
                {nextEnd && (() => {
                  const soonest = endingList.slice(0, 3);
                  const more = ending - soonest.length;
                  // What is at stake, in the landlord's terms: the rent these leases carry.
                  const atStake = endingList.reduce((t, it) => t + Number(it.annualRentFils ?? 0), 0);
                  const firstLeft = nextEnd.endDate ? daysBetween(today, toDate(nextEnd.endDate)!) : null;
                  // Urgency per lease: ≤30 days red, ≤90 amber, else calm.
                  const urg = (d: number | null) => d !== null && d <= 30
                    ? { bar: 'bg-[#c2413b]', chip: 'bg-[#fdecea] text-[#b3261e]' }
                    : d !== null && d <= 90
                      ? { bar: 'bg-[#e0a526]', chip: 'bg-[#fdf3dc] text-[#8a5a00]' }
                      : { bar: 'bg-[#a8d9c2]', chip: 'bg-[#eef7f2] text-[#047246]' };
                  return (
                    <div className="lm-up flex items-center gap-x-5 gap-y-3 flex-wrap rounded-2xl bg-white border border-black/[0.07] pl-4 pr-4 py-3.5 text-[13px] text-[#46534c] shadow-[0_1px_2px_rgba(16,24,20,.04)] print:border-[#e4e9e5]">
                      {/* The headline: how many, what rent, how soon. */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="lm-glow w-11 h-11 shrink-0 rounded-xl grid place-items-center bg-gradient-to-br from-[#f5c26b] to-[#e0a526] text-[#5a3a06]" aria-hidden><CalendarClock size={19} strokeWidth={2.2} /></span>
                        <div className="min-w-0">
                          <div className="text-[15px] font-semibold text-[#14201a] leading-tight">
                            {ending} lease{ending === 1 ? '' : 's'} due for renewal
                          </div>
                          <div className="mt-0.5 text-[12.5px] text-[#6f7a73] tabular-nums">
                            {atStake > 0 && <><b className="font-semibold text-[#14201a]">{fmtAed(atStake)}</b> annual rent · </>}
                            {firstLeft !== null ? <>first ends in <b className="font-semibold text-[#14201a]">{firstLeft} day{firstLeft === 1 ? '' : 's'}</b></> : `within ${ENDING_SOON_DAYS} days`}
                          </div>
                        </div>
                      </div>

                      {/* The leases themselves — white cards with an urgency edge;
                          each opens its record. */}
                      <div className="flex items-stretch gap-2.5 flex-1 min-w-0 flex-wrap lg:border-l lg:border-[#edf1ee] lg:pl-5">
                        {soonest.map(it => {
                          const left = it.endDate ? daysBetween(today, toDate(it.endDate)!) : null;
                          const u = urg(left);
                          const body = (
                            <>
                              <span className={cn('absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full', u.bar)} aria-hidden />
                              <span className="min-w-0 flex-1 text-left">
                                <span className="flex items-center gap-2">
                                  <b className="font-semibold text-[13.5px] text-[#14201a] truncate">{it.tenantName ?? it.contractRef}</b>
                                  {left !== null && <span className={cn('ml-auto shrink-0 px-2 h-5 inline-flex items-center rounded-full text-[11.5px] font-semibold tabular-nums', u.chip)}>{left} days left</span>}
                                </span>
                                <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#6f7a73] tabular-nums">
                                  <span className="truncate">{unitText(it.unitLabel)} · ends {fmtDate(it.endDate)}</span>
                                  {it.annualRentFils ? <span className="ml-auto shrink-0 font-medium text-[#46534c]">{fmtAed(it.annualRentFils)}</span> : null}
                                </span>
                              </span>
                            </>
                          );
                          const cls = 'relative flex items-center gap-2 rounded-xl border border-[#e6ebe8] bg-white pl-4 pr-3 py-2 min-w-0 flex-1 basis-[230px] max-w-[320px]';
                          return it.contractId != null ? (
                            <button key={it.contractId} type="button" data-lease={it.contractId} onClick={openLeaseFromData} title={`Open ${it.contractRef ?? 'lease'}`}
                              className={cn(cls, 'group transition-[border-color,box-shadow] hover:border-[#9fd3bd] hover:shadow-[0_2px_10px_-4px_rgba(4,114,70,.25)] print:hidden')}>
                              {body}
                              <ChevronRight size={14} className="shrink-0 text-[#b4bcb7] transition-colors group-hover:text-[#047246]" aria-hidden />
                            </button>
                          ) : (
                            <div key={`${it.contractRef}-${it.endDate}`} className={cls}>{body}</div>
                          );
                        })}
                        {more > 0 && <span className="self-center text-[12.5px] font-medium text-[#6f7a73] px-1">+{more} more</span>}
                      </div>

                      <button type="button" onClick={() => { setStatusTab(statusTab === 'ending' ? 'all' : 'ending'); setMonth(null); }}
                        className="ml-auto h-10 px-4 rounded-full text-[13px] font-semibold inline-flex items-center gap-1 bg-[#047246] text-white hover:bg-[#0b3d2a] transition-colors print:hidden">
                        {statusTab === 'ending' ? 'Show all leases' : <>Review {ending === 1 ? 'renewal' : `all ${ending}`} <ChevronRight size={14} /></>}
                      </button>
                    </div>
                  );
                })()}

                {/* The book + rent by month — one compact card. */}
                <section className="lm-up rounded-2xl border border-[#e4e9e5] bg-white shadow-[0_1px_2px_rgba(15,40,28,0.06),0_4px_16px_rgba(15,40,28,0.06)] grid lg:grid-cols-[minmax(300px,0.85fr)_1.6fr]" style={{ '--i': nextEnd ? 1 : 0 } as React.CSSProperties}>
                  {/* Left: the book */}
                  <div className="px-5 py-4 lg:border-r border-b lg:border-b-0 border-[#edf1ee] min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium text-[#5f6b63]">Annual rent contracted</span>
                      {!nextEnd && <span className="ml-auto inline-flex items-center gap-1 h-5 px-2 rounded-full bg-[#eef7f2] text-[#047246] text-[11px] font-semibold" title={`Every running lease has more than ${ENDING_SOON_DAYS} days left`}><Check size={11} /> No renewals due</span>}
                    </div>
                    {/* The book, and how much of it is this year's new business — as a ring. */}
                    <div className="mt-2 flex items-center gap-4">
                      <Ring size={96} stroke={8} pct={annualFils ? (commencedFils / splitBase) * 100 : 0} title={`${share}% of the rent on the book started in ${year}`}>
                        <b className="text-[21px] leading-none font-bold tabular-nums text-[#0b3d2a]">{share}<span className="text-[12px]">%</span></b>
                        <small className="mt-1 text-[10.5px] font-semibold text-[#5f6b63] whitespace-nowrap">new in {year}</small>
                      </Ring>
                      <div className="min-w-0">
                        <b className="block text-[26px] leading-none font-semibold tracking-[-0.025em] text-[#14201a] tabular-nums whitespace-nowrap"><CountUp value={annualFils} format={fmtAed} /></b>
                        <span className="mt-1 block text-[12.5px] text-[#6f7a73]">{occupied} occupied unit{occupied === 1 ? '' : 's'}</span>
                        <div className="mt-2.5 flex flex-col gap-1 text-[12.5px] tabular-nums">
                          <span className="inline-flex items-center gap-1.5 text-[#5f6b63]"><i className="w-2 h-2 rounded-full bg-gradient-to-br from-[#25946a] to-[#f5c26b]" />{year} <b className="font-semibold text-[#14201a]">{fmtAed(commencedFils)}</b></span>
                          <span className="inline-flex items-center gap-1.5 text-[#5f6b63]" title="Leases that began before this year and are still running — listed under their own year in the picker"><i className="w-2 h-2 rounded-full bg-[#cfe8da]" />Earlier <b className="font-semibold text-[#14201a]">{fmtAed(carriedFils)}</b> <span className="text-[#6f7a73]">{earlierShare}%</span></span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3.5 pt-3 border-t border-[#edf1ee] grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[12px] text-[#6f7a73]">New leases {year}</div>
                        <div className="text-[16px] font-semibold tabular-nums text-[#14201a]"><CountUp value={leasesCommenced} format={n => String(Math.round(n))} ms={700} /></div>
                      </div>
                      <div>
                        <div className="text-[12px] text-[#6f7a73]">Avg. new lease</div>
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-[16px] font-semibold tabular-nums text-[#14201a]">{avgNew ? <CountUp value={avgNew} format={fmtAed} /> : '—'}</span>
                          {vsBook !== null && vsBook !== 0 && (
                            <span className={cn('text-[11.5px] font-semibold px-1.5 rounded-md tabular-nums', vsBook > 0 ? 'bg-[#eef7f2] text-[#047246]' : 'bg-[#fdecea] text-[#b3261e]')}
                              title={`${Math.abs(vsBook)}% ${vsBook > 0 ? 'above' : 'below'} your average rent of ${fmtAed(avgBook)} across all occupied units`}>
                              {vsBook > 0 ? '▲' : '▼'} {Math.abs(vsBook)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: rent commenced by month */}
                  <div className="px-5 py-4 min-w-0 flex flex-col">
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[12.5px]">
                      <span className="font-medium text-[#5f6b63]">Rent commenced by month</span>
                      {peak && (
                        <button type="button" onClick={() => pickMonth(peak.i)}
                          className={cn('inline-flex items-center gap-1 h-6 px-2 rounded-full transition-colors print:pointer-events-none',
                            month === peak.i ? 'bg-[#e6f4ed] text-[#0b3d2a] ring-1 ring-inset ring-[#9fd3bd]' : 'bg-[#fdf3dc] text-[#5a3a06] ring-1 ring-inset ring-[#f3dca6] hover:bg-[#fbe7b8]')}
                          title="Busiest month — show its leases">
                          <i className="w-2 h-2 rounded-full bg-gradient-to-b from-[#f5c26b] to-[#e0a526]" aria-hidden />
                          Busiest <b className="font-semibold">{MONTHS[peak.i]}</b> · {fmtShort(byMonth[peak.i].rentFils)} · {byMonth[peak.i].count}
                        </button>
                      )}
                      {avgMonth > 0 && <span className="text-[#6f7a73] hidden sm:inline"><span className="inline-block w-3.5 border-t-[1.5px] border-dashed border-[#b7791f] align-middle mr-1" />avg {fmtShort(avgMonth)}/mo</span>}
                      <span className="ml-auto text-[#6f7a73] print:hidden">
                        {month !== null
                          ? <button onClick={() => setMonth(null)} className="font-medium text-[#047246] hover:underline">{MONTHS_L[month]} · clear</button>
                          : 'Click a month to filter'}
                      </span>
                    </div>
                    <div className="relative mt-2 flex-1 min-h-[130px]">
                      {/* Plot area: 16px headroom for the value labels, 22px for the month labels. */}
                      <div className="absolute inset-x-0 top-4 bottom-[22px] pointer-events-none z-[1]">
                        {avgMonth > 0 && (
                          <div className="lm-fade absolute left-0 right-0 border-t-[1.5px] border-dashed border-[#b7791f]/60"
                            style={{ bottom: `${(avgMonth / maxMonth) * 100}%` }} />
                        )}
                      </div>
                      <div className="absolute inset-x-0 bottom-[22px] border-t border-[#e4e9e5]" />
                      <div className="relative grid grid-cols-12 gap-1.5 sm:gap-2.5 h-full">
                        {byMonth.map((m, i) => {
                          const on = month === i;
                          const dim = month !== null && !on;
                          const pct = m.rentFils ? Math.max(4, (m.rentFils / maxMonth) * 100) : 0;
                          const isNow = i === nowMonth;
                          return (
                            <button key={i} type="button" disabled={!m.rentFils} onClick={() => pickMonth(i)}
                              title={`${MONTHS_L[i]}: ${m.count} lease${m.count === 1 ? '' : 's'}, ${fmtAed(m.rentFils)}`}
                              aria-pressed={on} aria-label={`${MONTHS_L[i]}: ${m.count} lease${m.count === 1 ? '' : 's'}, ${fmtAed(m.rentFils)}`}
                              className="group h-full flex flex-col items-center disabled:cursor-default">
                              <span className="relative flex-1 w-full">
                                <span className="absolute inset-x-0 top-4 bottom-0 flex justify-center">
                                  {m.rentFils ? (
                                    <>
                                      <span className={cn('lm-fade absolute left-1/2 -translate-x-1/2 mb-1 text-[10.5px] font-semibold tabular-nums whitespace-nowrap transition-opacity', on ? 'text-[#047246]' : i === peak?.i ? 'text-[#94600f]' : 'text-[#5f6b63]', dim && 'opacity-40')}
                                        style={{ bottom: `calc(${pct}% + 4px)`, '--i': i } as React.CSSProperties}>
                                        {fmtShort(m.rentFils)}
                                      </span>
                                      <span className={cn('lm-bar absolute bottom-0 w-full max-w-[40px] rounded-t-[7px] rounded-b-[3px] transition-[background,opacity] duration-150',
                                        on ? 'bg-gradient-to-b from-[#25946a] to-[#047246]'
                                          : i === peak?.i ? 'bg-gradient-to-b from-[#f5c26b] to-[#e0a526] group-hover:from-[#25946a] group-hover:to-[#047246]'
                                          : 'bg-gradient-to-b from-[#cfe8da] to-[#a8d9c2] group-hover:from-[#25946a] group-hover:to-[#047246]',
                                        dim && 'opacity-40')}
                                        style={{ height: `${pct}%`, '--i': i } as React.CSSProperties} />
                                    </>
                                  ) : (
                                    <span className="absolute bottom-0 w-full max-w-[40px] h-[3px] rounded-full bg-[#e4e9e5]" />
                                  )}
                                </span>
                              </span>
                              <span className={cn('mt-1.5 h-4 text-[11.5px] leading-4 whitespace-nowrap',
                                on ? 'text-[#047246] font-semibold' : isNow ? 'text-[#14201a] font-semibold' : 'text-[#6f7a73]')}>
                                {MONTHS[i]}{m.count > 1 && <span className="text-[#8b958f] font-normal"> ×{m.count}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* What needs attention — one line of pills, only what's non-zero. */}
                    {(ending > 0 || ended > 0 || notStarted > 0 || quietMonths > 0) && (
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11.5px] font-medium tabular-nums">
                        {ending > 0 && (
                          <button type="button" onClick={() => { setStatusTab('ending'); setMonth(null); }} title={`Running leases ending within ${ENDING_SOON_DAYS} days`}
                            className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-[#fdecea] text-[#b3261e] hover:bg-[#fbdcd8] print:pointer-events-none">
                            <b className="font-semibold">{ending}</b> ending ≤ {ENDING_SOON_DAYS}d · {fmtShort(endingAtStake)} at stake
                          </button>
                        )}
                        {ended > 0 && (
                          <button type="button" onClick={() => { setStatusTab(statusCounts.expired >= statusCounts.terminated ? 'expired' : 'terminated'); setMonth(null); }} title="Leases in this year that expired or were terminated"
                            className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-[#fdecea] text-[#b3261e] hover:bg-[#fbdcd8] print:pointer-events-none">
                            <b className="font-semibold">{ended}</b> expired / ended
                          </button>
                        )}
                        {notStarted > 0 && (
                          <button type="button" onClick={() => { setStatusTab('upcoming'); setMonth(null); }} title="Signed leases whose start date is still ahead — not earning yet"
                            className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-[#fdf3dc] text-[#94600f] hover:bg-[#fbe7b8] print:pointer-events-none">
                            <b className="font-semibold">{notStarted}</b> not started
                          </button>
                        )}
                        {quietMonths > 0 && (
                          <span title={`Months of ${year} so far with no new lease`} className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-[#fdf3dc] text-[#94600f]">
                            <b className="font-semibold">{quietMonths}</b> / {monthsSoFar} months, no new lease
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            );
          })()}

          {/* ── Register ── */}
          <section className="lm-up bg-white rounded-2xl border border-[#e4e9e5] shadow-[0_1px_2px_rgba(15,40,28,0.06),0_4px_16px_rgba(15,40,28,0.06)] print:border-none print:shadow-none" style={{ '--i': 2 } as React.CSSProperties}>
            {/* Toolbar — status views on the left, find / order / view on the right. */}
            <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-b border-[#edf1ee] print:hidden">
              <div role="tablist" aria-label="Lease status"
                className="inline-flex items-center gap-1.5 max-w-full overflow-x-auto py-1 -my-1 px-1 -mx-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {STATUS_TABS.filter(tb => tb.key === 'all' || tb.key === statusTab || statusCounts[tb.key] > 0).map(tb => {
                  const on = statusTab === tb.key;
                  const warn = tb.key === 'ending' && statusCounts.ending > 0;
                  return (
                    <button key={tb.key} role="tab" aria-selected={on} title={tb.hint}
                      onClick={() => { setStatusTab(tb.key); setMonth(null); }}
                      className={cn('h-8 px-3.5 shrink-0 rounded-full border inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-[#047246]/25',
                        on ? 'bg-[#e6f4ed] border-[#9fd3bd] text-[#0b3d2a]' : 'bg-white border-[#e4e9e5] text-[#46534c] hover:border-[#d3dad5] hover:text-[#14201a]')}>
                      {warn && <span className={cn('w-1.5 h-1.5 rounded-full bg-[#e0a526]', !on && 'lm-ping')} aria-hidden />}
                      {tb.label}
                      <span className={cn('text-[12px] tabular-nums', on ? 'text-[#047246] font-semibold' : 'text-[#6f7a73] font-medium')}>{statusCounts[tb.key]}</span>
                    </button>
                  );
                })}
              </div>
              {month !== null && (
                <span className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full border border-[#a8d9c2] bg-[#eef7f2] text-[#047246] text-[12.5px] font-medium">
                  {MONTHS_L[month]}
                  <button onClick={() => setMonth(null)} aria-label="Clear month filter"
                    className="w-5 h-5 rounded-full grid place-items-center hover:bg-[#d8efe3]"><X size={11} /></button>
                </span>
              )}
              <div className="ml-auto flex items-center justify-end gap-1.5 flex-wrap min-w-0">
                <label title="Search by contract, customer, unit or property — press / to jump here"
                  className="flex items-center gap-2 h-8 w-full sm:w-[220px] lg:w-[250px] rounded-full border border-[#e4e9e5] bg-white pl-3 pr-2 text-[#6f7a73] transition-colors hover:border-[#d3dad5] focus-within:border-[#047246]/50 focus-within:ring-2 focus-within:ring-[#047246]/10">
                  <Search size={14} className="shrink-0" />
                  <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search leases" aria-label="Search leases by contract, customer or unit"
                    className="flex-1 min-w-0 bg-transparent text-[13px] text-[#14201a] outline-none placeholder:text-[#8b958f]" />
                  {search && (
                    <button onClick={() => setSearch('')} aria-label="Clear search"
                      className="w-5 h-5 shrink-0 grid place-items-center rounded-full bg-[#edf1ee] text-[#5f6b63] hover:bg-[#e4e9e5] hover:text-[#14201a]"><X size={11} /></button>
                  )}
                </label>
                <PillSelect label="Sort by" align="right" active={false}
                  icon={<ArrowUpDown size={13} className="text-[#6f7a73]" />}
                  value={`${sort.key}:${sort.dir}`}
                  onChange={v => { const [k, d] = v.split(':'); setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 }); }}
                  options={[
                    { value: 'start:-1', label: 'Newest first', group: 'Month commenced' },
                    { value: 'start:1', label: 'Oldest first', group: 'Month commenced' },
                    { value: 'end:1', label: 'Soonest first', group: 'Lease end date' },
                    { value: 'end:-1', label: 'Latest first', group: 'Lease end date' },
                    { value: 'rent:-1', label: 'Highest first', group: 'Annual rent' },
                    { value: 'rent:1', label: 'Lowest first', group: 'Annual rent' },
                    { value: 'tenant:1', label: 'A → Z', group: 'Customer' },
                    { value: 'tenant:-1', label: 'Z → A', group: 'Customer' },
                  ]}
                  display={({ 'start:-1': 'Newest month', 'start:1': 'Oldest month', 'end:1': 'Ending soonest', 'end:-1': 'Ending latest',
                    'rent:-1': 'Highest rent', 'rent:1': 'Lowest rent', 'tenant:1': 'Customer A–Z', 'tenant:-1': 'Customer Z–A' } as Record<string, string>)[`${sort.key}:${sort.dir}`]} />
                <button onClick={toggleDensity} aria-pressed={compact} title={compact ? 'Comfortable rows' : 'Compact rows'}
                  className="h-8 w-8 grid place-items-center rounded-full text-[#5f6b63] hover:bg-[#f4faf7] hover:text-[#14201a]">
                  {compact ? <Rows3 size={15} /> : <Rows4 size={15} />}
                  <span className="sr-only">{compact ? 'Comfortable rows' : 'Compact rows'}</span>
                </button>
                {sort.key === 'start' && groups.length > 1 && (
                  <button onClick={() => setShownCollapsed(allCollapsed ? new Set() : new Set(allMonths))}
                    title={allCollapsed ? 'Expand all months' : 'Collapse all months'}
                    className="h-8 w-8 grid place-items-center rounded-full text-[#5f6b63] hover:bg-[#f4faf7] hover:text-[#14201a]">
                    {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
                    <span className="sr-only">{allCollapsed ? 'Expand all' : 'Collapse all'}</span>
                  </button>
                )}
              </div>
            </div>

            {groups.length === 0 ? (
              <div className="px-5 py-14 text-center text-sm text-[#46534c]">
                {anyFilter ? (
                  <>
                    <div className="w-11 h-11 mx-auto mb-3 rounded-2xl grid place-items-center bg-[#f9fbf9] border border-[#e4e9e5] text-[#6f7a73]"><Search size={18} /></div>
                    <b className="block text-[14px] text-[#14201a] mb-1">No leases match these filters</b>
                    {search ? <>Nothing for “{search}”</> : 'Try widening the filters'}{month !== null ? ` in ${MONTHS_L[month]}` : ''}{statusTab !== 'all' ? ` under ${STATUS_TABS.find(x => x.key === statusTab)!.label}` : ''}.
                    <div><button onClick={() => { clearAll(); setMonth(null); }}
                      className="mt-4 h-9 px-3.5 rounded-full border border-[#e4e9e5] text-[13px] font-medium text-[#14201a] hover:border-[#d3dad5]">Clear all filters</button></div>
                  </>
                ) : (
                  <>No leases commenced in {year}{filtersNarrowed ? ' for these filters' : ''}.</>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-b-2xl print:overflow-visible">
                <table className="w-full min-w-[880px] border-collapse text-[13.5px]">
                  <colgroup>
                    <col className="w-[27%]" /><col className="w-[21%]" /><col className="w-[20%]" /><col className="w-[10%]" />
                    <col className="w-[11%]" /><col className="w-[8%]" /><col className="w-[3%]" />
                  </colgroup>
                  <thead>
                    <tr className="text-left text-[12px] font-medium text-[#6f7a73]">
                      <SortTh label="Customer" k="tenant" sort={sort} onSort={toggleSort} first />
                      <th className="px-3 py-2.5 border-b border-[#edf1ee] font-medium">Unit</th>
                      <SortTh label="Term" k="start" sort={sort} onSort={toggleSort} />
                      <SortTh label="Ends" k="end" sort={sort} onSort={toggleSort} />
                      <SortTh label="Annual rent" k="rent" sort={sort} onSort={toggleSort} right />
                      <th className="px-3 py-2.5 border-b border-[#edf1ee] font-medium">Status</th>
                      <th className="border-b border-[#edf1ee] print:hidden" />
                    </tr>
                  </thead>
                  <tbody>
                    {sort.key === 'start'
                      ? orderedGroups.map(g => {
                          const isCol = shownCollapsed.has(g.month);
                          const isNow = year === today.getFullYear() && g.month === today.getMonth();
                          const toggle = () => { const n = new Set(shownCollapsed); if (isCol) n.delete(g.month); else n.add(g.month); setShownCollapsed(n); };
                          return (
                            <Fragment key={`${g.month}-${g.row.monthLabel}`}>
                              {/* Month — a slim section row; its rent sits in the rent column. */}
                              <tr className="group/m cursor-pointer select-none bg-[#f4faf7] hover:bg-[#eaf5ef] transition-colors print:break-after-avoid"
                                aria-expanded={!isCol} onClick={toggle}>
                                <td colSpan={4} className="pl-4 pr-3 py-2 border-y border-[#edf1ee]">
                                  <div className="flex items-center gap-2">
                                    <ChevronRight size={15} className={cn('shrink-0 text-[#6f7a73] transition-transform duration-150 print:hidden', !isCol && 'rotate-90')} />
                                    <span className="font-semibold text-[14px] text-[#14201a]">{MONTHS_L[g.month] ?? g.row.monthLabel} {year}</span>
                                    {isNow && <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#047246]"><span className="w-1.5 h-1.5 rounded-full bg-[#047246]" />This month</span>}
                                    <span className="text-[12.5px] text-[#6f7a73] tabular-nums">· {g.row.leases} lease{g.row.leases === 1 ? '' : 's'}</span>
                                    {/* The month's share, in words: of all new rent this year, or of what a filter shows. */}
                                    {visibleRent > 0 && (() => {
                                      const sharePct = (Number(g.row.annualRentFils ?? 0) / visibleRent) * 100;
                                      const isPeak = g.month === peakMonth;
                                      // The meter is scaled to the busiest month, so months compare at a glance.
                                      const peakFils = peakMonth >= 0 ? byMonth[peakMonth].rentFils : 0;
                                      const meter = peakFils ? Math.min(100, (Number(g.row.annualRentFils ?? 0) / peakFils) * 100) : 0;
                                      return (
                                        <span className="inline-flex items-center gap-2 text-[12.5px] text-[#6f7a73] tabular-nums"
                                          title={`${fmtAed(g.row.annualRentFils)} of ${fmtAed(visibleRent)}`}>
                                          <span>· {Math.round(sharePct)}% of {narrowing ? 'the rent shown' : `${year}’s new rent`}</span>
                                          <span title={isPeak ? 'The busiest month' : `${Math.round(meter)}% of the busiest month`} className="hidden sm:block w-16 h-1.5 rounded-full bg-[#e4e9e5] overflow-hidden print:hidden" aria-hidden>
                                            <i className={cn('lm-fill block h-full rounded-full', isPeak ? 'bg-gradient-to-r from-[#f5c26b] to-[#e0a526]' : 'bg-[#7bbfa3]')} style={{ width: `${Math.max(4, meter)}%` }} />
                                          </span>
                                          {isPeak && !narrowing && <span className="inline-flex items-center h-5 px-1.5 rounded-full bg-[#fdf3dc] text-[#5a3a06] text-[11px] font-semibold ring-1 ring-inset ring-[#f3dca6]">Busiest</span>}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </td>
                                <td className="px-3 py-2 border-y border-[#edf1ee] text-right whitespace-nowrap" title={`Rent from the leases that started in ${g.row.monthLabel}`}>
                                  <span className="font-semibold tabular-nums text-[#14201a]">{fmtAed(g.row.annualRentFils)}</span>
                                </td>
                                <td colSpan={2} className="border-y border-[#edf1ee]" />
                              </tr>
                              {g.items.map((it, ri) => (
                                <LeaseRow key={`${it.contractId}-${it.contractRef}`} it={it} today={today} contractsBase={contractsBase} onOpen={openLease} compact={compact} i={ri}
                                  className={isCol ? 'hidden print:table-row' : undefined} />
                              ))}
                            </Fragment>
                          );
                        })
                      : sortedFlat.map((it, ri) => <LeaseRow key={`${it.contractId}-${it.contractRef}`} it={it} today={today} contractsBase={contractsBase} onOpen={openLease} compact={compact} i={ri} />)}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#f4faf7]">
                      <td colSpan={4} className="pl-4 pr-3 py-3 border-t border-[#e4e9e5] text-[13px] text-[#5f6b63]">
                        <b className="font-semibold text-[#14201a] tabular-nums">{visibleItems.length}</b> lease{visibleItems.length === 1 ? '' : 's'}{anyFilter ? ' shown' : ''}
                      </td>
                      <td className="px-3 py-3 border-t border-[#e4e9e5] text-right font-semibold tabular-nums text-[#14201a] whitespace-nowrap">{fmtAed(visibleRent)}</td>
                      <td colSpan={2} className="border-t border-[#e4e9e5]" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <p className="text-xs text-[#6f7a73] mt-3">
            Generated {new Date(data.generatedAt).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {' '}· Rent shown is the annual contract value at commencement.
          </p>
        </div>
      )}
    </div>
    </div>
  );
}

/* ── pieces ────────────────────────────────────────────────────────────────── */
function SortTh({ label, k, sort, onSort, right, first }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; right?: boolean; first?: boolean;
}) {
  const on = sort.key === k;
  return (
    <th className={cn('py-2.5 border-b border-[#edf1ee] whitespace-nowrap font-medium', first ? 'pl-4 pr-3' : 'px-3', right && 'text-right')}
      aria-sort={on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)}
        className={cn('group/s inline-flex items-center gap-1 hover:text-[#14201a] print:pointer-events-none', on && 'text-[#14201a]')}>
        {label}
        {on
          ? (sort.dir > 0 ? <ChevronUp size={13} className="print:hidden" /> : <ChevronDown size={13} className="print:hidden" />)
          : <ArrowUpDown size={12} className="opacity-0 group-hover/s:opacity-60 transition-opacity print:hidden" />}
      </button>
    </th>
  );
}

function LeaseRow({ it, today, contractsBase, onOpen, className, compact, i = 0 }: {
  it: LeaseItem; today: Date; contractsBase: string; onOpen: (id: number) => void; className?: string; compact?: boolean; i?: number;
}) {
  const py = compact ? 'py-1.5' : 'py-2.5';
  const start = toDate(it.startDate);
  const end = toDate(it.endDate);
  const pct = start && end && end > start ? Math.max(0, Math.min(100, (daysBetween(start, today) / daysBetween(start, end)) * 100)) : 0;
  const daysLeft = end ? daysBetween(today, end) : null;
  const status = String(it.status ?? '');
  const endingSoon = (status === 'active' || status === 'renewed') && daysLeft !== null && daysLeft >= 0 && daysLeft <= ENDING_SOON_DAYS;
  const notStarted = start !== null && start > today;
  const href = it.contractId != null ? `${contractsBase}/${it.contractId}/v2` : null;
  const name = it.tenantName ?? '—';

  return (
    <tr className={cn('lm-row group border-b border-[#f3f1ec] last:border-b-0 hover:bg-[#f9fbf9] transition-colors', href && 'cursor-pointer', className)}
      style={{ '--i': i } as React.CSSProperties}
      tabIndex={href ? 0 : undefined}
      onClick={e => { if (it.contractId != null && !(e.target as HTMLElement).closest('a,button')) onOpen(it.contractId); }}
      onKeyDown={e => { if (e.key === 'Enter' && it.contractId != null && e.target === e.currentTarget) onOpen(it.contractId); }}>
      {/* Customer, with the contract number beneath it. */}
      <td className={cn('pl-4 pr-3', py)}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn('rounded-full grid place-items-center font-semibold shrink-0 print:hidden', compact ? 'w-6 h-6 text-[9.5px]' : 'w-8 h-8 text-[11px]', hueFor(name))}>{initials(name)}</span>
          <div className={cn('min-w-0', compact && 'flex items-baseline gap-2')}>
            <div className="font-medium text-[#14201a] truncate">{name}</div>
            <div className="font-mono text-[11.5px] text-[#6f7a73] shrink-0">{it.contractRef ?? '—'}</div>
          </div>
        </div>
      </td>
      <td className={cn('px-3', py)}>
        <div className="text-[#14201a] truncate">{unitText(it.unitLabel)}</div>
        <div className={cn('text-[12px] text-[#6f7a73] truncate', compact && 'hidden')}>{it.buildingName ?? ''}</div>
      </td>
      <td className={cn('px-3', py)}>
        <div className="text-[12.5px] text-[#46534c] tabular-nums whitespace-nowrap">{fmtDate(it.startDate)} – {fmtDate(it.endDate)}</div>
        <div className={cn('mt-1.5 h-1 max-w-[150px] rounded-full bg-[#edf1ee] overflow-hidden print:hidden', compact && 'hidden')}
          title={notStarted ? 'Not started yet' : `${Math.round(pct)}% of term elapsed`}>
          <i className={cn('lm-fill block h-full rounded-full', endingSoon ? 'bg-gradient-to-r from-[#f5c26b] to-[#e0a526]' : 'bg-[#7bbfa3]')} style={{ width: `${pct}%`, '--i': i } as React.CSSProperties} />
        </div>
      </td>
      <td className={cn('px-3 whitespace-nowrap tabular-nums text-[12.5px]', py)}>
        {daysLeft === null ? <span className="text-[#6f7a73]">—</span>
          : notStarted ? <span className="text-[#5f6b63]">in {daysBetween(today, start!)}d</span>
          : daysLeft < 0 ? <span className="text-[#6f7a73]">{-daysLeft}d ago</span>
          : <span className={endingSoon ? 'font-semibold text-[#8a5a00]' : 'text-[#46534c]'}>{daysLeft}d left</span>}
      </td>
      <td className={cn('px-3 text-right font-semibold tabular-nums text-[#14201a] whitespace-nowrap', py)}>{fmtAed(it.annualRentFils)}</td>
      <td className={cn('px-3', py)}>
        <span className={cn('inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[12px] font-medium capitalize whitespace-nowrap',
          endingSoon ? 'bg-[#fdf3dc] text-[#8a5a00]' : STATUS_STYLE[status] ?? 'bg-[#edf1ee] text-[#46534c]')}
          title={endingSoon ? 'In the renewal window' : undefined}>
          <span className={cn('w-1.5 h-1.5 rounded-full', endingSoon ? 'bg-[#e0a526] lm-ping' : 'bg-current opacity-70')} aria-hidden />
          {endingSoon ? 'Renewal due' : status ? status.replace(/_/g, ' ') : '—'}
        </span>
      </td>
      <td className={cn('pr-3 text-right print:hidden', py)}>
        {href && (
          <Link href={href} title="Open lease" aria-label={`Open lease ${it.contractRef ?? ''}`}
            // A plain click opens the lease inside the report; ⌘/Ctrl/middle-click
            // still opens the contract page in a new tab.
            onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0 && it.contractId != null) { e.preventDefault(); onOpen(it.contractId); } }}
            className="inline-grid place-items-center w-7 h-7 rounded-full text-[#047246] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[#eef7f2] transition-opacity">
            <ArrowRight size={14} />
          </Link>
        )}
      </td>
    </tr>
  );
}

type MenuOption = { value: string; label: string; group?: string; count?: number };

/** Shared popover surface — hairline border, soft layered shadow, quick fade-in. */
const POPOVER = 'absolute top-[calc(100%+6px)] z-40 rounded-xl border border-black/[0.07] bg-white p-1 shadow-[0_16px_36px_-12px_rgba(16,24,20,.22),0_3px_8px_-3px_rgba(16,24,20,.10)] lm-pop';

/** A filter as a compact pill with its own menu — never the browser's native
 *  dropdown. Slim rows, ✓ on the right, optional per-option count with a faint
 *  share bar behind it. Keyboard: ↑/↓ move, Enter picks, Esc closes. */
export function PillSelect({ label, value, options, onChange, active, icon, display, align = 'left', variant = 'pill', footnote }: {
  label: string; value: string; options: MenuOption[]; onChange: (v: string) => void; active: boolean;
  icon?: React.ReactNode; display?: string; align?: 'left' | 'right'; variant?: 'pill' | 'inset'; footnote?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const cur = listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    (cur ?? listRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); return; }
      if (e.key === 'Tab') { setOpen(false); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const current = options.find(o => o.value === value);
  const pick = (v: string) => { onChange(v); setOpen(false); btnRef.current?.focus(); };
  return (
    <div className="relative inline-flex" ref={ref}>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${display ?? current?.label ?? ''}`}
        onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); setOpen(true); } }}
        className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#047246]/20',
          variant === 'pill'
            ? cn('h-8 rounded-full border pl-3 pr-2.5', active ? 'border-[#a8d9c2] bg-[#eef7f2] text-[#047246]' : 'border-[#e4e9e5] bg-white text-[#14201a] hover:border-[#d3dad5]', open && 'border-[#047246]/50 ring-2 ring-[#047246]/10')
            : cn('h-7 rounded-full px-2.5', active ? 'bg-[#e6f4ed] text-[#0b3d2a] ring-1 ring-inset ring-[#9fd3bd]' : 'text-[#46534c] hover:text-[#14201a] hover:bg-[#f9fbf9]'))}>
        {icon}
        <span className="truncate max-w-[200px]">{display ?? current?.label}</span>
        <ChevronDown size={14} className={cn('shrink-0 transition-transform duration-150', open && 'rotate-180',
          variant === 'inset' && active ? 'text-white/80' : active ? 'text-[#047246]' : 'text-[#6f7a73]')} />
      </button>
      {open && (
        <div className={cn(POPOVER, 'min-w-[208px]', align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left')}>
          <div ref={listRef} role="listbox" aria-label={label} className="max-h-[320px] overflow-y-auto">
            {options.map((o, i) => {
              const on = o.value === value;
              const header = o.group && o.group !== options[i - 1]?.group ? o.group : null;
              const empty = o.count === 0 && !on;
              return (
                <Fragment key={o.value}>
                  {header && <div className={cn('px-2.5 pb-1 text-[11.5px] font-medium text-[#6f7a73]', i === 0 ? 'pt-1.5' : 'pt-2.5 mt-1 border-t border-black/[0.05]')}>{header}</div>}
                  <button type="button" role="option" aria-selected={on} onClick={() => pick(o.value)}
                    className={cn('w-full h-8 flex items-center gap-2 px-2 rounded-lg text-left text-[13px] outline-none transition-colors',
                      on ? 'bg-[#eef7f2] text-[#047246] font-semibold' : empty ? 'text-[#8b958f] hover:bg-[#f2f5f3] focus-visible:bg-[#f2f5f3]' : 'text-[#14201a] hover:bg-[#f2f5f3] focus-visible:bg-[#f2f5f3]')}>
                    <span className="w-4 shrink-0 grid place-items-center">{on && <Check size={14} strokeWidth={2.5} />}</span>
                    <span className="flex-1 min-w-0 truncate">{o.label}</span>
                    {o.count != null && (
                      <span className={cn('min-w-[24px] h-5 px-1.5 rounded-full grid place-items-center text-[11.5px] font-semibold tabular-nums',
                        on ? 'bg-[#cfe8da] text-[#0b3d2a]' : empty ? 'text-[#c3c8c5]' : 'bg-[#edf1ee] text-[#46534c]')}>{o.count}</span>
                    )}
                  </button>
                </Fragment>
              );
            })}
          </div>
          {footnote && <div className="mt-1 px-2.5 pt-2 pb-1.5 border-t border-black/[0.05] text-[11.5px] text-[#6f7a73]">{footnote}</div>}
        </div>
      )}
    </div>
  );
}

/** Export — one button, two outputs (CSV of the rows shown · print / PDF). */
export function ExportMenu({ disabled, rows, onCsv, onPrint }: { disabled: boolean; rows: number; onCsv: () => void; onPrint: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const item = 'w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left outline-none hover:bg-[#f2f5f3] focus-visible:bg-[#f2f5f3]';
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        className={cn('h-8 pl-3 pr-2.5 rounded-full text-[13px] font-medium inline-flex items-center gap-1.5 text-white bg-[#047246] hover:bg-[#1a6b51] disabled:opacity-50 transition-colors',
          open && 'ring-2 ring-[#047246]/20')}>
        <Download size={14} /> Export <ChevronDown size={14} className={cn('text-white/80 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className={cn(POPOVER, 'right-0 origin-top-right w-[240px]')}>
          <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); onCsv(); }}>
            <FileSpreadsheet size={16} className="mt-0.5 text-[#047246] shrink-0" />
            <span><span className="block text-[13px] font-medium text-[#14201a]">Download CSV</span><span className="block text-[12px] text-[#6f7a73]">{rows} lease{rows === 1 ? '' : 's'} as shown, for Excel</span></span>
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); onPrint(); }}>
            <Printer size={16} className="mt-0.5 text-[#047246] shrink-0" />
            <span><span className="block text-[13px] font-medium text-[#14201a]">Print or save as PDF</span><span className="block text-[12px] text-[#6f7a73]">A4, the whole register</span></span>
          </button>
        </div>
      )}
    </div>
  );
}

/** One removable filter in the "Filtered by" row. */
export function FilterChip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full border border-[#d8efe3] bg-[#eef7f2] text-[12.5px] text-[#14201a] max-w-[320px]">
      <span className="text-[#5f6b63]">{label}:</span>
      <span className="font-semibold truncate">{value}</span>
      <button onClick={onClear} aria-label={`Remove ${label} filter`}
        className="ml-0.5 w-5 h-5 shrink-0 rounded-full grid place-items-center text-[#46534c] hover:bg-[#d8efe3] hover:text-[#14201a]"><X size={11} /></button>
    </span>
  );
}

/** Multi-select property filter — the API already takes a comma list of buildings. */
export function PropertyPicker({ options, selected, onChange }: {
  options: BuildingOption[]; selected: number[]; onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.name.toLowerCase().includes(needle)) : options;
  const label = selected.length === 0 ? 'All properties'
    : selected.length === 1 ? (options.find(o => o.id === selected[0])?.name ?? '1 property')
    : `${selected.length} properties`;
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} disabled={options.length === 0} aria-haspopup="listbox" aria-expanded={open}
        className={cn('h-8 max-w-[190px] rounded-full border pl-3 pr-2.5 text-[13px] font-medium inline-flex items-center gap-1.5 hover:border-[#d3dad5] disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[#047246]/15',
          selected.length ? 'border-[#a8d9c2] bg-[#eef7f2] text-[#047246]' : 'border-[#e4e9e5] bg-white text-[#14201a]', open && 'border-[#047246]')}>
        <Building2 size={13} className={cn('shrink-0', selected.length ? 'text-[#047246]' : 'text-[#6f7a73]')} />
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className={cn('text-[#6f7a73] shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className={cn(POPOVER, 'left-0 origin-top-left w-[288px]')}>
          {options.length > 6 && (
            <div className="p-1 pb-1.5 border-b border-black/[0.05]">
              <label className="flex items-center gap-2 h-8 rounded-lg bg-[#f4faf7] px-2.5 text-[#6f7a73] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#047246]/15">
                <Search size={14} />
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a property…" aria-label="Find a property"
                  className="flex-1 min-w-0 bg-transparent text-[13px] text-[#14201a] outline-none placeholder:text-[#6f7a73]" />
              </label>
            </div>
          )}
          <div role="listbox" aria-multiselectable="true" className="max-h-[300px] overflow-y-auto pt-1">
            {shown.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-[#6f7a73]">No property matches “{q}”.</div>}
            {shown.map(o => {
              const on = selected.includes(o.id);
              return (
                <button key={o.id} type="button" role="option" aria-selected={on} onClick={() => toggle(o.id)}
                  className="w-full h-8 flex items-center gap-2.5 px-2.5 rounded-lg text-left text-[13px] outline-none hover:bg-[#f2f5f3] focus-visible:bg-[#f2f5f3]">
                  <span className={cn('w-4 h-4 rounded-[5px] border grid place-items-center shrink-0 transition-colors', on ? 'bg-[#047246] border-[#047246] text-white' : 'border-[#cfccc1] bg-white')}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className={cn('flex-1 min-w-0 truncate', on ? 'font-semibold text-[#047246]' : 'text-[#14201a]')}>{o.name}</span>
                  <span className="text-[12px] text-[#6f7a73] tabular-nums shrink-0">{o.contracts}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-1 px-2 pt-1.5 pb-0.5 border-t border-black/[0.05]">
            <button type="button" onClick={() => onChange(options.map(o => o.id))} className="text-[12.5px] font-medium text-[#047246] hover:underline">Select all</button>
            <span className="text-[#d3dad5]">·</span>
            <button type="button" onClick={() => onChange([])} disabled={!selected.length} className="text-[12.5px] font-medium text-[#46534c] hover:underline disabled:opacity-40">Clear</button>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto h-7 px-3 rounded-full bg-[#14201a] text-white text-[12.5px] font-medium hover:bg-[#047246]">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Skeleton() {
  return (
    <div className="animate-pulse" aria-label="Loading report">
      <div className="grid gap-4 mb-4 lg:grid-cols-[minmax(320px,1fr)_1.5fr]">
        <div className="h-[300px] rounded-2xl bg-white border border-[#e4e9e5]" />
        <div className="h-[300px] rounded-2xl bg-white border border-[#e4e9e5]" />
      </div>
      <div className="rounded-2xl bg-white border border-[#e4e9e5] p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-[#edf1ee]" />)}
      </div>
    </div>
  );
}


/** A figure that counts up to its value on first show (marketspace style). It
 *  re-runs only when the value changes; with reduced motion it just shows it. */
export function CountUp({ value, format, ms = 900 }: { value: number; format: (n: number) => string; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dur = reduce || !Number.isFinite(value) ? 0 : ms;
    const start = from.current;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, ms]);
  return <>{format(shown)}</>;
}

/** A ring that draws round to `pct` — green into gold, like the portal's on-time ring. */
export function Ring({ pct, size = 84, stroke = 9, children, title }: { pct: number; size?: number; stroke?: number; children?: React.ReactNode; title?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const id = `lm-ring-${size}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={title}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#25946a" /><stop offset="1" stopColor="#f5c26b" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e6f4ed" strokeWidth={stroke} />
        {pct > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round"
            className="lm-ring-fg" style={{ '--c': c, '--off': off } as React.CSSProperties} />
        )}
      </svg>
      <div className="lm-zoom absolute inset-0 grid place-content-center text-center">{children}</div>
    </div>
  );
}
