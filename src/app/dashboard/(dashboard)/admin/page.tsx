/**
 * Admin — Overview Dashboard (dashboard/admin)
 *
 * Super-admin/admin entry point. Shows platform-wide stats: total users,
 * KYC pending queue, active listings, open disputes, revenue summary.
 *
 * Quick actions: review KYC, approve listings, manage users, view reports.
 * Data: GET /admin/stats (proxied to UsersService.adminStats + other aggregates).
 *
 * Full admin intelligence (fee config, bulk ops, impersonation) is Sprint 5.
 */
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, StatCard, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { Users, ShieldCheck, AlertTriangle } from 'lucide-react';
import { apiGet } from '@/lib/api';

interface AdminStats {
  totalUsers: number;
  kycPending: number;
  activeUsers: number;
  suspendedUsers: number;
}

export default function AdminOverview() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    apiGet<AdminStats>('/admin/stats')
      .then(setStats)
      .catch(() => null);
  }, []);

  return (
    <DashboardPage
      title={isSuperAdmin ? 'Super Admin Dashboard' : 'Admin Dashboard'}
      subtitle="Platform overview — users, KYC, listings and disputes."
    >
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Users"      value={stats ? String(stats.totalUsers) : '—'} icon={Users}         trend={stats ? `${stats.activeUsers} active` : 'Loading…'} />
        <StatCard label="KYC Pending"      value={stats ? String(stats.kycPending) : '—'} icon={ShieldCheck}   trend="Awaiting review" color="gold" />
        <StatCard label="Active Users"     value={stats ? String(stats.activeUsers) : '—'} icon={Users}         trend="Verified accounts" color="neutral" />
        <StatCard label="Suspended"        value={stats ? String(stats.suspendedUsers) : '—'} icon={AlertTriangle} trend="Accounts suspended" color="error" />
      </div>

      {/* Recent activity */}
      <SectionHeader title="Recent Platform Activity" />
      <DashboardEmpty message="Platform activity feed will appear here once data is available." />
    </DashboardPage>
  );
}
