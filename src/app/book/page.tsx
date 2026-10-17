/**
 * /book — PREVIEW booking listings (holiday homes, venues, sports courts, yacht charters).
 * These verticals have no backend yet; listings and bookings live in the browser
 * (src/lib/os/bookings). No real payment is taken.
 */
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/upnow/SiteHeader';
import { Footer } from '@/components/upnow/Footer';
import { BookIndex } from '@/components/booking/BookIndex';
import type { BookingModel } from '@/lib/os/bookings/types';

export const metadata: Metadata = {
  title: 'Holiday homes, venues, courts & yachts (Preview) — UpNow',
  description: 'Preview the UpNow booking flow for short stays, event venues, sports courts and yacht charters.',
};

const MODELS: readonly BookingModel[] = ['shortstay', 'venue', 'court', 'charter'];

export default async function BookIndexPage({ searchParams }: { searchParams: Promise<{ model?: string | string[] }> }) {
  const { model } = await searchParams;
  const initial = typeof model === 'string' && (MODELS as readonly string[]).includes(model) ? (model as BookingModel) : null;
  return (
    <>
      <SiteHeader />
      <BookIndex key={initial ?? 'all'} initialModel={initial} />
      <Footer />
    </>
  );
}
