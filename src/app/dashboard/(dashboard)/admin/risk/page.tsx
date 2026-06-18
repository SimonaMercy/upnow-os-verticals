/**
 * Super-Admin Risk Dashboard (dashboard/admin/risk)
 *
 * "Which RPs are exploiting customers (or about to), and how much customer
 * money is exposed right now?" Live dimensions: DEPOSIT + FAIRNESS, with a
 * per-RP composite watchlist, exposure/alert charts, and drill-down.
 * Amounts are WHOLE AED. Chart style matches reports/ExecutiveOverview.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Wallet, AlertTriangle, Clock, Scissors, Copy, ShieldAlert, ChevronRight,
  ArrowLeft, RefreshCw, Banknote, TrendingUp, UserMinus, Loader2, Pause, Play, Ban,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { apiGet, apiPost, apiPatch } from '@/lib/api';

/* ── Types ── */
type Tier = 'ok' | 'monitor' | 'review' | 'critical';
interface OverviewKpis {
  totalDepositLiabilityAed: number; totalDepositCount: number;
  depositsAtRiskAed: number; depositsAtRiskCount: number; criticalTrapCount: number;
  slowRefundCount: number; excessiveDeductionCount: number; doubleChargeCount: number;
  renewalHikeCount: number; severeHikeCount: number;
  directTerminationCount: number; payingEvictionCount: number;
  rpsOnWatchlist: number; openCriticalAlerts: number;
}
interface LeaderRow {
  rpId: number; name: string; userId: number | null; complianceStatus: string; userStatus: string;
  trapCount: number; trapExposureAed: number; maxTrapDays: number;
  renewalHikeCount: number; directTerminationCount: number; payingEvictionCount: number;
  depositScore: number; fairnessScore: number; compositeScore: number; tier: Tier;
  priorComposite?: number | null; delta?: number | null;
}
interface RpHistory {
  name: string;
  scoreHistory: { date: string; composite: number; deposit: number; fairness: number; lead: number; manager: number; payment: number }[];
  flags: { ruleKey: string; severity: string; dimension: string; exposureAed: number; status: string; firstSeen: string; lastSeen: string; openDays: number }[];
}
interface Overview { generatedAt: string; kpis: OverviewKpis; leaderboard: LeaderRow[]; }
interface TrapRow { depositId: number; contractId: number; rpName: string; amountAed: number; endDate: string; daysOverdue: number; }
interface SlowRefundRow { settlementId: number; contractId: number; rpName: string; refundAed: number; status: string; daysStalled: number; }
interface DeductionRow { settlementId: number; contractId: number; rpName: string; depositHeldAed: number; deductionAed: number; deductionRatio: number; }
interface DoubleChargeRow { contractId: number; rpName: string; depositCount: number; totalAed: number; }
interface DepositAlerts { trap: TrapRow[]; slowRefund: SlowRefundRow[]; excessiveDeduction: DeductionRow[]; doubleCharge: DoubleChargeRow[]; }
interface HikeRow { contractId: number; rpName: string; priorRent: number; newRent: number; hikePct: number; marketPrice: number | null; }
interface EvictionRow { contractId: number; rpName: string; status: string; payingTenant: boolean; paidAed: number; terminationRequestedAt: string | null; }
interface FairnessAlerts { renewalHikes: HikeRow[]; directEvictions: EvictionRow[]; }

/* ── Style constants (match ExecutiveOverview) ── */
const RED = '#dc2626', AMBER = '#d97706', PURPLE = '#7c3aed', GRAY = '#d4d2cc';
const tooltipStyle = { borderRadius: 12, border: '1px solid #e8e6e0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };

function fmtAED(aed: number | null | undefined): string {
  if (aed == null) return '—';
  const a = Math.abs(aed);
  if (a >= 1_000_000) return `AED ${(aed / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `AED ${Math.round(aed / 1_000)}K`;
  return `AED ${Math.round(aed).toLocaleString('en-AE')}`;
}
const aedAxis = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K` : String(v));

const TIER_STYLE: Record<Tier, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#fef2f2', fg: '#b91c1c', label: 'Critical' },
  review: { bg: '#fffbeb', fg: '#b45309', label: 'Review' },
  monitor: { bg: '#f5f4f0', fg: '#6b6860', label: 'Monitor' },
  ok: { bg: '#f0faf6', fg: '#1a7a5a', label: 'OK' },
};

function KpiTile({ icon: Icon, label, value, sub, tone = 'neutral' }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; value: string; sub?: string; tone?: 'neutral' | 'good' | 'bad' | 'warn';
}) {
  const valueCls = tone === 'bad' ? 'text-[#b91c1c]' : tone === 'warn' ? 'text-[#b45309]' : tone === 'good' ? 'text-[#1a7a5a]' : 'text-[#1a1916]';
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
  const s = TIER_STYLE[tier] ?? TIER_STYLE.ok;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: s.bg, color: s.fg }}>{s.label}</span>;
}
function Movement({ delta }: { delta?: number | null }) {
  if (delta == null) return <span className="text-[10px] text-[#9b9890]" title="No prior snapshot">new</span>;
  if (delta === 0) return <span className="text-[10px] text-[#9b9890]">•</span>;
  const up = delta > 0;
  return <span className="text-[10px] font-semibold" title="Change vs last snapshot" style={{ color: up ? '#b91c1c' : '#1a7a5a' }}>{up ? '▲' : '▼'}{Math.abs(delta)}</span>;
}
const RULE_LABEL: Record<string, string> = {
  'deposit.trap': 'Deposit withheld', 'deposit.slow_refund': 'Stalled refund', 'deposit.excessive_deduction': 'Excessive deduction',
  'deposit.double_charge': 'Double-charge', 'fairness.renewal_hike': 'Renewal hike', 'fairness.direct_eviction': 'Direct eviction',
};
const sevColor = (s: string) => (s === 'high' ? RED : s === 'medium' ? AMBER : '#9b9890');

function AlertList<T>({ title, icon: Icon, count, rows, emptyText, render, accent }: {
  title: string; icon: typeof Wallet; count: number; rows: T[];
  emptyText: string; render: (row: T, i: number) => React.ReactNode; accent: string;
}) {
  return (
    <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#f0ede8]">
        <Icon size={14} style={{ color: accent }} />
        <h3 className="font-semibold text-[13px] flex-1 text-[#1a1916]">{title}</h3>
        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: count ? `${accent}1a` : '#f5f4f0', color: count ? accent : '#9b9890' }}>{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-[12px] text-center text-[#9b9890]">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-[#f0ede8] max-h-80 overflow-y-auto">
          {rows.map((r, i) => (<li key={i} className="px-4 py-2.5 text-[12px]">{render(r, i)}</li>))}
        </ul>
      )}
    </div>
  );
}

export default function AdminRiskPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const allowed = user?.role === 'super_admin' || user?.role === 'admin';

  const [overview, setOverview] = useState<Overview | null>(null);
  const [deposits, setDeposits] = useState<DepositAlerts | null>(null);
  const [fairness, setFairness] = useState<FairnessAlerts | null>(null);
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const [history, setHistory] = useState<RpHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const loadOverview = useCallback(() => { apiGet<Overview>('/admin/risk/overview').then(setOverview).catch(() => null); }, []);
  const loadAllAlerts = useCallback(() => {
    apiGet<DepositAlerts>('/admin/risk/deposits').then(setDeposits).catch(() => null);
    apiGet<FairnessAlerts>('/admin/risk/fairness').then(setFairness).catch(() => null);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    Promise.all([
      apiGet<Overview>('/admin/risk/overview').then(setOverview).catch(() => null),
      apiGet<DepositAlerts>('/admin/risk/deposits').then(setDeposits).catch(() => null),
      apiGet<FairnessAlerts>('/admin/risk/fairness').then(setFairness).catch(() => null),
    ]).finally(() => setLoading(false));
  }, [allowed]);

  const selectRp = useCallback((rpId: number, name: string) => {
    setSelected({ id: rpId, name });
    apiGet<{ deposits: DepositAlerts; fairness: FairnessAlerts }>(`/admin/risk/rp/${rpId}`)
      .then((r) => { setDeposits(r.deposits); setFairness(r.fairness); }).catch(() => null);
    setHistory(null);
    apiGet<RpHistory>(`/admin/risk/rp/${rpId}/history`).then(setHistory).catch(() => null);
  }, []);
  const clearRp = useCallback(() => { setSelected(null); setHistory(null); loadAllAlerts(); }, [loadAllAlerts]);
  const recompute = useCallback(async () => {
    setRecomputing(true);
    try { await apiPost('/admin/risk/recompute'); loadOverview(); if (!selected) loadAllAlerts(); }
    catch { /* non-blocking */ } finally { setRecomputing(false); }
  }, [loadOverview, loadAllAlerts, selected]);
  const [busy, setBusy] = useState<number | null>(null);
  const pauseRp = useCallback(async (r: LeaderRow) => {
    const target = r.complianceStatus === 'paused' ? 'compliant' : 'paused';
    if (!window.confirm(`${target === 'paused' ? 'Pause listings for' : 'Resume'} ${r.name}?`)) return;
    setBusy(r.rpId);
    try { await apiPatch(`/admin/kyc/rental-providers/${r.rpId}/compliance`, { complianceStatus: target, complianceNotes: 'Risk dashboard action' }); loadOverview(); }
    catch (e) { window.alert(`Action failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [loadOverview]);
  const suspendRp = useCallback(async (r: LeaderRow) => {
    if (!r.userId) return;
    const target = r.userStatus === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${target === 'suspended' ? 'Suspend' : 'Reactivate'} ${r.name}'s account?`)) return;
    setBusy(r.rpId);
    try { await apiPatch(`/admin/users/${r.userId}/status`, { status: target }); loadOverview(); }
    catch (e) { window.alert(`Action failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [loadOverview]);

  // ── chart data (computed from what we already fetched) ──
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
    const k = overview?.kpis;
    if (!k) return [];
    return [
      { name: 'Trapped', value: k.depositsAtRiskCount, fill: RED },
      { name: 'Paying evict.', value: k.payingEvictionCount, fill: RED },
      { name: 'Excess ded.', value: k.excessiveDeductionCount, fill: AMBER },
      { name: 'Stalled', value: k.slowRefundCount, fill: AMBER },
      { name: 'Renewal hike', value: k.renewalHikeCount, fill: AMBER },
      { name: 'Double-chg', value: k.doubleChargeCount, fill: PURPLE },
    ];
  }, [overview]);

  if (!allowed) {
    return <div className="p-6 max-w-7xl mx-auto"><div className="bg-white rounded-2xl border border-[#e8e6e0] p-10 text-center text-sm text-[#9b9890]">This dashboard is restricted to platform admins.</div></div>;
  }

  const k = overview?.kpis;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-lg font-bold text-[#1a1916]">Risk Dashboard</h1>
          <p className="text-[12px] text-[#9b9890] mt-0.5">Are rental providers supporting customers — or exploiting them? Deposit &amp; contract-fairness oversight.</p>
        </div>
        {isSuperAdmin && (
          <button onClick={recompute} disabled={recomputing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-50 bg-[#f0faf6] text-[#1a7a5a] border border-[#bbe5d6]">
            <RefreshCw size={13} className={recomputing ? 'animate-spin' : ''} />
            {recomputing ? 'Recomputing…' : 'Recompute'}
          </button>
        )}
      </div>

      {loading && !overview ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-10 flex items-center justify-center">
          <Loader2 size={18} className="animate-spin text-[#2e9f82]" /><span className="ml-2 text-sm text-[#6b6860]">Loading risk overview…</span>
        </div>
      ) : (
        <>
          {/* KPI tiles (compact) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
            <KpiTile icon={Wallet} label="Deposits at risk" value={k ? fmtAED(k.depositsAtRiskAed) : '—'} sub={k ? `${k.depositsAtRiskCount} trapped · ${k.criticalTrapCount} over 90d` : ''} tone="bad" />
            <KpiTile icon={UserMinus} label="Paying-tenant evictions" value={k ? String(k.payingEvictionCount) : '—'} sub={k ? `${k.directTerminationCount} direct terminations` : ''} tone={k && k.payingEvictionCount > 0 ? 'bad' : 'neutral'} />
            <KpiTile icon={TrendingUp} label="Renewal hikes" value={k ? String(k.renewalHikeCount) : '—'} sub={k ? `${k.severeHikeCount} severe · above market` : ''} tone={k && k.renewalHikeCount > 0 ? 'warn' : 'neutral'} />
            <KpiTile icon={ShieldAlert} label="RPs on watchlist" value={k ? String(k.rpsOnWatchlist) : '—'} sub="composite score ≥ 60" tone={k && k.rpsOnWatchlist > 0 ? 'warn' : 'neutral'} />
            <KpiTile icon={AlertTriangle} label="Open critical alerts" value={k ? String(k.openCriticalAlerts) : '—'} sub="high-severity, last scan" tone={k && k.openCriticalAlerts > 0 ? 'bad' : 'good'} />
            <KpiTile icon={Banknote} label="Deposit liability" value={k ? fmtAED(k.totalDepositLiabilityAed) : '—'} sub={k ? `${k.totalDepositCount} held / partial` : ''} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <ChartCard title="Customer deposits at risk by age" sub="AED held past a closed lease, bucketed by how overdue the refund is">
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={agingData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={aedAxis} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v: unknown) => [fmtAED(Number(v)), 'At risk'] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                  <Bar dataKey="aed" radius={[4, 4, 0, 0]}>
                    {agingData.map((d, i) => (<Cell key={i} fill={d.bucket === '90d+' ? RED : AMBER} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Risk alerts by type" sub="Open findings across the deposit & fairness dimensions">
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={alertMix} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip formatter={(v: unknown) => [String(v), 'Alerts'] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {alertMix.map((d, i) => (<Cell key={i} fill={d.fill} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Watchlist */}
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-[#1a1916]">Rental-provider risk watchlist</h2>
            {overview && <span className="text-[11px] text-[#9b9890]">Updated {new Date(overview.generatedAt).toLocaleString('en-AE')}</span>}
          </div>
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mb-6">
            {!overview || overview.leaderboard.length === 0 ? (
              <p className="px-4 py-8 text-[13px] text-center text-[#9b9890]">No risk signals across any rental provider. 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[#9b9890] bg-[#faf9f7] text-[11px]">
                      <th className="text-left font-semibold px-4 py-2">Rental provider</th>
                      <th className="text-center font-semibold px-3 py-2">Tier</th>
                      <th className="text-right font-semibold px-3 py-2">Score</th>
                      <th className="text-right font-semibold px-3 py-2">Trapped</th>
                      <th className="text-right font-semibold px-3 py-2">At risk</th>
                      <th className="text-right font-semibold px-3 py-2">Hikes</th>
                      <th className="text-right font-semibold px-3 py-2">Evictions</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {overview.leaderboard.map((r) => (
                      <tr key={r.rpId} onClick={() => selectRp(r.rpId, r.name)} className="cursor-pointer transition-colors hover:bg-[#faf9f7] border-t border-[#f0ede8]">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-[#1a1916]">{r.name}</div>
                          <div className="text-[11px] capitalize text-[#9b9890]">{r.complianceStatus.replace(/_/g, ' ')}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center"><TierBadge tier={r.tier} /></td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="font-bold text-[#1a1916] leading-none">{r.compositeScore}</div>
                          <div className="mt-0.5"><Movement delta={r.delta} /></div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-[#3f3d39]">{r.trapCount > 0 ? `${r.trapCount}${r.maxTrapDays >= 90 ? ' ⚠' : ''}` : '—'}</td>
                        <td className="px-3 py-2.5 text-right text-[#3f3d39]">{r.trapExposureAed ? fmtAED(r.trapExposureAed) : '—'}</td>
                        <td className="px-3 py-2.5 text-right text-[#3f3d39]">{r.renewalHikeCount || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-medium" style={{ color: r.payingEvictionCount ? RED : '#3f3d39' }}>{r.payingEvictionCount || (r.directTerminationCount ? `0/${r.directTerminationCount}` : '—')}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {isSuperAdmin && (
                              <>
                                <button title={r.complianceStatus === 'paused' ? 'Resume listings' : 'Pause listings'} onClick={(e) => { e.stopPropagation(); void pauseRp(r); }} disabled={busy === r.rpId}
                                  className="p-1.5 rounded-lg border border-[#e8e6e0] hover:bg-[#fffbeb] disabled:opacity-40">
                                  {r.complianceStatus === 'paused' ? <Play size={13} className="text-[#1a7a5a]" /> : <Pause size={13} className="text-[#b45309]" />}
                                </button>
                                <button title={r.userStatus === 'suspended' ? 'Reactivate account' : 'Suspend account'} onClick={(e) => { e.stopPropagation(); void suspendRp(r); }} disabled={busy === r.rpId || !r.userId}
                                  className="p-1.5 rounded-lg border border-[#e8e6e0] hover:bg-[#fef2f2] disabled:opacity-40">
                                  <Ban size={13} className={r.userStatus === 'suspended' ? 'text-[#1a7a5a]' : 'text-[#b91c1c]'} />
                                </button>
                              </>
                            )}
                            <ChevronRight size={15} className="text-[#d4d2cc]" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Alerts */}
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-[#1a1916]">{selected ? `Alerts — ${selected.name}` : 'Risk alerts'}</h2>
            {selected && <button onClick={clearRp} className="flex items-center gap-1 text-[12px] font-semibold text-[#2e9f82]"><ArrowLeft size={13} /> All providers</button>}
          </div>

          {/* Per-RP risk intelligence: score history + flag timeline */}
          {selected && history && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
              <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
                <h3 className="text-sm font-bold text-[#1a1916]">Risk score over time</h3>
                <p className="text-[11px] text-[#9b9890] mt-0.5 mb-1">{history.scoreHistory.length <= 1 ? 'one snapshot so far — builds daily' : 'composite, by daily snapshot'}</p>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={history.scoreHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="compHist" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={RED} stopOpacity={0.25} /><stop offset="100%" stopColor={RED} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => [String(v), 'Composite'] as [string, string]} />
                    <Area type="monotone" dataKey="composite" stroke={RED} strokeWidth={2} fill="url(#compHist)" dot={{ r: 3, fill: RED }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#f0ede8]"><h3 className="text-sm font-bold text-[#1a1916]">Flag timeline</h3></div>
                {history.flags.length === 0 ? (
                  <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">No flags on record.</p>
                ) : (
                  <ul className="divide-y divide-[#f0ede8] max-h-48 overflow-y-auto">
                    {history.flags.map((f, i) => (
                      <li key={i} className="px-4 py-2 flex items-center justify-between gap-3 text-[12px]">
                        <div className="min-w-0">
                          <div className="font-semibold truncate" style={{ color: sevColor(f.severity) }}>{RULE_LABEL[f.ruleKey] ?? f.ruleKey}</div>
                          <div className="text-[11px] text-[#9b9890]">first seen {new Date(f.firstSeen).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE })} · open {f.openDays}d</div>
                        </div>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize flex-shrink-0" style={{ backgroundColor: f.status === 'resolved' ? '#ecfdf5' : f.status === 'acknowledged' ? '#f5f4f0' : `${sevColor(f.severity)}1a`, color: f.status === 'resolved' ? '#047857' : f.status === 'acknowledged' ? '#6b6860' : sevColor(f.severity) }}>{f.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2 text-[#9b9890]">Deposits</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
            <AlertList title="Trapped deposits" icon={Wallet} accent={RED} count={deposits?.trap.length ?? 0} rows={deposits?.trap ?? []} emptyText="No deposits held past a closed lease."
              render={(r: TrapRow) => (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold truncate text-[#1a1916]">{r.rpName}</div><div className="text-[11px] text-[#9b9890]">Contract #{r.contractId} · ended {new Date(r.endDate).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE })}</div></div>
                  <div className="text-right flex-shrink-0"><div className="font-bold text-[#b91c1c]">{fmtAED(r.amountAed)}</div><div className="text-[11px]" style={{ color: r.daysOverdue >= 90 ? RED : '#9b9890' }}>{r.daysOverdue}d overdue</div></div>
                </div>
              )} />
            <AlertList title="Stalled refunds" icon={Clock} accent={AMBER} count={deposits?.slowRefund.length ?? 0} rows={deposits?.slowRefund ?? []} emptyText="No settlements stalled past SLA."
              render={(r: SlowRefundRow) => (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold truncate text-[#1a1916]">{r.rpName}</div><div className="text-[11px] capitalize text-[#9b9890]">Contract #{r.contractId} · {r.status}</div></div>
                  <div className="text-right flex-shrink-0"><div className="font-bold text-[#1a1916]">{fmtAED(r.refundAed)}</div><div className="text-[11px] text-[#9b9890]">{r.daysStalled}d stalled</div></div>
                </div>
              )} />
            <AlertList title="Excessive deductions" icon={Scissors} accent={RED} count={deposits?.excessiveDeduction.length ?? 0} rows={deposits?.excessiveDeduction ?? []} emptyText="No settlements with outsized damage deductions."
              render={(r: DeductionRow) => (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold truncate text-[#1a1916]">{r.rpName}</div><div className="text-[11px] text-[#9b9890]">Contract #{r.contractId} · {fmtAED(r.deductionAed)} of {fmtAED(r.depositHeldAed)}</div></div>
                  <div className="text-right flex-shrink-0"><div className="font-bold text-[#b91c1c]">{r.deductionRatio}%</div><div className="text-[11px] text-[#9b9890]">deducted</div></div>
                </div>
              )} />
            <AlertList title="Possible double-charges" icon={Copy} accent={PURPLE} count={deposits?.doubleCharge.length ?? 0} rows={deposits?.doubleCharge ?? []} emptyText="No contracts with duplicate live deposits."
              render={(r: DoubleChargeRow) => (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold truncate text-[#1a1916]">{r.rpName}</div><div className="text-[11px] text-[#9b9890]">Contract #{r.contractId} · {r.depositCount} deposits on file</div></div>
                  <div className="text-right flex-shrink-0"><div className="font-bold text-[#1a1916]">{fmtAED(r.totalAed)}</div><div className="text-[11px] text-[#9b9890]">total held</div></div>
                </div>
              )} />
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2 text-[#9b9890]">Contract fairness</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <AlertList title="Direct termination of paying tenants" icon={UserMinus} accent={RED} count={fairness?.directEvictions.length ?? 0} rows={fairness?.directEvictions ?? []} emptyText="No direct (no-consent) terminations."
              render={(r: EvictionRow) => (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold truncate text-[#1a1916]">{r.rpName}</div><div className="text-[11px] capitalize text-[#9b9890]">Contract #{r.contractId} · {r.status}{r.terminationRequestedAt ? ` · ${new Date(r.terminationRequestedAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE })}` : ''}</div></div>
                  <div className="text-right flex-shrink-0">{r.payingTenant ? (<><div className="font-bold text-[#b91c1c]">Paying</div><div className="text-[11px] text-[#9b9890]">{fmtAED(r.paidAed)} paid</div></>) : (<div className="text-[11px] text-[#9b9890]">no payments</div>)}</div>
                </div>
              )} />
            <AlertList title="Abusive renewal hikes" icon={TrendingUp} accent={AMBER} count={fairness?.renewalHikes.length ?? 0} rows={fairness?.renewalHikes ?? []} emptyText="No above-market renewal hikes."
              render={(r: HikeRow) => (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold truncate text-[#1a1916]">{r.rpName}</div><div className="text-[11px] text-[#9b9890]">Contract #{r.contractId} · {fmtAED(r.priorRent)} → {fmtAED(r.newRent)}{r.marketPrice ? ` · mkt ${fmtAED(r.marketPrice)}` : ''}</div></div>
                  <div className="text-right flex-shrink-0"><div className="font-bold text-[#b45309]">+{r.hikePct}%</div></div>
                </div>
              )} />
          </div>

          <p className="text-[11px] mt-5 text-[#9b9890]">Live dimensions: deposit + contract fairness. Manager-oversight and lead-responsiveness land next.</p>
        </>
      )}
    </div>
  );
}
