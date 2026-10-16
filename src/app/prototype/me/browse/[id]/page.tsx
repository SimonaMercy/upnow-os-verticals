import { ListingDetailView } from '@/prototype/views/customer/ListingDetail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingDetailView id={id} />;
}
