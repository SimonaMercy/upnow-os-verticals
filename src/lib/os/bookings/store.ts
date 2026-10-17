'use client';

/**
 * PREVIEW booking store — a module-level singleton (no React provider) persisted to
 * localStorage ('upnow.preview.bookings.v3') and synced across tabs via the 'storage' event.
 * (v2 = payment modes; v3 = provisional holds, lost leads, date changes, weekly court series —
 * a fresh key so every browser reseeds with examples of the new states.)
 *
 *   • SSR-safe: nothing touches `window` at import. The server snapshot is empty-but-valid
 *     (seed listings, no bookings). The client hydrates lazily on first read / subscribe.
 *   • `useBookings()` → BookingStore via useSyncExternalStore; the snapshot object is rebuilt
 *     only when state changes, so it is referentially stable between renders.
 *   • The engine's `sweep` runs on load, every 30s while anyone is subscribed, and after every
 *     action, so lapsed deadlines expire even with no clicks.
 *   • `advanceClock(ms)` moves a persisted demo clock forward (now() = Date.now() + offset).
 *   • `listingSettings` — the provider's per-listing overrides (payment model, instant booking),
 *     persisted with the rest and merged over the seed by effectiveListing(). `updateListing`
 *     changes them; a booking copies paymentMode at creation, so existing bookings keep theirs.
 *     resetDemo() clears them along with the bookings.
 *
 * Every screen using this store must render <PreviewBanner/>. Nothing is sent to the API.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { AvailabilityBlock, Booking, BookingStore, ListingSettings, NewBookingInput, PreviewListing } from './types';
import { applyCustomer, applyProvider, createBooking, createSeries as engineCreateSeries, effectiveListing, isTransitionError, overlaps, priceFor, sweep } from './engine';
import { refundFor } from './policies';
import { SEED_LISTINGS, seedBookings } from './seed';

export const STORAGE_KEY = 'upnow.preview.bookings.v3';
const SWEEP_EVERY_MS = 30_000;

interface Persisted {
  v: 1;
  bookings: Booking[];
  blocks: AvailabilityBlock[];
  clockOffsetMs: number;
  seededAt: number;
  listingSettings: Record<string, ListingSettings>;
}

let state: Persisted = { v: 1, bookings: [], blocks: [], clockOffsetMs: 0, seededAt: 0, listingSettings: {} };
let hydrated = false;
const listeners = new Set<() => void>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

const isBrowser = () => typeof window !== 'undefined';
const now = (): number => Date.now() + state.clockOffsetMs;

function read(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Persisted>;
    if (p?.v !== 1 || !Array.isArray(p.bookings) || !Array.isArray(p.blocks)) return null;
    return {
      v: 1, bookings: p.bookings, blocks: p.blocks, clockOffsetMs: Number(p.clockOffsetMs) || 0, seededAt: Number(p.seededAt) || 0,
      listingSettings: cleanSettings(p.listingSettings),
    };
  } catch {
    return null;
  }
}
/** Keep only known listings and valid fields (stored data is untrusted). */
function cleanSettings(raw: unknown): Record<string, ListingSettings> {
  const out: Record<string, ListingSettings> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SEED_LISTINGS.some((l) => l.id === id) || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const s: ListingSettings = {};
    if (o.paymentMode === 'platform' || o.paymentMode === 'direct') s.paymentMode = o.paymentMode;
    if (typeof o.instantBook === 'boolean') s.instantBook = o.instantBook;
    out[id] = s;
  }
  return out;
}

function write() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — keep working in memory */
  }
}

function freshState(offset = 0): Persisted {
  const t = Date.now() + offset;
  const seeded = seedBookings(t);
  if (seeded.errors.length && process.env.NODE_ENV !== 'production') console.warn('[preview bookings] seed errors', seeded.errors);
  return { v: 1, bookings: seeded.bookings, blocks: seeded.blocks, clockOffsetMs: offset, seededAt: t, listingSettings: {} };
}

function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return;
  const next = e.newValue ? read() : null;
  state = next ?? freshState();
  if (!next) write();
  rebuild();
}

function hydrate() {
  if (hydrated || !isBrowser()) return;
  hydrated = true;
  state = read() ?? freshState();
  state = { ...state, bookings: sweep(state.bookings, now()) };
  write();
  window.addEventListener('storage', onStorage);
  rebuild(false);
}

/** Replace state, sweep, persist, notify. */
function commit(next: Persisted) {
  state = { ...next, bookings: sweep(next.bookings, Date.now() + next.clockOffsetMs) };
  write();
  rebuild();
}

function runSweep() {
  const swept = sweep(state.bookings, now());
  if (swept !== state.bookings) commit({ ...state, bookings: swept });
}

function nextId(offset = 0): string {
  let max = 1000;
  for (const b of state.bookings) {
    const n = Number(b.id.replace(/^BK-/, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `BK-${max + 1 + offset}`;
}

/** Seed listings with the provider's settings applied — rebuilt only when settings change. */
let mergedFor: Record<string, ListingSettings> | null = null;
let merged: PreviewListing[] = SEED_LISTINGS;
function listings(): PreviewListing[] {
  if (mergedFor !== state.listingSettings) {
    merged = SEED_LISTINGS.map((l) => effectiveListing(l, state.listingSettings[l.id]));
    mergedFor = state.listingSettings;
  }
  return merged;
}

/** A listing as customers and the engine see it now (settings applied). */
export function getListing(id: string): PreviewListing | undefined {
  return listings().find((l) => l.id === id);
}

// ---------------------------------------------------------------------------- actions (stable references)

const advanceClock = (deltaMs: number) => {
  hydrate();
  commit({ ...state, clockOffsetMs: state.clockOffsetMs + deltaMs });
};
const resetDemo = () => {
  hydrate();
  commit(freshState(0));
};
const updateListing: BookingStore['updateListing'] = (listingId, patch) => {
  hydrate();
  const l = SEED_LISTINGS.find((x) => x.id === listingId);
  if (!l) return { error: 'Listing not found' };
  if (l.owner !== 'own') return { error: 'You can only change your own listings' };
  const cur = state.listingSettings[listingId] ?? {};
  const next: ListingSettings = { ...cur };
  if (patch.paymentMode !== undefined) {
    if (patch.paymentMode !== 'platform' && patch.paymentMode !== 'direct') return { error: 'Unknown payment model' };
    next.paymentMode = patch.paymentMode;
  }
  if (patch.instantBook !== undefined) {
    if ((next.paymentMode ?? l.paymentMode) === 'direct' && patch.instantBook) return { error: 'Instant booking needs payment on UpNow — direct-pay listings take requests only' };
    if (l.model === 'court') return { error: 'Courts paid on UpNow are always booked instantly' };
    next.instantBook = patch.instantBook;
  }
  commit({ ...state, listingSettings: { ...state.listingSettings, [listingId]: next } });
  return {};
};
const quote: BookingStore['quote'] = (input) => {
  const l = input.listingId ? getListing(input.listingId) : undefined;
  if (!l) return { lineItems: [], totalFils: 0, error: 'Listing not found' };
  return priceFor(l, input);
};
const isAvailable: BookingStore['isAvailable'] = (listingId, start, end, courtId) => {
  hydrate();
  return !overlaps({ listingId, start, end, courtId, now: now() }, state.bookings, state.blocks);
};
const create = (input: NewBookingInput): { booking?: Booking; error?: string } => {
  hydrate();
  const l = getListing(input.listingId);
  if (!l) return { error: 'Listing not found' };
  const t = now();
  const bookings = sweep(state.bookings, t);
  const r = createBooking(input, l, t, nextId(), { bookings, blocks: state.blocks });
  if (isTransitionError(r)) return { error: r.error };
  commit({ ...state, bookings: [...bookings, r] });
  return { booking: state.bookings.find((b) => b.id === r.id) ?? r };
};
const createSeries: BookingStore['createSeries'] = (input, weeks) => {
  hydrate();
  const l = getListing(input.listingId);
  if (!l) return { bookings: [], skipped: [], error: 'Listing not found' };
  const t = now();
  const bookings = sweep(state.bookings, t);
  const r = engineCreateSeries(input, l, t, (i) => nextId(i), weeks, { bookings, blocks: state.blocks });
  if (r.error) return r;
  commit({ ...state, bookings: [...bookings, ...r.bookings] });
  return { ...r, bookings: r.bookings.map((b) => state.bookings.find((x) => x.id === b.id) ?? b) };
};
function act(bookingId: string, run: (b: Booking, l: PreviewListing, t: number, bookings: Booking[]) => Booking | { error: string }): { error?: string } {
  hydrate();
  const t = now();
  const bookings = sweep(state.bookings, t);
  const b = bookings.find((x) => x.id === bookingId);
  if (!b) return { error: 'Booking not found' };
  const l = getListing(b.listingId);
  if (!l) return { error: 'Listing not found' };
  const r = run(b, l, t, bookings);
  if (isTransitionError(r)) {
    if (bookings !== state.bookings) commit({ ...state, bookings });
    return { error: r.error };
  }
  commit({ ...state, bookings: bookings.map((x) => (x.id === bookingId ? r : x)) });
  return {};
}
const providerAct: BookingStore['providerAct'] = (id, action) =>
  act(id, (b, l, t, bookings) => applyProvider(b, action, l, t, { bookings, blocks: state.blocks }));
const customerAct: BookingStore['customerAct'] = (id, action) =>
  act(id, (b, l, t, bookings) => applyCustomer(b, action, l, t, { bookings, blocks: state.blocks }));
const addBlock: BookingStore['addBlock'] = (block) => {
  hydrate();
  let n = 1;
  for (const k of state.blocks) {
    const v = Number(k.id.replace(/^BL-/, ''));
    if (Number.isFinite(v) && v >= n) n = v + 1;
  }
  commit({ ...state, blocks: [...state.blocks, { ...block, id: `BL-${n}` }] });
};
const removeBlock: BookingStore['removeBlock'] = (id) => {
  hydrate();
  commit({ ...state, blocks: state.blocks.filter((k) => k.id !== id) });
};
const refundQuote: BookingStore['refundQuote'] = (bookingId) => {
  hydrate();
  const b = state.bookings.find((x) => x.id === bookingId);
  const l = b ? getListing(b.listingId) : undefined;
  return b && l ? refundFor(b, l, now()) : null;
};

// ---------------------------------------------------------------------------- snapshot

function build(): BookingStore {
  return {
    listings: listings(),
    listingSettings: state.listingSettings,
    updateListing,
    bookings: state.bookings,
    blocks: state.blocks,
    clockOffsetMs: state.clockOffsetMs,
    now, advanceClock, resetDemo, quote, isAvailable, create, createSeries, providerAct, customerAct, addBlock, removeBlock, refundQuote,
  };
}
let snapshot: BookingStore = build();
const serverSnapshot: BookingStore = build();

function rebuild(notify = true) {
  snapshot = build();
  if (notify) listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  hydrate();
  listeners.add(cb);
  if (!sweepTimer && isBrowser()) sweepTimer = setInterval(runSweep, SWEEP_EVERY_MS);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  };
}
function getSnapshot(): BookingStore {
  hydrate();
  return snapshot;
}
const getServerSnapshot = (): BookingStore => serverSnapshot;

/** Non-hook API (also usable outside React). */
export const bookingStore = { subscribe, getSnapshot, getServerSnapshot };

export function useBookings(): BookingStore {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ---------------------------------------------------------------------------- live clock

/**
 * The store's now() (demo clock included), re-rendering every `intervalMs` and whenever the
 * clock is advanced. Values are quantised to the interval, so the snapshot (a number) only
 * changes once per tick. Use ~1000 for minute/second countdowns (court holds), 30000 otherwise.
 */
export function useNow(intervalMs = 30_000): number {
  const iv = Math.max(250, intervalMs);
  const sub = useCallback((cb: () => void) => {
    const unsub = subscribe(cb);
    const id = setInterval(cb, iv);
    return () => {
      clearInterval(id);
      unsub();
    };
  }, [iv]);
  const get = useCallback(() => {
    hydrate();
    return Math.floor(now() / iv) * iv;
  }, [iv]);
  const getServer = useCallback(() => Math.floor(Date.now() / iv) * iv, [iv]);
  return useSyncExternalStore(sub, get, getServer);
}
