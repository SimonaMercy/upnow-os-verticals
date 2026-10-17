/**
 * Operations home for a vertical (Genspark "Operations"). New page — no previous page to keep parity with.
 * Spaces has a real lease board, so /v/spaces redirects to it; every other vertical runs on preview data.
 */
import { notFound, redirect } from 'next/navigation';
import { verticalOf } from '@/lib/catalog';
import VerticalHome from './_home';

export default async function Page({ params }: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await params;
  if (!verticalOf(vertical)) notFound();
  if (vertical === 'spaces') redirect('/rental-provider/dashboard/orders');
  return <VerticalHome />;
}
