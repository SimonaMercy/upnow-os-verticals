'use client';

import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, StatCard, QuickAction, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { Building2, FileText, Wrench, AlertTriangle } from 'lucide-react';

export default function ManagerOverview() {
  const { user } = useAuth();
  const name = user?.name ?? user?.firstName ?? 'there';

  return (
    <DashboardPage
      title={`Welcome, ${name}`}
      subtitle="Manage your assigned properties and tenancies."
    >
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Managed Properties" value="0" icon={Building2}      trend="No assignments yet" />
        <StatCard label="Active Contracts"   value="0" icon={FileText}       trend="No active tenancies" color="gold" />
        <StatCard label="Maintenance"        value="0" icon={Wrench}         trend="No open requests" color="neutral" />
        <StatCard label="Alerts"             value="0" icon={AlertTriangle}  trend="All clear" color="neutral" />
      </div>

      {/* Quick actions */}
      <SectionHeader title="Quick Actions" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        <QuickAction
          label="Properties"
          href="/dashboard/manager/properties"
          icon={Building2}
          description="View properties you manage"
        />
        <QuickAction
          label="Contracts"
          href="/dashboard/manager/contracts"
          icon={FileText}
          description="Active tenancy agreements"
        />
        <QuickAction
          label="Maintenance"
          href="/dashboard/manager/maintenance"
          icon={Wrench}
          description="Open maintenance requests"
        />
      </div>

      {/* Recent activity */}
      <SectionHeader title="Recent Activity" />
      <DashboardEmpty message="No recent activity. You'll see updates here once properties are assigned to you." />
    </DashboardPage>
  );
}
