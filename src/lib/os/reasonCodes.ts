/**
 * Shared reason-code catalogue for the admin portal's three gates (one decision model).
 *
 * Every negative decision — Ask for changes / Request action, Reject, Expire — is recorded with one or
 * more reason codes plus optional free text. There is no backend reason-code field yet, so the codes
 * travel inside the EXISTING text field each endpoint already takes (complianceNotes / reason), composed
 * as "[CODE] Explanation To fix: … — free text". The provider sees that text exactly as stored.
 *
 * The statement-of-reasons fields (category, specific reason, ground, automated detection / decision,
 * provider-visible text) follow the EU DSA Art. 17 "statement of reasons" shape. UAE law doesn't require
 * it; it makes appeals and regulator enquiries straightforward.
 */

export type GateId = 1 | 2 | 3;
/** The three negative outcomes that carry reasons. */
export type ReasonDecision = 'changes' | 'reject' | 'expire';

export interface ReasonCode {
  /** Stable code, stored in the text — e.g. G1-LIC-EXPIRED. */
  code: string;
  gate: GateId;
  /** Statement-of-reasons category. */
  category: string;
  /** Short admin-facing label for the picker. */
  label: string;
  /** Provider-facing explanation (sent and stored). */
  explanation: string;
  /** Provider-facing "what to fix" (sent and stored). */
  fix: string;
  /** Legal / terms ground the decision rests on. */
  ground: string;
  /** Decisions this code is offered for. */
  decisions: ReasonDecision[];
  /** Catch-all code — free text becomes required. */
  needsText?: boolean;
}

const ALL: ReasonDecision[] = ['changes', 'reject', 'expire'];
const FIXABLE: ReasonDecision[] = ['changes', 'reject'];

const T_AND_C_PROVIDER = 'UpNow Provider Terms — business verification (Gate 1)';
const T_AND_C_AUTH = 'UpNow Provider Terms — vertical authorisation (Gate 2)';
const T_AND_C_LISTING = 'UpNow Listing Policy (Gate 3)';

export const REASON_CODES: ReasonCode[] = [
  // ── Gate 1 · Business verification ─────────────────────────────────────────
  {
    code: 'G1-LIC-EXPIRED', gate: 1, category: 'Trade licence', label: 'Trade licence expired',
    explanation: 'Your trade licence has expired, so we cannot verify the business.',
    fix: 'Upload the renewed trade licence showing the new expiry date.',
    ground: `${T_AND_C_PROVIDER}; licence must be valid (issuing authority rules)`, decisions: ALL,
  },
  {
    code: 'G1-LIC-ILLEGIBLE', gate: 1, category: 'Trade licence', label: 'Trade licence missing or unreadable',
    explanation: 'The trade licence is missing or we cannot read the licence number, authority, activities or expiry.',
    fix: 'Upload a clear, complete copy of every page of the trade licence.',
    ground: T_AND_C_PROVIDER, decisions: FIXABLE,
  },
  {
    code: 'G1-NAME-MISMATCH', gate: 1, category: 'Legal entity', label: 'Name mismatch across documents',
    explanation: 'The business name on your profile does not match the name on the trade licence.',
    fix: 'Correct the business name on your profile, or upload the licence issued in that exact name.',
    ground: T_AND_C_PROVIDER, decisions: FIXABLE,
  },
  {
    code: 'G1-SIG-ID-MISSING', gate: 1, category: 'Authorised signatory', label: 'Signatory ID missing',
    explanation: 'We do not have an Emirates ID or passport for the authorised signatory.',
    fix: 'Upload the front and back of the signatory’s Emirates ID (or passport and visa).',
    ground: T_AND_C_PROVIDER, decisions: FIXABLE,
  },
  {
    code: 'G1-SIG-ID-ILLEGIBLE', gate: 1, category: 'Authorised signatory', label: 'Signatory ID illegible or expired',
    explanation: 'The signatory’s ID is unreadable, cropped or expired.',
    fix: 'Upload a clear, in-date copy with all four corners visible.',
    ground: T_AND_C_PROVIDER, decisions: ALL,
  },
  {
    code: 'G1-SIG-NAME-MISMATCH', gate: 1, category: 'Authorised signatory', label: 'Signatory not named on licence / MOA',
    explanation: 'The person signing is not named as owner, partner or manager on the licence or MOA.',
    fix: 'Upload the MOA or a Power of Attorney that authorises this person to act for the business.',
    ground: T_AND_C_PROVIDER, decisions: FIXABLE,
  },
  {
    code: 'G1-MOA-POA-MISSING', gate: 1, category: 'Authority to act', label: 'MOA / POA missing',
    explanation: 'We need the Memorandum of Association or a Power of Attorney to confirm who can act for the business.',
    fix: 'Upload the MOA, or a notarised Power of Attorney plus the holder’s Emirates ID.',
    ground: T_AND_C_PROVIDER, decisions: FIXABLE,
  },
  {
    code: 'G1-POA-EXPIRED', gate: 1, category: 'Authority to act', label: 'POA expired',
    explanation: 'The Power of Attorney on file has expired.',
    fix: 'Upload a current Power of Attorney.',
    ground: T_AND_C_PROVIDER, decisions: ALL,
  },
  {
    code: 'G1-BANK-NAME-MISMATCH', gate: 1, category: 'Bank account', label: 'Bank account name mismatch',
    explanation: 'The bank account holder name does not match the legal name of the business or owner.',
    fix: 'Upload an IBAN letter or bank statement for an account in the business’s (or owner’s) own name.',
    ground: `${T_AND_C_PROVIDER}; payouts only to accounts in the provider’s name`, decisions: FIXABLE,
  },
  {
    code: 'G1-BANK-MISSING', gate: 1, category: 'Bank account', label: 'Bank details missing',
    explanation: 'There are no bank details or IBAN proof on file, so payouts cannot be set up.',
    fix: 'Add your IBAN and upload an IBAN letter or recent bank statement.',
    ground: T_AND_C_PROVIDER, decisions: FIXABLE,
  },
  {
    code: 'G1-DOC-EXPIRED', gate: 1, category: 'Document validity', label: 'A required document has expired',
    explanation: 'One of your verification documents has passed its expiry date.',
    fix: 'Upload the renewed document; your verification resumes once it is checked.',
    ground: T_AND_C_PROVIDER, decisions: ALL,
  },
  {
    code: 'G1-OTHER', gate: 1, category: 'Other', label: 'Other (explain below)',
    explanation: 'Your verification needs attention.', fix: 'See the reviewer’s note.',
    ground: T_AND_C_PROVIDER, decisions: ALL, needsText: true,
  },

  // ── Gate 2 · Vertical authorisation ───────────────────────────────────────
  {
    code: 'G2-SCOPE-EXCLUDES', gate: 2, category: 'Licence scope', label: 'Licence scope excludes the activity',
    explanation: 'The activities on your licence do not cover the vertical you asked to operate.',
    fix: 'Add the activity to your licence, or upload a licence whose activities include it.',
    ground: `${T_AND_C_AUTH}; activity must be licensed by the competent authority`, decisions: FIXABLE,
  },
  {
    code: 'G2-LIC-EXPIRED', gate: 2, category: 'Licence validity', label: 'Licence expired',
    explanation: 'The licence or permit you rely on for this vertical has expired.',
    fix: 'Upload the renewed licence or permit.',
    ground: T_AND_C_AUTH, decisions: ALL,
  },
  {
    code: 'G2-AUTHORITY-MISMATCH', gate: 2, category: 'Issuing authority', label: 'Authority mismatch',
    explanation: 'This vertical needs a licence from a different authority than the one supplied.',
    fix: 'Upload the licence issued by the authority required for this vertical.',
    ground: T_AND_C_AUTH, decisions: FIXABLE,
  },
  {
    code: 'G2-TECH-CERTS-MISSING', gate: 2, category: 'Technician certification', label: 'Technician certificates missing',
    explanation: 'Certificates for the technicians who will do this work are missing or expired.',
    fix: 'Upload a valid certificate for each technician assigned to this vertical.',
    ground: `${T_AND_C_AUTH}; e.g. Dubai Municipality public-health permits`, decisions: FIXABLE,
  },
  {
    code: 'G2-FREEZONE-MAINLAND', gate: 2, category: 'Licence jurisdiction', label: 'Free-zone licence for mainland in-home service',
    explanation: 'A free-zone licence does not allow in-home services on the mainland.',
    fix: 'Upload a mainland (DED/DET) licence, or a free-zone licence with a mainland operating permit.',
    ground: T_AND_C_AUTH, decisions: FIXABLE,
  },
  {
    code: 'G2-PERMIT-MISSING', gate: 2, category: 'Sector permit', label: 'Sector permit not supplied',
    explanation: 'This vertical needs a sector permit (for example RERA, DTCM, DHA or KHDA) that was not supplied.',
    fix: 'Upload the sector permit for this vertical.',
    ground: T_AND_C_AUTH, decisions: FIXABLE,
  },
  {
    code: 'G2-OTHER', gate: 2, category: 'Other', label: 'Other (explain below)',
    explanation: 'Your authorisation request needs attention.', fix: 'See the reviewer’s note.',
    ground: T_AND_C_AUTH, decisions: ALL, needsText: true,
  },

  // ── Gate 3 · Listing approval ─────────────────────────────────────────────
  {
    code: 'G3-FIELDS-MISSING', gate: 3, category: 'Listing completeness', label: 'Missing required fields',
    explanation: 'Some required listing details are missing (for example rent, size, availability or description).',
    fix: 'Complete every required field and resubmit.',
    ground: T_AND_C_LISTING, decisions: FIXABLE,
  },
  {
    code: 'G3-PHOTO-POLICY', gate: 3, category: 'Photos', label: 'Photos break policy',
    explanation: 'One or more photos break the photo policy (watermarks, logos, people, stock images, low quality or not this property).',
    fix: 'Replace those photos with your own clear photos of this property.',
    ground: T_AND_C_LISTING, decisions: FIXABLE,
  },
  {
    code: 'G3-CONTACT-DETAILS', gate: 3, category: 'Off-platform contact', label: 'Contact details in text or photos',
    explanation: 'The listing contains a phone number, email, link or messenger handle.',
    fix: 'Remove all contact details from the text and photos — customers contact you through UpNow.',
    ground: T_AND_C_LISTING, decisions: FIXABLE,
  },
  {
    code: 'G3-PERMIT-MISSING', gate: 3, category: 'Advertising permit', label: 'Permit missing',
    explanation: 'The listing has no valid advertising permit (Trakheesi / DET) or ownership proof attached.',
    fix: 'Add the permit number and upload the permit or title deed / Form A.',
    ground: `${T_AND_C_LISTING}; Dubai advertising-permit rules`, decisions: ALL,
  },
  {
    code: 'G3-PERMIT-PRICE', gate: 3, category: 'Permit mismatch', label: 'Permit mismatch — price',
    explanation: 'The price in the listing does not match the price on the permit.',
    fix: 'Make the listed price match the permit, or renew the permit at the new price.',
    ground: T_AND_C_LISTING, decisions: FIXABLE,
  },
  {
    code: 'G3-PERMIT-BEDS', gate: 3, category: 'Permit mismatch', label: 'Permit mismatch — bedrooms',
    explanation: 'The bedroom count in the listing does not match the permit.',
    fix: 'Correct the bedrooms to match the permit.',
    ground: T_AND_C_LISTING, decisions: FIXABLE,
  },
  {
    code: 'G3-PERMIT-PURPOSE', gate: 3, category: 'Permit mismatch', label: 'Permit mismatch — purpose',
    explanation: 'The permit is for a different purpose (for example sale instead of rent, or holiday home instead of long-term).',
    fix: 'Upload a permit for this purpose, or change the listing to match the permit.',
    ground: T_AND_C_LISTING, decisions: FIXABLE,
  },
  {
    code: 'G3-PERMIT-LOCATION', gate: 3, category: 'Permit mismatch', label: 'Permit mismatch — location',
    explanation: 'The building, unit or community in the listing does not match the permit.',
    fix: 'Correct the location to match the permit.',
    ground: T_AND_C_LISTING, decisions: FIXABLE,
  },
  {
    code: 'G3-DUPLICATE', gate: 3, category: 'Duplicate', label: 'Duplicate listing',
    explanation: 'This unit is already listed (same unit, building and price).',
    fix: 'Edit the existing listing instead of creating a new one.',
    ground: T_AND_C_LISTING, decisions: ['reject', 'expire'],
  },
  {
    code: 'G3-PRICE-INDEX', gate: 3, category: 'Price', label: 'Price outside index range',
    explanation: 'The rent is well outside the RERA rental-index range for this type of unit.',
    fix: 'Check the rent is correct, or tell us why it is justified (for example finishes or inclusions).',
    ground: `${T_AND_C_LISTING}; RERA rental index`, decisions: FIXABLE,
  },
  {
    code: 'G3-WRONG-CATEGORY', gate: 3, category: 'Category', label: 'Wrong category',
    explanation: 'The listing is in the wrong category or unit type.',
    fix: 'Move it to the correct category / unit type and resubmit.',
    ground: T_AND_C_LISTING, decisions: FIXABLE,
  },
  {
    code: 'G3-NO-LONGER-AVAILABLE', gate: 3, category: 'Availability', label: 'No longer available / let',
    explanation: 'The property is let or no longer available, so the advert must come down.',
    fix: 'Relist it when it is available again.',
    ground: `${T_AND_C_LISTING}; adverts come down once a property is let`, decisions: ['expire'],
  },
  {
    code: 'G3-OTHER', gate: 3, category: 'Other', label: 'Other (explain below)',
    explanation: 'Your listing needs attention.', fix: 'See the reviewer’s note.',
    ground: T_AND_C_LISTING, decisions: ALL, needsText: true,
  },
];

/** Codes offered for a gate + decision. */
export function reasonsFor(gate: GateId, decision: ReasonDecision): ReasonCode[] {
  return REASON_CODES.filter((r) => r.gate === gate && r.decisions.includes(decision));
}

export function reasonByCode(code: string): ReasonCode | undefined {
  return REASON_CODES.find((r) => r.code === code);
}

/**
 * The provider-visible text sent to the existing endpoint:
 *   "[CODE] Explanation To fix: … [CODE2] … — free text"
 */
/**
 * The backend's max length for complianceNotes / reject `reason` is not documented here, so
 * the composed text is capped at REASON_TEXT_MAX. Over the cap, the "To fix" clauses are
 * dropped first, then explanations shortened; the admin's own note is always kept whole.
 */
export const REASON_TEXT_MAX = 1000;

export function composeReasonText(codes: ReasonCode[], freeText: string): string {
  const free = freeText.trim();
  const join = (head: string) => (!head ? free : free ? `${head} — ${free}` : head);
  const full = join(codes.map((r) => `[${r.code}] ${r.explanation} To fix: ${r.fix}`).join(' '));
  if (full.length <= REASON_TEXT_MAX) return full;
  const noFix = join(codes.map((r) => `[${r.code}] ${r.explanation}`).join(' '));
  if (noFix.length <= REASON_TEXT_MAX) return noFix;
  // Last resort: codes + labels only (the explanation lives with the code on the provider side).
  return join(codes.map((r) => `[${r.code}] ${r.label}`).join('; '));
}

/** Validation for a reason-coded decision: at least one code; catch-all codes need free text. */
export function reasonError(codes: ReasonCode[], freeText: string): string | null {
  if (codes.length === 0) return 'Pick at least one reason code — the provider sees the explanation.';
  if (codes.some((r) => r.needsText) && !freeText.trim()) return '“Other” needs a note saying what is wrong.';
  return null;
}

export const DECISION_LABEL: Record<ReasonDecision, string> = {
  changes: 'Request changes',
  reject: 'Reject',
  expire: 'Suspend / expire',
};

/** Statement-of-reasons record (DSA Art. 17 shape) for preview. */
export interface StatementOfReasons {
  decision: string;
  categories: string[];
  reasons: string[];
  grounds: string[];
  automatedDetection: false;
  automatedDecision: false;
  providerText: string;
}

export function statementOf(decisionLabel: string, codes: ReasonCode[], freeText: string): StatementOfReasons {
  const uniq = (a: string[]) => Array.from(new Set(a));
  return {
    decision: decisionLabel,
    categories: uniq(codes.map((r) => r.category)),
    reasons: codes.map((r) => `${r.code} · ${r.label}`),
    grounds: uniq(codes.map((r) => r.ground)),
    automatedDetection: false,
    automatedDecision: false,
    providerText: composeReasonText(codes, freeText),
  };
}

// ── Queue SLA ────────────────────────────────────────────────────────────────

/** Hours since an ISO timestamp (null when missing / invalid). */
export function hoursSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / 3_600_000);
}

/** Queue SLA band: ok < 24h · amber 24–48h · red > 48h. */
export function slaBand(hours: number | null): 'ok' | 'amber' | 'red' | null {
  if (hours == null) return null;
  return hours > 48 ? 'red' : hours >= 24 ? 'amber' : 'ok';
}

/** "6h" · "2d" · "3mo" */
export function waitLabel(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.floor(hours)}h`;
  const d = Math.floor(hours / 24);
  if (d < 60) return `${d}d`;
  if (d < 730) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}
