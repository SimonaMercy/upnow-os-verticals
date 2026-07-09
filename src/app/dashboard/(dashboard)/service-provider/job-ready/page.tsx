import { redirect } from 'next/navigation';

// Get Job-Ready lives in Settings, not the onboarding wizard. Deep links land there.
export default function ServiceProviderJobReadyPage() {
  redirect('/dashboard/service-provider/settings?tab=rules');
}
