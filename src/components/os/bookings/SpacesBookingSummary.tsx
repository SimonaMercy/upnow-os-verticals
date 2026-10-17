'use client';

/**
 * Live per-model counts from the PREVIEW booking engine (own listings): open requests, today's
 * arrivals and revenue confirmed this month (Dubai calendar month, by start date). Links to the
 * model boards and the All demand inbox.
 */
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Btn, Card, Kpi, Kpis } from '@/components/os/kit';
import { MODEL_LABEL, dubaiParts, formatAED, ms } from '@/lib/os/bookings/engine';
import { useNow } from '@/lib/os/bookings/store';
import type { BookingModel, BookingState } from '@/lib/os/bookings/types';
import { CALENDAR_HREF, ENGINE_MODELS, INBOX_HREF, boardHref, dayStart, isDemand, useOwn } from './shared';

const CONFIRMED: BookingState[] = ['confirmed', 'checked_in', 'in_progress', 'completed', 'closed', 'no_show'];
const ARRIVING: BookingState[] = ['confirmed', 'checked_in', 'in_progress'];

export function SpacesBookingSummary() {
  const { bookings, listings } = useOwn();
  const now = useNow(60_000);
  const stats = useMemo(() => {
    const today = dayStart(now);
    const p = dubaiParts(now);
    const per = {} as Record<BookingModel, { open: number; arrivals: number; revenue: number; listings: number }>;
    for (const m of ENGINE_MODELS) per[m] = { open: 0, arrivals: 0, revenue: 0, listings: listings.filter((l) => l.model === m).length };
    for (const b of bookings) {
      const s = per[b.model];
      if (isDemand(b)) s.open++;
      if (ARRIVING.includes(b.state) && dayStart(ms(b.start)) === today) s.arrivals++;
      const sp = dubaiParts(ms(b.start));
      if (CONFIRMED.includes(b.state) && sp.y === p.y && sp.m === p.m) s.revenue += b.totalFils;
    }
    const tot = ENGINE_MODELS.reduce((a, m) => ({ open: a.open + per[m].open, arrivals: a.arrivals + per[m].arrivals, revenue: a.revenue + per[m].revenue }), { open: 0, arrivals: 0, revenue: 0 });
    return { per, tot };
  }, [bookings, listings, now]);

  return (
    <>
      <Kpis>
        <Kpi dark k="Revenue confirmed this month" v={formatAED(stats.tot.revenue)} d="Stays, venues, courts and charters starting this month" />
        <Kpi k="Open requests" v={stats.tot.open} d="Enquiries, requests, offers, holds, unpaid" href={INBOX_HREF} />
        <Kpi k="Today's arrivals" v={stats.tot.arrivals} d="Check-ins, events, slots and departures" href={CALENDAR_HREF} />
      </Kpis>
      <div className="gx-cols gx-cols-2e" style={{ marginBottom: 14 }}>
        {ENGINE_MODELS.map((m) => {
          const s = stats.per[m];
          return (
            <Card key={m} title={MODEL_LABEL[m]} sub={`${s.listings} listing${s.listings === 1 ? '' : 's'}`}
              right={<><Btn size="sm" href={INBOX_HREF}>Requests</Btn><Btn size="sm" href={boardHref(m)}>Open board <ArrowRight size={13} aria-hidden /></Btn></>} pad>
              <div className="gx-kv">
                <div><div className="k">Open requests</div><div className="v">{s.open}</div></div>
                <div><div className="k">Today&apos;s arrivals</div><div className="v">{s.arrivals}</div></div>
                <div><div className="k">Confirmed this month</div><div className="v">{formatAED(s.revenue)}</div></div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
