/**
 * Third-party charge lines on the contract EDIT form — the contract's `other`
 * payment rows, edited as a list.
 *
 * Three of those lines are DERIVED from the net rent rather than typed:
 *
 *   • "20% on sub-lease"      — the head lessor's cut, a % of rent
 *   • "5% VAT on sub-lease"   — VAT compounded on that line (5% OF the 20%)
 *   • "5% VAT on Rent"        — rent VAT recorded as a labelled charge, which is
 *                               how the sub-leased leases carry it (their stored
 *                               rentVatRate is 0, so the form's usual "VAT on
 *                               rent · separate cheque" line never shows)
 *
 * Their LABELS say so (see lib/subleaseCharges + lib/chargeTax), and the backend
 * re-pins them to the rent on save (shared/sublease-charges + rent-vat-basis) —
 * this module is the same rule applied live, so the amounts the RP sees as they
 * type are the amounts that will be stored. A line whose label names no
 * percentage is a flat charge and is never touched.
 */

import { VAT_RATE, isTaxLabel } from './chargeTax';
import { classifySubleaseCharge, recomputeSubleaseCharges } from './subleaseCharges';

export type DerivedChargeKind = 'sublease_net' | 'sublease_vat' | 'rent_vat';

/** A charge that RECORDS rent VAT ("5% VAT on Rent"): tax-labelled at the
 *  standard rate and NOT one of the sub-lease lines (whose VAT is tax on the
 *  levy, a separate supply). Mirrors shared/rent-vat-basis isRentVatChargeRow. */
export function isRentVatChargeLabel(description: string | null | undefined): boolean {
  if (classifySubleaseCharge(description)) return false;
  return isTaxLabel(description);
}

/** Which derived line a label declares, or null for a flat (typed) charge. */
export function derivedChargeKind(description: string | null | undefined): DerivedChargeKind | null {
  const sub = classifySubleaseCharge(description);
  if (sub) return sub.kind === 'net' ? 'sublease_net' : 'sublease_vat';
  return isRentVatChargeLabel(description) ? 'rent_vat' : null;
}

/** Short "why this amount is read-only" hint for a derived line. */
export function derivedChargeHint(description: string | null | undefined): string | null {
  const sub = classifySubleaseCharge(description);
  if (sub) return sub.kind === 'net' ? `${sub.pct}% of the net rent` : `${sub.pct}% of the sub-lease charge`;
  return isRentVatChargeLabel(description) ? `${VAT_RATE}% of the net rent` : null;
}

export interface ThirdPartyLine {
  description: string;
  amount: string;
  /** A recorded (cleared/bounced/cancelled) row — shown, never re-derived or sent. */
  locked?: boolean;
}

/**
 * Re-derive every derived line in `lines` from `netAnnualRent`. Locked lines are
 * left exactly as they are (collected money). Returns the SAME array reference
 * when nothing moved, so a state setter can skip a re-render.
 */
export function recomputeThirdPartyCharges<T extends ThirdPartyLine>(lines: T[], netAnnualRent: number): T[] {
  const rent = Number(netAnnualRent) || 0;
  if (rent <= 0) return lines;
  const open = lines.filter(l => !l.locked);
  if (!open.length) return lines;

  const subleased = recomputeSubleaseCharges(open, rent);
  const rentVat = String(Math.round(rent * VAT_RATE) / 100);
  const next = subleased.map(l => (isRentVatChargeLabel(l.description) && l.amount !== rentVat ? { ...l, amount: rentVat } : l));
  if (next.every((l, i) => l === open[i])) return lines;

  let j = 0;
  return lines.map(l => (l.locked ? l : next[j++]));
}
