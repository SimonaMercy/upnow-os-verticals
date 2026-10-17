'use client';

/** /book/confirmation/[bookingId] — what happens next for a PREVIEW booking, with its live timer. */
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getListing, useBookings } from '@/lib/os/bookings/store';
import { BookingPanel } from './BookingPanel';
import { useHydrated } from './myBookings';
import { PreviewNote } from './ui';

export function ConfirmationView({ bookingId }: { bookingId: string }) {
  const hydrated = useHydrated();
  const store = useBookings();
  const b = hydrated ? store.bookings.find((x) => x.id === bookingId) : undefined;
  const l = b ? getListing(b.listingId) : undefined;

  return (
    <div className="bk bk-page">
      <div className="wrap" style={{ paddingBottom: 56 }}>
        <nav className="bk-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link><ChevronRight size={13} aria-hidden />
          <Link href="/book">Preview bookings</Link><ChevronRight size={13} aria-hidden />
          <span aria-current="page">{bookingId}</span>
        </nav>
        <PreviewNote />
        <div style={{ marginTop: 16 }}>
          {!hydrated ? <div className="bk-empty">Loading your booking…</div>
            : !b || !l ? (
              <div className="bk-empty">
                <b>We couldn&apos;t find booking {bookingId}</b>
                Preview bookings live in this browser only. If you cleared site data or opened the link elsewhere, it won&apos;t be here.
              </div>
            ) : <BookingPanel booking={b} listing={l} />}
        </div>
        <div className="bk-actions" style={{ marginTop: 20 }}>
          <Link href={b ? `/dashboard/customer/bookings/${b.id}` : '/dashboard/customer/bookings'} className="bk-btn primary">View in My bookings</Link>
          <Link href="/" className="bk-btn secondary">Back to marketplace</Link>
          <Link href="/book" className="bk-btn secondary">Browse more preview listings</Link>
        </div>
        <p className="bk-note left">My bookings needs you to be signed in. Without an account you can keep using this page — bookmark it.</p>
      </div>
    </div>
  );
}
