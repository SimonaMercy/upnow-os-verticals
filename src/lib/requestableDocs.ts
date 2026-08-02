/**
 * Standard documents an RP can request from a lead or tenant. Used by the
 * leads page and the contract page's "request document" flows so the picker
 * offers a consistent, searchable list (avoids typo'd / mis-mapped document
 * names). The RP can still type a one-off custom name when something genuinely
 * isn't listed.
 */
export const REQUESTABLE_DOCS = [
  // Identity / KYC. Anything that maps onto a checklist slot below carries the
  // SLOT'S OWN label, so the request and the row it lands on read as the same
  // document — a second wording would look like a second document.
  'Emirates ID',
  'Passport',
  'UAE Visa / Residency',
  'Visa Entry Stamp',
  'Passport-size Photo',
  'Labour Card / Work Permit',
  'Dependant Documents',
  'Marriage Certificate',
  // Income / financial
  'Bank Statement / Pay Slip',
  'Employment / Salary Certificate',
  'Credit Report',
  // Rental
  'Contract Registration Certificate',
  'Tenancy Contract',
  'Title Deed',
  'Cheque Copies (PDC)',
  'Security Deposit Cheque',
  'Receipt',
  'NOC from Current Landlord',
  'Rental History',
  'Utility Bill',
  'Utility Registration',
  'Utility Clearance',
  'Utility Final Bill',
  'Utility / Move-out Clearance',
  'Move-in / Move-out Form',
  // Company / commercial
  'Trade License',
  'Memorandum of Association (MOA)',
  'Establishment Card',
  'Tax Registration Certificate',
  'VAT Certificate',
  'Power of Attorney (POA)',
  'Signatory Authorization Letter',
  // Identity of the OTHER people on a company tenancy: a partner named on the
  // trade licence, and the authorised signatory's visa (their EID and passport
  // are the plain 'Emirates ID' / 'Passport' rows above).
  'Partner EID',
  'Partner Passport',
  'Partner Visa',
  'Signatory Visa',
  'Audited Financials / Company Profile',
  // Other
  'NOC (No Objection Certificate)',
  'Police Clearance',
  'Guarantor Documents',
];

/**
 * RP-requested additional documents are stored as a JSON array of free-text
 * names on `lead.additionalDocsNote`. Both the customer journey (upload slots)
 * and the RP leads page (status/approve) derive a STABLE, deterministic
 * document_key from each name so an uploaded file links back to the request.
 * e.g. "Bank Statement" → "additional_bank_statement".
 */
export function additionalDocKey(name: string): string {
  return 'additional_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Some requestable names are just another wording of a document we ALREADY
 * collect as a standard slot (e.g. "UAE Visa / Residency" ⇢ the KYC `uae_visa`
 * slot, "Bank Statement / Pay Slip" ⇢ the `bank_statement` slot). When an
 * RP requests one of these we do NOT spawn a duplicate upload slot — we promote
 * the existing slot to required. Keyed by the requestable NAME (lowercased);
 * value is the canonical document_key the rest of the app already uses.
 */
export const REQUESTED_NAME_TO_DOC_KEY: Record<string, string> = {
  'emirates id': 'emirates_id',
  'passport': 'passport',
  'uae visa / residency': 'uae_visa',
  'marriage certificate': 'marriage_certificate',
  'bank statement / pay slip': 'bank_statement',
  'employment / salary certificate': 'employment_letter',
  'trade license': 'trade_license',
  'tax registration certificate': 'tax_registration',
  'memorandum of association (moa)': 'moa',
  // Wordings the picker used to offer. Kept so requests already saved against a
  // lead still resolve to their slot instead of turning into an orphan row.
  'uae visa / residence visa': 'uae_visa',
  'bank statement': 'bank_statement',
  'pay slip': 'bank_statement',
  'salary certificate': 'employment_letter',
  'employment / offer letter': 'employment_letter',
  'vat / tax registration (trn)': 'tax_registration',
  // Same keys the contract upload picker writes, so a doc the RP uploads on the
  // contract page fulfils the request instead of leaving an empty slot beside it.
  'partner eid': 'partner_emirates_id',
  'partner passport': 'partner_passport',
  'partner visa': 'partner_visa',
  'signatory visa': 'signatory_visa',
};

/**
 * Resolve a requested doc name to a standard document_key we already collect, or
 * null when it's a genuinely new (additional) document. Used on BOTH sides so a
 * request for a doc we already have promotes the existing slot instead of
 * creating a duplicate, and the RP's fulfilment check tracks the same upload.
 */
export function resolveRequestedDocKey(name: string): string | null {
  return REQUESTED_NAME_TO_DOC_KEY[name.trim().toLowerCase()] ?? null;
}

/** The document_key a requested name is tracked under, standard slot or not. */
export function requestedDocKey(name: string): string {
  return resolveRequestedDocKey(name) ?? additionalDocKey(name);
}

/**
 * Is this document already on the request list? Compared by KEY, not by wording
 * — "UAE Visa / Residence Visa" and "UAE Visa / Residency" are one document, and
 * listing both would show the RP the same request twice.
 */
export function alreadyRequested(items: string[], name: string): boolean {
  const k = requestedDocKey(name);
  return items.some(i => requestedDocKey(i) === k);
}

/** The request list with same-document entries collapsed to the first wording. */
export function dedupeRequests(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter(i => {
    const k = requestedDocKey(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Parse the requested-additional-docs list stored on `additionalDocsNote`. */
export function parseAdditionalDocs(note: string | null | undefined): string[] {
  if (!note) return [];
  try {
    const parsed = JSON.parse(note);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Legacy keys the SAME document has historically been filed under, keyed by the
 * slot we use today. Imported customers carry `visa`, for example, while every
 * current surface asks for `uae_visa`.
 *
 * This matters wherever we ask "does this customer already have this document?".
 * Matching on the canonical key alone answers "no" for a document plainly on
 * file, which then either creates a second row for one document or tells the
 * customer to send something they already sent. Both were live bugs on the
 * renewal paperwork step and the external upload link.
 *
 * Deliberately NOT listed: the combined `emirates_id` scan as an alias of
 * `emirates_id_front` / `emirates_id_back`. One file covering both sides is not
 * a side — treating it as one lets a single upload satisfy both slots.
 *
 * MIRROR OF `upnow-backend/src/documents/requested-doc-keys.ts`.
 */
export const LEGACY_DOC_KEY_ALIASES: Record<string, string[]> = {
  uae_visa: ['visa', 'residence_visa', 'uae_visa_residency', 'uae_visa_residence_visa'],
  passport: ['passport_copy'],
  trade_license: ['trade_licence'],
  tax_registration: ['vat_certificate', 'tax_registration_certificate'],
  employment_letter: ['salary_certificate'],
};

/** Every key that can hold the document belonging in `slotKey` — itself first. */
export function docKeysForSlot(slotKey: string): string[] {
  return [slotKey, ...(LEGACY_DOC_KEY_ALIASES[slotKey] ?? [])];
}
