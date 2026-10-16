// PROTOTYPE bridge — production redirects /contracts/:id to /v2; do the same inside the new OS shell.
import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/prototype/os/rp/contracts/${id}/v2`);
}
