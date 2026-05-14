import type { Metadata } from 'next';
import ListingsView, { type ListingsViewSearchParams } from './_ListingsView';

export const metadata: Metadata = {
  title: 'Browse Listings — UpNow',
  description: 'Find your next home or workspace across the GCC.',
};

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<ListingsViewSearchParams>;
}) {
  const sp = await searchParams;
  return <ListingsView country="" emirate="" searchParams={sp} />;
}

