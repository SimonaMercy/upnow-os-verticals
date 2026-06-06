'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, FileText, Eye, Users, AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useManagerPermissions, type RpPermissions } from '@/contexts/ManagerPermissionsContext';
import { DashboardPage, StatCard, QuickAction, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';

interface OverviewStats {
  properties:      number;
  units:           number;
  activeContracts: number;
  openLeads:       number;
  rps: { id: number; name: string; propertyCount: number }[];
}

function permLabel(key: string) {
  return key.replace('can', '').replace(/([A-Z])/g, ' $1').trim();
}

export default function ManagerOverview() {
  const { user }                            = useAuth();
  const { rps, loading: permsLoading, can } = useManagerPermissions();
  const [stats, setStats]                   = useState<OverviewStats | null>(null);
  const [statsLoading, setStatsLoading]     = useState(true);
  const name = user?.name ?? user?.firstName ?? 'Manager';

  useEffect(() => {
    apiGet<OverviewStats>('/manager/overview')
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

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

      {/* Quick actions — permission-gated */}
      <SectionHeader title="Quick Actions" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {can('canListProperties') && (
          <QuickAction label="Properties" href="/dashboard/manager/properties" icon={Building2} description="View all managed listings" />
        )}
        {can('canManageAgreements') && (
          <QuickAction label="Contracts" href="/dashboard/manager/contracts" icon={FileText} description="Active tenancy agreements" />
        )}
        {can('canManageViewings') && (
          <QuickAction label="Viewings" href="/dashboard/manager/viewings" icon={Eye} description="Manage appointments" />
        )}
        {!loading && !can('canListProperties') && !can('canManageAgreements') && !can('canManageViewings') && (
          <div className="sm:col-span-2 lg:col-span-3">
            <DashboardEmpty message="No actions available. Your landlord hasn't granted any permissions yet." />
          </div>
        )}
      </div>
    </DashboardPage>
  );
}
