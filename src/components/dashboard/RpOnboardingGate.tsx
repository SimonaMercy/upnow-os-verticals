'use client';

/**
 * Rental Provider onboarding gate.
 *
 * Mounted inside the /rental-provider/dashboard layout. Gates RP users by their
 * compliance state rather than blindly bouncing every non-approved account to a
 * generic setup form:
 *   - never submitted (accountTypeConfirmedAt null) → hard redirect to /onboarding
 *     (a brand-new account must complete first-time setup before any access).
 *   - paused (admin enforcement hold)               → hard redirect to /onboarding
 *     (not self-fixable; the page shows a "paused" screen).
 *   - compliant                                     → full dashboard, no banner.
 *   - submitted but pending_review / action_required / expired → dashboard
 *     ALLOWED, with a sticky status banner pointing back to /onboarding so the
 *     RP can see exactly what's outstanding and resolve it.
 *
 * IMPORTANT: this is a read/UX gate only. Letting non-compliant (non-paused) RPs
 * in means WRITE actions (listing, contracts, payment collection) must still be
 * enforced server-side for true compliance — see the follow-up RpComplianceGuard.
 *
 * The onboarding route itself is exempt (no redirect loop), and non-RP users
 * (e.g. admins viewing RP pages by URL) are exempt too.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/lib/api';
import { ComplianceBanner } from './ComplianceBanner';

const ONBOARDING_PATH = '/rental-provider/dashboard/onboarding';

// States that must finish a flow before the RP can use any dashboard route.
const HARD_BLOCKED = new Set(['paused']);

interface ProfilePeek {
  profile?: { accountTypeConfirmedAt: string | null; complianceStatus?: string; complianceNotes?: string | null };
}

export function RpOnboardingGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  useEffect(() => {
    // Skip gate for the onboarding page itself, and for non-RP users.
    if (!user || user.role !== 'rental_provider' || pathname === ONBOARDING_PATH) {
      setAllowed(true);
      setChecked(true);
      return;
    }

    let cancelled = false;
    apiGet<ProfilePeek>('/profiles/rental-provider/me')
      .then((res) => {
        if (cancelled) return;
        const p = res?.profile;
        const submitted = !!p?.accountTypeConfirmedAt;
        const st = p?.complianceStatus ?? null;
        // Hard-block only the cases that must complete a flow first: a brand-new
        // account that never submitted, or an admin-paused account.
        if (!submitted || (st && HARD_BLOCKED.has(st))) {
          router.replace(ONBOARDING_PATH);
          return;
        }
        // compliant + pending_review / action_required / expired all get in; the
        // banner (below) nudges the non-compliant ones to finish verification.
        setStatus(st);
        setNotes(p?.complianceNotes ?? null);
        setAllowed(true);
      })
      .catch(() => {
        if (!cancelled) router.replace(ONBOARDING_PATH);
      })
      .finally(() => { if (!cancelled) setChecked(true); });

    return () => { cancelled = true; };
  }, [user, pathname, router]);

  if (!checked || !allowed) return null;

  const showBanner = !!status && status !== 'compliant' && pathname !== ONBOARDING_PATH;
  return (
    <>
      {showBanner && <ComplianceBanner status={status} notes={notes} />}
      {children}
    </>
  );
}
