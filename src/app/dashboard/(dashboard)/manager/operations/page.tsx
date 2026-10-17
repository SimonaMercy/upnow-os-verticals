/**
 * Manager Operations — mirror of the RP pipeline tracker, scoped to the landlord
 * chosen in the LandlordSwitcher (?rp=). Uses the SAME shared OperationsPipelines
 * component as the RP page (4 tabs: Lead · New Lease · Renewal · Terminated; 3
 * views: kanban/list/grid; ?tab=&view= state), wired to the manager-scoped
 * endpoints. Row actions reuse /contracts/:id/* (authorised for managers via
 * resolveContractActor); the list endpoints are /manager/*?rp=.
 */
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import OperationsPipelines from '@/components/upnow/OperationsPipelines';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

export default function ManagerOperationsPage() {
  const { canForRp, rps, loading } = useManagerPermissions();
  const params = useSearchParams();
  const selectedRp = params.get('rp');
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageAgreements)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageAgreements', effectiveRp);

  if (!loading && !allowed) {
    return <div style={{ padding: 40, color: '#5f6b63' }}>You don’t have contract access for this landlord.</div>;
  }
  if (effectiveRp == null) {
    return <div style={{ padding: 40, color: '#5f6b63' }}>Loading…</div>;
  }

  const rp = effectiveRp;
  // Breach / Legal boards and "Move lease to legal" need the landlord's legal permission;
  // without it the tabs show their lanes empty and offer no action.
  const legal = canForRp('canManageLegal', rp);
  // The AMC board needs the landlord's AMC permission; without it the tab shows its lanes empty.
  const amc = canForRp('canManageAmc', rp);
  return (
    <Suspense fallback={null}>
      {/* The Leasing Funnel sheet used to sit on top of the pipeline here. It is
          a REPORT — a month-by-month count of what already happened — and this
          is the board where work gets picked up and moved, so it pushed the
          lanes below the fold to answer a question nobody comes here to ask. It
          lives on /dashboard/manager/reports, which is where it is read. */}
      <OperationsPipelines
        key={rp}
        contractsPath={`/manager/contracts/operations?rp=${rp}`}
        leadsPath={`/manager/leads?rp=${rp}`}
        maintenancePath={`/manager/maintenance/requests?rp=${rp}`}
        contractHref={(id) => `/dashboard/manager/operations/${id}?rp=${rp}`}
        leadHref={(id) => `/dashboard/manager/leads/${id}?rp=${rp}`}
        maintenanceHref={(id) => `/dashboard/manager/maintenance/${id}?rp=${rp}`}
        amcPath={amc ? `/manager/amc/visits/open?rp=${rp}` : undefined}
        amcHref={amc ? (id) => `/dashboard/manager/amc/${id}?rp=${rp}` : undefined}
        legalBase={legal ? '/manager/legal' : undefined}
        legalRp={legal ? rp : undefined}
        disputeHref={legal ? (id) => `/dashboard/manager/legal/${id}?rp=${rp}` : undefined}
        rpFilter={rp}
      />
    </Suspense>
  );
}
