'use client';

/**
 * Service Provider — team management panel (technicians roster + invites).
 *
 * Extracted from the former /dashboard/service-provider/team page so it can
 * live inside Settings → Team (the page now redirects there). Skill
 * assignment stays in Rules → Team (job-ready card); this panel owns the
 * roster itself: invite, resend, cancel, status.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Users, Plus, Mail, Phone, Trash2, RefreshCw, Clock, Send, LogIn, ShieldCheck,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { SectionHeader } from '@/components/dashboard/DashboardWidgets';

// ─── Types ───────────────────────────────────────────────────────────────────

/** SP-127: whether the roster member can actually use the app. */
type LoginState = 'none' | 'invited' | 'ready' | 'signed_in';

interface TechnicianMember {
  id: number;
  userId: number;
  specialization: string | null;
  status: string;
  isSelf: boolean;
  isLeadCapable: boolean;
  /** SP-129: UpNow's verdict on the person — dispatch needs `compliant` once Gate 1 is on. */
  complianceStatus: 'pending_review' | 'compliant' | 'action_required' | 'expired' | 'paused';
  loginState: LoginState;
  pendingInviteId: number | null;
  pendingInviteEmail: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  /** email is null for login-less roster entries (placeholder addresses are never returned). */
  user: { id: number; name: string; email: string | null; phone: string | null };
}

interface Invitation {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  expiresAt: string;
  createdAt: string;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email('Valid email required'),
  firstName: z.string().min(1, 'First name required').max(100),
  lastName: z.string().max(100).optional(),
  phone: z.string().optional(),
});
type InviteForm = z.infer<typeof inviteSchema>;

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteTechnicianModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: InviteForm) =>
      apiPost('/invitations', { ...data, role: 'technician' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sp-invites'] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{ background: 'var(--color-base-100)', border: '1px solid var(--color-base-200)' }}
      >
        <h2 className="text-lg font-bold mb-4">Invite Technician</h2>

        {mutation.error && (
          <div
            className="rounded-xl p-3 mb-4 text-sm"
            style={{ background: 'color-mix(in srgb, var(--color-error) 10%, white)', color: 'var(--color-error)' }}
          >
            {(mutation.error as Error).message}
          </div>
        )}

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-firstName" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>
                First Name *
              </label>
              <input
                id="inv-firstName"
                {...register('firstName')}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-colors"
                style={{
                  border: `1px solid ${errors.firstName ? 'var(--color-error)' : 'var(--color-base-200)'}`,
                  background: 'var(--color-base-100)',
                }}
                placeholder="Jane"
              />
              {errors.firstName && (
                <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.firstName.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="inv-lastName" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>
                Last Name
              </label>
              <input
                id="inv-lastName"
                {...register('lastName')}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ border: '1px solid var(--color-base-200)', background: 'var(--color-base-100)' }}
                placeholder="Smith"
              />
            </div>
          </div>

          <div>
            <label htmlFor="inv-email" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>
              Email Address *
            </label>
            <input
              id="inv-email"
              {...register('email')}
              type="email"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{
                border: `1px solid ${errors.email ? 'var(--color-error)' : 'var(--color-base-200)'}`,
                background: 'var(--color-base-100)',
              }}
              placeholder="jane@example.com"
            />
            {errors.email && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="inv-phone" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>
              Phone (optional)
            </label>
            <input
              id="inv-phone"
              {...register('phone')}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ border: '1px solid var(--color-base-200)', background: 'var(--color-base-100)' }}
              placeholder="+971 50 000 0000"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ border: '1px solid var(--color-base-200)', color: 'var(--color-neutral-600)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'var(--color-primary)', opacity: mutation.isPending ? 0.7 : 1 }}
            >
              {mutation.isPending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Invite an existing roster member to the app (SP-127) ────────────────────

const rosterInviteSchema = z.object({
  email: z.string().email('Valid email required'),
  phone: z.string().optional(),
});
type RosterInviteForm = z.infer<typeof rosterInviteSchema>;

function InviteRosterMemberModal({ tech, onClose }: { tech: TechnicianMember; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<RosterInviteForm>({
    resolver: zodResolver(rosterInviteSchema),
    defaultValues: { email: tech.pendingInviteEmail ?? tech.user.email ?? '', phone: tech.user.phone ?? '' },
  });

  const mutation = useMutation({
    mutationFn: (data: RosterInviteForm) =>
      apiPost(`/invitations/technicians/${tech.id}`, { email: data.email, phone: data.phone || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sp-invites'] });
      qc.invalidateQueries({ queryKey: ['sp-team'] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{ background: 'var(--color-base-100)', border: '1px solid var(--color-base-200)' }}
      >
        <h2 className="text-lg font-bold mb-1">Invite {tech.user.name} to the app</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-neutral-500)' }}>
          They&apos;ll get an email link to set up their own login. Their roster entry, skills and job history stay exactly as they are.
        </p>

        {mutation.error && (
          <div
            className="rounded-xl p-3 mb-4 text-sm"
            style={{ background: 'color-mix(in srgb, var(--color-error) 10%, white)', color: 'var(--color-error)' }}
          >
            {(mutation.error as Error).message}
          </div>
        )}

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <div>
            <label htmlFor="ri-email" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>
              Their email address *
            </label>
            <input
              id="ri-email"
              {...register('email')}
              type="email"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{
                border: `1px solid ${errors.email ? 'var(--color-error)' : 'var(--color-base-200)'}`,
                background: 'var(--color-base-100)',
              }}
              placeholder="jane@example.com"
            />
            {errors.email && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.email.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="ri-phone" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>
              Phone (optional)
            </label>
            <input
              id="ri-phone"
              {...register('phone')}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ border: '1px solid var(--color-base-200)', background: 'var(--color-base-100)' }}
              placeholder="+971 50 000 0000"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ border: '1px solid var(--color-base-200)', color: 'var(--color-neutral-600)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'var(--color-primary)', opacity: mutation.isPending ? 0.7 : 1 }}
            >
              {mutation.isPending ? 'Sending…' : tech.loginState === 'invited' ? 'Resend Invite' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Verification (SP-129) ───────────────────────────────────────────────────

function VerificationChip({ status }: { status: TechnicianMember['complianceStatus'] }) {
  const map: Record<TechnicianMember['complianceStatus'], { label: string; bg: string; text: string }> = {
    compliant:       { label: 'Verified', bg: 'color-mix(in srgb, var(--color-primary) 12%, white)', text: 'var(--color-primary)' },
    pending_review:  { label: 'Pending verification', bg: 'color-mix(in srgb, #d97706 12%, white)', text: '#d97706' },
    action_required: { label: 'Action required', bg: 'color-mix(in srgb, var(--color-error) 12%, white)', text: 'var(--color-error)' },
    expired:         { label: 'Document expired', bg: 'color-mix(in srgb, var(--color-neutral-400) 15%, white)', text: 'var(--color-neutral-500)' },
    paused:          { label: 'Verification paused', bg: 'color-mix(in srgb, #d97706 12%, white)', text: '#d97706' },
  };
  const s = map[status] ?? map.pending_review;
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.text }}
      title={status === 'compliant' ? 'UpNow has verified this technician' : 'Not yet cleared for dispatch by UpNow'}>
      <ShieldCheck className="w-3 h-3" />{s.label}
    </span>
  );
}

// ─── Login state (SP-127) ────────────────────────────────────────────────────

function LoginStateChip({ tech }: { tech: TechnicianMember }) {
  if (tech.isSelf) return null;
  const map: Record<LoginState, { label: string; bg: string; text: string }> = {
    none:      { label: 'No app login', bg: 'color-mix(in srgb, var(--color-neutral-400) 15%, white)', text: 'var(--color-neutral-500)' },
    invited:   { label: 'Invite pending', bg: 'color-mix(in srgb, #d97706 12%, white)', text: '#d97706' },
    ready:     { label: 'Can sign in', bg: 'color-mix(in srgb, var(--color-primary) 12%, white)', text: 'var(--color-primary)' },
    signed_in: { label: 'App user', bg: 'color-mix(in srgb, var(--color-primary) 12%, white)', text: 'var(--color-primary)' },
  };
  const s = map[tech.loginState];
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.text }}
      title={tech.lastLoginAt ? `Last signed in ${new Date(tech.lastLoginAt).toLocaleDateString()}` : undefined}
    >
      <LogIn className="w-3 h-3" />{s.label}
    </span>
  );
}

// ─── Status chip ─────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    active:    { bg: 'color-mix(in srgb, var(--color-primary) 12%, white)', text: 'var(--color-primary)' },
    pending:   { bg: 'color-mix(in srgb, #d97706 12%, white)', text: '#d97706' },
    accepted:  { bg: 'color-mix(in srgb, var(--color-primary) 12%, white)', text: 'var(--color-primary)' },
    expired:   { bg: 'color-mix(in srgb, var(--color-neutral-400) 15%, white)', text: 'var(--color-neutral-500)' },
    cancelled: { bg: 'color-mix(in srgb, var(--color-error) 12%, white)', text: 'var(--color-error)' },
  };
  const s = styles[status] ?? styles.expired;
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize"
      style={{ background: s.bg, color: s.text }}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function SpTeamPanel() {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [rosterInvite, setRosterInvite] = useState<TechnicianMember | null>(null);
  const qc = useQueryClient();

  const { data: technicians = [], isLoading: loadingTech } = useQuery<TechnicianMember[]>({
    queryKey: ['sp-team'],
    queryFn: () => apiGet('/team/technicians'),
  });
  // SP-254: a solo operator (individual) IS the technician — no crew to invite.
  const { data: jobReady } = useQuery<{ supplyType?: 'solo' | 'company' }>({
    queryKey: ['sp-job-ready-supply'],
    queryFn: () => apiGet('/service-provider/job-ready'),
    staleTime: 60_000,
  });
  const solo = jobReady?.supplyType === 'solo';

  const { data: invites = [], isLoading: loadingInvites } = useQuery<Invitation[]>({
    queryKey: ['sp-invites'],
    queryFn: () => apiGet('/invitations?status=pending'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sp-invites'] }),
  });

  const resendMutation = useMutation({
    mutationFn: (id: number) => apiPost(`/invitations/${id}/resend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sp-invites'] }),
  });

  // Captured once per mount — keeps render pure (react-hooks/purity); the
  // day-level countdown doesn't need live ticking.
  const [now] = useState(() => Date.now());
  const daysLeft = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - now;
    return Math.max(0, Math.ceil(diff / 86400000));
  };

  return (
    <div>
      {showInviteModal && (
        <InviteTechnicianModal onClose={() => setShowInviteModal(false)} />
      )}
      {rosterInvite && (
        <InviteRosterMemberModal tech={rosterInvite} onClose={() => setRosterInvite(null)} />
      )}

      {/* Active Technicians */}
      <section className="mb-8">
        <SectionHeader
          title={solo ? 'You are the technician' : `Technicians (${technicians.length})`}
          action={solo ? undefined : (
            <button
              onClick={() => setShowInviteModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <Plus className="w-4 h-4" />
              Invite Technician
            </button>
          )}
        />
        {solo && (
          <p className="mb-3 text-[12.5px]" style={{ color: 'var(--color-neutral-500)' }}>
            You&apos;re registered as an individual, so jobs are dispatched to you directly — your provider verification covers you and there is no crew to invite.
            Want to run a team later? Ask UpNow to switch your account to a company profile.
          </p>
        )}
        {loadingTech ? (
          <div className="rounded-2xl p-8 text-center text-sm bg-white" style={{ boxShadow: 'var(--shadow-sm)', color: 'var(--color-neutral-400)' }}>
            Loading…
          </div>
        ) : technicians.length === 0 ? (
          <div
            className="rounded-2xl p-8 flex flex-col items-center justify-center gap-3 text-center bg-white"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <Users className="w-8 h-8" style={{ color: 'var(--color-neutral-300)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-neutral-600)' }}>No technicians yet</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-400)' }}>
                Invite your first technician using the button above
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {technicians.map((tech) => (
              <div
                key={tech.id}
                className="flex items-center gap-4 px-5 py-4 bg-white rounded-2xl"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-primary) 15%, white)', color: 'var(--color-primary)' }}
                >
                  {tech.user.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {tech.user.name}
                    {tech.isSelf && <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--color-neutral-500)' }}>(you)</span>}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {tech.user.email ? (
                      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                        <Mail className="w-3 h-3" />{tech.user.email}
                      </span>
                    ) : tech.pendingInviteEmail ? (
                      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                        <Mail className="w-3 h-3" />{tech.pendingInviteEmail} · invite sent
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>
                        Roster entry — no email on file
                      </span>
                    )}
                    {tech.user.phone && (
                      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                        <Phone className="w-3 h-3" />{tech.user.phone}
                      </span>
                    )}
                  </div>
                </div>
                {tech.specialization && (
                  <span className="text-xs px-2 py-0.5 rounded-lg" style={{ background: 'var(--color-base-200)', color: 'var(--color-neutral-600)' }}>
                    {tech.specialization}
                  </span>
                )}
                <VerificationChip status={tech.complianceStatus} />
                <LoginStateChip tech={tech} />
                <StatusChip status={tech.status} />
                {!tech.isSelf && tech.loginState !== 'signed_in' && (
                  <button
                    onClick={() => setRosterInvite(tech)}
                    title={tech.loginState === 'invited' ? 'Resend the app invite' : 'Invite to the app'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-base-200"
                    style={{ color: 'var(--color-primary)', border: '1px solid var(--color-base-200)' }}
                  >
                    <Send className="w-3.5 h-3.5" />
                    {tech.loginState === 'invited' ? 'Resend' : 'Invite to app'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending Invites */}
      {(loadingInvites || invites.length > 0) && (
        <section>
          <SectionHeader title={`Pending Invites (${invites.length})`} />
          <div className="space-y-3">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-4 px-5 py-4 bg-white rounded-2xl"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, #d97706 12%, white)' }}
                >
                  <Clock className="w-4 h-4" style={{ color: '#d97706' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {inv.firstName} {inv.lastName ?? ''}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
                    {inv.email} · Expires in {daysLeft(inv.expiresAt)} day{daysLeft(inv.expiresAt) !== 1 ? 's' : ''}
                  </p>
                </div>
                <StatusChip status={inv.status} />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => resendMutation.mutate(inv.id)}
                    disabled={resendMutation.isPending}
                    title="Resend invite"
                    className="p-1.5 rounded-lg transition-colors hover:bg-base-200"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => cancelMutation.mutate(inv.id)}
                    disabled={cancelMutation.isPending}
                    title="Cancel invite"
                    className="p-1.5 rounded-lg transition-colors hover:bg-base-200"
                    style={{ color: 'var(--color-error)' }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
