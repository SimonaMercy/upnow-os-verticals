'use client';

/**
 * Shared helpers for the provider-side booking screens (short stays, venues, courts, charters)
 * that run on the PREVIEW booking engine (src/lib/os/bookings). Display only — every rule lives
 * in the engine. Times are shown in Asia/Dubai; money is integer fils.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Pill, type Tone } from '@/components/os/kit';
import { useBookings } from '@/lib/os/bookings/store';
import {
  DAY_MS, DUBAI_OFFSET_MS, HOUR_MS, MIN_MS, PAYMENT_MODE_LABEL, SOURCE_LABEL, STATE_TONE, hasDates, isEnded, modeOf, ms, nightsBetween, sourceOf,
  stateLabelFor, timerOf, type BookingTimer,
} from '@/lib/os/bookings/engine';
import type { Booking, BookingModel, BookingState, PreviewListing } from '@/lib/os/bookings/types';

export const RP = '/rental-provider/dashboard';
export const INBOX_HREF = `${RP}/requests`;
export const boardHref = (m: BookingModel) => `${RP}/v/spaces/${m}`;
export const CALENDAR_HREF = `${RP}/v/spaces/calendar`;
export const inboxHref = (id: string) => `${INBOX_HREF}?id=${encodeURIComponent(id)}`;

export const ENGINE_MODELS: BookingModel[] = ['shortstay', 'venue', 'court', 'charter'];
export const isEngineModel = (m: string): m is BookingModel => (ENGINE_MODELS as string[]).includes(m);

export const MODEL_SHORT: Record<BookingModel, string> = { shortstay: 'Stay', venue: 'Venue', court: 'Court', charter: 'Charter' };
export const BOARD_TONE: Record<BookingModel, 'booking' | 'res' | 'court' | 'charter'> = { shortstay: 'booking', venue: 'res', court: 'court', charter: 'charter' };

/** States where the customer's intent still needs converting (the Demand inbox). */
export const DEMAND_STATES: readonly BookingState[] = ['enquiry', 'offer_sent', 'requested', 'held', 'awaiting_payment', 'provisional'];
export const isDemand = (b: Booking) => DEMAND_STATES.includes(b.state);

// ---------------------------------------------------------------------------- Dubai time

const DUBAI = 'Asia/Dubai';
const fDay = new Intl.DateTimeFormat('en-GB', { timeZone: DUBAI, weekday: 'short', day: 'numeric', month: 'short' });
const fTime = new Intl.DateTimeFormat('en-GB', { timeZone: DUBAI, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fMonth = new Intl.DateTimeFormat('en-GB', { timeZone: DUBAI, month: 'long', year: 'numeric' });
const toMs = (t: number | string) => (typeof t === 'number' ? t : ms(t));

export const fmtDay = (t: number | string) => fDay.format(toMs(t));
export const fmtTime = (t: number | string) => fTime.format(toMs(t));
export const fmtDT = (t: number | string) => `${fmtDay(t)}, ${fmtTime(t)}`;
export const fmtMonth = (t: number | string) => fMonth.format(toMs(t));

/** 'YYYY-MM-DD' of an instant, in Dubai (for <input type="date">). */
export function dubaiYmd(t: number): string {
  const x = new Date(t + DUBAI_OFFSET_MS);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}
/** Dubai wall-clock 'YYYY-MM-DD' + hh:mm → epoch ms (NaN when invalid). */
export function dubaiMs(ymd: string, hh = 0, mm = 0): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - DUBAI_OFFSET_MS + hh * HOUR_MS + mm * MIN_MS;
}
/** 'HH:MM' → [h, m]. */
export function parseHm(s: string): [number, number] {
  const [h, m] = s.split(':').map(Number);
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}

// ---------------------------------------------------------------------------- booking text

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function courtName(l: PreviewListing | undefined, courtId?: string): string {
  if (!l || l.model !== 'court') return '';
  return l.courts.find((c) => c.id === courtId)?.name ?? (courtId ? courtId : 'All courts');
}

/** Dates or slot, in Dubai time. */
export function whenText(b: Pick<Booking, 'model' | 'start' | 'end' | 'details'>, l?: PreviewListing): string {
  if (!hasDates(b)) return 'Dates not given yet';
  switch (b.model) {
    case 'shortstay': {
      const n = nightsBetween(b.start, b.end);
      return `${fmtDay(b.start)} → ${fmtDay(b.end)} · ${plural(n, 'night')}`;
    }
    case 'court':
      return `${courtName(l, b.details.courtId)} · ${fmtDay(b.start)} ${fmtTime(b.start)}–${fmtTime(b.end)}`;
    case 'venue':
      return `${fmtDay(b.start)} ${fmtTime(b.start)}–${fmtTime(b.end)}`;
    case 'charter': {
      const h = Math.round(((ms(b.end) - ms(b.start)) / HOUR_MS) * 10) / 10;
      return `${fmtDay(b.start)} ${fmtTime(b.start)}–${fmtTime(b.end)} · ${h}h`;
    }
  }
}

export function guestsText(b: Booking): string {
  if (b.model === 'court') return plural(b.details.players ?? b.guests, 'player');
  if (b.model === 'venue') return `${plural(b.guests, 'guest')}${b.details.layout ? ` · ${b.details.layout}` : ''}`;
  return plural(b.guests, 'guest');
}

// ---------------------------------------------------------------------------- pills

export function StatePill({ b }: { b: Pick<Booking, 'model' | 'state'> }) {
  return <Pill tone={STATE_TONE[b.state] as Tone}>{stateLabelFor(b.model, b.state)}</Pill>;
}
export function ModelPill({ model }: { model: BookingModel }) {
  return <Pill tone="outline" dot={false}>{MODEL_SHORT[model]}</Pill>;
}
/** Who takes the money: On UpNow (platform) or Direct (customer pays the provider). */
export function PayModePill({ b }: { b: Pick<Booking, 'paymentMode'> }) {
  const m = modeOf(b);
  return (
    <Pill tone={m === 'direct' ? 'outline' : 'primary'} dot={false} title={m === 'direct' ? 'Customer pays you directly — nothing is charged on UpNow' : 'Paid on UpNow (card, refunds by policy, payout)'}>
      {m === 'direct' ? 'Direct pay' : PAYMENT_MODE_LABEL.platform}
    </Pill>
  );
}
/** Lead source tag (Form / Call / WhatsApp / Email). */
export function SourcePill({ b }: { b: Pick<Booking, 'source'> }) {
  const s = sourceOf(b);
  return <Pill tone={s === 'form' ? 'neutral' : 'info'} dot={false} title="How the customer reached you">{s === 'form' ? 'Form' : `Via ${SOURCE_LABEL[s]}`}</Pill>;
}
export const WHOSE_LABEL: Record<BookingTimer['whose'], string> = { provider: 'Your turn', customer: 'Customer’s turn', system: 'Automatic' };
export function TimerChip({ timer, showWhose = true }: { timer: BookingTimer | null; showWhose?: boolean }) {
  if (!timer) return null;
  const tone: Tone = timer.tone === 'bad' ? 'danger' : timer.tone === 'warn' ? 'amber' : timer.whose === 'provider' ? 'info' : 'neutral';
  return (
    <Pill tone={tone} title={`Deadline ${fmtDT(timer.deadline)} (Dubai)`}>
      {timer.label}{showWhose ? ` · ${WHOSE_LABEL[timer.whose]}` : ''}
    </Pill>
  );
}

// ---------------------------------------------------------------------------- ordering

const TONE_RANK = { bad: 0, warn: 1, ok: 2 } as const;
/**
 * Inbox order ("sort by the clock that runs out first"): provider-owned timers first (bad → warn
 * → ok, earliest deadline first), then customer-owned waits by deadline, then everything else
 * by start time.
 */
export function urgencyKey(b: Booking, now: number): [number, number, number] {
  const t = timerOf(b, now);
  if (t?.whose === 'provider') return [0, TONE_RANK[t.tone], ms(t.deadline)];
  if (t?.whose === 'customer') return [1, 0, ms(t.deadline)];
  if (t) return [2, 0, ms(t.deadline)];
  return [3, 0, hasDates(b) ? ms(b.start) : Number.MAX_SAFE_INTEGER];
}
export function byUrgency(now: number) {
  return (a: Booking, b: Booking) => {
    const ka = urgencyKey(a, now);
    const kb = urgencyKey(b, now);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.id.localeCompare(b.id);
  };
}

// ---------------------------------------------------------------------------- own data

/** The signed-in provider's listings (owner 'own') and their bookings. */
export function useOwn() {
  const store = useBookings();
  return useMemo(() => {
    const listings = store.listings.filter((l) => l.owner === 'own');
    const ids = new Set(listings.map((l) => l.id));
    const byId = new Map(store.listings.map((l) => [l.id, l] as const));
    return {
      store,
      listings,
      byId,
      bookings: store.bookings.filter((b) => ids.has(b.listingId)),
      blocks: store.blocks.filter((k) => ids.has(k.listingId)),
    };
  }, [store]);
}

export const isLive = (b: Booking) => !isEnded(b.state);

/** Start of the Dubai day containing t. */
export const dayStart = (t: number) => Math.floor((t + DUBAI_OFFSET_MS) / DAY_MS) * DAY_MS - DUBAI_OFFSET_MS;

// ---------------------------------------------------------------------------- media query

function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia('(max-width: 1000px)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
/** True below 1000px (where the split pane stacks) — the inbox opens a drawer instead. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia('(max-width: 1000px)').matches, () => false);
}
