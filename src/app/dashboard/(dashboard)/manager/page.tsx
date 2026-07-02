'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Building2, FileText, Eye, Users, AlertTriangle, ChevronRight,
  RefreshCw, LogIn, LogOut, XCircle, Wrench, Clock,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useManagerPermissions, type RpPermissions } from '@/contexts/ManagerPermissionsContext';
import { DashboardPage, StatCard, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { RpDashboardHome } from '@/app/rental-provider/dashboard/page';

interface OverviewStats {
  properties:      number;
  units:           number;
  activeContracts: number;
  openLeads:       number;
  rps: { id: number; name: string; propertyCount: number }[];
}

interface ActionItem {
  id: number; tenant?: string; unit?: string | null; building?: string | null;
  vendor?: string; category?: string | null; doc?: string; reason?: string | null; date?: string | null;
}
interface Bucket { count: number; items: ActionItem[] }
interface ActionCenter {
  days: number;
  renewals: Bucket; terminationRequests: Bucket; moveIns: Bucket; moveOuts: Bucket;
  amcExpired: Bucket; delayedFollowups: Bucket;
}

const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '');

function permLabel(key: string) {
  return key.replace('can', '').replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Manager home (hybrid). No landlord selected → the cross-landlord overview +
 * picker below. A landlord selected in the switcher (?rp) → the rich RP-style
 * dashboard scoped to that landlord (reuses RpDashboardHome; sections the
 * manager lacks permission for come back empty via the /manager/* gates).
 */
export default function ManagerOverview() {
  const rpParam = useSearchParams().get('rp');
  if (rpParam) return <RpDashboardHome manager={{ rp: Number(rpParam) }} />;
  return <ManagerMultiOverview />;
}

function ManagerMultiOverview() {
  const { user }                            = useAuth();
  const { rps, loading: permsLoading, can } = useManagerPermissions();
  const [stats, setStats]                   = useState<OverviewStats | null>(null);
  const [statsLoading, setStatsLoading]     = useState(true);
  const [action, setAction]                 = useState<ActionCenter | null>(null);
  const [actionLoading, setActionLoading]   = useState(true);
  const [days, setDays]                     = useState(90);
  const name = user?.name ?? user?.firstName ?? 'Manager';

  useEffect(() => {
    apiGet<OverviewStats>('/manager/overview')
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  const loadAction = useCallback(() => {
    setActionLoading(true);
    apiGet<ActionCenter>(`/manager/action-center?days=${days}`)
      .then(setAction)
      .catch(() => {})
      .finally(() => setActionLoading(false));
  }, [days]);
  useEffect(() => { loadAction(); }, [loadAction]);

  const loading = statsLoading || permsLoading;

  return (
    <DashboardPage
      title={`Welcome back, ${name}`}
      subtitle={loading ? 'Loading your dashboard…' : `Managing properties for ${rps.length} landlord${rps.length !== 1 ? 's' : ''}`}
    >
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Properties"       value={loading ? '—' : stats?.properties      ?? 0} icon={Building2} color="primary" />
        <StatCard label="Units"            value={loading ? '—' : stats?.units           ?? 0} icon={Users}     color="neutral" />
        <StatCard label="Active Contracts" value={loading ? '—' : stats?.activeContracts ?? 0} icon={FileText}  color="gold" />
        <StatCard label="Open Viewings"    value={loading ? '—' : stats?.openLeads       ?? 0} icon={Eye}       color="neutral" />
      </div>

      {/* Action Center */}
      <div className="flex items-center justify-between mb-3">
        <SectionHeader title="Action Center" />
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
          <span>Renewals window</span>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border rounded-lg px-2 py-1 text-xs bg-white" style={{ borderColor: 'var(--color-base-200)' }}>
            {[30, 60, 90, 180].map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        <ActionBucket icon={RefreshCw} color="#2e9f82" label={`Renewals (≤${days}d)`} href="/dashboard/manager/contracts"
          loading={actionLoading} bucket={action?.renewals}
          render={i => ({ title: i.tenant ?? `Contract #${i.id}`, sub: [i.unit, i.building].filter(Boolean).join(' · '), date: i.date })} />
        <ActionBucket icon={XCircle} color="#b91c1c" label="Termination Requests" href="/dashboard/manager/contracts"
          loading={actionLoading} bucket={action?.terminationRequests}
          render={i => ({ title: i.tenant ?? `Contract #${i.id}`, sub: i.reason ?? [i.unit, i.building].filter(Boolean).join(' · '), date: i.date })} />
        <ActionBucket icon={LogIn} color="#2563eb" label="Move-ins" href="/dashboard/manager/contracts"
          loading={actionLoading} bucket={action?.moveIns}
          render={i => ({ title: i.tenant ?? `Contract #${i.id}`, sub: [i.unit, i.building].filter(Boolean).join(' · '), date: i.date })} />
        <ActionBucket icon={LogOut} color="#b45309" label="Move-outs" href="/dashboard/manager/contracts"
          loading={actionLoading} bucket={action?.moveOuts}
          render={i => ({ title: i.tenant ?? `Contract #${i.id}`, sub: [i.unit, i.building].filter(Boolean).join(' · '), date: i.date })} />
        <ActionBucket icon={Wrench} color="#9a3412" label="AMC Expired" href="/dashboard/manager/amc"
          loading={actionLoading} bucket={action?.amcExpired}
          render={i => ({ title: i.vendor ?? `AMC #${i.id}`, sub: (i.category ?? '').replace(/_/g, ' '), date: i.date })} />
        <ActionBucket icon={Clock} color="#92400e" label="Delayed Follow-ups" href="/dashboard/manager/tenants"
          loading={actionLoading} bucket={action?.delayedFollowups}
          render={i => ({ title: i.tenant ?? `Tenant #${i.id}`, sub: `${(i.doc ?? '').replace(/_/g, ' ')} not uploaded`, date: i.date })} />
      </div>

      {/* Landlords */}
      <SectionHeader title="Your Landlords" />
      <div className="mb-8">
        {loading ? (
          <DashboardEmpty message="Loading your landlords…" />
        ) : rps.length === 0 ? (
          <div
            className="rounded-2xl p-10 flex flex-col items-center justify-center text-center bg-white"
            style={{ boxShadow: 'var(--shadow-sm)', minHeight: 160 }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
              style={{ backgroundColor: '#fef9eb' }}
            >
              <AlertTriangle size={22} style={{ color: 'var(--color-gold)' }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>No landlords assigned yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-400)' }}>
              Ask your landlord to invite you via their Team settings.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {rps.map((rp: RpPermissions) => {
              const propCount = stats?.rps.find(r => r.id === rp.rentalProviderId)?.propertyCount ?? 0;
              const granted   = Object.entries(rp.permissions).filter(([, v]) => v).map(([k]) => permLabel(k));
              const card = (
                <div
                  className="flex items-center gap-4 p-4 bg-white rounded-2xl hover:shadow-md transition-shadow"
                  style={{ boxShadow: 'var(--shadow-sm)' }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-primary-50)' }}
                  >
                    <Building2 size={18} style={{ color: 'var(--color-primary)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>{rp.rpName}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-400)' }}>
                      {propCount} propert{propCount !== 1 ? 'ies' : 'y'}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {granted.slice(0, 4).map(p => (
                        <span
                          key={p}
                          className="text-[10px] rounded-full px-2 py-0.5"
                          style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary-dark)' }}
                        >
                          {p}
                        </span>
                      ))}
                      {granted.length > 4 && (
                        <span className="text-[10px]" style={{ color: 'var(--color-neutral-400)' }}>+{granted.length - 4} more</span>
                      )}
                      {granted.length === 0 && (
                        <span className="text-[10px]" style={{ color: 'var(--color-gold)' }}>No permissions set</span>
                      )}
                    </div>
                  </div>
                  {can('canListProperties') && (
                    <ChevronRight size={16} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                  )}
                </div>
              );
              return can('canListProperties') ? (
                <Link key={rp.rentalProviderId} href={`/dashboard/manager/properties?rp=${rp.rentalProviderId}`}>{card}</Link>
              ) : (
                <div key={rp.rentalProviderId}>{card}</div>
              );
            })}
          </div>
        )}
      </div>

    </DashboardPage>
  );
}

function ActionBucket({
  icon: Icon, color, label, href, loading, bucket, render,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  color: string; label: string; href: string; loading: boolean;
  bucket?: Bucket; render: (i: ActionItem) => { title: string; sub?: string; date?: string | null };
}) {
  const count = bucket?.count ?? 0;
  const items = bucket?.items ?? [];
  return (
    <div className="bg-white rounded-2xl p-4 flex flex-col" style={{ boxShadow: 'var(--shadow-sm)', minHeight: 150 }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}1a` }}>
          <Icon size={15} style={{ color }} />
        </span>
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--color-neutral-700)' }}>{label}</span>
        <span className="text-xl font-bold" style={{ color: count ? color : 'var(--color-neutral-300)' }}>{loading ? '—' : count}</span>
      </div>
      <div className="flex-1">
        {loading ? (
          <p className="text-xs py-3 text-center" style={{ color: 'var(--color-neutral-300)' }}>Loading…</p>
        ) : count === 0 ? (
          <p className="text-xs py-3 text-center" style={{ color: 'var(--color-neutral-300)' }}>Nothing pending</p>
        ) : (
          <div className="space-y-1">
            {items.slice(0, 4).map(i => {
              const r = render(i);
              return (
                <div key={i.id} className="flex items-center justify-between gap-2 py-1 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-neutral-800)' }}>{r.title}</p>
                    {r.sub && <p className="text-[11px] truncate" style={{ color: 'var(--color-neutral-400)' }}>{r.sub}</p>}
                  </div>
                  {r.date && <span className="text-[11px] shrink-0" style={{ color: 'var(--color-neutral-400)' }}>{fmtD(r.date)}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {count > 0 && (
        <Link href={href} className="flex items-center gap-1 text-[11px] font-medium mt-2" style={{ color }}>
          View all ({count}) <ChevronRight size={12} />
        </Link>
      )}
    </div>
  );
}
