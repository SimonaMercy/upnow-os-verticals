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
  // Leasing Funnel reuses the same per-manager month-sheet + drill-down, with a
  // different report slug + labels.
  if (params.slug === 'leasing-funnel') {
    return (
      <OperationsByStageReport
        endpointBase="/api/reports"
        reportPath="leasing-funnel"
        title="Leasing Funnel by Manager"
        csvBase="leasing-funnel"
        subtitleTeam="Contracts reaching each stage of the leasing journey — lead to settlement — month by month. An overall sheet for the whole account, then one per manager (each contract credited to the manager who ran it). Click any number for the records behind it. Signatures marked “on file” are never counted."
        subtitleScoped="The contracts you ran reaching each stage of the leasing journey — lead to settlement — month by month. Click any number for the records behind it. Signatures marked “on file” are never counted."
        backHref="/rental-provider/dashboard/reports"
      />
    );
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
      unitsBase="/rental-provider/dashboard/units"
      urlBase="/rental-provider/dashboard/reports"
    />
  );
}
