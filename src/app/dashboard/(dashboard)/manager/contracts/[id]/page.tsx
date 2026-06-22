// Manager: the v1 contract detail page was retired — redirect the bare
// /dashboard/manager/contracts/:id URL to the self-contained /v2 page.
import { redirect } from 'next/navigation';

export default async function ManagerContractRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/manager/contracts/${id}/v2`);
}
