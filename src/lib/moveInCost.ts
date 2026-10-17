/**
 * "Cost to move in" — a FRONTEND ESTIMATE for the public listing page
 * (MarketSpace components/marketplace/detail/spaces.js › moveIn()).
 *
 * Everything is computed in fils (integer). Where the listing API exposes the
 * landlord's own figure (security deposit, commission, admin fee, Ejari fee —
 * all whole AED on the unit row) that figure wins; where it doesn't, the
 * MarketSpace typical-Dubai default is used and the row says so. It is never
 * a quote: the real numbers come from the payment plan the landlord issues.
 *
 * Defaults (MarketSpace): security deposit 5% of annual rent (unfurnished
 * residential) / 10% (furnished residential, commercial, industrial, land);
 * agency fee 5% residential / 10% commercial & industrial, plus 5% VAT;
 * Ejari AED 220; DEWA deposit AED 2,000 apartment / 4,000 villa, commercial
 * or industrial. Commercial / industrial rent also carries 5% VAT on the
 * first cheque.
 */
import type { SpaceSubcategory } from './spaceJourney';

export interface MoveInInput {
  subcategory: SpaceSubcategory;
  /** Annual rent, whole AED (as the listing API returns it). */
  annualRentAed: number;
  /** Rent cheques the customer picks (1 / 2 / 4 / 6 / 12). */
  cheques: number;
  furnished?: boolean;
  /** Villa / townhouse → the higher DEWA deposit. */
  villa?: boolean;
  /** 5% VAT applies to the rent (commercial / industrial). */
  rentVatable?: boolean;
  /** Landlord figures from the listing, whole AED; null/undefined = not exposed. */
  securityDepositAed?: number | null;
  commissionAed?: number | null;
  adminFeeAed?: number | null;
  ejariFeeAed?: number | null;
  registrationLabel?: string;
  utilityLabel?: string;
}

export interface MoveInRow {
  key: string;
  label: string;
  note: string;
  fils: number;
  /** true when the figure is the landlord's own; false = typical default. */
  fromListing: boolean;
  refundable?: boolean;
}

export interface MoveInEstimate {
  rows: MoveInRow[];
  totalFils: number;
  firstChequeFils: number;
}

const VAT = 0.05;
const toFils = (aed: number) => Math.round(aed * 100);
const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export const MS_DEFAULTS = {
  ejariAed: 220,
  dewaApartmentAed: 2000,
  dewaLargeAed: 4000,
  agencyResidential: 0.05,
  agencyCommercial: 0.10,
  depositUnfurnished: 0.05,
  depositFurnished: 0.10,
  depositCommercial: 0.10,
} as const;

export function estimateMoveInCost(i: MoveInInput): MoveInEstimate {
  const rentFils = toFils(Math.max(0, i.annualRentAed));
  const n = Math.max(1, Math.round(i.cheques) || 1);
  const res = i.subcategory === 'residential';
  const regLabel = i.registrationLabel ?? 'Ejari';
  const utilLabel = i.utilityLabel ?? 'DEWA';
  const rows: MoveInRow[] = [];

  const firstChequeFils = Math.round(rentFils / n);
  rows.push({ key: 'rent', label: 'First rent cheque', note: `1 of ${n} cheque${n === 1 ? '' : 's'}`, fils: firstChequeFils, fromListing: true });
  if (i.rentVatable) {
    rows.push({ key: 'rent_vat', label: 'VAT on first rent cheque', note: '5% — commercial rent is VATable', fils: Math.round(firstChequeFils * VAT), fromListing: true });
  }

  // Security deposit
  if (pos(i.securityDepositAed)) {
    rows.push({ key: 'deposit', label: 'Security deposit', note: 'Refundable · set by the landlord', fils: toFils(i.securityDepositAed), fromListing: true, refundable: true });
  } else {
    const pct = res ? (i.furnished ? MS_DEFAULTS.depositFurnished : MS_DEFAULTS.depositUnfurnished) : MS_DEFAULTS.depositCommercial;
    rows.push({ key: 'deposit', label: 'Security deposit', note: `Refundable · typical ${Math.round(pct * 100)}% of annual rent`, fils: Math.round(rentFils * pct), fromListing: false, refundable: true });
  }

  // Agency fee (commission) + VAT
  let agencyFils: number;
  let agencyFromListing: boolean;
  if (pos(i.commissionAed)) {
    agencyFils = toFils(i.commissionAed);
    agencyFromListing = true;
    rows.push({ key: 'agency', label: 'Agency fee', note: 'Set by the landlord', fils: agencyFils, fromListing: true });
  } else {
    const pct = res || i.subcategory === 'land' ? MS_DEFAULTS.agencyResidential : MS_DEFAULTS.agencyCommercial;
    agencyFils = Math.round(rentFils * pct);
    agencyFromListing = false;
    rows.push({ key: 'agency', label: 'Agency fee', note: `Typical ${Math.round(pct * 100)}% of annual rent`, fils: agencyFils, fromListing: false });
  }

  // Admin fee — only when the landlord publishes one (MarketSpace has no default).
  const adminFils = pos(i.adminFeeAed) ? toFils(i.adminFeeAed) : 0;
  if (adminFils) rows.push({ key: 'admin', label: 'Admin fee', note: 'Set by the landlord', fils: adminFils, fromListing: true });

  const vatBase = agencyFils + adminFils;
  if (vatBase > 0) {
    rows.push({ key: 'fee_vat', label: adminFils ? 'VAT on agency & admin fees' : 'VAT on agency fee', note: '5%', fils: Math.round(vatBase * VAT), fromListing: agencyFromListing });
  }

  // Registration
  if (pos(i.ejariFeeAed)) {
    rows.push({ key: 'ejari', label: `${regLabel} fee`, note: 'Tenancy registration · set by the landlord', fils: toFils(i.ejariFeeAed), fromListing: true });
  } else {
    rows.push({ key: 'ejari', label: `${regLabel} fee`, note: 'Tenancy registration · typical', fils: toFils(MS_DEFAULTS.ejariAed), fromListing: false });
  }

  // Utility deposit — not for a bare plot (connection is quoted per plot).
  if (i.subcategory !== 'land') {
    const large = !res || !!i.villa;
    const aed = large ? MS_DEFAULTS.dewaLargeAed : MS_DEFAULTS.dewaApartmentAed;
    const what = res ? (i.villa ? 'a villa' : 'an apartment') : i.subcategory === 'industrial' ? 'an industrial unit' : 'a commercial unit';
    rows.push({ key: 'dewa', label: `${utilLabel} deposit`, note: `Refundable · typical for ${what}`, fils: toFils(aed), fromListing: false, refundable: true });
  }

  const totalFils = rows.reduce((s, r) => s + r.fils, 0);
  return { rows, totalFils, firstChequeFils };
}

export function fmtAedFromFils(fils: number): string {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(fils / 100);
}
