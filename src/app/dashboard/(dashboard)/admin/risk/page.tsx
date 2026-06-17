/**
 * Super-Admin Risk Dashboard (dashboard/admin/risk)
 *
 * Platform-wide rental-provider oversight: "which RPs are exploiting customers
 * (or about to), and how much customer money is exposed right now?"
 *
 * Live dimensions: DEPOSIT (trapped deposits, stalled refunds, excessive
 * deductions, double-charges) + FAIRNESS (abusive renewal hikes, direct
 * termination of paying tenants). Per-RP composite watchlist blends both.
 *
 * Data: GET /admin/risk/overview, /deposits, /fairness, /rp/:id.
 * Amounts are WHOLE AED.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  DashboardPage,
  StatCard,
  SectionHeader,
  DashboardEmpty,
} from '@/components/dashboard/DashboardWidgets';
import {
  Wallet,
  AlertTriangle,
  Clock,
  Scissors,
  Copy,
  ShieldAlert,
  ChevronRight,
  ArrowLeft,
  RefreshCw,
  Banknote,
  TrendingUp,
  UserMinus,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

/* ── Types ── */
type Tier = 'ok' | 'monitor' | 'review' | 'critical';

interface OverviewKpis {
  totalDepositLiabilityAed: number;
  totalDepositCount: number;
  depositsAtRiskAed: number;
  depositsAtRiskCount: number;
  criticalTrapCount: number;
  slowRefundCount: number;
  excessiveDeductionCount: number;
  doubleChargeCount: number;
  renewalHikeCount: number;
  severeHikeCount: number;
  directTerminationCount: number;
  payingEvictionCount: number;
  rpsOnWatchlist: number;
  openCriticalAlerts: number;
}
interface LeaderRow {
  rpId: number;
  name: string;
  complianceStatus: string;
  trapCount: number;
  trapExposureAed: number;
  maxTrapDays: number;
  slowRefundCount: number;
  excessiveDeductionCount: number;
  doubleChargeCount: number;
  renewalHikeCount: number;
  maxHikePct: number;
  directTerminationCount: number;
  payingEvictionCount: number;
  depositScore: number;
  fairnessScore: number;
  compositeScore: number;
  tier: Tier;
}
interface Overview {
  generatedAt: string;
  kpis: OverviewKpis;
  leaderboard: LeaderRow[];
}
interface TrapRow { depositId: number; contractId: number; rpName: string; amountAed: number; endDate: string; daysOverdue: number; }
interface SlowRefundRow { settlementId: number; contractId: number; rpName: string; refundAed: number; status: string; daysStalled: number; }
interface DeductionRow { settlementId: number; contractId: number; rpName: string; depositHeldAed: number; deductionAed: number; deductionRatio: number; }
interface DoubleChargeRow { contractId: number; rpName: string; depositCount: number; totalAed: number; }
interface DepositAlerts { trap: TrapRow[]; slowRefund: SlowRefundRow[]; excessiveDeduction: DeductionRow[]; doubleCharge: DoubleChargeRow[]; }
interface HikeRow { contractId: number; rpName: string; priorRent: number; newRent: number; hikePct: number; marketPrice: number | null; }
interface EvictionRow { contractId: number; rpName: string; status: string; payingTenant: boolean; paidAed: number; terminationRequestedAt: string | null; }
interface FairnessAlerts { renewalHikes: HikeRow[]; directEvictions: EvictionRow[]; }

/* ── Helpers ── */
function formatAED(aed: number | null | undefined): string {
  if (aed == null) return '—';
  if (aed >= 1_000_000) return `AED ${(aed / 1_000_000).toFixed(1)}M`;
  if (aed >= 1000) return `AED ${(aed / 1000).toFixed(aed % 1000 === 0 ? 0 : 1)}k`;
  return `AED ${aed.toLocaleString('en-AE')}`;
}

const TIER_STYLE: Record<Tier, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#fef2f2', fg: 'var(--color-error)', label: 'Critical' },
  review: { bg: '#fef9eb', fg: 'var(--color-gold)', label: 'Review' },
  monitor: { bg: 'var(--color-base-100)', fg: 'var(--color-neutral-600)', label: 'Monitor' },
  ok: { bg: '#ecfdf5', fg: '#047857', label: 'OK' },
};

function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier] ?? TIER_STYLE.ok;
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function AlertList<T>({
  title, icon: Icon, count, rows, emptyText, render, accent,
}: {
  title: string; icon: typeof Wallet; count: number; rows: T[];
  emptyText: string; render: (row: T, i: number) => React.ReactNode; accent: string;
}) {
  return (
    <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-base-200)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
          <Icon size={16} style={{ color: accent }} />
        </div>
        <h3 className="font-semibold text-sm flex-1" style={{ color: 'var(--color-neutral-900)' }}>{title}</h3>
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: count ? `${accent}1a` : 'var(--color-base-100)', color: count ? accent : 'var(--color-neutral-400)' }}>{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--color-neutral-400)' }}>{emptyText}</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--color-base-200)' }}>
          {rows.map((r, i) => (<li key={i} className="px-4 py-3 text-sm">{render(r, i)}</li>))}
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
      .then((r) => { setDeposits(r.deposits); setFairness(r.fairness); })
      .catch(() => null);
  }, []);

  const clearRp = useCallback(() => { setSelected(null); loadAllAlerts(); }, [loadAllAlerts]);

  const recompute = useCallback(async () => {
    setRecomputing(true);
    try {
      await apiPost('/admin/risk/recompute');
      loadOverview();
      if (!selected) loadAllAlerts();
    } catch { /* non-blocking */ } finally { setRecomputing(false); }
  }, [loadOverview, loadAllAlerts, selected]);

  if (!allowed) {
    return (
      <DashboardPage title="Risk Dashboard" subtitle="Platform-wide rental-provider oversight.">
        <DashboardEmpty message="This dashboard is restricted to platform admins." />
      </DashboardPage>
    );
  }

  const k = overview?.kpis;

  return (
    <DashboardPage
      title="Risk Dashboard"
      subtitle="Are rental providers supporting customers — or exploiting them? Deposit & contract-fairness watchlist."
      actions={isSuperAdmin ? (
        <button onClick={recompute} disabled={recomputing}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}>
          <RefreshCw size={15} className={recomputing ? 'animate-spin' : ''} />
          {recomputing ? 'Recomputing…' : 'Recompute snapshot'}
        </button>
      ) : undefined}
    >
      {/* Headline scorecards (deposit + fairness) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard label="Deposits at risk" value={k ? formatAED(k.depositsAtRiskAed) : '—'} icon={Wallet}
          trend={k ? `${k.depositsAtRiskCount} trapped` : 'Loading…'} color="error" />
        <StatCard label="Paying-tenant evictions" value={k ? String(k.payingEvictionCount) : '—'} icon={UserMinus}
          trend={k ? `${k.directTerminationCount} direct terms` : 'Loading…'} color="error" />
        <StatCard label="Renewal hikes (above mkt)" value={k ? String(k.renewalHikeCount) : '—'} icon={TrendingUp}
          trend={k ? `${k.severeHikeCount} severe` : 'Loading…'} color="gold" />
        <StatCard label="RPs on watchlist" value={k ? String(k.rpsOnWatchlist) : '—'} icon={ShieldAlert}
          trend="Composite ≥ 60" color="gold" />
        <StatCard label="Open critical alerts" value={k ? String(k.openCriticalAlerts) : '—'} icon={AlertTriangle}
          trend={k ? `${k.criticalTrapCount} trapped > 90d` : 'Loading…'} color="error" />
        <StatCard label="Total deposit liability" value={k ? formatAED(k.totalDepositLiabilityAed) : '—'} icon={Banknote}
          trend={k ? `${k.totalDepositCount} held/partial` : 'Loading…'} />
      </div>

      {/* Composite watchlist */}
      <SectionHeader title="Rental-provider risk watchlist"
        action={overview ? <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Updated {new Date(overview.generatedAt).toLocaleString('en-AE')}</span> : undefined} />
      <div className="rounded-2xl bg-white overflow-hidden mb-8" style={{ boxShadow: 'var(--shadow-sm)' }}>
        {loading ? (
          <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--color-neutral-400)' }}>Loading…</p>
        ) : !overview || overview.leaderboard.length === 0 ? (
          <p className="px-4 py-8 text-sm text-center" style={{ color: 'var(--color-neutral-400)' }}>No risk signals across any rental provider. 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--color-neutral-500)', backgroundColor: 'var(--color-base-100)' }}>
                  <th className="text-left font-medium px-4 py-2">Rental provider</th>
                  <th className="text-center font-medium px-3 py-2">Tier</th>
                  <th className="text-right font-medium px-3 py-2">Score</th>
                  <th className="text-right font-medium px-3 py-2">Trapped</th>
                  <th className="text-right font-medium px-3 py-2">At risk</th>
                  <th className="text-right font-medium px-3 py-2">Hikes</th>
                  <th className="text-right font-medium px-3 py-2">Evictions</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {overview.leaderboard.map((r) => (
                  <tr key={r.rpId} onClick={() => selectRp(r.rpId, r.name)}
                    className="cursor-pointer transition-colors hover:bg-[var(--color-base-100)] border-t" style={{ borderColor: 'var(--color-base-200)' }}>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: 'var(--color-neutral-900)' }}>{r.name}</div>
                      <div className="text-xs capitalize" style={{ color: 'var(--color-neutral-400)' }}>{r.complianceStatus.replace(/_/g, ' ')}</div>
                    </td>
                    <td className="px-3 py-3 text-center"><TierBadge tier={r.tier} /></td>
                    <td className="px-3 py-3 text-right font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{r.compositeScore}</td>
                    <td className="px-3 py-3 text-right" style={{ color: 'var(--color-neutral-700)' }}>{r.trapCount > 0 ? `${r.trapCount}${r.maxTrapDays >= 90 ? ' ⚠' : ''}` : '—'}</td>
                    <td className="px-3 py-3 text-right" style={{ color: 'var(--color-neutral-700)' }}>{r.trapExposureAed ? formatAED(r.trapExposureAed) : '—'}</td>
                    <td className="px-3 py-3 text-right" style={{ color: 'var(--color-neutral-700)' }}>{r.renewalHikeCount || '—'}</td>
                    <td className="px-3 py-3 text-right" style={{ color: r.payingEvictionCount ? 'var(--color-error)' : 'var(--color-neutral-700)' }}>{r.payingEvictionCount || (r.directTerminationCount ? `0/${r.directTerminationCount}` : '—')}</td>
                    <td className="px-3 py-3 text-right"><ChevronRight size={16} style={{ color: 'var(--color-neutral-300)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alerts (filtered to a selected RP, or all) */}
      <SectionHeader title={selected ? `Alerts — ${selected.name}` : 'Risk alerts'}
        action={selected ? (
          <button onClick={clearRp} className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
            <ArrowLeft size={13} /> All providers
          </button>
        ) : undefined} />

      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-neutral-400)' }}>Deposits</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <AlertList title="Trapped deposits" icon={Wallet} accent="#dc2626"
          count={deposits?.trap.length ?? 0} rows={deposits?.trap ?? []}
          emptyText="No deposits held past a closed lease."
          render={(r: TrapRow) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--color-neutral-900)' }}>{r.rpName}</div>
                <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Contract #{r.contractId} · ended {new Date(r.endDate).toLocaleDateString('en-AE')}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-semibold" style={{ color: 'var(--color-error)' }}>{formatAED(r.amountAed)}</div>
                <div className="text-xs" style={{ color: r.daysOverdue >= 90 ? 'var(--color-error)' : 'var(--color-neutral-400)' }}>{r.daysOverdue}d overdue</div>
              </div>
            </div>
          )} />
        <AlertList title="Stalled refunds" icon={Clock} accent="#d97706"
          count={deposits?.slowRefund.length ?? 0} rows={deposits?.slowRefund ?? []}
          emptyText="No settlements stalled past SLA."
          render={(r: SlowRefundRow) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--color-neutral-900)' }}>{r.rpName}</div>
                <div className="text-xs capitalize" style={{ color: 'var(--color-neutral-400)' }}>Contract #{r.contractId} · {r.status}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{formatAED(r.refundAed)}</div>
                <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>{r.daysStalled}d stalled</div>
              </div>
            </div>
          )} />
        <AlertList title="Excessive deductions" icon={Scissors} accent="#dc2626"
          count={deposits?.excessiveDeduction.length ?? 0} rows={deposits?.excessiveDeduction ?? []}
          emptyText="No settlements with outsized damage deductions."
          render={(r: DeductionRow) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--color-neutral-900)' }}>{r.rpName}</div>
                <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Contract #{r.contractId} · {formatAED(r.deductionAed)} of {formatAED(r.depositHeldAed)}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-semibold" style={{ color: 'var(--color-error)' }}>{r.deductionRatio}%</div>
                <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>deducted</div>
              </div>
            </div>
          )} />
        <AlertList title="Possible double-charges" icon={Copy} accent="#7c3aed"
          count={deposits?.doubleCharge.length ?? 0} rows={deposits?.doubleCharge ?? []}
          emptyText="No contracts with duplicate live deposits."
          render={(r: DoubleChargeRow) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--color-neutral-900)' }}>{r.rpName}</div>
                <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Contract #{r.contractId} · {r.depositCount} deposits on file</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{formatAED(r.totalAed)}</div>
                <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>total held</div>
              </div>
            </div>
          )} />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-neutral-400)' }}>Contract fairness</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AlertList title="Direct termination of paying tenants" icon={UserMinus} accent="#dc2626"
          count={fairness?.directEvictions.length ?? 0} rows={fairness?.directEvictions ?? []}
          emptyText="No direct (no-consent) terminations."
          render={(r: EvictionRow) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--color-neutral-900)' }}>{r.rpName}</div>
                <div className="text-xs capitalize" style={{ color: 'var(--color-neutral-400)' }}>Contract #{r.contractId} · {r.status}{r.terminationRequestedAt ? ` · ${new Date(r.terminationRequestedAt).toLocaleDateString('en-AE')}` : ''}</div>
              </div>
              <div className="text-right flex-shrink-0">
                {r.payingTenant ? (
                  <>
                    <div className="font-semibold" style={{ color: 'var(--color-error)' }}>Paying</div>
                    <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>{formatAED(r.paidAed)} paid</div>
                  </>
                ) : (
                  <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>no payments</div>
                )}
              </div>
            </div>
          )} />
        <AlertList title="Abusive renewal hikes" icon={TrendingUp} accent="#d97706"
          count={fairness?.renewalHikes.length ?? 0} rows={fairness?.renewalHikes ?? []}
          emptyText="No above-market renewal hikes."
          render={(r: HikeRow) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--color-neutral-900)' }}>{r.rpName}</div>
                <div className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Contract #{r.contractId} · {formatAED(r.priorRent)} → {formatAED(r.newRent)}{r.marketPrice ? ` · mkt ${formatAED(r.marketPrice)}` : ''}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-semibold" style={{ color: 'var(--color-gold)' }}>+{r.hikePct}%</div>
              </div>
            </div>
          )} />
      </div>

      <p className="text-xs mt-6" style={{ color: 'var(--color-neutral-400)' }}>
        Live dimensions: deposit + contract fairness. Manager-oversight and lead-responsiveness dimensions land next.
      </p>
    </DashboardPage>
  );
}
