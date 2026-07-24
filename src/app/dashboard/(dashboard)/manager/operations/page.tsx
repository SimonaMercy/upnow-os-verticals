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
import { OperationsByStageReport } from '@/components/upnow/OperationsByStageReport';
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
    return <div style={{ padding: 40, color: '#6b6860' }}>You don’t have contract access for this landlord.</div>;
  }
  if (effectiveRp == null) {
    return <div style={{ padding: 40, color: '#6b6860' }}>Loading…</div>;
  }

  const rp = effectiveRp;
  return (
    <Suspense fallback={null}>
      {/* Your own Leasing Funnel, scoped server-side to you, on top of the live
          pipeline you work — so your stage-by-stage funnel updates as you
          progress records below. */}
      <OperationsByStageReport
        key={`funnel-${rp}`}
        endpointBase="/api/manager/reports"
        reportPath="leasing-funnel"
        title="Leasing Funnel by Manager"
        csvBase="leasing-funnel"
        subtitleScoped="The contracts you ran reaching each stage of the leasing journey — lead to settlement — month by month. Click any number for the records behind it. Signatures marked “on file” are never counted."
        extraQuery={`rp=${rp}`}
        contractsBase="/dashboard/manager/contracts"
        leadsBase="/dashboard/manager/leads"
        hideBack
      />
      <OperationsPipelines
        key={rp}
        contractsPath={`/manager/contracts/operations?rp=${rp}`}
        leadsPath={`/manager/leads?rp=${rp}`}
        contractHref={(id) => `/dashboard/manager/operations/${id}?rp=${rp}`}
        leadHref={(id) => `/dashboard/manager/leads/${id}?rp=${rp}`}
        rpFilter={rp}
      />
    </Suspense>
  );
}
