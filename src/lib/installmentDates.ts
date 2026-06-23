// Rent-installment due-date scheduling — FRONTEND PREVIEW MIRROR of the backend
// `buildInstallmentDueDates` (upnow-backend/src/contracts/installment-dates.ts).
//
// The cheque-schedule previews (new-lease form + renewal-propose modal) must show
// the SAME dates the backend will stamp, otherwise the RP sees one schedule and
// the tenant receives another. Keep this in lock-step with the backend helper:
//   • spread evenly over the ACTUAL term (start→end), not a hardcoded 12 months;
//   • snap each due date BACK to the RP's configured `preferredChequeDays` on/before
//     it (so cheques land before each period; the first before move-in), walking
//     into the prior month when needed, clamped to the target month's length;
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
 * Snap a YYYY-MM-DD date BACK to the latest configured cheque day on/before it,
 * walking into the prior month when none in the current month qualifies — so a
 * cheque is always collected before its period (the first one before the lease
 * start). For a 1st-of-month start with days [10, 25] the result is the 25th of
 * the PRIOR month. No-op (keeps the date's own day-of-month) when no cheque days.
 */
export function snapBackToChequeDay(iso: string | Date, chequeDays?: number[] | null): string {
  const base = toIsoDate(iso);
  const days = Array.isArray(chequeDays)
    ? [...chequeDays].filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b)
    : [];
  if (days.length === 0) return base;
  const [y, m, d] = base.split('-').map(Number); // m is 1..12
  const onOrBefore = days.filter((x) => x <= d);
  if (onOrBefore.length) {
    return `${y}-${pad(m)}-${pad(onOrBefore[onOrBefore.length - 1])}`;
  }
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const lastOfMonth = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${pad(pm)}-${pad(Math.min(days[days.length - 1], lastOfMonth))}`;
}

/**
 * Even-month installment due dates over the real term, as 'YYYY-MM-DD' strings.
 *
 * @param startIso   contract start (string or Date)
 * @param endIso     contract end = inclusive last day (null → 12-month fallback)
 * @param n          number of installments (>= 1)
 * @param chequeDays RP.preferredChequeDays, e.g. [1, 10, 25]; each due date snaps
 *                   BACK to the configured day on/before it (so cheques land
 *                   before each period). No config ⇒ keeps the start day-of-month.
 */
export function buildInstallmentDueDates(
  startIso: string | Date,
  endIso: string | Date | null | undefined,
  n: number,
  chequeDays?: number[] | null,
): string[] {
  if (!startIso || !(n > 0)) return [];
  const start = toIsoDate(startIso);
  const [sy, sm] = start.split('-').map(Number);

  let termMonths = 12;
  if (endIso) {
    const [ey, em, ed] = toIsoDate(endIso).split('-').map(Number);
    const endPlus = new Date(Date.UTC(ey, em - 1, ed + 1)); // end is the inclusive last day
    termMonths = (endPlus.getUTCFullYear() * 12 + endPlus.getUTCMonth()) - (sy * 12 + (sm - 1));
  }
  if (!(termMonths > 0)) termMonths = 12;

  const interval = termMonths / n;
  return Array.from({ length: n }, (_, k) => {
    const raw = addMonthsIso(start, Math.round(k * interval)); // keeps start day-of-month
    return snapBackToChequeDay(raw, chequeDays);
  });
}
