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
import Link from 'next/link';
import {
  Wallet, AlertTriangle, Clock, Scissors, Copy, ShieldAlert, ChevronRight,
  ArrowLeft, RefreshCw, Banknote, TrendingUp, UserMinus, Loader2, Pause, Play, Ban,
  Users, Trophy, Building2,
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
interface Flag {
  id: number; actorName: string; ruleKey: string; severity: 'high' | 'medium' | 'low';
  dimension: string; exposureAed: number; detail: Record<string, unknown>; status: string;
}
interface ManagerRow {
  userId: number; name: string; email: string; lastLoginAt: string | null; landlordCount: number;
  flags: { deposits: boolean; collections: boolean; financials: boolean; signDocs: boolean; poa: boolean; createContracts: boolean; inviteManager: boolean };
  moneyPower: boolean; dormant: boolean; tier: Tier;
}
interface ManagerData { summary: Record<string, number>; managers: ManagerRow[] }
interface LeadData {
  totalLeads: number;
  summary: { stale: number; ghosted: number; frtBreaches: number; poaching: number };
  frtBreaches: { leadId: number; rpName: string; customerName: string | null; ageHours: number }[];
  stale: { leadId: number; rpName: string; stage: string; customerName: string | null; staleDays: number }[];
}
interface PaymentData {
  summary: { arrears: number; vatOvercharge: number; bounceClusters: number; orphanPayments: number };
  arrears: { contractId: number; rpName: string; overdueCheques: number; overdueAed: number; oldestDays: number }[];
}
interface JourneyData {
  funnel: { stage: string; count: number }[];
  activeContracts: number;
  stalls: { stuckPending: number; kycIncomplete: number; moveInMissing: number; noPortalLink: number };
  byRp: { rpId: number; name: string; stuckPending: number; kycIncomplete: number; moveInMissing: number; noPortalLink: number; total: number }[];
}
interface ContribRow {
  rpId: number; name: string; userId: number | null;
  properties: number; units: number; activeLeases: number; contractsTotal: number;
  rentRollAed: number; tenants: number; occupancyPct: number | null;
  rentRollSharePct: number; unitsSharePct: number; leaseSharePct: number;
}
interface Contribution {
  generatedAt: string;
  totals: { rps: number; properties: number; units: number; activeLeases: number; contractsTotal: number; rentRollAed: number; tenants: number; occupancyPct: number | null };
  rows: ContribRow[];
}

/* ── Style constants (match ExecutiveOverview) ── */
const RED = '#dc2626', AMBER = '#d97706', PURPLE = '#7c3aed', GRAY = '#d4d2cc', GREEN = '#2e9f82';
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

function Chip({ c, children }: { c: string; children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: `${c}1a`, color: c }}>{children}</span>;
}
function shortName(n: string): string {
  const parts = n.trim().split(/\s+/);
  return parts.length <= 2 ? n : `${parts[0]} ${parts[1]}`;
}
function flagDetailText(f: Flag): string {
  const d = (f.detail || {}) as Record<string, unknown>;
  if (f.ruleKey === 'deposit.trap') return `Contract #${d.contractId ?? '—'} · ${d.daysOverdue ?? '?'}d overdue`;
  if (f.ruleKey === 'fairness.direct_eviction') return d.payingTenant ? 'paying tenant' : 'no payments';
  if (f.ruleKey === 'fairness.renewal_hike') return `+${d.hikePct ?? '?'}%`;
  if (f.ruleKey === 'deposit.excessive_deduction') return `${d.ratio ?? '?'}% of deposit`;
  return f.dimension;
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
  const [flags, setFlags] = useState<Flag[]>([]);
  const [mgr, setMgr] = useState<ManagerData | null>(null);
  const [leadData, setLeadData] = useState<LeadData | null>(null);
  const [payData, setPayData] = useState<PaymentData | null>(null);
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [contrib, setContrib] = useState<Contribution | null>(null);

  const loadOverview = useCallback(() => { apiGet<Overview>('/admin/risk/overview').then(setOverview).catch(() => null); }, []);
  const loadFlags = useCallback(() => { apiGet<{ flags: Flag[] }>('/admin/risk/flags').then((r) => setFlags(r.flags)).catch(() => null); }, []);
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
      loadFlags(),
      apiGet<ManagerData>('/admin/risk/managers').then(setMgr).catch(() => null),
      apiGet<LeadData>('/admin/risk/leads').then(setLeadData).catch(() => null),
      apiGet<PaymentData>('/admin/risk/payments').then(setPayData).catch(() => null),
      apiGet<JourneyData>('/admin/risk/customer-journey').then(setJourney).catch(() => null),
      apiGet<Contribution>('/admin/risk/contribution').then(setContrib).catch(() => null),
    ]).finally(() => setLoading(false));
  }, [allowed, loadFlags]);

  async function resolveFlag(id: number, status: 'acknowledged' | 'resolved') {
    setFlags((fs) => fs.filter((f) => f.id !== id)); // optimistic
    try { await apiPatch(`/admin/risk/flags/${id}`, { status }); }
    catch { loadFlags(); }
  }

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

  const contribChart = useMemo(
    () => (contrib?.rows ?? []).slice(0, 8).map((r) => ({ name: shortName(r.name), aed: r.rentRollAed })),
    [contrib],
  );

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

          {/* ════════ Oversight & operations ════════ */}
          <div className="flex items-center gap-2 mt-7 mb-1">
            <span className="h-px flex-1 bg-[#e8e6e0]" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-[#9b9890]">Oversight &amp; operations</span>
            <span className="h-px flex-1 bg-[#e8e6e0]" />
          </div>

          {/* Customer-harm events */}
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mt-4">
            <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[#1a1916]">Customer-harm events</h2>
                <p className="text-[11px] text-[#9b9890]">The specific deposit &amp; fairness incidents behind the scores — Ack when reviewed, Resolve when handled.</p>
              </div>
              <span className="text-[11px] text-[#9b9890] flex-shrink-0 mt-0.5">{flags.length} open</span>
            </div>
            {flags.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">No open risk flags. 🎉</p>
            ) : (
              <ul className="divide-y divide-[#f0ede8] max-h-96 overflow-y-auto">
                {flags.map((f) => (
                  <li key={f.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-[12px]">
                    <div className="min-w-0">
                      <div className="font-semibold truncate" style={{ color: sevColor(f.severity) }}>{RULE_LABEL[f.ruleKey] ?? f.ruleKey}</div>
                      <div className="text-[11px] text-[#9b9890] truncate">{f.actorName} · {flagDetailText(f)}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {f.exposureAed > 0 && <span className="text-[11px] font-semibold text-[#3f3d39] mr-1">{fmtAED(f.exposureAed)}</span>}
                      <button title="Acknowledge" onClick={() => resolveFlag(f.id, 'acknowledged')} className="px-2 py-1 rounded-md border border-[#e8e6e0] text-[10px] font-semibold text-[#6b6860] hover:bg-[#f5f4f0]">Ack</button>
                      <button title="Resolve" onClick={() => resolveFlag(f.id, 'resolved')} className="px-2 py-1 rounded-md text-[10px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: GREEN }}>Resolve</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Manager oversight */}
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mt-4">
            <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[#1a1916] flex items-center gap-1.5"><Users size={14} className="text-[#2e9f82]" /> Manager oversight</h2>
                <p className="text-[11px] text-[#9b9890]">Money/signature power each delegated manager holds — a dormant, escalating or POA manager raises that RP&apos;s score above.</p>
              </div>
              {mgr && (
                <span className="text-[11px] text-[#9b9890] text-right flex-shrink-0 mt-0.5">
                  {mgr.summary.total} managers · {mgr.summary.withMoneyPower} hold money/signature power · {mgr.summary.dormantWithMoney} dormant-with-power · {mgr.summary.escalations} escalations
                </span>
              )}
            </div>
            {!mgr || mgr.managers.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">No delegated managers.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[#9b9890] bg-[#faf9f7] text-[11px]">
                      <th className="text-left font-semibold px-4 py-2">Manager</th>
                      <th className="text-center font-semibold px-3 py-2">RPs</th>
                      <th className="text-left font-semibold px-3 py-2">Powers held</th>
                      <th className="text-right font-semibold px-3 py-2">Last login</th>
                      <th className="text-center font-semibold px-3 py-2">Tier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mgr.managers.map((m) => (
                      <tr key={m.userId} className="border-t border-[#f0ede8]">
                        <td className="px-4 py-2.5"><div className="font-semibold text-[#1a1916]">{m.name}</div><div className="text-[11px] text-[#9b9890]">{m.email}</div></td>
                        <td className="px-3 py-2.5 text-center text-[#3f3d39]">{m.landlordCount}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {m.flags.poa && <Chip c={RED}>POA</Chip>}
                            {m.flags.signDocs && <Chip c={RED}>Sign</Chip>}
                            {m.flags.deposits && <Chip c={AMBER}>Deposits</Chip>}
                            {m.flags.collections && <Chip c={AMBER}>Collections</Chip>}
                            {m.flags.financials && <Chip c="#6b6860">Financials</Chip>}
                            {m.flags.createContracts && <Chip c="#6b6860">Contracts</Chip>}
                            {m.flags.inviteManager && <Chip c={PURPLE}>Invite</Chip>}
                            {!m.moneyPower && <span className="text-[11px] text-[#9b9890]">view-only</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-[11px]" style={{ color: m.dormant ? RED : '#9b9890' }}>{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE }) : 'never'}</td>
                        <td className="px-3 py-2.5 text-center"><TierBadge tier={m.tier} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Lead responsiveness */}
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mt-4">
            <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[#1a1916]">Lead responsiveness</h2>
                <p className="text-[11px] text-[#9b9890]">How quickly leads are attended &amp; followed up — slow/ghosted leads and poaching raise that RP&apos;s score above.</p>
              </div>
              {leadData && <span className="text-[11px] text-[#9b9890] flex-shrink-0 mt-0.5">{leadData.totalLeads} leads tracked</span>}
            </div>
            {!leadData || leadData.totalLeads === 0 ? (
              <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">No leads in the system yet — slow first-response, stale-lead, ghosting and lead-poaching detectors activate automatically once leads start flowing.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
                  {[
                    { label: 'Slow first response', value: leadData.summary.frtBreaches, tone: 'bad' as const },
                    { label: 'Stale leads', value: leadData.summary.stale, tone: 'warn' as const },
                    { label: 'Ghosted warm leads', value: leadData.summary.ghosted, tone: 'warn' as const },
                    { label: 'Possible poaching', value: leadData.summary.poaching, tone: 'bad' as const },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-[#e8e6e0] px-3 py-2.5">
                      <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{s.label}</div>
                      <div className="text-lg font-bold mt-1" style={{ color: s.value > 0 ? (s.tone === 'bad' ? '#b91c1c' : '#b45309') : '#1a7a5a' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {leadData.frtBreaches.length > 0 && (
                  <ul className="divide-y divide-[#f0ede8] border-t border-[#f0ede8] max-h-60 overflow-y-auto">
                    {leadData.frtBreaches.slice(0, 8).map((l) => (
                      <li key={l.leadId} className="px-4 py-2 flex items-center justify-between text-[12px]">
                        <span className="truncate"><span className="font-semibold text-[#1a1916]">{l.customerName || `Lead #${l.leadId}`}</span> <span className="text-[#9b9890]">· {l.rpName}</span></span>
                        <span className="text-[11px] font-semibold text-[#b91c1c] flex-shrink-0">no response · {Math.round(l.ageHours)}h</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Payment & financial integrity */}
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mt-4">
            <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[#1a1916]">Payment &amp; financial integrity</h2>
                <p className="text-[11px] text-[#9b9890]">Rent arrears on active leases, residential VAT overcharge, bounced-cheque clustering, orphan payments — feeds each RP&apos;s score.</p>
              </div>
              {payData && (
                <span className="text-[11px] text-[#9b9890] text-right flex-shrink-0 mt-0.5">
                  {payData.summary.arrears} in arrears · {payData.summary.vatOvercharge} VAT · {payData.summary.bounceClusters} bounce · {payData.summary.orphanPayments} orphan
                </span>
              )}
            </div>
            {!payData || payData.arrears.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">No payment-integrity issues detected (no arrears, VAT overcharge, bounce clusters or orphan payments).</p>
            ) : (
              <ul className="divide-y divide-[#f0ede8] max-h-72 overflow-y-auto">
                {payData.arrears.map((a) => (
                  <li key={a.contractId} className="px-4 py-2.5 flex items-center justify-between gap-3 text-[12px]">
                    <div className="min-w-0">
                      <div className="font-semibold truncate text-[#b91c1c]">Rent arrears (lease still active)</div>
                      <div className="text-[11px] text-[#9b9890] truncate">{a.rpName} · Contract #{a.contractId} · {a.overdueCheques} overdue cheque{a.overdueCheques === 1 ? '' : 's'}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-bold text-[#b91c1c]">{fmtAED(a.overdueAed)}</div>
                      <div className="text-[11px] text-[#9b9890]">{a.oldestDays}d overdue</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Rental-provider contribution */}
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mt-4">
            <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[#1a1916] flex items-center gap-1.5"><Trophy size={14} className="text-[#2e9f82]" /> Rental-provider contribution</h2>
                <p className="text-[11px] text-[#9b9890]">Who brings the most volume to the platform — properties, units, active leases, rent roll, tenants. Ranks on signed footprint.</p>
              </div>
              {contrib && (
                <span className="text-[11px] text-[#9b9890] text-right flex-shrink-0 mt-0.5">
                  {contrib.totals.rps} active providers · {contrib.totals.units} units · {fmtAED(contrib.totals.rentRollAed)} rent roll · {contrib.totals.occupancyPct ?? '—'}% occupied
                </span>
              )}
            </div>
            {!contrib || contrib.rows.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">No rental providers with a footprint yet.</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
                <div className="lg:col-span-1">
                  <p className="text-[11px] font-semibold text-[#6b6860] mb-1">Rent roll by provider</p>
                  <ResponsiveContainer width="100%" height={Math.max(150, contribChart.length * 34)}>
                    <BarChart layout="vertical" data={contribChart} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
                      <XAxis type="number" tickFormatter={aedAxis} tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 10, fill: '#6b6860' }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: unknown) => [fmtAED(Number(v)), 'Rent roll'] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                      <Bar dataKey="aed" radius={[0, 4, 4, 0]} fill={GREEN} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="lg:col-span-2 overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[#9b9890] bg-[#faf9f7] text-[11px]">
                        <th className="text-left font-semibold px-3 py-2">#</th>
                        <th className="text-left font-semibold px-3 py-2">Provider</th>
                        <th className="text-right font-semibold px-3 py-2">Units</th>
                        <th className="text-right font-semibold px-3 py-2">Active</th>
                        <th className="text-right font-semibold px-3 py-2">Occ.</th>
                        <th className="text-right font-semibold px-3 py-2">Tenants</th>
                        <th className="text-right font-semibold px-3 py-2">Rent roll</th>
                        <th className="text-left font-semibold px-3 py-2 w-28">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contrib.rows.map((r, i) => (
                        <tr key={r.rpId} className="border-t border-[#f0ede8]">
                          <td className="px-3 py-2.5 text-[#9b9890] font-semibold">{i + 1}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-[#1a1916]">{r.name}</div>
                            <div className="text-[11px] text-[#9b9890] flex items-center gap-1"><Building2 size={10} /> {r.properties} {r.properties === 1 ? 'property' : 'properties'}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#3f3d39]">{r.units}</td>
                          <td className="px-3 py-2.5 text-right text-[#3f3d39]">{r.activeLeases}</td>
                          <td className="px-3 py-2.5 text-right" style={{ color: r.occupancyPct != null && r.occupancyPct < 60 ? '#b45309' : '#3f3d39' }}>{r.occupancyPct == null ? '—' : `${r.occupancyPct}%`}</td>
                          <td className="px-3 py-2.5 text-right text-[#3f3d39]">{r.tenants}</td>
                          <td className="px-3 py-2.5 text-right font-bold text-[#1a1916]">{fmtAED(r.rentRollAed)}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 h-1.5 rounded-full bg-[#f0ede8] overflow-hidden min-w-[40px]"><div className="h-full rounded-full" style={{ width: `${r.rentRollSharePct}%`, backgroundColor: GREEN }} /></div>
                              <span className="text-[11px] font-semibold text-[#6b6860] tabular-nums w-9 text-right">{r.rentRollSharePct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Customer journey — the support side */}
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mt-4">
            <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[#1a1916]">Customer journey — are customers being supported through the process?</h2>
                <p className="text-[11px] text-[#9b9890]">Where customers get stuck: contract issued but never sent, KYC unverified, no portal link, move-in not done. Platform-wide (not in the RP score).</p>
              </div>
            </div>
            {!journey ? (
              <p className="px-4 py-6 text-[12px] text-center text-[#9b9890]">Loading…</p>
            ) : (
              <div className="p-4">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {journey.funnel.map((fn, i) => {
                    const max = journey.funnel[0]?.count || 1;
                    const pct = max ? Math.round((fn.count / max) * 100) : 0;
                    return (
                      <div key={fn.stage} className="rounded-xl border border-[#e8e6e0] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{fn.stage}</div>
                        <div className="text-lg font-bold mt-1" style={{ color: i > 0 && fn.count === 0 ? '#b91c1c' : '#1a1916' }}>{fn.count}</div>
                        <div className="h-1.5 rounded-full mt-1.5 bg-[#f0ede8] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: i > 0 && fn.count === 0 ? RED : GREEN }} /></div>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: 'Contract not issued/sent', value: journey.stalls.stuckPending },
                    { label: 'No portal link sent', value: journey.stalls.noPortalLink },
                    { label: 'KYC incomplete', value: journey.stalls.kycIncomplete },
                    { label: 'Move-in not done', value: journey.stalls.moveInMissing },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-[#e8e6e0] px-3 py-2.5">
                      <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{s.label}</div>
                      <div className="text-lg font-bold mt-1" style={{ color: s.value > 0 ? '#b45309' : '#1a7a5a' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {journey.byRp.length > 0 && (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[#9b9890] bg-[#faf9f7] text-[11px]">
                        <th className="text-left font-semibold px-3 py-2">Provider</th>
                        <th className="text-right font-semibold px-3 py-2">Not issued</th>
                        <th className="text-right font-semibold px-3 py-2">No link</th>
                        <th className="text-right font-semibold px-3 py-2">KYC</th>
                        <th className="text-right font-semibold px-3 py-2">Move-in</th>
                        <th className="text-right font-semibold px-3 py-2">Stuck</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journey.byRp.map((r) => (
                        <tr key={r.rpId} className="border-t border-[#f0ede8]">
                          <td className="px-3 py-2 font-medium text-[#1a1916]">{r.name}</td>
                          <td className="px-3 py-2 text-right text-[#3f3d39]">{r.stuckPending || '—'}</td>
                          <td className="px-3 py-2 text-right text-[#3f3d39]">{r.noPortalLink || '—'}</td>
                          <td className="px-3 py-2 text-right text-[#3f3d39]">{r.kycIncomplete || '—'}</td>
                          <td className="px-3 py-2 text-right text-[#3f3d39]">{r.moveInMissing || '—'}</td>
                          <td className="px-3 py-2 text-right font-bold text-[#b45309]">{r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          <p className="text-[11px] mt-5 text-[#9b9890]">Composite dimensions: deposit · contract fairness · manager · lead · payment — plus the platform-wide customer-journey view. <Link href="/dashboard/admin" className="text-[#2e9f82] font-semibold">← Back to Platform Overview</Link></p>
        </>
      )}
    </div>
  );
}
