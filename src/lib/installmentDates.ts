// Rent-installment due-date scheduling — FRONTEND PREVIEW MIRROR of the backend
// `buildInstallmentDueDates` (upnow-backend/src/contracts/installment-dates.ts).
//
// The cheque-schedule previews (new-lease form + renewal-propose modal) must show
// the SAME dates the backend will stamp, otherwise the RP sees one schedule and
// the tenant receives another. Keep this in lock-step with the backend helper:
//   • spread evenly over the ACTUAL term (start→end), not a hardcoded 12 months;
//   • snap each due date to the RP's configured `preferredChequeDays` (nearest to
//     the start day-of-month), clamped to the target month's length;
//   • pure string/UTC math so a YYYY-MM-DD never shifts a day by timezone.

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

const toIsoDate = (v: string | Date): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/** Add `months` to a YYYY-MM-DD string, clamping the day to the target month's length. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number); // m is 1..12
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12; // 0-based month of result
  const lastOfMonth = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, lastOfMonth))}`;
}

/**
 * Even-month installment due dates over the real term, as 'YYYY-MM-DD' strings.
 *
 * @param startIso   contract start (string or Date)
 * @param endIso     contract end = inclusive last day (null → 12-month fallback)
 * @param n          number of installments (>= 1)
 * @param chequeDays RP.preferredChequeDays, e.g. [1, 10, 25]; each due date snaps
 *                   to the configured day nearest the start day (clamped to month).
 */
export function buildInstallmentDueDates(
  startIso: string | Date,
  endIso: string | Date | null | undefined,
  n: number,
  chequeDays?: number[] | null,
): string[] {
  if (!startIso || !(n > 0)) return [];
  const start = toIsoDate(startIso);
  const [sy, sm, sd] = start.split('-').map(Number);

  let termMonths = 12;
  if (endIso) {
    const [ey, em, ed] = toIsoDate(endIso).split('-').map(Number);
    const endPlus = new Date(Date.UTC(ey, em - 1, ed + 1)); // end is the inclusive last day
    termMonths = (endPlus.getUTCFullYear() * 12 + endPlus.getUTCMonth()) - (sy * 12 + (sm - 1));
  }
  if (!(termMonths > 0)) termMonths = 12;

  const interval = termMonths / n;
  const day = Array.isArray(chequeDays) && chequeDays.length
    ? chequeDays.reduce((best, c) => (Math.abs(c - sd) < Math.abs(best - sd) ? c : best), chequeDays[0])
    : sd;

  return Array.from({ length: n }, (_, k) => {
    const raw = addMonthsIso(start, Math.round(k * interval)); // keeps start day-of-month
    const [ry, rm] = raw.split('-').map(Number);
    const lastOfMonth = new Date(Date.UTC(ry, rm, 0)).getUTCDate();
    return `${ry}-${pad(rm)}-${pad(Math.min(day, lastOfMonth))}`;
  });
}
