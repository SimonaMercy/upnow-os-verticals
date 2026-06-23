/**
 * RP Operations — the contract-setup worklist. Lists every non-ended, un-blessed
 * contract and lets the admin finish the setup steps and "Mark active" (which
 * locks the lease and moves it to the Leases register). See OperationsBoard.
 */
'use client';

import OperationsBoard from '@/components/upnow/OperationsBoard';

export default function RpOperationsPage() {
  return (
    <OperationsBoard
      listPath="/contracts/operations"
      contractHref={(id) => `/rental-provider/dashboard/operations/${id}`}
    />
  );
}
