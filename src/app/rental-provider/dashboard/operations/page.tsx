/**
 * RP Operations — four pipeline trackers (Lead · New Lease · Renewal ·
 * Terminated), each a stage board. Pure tracker: cards open the record's detail
 * page (Leads page for leads, contract detail for contracts) where the work
 * happens. Selected tab + view persist in the URL (?tab=&view=). See
 * OperationsPipelines for the data + stage model.
 *
 * The embedded Leasing Funnel sheet (Month × Lead Received … Settlement Signed)
 * that used to sit above the pipeline cards is off this page; it still lives as
 * its own report and on the manager Operations page. No performanceHref either —
 * the Manager performance button is off the hero.
 */
'use client';

import { Suspense } from 'react';
import OperationsPipelines from '@/components/upnow/OperationsPipelines';

const contractHref = (id: number) => `/rental-provider/dashboard/operations/${id}`;
const leadHref = (id: number) => `/rental-provider/dashboard/leads/${id}`;
const maintenanceHref = (id: number) => `/rental-provider/dashboard/maintenance/${id}`;
const amcHref = (id: number) => `/rental-provider/dashboard/amc/${id}`;
const disputeHref = (id: number) => `/rental-provider/dashboard/legal/${id}`;

export default function RpOperationsPage() {
  return (
    <Suspense fallback={null}>
      <OperationsPipelines
        contractsPath="/contracts/operations"
        leadsPath="/leads"
        maintenancePath="/maintenance/requests"
        contractHref={contractHref}
        leadHref={leadHref}
        maintenanceHref={maintenanceHref}
        amcPath="/amc/visits/open"
        amcHref={amcHref}
        legalBase="/legal"
        disputeHref={disputeHref}
      />
    </Suspense>
  );
}
