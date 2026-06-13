/**
 * Executive Overview — the CEO "where do I stand" strip at the top of /reports.
 *
 * One fetch (GET /api/reports/executive-summary) renders:
 *   1. Headline KPI tiles (rent roll, occupancy, arrears, 90-day PDC inflow,
 *      expiring leases, deposit liability)
 *   2. A red/amber exceptions strip (renewal backlog, missing deposits, KYC,
 *      unlisted vacants) — each links to the report where it is actioned
 *   3. Four charts (recharts): rent cashflow by month, renewals coming up,
 *      receivables aging, occupancy by property
 *
 * All money arrives in fils. Chart series with no data auto-hide.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, AlertCircle, AlertTriangle, CheckCircle2, ChevronRight,
  Wallet, Building2, CalendarClock, ShieldCheck, RefreshCw, Banknote,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts';

interface ExecutiveSummary {
  generatedAt: string;
  year: number;
  kpis: {
    properties: number;
    units: number; occupied: number; vacant: number; occupancyRate: number;
    rentRollFils: number; activeContractedRentFils: number;
    arrearsFils: number; arrearsCheques: number;
    upcoming90Fils: number;
    expiring90: number; expiring90RentFils: number;
    renewalsOverdue: number;
    vacantAskingFils: number;
    depositsHeld: number; depositLiabilityFils: number;
    collectionYtdRate: number;
  };
  charts: {
    cashflowByMonth: Array<{ month: string; label: string; collectedFils: number; overdueFils: number; upcomingFils: number; bouncedFils: number }>;
    renewalsByMonth: Array<{ month: string; label: string; leases: number; annualRentFils: number; overdue: boolean }>;
    occupancyByProperty: Array<{ name: string; occupied: number; vacant: number; maintenance: number }>;
    agingBuckets: Array<{ bucket: string; amountFils: number }>;
  };
  exceptions: {
    renewalsOverdue: number; renewalsOverdueRentFils: number;
    missingDeposit: number; missingDepositRentFils: number;
    kycIncomplete: number;
    vacantUnlisted: number;
  };
}

const GREEN = '#2e9f82';
const AMBER = '#d97706';
const RED = '#dc2626';
const GRAY = '#d4d2cc';

const fmtAed = (fils: number | null | undefined) =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(fils ?? 0) / 100);
/** Compact AED for KPI tiles and chart axes: 7.46M, 689K, 950. */
const fmtAedShort = (fils: number | null | undefined) => {
  const v = Number(fils ?? 0) / 100;
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
};

function KpiTile({ icon: Icon, label, value, sub, tone = 'neutral' }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; value: string; sub?: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
}) {
  const valueCls =
    tone === 'bad' ? 'text-[#b91c1c]' : tone === 'warn' ? 'text-[#b45309]' : tone === 'good' ? 'text-[#1a7a5a]' : 'text-[#1a1916]';
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">
        <Icon size={12} /> {label}
      </div>
      <p className={`text-xl font-bold mt-1.5 leading-none ${valueCls}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#9b9890] mt-1.5">{sub}</p>}
    </div>
  );
}

/** Red/amber exception chip linking to the report where it gets actioned. */
function ExceptionChip({ href, severity, children }: { href: string; severity: 'red' | 'amber'; children: React.ReactNode }) {
  const cls = severity === 'red'
    ? 'bg-[#fef2f2] border-[#fecaca] text-[#b91c1c] hover:border-[#dc2626]'
    : 'bg-[#fffbeb] border-[#fde68a] text-[#92400e] hover:border-[#d97706]';
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${cls}`}>
      <AlertTriangle size={12} /> {children} <ChevronRight size={12} />
    </Link>
  );
}

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4 print:break-inside-avoid">
      <h3 className="text-sm font-bold text-[#1a1916]">{title}</h3>
      {sub && <p className="text-[11px] text-[#9b9890] mt-0.5 mb-2">{sub}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

const tooltipStyle = {
  borderRadius: 12, border: '1px solid #e8e6e0', fontSize: 12,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
};

// recharts v3 Formatter/labelFormatter generics are overload intersections —
// keep params wide (unknown) so the helpers satisfy every overload.
const aedTooltip = (v: unknown, name: unknown) => [fmtAed(Number(v)), String(name)] as [string, string];
const aedTooltipAs = (label: string) => (v: unknown) => [fmtAed(Number(v)), label] as [string, string];
const renewalTooltipLabel = (label: unknown, payload: unknown) => {
  const p = (payload as Array<{ payload?: { leases?: number } }> | undefined)?.[0]?.payload;
  return p?.leases != null ? `${String(label)} — ${p.leases} lease${p.leases === 1 ? '' : 's'}` : String(label ?? '');
};

export default function ExecutiveOverview({
  endpoint = '/api/reports/executive-summary',
  linkFor = (slug: string) => `/rental-provider/dashboard/reports/${slug}`,
}: {
  /** Manager portal passes '/api/manager/reports/executive-summary?rp=N'. */
  endpoint?: string;
  /** Builds exception-chip hrefs per portal. */
  linkFor?: (slug: string) => string;
} = {}) {
  const [data, setData] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(endpoint, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [endpoint]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-10 flex items-center justify-center mb-8">
        <Loader2 size={18} className="animate-spin text-[#2e9f82]" />
        <span className="ml-2 text-sm text-[#6b6860]">Loading overview…</span>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-700 mb-8">
        <AlertCircle size={14} /> Could not load the executive overview{error ? ` (${error})` : ''}.
      </div>
    );
  }

  const { kpis: k, charts, exceptions: ex } = data;
  const hasBounced = charts.cashflowByMonth.some(m => m.bouncedFils > 0);
  // Arrears dated before this calendar year never appear in the cashflow chart's
  // window — call them out so the chart doesn't contradict the Arrears tile.
  const chartOverdueFils = charts.cashflowByMonth.reduce((s, m) => s + m.overdueFils, 0);
  const arrearsOutsideChartFils = Math.max(0, k.arrearsFils - chartOverdueFils);
  const hasMaintenance = charts.occupancyByProperty.some(p => p.maintenance > 0);
  const anyException = ex.renewalsOverdue > 0 || ex.missingDeposit > 0 || ex.kycIncomplete > 0 || ex.vacantUnlisted > 0;
  // Truncate long building names on the occupancy axis.
  const occData = charts.occupancyByProperty.map(p => ({ ...p, short: p.name.length > 18 ? `${p.name.slice(0, 17)}…` : p.name }));

  return (
    <div className="mb-10">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <KpiTile icon={Banknote} label="Rent roll / yr" value={`AED ${fmtAedShort(k.rentRollFils)}`}
          sub={`${k.occupied} occupied units · latest leases`} tone="good" />
        <KpiTile icon={Building2} label="Occupancy" value={`${k.occupancyRate.toFixed(1)}%`}
          sub={`${k.occupied} of ${k.units} units · ${k.properties} properties`} />
        <KpiTile icon={Wallet} label="Arrears" value={fmtAed(k.arrearsFils)}
          sub={k.arrearsCheques ? `${k.arrearsCheques} cheque${k.arrearsCheques === 1 ? '' : 's'} past due` : 'No cheques past due'}
          tone={k.arrearsFils > 0 ? 'bad' : 'good'} />
        <KpiTile icon={CalendarClock} label="PDC next 90 days" value={`AED ${fmtAedShort(k.upcoming90Fils)}`}
          sub="post-dated cheques landing" />
        <KpiTile icon={RefreshCw} label="Expiring ≤ 90 days" value={String(k.expiring90)}
          sub={`AED ${fmtAedShort(k.expiring90RentFils)} at stake · ${k.renewalsOverdue} already lapsed`}
          tone={k.renewalsOverdue > 0 ? 'warn' : 'neutral'} />
        <KpiTile icon={ShieldCheck} label="Deposit liability" value={`AED ${fmtAedShort(k.depositLiabilityFils)}`}
          sub={`${k.depositsHeld} deposits held`} />
      </div>

      {/* Exceptions strip */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {ex.renewalsOverdue > 0 && (
          <ExceptionChip href={linkFor('renewal-forecast')} severity="red">
            {ex.renewalsOverdue} leases overdue for renewal · {fmtAed(ex.renewalsOverdueRentFils)}
          </ExceptionChip>
        )}
        {ex.missingDeposit > 0 && (
          <ExceptionChip href={linkFor('data-gaps')} severity="red">
            {ex.missingDeposit} active leases missing a deposit
          </ExceptionChip>
        )}
        {ex.kycIncomplete > 0 && (
          <ExceptionChip href={linkFor('data-gaps')} severity="amber">
            {ex.kycIncomplete} customers with KYC gaps
          </ExceptionChip>
        )}
        {ex.vacantUnlisted > 0 && (
          <ExceptionChip href={linkFor('vacancy-analysis')} severity="amber">
            {ex.vacantUnlisted} vacant units not listed
          </ExceptionChip>
        )}
        {!anyException && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#bbe5d6] bg-[#f0faf6] text-xs font-semibold text-[#1a7a5a]">
            <CheckCircle2 size={12} /> No exceptions — portfolio is clean
          </span>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title={`Rent cashflow ${data.year}`}
          sub={`Cheque schedule by month — collected so far ${k.collectionYtdRate.toFixed(0)}% of what fell due this year${arrearsOutsideChartFils > 0 ? ` · ${fmtAed(arrearsOutsideChartFils)} arrears from before ${data.year} not shown (see Arrears tile)` : ''}`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={charts.cashflowByMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => fmtAedShort(v)} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={48} />
              <Tooltip formatter={aedTooltip} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
              <Bar dataKey="collectedFils" name="Collected" stackId="m" fill={GREEN} radius={[0, 0, 0, 0]} />
              <Bar dataKey="overdueFils" name="Overdue" stackId="m" fill={RED} />
              {hasBounced && <Bar dataKey="bouncedFils" name="Bounced" stackId="m" fill="#7f1d1d" />}
              <Bar dataKey="upcomingFils" name="Upcoming PDC" stackId="m" fill={AMBER} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Renewals coming up"
          sub="Annual rent on leases reaching their end date — red is the overdue backlog">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={charts.renewalsByMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={48} />
              <YAxis tickFormatter={v => fmtAedShort(v)} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                formatter={aedTooltipAs('Annual rent')}
                labelFormatter={renewalTooltipLabel}
                contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
              <Bar dataKey="annualRentFils" name="Annual rent" radius={[3, 3, 0, 0]}>
                {charts.renewalsByMonth.map((r, i) => (
                  <Cell key={i} fill={r.overdue ? RED : GREEN} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Receivables aging"
          sub="Pending cheques by how overdue they are (upcoming PDCs excluded)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={charts.agingBuckets} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => fmtAedShort(v)} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={48} />
              <Tooltip formatter={aedTooltipAs('Outstanding')} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
              <Bar dataKey="amountFils" name="Outstanding" radius={[3, 3, 0, 0]}>
                {charts.agingBuckets.map((b, i) => (
                  <Cell key={i} fill={['#fbbf24', '#f59e0b', '#ea580c', '#dc2626', '#7f1d1d'][i] ?? AMBER} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Occupancy by property" sub="Occupied vs vacant units per building">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={occData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="short" tick={{ fontSize: 10, fill: '#6b6860' }} axisLine={false} tickLine={false} width={120} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
              <Bar dataKey="occupied" name="Occupied" stackId="o" fill={GREEN} />
              <Bar dataKey="vacant" name="Vacant" stackId="o" fill={GRAY} radius={[0, 3, 3, 0]} />
              {hasMaintenance && <Bar dataKey="maintenance" name="Maintenance" stackId="o" fill={AMBER} />}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
