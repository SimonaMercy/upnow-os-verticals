/**
 * Customer — Overview Dashboard (dashboard/customer)
 *
 * Entry point for tenant/customer accounts. Shows:
 *   - Profile completion banner (guides new users through KYC + spaces setup)
 *   - Stat cards: active spaces, upcoming viewings, open contracts, documents
 *   - Quick actions: browse listings, my spaces, my viewings, book a service
 *
 * The document stat card should eventually show real count from GET /documents/my
 * (tracked in CID-328-FE — Unified Document Hub).
 */
'use client';

import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, StatCard, QuickAction, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { ProfileCompletionBanner } from '@/components/dashboard/ProfileCompletionBanner';
import { Search, CalendarCheck, FileText, Layers, Home } from 'lucide-react';

export default function TenantOverview() {
  const { user } = useAuth();
  const name = user?.name ?? user?.firstName ?? 'there';

  return (
    <DashboardPage
      title={`Welcome back, ${name} 👋`}
      subtitle="Here's what's happening with your rentals and services."
    >
      {/* T-101 AC: profile completion prompt */}
      <ProfileCompletionBanner />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Contracts"  value="0"  icon={FileText}      trend="No active tenancy" />
        <StatCard label="Open Bookings"     value="0"  icon={CalendarCheck} trend="No service bookings" color="gold" />
        <StatCard label="Saved Properties"  value="0"  icon={Home}          trend="Start exploring" color="neutral" />
        <StatCard label="Documents"         value="0"  icon={Layers}        trend="Upload your KYC" color="neutral" />
      </div>

      {/* Quick actions */}
      <SectionHeader title="Quick Actions" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        <QuickAction
          label="Browse Properties"
          href="/dashboard/customer/browse"
          icon={Search}
          description="Search available rentals across UAE"
        />
        <QuickAction
          label="Book a Service"
          href="/dashboard/customer/bookings"
          icon={CalendarCheck}
          description="Home services, maintenance & more"
        />
        <QuickAction
          label="My Contracts"
          href="/dashboard/customer/contracts"
          icon={FileText}
          description="View your tenancy agreements"
        />
      </div>

      {/* Recent activity */}
      <SectionHeader title="Recent Activity" />
      <DashboardEmpty message="No recent activity yet. Start by browsing available properties." />
    </DashboardPage>
  );
}
