/**
 * RP activity-log route — thin wrapper around the shared ActivityLogView.
 *
 * A static segment, so it takes precedence over the generic /reports/[slug]
 * table renderer: this payload is a feed + coverage matrix, not a flat table.
 */
'use client';

import { ActivityLogView } from '@/components/upnow/ActivityLogView';

export default function ActivityLogPage() {
  return (
    <ActivityLogView
      endpoint="/api/reports/activity-log"
      backHref="/rental-provider/dashboard/reports"
    />
  );
}
