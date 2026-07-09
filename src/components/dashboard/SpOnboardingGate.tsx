'use client';

/**
 * Service Provider onboarding gate.
 *
 * Mounted in the /dashboard/service-provider layout. Unlike the RP gate
 * (which lets submitted-but-unreviewed accounts browse with a banner), the SP
 * portal is approval-gated end to end: an SP sees NOTHING of the dashboard
 * until compliance review approves them.
 *   - compliant → full dashboard.
 *   - anything else (no profile, wizard incomplete, pending_review,
 *     action_required, expired, paused) → redirect to /onboarding, which
 *     renders the right phase itself: the setup wizard, the rejected
 *     "fix & re-submit" walk-through, or the under-review screen.
 *
 * Exempt routes:
 *   - /onboarding (no redirect loop),
 *   - /documents — rejected SPs must be able to re-upload flagged files;
 *     the reviewer-note banner and rejection emails link here.
 * Non-SP users (e.g. admins opening SP URLs) are exempt.
 *
 * Like the RP gate this is a read/UX gate only — write actions are enforced
 * server-side by compliance checks on the SP endpoints.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/lib/api';

const ONBOARDING_PATH = '/dashboard/service-provider/onboarding';
const EXEMPT_PATHS = [ONBOARDING_PATH, '/dashboard/service-provider/documents'];

export function SpOnboardingGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  // The approved verdict is remembered per path; navigating to another gated
  // path re-checks (fresh loader) so a mid-session verdict change is caught.
  const [approvedFor, setApprovedFor] = useState<string | null>(null);

  const exempt =
    !user || user.role !== 'service_provider' || EXEMPT_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (exempt) return;
    let cancelled = false;
    apiGet<{ isCompliant: boolean }>('/profiles/service-provider/me/kyc-status')
      .then((kyc) => {
        if (cancelled) return;
        if (kyc.isCompliant) setApprovedFor(pathname);
        else router.replace(ONBOARDING_PATH);
      })
      .catch(() => {
        // No profile yet (or transient error) — the wizard is the safe landing.
        if (!cancelled) router.replace(ONBOARDING_PATH);
      });
    return () => { cancelled = true; };
  }, [exempt, pathname, router]);

  if (exempt || approvedFor === pathname) return <>{children}</>;
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--color-primary)' }} />
    </div>
  );
}
