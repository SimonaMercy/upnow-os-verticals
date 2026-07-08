/**
 * Layout for all Rental Provider dashboard routes (/rental-provider/dashboard/*).
 * Wraps content in DashboardShell (sidebar nav + topbar) and the onboarding
 * gate (forces new accounts through the onboarding flow before they can use
 * any other RP page).
 */
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { RpOnboardingGate } from '@/components/dashboard/RpOnboardingGate';
import { ReactNode } from 'react';

import { PageViewTracker } from '@/components/upnow/PageViewTracker';

export default function RentalProviderDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardShell>
      <PageViewTracker portal="rp" />
      <RpOnboardingGate>{children}</RpOnboardingGate>
    </DashboardShell>
  );
}
