import { PackView } from '@/prototype/verticals/Pack';

export default async function Page({ params }: { params: Promise<{ vertical: string; module: string }> }) {
  const { vertical, module } = await params;
  return <PackView vertical={vertical} module={module} />;
}
