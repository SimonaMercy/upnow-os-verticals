'use client';

/**
 * May the person looking at this screen delete a document?
 *
 * ONE answer for every surface. The delete affordance now sits on the customer
 * KYC card, the contract binder, the property and unit cards, leads, onboarding,
 * settlement, the AMC view and the shared document reader — and a rule copied
 * nine times is a rule that will disagree with itself on the tenth.
 *
 * - A landlord (rental-provider portal) always may: the records are theirs.
 * - A manager may only for a landlord who granted `canDeleteDocuments`
 *   (migration 0247). It is deliberately NOT implied by `canManageDocuments`:
 *   attaching a file and destroying one are different authorities.
 *
 * The backend `assertDocDeletable` is the real guard and returns 403 regardless
 * of what this says; this exists so a manager is not shown a button that will
 * fail. While permissions are still loading it answers NO — a delete control
 * that appears and then vanishes is worse than one that arrives a moment late.
 */

import { usePathname, useSearchParams } from 'next/navigation';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

export function useCanDeleteDocuments(): (rpId?: number | null) => boolean {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const { canForRp, loading } = useManagerPermissions();
  // The manager portal re-exports several rental-provider pages, so the portal is
  // read from the path, exactly as those pages already do it.
  const isManager = pathname.startsWith('/dashboard/manager');

  return (rpId?: number | null) => {
    if (!isManager) return true;
    if (loading) return false;
    // Which landlord is being acted for: the explicit one the caller resolved
    // from its own payload, else the `?rp=` the landlord switcher put on the URL.
    // Never a fallback to "the first landlord I manage" — that is how a grant
    // from one landlord starts authorising work on another's records.
    const raw = searchParams?.get('rp');
    const rp = rpId ?? (raw ? Number(raw) : null);
    if (rp == null || Number.isNaN(rp)) return false;
    return canForRp('canDeleteDocuments', rp);
  };
}
