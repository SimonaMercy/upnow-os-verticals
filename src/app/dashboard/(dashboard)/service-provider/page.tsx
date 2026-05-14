/**
 * Service Provider — Overview Dashboard (dashboard/service-provider)
 *
 * Entry point for SP accounts. Shows: open orders, technician count,
 * active bookings, completion rate, quick actions (view team, manage profile).
 *
 * The booking engine (Sprint 3) is not yet built — this page is a stub that
 * will be populated once SCRUM-301/302 are implemented.
 */
'use client';

import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, StatCard, QuickAction, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { ProfileCompletionBanner } from '@/components/dashboard/ProfileCompletionBanner';
import { Briefcase, CalendarCheck, Star, Wallet, Plus, CheckCircle2, ShieldAlert, Lock } from 'lucide-react';

// ─── KYC status banner ─────────────────────────────────────────────────────────

function KycStatusBanner({ kycStatus }: { kycStatus: string }) {
  if (kycStatus === 'pending_review') {
    return (
      <div
        className="rounded-2xl px-5 py-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-4"
        style={{ background: 'color-mix(in srgb, var(--color-primary) 8%, white)', border: '1px solid color-mix(in srgb, var(--color-primary) 20%, white)' }}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--color-primary)' }}>
              Under review
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-600)' }}>
              Our compliance team is verifying your documents. This usually takes less than 24 hours.
            </p>
          </div>
        </div>
        {/* 3-step progress track */}
        <div className="flex items-center gap-1.5 flex-shrink-0 text-xs">
          <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--color-primary)' }}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Profile submitted
          </span>
          <span style={{ color: 'var(--color-base-200)' }}>──</span>
          <span className="flex items-center gap-1 font-semibold" style={{ color: 'var(--color-primary)' }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--color-primary)' }} />
            Verification in progress
          </span>
          <span style={{ color: 'var(--color-base-200)' }}>──</span>
          <span className="flex items-center gap-1" style={{ color: 'var(--color-neutral-400)' }}>
            <Lock className="w-3.5 h-3.5" /> Bookings unlocked
          </span>
        </div>
      </div>
    );
  }

  if (kycStatus === 'rejected') {
    return (
      <div
        className="rounded-2xl px-5 py-4 mb-6 flex items-center justify-between gap-4"
        style={{ background: 'color-mix(in srgb, var(--color-error) 8%, white)', border: '1px solid color-mix(in srgb, var(--color-error) 20%, white)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <ShieldAlert className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--color-error)' }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--color-error)' }}>
              Action required
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-600)' }}>
              One or more documents were rejected. Please re-upload and resubmit for review.
            </p>
          </div>
        </div>
        <a
          href="/dashboard/service-provider/documents"
          className="flex-shrink-0 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-error)' }}
        >
          Re-upload documents
        </a>
      </div>
    );
  }

  return null;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ServiceProviderOverview() {
  const { user } = useAuth();
  const name = user?.name ?? user?.firstName ?? 'there';

  return (
    <DashboardPage
      title={`Welcome, ${name}`}
      subtitle="Manage your services, jobs and team."
      actions={
        <a
          href="/dashboard/service-provider/services/new"
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={16} /> Add Service
        </a>
      }
    >
      {/* KYC review banner */}
      {user?.kycStatus && <KycStatusBanner kycStatus={user.kycStatus} />}

      {/* T-101 AC: profile completion prompt */}
      <ProfileCompletionBanner />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Services"  value="0" icon={Briefcase}    trend="No services listed" />
        <StatCard label="Pending Jobs"     value="0" icon={CalendarCheck} trend="No incoming jobs" color="gold" />
        <StatCard label="Avg. Rating"      value="—" icon={Star}         trend="No reviews yet" color="neutral" />
        <StatCard label="Earnings (AED)"   value="0" icon={Wallet}       trend="This month" color="neutral" />
      </div>

      {/* Quick actions */}
      <SectionHeader title="Quick Actions" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        <QuickAction
          label="Add Service"
          href="/dashboard/service-provider/services/new"
          icon={Plus}
          description="Create a new service listing"
        />
        <QuickAction
          label="View Jobs"
          href="/dashboard/service-provider/jobs"
          icon={CalendarCheck}
          description="See incoming and active bookings"
        />
        <QuickAction
          label="Reviews"
          href="/dashboard/service-provider/reviews"
          icon={Star}
          description="See customer feedback"
        />
      </div>

      {/* Recent activity */}
      <SectionHeader title="Recent Activity" />
      <DashboardEmpty message="No recent activity. Add your first service to start receiving bookings." />
    </DashboardPage>
  );
}

