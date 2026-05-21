'use client';

/**
 * Rental Provider onboarding gate.
 *
 * Mounted inside the /rental-provider/dashboard layout. For RP users, it
 * checks whether the profile has been submitted (accountTypeConfirmedAt is
 * set). If not, it forces a redirect to the onboarding page so a new account
 * cannot bypass the flow.
 *
 * The onboarding route itself is exempt (no redirect loop), and admins
 * viewing RP pages by URL are exempt too (only role=rental_provider is gated).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/lib/api';

const ONBOARDING_PATH = '/rental-provider/dashboard/onboarding';

interface ProfilePeek {
  profile?: { accountTypeConfirmedAt: string | null; complianceStatus?: string };
}

/**
 * RP users are gated to the onboarding screen until two conditions are true:
 *   1. They have submitted their application (accountTypeConfirmedAt is set), AND
 *   2. Compliance review is approved (complianceStatus is COMPLIANT).
 *
 * If either condition is missing, they're forced back to /onboarding — where
 * the page itself renders either the form (if not submitted), the under-review
 * waiting screen (if pending), or the action-required edit view (if the admin
 * sent it back).
 */
export function RpOnboardingGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

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
        const approved = p?.complianceStatus === 'compliant';
        if (!submitted || !approved) {
          router.replace(ONBOARDING_PATH);
        } else {
          setAllowed(true);
        }
      })
      .catch(() => {
        if (!cancelled) router.replace(ONBOARDING_PATH);
      })
      .finally(() => { if (!cancelled) setChecked(true); });

    return () => { cancelled = true; };
  }, [user, pathname, router]);

  if (!checked || !allowed) return null;
  return <>{children}</>;
}
