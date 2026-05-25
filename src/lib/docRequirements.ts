export interface DocReq {
  key: string;
  label: string;
  category: string;
  required: boolean;
  hint?: string;
}

export const COMMERCIAL_TYPES = ['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical'];
export const INDUSTRIAL_TYPES = ['warehouse','open_yard','storage_unit','cold_storage','logistics_facility'];

/** Shared identity docs — required for every booking type. */
export const KYC_DOCS: DocReq[] = [
  { key: 'emirates_id', label: 'Emirates ID',         category: 'identity', required: true,  hint: 'Both sides of your Emirates ID card (all occupants)' },
  { key: 'passport',    label: 'Passport',             category: 'identity', required: true,  hint: 'Bio-data page of your valid passport (all occupants)' },
  { key: 'uae_visa',    label: 'UAE Visa / Residency', category: 'identity', required: true,  hint: 'UAE residence visa page (not required for UAE nationals)' },
];

export const KYC_DOC_KEYS = new Set(KYC_DOCS.map(d => d.key));

/**
 * Residential rental docs.
 * Required: Employment Letter + Bank Statement / Pay Slip
 * Optional: Marriage Certificate, Rental History, Credit Report, Previous Utility Closing
 */
export const RESIDENTIAL_RENTAL_DOCS: DocReq[] = [
  { key: 'employment_letter',    label: 'Employment / Salary Certificate', category: 'banking', required: true,  hint: 'Letter from your current employer on company letterhead' },
  { key: 'bank_statement',       label: 'Bank Statement / Pay Slip',       category: 'banking', required: true,  hint: 'Last 3 months bank statement or most recent pay slip' },
  { key: 'marriage_certificate', label: 'Marriage Certificate',            category: 'legal',   required: false, hint: 'Required if renting as a family' },
  { key: 'rental_history',       label: 'Rental History',                  category: 'legal',   required: false, hint: 'Previous landlord clearance / rent clearance paper' },
  { key: 'credit_report',        label: 'Credit Report',                   category: 'banking', required: false, hint: 'AECB credit report (if applicable)' },
  { key: 'utility_clearance',    label: 'Previous Utility Closing',        category: 'legal',   required: false, hint: 'Utility clearance from previous premises' },
];

/**
 * Commercial rental docs.
 * Required: Trade License
 * Optional: Tax Registration, MOA/MOM, Financial Statements, Rental History, Previous Utility Closing
 */
export const COMMERCIAL_RENTAL_DOCS: DocReq[] = [
  { key: 'trade_license',     label: 'Trade License',                     category: 'license', required: true,  hint: 'Valid UAE trade license' },
  { key: 'tax_registration',  label: 'Tax Registration Certificate',      category: 'license', required: false, hint: 'UAE VAT / tax registration certificate (if applicable)' },
  { key: 'moa',               label: 'MOA / MOM',                         category: 'legal',   required: false, hint: 'Memorandum of Association or Minutes of Meeting' },
  { key: 'bank_statement',    label: 'Financial Statements',              category: 'banking', required: false, hint: 'Latest 2 years audited financials or bank statements' },
  { key: 'rental_history',    label: 'Rental History',                    category: 'legal',   required: false, hint: 'Previous landlord clearance' },
  { key: 'utility_clearance', label: 'Previous Utility Closing',          category: 'legal',   required: false, hint: 'Utility clearance from previous premises' },
];

/**
 * Industrial rental docs.
 * Required: Trade License + Business / Activity License
 * Optional: Financial Statements, Rental History, Previous Utility Closing
 */
export const INDUSTRIAL_RENTAL_DOCS: DocReq[] = [
  { key: 'trade_license',     label: 'Trade License',               category: 'license', required: true,  hint: 'Valid UAE trade license' },
  { key: 'business_license',  label: 'Business / Activity License', category: 'license', required: true,  hint: 'License specific to warehouse / industrial activity' },
  { key: 'bank_statement',    label: 'Financial Statements',        category: 'banking', required: false, hint: 'Latest audited financials or bank statements' },
  { key: 'rental_history',    label: 'Rental History',              category: 'legal',   required: false, hint: 'Previous landlord clearance' },
  { key: 'utility_clearance', label: 'Previous Utility Closing',    category: 'legal',   required: false, hint: 'Previous Utility clearance' },
];

export function getRentalSectionDocs(unitType: string | null | undefined): DocReq[] {
  const t = unitType ?? '';
  if (COMMERCIAL_TYPES.includes(t)) return COMMERCIAL_RENTAL_DOCS;
  if (INDUSTRIAL_TYPES.includes(t)) return INDUSTRIAL_RENTAL_DOCS;
  return RESIDENTIAL_RENTAL_DOCS;
}

/** All docs (KYC + rental) combined — used by the spaces page journey tracker. */
export function getRequiredDocs(unitType: string | null | undefined): DocReq[] {
  return [...KYC_DOCS, ...getRentalSectionDocs(unitType)];
}

/**
 * Identity docs (Emirates ID, Passport, UAE Visa) for occupants 2..n.
 * Occupant 1 (the primary tenant) reuses the existing `emirates_id`,
 * `passport`, `uae_visa` keys. Returns [] when `occupantCount` ≤ 1.
 */
export function getOccupantDocs(occupantCount: number): DocReq[] {
  if (!occupantCount || occupantCount <= 1) return [];
  const out: DocReq[] = [];
  for (let i = 2; i <= occupantCount; i++) {
    out.push(
      { key: `occupant_${i}_emirates_id`, label: `Occupant ${i} — Emirates ID`,         category: 'identity', required: true, hint: 'Both sides of Emirates ID card' },
      { key: `occupant_${i}_passport`,    label: `Occupant ${i} — Passport`,             category: 'identity', required: true, hint: 'Bio-data page of valid passport' },
      { key: `occupant_${i}_uae_visa`,    label: `Occupant ${i} — UAE Visa / Residency`, category: 'identity', required: true, hint: 'UAE residence visa page (skip for UAE nationals)' },
    );
  }
  return out;
}

/**
 * Derive minimum occupant count from existing doc keys. If the tenant
 * uploaded `occupant_3_emirates_id` previously, the stepper should
 * default back to 3 on reload. Returns 1 if no occupant-prefixed docs.
 */
export function deriveOccupantCount(docKeys: Iterable<string>): number {
  let max = 1;
  for (const k of docKeys) {
    const m = k.match(/^occupant_(\d+)_/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

/**
 * Trimmed doc list for contract RENEWAL — required docs only, no optional fields.
 *
 * The original lease already collected the full KYC + financial / commercial
 * pack. At renewal we only re-verify identity (residential) or commercial
 * licensing (commercial / industrial). Bank statements, employment letters,
 * MOAs, visa copies, tax certs etc. are NOT re-collected.
 *
 * - Residential: Emirates ID + Passport
 * - Commercial:  Trade License
 * - Industrial:  Trade License + Business License
 */
export function getRenewalRequiredDocs(unitType: string | null | undefined): DocReq[] {
  const t = unitType ?? '';
  if (COMMERCIAL_TYPES.includes(t)) {
    return [
      { key: 'trade_license', label: 'Trade License', category: 'license', required: true, hint: 'Current valid UAE trade license' },
    ];
  }
  if (INDUSTRIAL_TYPES.includes(t)) {
    return [
      { key: 'trade_license',    label: 'Trade License',               category: 'license', required: true, hint: 'Current valid UAE trade license' },
      { key: 'business_license', label: 'Business / Activity License', category: 'license', required: true, hint: 'License specific to warehouse / industrial activity' },
    ];
  }
  // Residential default
  return [
    { key: 'emirates_id', label: 'Emirates ID', category: 'identity', required: true, hint: 'Both sides of your current Emirates ID' },
    { key: 'passport',    label: 'Passport',     category: 'identity', required: true, hint: 'Bio-data page of your valid passport' },
  ];
}
