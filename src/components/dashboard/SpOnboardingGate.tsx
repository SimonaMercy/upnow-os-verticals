'use client';

/**
 * Service Provider onboarding gate.
 *
 * Mounted in the /dashboard/service-provider layout. Mirrors the RP gate
 * (RpOnboardingGate): rather than hard-bouncing every non-approved SP to the
 * setup wizard, a provider who has SUBMITTED a complete application keeps
 * read access to the whole dashboard while a sticky status banner tells them
 * what's outstanding.
 *
 *   - no profile yet, or registration incomplete (still mid-wizard / imported
 *     stub) → hard redirect to /onboarding (the wizard is the safe landing).
 *   - paused (admin enforcement hold)          → hard redirect to /onboarding
 *     (not self-fixable; the page shows a "paused" screen).
 *   - compliant                                → full dashboard, no banner.
 *   - submitted but pending_review / action_required / expired → dashboard
 *     ALLOWED, with the ComplianceBanner pointing back to /onboarding.
 *
 * "Registration complete" mirrors the onboarding wizard's own step-completion
 * checks (substantive steps 1–4): business basics, service categories, service
 * area, and strength. The optional owner-details step and the phone step
 * (a precondition already satisfied for a signed-in SP) are not required — the
 * same fields the wizard uses to decide it can show the "under review" screen.
 *
 * IMPORTANT: this is a read/UX gate only. Letting non-compliant (non-paused)
 * SPs in means WRITE actions are still enforced server-side by compliance
 * checks on the SP endpoints.
 *
 * The onboarding route itself is exempt (no redirect loop), and non-SP users
 * (e.g. admins opening SP URLs) are exempt too.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/lib/api';
import { ComplianceBanner } from './ComplianceBanner';
import {
  PlatformAgreementPanel,
  fetchAgreementStatus,
  type AgreementStatus,
} from '@/components/upnow/PlatformAgreementPanel';

const ONBOARDING_PATH = '/dashboard/service-provider/onboarding';

// States that must finish a flow before the SP can use any dashboard route.
const HARD_BLOCKED = new Set(['paused']);

interface ProfilePeek {
  profile?: {
    accountTypeConfirmedAt: string | null;
    businessName?: string | null;
    serviceCategories?: string[] | null;
    emiratesServed?: string[] | null;
    teamSizeBand?: string | null;
    fleetSizeBand?: string | null;
    opsContactName?: string | null;
    complianceStatus?: string | null;
    complianceNotes?: string | null;
    /** v2 (0260): landlord_vendor = a landlord-invited light account. */
    tier?: string | null;
  };
}

/** Mirror of the onboarding wizard's completion check (substantive steps 1–4). */
function isRegistrationComplete(p: ProfilePeek['profile']): boolean {
  if (!p) return false;
  return (
    !!p.accountTypeConfirmedAt &&
    !!p.businessName &&
    !!p.serviceCategories?.length &&
    !!p.emiratesServed?.length &&
    !!p.teamSizeBand &&
    !!p.fleetSizeBand &&
    !!p.opsContactName
  );
}

export function SpOnboardingGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  // SP-252: when a NEWER platform agreement is published, every provider is
  // re-prompted and blocked from the portal until they accept it — the earlier
  // acceptance stays on record. Loaded alongside the profile peek.
  const [agreement, setAgreement] = useState<AgreementStatus | null>(null);

  // Skip the gate for the onboarding page itself, and for non-SP users (e.g.
  // admins opening SP URLs) — handled by an early render below, so the effect
  // never needs a synchronous setState for this case.
  const exempt = !user || user.role !== 'service_provider' || pathname === ONBOARDING_PATH;

  useEffect(() => {
    if (exempt) return;
    let cancelled = false;
    apiGet<ProfilePeek>('/profiles/service-provider/me')
      .then((res) => {
        if (cancelled) return;
        const p = res?.profile;
        // v2: a landlord-invited vendor has no marketplace registration to
        // complete and no compliance review — the light portal is its home.
        if (p?.tier === 'landlord_vendor') {
          try { sessionStorage.setItem('sp_tier', 'landlord_vendor'); window.dispatchEvent(new CustomEvent('sp-tier', { detail: 'landlord_vendor' })); } catch { /* fine */ }
          setStatus(null);
          setAllowed(true);
          return;
        }
        try { sessionStorage.setItem('sp_tier', p ? 'marketplace' : ''); window.dispatchEvent(new CustomEvent('sp-tier', { detail: p ? 'marketplace' : '' })); } catch { /* fine */ }
        const st = p?.complianceStatus ?? null;
        // Hard-block the cases that must complete a flow first: no/partial
        // registration (still mid-wizard or an imported stub), or admin-paused.
        if (!isRegistrationComplete(p) || (st && HARD_BLOCKED.has(st))) {
          router.replace(ONBOARDING_PATH);
          return;
        }
        // compliant + pending_review / action_required / expired all get in; the
        // banner (below) nudges the non-compliant ones to finish verification.
        setStatus(st);
        setNotes(p?.complianceNotes ?? null);
        setAllowed(true);
        // Best-effort: if the agreement lookup fails the portal is not blocked.
        fetchAgreementStatus().then((ag) => { if (!cancelled) setAgreement(ag); }).catch(() => {});
      })
      .catch(() => {
        // No profile yet (or transient error) — the wizard is the safe landing.
        if (!cancelled) router.replace(ONBOARDING_PATH);
      })
      .finally(() => { if (!cancelled) setChecked(true); });

    return () => { cancelled = true; };
  }, [exempt, pathname, router]);

  if (exempt) return <>{children}</>;
  if (!checked || !allowed) return null;

  const showBanner = !!status && status !== 'compliant';
  const reprompt = !!agreement?.requiresAcceptance && !!agreement.agreement;
  return (
    <>
      {showBanner && <ComplianceBanner status={status} notes={notes} onboardingPath={ONBOARDING_PATH} />}
      {reprompt && agreement && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Platform agreement update"
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          style={{ background: 'rgba(24, 36, 32, 0.55)', backdropFilter: 'blur(2px)' }}
        >
          <div className="w-full" style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', borderRadius: 18, background: '#F5F7F4', boxShadow: '0 24px 64px rgba(0,0,0,.25)', padding: 18 }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4338CA', marginBottom: 6 }}>
              Platform agreement update
            </p>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#182420', letterSpacing: '-.01em' }}>
              {agreement.history.length ? 'A new version of the platform agreement needs your acceptance' : 'Please accept the platform agreement to continue'}
            </h2>
            <p style={{ fontSize: 13, color: '#55645B', margin: '6px 0 14px', lineHeight: 1.55 }}>
              {agreement.history.length
                ? `You accepted v${agreement.history[0].agreementVersion} earlier — that record stays. To keep receiving jobs, read and accept v${agreement.agreement!.version}.`
                : 'Read the agreement and accept it once. Your acceptance is recorded with the version and time.'}
            </p>
            <PlatformAgreementPanel
              status={agreement}
              context="reprompt"
              defaultOpen
              onAccepted={(_acc, next) => setAgreement(next)}
            />
          </div>
        </div>
      )}
      {children}
    </>
  );
}
