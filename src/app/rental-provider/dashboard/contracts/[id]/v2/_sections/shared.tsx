'use client';
/* Split verbatim out of ../page.tsx (lease detail v2) — behaviour unchanged. */
import { contractRailLabels, spaceSubcategory, type ContractRailKey } from '@/lib/spaceJourney';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { UPLOADABLE_DOCS, sectionOf, type DocSection } from '@/lib/documentCatalogue';
import { Building2, CreditCard, Paperclip, ClipboardList, StickyNote, Scale, Mail, MessageCircle } from 'lucide-react';
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';
import type { DocReading, ChequeIntake } from '@/lib/planAttach';
import { deriveSpaceCategoryFromUnitType } from '@/lib/unitTaxonomy';
import type { FeeRuleLite } from '@/lib/feeRules';


// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface ContractDoc {
  id: number;
  ownerType: string;
  ownerId: number;
  category: string;
  /** Where the RP filed it (documents.section) — kyc | tenancy | null. */
  section?: string | null;
  documentKey: string;
  displayName: string | null;
  fileUrl: string;
  status: string;
  issueDate: string | null;
  expiryDate: string | null;
  isVisibleToTenant: boolean;
  /** Recorded binder/landlord-link choice; null = the default rule decides. */
  portalHidden?: boolean | null;
  /** What the reader found on this file (cheque papers on a renewal); null = not read. */
  reading?: DocReading | null;
}

/** Identity of a stored documents row (its upsert key): an upload posted under
 *  the SAME owner + key overwrites that row in place instead of adding one. */
export type DocReplaceTarget = Pick<ContractDoc, 'ownerType' | 'ownerId' | 'documentKey'>;

export interface ContractPayment {
  id: number;
  description: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  amount: number;            // gross (incl. rent VAT) — matches API field name
  vatAmount?: number;        // rent VAT portion of amount (0 = exempt)
  transactionDate: string | null;
  chequeStatus?: string | null;
  paidAt?: string | null;
  chequeNumber?: string | null;
  /** The bank the cheque is drawn on, as read off the cheque (0381). */
  bankName?: string | null;
  /** Cheque image / payment advice this instalment was recorded against
   *  (`payments.document_id`). Null = a typed reference with no scan on file. */
  documentId?: number | null;
  /** The BOUNCED cheque this row replaces (`payments.replaces_payment_id`). The
   *  link is what takes the bounce off the dashboards — until it exists, the
   *  landlord keeps being chased for rent the customer has already made good. */
  replacesPaymentId?: number | null;
  /** WHY a cancelled cheque was cancelled (`payments.cancellation_reason`):
   *  'replaced' — the customer swapped it and the money is on a linked row;
   *  'returned_to_customer' / 'lease_cancelled' — genuine voids, nothing came in
   *  its place and nothing may be linked to it. */
  cancellationReason?: string | null;
  /** Where the paper is (0323 / 0324): with_us · with_head_office · banked ·
   *  to_return · returned; null for a transfer / card / online payment. */
  custody?: 'with_us' | 'with_head_office' | 'not_recorded' | 'banked' | 'returned' | null;
  /** A bounced / cancelled cheque still to go back to the customer, wherever it is. */
  toReturn?: boolean;
  handedOverAt?: string | null;
  handedOverBy?: string | null;
  returnedToCustomerAt?: string | null;
  returnedToCustomerBy?: string | null;
  returnedToCustomerReason?: string | null;
  returnedToCustomerNote?: string | null;
  /** The reference image filed when it went back (0328). */
  returnedToCustomerDocumentId?: number | null;
  /** What this row should READ as. Same as chequeStatus except on a bounce that
   *  has since been covered ('cleared' once the replacement money is banked,
   *  'replaced' while that cheque is still pending) and on a cheque the customer
   *  swapped, which reads 'replaced' and never 'cleared'. Server-derived so
   *  every surface agrees; `chequeStatus` remains the stored truth. */
  effectiveStatus?: string | null;
}

export interface MoveInInsp {
  rpSubmittedAt?: string | null;
  tenantSig?: string | null;
  rpCounterSig?: string | null;
  rpCounterSignedAt?: string | null;
}

export interface ContractDetail {
  id: number;
  ref: string;
  contractType: 'new' | 'renewal';
  status: 'pending' | 'issued' | 'active' | 'expired' | 'terminated';
  ejariStatus: string | null;
  contractActive: boolean;
  contractSent: boolean;
  pdcConfirmed: boolean;
  pdcConfirmedAt: string | null;
  tenantChequesSubmittedAt: string | null;
  /** Renewal KYC re-verification: docs the customer must re-upload (expired/undated). */
  expiredKycDocKeys?: string[];
  /** Subset of the above flagged ONLY because no expiry was ever captured. The copy on
   *  file may well be current — a re-upload can't tell us, but the RP reading the date
   *  off it can. These are the RP's to clear, not the customer's. */
  kycExpiryMissingKeys?: string[];
  /** Durable "KYC re-verification was required" flag (snapshotted at accept-time). */
  renewalDocsRequiredAt?: string | null;
  /** Customer pressed "Submit for review" — their side of the step is finished. */
  renewalDocsSubmittedAt?: string | null;
  /** RP has reviewed + accepted the re-uploaded KYC docs → cheques unlock. */
  renewalDocsAcceptedAt?: string | null;
  utilityStatus?: string | null;
  utilityAccountNumber?: string | null;
  startDate: string;
  endDate: string;
  durationYears: number | null;
  annualRent: number;
  rentVatRate?: number;
  contractValue: number | null;
  listedRent?: number | null;
  discountType?: 'percent' | 'fixed' | null;
  discountAmount?: number | null;
  securityDepositAmount: number | null;
  /** Effective held deposit (contract field → deposit rows → payment → tenancy-carried). */
  securityDepositHeld?: number | null;
  /** Unified deposit record for the payments table; isCarried = read-only on renewals. */
  securityDeposit?: {
    depositId: number | null;
    amount: number; chequeNumber: string | null; recordedDate: string | null;
    dueDate: string | null; paymentMethod: string | null; chequeStatus: string | null;
    status: string | null; isCarried: boolean; sourceContractId: number | null;
    settledRefundAmount: number | null; settledDeductionAmount: number | null;
    settledOn: string | null; settledViaSettlementId: number | null;
  } | null;
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  /** Installment plans the owning RP offers (empty = all). Used by the renewal
   *  modal so a manager (no own RP profile) still sees the RP's filtered list. */
  allowedInstallments?: number[];
  /** Owning RP's configured cheque days — lets the renewal preview snap due dates
   *  to the same days the backend stamps (works for managers too). */
  preferredChequeDays?: number[];
  /** Owning RP's rent-VAT collection mode (Settings → Rules): 'annual' = one Rental
   *  VAT cheque for the year, 'installment' = one beside each rent cheque. */
  rentVatMode?: 'annual' | 'installment';
  /** Owning RP's fee rules (Settings → Fee Rules) resolved for THIS unit's space
   *  category. Drives the Propose Renewal fee prefill — a rule switched off means
   *  an explicit 0. `configured: false` = untouched platform defaults (no opinion). */
  feeRules?: { spaceCategory: string; configured: boolean; rules: FeeRuleLite[] } | null;
  adminFeeFils: number;
  ejariFeeFils: number;
  customClauses: string[];
  notes: string | null;
  createdAt: string;
  /** ⚠️ On a renewal CHILD these two are MIRRORED from the parent — they say
   *  what happened to the renewal that CREATED this lease, so one that is
   *  simply live reads 'accepted'. Correct for the decision/rejection banners,
   *  WRONG for "may this lease be renewed" — use `ownRenewal*` for that. */
  renewalAccepted: 'pending' | 'accepted' | 'rejected' | null;
  renewalStatus: string | null;
  /** This row's OWN markers, never mirrored — a renewal of THIS lease. */
  ownRenewalAccepted?: 'pending' | 'accepted' | 'rejected' | null;
  ownRenewalStatus?: string | null;
  renewalRejectionReason?: string | null;
  /** Customer declined the renewal with intent to leave → move-out wind-down. */
  vacateAtEnd?: boolean;
  parentContractId?: number | null;
  /** The lead this contract was created from (migration 0098) — drives the
   *  "Offer Receipt" row in the documents binder. NULL for renewals/manual. */
  originLeadId?: number | null;
  /** The offered payment plan from the origin lead — powers the Offer Receipt. */
  offerPlan?: OfferPlan | null;
  /** Live renewal child of THIS contract (when viewing a parent) — the agreed
   *  or in-flight renewal lives in its own contract row. */
  renewalChild?: { id: number; status: string; startDate?: string | null; endDate?: string | null; annualRent?: number } | null;
  /** The same customer signed a LATER lease for this unit (renewed/continued) —
   *  link-independent, so it's true even for flat-imported chains with no
   *  parent_contract_id. When true, this lease was not closed out. */
  hasSuccessor?: boolean;
  successorProposal?: {
    id: number;
    status: 'pending' | 'issued' | 'active' | 'expired' | 'terminated';
    contractActive: boolean;
    createdAt: string;
  } | null;
  termination: {
    requestedByRole: 'tenant' | 'rental_provider' | null;
    requestedAt: string | null;
    reason: string | null;
    /** Coded move-out reason (migration 0198) — what the Move-out Reasons
     *  report counts. NULL on every lease terminated before it existed. */
    reasonCode: string | null;
    effectiveDate: string | null;
    response: 'pending' | 'accepted' | 'rejected' | null;
    respondedAt: string | null;
    /** 'direct' = RP-side direct termination (no customer approval); the lease
     *  stays active until the settlement is marked paid. 'cancelled' = a
     *  pre-active void (restorable). NULL/'mutual' = legacy. */
    method?: 'mutual' | 'direct' | 'cancelled' | null;
  } | null;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null; entityType?: 'individual' | 'company' | null; companyName?: string | null };
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null; bankAccountName?: string | null; hasPoa?: boolean; poaPersonName?: string | null;
    /** Where a bank transfer goes — the landlord's primary account (API: bankDetailsOf). */
    bankDetails?: { accountName: string | null; bankName: string | null; iban: string | null } | null };
  property: { id: number | null; buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null; spaceCategory?: string | null };
  unit: {
    id: number | null; number: string | null; name: string | null; type: string | null;
    floor: string | null; bedrooms: number | null; bathrooms: number | null;
    /** Extra charges configured on the UNIT (sub-lease pass-through, service
     *  charge, …). The renewal form offers any of these the current lease isn't
     *  already billing — see the ProposeRenewalModal `extras` seed. */
    additionalPayments?: { label: string; amount: number; vat?: number }[];
  };
  documents: ContractDoc[];
  payments: ContractPayment[];
  /** One-off leasing fees (admin / ejari / commission) — stored as their own
   *  rows, kept out of the rent schedule/totals and shown in their own section. */
  fees?: ContractPayment[];
}

/**
 * This contract IS the next term of another lease (a renewal child), not a
 * standalone lease. Cancelling one ends the renewal (a termination of the next
 * term); cancelling a standalone pre-active lease only resets it to setup.
 */
export const isRenewalChild = (c: Pick<ContractDetail, 'contractType' | 'parentContractId'>) =>
  c.contractType === 'renewal' && !!c.parentContractId;

/**
 * Does THIS lease already have a renewal of its own under way — proposed, sent,
 * accepted, or sitting as an unsent draft? The one question every "Propose
 * renewal" affordance needs to answer.
 *
 * Reads the row's OWN markers, never the top-level ones: on a renewal child the
 * API mirrors the parent's decision into `renewalAccepted` / `renewalStatus` so
 * the decision banners can render from either row. That mirrored value describes
 * the renewal that CREATED this lease. Reading it here made every active renewal
 * child look like it already had a renewal accepted, so the button vanished and
 * a chain could never go past one hop — even though the backend allows it.
 * Falls back to the top-level fields for a NON-child, where the two are the same.
 */
export const hasRenewalInFlight = (c: ContractDetail): boolean => {
  const accepted = c.ownRenewalAccepted !== undefined
    ? c.ownRenewalAccepted
    : (isRenewalChild(c) ? null : c.renewalAccepted);
  const status = c.ownRenewalStatus !== undefined
    ? c.ownRenewalStatus
    : (isRenewalChild(c) ? null : c.renewalStatus);
  return accepted === 'pending' || accepted === 'accepted' || status === 'draft';
};

// ────────────────────────────────────────────────────────────────────────────
// Step model
// ────────────────────────────────────────────────────────────────────────────

export type StepKey = 'issue' | 'documents' | 'cheques' | 'sign' | 'ejari' | 'utility' | 'movein' | 'active' | 'terms' | 'moveout' | 'closeout' | 'settlement';
export type Tone = 'action' | 'waiting' | 'celebrate' | 'declined';
export type IconKey = 'document' | 'pen' | 'stamp' | 'bolt' | 'key' | 'active' | 'envelope' | 'alert' | 'clock' | 'wallet';

export interface Step { key: StepKey; short: string; label: string; icon: IconKey }

// Order is the REAL process order, and Registration sits third — right after the
// signatures, before Utility. That is the sequence the outside world imposes: the
// registration certificate is what a utility account is opened against, which is
// why `updateEjari` fires the customer's `utilityNeeded` notification the moment
// registration completes. Between 2026-08-01 and 2026-08-08 this array put
// Registration LAST, on the reasoning that registration is what makes a tenancy
// legally live; that reversed the real dependency, and the step copy below was
// never renumbered to match it (Registration kept reading "Stop 3 · complete"
// while rendering fifth). Activation is now carried by the last step that
// actually happens — the move-in counter-signature (see _autoActivateOnEjari and
// the counter-sign path in contracts.service).
export const STEPS_NEW: Step[] = [
  { key: 'issue',   short: 'Issue',   label: 'Contract issued',  icon: 'document' },
  { key: 'sign',    short: 'Sign',    label: 'Signatures',        icon: 'pen'      },
  { key: 'ejari',   short: 'Contract Registration',   label: 'Contract Registration',icon: 'stamp'    },
  { key: 'utility', short: 'Utility', label: 'Utility account',   icon: 'bolt'     },
  { key: 'movein',  short: 'Move-in', label: 'Move-in inspection',icon: 'key'      },
  { key: 'active',  short: 'Active',  label: 'Active tenancy',    icon: 'active'   },
];
// Renewal branch = 4 steps (AGENTS.md: Terms Agreed → Signatures → Ejari Renewal →
// Active Renewal). The former Documents and Cheques / PDC steps are folded into
// "Terms agreed" as sub-sections (see stepContent 'terms'), and isDone('terms')
// requires all three, so Signatures never unlocks earlier than it used to.
export const STEPS_RENEWAL: Step[] = [
  { key: 'terms',     short: 'Terms',   label: 'Terms agreed',    icon: 'envelope' },
  { key: 'sign',      short: 'Sign',    label: 'Signatures',      icon: 'pen'      },
  { key: 'ejari',     short: 'Contract Registration',   label: 'Contract Registration renewal',   icon: 'stamp'    },
  { key: 'active',    short: 'Active',  label: 'Renewal active',  icon: 'active'   },
];
/**
 * STEPS_NEW in the lease's own words — the same per-subcategory names the
 * customer sees (lib/spaceJourney): residential "Ejari / DEWA / Move-in
 * inspection", commercial "Lease & signatures / Utilities / Fit-out &
 * handover", land "Land lease agreement / Registration / Plot handover". The
 * six keys and their order are untouched; only label/short change.
 */
export function stepsNewFor(unitType: string | null | undefined, spaceCategory?: string | null, emirate?: string | null): Step[] {
  const labels = contractRailLabels({ subcategory: spaceSubcategory(unitType, spaceCategory), emirate });
  return STEPS_NEW.map(s => {
    const l = labels[s.key as ContractRailKey];
    return l ? { ...s, label: l.label, short: l.short } : s;
  });
}
// Appended after "Active" once a termination is accepted and the lease is
// winding down (Phase 6c) — the actionable move-out inspection + settlement steps.
export const MOVE_OUT_STEP: Step = { key: 'moveout', short: 'Move-out', label: 'Move-out inspection', icon: 'key' };
// Optional utility close-out (clearance + final bill) between move-out and the
// deposit settlement — settlement stays reachable regardless of its state.
export const CLOSEOUT_STEP: Step = { key: 'closeout', short: 'Closeout', label: 'Utility closeout', icon: 'bolt' };
export const SETTLEMENT_STEP: Step = { key: 'settlement', short: 'Settlement', label: 'Deposit settlement', icon: 'wallet' };

export interface DerivedState {
  status: ContractDetail['status'];
  ejariStatus: ContractDetail['ejariStatus'];
  /** RP confirmed the post-dated cheques were collected — gates the renewal from
   *  the Cheques/PDC step to Signatures (matches the Operations renewal kanban). */
  pdcConfirmed: boolean;
  /** Renewal KYC re-verification was required (a KYC doc was expired at accept). */
  renewalDocsRequired: boolean;
  /** RP has reviewed + accepted the customer's re-uploaded KYC docs. */
  renewalDocsAccepted: boolean;
  /** KYC doc bases the customer still needs to (re-)upload a valid copy for. */
  expiredKycDocKeys: string[];
  tenantSigned: boolean;
  landlordSigned: boolean;
  /** All signatures are method 'on_file' — imported lease signed on paper,
   *  so digital signature fields are not applicable. */
  sigsOnFile: boolean;
  utilityDoc: boolean;
  moveIn: { rpSubmitted: boolean; tenantSig: boolean; rpCounterSig: boolean };
  moveOut: { rpSubmitted: boolean; tenantSig: boolean; rpCounterSig: boolean };
  /** Move-in document escape hatch — an uploaded move-in report stands in for a
   *  full inspection when clearing the backlog on an imported/active lease. */
  moveInDoc: boolean;
  /** Move-out document escape hatch — an uploaded move-out report stands in for
   *  a full inspection on outdated/legacy leases. */
  moveOutDoc: boolean;
  /** Optional utility close-out documents (between move-out and settlement). */
  closeout: { clearance: boolean; finalBill: boolean };
  settlementStatus: 'draft' | 'sent' | 'agreed' | 'paid' | null;
  /** Renewal 'terms' step is DONE only once the customer actually accepts the
   *  offer (renewalAccepted='accepted'). While it's merely proposed/pending the
   *  step is the live "awaiting customer" step — never auto-marked agreed. */
  termsAccepted: boolean;
}

export function isDone(key: StepKey, st: DerivedState): boolean {
  switch (key) {
    case 'issue':   return st.status !== 'pending';
    // Renewal KYC step — done if no re-verification was needed, or once the RP
    // has reviewed + accepted the customer's re-uploaded docs.
    case 'documents': return !st.renewalDocsRequired || st.renewalDocsAccepted;
    // Renewal Cheques/PDC step — done once the RP confirms the cheques collected,
    // or once the lease actually reached activation. A lease that RAN is inherently
    // past this stage, so the terminal statuses keep the step quiet and avoid
    // offering a moot "Mark as Collected" button the backend would reject.
    //
    // Signatures deliberately do NOT count. They used to: the assumption was that
    // signing implies the cheques were collected first. That inference breaks for a
    // lease signed via the import/blessing path (which is exempt from the PDC gate,
    // see activateContract) and then demoted back to ISSUED by resetEjariForRedo —
    // leaving it signed, un-activated, and pdcConfirmed=false. The step then read
    // "Cheques collected" over a record whose flag was never set, and auto-activation
    // on Ejari (_autoActivateRenewalOnEjari) silently refused for exactly that reason.
    // Every case the clause covered correctly is already covered by the statuses
    // below; it fired alone only on the stuck records, where it hid the problem.
    //
    // An ACTIVE lease no longer counts as done on its own (decided 14 Sep 2026): rent
    // only counts once the payment is confirmed, so an activated lease without it has
    // this step open until someone confirms the cheques or the bank transfer.
    case 'cheques': return st.pdcConfirmed
      || st.status === 'expired' || st.status === 'terminated';
    case 'sign':    return st.tenantSigned && st.landlordSigned;
    case 'ejari':   return st.ejariStatus === 'registered';
    case 'utility': return st.utilityDoc;
    case 'movein':  return st.moveIn.rpCounterSig || st.moveInDoc;
    case 'moveout': return st.moveOut.rpCounterSig || st.moveOutDoc;
    // Closeout is OPTIONAL — settlement stays reachable regardless.
    case 'closeout': return st.closeout.clearance && st.closeout.finalBill;
    case 'settlement': return st.settlementStatus === 'paid';
    // active/expired/terminated all mean the lease reached activation — so the
    // step machinery skips the "Activate" override for ended leases and lands
    // the RP on the wind-down (or terminal panel) instead.
    case 'active':  return st.status === 'active' || st.status === 'expired' || st.status === 'terminated';
    // Renewal step 1 — done only once the customer accepts (not merely proposed)
    // AND the folded-in renewal documents + cheques/PDC sub-sections are done.
    case 'terms':   return st.termsAccepted && isDone('documents', st) && isDone('cheques', st);
    default:        return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

export function fmtAed(n: number | null | undefined): string {
  if (n == null) return '—';
  return 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(n));
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  // Pin to Asia/Dubai so a date-only value (e.g. a cheque date "2026-06-01",
  // parsed by new Date() as UTC midnight) renders on its real calendar day for
  // every viewer — without a timeZone it shifts back a day west of UTC.
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE });
}

export function fmtMethod(m: string | null | undefined): string {
  if (!m) return '—';
  return m.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online' },
];

/** Generic upload types, projected from THE document catalogue — the same list
 *  the "request from customer" picker offers, so one document reads as one
 *  document on both sides. The contract-specific checklist types
 *  (docRequirements mapping) are merged in front of these.
 *
 *  `section` rides along so the picker can group by it: the RP states whether
 *  they are filing a customer-KYC paper or a tenancy one AS they upload, instead
 *  of the binder inferring it from the key afterwards. */
export type DocTypeOption = { value: string; label: string; category: string; needsExpiry: boolean; section: DocSection };
export const BASE_DOC_TYPES: DocTypeOption[] =
  UPLOADABLE_DOCS.map(e => ({ value: e.key, label: e.label, category: e.category, needsExpiry: e.needsExpiry === true, section: sectionOf(e) }));

/** Checklist doc keys whose uploads need an expiry date (identity docs + trade
 *  licence). The VAT Tax Registration Certificate and the business / activity
 *  licence are excluded — they carry no expiry. So is `emirates_id_back`: the
 *  card prints one expiry, on the front, and the back inherits it — see
 *  docNeedsExpiry in lib/docRequirements. */
export const EXPIRY_DOC_KEYS = new Set([
  'emirates_id', 'emirates_id_front', 'passport', 'uae_visa',
  'trade_license',
]);

/** The fee/VAT category for a unit TYPE. Delegates to lib/unitTaxonomy — this
 *  used to be a hand-copied list here, which quietly went stale: it never
 *  learned that accommodation lets are commercial, so the renewal preview
 *  offered 0% rent VAT on a staff-accommodation unit while the backend stamped
 *  5%. Three copies of one taxonomy is two too many; keep this a delegation. */
export const spaceCategoryFromUnitType = (unitType: string | null): string =>
  deriveSpaceCategoryFromUnitType(unitType?.toLowerCase() ?? null);

export function deriveState(contract: ContractDetail, signatures: { role: string; method?: string }[], insp: MoveInInsp | null, moveOutInsp: MoveInInsp | null, settlementStatus: DerivedState['settlementStatus']): DerivedState {
  const docs = contract.documents ?? [];
  const moveInDoc = docs.some(d => /^move_?in/i.test(d.documentKey || '') || /move-?in/i.test(d.displayName || ''));
  const moveOutDoc = docs.some(d => /^move_?out/i.test(d.documentKey || '') || /move-?out/i.test(d.displayName || ''));
  const clearance = docs.some(d => (d.documentKey || '').startsWith('utility_clearance') || /clearance/i.test(d.displayName || ''));
  const finalBill = docs.some(d => (d.documentKey || '').startsWith('utility_final_bill') || /final.?bill/i.test(d.displayName || ''));
  return {
    status: contract.status,
    ejariStatus: contract.ejariStatus,
    pdcConfirmed: contract.pdcConfirmed === true,
    renewalDocsRequired: !!contract.renewalDocsRequiredAt,
    renewalDocsAccepted: !!contract.renewalDocsAcceptedAt,
    expiredKycDocKeys: contract.expiredKycDocKeys ?? [],
    tenantSigned: signatures.some(s => s.role === 'tenant'),
    landlordSigned: signatures.some(s => s.role === 'landlord'),
    sigsOnFile: signatures.length > 0 && signatures.every(s => s.method === 'on_file'),
    // "Done" only once the RP has verified it. While the customer's submission is
    // merely `submitted`, the step stays open so the RP sees the review/approve UI.
    utilityDoc: contract.utilityStatus === 'verified',
    moveIn: {
      rpSubmitted: !!insp?.rpSubmittedAt,
      tenantSig: !!insp?.tenantSig,
      rpCounterSig: !!insp?.rpCounterSig,
    },
    moveOut: {
      rpSubmitted: !!moveOutInsp?.rpSubmittedAt,
      tenantSig: !!moveOutInsp?.tenantSig,
      rpCounterSig: !!moveOutInsp?.rpCounterSig,
    },
    moveInDoc,
    moveOutDoc,
    closeout: { clearance, finalBill },
    settlementStatus,
    // The renewal 'terms' step is done for any renewal that is past the proposal
    // stage — a still-'pending' proposal is done only once the customer accepts.
    // `renewalAccepted` is overloaded: on the PROPOSAL child it (mirrored) means
    // "these terms accepted?"; on a LIVE lease it means "is the NEXT renewal
    // accepted?" — so keying purely off it would wrongly pull an active lease
    // (whose own terms were long agreed) back to the Terms step. Gate on status.
    termsAccepted: contract.status !== 'pending' || contract.renewalAccepted === 'accepted',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// QuestMap (SVG journey with clickable waypoints)
// ────────────────────────────────────────────────────────────────────────────

export const STEP_ICON_PATHS: Record<IconKey, string> = {
  document: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  pen:      'M14 4l6 6L9 21H3v-6z',
  stamp:    'M9 3v6.5a2.5 2.5 0 0 1-5 0 M15 3v6.5a2.5 2.5 0 0 0 5 0 M3 13h18v4H3z',
  bolt:     'M13 2 4 14h7l-1 8 9-12h-7z',
  key:      'M7.5 11A4.5 4.5 0 1 0 12 15.5 M12 9.5 21 9.5 M18 9.5v3',
  active:   'M12 3 a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M8 12 l3 3 5-6',
  envelope: 'M3 5h18v14H3z M3 7l9 7 9-7',
  alert:    'M12 2L1 21h22z M12 9v5 M12 17h.01',
  clock:    'M12 3 a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  wallet:   'M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1z M3 7l0-1a2 2 0 0 1 2-2h11 M16 13h.01',
};

// ────────────────────────────────────────────────────────────────────────────
// Step content
// ────────────────────────────────────────────────────────────────────────────

export interface StepContent {
  tone: Tone;
  icon: IconKey;
  sub: string;
  label: string;
  headline: string;
  body: string;
  timing: string | null;
  node: React.ReactNode;
}

/** Resolved action capabilities for the current actor. For an RP owner every
 *  field is `true`; for a manager each is the per-landlord permission value.
 *  Computed once in the page component (mirroring the Edit gate) and threaded
 *  into the child components that render gated affordances. */
export interface ActorPerms {
  /** Propose / manage renewals → canManageRenewals. */
  renewals: boolean;
  /** Terminate / request termination + addenda → canManageAgreements. */
  agreements: boolean;
  /** Sign the LANDLORD signature inline (a manager signing on the landlord's
   *  behalf) — needs signing rights AND power of attorney. */
  signLandlord: boolean;
  /** Send the no-login landlord signing link — invites the owner to sign
   *  themselves, so only needs agreement management (NOT signing / POA). */
  sendLandlordLink: boolean;
  /** Sign tenant / witness / manager signatures → canSignDocuments. */
  signDocuments: boolean;
  /** Counter-sign a move-in / move-out inspection → canManageInspections (NOT
   *  the landlord/POA contract signature — a manager signs inspections). */
  inspections: boolean;
  /** Deposit edit → canManageDeposits OR canManageCollections. */
  deposits: boolean;
  /** Finalize / sign off the FINAL SETTLEMENT (send, mark-paid, unsend) →
   *  canSettleDeposits. */
  settleDeposits: boolean;
  /** Record / edit payments, fees, cheque-status, confirm PDC → canManageCollections. */
  collections: boolean;
  /** Remove a document → canDeleteDocuments. NOT implied by being able to upload
   *  one: attaching a file and destroying one are different authorities (0247). */
  deleteDocuments: boolean;  /** 0326 — head-office custody shown and editable. */
  headOffice: boolean;
}

export interface StepHandlers {
  contract: ContractDetail;
  state: DerivedState;
  setState: (patch: Partial<DerivedState>) => void;
  openModal: (m: 'sign' | 'terminate' | 'renew' | 'direct-terminate') => void;
  openDrawer: (tab: DrawerTab) => void;
  patchContract: (patch: Partial<ContractDetail>) => void;
  onActivate: () => Promise<void>;
  onIssue: () => Promise<void>;
  /** Ejari "Upload & activate": upload → register → activate (if not active). */
  onUploadEjari: () => void;
  onUploadUtility: () => void;
  onMarkUtility: () => Promise<void>;
  /** Bypass digital signing — record both signatures as on file (paper/imported). */
  onMarkSignedOnFile: () => Promise<void>;
  onVerifyUtility: () => Promise<void>;
  /** Reject the customer's utility submission — opens the reason modal, which
   *  sends it back to the customer's utility step for a fresh upload. */
  onRejectUtility: () => void;
  /** Confirm the post-dated cheques were collected → PATCH /contracts/:id/confirm-pdc.
   *  Unlocks the Signatures step on a renewal (Cheques/PDC → Signatures). */
  onConfirmPdc: () => Promise<void>;
  /** Renewal Cheques/PDC step — RP uploads the Payment Advice on the customer's
   *  behalf, or marks the cheques as already on file once it's attached. */
  onUploadCheques: () => void;
  /** Attach cheque file(s) against one payment slot of the renewal plan — the
   *  SAME tag the customer's Payments step writes (`<slot> · <file>`), so both
   *  sides read one attachment per payment. `replaceIds` go only after the new
   *  files are stored. */
  onAttachChequeForSlot: (slotLabel: string, files: FileList | null, replaceIds?: number[]) => Promise<void>;
  /** Remove one cheque file (soft delete). */
  onRemoveChequeDoc: (docId: number) => Promise<void>;
  /** Tag a file sent "all together" to the payment it covers. */
  onTagChequeDoc: (docId: number, slotLabel: string) => Promise<void>;
  onMarkChequesOnFile: () => Promise<void>;
  /** What the reader made of the renewal's cheque files (null until first read). */
  chequeIntake: ChequeIntake | null;
  chequeReading: boolean;
  /** Read what is unread and place every cheque on its payment; `retryDocumentId` re-reads one file. */
  onReadCheques: (retryDocumentId?: number) => Promise<void>;
  /** Accept the customer's re-uploaded renewal KYC documents → PATCH
   *  /contracts/:id/renewal/accept-docs. Unlocks the Cheques step (Documents → Cheques). */
  onAcceptDocs: () => Promise<void>;
  /** Approve a single KYC document → POST /documents/:id/verify (same as leads / new-lease). */
  onApproveDoc: (docId: number) => void;
  /** Reject a single KYC document → POST /documents/:id/reject (same as leads / new-lease). */
  onRejectDoc: (docId: number, label?: string) => void;
  /** Approve a KYC doc AND record the expiry the RP read off it → POST /documents/:id/verify
   *  with a body. Rejects on failure so the caller can surface it (unlike onApproveDoc,
   *  which is fire-and-forget). */
  onApproveDocWithExpiry: (docId: number, expiryDate: string) => Promise<void>;
  /** Edit a payment/cheque row — number / method / date / status. Used by the
   *  renewal Cheques step so the RP records each cheque against the plan. */
  onUpdatePayment: (paymentId: number, patch: { chequeStatus?: string; amount?: number; vatAmount?: number; chequeNumber?: string | null; bankName?: string | null; description?: string | null; transactionDate?: string | null; paymentMethod?: string; paymentType?: string; documentId?: number | null; cancellationReason?: string | null }) => Promise<void>;
  onRevertToDraft: () => Promise<void>;
  /** Send the saved renewal draft to the customer, or discard it. */
  onRenewalDraft: (action: 'send' | 'discard') => Promise<void>;
  /** When a renewal notice was last sent from this page (ms), or null. */
  noticeSentAt: number | null;
  /** Undo a sent settlement — pulls it back to draft so the figures can be
   *  corrected and re-sent (only while the customer hasn't agreed yet). */
  onUnsendSettlement: () => Promise<void>;
  /** Cancel/undo a termination — reverts the lease to active while it has not
   *  yet closed out. */
  onCancelTermination: () => Promise<void>;
  /** Escape-hatch uploads — work even while the lease is active. */
  onUploadMoveInDoc: () => void;
  onUploadMoveOutDoc: () => void;
  onUploadCloseoutClearance: () => void;
  onUploadCloseoutFinalBill: () => void;
  signActionUrl: string;
  inspectionUrl: string;
  moveOutInspectionUrl: string;
  settlementUrl: string;
  printUrl: string;
  /** Role-aware contracts list base (RP vs manager) for child/parent links. */
  contractsBase: string;
  /** Role-aware Operations pipeline base (RP vs manager) — draft/proposal
   *  links jump here (the live workflow) rather than into the read-only
   *  contract record. */
  operationsBase: string;
  /** Manager-permission gates for the action affordances in this step. RP
   *  owners get `true` for every flag; a manager gets the per-landlord flag
   *  value. The backend already 403s a manager without the flag — this just
   *  hides the button so they never see an action they can't take. */
  perms: ActorPerms;
  /** Refetch the contract after a document is removed, so the lists come back
   *  from the server rather than being pruned in local state. */
  onDocsChanged: () => void;
  /** When true, all workflow rollback / re-do affordances are hidden:
   *  the "Update" / "Re-upload" / "Revert to draft" buttons on completed
   *  steps and the ChkRow undo toggles on the Sign step. Set to true
   *  whenever the contract has reached its terminal lifecycle (active,
   *  terminated, expired) so the activation history can't be rewritten
   *  after the fact. Active-state actions in the Active step
   *  (record payment / propose renewal / request termination) are
   *  unaffected — those are live management, not workflow rollback. */
  readOnlyWorkflow: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Detail cards row
// ────────────────────────────────────────────────────────────────────────────

export type DrawerTab = 'property' | 'payments' | 'documents' | 'clauses' | 'notes' | 'emails' | 'whatsapp' | 'breaches';

/** One entry in the tenancy's running notes log (newest first). */
export type ContractNote = {
  id: number;
  body: string;
  authorName: string | null;
  authorRole: 'rental_provider' | 'manager' | 'tenant' | null;
  createdAt: string;
};

export const DRAWER_TABS: { key: DrawerTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'property',  label: 'Property',  icon: Building2 },
  { key: 'payments',  label: 'Payments',  icon: CreditCard },
  { key: 'documents', label: 'Documents', icon: Paperclip },
  { key: 'clauses',   label: 'Clauses',   icon: ClipboardList },
  { key: 'notes',     label: 'Notes',     icon: StickyNote },
  { key: 'emails',    label: 'Emails',    icon: Mail },
  { key: 'whatsapp',  label: 'WhatsApp',  icon: MessageCircle },
  { key: 'breaches',  label: 'Breaches',  icon: Scale },
];

/** Every Settings → Rules penalty / admin charge, as an addable fee type. Each maps
 *  to the per-RP config columns its amount auto-fills from (flat fee, % of rent,
 *  N months of rent, or pro-rated daily). Grouped under Management Fee (RP-charged). */
export const RULE_FEE_DEFS: { pt: string; label: string; feeK: string; pctK: string; monthsK?: string; dailyK?: string }[] = [
  { pt: 'bounced_cheque_fee', label: 'Bounced cheque', feeK: 'bouncedChequePenaltyFee', pctK: 'bouncedChequePenaltyPct' },
  { pt: 'cheque_replacement_fee', label: 'Cheque hold / replacement', feeK: 'chequeHoldPenaltyFee', pctK: 'chequeHoldPenaltyPct' },
  { pt: 'cheque_deferral_fee', label: 'Cheque deferral', feeK: 'chequeDeferralPenaltyFee', pctK: 'chequeDeferralPenaltyPct' },
  { pt: 'late_renewal_fee', label: 'Late renewal', feeK: 'lateRenewalPenaltyFee', pctK: 'lateRenewalPenaltyPct' },
  { pt: 'early_termination_fee', label: 'Early termination', feeK: 'earlyTerminationPenaltyFee', pctK: 'earlyTerminationPenaltyPct', monthsK: 'earlyTerminationPenaltyMonths' },
  { pt: 'late_moveout_fee', label: 'Late move-out', feeK: 'lateMoveoutPenaltyFee', pctK: 'lateMoveoutPenaltyPct', dailyK: 'lateMoveoutPenaltyDaily' },
  { pt: 'unauthorized_sharing_fee', label: 'Sharing without notice / NOC', feeK: 'unauthorizedSharingPenaltyFee', pctK: 'unauthorizedSharingPenaltyPct' },
  { pt: 'access_card_fee', label: 'Access card / remote replacement', feeK: 'accessCardReplacementFee', pctK: 'accessCardReplacementPct' },
  { pt: 'contract_name_change_fee', label: 'Contract name change', feeK: 'contractNameChangeFee', pctK: 'contractNameChangePct' },
  { pt: 'unit_transfer_fee', label: 'Unit transfer', feeK: 'unitTransferFee', pctK: 'unitTransferPct' },
];

/**
 * WHY a cheque was cancelled (migration 0245) — the words a manager picks from,
 * and the words the schedule reads back. Only `replaced` means the money was
 * collected somewhere else, and only it may carry a link to the payment that
 * took its place; the other two are genuine voids.
 */
export type CancelReason = 'replaced' | 'returned_to_customer' | 'lease_cancelled';
export const CANCEL_REASONS: { key: CancelReason; label: string; hint: string }[] = [
  { key: 'replaced', label: 'Replaced — the customer swapped it',
    hint: 'The rent is still being collected, on another row. Record that payment next and link it here.' },
  { key: 'returned_to_customer', label: 'Returned to the customer',
    hint: 'The cheque went back and nothing came in its place.' },
  { key: 'lease_cancelled', label: 'The lease was cancelled',
    hint: 'The tenancy itself was cancelled, voiding the whole schedule.' },
];
export const CANCEL_REASON_WORD: Record<string, string> = {
  replaced: 'swapped by the customer',
  returned_to_customer: 'returned to the customer',
  lease_cancelled: 'voided with the lease',
};
export const RULE_FEE_LABELS: Record<string, string> = Object.fromEntries(RULE_FEE_DEFS.map(d => [d.pt, d.label]));
/** Charges the tenancy INCURS along the way — a bounced cheque, a late renewal, a
 *  replacement access card. Real money, and they belong in the ledger; but they are
 *  not part of what the tenancy was CONTRACTED to pay, so the pass leaves them out
 *  of "Total payable" (contract 81 read AED 78,000 for a lease agreed at 77,000,
 *  the extra 1,000 being two bounced-cheque penalties and no leasing fee at all). */
export const INCURRED_FEE_TYPES = new Set<string>(RULE_FEE_DEFS.map(d => d.pt));

/* ── Payment segmentation — ONE source of truth ────────────────────────────
 * The plan table, the receipts and the live-lease summary must never disagree
 * about which charge sits in which group, so the predicates live here rather
 * than being re-derived per surface. Management Fee = what the landlord charges
 * (admin + commission + every Rules penalty); Third Party = pass-throughs
 * (Contract Registration, fees VAT, service charges, ad-hoc "other").
 */
/** Bounced / cancelled cheques are void — never counted in any total. */
/** Money actually received in a section — the cleared cheques/payments only. */
export const clearedSum = (rows: { chequeStatus?: string | null; amount?: number | null }[]) =>
  rows.reduce((t, p) => t + ((p.chequeStatus ?? '').toLowerCase() === 'cleared' ? Number(p.amount || 0) : 0), 0);
export const feeActive = (p: { chequeStatus?: string | null }) =>
  !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase());
/** The combined VAT cheque on admin/commission fees is a pass-through tax — it
 *  belongs with Third Party, never inside the rent schedule. */
export const isFeesVat = (p: { paymentType?: string | null; description?: string | null }) =>
  (p.paymentType ?? '') === 'vat' && /fees\s*vat/i.test(p.description ?? '');
export const MGMT_FEE_TYPES = new Set<string>(['admin_fee', 'commission', ...RULE_FEE_DEFS.map(d => d.pt)]);


/** The status cell's control strip — inline status <select> + Edit. `nowrap`
 *  because the table cells set `overflow-wrap: anywhere`, which otherwise breaks
 *  the word "Edit" one letter per line; `wrap` on the strip so the button drops
 *  to a second line instead when the column is narrow (the same table renders in
 *  the wide contract record AND inside the narrower renewal Cheques step card). */
export const PAY_STATUS_CELL: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', whiteSpace: 'nowrap',
};

/** Inline gapless receipt number shown under a payment/deposit/fee row. Struck
 *  through and tagged "VOID" when the receipt was soft-voided (its cheque was
 *  reverted from cleared) — the number is retained for the gapless series. */
/**
 * "Download the receipt for THIS row and send it to the customer."
 *
 * The receipt for a single payment has always existed — `/print/receipt?pid=`
 * renders it — but the only way to reach one was through the combined Receipts
 * document in the binder and then hunting for the right page. When a cheque
 * bounces or is swapped, the manager is on this row, in this conversation, and
 * needs exactly two files: the receipt for the money that replaced it, and the
 * receipt for the charge. So the link sits where the work happens — beside the
 * status control that just changed.
 *
 * Offered ONLY once the row has an issued receipt number. A receipt is proof
 * money arrived; rendering one for a pending cheque would hand the customer a
 * document saying they had paid something they have not. A voided number says so
 * on its face rather than being hidden, because a customer holding the voided
 * copy needs to be able to tell it apart from the live one.
 */
export type CustodyAction = 'submit' | 'take_back' | 'returned' | 'undo_return';
export type CustodyHandler = (paymentIds: number[], action: CustodyAction, extra?: { reason: string; note?: string; documentId?: number }) => Promise<void>;

/** Every payment type the "New payment" popup can write. Which of these are
 *  actually offered is decided by the segment that opened it (see `recTypes`) —
 *  the Rental Income rail offers rental income only. */
export const REC_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'rental_income',   label: 'Rental income' },
  // Only ever offered when the popup is opened FOR a VAT row (recTypes gates the
  // list) — replacing a bounced VAT cheque must not re-file it as rent.
  { value: 'vat',             label: 'VAT' },
  { value: 'security_deposit', label: 'Security deposit' },
  { value: 'admin_fee',       label: 'Admin fee' },
  { value: 'ejari_fee',       label: 'Contract Registration fee' },
  { value: 'commission',      label: 'Commission' },
  { value: 'maintenance_fee', label: 'Maintenance fee' },
  { value: 'service_charge',  label: 'Service charge' },
  { value: 'other',           label: 'Other' },
];


/** Days between two dates, counted on calendar days (no DST / hour drift). */
export const dayCount = (a: Date, b: Date) =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
export const isoDay = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
