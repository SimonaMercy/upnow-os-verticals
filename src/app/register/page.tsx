import { redirect } from 'next/navigation';

// Registration now happens in a popup on the landing page — there is no
// separate registration page. Redirect to the marketplace with the sign-up
// popup opened via ?auth.
export default function RegisterIndexPage() {
  redirect('/?auth=signup');
}
