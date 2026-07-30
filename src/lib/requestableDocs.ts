/**
 * Standard documents an RP can request from a lead or tenant. Used by the
 * leads page and the contract page's "request document" flows so the picker
 * offers a consistent, searchable list (avoids typo'd / mis-mapped document
 * names). The RP can still type a one-off custom name when something genuinely
 * isn't listed.
 */
export const REQUESTABLE_DOCS = [
  // Identity / KYC
  'Emirates ID',
  'Passport',
  'UAE Visa / Residence Visa',
  'Visa Entry Stamp',
  'Passport-size Photo',
  'Labour Card / Work Permit',
  'Dependant Documents',
  'Marriage Certificate',
  // Income / financial
  'Bank Statement',
  'Salary Certificate',
  'Employment / Offer Letter',
  'Pay Slip',
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
  'VAT / Tax Registration (TRN)',
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
 * collect as a standard slot (e.g. "UAE Visa / Residence Visa" ⇢ the KYC
 * `uae_visa` slot, "Salary Certificate" ⇢ the `employment_letter` slot). When an
 * RP requests one of these we do NOT spawn a duplicate upload slot — we promote
 * the existing slot to required. Keyed by the requestable NAME (lowercased);
 * value is the canonical document_key the rest of the app already uses.
 */
export const REQUESTED_NAME_TO_DOC_KEY: Record<string, string> = {
  'emirates id': 'emirates_id',
  'passport': 'passport',
  'uae visa / residence visa': 'uae_visa',
  'marriage certificate': 'marriage_certificate',
  'bank statement': 'bank_statement',
  'pay slip': 'bank_statement',
  'salary certificate': 'employment_letter',
  'employment / offer letter': 'employment_letter',
  'trade license': 'trade_license',
  'vat / tax registration (trn)': 'tax_registration',
  'memorandum of association (moa)': 'moa',
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
