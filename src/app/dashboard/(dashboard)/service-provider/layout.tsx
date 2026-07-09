import type { ReactNode } from 'react';
import { SpOnboardingGate } from '@/components/dashboard/SpOnboardingGate';

/** The SP portal is approval-gated: see SpOnboardingGate for the policy. */
export default function ServiceProviderLayout({ children }: { children: ReactNode }) {
  return <SpOnboardingGate>{children}</SpOnboardingGate>;
}
