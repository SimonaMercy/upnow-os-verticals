/**
 * Lease Summary - Yearly (slug `new-leases-matrix`) — the property × month grid
 * of new leases, as its own page rather than a ReportDetailView countMatrix.
 *
 * Same data, filters and CSV as the generic view it replaces, laid out in the
 * Leases - Monthly look: an overview card (the year's new leases and the rent
 * they carry, the top property, a 12-month bar chart that highlights a month in
 * the grid), then the grid itself as a heat map — each cell shaded by how many
 * leases commenced, a share bar per property, and every number clickable for
 * the leases behind it. A lease opens its record INSIDE the report (?lease=),
 * like Leases - Monthly.
 *
 * Data: GET {endpointBase}/new-leases-matrix?year=YYYY (+ buildings, leaseTypes,
 * + any extraQuery like rp=N). Backend returns { generatedAt, year, months[],
 * rows: [{ label, cells[], cellItems[][], newLeases, annualRentFils }],
 * columnTotals[], totals, buildings, availableYears }. Money is in fils.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, ArrowUpDown, ChevronRight, ExternalLink, Info, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BasisNote } from '@/components/upnow/reportCatalog';
import { getReportsYear, useReportsYear, yearForMatrix, REPORT_YEARS } from '@/components/upnow/reportsYear';
import { leasesThemeClass, LeasesThemeStyles } from '@/components/upnow/leasesTheme';
import { LeasesViewSwitch } from '@/components/upnow/LeasesViewSwitch';
import {
  CountUp, ExportMenu, FilterChip, PillSelect, PropertyPicker, Skeleton,
  type BuildingOption, type LeaseType,
} from '@/components/upnow/LeasesMonthlyReport';

// The lease opened inside the report is the real lease record (same as Leases - Monthly).
const ContractV2View = dynamic(
  () => import('@/app/rental-provider/dashboard/contracts/[id]/v2/page').then(m => m.ContractV2View),
  { ssr: false, loading: () => <div className="py-24 grid place-items-center text-[#6f7a73]"><Loader2 size={20} className="animate-spin" /></div> },
);

/* ── payload ── */
interface CellItem {
  contractId?: number | null;
  contractRef?: string | null;
  unitLabel?: string | null;
  tenantName?: string | null;
  startDate?: string | null;
  annualRentFils?: number | null;
}
interface MatrixRow { label: string; cells: number[]; cellItems?: CellItem[][]; newLeases: number; annualRentFils: number }
interface Payload {
  generatedAt: string;
  year?: number;
  months?: string[];
  rows: MatrixRow[];
  columnTotals?: number[];
  totals: Record<string, number>;
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

type SortKey = 'leases' | 'rent' | 'name';
const SORT_LABEL: Record<SortKey, string> = { leases: 'Most new leases', rent: 'Highest rent', name: 'Property A–Z' };

/* ── formatting ── */
const fmtAed = (fils: number | null | undefined): string =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(fils ?? 0) / 100);
const fmtShort = (fils: number): string => {
  const n = fils / 100;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};
const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : '—';
};
const unitText = (label: string | null | undefined) => (!label ? '—' : /^unit\b/i.test(label.trim()) ? label.trim() : `Unit ${label.trim()}`);
const toCsvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Heat-map shade for a cell — 0 is blank, the busiest cell is the darkest. */
function heat(n: number, max: number): string {
  if (!n) return 'text-[#c9d0cb]';
  const k = n / Math.max(1, max);
  if (k > 0.75) return 'bg-[#047246] text-white';
  if (k > 0.5) return 'bg-[#25946a] text-white';
  if (k > 0.25) return 'bg-[#a8d9c2] text-[#0b3d2a]';
  return 'bg-[#dcf0e5] text-[#0b3d2a]';
}

type Drill = { title: string; sub: string; items: CellItem[] };

export function LeasesYearlyReport({
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

  /* ── filters (seeded from the address) ── */
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
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const k = sp?.get('sort');
    return k === 'rent' || k === 'name' ? k : 'leases';
  });
  const [hideEmpty, setHideEmpty] = useState(() => sp?.get('empty') === 'hide');
  const [showAbout, setShowAbout] = useState(false);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Follow the hub-wide Reports year unless the address pinned one.
  const hubYear = useReportsYear();
  const yearPinned = useRef(!!sp?.get('year'));
  useEffect(() => { if (!yearPinned.current) setYear(yearForMatrix(hubYear)); }, [hubYear]);

  const url = useMemo(() => {
    const q = new URLSearchParams(extraQuery);
    q.set('year', String(year));
    if (selectedBuildings.length) q.set('buildings', selectedBuildings.join(','));
    if (selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length)
      q.set('leaseTypes', selectedLeaseTypes.join(','));
    return `${endpointBase}/new-leases-matrix?${q.toString()}`;
  }, [endpointBase, extraQuery, year, selectedBuildings, selectedLeaseTypes]);
  const reqKey = `${url}#${reloadKey}`;

  const [result, setResult] = useState<{ key: string; error?: string } | null>(null);
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
        setResult({ key: reqKey });
        setData(d);
        const ys = d.availableYears;
        if (ys?.length && !ys.includes(year)) setYear(Math.max(...ys));
      })
      .catch(e => { if (alive) setResult({ key: reqKey, error: String(e?.message ?? e) }); });
    return () => { alive = false; };
  }, [url, reqKey, year]);
  const loading = result?.key !== reqKey;
  const error = !loading ? result?.error ?? null : null;

  const yearOptions = data?.availableYears?.length ? [...data.availableYears].sort((a, b) => b - a) : REPORT_YEARS;
  const pickYear = (y: number) => { yearPinned.current = true; setYear(y); setMonth(null); };
  const pickBuildings = (b: number[]) => setSelectedBuildings(b);
  const pickLeaseTypes = (lt: LeaseType[]) => { setSelectedLeaseTypes(lt); setSelectedBuildings([]); };
  const buildingOptions = data?.buildings ?? [];
  const propertyOptions = selectedLeaseTypes.length === 1
    ? buildingOptions.filter(b => b.leasingType === selectedLeaseTypes[0])
    : buildingOptions;

  /* ── derived ── */
  const monthLabels = data?.months?.length ? data.months : MONTHS;
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? allRows.filter(r => String(r.label ?? '').toLowerCase().includes(needle)) : allRows;
  }, [allRows, search]);
  const emptyCount = searched.filter(r => !Number(r.newLeases)).length;
  const rows = useMemo(() => {
    const list = hideEmpty ? searched.filter(r => Number(r.newLeases) > 0) : [...searched];
    const by = (r: MatrixRow) => (sortKey === 'rent' ? Number(r.annualRentFils) : Number(r.newLeases));
    return list.sort((a, b) => sortKey === 'name'
      ? String(a.label).localeCompare(String(b.label))
      : by(b) - by(a) || String(a.label).localeCompare(String(b.label)));
  }, [searched, hideEmpty, sortKey]);

  // Totals follow the search (the server's figures when nothing narrows).
  const narrowed = !!search.trim();
  const colTotals = useMemo(() => {
    if (!narrowed) return data?.columnTotals ?? monthLabels.map(() => 0);
    const out = monthLabels.map(() => 0);
    for (const r of searched) (r.cells ?? []).forEach((n, i) => { if (i < out.length) out[i] += Number(n) || 0; });
    return out;
  }, [narrowed, data, searched, monthLabels]);
  const totalLeases = narrowed ? searched.reduce((s, r) => s + (Number(r.newLeases) || 0), 0) : Number(data?.totals?.newLeases ?? 0);
  const totalRent = narrowed ? searched.reduce((s, r) => s + (Number(r.annualRentFils) || 0), 0) : Number(data?.totals?.annualRentFils ?? 0);
  const propCount = narrowed ? searched.length : Number(data?.totals?.properties ?? allRows.length);
  const leasingProps = searched.filter(r => Number(r.newLeases) > 0).length;
  const avgLease = totalLeases ? totalRent / totalLeases : 0;
  const maxCell = Math.max(1, ...rows.flatMap(r => (r.cells ?? []).map(Number)));
  const maxRowLeases = Math.max(1, ...rows.map(r => Number(r.newLeases) || 0));
  const maxCol = Math.max(1, ...colTotals.map(Number));
  const peakMonth = colTotals.some(n => Number(n) > 0) ? colTotals.reduce((b, n, i) => (Number(n) > Number(colTotals[b]) ? i : b), 0) : -1;
  const activeMonths = colTotals.filter(n => Number(n) > 0);
  const avgMonth = activeMonths.length ? activeMonths.reduce((s, n) => s + Number(n), 0) / activeMonths.length : 0;
  const today = new Date();
  const nowMonth = year === today.getFullYear() ? today.getMonth() : -1;
  const monthsSoFar = year < today.getFullYear() ? 12 : year === today.getFullYear() ? today.getMonth() + 1 : 0;
  const quietMonths = colTotals.slice(0, monthsSoFar).filter(n => !Number(n)).length;
  const top = [...searched].sort((a, b) => Number(b.newLeases) - Number(a.newLeases))[0];
  const topShare = top && totalLeases ? Math.round((Number(top.newLeases) / totalLeases) * 100) : 0;

  const filtersNarrowed = selectedBuildings.length > 0 || (selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length);
  const anyFilter = filtersNarrowed || month !== null || !!search.trim() || hideEmpty;
  const clearAll = () => { pickLeaseTypes([...ALL_LEASE_TYPES]); setSearch(''); setMonth(null); setHideEmpty(false); };

  /* ── drill + inline lease ── */
  const openCell = (r: MatrixRow, i: number) => {
    const items = r.cellItems?.[i] ?? [];
    if (!items.length) return;
    setDrill({ title: String(r.label), sub: `${MONTHS_L[i] ?? monthLabels[i]} ${year}`, items });
  };
  const openRow = (r: MatrixRow) => {
    const items = (r.cellItems ?? []).flat();
    if (!items.length) return;
    setDrill({ title: String(r.label), sub: `All new leases in ${year}`, items });
  };
  const openMonthAll = (i: number) => {
    const items = rows.flatMap(r => (r.cellItems?.[i] ?? []).map(it => ({ ...it, _prop: r.label })));
    if (!items.length) return;
    setDrill({ title: `${MONTHS_L[i]} ${year}`, sub: 'Every property', items });
  };

  const leaseHref = useCallback((id: number | null) => {
    const q = new URLSearchParams(sp?.toString() ?? '');
    if (id == null) q.delete('lease'); else q.set('lease', String(id));
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [sp, pathname]);
  const openLease = (id: number) => {
    listScrollRef.current = window.scrollY;
    router.push(leaseHref(id), { scroll: false });
    window.scrollTo(0, 0);
  };
  const closeLease = useCallback(() => {
    router.push(leaseHref(null), { scroll: false });
    const y = listScrollRef.current;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [router, leaseHref]);

  // The view lives in the address — reload, shared link and Back all keep it.
  useEffect(() => {
    if (openLeaseId != null) return;
    const id = window.setTimeout(() => {
      const q = new URLSearchParams(window.location.search);
      const put = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k));
      put('year', yearPinned.current ? String(year) : null);
      put('buildings', selectedBuildings.length ? selectedBuildings.join(',') : null);
      put('leaseTypes', selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length ? selectedLeaseTypes.join(',') : null);
      put('month', month !== null ? String(month + 1) : null);
      put('q', search.trim() || null);
      put('sort', sortKey !== 'leases' ? sortKey : null);
      put('empty', hideEmpty ? 'hide' : null);
      const qs = q.toString();
      if (qs !== window.location.search.replace(/^\?/, '')) window.history.replaceState(window.history.state, '', qs ? `${pathname}?${qs}` : pathname);
    }, 250);
    return () => window.clearTimeout(id);
  }, [openLeaseId, year, selectedBuildings, selectedLeaseTypes, month, search, sortKey, hideEmpty, pathname]);

  // Esc: closes the drill, then the open lease.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drill) setDrill(null);
      else if (openLeaseId != null) closeLease();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drill, openLeaseId, closeLease]);

  /* ── CSV — the same shape the generic view exported ── */
  const handleCsv = () => {
    if (!data) return;
    const headers = ['Property', ...monthLabels, 'New leases', 'Annual rent'];
    const out = rows.map(r => [String(r.label ?? ''), ...(r.cells ?? []).map(n => String(Number(n) || 0)),
      String(Number(r.newLeases) || 0), ((Number(r.annualRentFils) || 0) / 100).toFixed(2)]);
    out.push(['Total', ...colTotals.map(n => String(Number(n) || 0)), String(totalLeases), (totalRent / 100).toFixed(2)]);
    const csv = '﻿' + [headers, ...out].map(r => r.map(toCsvCell).join(',')).join('\n');
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = `new-leases-matrix-${data.year ?? year}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(href);
  };

  const backCls = 'w-8 h-8 shrink-0 grid place-items-center rounded-full border border-[#e4e9e5] bg-white text-[#46534c] hover:text-[#14201a] hover:border-[#d3dad5]';
  const BackLink = onBack ? (
    <button type="button" onClick={onBack} className={backCls} title="All Reports" aria-label="Back to all reports"><ArrowLeft size={15} /></button>
  ) : (
    <Link href={backHref ?? '/rental-provider/dashboard/reports'} className={backCls} title="All Reports" aria-label="Back to all reports"><ArrowLeft size={15} /></Link>
  );

  /* ── a lease opened inside the report ── */
  if (openLeaseId != null) {
    const ref = allRows.flatMap(r => (r.cellItems ?? []).flat()).find(it => it.contractId === openLeaseId)?.contractRef;
    return (
      <div className={cn('min-h-screen bg-[#f6f8f6] text-[14px] text-[#14201a]', leasesThemeClass)}>
        <LeasesThemeStyles />
        <div className="sticky top-0 z-30 border-b border-[#e4e9e5] bg-[#f6f8f6]/90 backdrop-blur print:hidden">
          <div className="max-w-[1240px] mx-auto px-7 h-12 flex items-center gap-2 text-[13px]">
            <nav className="flex items-center gap-1.5 min-w-0 text-[#6f7a73]" aria-label="Breadcrumb">
              <button onClick={closeLease} className="hover:text-[#14201a] inline-flex items-center gap-1"><ArrowLeft size={13} />Lease Summary – Yearly</button>
              <ChevronRight size={12} />
              <span className="font-medium text-[#14201a] truncate">{ref ?? `CID-${openLeaseId}`}</span>
            </nav>
            <Link href={`${contractsBase}/${openLeaseId}/v2${sp?.get('rp') ? `?rp=${sp.get('rp')}` : ''}`} title="Open on its own page"
              className="ml-auto h-8 px-2.5 rounded-lg text-xs font-medium text-[#46534c] hover:text-[#14201a] hover:bg-white inline-flex items-center gap-1">
              <ExternalLink size={13} /><span className="hidden md:inline">Full page</span>
            </Link>
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
        {/* ── Header ── */}
        <div className="flex items-center gap-2 mb-3 print:hidden">
          {BackLink}
          <h1 className="ms-serif m-0 text-[30px] leading-none text-[#0b3d2a] whitespace-nowrap !font-[700]">Lease Summary – Yearly</h1>
          <LeasesViewSwitch current="yearly" year={year} buildings={selectedBuildings} leaseTypes={selectedLeaseTypes}
            allLeaseTypes={ALL_LEASE_TYPES.length} reportsBase={backHref} onSwitch={onSwitchView} />
          <button type="button" onClick={() => setShowAbout(v => !v)} aria-expanded={showAbout}
            className={cn('w-7 h-7 grid place-items-center rounded-full transition-colors', showAbout ? 'bg-[#eef7f2] text-[#047246]' : 'text-[#6f7a73] hover:text-[#047246] hover:bg-white')}
            title="What this report shows and how it counts" aria-label="About this report">
            <Info size={15} />
          </button>
          <span className="hidden lg:inline text-[13px] text-[#6f7a73] truncate">New leases per property, by the month they commenced in {year}</span>
        </div>

        {/* Filters + export */}
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
          {loading && data && <Loader2 size={15} className="animate-spin text-[#6f7a73] ml-1" aria-label="Updating" />}
          <div className="ml-auto">
            <ExportMenu disabled={!data || loading} rows={rows.length} onCsv={handleCsv} onPrint={() => window.print()} />
          </div>
        </div>

        {showAbout && (
          <div className="mb-4 rounded-2xl border border-[#d8efe3] bg-[#eef7f2] px-4 py-3 text-[13px] leading-relaxed text-[#46534c] print:hidden">
            <p className="m-0 font-semibold text-[#14201a]">New leases per property, by the month they commenced in {year}.</p>
            <p className="m-0 mt-1">
              Each unit’s <b>current</b> lease is placed once, in the month it <b>commenced</b> — a renewed unit is never double-counted,
              so the totals reconcile with Lease Revenue and the Portfolio page’s Annual Rent. Each cell counts the units whose current
              lease began that month at the property; <b>Annual rent</b> is the yearly rent those leases carry. Click any number for the leases behind it.
            </p>
            <BasisNote slug="new-leases-matrix" className="mt-2" />
          </div>
        )}

        {/* Print-only header */}
        <div className="hidden print:block mb-5">
          <h1 className="text-xl font-bold">Lease Summary – Yearly · {year}</h1>
          {data && <p className="text-xs text-[#46534c]">Generated {new Date(data.generatedAt).toLocaleString('en-AE', { timeZone: 'Asia/Dubai' })}</p>}
        </div>

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
            {month !== null && <FilterChip label="Month" value={`${MONTHS_L[month]} ${year}`} onClear={() => setMonth(null)} />}
            {search.trim() && <FilterChip label="Search" value={`“${search.trim()}”`} onClear={() => setSearch('')} />}
            {hideEmpty && <FilterChip label="Hidden" value="Properties with no new lease" onClear={() => setHideEmpty(false)} />}
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
            {/* ── Overview ── */}
            <section className="lm-up mb-4 rounded-2xl border border-[#e4e9e5] bg-white shadow-[0_1px_2px_rgba(15,40,28,0.06),0_4px_16px_rgba(15,40,28,0.06)] grid lg:grid-cols-[minmax(300px,0.85fr)_1.6fr] print:break-inside-avoid">
              {/* Left: the year in figures */}
              <div className="px-5 py-4 lg:border-r border-b lg:border-b-0 border-[#edf1ee] min-w-0">
                <span className="text-[12.5px] font-medium text-[#5f6b63]">New leases in {year}</span>
                <div className="mt-1.5 flex items-baseline gap-2.5 flex-wrap">
                  <b className="text-[34px] leading-none font-semibold tracking-[-0.025em] text-[#14201a] tabular-nums"><CountUp value={totalLeases} format={n => String(Math.round(n))} ms={700} /></b>
                  <span className="text-[13px] text-[#6f7a73]">leases ·</span>
                  <b className="text-[18px] font-semibold text-[#14201a] tabular-nums"><CountUp value={totalRent} format={fmtAed} /></b>
                  <span className="text-[13px] text-[#6f7a73]">annual rent</span>
                </div>
                {top && Number(top.newLeases) > 0 && (
                  <button type="button" onClick={() => openRow(top)}
                    className="mt-3 w-full text-left rounded-xl border border-[#e6ebe8] px-3 py-2 hover:border-[#9fd3bd] transition-colors print:pointer-events-none">
                    <span className="flex items-center justify-between gap-2 text-[12px] text-[#6f7a73]">Top property <span className="tabular-nums">{topShare}% of leases</span></span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <b className="font-semibold text-[13.5px] text-[#14201a] truncate">{top.label}</b>
                      <span className="shrink-0 text-[12.5px] font-medium text-[#46534c] tabular-nums">{top.newLeases} · {fmtShort(Number(top.annualRentFils))}</span>
                    </span>
                    <span className="mt-1.5 block h-1 rounded-full bg-[#edf1ee] overflow-hidden"><i className="lm-fill block h-full rounded-full bg-gradient-to-r from-[#25946a] to-[#f5c26b]" style={{ width: `${topShare}%` }} /></span>
                  </button>
                )}
                <div className="mt-3 pt-3 border-t border-[#edf1ee] grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[12px] text-[#6f7a73]">Properties leasing</div>
                    <div className="text-[16px] font-semibold tabular-nums text-[#14201a]">{leasingProps}<span className="text-[12px] font-medium text-[#6f7a73]"> / {propCount}</span></div>
                  </div>
                  <div>
                    <div className="text-[12px] text-[#6f7a73]">Avg. rent per lease</div>
                    <div className="text-[16px] font-semibold tabular-nums text-[#14201a]">{avgLease ? fmtAed(avgLease) : '—'}</div>
                  </div>
                </div>
              </div>

              {/* Right: new leases by month */}
              <div className="px-5 py-4 min-w-0 flex flex-col">
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[12.5px]">
                  <span className="font-medium text-[#5f6b63]">New leases by month</span>
                  {peakMonth >= 0 && (
                    <button type="button" onClick={() => setMonth(month === peakMonth ? null : peakMonth)}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-[#fdf3dc] text-[#5a3a06] ring-1 ring-inset ring-[#f3dca6] hover:bg-[#fbe7b8] print:pointer-events-none"
                      title="Busiest month — highlight it in the grid">
                      <i className="w-2 h-2 rounded-full bg-gradient-to-b from-[#f5c26b] to-[#e0a526]" aria-hidden />
                      Busiest <b className="font-semibold">{MONTHS[peakMonth]}</b> · {colTotals[peakMonth]}
                    </button>
                  )}
                  {avgMonth > 0 && <span className="text-[#6f7a73] hidden sm:inline"><span className="inline-block w-3.5 border-t-[1.5px] border-dashed border-[#b7791f] align-middle mr-1" />avg {avgMonth.toFixed(1)}/mo</span>}
                  <span className="ml-auto text-[#6f7a73] print:hidden">
                    {month !== null
                      ? <button onClick={() => setMonth(null)} className="font-medium text-[#047246] hover:underline">{MONTHS_L[month]} · clear</button>
                      : 'Click a month to highlight it'}
                  </span>
                </div>
                <div className="relative mt-2 flex-1 min-h-[130px]">
                  <div className="absolute inset-x-0 top-4 bottom-[22px] pointer-events-none z-[1]">
                    {avgMonth > 0 && (
                      <div className="lm-fade absolute left-0 right-0 border-t-[1.5px] border-dashed border-[#b7791f]/60" style={{ bottom: `${(avgMonth / maxCol) * 100}%` }} />
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-[22px] border-t border-[#e4e9e5]" />
                  <div className="relative grid grid-cols-12 gap-1.5 sm:gap-2.5 h-full">
                    {colTotals.map((raw, i) => {
                      const n = Number(raw) || 0;
                      const on = month === i;
                      const dim = month !== null && !on;
                      const pct = n ? Math.max(4, (n / maxCol) * 100) : 0;
                      return (
                        <button key={i} type="button" disabled={!n} onClick={() => setMonth(on ? null : i)}
                          title={`${MONTHS_L[i]}: ${n} new lease${n === 1 ? '' : 's'}`} aria-pressed={on}
                          className="group h-full flex flex-col items-center disabled:cursor-default">
                          <span className="relative flex-1 w-full">
                            <span className="absolute inset-x-0 top-4 bottom-0 flex justify-center">
                              {n ? (
                                <>
                                  <span className={cn('lm-fade absolute left-1/2 -translate-x-1/2 text-[10.5px] font-semibold tabular-nums', on ? 'text-[#047246]' : i === peakMonth ? 'text-[#94600f]' : 'text-[#5f6b63]', dim && 'opacity-40')}
                                    style={{ bottom: `calc(${pct}% + 4px)`, '--i': i } as React.CSSProperties}>{n}</span>
                                  <span className={cn('lm-bar absolute bottom-0 w-full max-w-[40px] rounded-t-[7px] rounded-b-[3px] transition-[background,opacity] duration-150',
                                    on ? 'bg-gradient-to-b from-[#25946a] to-[#047246]'
                                      : i === peakMonth ? 'bg-gradient-to-b from-[#f5c26b] to-[#e0a526] group-hover:from-[#25946a] group-hover:to-[#047246]'
                                      : 'bg-gradient-to-b from-[#cfe8da] to-[#a8d9c2] group-hover:from-[#25946a] group-hover:to-[#047246]',
                                    dim && 'opacity-40')}
                                    style={{ height: `${pct}%`, '--i': i } as React.CSSProperties} />
                                </>
                              ) : (
                                <span className="absolute bottom-0 w-full max-w-[40px] h-[3px] rounded-full bg-[#e4e9e5]" />
                              )}
                            </span>
                          </span>
                          <span className={cn('mt-1.5 h-4 text-[11.5px] leading-4 whitespace-nowrap', on ? 'text-[#047246] font-semibold' : i === nowMonth ? 'text-[#14201a] font-semibold' : 'text-[#6f7a73]')}>{MONTHS[i]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {(quietMonths > 0 || emptyCount > 0) && (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11.5px] font-medium tabular-nums">
                    {emptyCount > 0 && (
                      <button type="button" onClick={() => setHideEmpty(h => !h)} title={hideEmpty ? 'Show them in the grid again' : 'Hide them from the grid'}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-[#fdecea] text-[#b3261e] hover:bg-[#fbdcd8] print:pointer-events-none">
                        <b className="font-semibold">{emptyCount}</b> propert{emptyCount === 1 ? 'y' : 'ies'} with no new lease{hideEmpty ? ' · hidden' : ''}
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

            {/* ── The grid ── */}
            <section className="lm-up bg-white rounded-2xl border border-[#e4e9e5] shadow-[0_1px_2px_rgba(15,40,28,0.06),0_4px_16px_rgba(15,40,28,0.06)] print:border-none print:shadow-none" style={{ '--i': 1 } as React.CSSProperties}>
              <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-b border-[#edf1ee] print:hidden">
                <span className="px-1 text-[13px] font-semibold text-[#14201a]">{rows.length} propert{rows.length === 1 ? 'y' : 'ies'}</span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11.5px] text-[#6f7a73]">
                  Fewer
                  {['bg-[#dcf0e5]', 'bg-[#a8d9c2]', 'bg-[#25946a]', 'bg-[#047246]'].map(c => <i key={c} className={cn('w-3 h-3 rounded-[4px]', c)} />)}
                  More leases
                </span>
                <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end min-w-0">
                  <label className="flex items-center gap-2 h-8 w-full sm:w-[220px] rounded-full border border-[#e4e9e5] bg-white pl-3 pr-2 text-[#6f7a73] hover:border-[#d3dad5] focus-within:border-[#047246]/50 focus-within:ring-2 focus-within:ring-[#047246]/10">
                    <Search size={14} className="shrink-0" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search properties" aria-label="Search properties"
                      className="flex-1 min-w-0 bg-transparent text-[13px] text-[#14201a] outline-none placeholder:text-[#8b958f]" />
                    {search && (
                      <button onClick={() => setSearch('')} aria-label="Clear search"
                        className="w-5 h-5 shrink-0 grid place-items-center rounded-full bg-[#edf1ee] text-[#5f6b63] hover:bg-[#e4e9e5]"><X size={11} /></button>
                    )}
                  </label>
                  <PillSelect label="Sort by" align="right" active={false}
                    icon={<ArrowUpDown size={13} className="text-[#6f7a73]" />}
                    value={sortKey} display={SORT_LABEL[sortKey]} onChange={v => setSortKey(v as SortKey)}
                    options={(Object.keys(SORT_LABEL) as SortKey[]).map(k => ({ value: k, label: SORT_LABEL[k] }))} />
                </div>
              </div>

              <div className="overflow-x-auto rounded-b-2xl print:overflow-visible">
                <table className="min-w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-[0.05em] text-[#6f7a73]">
                      <th className="sticky left-0 z-10 bg-[#fafbfa] px-4 py-2.5 text-left font-semibold min-w-[200px]">Property</th>
                      {monthLabels.map((m, i) => (
                        <th key={m} className={cn('px-1 py-2.5 text-center font-semibold whitespace-nowrap bg-[#fafbfa]',
                          month === i && 'bg-[#e6f4ed] text-[#047246]', i === peakMonth && month !== i && 'text-[#94600f]', i === nowMonth && 'text-[#14201a]')}>
                          <button type="button" onClick={() => setMonth(month === i ? null : i)} className="uppercase print:pointer-events-none" title={`Highlight ${MONTHS_L[i]}`}>{MONTHS[i] ?? m}</button>
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap bg-[#fafbfa] border-l border-[#edf1ee]">New leases</th>
                      <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap bg-[#fafbfa]">Annual rent</th>
                      <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap bg-[#fafbfa]">Avg. / lease</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => {
                      const n = Number(r.newLeases) || 0;
                      const share = (n / maxRowLeases) * 100;
                      const dimRow = month !== null && !Number(r.cells?.[month]);
                      return (
                        <tr key={`${r.label}-${ri}`} className={cn('lm-row border-t border-[#f0f3f1] hover:bg-[#fafbfa] print:break-inside-avoid', dimRow && 'opacity-45')}
                          style={{ '--i': ri } as React.CSSProperties}>
                          <td className="sticky left-0 z-10 bg-white px-4 py-2 min-w-[200px] max-w-[260px]">
                            <span className={cn('block font-semibold truncate', n ? 'text-[#14201a]' : 'text-[#8b958f]')} title={String(r.label)}>{r.label}</span>
                            <span className="mt-1 block h-1 rounded-full bg-[#edf1ee] overflow-hidden print:hidden">
                              {n > 0 && <i className="lm-fill block h-full rounded-full bg-[#25946a]" style={{ width: `${share}%`, '--i': ri } as React.CSSProperties} />}
                            </span>
                          </td>
                          {monthLabels.map((_, ci) => {
                            const v = Number(r.cells?.[ci]) || 0;
                            const can = v > 0 && (r.cellItems?.[ci]?.length ?? 0) > 0;
                            return (
                              <td key={ci} className={cn('px-1 py-1.5 text-center', month === ci && 'bg-[#f2faf6]')}>
                                {v ? (
                                  <button type="button" disabled={!can} onClick={() => openCell(r, ci)}
                                    title={`${r.label} · ${MONTHS_L[ci]}: ${v} new lease${v === 1 ? '' : 's'}`}
                                    className={cn('w-8 h-8 rounded-lg text-[12.5px] font-semibold tabular-nums transition-transform hover:scale-110 disabled:hover:scale-100 print:bg-transparent print:text-[#14201a]', heat(v, maxCell))}>
                                    {v}
                                  </button>
                                ) : <span className="text-[#d4dad6]">·</span>}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right tabular-nums border-l border-[#edf1ee]">
                            {n ? (
                              <button type="button" onClick={() => openRow(r)} className="font-bold text-[#047246] hover:underline print:text-[#14201a] print:no-underline" title="See all of this property’s new leases">{n}</button>
                            ) : <span className="text-[#b4bcb7]">0</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-[#14201a]">{n ? fmtAed(r.annualRentFils) : <span className="text-[#b4bcb7]">—</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-[#6f7a73]">{n ? fmtAed(Number(r.annualRentFils) / n) : '—'}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr><td colSpan={monthLabels.length + 4} className="px-4 py-10 text-center text-[#6f7a73]">No properties match{search.trim() ? ` “${search.trim()}”` : ''}.</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#e4e9e5] bg-[#fafbfa] font-bold text-[#14201a]">
                      <td className="sticky left-0 z-10 bg-[#fafbfa] px-4 py-3">Total</td>
                      {colTotals.map((raw, i) => {
                        const v = Number(raw) || 0;
                        return (
                          <td key={i} className={cn('px-1 py-3 text-center tabular-nums', month === i && 'bg-[#e6f4ed]')}>
                            {v ? <button type="button" onClick={() => openMonthAll(i)} className="hover:text-[#047246] hover:underline print:no-underline" title={`Every new lease in ${MONTHS_L[i]}`}>{v}</button> : <span className="text-[#c9d0cb] font-normal">·</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right tabular-nums border-l border-[#edf1ee]">{totalLeases}</td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{fmtAed(totalRent)}</td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-[#46534c]">{avgLease ? fmtAed(avgLease) : '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* ── Drill: the leases behind a number ── */}
      {drill && (
        <div className="fixed inset-0 z-50 flex justify-end print:hidden" role="dialog" aria-modal="true" aria-label={`${drill.title} · ${drill.sub}`}>
          <button type="button" className="absolute inset-0 bg-[#0b1f16]/30" onClick={() => setDrill(null)} aria-label="Close" />
          <div className="lm-pop relative h-full w-full max-w-[460px] bg-white shadow-[-12px_0_40px_-12px_rgba(16,24,20,.25)] flex flex-col">
            <div className="px-5 pt-5 pb-3 border-b border-[#edf1ee] flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="m-0 text-[16px] font-bold text-[#14201a] truncate">{drill.title}</h3>
                <p className="m-0 mt-0.5 text-[12.5px] text-[#6f7a73]">
                  {drill.sub} · {drill.items.length} lease{drill.items.length === 1 ? '' : 's'} · {fmtAed(drill.items.reduce((s, it) => s + Number(it.annualRentFils ?? 0), 0))}
                </p>
              </div>
              <button type="button" onClick={() => setDrill(null)} aria-label="Close"
                className="w-8 h-8 shrink-0 grid place-items-center rounded-full text-[#46534c] hover:bg-[#edf1ee]"><X size={15} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {[...drill.items].sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? ''))).map((it, i) => {
                const prop = (it as CellItem & { _prop?: string })._prop;
                const body = (
                  <>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-2">
                        <b className="font-semibold text-[13.5px] text-[#14201a] truncate">{it.tenantName ?? it.contractRef ?? 'Lease'}</b>
                        <span className="ml-auto shrink-0 text-[13px] font-semibold tabular-nums text-[#14201a]">{fmtAed(it.annualRentFils)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#6f7a73] tabular-nums">
                        <span className="truncate">{[prop, unitText(it.unitLabel), it.contractRef].filter(Boolean).join(' · ')}</span>
                        <span className="ml-auto shrink-0">starts {fmtDate(it.startDate)}</span>
                      </span>
                    </span>
                  </>
                );
                return it.contractId != null ? (
                  <button key={`${it.contractId}-${i}`} type="button" onClick={() => { setDrill(null); openLease(it.contractId!); }}
                    className="group w-full flex items-center gap-2 rounded-xl px-3 py-2.5 hover:bg-[#f4faf7]" title={`Open ${it.contractRef ?? 'lease'}`}>
                    {body}
                    <ChevronRight size={14} className="shrink-0 text-[#b4bcb7] group-hover:text-[#047246]" />
                  </button>
                ) : (
                  <div key={`${it.contractRef}-${i}`} className="flex items-center gap-2 rounded-xl px-3 py-2.5">{body}</div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
