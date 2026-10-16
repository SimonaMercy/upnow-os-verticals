/**
 * PROTOTYPE ONLY — the provider / listing business rules in one place.
 *
 *  1. A business must be verified, and authorised for the vertical and the
 *     subcategory, before a listing can go to review ("verify before publish").
 *  2. A listing in a vertical that is only *requested* may be drafted and
 *     submitted; it waits as "Waiting for verification" and moves on by itself
 *     once Admin approves (MarketSpace listing-new.js `nextStatus` / `settle`).
 *  3. Licence-gated subcategories (holiday, yacht, venue, safari, gym) wait as
 *     "Awaiting licence" until the licence is on file.
 *  4. Review is always a separate, per-listing Admin decision.
 *
 * In production these rules belong to the backend; here they drive the demo.
 */
import { SUB } from './registry';
import type { Listing, ListingStatus, Org } from './types';

/** Where a submitted listing lands. */
export function listingTarget(org: Org | null | undefined, subKey: string): ListingStatus {
  const s = SUB[subKey];
  if (!org || !s) return 'awaiting_verification';
  const auth = org.verticals.find((a) => a.vertical === s.vertical);
  if (org.status !== 'verified' || auth?.status !== 'approved' || !auth.subcategories.includes(subKey)) return 'awaiting_verification';
  if (!s.licenceGate) return 'in_review';
  const lic = org.verticals.flatMap((v) => v.licences).find((l) => l.name === s.licenceGate);
  return lic && lic.status !== 'missing' ? 'in_review' : 'awaiting_licence';
}

/** Subcategories a business may create listings in: authorised, or requested and awaiting approval. */
export function draftableSubs(org: Org | null | undefined): { key: string; pending: boolean }[] {
  if (!org) return [];
  return org.verticals
    .filter((a) => a.status === 'approved' || a.status === 'submitted' || a.status === 'changes_requested')
    .flatMap((a) => a.subcategories.map((key) => ({ key, pending: a.status !== 'approved' || org.status !== 'verified' })));
}

/** Move waiting listings forward when their blocker has cleared (after an Admin decision or a licence upload). */
export function settleListings(listings: Listing[], orgs: Org[]): Listing[] {
  return listings.map((l) => {
    if (l.status !== 'awaiting_verification' && l.status !== 'awaiting_licence') return l;
    const next = listingTarget(orgs.find((o) => o.id === l.orgId), l.subKey);
    if (next === l.status) return l;
    return {
      ...l,
      status: next,
      reviewNote: next === 'awaiting_licence' ? `Waiting for ${SUB[l.subKey].licenceGate}.` : undefined,
    };
  });
}
