/**
 * RP route for the "missing-properties" live worklist — thin wrapper around the shared
 * MissingDataView (the manager portal renders the same view inline, scoped).
 *
 * Genspark OS: framed by ReportShell (Insights › <name>); the view itself, its
 * endpoint, filters, CSV/print and back link are unchanged.
 */
'use client';

import { MissingDataView, MISSING_REPORTS } from '@/components/upnow/MissingDataView';
import { ReportShell } from '../_shell';

export default function Page() {
  return (
    <ReportShell name={MISSING_REPORTS['missing-properties'].title}>
      <MissingDataView
        config={MISSING_REPORTS['missing-properties']}
        endpoint="/api/reports/missing-properties"
        backHref="/rental-provider/dashboard/reports"
      />
    </ReportShell>
  );
}
