import { redirect } from 'next/navigation';

// The full journey lives in ONE place — the onboarding page flows from the
// registration wizard into the Get Job-Ready cards. Deep links land there.
export default function ServiceProviderJobReadyPage() {
  redirect('/dashboard/service-provider/onboarding');
}
