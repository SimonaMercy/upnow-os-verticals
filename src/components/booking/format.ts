/**
 * Customer-side helpers for the PREVIEW booking engine (src/lib/os/bookings): Dubai date
 * maths for form inputs, display formatting and listing card data. Pure — safe on the server.
 *
 * Asia/Dubai is a fixed UTC+4 (no DST), so a 'YYYY-MM-DD' + 'HH:MM' picked in the form maps
 * to one instant with the engine's DUBAI_OFFSET_MS.
 */
import { DAY_MS, DUBAI_OFFSET_MS, dubaiParts, formatAED, nightsBetween, type StateTone } from '@/lib/os/bookings/engine';
import type { Booking, BookingModel, PreviewListing } from '@/lib/os/bookings/types';

export const TZ = 'Asia/Dubai';
const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of instant t, as seen in Dubai. */
export function dubaiDateStr(t: number): string {
  const p = dubaiParts(t);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
/** The instant of `date` ('YYYY-MM-DD') at hh:mm Dubai. NaN when the date is invalid. */
export function dubaiInstant(date: string, hh = 0, mm = 0): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d, hh, mm) - DUBAI_OFFSET_MS;
}
/** 'YYYY-MM-DD' shifted by n days. */
export function addDays(date: string, n: number): string {
  const t = dubaiInstant(date, 12);
  return Number.isFinite(t) ? dubaiDateStr(t + n * DAY_MS) : date;
}
/** '15:00' → [15, 0]. */
export function hm(time: string): [number, number] {
  const [h, m] = time.split(':').map(Number);
  return [h || 0, m || 0];
}
/** Time options 'HH:MM' from fromHour to toHour (inclusive of fromHour, exclusive of toHour). */
export function timeOptions(fromHour: number, toHour: number, stepMin = 30): string[] {
  const out: string[] = [];
  for (let m = fromHour * 60; m < toHour * 60; m += stepMin) out.push(`${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`);
  return out;
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const dayShortFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });

const toDate = (v: string | number) => new Date(v);
export const fmtDay = (v: string | number) => dayFmt.format(toDate(v));
export const fmtDayShort = (v: string | number) => dayShortFmt.format(toDate(v));
export const fmtTime = (v: string | number) => timeFmt.format(toDate(v));
export const fmtDateTime = (v: string | number) => `${dayShortFmt.format(toDate(v))}, ${timeFmt.format(toDate(v))}`;

/** 'm:ss' countdown text (court checkout hold). */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export const MODEL_NOUN: Record<BookingModel, string> = {
  shortstay: 'Holiday home', venue: 'Event venue', court: 'Sports court', charter: 'Yacht charter',
};
export const MODEL_PLURAL: Record<BookingModel, string> = {
  shortstay: 'Holiday homes', venue: 'Venues', court: 'Sports courts', charter: 'Yacht charters',
};
export const MODEL_ORDER: BookingModel[] = ['shortstay', 'venue', 'court', 'charter'];
export const PREVIEW_NOTE = 'Preview — demonstration bookings, no real payment is taken';

/** Who the customer is dealing with, in words. */
export function providerNoun(model: BookingModel): string {
  return model === 'shortstay' ? 'host' : model === 'venue' ? 'venue' : model === 'court' ? 'club' : 'operator';
}

/** 'From' price for cards. */
export function fromPrice(l: PreviewListing): { price: string; per: string } {
  switch (l.model) {
    case 'shortstay': return { price: formatAED(l.nightlyFils), per: '/ night' };
    case 'venue':
      if (l.minSpendFils != null) return { price: formatAED(l.minSpendFils), per: 'min. spend' };
      if (l.hourlyFils != null) return { price: formatAED(l.hourlyFils), per: '/ hour' };
      return { price: formatAED(l.dayRateFils ?? 0), per: '/ day' };
    case 'court': return { price: formatAED(l.offPeakPer60Fils), per: '/ 60 min' };
    case 'charter': return { price: formatAED(l.hourlyFils), per: '/ hour' };
  }
}

export function maxVenueCapacity(l: PreviewListing): number {
  return l.model === 'venue' ? Math.max(...Object.values(l.capacity).map((n) => n ?? 0)) : 0;
}

/** One-line facts for cards and headers. */
export function metaLine(l: PreviewListing): string {
  switch (l.model) {
    case 'shortstay': return `${l.area} · ${l.bedrooms} BR · up to ${l.maxGuests} guests`;
    case 'venue': return `${l.area} · up to ${maxVenueCapacity(l)} guests`;
    case 'court': return `${l.area} · ${l.sport} · ${l.courts.length} court${l.courts.length === 1 ? '' : 's'}`;
    case 'charter': return `${l.departurePoint} · ${l.lengthFt}ft · up to ${l.capacity} guests`;
  }
}

/** Dates / slot of a booking in words. */
export function whenLabel(b: Booking, l?: PreviewListing): string {
  if (!Number.isFinite(new Date(b.start).getTime()) || !Number.isFinite(new Date(b.end).getTime())) return 'Dates to be agreed';
  if (b.model === 'shortstay') {
    const n = nightsBetween(b.start, b.end);
    return `${fmtDayShort(b.start)} → ${fmtDayShort(b.end)} · ${n} night${n === 1 ? '' : 's'}`;
  }
  const court = b.model === 'court' && l?.model === 'court' ? l.courts.find((c) => c.id === b.details.courtId)?.name : undefined;
  return `${fmtDay(b.start)} · ${fmtTime(b.start)}–${fmtTime(b.end)}${court ? ` · ${court}` : ''}`;
}

/** Timer tone → pill tone. */
export const TIMER_TONE: Record<'ok' | 'warn' | 'bad', StateTone> = { ok: 'primary', warn: 'amber', bad: 'danger' };
