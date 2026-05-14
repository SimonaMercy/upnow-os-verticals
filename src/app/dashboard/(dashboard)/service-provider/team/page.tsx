'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Users, Plus, Mail, Phone, Trash2, RefreshCw, Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { DashboardPage, SectionHeader } from '@/components/dashboard/DashboardWidgets';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TechnicianMember {
  id: number;
  userId: number;
  specialization: string | null;
  status: string;
  createdAt: string;
  user: { id: number; name: string; email: string; phone: string | null };
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SpTeamPage() {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const qc = useQueryClient();

  const { data: technicians = [], isLoading: loadingTech } = useQuery<TechnicianMember[]>({
    queryKey: ['sp-team'],
    queryFn: () => apiGet('/team/technicians'),
  });

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

  const daysLeft = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  };

  return (
    <DashboardPage
      title="My Team"
      subtitle="Manage technicians working under your service provider account"
      actions={
        <button
          onClick={() => setShowInviteModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus className="w-4 h-4" />
          Invite Technician
        </button>
      }
    >
      {showInviteModal && (
        <InviteTechnicianModal onClose={() => setShowInviteModal(false)} />
      )}

      {/* Active Technicians */}
      <section className="mb-8">
        <SectionHeader title={`Active Technicians (${technicians.length})`} />
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
                  <p className="text-sm font-semibold truncate">{tech.user.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                      <Mail className="w-3 h-3" />{tech.user.email}
                    </span>
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
                <StatusChip status={tech.status} />
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
    </DashboardPage>
  );
}
