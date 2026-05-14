import type { Metadata } from 'next';
import ListingsView, { type CountryItem, type EmirateItem, type ListingsViewSearchParams } from '../../_ListingsView';

const BACKEND = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Props {
  params: Promise<{ country: string; emirate: string }>;
  searchParams: Promise<ListingsViewSearchParams>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country, emirate } = await params;
  const [countries, emirates]: [CountryItem[], EmirateItem[]] = await Promise.all([
    fetch(`${BACKEND}/locations/countries`, { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(`${BACKEND}/locations/emirates`,  { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  const countryObj = countries.find(c => c.code.toLowerCase() === country.toLowerCase());
  const emirateObj = emirates.find(e => e.slug === emirate.toLowerCase());
  if (!countryObj) return { title: 'Listings — UpNow' };
  const title = emirateObj
    ? `Properties for Rent in ${emirateObj.nameEn} — UpNow`
    : `Properties for Rent in ${countryObj.nameEn} — UpNow`;
  const description = emirateObj
    ? `Browse residential, commercial and industrial spaces for rent in ${emirateObj.nameEn}, ${countryObj.nameEn}.`
    : `Browse listings in ${countryObj.nameEn}.`;
  return { title, description };
}

export default async function EmirateListingsPage({ params, searchParams }: Props) {
  const { country, emirate } = await params;
  const sp = await searchParams;
  return <ListingsView country={country.toLowerCase()} emirate={emirate.toLowerCase()} searchParams={sp} />;
}
