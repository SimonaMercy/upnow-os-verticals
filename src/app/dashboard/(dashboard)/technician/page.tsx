'use client';

import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, StatCard, QuickAction, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { CalendarCheck, CheckCircle, Clock, Star } from 'lucide-react';

export default function TechnicianOverview() {
  const { user } = useAuth();
  const name = user?.name ?? user?.firstName ?? 'there';

  return (
    <DashboardPage
      title={`Welcome, ${name}`}
      subtitle="Your assigned jobs and schedule."
    >
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Assigned Jobs"   value="0" icon={CalendarCheck} trend="No active jobs" />
        <StatCard label="Completed Today" value="0" icon={CheckCircle}   trend="—" color="gold" />
        <StatCard label="Pending"         value="0" icon={Clock}         trend="No pending" color="neutral" />
        <StatCard label="Rating"          value="—" icon={Star}          trend="No reviews yet" color="neutral" />
      </div>

      {/* Quick actions */}
      <SectionHeader title="Quick Actions" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        <QuickAction
          label="My Jobs"
          href="/dashboard/technician/jobs"
          icon={CalendarCheck}
          description="View all assigned work orders"
        />
        <QuickAction
          label="Schedule"
          href="/dashboard/technician/schedule"
          icon={Clock}
          description="Your upcoming job calendar"
        />
      </div>

      {/* Recent activity */}
      <SectionHeader title="Recent Activity" />
      <DashboardEmpty message="No recent activity. Jobs assigned to you will appear here." />
    </DashboardPage>
  );
}
