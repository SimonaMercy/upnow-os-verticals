/**
 * RP activity-log route — thin wrapper around the shared ActivityLogView.
 *
 * A static segment, so it takes precedence over the generic /reports/[slug]
 * table renderer: this payload is a feed + coverage matrix, not a flat table.
 *
 * Genspark OS: framed by ReportShell (Insights › Activity Log); the view, its
 * endpoint and back link are unchanged.
 */
'use client';

import { ActivityLogView } from '@/components/upnow/ActivityLogView';
import { ReportShell, reportName } from '../_shell';

export default function ActivityLogPage() {
  return (
    <ReportShell name={reportName('activity-log')}>
      <ActivityLogView
        endpoint="/api/reports/activity-log"
        backHref="/rental-provider/dashboard/reports"
      />
    </ReportShell>
  );
}
