/**
 * Hub-wide "Reports year" — a single year (or "All years") chosen in the Reports
 * page header that scopes the Executive Overview and becomes the default period
 * every time-based report opens with. Snapshot reports (occupancy, vacancy,
 * portfolio, missing-data) have no time dimension and ignore it.
 *
 * Persisted in localStorage so the choice survives navigation into a report's
 * own route (the detail view lives on a separate page and reads this as its
 * default). A custom event keeps every mounted control in sync within the tab.
 */
'use client';

import { useSyncExternalStore } from 'react';

export type ReportsYear = number | 'all';

/** Current calendar year — the default when nothing is stored. */
export const CURRENT_YEAR = new Date().getFullYear();
/** Earliest year offered in the picker (matches the matrix / deposit controls). */
const EARLIEST_YEAR = 2023;

const KEY = 'upnow.reports.year';
const EVT = 'upnow:reports-year';

/** Descending list of selectable years (current first), used by the header picker. */
export const REPORT_YEARS: number[] = Array.from(
  { length: CURRENT_YEAR - EARLIEST_YEAR + 1 },
  (_, i) => CURRENT_YEAR - i,
);

function isValidYear(n: number): boolean {
  return Number.isInteger(n) && n >= EARLIEST_YEAR && n <= CURRENT_YEAR + 1;
}

/** Read the stored year. SSR-safe: returns the current year on the server. */
export function getReportsYear(): ReportsYear {
  if (typeof window === 'undefined') return CURRENT_YEAR;
  const raw = window.localStorage.getItem(KEY);
  if (raw === 'all') return 'all';
  const n = Number(raw);
  return raw && isValidYear(n) ? n : CURRENT_YEAR;
}

/** Persist the chosen year and notify every subscriber in this tab. */
export function setReportsYear(year: ReportsYear): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, String(year));
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', cb); // cross-tab sync
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Reactive hook — re-renders when the hub year changes (incl. other tabs). */
export function useReportsYear(): ReportsYear {
  return useSyncExternalStore(subscribe, getReportsYear, () => CURRENT_YEAR);
}

/** Map the hub year to a date-range report's from/to. "All years" clears it. */
export function yearToRange(year: ReportsYear): { from: string; to: string } {
  if (year === 'all') return { from: '', to: '' };
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** A concrete year for controls that must pick one (the rent-roll matrix and
 *  the executive overview's single year-bound chart). "All years" → current. */
export function yearForMatrix(year: ReportsYear): number {
  return year === 'all' ? CURRENT_YEAR : year;
}

/** Short label for the picker / chips. */
export function yearLabel(year: ReportsYear): string {
  return year === 'all' ? 'All years' : String(year);
}
