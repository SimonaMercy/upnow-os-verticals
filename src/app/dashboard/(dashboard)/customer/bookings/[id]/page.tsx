'use client';

/** Customer booking detail — one PREVIEW booking (short stay, venue, court, charter). */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { getListing, useBookings } from '@/lib/os/bookings/store';
import { BookingPanel } from '@/components/booking/BookingPanel';
import { useHydrated } from '@/components/booking/myBookings';
import { PreviewNote } from '@/components/booking/ui';

export default function CustomerBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ''));
  const hydrated = useHydrated();
  const store = useBookings();
  const b = hydrated ? store.bookings.find((x) => x.id === id) : undefined;
  const l = b ? getListing(b.listingId) : undefined;

  return (
    <div className="bk px-6 py-8 max-w-6xl mx-auto">
      <Link href="/dashboard/customer/bookings" className="bk-btn secondary sm" style={{ marginBottom: 14 }}>
        <ChevronLeft size={15} aria-hidden /> Back to My bookings
      </Link>
      <h1 className="text-xl font-semibold mb-3" style={{ color: 'var(--color-neutral-900)' }}>
        {l ? l.title : 'Booking'} <span style={{ color: 'var(--color-neutral-500)', fontWeight: 500 }}>· {id}</span>
      </h1>
      <PreviewNote />
      <div style={{ marginTop: 16 }}>
        {!hydrated ? <div className="bk-empty">Loading booking…</div>
          : !b || !l ? (
            <div className="bk-empty"><b>Booking {id} not found</b>Preview bookings live in this browser only.</div>
          ) : <BookingPanel booking={b} listing={l} />}
      </div>
    </div>
  );
}
