import type { ReactNode } from 'react';
import { SpOnboardingGate } from '@/components/dashboard/SpOnboardingGate';
import { PageViewTracker } from '@/components/upnow/PageViewTracker';

/** The SP portal is approval-gated: see SpOnboardingGate for the policy. */
export default function ServiceProviderLayout({ children }: { children: ReactNode }) {
  return (
    <SpOnboardingGate>
      <PageViewTracker portal="service_provider" />
      {children}
    </SpOnboardingGate>
  );
}
