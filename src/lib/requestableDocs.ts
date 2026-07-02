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
  'Ejari Certificate',
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
