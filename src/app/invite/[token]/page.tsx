/**
 * Invite acceptance page (/invite/[token])
 *
 * Shown to manager or technician invitees. On load, validates the token via
 * GET /invitations/:token. If valid, renders a sign-up form pre-filled with
 * the invitee's name and email from the invite record.
 *
 * On submit: POST /invitations/:token/accept — creates the user account,
 * role profile, and permission record atomically, then returns a JWT which
 * the proxy stores as an httpOnly cookie. User lands logged in.
 *
 * Error states: expired token (INVITE_EXPIRED), already accepted (INVITE_NOT_PENDING).
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface InviteDetails {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'manager' | 'technician';
  invitedBy?: { name: string };
  metadata: Record<string, boolean> | null;
  expiresAt: string;
  status: string;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const schema = z.object({
  firstName: z.string().min(1, 'Required').max(100),
  lastName: z.string().max(100).optional(),
  phone: z.string().min(7, 'Valid phone required').max(20),
  password: z.string().min(8, 'At least 8 characters'),
  confirmPassword: z.string().min(1, 'Required'),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormValues = z.infer<typeof schema>;

// ─── Permission label map ─────────────────────────────────────────────────────

const PERM_LABELS: Record<string, string> = {
  can_list_properties:    'List properties',
  can_edit_properties:    'Edit properties',
  can_manage_viewings:    'Manage viewings',
  can_manage_agreements:  'Manage agreements',
  can_manage_deposits:    'Manage deposits',
  can_manage_collections: 'Manage collections',
  can_manage_renewals:    'Manage renewals',
  can_manage_documents:   'Manage documents',
  can_view_financials:    'View financials',
  can_communicate_tenants:'Communicate with customers',
  can_escalate_to_admin:  'Escalate to admin',
  can_invite_manager:     'Invite other managers',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', phone: '', password: '', confirmPassword: '' },
  });

  // Load invite details
  useEffect(() => {
    if (!token) return;
    apiGet<InviteDetails>(`/invitations/${token}`)
      .then((data) => {
        setInvite(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setLoadError(err.message ?? 'This invite link is invalid or has expired.');
        setLoading(false);
      });
  }, [token]);

  const onSubmit = async (values: FormValues) => {
    try {
      await apiPost(`/invitations/${token}/accept`, {
        firstName: values.firstName,
        lastName: values.lastName || undefined,
        phone: values.phone,
        password: values.password,
      });
      setSuccess(true);
      // Small delay to show success, then redirect to dashboard
      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to accept invite. Please try again.';
      setError('root', { message });
    }
  };

  const grantedPerms = invite?.metadata
    ? Object.entries(invite.metadata).filter(([, v]) => v).map(([k]) => PERM_LABELS[k] ?? k)
    : [];

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-base-200)' }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--color-primary)' }} />
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (loadError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--color-base-200)' }}>
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{ background: 'var(--color-base-100)', border: '1px solid var(--color-base-200)' }}
        >
          <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-error)' }} />
          <h1 className="text-xl font-bold mb-2">Invite link invalid</h1>
          <p className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>
            This link is no longer valid. Contact your inviter for a new invite link.
          </p>
        </div>
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--color-base-200)' }}>
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{ background: 'var(--color-base-100)', border: '1px solid var(--color-base-200)' }}
        >
          <ShieldCheck className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-primary)' }} />
          <h1 className="text-xl font-bold mb-2">Welcome to UpNow!</h1>
          <p className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>
            Your account has been created. Redirecting to your dashboard…
          </p>
        </div>
      </div>
    );
  }

  const roleLabel = invite.role === 'manager' ? 'Asset Manager' : 'Technician';
  const inviterName = invite.invitedBy?.name ?? 'your account owner';

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-12" style={{ background: 'var(--color-base-200)' }}>
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-base-100)', border: '1px solid var(--color-base-200)' }}
      >
        {/* Header */}
        <div className="px-6 pt-8 pb-5 text-center">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, white)' }}
          >
            <ShieldCheck className="w-7 h-7" style={{ color: 'var(--color-primary)' }} />
          </div>
          <h1 className="text-xl font-bold">You&apos;re invited!</h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--color-neutral-500)' }}>
            <strong>{inviterName}</strong> has invited you to join as a <strong>{roleLabel}</strong>
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-400)' }}>
            for <span className="font-medium">{invite.email}</span>
          </p>
        </div>

        {/* Permission summary (managers only) */}
        {invite.role === 'manager' && grantedPerms.length > 0 && (
          <div className="mx-6 mb-4 rounded-xl p-4" style={{ background: 'var(--color-base-200)' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-neutral-600)' }}>
              Your permissions
            </p>
            <ul className="space-y-1">
              {grantedPerms.map((p) => (
                <li key={p} className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-neutral-600)' }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--color-primary)' }} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-8 space-y-4">
          {errors.root && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'color-mix(in srgb, var(--color-error) 10%, white)', color: 'var(--color-error)' }}>
              {errors.root.message}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="acc-firstName" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>First Name *</label>
              <input
                id="acc-firstName"
                {...register('firstName')}
                defaultValue={invite.firstName ?? ''}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ border: `1px solid ${errors.firstName ? 'var(--color-error)' : 'var(--color-base-200)'}` }}
                placeholder="First name"
              />
              {errors.firstName && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.firstName.message}</p>}
            </div>
            <div>
              <label htmlFor="acc-lastName" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Last Name</label>
              <input
                id="acc-lastName"
                {...register('lastName')}
                defaultValue={invite.lastName ?? ''}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ border: '1px solid var(--color-base-200)' }}
                placeholder="Last name"
              />
            </div>
          </div>

          <div>
            <label htmlFor="acc-phone" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Phone *</label>
            <input
              id="acc-phone"
              {...register('phone')}
              type="tel"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ border: `1px solid ${errors.phone ? 'var(--color-error)' : 'var(--color-base-200)'}` }}
              placeholder="+971 50 000 0000"
            />
            {errors.phone && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.phone.message}</p>}
          </div>

          <div>
            <label htmlFor="acc-password" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Password *</label>
            <input
              id="acc-password"
              {...register('password')}
              type="password"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ border: `1px solid ${errors.password ? 'var(--color-error)' : 'var(--color-base-200)'}` }}
              placeholder="Minimum 8 characters"
            />
            {errors.password && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.password.message}</p>}
          </div>

          <div>
            <label htmlFor="acc-confirmPassword" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Confirm Password *</label>
            <input
              id="acc-confirmPassword"
              {...register('confirmPassword')}
              type="password"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ border: `1px solid ${errors.confirmPassword ? 'var(--color-error)' : 'var(--color-base-200)'}` }}
              placeholder="Repeat password"
            />
            {errors.confirmPassword && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.confirmPassword.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white mt-2"
            style={{ background: 'var(--color-primary)', opacity: isSubmitting ? 0.7 : 1 }}
          >
            {isSubmitting ? 'Creating your account…' : 'Accept Invite & Join'}
          </button>
        </form>
      </div>
    </div>
  );
}
