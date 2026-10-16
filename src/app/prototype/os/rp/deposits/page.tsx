// PROTOTYPE bridge — production redirects /deposits to /payments; do the same inside the new OS shell.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/prototype/os/rp/payments');
}
