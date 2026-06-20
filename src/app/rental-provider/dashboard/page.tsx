/**
 * Rental Provider — Overview Dashboard (rental-provider/dashboard)
 *
 * Top-level RP dashboard. Hero with range tabs, KPI strip (hero receivables +
 * occupancy + active orders + renewals due), occupancy gauge, receivables vs
 * collected bars, quick actions, and dynamic activity / upcoming-renewals lists.
 *
 * Data sources (all re-fetch on range change where range-scoped):
 *   /properties/dashboard-stats        (range-scoped portfolio counts)
 *   /contracts/financial-summary       (range-scoped money + chart)
 *   /contracts/dashboard-extras        (renewals list + activity feed)
 *   /fee-rules/configured              (setup nudge)
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Building2, DollarSign, FileText, AlertCircle, Calendar,
  ClipboardList, Percent, X,
  TrendingUp, ArrowUpRight, CheckCircle2, AlertTriangle, Eye,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';

interface DashboardStats {
  totalProperties: number;
  totalUnits: number;
  occupied: number;
  available: number;
  maintenance: number;
  reserved: number;
  occupancyRate: number;
  activeContracts: number;
  renewalsDue60Days: number;
  units?: UnitRow[];
}

interface UnitRow {
  id: number;
  number: string | null;
  name: string | null;
  building: string | null;
  availability: string;
  listingStatus: string;
}

type BadgeTone = 'green' | 'amber' | 'red' | 'indigo' | 'gray';
interface DrillRow {
  key: string | number;
  title: string;
  subtitle?: string;
  href?: string;
  badges?: { label: string; tone: BadgeTone }[];
}
interface DrillState {
  title: string;
  note?: string;
  loading?: boolean;
  groups: { label?: string; rows: DrillRow[] }[];
}

interface FinancialSummary {
  receivablesInRange: number;
  overdueOrBounced: number;
  depositsHeld: number;
  rangeStart: string;
  rangeEnd: string;
  chartData: Array<{ m: string; receivable: number; collected: number }>;
}

interface UpcomingRenewal {
  contractId: number;
  unitLabel: string;
  tenantName: string | null;
  endDate: string;
  daysUntilEnd: number;
  renewalStatus: string | null;
}

interface ActivityItem {
  kind: 'payment' | 'viewing' | 'contract';
  tone: 'good' | 'warn' | 'info';
  title: string;
  subtitle: string;
  at: string;
  href?: string;
}

interface DashboardExtras {
  upcomingRenewals: UpcomingRenewal[];
  recentActivity: ActivityItem[];
}

function fmtAed(n: number) {
  // Keep one decimal in the abbreviations so e.g. AED 1,500 shows as "1.5K"
  // rather than rounding to "2K" (the old .toFixed(0) lost precision on KPIs).
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `AED ${n.toLocaleString()}`;
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE, month: 'short', day: 'numeric' });
}

const AVAIL_TONE: Record<string, BadgeTone> = { occupied: 'indigo', available: 'green', maintenance: 'amber', reserved: 'gray' };
function unitDrillRow(u: UnitRow): DrillRow {
  return {
    key: u.id,
    title: u.number ? `Unit ${u.number}` : (u.name ?? `Unit ${u.id}`),
    subtitle: u.building ?? undefined,
    href: `/rental-provider/dashboard/units/${u.id}`,
    badges: [
      { label: u.availability, tone: AVAIL_TONE[u.availability] ?? 'gray' },
      u.listingStatus === 'published'
        ? { label: 'Published', tone: 'green' as BadgeTone }
        : { label: `Not listed · ${u.listingStatus}`, tone: 'amber' as BadgeTone },
    ],
  };
}
/** Group units by building (sorted), units sorted by number — "properly arranged". */
function unitGroups(rows: UnitRow[]): { label?: string; rows: DrillRow[] }[] {
  const byBuilding = new Map<string, UnitRow[]>();
  for (const u of rows) {
    const b = u.building ?? '—';
    const arr = byBuilding.get(b) ?? [];
    arr.push(u); byBuilding.set(b, arr);
  }
  return [...byBuilding.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([building, us]) => ({
      label: `${building} · ${us.length}`,
      rows: us
        .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? '', undefined, { numeric: true }))
        .map(unitDrillRow),
    }));
}

type RangePreset = 'this_month' | 'last_month' | 'last_3m' | 'last_6m' | 'this_year' | 'all_time';

const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_3m',    label: 'Last 3M' },
  { key: 'last_6m',    label: 'Last 6M' },
  { key: 'this_year',  label: 'This Year' },
  { key: 'all_time',   label: 'All Time' },
];

function presetToDates(preset: RangePreset): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case 'this_month':
      return { from: fmt(new Date(y, m, 1)), to: today };
    case 'last_month': {
      const start = new Date(y, m - 1, 1);
      const end   = new Date(y, m, 0);
      return { from: fmt(start), to: fmt(end) };
    }
    case 'last_3m':
      return { from: fmt(new Date(y, m - 2, 1)), to: today };
    case 'last_6m':
      return { from: fmt(new Date(y, m - 5, 1)), to: today };
    case 'this_year':
      return { from: `${y}-01-01`, to: today };
    case 'all_time':
      return { from: '2020-01-01', to: today };
  }
}

const ACT_ICON: Record<ActivityItem['kind'], typeof CheckCircle2> = {
  payment:  CheckCircle2,
  viewing:  Eye,
  contract: FileText,
};

export default function RentalProviderDashboard() {
  const { user } = useAuth();
  const name = user?.name ?? user?.firstName ?? 'there';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [fin, setFin] = useState<FinancialSummary | null>(null);
  const [extras, setExtras] = useState<DashboardExtras | null>(null);
  const [selectedRange, setSelectedRange] = useState<RangePreset>('this_month');
  const [feeRulesConfigured, setFeeRulesConfigured] = useState<boolean | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  // Per-fetch loading + error tracking so each section can show its own state.
  // NOTE: setState only happens in the catch/then path (post-await) to keep the
  // react-hooks/set-state-in-effect rule happy.
  const [statsErr,    setStatsErr]    = useState<string | null>(null);
  const [finErr,      setFinErr]      = useState<string | null>(null);
  const [extrasErr,   setExtrasErr]   = useState<string | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);

  const fetchStats = useCallback(async (preset: RangePreset, signal?: AbortSignal) => {
    const { from, to } = presetToDates(preset);
    try {
      const r = await fetch(`/api/properties/dashboard-stats?from=${from}&to=${to}`, { credentials: 'include', signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data && typeof data.totalUnits === 'number') {
        setStats(data);
        setStatsErr(null);
      } else {
        throw new Error('Malformed response');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setStatsErr((e as Error).message || 'Failed to load portfolio stats');
    }
  }, []);

  const fetchFinancial = useCallback(async (preset: RangePreset, signal?: AbortSignal) => {
    const { from, to } = presetToDates(preset);
    try {
      const r = await fetch(`/api/contracts/financial-summary?from=${from}&to=${to}`, { credentials: 'include', signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data && typeof data.receivablesInRange === 'number') {
        setFin(data);
        setFinErr(null);
      } else {
        throw new Error('Malformed response');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setFinErr((e as Error).message || 'Failed to load financials');
    }
  }, []);

  const fetchExtras = useCallback(async (preset: RangePreset, signal?: AbortSignal) => {
    const { from, to } = presetToDates(preset);
    try {
      const r = await fetch(`/api/contracts/dashboard-extras?from=${from}&to=${to}`, { credentials: 'include', signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: DashboardExtras = await r.json();
      if (data && Array.isArray(data.recentActivity)) {
        setExtras(data);
        setExtrasErr(null);
      } else {
        throw new Error('Malformed response');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setExtrasErr((e as Error).message || 'Failed to load activity');
    }
  }, []);

  const fetchFeeRules = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/fee-rules/configured', { credentials: 'include', signal });
      if (!r.ok) return;
      const d: { configured: boolean } = await r.json();
      setFeeRulesConfigured(d.configured);
    } catch { /* fee-rules nudge is best-effort, ignore */ }
  }, []);

  // Re-fire range-scoped fetches whenever the user picks a different range.
  useEffect(() => {
    const ac = new AbortController();
    fetchStats(selectedRange, ac.signal);
    fetchFinancial(selectedRange, ac.signal);
    fetchExtras(selectedRange, ac.signal);
    return () => ac.abort();
  }, [selectedRange, fetchStats, fetchFinancial, fetchExtras]);

  useEffect(() => {
    const ac = new AbortController();
    fetchFeeRules(ac.signal);
    return () => ac.abort();
  }, [fetchFeeRules]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchStats(selectedRange),
        fetchFinancial(selectedRange),
        fetchExtras(selectedRange),
        fetchFeeRules(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [selectedRange, fetchStats, fetchFinancial, fetchExtras, fetchFeeRules]);

  const occupied         = stats?.occupied ?? 0;
  const available        = stats?.available ?? 0;
  const totalUnits       = stats?.totalUnits ?? 0;
  const totalProperties  = stats?.totalProperties ?? 0;
  const occupancyRate    = stats?.occupancyRate ?? 0;
  const activeContracts  = stats?.activeContracts ?? 0;
  const renewalsDue60    = stats?.renewalsDue60Days ?? 0;
  const units            = stats?.units ?? [];
  const [drill, setDrill] = useState<DrillState | null>(null);

  // Drill-down openers — KPI tiles show the records behind the number.
  const drillAvailable = () => {
    const rows = units.filter(u => u.availability === 'available');
    const published = rows.filter(u => u.listingStatus === 'published').length;
    setDrill({
      title: `Available units · ${rows.length}`,
      note: `${published} published in public listings · ${rows.length - published} not listed (draft / pending) — only published units appear publicly.`,
      groups: unitGroups(rows),
    });
  };
  const drillOccupied = () => setDrill({ title: `Occupied units · ${occupied}`, groups: unitGroups(units.filter(u => u.availability === 'occupied')) });
  const drillAllUnits = () => setDrill({ title: `All units · ${units.length}`, groups: unitGroups(units) });
  const drillRenewals = () => {
    const list = (extras?.upcomingRenewals ?? []).slice().sort((a, b) => a.daysUntilEnd - b.daysUntilEnd);
    setDrill({
      title: `Renewals due · ${list.length}`,
      note: list.length ? 'Active leases ending soon — propose a renewal before they lapse.' : 'No renewals due in this window.',
      groups: [{ rows: list.map(x => ({
        key: x.contractId,
        title: x.unitLabel,
        subtitle: `${x.tenantName ?? 'Tenant'} · ${x.daysUntilEnd <= 0 ? `expired ${Math.abs(x.daysUntilEnd)}d ago` : `${x.daysUntilEnd}d left`}`,
        href: `/rental-provider/dashboard/contracts/${x.contractId}/v2`,
        badges: x.renewalStatus
          ? [{ label: x.renewalStatus, tone: 'indigo' as BadgeTone }]
          : (x.daysUntilEnd <= 30 ? [{ label: 'urgent', tone: 'red' as BadgeTone }] : []),
      })) }],
    });
  };
  const drillOverdue = async () => {
    setDrill({ title: 'Overdue / bounced', loading: true, groups: [] });
    try {
      const res = await fetch('/api/contracts/receivables', { credentials: 'include' });
      const data = res.ok ? await res.json() : [];
      const rows = (Array.isArray(data) ? data : []).filter((p: { status?: string }) => p.status === 'overdue');
      setDrill({
        title: `Overdue / bounced · ${rows.length}`,
        note: rows.length ? 'Past-due or bounced cheques — follow up for collection.' : 'No overdue or bounced cheques.',
        groups: [{ rows: rows.map((p: { id: number; tenant?: string; amount?: number; unit?: string; building?: string; transactionDate?: string; chequeNumber?: string; status?: string }) => ({
          key: p.id,
          title: `${p.tenant ?? 'Tenant'} — AED ${Number(p.amount ?? 0).toLocaleString()}`,
          subtitle: `${p.unit ? `Unit ${p.unit} · ` : ''}${p.building ?? ''} · due ${p.transactionDate ? new Date(p.transactionDate).toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: '2-digit' }) : '—'}${p.chequeNumber ? ` · #${p.chequeNumber}` : ''}`,
          href: '/rental-provider/dashboard/receivables',
          badges: [{ label: p.status ?? 'overdue', tone: 'red' as BadgeTone }],
        })) }],
      });
    } catch {
      setDrill({ title: 'Overdue / bounced', note: 'Could not load cheques.', groups: [] });
    }
  };

  const rangeLabel = RANGE_PRESETS.find(r => r.key === selectedRange)?.label ?? '';

  const gaugePct = useMemo(() => Math.min(100, Math.max(0, occupancyRate)), [occupancyRate]);
  const dashLen = 2 * Math.PI * 40;

  return (
    <div className="p-6 sm:p-8 max-w-[1320px] mx-auto space-y-6">
      {/* Hero */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-[260px] flex-1">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] uppercase text-[var(--primary-dark)] mb-2">
            <TrendingUp size={13} />
            <span>Portfolio Overview</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--neutral-900)] leading-tight">
            Welcome, <span className="italic font-medium text-[var(--primary-dark)]">{name}</span>.
          </h1>
          <p className="text-sm sm:text-[15px] text-[var(--neutral-500)] mt-2 max-w-[54ch] leading-relaxed">
            Your portfolio at a glance — occupancy, receivables and renewals — refreshes with the range you pick below.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            title="Refresh all dashboard data"
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-[var(--neutral-700)] bg-white border border-[var(--base-200)] hover:border-[var(--neutral-500)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
          <Link
            href="/rental-provider/dashboard/portfolio?add=1"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-dark)] transition-colors"
          >
            <Building2 size={16} /> List Property
          </Link>
          <Link
            href="/rental-provider/dashboard/contracts/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[var(--neutral-700)] bg-white border border-[var(--base-200)] hover:border-[var(--neutral-500)] transition-colors"
          >
            <ClipboardList size={16} /> New Contract
          </Link>
        </div>
      </header>

      {/* Range tab strip */}
      <div className="flex items-center justify-between gap-4 flex-wrap border-b border-[var(--base-200)]">
        <div className="flex items-stretch overflow-x-auto flex-1 min-w-0 -mb-px">
          {RANGE_PRESETS.map(({ key, label }) => {
            const active = selectedRange === key;
            return (
              <button
                key={key}
                onClick={() => setSelectedRange(key)}
                className={`px-4 py-3 text-[13.5px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-[var(--neutral-900)] text-[var(--neutral-900)]'
                    : 'border-transparent text-[var(--neutral-400)] hover:text-[var(--neutral-700)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--neutral-400)] font-medium pb-3 pr-1">
          <Calendar size={12} />
          <span>{RANGE_PRESETS.find(r => r.key === selectedRange)?.label}</span>
        </div>
      </div>

      {/* Error banner — shows when any range-scoped fetch fails */}
      {(statsErr || finErr || extrasErr) && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-red-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-900">Some data didn&apos;t load</p>
            <p className="text-[12px] text-red-700 mt-0.5">
              {[statsErr && 'portfolio stats', finErr && 'financials', extrasErr && 'activity']
                .filter(Boolean).join(', ')} failed to refresh.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      {/* Fee rules setup nudge */}
      {feeRulesConfigured === false && !nudgeDismissed && (
        <div className="flex items-center gap-4 bg-white border border-amber-200 border-l-4 border-l-amber-400 rounded-2xl px-5 py-4 shadow-sm">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
            <Percent size={16} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[var(--neutral-900)]">Set up your fee rules</p>
            <p className="text-[13px] text-[var(--neutral-500)] mt-0.5 leading-snug">
              Configure admin fees, Ejari, commission, and security deposits so they auto-fill on every new contract.
            </p>
          </div>
          <Link
            href="/rental-provider/dashboard/settings"
            className="flex-shrink-0 inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors"
          >
            Configure
          </Link>
          <button
            onClick={() => setNudgeDismissed(true)}
            aria-label="Dismiss"
            className="flex-shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[var(--neutral-400)] hover:bg-[var(--base-100)] hover:text-[var(--neutral-900)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* KPI Strip — hero receivables + 3 stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Hero KPI — Receivables (dark) */}
        <div className="relative overflow-hidden rounded-2xl p-6 text-white bg-gradient-to-br from-[#14201c] via-[#1d2c27] to-[#22332d] shadow-sm lg:col-span-1">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] uppercase text-white/70">
            <DollarSign size={12} className="text-[#7be1c2]" />
            Receivables · {rangeLabel}
          </div>
          <div className="mt-3 text-[42px] font-bold leading-[1] tracking-tight tabular-nums">
            {fin ? fmtAed(fin.receivablesInRange) : (finErr ? '—' : '…')}
          </div>
          <div className="mt-3 text-[12.5px] text-white/60">
            {fin?.overdueOrBounced ? (
              <span className="inline-flex items-center gap-1 text-[#ffb4a8]">
                <AlertTriangle size={12} /> {fin.overdueOrBounced} overdue / bounced
              </span>
            ) : (
              <span className="text-white/55">No overdue payments</span>
            )}
          </div>
          <ArrowUpRight size={56} className="absolute -right-3 -bottom-3 text-white/5" />
        </div>

        {/* Occupancy */}
        <KpiCard
          icon={<Building2 size={12} />}
          label="Occupancy"
          value={`${occupancyRate}%`}
          sub={`${occupied} of ${totalUnits} units`}
          onClick={drillOccupied}
        />
        {/* Active orders */}
        <KpiCard
          icon={<ClipboardList size={12} />}
          label="Active Orders"
          value={String(activeContracts)}
          sub={`across ${totalProperties} ${totalProperties === 1 ? 'asset' : 'assets'}`}
        />
        {/* Renewals due */}
        <KpiCard
          icon={<AlertCircle size={12} />}
          label="Renewals · 60 days"
          value={String(renewalsDue60)}
          sub={renewalsDue60 > 0 ? 'action needed' : 'none pending'}
          tone={renewalsDue60 > 0 ? 'warn' : 'default'}
          onClick={drillRenewals}
        />
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiMini label="Total Units"        value={String(totalUnits)}                        sub={`${totalProperties} properties`} onClick={drillAllUnits} />
        <KpiMini label="Available"          value={String(available)}                         sub="ready to list" onClick={drillAvailable} />
        <KpiMini label="Deposits Held"      value={fin ? fmtAed(fin.depositsHeld) : '—'}      sub="active security" />
        <KpiMini label="Overdue / Bounced"  value={fin ? String(fin.overdueOrBounced) : '—'}  sub="past due cheques" tone={(fin?.overdueOrBounced ?? 0) > 0 ? 'danger' : 'default'} onClick={drillOverdue} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">
        {/* Gauge */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-[var(--base-200)]">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-base font-bold text-[var(--neutral-900)]">Occupancy Rate</h3>
              <p className="text-xs text-[var(--neutral-400)] mt-0.5">Across all units in your portfolio</p>
            </div>
          </div>
          <div className="flex items-center justify-center py-4">
            <div className="relative w-[200px] h-[200px]">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="var(--base-200)" strokeWidth="12" />
                <circle
                  cx="50" cy="50" r="40" fill="none"
                  stroke="var(--primary)" strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={`${(gaugePct / 100) * dashLen} ${dashLen}`}
                  style={{ transition: 'stroke-dasharray .6s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[36px] font-bold tracking-tight text-[var(--neutral-900)] tabular-nums leading-none">{occupancyRate}%</span>
                <span className="text-xs text-[var(--neutral-400)] mt-1.5">Occupancy</span>
              </div>
            </div>
          </div>
          <div className="flex justify-center gap-6 text-[13px] text-[var(--neutral-700)] font-medium">
            <button type="button" onClick={drillOccupied} className="flex items-center gap-2 hover:underline cursor-pointer"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)]" />Occupied {occupied}</button>
            <button type="button" onClick={drillAvailable} className="flex items-center gap-2 hover:underline cursor-pointer"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--base-200)]" />Available {available}</button>
          </div>
        </div>

        {/* Bar chart */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-[var(--base-200)]">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[var(--neutral-900)]">Receivables vs Collected</h3>
              <p className="text-xs text-[var(--neutral-400)] mt-0.5">{rangeLabel}</p>
            </div>
            <Link href="/rental-provider/dashboard/receivables" className="text-xs font-semibold text-[var(--neutral-700)] underline decoration-[var(--base-200)] underline-offset-4 hover:decoration-[var(--neutral-400)]">View all</Link>
          </div>
          {finErr && !fin ? (
            <SectionError message="Couldn't load financial data." onRetry={() => fetchFinancial(selectedRange)} />
          ) : fin && fin.chartData.length > 0 ? (() => {
            const maxVal = Math.max(...fin.chartData.flatMap(d => [d.receivable, d.collected]), 1);
            const many = fin.chartData.length > 8;
            return (
              <>
                <div className={many ? 'overflow-x-auto' : ''}>
                  <div className="flex items-end gap-2.5 px-1" style={{ height: 180, minWidth: many ? `${fin.chartData.length * 44}px` : undefined }}>
                    {fin.chartData.map((d, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1.5" style={{ minWidth: '32px' }}>
                        <div className="flex gap-1 items-end w-full justify-center" style={{ height: 150 }}>
                          <div
                            className="rounded-t-[3px] bg-[var(--primary-light)] w-3"
                            style={{ height: `${Math.max(4, (d.receivable / maxVal) * 100)}%` }}
                            title={`Receivable: AED ${d.receivable.toLocaleString()}`}
                          />
                          <div
                            className="rounded-t-[3px] bg-[var(--primary)] w-3"
                            style={{ height: `${Math.max(4, (d.collected / maxVal) * 100)}%` }}
                            title={`Collected: AED ${d.collected.toLocaleString()}`}
                          />
                        </div>
                        <span className="text-[10.5px] text-[var(--neutral-400)] font-semibold leading-none whitespace-nowrap">{d.m}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-center gap-6 mt-4 text-[13px] text-[var(--neutral-700)] font-medium">
                  <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--primary-light)]" />Receivable</span>
                  <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)]" />Collected</span>
                </div>
              </>
            );
          })() : (
            <div className="flex items-end gap-3 px-2" style={{ height: 180 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex gap-1 items-end w-full justify-center" style={{ height: 150 }}>
                    <div className="w-3 rounded-t-[3px] bg-[var(--base-200)] animate-pulse" style={{ height: '60%' }} />
                    <div className="w-3 rounded-t-[3px] bg-[var(--base-200)] animate-pulse" style={{ height: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity + Renewals */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
        {/* Recent activity */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-[var(--base-200)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[15px] font-bold text-[var(--neutral-900)]">Recent Activity</h3>
            {extras && extras.recentActivity.length > 0 && (
              <Link href="/rental-provider/dashboard/receivables" className="text-xs font-semibold text-[var(--neutral-500)] hover:text-[var(--neutral-900)]">View all</Link>
            )}
          </div>
          {extrasErr && !extras ? (
            <SectionError message="Couldn't load recent activity." onRetry={() => fetchExtras(selectedRange)} />
          ) : !extras ? (
            <ActivitySkeleton />
          ) : extras.recentActivity.length === 0 ? (
            <p className="text-sm text-[var(--neutral-400)] py-8 text-center">No activity yet — events will show up here as your portfolio gets busy.</p>
          ) : (
            <div className="flex flex-col">
              {extras.recentActivity.map((a, i) => {
                const Icon = ACT_ICON[a.kind];
                const tone = a.tone;
                const toneCls =
                  tone === 'good' ? 'bg-[var(--primary-light)] text-[var(--primary-dark)]' :
                  tone === 'warn' ? 'bg-amber-50 text-amber-700' :
                  'bg-[var(--base-100)] text-[var(--neutral-700)]';
                return (
                  <div key={i} className="grid grid-cols-[32px_1fr_auto] gap-3 items-center py-3 border-b border-[var(--base-200)] last:border-0">
                    <div className={`w-8 h-8 rounded-full grid place-items-center ${toneCls}`}>
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      {a.href ? (
                        <Link href={a.href} className="block text-[13.5px] font-semibold text-[var(--neutral-900)] leading-tight truncate hover:underline">
                          {a.title}
                        </Link>
                      ) : (
                        <p className="text-[13.5px] font-semibold text-[var(--neutral-900)] leading-tight truncate">{a.title}</p>
                      )}
                      <p className="text-[12px] text-[var(--neutral-400)] mt-0.5 truncate">{a.subtitle}</p>
                    </div>
                    <span className="text-[11.5px] text-[var(--neutral-400)] font-medium whitespace-nowrap">{relativeTime(a.at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming renewals */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-[var(--base-200)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[15px] font-bold text-[var(--neutral-900)]">Upcoming Renewals</h3>
            <Link href="/rental-provider/dashboard/contracts" className="text-xs font-semibold text-[var(--neutral-500)] hover:text-[var(--neutral-900)]">All contracts</Link>
          </div>
          {extrasErr && !extras ? (
            <SectionError message="Couldn't load renewals." onRetry={() => fetchExtras(selectedRange)} />
          ) : !extras ? (
            <ActivitySkeleton rows={4} />
          ) : extras.upcomingRenewals.length === 0 ? (
            <p className="text-sm text-[var(--neutral-400)] py-8 text-center">No renewals due in the next 60 days.</p>
          ) : (
            <div className="flex flex-col">
              {extras.upcomingRenewals.map((r) => {
                const urgent = r.daysUntilEnd <= 14;
                return (
                  <Link
                    key={r.contractId}
                    href={`/rental-provider/dashboard/contracts/${r.contractId}/v2`}
                    className="flex items-center justify-between gap-3 py-3 border-b border-[var(--base-200)] last:border-0 hover:bg-[var(--base-100)]/40 -mx-2 px-2 rounded-md transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-bold text-[var(--neutral-900)] truncate">{r.unitLabel}</div>
                      <div className="text-[12px] text-[var(--neutral-400)] mt-0.5 truncate">{r.tenantName ?? 'No customer'}</div>
                    </div>
                    <span
                      className={`flex-shrink-0 text-[12px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                        urgent ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {r.daysUntilEnd <= 0 ? 'expires today' : `${r.daysUntilEnd}d`}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <DrillDown drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

function clickableProps(onClick?: () => void) {
  if (!onClick) return {};
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
  };
}

function KpiCard({ icon, label, value, sub, tone = 'default', onClick }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: 'default' | 'warn';
  onClick?: () => void;
}) {
  return (
    <div
      {...clickableProps(onClick)}
      className={`bg-white rounded-2xl p-5 shadow-sm border border-[var(--base-200)] flex flex-col gap-2${onClick ? ' cursor-pointer hover:border-[var(--neutral-400)] hover:shadow-md transition-all' : ''}`}
    >
      <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] inline-flex items-center gap-1.5">
        <span className={tone === 'warn' ? 'text-amber-600' : 'text-[var(--primary-dark)]'}>{icon}</span>
        {label}
        {onClick && <Eye size={11} className="text-[var(--neutral-400)] ml-auto" />}
      </div>
      <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-[var(--neutral-900)]">{value}</div>
      <div className="text-[12.5px] text-[var(--neutral-400)] font-medium">{sub}</div>
    </div>
  );
}

function KpiMini({ label, value, sub, tone = 'default', onClick }: {
  label: string;
  value: string;
  sub: string;
  tone?: 'default' | 'danger';
  onClick?: () => void;
}) {
  return (
    <div
      {...clickableProps(onClick)}
      className={`bg-white rounded-xl p-4 shadow-sm border border-[var(--base-200)]${onClick ? ' cursor-pointer hover:border-[var(--neutral-400)] hover:shadow-md transition-all' : ''}`}
    >
      <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] flex items-center gap-1.5">
        {label}
        {onClick && <Eye size={10} className="text-[var(--neutral-400)] ml-auto" />}
      </div>
      <div className={`text-[22px] font-bold tracking-tight mt-1.5 tabular-nums ${tone === 'danger' ? 'text-red-600' : 'text-[var(--neutral-900)]'}`}>{value}</div>
      <div className="text-[11.5px] text-[var(--neutral-400)] mt-0.5">{sub}</div>
    </div>
  );
}

const DRILL_TONE: Record<BadgeTone, { bg: string; fg: string }> = {
  green:  { bg: '#dcfce7', fg: '#166534' },
  amber:  { bg: '#fef3c7', fg: '#92400e' },
  red:    { bg: '#fee2e2', fg: '#991b1b' },
  indigo: { bg: '#e0e7ff', fg: '#3730a3' },
  gray:   { bg: '#f3f4f6', fg: '#374151' },
};

function DrillDown({ drill, onClose }: { drill: DrillState | null; onClose: () => void }) {
  if (!drill) return null;
  const total = drill.groups.reduce((s, g) => s + g.rows.length, 0);
  const renderRow = (r: DrillRow) => {
    const inner = (
      <>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-[var(--neutral-900)] truncate">{r.title}</p>
          {r.subtitle && <p className="text-[11.5px] text-[var(--neutral-400)] truncate">{r.subtitle}</p>}
        </div>
        {r.badges?.map((b, bi) => (
          <span key={bi} className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: DRILL_TONE[b.tone].bg, color: DRILL_TONE[b.tone].fg }}>{b.label}</span>
        ))}
      </>
    );
    return r.href
      ? <Link key={r.key} href={r.href} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-[var(--base-100)]">{inner}</Link>
      : <div key={r.key} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg">{inner}</div>;
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,18,14,0.5)' }} onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl border border-[var(--base-200)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-[var(--base-200)]">
          <div>
            <h3 className="text-base font-bold text-[var(--neutral-900)]">{drill.title}</h3>
            {drill.note && <p className="text-xs text-[var(--neutral-500)] mt-1 leading-snug">{drill.note}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--neutral-400)] hover:text-[var(--neutral-900)] shrink-0"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-3">
          {drill.loading ? (
            <p className="text-sm text-[var(--neutral-400)] text-center py-8">Loading…</p>
          ) : total === 0 ? (
            <p className="text-sm text-[var(--neutral-400)] text-center py-8">Nothing to show.</p>
          ) : drill.groups.map((g, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-2' : ''}>
              {g.label && <p className="text-[10.5px] font-bold tracking-[0.1em] uppercase text-[var(--neutral-400)] px-3 pt-2 pb-1">{g.label}</p>}
              {g.rows.map(renderRow)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-6 text-center">
      <AlertTriangle size={20} className="text-red-500 mx-auto mb-2" />
      <p className="text-sm text-[var(--neutral-700)] font-semibold">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--neutral-700)] bg-white border border-[var(--base-200)] hover:border-[var(--neutral-500)] cursor-pointer"
      >
        <RefreshCw size={12} /> Try again
      </button>
    </div>
  );
}

function ActivitySkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[32px_1fr_60px] gap-3 items-center py-3 border-b border-[var(--base-200)] last:border-0">
          <div className="w-8 h-8 rounded-full bg-[var(--base-100)] animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3 bg-[var(--base-100)] rounded animate-pulse w-3/4" />
            <div className="h-2.5 bg-[var(--base-100)] rounded animate-pulse w-1/2" />
          </div>
          <div className="h-2.5 bg-[var(--base-100)] rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
