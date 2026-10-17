/**
 * RP report detail route — thin wrapper around the shared ReportDetailView
 * (also used by the manager portal with /api/manager/reports endpoints).
 *
 * Genspark OS: the default export frames the report in ReportShell
 * (Insights › <report title from the catalog>). The slug dispatch below
 * (ReportBody) is unchanged — every custom report component, ReportSheetView
 * and the shared ReportDetailView get exactly the props they had before.
 */
'use client';

import { useParams, useRouter } from 'next/navigation';
import { ReportDetailView } from '@/components/upnow/ReportDetailView';
import { PaymentGroupingReport } from '@/components/upnow/PaymentGroupingReport';
import { ManagerOperationsReport } from '@/components/upnow/ManagerOperationsReport';
import { ManagerActivityPerformance } from '@/components/upnow/ManagerActivityPerformance';
import { ManagerActivityCounters } from '@/components/upnow/ManagerActivityCounters';
import { OperationsByStageReport } from '@/components/upnow/OperationsByStageReport';
import { LeaseRevenueByYearReport } from '@/components/upnow/LeaseRevenueByYearReport';
import { LeasesMonthlyReport } from '@/components/upnow/LeasesMonthlyReport';
import { LeasesYearlyReport } from '@/components/upnow/LeasesYearlyReport';
import ReportSheetView, { SHEET_SLUGS, type SheetSlug } from '@/components/upnow/ReportSheetView';
import { MoveOutReasonsReport } from '@/components/upnow/MoveOutReasonsReport';
import { OperationPlanReport } from '@/components/upnow/OperationPlanReport';
import { MarketComparisonReport } from '@/components/upnow/MarketComparisonReport';
import { BouncedChequesReport } from '@/components/upnow/BouncedChequesReport';
import { ReportShell, reportName } from '../_shell';

export default function ReportDetailPage() {
  const params = useParams<{ slug: string }>();
  return (
    <ReportShell name={reportName(params.slug)}>
      <ReportBody />
    </ReportShell>
  );
}

function ReportBody() {
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
  if (params.slug === 'manager-activity-counters') {
    return (
      <ManagerActivityCounters
        endpoint="/api/reports/manager-activity-counters"
        backHref="/rental-provider/dashboard/reports"
      />
    );
  }
  if (params.slug === 'manager-activity-performance') {
    return (
      <ManagerActivityPerformance
        endpoint="/api/reports/manager-activity-performance"
        backHref="/rental-provider/dashboard/reports"
      />
    );
  }
  if (params.slug === 'operations-by-stage') {
    return <OperationsByStageReport endpointBase="/api/reports" backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'operation-plan') {
    return <OperationPlanReport backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'move-out-reasons') {
    return <MoveOutReasonsReport endpointBase="/api/reports" backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'bounced-cheques') {
    return <BouncedChequesReport endpointBase="/api/reports" backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'market-comparison') {
    return <MarketComparisonReport endpointBase="/api/reports" backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'lease-revenue-by-year') {
    return <LeaseRevenueByYearReport endpointBase="/api/reports" backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'leases-by-year') {
    return <LeasesMonthlyReport endpointBase="/api/reports" backHref="/rental-provider/dashboard/reports" />;
  }
  if (params.slug === 'new-leases-matrix') {
    return <LeasesYearlyReport endpointBase="/api/reports" backHref="/rental-provider/dashboard/reports" />;
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
