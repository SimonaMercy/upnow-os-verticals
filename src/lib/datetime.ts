/**
 * App-wide display timezone — the single source of truth.
 *
 * UpNow operates in the UAE, so dates and times are rendered in this zone for
 * every viewer regardless of their browser timezone. Without it, a date-only
 * value (parsed by `new Date('2026-06-01')` as UTC midnight) renders as the
 * previous day for anyone west of UTC.
 *
 * Configurable: set NEXT_PUBLIC_APP_TIME_ZONE to override (e.g. for a future
 * market). Defaults to Asia/Dubai.
 */
export const APP_TIME_ZONE = process.env.NEXT_PUBLIC_APP_TIME_ZONE || 'Asia/Dubai';
