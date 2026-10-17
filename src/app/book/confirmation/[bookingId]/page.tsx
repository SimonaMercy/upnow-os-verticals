/**
 * /book/confirmation/[bookingId] — what happens next after a PREVIEW booking is created.
 * The booking itself lives in this browser (localStorage), so the page is a client view.
 */
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/upnow/SiteHeader';
import { Footer } from '@/components/upnow/Footer';
import { ConfirmationView } from '@/components/booking/ConfirmationView';

export const metadata: Metadata = { title: 'Your booking (Preview) — UpNow', robots: { index: false } };

export default async function BookingConfirmationPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  return (
    <>
      <SiteHeader />
      <ConfirmationView bookingId={decodeURIComponent(bookingId)} />
      <Footer />
    </>
  );
}
