/**
 * Manager Operations — mirror of the RP setup worklist, scoped to the landlord
 * chosen in the LandlordSwitcher (?rp=). Reuses the shared Operations views; the
 * list endpoint is manager-scoped, while the row actions reuse the standard
 * /contracts/:id/* endpoints (authorised for managers via resolveContractActor).
 *
 * Same two views as the RP page, switched by ?view: the default LIST
 * (OperationsBoard) and the drag-and-drop BOARD (OperationsKanban). The ?rp
 * scope is preserved across the toggle by OperationsViewToggle.
 */
'use client';

import { useSearchParams } from 'next/navigation';
import OperationsBoard from '@/components/upnow/OperationsBoard';
import OperationsKanban from '@/components/upnow/OperationsKanban';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

export default function ManagerOperationsPage() {
  const { canForRp, rps, loading } = useManagerPermissions();
  const params = useSearchParams();
  const selectedRp = params.get('rp');
  const view = params.get('view');
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

  const shared = {
    listPath: `/manager/contracts/operations?rp=${effectiveRp}`,
    contractHref: (id: number) => `/dashboard/manager/operations/${id}`,
    canAct: allowed,
  };
  return view === 'board'
    ? <OperationsKanban key={effectiveRp} {...shared} />
    : <OperationsBoard key={effectiveRp} {...shared} />;
}
