'use client';

/**
 * RP → Team — the visual overview of what the landlord's managers are doing,
 * on top of the activity log. Landlord-only (the manager portal has no mirror:
 * its subject is the team compared side by side).
 */
import { TeamOverviewView } from '@/components/upnow/TeamOverviewView';

export default function TeamPage() {
  return (
    <TeamOverviewView
      endpoint="/api/reports/team-overview"
      manageHref="/rental-provider/dashboard/settings?tab=team"
      reportsHref="/rental-provider/dashboard/reports"
      operationsHref="/rental-provider/dashboard/operations"
    />
  );
}
