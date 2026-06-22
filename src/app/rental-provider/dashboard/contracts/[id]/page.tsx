// The v1 contract detail page was retired — /v2 is the single contract detail
// page (self-contained: ejari/utility upload, renewal, settlement, fees, docs).
// Keep the bare /contracts/:id URL alive by redirecting any old link to /v2.
import { redirect } from 'next/navigation';

export default async function ContractRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/rental-provider/dashboard/contracts/${id}/v2`);
}
