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
 * Session hand-over: there is ONE session cookie per browser, so accepting an
 * invite necessarily replaces whoever is signed in. If a different account
 * (landlord, customer, …) is already active we say so and make the swap an
 * explicit choice — otherwise the invite silently signs that person out and
 * drops them into the manager account.
 *
 * Error states: expired token (INVITE_EXPIRED), already accepted (INVITE_NOT_PENDING).
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ShieldCheck, AlertCircle, Loader2, UserCog } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { dashboardPath, type AppUser, type UserRole } from '@/contexts/AuthContext';

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

const ROLE_LABELS: Record<UserRole, string> = {
  customer: 'Customer',
  rental_provider: 'Rental Provider',
  service_provider: 'Service Provider',
  manager: 'Asset Manager',
  technician: 'Technician',
  admin: 'Admin',
  super_admin: 'Admin',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  /** Whoever is signed in on THIS browser right now (null when nobody is). */
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Load invite details + the active session side by side. /auth/me 401s when
  // nobody is signed in, which is the common case here — treat it as "no user".
  useEffect(() => {
    if (!token) return;
    let active = true;

    Promise.all([
      apiGet<InviteDetails>(`/invitations/${token}`),
      apiGet<AppUser>('/auth/me').catch(() => null),
    ])
      .then(([data, me]) => {
        if (!active) return;
        setInvite(data);
        setCurrentUser(me);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!active) return;
        setLoadError(err.message ?? 'This invite link is invalid or has expired.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  // A different person is signed in on this browser. Accepting swaps the single
  // session cookie, so it must be a deliberate choice, not a side effect.
  const sessionConflict =
    !!currentUser &&
    !!invite &&
    currentUser.email.trim().toLowerCase() !== invite.email.trim().toLowerCase();

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
      // a bare /dashboard has no page (it 404s). Hard-navigate rather than
      // router.push: the accept just swapped the session cookie, and a client
      // navigation would carry the previous user's AuthContext into the shell.
      const home = invite ? dashboardPath(invite.role) : '/';
      setTimeout(() => window.location.replace(home), 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to accept invite. Please try again.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  /** Leave the invite untouched and send the signed-in user back to their own area. */
  const onKeepCurrentSession = () => {
    window.location.replace(currentUser ? dashboardPath(currentUser.role) : '/');
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
          {sessionConflict && currentUser && (
            <div
              className="rounded-xl p-3.5 text-xs space-y-1.5"
              style={{
                background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 12%, white)',
                border: '1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 35%, white)',
              }}
            >
              <div className="flex items-center gap-2 font-semibold">
                <UserCog className="w-4 h-4 shrink-0" />
                <span>
                  You&apos;re signed in as {currentUser.name || currentUser.email} (
                  {ROLE_LABELS[currentUser.role] ?? currentUser.role})
                </span>
              </div>
              <p style={{ color: 'var(--color-neutral-600)' }}>
                Only one account can be signed in per browser. Accepting this invite signs
                that account out and signs you in as <strong>{invite.email}</strong>.
              </p>
            </div>
          )}

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
            {submitting
              ? 'Accepting…'
              : sessionConflict
                ? 'Sign out & accept invite'
                : 'Accept Invite'}
          </button>

          {sessionConflict && currentUser && (
            <button
              type="button"
              onClick={onKeepCurrentSession}
              disabled={submitting}
              className="w-full py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'var(--color-base-200)', color: 'var(--color-neutral-600)' }}
            >
              Cancel — stay signed in as {currentUser.name || currentUser.email}
            </button>
          )}

          <p className="text-xs text-center" style={{ color: 'var(--color-neutral-400)' }}>
            No password needed — you&apos;ll sign in with a one-time code sent to your email.
          </p>
        </div>
      </div>
    </div>
  );
}
