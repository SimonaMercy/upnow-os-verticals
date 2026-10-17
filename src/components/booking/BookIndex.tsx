'use client';

/** /book — every PREVIEW listing (holiday homes, venues, courts, yachts) with model filter chips. */
import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { SEED_LISTINGS } from '@/lib/os/bookings/seed';
import { useBookings } from '@/lib/os/bookings/store';
import { useHydrated } from './myBookings';
import type { BookingModel } from '@/lib/os/bookings/types';
import { MODEL_ORDER, MODEL_PLURAL } from './format';
import { ListingCard, PreviewNote } from './ui';

export function BookIndex({ initialModel }: { initialModel: BookingModel | null }) {
  const [model, setModel] = useState<BookingModel | null>(initialModel);
  const hydrated = useHydrated();
  const store = useBookings();
  // After hydration, the store's listings carry the providers' payment-model settings.
  const all = hydrated ? store.listings : SEED_LISTINGS;
  const shown = model ? all.filter((l) => l.model === model) : all;
  const pick = (m: BookingModel | null) => {
    setModel(m);
    try {
      window.history.replaceState(null, '', m ? `/book?model=${m}` : '/book');
    } catch { /* ignore */ }
  };
  return (
    <div className="bk bk-page">
      <div className="wrap">
        <nav className="bk-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link><ChevronRight size={13} aria-hidden /><span aria-current="page">Preview bookings</span>
        </nav>
        <PreviewNote />
        <div className="bk-head" style={{ margin: '18px 0 10px' }}>
          <h1>Holiday homes, venues, courts &amp; yachts</h1>
          <div className="sub">Try the booking flow end to end — some providers take payment on UpNow (request, instant book, pay — simulated), others confirm and you pay them directly. Track it all in My bookings.</div>
        </div>
        <div className="bk-chips" role="group" aria-label="Filter by type">
          <button type="button" aria-pressed={model === null} onClick={() => pick(null)}>All ({SEED_LISTINGS.length})</button>
          {MODEL_ORDER.map((m) => (
            <button key={m} type="button" aria-pressed={model === m} onClick={() => pick(m)}>
              {MODEL_PLURAL[m]} ({SEED_LISTINGS.filter((l) => l.model === m).length})
            </button>
          ))}
        </div>
        <div className="bk-grid">{shown.map((l) => <ListingCard key={l.id} l={l} />)}</div>
      </div>
    </div>
  );
}
