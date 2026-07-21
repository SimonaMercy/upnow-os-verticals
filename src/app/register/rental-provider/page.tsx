import { redirect } from 'next/navigation';

// Registration now happens in a popup on the landing page.
export default function RegisterRentalProviderPage() {
  redirect('/?auth=signup');
}
