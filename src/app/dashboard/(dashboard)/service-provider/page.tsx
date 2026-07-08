/**
 * Service Provider — Overview Dashboard (dashboard/service-provider)
 *
 * Entry point for SP accounts, wired to every sidebar destination:
 *   1. Go-live journey strip — profile → KYC docs → compliance (GATE 1) →
 *      services; each step is server-state-driven and links where the work
 *      happens. Hidden once the account is fully live.
 *   2. KPI row — new requests / active jobs / earnings (month) / team size.
 *   3. Pipeline snapshot — per-pipeline counts deep-linking into
 *      /operations?tab=… (same partition logic as the Operations page via
 *      bookingPipeline; counts always agree).
 *   4. Quick-action cards — My Services, Team, Documents & KYC with live
 *      sub-lines.
 *
 * Booking/service numbers come from endpoints that ship in SP Sprints 1–3
 * (SP_EXECUTION_PLAN_2026-07-02); all fetches are tolerant so the page shows
 * honest zeros today and lights up as each backend piece lands. Profile, KYC,
 * team and invitation data are live already.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, StatCard, SectionHeader, QuickAction } from '@/components/dashboard/DashboardWidgets';
import { ProfileCompletionBanner } from '@/components/dashboard/ProfileCompletionBanner';
import { bookingPipeline, type SpBooking, type SpPipelineTab } from '@/components/upnow/SpOperationsPipelines';
import { apiGet } from '@/lib/api';
import {
  Briefcase, CalendarCheck, Star, Wallet, Plus, CheckCircle2, ShieldAlert, Lock,
  Inbox, FileText, Wrench, Users, ChevronRight, ClipboardList,
} from 'lucide-react';

/* ── Server shapes (defensive) ─────────────────────────────────────────────── */
interface SpProfile {
  businessName?: string | null;
  ownerName?: string | null;
  entityType?: string | null;
  complianceStatus?: string | null;
  serviceCategories?: string | null;   // CSV
  emiratesServed?: string | null;      // CSV
}
interface KycStatus {
  hasProfile: boolean;
  complianceStatus: string | null;
  isCompliant: boolean;
  requiredDocumentsMissing?: number;
  totalRequired?: number;
  totalUploaded?: number;
}
interface SpService { id: number; listingStatus?: string | null }

const asArray = <T,>(d: unknown): T[] =>
  Array.isArray(d) ? d as T[] : (Array.isArray((d as { data?: T[] })?.data) ? (d as { data: T[] }).data : []);

/* ── KYC status banner (kept from the original page) ───────────────────────── */
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
            <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--color-primary)' }}>Under review</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-600)' }}>
              Our compliance team is verifying your documents. This usually takes less than 24 hours.
            </p>
          </div>
        </div>
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
            <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--color-error)' }}>Action required</p>
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

/* ── Go-live journey strip ─────────────────────────────────────────────────── */
interface JourneyStep { key: string; label: string; sub: string; done: boolean; href: string }

function JourneyStrip({ steps }: { steps: JourneyStep[] }) {
  const doneCount = steps.filter(s => s.done).length;
  const current = steps.find(s => !s.done)?.key;
  return (
    <div className="rounded-2xl bg-white p-5 mb-6" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>Get your business live</h2>
        <span className="text-xs font-medium" style={{ color: 'var(--color-neutral-400)' }}>{doneCount}/{steps.length} complete</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {steps.map((s, i) => {
          const active = s.key === current;
          return (
            <Link
              key={s.key}
              href={s.href}
              className="flex items-start gap-3 rounded-xl border p-3 transition-colors hover:border-[var(--color-primary)]"
              style={{
                borderColor: active ? 'var(--color-primary)' : 'var(--color-base-200)',
                background: active ? 'color-mix(in srgb, var(--color-primary) 5%, white)' : undefined,
              }}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                style={s.done
                  ? { background: 'var(--color-primary)', color: 'white' }
                  : { background: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}
              >
                {s.done ? <CheckCircle2 size={14} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight" style={{ color: 'var(--color-neutral-900)' }}>{s.label}</span>
                <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-neutral-400)' }}>{s.sub}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── Pipeline snapshot strip (deep-links into /operations tabs) ────────────── */
const PIPELINES: { key: SpPipelineTab; label: string; icon: typeof Inbox }[] = [
  { key: 'requests', label: 'Requests',    icon: Inbox },
  { key: 'quotes',   label: 'Quotes',      icon: FileText },
  { key: 'active',   label: 'Active Jobs', icon: Wrench },
  { key: 'closure',  label: 'Closure',     icon: Wallet },
];

function PipelineStrip({ counts }: { counts: Record<SpPipelineTab, number> }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {PIPELINES.map(p => {
        const Icon = p.icon;
        return (
          <Link
            key={p.key}
            href={`/dashboard/service-provider/operations?tab=${p.key}`}
            className="flex items-center gap-3 rounded-2xl bg-white p-4 group hover:shadow-md transition-shadow"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-primary-50)' }}>
              <Icon size={16} style={{ color: 'var(--color-primary)' }} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium" style={{ color: 'var(--color-neutral-500)' }}>{p.label}</span>
              <span className="block text-lg font-bold leading-tight" style={{ color: 'var(--color-neutral-900)' }}>{counts[p.key]}</span>
            </span>
            <ChevronRight size={15} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-neutral-400)' }} />
          </Link>
        );
      })}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */
export default function ServiceProviderOverview() {
  const { user } = useAuth();
  const name = user?.name ?? user?.firstName ?? 'there';

  const [profile, setProfile] = useState<SpProfile | null>(null);
  const [kyc, setKyc] = useState<KycStatus | null>(null);
  const [techCount, setTechCount] = useState(0);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [bookings, setBookings] = useState<SpBooking[]>([]);
  const [services, setServices] = useState<SpService[]>([]);
  const [jobReady, setJobReady] = useState<{ jobReady: boolean; cards: Record<string, { complete: boolean }> } | null>(null);

  useEffect(() => {
    // Live today: profile, kyc-status, team, invitations.
    // Tolerant (land in SP Sprints 1–3): services, bookings.
    apiGet<SpProfile>('/profiles/service-provider/me').then(setProfile).catch(() => {});
    apiGet<KycStatus>('/profiles/service-provider/me/kyc-status').then(setKyc).catch(() => {});
    apiGet<unknown>('/team/technicians').then(d => setTechCount(asArray(d).length)).catch(() => {});
    apiGet<unknown>('/invitations?status=pending').then(d => setPendingInvites(asArray(d).length)).catch(() => {});
    apiGet<unknown>('/service-provider/services').then(d => setServices(asArray<SpService>(d))).catch(() => {});
    apiGet<unknown>('/bookings').then(d => setBookings(asArray<SpBooking>(d))).catch(() => {});
    apiGet<{ jobReady: boolean; cards: Record<string, { complete: boolean }> }>('/service-provider/job-ready').then(setJobReady).catch(() => {});
  }, []);

  const pipelineCounts = useMemo(() => {
    const counts: Record<SpPipelineTab, number> = { requests: 0, quotes: 0, active: 0, closure: 0 };
    for (const b of bookings) { const t = bookingPipeline(b); if (t) counts[t] += 1; }
    return counts;
  }, [bookings]);

  const monthEarnings = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    return bookings
      .filter(b => ['completed', 'escrow_release'].includes((b.status ?? '').toLowerCase()))
      .filter(b => ((b.updatedAt ?? b.createdAt ?? '')).slice(0, 7) === ym)
      .reduce((sum, b) => sum + Number(b.totalAmount ?? b.price ?? 0), 0);
  }, [bookings]);

  const publishedServices = services.filter(s => ['approved', 'published'].includes((s.listingStatus ?? '').toLowerCase())).length;

  // Go-live journey (GATE 1 + listings), each step server-state-driven.
  const steps: JourneyStep[] = useMemo(() => {
    const profileDone = Boolean(profile?.businessName && profile?.serviceCategories && profile?.emiratesServed);
    const docsTotal = kyc?.totalRequired ?? 0;
    const docsUploaded = kyc?.totalUploaded ?? 0;
    const docsDone = docsTotal > 0 && (kyc?.requiredDocumentsMissing ?? 1) === 0;
    const compliant = Boolean(kyc?.isCompliant);
    const compliance = (kyc?.complianceStatus ?? 'pending_review').replace(/_/g, ' ');
    return [
      { key: 'profile',    label: 'Business profile', done: profileDone, href: '/dashboard/service-provider/onboarding',
        sub: profileDone ? (profile?.businessName ?? 'Complete') : 'Finish the setup wizard' },
      { key: 'documents',  label: 'KYC documents',    done: docsDone, href: '/dashboard/service-provider/documents',
        sub: docsTotal ? `${Math.min(docsUploaded, docsTotal)}/${docsTotal} uploaded` : 'Trade licence, Emirates ID…' },
      { key: 'compliance', label: 'UpNow approval',   done: compliant, href: '/dashboard/service-provider/documents',
        sub: compliant ? 'Approved' : compliance },
      { key: 'services',   label: 'List your services', done: services.length > 0, href: '/dashboard/service-provider/services',
        sub: services.length ? `${services.length} listed` : 'Pick from the catalog' },
      { key: 'jobready',   label: 'Get job-ready',    done: Boolean(jobReady?.jobReady), href: '/dashboard/service-provider/onboarding',
        sub: jobReady?.jobReady ? 'Receiving jobs' :
          !compliant ? 'Unlocks after approval' :
          jobReady ? `${Object.values(jobReady.cards).filter(c => c.complete).length}/5 cards` : 'Coverage, team, vehicles…' },
    ];
  }, [profile, kyc, services, jobReady]);

  const live = steps.every(s => s.done);

  return (
    <DashboardPage
      title={`Welcome, ${name}`}
      subtitle={profile?.businessName ? `${profile.businessName} — services, jobs and team at a glance.` : 'Manage your services, jobs and team.'}
      actions={
        <Link
          href="/dashboard/service-provider/services"
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={16} /> Add Service
        </Link>
      }
    >
      {user?.kycStatus && <KycStatusBanner kycStatus={user.kycStatus} />}
      <ProfileCompletionBanner />

      {/* Go-live journey — hidden once fully live */}
      {!live && <JourneyStrip steps={steps} />}

      {/* Post-approval nudge — approved but not yet job-ready */}
      {Boolean(kyc?.isCompliant) && jobReady && !jobReady.jobReady && (
        <Link href="/dashboard/service-provider/onboarding"
          className="mb-6 flex items-center gap-4 rounded-2xl p-4 transition-shadow hover:shadow-md"
          style={{ background: '#EAF5EE', border: '1px solid #CBE5D6' }}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white" style={{ background: '#08603D' }}>
            {Object.values(jobReady.cards).filter(c => c.complete).length}/5
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold" style={{ color: '#182420' }}>
              You&apos;re approved — {5 - Object.values(jobReady.cards).filter(c => c.complete).length} card{5 - Object.values(jobReady.cards).filter(c => c.complete).length === 1 ? '' : 's'} left before bookings reach you
            </span>
            <span className="block text-[13px]" style={{ color: '#55645B' }}>Coverage, team, vehicles, hours, job rules — a few minutes total</span>
          </span>
          <span className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: '#0B7A4E' }}>Get job-ready →</span>
        </Link>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="New Requests"    value={pipelineCounts.requests} icon={Inbox}
          trend={pipelineCounts.requests ? 'Awaiting confirmation' : 'No incoming requests'} />
        <StatCard label="Active Jobs"     value={pipelineCounts.active} icon={CalendarCheck}
          trend={pipelineCounts.active ? 'In the field now' : 'No jobs in progress'} color="gold" />
        <StatCard label="Earnings (AED)"  value={monthEarnings.toLocaleString('en-AE')} icon={Wallet}
          trend="This month" color="neutral" />
        <StatCard label="Team"            value={techCount} icon={Users}
          trend={pendingInvites ? `${pendingInvites} invite${pendingInvites === 1 ? '' : 's'} pending` : 'Technicians'} color="neutral" />
      </div>

      {/* Pipeline snapshot → Operations tabs */}
      <SectionHeader
        title="Booking pipelines"
        action={
          <Link href="/dashboard/service-provider/operations" className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: 'var(--color-primary)' }}>
            <ClipboardList size={13} /> Open Operations
          </Link>
        }
      />
      <PipelineStrip counts={pipelineCounts} />

      {/* Shortcuts to the rest of the portal */}
      <SectionHeader title="Manage" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickAction
          label="My Services" href="/dashboard/service-provider/services" icon={Briefcase}
          description={services.length ? `${services.length} listed · ${publishedServices} live` : 'Pick services from the catalog'}
        />
        <QuickAction
          label="Team" href="/dashboard/service-provider/team" icon={Users}
          description={`${techCount} technician${techCount === 1 ? '' : 's'}${pendingInvites ? ` · ${pendingInvites} pending` : ''}`}
        />
        <QuickAction
          label="Documents & KYC" href="/dashboard/service-provider/documents" icon={FileText}
          description={kyc?.totalRequired ? `${Math.min(kyc.totalUploaded ?? 0, kyc.totalRequired)}/${kyc.totalRequired} uploaded` : 'Compliance documents'}
        />
        <QuickAction
          label="Reviews" href="/dashboard/service-provider/reviews" icon={Star}
          description="Ratings appear after completed jobs"
        />
      </div>
    </DashboardPage>
  );
}
