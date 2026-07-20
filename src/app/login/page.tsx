import { redirect } from 'next/navigation';

// Sign-in now happens in a popup on the landing page — there is no separate
// login page. Any link or post-logout/session-expiry target that still points
// at /login lands on the marketplace with the sign-in popup opened via ?auth.
export default function LoginPage() {
  redirect('/?auth=signin');
}
