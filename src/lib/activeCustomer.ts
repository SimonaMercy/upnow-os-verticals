/**
 * Front-end mirror of the canonical "active customer" predicate (backend
 * src/contracts/active-customer.util.ts + ContractsService.listEndedLeaseCustomers).
 *
 * The Customers and Orders pages derive their rows client-side from the flat
 * /contracts list, so the "is this customer/lease still live?" decision must
 * match the backend Ended-Leases definition exactly, otherwise the "active"
 * surfaces and the "Ended Leases" nav would disagree about who is gone.
 *
 * A renewal chain = one unit. Its TIP lease is the non-terminal lease, preferring
 * occupied (contractActive) then latest start then highest id. A chain is LIVE if
 * its tip is occupied (incl. expired-but-still-occupied renewal backlog) or a
 * renewal/new lease in flight (status pending|issued). A customer is ACTIVE if
 * any of their chains is live.
 *
 * NOTE: assumes superseded renewal duplicates were already dropped upstream —
 * the backend listForRp does this before returning the /contracts list.
 */

export type LeaseLike = {
  id?: number | null;
  unitId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  annualRent?: number | null;
  status?: string | null;
  contractActive?: boolean | null;
};

const TERMINAL = new Set(['terminated', 'cancelled']);

/** The tip lease of each renewal chain (per unit) that is still LIVE. */
export function liveLeaseTips<T extends LeaseLike>(leases: T[]): T[] {
  const byUnit = new Map<string, T[]>();
  leases.forEach((l, i) => {
    const key = l.unitId != null ? `u-${l.unitId}` : `x-${l.id ?? i}`;
    const arr = byUnit.get(key);
    if (arr) arr.push(l); else byUnit.set(key, [l]);
  });
  const tips: T[] = [];
  for (const chain of byUnit.values()) {
    let tip: T | null = null;
    for (const c of chain) {
      if (TERMINAL.has((c.status ?? '').toLowerCase())) continue;
      if (!tip) { tip = c; continue; }
      const a = String(c.startDate ?? ''), b = String(tip.startDate ?? '');
      const better = (!!c.contractActive === !!tip.contractActive)
        ? (a > b || (a === b && (c.id ?? 0) > (tip.id ?? 0)))
        : !!c.contractActive;
      if (better) tip = c;
    }
    if (!tip) continue;
    const st = (tip.status ?? '').toLowerCase();
    if (tip.contractActive === true || st === 'pending' || st === 'issued') tips.push(tip);
  }
  return tips;
}

/** Does this customer still have at least one live lease? */
export function customerHasLiveLease(leases: LeaseLike[]): boolean {
  return liveLeaseTips(leases).length > 0;
}

type ContractRowLike = {
  id?: number | null;
  tenant?: { id?: number | null } | null;
  unit?: { id?: number | null } | null;
  startDate?: string | null;
  status?: string | null;
  contractActive?: boolean | null;
};

/** From the flat /contracts list, the set of tenant ids that are still active. */
export function liveTenantIdSet(contracts: ContractRowLike[]): Set<number> {
  const byTenant = new Map<number, LeaseLike[]>();
  for (const c of contracts) {
    const tid = c.tenant?.id;
    if (tid == null) continue;
    const arr = byTenant.get(tid) ?? [];
    arr.push({
      id: c.id ?? null,
      unitId: c.unit?.id ?? null,
      startDate: c.startDate ?? null,
      status: c.status ?? null,
      contractActive: c.contractActive ?? null,
    });
    byTenant.set(tid, arr);
  }
  const out = new Set<number>();
  for (const [tid, leases] of byTenant) if (customerHasLiveLease(leases)) out.add(tid);
  return out;
}
