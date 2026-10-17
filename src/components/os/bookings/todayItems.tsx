'use client';

/**
 * Booking items for the Overview › Today queue, from the PREVIEW booking engine (own listings
 * only): provider-owned clocks (enquiry replies, requests to accept, tasks such as DET guest
 * registration or the charter manifest, overdue check-outs, deposit decisions, "Chase …" payments on
 * direct-pay bookings) and today's
 * check-ins / event starts / departures. One item per booking; each links to the inbox with
 * ?id=<booking>. Marked with a Preview pill.
 */
import { useMemo } from 'react';
import { CalendarCheck, ClipboardCheck, Inbox, MessageSquare, ShieldCheck } from 'lucide-react';
import { PreviewPill } from '@/components/os/kit';
import { MODEL_LABEL, isEnded, ms, timerOf } from '@/lib/os/bookings/engine';
import { useNow } from '@/lib/os/bookings/store';
import type { TodayItem } from '@/app/rental-provider/dashboard/_today';
import { dayStart, fmtTime, inboxHref, useOwn } from './shared';

const ARRIVAL: Record<string, string> = { shortstay: 'Check-in today', venue: 'Event today', court: 'Court slot today', charter: 'Departure today' };

export function useBookingTodayItems(): TodayItem[] {
  const { bookings, byId } = useOwn();
  const now = useNow(60_000);
  return useMemo(() => {
    const out: TodayItem[] = [];
    const today = dayStart(now);
    for (const b of bookings) {
      if (isEnded(b.state)) continue;
      const l = byId.get(b.listingId);
      const where = `${b.customer.name} · ${l?.title ?? b.listingId}`;
      const t = timerOf(b, now);
      const title = (text: string) => <>{text} — {where} <PreviewPill /></>;
      if (t?.whose === 'provider') {
        const tone = t.tone === 'bad' ? 'bad' : t.tone === 'warn' ? 'warn' : 'info';
        const base = { key: `bk-${b.id}`, tone, dueAt: ms(t.deadline), due: t.label, action: { label: b.state === 'enquiry' || b.state === 'requested' ? 'Open request' : 'Open booking', href: inboxHref(b.id) } } as const;
        if (t.label.startsWith('Answer the date change')) {
          out.push({ ...base, band: 2, icon: CalendarCheck, title: title(`Answer the ${b.model === 'court' ? 'slot' : 'date'} change request`), consequence: 'If you do nothing the request lapses and the booking stays as it is' });
        } else if (b.state === 'provisional') {
          out.push({ ...base, band: 2, icon: ClipboardCheck, title: title('Provisional — record or chase the deposit'), consequence: 'The date is released automatically if the deposit is not recorded by then; you can extend the hold' });
        } else if (t.label.startsWith('Chase ')) {
          // Direct-pay booking: the customer pays the provider outside UpNow — nothing expires, the provider chases.
          out.push({ ...base, band: 3, icon: ClipboardCheck, title: title(t.label.replace(/ — (due in|overdue).*$/, '')), consequence: 'Paid to you directly — chase the customer, then mark it received so the booking shows what is still owed' });
        } else if (b.state === 'enquiry') {
          out.push({ ...base, band: 2, icon: MessageSquare, title: title('Reply to enquiry'), consequence: `${MODEL_LABEL[b.model]} — the first-reply clock counts toward your response rate` });
        } else if (b.state === 'requested') {
          out.push({ ...base, band: 2, icon: Inbox, title: title('Accept or decline request'), consequence: 'The dates are held for this customer; if you do nothing the request expires and counts against you' });
        } else if (b.state === 'completed') {
          out.push({ ...base, band: 3, icon: ShieldCheck, title: title('Release or claim the deposit'), consequence: 'After the 14-day window the hold is released automatically and no claim is possible' });
        } else if (b.state === 'confirmed') {
          out.push({ ...base, band: 3, icon: ClipboardCheck, title: title(t.label.replace(/ (due in|overdue).*$/, '')), consequence: `Compliance / preparation task for ${MODEL_LABEL[b.model].toLowerCase()}` });
        } else {
          out.push({ ...base, band: 3, icon: ClipboardCheck, title: title(t.label.replace(/ overdue.*$/, '')), consequence: 'Close the booking so the payout and review windows start' });
        }
        continue;
      }
      if (b.state === 'confirmed' && dayStart(ms(b.start)) === today) {
        out.push({
          key: `bk-${b.id}`, band: 6, tone: 'info', dueAt: ms(b.start), icon: CalendarCheck,
          title: title(ARRIVAL[b.model]), consequence: `${MODEL_LABEL[b.model]} starts ${fmtTime(b.start)} (Dubai)`,
          due: t?.label ?? `Starts ${fmtTime(b.start)}`, action: { label: 'Open booking', href: inboxHref(b.id) },
        });
      }
    }
    return out;
  }, [bookings, byId, now]);
}
