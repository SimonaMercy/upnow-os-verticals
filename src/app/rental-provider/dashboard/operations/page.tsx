/**
 * RP Operations — four pipeline trackers (Lead · New Lease · Renewal ·
 * Terminated), each a stage board. Pure tracker: cards open the record's detail
 * page (Leads page for leads, contract detail for contracts) where the work
 * happens. Selected tab + view persist in the URL (?tab=&view=). See
 * OperationsPipelines for the data + stage model.
 */
'use client';

import { Suspense } from 'react';
import OperationsPipelines from '@/components/upnow/OperationsPipelines';

const contractHref = (id: number) => `/rental-provider/dashboard/operations/${id}`;
const leadHref = (id: number) => `/rental-provider/dashboard/leads/${id}`;

export default function RpOperationsPage() {
  return (
    <Suspense fallback={null}>
      <OperationsPipelines
        contractsPath="/contracts/operations"
        leadsPath="/leads"
        contractHref={contractHref}
        leadHref={leadHref}
      />
    </Suspense>
  );
}
