/**
 * RP route for the "missing-contracts" live worklist — thin wrapper around the shared
 * MissingDataView (the manager portal renders the same view inline, scoped).
 */
'use client';

import { MissingDataView, MISSING_REPORTS } from '@/components/upnow/MissingDataView';

export default function Page() {
  return (
    <MissingDataView
      config={MISSING_REPORTS['missing-contracts']}
      endpoint="/api/reports/missing-contracts"
      backHref="/rental-provider/dashboard/reports"
    />
  );
}
