/**
 * /book/[listingId] — PREVIEW listing detail + booking widget (short stay, venue, court, charter).
 * Listings come from the browser-only booking engine's seed (src/lib/os/bookings/seed.ts).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/upnow/SiteHeader';
import { Footer } from '@/components/upnow/Footer';
import { ListingDetail } from '@/components/booking/ListingDetail';
import { SEED_LISTINGS, listingById } from '@/lib/os/bookings/seed';

type Props = { params: Promise<{ listingId: string }> };

export function generateStaticParams() {
  return SEED_LISTINGS.map((l) => ({ listingId: l.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { listingId } = await params;
  const l = listingById(listingId);
  if (!l) return { title: 'Listing not found — UpNow' };
  return { title: `${l.title} · ${l.area} (Preview) — UpNow`, description: l.description };
}

export default async function BookListingPage({ params }: Props) {
  const { listingId } = await params;
  const listing = listingById(listingId);
  if (!listing) notFound();
  return (
    <>
      <SiteHeader />
      <ListingDetail listing={listing} />
      <Footer />
    </>
  );
}
