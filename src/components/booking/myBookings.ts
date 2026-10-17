'use client';

/**
 * "My bookings" for the PREVIEW booking engine: the ids of bookings created from this browser,
 * kept in localStorage ('upnow.preview.mybookings.v1') and synced across tabs. Every access is
 * wrapped in try/catch — private mode / blocked storage just means an empty list.
 */
import { useSyncExternalStore } from 'react';

export const MY_BOOKINGS_KEY = 'upnow.preview.mybookings.v1';
const EMPTY: string[] = [];
let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(MY_BOOKINGS_KEY);
    const a: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function onStorage(e: StorageEvent) {
  if (e.key !== MY_BOOKINGS_KEY) return;
  cache = read();
  listeners.forEach((l) => l());
}

export function rememberBooking(id: string) {
  const ids = Array.from(new Set([...(cache ?? read()), id]));
  try {
    window.localStorage.setItem(MY_BOOKINGS_KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked — keep it for this page view */
  }
  cache = ids;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
}
function getSnapshot(): string[] {
  if (cache == null) cache = read();
  return cache;
}

/** Booking ids created from this browser (empty on the server). */
export function useMyBookingIds(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

const noop = () => () => {};
/** False during SSR and the hydration render, true afterwards — gate browser-only data on it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
