/**
 * Shared derivation for the Customers directory (RP + manager mirror).
 *
 * Both pages render the same Claude-Design "Customers" handoff and read the same
 * flat /contracts list (backend `listForRp`). This collapses that list into one
 * row per customer with the aggregates the cards need: lease count, counting-lease
 * count, rent arrears, and the next renewal date.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * "Total customers" and "Active leases" use the platform's ONE earning-lease
 * rule — a front-end mirror of `LEASE_COUNTS_SQL` (backend shared/lease-sql.ts),
 * the same predicate behind the portfolio rent KPI and Cash Management:
 *
 *     contract_active = true
 *     AND status NOT IN ('expired','terminated')
 *     AND contract_end_date >= CURRENT_DATE
 *     AND NOT (termination accepted AND effective date passed)
 *     AND (status = 'active' OR pdc_confirmed = true)
 *
 * plus that rule's prescribed `DISTINCT ON (unit_id)` pairing — newest start,
 * then highest id — so a renewal supersedes the term it replaces instead of
 * being counted beside it.
 *
 * ── The in-flight fallback ──────────────────────────────────────────────────
 * That rule alone leaves out a real customer: a unit still physically OCCUPIED
 * whose only live lease is an in-flight renewal (`pending` / `issued`, cheques
 * not yet confirmed) sitting on top of a term that has run out. The tenancy is
 * neither terminated nor ended — the customer is in the unit — so the directory
 * counts it. CEO ruling, 5 Aug 2026; on RP 2 these are the four units the
 * dashboard's occupancy tile counts and the strict rule did not (316 + 214
 * Avenue Residence, Room-16 + Room-17 Al Qouz).
 *
 * The fallback is a SECOND tier, never a replacement: per unit a lease meeting
 * the strict rule always wins, and only a unit with none of those falls through
 * to its in-flight lease. That keeps every existing attribution (and its
 * arrears) exactly where it was, and it is gated on `unit.availability` so an
 * unsigned draft on a VACANT unit — the case shared/lease-sql.ts documents as
 * having quietly inflated the receivables — still does not count.
 *
 * Together the two tiers reconcile this page to the dashboard: RP 2 = 107
 * leases (103 strict + 4 in-flight) across 93 customers.
 *
 * This deliberately replaces the older `liveLeaseTips` chain-tip predicate,
 * which counted in-flight drafts on any unit, occupied or not. Consequence to
 * know: this page is no longer the exact inverse of the Ended Leases nav, which
 * still uses the backend's own definition.
 *
 * Customers with NO counting lease are still returned, flagged `active: false`,
 * so the directory's "Ended leases" filter can show them.
 *
 * NOTE: assumes superseded renewal duplicates were already dropped upstream —
 * the backend listForRp does this before returning the /contracts list.
 */

import { liveLeaseTips } from './liveLease';

/** One row from `/contracts` (backend `listForRp`) — only the fields we read. */
export type DirectoryContractRow = {
  id: number | null;
  status: string | null;
  contractActive: boolean | null;
  pdcConfirmed?: boolean | null;
  annualRent: number | null;
  outstanding?: number | null;
  startDate: string | null;
  endDate: string | null;
  termination?: { response?: string | null; effectiveDate?: string | null } | null;
  tenant: {
    id: number | null;
    name: string | null;
    email: string | null;
    phone?: string | null;
    entityType?: string | null;
    companyName?: string | null;
  } | null;
  unit: { id: number | null; availability?: string | null } | null;
};

/** Per-customer display model shared by the Row and Grid cards. */
export type DirectoryCustomer = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: boolean;
  /** Has at least one counting lease — i.e. belongs in the active directory. */
  active: boolean;
  leaseCount: number;
  activeLeaseCount: number;
  /** Rent arrears across the customer's counting leases (AED). */
  outstanding: number;
  /**
   * The SOONEST renewal among counting leases — the next upcoming end date, or
   * the most-overdue end if every counting lease has already lapsed. A customer
   * can hold several units, so the next lease due (not the farthest) is what the
   * renewal countdown must key on.
   */
  nextRenewalEnd: string | null;
};

type RawLease = {
  id: number | null;
  unitId: number | null;
  unitOccupied: boolean;
  startDate: string | null;
  endDate: string | null;
  annualRent: number;
  status: string | null;
  contractActive: boolean | null;
  pdcConfirmed: boolean;
  terminationResponse: string | null;
  terminationEffectiveDate: string | null;
  outstanding: number;
};

/** Days until (−ve = past) a lease end date, calendar-day to calendar-day (UTC). */
export function renewalDaysOf(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - todayUtc) / 86400000);
}

/** The one live lease per unit — the shared rule, applied to a customer's leases. */
const countingLeases = (leases: RawLease[]): RawLease[] => liveLeaseTips(leases, (l) => l);

/**
 * Collapse the flat /contracts list into one row per customer. Company customers
 * display by company name, individuals by person name. Customers with no counting
 * lease come back with `active: false` (the "Ended leases" filter's pool) rather
 * than being dropped — the directory decides what to show.
 */
export function deriveCustomers(rows: DirectoryContractRow[]): DirectoryCustomer[] {
  const byTenant = new Map<number, { c: DirectoryCustomer; leases: RawLease[] }>();
  for (const c of rows) {
    const tid = c.tenant?.id;
    const isCompany = c.tenant?.entityType === 'company';
    const displayName = isCompany && c.tenant?.companyName ? c.tenant.companyName : c.tenant?.name;
    if (!tid || !displayName) continue;
    const e =
      byTenant.get(tid) ??
      {
        c: {
          id: tid,
          name: displayName,
          email: c.tenant?.email ?? '',
          phone: c.tenant?.phone ?? null,
          company: isCompany,
          active: false,
          leaseCount: 0,
          activeLeaseCount: 0,
          outstanding: 0,
          nextRenewalEnd: null,
        } as DirectoryCustomer,
        leases: [] as RawLease[],
      };
    e.leases.push({
      id: c.id ?? null,
      unitId: c.unit?.id ?? null,
      unitOccupied: c.unit?.availability === 'occupied',
      startDate: c.startDate ?? null,
      endDate: c.endDate ?? null,
      annualRent: c.annualRent ?? 0,
      status: c.status ?? null,
      contractActive: c.contractActive ?? null,
      pdcConfirmed: c.pdcConfirmed === true,
      terminationResponse: c.termination?.response ?? null,
      terminationEffectiveDate: c.termination?.effectiveDate ?? null,
      outstanding: Number(c.outstanding ?? 0),
    });
    byTenant.set(tid, e);
  }

  return Array.from(byTenant.values())
    .map(({ c, leases }) => {
      const counting = countingLeases(leases);
      c.leaseCount = leases.length;
      c.activeLeaseCount = counting.length;
      c.active = counting.length > 0;
      // Outstanding is scoped to the counting leases — "across active units".
      // For a customer with none left, fall back to every lease, so unpaid rent
      // on an ended tenancy doesn't silently read as AED 0 in the Ended view.
      c.outstanding = (c.active ? counting : leases).reduce((s, l) => s + (l.outstanding ?? 0), 0);
      // Next renewal = the SOONEST upcoming end among counting leases (a customer
      // can hold several units), falling back to the most-overdue end when all
      // have lapsed — so a 30-day renewal isn't masked by a 700-day one elsewhere.
      const ends = counting.map((l) => l.endDate).filter((d): d is string => !!d);
      const upcoming = ends.filter((d) => (renewalDaysOf(d) ?? -1) >= 0);
      c.nextRenewalEnd = (upcoming.length ? upcoming : ends).reduce<string | null>(
        (m, d) => (!m || new Date(d) < new Date(m) ? d : m),
        null,
      );
      return c;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
