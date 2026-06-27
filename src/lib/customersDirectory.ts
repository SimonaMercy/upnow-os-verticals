/**
 * Shared derivation for the Customers directory (RP + manager mirror).
 *
 * Both pages render the same Claude-Design "Customers" handoff and read the same
 * flat /contracts list (backend `listForRp`). This collapses that list into one
 * row per customer — active customers only (a live or upcoming lease), matching
 * the Ended-Leases nav's exact inverse — with the aggregates the cards need:
 * lease count, active-lease count, rent arrears (Outstanding), and the next
 * renewal date. Keep the two pages thin: fetch → deriveCustomers → render.
 */
import { liveLeaseTips, type LeaseLike } from './activeCustomer';

/** One row from `/contracts` (backend `listForRp`) — only the fields we read. */
export type DirectoryContractRow = {
  id: number | null;
  status: string | null;
  contractActive: boolean | null;
  annualRent: number | null;
  outstanding?: number | null;
  startDate: string | null;
  endDate: string | null;
  tenant: {
    id: number | null;
    name: string | null;
    email: string | null;
    phone?: string | null;
    entityType?: string | null;
    companyName?: string | null;
  } | null;
  unit: { id: number | null } | null;
};

/** Per-customer display model shared by the Row and Grid cards. */
export type DirectoryCustomer = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: boolean;
  leaseCount: number;
  activeLeaseCount: number;
  /** Rent arrears across the customer's live leases (AED). */
  outstanding: number;
  /**
   * The SOONEST renewal among live leases — the next upcoming end date, or the
   * most-overdue end if every live lease has already lapsed. Drives the renewal
   * countdown. A customer can hold several units, so the next lease due (not the
   * farthest) is what the "Renewals < 90d" KPI / filter / card must key on.
   */
  nextRenewalEnd: string | null;
};

type RawLease = LeaseLike & { outstanding: number };

/** Days until (−ve = past) a lease end date, calendar-day to calendar-day (UTC). */
export function renewalDaysOf(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - todayUtc) / 86400000);
}

/**
 * Collapse the flat /contracts list into one row per customer, dropping anyone
 * whose every lease has ended (they live under Ended Leases). Company customers
 * display by company name, individuals by person name.
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
      startDate: c.startDate ?? null,
      endDate: c.endDate ?? null,
      annualRent: c.annualRent ?? 0,
      status: c.status ?? null,
      contractActive: c.contractActive ?? null,
      outstanding: Number(c.outstanding ?? 0),
    });
    byTenant.set(tid, e);
  }

  return Array.from(byTenant.values())
    .map(({ c, leases }) => {
      // Live leases = the in-force / in-flight tip of each renewal chain.
      const tips = liveLeaseTips(leases);
      c.leaseCount = leases.length;
      c.activeLeaseCount = tips.length;
      // Outstanding is scoped to the live leases — "across active units".
      c.outstanding = tips.reduce((s, l) => s + (l.outstanding ?? 0), 0);
      // Next renewal = the SOONEST upcoming end among live leases (a customer can
      // hold several units), falling back to the most-overdue end when all have
      // lapsed — so a 30-day renewal isn't masked by a 700-day one on another unit.
      const ends = tips.map((l) => l.endDate).filter((d): d is string => !!d);
      const upcoming = ends.filter((d) => (renewalDaysOf(d) ?? -1) >= 0);
      c.nextRenewalEnd = (upcoming.length ? upcoming : ends).reduce<string | null>(
        (m, d) => (!m || new Date(d) < new Date(m) ? d : m),
        null,
      );
      return c;
    })
    // Active customers only — drop those whose every lease has ended.
    .filter((c) => c.activeLeaseCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
