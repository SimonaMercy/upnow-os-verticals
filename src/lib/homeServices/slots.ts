/**
 * Booking slot grid helpers — all in UAE time (Asia/Dubai, UTC+4, no DST),
 * whatever the viewer's browser timezone is.
 *
 * Frontend guard only: past hours (and hours inside the lead time) are greyed
 * out. Real capacity — whether a provider is actually free at that hour — is
 * the backend's call and is NOT modelled here.
 */

export const SLOT_HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 08:00–20:00 start times
/** Dubai is a fixed UTC+4 (no daylight saving). */
const DUBAI_OFFSET = '+04:00';
/**
 * Minimum notice for a slot when the catalogue declares none: one hour, so a
 * professional can actually travel to the address.
 */
export const DEFAULT_LEAD_MINUTES = 60;

export interface DayOption { value: string; wd: string; num: string; mon: string; isToday: boolean }

/** YYYY-MM-DD of `now` in Dubai. */
export function dubaiDateKey(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** ISO instant for a Dubai wall-clock slot (`day` = YYYY-MM-DD, `hour` 0–23). */
export function slotStartIso(day: string, hour: number): string {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00${DUBAI_OFFSET}`).toISOString();
}

/** True when the slot starts before now + lead time (past, or too soon to travel). */
export function isSlotUnavailable(day: string, hour: number, now: Date, leadMinutes = DEFAULT_LEAD_MINUTES): boolean {
  return new Date(slotStartIso(day, hour)).getTime() < now.getTime() + leadMinutes * 60_000;
}

/**
 * The next `count` Dubai calendar days starting today. Today is dropped when
 * every one of its slots has already gone.
 */
export function bookingDays(now: Date, count = 14, leadMinutes = DEFAULT_LEAD_MINUTES): DayOption[] {
  const todayKey = dubaiDateKey(now);
  const [y, m, d] = todayKey.split('-').map(Number);
  const out: DayOption[] = [];
  for (let i = 0; i < count; i++) {
    // Noon UTC on the Dubai date — formatting it in Dubai never crosses midnight.
    const dt = new Date(Date.UTC(y, m - 1, d + i, 12));
    const value = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    if (i === 0 && SLOT_HOURS.every((h) => isSlotUnavailable(value, h, now, leadMinutes))) continue;
    out.push({
      value,
      wd: dt.toLocaleDateString('en-AE', { weekday: 'short', timeZone: 'UTC' }),
      num: String(dt.getUTCDate()),
      mon: dt.toLocaleDateString('en-AE', { month: 'short', timeZone: 'UTC' }),
      isToday: i === 0,
    });
  }
  return out;
}

/** Lead time from a catalogue service, if it declares one (read defensively — no such field today). */
export function leadMinutesOf(svc: { leadTimeMinutes?: number | null; minLeadHours?: number | null } | null | undefined): number {
  if (svc?.leadTimeMinutes != null && svc.leadTimeMinutes > 0) return svc.leadTimeMinutes;
  if (svc?.minLeadHours != null && svc.minLeadHours > 0) return svc.minLeadHours * 60;
  return DEFAULT_LEAD_MINUTES;
}
