/**
 * Where a contract actually lives, as a URL.
 *
 * A contract is on ONE of two surfaces and the platform keeps them disjoint:
 *
 *   • Operations — still being set up (`locked_at IS NULL`, or sitting in the
 *     Operations worklist). Route: /dashboard/operations/{id}
 *   • Leases     — blessed into the register. Route: /dashboard/contracts/{id}/v2
 *
 * Drill-downs kept hard-coding the lease route, so any row for a record still in
 * setup landed on a lease page for a lease that is not in the register — the
 * click went nowhere near the work. This is the one place that decision is made,
 * so fixing it once fixes it everywhere that imports from here.
 *
 * `surface` comes from the API where the server can see `locked_at` (e.g. the
 * dashboard's `openIn`). Where a payload carries `lockedAt` directly, use
 * `surfaceOfLockedAt`. Never guess from status alone: a `pending` lease can be
 * locked, and an `active` one can still be in the worklist.
 */

export type ContractSurface = 'operations' | 'lease';

/** Manager mode mirrors the RP routes under /dashboard/manager. */
export type PortalScope = { rp: number } | null | undefined;

/** The surface implied by a `locked_at` value, for payloads that carry it. */
export function surfaceOfLockedAt(lockedAt: string | null | undefined): ContractSurface {
  return lockedAt == null ? 'operations' : 'lease';
}

export function contractHref(
  id: number,
  surface: ContractSurface = 'lease',
  manager?: PortalScope,
): string {
  if (surface === 'operations') {
    return manager
      ? `/dashboard/manager/operations/${id}?rp=${manager.rp}`
      : `/rental-provider/dashboard/operations/${id}`;
  }
  return manager
    ? `/dashboard/manager/contracts/${id}/v2?rp=${manager.rp}`
    : `/rental-provider/dashboard/contracts/${id}/v2`;
}
