import { BusinessView } from '@/prototype/views/Business';

export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  return <BusinessView tab={tab} />;
}
