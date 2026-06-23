/**
 * Manager Operations — mirror of the RP setup worklist, scoped to the landlord
 * chosen in the LandlordSwitcher (?rp=). Reuses the shared OperationsBoard; the
 * list endpoint is manager-scoped, while the row actions reuse the standard
 * /contracts/:id/* endpoints (authorised for managers via resolveContractActor).
 */
'use client';

import { useSearchParams } from 'next/navigation';
import OperationsBoard from '@/components/upnow/OperationsBoard';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

export default function ManagerOperationsPage() {
  const { canForRp, rps, loading } = useManagerPermissions();
  const selectedRp = useSearchParams().get('rp');
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageAgreements)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageAgreements', effectiveRp);

  if (!loading && !allowed) {
    return <div style={{ padding: 40, color: '#6b6860' }}>You don’t have contract access for this landlord.</div>;
  }
  if (effectiveRp == null) {
    return <div style={{ padding: 40, color: '#6b6860' }}>Loading…</div>;
  }

  return (
    <OperationsBoard
      key={effectiveRp}
      listPath={`/manager/contracts/operations?rp=${effectiveRp}`}
      contractHref={(id) => `/dashboard/manager/operations/${id}`}
      canAct={allowed}
    />
  );
}
