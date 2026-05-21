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
import { DashboardPage, StatCard, QuickAction, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { CanAccess } from '@/components/ui/CanAccess';
import { Users, ShieldCheck, Building2, AlertTriangle, BarChart2, Inbox, UserCog } from 'lucide-react';
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

      {/* Quick actions */}
      <SectionHeader title="Quick Actions" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        <QuickAction
          label="User Management"
          href="/dashboard/admin/users"
          icon={Users}
          description="View, suspend or reactivate users"
        />
        <QuickAction
          label="KYC Queue"
          href="/dashboard/admin/kyc"
          icon={ShieldCheck}
          description="Review pending KYC documents"
        />
        <QuickAction
          label="Listings Approval"
          href="/dashboard/admin/listings"
          icon={Building2}
          description="Approve or reject property listings"
        />
        <QuickAction
          label="Disputes"
          href="/dashboard/admin/disputes"
          icon={AlertTriangle}
          description="Manage open disputes"
        />
        <QuickAction
          label="Analytics"
          href="/dashboard/admin/analytics"
          icon={BarChart2}
          description="Platform-wide metrics"
        />
        <QuickAction
          label="Inbox"
          href="/dashboard/admin/inbox"
          icon={Inbox}
          description="Support messages"
        />
        <QuickAction
          label="Register Provider"
          href="/dashboard/admin/accounts/new-provider"
          icon={Building2}
          description="Onboard a Rental or Service Provider"
        />
        <CanAccess roles={['super_admin']}>
          <QuickAction
            label="Admin Accounts"
            href="/dashboard/admin/accounts"
            icon={UserCog}
            description="Create and manage delegated admins"
          />
        </CanAccess>
      </div>

      {/* Recent activity */}
      <SectionHeader title="Recent Platform Activity" />
      <DashboardEmpty message="Platform activity feed will appear here once data is available." />
    </DashboardPage>
  );
}
