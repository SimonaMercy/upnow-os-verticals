/**
 * RP report detail route — thin wrapper around the shared ReportDetailView
 * (also used by the manager portal with /api/manager/reports endpoints).
 */
'use client';

import { useParams, useRouter } from 'next/navigation';
import { ReportDetailView } from '@/components/upnow/ReportDetailView';
import { PaymentGroupingReport } from '@/components/upnow/PaymentGroupingReport';
import { ManagerOperationsReport } from '@/components/upnow/ManagerOperationsReport';
import { OperationsByStageReport } from '@/components/upnow/OperationsByStageReport';
import ReportSheetView, { SHEET_SLUGS, type SheetSlug } from '@/components/upnow/ReportSheetView';

export default function ReportDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  // Custom interactive reports — not standard tables, so they render their own
  // components instead of ReportDetailView.
  if (params.slug === 'payment-grouping') {
    return <PaymentGroupingReport backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'manager-operations') {
    return <ManagerOperationsReport backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'operations-by-stage') {
    return <OperationsByStageReport endpointBase="/api/reports" backHref="/rental-provider/dashboard/reports" />;
  }
  // The two headline reports render as exportable month sheets (the CEO's
  // reference-file format), each on its own slug.
  if ((SHEET_SLUGS as string[]).includes(params.slug)) {
    return (
      <ReportSheetView
        slug={params.slug as SheetSlug}
        onBack={() => router.push('/rental-provider/dashboard/reports')}
      />
    );
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
