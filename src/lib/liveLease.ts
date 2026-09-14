/**
 * The platform's "is this tenancy current?" rule, front-end side.
 *
 * A clause-for-clause mirror of `LIVE_LEASE_TIPS_SQL` / `CURRENT_LEASE_SQL`
 * (backend `src/shared/lease-sql.ts`), which the RP dashboard's Active Leases and
 * Customers tiles count with. Every page that derives tenancies from the flat
 * `/contracts` feed (`listForRp`) imports from here, so the Customers directory,
 * the Leases register and the dashboard cannot drift.
 *
 *     contract_active = true
 *     AND status NOT IN ('expired','terminated')
 *     AND contract_start_date <= today (Dubai)
 *     AND contract_end_date   >= today (Dubai)
 *     AND no termination started (termination_response <> 'accepted')
 *     AND (status = 'active' OR pdc_confirmed = true     ← confirmed
 *          OR contract_type = 'renewal')                 ← running renewal
 *
 * A lease that starts later is not current, and a unit is vacant the moment a
 * termination is started on its lease (both decided 14 Sep 2026). Per unit, a
 * confirmed lease always wins over an unconfirmed one, then the later start.
 */

/** The fields the rule reads. Both the Customers and Leases pages map into this. */
export type LiveLeaseInput = {
  id?: number | null;
  unitId?: number | null;
  /** 'renewal' | 'new' | … — a running renewal counts before it is confirmed. */
  contractType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  contractActive?: boolean | null;
  pdcConfirmed?: boolean | null;
  terminationResponse?: string | null;
  terminationEffectiveDate?: string | null;
};

/**
 * Today in Dubai as a YYYY-MM-DD key — the client-side stand-in for the backend's
 * `DUBAI_TODAY_SQL`. Never the browser's local date: a landlord abroad would
 * otherwise count a different set of leases from the server.
 */
export function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Running today: started, not ended, not expired or terminated, no termination
 * started. A missing start or end date fails the SQL comparison, so it fails here.
 */
export function leaseIsLive(l: LiveLeaseInput, today = todayKey()): boolean {
  if (l.contractActive !== true) return false;
  const status = (l.status ?? '').toLowerCase();
  if (status === 'expired' || status === 'terminated') return false;
  if (!l.startDate || l.startDate.slice(0, 10) > today) return false;
  if (!l.endDate || l.endDate.slice(0, 10) < today) return false;
  return (l.terminationResponse ?? '') !== 'accepted';
}

/** Running today and activated, or its payment confirmed. */
export function leaseIsConfirmed(l: LiveLeaseInput, today = todayKey()): boolean {
  if (!leaseIsLive(l, today)) return false;
  return (l.status ?? '').toLowerCase() === 'active' || l.pdcConfirmed === true;
}

/** Running today, not yet confirmed, and a renewal for the customer already in the unit. */
export function leaseIsInFlight(l: LiveLeaseInput, today = todayKey()): boolean {
  return leaseIsLive(l, today) && !leaseIsConfirmed(l, today) && (l.contractType ?? '').toLowerCase() === 'renewal';
}

/** A current lease — either tier. */
export function leaseIsCounted(l: LiveLeaseInput, today = todayKey()): boolean {
  return leaseIsConfirmed(l, today) || leaseIsInFlight(l, today);
}

/**
 * The ONE current lease per unit — `DISTINCT ON (unit_id) … ORDER BY confirmed
 * DESC, contract_start_date DESC, id DESC`. Rows with no unit stand alone, so a
 * unit-less lease is never silently merged with another.
 *
 * `read` maps each caller's row into the fields the rule needs; the ORIGINAL
 * items come back, so callers keep their own richer shape.
 */
export function liveLeaseTips<T>(items: T[], read: (item: T) => LiveLeaseInput): T[] {
  const today = todayKey();
  const byUnit = new Map<string, { item: T; l: LiveLeaseInput; confirmed: boolean }>();
  items.forEach((item, i) => {
    const l = read(item);
    const confirmed = leaseIsConfirmed(l, today);
    if (!confirmed && !leaseIsInFlight(l, today)) return;
    const key = l.unitId != null ? `u-${l.unitId}` : `x-${l.id ?? i}`;
    const held = byUnit.get(key);
    if (!held) { byUnit.set(key, { item, l, confirmed }); return; }
    if (confirmed !== held.confirmed) {
      if (confirmed) byUnit.set(key, { item, l, confirmed });
      return;
    }
    const a = String(l.startDate ?? ''), b = String(held.l.startDate ?? '');
    if (a > b || (a === b && (l.id ?? 0) > (held.l.id ?? 0))) byUnit.set(key, { item, l, confirmed });
  });
  return Array.from(byUnit.values()).map((e) => e.item);
}
