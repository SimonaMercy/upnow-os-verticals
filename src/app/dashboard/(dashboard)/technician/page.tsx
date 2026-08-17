'use client';

/**
 * Technician home (SP-127) — the first screen a technician sees after
 * accepting their provider's invite. Built from GET /technician/me: who they
 * are, which provider they work for, and whether UpNow has cleared them for
 * jobs yet. Jobs / schedule / earnings arrive with SP-95 / SP-103 / SP-182.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/lib/api';
import { DashboardPage, StatCard, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import {
  Building2, CalendarCheck, Clock, ShieldAlert, ShieldCheck, Star, Wrench,
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
  /** SP-131 */
  kyc?: { requiredMissing: string[]; rejected: number; expired: number; expiringSoon: number; complete: boolean };
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
  // SP-103 · next rostered shift (upcoming, not cancelled) — the roster is the provider's; I confirm from My shifts.
  const { data: shiftsRes } = useQuery<{ shifts: Array<{ id: number; status: string; phase: string; shiftStartAt: string; shiftEndAt: string; zones: Array<{ label: string }> }> }>({
    queryKey: ['technician-shifts-next'],
    queryFn: () => apiGet(`/technician/shifts?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 28 * 864e5).toISOString())}`),
    staleTime: 60_000,
    enabled: !!me,
  });
  const nextShift = shiftsRes?.shifts.find((s) => s.phase !== 'past' && s.status !== 'cancelled') ?? null;
  const toConfirm = shiftsRes?.shifts.filter((s) => s.phase !== 'past' && s.status === 'assigned').length ?? 0;
  const shiftConflicts = shiftsRes?.shifts.filter((s) => s.phase !== 'past' && s.status === 'conflict_reported').length ?? 0;
  const tz = 'Asia/Dubai';
  const shiftDay = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  const shiftTime = (iso: string) => new Date(iso).toLocaleTimeString('en-AE', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const nextShiftValue = !nextShift ? '—' : nextShift.phase === 'live' ? 'Now' : shiftDay(nextShift.shiftStartAt);
  const nextShiftTrend = !nextShift
    ? 'No shifts rostered'
    : [
        nextShift.phase === 'live' ? `until ${shiftTime(nextShift.shiftEndAt)}` : `${shiftTime(nextShift.shiftStartAt)}–${shiftTime(nextShift.shiftEndAt)}`,
        nextShift.zones.length ? nextShift.zones.map((z) => z.label).join(', ') : null,
        shiftConflicts ? `${shiftConflicts} conflict${shiftConflicts === 1 ? '' : 's'}` : toConfirm ? `${toConfirm} to confirm` : null,
      ].filter(Boolean).join(' · ');

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

      {/* SP-131 · the one thing a new technician must do: put their EID + visa on file. */}
      {me?.kyc && (!me.kyc.complete || me.kyc.rejected > 0 || me.kyc.expired > 0 || me.kyc.expiringSoon > 0) && (
        <Link
          href="/dashboard/technician/documents"
          className="block rounded-2xl px-5 py-4 mb-6 bg-white transition-shadow hover:shadow-md"
          style={{ boxShadow: 'var(--shadow-sm)', border: '1px solid color-mix(in srgb, #d97706 35%, white)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
            {!me.kyc.complete
              ? `Upload your ${me.kyc.requiredMissing.map((k) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).join(' and ')} →`
              : me.kyc.rejected > 0
                ? `${me.kyc.rejected} document${me.kyc.rejected === 1 ? ' was' : 's were'} rejected — re-upload →`
                : me.kyc.expired > 0
                  ? `${me.kyc.expired} document${me.kyc.expired === 1 ? ' has' : 's have'} expired — replace →`
                  : `${me.kyc.expiringSoon} document${me.kyc.expiringSoon === 1 ? ' expires' : 's expire'} within 30 days →`}
          </p>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
            UpNow reviews your Emirates ID and residence visa before jobs can be assigned to you.
          </p>
        </Link>
      )}

      {/* Stats — job counters light up with SP-95; the account facts are live now. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Assigned Jobs"   value="0" icon={CalendarCheck} trend="No active jobs" />
        <Link href="/dashboard/technician/schedule" className="block">
          <StatCard label="Next shift" value={nextShiftValue} icon={CalendarCheck} trend={nextShiftTrend} color={shiftConflicts ? 'error' : nextShift ? 'gold' : 'neutral'} />
        </Link>
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
