/**
 * Move-out reasons — the coded vocabulary behind every ended tenancy.
 *
 * The free-text box on a termination reads fine on one lease and cannot be
 * counted across a portfolio ("moved back to India" / "left uae" / "repatriated"
 * are one fact typed three ways). The code is what the Move-out Reasons report
 * groups by; the free text stays as the detail behind it.
 *
 * MIRROR of `upnow-backend/src/contracts/move-out-reasons.ts` and the CHECK
 * constraint in `migrations/0198_move-out-reasons.sql` — change all three
 * together. The backend re-validates every code, so a drift here surfaces as a
 * 400 ("Select a move-out reason"), never as a silently wrong figure.
 */

export type MoveOutReasonCode =
  | 'relocated_uae'
  | 'left_country'
  | 'bought_property'
  | 'rent_too_high'
  | 'space_needs'
  | 'job_change'
  | 'owner_use'
  | 'unit_sold'
  | 'property_issue'
  | 'non_payment'
  | 'breach'
  | 'other';

export type MoveOutReasonSide = 'customer' | 'landlord' | 'breach';

export interface MoveOutReasonDef {
  code: MoveOutReasonCode;
  label: string;
  side: MoveOutReasonSide;
  /** The free-text note is mandatory — the code on its own says nothing. */
  requiresNote?: boolean;
  /** Never offered to the customer in the portal (they can't self-report it). */
  rpOnly?: boolean;
}

export const MOVE_OUT_REASONS: MoveOutReasonDef[] = [
  { code: 'relocated_uae',   label: 'Relocated within UAE',             side: 'customer' },
  { code: 'left_country',    label: 'Left the country',                 side: 'customer' },
  { code: 'bought_property', label: 'Bought own property',              side: 'customer' },
  { code: 'rent_too_high',   label: 'Rent / renewal increase too high', side: 'customer' },
  { code: 'space_needs',     label: 'Needed a bigger / smaller unit',   side: 'customer' },
  { code: 'job_change',      label: 'Job change or loss',               side: 'customer' },

  { code: 'owner_use',       label: 'Owner needs the unit',             side: 'landlord' },
  { code: 'unit_sold',       label: 'Unit sold',                        side: 'landlord' },
  { code: 'property_issue',  label: 'Unit condition / maintenance',     side: 'landlord' },

  { code: 'non_payment',     label: 'Non-payment of rent',              side: 'breach', rpOnly: true },
  { code: 'breach',          label: 'Other breach of contract',         side: 'breach', rpOnly: true },

  { code: 'other',           label: 'Other',                            side: 'customer', requiresNote: true },
];

export const MOVE_OUT_SIDE_LABELS: Record<MoveOutReasonSide, string> = {
  customer: 'Customer-driven',
  landlord: 'Landlord-driven',
  breach: 'Breach',
};

/** Section headings for the picker — the optgroups a dropdown is grouped by. */
export const MOVE_OUT_SIDE_ORDER: MoveOutReasonSide[] = ['customer', 'landlord', 'breach'];

const BY_CODE = new Map(MOVE_OUT_REASONS.map(r => [r.code, r]));

export function moveOutReason(code: string | null | undefined): MoveOutReasonDef | null {
  return code ? BY_CODE.get(code as MoveOutReasonCode) ?? null : null;
}

/** `null` reads as "Not recorded" so an uncoded lease is never a blank cell. */
export function moveOutReasonLabel(code: string | null | undefined): string {
  return moveOutReason(code)?.label ?? 'Not recorded';
}

export function moveOutReasonSide(code: string | null | undefined): MoveOutReasonSide | null {
  return moveOutReason(code)?.side ?? null;
}

/** Options for a picker; the customer portal hides the RP-only (breach) codes. */
export function moveOutReasonOptions(audience: 'rp' | 'customer'): MoveOutReasonDef[] {
  return audience === 'customer' ? MOVE_OUT_REASONS.filter(r => !r.rpOnly) : MOVE_OUT_REASONS;
}

/**
 * Is this pair submittable? Mirrors the backend guard exactly so the button
 * disables instead of the request 400-ing.
 */
export function moveOutReasonReady(code: string, note: string): boolean {
  const def = moveOutReason(code);
  if (!def) return false;
  return def.requiresNote ? !!note.trim() : true;
}
