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
