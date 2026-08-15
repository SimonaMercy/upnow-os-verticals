'use client';

/**
 * Technician home (SP-127) — the first screen a technician sees after
 * accepting their provider's invite. Built from GET /technician/me: who they
 * are, which provider they work for, and whether UpNow has cleared them for
 * jobs yet. Jobs / schedule / earnings arrive with SP-95 / SP-103 / SP-182.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/lib/api';
import { DashboardPage, StatCard, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import {
  Building2, CalendarCheck, CheckCircle, Clock, ShieldAlert, ShieldCheck, Star, Wrench,
} from 'lucide-react';

interface TechnicianMe {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  isLeadCapable: boolean;
  complianceStatus: 'pending_review' | 'compliant' | 'action_required' | 'expired' | 'paused';
  assignable: boolean;
  assignableReason: string | null;
  provider: { id: number; name: string; entityType: string };
  skills: string[];
  services: Array<{ id: number; name: string; category: string }>;
  memberSince: string;
}

const COMPLIANCE_LABEL: Record<TechnicianMe['complianceStatus'], string> = {
  pending_review: 'Pending review',
  compliant: 'Verified',
  action_required: 'Action required',
  expired: 'Document expired',
  paused: 'Paused',
};

function VerificationBanner({ me }: { me: TechnicianMe }) {
  const ok = me.assignable;
  const Icon = ok ? ShieldCheck : ShieldAlert;
  const tone = ok ? 'var(--color-primary)' : '#d97706';
  return (
    <div
      className="rounded-2xl px-5 py-4 mb-6 flex items-start gap-3 bg-white"
      style={{ boxShadow: 'var(--shadow-sm)', borderLeft: `4px solid ${tone}` }}
    >
      <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: tone }} />
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
          {ok ? 'You are verified and can be assigned jobs' : COMPLIANCE_LABEL[me.complianceStatus]}
        </p>
        <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
          {ok
            ? `Jobs from ${me.provider.name} will appear here as they are assigned to you.`
            : me.assignableReason ?? 'You are not yet cleared for jobs.'}
        </p>
      </div>
    </div>
  );
}

export default function TechnicianOverview() {
  const { user } = useAuth();
  const { data: me, isLoading, error } = useQuery<TechnicianMe>({
    queryKey: ['technician-me'],
    queryFn: () => apiGet('/technician/me'),
    staleTime: 30_000,
  });
  const name = me?.name ?? user?.name ?? user?.firstName ?? 'there';

  return (
    <DashboardPage
      title={`Welcome, ${name}`}
      subtitle={me ? `Technician at ${me.provider.name}` : 'Your assigned jobs and schedule.'}
    >
      {error && (
        <div
          className="rounded-2xl p-4 mb-6 text-sm"
          style={{ background: 'color-mix(in srgb, var(--color-error) 10%, white)', color: 'var(--color-error)' }}
        >
          {(error as Error).message || 'Could not load your technician profile.'}
        </div>
      )}
      {me && <VerificationBanner me={me} />}

      {/* Stats — job counters light up with SP-95; the account facts are live now. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Assigned Jobs"   value="0" icon={CalendarCheck} trend="No active jobs" />
        <StatCard label="Completed Today" value="0" icon={CheckCircle}   trend="—" color="gold" />
        <StatCard
          label="Verification"
          value={isLoading ? '…' : me ? COMPLIANCE_LABEL[me.complianceStatus] : '—'}
          icon={me?.assignable ? ShieldCheck : Clock}
          trend={me?.assignable ? 'Cleared for jobs' : 'Not assignable yet'}
          color={me?.assignable ? 'primary' : 'neutral'}
        />
        <StatCard label="Rating" value="—" icon={Star} trend="No reviews yet" color="neutral" />
      </div>

      {me && (
        <section className="mb-8">
          <SectionHeader title="Your account" />
          <div className="rounded-2xl bg-white p-5 grid grid-cols-1 md:grid-cols-3 gap-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="flex items-start gap-3">
              <Building2 className="w-4 h-4 mt-0.5" style={{ color: 'var(--color-neutral-400)' }} />
              <div>
                <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>Provider</p>
                <p className="text-sm font-medium">{me.provider.name}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Wrench className="w-4 h-4 mt-0.5" style={{ color: 'var(--color-neutral-400)' }} />
              <div>
                <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>Skills</p>
                <p className="text-sm font-medium">
                  {me.services.length
                    ? me.services.map((s) => s.name).join(', ')
                    : me.skills.length
                      ? me.skills.map((s) => s.replace(/_/g, ' ')).join(', ')
                      : 'Not set yet — your provider assigns these'}
                </p>
                {me.isLeadCapable && (
                  <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-primary)' }}>Lead technician</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 mt-0.5" style={{ color: 'var(--color-neutral-400)' }} />
              <div>
                <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>Signed in as</p>
                <p className="text-sm font-medium truncate">{me.email}</p>
                {me.phone && <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>{me.phone}</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      <SectionHeader title="Recent Activity" />
      <DashboardEmpty message="No recent activity. Jobs assigned to you will appear here." />
    </DashboardPage>
  );
}
