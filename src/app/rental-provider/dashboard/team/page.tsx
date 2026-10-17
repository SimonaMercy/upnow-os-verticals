'use client';

/**
 * Business › Team — Genspark OS shell around the landlord's team overview.
 *
 * Parity with previous page (every item kept): TeamOverviewView REUSED with the same props
 * (endpoint /api/reports/team-overview, manageHref settings?tab=team, reportsHref, operationsHref)
 * — its date-range picker, Refresh, Manage team, KPI tiles, live feed (paged, per person / kind),
 * step donut, drill-downs, activity-log + counters links and empty "Invite a manager" state are
 * untouched. The only change to the component is an opt-in `embedded` prop (RP-only component —
 * no manager or admin import) that hides its own title so the kit PageHead is the heading.
 * Rendered outside the `.gx` scope so its own styling applies.
 * /prototype/os/rp/team re-exports this page.
 */
import { TeamOverviewView } from '@/components/upnow/TeamOverviewView';
import { Btn, OsPage, PageHead } from '@/components/os/kit';

export default function TeamPage() {
  return (
    <>
      <OsPage className="!pb-2">
        <PageHead
          eyebrow="Business"
          title="Team"
          lede="What your managers are doing now, and the tasks they closed — read from what the platform records. Off-platform calls and WhatsApp leave no trace."
          actions={<>
            <Btn size="sm" href="/rental-provider/dashboard/reports/activity-log">Activity log</Btn>
            <Btn size="sm" variant="primary" href="/rental-provider/dashboard/settings?tab=team">Manage team</Btn>
          </>}
        />
      </OsPage>
      <TeamOverviewView
        embedded
        endpoint="/api/reports/team-overview"
        manageHref="/rental-provider/dashboard/settings?tab=team"
        reportsHref="/rental-provider/dashboard/reports"
        operationsHref="/rental-provider/dashboard/operations"
      />
    </>
  );
}
