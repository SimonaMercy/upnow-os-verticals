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
  TrendingUp, Loader2, ArrowUpRight, Pause, Play, Ban, Download, Building2, Trophy,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { apiGet, apiPatch } from '@/lib/api';

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
  rpId: number; name: string; userId: number | null; complianceStatus: string; userStatus: string;
  trapCount: number; trapExposureAed: number; maxTrapDays: number;
  renewalHikeCount: number; directTerminationCount: number; payingEvictionCount: number;
  leadStale: number; leadGhosted: number; leadFrt: number; leadPoaching: number;
  mgrPoa: number; mgrDormantMoney: number; mgrEscalation: boolean;
  arrearsCount: number; maxArrearsDays: number; vatOvercharge: number;
  depositScore: number; fairnessScore: number; leadScore: number; managerScore: number; paymentScore: number;
  compositeScore: number; tier: Tier;
  priorComposite?: number | null; delta?: number | null;
}
function rpReasons(r: LeaderRow): string {
  const parts = [
    r.trapCount ? `${r.trapCount} trapped` : '',
    r.payingEvictionCount ? `${r.payingEvictionCount} paying eviction${r.payingEvictionCount === 1 ? '' : 's'}` : '',
    r.renewalHikeCount ? `${r.renewalHikeCount} hike${r.renewalHikeCount === 1 ? '' : 's'}` : '',
    r.arrearsCount ? `${r.arrearsCount} in arrears (${r.maxArrearsDays}d)` : '',
    r.vatOvercharge ? 'VAT overcharge' : '',
    r.mgrDormantMoney ? 'dormant manager w/ money' : '',
    r.mgrEscalation ? 'manager escalation' : '',
    r.mgrPoa ? 'manager holds POA' : '',
    r.leadPoaching ? 'lead poaching' : '',
    r.leadFrt ? `${r.leadFrt} slow lead${r.leadFrt === 1 ? '' : 's'}` : '',
    r.leadStale ? `${r.leadStale} stale lead${r.leadStale === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'flagged';
}
function exportWatchlistCsv(rows: LeaderRow[]) {
  const headers = ['Rental provider', 'Compliance', 'Tier', 'Composite', 'Deposit', 'Fairness', 'Lead', 'Manager', 'Payment', 'Trapped deposits', 'At-risk AED', 'Arrears (days)', 'Reasons'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([r.name, r.complianceStatus, r.tier, r.compositeScore, r.depositScore, r.fairnessScore, r.leadScore, r.managerScore, r.paymentScore, r.trapCount, r.trapExposureAed, r.maxArrearsDays, rpReasons(r)].map(esc).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rp-risk-watchlist-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
interface Overview { generatedAt: string; kpis: OverviewKpis; leaderboard: LeaderRow[]; }
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
interface TrapRow { contractId: number; rpName: string; amountAed: number; endDate: string; daysOverdue: number; }
interface DeductionRow { contractId: number; rpName: string; deductionAed: number; deductionRatio: number; }
interface DepositAlerts { trap: TrapRow[]; excessiveDeduction: DeductionRow[]; }
interface HikeRow { contractId: number; rpName: string; priorRent: number; newRent: number; hikePct: number; }
interface EvictionRow { contractId: number; rpName: string; payingTenant: boolean; paidAed: number; }
interface FairnessAlerts { renewalHikes: HikeRow[]; directEvictions: EvictionRow[]; }
interface TrendPoint { date: string; watchlist: number; atRiskAed: number; payingEvictions: number; avgScore: number; }
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
function shortName(n: string): string {
  const parts = n.trim().split(/\s+/);
  return parts.length <= 2 ? n : `${parts[0]} ${parts[1]}`;
}

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
function Chip({ c, children }: { c: string; children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: `${c}1a`, color: c }}>{children}</span>;
}
function Movement({ delta }: { delta?: number | null }) {
  if (delta == null) return <span className="text-[10px] text-[#9b9890]" title="No prior snapshot">new</span>;
  if (delta === 0) return <span className="text-[10px] text-[#9b9890]" title="No change vs last scan">•</span>;
  const up = delta > 0;
  return <span className="text-[10px] font-semibold" title="Change vs last snapshot" style={{ color: up ? '#b91c1c' : '#1a7a5a' }}>{up ? '▲' : '▼'}{Math.abs(delta)}</span>;
}

const RULE_LABEL: Record<string, string> = {
  'deposit.trap': 'Deposit withheld',
  'deposit.slow_refund': 'Stalled refund',
  'deposit.excessive_deduction': 'Excessive deduction',
  'deposit.double_charge': 'Possible double-charge',
  'fairness.renewal_hike': 'Renewal hike',
  'fairness.direct_eviction': 'Direct eviction',
};
const sevColor = (s: string) => (s === 'high' ? RED : s === 'medium' ? AMBER : '#9b9890');
function flagDetailText(f: Flag): string {
  const d = (f.detail || {}) as Record<string, unknown>;
  if (f.ruleKey === 'deposit.trap') return `Contract #${d.contractId ?? '—'} · ${d.daysOverdue ?? '?'}d overdue`;
  if (f.ruleKey === 'fairness.direct_eviction') return d.payingTenant ? 'paying tenant' : 'no payments';
  if (f.ruleKey === 'fairness.renewal_hike') return `+${d.hikePct ?? '?'}%`;
  if (f.ruleKey === 'deposit.excessive_deduction') return `${d.ratio ?? '?'}% of deposit`;
  return f.dimension;
}

export default function AdminDecisionDashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [deposits, setDeposits] = useState<DepositAlerts | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [mgr, setMgr] = useState<ManagerData | null>(null);
  const [leadData, setLeadData] = useState<LeadData | null>(null);
  const [payData, setPayData] = useState<PaymentData | null>(null);
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [contrib, setContrib] = useState<Contribution | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOverview = () => apiGet<Overview>('/admin/risk/overview').then(setOverview).catch(() => null);
  const loadFlags = () => apiGet<{ flags: Flag[] }>('/admin/risk/flags').then((r) => setFlags(r.flags)).catch(() => null);

  useEffect(() => {
    apiGet<AdminStats>('/admin/stats').then(setStats).catch(() => null);
    setLoading(true);
    Promise.all([
      loadOverview(),
      apiGet<DepositAlerts>('/admin/risk/deposits').then(setDeposits).catch(() => null),
      apiGet<{ points: TrendPoint[] }>('/admin/risk/trend').then((t) => setTrend(t.points)).catch(() => null),
      loadFlags(),
      apiGet<ManagerData>('/admin/risk/managers').then(setMgr).catch(() => null),
      apiGet<LeadData>('/admin/risk/leads').then(setLeadData).catch(() => null),
      apiGet<PaymentData>('/admin/risk/payments').then(setPayData).catch(() => null),
      apiGet<JourneyData>('/admin/risk/customer-journey').then(setJourney).catch(() => null),
      apiGet<Contribution>('/admin/risk/contribution').then(setContrib).catch(() => null),
    ]).finally(() => setLoading(false));
  }, []);

  async function resolveFlag(id: number, status: 'acknowledged' | 'resolved') {
    setFlags((fs) => fs.filter((f) => f.id !== id)); // optimistic
    try { await apiPatch(`/admin/risk/flags/${id}`, { status }); }
    catch { loadFlags(); }
  }
  async function pauseRp(r: LeaderRow) {
    const target = r.complianceStatus === 'paused' ? 'compliant' : 'paused';
    if (!window.confirm(`${target === 'paused' ? 'Pause listings for' : 'Resume'} ${r.name}?`)) return;
    setBusy(r.rpId);
    try { await apiPatch(`/admin/kyc/rental-providers/${r.rpId}/compliance`, { complianceStatus: target, complianceNotes: 'Risk dashboard action' }); await loadOverview(); }
    catch (e) { window.alert(`Action failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }
  async function suspendRp(r: LeaderRow) {
    if (!r.userId) return;
    const target = r.userStatus === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${target === 'suspended' ? 'Suspend' : 'Reactivate'} ${r.name}'s account?`)) return;
    setBusy(r.rpId);
    try { await apiPatch(`/admin/users/${r.userId}/status`, { status: target }); await loadOverview(); }
    catch (e) { window.alert(`Action failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

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

  const topRps = (overview?.leaderboard ?? []).slice(0, 6);

  const contribChart = useMemo(
    () => (contrib?.rows ?? []).slice(0, 8).map((r) => ({ name: shortName(r.name), aed: r.rentRollAed })),
    [contrib],
  );

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
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2 text-[#9b9890]">Customer-protection risk — act on these</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <KpiTile icon={Wallet} label="Customer deposits at risk" value={k ? fmtAED(k.depositsAtRiskAed) : '—'} sub={k ? `${k.depositsAtRiskCount} trapped · ${k.criticalTrapCount} over 90d` : ''} tone="bad" href="/dashboard/admin/risk" />
            <KpiTile icon={ShieldAlert} label="RPs to act on" value={k ? String(k.rpsOnWatchlist) : '—'} sub="composite risk score ≥ 60" tone={k && k.rpsOnWatchlist > 0 ? 'warn' : 'good'} href="/dashboard/admin/risk" />
            <KpiTile icon={UserMinus} label="Paying-tenant evictions" value={k ? String(k.payingEvictionCount) : '—'} sub={k ? `${k.directTerminationCount} direct terminations` : ''} tone={k && k.payingEvictionCount > 0 ? 'bad' : 'neutral'} href="/dashboard/admin/risk" />
            <KpiTile icon={AlertTriangle} label="Open critical alerts" value={k ? String(k.openCriticalAlerts) : '—'} sub={k ? `${k.severeHikeCount} severe hikes · ${k.excessiveDeductionCount} deductions` : ''} tone={k && k.openCriticalAlerts > 0 ? 'bad' : 'good'} href="/dashboard/admin/risk" />
          </div>

          {/* Platform stats (secondary) */}
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2 text-[#9b9890]">Platform health</p>
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

          {/* Rental-provider contribution — who brings the most volume to the platform */}
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mb-5">
            <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[#1a1916] flex items-center gap-1.5"><Trophy size={14} className="text-[#2e9f82]" /> Rental-provider contribution</h2>
                <p className="text-[11px] text-[#9b9890]">Who brings the most volume to the platform — properties, units, active leases, rent roll, tenants. Leads/viewings aren&apos;t tracked yet, so this ranks on signed footprint.</p>
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
                {/* Rent-roll distribution chart */}
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
                {/* Ranked table */}
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

          {/* RPs to act on + Customer-harm events */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden">
              <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
                <div>
                  <h2 className="text-[13px] font-bold text-[#1a1916]">Rental providers to act on</h2>
                  <p className="text-[11px] text-[#9b9890]">One composite score per RP — deposits · fairness · manager · leads · payments. Highest first.</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 mt-0.5">
                  {topRps.length > 0 && (
                    <button onClick={() => exportWatchlistCsv(overview?.leaderboard ?? [])} className="flex items-center gap-1 text-[11px] font-semibold text-[#6b6860] hover:text-[#1a1916]">
                      <Download size={12} /> Export CSV
                    </button>
                  )}
                  <Link href="/dashboard/admin/risk" className="text-[11px] font-semibold text-[#2e9f82]">View all</Link>
                </div>
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
                          <div className="text-[11px] text-[#9b9890]">{rpReasons(r)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-[#9b9890]">{r.trapExposureAed ? fmtAED(r.trapExposureAed) : ''}</td>
                        <td className="px-3 py-2.5 text-center w-20"><TierBadge tier={r.tier} /></td>
                        <td className="px-3 py-2.5 text-right w-12">
                          <div className="font-bold text-[#1a1916] leading-none">{r.compositeScore}</div>
                          <div className="mt-0.5"><Movement delta={r.delta} /></div>
                        </td>
                        {isSuperAdmin && (
                          <td className="px-3 py-2.5 text-right whitespace-nowrap w-24">
                            <div className="inline-flex gap-1">
                              <button title={r.complianceStatus === 'paused' ? 'Resume listings' : 'Pause listings'} onClick={() => pauseRp(r)} disabled={busy === r.rpId}
                                className="p-1.5 rounded-lg border border-[#e8e6e0] hover:bg-[#fffbeb] disabled:opacity-40">
                                {r.complianceStatus === 'paused' ? <Play size={13} className="text-[#1a7a5a]" /> : <Pause size={13} className="text-[#b45309]" />}
                              </button>
                              <button title={r.userStatus === 'suspended' ? 'Reactivate account' : 'Suspend account'} onClick={() => suspendRp(r)} disabled={busy === r.rpId || !r.userId}
                                className="p-1.5 rounded-lg border border-[#e8e6e0] hover:bg-[#fef2f2] disabled:opacity-40">
                                <Ban size={13} className={r.userStatus === 'suspended' ? 'text-[#1a7a5a]' : 'text-[#b91c1c]'} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden">
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
                        <button title="Resolve" onClick={() => resolveFlag(f.id, 'resolved')} className="px-2 py-1 rounded-md text-[10px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: '#2e9f82' }}>Resolve</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Manager oversight */}
          <div className="rounded-2xl bg-white border border-[#e8e6e0] overflow-hidden mt-4">
            <div className="flex items-start justify-between px-4 py-2.5 border-b border-[#f0ede8] gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[#1a1916]">Manager oversight</h2>
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
                        <td className="px-3 py-2.5 text-right text-[11px]" style={{ color: m.dormant ? RED : '#9b9890' }}>{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('en-AE') : 'never'}</td>
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
                {/* Funnel */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {journey.funnel.map((f, i) => {
                    const max = journey.funnel[0]?.count || 1;
                    const pct = max ? Math.round((f.count / max) * 100) : 0;
                    return (
                      <div key={f.stage} className="rounded-xl border border-[#e8e6e0] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{f.stage}</div>
                        <div className="text-lg font-bold mt-1" style={{ color: i > 0 && f.count === 0 ? '#b91c1c' : '#1a1916' }}>{f.count}</div>
                        <div className="h-1.5 rounded-full mt-1.5 bg-[#f0ede8] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: i > 0 && f.count === 0 ? RED : GREEN }} /></div>
                      </div>
                    );
                  })}
                </div>
                {/* Stall stats */}
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
                {/* Per-RP stalls */}
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

          {overview && <p className="text-[11px] mt-4 text-[#9b9890]">Risk last scanned {new Date(overview.generatedAt).toLocaleString('en-AE')} · deposit + fairness + manager + lead + payment dimensions in the composite, plus the customer-journey view. <Link href="/dashboard/admin/risk" className="text-[#2e9f82] font-semibold">Open the full risk board →</Link></p>}
        </>
      )}
    </div>
  );
}
