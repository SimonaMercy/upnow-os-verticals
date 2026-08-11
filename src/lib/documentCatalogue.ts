/**
 * THE document catalogue — one row per document type the platform collects.
 *
 * Before this file, four independent maps decided what a document is called and
 * which slot it lands on:
 *   - REQUESTABLE_DOCS            (the "request from customer" picker)
 *   - BASE_DOC_TYPES              (the RP "upload" picker, contract v2 page)
 *   - KEY_ALIASES                 (the contract v2 checklist matcher)
 *   - REQUESTED_NAME_TO_DOC_KEY   (requested name → slot, + its backend mirror)
 *
 * They drifted, and the drift was visible: "Contract Registration Certificate"
 * was character-for-character the same label in the upload picker and the
 * request picker, yet uploading it landed on the Ejari slot while requesting it
 * floated as a loose row — because the matcher accepted `contract_registration`
 * but not `contract_registration_certificate`. 33 of 40 requestable documents
 * behaved that way.
 *
 * So: ONE list. Both pickers render from it, the checklist matches against it,
 * and the request flow derives its document_key from it. A document has exactly
 * one `key` and exactly one `label`, so the same words on screen always mean the
 * same row in the database.
 *
 * MIRROR OF `upnow-backend/src/documents/requested-doc-keys.ts` — a key or alias
 * added here needs the same entry there, or the customer journey and the
 * external upload link will resolve a request differently from the RP's view.
 */

export interface DocCatalogueEntry {
  /** Canonical document_key. NEVER change one — existing rows are filed under it. */
  key: string;
  /** The single wording shown in BOTH pickers and on the checklist row. */
  label: string;
  category: string;
  /** Whether an upload of this document prompts the RP for an expiry date. */
  needsExpiry?: boolean;
  /** Offer it in the RP's upload picker. Default true. */
  canUpload?: boolean;
  /** Offer it in the "request from customer" picker. Default true. */
  canRequest?: boolean;
  /**
   * Other keys / past wordings that mean THIS document. Fed to the checklist
   * matcher and the legacy-key resolver, so a row filed under an old key or an
   * old label still lands on this slot instead of duplicating it.
   *
   * Store them normalised (lowercase, non-alphanumerics collapsed to `_`) —
   * `normDocName` is what both sides compare with.
   */
  aliases?: string[];
}

/** The shape both pickers and the matcher compare with: lowercase, `_`-joined. */
export function normDocName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * The catalogue. Grouped by category for readability only — nothing reads the
 * grouping, and order here is the order the pickers show.
 *
 * `aliases` carry real history. They are not decoration: every entry below was
 * observed in the database or in a picker that shipped, and dropping one
 * re-orphans documents already on file.
 */
export const DOC_CATALOGUE: DocCatalogueEntry[] = [
  // ── Identity ────────────────────────────────────────────────────────────
  { key: 'emirates_id_front', label: 'Emirates ID — Front', category: 'identity', needsExpiry: true },
  // The card prints ONE expiry, on the front; the backend copies it onto the
  // back row (syncEmiratesIdExpiry). Asking on both sides asks twice.
  { key: 'emirates_id_back', label: 'Emirates ID — Back', category: 'identity' },
  // The legacy combined scan. Still uploadable and requestable — plenty of
  // customers have one file covering both sides — but deliberately NOT an alias
  // of either side: one file covering both sides is not a side, and treating it
  // as one would let a single upload satisfy two slots.
  { key: 'emirates_id', label: 'Emirates ID', category: 'identity', needsExpiry: true },
  { key: 'passport', label: 'Passport', category: 'identity', needsExpiry: true, aliases: ['passport_copy'] },
  {
    key: 'uae_visa', label: 'UAE Visa / Residency', category: 'identity', needsExpiry: true,
    // `visa` is what the old upload picker wrote and what imported customers carry.
    aliases: ['visa', 'residence_visa', 'uae_visa_residency', 'uae_visa_residence_visa'],
  },
  { key: 'visa_entry_stamp', label: 'Visa Entry Stamp', category: 'identity' },
  { key: 'passport_photo', label: 'Passport-size Photo', category: 'identity', aliases: ['passport_size_photo'] },
  { key: 'labour_card', label: 'Labour Card / Work Permit', category: 'identity', aliases: ['labour_card_work_permit', 'work_permit'] },
  { key: 'dependant_documents', label: 'Dependant Documents', category: 'identity' },
  // Identity of the OTHER people on a company tenancy — a partner named on the
  // trade licence, and the authorised signatory's visa (their EID and passport
  // are the plain `emirates_id` / `passport` rows above). Separate keys so they
  // never collapse into the primary customer's identity slots.
  { key: 'partner_emirates_id', label: 'Partner EID', category: 'identity', needsExpiry: true, aliases: ['partner_eid'] },
  { key: 'partner_passport', label: 'Partner Passport', category: 'identity', needsExpiry: true },
  { key: 'partner_visa', label: 'Partner Visa', category: 'identity', needsExpiry: true },
  { key: 'signatory_visa', label: 'Signatory Visa', category: 'identity', needsExpiry: true },

  // ── Licensing / compliance ──────────────────────────────────────────────
  { key: 'trade_license', label: 'Trade License', category: 'license', needsExpiry: true, aliases: ['trade_licence'] },
  { key: 'business_license', label: 'Business / Activity License', category: 'license', aliases: ['business_activity_license'] },
  {
    key: 'tax_registration', label: 'Tax Registration Certificate', category: 'license',
    // One document, three past wordings. `vat_certificate` was simultaneously
    // its own upload slot AND an alias of this one — the pickers offered "VAT
    // Certificate" and "Tax Registration Certificate" as if they were different
    // documents. They are the FTA TRN certificate. Collapsed here.
    aliases: ['tax_registration_certificate', 'vat_tax_registration_trn', 'vat_certificate', 'vat_trn_certificate'],
  },
  { key: 'initial_approval', label: 'Initial Approval', category: 'compliance' },
  { key: 'trade_name_reservation', label: 'Trade Name Reservation', category: 'compliance' },

  // ── Legal ───────────────────────────────────────────────────────────────
  { key: 'marriage_certificate', label: 'Marriage Certificate', category: 'legal' },
  {
    key: 'moa', label: 'Memorandum of Association (MOA)', category: 'legal',
    aliases: ['moa_mom', 'memorandum_of_association', 'memorandum_of_association_moa', 'moa_establishment_card'],
  },
  { key: 'establishment_card', label: 'Establishment Card', category: 'legal' },
  { key: 'board_resolution', label: 'Board Resolution / Power of Attorney', category: 'legal' },
  { key: 'poa', label: 'Power of Attorney (POA)', category: 'legal', aliases: ['power_of_attorney', 'power_of_attorney_poa'] },
  { key: 'signatory_authorization', label: 'Signatory Authorization Letter', category: 'legal', aliases: ['signatory_authorization_letter'] },
  { key: 'noc', label: 'NOC (No Objection Certificate)', category: 'legal', aliases: ['no_objection_certificate', 'noc_no_objection_certificate'] },
  { key: 'noc_landlord', label: 'NOC from Current Landlord', category: 'legal', aliases: ['noc_from_current_landlord'] },
  { key: 'undertaking_letter', label: 'Undertaking Letter', category: 'legal' },
  { key: 'police_clearance', label: 'Police Clearance', category: 'legal' },
  { key: 'guarantor_documents', label: 'Guarantor Documents', category: 'legal' },

  // ── Income / financial ──────────────────────────────────────────────────
  {
    key: 'bank_statement', label: 'Bank Statement / Pay Slip', category: 'banking',
    aliases: ['bank_statement_pay_slip', 'pay_slip', 'financial_statements'],
  },
  { key: 'company_bank_statement', label: 'Company Bank Statement', category: 'banking' },
  {
    key: 'employment_letter', label: 'Employment / Salary Certificate', category: 'banking',
    aliases: ['employment_salary_certificate', 'salary_certificate', 'employment_offer_letter'],
  },
  { key: 'credit_report', label: 'Credit Report', category: 'banking' },
  { key: 'audited_financials', label: 'Audited Financials / Company Profile', category: 'banking', aliases: ['audited_financials_company_profile'] },

  // ── Contract ────────────────────────────────────────────────────────────
  {
    key: 'ejari_certificate', label: 'Contract Registration Certificate', category: 'contract',
    // `contract_registration_certificate` is the headline fix: it is the
    // normalised form of this very label, so requesting the document by the
    // name the picker itself shows used to miss the slot it belongs to.
    aliases: ['ejari', 'contract_registration', 'contract_registration_certificate', 'tenancy_contract_registration', 'ejari_registration'],
  },
  { key: 'signed_tenancy_contract', label: 'Tenancy Contract', category: 'contract', aliases: ['signed_tenancy_contract'] },
  { key: 'agreement', label: 'Agreement', category: 'contract' },

  // ── Property / utilities ────────────────────────────────────────────────
  { key: 'title_deed', label: 'Title Deed', category: 'property' },
  { key: 'rental_history', label: 'Rental History', category: 'property' },
  { key: 'utility_bill', label: 'Utility Bill', category: 'property' },
  { key: 'utility_registration', label: 'Utility Registration', category: 'property', aliases: ['utility_proof_of_payment', 'utility_proof', 'utility_activation'] },
  {
    key: 'utility_clearance', label: 'Utility Clearance', category: 'property',
    // "Utility / Move-out Clearance" was a second request-picker entry for this
    // same document; folded in rather than left to spawn its own row.
    aliases: ['previous_utility_closing', 'utility_move_out_clearance'],
  },
  { key: 'utility_final_bill', label: 'Utility Final Bill', category: 'property' },

  // ── Payment ─────────────────────────────────────────────────────────────
  {
    key: 'payment_advice', label: 'Payment Confirmation', category: 'payment',
    // The rent cheques. `pdc` and `cheque` remain pickable in their own right
    // below AND satisfy this slot — that is the behaviour the checklist already
    // had, kept verbatim so imported cheque rows keep snapping into place.
    aliases: ['pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques'],
  },
  { key: 'pdc', label: 'Cheque Copies (PDC)', category: 'payment', aliases: ['post_dated_cheques'] },
  { key: 'cheque', label: 'Cheque', category: 'payment' },
  { key: 'security_deposit_cheque', label: 'Security Deposit Cheque', category: 'payment' },
  { key: 'receipt', label: 'Receipt', category: 'payment' },
  { key: 'payment_plan', label: 'Payment Plan', category: 'payment' },
  { key: 'sd_refund_form', label: 'SD Refund Form', category: 'payment' },
  { key: 'sd_receiving_voucher', label: 'SD Receiving Voucher', category: 'payment' },
  { key: 'payment_proof_transfer', label: 'Payment Proof of Transfer', category: 'payment' },
  { key: 'cheque_receipt_voucher', label: 'Cheque Receipt Voucher', category: 'payment' },
  { key: 'cheque_deposit_slip', label: 'Cheque Deposit Slip', category: 'payment' },

  // ── Inspection ──────────────────────────────────────────────────────────
  // "Move-in / Move-out Form" used to be a single ambiguous request entry that
  // could not resolve to either report. Aliased onto the move-in report so any
  // request saved under the old wording still lands somewhere real.
  { key: 'move_in_report', label: 'Move-in Inspection Report', category: 'inspection', aliases: ['move_in_move_out_form'] },
  { key: 'move_out_report', label: 'Move-out Inspection Report', category: 'inspection' },

  // ── Other ───────────────────────────────────────────────────────────────
  // Upload-only catch-all. Asking a customer for "Others" says nothing — the
  // request box takes a free-text name for anything genuinely off-catalogue.
  { key: 'other', label: 'Others', category: 'other', canRequest: false },
];

const byKey = new Map(DOC_CATALOGUE.map(e => [e.key, e]));

/** Catalogue entry for a document_key, or undefined when off-catalogue. */
export function docEntry(key: string): DocCatalogueEntry | undefined {
  return byKey.get(key);
}

/** Entries offered in the RP's upload picker, in catalogue order. */
export const UPLOADABLE_DOCS: DocCatalogueEntry[] = DOC_CATALOGUE.filter(e => e.canUpload !== false);

/** Entries offered in the "request from customer" picker, in catalogue order. */
export const REQUESTABLE_ENTRIES: DocCatalogueEntry[] = DOC_CATALOGUE.filter(e => e.canRequest !== false);

/**
 * Every normalised name that means `key` — the key itself, its label, and its
 * aliases. This is what the checklist matcher compares an uploaded row's
 * timestamp-stripped key OR its display name against.
 */
export function acceptedNamesFor(key: string): string[] {
  const e = byKey.get(key);
  if (!e) return [key];
  return Array.from(new Set([key, normDocName(e.label), ...(e.aliases ?? [])]));
}

/**
 * Reverse index: normalised name → canonical key. Built once. Where two entries
 * claim the same alias (a `pdc` upload satisfies both the `pdc` slot and the
 * `payment_advice` slot), the entry whose OWN key or label it is wins — an
 * alias must never outrank a document's own identity.
 */
const nameToKey: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const e of DOC_CATALOGUE) for (const a of e.aliases ?? []) if (!(a in out)) out[a] = e.key;
  // Own key / own label applied last so they overwrite any alias claim.
  for (const e of DOC_CATALOGUE) { out[e.key] = e.key; out[normDocName(e.label)] = e.key; }
  return out;
})();

/**
 * The catalogue key a name refers to, or null when it is genuinely off-catalogue.
 * Accepts a label, a document_key, or any historical wording.
 */
export function docKeyForName(name: string | null | undefined): string | null {
  return nameToKey[normDocName(name)] ?? null;
}
