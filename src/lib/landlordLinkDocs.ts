/**
 * What the lease's presentation binder — the RP contract documents page AND the
 * landlord's no-login link, kept consistent — shows of the documents on file.
 * The manager's explicit choice (`documents.portal_hidden`, migration 0338,
 * configured from the customer profile's document readers) always wins; with no
 * choice recorded (null) the DEFAULT rule applies: the binder's named slots
 * (cheque copies, Contract Registration, utility paperwork, the generated
 * move-out / settlement artifacts) and everything not owned by the lease (the
 * customer's KYC pack, deposit rows) show; a loose paper filed onto the lease
 * for internal reference — an undertaking, an NOC, a letter — stays off until
 * the manager turns it on (owner's call, 28 Sep 2026).
 *
 * ⚠️ PORT of upnow-backend/src/shared/landlord-link-docs.ts — change one,
 * change the other. The base-key spellings mirror the binder's KEY_ALIASES.
 */

const DEFAULT_SHOWN_BASE_KEYS = new Set([
  'payment_advice', 'pdc', 'post_dated_cheques', 'cheque_copies_pdc',
  'cheque_copies', 'cheques', 'cheque', 'rent_cheques',
  'ejari_certificate', 'ejari', 'contract_registration',
  'tenancy_contract_registration', 'ejari_registration',
  'utility_registration', 'utility_proof_of_payment', 'utility_proof',
  'utility_activation', 'utility_final_bill', 'final_bill',
  'move_out_report', 'deposit_settlement',
]);

type VisibilityDoc = { ownerType?: string | null; documentKey: string | null; portalHidden?: boolean | null };

/** Upload timestamps ride the key (`undertaking_letter_1790585876032`) — the
 *  document's identity is the base in front of them. */
export const landlordLinkBaseKey = (key: string | null | undefined): string =>
  (key ?? '').toLowerCase().replace(/_\d{10,}$/, '');

export function landlordLinkShowsByDefault(d: VisibilityDoc): boolean {
  if (d.ownerType !== 'tenancy_contract') return true;
  return DEFAULT_SHOWN_BASE_KEYS.has(landlordLinkBaseKey(d.documentKey));
}

/** The effective visibility: the recorded choice, else the default rule. */
export function landlordLinkShows(d: VisibilityDoc): boolean {
  return d.portalHidden == null ? landlordLinkShowsByDefault(d) : !d.portalHidden;
}
