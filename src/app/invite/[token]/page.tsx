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
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { dashboardPath } from '@/contexts/AuthContext';

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

// The invitee supplies nothing — name/email/permissions are set by the inviter
// and sign-in is via email one-time code. Accepting just confirms the invite.

// ─── Component ───────────────────────────────────────────────────────────────

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

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

  const onAccept = async () => {
    setFormError(null);
    setSubmitting(true);
    try {
      await apiPost(`/invitations/${token}/accept`, {
        // Everything is carried from the invite (set by the inviter). No phone or
        // password — sign-in is via email OTP.
        firstName: invite?.firstName?.trim() || invite?.email.split('@')[0] || 'Member',
        lastName: invite?.lastName || undefined,
      });
      setSuccess(true);
      // Small delay to show success, then land on the ROLE's home —
      // a bare /dashboard has no page (it 404s).
      const home = invite ? dashboardPath(invite.role) : '/';
      setTimeout(() => router.push(home), 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to accept invite. Please try again.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

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
  const inviteeName = `${invite.firstName ?? ''} ${invite.lastName ?? ''}`.trim() || invite.email;

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-12" style={{ background: 'var(--color-base-200)' }}>
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-base-100)', border: '1px solid var(--color-base-200)' }}
      >
        {/* Header — UpNow brand */}
        <div className="px-6 pt-8 pb-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-5">
            <span style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #1f8a6e 0%, #34c79f 100%)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 17 }}>U</span>
            <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.01em' }}>UpNow</span>
          </div>
          <h1 className="text-xl font-bold">You&apos;re invited!</h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--color-neutral-500)' }}>
            <strong>{inviterName}</strong> has invited you to join as a <strong>{roleLabel}</strong>
          </p>
        </div>

        {/* Account details — set by the inviter (read-only) */}
        <div className="mx-6 mb-4 rounded-xl p-4 space-y-2" style={{ background: 'var(--color-base-200)' }}>
          <div className="flex justify-between gap-3 text-sm">
            <span style={{ color: 'var(--color-neutral-500)' }}>Name</span>
            <span className="font-medium text-right">{inviteeName}</span>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <span style={{ color: 'var(--color-neutral-500)' }}>Email</span>
            <span className="font-medium text-right break-all">{invite.email}</span>
          </div>
        </div>

        {/* Accept */}
        <div className="px-6 pb-8 space-y-4">
          {formError && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'color-mix(in srgb, var(--color-error) 10%, white)', color: 'var(--color-error)' }}>
              {formError}
            </div>
          )}

          <label className="flex items-start gap-2.5 text-xs cursor-pointer" style={{ color: 'var(--color-neutral-600)' }}>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 w-4 h-4"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            <span>
              I accept UpNow&apos;s <strong>Terms &amp; Conditions</strong> and <strong>Privacy Policy</strong>.
            </span>
          </label>

          <button
            type="button"
            onClick={onAccept}
            disabled={submitting || !termsAccepted}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--color-primary)', opacity: submitting || !termsAccepted ? 0.6 : 1, cursor: submitting || !termsAccepted ? 'not-allowed' : 'pointer' }}
          >
            {submitting ? 'Accepting…' : 'Accept Invite'}
          </button>

          <p className="text-xs text-center" style={{ color: 'var(--color-neutral-400)' }}>
            No password needed — you&apos;ll sign in with a one-time code sent to your email.
          </p>
        </div>
      </div>
    </div>
  );
}
