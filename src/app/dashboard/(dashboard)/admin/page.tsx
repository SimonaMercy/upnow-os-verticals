/**
 * Admin — Decision Dashboard (dashboard/admin)
 *
 * The super-admin's landing: the decisions that matter, up front —
 *   1. Customer money at risk (trapped/withheld deposits)
 *   2. RPs to act on (composite risk watchlist)
 *   3. Customer-harm events (paying-tenant evictions, abusive hikes, excessive deductions, long-withheld deposits)
 *   4. Platform-health trend (from nightly risk snapshots)
 * …plus the platform stats (users / KYC). Full alert lists + per-RP drill-down
 * live on the Risk board (/dashboard/admin/risk). Amounts are WHOLE AED.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  Wallet, ShieldAlert, UserMinus, AlertTriangle, Users, ShieldCheck, Banknote,
  TrendingUp, Scissors, ChevronRight, Loader2, ArrowUpRight,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { apiGet } from '@/lib/api';

/* ── Types ── */
type Tier = 'ok' | 'monitor' | 'review' | 'critical';
interface AdminStats { totalUsers: number; kycPending: number; activeUsers: number; suspendedUsers: number; }
interface OverviewKpis {
  totalDepositLiabilityAed: number; totalDepositCount: number;
  depositsAtRiskAed: number; depositsAtRiskCount: number; criticalTrapCount: number;
  slowRefundCount: number; excessiveDeductionCount: number; doubleChargeCount: number;
  renewalHikeCount: number; severeHikeCount: number;
  directTerminationCount: number; payingEvictionCount: number;
  rpsOnWatchlist: number; openCriticalAlerts: number;
}
interface LeaderRow {
  rpId: number; name: string; complianceStatus: string;
  trapCount: number; trapExposureAed: number; maxTrapDays: number;
  renewalHikeCount: number; directTerminationCount: number; payingEvictionCount: number;
  compositeScore: number; tier: Tier;
}
interface Overview { generatedAt: string; kpis: OverviewKpis; leaderboard: LeaderRow[]; }
interface TrapRow { contractId: number; rpName: string; amountAed: number; endDate: string; daysOverdue: number; }
interface DeductionRow { contractId: number; rpName: string; deductionAed: number; deductionRatio: number; }
interface DepositAlerts { trap: TrapRow[]; excessiveDeduction: DeductionRow[]; }
interface HikeRow { contractId: number; rpName: string; priorRent: number; newRent: number; hikePct: number; }
interface EvictionRow { contractId: number; rpName: string; payingTenant: boolean; paidAed: number; }
interface FairnessAlerts { renewalHikes: HikeRow[]; directEvictions: EvictionRow[]; }
interface TrendPoint { date: string; watchlist: number; atRiskAed: number; payingEvictions: number; avgScore: number; }

/* ── Style ── */
const RED = '#dc2626', AMBER = '#d97706', PURPLE = '#7c3aed', GREEN = '#2e9f82';
const tooltipStyle = { borderRadius: 12, border: '1px solid #e8e6e0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };
function fmtAED(aed: number | null | undefined): string {
  if (aed == null) return '—';
  const a = Math.abs(aed);
  if (a >= 1_000_000) return `AED ${(aed / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `AED ${Math.round(aed / 1_000)}K`;
  return `AED ${Math.round(aed).toLocaleString('en-AE')}`;
}
const aedAxis = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K` : String(v));
const TIER: Record<Tier, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#fef2f2', fg: '#b91c1c', label: 'Critical' },
  review: { bg: '#fffbeb', fg: '#b45309', label: 'Review' },
  monitor: { bg: '#f5f4f0', fg: '#6b6860', label: 'Monitor' },
  ok: { bg: '#f0faf6', fg: '#1a7a5a', label: 'OK' },
};

function KpiTile({ icon: Icon, label, value, sub, tone = 'neutral', href }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; value: string; sub?: string; tone?: 'neutral' | 'good' | 'bad' | 'warn'; href?: string;
}) {
  const vc = tone === 'bad' ? 'text-[#b91c1c]' : tone === 'warn' ? 'text-[#b45309]' : tone === 'good' ? 'text-[#1a7a5a]' : 'text-[#1a1916]';
  const body = (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3.5 h-full hover:border-[#d4d2cc] transition-colors">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold"><Icon size={12} /> {label}</div>
      <p className={`text-xl font-bold mt-1.5 leading-none ${vc}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#9b9890] mt-1.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
      <h3 className="text-sm font-bold text-[#1a1916]">{title}</h3>
      {sub && <p className="text-[11px] text-[#9b9890] mt-0.5 mb-1">{sub}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER[tier] ?? TIER.ok;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: s.bg, color: s.fg }}>{s.label}</span>;
}

interface HarmEvent { kind: string; rpName: string; detail: string; value: string; color: string; sev: number; }

export default function AdminDecisionDashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [deposits, setDeposits] = useState<DepositAlerts | null>(null);
  const [fairness, setFairness] = useState<FairnessAlerts | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<AdminStats>('/admin/stats').then(setStats).catch(() => null);
    setLoading(true);
    Promise.all([
      apiGet<Overview>('/admin/risk/overview').then(setOverview).catch(() => null),
      apiGet<DepositAlerts>('/admin/risk/deposits').then(setDeposits).catch(() => null),
      apiGet<FairnessAlerts>('/admin/risk/fairness').then(setFairness).catch(() => null),
      apiGet<{ points: TrendPoint[] }>('/admin/risk/trend').then((t) => setTrend(t.points)).catch(() => null),
    ]).finally(() => setLoading(false));
  }, []);

  const k = overview?.kpis;

  const agingData = useMemo(() => {
    const b = [{ bucket: '31–60d', aed: 0 }, { bucket: '61–90d', aed: 0 }, { bucket: '90d+', aed: 0 }];
    for (const t of deposits?.trap ?? []) {
      if (t.daysOverdue > 90) b[2].aed += t.amountAed;
      else if (t.daysOverdue > 60) b[1].aed += t.amountAed;
      else b[0].aed += t.amountAed;
    }
    return b;
  }, [deposits]);

  const alertMix = useMemo(() => {
    if (!k) return [];
    return [
      { name: 'Trapped', value: k.depositsAtRiskCount, fill: RED },
      { name: 'Paying evict.', value: k.payingEvictionCount, fill: RED },
      { name: 'Excess ded.', value: k.excessiveDeductionCount, fill: AMBER },
      { name: 'Stalled', value: k.slowRefundCount, fill: AMBER },
      { name: 'Renewal hike', value: k.renewalHikeCount, fill: AMBER },
      { name: 'Double-chg', value: k.doubleChargeCount, fill: PURPLE },
    ];
  }, [k]);

  const harmEvents = useMemo<HarmEvent[]>(() => {
    const ev: HarmEvent[] = [];
    for (const e of fairness?.directEvictions ?? []) if (e.payingTenant)
      ev.push({ kind: 'Paying-tenant eviction', rpName: e.rpName, detail: `Contract #${e.contractId}`, value: `${fmtAED(e.paidAed)} paid`, color: RED, sev: 3 });
    for (const d of deposits?.excessiveDeduction ?? [])
      ev.push({ kind: 'Excessive deduction', rpName: d.rpName, detail: `Contract #${d.contractId}`, value: `${d.deductionRatio}% of deposit`, color: RED, sev: 3 });
    for (const h of fairness?.renewalHikes ?? [])
      ev.push({ kind: 'Above-market renewal hike', rpName: h.rpName, detail: `Contract #${h.contractId} · ${fmtAED(h.priorRent)}→${fmtAED(h.newRent)}`, value: `+${h.hikePct}%`, color: AMBER, sev: 2 });
    for (const t of deposits?.trap ?? []) if (t.daysOverdue >= 90)
      ev.push({ kind: 'Deposit withheld', rpName: t.rpName, detail: `Contract #${t.contractId}`, value: `${fmtAED(t.amountAed)} · ${t.daysOverdue}d`, color: RED, sev: 3 });
    return ev.sort((a, b) => b.sev - a.sev).slice(0, 10);
  }, [deposits, fairness]);

  const topRps = (overview?.leaderboard ?? []).slice(0, 6);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-lg font-bold text-[#1a1916]">{isSuperAdmin ? 'Super Admin Dashboard' : 'Admin Dashboard'}</h1>
          <p className="text-[12px] text-[#9b9890] mt-0.5">Customer money at risk, rental providers to act on, and the harm events behind them.</p>
        </div>
        <Link href="/dashboard/admin/risk" className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-[#f0faf6] text-[#1a7a5a] border border-[#bbe5d6] hover:border-[#2e9f82] transition-colors flex-shrink-0">
          Full risk board <ArrowUpRight size={13} />
        </Link>
      </div>

      {loading && !overview ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-10 flex items-center justify-center">
          <Loader2 size={18} className="animate-spin text-[#2e9f82]" /><span className="ml-2 text-sm text-[#6b6860]">Loading…</span>
        </div>
      ) : (
        <>
          {/* Decision KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <KpiTile icon={Wallet} label="Customer deposits at risk" value={k ? fmtAED(k.depositsAtRiskAed) : '—'} sub={k ? `${k.depositsAtRiskCount} trapped · ${k.criticalTrapCount} over 90d` : ''} tone="bad" href="/dashboard/admin/risk" />
            <KpiTile icon={ShieldAlert} label="RPs to act on" value={k ? String(k.rpsOnWatchlist) : '—'} sub="composite risk score ≥ 60" tone={k && k.rpsOnWatchlist > 0 ? 'warn' : 'good'} href="/dashboard/admin/risk" />
            <KpiTile icon={UserMinus} label="Paying-tenant evictions" value={k ? String(k.payingEvictionCount) : '—'} sub={k ? `${k.directTerminationCount} direct terminations` : ''} tone={k && k.payingEvictionCount > 0 ? 'bad' : 'neutral'} href="/dashboard/admin/risk" />
            <KpiTile icon={AlertTriangle} label="Open critical alerts" value={k ? String(k.openCriticalAlerts) : '—'} sub={k ? `${k.severeHikeCount} severe hikes · ${k.excessiveDeductionCount} deductions` : ''} tone={k && k.openCriticalAlerts > 0 ? 'bad' : 'good'} href="/dashboard/admin/risk" />
          </div>

          {/* Platform stats (secondary) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <KpiTile icon={Banknote} label="Deposit liability" value={k ? fmtAED(k.totalDepositLiabilityAed) : '—'} sub={k ? `${k.totalDepositCount} held / partial` : ''} />
            <KpiTile icon={Users} label="Total users" value={stats ? String(stats.totalUsers) : '—'} sub={stats ? `${stats.activeUsers} active` : ''} />
            <KpiTile icon={ShieldCheck} label="KYC pending" value={stats ? String(stats.kycPending) : '—'} sub="awaiting review" tone={stats && stats.kycPending > 0 ? 'warn' : 'neutral'} />
            <KpiTile icon={AlertTriangle} label="Suspended" value={stats ? String(stats.suspendedUsers) : '—'} sub="accounts" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
            <ChartCard title="Deposits at risk by age" sub="AED held past a closed lease">
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={agingData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={aedAxis} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip formatter={(v: unknown) => [fmtAED(Number(v)), 'At risk'] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                  <Bar dataKey="aed" radius={[4, 4, 0, 0]}>{agingData.map((d, i) => (<Cell key={i} fill={d.bucket === '90d+' ? RED : AMBER} />))}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Risk alerts by type" sub="open findings, all dimensions">
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={alertMix} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9b9890' }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={26} />
                  <Tooltip formatter={(v: unknown) => [String(v), 'Alerts'] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>{alertMix.map((d, i) => (<Cell key={i} fill={d.fill} />))}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Platform health trend" sub={trend.length <= 1 ? 'builds daily from the nightly scan' : 'AED at risk over time'}>
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="atRisk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={RED} stopOpacity={0.3} /><stop offset="100%" stopColor={RED} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={aedAxis} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip formatter={(v: unknown) => [fmtAED(Number(v)), 'At risk'] as [string, string]} contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="atRiskAed" stroke={RED} strokeWidth={2} fill="url(#atRisk)" dot={{ r: 3, fill: RED }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* RPs to act on + Customer-harm events */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#f0ede8]">
                <h2 className="text-[13px] font-bold text-[#1a1916]">Rental providers to act on</h2>
                <Link href="/dashboard/admin/risk" className="text-[11px] font-semibold text-[#2e9f82]">View all</Link>
              </div>
              {topRps.length === 0 ? (
                <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">No rental providers on the watchlist. 🎉</p>
              ) : (
                <table className="w-full text-[12px]">
                  <tbody>
                    {topRps.map((r) => (
                      <tr key={r.rpId} className="border-t border-[#f0ede8] first:border-t-0">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-[#1a1916]">{r.name}</div>
                          <div className="text-[11px] text-[#9b9890]">
                            {[r.trapCount ? `${r.trapCount} trapped` : '', r.payingEvictionCount ? `${r.payingEvictionCount} paying eviction${r.payingEvictionCount === 1 ? '' : 's'}` : '', r.renewalHikeCount ? `${r.renewalHikeCount} hike${r.renewalHikeCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'flagged'}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-[#9b9890]">{r.trapExposureAed ? fmtAED(r.trapExposureAed) : ''}</td>
                        <td className="px-3 py-2.5 text-center w-20"><TierBadge tier={r.tier} /></td>
                        <td className="px-3 py-2.5 text-right font-bold text-[#1a1916] w-10">{r.compositeScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#f0ede8]"><h2 className="text-[13px] font-bold text-[#1a1916]">Customer-harm events</h2></div>
              {harmEvents.length === 0 ? (
                <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">No customer-harm events detected.</p>
              ) : (
                <ul className="divide-y divide-[#f0ede8] max-h-96 overflow-y-auto">
                  {harmEvents.map((e, i) => (
                    <li key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 text-[12px]">
                      <div className="min-w-0">
                        <div className="font-semibold truncate" style={{ color: e.color }}>{e.kind}</div>
                        <div className="text-[11px] text-[#9b9890] truncate">{e.rpName} · {e.detail}</div>
                      </div>
                      <div className="text-[11px] font-semibold text-[#3f3d39] flex-shrink-0 text-right">{e.value}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {overview && <p className="text-[11px] mt-4 text-[#9b9890]">Risk last scanned {new Date(overview.generatedAt).toLocaleString('en-AE')} · deposit + contract-fairness dimensions live. <Link href="/dashboard/admin/risk" className="text-[#2e9f82] font-semibold">Open the full risk board →</Link></p>}
        </>
      )}
    </div>
  );
}
