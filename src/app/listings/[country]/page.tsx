import type { Metadata } from 'next';
import ListingsView, { type CountryItem, type ListingsViewSearchParams } from '../_ListingsView';

const BACKEND = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Props {
  params: Promise<{ country: string }>;
  searchParams: Promise<ListingsViewSearchParams>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  const countries: CountryItem[] = await fetch(`${BACKEND}/locations/countries`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : []).catch(() => []);
  const countryObj = countries.find(c => c.code.toLowerCase() === country.toLowerCase());
  if (!countryObj) return { title: 'Listings — UpNow' };
  return {
    title: `Properties for Rent in ${countryObj.nameEn} — UpNow`,
    description: `Browse residential, commercial and industrial spaces for rent in ${countryObj.nameEn}.`,
  };
}

export default async function CountryListingsPage({ params, searchParams }: Props) {
  const { country } = await params;
  const sp = await searchParams;
  return <ListingsView country={country.toLowerCase()} emirate="" searchParams={sp} />;
}
