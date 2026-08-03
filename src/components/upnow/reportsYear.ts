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
/**
 * Latest year offered. Held at the current year deliberately: a future year lists
 * renewals that are DUE but have no lease behind them yet, so the register reads
 * as though next year were already contracted. Reverted from CURRENT_YEAR + 1 on
 * 3 Aug 2026 for that reason — raise it only alongside a report that can state
 * clearly which rows are projected rather than recorded.
 */
export const LATEST_YEAR = CURRENT_YEAR;

const KEY = 'upnow.reports.year';
const EVT = 'upnow:reports-year';

/**
 * Descending list of selectable years (newest first) — the SINGLE source for
 * every year picker in the reports module.
 *
 * It was not always: ReportDetailView carried four inline copies of this range,
 * three capped at the current year and one, built from a different formula, that
 * reached a year further. Which picker a report happened to render decided which
 * years you could pick. Anything needing ascending order reverses a copy;
 * nothing rebuilds the range.
 */
export const REPORT_YEARS: number[] = Array.from(
  { length: LATEST_YEAR - EARLIEST_YEAR + 1 },
  (_, i) => LATEST_YEAR - i,
);

function isValidYear(n: number): boolean {
  // Keyed off LATEST_YEAR so the validator and the picker can never disagree
  // about how far forward a year may go — they did before, and the picker lost.
  return Number.isInteger(n) && n >= EARLIEST_YEAR && n <= LATEST_YEAR;
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
