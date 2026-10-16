import { PackView } from '@/prototype/verticals/Pack';

export default async function Page({ params }: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await params;
  return <PackView vertical={vertical} />;
}
