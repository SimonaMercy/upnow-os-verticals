export interface DocReq {
  key: string;
  label: string;
  category: string;
  required: boolean;
  hint?: string;
}

export const COMMERCIAL_TYPES = [
  'retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical',
  'coworking_desk','private_office','meeting_room','day_office',
  'event_hall','wedding_venue','conference_hall','private_dining','outdoor_venue',
];
export const INDUSTRIAL_TYPES = ['warehouse','open_yard','storage_unit','cold_storage','logistics_facility'];

/** Shared identity docs — required for every booking type. Emirates ID is
 *  captured as two separate slots (Front + Back) to avoid the "is this one
 *  file or two?" confusion. A legacy combined `emirates_id` upload still
 *  counts (see isDocKeySatisfied) so existing customers aren't forced to
 *  re-upload. */
export const KYC_DOCS: DocReq[] = [
  { key: 'emirates_id_front', label: 'Emirates ID — Front', category: 'identity', required: true, hint: 'Clear photo or scan of the FRONT of your Emirates ID' },
  { key: 'emirates_id_back',  label: 'Emirates ID — Back',  category: 'identity', required: true, hint: 'Clear photo or scan of the BACK of your Emirates ID' },
  { key: 'passport',          label: 'Passport',            category: 'identity', required: true, hint: 'Bio-data page of your valid passport' },
  { key: 'uae_visa',          label: 'UAE Visa / Residency', category: 'identity', required: false, hint: 'UAE residence visa page (optional — provide if available)' },
];

export const KYC_DOC_KEYS = new Set(KYC_DOCS.map(d => d.key));

/**
 * Identity/licensing pack for a COMPANY customer — the company signs the
 * tenancy, so what's collected is the company's licence plus the identity of
 * the person authorised to sign it. Mirrors the backend CUSTOMER_COMPANY
 * matrix (documents/document-requirements.ts) so the customer journey, the RP
 * checklist and the KYC review all ask for the same things.
 *
 * Keys are shared with the individual pack where the document is the same file
 * in the same slot (`emirates_id_front/_back`, `passport`) — only the labels
 * change, so an upload made under either entity type still counts.
 */
export const COMPANY_KYC_DOCS: DocReq[] = [
  { key: 'trade_license',     label: 'Trade License',                          category: 'license',  required: true,  hint: 'Valid UAE trade licence of the company taking the tenancy' },
  { key: 'emirates_id_front', label: 'Signatory Emirates ID — Front',          category: 'identity', required: true,  hint: 'FRONT of the Emirates ID of the person authorised to sign' },
  { key: 'emirates_id_back',  label: 'Signatory Emirates ID — Back',           category: 'identity', required: true,  hint: 'BACK of the same Emirates ID' },
  { key: 'passport',          label: 'Signatory Passport',                     category: 'identity', required: false, hint: 'Bio-data page — required if the signatory is not a UAE national' },
  { key: 'moa',               label: 'MOA / Establishment Card',               category: 'legal',    required: false, hint: 'Memorandum of Association or establishment card (optional)' },
  { key: 'board_resolution',  label: 'Board Resolution / Power of Attorney',   category: 'legal',    required: false, hint: 'Authorises the signatory to sign the tenancy (optional)' },
];

/** Supporting documents for a COMPANY customer — the company equivalents of the
 *  individual's salary certificate / personal bank statement. Never personal
 *  ones: a company has no employment letter or marriage certificate. */
export const COMPANY_SUPPORTING_DOCS: DocReq[] = [
  { key: 'vat_certificate',        label: 'VAT / TRN Certificate',   category: 'compliance', required: false, hint: 'VAT registration certificate, if the company is registered' },
  { key: 'company_bank_statement', label: 'Company Bank Statement',  category: 'banking',    required: false, hint: 'Last 3 months, on the company account' },
];

/** The identity pack for this customer — personal, or the company's. */
export function getKycDocs(entityType?: 'individual' | 'company' | null): DocReq[] {
  return entityType === 'company' ? COMPANY_KYC_DOCS : KYC_DOCS;
}

/** First-wins de-dupe, so a company renting a commercial unit doesn't get the
 *  trade licence (or VAT certificate) asked for twice under two labels. */
function dedupeByKey(docs: DocReq[]): DocReq[] {
  const seen = new Set<string>();
  return docs.filter(d => (seen.has(d.key) ? false : (seen.add(d.key), true)));
}

/**
 * Base document keys whose physical document carries an expiry date the RP
 * should record on upload (identity + licensing docs). Matched on the base key
 * so any suffixed variant resolves — `emirates_id_front`, `occupant_2_passport`,
 * a "Replace" upload's `_<timestamp>` suffix, etc. Mirrors the EXPIRY_DOC_KEYS
 * config on the contract v2 upload modal so both paths agree on what expires.
 */
// NB: the VAT Tax Registration Certificate (FTA TRN) and the business /
// activity licence are deliberately excluded — only identity docs and the
// trade licence prompt for an expiry.
export const EXPIRY_DOC_BASES = [
  'emirates_id', 'passport', 'visa', 'trade_license',
];

/**
 * Sides that are the SAME physical document as another slot, and so must not be
 * asked for a date of their own. A UAE Emirates ID prints one expiry, on the
 * FRONT — asking on both sides asks the same question twice and lets two
 * different answers be recorded for one card. The front is where the date is
 * read from; the backend copies it onto the back row (syncEmiratesIdExpiry), so
 * every surface that reads a per-document expiry still sees a dated back copy.
 */
const EXPIRY_INHERITED_KEYS = ['emirates_id_back'];

/** Whether uploading this document key should prompt the RP for an expiry date. */
export function docNeedsExpiry(documentKey: string | null | undefined): boolean {
  const k = (documentKey ?? '').toLowerCase();
  if (EXPIRY_INHERITED_KEYS.some(part => k.includes(part))) return false;
  return EXPIRY_DOC_BASES.some(base => k.includes(base));
}

/** Emirates ID is satisfied by both sides (front + back), or a legacy combined file. */
export function emiratesIdSatisfied(keys: Set<string>): boolean {
  return (keys.has('emirates_id_front') && keys.has('emirates_id_back')) || keys.has('emirates_id');
}

/** Whether a required doc key is satisfied. The EID side keys also accept a
 *  legacy combined `emirates_id` upload so existing customers stay complete. */
export function isDocKeySatisfied(key: string, keys: Set<string>): boolean {
  if (key === 'emirates_id_front' || key === 'emirates_id_back') return keys.has(key) || keys.has('emirates_id');
  if (key === 'emirates_id') return emiratesIdSatisfied(keys);
  return keys.has(key);
}

/**
 * Residential rental docs. For v1, ALL of these are optional — only
 * the KYC identity trio (Emirates ID, Passport, UAE Visa) gates the
 * Step 2 submit button. Customers can still upload supporting docs
 * at their discretion, and admin can ask for specific ones during
 * review via the RP-requested-docs flow.
 */
export const RESIDENTIAL_RENTAL_DOCS: DocReq[] = [
  { key: 'employment_letter',    label: 'Employment / Salary Certificate', category: 'banking', required: false, hint: 'Letter from your current employer on company letterhead' },
  { key: 'bank_statement',       label: 'Bank Statement / Pay Slip',       category: 'banking', required: false, hint: 'Last 3 months bank statement or most recent pay slip' },
  { key: 'marriage_certificate', label: 'Marriage Certificate',            category: 'legal',   required: false, hint: 'Required if renting as a family' },
  // Rental History / Credit Report / Previous Utility Closing were dropped
  // (Jun 2026) — not worth the checklist noise; admin can still request them
  // ad hoc via the request flow (they remain in REQUESTABLE_DOCS).
];

/**
 * Commercial rental docs. The licensing pack (Trade License, Tax Registration
 * Certificate) is MANDATORY for any commercial lease — Ejari registration of a
 * commercial tenancy needs it, and it applies regardless of whether the tenant
 * is an individual or a company. MOA / MOM is OPTIONAL (collected when available
 * but never a gate). Financial Statements / Rental History / Previous Utility
 * Closing were removed from the checklist (Jun 2026); admin can still request
 * them ad hoc via REQUESTABLE_DOCS.
 */
export const COMMERCIAL_RENTAL_DOCS: DocReq[] = [
  { key: 'trade_license',     label: 'Trade License',                     category: 'license', required: true,  hint: 'Valid UAE trade license' },
  { key: 'tax_registration',  label: 'Tax Registration Certificate',      category: 'license', required: true,  hint: 'UAE VAT / tax registration certificate' },
  { key: 'moa',               label: 'MOA / MOM',                         category: 'legal',   required: false, hint: 'Memorandum of Association or Minutes of Meeting (optional)' },
];

/**
 * Industrial rental docs. The licensing pack (Trade License + Business /
 * Activity License) is MANDATORY for any industrial lease (same rationale as
 * commercial). Financial / history docs stay optional.
 */
export const INDUSTRIAL_RENTAL_DOCS: DocReq[] = [
  { key: 'trade_license',     label: 'Trade License',               category: 'license', required: true,  hint: 'Valid UAE trade license' },
  { key: 'business_license',  label: 'Business / Activity License', category: 'license', required: true,  hint: 'License specific to warehouse / industrial activity' },
];

/**
 * Universal contract-level slots shown on EVERY lease — new AND renewal.
 * These are the two documents every tenancy carries regardless of unit type:
 *   - Contract Registration — the Ejari / DLD tenancy registration certificate
 *     (imported leases name the file "Contract Registration"; it is keyed
 *     `ejari_certificate`).
 *   - Payment Advice — the tenant's rent cheques. The same cheques recorded in
 *     the Payments section; the imported file is named "Payment Advice".
 * The checklist matches these by key + the name/cheque aliases in the v2 page,
 * so the loose imported rows snap into these slots instead of floating under
 * the generic Contract / Financial groups.
 */
export const CONTRACT_DOCS: DocReq[] = [
  { key: 'ejari_certificate', label: 'Contract Registration Certificate', category: 'contract', required: false, hint: 'Contract Registration / DLD tenancy-contract registration certificate' },
  { key: 'payment_advice',    label: 'Payment Confirmation',  category: 'payment',  required: false, hint: 'Rent cheques / payment confirmation — the cheques recorded in the Payments section' },
];

/** Keys that become REQUIRED for a company tenant on a commercial/industrial
 *  lease (the company's legal/licensing pack the Ejari registration needs).
 *  MOA is intentionally excluded — it's collected when available but optional. */
const COMPANY_REQUIRED_KEYS = ['trade_license', 'business_license'];

export function getRentalSectionDocs(
  unitType: string | null | undefined,
  entityType?: 'individual' | 'company' | null,
): DocReq[] {
  const t = unitType ?? '';
  const isCommercial = COMMERCIAL_TYPES.includes(t);
  const isIndustrial = INDUSTRIAL_TYPES.includes(t);
  // A company renting a RESIDENTIAL unit (staff accommodation, a director's
  // apartment) is still a company: asking it for an employment letter or a
  // marriage certificate is nonsense. It gets the company supporting pack.
  if (entityType === 'company' && !isCommercial && !isIndustrial) {
    return COMPANY_SUPPORTING_DOCS;
  }
  const base = isCommercial ? COMMERCIAL_RENTAL_DOCS
    : isIndustrial ? INDUSTRIAL_RENTAL_DOCS
    : RESIDENTIAL_RENTAL_DOCS;

  // A company renting a commercial/industrial space must provide its licensing
  // pack — promote those rows to required (mirrors the backend CUSTOMER_COMPANY
  // requirement). Individuals and residential leases are unchanged.
  if (entityType === 'company' && (isCommercial || isIndustrial)) {
    return base.map(d =>
      COMPANY_REQUIRED_KEYS.includes(d.key) ? { ...d, required: true } : d,
    );
  }
  return base;
}

/** All docs (KYC + rental) combined — used by the spaces page journey tracker. */
export function getRequiredDocs(
  unitType: string | null | undefined,
  entityType?: 'individual' | 'company' | null,
): DocReq[] {
  return dedupeByKey([
    ...getKycDocs(entityType),
    ...getRentalSectionDocs(unitType, entityType),
  ]);
}

/**
 * Identity docs (Emirates ID, Passport, UAE Visa) for occupants 2..n.
 * Occupant 1 (the primary customer) reuses the top-level KYC keys.
 * Returns [] when `occupantCount` ≤ 1.
 *
 * v1 launch: all occupant rows are `required: false` — only the primary
 * customer's KYC trio gates Step 2. Additional occupants are encouraged
 * but not blocking; admin requests them via RP-requested-docs if needed.
 */
export function getOccupantDocs(occupantCount: number): DocReq[] {
  if (!occupantCount || occupantCount <= 1) return [];
  const out: DocReq[] = [];
  for (let i = 2; i <= occupantCount; i++) {
    out.push(
      { key: `occupant_${i}_emirates_id_front`, label: `Occupant ${i} — Emirates ID (Front)`, category: 'identity', required: false, hint: 'Front of the Emirates ID' },
      { key: `occupant_${i}_emirates_id_back`,  label: `Occupant ${i} — Emirates ID (Back)`,  category: 'identity', required: false, hint: 'Back of the Emirates ID' },
      { key: `occupant_${i}_passport`,    label: `Occupant ${i} — Passport`,             category: 'identity', required: false, hint: 'Bio-data page of valid passport' },
      { key: `occupant_${i}_uae_visa`,    label: `Occupant ${i} — UAE Visa / Residency`, category: 'identity', required: false, hint: 'UAE residence visa page (skip for UAE nationals)' },
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
  // Residential default — renewal needs fresh copies of the Emirates ID
  // and the passport; visa carries over.
  return [
    { key: 'emirates_id', label: 'Emirates ID', category: 'identity', required: true, hint: 'Fresh PDF or photos of your current Emirates ID (both sides)' },
    { key: 'passport',    label: 'Passport',     category: 'identity', required: true, hint: 'Bio-data page of your valid passport' },
  ];
}
