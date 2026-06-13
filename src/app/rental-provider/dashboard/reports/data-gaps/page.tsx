/**
 * RP data-gaps route — thin wrapper around the shared DataGapsView (the
 * manager portal renders the same view inline with its scoped endpoint).
 */
'use client';

import { DataGapsView } from '@/components/upnow/DataGapsView';

export default function DataGapsPage() {
  return <DataGapsView endpoint="/api/reports/data-gaps" backHref="/rental-provider/dashboard/reports" />;
}
