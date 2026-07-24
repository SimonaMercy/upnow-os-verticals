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
import { OperationsByStageReport } from '@/components/upnow/OperationsByStageReport';

const contractHref = (id: number) => `/rental-provider/dashboard/operations/${id}`;
const leadHref = (id: number) => `/rental-provider/dashboard/leads/${id}`;

export default function RpOperationsPage() {
  return (
    <Suspense fallback={null}>
      {/* Pipeline tracker on top; the Leasing Funnel activity table renders right
          after its heading, above the pipeline cards. overallOnly → the account's
          activity as ONE consolidated sheet (managers' work on your behalf
          included). All heading/label text dropped — just the table. */}
      <OperationsPipelines
        contractsPath="/contracts/operations"
        leadsPath="/leads"
        contractHref={contractHref}
        leadHref={leadHref}
        performanceHref="/rental-provider/dashboard/reports/manager-operations"
        afterHeading={
          <OperationsByStageReport
            endpointBase="/api/reports"
            reportPath="leasing-funnel"
            title="Leasing Funnel"
            csvBase="leasing-funnel"
            overallOnly
            hideBack
            hideHeading
            flush
            hideControls
          />
        }
      />
    </Suspense>
  );
}
