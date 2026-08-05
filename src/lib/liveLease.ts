/**
 * The platform's "is this tenancy live?" rule, front-end side.
 *
 * A clause-for-clause mirror of `LIVE_LEASE_TIPS_SQL` (backend
 * `src/shared/lease-sql.ts`), which is what the RP dashboard's Customers and
 * Active Leases tiles are counted with. Every page that derives live tenancies
 * from the flat `/contracts` feed (`listForRp`) imports from here, so the
 * Customers directory, the Leases register and the dashboard cannot drift.
 *
 *     contract_active = true
 *     AND status NOT IN ('expired','terminated')
 *     AND contract_end_date >= CURRENT_DATE
 *     AND NOT (termination accepted AND effective date passed)
 *     AND ((status = 'active' OR pdc_confirmed = true)   ← tier 1
 *          OR unit.availability = 'occupied')            ← tier 2
 *
 * Tier 1 is the earning rule (`LEASE_COUNTS_SQL`). Tier 2 adds the in-flight
 * renewal on a unit the customer still occupies — the tenancy has neither ended
 * nor been terminated, the cheques simply are not in yet. Tier 1 always wins on
 * a given unit, so a confirmed term never loses its place to a draft.
 *
 * ⚠️ Tier 2 MUST stay gated on occupancy. Without that gate this collapses into
 * the old chain-tip rule and re-admits unsigned drafts on VACANT units — the
 * case lease-sql.ts records as having quietly inflated receivables.
 *
 * RP 2 reference figures: 107 live leases (103 tier-1 + 4 tier-2), 93 customers.
 */

/** The fields the rule reads. Both the Customers and Leases pages map into this. */
export type LiveLeaseInput = {
  id?: number | null;
  unitId?: number | null;
  /** `unit.availability === 'occupied'` on the /contracts row. */
  unitOccupied?: boolean | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  contractActive?: boolean | null;
  pdcConfirmed?: boolean | null;
  terminationResponse?: string | null;
  terminationEffectiveDate?: string | null;
};

/** Today as a YYYY-MM-DD key — the client-side stand-in for SQL CURRENT_DATE. */
export function todayKey(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/**
 * Neither ENDED nor TERMINATED. A missing end date fails `>= CURRENT_DATE` in
 * SQL (NULL comparison), so it fails here too.
 */
export function leaseIsLive(l: LiveLeaseInput, today = todayKey()): boolean {
  if (l.contractActive !== true) return false;
  const status = (l.status ?? '').toLowerCase();
  if (status === 'expired' || status === 'terminated') return false;
  if (!l.endDate || l.endDate.slice(0, 10) < today) return false;
  return !(
    (l.terminationResponse ?? '') === 'accepted' &&
    l.terminationEffectiveDate &&
    l.terminationEffectiveDate.slice(0, 10) <= today
  );
}

/** Tier 1 — LEASE_COUNTS_SQL: live, and activated or cheques confirmed. */
export function leaseIsConfirmed(l: LiveLeaseInput, today = todayKey()): boolean {
  if (!leaseIsLive(l, today)) return false;
  return (l.status ?? '').toLowerCase() === 'active' || l.pdcConfirmed === true;
}

/** Tier 2 — live, not yet confirmed, on a unit the customer still occupies. */
export function leaseIsInFlight(l: LiveLeaseInput, today = todayKey()): boolean {
  return leaseIsLive(l, today) && !leaseIsConfirmed(l, today) && l.unitOccupied === true;
}

/** Either tier — the lease belongs to the live set. */
export function leaseIsCounted(l: LiveLeaseInput, today = todayKey()): boolean {
  return leaseIsConfirmed(l, today) || leaseIsInFlight(l, today);
}

/**
 * The ONE live lease per unit — `DISTINCT ON (unit_id) … ORDER BY confirmed
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
