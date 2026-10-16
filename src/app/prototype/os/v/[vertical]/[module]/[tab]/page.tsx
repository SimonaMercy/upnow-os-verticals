import { PackView } from '@/prototype/verticals/Pack';

export default async function Page({ params }: { params: Promise<{ vertical: string; module: string; tab: string }> }) {
  const { vertical, module, tab } = await params;
  return <PackView vertical={vertical} module={module} tab={tab} />;
}
