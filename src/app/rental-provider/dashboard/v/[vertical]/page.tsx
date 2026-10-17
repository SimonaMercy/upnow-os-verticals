/**
 * Pack Overview for a vertical (rail: <VERTICAL> PACK › Overview). New page — no previous page to
 * keep parity with. Spaces renders SpacesHome (booking summary + a compact long-term lease row);
 * every other vertical runs on preview data.
 */
import { notFound } from 'next/navigation';
import { verticalOf } from '@/lib/catalog';
import VerticalHome from './_home';

export default async function Page({ params }: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await params;
  if (!verticalOf(vertical)) notFound();
  return <VerticalHome />;
}
