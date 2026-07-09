import { redirect } from 'next/navigation';

// Team management lives in Settings → Team. Deep links land there.
export default function SpTeamPage() {
  redirect('/dashboard/service-provider/settings?tab=team');
}
