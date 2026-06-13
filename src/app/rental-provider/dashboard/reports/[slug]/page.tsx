/**
 * RP report detail route — thin wrapper around the shared ReportDetailView
 * (also used by the manager portal with /api/manager/reports endpoints).
 */
'use client';

import { useParams } from 'next/navigation';
import { ReportDetailView } from '@/components/upnow/ReportDetailView';

export default function ReportDetailPage() {
  const params = useParams<{ slug: string }>();
  return (
    <ReportDetailView
      slug={params.slug}
      endpointBase="/api/reports"
      backHref="/rental-provider/dashboard/reports"
      contractsBase="/rental-provider/dashboard/contracts"
      urlBase="/rental-provider/dashboard/reports"
    />
  );
}
