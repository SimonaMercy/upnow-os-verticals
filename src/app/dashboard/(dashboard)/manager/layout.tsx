'use client';

import { ManagerPermissionsProvider, useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { LandlordSwitcher } from '@/components/dashboard/LandlordSwitcher';
import { ManagerScopeSync } from '@/components/dashboard/ManagerScopeSync';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ShieldOff, UserPlus } from 'lucide-react';
import { apiGet } from '@/lib/api';

/**
 * Manager area layout. A single global scope bar carries the LandlordSwitcher so
 * EVERY manager page shows (and controls) which landlord's data is in view — the
 * `?rp=` it sets is read by each page to scope its data + permission gate.
 * Putting it here (once) avoids the previous state where only some pages had it.
 */
import { PageViewTracker } from '@/components/upnow/PageViewTracker';

type DeactivatedRp = { rentalProviderId: number; rpName: string; deactivatedAt: string };

/**
 * What a manager with no ACTIVE landlord sees instead of their pages. `my-rps`
 * hides deactivated landlords, so an empty list means either every landlord
 * has switched this manager off, or nobody has assigned them yet — this asks
 * `/manager/my-rps/deactivated` to say which, and names the landlords so the
 * manager knows whom to ask. Re-activation by any landlord restores the pages.
 */
function NoActiveLandlord() {
  const [deactivated, setDeactivated] = useState<DeactivatedRp[] | null>(null);
  useEffect(() => {
    apiGet<DeactivatedRp[]>('/manager/my-rps/deactivated')
      .then(setDeactivated)
      .catch(() => setDeactivated([]));
  }, []);
  if (deactivated === null) return null;

  const byLandlord = deactivated.length > 0;
  const names = deactivated.map(d => d.rpName);
  const nameList =
    names.length <= 1 ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const Icon = byLandlord ? ShieldOff : UserPlus;

  return (
    <div className="mgr-inactive">
      <div className="mgr-inactive__card">
        <div className="mgr-inactive__icon">
          <Icon size={22} />
        </div>
        <p className="mgr-inactive__title">
          {byLandlord ? 'Your access has been deactivated' : 'No landlords assigned yet'}
        </p>
        <p className="mgr-inactive__body">
          {byLandlord
            ? `${nameList} ${names.length === 1 ? 'has' : 'have'} deactivated your access to their account. ` +
              'Your permissions are kept — ask them to re-activate you from Settings → Team.'
            : 'Ask your landlord to invite you via their Team settings.'}
        </p>
      </div>
      <style>{`
        .mgr-inactive { display: flex; justify-content: center; padding: 72px 24px; }
        .mgr-inactive__card {
          max-width: 460px; width: 100%; text-align: center;
          background: #fff; border-radius: 16px; padding: 40px 32px;
          box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,.08));
        }
        .mgr-inactive__icon {
          width: 48px; height: 48px; border-radius: 12px; margin: 0 auto 14px;
          display: flex; align-items: center; justify-content: center;
          background: #fef9eb; color: var(--color-gold, #c9a227);
        }
        .mgr-inactive__title { font-size: 15px; font-weight: 600; color: var(--color-neutral-900, #1a1a1a); margin: 0; }
        .mgr-inactive__body  { font-size: 13px; line-height: 1.5; color: var(--color-neutral-400, #8a8a8a); margin: 8px 0 0; }
      `}</style>
    </div>
  );
}

/**
 * A manager with no ACTIVE landlord sees only the notice above — no scope bar,
 * no cards. A landlord's "Deactivate" (Settings → Team) switches off that
 * landlord's grant only, and `/manager/my-rps` already drops deactivated
 * landlords, so the list is empty once every landlord has done so (or none has
 * assigned them yet). Product rule (1 Sep 2026): they may still sign in. The
 * shell (sidebar, sign-out) stays, and the API 403s every landlord-scoped call
 * regardless, so this is presentation only. Children render during the one-off
 * permissions load so ordinary managers don't pay an extra round-trip.
 */
function ManagerGate({ children }: { children: ReactNode }) {
  const { rps, loading } = useManagerPermissions();
  const pathname = usePathname();
  // My Profile is the manager's own record, not a landlord's — it stays
  // reachable (and the scope bar stays off it) however many landlords are active.
  const ownProfile = pathname?.startsWith('/dashboard/manager/profile') ?? false;
  if (!loading && rps.length === 0) return ownProfile ? <>{children}</> : <NoActiveLandlord />;
  return (
    <>
      <ManagerScopeSync />
      <div className="mgr-scopebar">
        <span className="mgr-scopebar__lbl">Acting for</span>
        <LandlordSwitcher />
      </div>
      <PageViewTracker portal="manager" />
      {children}
    </>
  );
}

export default function ManagerLayout({ children }: { children: ReactNode }) {
  return (
    <ManagerPermissionsProvider>
      <ManagerGate>{children}</ManagerGate>
      <style>{`
        .mgr-scopebar {
          position: sticky; top: 0; z-index: 40;
          display: flex; align-items: center; justify-content: flex-end; gap: 10px;
          padding: 10px 22px;
          background: rgba(255,255,255,0.88);
          backdrop-filter: saturate(180%) blur(8px);
          border-bottom: 1px solid var(--color-base-200, #ececec);
        }
        .mgr-scopebar__lbl {
          font-size: 12px; font-weight: 600; letter-spacing: .01em;
          color: var(--color-neutral-400, #8a8a8a);
        }
      `}</style>
    </ManagerPermissionsProvider>
  );
}
