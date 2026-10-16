import { ListingWizard } from '@/prototype/views/ListingWizard';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingWizard editId={id} />;
}
