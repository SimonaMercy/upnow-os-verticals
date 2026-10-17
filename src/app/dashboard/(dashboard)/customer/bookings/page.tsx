'use client';
/* eslint-disable @next/next/no-img-element -- small static images from /public/marketspace, same as the marketplace cards */

/**
 * Customer "My bookings" — PREVIEW short stays, venues, courts and yacht charters
 * (browser-only booking engine, src/lib/os/bookings; no backend, no real payment).
 *
 * "Mine" = bookings created from this browser (localStorage 'upnow.preview.mybookings.v1')
 * plus bookings whose customer email matches the signed-in user. A "Show demo bookings"
 * toggle lists every seeded booking so reviewers can try each state.
 */
import Link from 'next/link';
import { useState } from 'react';
import { CalendarCheck, Plus } from 'lucide-react';
import { Pill } from '@/components/os/kit';
import { useAuth } from '@/contexts/AuthContext';
import { getListing, useBookings, useNow } from '@/lib/os/bookings/store';
import { MODEL_LABEL, STATE_TONE, customerStateLabel, formatAED, hasDates, isDirect, ms, nextActions, timerOf } from '@/lib/os/bookings/engine';
import type { Booking, BookingState } from '@/lib/os/bookings/types';
import { TimerPill } from '@/components/booking/BookingPanel';
import { whenLabel } from '@/components/booking/format';
import { useHydrated, useMyBookingIds } from '@/components/booking/myBookings';
import { PreviewNote } from '@/components/booking/ui';

type Tab = 'upcoming' | 'action' | 'past' | 'cancelled';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' }, { id: 'action', label: 'Action needed' }, { id: 'past', label: 'Past' }, { id: 'cancelled', label: 'Cancelled' },
];
const CANCELLED: readonly BookingState[] = ['declined', 'expired', 'cancelled_by_customer', 'cancelled_by_provider', 'no_show', 'lost'];
const PAST: readonly BookingState[] = ['completed', 'closed'];
const CUSTOMER_MOVES = ['pay', 'accept_offer', 'accept_change', 'provide_ids', 'review'];

function needsAction(b: Booking, now: number): boolean {
  const l = getListing(b.listingId);
  // Direct-pay: a confirmed booking with money still due means "pay the provider directly" (outside the app).
  if (isDirect(b) && ['provisional', 'confirmed', 'completed'].includes(b.state) && b.payments.some((p) => p.status === 'due')) return true;
  return !!l && nextActions(b, 'customer', l, now).some((a) => CUSTOMER_MOVES.includes(a.action));
}
function inTab(b: Booking, tab: Tab, now: number): boolean {
  if (tab === 'action') return needsAction(b, now);
  if (tab === 'cancelled') return CANCELLED.includes(b.state);
  if (tab === 'past') return PAST.includes(b.state);
  return !CANCELLED.includes(b.state) && !PAST.includes(b.state);
}
const startOf = (b: Booking) => (hasDates(b) ? ms(b.start) : Number.MAX_SAFE_INTEGER);
function sortFor(tab: Tab, now: number) {
  return (a: Booking, b: Booking) => {
    if (tab === 'past') return startOf(b) - startOf(a);
    if (tab === 'cancelled') return ms(b.updatedAt) - ms(a.updatedAt);
    if (tab === 'action') {
      const da = timerOf(a, now, 'customer')?.deadline, db = timerOf(b, now, 'customer')?.deadline;
      return (da ? ms(da) : Number.MAX_SAFE_INTEGER) - (db ? ms(db) : Number.MAX_SAFE_INTEGER) || startOf(a) - startOf(b);
    }
    return startOf(a) - startOf(b);
  };
}

export default function CustomerBookingsPage() {
  const { user } = useAuth();
  const hydrated = useHydrated();
  const store = useBookings();
  const now = useNow(30_000);
  const myIds = useMyBookingIds();
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');

  const email = user?.email?.trim().toLowerCase();
  const isMine = (b: Booking) => myIds.includes(b.id) || (!!email && b.customer.email?.trim().toLowerCase() === email);
  const mine = store.bookings.filter(isMine);
  const pool = demo ? store.bookings : mine;
  const counts = Object.fromEntries(TABS.map((t) => [t.id, pool.filter((b) => inTab(b, t.id, now)).length])) as Record<Tab, number>;
  const rows = pool.filter((b) => inTab(b, tab, now)).sort(sortFor(tab, now));

  return (
    <div className="bk px-6 py-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-neutral-900)' }}>My bookings</h1>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--color-neutral-500)' }}>
            Holiday homes, venues, sports courts and yacht charters — requests, payments and what happens next.
          </p>
        </div>
        <Link href="/book" className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={15} aria-hidden /> Book something
        </Link>
      </div>
      <PreviewNote />

      <div className="flex items-center justify-between gap-3 flex-wrap" style={{ margin: '16px 0 14px' }}>
        <div className="bk-tabs" role="tablist" aria-label="Booking status">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}<span className="n">{hydrated ? counts[t.id] : '·'}</span>
            </button>
          ))}
        </div>
        <label className="bk-check" style={{ marginTop: 0 }}>
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <span>Show demo bookings<small>Every seeded booking, so you can try each state</small></span>
        </label>
      </div>

      {!hydrated ? <div className="bk-empty">Loading bookings…</div>
        : pool.length === 0 ? (
          <div className="bk-empty">
            <CalendarCheck size={26} aria-hidden style={{ margin: '0 auto 8px', color: 'var(--ms-primary)' }} />
            <b>No bookings yet</b>
            Book a holiday home, venue, court or yacht from the marketplace — or tick <em>Show demo bookings</em> to explore every booking state.
            <div className="bk-actions" style={{ justifyContent: 'center', marginTop: 14 }}>
              <Link href="/book" className="bk-btn primary sm">Browse preview listings</Link>
              <button type="button" className="bk-btn secondary sm" onClick={() => setDemo(true)}>Show demo bookings</button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="bk-empty"><b>Nothing here</b>No {TABS.find((t) => t.id === tab)!.label.toLowerCase()} bookings.</div>
        ) : (
          <div>
            {rows.map((b) => {
              const l = getListing(b.listingId);
              if (!l) return null;
              return (
                <article key={b.id} className="bk-bcard">
                  <img src={l.images[0]} alt="" />
                  <div className="body">
                    <div className="t">{l.title}</div>
                    <div className="m">{MODEL_LABEL[b.model]} · {whenLabel(b, l)}</div>
                    <div className="m">{b.id} · {isDirect(b) ? (b.model === 'court' ? 'Pay at the venue' : `Pay ${l.providerName} directly`) : 'Paid on UpNow'}{!isMine(b) && <> · demo booking for {b.customer.name}</>}</div>
                    <div className="pills">
                      <Pill tone={STATE_TONE[b.state]}>{customerStateLabel(b.model, b.state)}</Pill>
                      <TimerPill b={b} now={now} />
                    </div>
                  </div>
                  <div className="side">
                    <span className="total">{formatAED(b.totalFils)}</span>
                    <Link href={`/dashboard/customer/bookings/${b.id}`} className="bk-btn secondary sm">Open booking</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
    </div>
  );
}
