/**
 * RP report detail route — thin wrapper around the shared ReportDetailView
 * (also used by the manager portal with /api/manager/reports endpoints).
 */
'use client';

import { useParams } from 'next/navigation';
import { ReportDetailView } from '@/components/upnow/ReportDetailView';
import { PaymentGroupingReport } from '@/components/upnow/PaymentGroupingReport';

export default function ReportDetailPage() {
  const params = useParams<{ slug: string }>();
  // Custom interactive report — not a standard table, so it renders its own
  // component instead of ReportDetailView.
  if (params.slug === 'payment-grouping') {
    return <PaymentGroupingReport backHref="/rental-provider/dashboard/reports" />;
  }
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
