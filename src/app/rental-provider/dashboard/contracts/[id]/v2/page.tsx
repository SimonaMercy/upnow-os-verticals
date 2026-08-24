/**
 * RP Contract Detail — v2 (Quest layout)
 *
 * Parallel route at /rental-provider/dashboard/contracts/[id]/v2.
 * Implements the "UpNow RP Contract v2" design with full feature parity
 * with the v1 page at /rental-provider/dashboard/contracts/[id]:
 *   - All 6 NEW-lease steps (Issue → Sign → Ejari → Utility → Move-in → Active)
 *   - All 4 RENEWAL steps (Terms → Sign → Ejari → Active)
 *   - Phase 6c lifecycle states: superseded, terminating (active+termination accepted)
 *   - Termination request flow (initiate + respond)
 *   - Renewal propose / accept / decline (+ successor proposal link)
 *   - Sign modal (canvas + typed-name fallback)
 *   - Payment recording (status + paid date + reference)
 *   - Ejari upload / mark as registered
 *   - Utility doc surfacing (RP or customer)
 *   - Move-in inspection state mirror (rpSubmitted / tenantSig / rpCounterSig)
 *
 * Data fetching matches v1 exactly so the same backend endpoints power both:
 *   GET  /api/contracts/:id
 *   GET  /api/contracts/:id/signatures
 *   GET  /api/contracts/:id/inspection?type=move_in
 *   GET  /api/documents?ownerType=customer&ownerId=:tenantId
 *
 * Styling: design tokens (jade/saffron/brick palette + r-lg/r-md radius)
 * are injected via a <style jsx global> block at the bottom of the page
 * so we don't pollute the global stylesheet.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { REQUESTABLE_DOCS, groupRequestNames, requestedDocKey } from '@/lib/requestableDocs';
import { SECTION_LABEL, SECTION_ORDER, UPLOADABLE_DOCS, acceptedNamesFor, normDocName, sectionForCategory, sectionForDocKey, sectionOf, type DocSection } from '@/lib/documentCatalogue';
import { KYC_DOCS, getRequiredDocs, getRentalSectionDocs, getRenewalRequiredDocs, CONTRACT_DOCS } from '@/lib/docRequirements';
import type { DocReq } from '@/lib/docRequirements';
import {
  ArrowLeft, FileText, FileSignature, Stamp, Zap, Key, BadgeCheck,
  ChevronRight, ChevronDown, MapPin, Clock, Bell, Search,
  User, Building2, Calendar, CreditCard, Paperclip,
  ClipboardList, ListChecks, RotateCcw, X, AlertCircle, Check, StickyNote,
  UploadCloud, Eye, Download, ExternalLink, Pencil, ClipboardCheck, Send, Wallet,
  Trash2, Plus, Link2,
} from 'lucide-react';
import { DirhamSign } from '@/components/ui/DirhamSign';
import { CustomerDocsModal } from '@/components/upnow/CustomerDocsModal';
import { DocsLinkButton } from '@/components/upnow/DocsLinkButton';
import { DownloadDocButton } from '@/components/upnow/DownloadDocButton';
import { openDocsTogether } from '@/lib/openDocsTogether';
import { type OfferPlan } from '@/components/upnow/OfferReceiptModal';
import { PaymentPlanCard } from '@/components/upnow/PaymentPlanCard';
import { SegregatedPlanView } from '@/components/upnow/SegregatedPlanView';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import { segRowsFromContract, buildSegregatedPlan, type SegPaymentInput } from '@/lib/segregatedPlan';
import { taxPortionOf } from '@/lib/chargeTax';
import { chequeStatusDisplay } from '@/lib/chequeStatusDisplay';
import { groupReplacementsUnderBounce, MAX_REPLACEMENT_DEPTH } from '@/lib/chequeReplacementGroups';
import { buildCurrentPlan } from '@/lib/currentPlan';
import { fetchPaymentRefs, EMPTY_PAYMENT_REFS, type PaymentRefs } from '@/lib/paymentRefs';
import { openDocViewer } from '@/lib/docViewer';
import { DeleteDocumentButton } from '@/components/upnow/DeleteDocumentButton';
import { errMessage } from '@/lib/apiError';
import MoveOutReasonSelect from '@/components/upnow/MoveOutReasonSelect';
import { moveOutReason, moveOutReasonLabel, moveOutReasonReady } from '@/lib/moveOutReasons';
import { docLabel } from '@/lib/docLabel';
import { tenantDisplayName } from '@/lib/tenantName';
import { allowedInstallmentPlans, installmentLabel } from '@/lib/installmentPlans';
import { buildInstallmentDueDates } from '@/lib/installmentDates';
import { recomputeSubleaseCharges, classifySubleaseCharge } from '@/lib/subleaseCharges';
import { configuredFeeFromRules, feeVatFromRules, type FeeRuleLite } from '@/lib/feeRules';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { useAuth } from '@/contexts/AuthContext';
import { unitHref as unitWorkspaceHref } from '@/lib/unitHref';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface ContractDoc {
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
}

/** Identity of a stored documents row (its upsert key): an upload posted under
 *  the SAME owner + key overwrites that row in place instead of adding one. */
type DocReplaceTarget = Pick<ContractDoc, 'ownerType' | 'ownerId' | 'documentKey'>;

interface ContractPayment {
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
  /** What this row should READ as. Same as chequeStatus except on a bounce that
   *  has since been covered ('cleared' once the replacement money is banked,
   *  'replaced' while that cheque is still pending) and on a cheque the customer
   *  swapped, which reads 'replaced' and never 'cleared'. Server-derived so
   *  every surface agrees; `chequeStatus` remains the stored truth. */
  effectiveStatus?: string | null;
}

interface MoveInInsp {
  rpSubmittedAt?: string | null;
  tenantSig?: string | null;
  rpCounterSig?: string | null;
  rpCounterSignedAt?: string | null;
}

interface ContractDetail {
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
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null; bankAccountName?: string | null; hasPoa?: boolean; poaPersonName?: string | null };
  property: { id: number | null; buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
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
const isRenewalChild = (c: Pick<ContractDetail, 'contractType' | 'parentContractId'>) =>
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
const hasRenewalInFlight = (c: ContractDetail): boolean => {
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

type StepKey = 'issue' | 'documents' | 'cheques' | 'sign' | 'ejari' | 'utility' | 'movein' | 'active' | 'terms' | 'moveout' | 'closeout' | 'settlement';
type Tone = 'action' | 'waiting' | 'celebrate' | 'declined';
type IconKey = 'document' | 'pen' | 'stamp' | 'bolt' | 'key' | 'active' | 'envelope' | 'alert' | 'clock' | 'wallet';

interface Step { key: StepKey; short: string; label: string; icon: IconKey }

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
const STEPS_NEW: Step[] = [
  { key: 'issue',   short: 'Issue',   label: 'Contract issued',  icon: 'document' },
  { key: 'sign',    short: 'Sign',    label: 'Signatures',        icon: 'pen'      },
  { key: 'ejari',   short: 'Contract Registration',   label: 'Contract Registration',icon: 'stamp'    },
  { key: 'utility', short: 'Utility', label: 'Utility account',   icon: 'bolt'     },
  { key: 'movein',  short: 'Move-in', label: 'Move-in inspection',icon: 'key'      },
  { key: 'active',  short: 'Active',  label: 'Active tenancy',    icon: 'active'   },
];
const STEPS_RENEWAL: Step[] = [
  { key: 'terms',     short: 'Terms',   label: 'Terms agreed',    icon: 'envelope' },
  { key: 'documents', short: 'KYC',     label: 'Documents',       icon: 'document' },
  { key: 'cheques',   short: 'Cheques', label: 'Cheques / PDC',   icon: 'wallet'   },
  { key: 'sign',      short: 'Sign',    label: 'Signatures',      icon: 'pen'      },
  { key: 'ejari',     short: 'Contract Registration',   label: 'Contract Registration renewal',   icon: 'stamp'    },
  { key: 'active',    short: 'Active',  label: 'Renewal active',  icon: 'active'   },
];
// Appended after "Active" once a termination is accepted and the lease is
// winding down (Phase 6c) — the actionable move-out inspection + settlement steps.
const MOVE_OUT_STEP: Step = { key: 'moveout', short: 'Move-out', label: 'Move-out inspection', icon: 'key' };
// Optional utility close-out (clearance + final bill) between move-out and the
// deposit settlement — settlement stays reachable regardless of its state.
const CLOSEOUT_STEP: Step = { key: 'closeout', short: 'Closeout', label: 'Utility closeout', icon: 'bolt' };
const SETTLEMENT_STEP: Step = { key: 'settlement', short: 'Settlement', label: 'Deposit settlement', icon: 'wallet' };

interface DerivedState {
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

function isDone(key: StepKey, st: DerivedState): boolean {
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
    case 'cheques': return st.pdcConfirmed
      || st.status === 'active' || st.status === 'expired' || st.status === 'terminated';
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
    case 'terms':   return st.termsAccepted; // done only once the customer accepts (not merely proposed)
    default:        return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtAed(n: number | null | undefined): string {
  if (n == null) return '—';
  return 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  // Pin to Asia/Dubai so a date-only value (e.g. a cheque date "2026-06-01",
  // parsed by new Date() as UTC midnight) renders on its real calendar day for
  // every viewer — without a timeZone it shifts back a day west of UTC.
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE });
}

function fmtMethod(m: string | null | undefined): string {
  if (!m) return '—';
  return m.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

const PAYMENT_METHODS: { value: string; label: string }[] = [
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
type DocTypeOption = { value: string; label: string; category: string; needsExpiry: boolean; section: DocSection };
const BASE_DOC_TYPES: DocTypeOption[] =
  UPLOADABLE_DOCS.map(e => ({ value: e.key, label: e.label, category: e.category, needsExpiry: e.needsExpiry === true, section: sectionOf(e) }));

/** Checklist doc keys whose uploads need an expiry date (identity docs + trade
 *  licence). The VAT Tax Registration Certificate and the business / activity
 *  licence are excluded — they carry no expiry. So is `emirates_id_back`: the
 *  card prints one expiry, on the front, and the back inherits it — see
 *  docNeedsExpiry in lib/docRequirements. */
const EXPIRY_DOC_KEYS = new Set([
  'emirates_id', 'emirates_id_front', 'passport', 'uae_visa',
  'trade_license',
]);

function spaceCategoryFromUnitType(unitType: string | null): string {
  if (!unitType) return 'residential';
  const t = unitType.toLowerCase();
  if (['warehouse','open_yard','storage_unit','cold_storage','logistics_facility'].includes(t)) return 'industrial';
  if (['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical',
       'coworking_desk','private_office','meeting_room','day_office','event_hall','wedding_venue',
       'conference_hall','private_dining','outdoor_venue'].includes(t)) return 'commercial';
  return 'residential';
}

function deriveState(contract: ContractDetail, signatures: { role: string; method?: string }[], insp: MoveInInsp | null, moveOutInsp: MoveInInsp | null, settlementStatus: DerivedState['settlementStatus']): DerivedState {
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

const STEP_ICON_PATHS: Record<IconKey, string> = {
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

function Waypoint({
  step, done, selected, cx, cy, index, onSelect,
}: { step: Step; done: boolean; selected: boolean; cx: number; cy: number; index: number; onSelect: () => void }) {
  const r = selected ? 22 : 18;
  const fill = done ? 'var(--jade-deep)' : '#fff';
  const stroke = selected ? 'var(--brick)' : done ? 'var(--jade-deep)' : 'var(--mist-strong)';
  const icol = done ? '#fff' : selected ? 'var(--brick)' : 'var(--mute)';
  const lcol = done ? 'var(--jade-deep)' : selected ? 'var(--brick)' : 'var(--mute)';
  return (
    <g className="wpclick" onClick={onSelect} style={{ cursor: 'pointer' }}>
      {selected && !done && (
        <circle cx={cx} cy={cy} r={30} fill="var(--brick)" opacity={0.14}>
          <animate attributeName="r" values="22;34;22" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.22;0;0.22" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      <ellipse cx={cx + 1} cy={cy + r + 3} rx={r * 0.7} ry={3} fill="var(--ink)" opacity={0.08} />
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : 2} />
      <g transform={`translate(${cx + r - 5}, ${cy - r + 5})`}>
        <circle r={8} fill="var(--ink)" />
        <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={9} fontWeight={700}>{index + 1}</text>
      </g>
      <g transform={`translate(${cx - 11}, ${cy - 11})`}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={icol} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          {STEP_ICON_PATHS[step.icon].split(' M').map((seg, i) => (
            <path key={i} d={(i === 0 ? '' : 'M') + seg} />
          ))}
        </svg>
      </g>
      <text x={cx} y={cy + r + 18} textAnchor="middle" fontSize={11} fontWeight={600} fill={lcol}>{step.short}</text>
      <text x={cx} y={cy + r + 30} textAnchor="middle" fontSize={10} fill={selected ? 'var(--brick)' : 'var(--mute)'}>
        {done ? '✓ done' : selected ? 'now →' : 'tap'}
      </text>
    </g>
  );
}

function QuestMap({
  steps, doneArr, selectedIdx, onSelect, mode,
}: { steps: Step[]; doneArr: boolean[]; selectedIdx: number; onSelect: (i: number) => void; mode: 'new' | 'renewal' }) {
  const n = steps.length;
  const W = 332;
  const topPad = 56;
  const gap = 108;
  const innerH = topPad + 56 + (n - 1) * gap;
  const xs = steps.map((_, i) => 166 + (i % 4 === 1 ? 70 : i % 4 === 3 ? -70 : 0));
  const ys = steps.map((_, i) => topPad + i * gap);
  const doneCount = doneArr.filter(Boolean).length;
  const seg = (i: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[i] + ys[i + 1]) / 2;
    return `M ${xs[i]} ${ys[i]} C ${cx} ${cy}, ${cx} ${cy}, ${xs[i + 1]} ${ys[i + 1]}`;
  };
  const selStep = selectedIdx >= 0 ? steps[selectedIdx] : null;
  const selDone = selectedIdx >= 0 ? doneArr[selectedIdx] : false;
  return (
    <div className="qmap">
      <div className="qmap-h">
        <span className="qmap-l">
          <MapPin size={13} />{' '}{mode === 'renewal' ? 'Renewal journey' : 'Activation journey'}
        </span>
        <span className="qmap-c">{doneCount}/{n} complete</span>
      </div>
      <svg viewBox={`0 0 ${W} ${innerH}`} width="100%" height={innerH} style={{ display: 'block' }}>
        {steps.slice(0, -1).map((_, i) => {
          const solid = doneArr[i] && doneArr[i + 1];
          return (
            <path
              key={i}
              d={seg(i)}
              fill="none"
              stroke={solid ? 'var(--jade-deep)' : 'var(--mute)'}
              strokeWidth={solid ? 3 : 2}
              strokeDasharray={solid ? undefined : '2 7'}
              strokeLinecap="round"
              opacity={solid ? 1 : 0.5}
            />
          );
        })}
        {steps.map((s, i) => (
          <Waypoint key={s.key} step={s} done={doneArr[i]} selected={i === selectedIdx} cx={xs[i]} cy={ys[i]} index={i} onSelect={() => onSelect(i)} />
        ))}
      </svg>
      {selStep && (
        <div className="youare">
          <span className={'yi ' + (selDone ? 'done' : 'here')}>
            {selDone ? <BadgeCheck size={15} /> : <MapPin size={14} />}
          </span>
          <div style={{ flex: 1 }}>
            <div className="yl">{selDone ? 'Reviewing · complete' : 'Working on this step'}</div>
            <div className="yv">{selStep.label}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Action card primitives
// ────────────────────────────────────────────────────────────────────────────

function HeroIcon({ tone, icon }: { tone: Tone; icon: IconKey }) {
  const map: Record<IconKey, React.ComponentType<{ size?: number }>> = {
    document: FileText,
    pen:      Pencil,
    stamp:    Stamp,
    bolt:     Zap,
    key:      Key,
    active:   BadgeCheck,
    envelope: FileText,
    alert:    AlertCircle,
    clock:    Clock,
    wallet:   Wallet,
  };
  const Ic = map[icon];
  return <div className={'heroicon ' + tone}><Ic size={26} /></div>;
}

function Completed({ title, sub, onUndo, undoLabel, viewUrl, viewLabel, onView }: { title: string; sub?: string; onUndo?: () => void; undoLabel?: string; viewUrl?: string | null; viewLabel?: string; onView?: () => void }) {
  // `onView` routes customer-uploaded documents through the in-app viewer; the
  // `viewUrl` link is reserved for the generated Ejari PDF and in-app workspace
  // routes (move-out inspection / settlement), which stay externally openable.
  const hasView = !!onView || !!viewUrl;
  return (
    <div className="donepanel">
      <span className="dp-ic"><Check size={18} /></span>
      <div>
        <div className="dp-t">{title}</div>
        {sub && <div className="dp-s">{sub}</div>}
      </div>
      {onView
        ? <button type="button" onClick={onView} className="btn btn-ghost btn-sm cursor-pointer" style={{ marginLeft: 'auto' }}><ExternalLink size={13} /> {viewLabel || 'View'}</button>
        : viewUrl && <a href={viewUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}><ExternalLink size={13} /> {viewLabel || 'View'}</a>}
      {onUndo && <button className="btn btn-ghost btn-sm" style={{ marginLeft: hasView ? 8 : 'auto' }} onClick={onUndo}>{undoLabel || 'Update'}</button>}
    </div>
  );
}

/** RP review of the customer-uploaded utility proof: view the bill + confirm or reject. */
function UtilityReview({ proof, accountNumber, onConfirm, onReject, onUpload, lock }: {
  proof: ContractDoc; accountNumber?: string | null; onConfirm: () => void; onReject: () => void; onUpload: () => void; lock?: boolean;
}) {
  return (
    <>
      <div className="upbox">
        <span className="uf">
          <span className="ufi"><FileText size={15} /></span>
          {proof.displayName ?? 'Utility proof'}{accountNumber ? ` · ${accountNumber}` : ''}
        </span>
        <button type="button" onClick={() => openDocViewer({ fileUrl: proof.fileUrl, caption: proof.displayName ?? 'Utility proof' })} className="mini-btn view cursor-pointer" style={{ marginLeft: 'auto' }}><ExternalLink size={12} /> View bill</button>
      </div>
      {!lock && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <button className="btn btn-jade btn-sm" onClick={onConfirm}>
            <Check size={13} /> Confirm utility account
          </button>
          <button className="mini-btn no cursor-pointer" onClick={onReject}>
            <X size={13} /> Reject
          </button>
        </div>
      )}
      {!lock && <button className="ca" style={{ justifySelf: 'start', marginTop: 4, padding: 0 }} onClick={onUpload}>Upload a different proof</button>}
    </>
  );
}

function ChkRow({
  on, label, hint, onToggle, actionLabel, onAction, locked,
}: {
  on: boolean;
  label: string;
  hint?: string | null;
  onToggle: () => void;
  actionLabel?: string;
  onAction?: () => void;
  /** When true: hide the right-side Undo/action button entirely and
   *  make the checkbox a no-op. Used post-activation so the signing
   *  record can't be silently un-signed. */
  locked?: boolean;
}) {
  return (
    <div className={'chkrow ' + (on ? 'on' : '')}>
      <span className="cb" onClick={locked ? undefined : onToggle}>
        {on ? <Check size={12} /> : null}
      </span>
      <span className="ct">
        {label}
        {hint && <span style={{ color: 'var(--mute)', fontWeight: 500 }}> — {hint}</span>}
      </span>
      {!locked && (on
        ? <button className="ca" onClick={onToggle}>Undo</button>
        : onAction && <button className="ca" onClick={onAction}>{actionLabel}</button>)}
    </div>
  );
}

function UploadAction({
  fileLabel, onUpload, onMark,
}: { fileLabel: string; onUpload: () => void; onMark: () => void }) {
  return (
    <>
      <div className="upbox">
        <span className="uf">
          <span className="ufi"><FileText size={15} /></span> {fileLabel}
        </span>
        <button className="btn btn-jade btn-sm" style={{ marginLeft: 'auto' }} onClick={onUpload}>
          <UploadCloud size={13} /> Upload &amp; register
        </button>
      </div>
      <button className="ca" style={{ justifySelf: 'start', marginTop: -4, padding: 0 }} onClick={onMark}>
        Mark as already on file
      </button>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step content
// ────────────────────────────────────────────────────────────────────────────

interface StepContent {
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
interface ActorPerms {
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
  deleteDocuments: boolean;
}

interface StepHandlers {
  contract: ContractDetail;
  state: DerivedState;
  setState: (patch: Partial<DerivedState>) => void;
  openModal: (m: 'sign' | 'terminate' | 'renew' | 'direct-terminate') => void;
  openDrawer: (tab: DrawerTab) => void;
  patchContract: (patch: Partial<ContractDetail>) => void;
  onActivate: () => Promise<void>;
  onIssue: () => Promise<void>;
  onUploadEjari: () => void;
  onMarkEjari: () => Promise<void>;
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
  onMarkChequesOnFile: () => Promise<void>;
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
  onUpdatePayment: (paymentId: number, patch: { chequeStatus?: string; amount?: number; vatAmount?: number; chequeNumber?: string | null; description?: string | null; transactionDate?: string | null; paymentMethod?: string; paymentType?: string; documentId?: number | null; cancellationReason?: string | null }) => Promise<void>;
  onRevertToDraft: () => Promise<void>;
  /** Send the saved renewal draft to the customer, or discard it. */
  onRenewalDraft: (action: 'send' | 'discard') => Promise<void>;
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

/** Increment the trailing number of a cheque serial, e.g. "CK001234" -> "CK001235".
 *  Cheques come off one book, so recording the first one gives every later row a
 *  sensible default. Mirrors the lead card's helper of the same name. */
function nextSerial(base: string, offset = 1): string {
  const m = base.match(/^(.*?)(\d+)$/);
  if (!m) return base;
  const [, prefix, digits] = m;
  return prefix + (parseInt(digits, 10) + offset).toString().padStart(digits.length, '0');
}

/** Renewal Cheques/PDC step body (RP side). Before the customer submits, a waiting
 *  panel. Once submitted: the RP records each cheque against the payment plan
 *  (number / method / date / status via the existing payments PATCH), views the
 *  customer's uploaded cheque(s) filed as Payment Advice, then marks collected —
 *  which sets pdcConfirmed and unlocks Signatures. */
function RenewalChequeCollect({ h }: { h: StepHandlers }) {
  const submitted = !!h.contract.tenantChequesSubmittedAt;
  const canEdit = h.perms.collections;
  const rows: ContractPayment[] = [
    ...(h.contract.payments ?? []).filter(p => (p.paymentType ?? '') !== 'security_deposit'),
    ...(h.contract.fees ?? []),
  ];
  // The customer's uploaded cheque images/PDFs are filed as Payment Advice.
  const PA_BASES = ['payment_advice', 'pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques', 'renewal_payment_proof'];
  const chequeDocs = (h.contract.documents ?? []).filter(d => PA_BASES.includes((d.documentKey ?? '').toLowerCase().replace(/_\d{10,}$/, '')));

  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Method + reference typed against a row but NOT yet committed. Nothing is
   *  written until "Record" — exactly like the lead card, where filling the two
   *  fields is preparation and Record is the act of recording the cheque. */
  const [draft, setDraft] = useState<Record<number, { method?: string; ref?: string }>>({});
  /** Rows the RP re-opened to correct after recording. */
  const [reopened, setReopened] = useState<Set<number>>(new Set());
  /** The uploaded cheque whose instalment mapping is being saved. */
  const [attachBusy, setAttachBusy] = useState<number | null>(null);

  /** Commit a row. Returns false (and shows the reason) when the PATCH fails, so
   *  the caller doesn't clear the draft the RP would then have to retype. */
  const patchRow = async (id: number, patch: Parameters<StepHandlers['onUpdatePayment']>[1]): Promise<boolean> => {
    setBusyId(id); setErr(null);
    try { await h.onUpdatePayment(id, patch); return true; }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to record'); return false; }
    finally { setBusyId(null); }
  };

  /** Point an uploaded cheque image at the instalment it pays (or clear it).
   *  One document belongs to one instalment, so attaching it somewhere new
   *  detaches it from wherever it was — otherwise two rows would claim the same
   *  scan and the "Mapped to" line would contradict itself. */
  const mapAttachment = async (docId: number, paymentId: number | null) => {
    setAttachBusy(docId); setErr(null);
    try {
      const previous = payRows.find(r => r.documentId === docId);
      if (previous && previous.id !== paymentId) await h.onUpdatePayment(previous.id, { documentId: null });
      if (paymentId != null) await h.onUpdatePayment(paymentId, { documentId: docId });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to map the attachment');
    } finally { setAttachBusy(null); }
  };

  // Every payment being COLLECTED on this renewal in one numbered series — fees
  // and rent instalments together, ordered the way the lead's Record Cheques card
  // orders them (due date, then deposit → fee → instalment), so #3 means the same
  // payment on both sides. Fees live on `contract.fees`, rent on `contract.payments`.
  // The security deposit is deliberately absent: on a renewal it was collected on
  // the previous term and carried forward, so there is no cheque to record for it
  // here. (It is still shown, held, in the Payments record below.) A deposit that
  // IS this contract's own payment row stays in the series.
  const TYPE_ORDER: Record<string, number> = { security_deposit: -1, admin_fee: 0, ejari_fee: 0, commission: 0 };
  const payRows: ContractPayment[] = [
    ...(h.contract.payments ?? []),
    ...(h.contract.fees ?? []),
  ]
    .sort((a, b) => {
      const da = (a.transactionDate ?? '').slice(0, 10), db = (b.transactionDate ?? '').slice(0, 10);
      if (da !== db) return da.localeCompare(db);
      return (TYPE_ORDER[a.paymentType ?? ''] ?? 1) - (TYPE_ORDER[b.paymentType ?? ''] ?? 1);
    });
  // Bounced / cancelled cheques are void — they stay in the list as history but
  // are out of the header total, the same rule the Payments table applies.
  const payTotal = payRows.reduce((t, r) => t + (feeActive(r) ? (r.amount || 0) : 0), 0);

  // Cheque paperwork can already be in hand while the collection was never
  // CONFIRMED — an imported lease, or one demoted back to ISSUED after it ran.
  // Saying "waiting for the customer" there blames the wrong party and hides the
  // fact that the only outstanding thing is the RP's own confirmation, so the
  // panel names the real gap and points at the action that closes it.
  const evidenceOnFile = chequeDocs.length > 0
    || rows.some(p => !!p.chequeNumber || p.chequeStatus === 'cleared');

  if (!submitted) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--saffron-soft, #fff7ed)', color: 'var(--saffron-deep, #c2410c)', fontSize: 13, fontWeight: 600 }}>
          {evidenceOnFile
            ? <>Cheques for this renewal are already on file, but their collection was never confirmed — so this lease cannot go live. Check them below, then mark them on file to record the collection.</>
            : <>Waiting for {h.contract.tenant.name || 'the customer'} to upload &amp; submit their cheques. Once they do, record each cheque here and mark them collected to unlock signing.</>}
        </div>
        <button className="ca" style={{ justifySelf: 'start', padding: 0 }} onClick={() => h.openDrawer('payments')}>View the renewal cheque schedule</button>
        {chequeDocs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span className="note" style={{ fontWeight: 600 }}>Payment Confirmation already on file:</span>
            {chequeDocs.map((d, i) => (
              <button key={d.id} type="button" className="mini-btn view" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? `Cheque ${i + 1}` })}>
                <ExternalLink size={12} /> {d.displayName ?? `Cheque ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        {canEdit && (
          <UploadAction
            fileLabel="Payment-Confirmation.pdf"
            onUpload={h.onUploadCheques}
            onMark={() => void h.onMarkChequesOnFile()}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* The SAME Record-Cheques card the new lease uses on the lead
          (ChequesSection in leads/[id]): Instalment · Method · Reference ·
          Record, one row per planned payment, numbered, with the cheque total in
          the header. Method + reference are a draft until "Record" commits them
          — the button means the same thing on both sides. The renewal used to
          get a cut-down ledger instead, which is a different job from recording
          a cheque. Shares the .paygrid / .payrow styles by name. */}
      <div className="chqbox">
        <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span><CreditCard size={13} style={{ verticalAlign: '-2px' }} /> Payments</span>
          <span style={{ color: 'var(--mute)', fontWeight: 600 }}>{payRows.length} &middot; {fmtAed(payTotal)}</span>
        </div>
        {err && <div className="errline">{err}</div>}
        <div className="paygrid">
          <div className="payhead">
            <span>Instalment</span><span>Method</span><span>Reference</span><span>Record</span>
          </div>
          {payRows.map((r, i) => {
            const d = draft[r.id] ?? {};
            const method = d.method ?? r.paymentMethod ?? 'cheque';
            const reference = d.ref ?? r.chequeNumber ?? '';
            // A row counts as recorded once its cheque reference is on the row —
            // the contract equivalent of the lead's lead_cheques record.
            const recorded = !!r.chequeNumber && !reopened.has(r.id);
            return (
              <div key={r.id} className="payrow">
                <div className="payrow-info">
                  <span className="payrow-n">#{i + 1}</span>
                  <span className="payrow-lbl">
                    <span className="payrow-desc" title={r.description ?? undefined}>{r.description ?? 'Payment'}</span>
                    <span className="payrow-sub">
                      {fmtAed(r.amount)}{r.transactionDate ? ` \u00b7 due ${fmtDate(r.transactionDate)}` : ''}
                      {recorded ? ` \u00b7 ${fmtMethod(r.paymentMethod)} ${r.chequeNumber}` : ''}
                    </span>
                  </span>
                </div>
                <select
                      className="qinput payrow-ctl"
                      aria-label={`${r.description ?? 'Payment'} method`}
                      value={method}
                      disabled={!canEdit || recorded}
                      onChange={e => setDraft(v => ({ ...v, [r.id]: { ...v[r.id], method: e.target.value } }))}
                    >
                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <input
                      className="qinput payrow-ctl"
                      type="text"
                      aria-label={`${r.description ?? 'Payment'} reference`}
                      placeholder="Cheque # / ID…"
                      value={reference}
                      disabled={!canEdit || recorded}
                      onChange={e => setDraft(v => ({ ...v, [r.id]: { ...v[r.id], ref: e.target.value } }))}
                      // Cheques come off one book, so the rest of the series is
                      // the same serial counting up. Fill the empty rows below
                      // rather than making the RP type eight near-identical
                      // numbers — same courtesy the lead card gives.
                      onBlur={e => {
                        const val = e.currentTarget.value.trim();
                        if (!val) return;
                        setDraft(v => {
                          const next = { ...v };
                          let step = 1;
                          for (let k = i + 1; k < payRows.length; k++) {
                            const t = payRows[k];
                            if ((next[t.id]?.ref ?? t.chequeNumber ?? '').trim()) continue;
                            next[t.id] = { ...next[t.id], ref: nextSerial(val, step) };
                            step += 1;
                          }
                          return next;
                        });
                      }}
                    />
                    <div className="payrow-rec">
                      {recorded ? (
                        <>
                          <select
                            className={'qinput cstat ' + (r.chequeStatus ?? 'pending')}
                            aria-label={`${r.description ?? 'Payment'} status`}
                            value={r.chequeStatus ?? 'pending'}
                            disabled={!canEdit || busyId === r.id}
                            onChange={e => void patchRow(r.id, { chequeStatus: e.target.value })}
                          >
                            <option value="pending">Pending</option>
                            <option value="cleared">Cleared</option>
                            <option value="bounced">Bounced</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                          {canEdit && (
                            // Correct a mistyped cheque — re-opens the two fields.
                            // Never a delete: a payment line is history, and fee
                            // lines are never removed.
                            <button type="button" className="mini-btn view" title="Correct this cheque"
                              onClick={() => setReopened(prev => new Set(prev).add(r.id))}>
                              <Pencil size={12} />
                            </button>
                          )}
                        </>
                      ) : canEdit ? (
                        <button
                          type="button"
                          className="btn btn-jade btn-sm"
                          disabled={busyId === r.id}
                          onClick={async () => {
                            const serial = reference.trim();
                            if (!serial) { setErr(`Type the cheque # in Reference for #${i + 1} first`); return; }
                            const ok = await patchRow(r.id, { chequeNumber: serial, paymentMethod: method, chequeStatus: r.chequeStatus ?? 'pending' });
                            if (ok) {
                              setReopened(prev => { const n = new Set(prev); n.delete(r.id); return n; });
                              setDraft(v => { const n = { ...v }; delete n[r.id]; return n; });
                            }
                          }}
                        >
                          {busyId === r.id ? '\u2026' : 'Record'}
                        </button>
                      ) : (
                        <span className={'cstat ' + (r.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>{r.chequeStatus ?? 'pending'}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Customer-uploaded cheque images — thumbnail + View + map to the
            instalment each one pays. Same job, same controls as the lead's
            "Uploaded by customer" list; here the mapping is stored on the
            payment row (payments.document_id) rather than on a lead cheque. */}
        {chequeDocs.length > 0 && (
          <div className="doclist" style={{ marginTop: 12 }}>
            <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Uploaded by customer ({chequeDocs.length})</span>
              {chequeDocs.length > 1 && (
                <button type="button" className="linkbtn"
                  onClick={() => openDocsTogether(chequeDocs.map(d => ({ fileUrl: d.fileUrl, displayName: d.displayName ?? 'Cheque' })))}>
                  <Eye size={11} /> View all
                </button>
              )}
            </div>
            {chequeDocs.map((doc, i) => {
              const label = doc.displayName || `Cheque ${i + 1}`;
              const open = () => doc.fileUrl && openDocViewer({ fileUrl: doc.fileUrl, caption: label });
              // The instalment this scan is currently attached to, if any.
              const mappedTo = payRows.find(r => r.documentId === doc.id);
              return (
                <div key={doc.id} className="uprow">
                  <button type="button" className="upthumb" onClick={open} disabled={!doc.fileUrl} aria-label={`Preview ${label}`}>
                    {doc.fileUrl && !doc.fileUrl.toLowerCase().split('?')[0].endsWith('.pdf')
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={doc.fileUrl} alt={label} />
                      : <FileText size={16} />}
                  </button>
                  <div className="upmeta">
                    <div className="dn">{label}</div>
                    <div className="ds">
                      {mappedTo
                        ? <>Mapped to #{payRows.indexOf(mappedTo) + 1} {mappedTo.description ?? 'Payment'}{mappedTo.chequeNumber ? ` \u00b7 ${mappedTo.chequeNumber}` : ''}</>
                        : <>Not mapped to an instalment yet</>}
                    </div>
                    <div className="upctl">
                      {doc.fileUrl && <button type="button" className="mini-btn view" onClick={open}><Eye size={12} /> View</button>}
                      <select
                        className="qinput"
                        style={{ width: 190 }}
                        aria-label={`Map ${label} to an instalment`}
                        disabled={!canEdit || attachBusy === doc.id}
                        value={mappedTo ? String(mappedTo.id) : ''}
                        onChange={e => void mapAttachment(doc.id, e.target.value === '' ? null : Number(e.target.value))}
                      >
                        <option value="">Map to instalment&hellip;</option>
                        {payRows.map((r, k) => (
                          <option key={r.id} value={r.id}>#{k + 1} {r.description ?? `Payment ${k + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {canEdit && (
        <button
          type="button"
          className="btn btn-jade btn-block"
          disabled={confirming}
          onClick={() => { setConfirming(true); setErr(null); void h.onConfirmPdc().catch(e => setErr(e instanceof Error ? e.message : 'Failed to mark collected')).finally(() => setConfirming(false)); }}
        >
          <Check size={15} /> {confirming ? 'Marking…' : 'Mark as Collected'}
        </button>
      )}
      <p className="note" style={{ margin: 0 }}>Mark once every cheque above is in hand — this unlocks the signature step.</p>
    </div>
  );
}

/** Renewal Documents step body (RP side). Reuses the SAME per-document
 *  View / Approve / Reject pattern as the lead + new-lease KYC review (backed by
 *  POST /documents/:id/verify and /reject) so the RP's experience is consistent
 *  across flows. The customer re-uploads the KYC docs that expired since the last
 *  lease; once every flagged doc has a fresh (non-expired, non-rejected) copy, the
 *  RP presses "Accept documents & unlock cheques" to advance the renewal. */
function RenewalDocReview({ h }: { h: StepHandlers }) {
  const canEdit = h.perms.renewals || h.perms.agreements;
  const remaining = h.contract.expiredKycDocKeys ?? [];
  // Of the flagged bases, the ones stuck only for want of an expiry date. Splitting these
  // out is what keeps the step from dead-ending: a copy nobody dated can't be fixed by the
  // customer sending the same undated copy again, but the RP is looking right at the date.
  const undated = h.contract.kycExpiryMissingKeys ?? [];
  const awaitingCustomer = remaining.filter(b => !undated.includes(b));
  const LABELS: Record<string, string> = {
    emirates_id: 'Emirates ID', passport: 'Passport', visa: 'UAE Visa / Residency', trade_license: 'Trade License',
  };
  // The slot(s) each flagged base is uploaded into — the SAME keys the customer's
  // own renewal step writes to (spaces v2 BASE_SLOTS), so a copy sent through the
  // upload link refreshes the base here instead of landing as a stray file.
  // Emirates ID is TWO slots, front and back, as it is everywhere else.
  const UPLOAD_SLOTS: Record<string, { key: string; label: string; category: string }[]> = {
    emirates_id: [
      { key: 'emirates_id_front', label: 'Emirates ID — Front', category: 'identity' },
      { key: 'emirates_id_back',  label: 'Emirates ID — Back',  category: 'identity' },
    ],
    passport:      [{ key: 'passport',      label: 'Passport',             category: 'identity' }],
    visa:          [{ key: 'uae_visa',      label: 'UAE Visa / Residency', category: 'identity' }],
    trade_license: [{ key: 'trade_license', label: 'Trade License',        category: 'license'  }],
  };
  const baseOf = (k: string): string | null => {
    const s = (k ?? '').toLowerCase();
    if (s.includes('emirates_id') || s.includes('eid')) return 'emirates_id';
    if (s.includes('passport')) return 'passport';
    if (s.includes('visa')) return 'visa';
    if (s.includes('trade_license') || s.includes('licen')) return 'trade_license';
    return null;
  };
  // Collect ALL docs per flagged KYC base — Emirates ID is two files (front + back),
  // so View must open both, not just one side. `freshestByBase` is the representative
  // used for the status/expiry line (prefer latest future expiry, else id).
  // `!!d.fileUrl` — a document REQUESTED through the upload link is a row with no
  // file yet. It must not stand in as the base's freshest copy, or the row would
  // read "Pending review" for a document nobody has sent.
  const kycDocs = (h.contract.documents ?? []).filter(d => !!d.fileUrl && baseOf(d.documentKey ?? ''));
  const docsByBase = new Map<string, ContractDoc[]>();
  const freshestByBase = new Map<string, ContractDoc>();
  for (const d of kycDocs) {
    const b = baseOf(d.documentKey ?? '')!;
    (docsByBase.get(b) ?? docsByBase.set(b, []).get(b)!).push(d);
    const prev = freshestByBase.get(b);
    if (!prev) { freshestByBase.set(b, d); continue; }
    const de = d.expiryDate ? Date.parse(d.expiryDate) : 0;
    const pe = prev.expiryDate ? Date.parse(prev.expiryDate) : 0;
    if (de > pe || (de === pe && d.id > prev.id)) freshestByBase.set(b, d);
  }
  // Show every KYC doc on file so the RP can see/verify them all. Which ones are
  // FLAGGED for re-upload (`remaining`) is scoped to the tenancy type by the backend
  // (commercial → trade licence, residential → personal IDs), so a doc that isn't
  // flagged simply shows as already "Approved / on file" rather than "Pending".
  const bases = Array.from(new Set([...remaining, ...Array.from(freshestByBase.keys())]));
  const uploadSlots = bases.flatMap(b => UPLOAD_SLOTS[b] ?? [{ key: b, label: LABELS[b] ?? b, category: 'identity' }]);
  // The customer has pressed "Submit for review" on their side — their part is done,
  // so the footer must stop telling the RP to wait on them.
  const custSubmittedAt = h.contract.renewalDocsSubmittedAt ?? null;

  const [accepting, setAccepting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState<Record<string, string>>({});
  const [savingBase, setSavingBase] = useState<string | null>(null);
  const allRefreshed = remaining.length === 0;

  const accept = async () => {
    setAccepting(true); setErr(null);
    try { await h.onAcceptDocs(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to accept'); }
    finally { setAccepting(false); }
  };

  // Record the expiry the RP read off the copy. A future date drops the base out of
  // `remaining` on reload; a past one keeps it flagged but flips the row to a truthful
  // "expired — awaiting a fresh copy". Either way, entering the real date resolves it.
  const saveExpiry = async (base: string, docId: number) => {
    const date = expiryDraft[base];
    if (!date) return;
    setSavingBase(base); setErr(null);
    try {
      await h.onApproveDocWithExpiry(docId, date);
      setExpiryDraft(d => { const n = { ...d }; delete n[base]; return n; });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save expiry'); }
    finally { setSavingBase(null); }
  };

  return (
    // minWidth:0 — grid items default to min-width:auto, which would let the widest doc row
    // stretch the whole step panel past the card instead of wrapping inside it.
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {/* Same View / Approve / Reject row pattern as the lead + new-lease KYC review. */}
      <div className="doclist" style={{ minWidth: 0 }}>
        {bases.map(b => {
          const doc = freshestByBase.get(b);
          const allDocs = docsByBase.get(b) ?? [];
          const multi = allDocs.length > 1;
          const stillMissing = remaining.includes(b);
          // Two very different reasons hide behind one flag: `needsExpiry` is the RP's to
          // clear (type the date), `awaitingUpload` is genuinely the customer's.
          const needsExpiry = undated.includes(b);
          const awaitingUpload = stillMissing && !needsExpiry;
          const lbl = LABELS[b] ?? b;
          const ok = !!doc && ['processed', 'complete'].includes(doc.status ?? '');
          const rejected = !!doc && doc.status === 'rejected';
          const stt = stillMissing ? 'pending' : ok ? 'approved' : rejected ? 'rejected' : 'pending';
          return (
            <div key={b} className={'docitem ' + stt + (canEdit && doc && needsExpiry ? ' needsexp' : '')}>
              <FileText size={14} />
              <div style={{ minWidth: 0 }}>
                <div className="dn">{lbl}</div>
                <div className="ds">
                  {/* A dated copy that's still flagged here and isn't rejected can only be
                      flagged for one reason — the backend found its expiry in the past. */}
                  {needsExpiry ? 'No expiry date on file — add it to verify this copy'
                    : rejected ? 'Rejected — awaiting a fresh copy'
                    : awaitingUpload ? (doc!.expiryDate ? `Expired ${fmtDate(doc!.expiryDate)} — awaiting a fresh copy` : 'Awaiting a fresh copy from the customer')
                    : ok ? (doc!.expiryDate ? `Approved · expires ${fmtDate(doc!.expiryDate)}` : 'Approved')
                    : doc!.expiryDate ? `Pending review · expires ${fmtDate(doc!.expiryDate)}` : 'Pending review'}
                </div>
              </div>
              <div className="dacts">
                {doc && (
                  <button type="button" className="mini-btn view cursor-pointer" onClick={() => openDocViewer(allDocs.map(d => ({ fileUrl: d.fileUrl, caption: d.displayName ?? lbl })), lbl)}>
                    <ExternalLink size={12} /> {multi ? `View ${allDocs.length}` : 'View'}
                  </button>
                )}
                {/* Single copy only. A base holding several (both Emirates ID
                    sides, or a superseded re-upload) has no unambiguous target,
                    and `doc` here is the FRESHEST — removing that one would take
                    the good copy and leave the stale one behind. */}
                {h.perms.deleteDocuments && doc && !multi && (
                  <DeleteDocumentButton docId={doc.id} label={lbl} onDeleted={h.onDocsChanged} />
                )}
                {/* Undated copy: the date input IS the fix, so it sits in the row rather than
                    behind a badge that leaves the RP nothing to press. */}
                {canEdit && doc && needsExpiry && (
                  <>
                    <input
                      type="date" className="dexp" aria-label={`${lbl} expiry date`}
                      value={expiryDraft[b] ?? ''}
                      onChange={e => setExpiryDraft(d => ({ ...d, [b]: e.target.value }))}
                    />
                    <button
                      type="button" className="mini-btn ok cursor-pointer"
                      disabled={!expiryDraft[b] || savingBase === b}
                      onClick={() => void saveExpiry(b, doc.id)}
                    >
                      <Check size={12} /> {savingBase === b ? 'Saving…' : 'Approve'}
                    </button>
                  </>
                )}
                {canEdit && doc && !stillMissing && !ok && (
                  <button type="button" className="mini-btn ok cursor-pointer" onClick={() => h.onApproveDoc(doc.id)}><Check size={12} /> Approve</button>
                )}
                {canEdit && doc && (needsExpiry || (!stillMissing && !rejected)) && (
                  <button type="button" className="mini-btn no cursor-pointer" onClick={() => h.onRejectDoc(doc.id, lbl)}><X size={12} /> Reject</button>
                )}
                {awaitingUpload && <span className="cstat bounced">Pending</span>}
              </div>
            </div>
          );
        })}
      </div>
      {/* One upload link carrying exactly the documents still owed — the customer
          attaches them all without logging in, and without the RP re-typing the
          list into a request picker. Same control as the lead docs step. */}
      {canEdit && h.contract.tenant.id && bases.length > 0 && (
        <div style={{ paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
            Customer document upload link
          </div>
          {/* Every KYC document on this renewal, refreshed or not — the customer's
              page marks what is already on file and what is still expected. */}
          <DocsLinkButton
            tenantId={h.contract.tenant.id}
            contractId={h.contract.id}
            variant="inline"
            label={`Send upload link (${uploadSlots.length})`}
            presetDocs={uploadSlots.map(s => ({
              key: s.key, label: s.label, category: s.category, required: true,
            }))}
          />
        </div>
      )}
      {err && <p className="note" style={{ color: 'var(--brick)' }}>{err}</p>}
      {allRefreshed ? (
        canEdit && (
          <button type="button" className="btn btn-jade btn-block" disabled={accepting} onClick={() => void accept()}>
            <Check size={15} /> {accepting ? 'Accepting…' : 'Accept documents & unlock cheques'}
          </button>
        )
      ) : awaitingCustomer.length === 0 ? (
        // Every blocker is RP-side — don't tell them to wait on a customer who has nothing to send.
        <p className="note">
          {custSubmittedAt ? `${h.contract.tenant.name || 'The customer'} submitted their documents on ${fmtDate(custSubmittedAt)}. ` : ''}
          Add the missing expiry date{undated.length === 1 ? '' : 's'} above to unlock the cheques step.
        </p>
      ) : (
        <p className="note">
          Waiting for {h.contract.tenant.name || 'the customer'} to re-upload {awaitingCustomer.length === 1 ? 'a document' : `${awaitingCustomer.length} documents`}. You can accept once every copy is refreshed{undated.length ? ', including the expiry dates above' : ''}.
        </p>
      )}
    </div>
  );
}

function stepContent(key: StepKey, st: DerivedState, h: StepHandlers, mode: 'new' | 'renewal'): StepContent {
  const TEN = h.contract.tenant.name || 'the customer';
  const totalSteps = mode === 'renewal' ? 6 : 6;
  const stopOf = (n: number) => mode === 'renewal' ? `Renewal · Stop ${n}` : `Stop ${n} of ${totalSteps}`;

  // Once a contract is active/terminated/expired, the activation steps
  // are frozen: no Re-upload, no undo toggles, no "Revert to draft".
  // Only the read-only "complete" panel shows.
  const lock = h.readOnlyWorkflow;

  if (key === 'issue') {
    const done = isDone('issue', st);
    return done
      ? {
          tone: 'celebrate', icon: 'document', sub: 'Stop 1 · complete', label: 'Issued',
          headline: 'Contract issued.',
          body: `Sent to ${TEN} — the signing process is underway.`,
          timing: null,
          node: (
            <Completed
              title="Issued to customer"
              sub="Signing in progress"
              onUndo={lock ? undefined : h.onRevertToDraft}
              undoLabel="Revert to draft"
            />
          ),
        }
      : {
          tone: 'action', icon: 'document', sub: stopOf(1), label: 'Draft',
          headline: 'Issue this contract.',
          body: `Review the terms below, then send it to ${TEN} to begin signing.`,
          timing: null,
          node: (
            <button className="btn btn-jade btn-lg btn-block" onClick={() => h.onIssue()}>
              <FileSignature size={15} /> Issue contract to {TEN}
            </button>
          ),
        };
  }

  if (key === 'documents') {
    // Renewal-only KYC re-verification step — the customer re-uploads expired /
    // undated KYC docs (EID / passport / visa / trade licence); the RP reviews and
    // ACCEPTS them before cheques unlock, matching the Operations renewal kanban.
    const done = isDone('documents', st);
    if (done && !st.renewalDocsRequired) {
      // No re-verification was ever needed for this renewal — nothing to show.
      return {
        tone: 'celebrate', icon: 'document', sub: 'Renewal · Stop 2 · complete', label: 'Documents current',
        headline: 'KYC documents are current.',
        body: 'No document refresh was needed for this renewal.',
        timing: null,
        node: (
          <div className="chklist">
            <ChkRow on locked label="KYC documents up to date" onToggle={() => {}} />
          </div>
        ),
      };
    }
    return done
      ? {
          tone: 'celebrate', icon: 'document', sub: 'Renewal · Stop 2 · complete', label: 'Documents accepted',
          headline: 'Refreshed documents accepted.',
          body: `You reviewed and accepted ${TEN}'s refreshed KYC documents — the renewal can proceed to cheques.`,
          timing: null,
          node: (
            <div className="chklist">
              <ChkRow on locked label="Refreshed KYC documents accepted" onToggle={() => {}} />
            </div>
          ),
        }
      : {
          tone: 'action', icon: 'document', sub: stopOf(2), label: 'Documents',
          headline: 'Review the refreshed documents.',
          body: `${TEN} is re-uploading KYC documents that expired since the last lease. Review each one below, then accept to unlock the cheques step.`,
          timing: null,
          node: <RenewalDocReview h={h} />,
        };
  }

  if (key === 'cheques') {
    // Renewal-only Cheques/PDC step — collect + confirm the post-dated cheques
    // BEFORE signatures, matching the Operations renewal kanban.
    const done = isDone('cheques', st);
    return done
      ? {
          tone: 'celebrate', icon: 'wallet', sub: 'Renewal · Stop 3 · complete', label: 'Cheques collected',
          headline: 'Renewal cheques collected.',
          body: 'The post-dated cheques are confirmed — the renewal is ready for signature.',
          timing: null,
          node: (
            <div className="chklist">
              <ChkRow on locked label="Post-dated cheques confirmed" onToggle={() => {}} />
            </div>
          ),
        }
      : {
          tone: 'action', icon: 'wallet', sub: stopOf(3), label: 'Cheques / PDC',
          headline: 'Collect the renewal cheques.',
          body: `${TEN} uploads their post-dated cheques against the schedule; record each one's number, method and status, view their upload, then mark them collected to unlock signing.`,
          timing: null,
          node: <RenewalChequeCollect h={h} />,
        };
  }

  if (key === 'sign') {
    const done = isDone('sign', st);
    return done
      ? st.sigsOnFile
        ? {
            tone: 'celebrate', icon: 'pen', sub: 'Stop 2 · complete', label: 'Signed — on file',
            headline: 'Signed on paper — on file.',
            body: 'This lease was signed physically before it was imported. Digital signature fields are not applicable.',
            timing: null,
            node: (
              <>
                <div className="chklist">
                  <ChkRow on locked label={`${TEN} signed (on file)`} onToggle={() => {}} />
                  <ChkRow on locked label="Landlord signed (on file)" onToggle={() => {}} />
                </div>
                <SignatureAuditTrail contractId={h.contract.id} />
              </>
            ),
          }
        : {
          tone: 'celebrate', icon: 'pen', sub: 'Stop 2 · complete', label: 'Signed',
          headline: 'Both parties have signed.',
          body: 'Customer and landlord signatures are on file.',
          timing: null,
          node: (
            <>
              <div className="chklist">
                <ChkRow on locked={lock} label={`${TEN} signed`} onToggle={() => h.setState({ tenantSigned: false })} />
                <ChkRow on locked={lock} label="Landlord signed" onToggle={() => h.setState({ landlordSigned: false })} />
              </div>
              <SignatureAuditTrail contractId={h.contract.id} />
            </>
          ),
        }
      : {
          tone: 'action', icon: 'pen', sub: stopOf(mode === 'renewal' ? 3 : 2), label: 'Signatures',
          headline: 'Capture both signatures.',
          body: `${TEN} signs from their portal and you countersign here — or, for a paper-signed / imported lease, mark both as already on file.`,
          timing: 'Takes ~2 min',
          node: (
            <>
              <div className="chklist">
                <ChkRow
                  on={st.tenantSigned}
                  label={`${TEN} signed`}
                  hint={st.tenantSigned ? undefined : 'awaiting customer'}
                  onToggle={() => h.setState({ tenantSigned: !st.tenantSigned })}
                />
                <ChkRow
                  on={st.landlordSigned}
                  label="Landlord signed (you)"
                  onToggle={() => h.setState({ landlordSigned: !st.landlordSigned })}
                  actionLabel={h.perms.signLandlord ? 'Sign now' : undefined}
                  onAction={h.perms.signLandlord ? () => h.openModal('sign') : undefined}
                />
              </div>
              {h.perms.signLandlord && (
                <button
                  className="ca"
                  style={{ justifySelf: 'start', marginTop: 4, padding: 0 }}
                  onClick={() => h.onMarkSignedOnFile()}
                >
                  Mark as signed on file (paper / imported)
                </button>
              )}
              <SignatureAuditTrail contractId={h.contract.id} />
            </>
          ),
        };
  }

  if (key === 'ejari') {
    const done = isDone('ejari', st);
    // The uploaded certificate — base key first, then any extra slots (ejari_certificate_2…).
    const ejariDoc = (h.contract.documents ?? []).find(d => d.documentKey === 'ejari_certificate')
      ?? (h.contract.documents ?? []).find(d => d.documentKey.startsWith('ejari'));
    return done
      ? {
          tone: 'celebrate', icon: 'stamp', sub: 'Stop 3 · complete', label: 'Contract Registration',
          headline: mode === 'renewal' ? 'Contract Registration renewed.' : 'Contract Registration completed.',
          body: 'Certificate is on file with the Dubai Land Department.',
          timing: null,
          node: <Completed title="Registered with DLD" sub={ejariDoc?.displayName ?? 'Contract-Registration-Certificate.pdf'} viewUrl={ejariDoc?.fileUrl} viewLabel="View Contract Registration" />,
        }
      : {
          tone: 'action', icon: 'stamp', sub: mode === 'renewal' ? 'Renewal · Contract Registration' : stopOf(3), label: 'Contract Registration',
          headline: 'Register the Contract Registration Certificate with the DLD.',
          body: 'Upload the certificate, or mark it as already on file when importing an existing lease.',
          timing: '2–5 business days',
          node: <UploadAction fileLabel="Contract-Registration-Certificate.pdf" onUpload={h.onUploadEjari} onMark={() => h.onMarkEjari()} />,
        };
  }

  if (key === 'utility') {
    const done = isDone('utility', st);
    // Move-in utility activation proof. The RP now writes the SAME shared doc the
    // customer reads (`utility_proof_of_payment`), so prefer that — it guarantees
    // both sides show the same file. Fall back to the newest legacy RP-uploaded
    // copy ("utility_registration_*" / "utility_<ts>") for older contracts.
    // Clearance / final-bill are move-out docs and must NOT count here.
    const utilDocs = (h.contract.documents || []).filter(d =>
      d.documentKey === 'utility_proof_of_payment' ||
      d.documentKey === 'utility' ||
      /^utility_\d/.test(d.documentKey) ||
      /^utility_registration(_|$)/.test(d.documentKey));
    const proof = utilDocs.find(d => d.documentKey === 'utility_proof_of_payment')
      ?? utilDocs.reduce<ContractDoc | undefined>((best, d) => (!best || (d.id ?? 0) > (best.id ?? 0) ? d : best), undefined);
    const acc = h.contract.utilityAccountNumber;
    const accSub = acc ? `Utility account ${acc}` : 'Utility activation proof on file';
    // A customer submission awaiting RP review only while status is `submitted`.
    // After a reject the status drops back to `not_submitted` (awaiting the
    // customer's fresh upload), so we don't re-open the review over a stale proof.
    const awaitingReview = h.contract.utilityStatus === 'submitted' && !!proof;
    return done
      ? {
          tone: 'celebrate', icon: 'bolt', sub: 'Stop 4 · complete', label: 'Utility',
          headline: 'Utility account confirmed.',
          body: proof ? `${TEN}'s utility proof is on file.` : 'Utility activation proof is on file.',
          timing: null,
          node: <Completed title="Utility account confirmed" sub={accSub} onView={proof?.fileUrl ? () => openDocViewer({ fileUrl: proof.fileUrl, caption: proof.displayName ?? 'Utility proof' }) : undefined} viewLabel="View bill" />,
        }
      : {
          tone: 'action', icon: 'bolt', sub: stopOf(4), label: 'Utility',
          headline: awaitingReview ? `${TEN} uploaded the utility proof.` : 'Attach the utility activation.',
          body: awaitingReview
            ? 'Review the proof the customer uploaded, then confirm the utility account to advance — or reject it to send it back for a new upload.'
            : `Add the utility proof, let ${TEN} upload it, or mark it on file for imported leases.`,
          timing: awaitingReview ? null : 'Takes ~1 min',
          node: awaitingReview
            ? <UtilityReview proof={proof} accountNumber={acc} onConfirm={() => h.onVerifyUtility()} onReject={() => h.onRejectUtility()} onUpload={h.onUploadUtility} lock={lock} />
            : <UploadAction fileLabel="Utility-activation.pdf" onUpload={h.onUploadUtility} onMark={() => h.onMarkUtility()} />,
        };
  }

  if (key === 'movein') {
    const done = isDone('movein', st);
    // Completed via the uploaded move-in document (backlog escape hatch) rather
    // than a full counter-signed inspection — show the doc instead of the
    // "counter-signed" panel so the UI never claims a signature that isn't there.
    const moveInReport = (h.contract.documents ?? []).find(d =>
      /^move_?in/i.test(d.documentKey || '') || /move-?in/i.test(d.displayName || ''));
    const doneByDoc = done && !st.moveIn.rpCounterSig;
    return done
      ? {
          tone: 'celebrate', icon: 'key', sub: 'Stop 5 · complete', label: 'Move-in',
          headline: 'Move-in complete.',
          body: doneByDoc
            ? 'Move-in document is on file — keys handed over.'
            : 'Inspection signed by both parties — keys handed over.',
          timing: null,
          node: doneByDoc
            ? <Completed title="Move-in document on file" sub={moveInReport?.displayName ?? 'Move-in-report.pdf'} onView={moveInReport?.fileUrl ? () => openDocViewer({ fileUrl: moveInReport.fileUrl, caption: moveInReport.displayName ?? 'Move-in report' }) : undefined} viewLabel="View document" />
            : <Completed title="Inspection counter-signed" sub="Keys handed to customer" />,
        }
      : {
          tone: 'action', icon: 'key', sub: stopOf(5), label: 'Move-in',
          headline: 'Complete the move-in inspection.',
          body: 'Walk the unit, collect signatures and sign. Open the inspection page to act.',
          timing: 'Takes ~2 min',
          node: (
            <>
              {/* `locked`: these three are a read-out of the inspection's real
                  signature state, not switches. Their Undo buttons were wired to
                  a no-op toggle — clicking one did nothing at all, and a
                  submission or a customer's signature is not undoable from here
                  anyway. Progress is driven from the inspection workspace. */}
              <div className="chklist">
                <ChkRow locked on={st.moveIn.rpSubmitted} label="Inspection submitted" onToggle={() => {}} />
                <ChkRow locked on={st.moveIn.tenantSig} label={`${TEN} signed`} onToggle={() => {}} />
                <ChkRow locked on={st.moveIn.rpCounterSig} label="Manager / Landlord Sign" onToggle={() => {}} />
              </div>
              <Link href={h.inspectionUrl} className="btn btn-jade btn-block">
                <ClipboardCheck size={14} /> Open inspection workspace
              </Link>
            </>
          ),
        };
  }

  if (key === 'moveout') {
    const done = isDone('moveout', st);
    const eff = h.contract.termination?.effectiveDate;
    return done
      ? {
          tone: 'celebrate', icon: 'key', sub: 'Move-out · complete', label: 'Move-out',
          headline: 'Move-out inspection complete.',
          body: 'Both parties signed the move-out condition report. Proceed to the deposit settlement.',
          timing: null,
          node: <Completed title="Move-out inspection counter-signed" sub="Ready for final settlement" viewUrl={h.moveOutInspectionUrl} viewLabel="View inspection" />,
        }
      : {
          tone: 'action', icon: 'key', sub: 'Wind-down', label: 'Move-out',
          headline: 'Complete the move-out inspection.',
          body: `Walk the unit against the move-in report${eff ? ` before ${fmtDate(eff)}` : ''}, record the move-out condition, collect the customer signature and counter-sign.`,
          timing: 'Takes ~3 min',
          node: (
            <>
              <div className="chklist">
                <ChkRow locked on={st.moveOut.rpSubmitted} label="Move-out inspection submitted" onToggle={() => {}} />
                <ChkRow locked on={st.moveOut.tenantSig} label={`${TEN} signed`} onToggle={() => {}} />
                <ChkRow locked on={st.moveOut.rpCounterSig} label="Manager / Landlord Sign" onToggle={() => {}} />
              </div>
              <Link href={h.moveOutInspectionUrl} className="btn btn-jade btn-block">
                <ClipboardCheck size={14} /> Open move-out inspection
              </Link>
              <p className="note" style={{ marginTop: 8 }}>
                Lease is outdated? Upload the move-out document instead of a full inspection.
              </p>
              <button className="btn btn-ghost btn-block" onClick={h.onUploadMoveOutDoc}>
                <UploadCloud size={14} /> Upload move-out document instead
              </button>
            </>
          ),
        };
  }

  if (key === 'closeout') {
    const docs = h.contract.documents || [];
    const clearanceDoc = docs.find(d => (d.documentKey || '').startsWith('utility_clearance') || /clearance/i.test(d.displayName || ''));
    const finalBillDoc = docs.find(d => (d.documentKey || '').startsWith('utility_final_bill') || /final.?bill/i.test(d.displayName || ''));
    const both = st.closeout.clearance && st.closeout.finalBill;
    return {
      tone: both ? 'celebrate' : 'action', icon: 'bolt', sub: 'Wind-down', label: 'Closeout',
      headline: both ? 'Utility closeout complete.' : 'Close out the utility account.',
      body: both
        ? 'Utility clearance and final bill are on file. Proceed to the deposit settlement to close the lease.'
        : 'Attach the utility clearance and final bill from the provider. This step is optional — you can proceed to settlement.',
      timing: null,
      node: (
        <>
          <div className="chklist">
            <div className={'chkrow ' + (st.closeout.clearance ? 'on' : '')}>
              <span className="cb">{st.closeout.clearance ? <Check size={12} /> : null}</span>
              <span className="ct">Utility clearance</span>
              {clearanceDoc
                ? <button type="button" onClick={() => openDocViewer({ fileUrl: clearanceDoc.fileUrl, caption: clearanceDoc.displayName ?? 'Utility clearance' })} className="ca cursor-pointer"><ExternalLink size={12} /> View</button>
                : <button className="ca" onClick={h.onUploadCloseoutClearance}>Upload</button>}
            </div>
            <div className={'chkrow ' + (st.closeout.finalBill ? 'on' : '')}>
              <span className="cb">{st.closeout.finalBill ? <Check size={12} /> : null}</span>
              <span className="ct">Utility final bill</span>
              {finalBillDoc
                ? <button type="button" onClick={() => openDocViewer({ fileUrl: finalBillDoc.fileUrl, caption: finalBillDoc.displayName ?? 'Utility final bill' })} className="ca cursor-pointer"><ExternalLink size={12} /> View</button>
                : <button className="ca" onClick={h.onUploadCloseoutFinalBill}>Upload</button>}
            </div>
          </div>
          <p className="note" style={{ marginTop: 8 }}>Optional — you can proceed to settlement.</p>
          {h.perms.settleDeposits && (
            <Link href={h.settlementUrl} className="btn btn-jade btn-block">
              <Wallet size={14} /> Proceed to settlement
            </Link>
          )}
        </>
      ),
    };
  }

  if (key === 'settlement') {
    const ss = st.settlementStatus;
    if (ss === 'paid') {
      return {
        tone: 'celebrate', icon: 'wallet', sub: 'Settlement · complete', label: 'Settlement',
        headline: 'Deposit settled.',
        body: 'The deposit refund has been reconciled and marked paid. This tenancy is fully closed out.',
        timing: null,
        node: <Completed title="Deposit refund paid" sub="Settlement closed" viewUrl={h.settlementUrl} viewLabel="View settlement" />,
      };
    }
    const statusLine =
      ss === 'agreed' ? `${TEN} agreed — pay the refund and mark it paid.`
      : ss === 'sent' ? `Sent to ${TEN} — awaiting their agreement.`
      : 'Reconcile the deposit: deductions, dues, and the net refund.';
    return {
      tone: 'action', icon: 'wallet', sub: 'Wind-down', label: 'Settlement',
      headline: 'Settle the security deposit.',
      body: statusLine,
      timing: null,
      node: (
        <>
          <div className="chklist">
            {/* "Sent" can be undone (pull back to draft) until the customer
               agrees; once agreed the figures are committed, so it locks.
               This is live wind-down management (like recording a payment), so
               it is NOT gated by readOnlyWorkflow — the lease stays active
               through settlement, which would otherwise lock it permanently.
               A manager without the settle-deposits permission sees it
               locked (read-only). */}
            <ChkRow on={ss === 'sent' || ss === 'agreed'} label="Settlement sent to customer"
              onToggle={h.onUnsendSettlement} locked={ss === 'agreed' || !h.perms.settleDeposits} />
            {/* The customer's agreement and the payout are not the RP's to undo here. */}
            <ChkRow on={ss === 'agreed'} label={`${TEN} agreed`} onToggle={() => {}} locked />
            <ChkRow on={false} label="Refund marked paid" onToggle={() => {}} locked />
          </div>
          {h.perms.settleDeposits && (
            <Link href={h.settlementUrl} className="btn btn-jade btn-block">
              <Wallet size={14} /> Open settlement workspace
            </Link>
          )}
        </>
      ),
    };
  }

  if (key === 'terms') {
    // The 'terms' step reflects the REAL offer state — it is NOT agreed the moment
    // the RP sends it. renewalAccepted: 'accepted' → locked in; 'pending' → sent &
    // awaiting the customer; null/'draft' → not yet sent. In the two not-yet-agreed
    // states the RP sees the FULL proposed terms (the exact schedule + rent/fees/
    // discount the customer received), reusing the same PaymentPlanCard rendering as
    // the "Payment Plan" binder — plus a link to preview the full renewal contract.
    const ra = h.contract.renewalAccepted;
    // A live lease (already active/issued) or an accepted proposal → terms agreed.
    // Only a still-'pending' proposal that hasn't been accepted shows the
    // "sent/draft, awaiting" state below (status guards against the overloaded
    // renewalAccepted on an active lease that has its OWN renewal in flight).
    const isPendingProposal = h.contract.status === 'pending';
    if (!isPendingProposal || ra === 'accepted') {
      return {
        tone: 'celebrate', icon: 'envelope', sub: 'Renewal · step 1', label: 'Terms agreed',
        headline: 'Renewal terms agreed.',
        body: `${TEN} accepted the new annual rent of ${fmtAed(h.contract.annualRent)}.`,
        timing: null,
        node: <Completed title="Customer accepted the terms" sub="Renewal locked in" />,
      };
    }
    const sent = ra === 'pending';
    const proposedPlan = buildCurrentPlan(h.contract, h.contract.payments ?? []);
    return {
      tone: sent ? 'waiting' : 'action', icon: 'envelope', sub: 'Renewal · step 1', label: 'Terms',
      headline: sent ? `Renewal sent — awaiting ${TEN}.` : 'Renewal draft — not yet sent.',
      body: sent
        ? `These are the exact terms ${TEN} received. They haven't accepted yet.`
        : `Review the proposed terms below, then send them to ${TEN} from the Active step.`,
      timing: sent ? `Awaiting ${TEN}'s decision` : null,
      node: (
        <>
          <PaymentPlanCard
            plan={proposedPlan}
            rows={segRowsFromContract(h.contract, h.contract.payments ?? [])}
            refLabel={h.contract.ref}
            contractType={h.contract.contractType}
            tenantName={h.contract.tenant.companyName || h.contract.tenant.name}
            landlordName={h.contract.landlord.bankAccountName || h.contract.landlord.companyName || h.contract.landlord.name}
            unitNumber={h.contract.unit.number}
            buildingName={h.contract.property.buildingName}
            community={h.contract.property.community || h.contract.property.emirate}
            periodStart={h.contract.startDate}
            periodEnd={h.contract.endDate}
          />
          <Link href={h.printUrl} target="_blank" className="btn btn-ghost btn-block" style={{ marginTop: 12 }}>
            <Eye size={14} /> Preview full renewal contract
          </Link>
        </>
      ),
    };
  }

  // active
  if (h.contract.termination && h.contract.termination.response === 'pending' && h.contract.termination.requestedByRole === 'tenant') {
    return {
      tone: 'action', icon: 'alert', sub: 'Response required', label: 'Termination requested',
      headline: `${TEN} wants to end the lease early.`,
      body: 'Review the reason and effective date, then accept or reject.',
      timing: 'Awaiting your response',
      node: (
        <>
          <div className="qbanner action">
            <span className="bic"><AlertCircle size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
              <p className="bp">Requested {fmtDate(h.contract.termination.requestedAt)}</p>
              {h.contract.termination.reasonCode && <p className="bp">Reason: {moveOutReasonLabel(h.contract.termination.reasonCode)}</p>}
              {h.contract.termination.reason && <div className="quote">&ldquo;{h.contract.termination.reason}&rdquo;</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-brick" data-action="accept-termination"><Check size={14} /> Accept termination</button>
            <button className="btn btn-ghost" data-action="reject-termination"><X size={14} /> Reject</button>
          </div>
        </>
      ),
    };
  }
  if (h.contract.termination && h.contract.termination.response === 'pending' && h.contract.termination.requestedByRole === 'rental_provider') {
    return {
      tone: 'waiting', icon: 'clock', sub: 'Awaiting customer', label: 'Termination sent',
      headline: 'Termination request sent.',
      body: `The lease stays active until ${TEN} accepts.`,
      timing: 'Awaiting customer response',
      node: (
        <div className="qbanner waiting">
          <span className="bic"><Clock size={18} /></span>
          <div style={{ flex: 1 }}>
            <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
            {h.contract.termination.reasonCode && <p className="bp">Reason: {moveOutReasonLabel(h.contract.termination.reasonCode)}</p>}
            {h.contract.termination.reason && <div className="quote">&ldquo;{h.contract.termination.reason}&rdquo;</div>}
          </div>
        </div>
      ),
    };
  }
  if (
    h.contract.termination && h.contract.termination.response === 'accepted'
    && (h.contract.status === 'active'
        || (h.contract.status === 'expired' && h.contract.termination.method === 'direct'))
  ) {
    const isDirect = h.contract.termination.method === 'direct';
    return {
      tone: 'waiting', icon: 'clock', sub: 'Winding down', label: 'Terminating',
      headline: isDirect ? 'Direct close-out in progress.' : 'Move-out scheduled.',
      body: isDirect
        ? 'Complete the move-out, utility closeout, then mark the settlement paid to close this lease.'
        : `The tenancy stays active until ${fmtDate(h.contract.termination.effectiveDate)}, then auto-terminates.`,
      timing: isDirect ? null : 'Until effective date',
      node: (
        <>
          <div className="qbanner waiting">
            <span className="bic"><Clock size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
              <p className="bp">
                {isDirect
                  ? 'Direct termination — the lease stays active until you mark the settlement paid.'
                  : 'Both parties have agreed. Complete the move-out inspection, then settle the security deposit.'}
              </p>
              {h.contract.termination.reasonCode && <p className="bp">Reason: {moveOutReasonLabel(h.contract.termination.reasonCode)}</p>}
            </div>
          </div>
          <Link href={h.moveOutInspectionUrl} className="btn btn-jade btn-block">
            <ClipboardCheck size={14} /> {st.moveOut.rpCounterSig ? 'View move-out inspection' : 'Open move-out inspection'}
          </Link>
          {h.perms.agreements && (
            <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => void h.onCancelTermination()}>
              <RotateCcw size={14} /> Cancel termination — keep lease active
            </button>
          )}
        </>
      ),
    };
  }

  // Terminated — closed-out terminal record (direct or mutual).
  if (h.contract.status === 'terminated') {
    const isDirect = h.contract.termination?.method === 'direct';
    return {
      tone: 'celebrate', icon: 'active', sub: 'Lease ended', label: 'Terminated',
      headline: 'Lease terminated.',
      body: isDirect
        ? 'This lease was closed out via a direct termination.'
        : 'This lease has been terminated.',
      timing: null,
      node: (
        <div className="stats">
          <div className="stat">
            <div className="sl">Deposit held</div>
            <div className="sv jade">{fmtAed(h.contract.securityDepositHeld ?? h.contract.securityDepositAmount)}</div>
          </div>
        </div>
      ),
    };
  }

  // Expired (natural end) with no close-out yet — for outdated leases where the
  // customer already vacated, offer a direct termination + wind-down right here
  // instead of the misleading "Activate" override.
  if (h.contract.status === 'expired') {
    return {
      tone: 'action', icon: 'active', sub: 'Lease expired', label: 'Expired',
      headline: 'This lease has expired.',
      body: 'The term has ended. If the customer has already vacated, terminate it directly to record the move-out, utility closeout and final settlement.',
      timing: null,
      node: (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {h.perms.agreements && (
            <button
              className="btn btn-ghost"
              style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }}
              onClick={() => h.openModal('direct-terminate')}
            >
              <X size={14} /> Terminate directly
            </button>
          )}
        </div>
      ),
    };
  }

  if (isDone('active', st)) {
    return {
      tone: 'celebrate', icon: 'active', sub: mode === 'renewal' ? 'Renewal · live' : 'Stop 6 · live',
      label: mode === 'renewal' ? 'Renewal active' : 'Active tenancy',
      headline: mode === 'renewal' ? 'The renewal is live.' : 'This tenancy is live.',
      body: 'Manage payments, propose a renewal, or end the tenancy at any time.',
      timing: null,
      node: (
        <>
          {/* Rent · term · deposit · collected · next payment all read off the
              segregated summary below (and the page header), so the tiles that
              used to sit here only repeated them. The DISCOUNT is the one figure
              the plan does not carry, so it stays — as a single line. */}
          {(h.contract.discountAmount ?? 0) > 0 && (
            <div className="flag" style={{ justifySelf: 'flex-start', background: '#fdf1f1', borderColor: '#f3c9c9', color: '#b91c1c' }}>
              Discount applied
              {h.contract.listedRent != null && (
                <>
                  {' · '}
                  <span style={{ textDecoration: 'line-through', opacity: 0.75 }}>{fmtAed(h.contract.listedRent)}</span>
                  {' → '}
                  <strong>{fmtAed(h.contract.annualRent)}</strong>
                </>
              )}
              {' · '}− {fmtAed(h.contract.discountAmount!)}
            </div>
          )}
          {/* Only the PARENT lease (which owns the proposal) has a renewalChild.
              The child proposal itself sees a mirrored renewalAccepted='pending'
              (from getContractById) but renewalChild=null — gate on renewalChild
              so the banner never self-references on the proposal row. */}
          {h.contract.renewalAccepted === 'pending' && h.contract.renewalChild && (
            <div className="flag waiting" style={{ justifySelf: 'flex-start' }}>
              <RotateCcw size={13} /> Renewal proposed — awaiting {TEN}
              {' · '}
              <Link href={`${h.contractsBase}/${h.contract.renewalChild.id}/v2`} style={{ fontWeight: 700, textDecoration: 'underline' }}>
                View proposal · CID-{h.contract.renewalChild.id}
              </Link>
            </div>
          )}
          {/* Renewal DRAFT — saved for RP review; the customer has NOT been
              notified yet (gated on renewalAccepted='pending'). RP reviews then
              sends or discards. */}
          {h.contract.renewalStatus === 'draft' && h.contract.renewalAccepted !== 'pending' && h.contract.renewalChild && (
            <div className="flag" style={{ justifySelf: 'flex-start', background: '#fdf7ea', borderColor: '#e7d8a8', color: '#8a6d1f' }}>
              <RotateCcw size={13} /> Renewal draft ready — not yet sent to {TEN}
              {' · '}
              <Link href={`${h.operationsBase}/${h.contract.renewalChild.id}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>
                Review draft · CID-{h.contract.renewalChild.id}
              </Link>
            </div>
          )}
          {/* Customer accepted — the renewal now lives in its own contract.
              Without this block the renewal VANISHED from the parent page the
              moment it was accepted/issued. */}
          {h.contract.renewalAccepted === 'accepted' && h.contract.renewalChild && (
            <div className="flag" style={{ justifySelf: 'flex-start', background: 'var(--jade-soft, #e7f5ef)', borderColor: 'var(--jade, #2e9f82)', color: 'var(--jade-deep, #1a7a5a)' }}>
              <RotateCcw size={13} /> Renewal agreed — {fmtDate(h.contract.renewalChild.startDate ?? null)} → {fmtDate(h.contract.renewalChild.endDate ?? null)}
              {h.contract.renewalChild.annualRent ? <> @ {fmtAed(h.contract.renewalChild.annualRent)}</> : null}
            </div>
          )}
          {/* Payment summary — the SAME segregated view the Payment Plan document
              renders (Security Deposit · Rental Income · Management Fee · Third
              Party, each with its lines and total), built from the one canonical
              grouping in segregatedPlan.ts rather than a second look-alike table.
              It replaces the Record payment / Propose renewal / Terminate directly
              buttons that used to sit here: all three already exist on this page,
              so repeating them added noise instead of information. */}
          <SegregatedPlanView
            plan={buildSegregatedPlan(segRowsFromContract(h.contract, h.contract.payments ?? []))}
            style={{ padding: 0 }}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {h.contract.renewalAccepted === 'accepted' && h.contract.renewalChild && (
              <Link href={`${h.contractsBase}/${h.contract.renewalChild.id}/v2`} className="btn btn-jade">
                <RotateCcw size={14} /> Open renewal contract · CID-{h.contract.renewalChild.id}
              </Link>
            )}
            {/* Draft review action — send the reviewed draft to the customer. */}
            {h.contract.renewalStatus === 'draft' && h.contract.renewalAccepted !== 'pending' && h.perms.renewals && (
              <button className="btn btn-jade" onClick={() => void h.onRenewalDraft('send')}>
                <RotateCcw size={14} /> Send to {TEN}
              </button>
            )}
          </div>
        </>
      ),
    };
  }

  // not yet active — manual activation override
  const stepsAll = mode === 'renewal' ? STEPS_RENEWAL : STEPS_NEW;
  const missing = stepsAll.filter(s => s.key !== 'active' && !isDone(s.key, st)).map(s => s.label);
  return {
    tone: 'action', icon: 'active', sub: mode === 'renewal' ? 'Renewal · activate' : `Stop 6 of 6`, label: 'Activate',
    headline: 'Activate the tenancy.',
    body: 'Go live now and backfill any records later, or finish the open steps first — your call.',
    timing: null,
    node: (
      <>
        {missing.length > 0 && (
          <div className="qbanner waiting">
            <span className="bic"><AlertCircle size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Still open</p>
              <p className="bp">{missing.join(' · ')}. You can activate anyway and complete these afterwards.</p>
            </div>
          </div>
        )}
      </>
    ),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Missing strip
// ────────────────────────────────────────────────────────────────────────────

function MissingStrip({
  missing, allActive, onJump,
}: { missing: Step[]; allActive: boolean; onJump: (k: StepKey) => void }) {
  if (missing.length > 0) {
    return (
      <div className="missing">
        <span className="ml"><AlertCircle size={14} /> {missing.length} step{missing.length > 1 ? 's' : ''} need attention</span>
        {missing.map(s => (
          <button key={s.key} className="mchip" onClick={() => onJump(s.key)}>
            {s.label} <ChevronRight size={12} />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="missing allgood">
      <span className="ml">
        <Check size={14} /> {allActive ? 'Every step complete — tenancy is fully on file.' : 'All records complete — ready to activate the tenancy.'}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Detail cards row
// ────────────────────────────────────────────────────────────────────────────

type DrawerTab = 'property' | 'payments' | 'documents' | 'clauses' | 'notes';

/** One entry in the tenancy's running notes log (newest first). */
type ContractNote = {
  id: number;
  body: string;
  authorName: string | null;
  authorRole: 'rental_provider' | 'manager' | 'tenant' | null;
  createdAt: string;
};

/** Generates + emails the tenant a secure magic link, deep-linked to the section
 *  relevant to where it's shown (documents vs the contract review/sign page),
 *  and shows the link so the RP can copy/share it directly (e.g. WhatsApp). */
function SendTenantLinkButton({ tenantId, contractId, section = 'documents', label = 'Get / send link', role = 'tenant', disabled = false }: {
  tenantId: number; contractId: number; section?: 'documents' | 'contract' | 'move_in' | 'move_out' | 'settlement'; label?: string; role?: 'tenant' | 'inspector' | 'landlord'; disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    setState('sending');
    try {
      const res = await fetch('/api/portal/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        // Each link is scoped to one purpose — the backend enforces it and
        // returns a ready-to-share URL already deep-linked to the right page.
        body: JSON.stringify({ tenantId, contractId, purpose: section, signerRole: role }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const finalLink = d.link ?? '';
      setLink(finalLink); setEmail(d.email ?? null); setState('done');
      if (finalLink) { try { await navigator.clipboard.writeText(finalLink); setCopied(true); } catch { /* ignore */ } }
    } catch { setState('error'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };

  if (state === 'done' && link) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', maxWidth: 360 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
          <input readOnly value={link} onFocus={e => e.currentTarget.select()}
            style={{ flex: 1, fontSize: 11, padding: '4px 8px', border: '1px solid var(--line, #e8e6e0)', borderRadius: 8, background: '#fafaf8', color: '#1a1916' }} />
          <button type="button" className="mini-btn ok" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
          <a href={link} target="_blank" rel="noreferrer" className="mini-btn view"><ExternalLink size={12} /> Open</a>
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--mute, #9b9890)' }}>
          {email ? `Emailed to ${email} · ` : ''}
          {role === 'inspector'
            ? 'share this link with your inspection manager to fill the inspection, attach photos & counter-sign on site (valid 14 days)'
            : role === 'landlord'
              ? 'share this link with the landlord / authorised signatory to review every document & sign as the lessor — no login (valid 14 days)'
              : 'share this link with the customer to upload & sign (valid 14 days)'}
        </span>
      </div>
    );
  }
  return (
    <button type="button" className="mini-btn view" onClick={send} disabled={disabled || state === 'sending'}
      style={disabled ? { opacity: .5, cursor: 'not-allowed' } : undefined}
      title={disabled ? 'Choose the documents to request first' : 'Generate a secure link for the tenant'}>
      <Send size={12} /> {state === 'sending' ? 'Generating…' : state === 'error' ? 'Retry' : label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Drawer
// ────────────────────────────────────────────────────────────────────────────

function DRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="drow2">
      <span className="k">{k}</span>
      <span className="v">{v ?? '—'}</span>
    </div>
  );
}

const DRAWER_TABS: { key: DrawerTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'property',  label: 'Property',  icon: Building2 },
  { key: 'payments',  label: 'Payments',  icon: CreditCard },
  { key: 'documents', label: 'Documents', icon: Paperclip },
  { key: 'clauses',   label: 'Clauses',   icon: ClipboardList },
  { key: 'notes',     label: 'Notes',     icon: StickyNote },
];

/** Every Settings → Rules penalty / admin charge, as an addable fee type. Each maps
 *  to the per-RP config columns its amount auto-fills from (flat fee, % of rent,
 *  N months of rent, or pro-rated daily). Grouped under Management Fee (RP-charged). */
const RULE_FEE_DEFS: { pt: string; label: string; feeK: string; pctK: string; monthsK?: string; dailyK?: string }[] = [
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
type CancelReason = 'replaced' | 'returned_to_customer' | 'lease_cancelled';
const CANCEL_REASONS: { key: CancelReason; label: string; hint: string }[] = [
  { key: 'replaced', label: 'Replaced — the customer swapped it',
    hint: 'The rent is still being collected, on another row. Record that payment next and link it here.' },
  { key: 'returned_to_customer', label: 'Returned to the customer',
    hint: 'The cheque went back and nothing came in its place.' },
  { key: 'lease_cancelled', label: 'The lease was cancelled',
    hint: 'The tenancy itself was cancelled, voiding the whole schedule.' },
];
const CANCEL_REASON_WORD: Record<string, string> = {
  replaced: 'swapped by the customer',
  returned_to_customer: 'returned to the customer',
  lease_cancelled: 'voided with the lease',
};
const RULE_FEE_LABELS: Record<string, string> = Object.fromEntries(RULE_FEE_DEFS.map(d => [d.pt, d.label]));
/** Charges the tenancy INCURS along the way — a bounced cheque, a late renewal, a
 *  replacement access card. Real money, and they belong in the ledger; but they are
 *  not part of what the tenancy was CONTRACTED to pay, so the pass leaves them out
 *  of "Total payable" (contract 81 read AED 78,000 for a lease agreed at 77,000,
 *  the extra 1,000 being two bounced-cheque penalties and no leasing fee at all). */
const INCURRED_FEE_TYPES = new Set<string>(RULE_FEE_DEFS.map(d => d.pt));

/* ── Payment segmentation — ONE source of truth ────────────────────────────
 * The plan table, the receipts and the live-lease summary must never disagree
 * about which charge sits in which group, so the predicates live here rather
 * than being re-derived per surface. Management Fee = what the landlord charges
 * (admin + commission + every Rules penalty); Third Party = pass-throughs
 * (Contract Registration, fees VAT, service charges, ad-hoc "other").
 */
/** Bounced / cancelled cheques are void — never counted in any total. */
const feeActive = (p: { chequeStatus?: string | null }) =>
  !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase());
/** The combined VAT cheque on admin/commission fees is a pass-through tax — it
 *  belongs with Third Party, never inside the rent schedule. */
const isFeesVat = (p: { paymentType?: string | null; description?: string | null }) =>
  (p.paymentType ?? '') === 'vat' && /fees\s*vat/i.test(p.description ?? '');
const MGMT_FEE_TYPES = new Set<string>(['admin_fee', 'commission', ...RULE_FEE_DEFS.map(d => d.pt)]);


/** The status cell's control strip — inline status <select> + Edit. `nowrap`
 *  because the table cells set `overflow-wrap: anywhere`, which otherwise breaks
 *  the word "Edit" one letter per line; `wrap` on the strip so the button drops
 *  to a second line instead when the column is narrow (the same table renders in
 *  the wide contract record AND inside the narrower renewal Cheques step card). */
const PAY_STATUS_CELL: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', whiteSpace: 'nowrap',
};

/** Shared fixed column widths for BOTH payment tables (deposit/rent + fees) so
 *  every section's columns — amounts especially — line up in one vertical grid. */
function PayCols() {
  return (
    <colgroup>
      <col style={{ width: '15%' }} />{/* # / Fee */}
      <col style={{ width: '21%' }} />{/* Description */}
      <col style={{ width: '12%' }} />{/* Amount */}
      <col style={{ width: '14%' }} />{/* Reference */}
      <col style={{ width: '10%' }} />{/* Method */}
      <col style={{ width: '12%' }} />{/* Due date */}
      <col style={{ width: '16%' }} />{/* Status */}
    </colgroup>
  );
}

/** A segregation-group divider row inside the Payments/Fees tables — the same
 *  Security Deposit / Rental Income / Management Fee / Third Party rail used by the
 *  read-only plan view, so the working (editable) table reads in the same four groups. */
function PaySegRail({ title, extra, onAdd }: { title: string; extra?: React.ReactNode; onAdd?: () => void }) {
  return (
    <tr>
      <td colSpan={7} style={{ borderLeft: '3px solid #1a5a4a', background: 'var(--jade-tint, #eef2f0)', padding: '6px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 750, fontSize: 13, letterSpacing: '-.01em' }}>{title}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {extra != null && <span className="note" style={{ fontWeight: 400 }}>{extra}</span>}
            {onAdd && <button type="button" className="mini-btn view" onClick={onAdd}><Plus size={11} /> Add</button>}
          </span>
        </div>
      </td>
    </tr>
  );
}

/**
 * The security deposit, as its own section of the contract.
 *
 * It sat inside the Payments table until migration 0191 — the first rail, above
 * Rental Income — which was wrong twice over. It put money the landlord HOLDS in
 * the same list as money the customer OWES, and because a deposit could be
 * recorded either as a `payments` row or as a register row, the table rendered
 * whichever it found first: the payment-backed version had no Settle button, so
 * the four leases signed in the app could not settle their deposit at move-out.
 *
 * One record now (the register), one section, and every action it actually needs
 * in one place: record, correct, clear/bounce the cheque, settle at move-out, and
 * the receipt number. A lease with NO deposit still gets the section — an empty
 * state that offers Add is how a deposit nobody recorded stops being invisible.
 */
function ContractDepositSection({
  deposit: sd, agreedAmount, contractBase, refs, perms,
  adding, editing, busy, statusBusy, err, statusErr,
  form, setForm, onStartAdd, onStartEdit, onCancel, onSaveNew, onSaveEdit, onChangeStatus,
}: {
  deposit: {
    depositId: number | null; amount: number; chequeNumber: string | null;
    recordedDate: string | null; dueDate: string | null; paymentMethod: string | null;
    chequeStatus: string | null; status: string | null; isCarried: boolean;
    sourceContractId: number | null; settledRefundAmount: number | null;
    settledDeductionAmount: number | null; settledOn: string | null; settledViaSettlementId: number | null;
  } | null;
  agreedAmount: number | null;
  contractBase: string;
  refs: PaymentRefs;
  perms: ActorPerms;
  adding: boolean; editing: boolean; busy: boolean; statusBusy: boolean;
  err: string | null; statusErr: string | null;
  form: { amount: string; chequeNumber: string; paymentMethod: string; dueDate: string; chequeStatus: string };
  setForm: React.Dispatch<React.SetStateAction<{ amount: string; chequeNumber: string; paymentMethod: string; dueDate: string; chequeStatus: string }>>;
  onStartAdd: () => void; onStartEdit: () => void; onCancel: () => void;
  onSaveNew: () => void; onSaveEdit: (depositId: number) => void;
  onChangeStatus: (depositId: number, status: string) => void;
}) {
  // Editable only on the lease that OWNS the record. A renewal carries the same
  // physical deposit and shows it read-only — editing it there would edit the
  // original lease's money from a page that does not own it.
  const editable = !!sd && !sd.isCarried && sd.depositId != null && perms.deposits;
  const settled = !!sd?.status && sd.status !== 'held';
  const form_ = (
    <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12, background: 'var(--jade-tint)' }}>
      <p className="subhead">{adding ? 'Record the security deposit' : 'Edit security deposit'}</p>
      <div className="grid2">
        <div className="field"><label>Amount (AED)</label>
          <input type="number" min="0" step="0.01" className="input" value={form.amount} autoFocus
            onChange={e => setForm(v => ({ ...v, amount: e.target.value }))} />
        </div>
        <div className="field"><label>Payment method</label>
          <select className="input" value={form.paymentMethod}
            onChange={e => setForm(v => ({ ...v, paymentMethod: e.target.value }))}>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Cheque / reference no.</label>
          <input className="input" value={form.chequeNumber} placeholder="Cheque #, transfer ID…"
            onChange={e => setForm(v => ({ ...v, chequeNumber: e.target.value }))} />
        </div>
        <div className="field"><label>{form.chequeStatus === 'cleared' ? 'Date received' : 'Due date'}</label>
          <input type="date" className="input" value={form.dueDate}
            onChange={e => setForm(v => ({ ...v, dueDate: e.target.value }))} />
        </div>
        <div className="field"><label>Cheque status</label>
          <select className="input" value={form.chequeStatus}
            onChange={e => setForm(v => ({ ...v, chequeStatus: e.target.value }))}>
            <option value="pending">Pending</option>
            <option value="cleared">Cleared</option>
            <option value="bounced">Bounced</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      {/* Says what clearing it means before it is clicked — the receipt number is
          minted off this, and money in hand is what it asserts. */}
      <p className="note" style={{ marginTop: 6, fontSize: 11 }}>
        {form.chequeStatus === 'cleared'
          ? 'Cleared means the money is in hand — this mints the deposit receipt.'
          : 'The deposit is recorded as held either way; the status tracks the cheque.'}
      </p>
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-jade btn-sm" disabled={busy}
          onClick={() => (adding ? onSaveNew() : onSaveEdit(sd!.depositId!))}>
          <Check size={14} /> {busy ? 'Saving…' : adding ? 'Record deposit' : 'Save changes'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="sec">
      <div className="sech">
        <span className="si"><DirhamSign size={16} /></span>
        <span className="st">Security Deposit</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {sd && !sd.isCarried && (
            <span className="note" style={{ fontSize: 11 }}>held against this lease</span>
          )}
          {sd?.isCarried && sd.sourceContractId != null && (
            <span className="note" style={{ fontSize: 11 }}>
              carried from{' '}
              <Link href={`${contractBase.replace(/\/\d+$/, '')}/${sd.sourceContractId}/v2`}
                style={{ color: 'var(--jade)', fontWeight: 600, textDecoration: 'underline' }}>
                CID-{sd.sourceContractId}
              </Link>
            </span>
          )}
        </span>
      </div>
      <div className="secb" style={{ padding: 14 }}>
        {!sd ? (
          // Nothing on record. The landlord's own tracker had six leases reading
          // this way, five of which were deposits filed somewhere else — so the
          // empty state states the fact and offers the fix rather than staying blank.
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 13 }}>No deposit on record for this tenancy</p>
              <p className="note" style={{ fontSize: 12 }}>
                {agreedAmount
                  ? `The lease agrees ${fmtAed(agreedAmount)} — record it here once the cheque or transfer is in hand.`
                  : 'If a deposit was collected, record it here so it can be evidenced and settled at move-out.'}
              </p>
            </div>
            {perms.deposits && !adding && (
              <button type="button" className="btn btn-jade btn-sm" style={{ marginLeft: 'auto' }} onClick={onStartAdd}>
                <Plus size={13} /> Add deposit
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--jade-deep)', letterSpacing: '-.02em' }}>
                  {sd.amount ? fmtAed(sd.amount) : <span style={{ color: '#9b9890', fontSize: 15 }}>amount not recorded</span>}
                </div>
                {sd.depositId != null && <ReceiptRefTag refs={refs} id={sd.depositId} kind="deposit" />}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, auto))', gap: '4px 22px', marginLeft: 'auto' }}>
                <DRow k="Reference" v={sd.chequeNumber ?? '—'} />
                <DRow k="Method"    v={sd.paymentMethod ? fmtMethod(sd.paymentMethod) : '—'} />
                <DRow k={sd.recordedDate ? 'Received' : 'Cheque date'} v={fmtDate(sd.recordedDate ?? sd.dueDate) || '—'} />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {editable && sd.amount ? (
                <select className={'cstat ' + (sd.chequeStatus ?? 'pending')} style={{ cursor: 'pointer' }}
                  title="Cheque / banking status" value={sd.chequeStatus ?? 'pending'} disabled={statusBusy}
                  onChange={e => onChangeStatus(sd.depositId!, e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="cleared">Cleared</option>
                  <option value="bounced">Bounced</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              ) : (
                <span className={'cstat ' + (sd.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>
                  {(sd.chequeStatus ?? 'pending')}
                </span>
              )}
              {/* The settlement outcome is a different fact from the cheque status
                  — held vs returned/kept — so it gets its own chip, never merged. */}
              {settled && (
                <span className={'cstat ' + sd.status} style={{ textTransform: 'capitalize' }}>{sd.status!.replace('_', ' ')}</span>
              )}
              {editable && !adding && !editing && (
                <button type="button" className="mini-btn view" title="Correct the amount, reference, method or date"
                  onClick={onStartEdit}>
                  <Pencil size={12} /> {sd.amount ? 'Edit' : 'Set deposit'}
                </button>
              )}
              {perms.settleDeposits && sd.amount > 0 && !settled && (
                <Link href={`${contractBase}/settlement`} className="mini-btn view" title="Settle the deposit (refund / deduction)">
                  <Stamp size={12} /> Settle
                </Link>
              )}
              {statusErr && <span className="note" style={{ color: 'var(--brick)', fontSize: 11 }}>{statusErr}</span>}
            </div>

            {settled && (sd.settledRefundAmount != null || sd.settledDeductionAmount != null) && (
              <p className="note" style={{ fontSize: 12 }}>
                Refunded {fmtAed(sd.settledRefundAmount ?? 0)} · kept {fmtAed(sd.settledDeductionAmount ?? 0)}
                {sd.settledOn ? ` · ${fmtDate(sd.settledOn)}` : ''}
                {sd.settledViaSettlementId != null ? ' · via the move-out settlement' : ''}
              </p>
            )}
          </div>
        )}
        {(adding || (editing && editable)) && <div style={{ marginTop: 12 }}>{form_}</div>}
      </div>
    </div>
  );
}

/** Per-section subtotal row — closes each segment (Security Deposit / Rental Income /
 *  Management Fee / Third Party) with its own total, so no section is left un-summed
 *  and the totals never get lumped together. Optional sub-lines (e.g. Net rent / VAT). */
function PaySegTotalRow({ label = 'Total', amount, sub }: { label?: string; amount: number; sub?: { label: string; amount: number }[] }) {
  const tot: React.CSSProperties = { borderTop: '2px solid #bfe3d5', background: 'var(--jade-tint, #eef2f0)' };
  return (
    <>
      {(sub ?? []).map(s => (
        <tr key={s.label}>
          <td colSpan={2} style={{ color: 'var(--mute)' }}>{s.label}</td>
          <td className="amt" style={{ color: 'var(--mute)', fontWeight: 600 }}>{fmtAed(s.amount)}</td>
          <td colSpan={4} />
        </tr>
      ))}
      <tr>
        <td colSpan={2} style={{ ...tot, fontWeight: 800, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6b6860' }}>{label}</td>
        <td className="amt" style={{ ...tot, fontWeight: 800, color: 'var(--jade-deep)' }}>{fmtAed(amount)}</td>
        <td colSpan={4} style={tot} />
      </tr>
    </>
  );
}

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
function ReceiptDownload({ refs, id, base }: { refs: PaymentRefs; id: number; base: string }) {
  const ref = refs.receiptByPaymentId?.[id];
  if (!ref) return null;
  const isVoid = !!refs.voidedPaymentIds?.has(id);
  return (
    <a
      className="mini-btn view"
      href={`${base}?pid=${id}`}
      target="_blank"
      rel="noreferrer"
      // Icon only: the status cell already carries a dropdown and an Edit
      // button, and a third labelled control wrapped the row. The number lives
      // in the tooltip and is printed under the description besides.
      aria-label={isVoid ? `Receipt ${ref} — voided` : `Download receipt ${ref}`}
      title={isVoid
        ? `Receipt ${ref} — VOIDED (the cheque was reverted). Open it to see the void notice.`
        : `Open receipt ${ref} to download and send to the customer`}
      style={{ padding: '3px 6px', ...(isVoid ? { color: 'var(--brick)' } : null) }}
    >
      <Download size={13} />
    </a>
  );
}

function ReceiptRefTag({ refs, id, kind = 'payment' }: { refs: PaymentRefs; id: number; kind?: 'payment' | 'deposit' }) {
  // A register-booked deposit is numbered against security_deposits.id, a payment
  // against payments.id — two separate id spaces, never interchangeable.
  const ref = kind === 'deposit' ? refs.receiptByDepositId[id] : refs.receiptByPaymentId[id];
  if (!ref) return null;
  const isVoid = kind === 'deposit' ? refs.voidedDepositIds.has(id) : refs.voidedPaymentIds.has(id);
  return (
    <span className="note"
      title={isVoid ? 'Receipt voided — cheque reverted to a non-cleared status; number retained for the gapless series' : 'Issued receipt number — for bank reconciliation'}
      style={{ display: 'block', fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace', color: isVoid ? '#b3261e' : '#1a5a4a', marginTop: 2, textDecoration: isVoid ? 'line-through' : 'none' }}>
      Receipt {ref}{isVoid ? ' · VOID' : ''}
    </span>
  );
}

/** Every payment type the "New payment" popup can write. Which of these are
 *  actually offered is decided by the segment that opened it (see `recTypes`) —
 *  the Rental Income rail offers rental income only. */
const REC_TYPE_OPTIONS: { value: string; label: string }[] = [
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

function DetailsDrawer({
  open, tab, setTab, onClose, inline, contract, payments, kycDocs, onApproveDoc, onRejectDoc,
  // onDeletePayment is intentionally not destructured — fee rows are corrected
  // via Edit / Status, never deleted, so the drawer no longer offers Delete.
  onRecordPayment, onUpdatePayment, onUpdateDeposit, onCreateDeposit, onSaveClauses, onConfirmPdc, onUploadDoc, onRequestDoc,
  notes, onAddNote, perms, onDocsChanged, paymentRefs = EMPTY_PAYMENT_REFS, showExtras = true, editLocked = false,
}: {
  /** Refetch after a document is removed — the list must come from the server. */
  onDocsChanged: () => void;
  open: boolean; tab: DrawerTab; setTab: (t: DrawerTab) => void; onClose: () => void;
  /** Inline mode (CEO doctrine): render ALL sections stacked in the page flow —
   *  no slide-in drawer, no tabs, nothing hidden behind a click. The property
   *  section is skipped (the header chain links to property/unit details
   *  instead of duplicating them) and clauses stay hidden (addendums are the
   *  mechanism). */
  inline?: boolean;
  /** When false, the Clauses & Notes sections are hidden — used by the read-only
   *  Leases "record" view (Summary + Payments + Documents only). Defaults to true
   *  (the Operations full view keeps them). */
  showExtras?: boolean;
  /** True once the contract is signed by any party (non-on_file signature) →
   *  the Clauses & Notes editor is read-only, matching the backend lock. */
  editLocked?: boolean;
  contract: ContractDetail; payments: ContractPayment[]; kycDocs: ContractDoc[];
  onApproveDoc: (id: number) => void; onRejectDoc: (id: number, label?: string) => void;
  /** POST /api/contracts/:id/payments — record a new instalment / payment / fee. */
  onRecordPayment: (body: {
    description?: string; amount: number; vatAmount?: number; paymentType?: string; paymentMethod?: string;
    chequeNumber?: string; transactionDate?: string; chequeStatus?: string;
    /** The cheque on this contract that this payment makes good — one that
     *  bounced, or one the customer swapped (cancelled, reason 'replaced'). */
    replacesPaymentId?: number | null;
    /** Raise the bounce / replacement charge in the same action, linked to the
     *  same cheque. Omitted or 0 raises nothing. */
    replacementFee?: number;
  }) => Promise<void>;
  /** PATCH /api/contracts/:id/payments/:paymentId — edit status / amount / VAT / reference / description. */
  onUpdatePayment: (paymentId: number, patch: {
    chequeStatus?: string; amount?: number; vatAmount?: number; chequeNumber?: string | null;
    description?: string | null; transactionDate?: string | null; paymentMethod?: string; paymentType?: string;
    documentId?: number | null; replacesPaymentId?: number | null;
    /** Why a cheque is being cancelled — required when moving it into
     *  `cancelled` (migration 0245). */
    cancellationReason?: string | null;
  }) => Promise<void>;
  /** DELETE /api/contracts/:id/payments/:paymentId — remove a fee / payment line. */
  onDeletePayment: (paymentId: number) => Promise<void>;
  /** PATCH /api/contracts/:id/deposits/:depositId — edit a held security deposit. */
  onUpdateDeposit: (depositId: number, patch: {
    chequeStatus?: string; paymentMethod?: string | null; dueDate?: string | null;
    chequeNumber?: string | null; amount?: number; depositStatus?: string;
  }) => Promise<void>;
  /** POST /api/contracts/:id/deposits — record the deposit on a lease that has none. */
  onCreateDeposit: (body: {
    amount: number; chequeNumber?: string | null; paymentMethod?: string | null;
    dueDate?: string | null; chequeStatus?: string;
  }) => Promise<void>;
  /** PATCH /api/contracts/:id/clauses — save edited custom clauses + notes. */
  onSaveClauses: (customClauses: string[], notes: string | null) => Promise<void>;
  /** PATCH /api/contracts/:id/confirm-pdc — confirm post-dated cheques received. */
  onConfirmPdc: () => Promise<void>;
  /** upload-url → PUT → POST /api/documents — attach a contract document. */
  /** `replaceOf` = the stored row to overwrite in place (binder "Replace");
   *  omitted → a fresh timestamped row is added beside whatever is on file. */
  onUploadDoc: (file: File, meta: { key: string; label: string; category: string; section: DocSection }, visibleToTenant: boolean, expiryDate: string, replaceOf?: DocReplaceTarget) => Promise<void>;
  /** POST /api/documents/request — request a document from the tenant. */
  onRequestDoc: (label: string, notes: string) => Promise<void>;
  /** Running tenancy notes log (newest first). */
  notes: ContractNote[];
  /** POST /api/contracts/:id/notes — append a note to the tenancy log. */
  onAddNote: (body: string) => Promise<void>;
  /** Manager-permission gates for the editing affordances in this drawer
   *  (fees/payments/PDC → collections, deposit → deposits, notes → agreements).
   *  RP owners get `true` for every field. */
  perms: ActorPerms;
  /** RP reconciliation refs — plan number + per-payment receipt numbers. */
  paymentRefs?: PaymentRefs;
}) {
  // No `depositRow` any more: a deposit is never a payment row (migration 0191),
  // so there is exactly one place to read it from — contract.securityDeposit, the
  // register record — and exactly one section that renders it.
  // Receipt links must respect the portal (RP vs manager) — derive the base
  // the same way the page does, so manager links don't 404.
  const drawerPathname = usePathname();
  const contractBase = (drawerPathname?.startsWith('/dashboard/manager')
    ? '/dashboard/manager/contracts'
    : '/rental-provider/dashboard/contracts') + `/${contract.id}`;
  const receiptBase = `${contractBase}/print/receipt`;
  // ── Record-payment form state (Flow 1) ──
  const [showRec, setShowRec] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [rec, setRec] = useState({
    description: '', amount: '', paymentType: 'rental_income',
    paymentMethod: 'cheque', chequeNumber: '', transactionDate: '',
    // '' = an ordinary cheque; an id = this one makes good that bounced cheque.
    replacesPaymentId: '' as number | '',
    /** The bounce / replacement charge to raise alongside a linked replacement.
     *  Prefilled from the RP's rule when the link is chosen; '' raises nothing. */
    replacementFee: '',
  });
  // Which payment types this popup may offer. The popup is opened from a SEGMENT
  // rail ("Add" on Rental Income), so it only ever writes into that segment —
  // offering the other types let a rent cheque be filed as a fee and land in the
  // wrong section. Set by openRecordFor(); management / third-party fees have
  // their own VAT-aware fee popup.
  const [recTypes, setRecTypes] = useState<string[]>(['rental_income']);
  const [statusBusy, setStatusBusy] = useState<number | null>(null);
  // ── Inline cheque editor — correct amount / reference / description on existing rows ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    amount: '', chequeNumber: '', description: '', paymentMethod: 'cheque', transactionDate: '',
    // '' = an ordinary cheque; an id = this row pays off that bounced cheque.
    replacesPaymentId: '' as number | '',
  });
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  // ── Attribute an existing payment to the bounce it pays off ──
  // Separate from the cheque editor on purpose: the payments that settle a
  // bounce are usually already CLEARED, and a cleared row has no Edit button —
  // its amount/reference are locked because a receipt was minted against them.
  // Linking changes none of that, so it gets its own affordance rather than
  // unlocking the money fields on a receipted row.
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkValue, setLinkValue] = useState<number | ''>('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const startLink = (p: ContractPayment) => {
    setLinkingId(p.id); setLinkErr(null); setLinkValue(p.replacesPaymentId ?? '');
  };
  const saveLink = async (paymentId: number) => {
    setLinkBusy(true); setLinkErr(null);
    try {
      await onUpdatePayment(paymentId, { replacesPaymentId: linkValue === '' ? null : linkValue });
      setLinkingId(null);
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : 'Could not link this payment');
    } finally {
      setLinkBusy(false);
    }
  };
  const startEdit = (p: ContractPayment) => {
    setEditingId(p.id); setEditErr(null);
    setEditForm({
      amount: p.amount != null ? String(p.amount) : '',
      chequeNumber: p.chequeNumber ?? '',
      description: p.description ?? '',
      paymentMethod: p.paymentMethod ?? 'cheque',
      transactionDate: p.transactionDate ? p.transactionDate.slice(0, 10) : '',
      replacesPaymentId: p.replacesPaymentId ?? '',
    });
  };
  const saveEdit = async (paymentId: number) => {
    const amt = Number(editForm.amount);
    if (editForm.amount.trim() === '' || !Number.isFinite(amt) || amt < 0) { setEditErr('Enter a valid amount'); return; }
    setEditBusy(true); setEditErr(null);
    try {
      await onUpdatePayment(paymentId, {
        amount: amt,
        chequeNumber: editForm.chequeNumber.trim() || null,
        description: editForm.description.trim() || null,
        paymentMethod: editForm.paymentMethod,
        transactionDate: editForm.transactionDate || null,
        // null unlinks — the corrective path when a row was attributed to the
        // wrong bounce (the bounce goes straight back to being owed).
        replacesPaymentId: editForm.replacesPaymentId === '' ? null : editForm.replacesPaymentId,
      });
      setEditingId(null);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setEditBusy(false);
    }
  };
  const submitRec = async () => {
    const amt = Number(rec.amount);
    if (!amt || amt <= 0) { setRecErr('Enter a valid amount'); return; }
    setRecBusy(true); setRecErr(null);
    try {
      await onRecordPayment({
        description: rec.description.trim() || undefined,
        amount: amt,
        paymentType: rec.paymentType,
        paymentMethod: rec.paymentMethod,
        chequeNumber: rec.chequeNumber.trim() || undefined,
        transactionDate: rec.transactionDate || undefined,
        replacesPaymentId: rec.replacesPaymentId === '' ? undefined : rec.replacesPaymentId,
        // Only meaningful on a linked replacement; the API ignores it otherwise.
        replacementFee: rec.replacesPaymentId === '' || !Number(rec.replacementFee)
          ? undefined : Number(rec.replacementFee),
      });
      setRec({ description: '', amount: '', paymentType: 'rental_income', paymentMethod: 'cheque', chequeNumber: '', transactionDate: '', replacesPaymentId: '', replacementFee: '' });
      setShowRec(false);
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setRecBusy(false);
    }
  };
  const changeStatus = async (paymentId: number, status: string, cancellationReason?: string) => {
    setStatusBusy(paymentId);
    try {
      await onUpdatePayment(paymentId, {
        chequeStatus: status,
        ...(status === 'cancelled' ? { cancellationReason } : {}),
      });
    }
    finally { setStatusBusy(null); }
  };
  // Cancelling asks WHY before it is applied (migration 0245). "Cancelled" had
  // come to mean three unrelated things — the customer swapped the cheque, the
  // paper went back, or the lease itself was cancelled — and only the first
  // leaves money collected on another row. Asking at the moment somebody knows
  // the answer is the only point at which it is cheap to record; a month later
  // nobody remembers, which is how the existing rows ended up needing a
  // migration to work it out from the notes people typed.
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState<CancelReason>('replaced');
  const [cancelBusy, setCancelBusy] = useState(false);
  const startCancel = (p: ContractPayment) => {
    setCancelId(p.id);
    setCancelReason((p.cancellationReason as CancelReason) ?? 'replaced');
  };
  const confirmCancel = async () => {
    if (cancelId == null) return;
    setCancelBusy(true);
    try { await changeStatus(cancelId, 'cancelled', cancelReason); setCancelId(null); }
    finally { setCancelBusy(false); }
  };
  // ── Deposit editor — only the home/oldest lease that OWNS the record; renewals carry it read-only ──
  const [depEditing, setDepEditing] = useState(false);
  const [depBusy, setDepBusy] = useState(false);
  const [depStatusBusy, setDepStatusBusy] = useState(false);
  const [depErr, setDepErr] = useState<string | null>(null);
  const [depForm, setDepForm] = useState({ amount: '', chequeNumber: '', paymentMethod: 'cheque', dueDate: '', chequeStatus: 'pending' });
  const startDepEdit = () => {
    const sd = contract.securityDeposit;
    if (!sd) return;
    setDepEditing(true); setDepErr(null);
    setDepForm({
      amount: sd.amount != null ? String(sd.amount) : '',
      chequeNumber: sd.chequeNumber ?? '',
      paymentMethod: sd.paymentMethod ?? 'cheque',
      dueDate: sd.dueDate ?? '',
      chequeStatus: sd.chequeStatus ?? 'pending',
    });
  };
  const saveDep = async (depositId: number) => {
    const amt = Number(depForm.amount);
    if (depForm.amount.trim() === '' || !Number.isFinite(amt) || amt < 0) { setDepErr('Enter a valid amount'); return; }
    setDepBusy(true); setDepErr(null);
    try {
      await onUpdateDeposit(depositId, {
        amount: amt,
        chequeNumber: depForm.chequeNumber.trim() || null,
        paymentMethod: depForm.paymentMethod || null,
        dueDate: depForm.dueDate || null,
        chequeStatus: depForm.chequeStatus,
      });
      setDepEditing(false);
    } catch (e) {
      setDepErr(e instanceof Error ? e.message : 'Failed to save deposit');
    } finally { setDepBusy(false); }
  };
  // ── Add a deposit — for a lease that has none on record ──
  //
  // The same form as the editor, opened from the section's Add button. Worth its
  // own state rather than reusing depEditing: "correct what we hold" and "record
  // a deposit we never captured" are different actions and the empty section has
  // to say which one it is offering.
  const [depAdding, setDepAdding] = useState(false);
  const startDepAdd = () => {
    setDepAdding(true); setDepErr(null);
    setDepForm({
      // Pre-fill the agreed figure when the contract carries one — the usual case
      // is that the deposit was agreed on the lease and simply never recorded.
      amount: contract.securityDepositAmount ? String(contract.securityDepositAmount) : '',
      chequeNumber: '', paymentMethod: 'cheque', dueDate: '', chequeStatus: 'pending',
    });
  };
  const saveNewDep = async () => {
    const amt = Number(depForm.amount);
    if (depForm.amount.trim() === '' || !Number.isFinite(amt) || amt <= 0) { setDepErr('Enter the deposit amount'); return; }
    setDepBusy(true); setDepErr(null);
    try {
      await onCreateDeposit({
        amount: amt,
        chequeNumber: depForm.chequeNumber.trim() || null,
        paymentMethod: depForm.paymentMethod || null,
        dueDate: depForm.dueDate || null,
        chequeStatus: depForm.chequeStatus,
      });
      setDepAdding(false);
    } catch (e) {
      setDepErr(e instanceof Error ? e.message : 'Failed to record the deposit');
    } finally { setDepBusy(false); }
  };
  // Surfaced when an inline status change (cheque or settlement) fails — otherwise
  // onUpdateDeposit rejects, reload() never runs, and the <select> silently snaps back.
  const [depStatusErr, setDepStatusErr] = useState<string | null>(null);
  const changeDepStatus = async (depositId: number, status: string) => {
    setDepStatusBusy(true); setDepStatusErr(null);
    try { await onUpdateDeposit(depositId, { chequeStatus: status }); }
    catch { setDepStatusErr('Could not update the cheque status. Please try again.'); }
    finally { setDepStatusBusy(false); }
  };
  // ── Clause editor state (Flow 2) — editable only while the contract is a draft
  //    AND not yet signed by any party (editLocked mirrors the backend guard on
  //    PATCH /contracts/:id/clauses; on-file/imported leases stay editable). ──
  const clausesEditable = contract.status === 'pending' && !editLocked;
  const [clauseList, setClauseList] = useState<string[]>(contract.customClauses ?? []);
  const [clauseNotes, setClauseNotes] = useState(contract.notes ?? '');
  const [clauseInput, setClauseInput] = useState('');
  const [clauseBusy, setClauseBusy] = useState(false);
  const [clauseSaved, setClauseSaved] = useState(false);
  const [clauseErr, setClauseErr] = useState<string | null>(null);
  // Keep the local editor in sync when the contract reloads.
  useEffect(() => {
    setClauseList(contract.customClauses ?? []);
    setClauseNotes(contract.notes ?? '');
  }, [contract.customClauses, contract.notes]);

  // ── Agreement Addendum ── attach the unit's layout addendum onto an existing
  //    contract. Unlike the draft-only file upload, this works on issued/active
  //    leases (snapshots the plan's current Agreement Addendum onto the lease).
  const [addendums, setAddendums] = useState<{ id: number; name: string | null }[]>([]);
  const [addendumRefresh, setAddendumRefresh] = useState(0);
  const [addendumBusy, setAddendumBusy] = useState(false);
  const [addendumErr, setAddendumErr] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    fetch(`/api/contracts/${contract.id}/addendums`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((a) => { if (ok) setAddendums(Array.isArray(a) ? a : []); })
      .catch(() => { if (ok) setAddendums([]); });
    return () => { ok = false; };
  }, [contract.id, addendumRefresh]);
  const addendumEnded = contract.status === 'terminated' || contract.status === 'expired';
  const onAttachLayoutAddendum = async () => {
    setAddendumBusy(true); setAddendumErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/addendums/from-layout`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(b?.message || `Error ${res.status}`);
      }
      setAddendumRefresh(n => n + 1);
    } catch (e) {
      setAddendumErr(e instanceof Error ? e.message : 'Failed to attach addendum');
    } finally { setAddendumBusy(false); }
  };

  const addClause = () => {
    const t = clauseInput.trim();
    if (t) { setClauseList(prev => [...prev, t]); setClauseInput(''); }
  };
  const saveClauses = async () => {
    setClauseBusy(true); setClauseErr(null); setClauseSaved(false);
    try {
      await onSaveClauses(clauseList, clauseNotes || null);
      setClauseSaved(true);
      setTimeout(() => setClauseSaved(false), 2500);
    } catch (e) {
      setClauseErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setClauseBusy(false);
    }
  };
  // ── Tenancy notes log (running hand-off journal) ──
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const submitNote = async () => {
    const t = noteDraft.trim();
    if (!t) return;
    setNoteBusy(true); setNoteErr(null);
    try {
      await onAddNote(t);
      setNoteDraft('');
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setNoteBusy(false);
    }
  };
  const rentRows = payments
    .filter(p => p.paymentType !== 'security_deposit')
    .slice()
    .sort((a, b) => (a.transactionDate ?? '').localeCompare(b.transactionDate ?? ''));
  // One-off leasing fees (admin / ejari / commission) — their own line items,
  // kept out of the rent schedule and rent totals.
  const feeRows = contract.fees ?? [];
  const feeGross = feeRows.reduce((s, p) => s + (p.amount || 0), 0);
  // Custom "Other" charges are stored as payments (payment_type 'other') — per-unit
  // taxes, service fees like "Fire Fighting". They are NOT rent, so pull them out of
  // the rent schedule + rent totals and show them under Fees (smallest → largest,
  // matching the receipt / payment-plan order). `rentRows` itself is left intact so
  // the live payment-plan (currentPlanItems below) still sees every row.
  const otherPaymentRows = rentRows
    .filter(p => (p.paymentType ?? '') === 'other')
    .slice()
    .sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
  // "Fees VAT" — the combined VAT cheque on admin/commission fees — is a
  // pass-through tax: it belongs under Third Party with the registration fee,
  // never inside the rent schedule (only rent + Rental VAT live there).
  const feesVatPaymentRows = rentRows.filter(p => isFeesVat(p));
  const rentScheduleRows = rentRows.filter(p => (p.paymentType ?? '') !== 'other' && !isFeesVat(p));
  // Same rows, re-ordered so every payment recorded against a bounced cheque sits
  // directly beneath it instead of at its own due date — see
  // chequeReplacementGroups.ts for why date order tells the story wrong.
  const rentScheduleGroups = groupReplacementsUnderBounce(rentScheduleRows);
  // Instalment numbering counts the schedule's own cheques. A replacement is part
  // of the bounce above it, not a further instalment, so it takes no number.
  const rentRowNumber = new Map<number, number>();
  for (const g of rentScheduleGroups) if (g.depth === 0) rentRowNumber.set(g.row.id, rentRowNumber.size + 1);
  /** Rows that head a group — the tint starts on the bounce, not on its first replacement. */
  const rentGroupHeadIds = new Set(rentScheduleGroups.map(g => g.parent?.id).filter((id): id is number => id != null));
  const rentReplacementCount = rentScheduleGroups.filter(g => g.depth > 0).length;
  const otherGross = otherPaymentRows.reduce((s, p) => s + (p.amount || 0), 0);
  // Fees split into the two segregation groups so the working table reads in the SAME
  // four sections as the plan/receipts: Admin + Commission → Management Fee; Ejari
  // (Contract Registration) + cheque-charge penalties → Third Party (with 'other' charges).
  // Management Fee = RP-charged fees: admin + commission + every Rules penalty/charge.
  // (Ejari / VAT / sub-lease / service charges stay Third Party — pass-through.)
  const managementFeeRows = feeRows.filter(f => MGMT_FEE_TYPES.has(f.paymentType ?? ''));
  const thirdPartyFeeRows = [
    ...feeRows.filter(f => !MGMT_FEE_TYPES.has(f.paymentType ?? '')),
    ...(feesVatPaymentRows as typeof feeRows),
  ];
  // Bounced / cancelled cheques are void — excluded from every section total and the
  // grand total, the same rule the header pass applies to the rent.
  const managementFeeTotal = managementFeeRows.reduce((s, f) => s + (feeActive(f) ? (f.amount || 0) : 0), 0);
  const otherActiveGross = otherPaymentRows.reduce((s, p) => s + (feeActive(p) ? (p.amount || 0) : 0), 0);
  const thirdPartyTotal = thirdPartyFeeRows.reduce((s, f) => s + (feeActive(f) ? (f.amount || 0) : 0), 0) + otherActiveGross;
  const feeLabel = (t: string | null) =>
    t === 'admin_fee' ? 'Admin fee' : t === 'ejari_fee' ? 'Contract Registration fee' : t === 'commission' ? 'Commission'
      : t === 'other' ? 'Other'
      : (t && RULE_FEE_LABELS[t]) ? RULE_FEE_LABELS[t]
      : (t ?? 'Fee');
  // ── Fees editor (admin-filled: admin / ejari / commission + cheque charges).
  //    Fees are never auto-fabricated — the RP enters them here. Amount is NET
  //    (excl. VAT); VAT is an optional separate figure; stored gross = net + VAT.
  //    The three cheque-charge types auto-fill their amount from Settings → Rules. ──
  // The whole RP Rules config (all penalty / admin-charge fields) so every rule type
  // can auto-fill its amount + show its basis in the Add-fee popup.
  const [rpRules, setRpRules] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { profile?: Record<string, unknown> } | null) => { if (alive) setRpRules(data?.profile ?? null); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const annualRentForRules = contract.annualRent || 0;
  /** Suggested amount + a short basis label for a Rules fee type, from the RP config +
   *  this contract's rent: N months → months x monthly rent; daily → 0 (set at
   *  settlement); else the greater of the flat fee and % of annual rent. */
  const ruleSuggest = (pt: string): { amount: number; basis: string } => {
    const def = RULE_FEE_DEFS.find(d => d.pt === pt);
    if (!def || !rpRules) return { amount: 0, basis: '' };
    const num = (k?: string) => (k && rpRules[k] != null && rpRules[k] !== '' ? Number(rpRules[k]) : 0);
    const fee = num(def.feeK), pct = num(def.pctK), months = num(def.monthsK);
    const daily = def.dailyK ? !!rpRules[def.dailyK] : false;
    const aed = (n: number) => `AED ${Math.round(n).toLocaleString('en-AE')}`;
    if (months > 0) return { amount: Math.round(months * annualRentForRules / 12), basis: `${months} mo of rent` };
    if (daily) return { amount: 0, basis: 'per day of overstay' };
    const pctAmt = pct > 0 ? Math.round(pct / 100 * annualRentForRules) : 0;
    if (fee > 0 && fee >= pctAmt) return { amount: fee, basis: aed(fee) };
    if (pctAmt > 0) return { amount: pctAmt, basis: `${pct}% of rent` };
    return { amount: 0, basis: 'not set' };
  };
  const FEE_TYPE_OPTIONS = [
    { value: 'admin_fee', label: 'Admin fee' },
    { value: 'ejari_fee', label: 'Contract Registration fee' },
    { value: 'commission', label: 'Commission' },
    ...RULE_FEE_DEFS.map(d => ({ value: d.pt, label: d.label })),
    // Catch-all pass-through charge (service fee, per-unit tax, etc.) — lands under
    // Third Party; the RP names it via the Description field.
    { value: 'other', label: 'Other' },
  ];
  /** Auto-filled amount (form string) for a fee type from Settings → Rules, or ''. */
  const feeAutoAmount = (t: string): string => {
    const a = ruleSuggest(t).amount;
    return a > 0 ? String(a) : '';
  };
  /** Dropdown label with the rule's basis + amount, e.g. "Early termination · 3 mo of rent (AED 25,000)". */
  const feeOptionLabel = (t: string, base: string): string => {
    const { amount, basis } = ruleSuggest(t);
    if (!basis) return base;
    return amount > 0 ? `${base} · ${basis}` : `${base} · ${basis}`;
  };
  const emptyFeeForm = { paymentType: 'admin_fee', amount: '', vatAmount: '', transactionDate: '', description: '', paymentMethod: 'cheque', chequeNumber: '' };
  const [showAddFee, setShowAddFee] = useState(false);
  const [feeAdd, setFeeAdd] = useState(emptyFeeForm);
  const [feeAddBusy, setFeeAddBusy] = useState(false);
  const [feeAddErr, setFeeAddErr] = useState<string | null>(null);
  const [feeEditId, setFeeEditId] = useState<number | null>(null);
  const [feeEdit, setFeeEdit] = useState(emptyFeeForm);
  const [feeEditBusy, setFeeEditBusy] = useState(false);
  const [feeEditErr, setFeeEditErr] = useState<string | null>(null);
  const submitAddFee = async () => {
    const net = Number(feeAdd.amount); const vat = Number(feeAdd.vatAmount || 0);
    if (!Number.isFinite(net) || net <= 0) { setFeeAddErr('Enter a valid amount'); return; }
    if (!Number.isFinite(vat) || vat < 0) { setFeeAddErr('Enter a valid VAT amount'); return; }
    setFeeAddBusy(true); setFeeAddErr(null);
    try {
      await onRecordPayment({
        paymentType: feeAdd.paymentType,
        amount: Math.round((net + vat) * 100) / 100,   // backend stores GROSS
        vatAmount: vat,
        description: feeAdd.description.trim() || feeLabel(feeAdd.paymentType),
        transactionDate: feeAdd.transactionDate || undefined,
        paymentMethod: feeAdd.paymentMethod,
        chequeNumber: feeAdd.chequeNumber.trim() || undefined,
        chequeStatus: 'pending',
      });
      setFeeAdd(emptyFeeForm); setShowAddFee(false);
    } catch (e) { setFeeAddErr(e instanceof Error ? e.message : 'Failed to add fee'); }
    finally { setFeeAddBusy(false); }
  };
  const startFeeEdit = (f: ContractPayment) => {
    setFeeEditId(f.id); setFeeEditErr(null);
    const vat = f.vatAmount ?? 0;
    setFeeEdit({
      paymentType: f.paymentType ?? 'admin_fee',
      amount: String(Math.max(Math.round(((f.amount ?? 0) - vat) * 100) / 100, 0)),  // NET
      vatAmount: vat ? String(vat) : '',
      transactionDate: f.transactionDate ? f.transactionDate.slice(0, 10) : '',
      description: f.description ?? '',
      paymentMethod: f.paymentMethod ?? 'cheque',
      chequeNumber: f.chequeNumber ?? '',
    });
  };
  const saveFeeEdit = async (paymentId: number) => {
    const net = Number(feeEdit.amount); const vat = Number(feeEdit.vatAmount || 0);
    if (!Number.isFinite(net) || net < 0) { setFeeEditErr('Enter a valid amount'); return; }
    if (!Number.isFinite(vat) || vat < 0) { setFeeEditErr('Enter a valid VAT amount'); return; }
    setFeeEditBusy(true); setFeeEditErr(null);
    try {
      await onUpdatePayment(paymentId, {
        amount: Math.round((net + vat) * 100) / 100,
        vatAmount: vat,
        description: feeEdit.description.trim() || null,
        transactionDate: feeEdit.transactionDate || null,
        paymentMethod: feeEdit.paymentMethod,
        chequeNumber: feeEdit.chequeNumber.trim() || null,
        paymentType: feeEdit.paymentType,
      });
      setFeeEditId(null);
    } catch (e) { setFeeEditErr(e instanceof Error ? e.message : 'Failed to save changes'); }
    finally { setFeeEditBusy(false); }
  };
  // Per-section "Add" → open the right popup pre-typed for that segment. Deposit + rent
  // use the payment popup; management + third-party fees use the fee popup (VAT-aware).
  const openRecordFor = (paymentType: string) => {
    setRec(v => ({ ...v, paymentType, amount: '', chequeNumber: '', description: '', transactionDate: '', replacesPaymentId: '', replacementFee: '' }));
    setRecTypes([paymentType]);
    setShowAddFee(false); setRecErr(null); setShowRec(true);
  };
  // "Record replacement" on a bounced row — the same popup, pre-filled and
  // pre-linked. Recording the new cheque this way is what settles the bounce:
  // the link is what stops the dashboards counting it, and it must cover the
  // full face value (a part-payment leaves the balance owed, so the API rejects
  // it and the bounce stays open).
  const openReplacementFor = (p: ContractPayment) => {
    const swapped = isSwapped(p);
    setRec({
      description: swapped
        ? `Replacement for cheque${p.chequeNumber ? ` No. ${p.chequeNumber}` : ''}`
        : `Payment against bounced cheque${p.chequeNumber ? ` No. ${p.chequeNumber}` : ''}`,
      // Pre-fill what is still SHORT, not the face value — on a bounce already
      // part-paid, the face value would over-collect.
      amount: String(shortfallOf(p)),
      paymentType: p.paymentType ?? 'rental_income',
      paymentMethod: p.paymentMethod ?? 'cheque',
      chequeNumber: '',
      transactionDate: '',
      replacesPaymentId: p.id,
      // A swapped cheque carries the replacement fee, a bounced one the bounce
      // fee — two different rules in Settings → Rules. Prefilled, and the
      // manager can change it or clear it before saving.
      replacementFee: feeAutoAmount(swapped ? 'cheque_replacement_fee' : 'bounced_cheque_fee'),
    });
    setRecTypes([p.paymentType ?? 'rental_income']);
    setShowAddFee(false); setRecErr(null); setShowRec(true);
  };
  // The cheque → replacement links, both directions, so each row can say which
  // payments settled it / which one it goes against. A cancelled replacement
  // doesn't count — that cheque was voided, so the original is owed again.
  //
  // A cheque may be settled by SEVERAL payments (10,000 + 7,500 against a 17,500
  // cheque), so it is the SUM that matters: it stays open for whatever is still
  // short. Mirrors cheque-replacement.ts on the backend, INCLUDING the rule that
  // a fee raised against a cheque is not money that covers it — the replacement
  // fee points at the same cheque so the ledger can say what it is for, and
  // counting it would mark the cheque paid on money that was never rent.
  const FEE_NOT_COVERAGE = new Set(['bounced_cheque_fee', 'cheque_replacement_fee', 'cheque_deferral_fee']);
  const replacementsOf = new Map<number, ContractPayment[]>();
  const chargesOf = new Map<number, ContractPayment[]>();
  const replacedRow = new Map<number, ContractPayment>();
  for (const r of payments) {
    if (r.replacesPaymentId == null) continue;
    const target = payments.find(t => t.id === r.replacesPaymentId);
    if (target) replacedRow.set(r.id, target);
    if (FEE_NOT_COVERAGE.has((r.paymentType ?? '').toLowerCase())) {
      chargesOf.set(r.replacesPaymentId, [...(chargesOf.get(r.replacesPaymentId) ?? []), r]);
      continue;
    }
    if ((r.chequeStatus ?? '').toLowerCase() === 'cancelled') continue;
    replacementsOf.set(r.replacesPaymentId, [...(replacementsOf.get(r.replacesPaymentId) ?? []), r]);
  }
  /** Money recorded against a cheque so far. */
  const coveredOf = (id: number) => (replacementsOf.get(id) ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  /** What is still owed on a cheque (0 = fully made good). */
  const shortfallOf = (p: ContractPayment) => Math.max(0, (p.amount || 0) - coveredOf(p.id));
  /** A cheque the customer SWAPPED rather than one that was simply voided — the
   *  only cancellation that may carry a replacement (migration 0245). */
  const isSwapped = (p: ContractPayment) =>
    (p.chequeStatus ?? '').toLowerCase() === 'cancelled'
    && (p.cancellationReason ?? '').toLowerCase() === 'replaced';
  /** Cheques that failed and are still short of being made good — a bounce, or a
   *  cheque marked as swapped whose replacement has not been recorded yet. */
  const unreplacedBounced = payments.filter(
    p => ((p.chequeStatus ?? '').toLowerCase() === 'bounced' || isSwapped(p)) && shortfallOf(p) > 1,
  );
  /**
   * The bounces an EXISTING row may be pointed at, and what each still needs.
   *
   * Computed with `rowId`'s own contribution taken out, so the row's current
   * target stays in the list (re-saving an edit must not silently unlink it) and
   * the amount shown is what would still be owed if this row moved elsewhere.
   * Two part-payments against one bounce is the normal case here: the first is
   * linked while the bounce is short by the full amount, the second while it is
   * short by the remainder.
   */
  const linkTargetsFor = (rowId: number) => {
    const me = payments.find(p => p.id === rowId);
    const myAmount = me?.amount || 0;
    const myDate = me?.transactionDate ? new Date(me.transactionDate.slice(0, 10)).getTime() : null;
    return payments
      // A bounce, or a cheque the customer swapped. The other two cancellation
      // reasons are genuine voids and the API refuses them, so they are never
      // offered here either.
      .filter(b => ((b.chequeStatus ?? '').toLowerCase() === 'bounced' || isSwapped(b)) && b.id !== rowId)
      .filter(b => !FEE_NOT_COVERAGE.has((b.paymentType ?? '').toLowerCase()))
      .map(b => {
        const mine = (replacementsOf.get(b.id) ?? []).find(r => r.id === rowId)?.amount ?? 0;
        return { row: b, owed: Math.max(0, (b.amount || 0) - (coveredOf(b.id) - mine)) };
      })
      // Same two guards the API enforces, so the list never offers a link that
      // would be rejected — or worse, one that looks plausible and is wrong:
      //  • money collected before the cheque bounced cannot be its replacement
      //    (an ordinary earlier instalment would otherwise settle it on paper
      //    while its money is already spoken for), 30 days of slack for a bank
      //    that returns a cheque early;
      //  • a payment larger than the shortfall belongs to something else too.
      .filter(o => {
        if (o.owed <= 1) return false;
        if (myAmount > o.owed + 1) return false;
        const failedDate = o.row.transactionDate ? new Date(o.row.transactionDate.slice(0, 10)).getTime() : null;
        if (myDate != null && failedDate != null && myDate < failedDate - 30 * 86_400_000) return false;
        return true;
      });
  };
  // What the charge on the record-payment popup is CALLED and what it prefills
  // to, both decided by the row the payment is being linked to: a cheque that
  // bounced carries the bounce fee, one the customer swapped carries the
  // replacement fee. Two rules, two lines on the customer's statement.
  const recChargeTarget = rec.replacesPaymentId === ''
    ? null : payments.find(b => b.id === rec.replacesPaymentId) ?? null;
  const recChargeIsSwap = recChargeTarget != null && isSwapped(recChargeTarget);
  const recChargeLabel = recChargeIsSwap ? 'Cheque replacement fee' : 'Bounced cheque fee';
  const recChargeAuto = feeAutoAmount(recChargeIsSwap ? 'cheque_replacement_fee' : 'bounced_cheque_fee');
  const openFeeFor = (paymentType: string) => {
    const auto = feeAutoAmount(paymentType);
    setFeeAdd({ ...emptyFeeForm, paymentType, ...(auto ? { amount: auto } : {}) });
    setShowRec(false); setFeeAddErr(null); setShowAddFee(true);
  };
  // A bounced or cancelled cheque is void (it never cleared / was replaced by a new
  // cheque), so it must NOT count toward the rent total — otherwise it double-counts
  // with its replacement. It still appears in the table above as history.
  const countsToTotal = (p: { chequeStatus?: string | null }) =>
    !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase());
  // Rent VAT (commercial/industrial): amounts are GROSS; split net vs VAT for display.
  const rentGross = rentScheduleRows.reduce((s, p) => s + (countsToTotal(p) ? (p.amount || 0) : 0), 0);
  const rentVat   = rentScheduleRows.reduce((s, p) => s + (countsToTotal(p) ? (p.vatAmount || 0) : 0), 0);
  const rentNet   = rentGross - rentVat;
  const showVat   = (contract.rentVatRate ?? 0) > 0 || rentVat > 0;
  // All four segments summed: rent + management + third party, plus the deposit ONLY
  // when it is this contract's own (a renewal carries it forward, never re-collected
  // → excluded here too).
  //
  // This is the LEDGER total — everything charged on the lease, penalties included —
  // so it exceeds the header pass's "Total payable" whenever the tenancy has incurred
  // one. That is deliberate: the pass states what the tenancy was AGREED at, this
  // states what it has been CHARGED. The pass prints the difference underneath
  // ("+ X charges incurred") so the gap reads as an answer rather than a discrepancy.
  // They used to be forced equal, which meant a bounced-cheque penalty silently
  // restated the agreed rent (contract 81: a 77,000 lease shown as 78,000).
  const grandDeposit = contract.contractType === 'renewal' ? 0 : (contract.securityDeposit?.amount ?? 0);
  const paymentsGrandTotal = grandDeposit + rentGross + managementFeeTotal + thirdPartyTotal;
  // What the tenancy was AGREED at, split back out of the grand total above. A
  // penalty is real money and belongs in the ledger, but rolling it into a single
  // figure meant a bounced cheque silently restated the rent: contract 81, a 77,000
  // lease, totalled 78,000 because of two 500 penalties. Showing both — agreed, plus
  // what the lease has since incurred — keeps the arithmetic honest AND keeps the
  // agreed figure legible, instead of making the reader choose which one is a lie.
  const incurredChargesTotal = feeRows.reduce(
    (s, f) => s + (feeActive(f) && INCURRED_FEE_TYPES.has(f.paymentType ?? '') ? (f.amount || 0) : 0), 0);
  const leaseAgreedTotal = paymentsGrandTotal - incurredChargesTotal;
  // ── Current payment plan (live) — what the customer is actually paying NOW,
  //    assembled from the contract's recorded rent cheques, fees, and deposit.
  //    Replaces the old origin-lead "offer" snapshot in the receipt modal.
  //    Contract money is whole AED; the modal expects fils, so ×100. ──
  const toFils = (aed: number) => Math.round((aed || 0) * 100);
  // Renewals carry the deposit from the original lease (read-only, never re-collected),
  // so it must not appear as a new line/instalment in the renewal's payment plan.
  const depositForPlan = contract.contractType === 'renewal'
    ? 0
    : (contract.securityDeposit?.amount
      ?? contract.securityDepositHeld ?? contract.securityDepositAmount ?? 0);
  let adminNet = 0, adminVat = 0, ejariNet = 0, ejariVat = 0, commNet = 0, commVat = 0;
  const customFees: { label: string; netFils: number; vatFils: number }[] = [];
  for (const f of feeRows) {
    const vat = f.vatAmount ?? 0;
    const net = (f.amount ?? 0) - vat;
    if (f.paymentType === 'admin_fee') { adminNet += net; adminVat += vat; }
    else if (f.paymentType === 'ejari_fee') { ejariNet += net; ejariVat += vat; }
    else if (f.paymentType === 'commission') { commNet += net; commVat += vat; }
    else customFees.push({ label: f.description || feeLabel(f.paymentType), netFils: toFils(net), vatFils: toFils(vat) });
  }
  const currentPlanItems: OfferPlan['items'] = [
    ...rentRows.map(p => ({
      amountFils: toFils(p.amount), vatFils: toFils(p.vatAmount ?? 0),
      dueDate: p.transactionDate ?? '', description: p.description ?? 'Rent',
      // Carry the real paymentType so the segregated PaymentPlanCard groups this
      // correctly (Rental Income) instead of falling through to Third Party.
      type: 'installment' as const, paymentType: p.paymentType ?? 'rental_income',
    })),
    ...feeRows.map(f => ({
      amountFils: toFils(f.amount), vatFils: toFils(f.vatAmount ?? 0),
      dueDate: f.transactionDate ?? '', description: f.description || feeLabel(f.paymentType),
      type: 'fee' as const, paymentType: f.paymentType ?? null,
    })),
    ...(depositForPlan > 0 ? [{
      amountFils: toFils(depositForPlan), vatFils: 0,
      dueDate: contract.securityDeposit?.dueDate ?? contract.securityDeposit?.recordedDate ?? '',
      description: 'Security deposit', type: 'security_deposit' as const, paymentType: 'security_deposit',
    }] : []),
  ].map((it, i) => ({ ...it, index: i + 1 }));
  // Headline rent = the contract's agreed current rent (annualRent is NET), so it
  // stays correct even before every cheque is recorded; the schedule below still
  // reflects the actual recorded cheques. VAT from the rate (commercial/industrial).
  const planRentNet = contract.annualRent || 0;
  const planRentVat = Math.round((planRentNet * (contract.rentVatRate ?? 0))) / 100;
  const currentPlan: OfferPlan = {
    totalAmountFils: toFils(planRentNet + planRentVat + feeGross + depositForPlan),
    rentFils: toFils(planRentNet),
    ...((contract.discountAmount ?? 0) > 0 && contract.listedRent != null
      ? { originalRentFils: toFils(contract.listedRent), discountFils: toFils(contract.discountAmount!) }
      : {}),
    installmentCount: rentRows.length || (contract.numberOfInstallments ?? 0),
    adminFeeFils: toFils(adminNet), adminFeeVatFils: toFils(adminVat),
    ejariFils: toFils(ejariNet), ejariVatFils: toFils(ejariVat),
    commissionFils: toFils(commNet), commissionVatFils: toFils(commVat),
    securityDepositFils: toFils(depositForPlan),
    rentVatRate: contract.rentVatRate ?? 0,
    rentVatFils: toFils(planRentVat),
    customFees,
    items: currentPlanItems,
  };
  // ── Upload document state (Flow 5) ──
  const docFileRef = useRef<HTMLInputElement>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upType, setUpType] = useState('');
  const [upVisible, setUpVisible] = useState(false);
  const [upExpiry, setUpExpiry] = useState('');
  const [upBusy, setUpBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  // What to CALL this particular file. The type says what kind of document it is
  // — one catalogue key, so every slot and checklist still matches — while the
  // name says which one: an NOC is a Vehicle NOC or a Property NOC, and the
  // reader needs to know which without opening it. Blank falls back to the
  // type's label, which is exactly what every upload did before.
  const [upName, setUpName] = useState('');
  // Document-type combobox. The list runs to ~60 entries, so it is searched
  // rather than scrolled; `upTypeQuery` doubles as the input's display value and
  // holds the chosen label whenever the menu is shut.
  const [upTypeQuery, setUpTypeQuery] = useState('');
  const [upTypeMenuOpen, setUpTypeMenuOpen] = useState(false);
  // The section the RP is filing under. Pre-selected from the picked type — the
  // catalogue knows a Passport is usually KYC — but theirs to change: only the
  // person holding the file knows whether THIS bank statement vets the customer
  // or evidences a payment on this lease. `upSectionTouched` keeps a deliberate
  // choice from being overwritten when they then switch document type.
  const [upSection, setUpSection] = useState<DocSection>('tenancy');
  const [upSectionTouched, setUpSectionTouched] = useState(false);
  // The stored document a binder "Replace" is superseding. Every upload used to
  // mint a fresh `${key}_${Date.now()}` row, so "Replace" on the Payment
  // Confirmation stacked a second (then third) file beside the one it was
  // meant to supersede — the slot flipped to "3 files · uploaded" and the
  // button to "Add". Carrying the row's own owner + key through to the POST
  // makes the backend's same-key upsert overwrite THAT row in place, keeping
  // its id (payments.document_id and audit rows point at it). Only honoured
  // while the picked type is still the slot the button was on — switching type
  // is a new document, not a replacement.
  const [upReplaceOf, setUpReplaceOf] = useState<{ slotKey: string; doc: ContractDoc } | null>(null);
  // Full mapped pack for the unit's category — KYC + commercial / industrial /
  // residential section (company promotions applied). Shown on new contracts;
  // renewals show only the re-verification slots (renewalDocs).
  const fullPackDocs = useMemo<DocReq[]>(
    // getRequiredDocs picks the identity pack by entity type — a company tenant
    // gets trade licence + authorised signatory, not personal KYC.
    () => getRequiredDocs(contract.unit.type, contract.tenant.entityType),
    [contract.unit.type, contract.tenant.entityType]);
  // Renewal-specific re-verification slots (empty for new contracts).
  const renewalDocs = useMemo<DocReq[]>(
    () => contract.contractType === 'renewal' ? getRenewalRequiredDocs(contract.unit.type) : [],
    [contract.contractType, contract.unit.type]);
  // Upload type picker = checklist types first (most relevant), then the
  // legacy generic types — so an upload lands on the exact checklist key. The
  // picker groups these by section, so "first" means first WITHIN its group.
  const DOC_TYPES = useMemo(() => {
    const fromChecklist: DocTypeOption[] = [];
    const seen = new Set<string>();
    for (const d of [...CONTRACT_DOCS, ...renewalDocs, ...fullPackDocs]) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      // A checklist key the catalogue doesn't carry (a renewal-only slot, say)
      // still gets a section — from its category, by the same rule.
      fromChecklist.push({
        value: d.key, label: d.label, category: d.category, needsExpiry: EXPIRY_DOC_KEYS.has(d.key),
        section: sectionForDocKey(d.key) ?? sectionForCategory(d.category),
      });
    }
    return [...fromChecklist, ...BASE_DOC_TYPES.filter(t => !seen.has(t.value))];
  }, [renewalDocs, fullPackDocs]);
  const uploadBoxRef = useRef<HTMLDivElement>(null);
  /** Checklist "Upload" / "Replace" → open the upload form with the slot's
   *  type preselected and pop the file picker. `replacing` = the stored row a
   *  binder "Replace" supersedes (see upReplaceOf); omitted for a plain upload. */
  const prefillUpload = (d: DocReq, replacing?: ContractDoc) => {
    setShowUpload(true);
    // Only preselect a type the picker actually knows — an unknown legacy key
    // would slip past submitUpload's lookup. Blank → the user picks the type.
    const known = DOC_TYPES.find(t => t.value === d.key);
    setUpType(known?.value ?? '');
    setUpTypeQuery(known?.label ?? '');
    setUpTypeMenuOpen(false);
    // A negative id is a cheque image synthesised from lead_cheques (contract
    // detail payload) — no documents row exists to overwrite, so it can only
    // be added beside. Only a real, type-known slot can be replaced in place.
    const target = replacing && replacing.id > 0 && known ? replacing : null;
    setUpReplaceOf(target ? { slotKey: known!.value, doc: target } : null);
    // Filing from a checklist row starts from that document's default section,
    // and the RP can still change it before saving. A replacement starts from
    // where the row is ALREADY filed — swapping the file is not a re-filing.
    const filedUnder = (target?.section === 'kyc' || target?.section === 'tenancy') ? target.section : null;
    setUpSection(filedUnder ?? known?.section ?? sectionForDocKey(d.key) ?? sectionForCategory(d.category));
    setUpSectionTouched(false);
    // Filling a named checklist slot — the slot's own wording is the right name.
    // A replacement keeps the name the row already carries (e.g. "Cheque 1")
    // unless it was just the slot label, which the type supplies anyway.
    setUpName(target?.displayName && normDocName(target.displayName) !== normDocName(d.label) ? target.displayName : '');
    // Same for visibility: the backend resets it on re-upload, so carry the
    // row's current setting into the form instead of silently going internal.
    setUpVisible(!!target?.isVisibleToTenant);
    setUpExpiry('');
    setUpErr(null);
    requestAnimationFrame(() => {
      uploadBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      docFileRef.current?.click();
    });
  };
  const upSelected = DOC_TYPES.find(t => t.value === upType);
  const upShowExpiry = upSelected?.needsExpiry ?? false;
  /** The row this submit will overwrite — null once the type is changed away
   *  from the slot the Replace button was on (same rule submitUpload applies). */
  const upReplacing = upReplaceOf && upReplaceOf.slotKey === upType ? upReplaceOf.doc : null;
  // Types matching what has been typed. An empty query lists everything, so
  // opening the box still works as a plain browse.
  const upTypeMatches = useMemo(() => {
    const q = upTypeQuery.trim().toLowerCase();
    // The chosen label sits in the box; treat that as "no filter" so re-opening
    // shows the whole list rather than the one entry already selected.
    if (!q || q === DOC_TYPES.find(t => t.value === upType)?.label.toLowerCase()) return DOC_TYPES;
    return DOC_TYPES.filter(t => t.label.toLowerCase().includes(q));
  }, [upTypeQuery, upType, DOC_TYPES]);
  const pickUpType = (value: string) => {
    setUpType(value); setUpExpiry('');
    const t = DOC_TYPES.find(x => x.value === value);
    setUpTypeQuery(t?.label ?? '');
    if (t && !upSectionTouched) setUpSection(t.section);
  };
  const submitUpload = async () => {
    if (!upFile || !upType) return;
    const meta = DOC_TYPES.find(t => t.value === upType)!;
    const replacing = upReplacing;
    setUpBusy(true); setUpErr(null);
    try {
      await onUploadDoc(
        upFile,
        { key: meta.value, label: upName.trim() || meta.label, category: meta.category, section: upSection },
        upVisible, upExpiry,
        replacing ? { ownerType: replacing.ownerType, ownerId: replacing.ownerId, documentKey: replacing.documentKey } : undefined,
      );
      setShowUpload(false); setUpFile(null); setUpType(''); setUpTypeQuery(''); setUpVisible(false); setUpExpiry('');
      setUpSection('tenancy'); setUpSectionTouched(false); setUpName(''); setUpReplaceOf(null);
      if (docFileRef.current) docFileRef.current.value = '';
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUpBusy(false);
    }
  };
  // ── Request document state (Flow 6) ──
  const [reqLabel, setReqLabel] = useState('');
  const [reqNotes, setReqNotes] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqMenuOpen, setReqMenuOpen] = useState(false);
  const [showReqModal, setShowReqModal] = useState(false);
  /** Documents picked in the request popup (multi-select). */
  const [reqSelected, setReqSelected] = useState<string[]>([]);
  /** How many requests the last send recorded (drives the success note). */
  const [reqSent, setReqSent] = useState(0);
  const reqInputRef = useRef<HTMLInputElement>(null);
  /** Cross-lease document history popup (shared CustomerDocsModal). */
  const [showDocsHistory, setShowDocsHistory] = useState(false);
  /** "View all" popup — same modal, scoped to THIS contract's documents. */
  const [showContractDocs, setShowContractDocs] = useState(false);
  const [showOffer, setShowOffer] = useState(false);
  const addReqDoc = (name: string) => {
    const n = name.trim();
    if (!n) return;
    setReqSelected(prev => prev.some(x => x.toLowerCase() === n.toLowerCase()) ? prev : [...prev, n]);
    setReqLabel('');
    setReqMenuOpen(false);
  };
  const removeReqDoc = (name: string) =>
    setReqSelected(prev => prev.filter(x => x !== name));
  /** Checklist "Request" → open the request popup with that doc selected. */
  const prefillRequest = (d: DocReq) => {
    setReqSelected([d.label]);
    setReqLabel('');
    setReqNotes(d.hint ?? '');
    setReqMenuOpen(false);
    setReqErr(null);
    setReqSent(0);
    setShowReqModal(true);
  };
  const openBlankRequest = () => {
    setReqSelected([]); setReqLabel(''); setReqNotes(''); setReqErr(null); setReqMenuOpen(false); setReqSent(0);
    setShowReqModal(true);
  };
  const submitRequest = async () => {
    // Anything still typed in the search box counts as a selection too.
    const typed = reqLabel.trim();
    const labels = [...reqSelected];
    if (typed && !labels.some(l => l.toLowerCase() === typed.toLowerCase())) labels.push(typed);
    if (!labels.length) return;
    setReqBusy(true); setReqErr(null);
    try {
      for (const label of labels) await onRequestDoc(label, reqNotes.trim());
      setReqSelected(labels);
      setReqLabel('');
      setReqSent(labels.length);
    } catch (e) {
      setReqErr(e instanceof Error ? e.message : 'Failed to send request');
    } finally {
      setReqBusy(false);
    }
  };
  return (
    <>
      {/* Backdrop only exists in drawer mode — in inline mode it would cover
          the whole page and swallow every click. */}
      {!inline && <div className={'scrim ' + (open ? 'open' : '')} onClick={onClose} />}
      <div className={inline ? 'sections-inline' : 'drawer ' + (open ? 'open' : '')}>
        {!inline && (
          <div className="dh">
            <span className="t">Contract details</span>
            <button className="x" onClick={onClose}><X size={18} /></button>
          </div>
        )}
        {!inline && (
          <div className="dtabs">
            {DRAWER_TABS.map(({ key, label, icon: Ic }) => (
              <button key={key} className={'dtab ' + (tab === key ? 'on' : '')} onClick={() => setTab(key)}>
                <Ic size={13} /> {label}
              </button>
            ))}
          </div>
        )}
        <div className={inline ? 'dbody-inline' : 'dbody'}>
          {/* Parties section removed (CEO: customer name + phone live in the
              page header; landlord details live on the settings page). */}
          {!inline && tab === 'property' && (
            <div className="sec">
              <div className="sech"><span className="si"><Building2 size={16} /></span><span className="st">Property &amp; unit</span></div>
              <div className="secb">
                <DRow k="Building"  v={contract.property.buildingName} />
                <DRow k="Community" v={contract.property.community} />
                <DRow k="Emirate"   v={contract.property.emirate} />
                <DRow k="Unit"      v={contract.unit.number ? `Unit ${contract.unit.number}` : null} />
                <DRow k="Type"      v={contract.unit.type} />
                <DRow k="Floor"     v={contract.unit.floor} />
                <DRow k="Bedrooms"  v={contract.unit.bedrooms} />
                <DRow k="Bathrooms" v={contract.unit.bathrooms} />
              </div>
            </div>
          )}
          {/* Rental period moved to the page-top info bar (next to the customer). */}
          {(inline || tab === 'payments') && (
            <>
              {/* ── Security deposit — its OWN section, above the payments ledger ──
                  It used to be the first rail INSIDE the Payments table, which put
                  money the landlord is holding on behalf of the customer in the
                  same list as money the customer owes, and let a deposit be
                  recorded two different ways depending on which row the table
                  found first. A deposit is a liability held, not income: it has a
                  settlement, a proof, a held→returned lifecycle and it carries
                  across a renewal, none of which a rent cheque has. */}
              <span id="sec-deposit" />
              <ContractDepositSection
                deposit={contract.securityDeposit ?? null}
                agreedAmount={contract.securityDepositAmount ?? null}
                contractBase={contractBase}
                refs={paymentRefs}
                perms={perms}
                adding={depAdding}
                editing={depEditing}
                busy={depBusy}
                statusBusy={depStatusBusy}
                err={depErr}
                statusErr={depStatusErr}
                form={depForm}
                setForm={setDepForm}
                onStartAdd={startDepAdd}
                onStartEdit={startDepEdit}
                onCancel={() => { setDepAdding(false); setDepEditing(false); setDepErr(null); }}
                onSaveNew={saveNewDep}
                onSaveEdit={saveDep}
                onChangeStatus={changeDepStatus}
              />
              <span id="sec-payments" />
              <div className="sec">
                <div className="sech">
                  <span className="si"><CreditCard size={16} /></span>
                  <span className="st">Payments</span>
                </div>
                <div className="secb">
                  <table className="ptable" style={{ tableLayout: 'fixed' }}>
                    <PayCols />
                    <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Reference</th><th>Method</th><th>Due date</th><th>Status</th></tr></thead>
                    <tbody>
                      {/* Counted the way the rows now read: the instalments, then
                          the payments made against a bounce among them — "6
                          cheques" against a schedule numbered 1–4 invited the
                          reader to hunt for two missing instalments. */}
                      <PaySegRail title="Rental Income" extra={rentScheduleRows.length
                        ? `${rentRowNumber.size} cheque${rentRowNumber.size === 1 ? '' : 's'}`
                          + (rentReplacementCount ? ` · ${rentReplacementCount} replacement${rentReplacementCount === 1 ? '' : 's'}` : '')
                        : undefined} onAdd={perms.collections ? () => openRecordFor('rental_income') : undefined} />
                      {rentScheduleGroups.map(({ row: p, depth, parent }) => (
                        <Fragment key={p.id}>
                        {/* A bounce and the payments made against it are shown as
                            one tinted block — the replacements indented beneath
                            the cheque they settle, instead of scattered to their
                            own due dates. See chequeReplacementGroups.ts. */}
                        <tr className={depth > 0 ? 'replgrp replkid' : rentGroupHeadIds.has(p.id) ? 'replgrp' : undefined}>
                          <td>
                            {depth > 0
                              ? <span className="replarrow" title="Recorded against the bounced cheque above">↳</span>
                              : rentRowNumber.get(p.id)}
                          </td>
                          <td style={depth > 0 ? { paddingLeft: 8 + Math.min(depth, MAX_REPLACEMENT_DEPTH) * 16 } : undefined}>
                            {depth > 0 && <span className="repltag">Replacement</span>}
                            {p.description ?? '—'}
                            <ReceiptRefTag refs={paymentRefs} id={p.id} />
                            {/* Both ends of a bounce → replacement pair, so the
                                table itself says why a bounced cheque is no
                                longer being chased — and, when it is only part
                                paid, exactly how much is still short. */}
                            {(replacementsOf.get(p.id)?.length ?? 0) > 0 && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                {shortfallOf(p) > 1
                                  ? `Part-replaced — ${fmtAed(coveredOf(p.id))} of ${fmtAed(p.amount)} · ${fmtAed(shortfallOf(p))} still owed`
                                  : `Replaced by ${replacementsOf.get(p.id)!
                                      .map(r => (r.chequeNumber ? `cheque ${r.chequeNumber}` : `payment #${r.id}`))
                                      .join(' + ')}`}
                              </span>
                            )}
                            {/* The charge that came with the swap. It is linked
                                to this cheque so the ledger says what it was
                                for, and it is deliberately NOT counted as money
                                replacing the cheque — it is a fee, not rent. */}
                            {(chargesOf.get(p.id)?.length ?? 0) > 0 && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                Charge raised: {chargesOf.get(p.id)!.map(f => fmtAed(f.amount)).join(' + ')}
                              </span>
                            )}
                            {/* Why it was cancelled — the answer to "cancelled
                                against what?". A swapped cheque says so even
                                before its replacement has been recorded, so a
                                half-finished swap is visible rather than
                                looking like an ordinary void. */}
                            {(p.chequeStatus ?? '').toLowerCase() === 'cancelled' && p.cancellationReason && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                Cancelled — {CANCEL_REASON_WORD[p.cancellationReason] ?? p.cancellationReason}
                                {isSwapped(p) && (replacementsOf.get(p.id)?.length ?? 0) === 0
                                  ? ' · the payment that replaced it has not been recorded yet'
                                  : ''}
                              </span>
                            )}
                            {/* Spelled out only when the pair could NOT be shown
                                together — the bounce sits in another section, or
                                was filtered out of this table. Under its own
                                bounce the indent already says it. */}
                            {parent == null && replacedRow.get(p.id) && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                {FEE_NOT_COVERAGE.has((p.paymentType ?? '').toLowerCase()) ? 'Charged against' : 'Replaces'}
                                {' '}{isSwapped(replacedRow.get(p.id)!) ? 'swapped' : 'bounced'}{' '}
                                {replacedRow.get(p.id)!.chequeNumber
                                  ? `cheque ${replacedRow.get(p.id)!.chequeNumber}`
                                  : `payment #${replacedRow.get(p.id)!.id}`}
                              </span>
                            )}
                          </td>
                          <td className="amt">
                            {fmtAed(p.amount)}
                            {/* A VAT cheque is entirely VAT — the "incl. X VAT" note only applies to a gross rent cheque. */}
                            {p.paymentType !== 'vat' && (p.vatAmount ?? 0) > 0 && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>incl. {fmtAed(p.vatAmount ?? 0)} VAT</span>
                            )}
                          </td>
                          <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{p.chequeNumber ?? '—'}</td>
                          <td>{fmtMethod(p.paymentMethod)}</td>
                          <td>{fmtDate(p.transactionDate)}</td>
                          <td>
                            <div style={PAY_STATUS_CELL}>
                              {/* A bounce that has been made good still reads as
                                  a bounce — red, and named as one — because it
                                  is an event that happened: it carries a
                                  penalty and it belongs in the customer's
                                  payment history. Showing it as a green
                                  "Cleared" made it indistinguishable from a
                                  cheque that never failed. What it says instead
                                  is what became of it. Whether it is still OPEN
                                  WORK is a separate question, answered by
                                  cheque-replacement's coverage rule, not by
                                  this chip. The dropdown is withheld on those
                                  rows on purpose: flipping a settled bounce's
                                  status without first voiding its replacement
                                  would leave the rent counted twice. The stored
                                  status is unchanged underneath. */}
                              {chequeStatusDisplay(p).statusLocked ? (
                                <span className={'cstat ' + chequeStatusDisplay(p).tone}>
                                  {chequeStatusDisplay(p).label}
                                </span>
                              ) : perms.collections ? (
                                <select
                                  className={'cstat ' + (p.chequeStatus ?? 'pending')}
                                  style={{ cursor: 'pointer' }}
                                  value={p.chequeStatus ?? 'pending'}
                                  disabled={statusBusy === p.id}
                                  onChange={e => {
                                    // Cancelling is the one status that needs a
                                    // reason, so it opens the picker below
                                    // rather than applying straight away.
                                    if (e.target.value === 'cancelled') startCancel(p);
                                    else void changeStatus(p.id, e.target.value);
                                  }}
                                >
                                  <option value="pending">Pending</option>
                                  <option value="cleared">Cleared</option>
                                  <option value="bounced">Bounced</option>
                                  <option value="cancelled">Cancelled…</option>
                                </select>
                              ) : (
                                <span className={'cstat ' + (p.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>
                                  {p.chequeStatus ?? 'pending'}
                                </span>
                              )}
                              {/* Right beside the status that produced it: the
                                  moment a cheque clears it has a receipt, and
                                  the manager can send it without leaving the
                                  row. */}
                              <ReceiptDownload refs={paymentRefs} id={p.id} base={receiptBase} />
                              {perms.collections && p.chequeStatus !== 'cleared' && (
                                <button
                                  type="button"
                                  className="mini-btn view"
                                  title="Edit amount / reference / description"
                                  onClick={() => editingId === p.id ? setEditingId(null) : startEdit(p)}
                                >
                                  <Pencil size={12} /> Edit
                                </button>
                              )}
                              {/* The one action a bounced cheque actually needs.
                                  Recording the new cheque here links the pair, so
                                  the lease stops showing as in arrears. */}
                              {perms.collections && ((p.chequeStatus ?? '') === 'bounced' || isSwapped(p)) && shortfallOf(p) > 1 && (
                                <button
                                  type="button"
                                  className="mini-btn view"
                                  title="Record the money the customer handed over against this cheque"
                                  onClick={() => openReplacementFor(p)}
                                >
                                  <CreditCard size={12} /> {coveredOf(p.id) > 0 ? 'Record balance' : 'Record replacement'}
                                </button>
                              )}
                              {/* The other half of the job: a payment already on
                                  the ledger being attributed to the bounce it
                                  paid off. Offered on any non-bounced row while
                                  a bounce is short — including CLEARED rows,
                                  which is the common shape (the money landed and
                                  was banked before anyone connected it), and the
                                  only route for a bounce cleared in two
                                  instalments: link each payment in turn. */}
                              {perms.collections && (p.chequeStatus ?? '') !== 'bounced' && !isSwapped(p)
                                && (linkTargetsFor(p.id).length > 0 || p.replacesPaymentId != null) && (
                                <button
                                  type="button"
                                  className="mini-btn view"
                                  title={p.replacesPaymentId != null
                                    ? 'Change or remove which cheque this payment goes against'
                                    : 'Record that this payment goes against a bounced or swapped cheque'}
                                  onClick={() => linkingId === p.id ? setLinkingId(null) : startLink(p)}
                                >
                                  <Link2 size={12} /> {p.replacesPaymentId != null ? 'Linked' : 'Link to cheque'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {cancelId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                              <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                <p className="subhead">Why is this cheque being cancelled?</p>
                                <div className="field" style={{ margin: 0 }}>
                                  <select
                                    className="input"
                                    value={cancelReason}
                                    onChange={e => setCancelReason(e.target.value as CancelReason)}
                                  >
                                    {CANCEL_REASONS.map(r => (
                                      <option key={r.key} value={r.key}>{r.label}</option>
                                    ))}
                                  </select>
                                  <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                    {CANCEL_REASONS.find(r => r.key === cancelReason)?.hint}
                                  </span>
                                </div>
                                <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 8 }}>
                                  A cancelled cheque is left out of every total whichever reason you pick — this records what became of it.
                                </span>
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button className="btn btn-jade btn-sm" disabled={cancelBusy} onClick={() => void confirmCancel()}>
                                    <Check size={14} /> {cancelBusy ? 'Saving…' : 'Cancel this cheque'}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" disabled={cancelBusy} onClick={() => setCancelId(null)}>Keep it</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {linkingId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                              <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                <p className="subhead">Which cheque does this payment go against?</p>
                                <div className="field" style={{ margin: 0 }}>
                                  <select
                                    className="input"
                                    value={linkValue === '' ? '' : String(linkValue)}
                                    onChange={e => setLinkValue(e.target.value === '' ? '' : Number(e.target.value))}
                                  >
                                    <option value="">No — an ordinary cheque</option>
                                    {linkTargetsFor(p.id).map(({ row: b, owed }) => (
                                      <option key={b.id} value={b.id}>
                                        {b.chequeNumber ? `Cheque ${b.chequeNumber}` : `Payment #${b.id}`} · {fmtAed(owed)} still owed{(b.amount || 0) !== owed ? ` of ${fmtAed(b.amount)}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                    A cheque that bounced, or one the customer swapped. Several payments can go against one — link each as it arrives, and it stops being chased once they add up to it. Amounts, references and receipts are untouched.
                                  </span>
                                </div>
                                {linkErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{linkErr}</p>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button className="btn btn-jade btn-sm" disabled={linkBusy} onClick={() => void saveLink(p.id)}>
                                    <Check size={14} /> {linkBusy ? 'Saving…' : 'Save link'}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" disabled={linkBusy} onClick={() => { setLinkingId(null); setLinkErr(null); }}>Cancel</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {editingId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                              <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                <p className="subhead">Correct cheque details</p>
                                <div className="field"><label>Description</label>
                                  <input className="input" value={editForm.description} placeholder="e.g. Instalment 1"
                                    onChange={e => setEditForm(v => ({ ...v, description: e.target.value }))} />
                                </div>
                                <div className="grid2">
                                  <div className="field"><label>Amount (AED)</label>
                                    <input type="number" min="0" step="0.01" className="input" value={editForm.amount}
                                      onChange={e => setEditForm(v => ({ ...v, amount: e.target.value }))} />
                                  </div>
                                  <div className="field"><label>Due date</label>
                                    <input type="date" className="input" value={editForm.transactionDate}
                                      onChange={e => setEditForm(v => ({ ...v, transactionDate: e.target.value }))} />
                                  </div>
                                </div>
                                <div className="grid2">
                                  <div className="field"><label>Payment method</label>
                                    <select className="input" value={editForm.paymentMethod}
                                      onChange={e => setEditForm(v => ({ ...v, paymentMethod: e.target.value }))}>
                                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                  </div>
                                  <div className="field"><label>Cheque / reference no.</label>
                                    <input className="input" value={editForm.chequeNumber} placeholder="Cheque #, transfer ID…"
                                      onChange={e => setEditForm(v => ({ ...v, chequeNumber: e.target.value }))} />
                                  </div>
                                </div>
                                {/* Attribute a payment ALREADY on the ledger to the
                                    bounce it pays off. The record-payment popup can
                                    only link at the moment of entry, and that is not
                                    how this usually happens: the money arrives, whoever
                                    is on collections books it as an ordinary cheque, and
                                    the connection to the bounce is made afterwards —
                                    often twice, when a customer clears a bounce in two
                                    instalments. Without this field that attribution had
                                    no home in the UI at all. */}
                                {perms.collections && (linkTargetsFor(p.id).length > 0 || editForm.replacesPaymentId !== '') && (
                                  <div className="field" style={{ marginTop: 10 }}>
                                    <label>Goes against a bounced cheque</label>
                                    <select
                                      className="input"
                                      value={editForm.replacesPaymentId === '' ? '' : String(editForm.replacesPaymentId)}
                                      onChange={e => setEditForm(v => ({ ...v, replacesPaymentId: e.target.value === '' ? '' : Number(e.target.value) }))}
                                    >
                                      <option value="">No — an ordinary cheque</option>
                                      {linkTargetsFor(p.id).map(({ row: b, owed }) => (
                                        <option key={b.id} value={b.id}>
                                          {b.chequeNumber ? `Cheque ${b.chequeNumber}` : `Payment #${b.id}`} · {fmtAed(owed)} still owed{(b.amount || 0) !== owed ? ` of ${fmtAed(b.amount)}` : ''}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                      {editForm.replacesPaymentId === ''
                                        ? 'Link this payment to a bounced cheque so the bounce stops being chased once the amounts against it add up.'
                                        : 'Several payments may go against one bounce — link each as it arrives. Choosing “No” here unlinks this one, and the bounce goes straight back to being owed.'}
                                    </span>
                                  </div>
                                )}
                                {showVat && (
                                  <p className="note" style={{ marginTop: 2 }}>VAT ({contract.rentVatRate ?? 0}%) is recalculated from the corrected amount automatically.</p>
                                )}
                                {editErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{editErr}</p>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button className="btn btn-jade btn-sm" disabled={editBusy} onClick={() => void saveEdit(p.id)}>
                                    <Check size={14} /> {editBusy ? 'Saving…' : 'Save changes'}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(null); setEditErr(null); }}>Cancel</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      ))}
                      {rentScheduleRows.length === 0 && (
                        <tr><td colSpan={7}><span className="note">No payments recorded yet.</span></td></tr>
                      )}
                      {rentScheduleRows.length > 1 && (
                        <PaySegTotalRow
                          label={showVat ? 'Rental Income total (incl. VAT)' : 'Rental Income total'}
                          amount={rentGross}
                          sub={showVat ? [{ label: 'Net rent', amount: rentNet }, { label: `VAT${(contract.rentVatRate ?? 0) > 0 ? ` (${contract.rentVatRate}%)` : ''}`, amount: rentVat }] : undefined}
                        />
                      )}
                    </tbody>
                  </table>

                  {/* Fees — admin / ejari / commission as their own line items,
                      separate from the rent schedule above. Admin-filled: the RP
                      adds / edits / removes them here; nothing is auto-fabricated. */}
                  <div style={{ marginTop: 18 }}>
                    {perms.collections && (feeRows.length === 0 && otherPaymentRows.length === 0) && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 6 }}>
                        <button type="button" className="mini-btn view" title="Add a fee line" onClick={() => openFeeFor('admin_fee')}>
                          <Plus size={12} /> Add fee
                        </button>
                      </div>
                    )}
                    <table className="ptable" style={{ tableLayout: 'fixed' }}>
                      <PayCols />
                      <thead><tr><th>Fee</th><th>Description</th><th>Amount</th><th>Reference</th><th>Method</th><th>Due date</th><th>Status</th></tr></thead>
                      <tbody>
                        {[...managementFeeRows, ...thirdPartyFeeRows].map((f, i) => (
                          <Fragment key={f.id}>
                          {i === 0 && managementFeeRows.length > 0 && <PaySegRail title="Management Fee" onAdd={perms.collections ? () => openFeeFor('admin_fee') : undefined} />}
                          {i === managementFeeRows.length && thirdPartyFeeRows.length > 0 && <PaySegRail title="Third Party" onAdd={perms.collections ? () => openFeeFor('ejari_fee') : undefined} />}
                          <tr>
                            <td>
                              {feeLabel(f.paymentType)}
                              <ReceiptRefTag refs={paymentRefs} id={f.id} />
                            </td>
                            <td>{f.description ?? '—'}</td>
                            <td className="amt">
                              {fmtAed(f.amount)}
                              {f.vatAmount ? <span className="note" style={{ display: 'block', fontSize: 11 }}>incl. {fmtAed(f.vatAmount)} VAT</span> : null}
                            </td>
                            <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{f.chequeNumber ?? '—'}</td>
                            <td>{f.paymentMethod ? fmtMethod(f.paymentMethod) : '—'}</td>
                            <td>{fmtDate(f.transactionDate)}</td>
                            <td>
                              <div style={PAY_STATUS_CELL}>
                                {perms.collections ? (
                                  <select
                                    className={'cstat ' + (f.chequeStatus ?? 'pending')}
                                    style={{ cursor: 'pointer' }}
                                    value={f.chequeStatus ?? 'pending'}
                                    disabled={statusBusy === f.id}
                                    onChange={e => void changeStatus(f.id, e.target.value)}
                                  >
                                    <option value="pending">Pending</option>
                                    <option value="cleared">Cleared</option>
                                    <option value="bounced">Bounced</option>
                                    <option value="cancelled">Cancelled</option>
                                  </select>
                                ) : (
                                  <span className={'cstat ' + (f.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>
                                    {f.chequeStatus ?? 'pending'}
                                  </span>
                                )}
                                {/* The replacement fee's own receipt, on the row
                                    that raised it — the second of the two files a
                                    manager sends after a cheque fails. */}
                                <ReceiptDownload refs={paymentRefs} id={f.id} base={receiptBase} />
                                {/* A cleared fee is received money (and may carry an issued
                                    receipt number) — not editable once cleared.
                                    Fees are never DELETED from a lease: an agreed
                                    charge stays on the record and is corrected via
                                    Edit (or cancelled through Status), so the plan
                                    always reconciles against the receipts it issued. */}
                                {perms.collections && f.chequeStatus !== 'cleared' && (
                                  <button
                                    type="button"
                                    className="mini-btn view"
                                    title="Edit fee amount / VAT / method / reference / date"
                                    onClick={() => feeEditId === f.id ? setFeeEditId(null) : startFeeEdit(f)}
                                  >
                                    <Pencil size={12} /> Edit
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {feeEditId === f.id && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                                <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                  <p className="subhead">Edit {feeLabel(f.paymentType).toLowerCase()}</p>
                                  <div className="field"><label>Fee type</label>
                                    <select className="input" value={feeEdit.paymentType}
                                      onChange={e => {
                                        const nt = e.target.value;
                                        setFeeEdit(v => { const auto = feeAutoAmount(nt); return { ...v, paymentType: nt, ...(auto ? { amount: auto } : {}) }; });
                                      }}>
                                      {FEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{feeOptionLabel(o.value, o.label)}</option>)}
                                    </select>
                                    {feeAutoAmount(feeEdit.paymentType) && <p className="note" style={{ marginTop: 2 }}>Amount auto-filled from Settings → Rules ({fmtAed(Number(feeAutoAmount(feeEdit.paymentType)))}). Editable.</p>}
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Amount (excl. VAT, AED)</label>
                                      <input type="number" min="0" step="0.01" className="input" value={feeEdit.amount}
                                        onChange={e => setFeeEdit(v => ({ ...v, amount: e.target.value }))} />
                                    </div>
                                    <div className="field"><label>VAT (AED, optional)</label>
                                      <input type="number" min="0" step="0.01" className="input" value={feeEdit.vatAmount} placeholder="0.00"
                                        onChange={e => setFeeEdit(v => ({ ...v, vatAmount: e.target.value }))} />
                                    </div>
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Payment method</label>
                                      <select className="input" value={feeEdit.paymentMethod}
                                        onChange={e => setFeeEdit(v => ({ ...v, paymentMethod: e.target.value }))}>
                                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                      </select>
                                    </div>
                                    <div className="field"><label>Cheque / reference no.</label>
                                      <input className="input" value={feeEdit.chequeNumber} placeholder="Cheque #, transfer ID…"
                                        onChange={e => setFeeEdit(v => ({ ...v, chequeNumber: e.target.value }))} />
                                    </div>
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Due date</label>
                                      <input type="date" className="input" value={feeEdit.transactionDate}
                                        onChange={e => setFeeEdit(v => ({ ...v, transactionDate: e.target.value }))} />
                                    </div>
                                    <div className="field"><label>Description</label>
                                      <input className="input" value={feeEdit.description} placeholder={feeLabel(f.paymentType)}
                                        onChange={e => setFeeEdit(v => ({ ...v, description: e.target.value }))} />
                                    </div>
                                  </div>
                                  <p className="note" style={{ marginTop: 2 }}>Total charged: <strong>{fmtAed((Number(feeEdit.amount) || 0) + (Number(feeEdit.vatAmount) || 0))}</strong></p>
                                  {feeEditErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{feeEditErr}</p>}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                    <button className="btn btn-jade btn-sm" disabled={feeEditBusy} onClick={() => void saveFeeEdit(f.id)}>
                                      <Check size={14} /> {feeEditBusy ? 'Saving…' : 'Save changes'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" disabled={feeEditBusy} onClick={() => { setFeeEditId(null); setFeeEditErr(null); }}>Cancel</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          {i === managementFeeRows.length - 1 && managementFeeRows.length > 1 && <PaySegTotalRow label="Management Fee total" amount={managementFeeTotal} />}
                          </Fragment>
                        ))}
                        {/* Custom "Other" charges (payment_type 'other') — per-unit taxes
                            and service fees, under Third Party. They are payments, so they
                            keep the payment status + edit controls (changeStatus / startEdit). */}
                        {thirdPartyFeeRows.length === 0 && otherPaymentRows.length > 0 && <PaySegRail title="Third Party" onAdd={perms.collections ? () => openFeeFor('ejari_fee') : undefined} />}
                        {otherPaymentRows.map(p => (
                          <Fragment key={p.id}>
                          <tr>
                            <td>Other</td>
                            <td>
                              {p.description ?? '—'}
                              {paymentRefs.receiptByPaymentId[p.id] && (
                                <span className="note" title="Issued receipt number — for bank reconciliation" style={{ display: 'block', fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace', color: '#1a5a4a', marginTop: 2 }}>
                                  Receipt {paymentRefs.receiptByPaymentId[p.id]}
                                </span>
                              )}
                            </td>
                            <td className="amt">
                              {fmtAed(p.amount)}
                              {(p.vatAmount ?? 0) > 0 && <span className="note" style={{ display: 'block', fontSize: 11 }}>incl. {fmtAed(p.vatAmount ?? 0)} VAT</span>}
                            </td>
                            <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{p.chequeNumber ?? '—'}</td>
                            <td>{p.paymentMethod ? fmtMethod(p.paymentMethod) : '—'}</td>
                            <td>{fmtDate(p.transactionDate)}</td>
                            <td>
                              <div style={PAY_STATUS_CELL}>
                                {perms.collections ? (
                                  <select
                                    className={'cstat ' + (p.chequeStatus ?? 'pending')}
                                    style={{ cursor: 'pointer' }}
                                    value={p.chequeStatus ?? 'pending'}
                                    disabled={statusBusy === p.id}
                                    onChange={e => void changeStatus(p.id, e.target.value)}
                                  >
                                    <option value="pending">Pending</option>
                                    <option value="cleared">Cleared</option>
                                    <option value="bounced">Bounced</option>
                                    <option value="cancelled">Cancelled</option>
                                  </select>
                                ) : (
                                  <span className={'cstat ' + (p.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>{p.chequeStatus ?? 'pending'}</span>
                                )}
                                <ReceiptDownload refs={paymentRefs} id={p.id} base={receiptBase} />
                                {perms.collections && p.chequeStatus !== 'cleared' && (
                                  <button type="button" className="mini-btn view" title="Edit amount / reference / description" onClick={() => editingId === p.id ? setEditingId(null) : startEdit(p)}>
                                    <Pencil size={12} /> Edit
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {editingId === p.id && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                                <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                  <p className="subhead">Correct charge details</p>
                                  <div className="field"><label>Description</label>
                                    <input className="input" value={editForm.description} placeholder="e.g. 5% VAT on Rent"
                                      onChange={e => setEditForm(v => ({ ...v, description: e.target.value }))} />
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Amount (AED)</label>
                                      <input type="number" min="0" step="0.01" className="input" value={editForm.amount}
                                        onChange={e => setEditForm(v => ({ ...v, amount: e.target.value }))} />
                                    </div>
                                    <div className="field"><label>Due date</label>
                                      <input type="date" className="input" value={editForm.transactionDate}
                                        onChange={e => setEditForm(v => ({ ...v, transactionDate: e.target.value }))} />
                                    </div>
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Payment method</label>
                                      <select className="input" value={editForm.paymentMethod}
                                        onChange={e => setEditForm(v => ({ ...v, paymentMethod: e.target.value }))}>
                                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                      </select>
                                    </div>
                                    <div className="field"><label>Cheque / reference no.</label>
                                      <input className="input" value={editForm.chequeNumber} placeholder="Cheque #, transfer ID…"
                                        onChange={e => setEditForm(v => ({ ...v, chequeNumber: e.target.value }))} />
                                    </div>
                                  </div>
                                  {editErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{editErr}</p>}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                    <button className="btn btn-jade btn-sm" disabled={editBusy} onClick={() => void saveEdit(p.id)}>
                                      <Check size={14} /> {editBusy ? 'Saving…' : 'Save changes'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(null); setEditErr(null); }}>Cancel</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        ))}
                        {(thirdPartyFeeRows.length + otherPaymentRows.length) > 1 && <PaySegTotalRow label="Third Party total" amount={thirdPartyTotal} />}
                        {feeRows.length === 0 && otherPaymentRows.length === 0 && !showAddFee && (
                          <tr><td colSpan={7}><span className="note">No fees recorded. Use <strong>Add fee</strong> to enter admin, contract registration, or commission charges — amounts are not auto-calculated.</span></td></tr>
                        )}
                      </tbody>
                    </table>

                    {/* Add-fee popup (admin-filled) */}
                    {showAddFee && (
                      <div className="mscrim" onClick={() => { setShowAddFee(false); setFeeAddErr(null); setFeeAdd(emptyFeeForm); }}>
                        <div className="modal sm" onClick={e => e.stopPropagation()}>
                          <div className="mh">
                            <span className="mt"><span className="mti" style={{ background: 'var(--jade)' }}><Plus size={16} /></span> Add fee</span>
                            <button className="x" onClick={() => { setShowAddFee(false); setFeeAddErr(null); setFeeAdd(emptyFeeForm); }}><X size={17} /></button>
                          </div>
                          <div className="mb">
                        <div className="grid2">
                          <div className="field"><label>Fee type</label>
                            <select className="input" value={feeAdd.paymentType}
                              onChange={e => {
                                const nt = e.target.value;
                                setFeeAdd(v => { const auto = feeAutoAmount(nt); return { ...v, paymentType: nt, ...(auto ? { amount: auto } : {}) }; });
                              }}>
                              {FEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{feeOptionLabel(o.value, o.label)}</option>)}
                            </select>
                            {feeAutoAmount(feeAdd.paymentType) && <p className="note" style={{ marginTop: 2 }}>Auto-filled from Settings → Rules ({fmtAed(Number(feeAutoAmount(feeAdd.paymentType)))}). Editable.</p>}
                          </div>
                          <div className="field"><label>Amount (excl. VAT, AED)</label>
                            <input type="number" min="0" step="0.01" className="input" value={feeAdd.amount} placeholder="e.g. 750"
                              onChange={e => setFeeAdd(v => ({ ...v, amount: e.target.value }))} />
                          </div>
                        </div>
                        <div className="grid2">
                          <div className="field"><label>VAT (AED, optional)</label>
                            <input type="number" min="0" step="0.01" className="input" value={feeAdd.vatAmount} placeholder="0.00"
                              onChange={e => setFeeAdd(v => ({ ...v, vatAmount: e.target.value }))} />
                          </div>
                          <div className="field"><label>Due date</label>
                            <input type="date" className="input" value={feeAdd.transactionDate}
                              onChange={e => setFeeAdd(v => ({ ...v, transactionDate: e.target.value }))} />
                          </div>
                        </div>
                        <div className="grid2">
                          <div className="field"><label>Payment method</label>
                            <select className="input" value={feeAdd.paymentMethod} onChange={e => setFeeAdd(v => ({ ...v, paymentMethod: e.target.value }))}>
                              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                          </div>
                          <div className="field"><label>Cheque / reference no.</label>
                            <input className="input" value={feeAdd.chequeNumber} placeholder="Cheque #, transfer ID…"
                              onChange={e => setFeeAdd(v => ({ ...v, chequeNumber: e.target.value }))} />
                          </div>
                        </div>
                        <div className="field"><label>Description (optional)</label>
                          <input className="input" value={feeAdd.description} placeholder={feeLabel(feeAdd.paymentType)}
                            onChange={e => setFeeAdd(v => ({ ...v, description: e.target.value }))} />
                        </div>
                        <p className="note" style={{ marginTop: 2 }}>Total charged: <strong>{fmtAed((Number(feeAdd.amount) || 0) + (Number(feeAdd.vatAmount) || 0))}</strong></p>
                        {feeAddErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{feeAddErr}</p>}
                          </div>
                          <div className="mf">
                            <button className="btn btn-ghost btn-sm" disabled={feeAddBusy} onClick={() => { setShowAddFee(false); setFeeAddErr(null); setFeeAdd(emptyFeeForm); }}>Cancel</button>
                            <button className="btn btn-jade btn-sm" disabled={feeAddBusy} onClick={() => void submitAddFee()}><Check size={14} /> {feeAddBusy ? 'Adding…' : 'Add fee'}</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Grand total — all four segments summed (deposit · rent · management · third party).
                      When the lease has incurred penalties, the agreed figure is shown
                      above it: one number cannot answer both "what was this agreed at?"
                      and "what has been charged on it?", and collapsing them let a
                      bounced cheque restate the rent. */}
                  <div style={{ marginTop: 16, padding: '11px 14px', borderRadius: 10, background: '#eef2f0', border: '1px solid #cfdcd6' }}>
                    {incurredChargesTotal > 0 && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 7 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#6b6860' }}>Lease Total</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1916', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(leaseAgreedTotal)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 9, borderBottom: '1px dashed #cfdcd6' }}>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: '#6b6860' }}>Charges incurred</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#b3541e', fontVariantNumeric: 'tabular-nums' }}>+ {fmtAed(incurredChargesTotal)}</span>
                        </div>
                      </>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: incurredChargesTotal > 0 ? 9 : 0 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#6b6860' }}>Grand Total</span>
                      <span style={{ fontSize: 17, fontWeight: 800, color: '#1a5a4a', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(paymentsGrandTotal)}</span>
                    </div>
                  </div>

                  {/* Record-payment popup (Flow 1) */}
                  {showRec && (
                    <div className="mscrim" onClick={() => { setShowRec(false); setRecErr(null); }}>
                      <div className="modal sm" onClick={e => e.stopPropagation()}>
                        <div className="mh">
                          <span className="mt"><span className="mti" style={{ background: 'var(--jade)' }}><CreditCard size={16} /></span> New payment</span>
                          <button className="x" onClick={() => { setShowRec(false); setRecErr(null); }}><X size={17} /></button>
                        </div>
                        <div className="mb">
                      <div className="grid2">
                        <div className="field"><label>Type</label>
                          <select className="input" value={rec.paymentType} onChange={e => setRec(v => ({ ...v, paymentType: e.target.value }))}>
                            {REC_TYPE_OPTIONS.filter(o => recTypes.includes(o.value)).map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="field"><label>Method</label>
                          <select className="input" value={rec.paymentMethod} onChange={e => setRec(v => ({ ...v, paymentMethod: e.target.value }))}>
                            <option value="cheque">Cheque</option>
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="cash">Cash</option>
                            <option value="card">Card</option>
                            <option value="online">Online</option>
                          </select>
                        </div>
                      </div>
                      <div className="field"><label>Description</label>
                        <input className="input" value={rec.description} placeholder={`Instalment ${rentRows.length + 1}`} onChange={e => setRec(v => ({ ...v, description: e.target.value }))} />
                      </div>
                      <div className="grid2">
                        <div className="field"><label>Amount (AED)</label>
                          <input type="number" min="0" step="0.01" className="input" value={rec.amount} onChange={e => setRec(v => ({ ...v, amount: e.target.value }))} />
                        </div>
                        <div className="field"><label>Cheque / reference no.</label>
                          <input className="input" value={rec.chequeNumber} placeholder="Cheque #, transfer ID…" onChange={e => setRec(v => ({ ...v, chequeNumber: e.target.value }))} />
                        </div>
                      </div>
                      <div className="field" style={{ margin: 0 }}><label>Date</label>
                        <input type="date" className="input" value={rec.transactionDate} onChange={e => setRec(v => ({ ...v, transactionDate: e.target.value }))} />
                      </div>
                      {/* Offered only when there is a failed cheque left to
                          settle — one that bounced, or one the customer swapped.
                          A linked payment takes the original off the "Overdue /
                          Bounced" KPI, the manager's action list and the arrears
                          totals — so nobody chases rent that has been made good. */}
                      {(unreplacedBounced.length > 0 || rec.replacesPaymentId !== '') && (
                        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                          <label>Goes against a bounced or swapped cheque</label>
                          <select
                            className="input"
                            value={rec.replacesPaymentId === '' ? '' : String(rec.replacesPaymentId)}
                            onChange={e => {
                              const id = e.target.value === '' ? '' : Number(e.target.value);
                              const target = id === '' ? null : payments.find(b => b.id === id) ?? null;
                              setRec(v => ({
                                ...v,
                                replacesPaymentId: id,
                                // Follow the row chosen: clearing the link clears
                                // the charge, and switching between a bounce and a
                                // swap switches which rule prefills it.
                                replacementFee: target == null ? ''
                                  : feeAutoAmount(isSwapped(target) ? 'cheque_replacement_fee' : 'bounced_cheque_fee'),
                              }));
                            }}
                          >
                            <option value="">No — this is a new cheque</option>
                            {unreplacedBounced.map(b => (
                              <option key={b.id} value={b.id}>
                                {b.chequeNumber ? `Cheque ${b.chequeNumber}` : `Payment #${b.id}`} · {fmtAed(shortfallOf(b))} still owed{coveredOf(b.id) > 0 ? ` of ${fmtAed(b.amount)}` : ''}{b.transactionDate ? ` · due ${fmtDate(b.transactionDate)}` : ''}
                              </option>
                            ))}
                          </select>
                          {rec.replacesPaymentId !== '' && (
                            <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                              The original cheque stays in the ledger as history and stops counting as arrears once the amounts recorded against it add up to what it was for — pay it off in one payment or several.
                            </span>
                          )}
                        </div>
                      )}
                      {/* The charge that goes with the swap, raised in the same
                          action because that is how it happens: the customer
                          hands over the new money and settles the fee in one
                          conversation. Prefilled from Settings → Rules and
                          editable — clear it to nil and no fee is raised. It is
                          linked to the same cheque so the ledger says what it
                          was for, and it never counts as money replacing it. */}
                      {rec.replacesPaymentId !== '' && (
                        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                          <label>{recChargeLabel} (AED)</label>
                          <input
                            type="number" min="0" step="0.01" className="input"
                            value={rec.replacementFee}
                            placeholder="0.00"
                            onChange={e => setRec(v => ({ ...v, replacementFee: e.target.value }))}
                          />
                          <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                            {recChargeAuto
                              ? `Auto-filled from Settings → Rules (${fmtAed(Number(recChargeAuto))}). Editable — clear it to charge nothing.`
                              : 'No rule is set for this charge in Settings → Rules. Enter an amount to raise one, or leave it empty.'}
                          </span>
                        </div>
                      )}
                      {recErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{recErr}</p>}
                        </div>
                        <div className="mf">
                          <button className="btn btn-ghost btn-sm" disabled={recBusy} onClick={() => { setShowRec(false); setRecErr(null); }}>Cancel</button>
                          <button className="btn btn-jade btn-sm" disabled={recBusy || !rec.amount} onClick={() => void submitRec()}><Check size={14} /> {recBusy ? 'Saving…' : 'Save payment'}</button>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
              {/* Payment documents (receipts / advices / invoices) live in the
                  Documents card below, under its Financial tab. */}
            </>
          )}
          {(inline || tab === 'documents') && (() => {
            // Requested-but-not-uploaded placeholders (empty fileUrl) are open
            // asks, not files — keep them out of the lists; checklist slots
            // show "Requested — awaiting upload" for them instead.
            const pendingAsks = (contract.documents ?? []).filter(d => !d.fileUrl);
            const all = (contract.documents ?? []).filter(d => !!d.fileUrl);
            // ── Expected-documents checklist (same mapping the customer journey
            // uses — src/lib/docRequirements). New lease → KYC + the unit
            // category's pack (commercial / industrial / residential). Renewal →
            // only the re-verification docs; the full pack lives on the original
            // lease. Slots match uploads so the gaps are what need requesting.
            const isRenewal = contract.contractType === 'renewal';
            const norm = normDocName;
            // The Emirates ID is the one document where the two sides and the
            // legacy combined scan satisfy each other ON THIS CHECKLIST — the
            // same rule isDocKeySatisfied applies. It is deliberately NOT in the
            // catalogue's own aliases: that list also feeds the customer-journey
            // resolver, where letting one file satisfy two side slots would mark
            // a half-supplied EID complete.
            const EID_SIDE_ALIASES: Record<string, string[]> = {
              emirates_id_front: ['emirates_id'],
              emirates_id_back: ['emirates_id'],
              emirates_id: ['emirates_id_front', 'emirates_id_back'],
            };
            // A slot can hold several files (e.g. Payment Advice = every cheque
            // image the tenant uploaded). Newest first; RP uploads carry a
            // `_<timestamp>` suffix on the key — strip it so a Replace supersedes.
            const matchDocs = (key: string): ContractDoc[] => {
              // Every wording that means this document — the catalogue's key,
              // label and historical aliases — so an upload and a request for
              // the same document land on the same row.
              const accepted = [...acceptedNamesFor(key), ...(EID_SIDE_ALIASES[key] ?? [])];
              const baseKey = (d: ContractDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
              return all
                .filter(d => accepted.includes(baseKey(d)) || accepted.includes(norm(d.displayName)))
                .sort((a, b) => b.id - a.id);
            };
            const askedNames = new Set(pendingAsks.flatMap(d => [
              norm(d.documentKey).replace(/_\d{10,}$/, ''),
              norm(d.displayName),
            ]));
            // Match the "Requested — awaiting upload" badge on ANY wording of the
            // document, not just its current label, so a request saved under an
            // older name still marks the slot it is tracked on.
            const askedFor = (req: DocReq) =>
              [...acceptedNamesFor(req.key), ...(EID_SIDE_ALIASES[req.key] ?? [])].some(n => askedNames.has(n));
            // (Old intake checklist + renderDoc removed — the card body is now
            // the document binder; KYC/licenses live behind "View customer
            // documents". matchDoc / renderMissing below are reused by the
            // binder's doc-slots.)
            // Missing slots use the SAME row pattern as on-file documents —
            // icon, name, status, actions right — dashed border marks the gap.
            const renderMissing = (req: DocReq) => {
              const asked = askedFor(req);
              return (
                <div key={'missing-' + req.key} className={'docitem docmiss' + (req.required && !asked ? ' req' : '')} title={req.hint}>
                  <FileText size={14} />
                  <div>
                    <div className="dn">{req.label}</div>
                    <div className="ds">{asked ? 'Requested — awaiting upload' : req.required ? 'Missing — required' : 'Not uploaded — optional'}</div>
                  </div>
                  <div className="dacts">
                    <button type="button" className="mini-btn ok" onClick={() => prefillUpload(req)}>
                      <UploadCloud size={12} /> Upload
                    </button>
                    {!asked && (
                      <button type="button" className="mini-btn view" onClick={() => prefillRequest(req)}>
                        <Send size={12} /> Request
                      </button>
                    )}
                  </div>
                </div>
              );
            };
            // ── The card body shows the contract documents BINDER in the fixed
            // sequence. Upload-type slots reuse View/Replace/Upload; generated /
            // print items are link rows. KYC/licenses live behind the
            // "View customer documents" link.
            type BinderSlot =
              | { kind: 'doc'; key: string; label: string; fallbackHref?: string; fallbackSub?: string }
              | { kind: 'link'; key: string; label: string; sub: string; href: string | null };
            const moveOutShown = contract.status === 'terminated' || contract.termination?.response === 'accepted' || !!contract.vacateAtEnd;
            const receiptsReady = contract.pdcConfirmed || contract.status === 'active' || contract.contractActive;
            // Separate rent/fee VAT cheques (new model) are a federal (FTA) tax —
            // included as a page inside the one combined Receipts document below.
            const showGovtVat = payments.some(p => (p.paymentType ?? '').toLowerCase() === 'vat');
            const binderSeq: BinderSlot[] = [
              { kind: 'link', key: 'offer',          label: 'Payment Summary', sub: 'Current payment summary', href: null },
              { kind: 'doc',  key: 'payment_advice', label: 'Payment Confirmation' },
              // One file → all receipts inside (Rental Income · Security Deposit · Management Fee · Government fee).
              { kind: 'link', key: 'receipts',       label: 'Receipts', sub: [isRenewal ? 'Rental income' : 'Rental income, security deposit', 'management fee', showGovtVat ? 'Government fee' : null].filter(Boolean).join(', '), href: receiptsReady ? receiptBase : null },
              { kind: 'link', key: 'agreement',      label: 'Agreement', sub: 'Tenancy contract', href: `${contractBase}/print` },
              { kind: 'doc',  key: 'ejari_certificate', label: 'Contract Registration Certificate' },
            ];
            if (!isRenewal) {
              binderSeq.push({ kind: 'doc',  key: 'utility_registration', label: 'Utility Proof of Payment' });
              // Stored PDF once the inspection is counter-signed; live page until then.
              binderSeq.push({ kind: 'doc', key: 'move_in_report', label: 'Move-in', fallbackHref: `${contractBase}/inspection/v2?type=move_in`, fallbackSub: 'Move-in inspection report' });
            }
            if (moveOutShown) {
              binderSeq.push({ kind: 'doc', key: 'move_out_report', label: 'Move-out', fallbackHref: `${contractBase}/inspection/v2?type=move_out`, fallbackSub: 'Move-out inspection report' });
              binderSeq.push({ kind: 'doc',  key: 'utility_final_bill', label: 'Utility Final Bill' });
              binderSeq.push({ kind: 'doc', key: 'deposit_settlement', label: 'Final Settlement', fallbackHref: `${contractBase}/settlement`, fallbackSub: 'Security deposit settlement' });
            }
            // Payment Plan opens an in-app modal showing the contract's CURRENT
            // live plan (recorded rent cheques + fees + deposit), not an external link.
            const renderOfferSlot = (s: Extract<BinderSlot, { kind: 'link' }>) => (
              <div key={s.key} className="docitem approved">
                <FileText size={14} />
                <div>
                  <div className="dn">{s.label}</div>
                  <div className="ds">{s.sub}</div>
                </div>
                <div className="dacts">
                  {currentPlan.totalAmountFils > 0
                    ? <>
                        <button type="button" className="mini-btn view cursor-pointer" onClick={() => setShowOffer(true)}><ExternalLink size={12} /> View</button>
                        <Link href={`${contractBase}/print/plan`} target="_blank" className="mini-btn view"><Download size={12} /> PDF</Link>
                      </>
                    : <span className="ds" style={{ color: '#b8b5ae' }}>Not yet available</span>}
                </div>
              </div>
            );
            const renderLinkSlot = (s: Extract<BinderSlot, { kind: 'link' }>) => (
              <div key={s.key} className="docitem approved">
                <FileText size={14} />
                <div>
                  <div className="dn">{s.label}</div>
                  <div className="ds">{s.sub}</div>
                </div>
                <div className="dacts">
                  {s.href
                    ? <Link href={s.href} target="_blank" className="mini-btn view"><ExternalLink size={12} /> View</Link>
                    : <span className="ds" style={{ color: '#b8b5ae' }}>Not yet available</span>}
                </div>
              </div>
            );
            const renderDocSlot = (s: Extract<BinderSlot, { kind: 'doc' }>) => {
              const docs = matchDocs(s.key);
              const req: DocReq = { key: s.key, label: s.label, category: 'contract', required: false };
              if (docs.length === 0) {
                // No stored PDF yet — fall back to the live page (inspection / settlement)
                // so it's reachable until the artifact is completed + snapshotted.
                if (s.fallbackHref) return (
                  <div key={s.key} className="docitem approved">
                    <FileText size={14} />
                    <div>
                      <div className="dn">{s.label}</div>
                      <div className="ds">{s.fallbackSub ?? 'Generated on completion'}</div>
                    </div>
                    <div className="dacts">
                      <Link href={s.fallbackHref} target="_blank" className="mini-btn view"><ExternalLink size={12} /> View</Link>
                    </div>
                  </div>
                );
                return renderMissing(req);
              }
              const multi = docs.length > 1;
              const doc = docs[0];
              // Payment Advice = the customer's uploaded cheque copies. They are
              // cleared in the Cheques/PDC step (Mark as Collected), NOT doc-reviewed,
              // so they never sit in a "Pending review" state — always "Uploaded".
              const noReview = s.key === 'payment_advice';
              const ok  = noReview || ['approved', 'processed', 'complete'].includes(doc.status);
              // Contract paperwork is FILED, not reviewed — a past expiry date is a
              // fact about the document, never an outstanding review. Without this
              // branch 'expired' fell through to "Pending review", so every ended
              // lease's Contract Registration Certificate claimed a review nobody
              // owed. The certificate is still on file; say when it lapsed instead.
              const expired = !ok && doc.status === 'expired';
              const stt = ok || expired ? 'approved' : doc.status === 'rejected' ? 'rejected' : 'pending';
              // Say what actually happened: the file IS uploaded. "On file" was
              // jargon that read as a filing state rather than a plain fact.
              const lbl = multi
                ? `${docs.length} files · uploaded`
                : ok ? 'Uploaded'
                : expired ? (doc.expiryDate ? `Uploaded · expired ${fmtDate(doc.expiryDate)}` : 'Uploaded · expired')
                : doc.status === 'rejected' ? 'Rejected' : 'Pending review';
              return (
                <div key={s.key} className={'docitem ' + stt}>
                  <FileText size={14} />
                  <div>
                    <div className="dn">{s.label}</div>
                    <div className="ds">{lbl}</div>
                  </div>
                  <div className="dacts">
                    <button type="button" onClick={() => multi ? openDocsTogether(docs) : openDocViewer({ fileUrl: doc.fileUrl, caption: s.label })} className="mini-btn view cursor-pointer"><ExternalLink size={12} /> {multi ? 'View all' : 'View'}</button>
                    {/* Generated tenancy artifacts get a clean, watermark-free download of the stored snapshot. */}
                    {['move_in_report', 'move_out_report', 'deposit_settlement'].includes(s.key) && (
                      <DownloadDocButton documentId={doc.id} label="PDF" className="mini-btn view" />
                    )}
                    {/* One file on the slot → Replace overwrites THAT row in place
                        (same id). Several → Add puts another beside them. */}
                    <button type="button" className="mini-btn view" title={multi ? `Add another ${s.label}` : `Replace the ${s.label} on file`} onClick={() => prefillUpload(req, multi ? undefined : doc)}><UploadCloud size={12} /> {multi ? 'Add' : 'Replace'}</button>
                    {/* Only when the slot holds ONE file. Several copies have no
                        single "this one" and a guess removes the wrong document;
                        the reader that lists them individually is where those go. */}
                    {perms.deleteDocuments && !multi && (
                      <DeleteDocumentButton docId={doc.id} label={s.label} onDeleted={onDocsChanged} />
                    )}
                  </div>
                </div>
              );
            };
            return (
              <>
              <div className="sec">
                <div className="sech">
                  <span className="si"><Paperclip size={16} /></span>
                  <span className="st">Documents ({all.length})</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <Link href={`${contractBase}/documents`} target="_blank" rel="noopener noreferrer" className="mini-btn view">
                      <ExternalLink size={12} /> View all
                    </Link>
                    <button type="button" className="mini-btn ok" onClick={() => { setShowUpload(s => !s); setUpErr(null); setUpReplaceOf(null); }}>
                      <UploadCloud size={12} /> Upload
                    </button>
                    <button type="button" className="mini-btn view" onClick={openBlankRequest}>
                      <Send size={12} /> Request
                    </button>
                  </div>
                </div>
                <div className="secb">
                  {/* Customer file = the mapped checklist ONLY. Every other doc
                      (payment slips, invoices, attachments, extra KYC uploads)
                      lives in the "View all" popup, scoped to this contract —
                      so the card stays the checklist, not a doc dump. */}
                  <div>
                    {/* Checklist — new lease: full pack + the two universal
                        contract docs; renewal: only Contract Registration +
                        Payment Advice. Always non-empty (CONTRACT_DOCS). */}
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-neutral-400, #9b9890)', margin: '2px 0 6px' }}>
                      Contract documents · in order
                    </div>
                    {isRenewal && (
                      <p className="note" style={{ margin: '0 0 8px' }}>
                        Renewal re-confirms the registration and the rent cheques.
                      </p>
                    )}
                    <div className="doclist">
                      {binderSeq.map(s => s.kind === 'doc' ? renderDocSlot(s) : s.key === 'offer' ? renderOfferSlot(s) : renderLinkSlot(s))}
                    </div>
                    {/* Everything else on this contract — one link, no inline dump. */}
                    <p className="note" style={{ marginTop: 8 }}>
                      {contract.tenant.id != null && (
                        <button type="button" className="chain-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => setShowDocsHistory(true)}>
                          Document History
                        </button>
                      )}
                    </p>
                  </div>

                  {/* Customer KYC — review + approve / reject the identity docs on
                      this contract. Approve = verify; Reject prompts for a reason
                      the customer sees as their re-upload prompt (matches leads). */}
                  {kycDocs.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-neutral-400, #9b9890)', margin: '2px 0 6px' }}>
                        Customer KYC · review
                      </div>
                      <div className="doclist">
                        {kycDocs.map(d => {
                          // A REQUESTED document is a row with no file yet (status
                          // 'pending', file_url ''). There is nothing to view and
                          // nothing to review, so it must read as awaiting the
                          // customer's upload — "Pending review" claims a file
                          // arrived. Same rule as renderMissing above and the
                          // customer-documents popup.
                          const awaitingUpload = !d.fileUrl;
                          const ok = ['processed', 'complete'].includes(d.status);
                          const rejected = d.status === 'rejected';
                          const expired = d.status === 'expired';
                          const stt = awaitingUpload ? 'docmiss' : ok ? 'approved' : rejected ? 'rejected' : 'pending';
                          const lbl = docLabel(d, kycDocs);
                          const req: DocReq = { key: d.documentKey, label: lbl, category: d.category, required: false };
                          return (
                            <div key={d.id} className={'docitem ' + stt}>
                              <FileText size={14} />
                              <div>
                                <div className="dn">{lbl}</div>
                                <div className="ds">
                                  {awaitingUpload ? 'Not uploaded'
                                    : ok ? 'Approved'
                                    : rejected ? 'Rejected — re-upload requested'
                                    : expired ? (d.expiryDate ? `Expired ${fmtDate(d.expiryDate)} — awaiting a fresh copy` : 'Expired — awaiting a fresh copy')
                                    : 'Pending review'}
                                </div>
                              </div>
                              <div className="dacts">
                                {awaitingUpload ? (
                                  // Already asked for — the only action left on the
                                  // landlord's side is uploading a copy they were sent
                                  // directly (email/WhatsApp), which fills this slot.
                                  <button type="button" className="mini-btn ok cursor-pointer" title={`Upload the ${lbl} on the customer's behalf`} onClick={() => prefillUpload(req)}>
                                    <UploadCloud size={12} /> Upload
                                  </button>
                                ) : (
                                  <>
                                    <button type="button" className="mini-btn view cursor-pointer" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: lbl })}><ExternalLink size={12} /> View</button>
                                    {!ok && (
                                      <>
                                        <button type="button" className="mini-btn ok cursor-pointer" onClick={() => onApproveDoc(d.id)}><Check size={12} /> Approve</button>
                                        <button type="button" className="mini-btn view cursor-pointer" onClick={() => onRejectDoc(d.id, lbl)}><X size={12} /> Reject</button>
                                      </>
                                    )}
                                    {/* Rejecting sends it back for a re-upload and keeps
                                        the trail; removing takes it off the record. Both
                                        are offered because a document filed against the
                                        WRONG customer cannot be fixed by rejecting it. */}
                                    {perms.deleteDocuments && (
                                      <DeleteDocumentButton docId={d.id} label={lbl} onDeleted={onDocsChanged} />
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Upload document (Flow 5) — popup, matching the request modal */}
                  {showUpload && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} role="dialog" aria-modal="true">
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }} onClick={() => { setShowUpload(false); setUpErr(null); }} />
                      {/* Paired questions sit side by side — type|name, then the
                          two places it can go — so the whole form reads in three
                          rows instead of one long stack. */}
                      <div ref={uploadBoxRef} style={{ position: 'relative', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -24px rgba(26,23,20,.5)', width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '16px 18px 12px', borderBottom: '1px solid #f0eee9' }}>
                          <div>
                            <p className="subhead" style={{ margin: 0 }}>{upReplacing ? `Replace ${upReplacing.displayName || upSelected?.label || 'document'}` : 'Upload a document'}</p>
                            <p className="note" style={{ margin: "2px 0 0" }}>
                              {upReplacing
                                ? 'The new file takes the place of the one on file — one document, not two.'
                                : <>{contract.ref} · {contract.tenant.name ?? "the customer"}</>}
                            </p>
                          </div>
                          <button type="button" className="mini-btn view" onClick={() => { setShowUpload(false); setUpErr(null); }}><X size={12} /></button>
                        </div>
                        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
                        <input ref={docFileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }}
                          onChange={e => setUpFile(e.target.files?.[0] ?? null)} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
                        {/* Searchable, because the list is ~60 entries long and a
                            native <select> makes you hunt. Same two section
                            groups the "File under" control below offers, so
                            picking a type also sets a sane default there. */}
                        <div className="field" style={{ position: 'relative', marginBottom: 0 }}>
                          <label>Document type</label>
                          <input
                            className="input" data-testid="up-doctype" role="combobox" aria-expanded={upTypeMenuOpen} aria-controls="v2-doctype-menu"
                            value={upTypeQuery}
                            placeholder="Search document types…"
                            onChange={e => { setUpTypeQuery(e.target.value); setUpTypeMenuOpen(true); }}
                            onFocus={e => { setUpTypeMenuOpen(true); e.currentTarget.select(); }}
                            onBlur={() => setTimeout(() => {
                              setUpTypeMenuOpen(false);
                              // Restore the chosen label — a half-typed query left
                              // in the box would read as the document's name.
                              setUpTypeQuery(DOC_TYPES.find(t => t.value === upType)?.label ?? '');
                            }, 150)}
                            onKeyDown={e => {
                              if (e.key === 'Escape') { setUpTypeMenuOpen(false); return; }
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const first = upTypeMatches[0];
                                if (first) { pickUpType(first.value); setUpTypeMenuOpen(false); }
                              }
                            }}
                          />
                          {upTypeMenuOpen && upTypeMatches.length > 0 && (
                            <div id="v2-doctype-menu" style={{ position: 'absolute', zIndex: 30, marginTop: 4, width: '100%', maxHeight: 240, overflowY: 'auto', background: '#fff', border: '1px solid #e8e6e0', borderRadius: 10, boxShadow: '0 8px 22px rgba(0,0,0,0.10)' }}>
                              {SECTION_ORDER.map(sec => {
                                const opts = upTypeMatches.filter(t => t.section === sec);
                                if (opts.length === 0) return null;
                                return (
                                  <div key={sec}>
                                    <p style={{ margin: 0, padding: '6px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', color: '#9b9890', background: '#faf9f6', position: 'sticky', top: 0 }}>{SECTION_LABEL[sec]}</p>
                                    {opts.map(t => (
                                      <button
                                        key={t.value} type="button"
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={() => { pickUpType(t.value); setUpTypeMenuOpen(false); }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#f0faf6')}
                                        onMouseLeave={e => (e.currentTarget.style.background = t.value === upType ? '#f4f3ef' : 'transparent')}
                                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#1a1916', cursor: 'pointer', background: t.value === upType ? '#f4f3ef' : 'transparent', border: 'none', fontWeight: t.value === upType ? 700 : 400 }}
                                      >
                                        <FileText size={12} style={{ color: '#9b9890', flexShrink: 0 }} /> {t.label}
                                      </button>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {upTypeMenuOpen && upTypeMatches.length === 0 && (
                            <p className="note" style={{ marginTop: 4 }}>No document type matches &ldquo;{upTypeQuery.trim()}&rdquo;.</p>
                          )}
                        </div>
                        {/* The name this file is READ under. The type stays the
                            catalogue key so slots and checklists keep matching;
                            this says WHICH one it is — Vehicle NOC vs Property NOC. */}
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Document name <span style={{ fontWeight: 400, color: '#9b9890' }}>· optional</span></label>
                          <input
                            className="input" data-testid="up-docname" value={upName} maxLength={255}
                            placeholder={upSelected ? upSelected.label : 'e.g. Vehicle NOC'}
                            onChange={e => setUpName(e.target.value)}
                          />
                        </div>
                        </div>
                        <p className="note" style={{ margin: '4px 0 14px' }}>
                          {upName.trim()
                            ? <>Filed as <strong>{upName.trim()}</strong>.</>
                            : upSelected ? <>Leave the name blank to file it as &ldquo;{upSelected.label}&rdquo;.</> : 'One type, many papers — a Vehicle NOC and a Property NOC are both an NOC.'}
                        </p>
                        <button
                          type="button" onClick={() => docFileRef.current?.click()}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 16, borderRadius: 10, cursor: 'pointer', background: upFile ? 'var(--jade-tint, #eef9f4)' : '#faf9f6', border: `1px ${upFile ? 'solid' : 'dashed'} ${upFile ? 'var(--jade-deep, #2e9f82)' : '#d9d5cd'}` }}
                        >
                          <UploadCloud size={16} style={{ color: upFile ? 'var(--jade-deep, #2e9f82)' : '#9b9890', flexShrink: 0 }} />
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1a1916', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {upFile ? upFile.name : 'Choose a file'}
                            </span>
                            <span style={{ display: 'block', fontSize: 11.5, color: '#6b6860', marginTop: 1 }}>
                              {upFile ? `${(upFile.size / 1024).toFixed(0)} KB · click to replace` : 'PDF, Word or image'}
                            </span>
                          </span>
                        </button>
                        {upShowExpiry && (
                          <div className="field">
                            <label>Expiry date <span style={{ fontWeight: 400, color: 'var(--brick)' }}>· required for {upSelected?.label}</span></label>
                            <input type="date" className="input" value={upExpiry} onChange={e => setUpExpiry(e.target.value)} />
                          </div>
                        )}
                        {/* WHERE THE DOCUMENT WILL LIVE. Not a display preference:
                            Customer KYC files it against the customer, so it also
                            appears on their profile and on their other leases. */}
                        <div className="field">
                          <label>File under</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {SECTION_ORDER.map(sec => (
                              <label key={sec} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer', border: `1px solid ${upSection === sec ? 'var(--jade-deep, #2e9f82)' : '#e8e6e0'}`, background: upSection === sec ? 'var(--jade-tint, #eef9f4)' : '#fff', borderRadius: 10, padding: '8px 10px' }}>
                                <input
                                  type="radio" name="v2DocSection" data-testid={`up-section-${sec}`} checked={upSection === sec} style={{ marginTop: 2 }}
                                  onChange={() => { setUpSection(sec); setUpSectionTouched(true); }}
                                />
                                <span>
                                  <span style={{ fontWeight: 600 }}>{SECTION_LABEL[sec]}</span>
                                  <span style={{ display: 'block', fontSize: 11.5, color: '#6b6860', marginTop: 1 }}>
                                    {sec === 'kyc'
                                      ? `Files against ${contract.tenant.name ?? 'the customer'} — shows on their profile and on every lease of theirs.`
                                      : 'Files against this lease only — on the customer profile it appears under History Documents.'}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                          {upSelected && upSection !== upSelected.section && (
                            <p className="note" style={{ marginTop: 6 }}>
                              Filed as {SECTION_LABEL[upSection]} rather than the usual {SECTION_LABEL[upSelected.section]} for {upSelected.label}.
                            </p>
                          )}
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Visibility</label>
                          <div style={{ display: 'flex', gap: 18 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                              <input type="radio" name="v2DocVisibility" checked={!upVisible} onChange={() => setUpVisible(false)} /> Internal only
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                              <input type="radio" name="v2DocVisibility" checked={upVisible} onChange={() => setUpVisible(true)} /> Visible to customer
                            </label>
                          </div>
                        </div>
                        </div>
                        <div style={{ padding: '12px 18px 16px', borderTop: '1px solid #f0eee9' }}>
                          {upErr && <p className="note" style={{ color: 'var(--brick)', margin: '0 0 8px' }}>{upErr}</p>}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button className="btn btn-jade btn-sm" disabled={upBusy || !upFile || !upType || (upShowExpiry && !upExpiry)} onClick={() => void submitUpload()}>
                              <UploadCloud size={14} /> {upBusy ? 'Uploading…' : upReplacing ? 'Replace' : 'Upload'}
                            </button>
                            <button className="btn btn-ghost btn-sm" disabled={upBusy} onClick={() => { setShowUpload(false); setUpErr(null); }}>Cancel</button>
                            {/* Says in one line what the two choices above add up to. */}
                            {upFile && upType && (
                              <span className="note" style={{ marginLeft: 'auto', textAlign: 'right' }}>
                                → {SECTION_LABEL[upSection]}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
              {/* Cross-lease document history — same popup module as the
                  customer page, no navigation away from the contract. */}
              {showDocsHistory && contract.tenant.id != null && (
                <CustomerDocsModal
                  tenantId={contract.tenant.id}
                  tenantName={contract.tenant.name}
                  /* Manager on "All landlords": scope the fetch by THIS contract's
                     landlord instead of the (empty) ?rp= query param. */
                  rp={contract.landlord?.id ?? null}
                  onClose={() => setShowDocsHistory(false)}
                />
              )}
              {/* "View all" — this contract's documents only (passes them in, so
                  the modal groups by category without a cross-lease fetch). */}
              {showContractDocs && (
                <CustomerDocsModal
                  tenantName={contract.tenant.name}
                  documents={all}
                  onClose={() => setShowContractDocs(false)}
                />
              )}
              {/* Payment Plan — the contract's current live plan. */}
              {showOffer && (
                <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }} onClick={() => setShowOffer(false)} />
                  <div style={{ position: 'relative', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
                    <button type="button" onClick={() => setShowOffer(false)} aria-label="Close"
                      style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, width: 28, height: 28, display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 999, cursor: 'pointer', color: '#6b6860' }}>✕</button>
                    <PaymentPlanCard
                      plan={currentPlan}
                      rows={segRowsFromContract(contract, payments)}
                      refLabel={contract.ref}
                      planRefNo={paymentRefs.planRefNo}
                      contractType={contract.contractType}
                      tenantName={contract.tenant.companyName || contract.tenant.name}
                      landlordName={contract.landlord.bankAccountName || contract.landlord.companyName || contract.landlord.name}
                      unitNumber={contract.unit.number}
                      buildingName={contract.property.buildingName}
                      community={contract.property.community || contract.property.emirate}
                      periodStart={contract.startDate}
                      periodEnd={contract.endDate}
                    />
                  </div>
                </div>
              )}
              {/* Request-a-document popup (Flow 6) */}
              {showReqModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} role="dialog" aria-modal="true">
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }} onClick={() => setShowReqModal(false)} />
                  <div style={{ position: 'relative', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -24px rgba(26,23,20,.5)', width: '100%', maxWidth: 460, padding: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                      <p className="subhead" style={{ margin: 0 }}>Request documents from {contract.tenant.name ?? 'the customer'}</p>
                      <button type="button" className="mini-btn view" onClick={() => setShowReqModal(false)}><X size={12} /></button>
                    </div>
                    {/* Selected documents — pick several, then send one request + one link */}
                    {reqSelected.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {reqSelected.map(name => (
                          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--jade-deep)', background: 'var(--jade-tint, #eef9f4)', border: '1px solid #cfe9df', borderRadius: 999, padding: '3px 6px 3px 10px' }}>
                            {name}
                            <button type="button" onClick={() => removeReqDoc(name)} style={{ display: 'grid', placeItems: 'center', border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 2 }} title="Remove">
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="field" style={{ position: 'relative' }}>
                      <input
                        ref={reqInputRef}
                        autoFocus
                        className="input"
                        value={reqLabel}
                        placeholder="Search or type a document name, Enter to add…"
                        onChange={e => { setReqLabel(e.target.value); setReqMenuOpen(true); }}
                        onFocus={() => setReqMenuOpen(true)}
                        onBlur={() => setTimeout(() => setReqMenuOpen(false), 150)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setReqMenuOpen(false);
                          if (e.key === 'Enter') { e.preventDefault(); addReqDoc(reqLabel); }
                        }}
                      />
                      {reqMenuOpen && (() => {
                        const q = reqLabel.trim().toLowerCase();
                        const matches = REQUESTABLE_DOCS.filter(d => d.toLowerCase().includes(q) && !reqSelected.some(s => s.toLowerCase() === d.toLowerCase()));
                        if (matches.length === 0) return null;
                        return (
                          <div style={{ position: 'absolute', zIndex: 30, marginTop: 4, width: '100%', maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #e8e6e0', borderRadius: 10, boxShadow: '0 8px 22px rgba(0,0,0,0.10)' }}>
                            {/* Same two groups as the upload picker — asking for a
                                document and filing one land in the same place. */}
                            {groupRequestNames(matches).map(g => (
                              <div key={g.section}>
                                <p style={{ margin: 0, padding: '6px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', color: '#9b9890', background: '#faf9f6', position: 'sticky', top: 0 }}>{g.label}</p>
                                {g.names.map(d => (
                                  <button
                                    key={d} type="button"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => addReqDoc(d)}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#f0faf6')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#1a1916', cursor: 'pointer', background: 'transparent', border: 'none' }}
                                  >
                                    <FileText size={12} style={{ color: '#9b9890', flexShrink: 0 }} /> {d}
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="field">
                      <input className="input" value={reqNotes} placeholder="Instructions for the customer (optional)" onChange={e => setReqNotes(e.target.value)} />
                    </div>
                    {reqErr && <p className="note" style={{ color: 'var(--brick)' }}>{reqErr}</p>}
                    {reqSent > 0 && (
                      <p className="note" style={{ color: 'var(--jade-deep)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Check size={13} /> Requested {reqSent} document{reqSent === 1 ? '' : 's'} — now send the upload link.
                      </p>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <button className="btn btn-jade btn-sm" disabled={reqBusy || (reqSelected.length === 0 && !reqLabel.trim())} onClick={() => void submitRequest()}>
                        <Paperclip size={14} /> {reqBusy ? 'Sending…' : `Send request${(reqSelected.length + (reqLabel.trim() ? 1 : 0)) > 1 ? 's' : ''}`}
                      </button>
                      {/* Upload link unlocks once documents are chosen */}
                      {contract.tenant.id && (
                        <SendTenantLinkButton
                          tenantId={contract.tenant.id}
                          contractId={contract.id}
                          section="documents"
                          label="Send docs link"
                          // Link is request-scoped: the customer sees only what was
                          // actually requested, so unlock it once the request is sent.
                          disabled={reqSent === 0}
                        />
                      )}
                      <button className="btn btn-ghost btn-sm" disabled={reqBusy} onClick={() => setShowReqModal(false)}>Close</button>
                    </div>
                  </div>
                </div>
              )}
              </>
            );
          })()}
          {!inline && tab === 'clauses' && (
            <>
            <div className="sec">
              <div className="sech"><span className="si"><ClipboardList size={16} /></span><span className="st">Clauses &amp; notes</span></div>
              <div className="secb">
                {clausesEditable ? (
                  /* Editable (draft only) — Flow 2 */
                  <>
                    {clauseList.map((c, i) => (
                      <div key={i} className="clause">
                        <span className="cn">{i + 1}</span>
                        <span className="ct">{c}</span>
                        <button type="button" className="mini-btn no" style={{ marginLeft: 'auto' }} onClick={() => setClauseList(prev => prev.filter((_, j) => j !== i))}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <input
                        className="input"
                        value={clauseInput}
                        placeholder="Type a clause and press Enter"
                        onChange={e => setClauseInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addClause(); } }}
                      />
                      <button type="button" className="btn btn-jade btn-sm" onClick={addClause}>Add</button>
                    </div>
                    <div className="field">
                      <label>Notes</label>
                      <textarea className="input" value={clauseNotes} placeholder="Any additional notes for this contract…" onChange={e => setClauseNotes(e.target.value)} />
                    </div>
                    {clauseErr && <p className="note" style={{ color: 'var(--brick)' }}>{clauseErr}</p>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button className="btn btn-jade btn-sm" disabled={clauseBusy} onClick={() => void saveClauses()}>
                        <Check size={14} /> {clauseBusy ? 'Saving…' : 'Save clauses'}
                      </button>
                      {clauseSaved && <span className="note" style={{ color: 'var(--jade-deep)', fontWeight: 700 }}>Saved ✓</span>}
                    </div>
                  </>
                ) : (
                  /* Read-only (issued / active / terminated / expired) */
                  <>
                    {contract.customClauses.map((c, i) => (
                      <div key={i} className="clause">
                        <span className="cn">{i + 1}</span>
                        <span className="ct">{c}</span>
                      </div>
                    ))}
                    {contract.customClauses.length === 0 && <p className="note">No custom clauses on this contract.</p>}
                    {contract.notes && (
                      <div className="field" style={{ marginTop: 12 }}>
                        <label>Notes</label>
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: 'var(--ink-2)' }}>{contract.notes}</div>
                      </div>
                    )}
                    <p className="note" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <BadgeCheck size={12} style={{ color: 'var(--jade-deep)' }} /> Contract sent to customer — clauses are locked.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="sec">
              <div className="sech"><span className="si"><FileText size={16} /></span><span className="st">Agreement Addendum</span></div>
              <div className="secb">
                {addendums.length > 0 ? (
                  <>
                    {addendums.map(a => (
                      <div key={a.id} className="clause">
                        <span className="ct" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <BadgeCheck size={14} style={{ color: 'var(--jade-deep)' }} /> {a.name || 'Agreement Addendum'}
                        </span>
                      </div>
                    ))}
                    <p className="note" style={{ marginTop: 8 }}>Attached — appears on the tenancy agreement.</p>
                  </>
                ) : addendumEnded ? (
                  <p className="note">No addendum attached.</p>
                ) : (
                  <>
                    <p className="note" style={{ marginBottom: 10 }}>
                      No addendum is attached. Attach this plan’s Agreement Addendum so it shows on the tenancy agreement.
                    </p>
                    {addendumErr && <p className="note" style={{ color: 'var(--brick)' }}>{addendumErr}</p>}
                    <button className="btn btn-jade btn-sm" disabled={addendumBusy} onClick={() => void onAttachLayoutAddendum()}>
                      <Plus size={14} /> {addendumBusy ? 'Attaching…' : 'Attach Agreement Addendum'}
                    </button>
                  </>
                )}
              </div>
            </div>
            </>
          )}

          {/* ── Tenancy notes log ──────────────────────────────────────────────
              A running, append-only journal staff keep about this tenancy so
              whoever picks it up next sees the full history. Shared across the
              whole renewal chain, and never locks (unlike the clauses note). */}
          {(inline || tab === 'notes') && showExtras && (
            <div className="sec" id="sec-notes">
              <div className="sech"><span className="si"><StickyNote size={16} /></span><span className="st">Notes</span></div>
              <div className="secb">
                <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>
                  An internal log for your team — record what is going on with this tenant so the next person to handle it is up to speed. Shared across this lease and its renewals. Not visible to the customer.
                </p>
                {perms.agreements && (
                  <>
                    <div className="field" style={{ marginBottom: 6 }}>
                      <textarea
                        className="input"
                        value={noteDraft}
                        placeholder="Add a note about this tenancy…"
                        rows={2}
                        onChange={e => setNoteDraft(e.target.value)}
                        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submitNote(); } }}
                      />
                    </div>
                    {noteErr && <p className="note" style={{ color: 'var(--brick)' }}>{noteErr}</p>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <button className="btn btn-jade btn-sm" disabled={noteBusy || !noteDraft.trim()} onClick={() => void submitNote()}>
                        <Check size={14} /> {noteBusy ? 'Saving…' : 'Add note'}
                      </button>
                    </div>
                  </>
                )}

                {notes.length === 0 ? (
                  <p className="note">No notes yet. Add the first one above.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {notes.map(n => (
                      <div key={n.id} style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                          <strong style={{ color: 'var(--ink-2)' }}>{n.authorName ?? (n.authorRole === 'tenant' ? 'Customer' : 'Staff')}</strong>
                          {n.authorRole === 'manager' && <span className="pill" style={{ fontSize: 10 }}>Manager</span>}
                          {n.authorRole === 'tenant' && <span className="pill" style={{ fontSize: 10 }}>Customer</span>}
                          <span style={{ marginLeft: 'auto' }}>
                            {new Date(n.createdAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--ink-1)', whiteSpace: 'pre-wrap' }}>{n.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Modals + signing (shared SignatureBlock)
// ────────────────────────────────────────────────────────────────────────────

/** Collapsible DocuSign-style signing audit trail: per-signature evidence
 *  (channel, IP, device, consent, terms hash) + the envelope event history,
 *  with a one-click "Certificate (PDF)" download. Fetches lazily on expand. */
function SignatureAuditTrail({ contractId }: { contractId: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<import('@/components/upnow/SignatureCertificatePdf').SignatureCertificateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dl, setDl] = useState(false);

  const load = async () => {
    if (data || loading) return;
    setLoading(true);
    try {
      const { fetchSignatureCertificate } = await import('@/components/upnow/SignatureCertificatePdf');
      setData(await fetchSignatureCertificate(contractId));
    } finally { setLoading(false); }
  };

  const download = async () => {
    if (!data || dl) return;
    setDl(true);
    try {
      const [{ pdf }, mod] = await Promise.all([import('@react-pdf/renderer'), import('@/components/upnow/SignatureCertificatePdf')]);
      const blob = await pdf(<mod.SignatureCertificateDoc data={data} refLabel={`CID-${contractId}`} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Signature-certificate-CID-${contractId}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } finally { setDl(false); }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button className="ca" style={{ padding: 0 }} onClick={() => { setOpen(o => !o); if (!open) void load(); }}>
        {open ? '▾ Hide signing audit trail' : '▸ View signing audit trail'}
      </button>
      {open && (
        <div style={{ marginTop: 8, border: '1px solid var(--edge, #e3e0d9)', borderRadius: 10, padding: '10px 12px', fontSize: 12 }}>
          {loading && <span className="note">Loading…</span>}
          {!loading && data && (
            <>
              {data.signatures.map(sig => {
                const mod = { // labels kept inline to avoid a client import at render time
                  rp_dashboard: 'UpNow dashboard', customer_dashboard: 'Customer dashboard',
                  tenant_portal: 'Emailed signing link (tenant)', landlord_link: 'Emailed signing link (landlord)',
                  on_file: 'On file (paper / imported)',
                } as Record<string, string>;
                const when = new Date(sig.signedAt).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
                return (
                  <div key={sig.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--mist, #f0ede7)' }}>
                    <strong style={{ textTransform: 'capitalize' }}>{sig.role}</strong> — {sig.signatoryName ?? '—'} · {when} GST
                    <div className="note" style={{ marginTop: 2 }}>
                      {[mod[sig.signedVia ?? ''] ?? (sig.method === 'on_file' ? mod.on_file : 'Legacy signature (pre-audit)'),
                        sig.ipAddress ? `IP ${sig.ipAddress}` : null,
                        sig.signerEmail,
                        sig.consentGiven ? 'e-sign consent ✓' : null,
                        sig.termsHash ? `terms #${sig.termsHash.slice(0, 12)}…` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                );
              })}
              {data.events.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {data.events.map(e => (
                    <div key={e.id} className="note" style={{ padding: '2px 0' }}>
                      {new Date(e.at).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} —{' '}
                      {({ link_sent: 'Signing link emailed', link_opened: 'Link opened', contract_viewed: 'Contract reviewed', signed: 'Signature executed', addendum_signed: 'Addendum signed', on_file_marked: 'Marked signed on file' } as Record<string, string>)[e.event] ?? e.event}
                      {e.role ? ` (${e.role})` : ''}{e.ipAddress ? ` · ${e.ipAddress}` : ''}
                    </div>
                  ))}
                </div>
              )}
              {data.signatures.length > 0 && (
                <button className="ca" style={{ padding: 0, marginTop: 8 }} onClick={download} disabled={dl}>
                  {dl ? 'Preparing…' : '⬇ Download signature certificate (PDF)'}
                </button>
              )}
              {data.signatures.length === 0 && data.events.length === 0 && <span className="note">No signing activity recorded yet.</span>}
            </>
          )}
          {!loading && !data && <span className="note">Audit trail unavailable.</span>}
        </div>
      )}
    </div>
  );
}

/** Maps a SignatureBlock payload to the /contracts/:id/sign landlord API call. */
async function submitLandlordSignature(contractId: number, fallbackName: string, p: SignaturePayload) {
  const res = await fetch(`/api/contracts/${contractId}/sign`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'landlord',
      signatoryName: p.signatoryName || fallbackName || 'Landlord',
      method: 'online',
      signatureImage: p.signatureImage,
      consent: p.consent,
      clientMeta: p.clientMeta,
      geo: p.geo,
    }),
  });
  if (!res.ok) throw new Error(`Sign failed: ${res.status}`);
}

function InlineLandlordSign({ contract, signerName, onBehalfOf, onSigned }: {
  contract: ContractDetail; signerName: string; onBehalfOf?: string | null; onSigned: () => void;
}) {
  const fallbackName = contract.landlord.companyName || contract.landlord.name || 'Landlord';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--jade-edge, #bfe3d6)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={16} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink, #1a1916)' }}>Sign this contract</div>
          <div className="note">Add your landlord signature below to countersign — no extra steps.</div>
        </div>
      </div>
      <SignatureBlock
        signerRole="Landlord"
        signerName={signerName}
        onBehalfOf={onBehalfOf}
        defaultName={signerName}
        termsText="I have reviewed this contract and agree to execute it as the landlord."
        submitLabel="Sign as Landlord"
        alreadySigned={false}
        onSign={async (p) => { await submitLandlordSignature(contract.id, fallbackName, p); onSigned(); }}
      />
    </div>
  );
}

/** Inline RP counter-signature for the move-in / move-out inspection — shown on
 *  the step card once the customer has signed, so the landlord doesn't have to
 *  open the inspection workspace just to countersign. Move-in auto-activates. */
function InlineInspectionCounterSign({ contractId, type, signerName, onBehalfOf, onSigned }: {
  contractId: number; type: 'move_in' | 'move_out'; signerName: string; onBehalfOf?: string | null; onSigned: () => void;
}) {
  const moveLabel = type === 'move_out' ? 'move-out' : 'move-in';
  const signInspection = async (p: SignaturePayload) => {
    const res = await fetch(`/api/contracts/${contractId}/inspection/sign?type=${type}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureImage: p.signatureImage, signatoryName: p.signatoryName, consent: p.consent, clientMeta: p.clientMeta, geo: p.geo }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(d?.message ?? `Sign failed: ${res.status}`);
    }
    onSigned();
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--jade-edge, #bfe3d6)', borderRadius: 'var(--r-lg)', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={16} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink, #1a1916)' }}>Sign the inspection</div>
          <div className="note">
            {type === 'move_in'
              ? 'The customer has signed — add your signature to complete move-in and activate the tenancy.'
              : 'The customer has signed — add your signature to complete the move-out inspection.'}
          </div>
        </div>
      </div>
      <SignatureBlock
        signerRole="Landlord"
        signerName={signerName}
        onBehalfOf={onBehalfOf}
        defaultName={signerName}
        termsText={`I confirm the condition recorded in this ${moveLabel} inspection is accurate.`}
        submitLabel="Sign inspection"
        alreadySigned={false}
        onSign={signInspection}
      />
    </div>
  );
}

function SignModal({
  contract, signerName, onBehalfOf, onClose, onSigned,
}: { contract: ContractDetail; signerName: string; onBehalfOf?: string | null; onClose: () => void; onSigned: () => void }) {
  const fallbackName = contract.landlord.companyName || contract.landlord.name || 'Landlord';
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={17} /></span>
            Sign contract
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <SignatureBlock
            signerRole="Landlord"
            signerName={signerName}
            onBehalfOf={onBehalfOf}
            defaultName={signerName}
            termsText="I have reviewed this contract and agree to execute it as the landlord."
            submitLabel="Sign as Landlord"
            alreadySigned={false}
            onSign={async (p) => { await submitLandlordSignature(contract.id, fallbackName, p); onClose(); onSigned(); }}
          />
        </div>
      </div>
    </div>
  );
}

function TerminateModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [effective, setEffective] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, reasonCode, effectiveDate: effective }),
      });
      if (!res.ok) throw new Error(await errMessage(res, 'Termination request failed'));
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Termination request failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            Request termination
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            {contract.tenant.name ?? 'The customer'} must accept this request before the contract terminates.
          </p>
          <div className="field">
            <label>Move-out reason</label>
            <MoveOutReasonSelect value={reasonCode} onChange={setReasonCode} />
            <p className="note" style={{ marginTop: 6 }}>Counted in the Move-out Reasons report.</p>
          </div>
          <div className="field">
            <label>Details{moveOutReason(reasonCode)?.requiresNote ? '' : ' (optional)'}</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Anything the reason above doesn't say" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Effective date</label>
            <input type="date" className="input" value={effective} onChange={e => setEffective(e.target.value)} />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-brick btn-sm" disabled={!moveOutReasonReady(reasonCode, reason) || !effective || busy} onClick={submit}>
            Send request
          </button>
        </div>
      </div>
    </div>
  );
}

/** RP-side direct termination — ends the lease without customer approval (the
 *  customer has already vacated). Starts the move-out → utility → settlement
 *  close-out; the lease stays ACTIVE until the settlement is marked paid. */
function DirectTerminateModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/direct`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, reasonCode, effectiveDate: effective }),
      });
      if (!res.ok) throw new Error(await errMessage(res, 'Direct termination failed'));
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Direct termination failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            Terminate directly
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            The customer has already vacated. This ends the lease without their approval and starts the move-out → utility → settlement close-out. The lease stays active until you complete the settlement.
          </p>
          <div className="field">
            <label>Move-out reason</label>
            <MoveOutReasonSelect value={reasonCode} onChange={setReasonCode} />
            <p className="note" style={{ marginTop: 6 }}>Counted in the Move-out Reasons report.</p>
          </div>
          <div className="field">
            <label>Details{moveOutReason(reasonCode)?.requiresNote ? '' : ' (optional)'}</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Anything the reason above doesn't say" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Effective date</label>
            <input type="date" className="input" value={effective} onChange={e => setEffective(e.target.value)} />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-brick btn-sm" disabled={!moveOutReasonReady(reasonCode, reason) || !effective || busy} onClick={submit}>
            Terminate directly
          </button>
        </div>
      </div>
    </div>
  );
}

// Clean void of a NOT-YET-ACTIVE (pending / issued) lease — the tenant never
// started, so there is no move-out / settlement wind-down. Distinct from
// DirectTerminateModal (which ends a live tenancy). Posts to /contracts/:id/cancel.
function RejectUtilityModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/utility/reject`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            Reject utility submission
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            This sends the utility step back to the customer to upload a fresh proof of payment. They&rsquo;ll see your reason below.
          </p>
          <div className="field" style={{ margin: 0 }}>
            <label>Reason (the customer will see this)</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. The proof is blurry / the account number doesn't match / wrong document." />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Keep reviewing</button>
          <button className="btn btn-brick btn-sm" disabled={busy} onClick={submit}>
            {busy ? 'Rejecting…' : 'Reject & send back'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Two different actions behind one button, because the backend treats a
 * pre-active RENEWAL differently from a pre-active new lease:
 *  · renewal child → a real cancellation (termination of the next term): the
 *    child is voided, its cheques cancelled, and the parent lease keeps running
 *    to its own end date. Not reversible — re-propose instead.
 *  · new lease → NOT a void; it resets the lease back to the setup pipeline.
 */
function CancelLeaseModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const isRenewal = isRenewalChild(contract);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.message ?? `Cancel failed: ${res.status}`);
      }
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            {isRenewal ? 'Cancel renewal' : 'Reset lease to setup'}
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            {isRenewal ? (
              <>
                This renewal has not started yet, so cancelling it ends the next term the way a termination ends a tenancy — no move-out or settlement. The renewal lease is marked terminated, its pending cheques are voided, and the current lease
                {contract.parentContractId ? ` (#${contract.parentContractId})` : ''} keeps running to its own end date. This cannot be undone — propose a fresh renewal if new terms are needed.
              </>
            ) : (
              <>This lease has not started yet, so it is not voided — it goes back to the setup pipeline at its uncompleted stage and stays on the Operations worklist. Any termination flags are cleared and previously-voided cheques are reinstated.</>
            )}
          </p>
          <div className="field" style={{ margin: 0 }}>
            <label>Reason (optional)</label>
            <textarea
              className="input"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={isRenewal ? 'Why are you cancelling this renewal?' : 'Why are you sending this lease back to setup?'}
            />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{isRenewal ? 'Keep renewal' : 'Keep as is'}</button>
          <button className="btn btn-brick btn-sm" disabled={busy} onClick={submit}>
            {busy ? 'Working…' : isRenewal ? 'Cancel renewal' : 'Reset to setup'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "↑ 27.7% vs current AED 94,000" — how far a proposed rent moves off the current
 * one, coloured by direction (up = saffron, down = jade, unchanged = muted). Shown
 * as the RP types so an increase is a decision rather than a discovery: Dubai's
 * rental index caps what can be asked in bands, and "94,000 → 120,000" doesn't read
 * as +27.7% at a glance. `pct: null` renders nothing.
 */
function RentDeltaChip({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return null;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const tone = flat
    ? { color: 'var(--mute)', background: 'var(--surface)' }
    : up
      ? { color: 'var(--saffron-deep)', background: 'var(--saffron-soft)' }
      : { color: 'var(--jade-deep)', background: 'var(--jade-tint)' };
  return (
    <span
      style={{
        ...tone, display: 'inline-block', marginTop: 5, padding: '2px 7px', borderRadius: 6,
        fontSize: 11, fontWeight: 700, letterSpacing: '0.01em',
      }}
    >
      {flat ? 'Same as current' : `${up ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%`}
      {' '}<span style={{ fontWeight: 600, opacity: 0.85 }}>{label}</span>
    </span>
  );
}

function RenewalProposeModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const ns = new Date(contract.endDate); ns.setDate(ns.getDate() + 1);
  const ne = new Date(ns); ne.setFullYear(ne.getFullYear() + 1); ne.setDate(ne.getDate() - 1);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  // Prefill one-off fees from the PARENT lease's actual fees (its fee rows, else
  // its stored column) — a sensible renewal default the RP can edit. Blank when
  // the parent had none; never a hardcoded/auto figure.
  const parentFeeAmt = (t: string, col?: number | null) => {
    const row = (contract.fees ?? []).find(x => x.paymentType === t)?.amount;
    const v = row ?? col ?? 0;
    return v > 0 ? String(v) : '';
  };
  // …but the RP's own FEE RULES (Settings → Fee Rules → Renewal contract, resolved
  // server-side for this unit's category) OUTRANK the parent lease when they exist.
  // A rule switched OFF is a decision — "we don't charge commission on renewal" —
  // so it prefills an explicit **0** that the RP can still override, rather than
  // silently re-billing the figure the original lease happened to carry. Only an
  // RP who has never configured the category falls back to the parent's fees.
  const feeRules = contract.feeRules?.configured ? contract.feeRules.rules : undefined;
  const ruleFeeAmt = (key: 'adminFee' | 'ejariFee' | 'commission', atRent: number) => {
    const v = configuredFeeFromRules(feeRules, key, atRent);
    return v == null ? null : String(v);
  };
  /** Rule amount if the RP configured one, else the parent lease's own figure. */
  const seedFee = (
    key: 'adminFee' | 'ejariFee' | 'commission',
    paymentType: string,
    atRent: number,
    col?: number | null,
  ) => ruleFeeAmt(key, atRent) ?? parentFeeAmt(paymentType, col);
  const [f, setF] = useState({
    // Default the renewal to the parent lease's current NET rent (annualRent is
    // net; the cheque schedule adds VAT on top). The RP explicitly enters any
    // increase — never seed a hidden uplift here. (Previously `* 1.05`, which
    // dropped a VAT-inclusive figure into the net field → the backend then added
    // VAT again, double-counting it and silently hiking the rent 5%.)
    listedRent: String(contract.annualRent),
    discountType: 'none' as 'none' | 'percent' | 'fixed',
    discountValue: '',
    newStartDate: iso(ns),
    newEndDate: iso(ne),
    numberOfInstallments: String(contract.numberOfInstallments ?? 4),
    // Inherited from the parent lease, not asked again on the renewal form: a renewal
    // continues the same payment method, and it's editable on the contract itself.
    // Still SENT, because the backend stamps each cheque row's method from the dto
    // (only the contract header falls back to the parent), so dropping it would file
    // a bank-transfer lease's renewal cheques as 'cheque'.
    modeOfPayment: contract.modeOfPayment ?? 'cheque',
    adminFee: seedFee('adminFee', 'admin_fee', contract.annualRent, contract.adminFeeFils),
    ejariFee: seedFee('ejariFee', 'ejari_fee', contract.annualRent, contract.ejariFeeFils),
    commission: seedFee('commission', 'commission', contract.annualRent),
  });
  // Which fee fields the RP has typed in — a touched field is theirs and is never
  // re-derived from the rules again.
  const [feeTouched, setFeeTouched] = useState<Record<'adminFee' | 'ejariFee' | 'commission', boolean>>({
    adminFee: false, ejariFee: false, commission: false,
  });
  // Extra one-off charge lines (Municipality Fee, parking add-on, etc.) — each a
  // separate cheque on top of rent + fees. Posted as `extraCharges`.
  //
  // A renewal continues THIS lease, so it repeats the current lease's Third Party
  // ('other') charges — the sub-lease charge, service charge, etc. Two sources,
  // in this order:
  //
  //   1. The PARENT lease's own payment rows — what this contract actually
  //      charges today, amounts and all.
  //   2. The UNIT's configured charges, for anything source 1 doesn't already
  //      cover. This used to be excluded on the reasoning that "a new lease reads
  //      the unit, a renewal shows what this contract already charges" — but a
  //      lease that was IMPORTED has no charge rows to show (its cheques were
  //      keyed straight in as bare rent), so a sub-leased unit's 20% pass-through
  //      silently vanished from every renewal of it. The unit is the standing
  //      configuration; the renewal offers it and the RP deletes any line that
  //      doesn't apply to this term.
  //
  // Rent VAT is skipped — the renewal recomputes it as its own cheque, so carrying
  // it forward would double-count. Every line stays editable/removable.
  //
  // Carrying the AMOUNT forward is right for a flat charge but wrong for the
  // sub-lease pass-through lines, whose labels declare them a percentage of the
  // rent — and a renewal is exactly where the rent changes. Those two re-derive
  // from the net rent below (and again whenever the rent field moves), so the
  // offer can never quote last year's percentage, nor the unit's Market Rent
  // percentage when the lease is let for less.
  const [extras, setExtras] = useState<{ description: string; amount: string; dueDate: string }[]>(() => {
    // Carried charges fall due on the FIRST installment date (same as the rent
    // cheque #1 / fees), computed the same way the schedule below does.
    const firstDue = buildInstallmentDueDates(
      iso(ns), iso(ne), contract.numberOfInstallments ?? 4, contract.preferredChequeDays ?? [],
    )[0] ?? iso(ns);
    const carried = (contract.payments ?? [])
      .filter(p => (p.paymentType ?? '') === 'other')
      .filter(p => !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase()))
      .filter(p => (p.amount ?? 0) > 0)
      .filter(p => !(/rent/i.test(p.description ?? '') && /vat/i.test(p.description ?? '')))
      .map(p => ({ description: (p.description ?? '').trim(), amount: String(p.amount ?? ''), dueDate: firstDue }));

    // Identity of a charge, for "does the lease already bill this?". The two
    // sub-lease lines are matched by what they ARE, not by their text: RPs
    // hand-type those labels and live data holds several spellings, so
    // "20% on sub lease" and "Sub-lease charge (20%)" must not both be offered.
    // Everything else falls back to its normalised label.
    const chargeKey = (label: string) => {
      const sub = classifySubleaseCharge(label);
      return sub ? `sublease:${sub.kind}` : label.trim().toLowerCase().replace(/\s+/g, ' ');
    };
    const already = new Set(carried.map(c => chargeKey(c.description)));
    const fromUnit = (contract.unit.additionalPayments ?? [])
      // Gross: the unit stores a charge's own VAT beside it, while an extras line
      // carries a single amount (the sub-lease VAT is its own labelled row, so
      // this only bites on a unit charge that declares inline VAT).
      .map(p => ({ description: (p.label ?? '').trim(), amount: (Number(p.amount) || 0) + (Number(p.vat) || 0) }))
      .filter(p => {
        if (!p.description || p.amount <= 0) return false;
        const k = chargeKey(p.description);
        if (already.has(k)) return false;
        already.add(k); // a unit listing the same charge twice still offers it once
        return true;
      })
      .map(p => ({ description: p.description, amount: String(p.amount), dueDate: firstDue }));

    return [...carried, ...fromUnit];
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Installment plans + cheque days come from the contract payload (the OWNING
  // RP's config) so a manager — who has no RP profile of their own — still sees
  // the right filtered list and the preview snaps dates the same way the backend does.
  const allowedInstallments = contract.allowedInstallments ?? [];
  const chequeDays = contract.preferredChequeDays ?? [];

  const set = (k: keyof typeof f, v: string) => {
    if (k === 'adminFee' || k === 'ejariFee' || k === 'commission') {
      setFeeTouched(p => (p[k] ? p : { ...p, [k]: true }));
    }
    setF(p => ({ ...p, [k]: v }));
  };
  const addExtra = () => setExtras(p => [...p, { description: '', amount: '', dueDate: '' }]);
  const setExtra = (i: number, k: 'description' | 'amount' | 'dueDate', v: string) =>
    setExtras(p => p.map((e, idx) => idx === i ? { ...e, [k]: v } : e));
  const removeExtra = (i: number) => setExtras(p => p.filter((_, idx) => idx !== i));

  const n = parseInt(f.numberOfInstallments) || 0;
  const listed = parseFloat(f.listedRent) || 0;
  const discVal = parseFloat(f.discountValue) || 0;
  const discountAmt = f.discountType === 'percent'
    ? Math.round(listed * discVal) / 100
    : f.discountType === 'fixed' ? discVal : 0;
  const rent = Math.max(0, listed - Math.min(discountAmt, listed)); // net rent

  // How far the proposed rent moves off the CURRENT one. Surfaced as the RP types
  // so the increase is a decision, not a discovery — Dubai's rental index caps what
  // can be asked in bands, and "94,000 → 120,000" doesn't read as +27.7% at a glance.
  // Compared against the parent's net rent, the same basis as the Contract Value.
  const prevRent = Number(contract.annualRent) || 0;
  const pctVsCurrent = (x: number) => (prevRent > 0 && x > 0 ? ((x - prevRent) / prevRent) * 100 : null);
  // Length of the term being replaced, in whole months (inclusive end date), so the
  // "Current contract" summary says 12 months rather than making the RP subtract dates.
  const currentTermMonths = (() => {
    const s = new Date(contract.startDate), e = new Date(contract.endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    const m = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
    return m > 0 ? m : null;
  })();
  const listedDeltaPct = pctVsCurrent(listed);
  const netDeltaPct = pctVsCurrent(rent);

  // Keep the derived sub-lease lines pinned to the net rent as it is edited.
  // recomputeSubleaseCharges returns the same array when nothing moved, so this
  // settles in one pass instead of looping. Flat charges are returned untouched.
  useEffect(() => {
    setExtras(prev => recomputeSubleaseCharges(prev, rent));
  }, [rent]);

  /**
   * What a fee field shows. Until the RP types in it, it stays DERIVED from their fee
   * rules at the current rent — so a percentage rule (commission is typically 5% of
   * rent) follows the rent field instead of quoting a figure computed off the old
   * rent, and a renewal is exactly where the rent changes. Once they've typed, the
   * value is theirs and is never recomputed.
   */
  const feeValue = (key: 'adminFee' | 'ejariFee' | 'commission') =>
    (feeTouched[key] ? null : ruleFeeAmt(key, rent)) ?? f[key];
  const adminN = parseFloat(feeValue('adminFee')) || 0;
  const ejariN = parseFloat(feeValue('ejariFee')) || 0;
  const commN = parseFloat(feeValue('commission')) || 0;
  // Rent VAT rate: the parent's stored rentVatRate can be stale/0 on older contracts,
  // but a renewal's rate is recomputed server-side from the UNIT category
  // (commercial/industrial = 5%, residential exempt). Mirror that so the preview
  // matches the actual proposal, not the old rate.
  const vatRate = Number(contract.rentVatRate)
    || (spaceCategoryFromUnitType((contract.unit as { type?: string | null } | undefined)?.type ?? null) !== 'residential' ? 5 : 0);
  const vatOf = (x: number) => vatRate ? Math.round(x * vatRate) / 100 : 0;
  // Due dates — spread over the actual renewal term + snapped to the RP's cheque
  // days, identical to what proposeRenewal stamps server-side.
  const dueDates = buildInstallmentDueDates(f.newStartDate, f.newEndDate, n, chequeDays);

  // Preview mirrors the backend splitVatToOwnCheques: rent cheques are NET, and the
  // rent VAT is its OWN cheque. The RP's Settings → Rules mode decides how many:
  //   'annual'      → ONE "Rental VAT" cheque for the year, on the first rent date.
  //   'installment' → one "Rental VAT N of M" cheque beside each rent cheque.
  // Fees are net too.
  const vatMode: 'annual' | 'installment' = contract.rentVatMode ?? 'installment';
  type Row = { key: string; d: string; date: string; net: number; vat: number };
  const rows: Row[] = [];
  const vatRows: Row[] = [];
  if (n && rent) {
    const base = Math.floor(rent / n);
    const lastA = rent - base * (n - 1);
    let annualVat = 0;
    for (let i = 0; i < n; i++) {
      const r = i === n - 1 ? lastA : base;
      rows.push({ key: `r${i}`, d: n === 1 ? 'Annual Rent' : `Instalment ${i + 1}`, date: dueDates[i] ?? '', net: r, vat: 0 });
      const v = vatOf(r);
      if (v > 0) {
        annualVat += v;
        if (vatMode !== 'annual') vatRows.push({ key: `rv${i}`, d: n === 1 ? `Rental VAT (${vatRate}%)` : `Rental VAT ${i + 1} of ${n} (${vatRate}%)`, date: dueDates[i] ?? '', net: 0, vat: v });
      }
    }
    // Annual mode: collapse to a single Rental VAT cheque on the first rent date.
    if (vatMode === 'annual' && annualVat > 0) vatRows.push({ key: 'rv-annual', d: `Rental VAT (${vatRate}%)`, date: dueDates[0] ?? '', net: 0, vat: annualVat });
  }
  rows.push(...vatRows);
  const feeDate = dueDates[0] ?? f.newStartDate;
  if (adminN > 0) rows.push({ key: 'admin', d: 'Admin Fee', date: feeDate, net: adminN, vat: 0 });
  if (ejariN > 0) rows.push({ key: 'ejari', d: 'Contract Registration Fee', date: feeDate, net: ejariN, vat: 0 });
  if (commN > 0)  rows.push({ key: 'comm',  d: 'Commission', date: feeDate, net: commN, vat: 0 });
  // Fees are NET above, and their tax rides ONE combined "Fees VAT" cheque due with
  // the first cheque — exactly what proposeRenewal stamps (ruleFeeVat per fee, then
  // splitVatToOwnCheques). Without this the preview was short by the fee tax and the
  // RP approved a plan whose total didn't match the cheques that got raised.
  const feeVat = Math.round((
    feeVatFromRules(feeRules, 'adminFee', adminN, rent)
    + feeVatFromRules(feeRules, 'ejariFee', ejariN, rent)
    + feeVatFromRules(feeRules, 'commission', commN, rent)
  ) * 100) / 100;
  if (feeVat > 0) rows.push({ key: 'feevat', d: 'Fees VAT', date: feeDate, net: 0, vat: feeVat });
  extras.forEach((e, i) => {
    const amt = parseFloat(e.amount) || 0;
    if (e.description.trim() && amt > 0) rows.push({ key: `x${i}`, d: e.description.trim(), date: e.dueDate || (dueDates[n - 1] ?? ''), net: amt, vat: 0 });
  });
  const totalVat = rows.reduce((s, r) => s + r.vat, 0);
  const total = rows.reduce((s, r) => s + r.net + r.vat, 0);

  // Segregated four-group preview — same shared view as the contract, receipts, PDFs,
  // lead, creation and edit. Classify each planned row by its key: rent instalments →
  // Rental Income; rental-VAT cheques + extras → Third Party; admin/Ejari/commission →
  // Management/Third Party. (Renewals carry the deposit forward, so no deposit row.)
  const seg = buildSegregatedPlan(rows.map((r): SegPaymentInput => {
    const paymentType =
      r.key.startsWith('rv') ? 'other'
      : r.key.startsWith('r') ? 'rental_income'
      : r.key === 'admin' ? 'admin_fee'
      : r.key === 'ejari' ? 'ejari_fee'
      : r.key === 'comm' ? 'commission'
      : 'other';
    return { paymentType, description: r.d, amount: r.net + r.vat, transactionDate: r.date || null };
  }));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/renewal/propose`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newAnnualRent: rent,                       // NET (listed − discount)
          listedRent: listed,
          discountType: f.discountType === 'none' ? undefined : f.discountType,
          discountValue: f.discountType === 'none' ? undefined : discVal,
          newStartDate: f.newStartDate,
          newEndDate: f.newEndDate,
          numberOfInstallments: n,
          modeOfPayment: f.modeOfPayment,
          adminFee: adminN,
          ejariFee: ejariN,
          commission: commN,
          extraCharges: extras
            .map(e => ({ description: e.description.trim(), amount: parseFloat(e.amount) || 0, dueDate: e.dueDate || undefined }))
            .filter(e => e.description && e.amount > 0),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Renewal propose failed: ${res.status}`);
      }
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Renewal propose failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    // No onClick on the scrim: a renewal is a long form (term, rent, discount, fees,
    // charges) and a stray click on the backdrop used to bin the whole thing. It closes
    // via the × or Cancel only.
    <div className="mscrim">
      <div className="modal xl" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--jade)' }}><RotateCcw size={17} /></span>
            Propose renewal
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          {/* What's being renewed, as four labelled facts instead of four loose lines
              of grey text — the RP checks the customer, the unit, the term they're
              replacing and the rent they're pricing against before touching anything
              below, so each gets a name. */}
          <p className="subhead mut">Current contract</p>
          <div className="infopanel curcontract" style={{ marginBottom: 18 }}>
            <div>
              <span className="eyebrow">Customer</span>
              <b>{contract.tenant.name ?? '—'}</b>
            </div>
            <div>
              <span className="eyebrow">Unit</span>
              <b>{contract.unit.number ? `Unit ${contract.unit.number}` : '—'}</b>
              <span className="note">{contract.property.buildingName ?? '—'}</span>
            </div>
            <div>
              <span className="eyebrow">Current term</span>
              <b>{fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}</b>
              {currentTermMonths != null && <span className="note">{currentTermMonths} months</span>}
            </div>
            <div>
              <span className="eyebrow">Current rent</span>
              <b>{fmtAed(contract.annualRent)}</b>
              {contract.numberOfInstallments
                ? <span className="note">{contract.numberOfInstallments} × {installmentLabel(contract.numberOfInstallments).toLowerCase()}</span>
                : null}
            </div>
          </div>
          <p className="subhead mut">Renewal period</p>
          <div className="grid3" style={{ marginBottom: 18 }}>
            <div className="field" style={{ margin: 0 }}><label>Start date</label><input type="date" className="input" value={f.newStartDate} onChange={e => set('newStartDate', e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>End date</label><input type="date" className="input" value={f.newEndDate} onChange={e => set('newEndDate', e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}>
              <label>Payments / Year</label>
              <select className="input" value={f.numberOfInstallments} onChange={e => set('numberOfInstallments', e.target.value)}>
                {/* "4 — Quarterly": the cheque count alone made the RP work out what
                    the frequency was. longLabel is the shared label from lib/installmentPlans. */}
                {allowedInstallmentPlans(allowedInstallments, [Number(f.numberOfInstallments)]).map(p => (
                  <option key={p.value} value={p.value}>{p.longLabel}</option>
                ))}
              </select>
            </div>
          </div>
          {/* The rent maths, laid out as the sum it actually is:
                Annual Rent − Discount = Contract Value.
              The discount is not a field in its own right — it's the thing that turns
              what's asked into what's billed, so it sits between the two and both
              sides carry their own "vs the current rent" readout. No "Mode of payment"
              here either: a renewal continues the parent lease's payment method, set
              on the contract itself rather than re-chosen every term. */}
          <p className="subhead mut">Rent for the new term</p>
          <div className="infopanel" style={{ padding: '14px 16px', marginBottom: 18 }}>
            <div className="rentcalc">
              <div className="field" style={{ margin: 0 }}>
                <label>Annual Rent</label>
                <input type="number" className="input" value={f.listedRent} onChange={e => set('listedRent', e.target.value)} />
                <RentDeltaChip pct={listedDeltaPct} label={`vs current ${fmtAed(prevRent)}`} />
              </div>
              <span className="op">−</span>
              <div className="field" style={{ margin: 0 }}>
                <label>Discount</label>
                <div className="disc">
                  <select className="input" value={f.discountType} onChange={e => set('discountType', e.target.value)}>
                    <option value="none">No discount</option>
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed (AED)</option>
                  </select>
                  <input
                    type="number"
                    className="input"
                    aria-label="Discount value"
                    value={f.discountType === 'none' ? '' : f.discountValue}
                    disabled={f.discountType === 'none'}
                    placeholder={f.discountType === 'percent' ? '%' : f.discountType === 'fixed' ? 'AED' : '—'}
                    onChange={e => set('discountValue', e.target.value)}
                    style={f.discountType === 'none' ? { background: 'var(--surface)', color: 'var(--mute)' } : undefined}
                  />
                </div>
                {/* A "%" only becomes money once you see it against the rent. */}
                {discountAmt > 0 && (
                  <span style={{
                    display: 'inline-block', marginTop: 5, padding: '2px 7px', borderRadius: 6,
                    fontSize: 11, fontWeight: 700, color: 'var(--jade-deep)', background: 'var(--jade-tint)',
                  }}>
                    − {fmtAed(discountAmt)}{' '}
                    <span style={{ fontWeight: 600, opacity: 0.85 }}>off {fmtAed(listed)}</span>
                  </span>
                )}
              </div>
              <span className="op">=</span>
              <div className="field" style={{ margin: 0 }}>
                <label>{discountAmt > 0 ? 'Contract Value after discount' : 'Contract Value'}</label>
                <input
                  className="input"
                  value={fmtAed(rent)}
                  disabled
                  style={{ background: '#fff', color: 'var(--ink)', fontWeight: 800, borderColor: 'var(--jade)' }}
                />
                {discountAmt > 0 && <RentDeltaChip pct={netDeltaPct} label="vs current, after discount" />}
              </div>
            </div>
          </div>
          <p className="subhead mut">Fees (AED) — billed as their own cheques</p>
          <div className="grid2">
            <div className="field"><label>Admin fee</label><input type="number" className="input" value={feeValue('adminFee')} onChange={e => set('adminFee', e.target.value)} /></div>
            <div className="field"><label>Contract Registration fee</label><input type="number" className="input" value={feeValue('ejariFee')} onChange={e => set('ejariFee', e.target.value)} /></div>
          </div>
          <div className="grid2" style={{ marginBottom: feeRules ? 6 : 18 }}>
            <div className="field"><label>Commission</label><input type="number" className="input" value={feeValue('commission')} onChange={e => set('commission', e.target.value)} /></div>
            <div className="field"><label>Deposit (carries over)</label><input className="input" value={fmtAed(contract.securityDepositAmount)} disabled style={{ background: 'var(--surface)', color: 'var(--ink-3)' }} /></div>
          </div>
          {feeRules && (
            <p className="note mut" style={{ marginTop: 0, marginBottom: 18 }}>
              Prefilled from your renewal fee rules for {contract.feeRules?.spaceCategory?.replace('_', ' ')} (Settings → Fee Rules → Renewal contract) — a fee
              you switched off comes through as 0. Edit any of them for this renewal.
            </p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: extras.length > 0 ? 4 : 8 }}>
            <p className="subhead mut" style={{ margin: 0 }}>Additional charges <span style={{ fontWeight: 600, opacity: 0.75 }}>· Third Party</span></p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addExtra}><Plus size={13} /> Add charge</button>
          </div>
          {extras.length > 0 && (
            <p className="note mut" style={{ marginTop: 0, marginBottom: 8 }}>Carried forward from the current lease, plus any charge configured on the unit that it isn’t already billing (e.g. sub-lease charge, service charge). Each is billed under Third Party — edit or remove any that don’t apply to this term.</p>
          )}
          {extras.map((e, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 150px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input className="input" placeholder="Description (e.g. Municipality Fee)" value={e.description} onChange={ev => setExtra(i, 'description', ev.target.value)} />
              <input className="input" type="number" placeholder="Amount" value={e.amount} onChange={ev => setExtra(i, 'amount', ev.target.value)} />
              <input className="input" type="date" value={e.dueDate} onChange={ev => setExtra(i, 'dueDate', ev.target.value)} />
              <button type="button" className="x" onClick={() => removeExtra(i)} title="Remove"><Trash2 size={15} /></button>
            </div>
          ))}

          {rows.length > 0 && (
            <>
              <p className="subhead mut" style={{ marginTop: 14 }}>Planned schedule</p>
              <SegregatedPlanView plan={seg} />
              {totalVat > 0 && (
                <p className="note mut" style={{ marginTop: 6 }}>Rent cheques are net; VAT of {totalVat.toLocaleString('en-AE')} is collected as its own cheque(s), shown under Third Party.</p>
              )}
              {chequeDays.length === 0 && (
                <p className="note mut" style={{ marginTop: 6 }}>Tip: set preferred cheque days in Settings → Rules to standardise due dates.</p>
              )}
            </>
          )}
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
          <p className="note mut" style={{ marginTop: 10 }}>
            This saves a draft for your review — the customer is <b>not</b> notified until you press <b>Send</b> on the contract page.
          </p>
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-jade btn-sm" disabled={busy} onClick={submit}>
            <RotateCcw size={14} /> Save renewal draft
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────

/** One labelled field on the boarding-pass (Tenant / Landlord / unit type). */
function PassField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: '3px 0 0' }}>{value}</p>
    </div>
  );
}

/**
 * ContractPass — the boarding-pass style contract summary shown at the top of the
 * read-only "record" view (mirrors the customer space page's tenancy pass). Left
 * = property / unit / parties; right stub = period + annual rent. Payment + KYC
 * detail render below it (the DetailsDrawer).
 */
function ContractPass({ contract, payments, tenantHref }: { contract: ContractDetail; payments: ContractPayment[]; tenantHref?: string | null }) {
  const isRenewal = contract.contractType === 'renewal';
  const winding = contract.termination?.response === 'accepted' || !!contract.vacateAtEnd;
  const building = contract.property.buildingName ?? 'Property';
  const unitLabel = contract.unit.number ? `Unit ${contract.unit.number}` : (contract.unit.name ?? '—');
  const location = [contract.property.community, contract.property.emirate].filter(Boolean).join(' , ')
    || contract.property.fullAddress || '—';
  const landlordName = contract.landlord.name ?? contract.landlord.companyName ?? '—';
  const months = contract.durationYears ? contract.durationYears * 12 : 12;
  const badge = winding ? { bg: 'var(--brick)', label: 'Move-out scheduled' }
    : contract.status === 'active' ? { bg: 'var(--jade-deep)', label: 'Active tenancy' }
    : contract.status === 'expired' ? { bg: 'var(--mute)', label: 'Lease ended' }
    : contract.status === 'terminated' ? { bg: 'var(--brick-deep)', label: 'Terminated' }
    : { bg: 'var(--saffron-deep)', label: 'In setup' };
  // Accurate payment summary — sums the ACTUAL payment rows (gross incl. VAT):
  // rent installments + any extra "other" charges + admin/ejari/commission fees +
  // the security deposit. Falls back to the contract's net rent + computed VAT for
  // a draft that has no rows yet, so the banner is never blank.
  const aed = (n: number) => `AED ${Math.round(n || 0).toLocaleString('en-AE')}`;
  // Bounced / cancelled cheques are void (replaced) — never count them in a total.
  const activePmt = (p: ContractPayment) => !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase());
  const g = (arr: ContractPayment[]) => arr.reduce((s, p) => s + (activePmt(p) ? (Number(p.amount) || 0) : 0), 0);
  const v = (arr: ContractPayment[]) => arr.reduce((s, p) => s + (activePmt(p) ? (Number(p.vatAmount) || 0) : 0), 0);
  const rows = payments ?? [];
  const nonDeposit = rows.filter(p => p.paymentType !== 'security_deposit');
  const otherItems = nonDeposit.filter(p => p.paymentType === 'other');
  const rentItems = nonDeposit.filter(p => p.paymentType !== 'other');
  // The pass answers "what was this tenancy agreed at?", so only CONTRACTED fees
  // count — admin, Contract Registration, commission. Penalties and mid-lease
  // charges are money the lease incurred later; they stay in the ledger below
  // (and in its grand total, which answers the different question "what has been
  // charged on this lease?") but must not restate the agreed figure.
  const allFeeItems = contract.fees ?? [];
  const feeItems = allFeeItems.filter(f => !INCURRED_FEE_TYPES.has(f.paymentType ?? ''));
  const incurredGross = g(allFeeItems.filter(f => INCURRED_FEE_TYPES.has(f.paymentType ?? '')));
  const computedRentVat = contract.rentVatRate ? Math.round((contract.annualRent || 0) * Number(contract.rentVatRate)) / 100 : 0;
  const hasRentRows = rentItems.length > 0;
  const rentGross = hasRentRows ? g(rentItems) : (contract.annualRent || 0) + computedRentVat;
  const rentVat = hasRentRows ? v(rentItems) : computedRentVat;
  const otherGross = g(otherItems);
  const feesGross = g(feeItems);
  // Renewals carry the deposit from the original lease (read-only, never re-collected),
  // so it must not appear as a payable line or inflate the headline Total payable here —
  // mirrors the depositForPlan zeroing that feeds the "Payment Plan" modal. The legitimate
  // "Security deposit held (refundable, not in rent total)" ledger footer keeps showing it.
  const deposit = isRenewal ? 0 : (rows.find(p => p.paymentType === 'security_deposit')?.amount ?? contract.securityDeposit?.amount ?? 0);
  // "Other" charges hold their tax in the LABEL, not in vat_amount — a
  // sub-leased building's "5% VAT on sub-lease" row IS tax, so summing
  // vat_amount alone left it out of the header's VAT figure (see lib/chargeTax).
  const otherVat = otherItems.reduce(
    (s, p) => s + (activePmt(p) ? taxPortionOf(p, Number(p.amount) || 0) : 0), 0);
  const totalVat = rentVat + otherVat + v(feeItems);
  const totalPayable = rentGross + otherGross + feesGross + deposit;
  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.6fr 24px 1fr', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--mist-strong)', boxShadow: 'var(--sh-hero)', overflow: 'hidden', marginBottom: 22 }}>
      {/* LEFT: identity */}
      <div style={{ padding: '24px 28px', display: 'grid', gap: 14, gridTemplateRows: 'auto 1fr auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, color: 'var(--jade-deep)', textTransform: 'uppercase', letterSpacing: '0.15em', padding: '3px 7px', border: '1px solid var(--jade)', borderRadius: 4 }}>{isRenewal ? 'Renewal pass' : 'Tenancy pass'}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--mute)', letterSpacing: '0.08em' }}>{contract.ref}</span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: badge.bg, color: '#fff', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{badge.label}</span>
        </div>
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Your place · {isRenewal ? 'Renewing' : 'Leased'}</p>
          <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: '5px 0 2px', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{building}</p>
          <p style={{ fontSize: 30, fontWeight: 700, color: 'var(--jade-deep)', margin: '0 0 2px', letterSpacing: '-0.025em', lineHeight: 1 }}>{unitLabel}</p>
          {contract.unit.number && contract.unit.name && (
            <p style={{ fontSize: 12, color: 'var(--mute)', margin: '0 0 8px', fontFamily: 'monospace', letterSpacing: '0.04em' }}>Unit {contract.unit.number}</p>
          )}
          <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}><MapPin size={12} /> {location}</p>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {contract.tenant.name && (
            <PassField label="Tenant" value={
              tenantHref
                ? <Link href={tenantHref} className="chain-link" title="Open customer details">{contract.tenant.name}</Link>
                : contract.tenant.name
            } />
          )}
          <PassField label="Landlord" value={landlordName} />
          {contract.unit.type && <PassField label={contract.unit.type.replace(/_/g, ' ')} value={contract.unit.bedrooms ? `${contract.unit.bedrooms} BR` : '—'} />}
        </div>
      </div>
      {/* PERFORATION */}
      <div style={{ position: 'relative', display: 'grid', placeItems: 'center', borderLeft: '1px dashed var(--mist-strong)', borderRight: '1px dashed var(--mist-strong)' }}>
        <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', width: 24, height: 24, background: 'var(--surface)', borderRadius: '50%', border: '1px solid var(--mist-strong)' }} />
        <div style={{ position: 'absolute', bottom: -12, left: '50%', transform: 'translateX(-50%)', width: 24, height: 24, background: 'var(--surface)', borderRadius: '50%', border: '1px solid var(--mist-strong)' }} />
      </div>
      {/* RIGHT: stub */}
      <div style={{ padding: '24px 22px', background: '#f4efe8', display: 'grid', gap: 14, gridAutoRows: 'min-content' }}>
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>{isRenewal ? 'Renewal period' : 'Lease period'}</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '4px 0 0', letterSpacing: '-0.015em' }}>{fmtDate(contract.startDate)}</p>
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--mute)', margin: '2px 0' }}>↓ {months} months</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-0.015em' }}>{fmtDate(contract.endDate)}</p>
        </div>
        <div style={{ borderTop: '1px dashed var(--mist-strong)', paddingTop: 12 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>Payment summary</p>
          <div style={{ display: 'grid', gap: 3, marginTop: 6, fontSize: 11, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Rent{rentVat > 0 ? ' (incl. VAT)' : ''}</span><b style={{ color: 'var(--ink)' }}>{rentGross > 0 ? aed(rentGross) : '—'}</b></div>
            {otherGross > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Other charges</span><b style={{ color: 'var(--ink)' }}>{aed(otherGross)}</b></div>}
            {feesGross > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Fees (incl. VAT)</span><b style={{ color: 'var(--ink)' }}>{aed(feesGross)}</b></div>}
            {!isRenewal && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Security deposit</span><b style={{ color: 'var(--ink)' }}>{deposit > 0 ? aed(deposit) : '—'}</b></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px dashed var(--mist-strong)', paddingTop: 4, marginTop: 2 }}><span style={{ fontWeight: 700 }}>Total payable</span><b style={{ color: 'var(--jade-deep)', fontSize: 13 }}>{aed(totalPayable)}</b></div>
            {totalVat > 0 && <div style={{ fontSize: 9, color: 'var(--mute)', textAlign: 'right' }}>incl. {aed(totalVat)} VAT</div>}
            {/* The ledger's grand total below legitimately exceeds this one when the
                lease has incurred penalties. Say so, or the two figures read as a
                bug and someone "fixes" the pass back into overstating the rent. */}
            {incurredGross > 0 && <div style={{ fontSize: 9, color: 'var(--mute)', textAlign: 'right' }}>+ {aed(incurredGross)} charges incurred — see Fees</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The contract detail component, rendered in one of three VIEWS:
 *   - 'full'     — the legacy whole page (default; unchanged behaviour).
 *   - 'pipeline' — the setup workflow only (stepper + step actions + modals).
 *                  Mounted INLINE inside the Operations worklist card.
 *   - 'record'   — the read-only contract record: header, summary, Payments,
 *                  Documents. This is what the standalone contract page shows.
 * `contractId` lets it be mounted outside its own route (e.g. in Operations);
 * it falls back to the route param on its own page.
 */
export function ContractV2View({ contractId: cidProp, view = 'full' }: { contractId?: number; view?: 'full' | 'pipeline' | 'record' }) {
  const params = useParams<{ id: string }>();
  const id = cidProp != null ? String(cidProp) : params?.id;
  const showPipeline = view !== 'record';
  const showRecord = view !== 'pipeline';
  const router = useRouter();
  // Context-aware navigation base: this page is reused by the manager route
  // (/dashboard/manager/contracts/[id]) via re-export. When loaded there, all
  // internal contract links must stay within the manager area instead of the
  // landlord (rental-provider) area. Backend endpoints are already role-aware.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isManagerView = pathname.startsWith('/dashboard/manager');
  const contractsBase = pathname.startsWith('/dashboard/manager')
    ? '/dashboard/manager/contracts'
    : '/rental-provider/dashboard/contracts';
  // Preserve the origin: sub-pages (settlement / inspection) read `from` so their
  // Back button returns to wherever we are now — the Operations pipeline detail
  // when opened from there, otherwise the lease record. (Fixes "back always goes
  // to the lease" when a record is worked from Operations.)
  const fromQ = `from=${encodeURIComponent(pathname)}`;
  // Manager permission gate for the Edit affordance — RP owners always see it,
  // managers only when they hold canManageAgreements for this contract's landlord.
  const { canForRp: managerCanForRp } = useManagerPermissions();
  const { user: authUser } = useAuth();
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [signatures, setSignatures] = useState<{ role: string; signedAt?: string; method?: string }[]>([]);
  const [paymentRefs, setPaymentRefs] = useState<PaymentRefs>(EMPTY_PAYMENT_REFS);
  const [notes, setNotes] = useState<ContractNote[]>([]);
  // Optional comment the RP types when accepting / rejecting a customer's
  // termination request — logged to the Notes journal alongside the decision.
  const [respComment, setRespComment] = useState('');
  const [moveInInsp, setMoveInInsp] = useState<MoveInInsp | null>(null);
  const [moveOutInsp, setMoveOutInsp] = useState<MoveInInsp | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<DerivedState['settlementStatus']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<StepKey | null>(null);
  const [modal, setModal] = useState<'sign' | 'terminate' | 'renew' | 'direct-terminate' | 'cancel-lease' | 'reject-utility' | null>(null);

  // Deep-link from the Leases (record) view: ?action=renew / ?action=terminate
  // jumps here into the full Operations view and opens that action directly, so
  // the lease's "Propose renewal" / "Terminate" buttons land on the live flow.
  const actionOpenedRef = useRef(false);
  useEffect(() => {
    if (view === 'record' || !contract || actionOpenedRef.current) return;
    const action = searchParams.get('action');
    if (action === 'renew') { actionOpenedRef.current = true; setModal('renew'); }
    else if (action === 'terminate') { actionOpenedRef.current = true; setModal('direct-terminate'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);
  // Closing a deep-linked modal (?action=renew / ?action=terminate) must also drop
  // `action` from the URL — otherwise a refresh or back-nav re-opens it every time.
  const closeDeepLinkedModal = useCallback(() => {
    setModal(null);
    if (!searchParams.get('action')) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete('action');
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false });
  }, [searchParams, pathname, router]);
  // Ejari / utility upload (ported from the old page so v2 is self-contained).
  const ejariInputRef = useRef<HTMLInputElement>(null);
  const utilityInputRef = useRef<HTMLInputElement>(null);
  // Renewal Cheques/PDC step — RP uploads the Payment Advice on the customer's
  // behalf (paper-collected cheques, no portal submission).
  const chequesInputRef = useRef<HTMLInputElement>(null);
  // Wind-down doc uploads (move-out report + utility close-out). One shared
  // hidden input + a "pending kind" so a single onChange routes to the right key.
  const windDownInputRef = useRef<HTMLInputElement>(null);
  const [windDownKind, setWindDownKind] = useState<'move_in' | 'move_out' | 'clearance' | 'final_bill' | null>(null);
  const [ejariUploading, setEjariUploading] = useState(false);
  const [utilityUploading, setUtilityUploading] = useState(false);
  const [chequesUploading, setChequesUploading] = useState(false);
  const [windDownUploading, setWindDownUploading] = useState(false);

  const reload = useCallback(() => {
    if (!id) return;
    setLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetch(`/api/contracts/${id}`, { credentials: 'include', signal: ctrl.signal }).then(r => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json() as Promise<ContractDetail>;
      }),
      fetch(`/api/contracts/${id}/signatures`, { credentials: 'include', signal: ctrl.signal }).then(r =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([data, sigs]) => {
        // For a company tenant the lease party is the entity, so surface the
        // company name as the displayed tenant name (every label on this page
        // reads contract.tenant.name). entityType/companyName are kept intact.
        const normalized: ContractDetail = data?.tenant
          ? { ...data, tenant: { ...data.tenant, name: tenantDisplayName(data.tenant) } }
          : data;
        setContract(normalized);
        setSignatures(Array.isArray(sigs) ? sigs : []);
        // RP reconciliation refs — plan number + per-payment receipt numbers.
        fetchPaymentRefs(id, ctrl.signal).then(setPaymentRefs).catch(() => { /* non-fatal */ });
        fetch(`/api/contracts/${id}/inspection?type=move_in`, { credentials: 'include', signal: ctrl.signal })
          .then(r => (r.ok ? r.json() : null))
          .then((insp: MoveInInsp | null) => setMoveInInsp(insp ?? null))
          .catch(() => null);
        // Load the move-out inspection + settlement once the lease is winding
        // down — either an accepted early termination, or the customer declined
        // the renewal to vacate (move-out at the scheduled lease end).
        const winding = (data.termination?.response === 'accepted' && data.status === 'active')
          || !!data.vacateAtEnd
          || data.termination?.method === 'direct';
        // The wind-down (move-out inspection + deposit settlement) lives on the
        // ACTIVE lease. When the RP opened the archived renewal proposal whose
        // parent is vacating, pull the status from the parent so the declined
        // renewal can show "declined → move-out → settlement" in one place.
        const isArchivedVacateChild = !!data.vacateAtEnd
          && data.contractActive === false && !!data.parentContractId;
        const windDownId = isArchivedVacateChild ? data.parentContractId : id;
        if (winding) {
          fetch(`/api/contracts/${windDownId}/inspection?type=move_out`, { credentials: 'include', signal: ctrl.signal })
            .then(r => (r.ok ? r.json() : null))
            .then((insp: MoveInInsp | null) => setMoveOutInsp(insp ?? null))
            .catch(() => null);
          fetch(`/api/contracts/${windDownId}/settlement`, { credentials: 'include', signal: ctrl.signal })
            .then(r => (r.ok ? r.json() : null))
            .then((s: { status?: DerivedState['settlementStatus']; exists?: boolean } | null) =>
              setSettlementStatus(s && s.exists ? (s.status ?? null) : null))
            .catch(() => null);
        } else {
          setMoveOutInsp(null);
          setSettlementStatus(null);
        }
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== 'AbortError') {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  // Tenancy notes log — loaded independently of the main contract fetch so the
  // journal renders even if a sub-fetch hiccups.
  const loadNotes = useCallback(() => {
    if (!id) return;
    fetch(`/api/contracts/${id}/notes`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: ContractNote[]) => setNotes(Array.isArray(rows) ? rows : []))
      .catch(() => undefined);
  }, [id]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const onAddNote = async (body: string) => {
    const res = await fetch(`/api/contracts/${id}/notes`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Failed to save note');
    const created = await res.json() as ContractNote;
    setNotes(prev => [created, ...prev]);
  };

  const derived = useMemo(
    () => contract ? deriveState(contract, signatures, moveInInsp, moveOutInsp, settlementStatus) : null,
    [contract, signatures, moveInInsp, moveOutInsp, settlementStatus],
  );

  // Reject-document dialog state. Declared HERE, above the loading/error returns
  // below — every hook has to run on every render, and a first paint that returns
  // early at "Loading contract…" would otherwise skip these four and change the
  // hook order on the next render. The handlers that use them are plain functions
  // and can stay down with the other action callbacks.
  const [rejectTarget, setRejectTarget] = useState<{ id: number; label: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectErr, setRejectErr] = useState<string | null>(null);

  // Loading / error
  if (loading && !contract) {
    return <div className="quest-page"><div style={{ padding: 40, textAlign: 'center', color: 'var(--mute)' }}>Loading contract…</div><GlobalStyle /></div>;
  }
  if (error || !contract || !derived) {
    return (
      <div className="quest-page">
        <div style={{ padding: 40, textAlign: 'center' }}>
          <AlertCircle size={36} style={{ color: 'var(--brick)' }} />
          <p style={{ fontWeight: 700, marginTop: 12 }}>Contract not found</p>
          <p className="note">{error ?? 'No data'}</p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => router.back()}>← Go back</button>
        </div>
        <GlobalStyle />
      </div>
    );
  }

  const mode: 'new' | 'renewal' = contract.contractType === 'renewal' ? 'renewal' : 'new';
  // Wind-down (Phase 6c): surface the actionable move-out inspection + deposit
  // settlement steps when the lease is ending — either an accepted early
  // termination (still active), or the customer declined the renewal to vacate
  // (move-out at the scheduled lease end). `vacateAtEnd` carries through expiry.
  // The move-out + settlement STEPS belong to the live lease being wound down.
  // The archived renewal proposal mirrors `vacateAtEnd` (from its parent) only so
  // its detail can show the declined-renewal summary — it must NOT render empty
  // wind-down steps, so gate the steps on the contract still being active.
  // A direct termination keeps the wind-down visible while active AND after it
  // closes to terminated (the lease only flips terminated once settlement is paid).
  const isWinding = (contract.termination?.response === 'accepted' && contract.status === 'active')
    || (!!contract.vacateAtEnd && contract.contractActive !== false)
    || contract.termination?.method === 'direct';
  const baseSteps = mode === 'renewal' ? STEPS_RENEWAL : STEPS_NEW;
  const steps = isWinding ? [...baseSteps, MOVE_OUT_STEP, CLOSEOUT_STEP, SETTLEMENT_STEP] : baseSteps;
  const doneArr = steps.map(s => isDone(s.key, derived));
  const firstTodo = doneArr.findIndex(x => !x);
  let autoIdx = firstTodo >= 0 ? firstTodo : steps.length - 1;
  // For a winding-down lease the setup steps are historical (the lease already
  // activated) — focus the RP on the live wind-down work (move-out → settlement),
  // not a setup step that might read incomplete. Default to the first unfinished
  // wind-down step (move-out, else closeout / settlement).
  if (isWinding) {
    const moveOutIdx = steps.findIndex(s => s.key === 'moveout');
    if (moveOutIdx >= 0) {
      const windDownTodo = steps.findIndex((s, i) => i >= moveOutIdx && !doneArr[i]);
      autoIdx = windDownTodo >= 0 ? windDownTodo : moveOutIdx;
    }
  }
  const selIdx = selKey ? Math.max(0, steps.findIndex(s => s.key === selKey)) : autoIdx;
  const selStep = steps[selIdx];

  // Lifecycle dead-ends — only the ARCHIVED renewal proposal row is a dead-end.
  // An active lease whose own renewal was declined (incl. decline-to-vacate) is
  // NOT a dead-end: it keeps running to its end and shows the move-out wind-down.
  const isDeclinedRenewal = contract.contractType === 'renewal'
    && contract.renewalAccepted === 'rejected'
    && contract.contractActive === false;
  const isSuperseded = contract.contractType !== 'renewal' && !contract.contractActive && (contract.status === 'pending' || contract.status === 'issued');
  // The RP cancelled this renewal before it started — the next term is void and
  // the parent lease keeps running. Another dead-end row: no setup work left.
  const isCancelledRenewal = isRenewalChild(contract)
    && contract.status === 'terminated'
    && contract.termination?.method === 'cancelled';

  // Actions
  const setLocalState = (patch: Partial<DerivedState>) => {
    if (!contract || !derived) return;
    // Local-only override — useful for "mark as already on file" before
    // the server round-trip lands.
    const merged: DerivedState = { ...derived, ...patch };
    if (patch.tenantSigned !== undefined) {
      setSignatures(p => {
        if (patch.tenantSigned && !p.some(s => s.role === 'tenant')) return [...p, { role: 'tenant' }];
        if (!patch.tenantSigned) return p.filter(s => s.role !== 'tenant');
        return p;
      });
    }
    if (patch.landlordSigned !== undefined) {
      setSignatures(p => {
        if (patch.landlordSigned && !p.some(s => s.role === 'landlord')) return [...p, { role: 'landlord' }];
        if (!patch.landlordSigned) return p.filter(s => s.role !== 'landlord');
        return p;
      });
    }
    if (patch.moveIn) {
      setMoveInInsp(p => ({
        ...p,
        rpSubmittedAt: patch.moveIn!.rpSubmitted ? (p?.rpSubmittedAt ?? new Date().toISOString()) : null,
        tenantSig:     patch.moveIn!.tenantSig    ? (p?.tenantSig    ?? 'data:image/png;base64,…') : null,
        rpCounterSig:  patch.moveIn!.rpCounterSig ? (p?.rpCounterSig ?? 'data:image/png;base64,…') : null,
      }));
    }
    if (patch.status || patch.ejariStatus || patch.utilityDoc !== undefined) {
      setContract(c => c ? { ...c, ...(patch.status ? { status: patch.status } : {}), ...(patch.ejariStatus ? { ejariStatus: patch.ejariStatus } : {}), ...(patch.utilityDoc !== undefined ? { utilityStatus: patch.utilityDoc ? 'submitted' : null } : {}) } : c);
    }
    void merged;
  };

  const patchContract = (patch: Partial<ContractDetail>) => setContract(c => c ? { ...c, ...patch } : c);

  const onActivate = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/activate`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Activate failed: ${res.status}`);
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Activate failed'); }
  };
  const onIssue = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/issue`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Issue failed: ${res.status}`);
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Issue failed'); }
  };
  const onRevertToDraft = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/revert`, { method: 'PATCH', credentials: 'include' });
      if (res.ok) void reload();
      else setLocalState({ status: 'pending' });
    } catch { setLocalState({ status: 'pending' }); }
  };

  // Send the saved renewal draft to the customer (notifies them) or discard it.
  const onRenewalDraft = async (action: 'send' | 'discard') => {
    if (action === 'discard' && !window.confirm('Discard this renewal draft? Its planned cheques will be voided.')) return;
    try {
      const res = action === 'send'
        ? await fetch(`/api/contracts/${contract.id}/renewal/send`, { method: 'PATCH', credentials: 'include' })
        : await fetch(`/api/contracts/${contract.id}/renewal/draft`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        window.alert(body?.message ?? `Could not ${action} the renewal (${res.status}).`);
        return;
      }
      void reload();
    } catch {
      window.alert(`Could not ${action} the renewal.`);
    }
  };

  // Send an unsent renewal DRAFT to the customer directly from the draft (child)
  // contract page. The send endpoint lives on the PARENT lease that owns the proposal.
  const onSendRenewalDraft = async () => {
    const pid = contract.parentContractId;
    if (!pid) return;
    try {
      const res = await fetch(`/api/contracts/${pid}/renewal/send`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        window.alert(b?.message ?? `Could not send the renewal (${res.status}).`);
        return;
      }
      void reload();
    } catch {
      window.alert('Could not send the renewal.');
    }
  };
  // Undo "settlement sent": pull the settlement back to draft so the figures can
  // be corrected and re-sent. Backend rejects once the customer has agreed/paid.
  const onUnsendSettlement = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/settlement/unsend`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b?.message ?? 'Could not undo the settlement.');
        return;
      }
      void reload();
    } catch { alert('Unexpected error. Please try again.'); }
  };

  // Undo a termination — reverts the lease to active (only while it hasn't
  // closed out). Any move-out / settlement draft started so far is kept but no
  // longer applies.
  const onCancelTermination = async () => {
    if (!window.confirm('Cancel this termination and return the lease to active? The move-out / settlement is no longer required.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/cancel`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b?.message ?? 'Could not cancel the termination.');
        return;
      }
      void reload();
    } catch { alert('Unexpected error. Please try again.'); }
  };

  // Undo a pre-active CANCELLATION — rolls the lease back to its previous state
  // (issued + active, cheques reinstated). Same endpoint as a termination undo;
  // the backend detects method='cancelled' and restores instead of reactivating.
  const onRestoreCancelled = async () => {
    if (!window.confirm('Restore this cancelled lease? It returns to its issued state and its cheques are reinstated.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/cancel`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b?.message ?? 'Could not restore the lease.');
        return;
      }
      void reload();
    } catch { alert('Unexpected error. Please try again.'); }
  };
  // Upload a file to GCS/local via presigned URL, then record the document row.
  async function uploadContractDoc(
    file: File,
    displayName: string,
    keyPrefix: string,
    opts?: { ownerType?: 'tenancy_contract' | 'customer'; ownerId?: number; category?: string; fixedKey?: boolean },
  ) {
    if (!contract) return;
    // `fixedKey` keeps the documentKey stable so the backend UPSERTs the same
    // row (one live doc per owner+key) — used when replacing a doc the customer
    // also reads (e.g. their utility proof), instead of stacking timestamped copies.
    const docKey = opts?.fixedKey ? keyPrefix : `${keyPrefix}_${Date.now()}`;
    const ownerType = opts?.ownerType ?? 'tenancy_contract';
    const ownerId = opts?.ownerId ?? contract.id;
    const category = opts?.category ?? 'property';
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
    });
    if (!urlRes.ok) throw new Error('Failed to get upload URL');
    // fileKey MUST be persisted as s3Key — the bucket is private and the
    // backend can only re-sign View URLs for rows that carry their key.
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey?: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!putRes.ok) throw new Error('File upload failed');
    const docRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, category, documentKey: docKey, displayName, fileUrl, mimeType: file.type || 'application/octet-stream', s3Key: fileKey, isVisibleToTenant: true }),
    });
    if (!docRes.ok) throw new Error('Failed to record document');
  }

  const onUploadEjari = () => ejariInputRef.current?.click();
  const onEjariFilePicked = async (file: File) => {
    setEjariUploading(true);
    try {
      await uploadContractDoc(file, 'Contract Registration Certificate', 'ejari_certificate');
      // Register Ejari once the certificate is on file.
      await fetch(`/api/contracts/${contract.id}/ejari`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ejariStatus: 'registered' }),
      });
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Contract Registration Certificate upload failed'); }
    finally { setEjariUploading(false); if (ejariInputRef.current) ejariInputRef.current.value = ''; }
  };
  const onMarkEjari = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/mark-registered`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark Contract Registration failed: ${res.status}`);
      const data = await res.json().catch(() => ({ matched: true }));
      if (data.matched === false) {
        alert('No Contract Registration Certificate is on file for this lease period yet. Please upload the certificate.');
        return;
      }
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not mark the Contract Registration Certificate as on file.');
    }
  };
  const onUploadUtility = () => utilityInputRef.current?.click();
  const onUtilityFilePicked = async (file: File) => {
    setUtilityUploading(true);
    try {
      // Write the SAME document the customer reads (their utility_proof_of_payment)
      // so an RP-uploaded replacement is reflected on both sides, not stored under
      // a separate contract-owned key the customer never sees. Falls back to a
      // contract-owned doc only if the tenant profile id is somehow missing.
      const tenantProfileId = contract.tenant.id;
      if (tenantProfileId != null) {
        await uploadContractDoc(file, 'Utility Proof of Payment', 'utility_proof_of_payment',
          { ownerType: 'customer', ownerId: tenantProfileId, category: 'payment', fixedKey: true });
      } else {
        await uploadContractDoc(file, 'Utility Registration', 'utility_registration');
      }
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Utility upload failed'); }
    finally { setUtilityUploading(false); if (utilityInputRef.current) utilityInputRef.current.value = ''; }
  };
  const onMarkUtility = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/utility/mark-on-file`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark utility failed: ${res.status}`);
      void reload();
    } catch { setLocalState({ utilityDoc: true }); }
  };
  // Renewal Cheques/PDC step — RP either uploads the Payment Advice on the
  // customer's behalf, or, once it's already attached, marks the cheques as
  // already on file (paper-collected) so the wait for a portal submission is
  // skipped and the step opens straight into the recording table.
  const onUploadCheques = () => chequesInputRef.current?.click();
  const onChequesFilePicked = async (file: File) => {
    setChequesUploading(true);
    try {
      await uploadContractDoc(file, 'Payment Confirmation', 'payment_advice');
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Payment Confirmation upload failed'); }
    finally { setChequesUploading(false); if (chequesInputRef.current) chequesInputRef.current.value = ''; }
  };
  const onMarkChequesOnFile = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/cheques/mark-on-file`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark cheques failed: ${res.status}`);
      const data = await res.json().catch(() => ({ matched: true }));
      if (data.matched === false) {
        alert('No Payment Confirmation is on file for this lease yet. Please upload the cheques first.');
        return;
      }
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not mark the cheques as already on file.');
    }
  };
  // Bypass digital signing for a paper-signed / imported lease: record BOTH
  // signatures as on-file (no signature image). Mirrors the Ejari/Utility
  // "Mark as already on file" actions; the step re-renders into the
  // "Signed on paper — on file" panel after reload.
  const onMarkSignedOnFile = async () => {
    if (!window.confirm('Mark this lease as signed on paper (already on file)? This records both signatures as on-file — use it for imported or physically-signed leases, not for contracts still awaiting a digital signature.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/sign/mark-on-file`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark signed-on-file failed: ${res.status}`);
      void reload();
    } catch (e) {
      // Optimistic fallback so the step reflects the intent before the next
      // reload; the on-file panel only confirms once the server round-trip lands.
      setLocalState({ tenantSigned: true, landlordSigned: true });
      void e;
    }
  };

  // ── Escape-hatch document uploads (move-in / move-out report + utility
  // close-out) ── These stand in for a full inspection/workflow when clearing
  // the backlog on an imported or active lease, so they do NOT gate on lock /
  // readOnlyWorkflow. A single hidden input is reused; `windDownKind` routes the
  // picked file to the right doc key.
  const pickWindDownDoc = (kind: 'move_in' | 'move_out' | 'clearance' | 'final_bill') => {
    setWindDownKind(kind);
    windDownInputRef.current?.click();
  };
  const onUploadMoveInDoc = () => pickWindDownDoc('move_in');
  const onUploadMoveOutDoc = () => pickWindDownDoc('move_out');
  const onUploadCloseoutClearance = () => pickWindDownDoc('clearance');
  const onUploadCloseoutFinalBill = () => pickWindDownDoc('final_bill');
  const onWindDownFilePicked = async (file: File, kind: 'move_in' | 'move_out' | 'clearance' | 'final_bill') => {
    const spec = {
      move_in:    { name: 'Move-in report',      key: 'move_in_report' },
      move_out:   { name: 'Move-out report',     key: 'move_out_report' },
      clearance:  { name: 'Utility Clearance',   key: 'utility_clearance' },
      final_bill: { name: 'Utility Final Bill',  key: 'utility_final_bill' },
    }[kind];
    setWindDownUploading(true);
    try {
      await uploadContractDoc(file, spec.name, spec.key);
      // Guide the RP to the next step after each upload: the move-in document
      // completes Stop 5 (the lease is already active — just reload in place);
      // the move-out document advances to the utility closeout; once both
      // closeout docs are in, advance to the settlement.
      if (kind === 'move_out') {
        setSelKey('closeout');
      } else if (kind === 'clearance' && derived?.closeout.finalBill) {
        setSelKey('settlement');
      } else if (kind === 'final_bill' && derived?.closeout.clearance) {
        setSelKey('settlement');
      }
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setWindDownUploading(false); setWindDownKind(null); if (windDownInputRef.current) windDownInputRef.current.value = ''; }
  };
  const onVerifyUtility = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/utility/verify`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Confirm utility failed: ${res.status}`);
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not confirm utility'); }
  };
  const onRejectUtility = () => setModal('reject-utility');

  // KYC approve / reject — use the dedicated verify/reject endpoints. A PATCH
  // with a `status` field is rejected by the API's whitelist validation (it's
  // not on UpdateDocumentDto) and silently does nothing, so this drawer's
  // approve/reject previously never persisted. Reject captures a reason that the
  // customer sees as their re-upload prompt (mirrors the leads page).
  const onApproveDoc = (id: number) => {
    fetch(`/api/documents/${id}/verify`, { method: 'POST', credentials: 'include' })
      .then(r => { if (r.ok) void reload(); }).catch(() => {});
  };
  // Same endpoint, but the RP also records the expiry printed on the document. Expiry is
  // captured RP-side at review time — /documents/:id/verify is role-guarded, so the date
  // can only ever be set by someone who reviewed the copy.
  const onApproveDocWithExpiry = async (id: number, expiryDate: string) => {
    const res = await fetch(`/api/documents/${id}/verify`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiryDate }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    await reload();
  };
  // Reject opens the app's own dialog, not window.prompt(). The native prompt was
  // unstyled browser chrome in the middle of a designed page, it cannot say WHICH
  // document is being rejected, its Cancel returns null and looked identical to a
  // silent failure, and a rejection is the one action here the customer actually
  // reads — the reason becomes their re-upload instruction, so it deserves a real
  // field. Mirrors the reject dialog on the lead documents step. (Its state is
  // declared above the loading/error returns — see the Rules-of-Hooks note there.)
  const onRejectDoc = (id: number, label?: string) => {
    setRejectReason(''); setRejectErr(null);
    setRejectTarget({ id, label: label?.trim() || 'this document' });
  };
  const confirmRejectDoc = async () => {
    if (!rejectTarget) return;
    setRejectBusy(true); setRejectErr(null);
    try {
      const res = await fetch(`/api/documents/${rejectTarget.id}/reject`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rejectReason.trim() ? { reason: rejectReason.trim() } : {}),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({} as { message?: string }));
        throw new Error((b as { message?: string }).message ?? `Could not reject (${res.status})`);
      }
      setRejectTarget(null);
      await reload();
    } catch (e) {
      // Surfaced in the dialog instead of vanishing — the old handler swallowed
      // every failure, so a reject that never landed looked exactly like one that did.
      setRejectErr(e instanceof Error ? e.message : 'Could not reject');
    } finally {
      setRejectBusy(false);
    }
  };

  // ── Flow 1: record payment + update status ──
  // POST /api/contracts/:id/payments  (mirrors old page addPaymentInstalment)
  const onRecordPayment = async (body: {
    description?: string; amount: number; vatAmount?: number; paymentType?: string; paymentMethod?: string;
    chequeNumber?: string; transactionDate?: string; chequeStatus?: string;
    /** The cheque on this contract that this payment makes good — one that
     *  bounced, or one the customer swapped. */
    replacesPaymentId?: number | null;
    /** Raise the bounce / replacement charge in the same request. */
    replacementFee?: number;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/payments`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };
  // PATCH /api/contracts/:id/payments/:paymentId — status, or correct amount / VAT / reference / description.
  const onUpdatePayment = async (paymentId: number, patch: {
    chequeStatus?: string; amount?: number; vatAmount?: number; chequeNumber?: string | null;
    description?: string | null; transactionDate?: string | null; paymentMethod?: string; paymentType?: string;
    documentId?: number | null; replacesPaymentId?: number | null;
    /** Why a cheque is being cancelled (migration 0245). */
    cancellationReason?: string | null;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/payments/${paymentId}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };
  // DELETE /api/contracts/:id/payments/:paymentId — remove a fee / payment line.
  const onDeletePayment = async (paymentId: number) => {
    const res = await fetch(`/api/contracts/${contract.id}/payments/${paymentId}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };

  // Edit a held security deposit — PATCH /api/contracts/:id/deposits/:depositId
  const onUpdateDeposit = async (depositId: number, patch: {
    chequeStatus?: string; paymentMethod?: string | null; dueDate?: string | null;
    chequeNumber?: string | null; amount?: number; depositStatus?: string;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/deposits/${depositId}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };

  // Record a deposit on a lease that never had one. Until this existed the
  // register could only be added to by the June import, so a deposit collected
  // outside the lead payment plan had nowhere to go — the landlord's own tracker
  // lists one (Unit 315, AED 5,000) that the system has never held.
  const onCreateDeposit = async (body: {
    amount: number; chequeNumber?: string | null; paymentMethod?: string | null;
    dueDate?: string | null; chequeStatus?: string;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/deposits`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };

  // ── Flow 2: edit clauses ──  PATCH /api/contracts/:id/clauses
  const onSaveClauses = async (customClauses: string[], notes: string | null) => {
    const res = await fetch(`/api/contracts/${contract.id}/clauses`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customClauses, notes }),
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    void reload();
  };

  // ── Flow 3: confirm PDCs ──  PATCH /api/contracts/:id/confirm-pdc
  const onConfirmPdc = async () => {
    const res = await fetch(`/api/contracts/${contract.id}/confirm-pdc`, {
      method: 'PATCH', credentials: 'include',
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    void reload();
  };

  const onAcceptDocs = async () => {
    const res = await fetch(`/api/contracts/${contract.id}/renewal/accept-docs`, {
      method: 'PATCH', credentials: 'include',
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    void reload();
  };

  // ── Flow 4: Ejari reset / redo ──  PATCH /api/contracts/:id/ejari/reset
  const onRedoEjari = async () => {
    if (!confirm('Roll the tenancy back to issued and clear the existing Contract Registration? You will then be able to upload a corrected certificate.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/reset`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to reset Contract Registration'); }
  };

  // ── Flow 5: upload KYC / contract document ──
  // upload-url → PUT → POST /api/documents.
  //
  // The RP's chosen SECTION decides the owner, because the section is where the
  // document lives rather than how it is labelled:
  //   kyc     → owner_type 'customer'         — travels with the customer, so it
  //             shows on their profile and in every lease binder of theirs
  //   tenancy → owner_type 'tenancy_contract' — this lease only
  // Either way the contract detail API returns both owner scopes, so a KYC
  // upload made here still appears on this page.
  const onUploadDoc = async (
    file: File,
    meta: { key: string; label: string; category: string; section: DocSection },
    visibleToTenant: boolean,
    expiryDate: string,
    replaceOf?: DocReplaceTarget,
  ) => {
    const asKyc = meta.section === 'kyc';
    if (asKyc && !replaceOf && !contract.tenant.id) {
      throw new Error('This contract has no linked customer, so the document cannot be filed as customer KYC.');
    }
    // A replacement is posted under the row it supersedes — its OWN owner and
    // key — so POST /documents' same-key upsert overwrites that row (id kept:
    // payments.document_id / audit rows still point at it) instead of adding a
    // fresh `${key}_${Date.now()}` row beside it. Anything else is a new file.
    const ownerType = replaceOf?.ownerType ?? (asKyc ? 'customer' : 'tenancy_contract');
    const ownerId = replaceOf?.ownerId ?? (asKyc ? contract.tenant.id! : contract.id);
    const docKey = replaceOf?.documentKey ?? `${meta.key}_${Date.now()}`;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
    });
    if (!urlRes.ok) {
      const b = await urlRes.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${urlRes.status}`));
    }
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey?: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
    const docBody: Record<string, unknown> = {
      ownerType, ownerId, category: meta.category, section: meta.section,
      documentKey: docKey, displayName: meta.label, fileUrl,
      // s3Key lets the backend re-sign View URLs (private bucket)
      s3Key: fileKey,
      mimeType: file.type || 'application/octet-stream', isVisibleToTenant: visibleToTenant,
    };
    if (expiryDate) docBody.expiryDate = expiryDate;
    const docRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(docBody),
    });
    if (!docRes.ok) {
      const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${docRes.status}`));
    }
    void reload();
  };

  // ── Flow 6: request a document from the tenant ──  POST /api/documents/request
  const onRequestDoc = async (label: string, notes: string) => {
    if (!contract.tenant.id) throw new Error('This contract has no linked customer.');
    // Ask under the CATALOGUE's key for this document, so the request lands on
    // the same checklist row the matching upload would. Slugifying the label
    // instead — which is what this did — meant requesting "Contract
    // Registration Certificate" wrote `contract_registration_certificate` while
    // uploading it wrote `ejari_certificate`: identical wording on screen, two
    // unrelated rows in the database. Off-catalogue names still get their
    // deterministic `additional_*` key.
    // The `_<timestamp>` suffix is kept: it is how a re-request creates a fresh
    // row rather than colliding with the existing one, and every reader strips
    // it (matchDocs' baseKey) before comparing.
    const docKey = `${requestedDocKey(label)}_${Date.now()}`;
    const res = await fetch('/api/documents/request', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'customer',
        ownerId: contract.tenant.id,
        documentKey: docKey,
        displayName: label,
        category: 'contract',
        notes: notes || undefined,
      }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${res.status}`));
    }
    void reload();
  };

  // Termination response
  const respondToTermination = async (response: 'accepted' | 'rejected') => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/respond`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, comment: respComment.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`Respond failed: ${res.status}`);
      setRespComment('');
      void reload();
      loadNotes();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Respond failed'); }
  };

  // Once the tenancy reaches a TERMINAL lifecycle (expired / terminated) the
  // workflow steps freeze — no "Revert to draft", no "Re-upload" on Ejari /
  // Utility, no undo toggles on the Sign step: an ended lease's activation
  // history must not be rewritten after the fact.
  //
  // An ACTIVE lease is deliberately NOT frozen: imported / synced leases are
  // routinely activated with setup steps still incomplete (the "Needs
  // activation" banner explicitly promises you can backfill documents and
  // cheques afterwards), so the RP must still be able to clear that backlog —
  // register Ejari, confirm utility, upload the move-in document, and correct
  // signatures on a live lease. The Documents drawer (KYC approve/reject) and
  // the active step's live-management actions (record payment, propose renewal,
  // request termination) were already always editable.
  const readOnlyWorkflow = contract.status === 'expired' || contract.status === 'terminated';

  // Term-edit lock. Once any party has really signed (method 'online' / 'paper'),
  // the executed agreement is read-only — the Edit affordance is hidden and the
  // backend PATCH /contracts/:id rejects the change. Imported / paper leases
  // recorded only as "signed on file" stay editable for data correction.
  // (Optimistic local sig entries carry no method → treated as not-yet-locking;
  // a real sign triggers reload(), which brings the authoritative method.)
  const editLocked = signatures.some(s => s.method != null && s.method !== 'on_file');

  // Manager permission gates — RP owners always see every affordance; a manager
  // only sees one they hold the relevant flag for, for THIS contract's landlord.
  // Mirrors the Edit gate's exact mechanism (isManagerView + managerCanForRp +
  // the rp scope from ?rp= falling back to the contract's landlord id). The
  // backend already 403s a manager who lacks the flag — this just hides the
  // button so they never see an action they can't take.
  // `?rp=` arrives EMPTY (not absent) when the manager is on "All landlords", so
  // fall back on falsy — `??` would keep the empty string and gate every action off.
  const rpScope = searchParams.get('rp') || (contract.landlord?.id != null ? String(contract.landlord.id) : '');
  const mgrCan = (flag: Parameters<typeof managerCanForRp>[0]) =>
    !isManagerView || (rpScope !== '' && managerCanForRp(flag, Number(rpScope)));
  const perms: ActorPerms = {
    renewals:      mgrCan('canManageRenewals'),
    agreements:    mgrCan('canManageAgreements'),
    // "Sign as Landlord" needs POA in addition to signing rights (a manager may
    // only sign the landlord's signature with power of attorney).
    signLandlord:  mgrCan('canSignDocuments') && mgrCan('canActAsPoa'),
    // Sending the owner their signing link only invites them to sign themselves,
    // so it needs agreement management — not signing rights or POA. A manager who
    // can't sign can still send the owner the link.
    sendLandlordLink: mgrCan('canManageAgreements'),
    signDocuments: mgrCan('canSignDocuments'),
    // Inspection counter-sign = inspection-management, not contract signing.
    inspections:   mgrCan('canManageInspections'),
    // Deposit edit: either deposits OR collections permission.
    deposits:      mgrCan('canManageDeposits') || mgrCan('canManageCollections'),
    // Final-settlement sign-off (send / mark-paid / unsend) → canSettleDeposits.
    settleDeposits: mgrCan('canSettleDeposits'),
    // Record/edit payment + clear-cheque: the backend accepts the granular
    // carve-out flags OR the umbrella, so surface the buttons for any of them.
    collections:   mgrCan('canManageCollections') || mgrCan('canRecordPayments') || mgrCan('canClearCheques'),
    // Deliberately NOT or-ed with anything. Deleting is its own grant, so a
    // manager who can upload documents does not thereby get the delete control.
    deleteDocuments: mgrCan('canDeleteDocuments'),
  };

  // Landlord-signature identity for the signing block. Three cases, all stamped
  // to match by the backend:
  //  1. A manager signing → their own name "on behalf of {landlord}" (POA act).
  //  2. Else, if the landlord (RP) has a Power of Attorney holder on file → the
  //     POA holder's name "on behalf of {landlord}". This is why an owner-path
  //     signature is attributed to the attorney, not the landlord directly.
  //  3. Otherwise the landlord signs directly, with no on-behalf-of line.
  const landlordName = contract.landlord.companyName || contract.landlord.name || 'Landlord';
  const poaHolder = contract.landlord.hasPoa && contract.landlord.poaPersonName?.trim() ? contract.landlord.poaPersonName.trim() : null;
  const landlordSignerName = isManagerView ? (authUser?.name || 'Authorised Manager') : (poaHolder ?? landlordName);
  const landlordOnBehalfOf = isManagerView ? landlordName : (poaHolder ? landlordName : null);

  // Step content + jump-to-step handler
  const stopOf = (n: number) => mode === 'renewal' ? `Renewal · Stop ${n}` : `Stop ${n} of 6`;
  const handlers: StepHandlers = {
    contract, state: derived,
    onDocsChanged: () => void reload(),
    setState: setLocalState,
    openModal: setModal,
    openDrawer: (t) => document.getElementById('sec-' + t)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    patchContract,
    onActivate, onIssue, onUploadEjari, onMarkEjari, onUploadUtility, onMarkUtility, onMarkSignedOnFile, onVerifyUtility, onRejectUtility, onConfirmPdc, onUploadCheques, onMarkChequesOnFile, onAcceptDocs, onApproveDoc, onRejectDoc, onApproveDocWithExpiry, onUpdatePayment, onRevertToDraft,
    onRenewalDraft,
    onUnsendSettlement,
    onCancelTermination,
    onUploadMoveInDoc, onUploadMoveOutDoc, onUploadCloseoutClearance, onUploadCloseoutFinalBill,
    signActionUrl: `${contractsBase}/${contract.id}`,
    inspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_in&${fromQ}`,
    moveOutInspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_out&${fromQ}`,
    settlementUrl: `${contractsBase}/${contract.id}/settlement?${fromQ}`,
    printUrl: `${contractsBase}/${contract.id}/print`,
    contractsBase,
    operationsBase: isManagerView ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations',
    perms,
    readOnlyWorkflow,
  };

  let content: StepContent;
  if (isSuperseded) {
    content = {
      tone: 'declined', icon: 'alert', sub: 'Superseded', label: 'Superseded',
      headline: 'Another customer leased this unit.',
      body: 'This draft is archived. Browse other listings to find a fresh unit for the customer.',
      timing: null,
      node: (
        <Link href={contractsBase} className="btn btn-jade">
          <ChevronRight size={14} /> Back to contracts
        </Link>
      ),
    };
  } else if (isCancelledRenewal) {
    content = {
      tone: 'declined', icon: 'alert', sub: 'Renewal cancelled', label: 'Cancelled',
      headline: 'This renewal was cancelled before it started.',
      // Reached two ways — the RP cancelled the renewal outright, OR the current
      // lease was terminated and took its un-accepted renewal with it. Don't claim
      // the current lease "keeps running": in the termination case it is winding down.
      body: 'The next term is void and its cheques were cancelled. Nothing further happens on this row — if new terms are needed, propose a fresh renewal on the current lease.',
      timing: null,
      node: contract.parentContractId ? (
        <Link href={`${contractsBase}/${contract.parentContractId}/v2`} className="btn btn-jade" style={{ alignSelf: 'flex-start' }}>
          <ChevronRight size={14} /> Go to the current lease
        </Link>
      ) : null,
    };
  } else if (isDeclinedRenewal) {
    // Two flavours of decline:
    //  • vacate  → the customer is leaving; the active lease winds down to a
    //              move-out inspection + deposit settlement. Show that here so
    //              the RP sees "declined → move-out → settlement" in one place,
    //              with the actions completing on the lease (their data home).
    //  • negotiate → lease keeps running; offer to re-propose.
    const vacating = !!contract.vacateAtEnd;
    const moveOutDone = !!derived?.moveOut?.rpCounterSig;
    const settlementDone = derived?.settlementStatus === 'paid';
    const settlementLabel = settlementDone
      ? 'Settled'
      : derived?.settlementStatus ? 'In progress' : 'Pending';
    content = {
      tone: 'declined', icon: 'alert',
      sub: vacating ? 'Moving out' : 'Renewal closed',
      label: vacating ? 'Declined — vacating' : 'Renewal declined',
      headline: vacating
        ? 'The customer declined and is moving out.'
        : 'The customer declined this renewal.',
      body: vacating
        ? 'They won’t renew and will vacate at lease end. Complete the move-out inspection and deposit settlement on the active lease.'
        : 'The proposal is archived and the original lease keeps running. You can propose fresh terms anytime.',
      timing: null,
      node: (
        <>
          {contract.renewalRejectionReason && (
            <div className="qbanner action">
              <span className="bic"><X size={18} /></span>
              <div style={{ flex: 1 }}>
                <p className="bt">Reason from {contract.tenant.name ?? 'customer'}</p>
                <div className="quote">&ldquo;{contract.renewalRejectionReason}&rdquo;</div>
              </div>
            </div>
          )}
          {vacating ? (
            <>
              {/* Wind-down status — lives on the active lease, surfaced here. */}
              <div className="qbanner waiting">
                <span className="bic"><Key size={18} /></span>
                <div style={{ flex: 1 }}>
                  <p className="bt">Move-out &amp; deposit settlement</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>Move-out inspection</span>
                      <strong>{moveOutDone ? 'Completed' : 'Pending'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>Deposit settlement</span>
                      <strong>{settlementLabel}</strong>
                    </div>
                  </div>
                </div>
              </div>
              {contract.parentContractId && (
                <Link href={`${contractsBase}/${contract.parentContractId}/v2`} className="btn btn-jade" style={{ alignSelf: 'flex-start' }}>
                  <Key size={15} /> Complete move-out &amp; settlement
                </Link>
              )}
            </>
          ) : contract.successorProposal ? (
            <Link href={`${contractsBase}/${contract.successorProposal.id}/v2`} className="btn btn-jade" style={{ alignSelf: 'flex-start' }}>
              <RotateCcw size={15} /> View new proposal · CID-{contract.successorProposal.id}
            </Link>
          ) : contract.parentContractId ? (
            <Link href={`${contractsBase}/${contract.parentContractId}/v2`} className="btn btn-jade" style={{ alignSelf: 'flex-start' }}>
              <RotateCcw size={15} /> Open original lease to re-propose
            </Link>
          ) : perms.renewals ? (
            <button className="btn btn-jade" style={{ alignSelf: 'flex-start' }} onClick={() => setModal('renew')}>
              <RotateCcw size={15} /> Propose new renewal
            </button>
          ) : null}
        </>
      ),
    };
  } else {
    content = stepContent(selStep.key, derived, handlers, mode);
    // Bind termination Accept / Reject buttons (rendered as data-action by stepContent)
    if (content.node && typeof content.node === 'object' && 'props' in content.node) {
      // Walk the node to attach onClick to data-action buttons — simpler to
      // re-render this tone-specific block ourselves when termination is pending.
      const t = contract.termination;
      if (t && t.response === 'pending' && t.requestedByRole === 'tenant') {
        content = {
          ...content,
          node: (
            <>
              <div className="qbanner action">
                <span className="bic"><AlertCircle size={18} /></span>
                <div style={{ flex: 1 }}>
                  <p className="bt">Effective {fmtDate(t.effectiveDate)}</p>
                  <p className="bp">Requested {fmtDate(t.requestedAt)}</p>
                  {t.reason && <div className="quote">&ldquo;{t.reason}&rdquo;</div>}
                </div>
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Add a note (optional)</label>
                <textarea className="input" value={respComment} placeholder="A note recorded with your decision — visible in the tenancy Notes log" onChange={e => setRespComment(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-brick" onClick={() => respondToTermination('accepted')}><Check size={14} /> Accept termination</button>
                <button className="btn btn-ghost" onClick={() => respondToTermination('rejected')}><X size={14} /> Reject</button>
              </div>
            </>
          ),
        };
      }
    }
    void stopOf;
  }

  const missingSteps = steps.filter((s, i) => s.key !== 'active' && !doneArr[i]);
  const allActive = isDone('active', derived);

  // Landlord (you) can sign once the contract is issued and not yet countersigned.
  // Mirrors the customer page, which exposes a "Sign Contract" button in its top bar
  // rather than only inside the workflow stepper.
  const canLandlordSign = contract.status === 'issued' && !derived.landlordSigned && !isSuperseded && !isDeclinedRenewal;

  // KYC docs = customer-owned IDENTITY documents in contract.documents.
  // Exclude operational customer uploads — payment advice (cheque copies) and
  // receipts/payment proofs are cleared in the Cheques step, not doc-reviewed, so
  // they must never show up here in a "Pending review" state with Approve/Reject.
  // On a RENEWAL, valid documents are already on file, so we only surface the
  // ones that are EXPIRED (they're the only profile docs that need re-collecting).
  // New contracts show the full set.
  const NON_KYC_DOC_BASES = ['payment_advice', 'pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques', 'renewal_payment_proof', 'payment_proof', 'receipt', 'payment_receipt'];
  const docBase = (k: string | null | undefined) => (k ?? '').toLowerCase().replace(/_\d{10,}$/, '');
  const allKycDocs = (contract.documents ?? []).filter(d =>
    (d.ownerType === 'customer' || d.ownerType === 'tenant') && !NON_KYC_DOC_BASES.includes(docBase(d.documentKey)));
  const kycDocs = contract.contractType === 'renewal'
    ? allKycDocs.filter(d => d.expiryDate && new Date(d.expiryDate) < new Date())
    : allKycDocs;

  // Header pill kept consistent with the contracts LIST's time-aware statuses:
  // a pending contract whose term is already RUNNING is "Needs activation"
  // (the live lease awaiting its status flip), a future-start pending term is
  // "Starts later". Without this the header shows the journey-step label and
  // contradicts what the list says about the same contract.
  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const startIso = (contract.startDate ?? '').slice(0, 10);
  const endIso = (contract.endDate ?? '').slice(0, 10);
  const isRunningPending = contract.status === 'pending' && !isSuperseded && !isDeclinedRenewal
    && !!startIso && startIso <= todayIso && !!endIso && endIso >= todayIso;
  const isFuturePending = contract.status === 'pending' && !isSuperseded && !isDeclinedRenewal
    && !!startIso && startIso > todayIso;
  const pill = isRunningPending
    ? { tone: 'waiting', label: 'Needs activation' }
    : isFuturePending
      ? { tone: 'waiting', label: 'Starts later' }
      : { tone: content.tone, label: content.label };

  // Deep-links to the related entities (Property → portfolio popup, Unit → unit
  // page, Customer → customer page). The manager mirror gets the same links
  // against its own landlord-scoped routes (?rp=<landlord>): it has no per-unit
  // page, so the unit opens the units workspace pre-filtered to that unit
  // number. Mirrors the lead detail page's link block exactly.
  const mgrRpQ = rpScope !== '' ? `rp=${rpScope}` : '';
  const propertyHref = !contract.property.id ? null
    : isManagerView ? (mgrRpQ ? `/dashboard/manager/properties?${mgrRpQ}&property=${contract.property.id}` : null)
    : `/rental-provider/dashboard/portfolio?property=${contract.property.id}`;
  // The Units workspace on THIS unit, in whichever portal is rendering. The
  // manager branch used to search by unit NUMBER, which matches every unit
  // sharing that number across buildings; the id is exact.
  const unitHref = !contract.unit.id ? null
    : isManagerView
      ? (rpScope !== '' ? unitWorkspaceHref(contract.unit.id, { rp: Number(rpScope) }) : null)
      : unitWorkspaceHref(contract.unit.id);
  const customerHref = !contract.tenant.id ? null
    : isManagerView ? (mgrRpQ ? `/dashboard/manager/tenants/${contract.tenant.id}?${mgrRpQ}` : null)
    : `/rental-provider/dashboard/tenants/${contract.tenant.id}`;

  return (
    <div className="quest-page">
      <div className="wrap">
        <div className="qhead">
          <div className="lhs">
            <button className="backbtn" onClick={() => router.back()}><ArrowLeft size={18} /></button>
            <div>
              <h1>
                CID-{contract.id} <span className={'pill ' + pill.tone}>{pill.label}</span>
              </h1>
              {/* Chain: Property → Unit → Contract — property and unit are
                  clickable (their details live on their own pages; nothing is
                  duplicated here). */}
              <div className="hsub">
                <Building2 size={13} />
                {/* Property name opens its details popup on the portfolio page
                    (no standalone property page — the portfolio popup is the home
                    for property details). A manager gets the same popup on their
                    own landlord-scoped Properties page. */}
                {propertyHref ? (
                  <Link href={propertyHref} className="chain-link" title="Open property details">
                    {contract.property.buildingName ?? '—'}
                  </Link>
                ) : (
                  <span>{contract.property.buildingName ?? '—'}</span>
                )}
                <ChevronRight size={12} style={{ opacity: .5 }} />
                {unitHref ? (
                  <Link href={unitHref} className="chain-link" title="Open unit details">
                    Unit {contract.unit.number ?? '—'}
                  </Link>
                ) : (
                  <span>Unit {contract.unit.number ?? '—'}</span>
                )}
                <ChevronRight size={12} style={{ opacity: .5 }} />
                <span>CID-{contract.id}</span>
                {contract.property.community && <> · {contract.property.community}</>}
              </div>
            </div>
          </div>
          <div className="rhs">
            {/* Edit terms — RP owners always; managers only with canManageAgreements
                for this landlord. Hidden on terminated leases (backend rejects edits
                there) and once the contract is signed by any party (editLocked —
                the executed agreement is read-only). For a manager the rp scope is
                carried so the edit page's customer picker reads /manager/tenants/*?rp=. */}
            {showPipeline && contract.status !== 'terminated' && !editLocked && (() => {
              // `||` not `??` — "All landlords" sends an EMPTY ?rp=, not a missing one.
              const rpForEdit = searchParams.get('rp') || (contract.landlord?.id != null ? String(contract.landlord.id) : '');
              const canEdit = !isManagerView
                || (rpForEdit !== '' && managerCanForRp('canManageAgreements', Number(rpForEdit)));
              if (!canEdit) return null;
              const editHref = isManagerView && rpForEdit
                ? `${contractsBase}/${contract.id}/edit?rp=${rpForEdit}`
                : `${contractsBase}/${contract.id}/edit`;
              return (
                <Link href={editHref} className="btn btn-ghost btn-sm">
                  <Pencil size={14} /> Edit
                </Link>
              );
            })()}
            <Link href={`${contractsBase}/${contract.id}/print`} className="btn btn-ghost btn-sm" target="_blank">
              <Eye size={14} /> Preview
            </Link>
            <Link href={`${contractsBase}/${contract.id}/print`} className="btn btn-ghost btn-sm" target="_blank">
              <Download size={14} /> PDF
            </Link>
            {/* Unsent renewal DRAFT (child) → send it to the customer directly from
                here instead of hopping back to the parent lease. Sends via the parent
                that owns the proposal. */}
            {contract.contractType === 'renewal' && !!contract.parentContractId
              && contract.renewalStatus === 'draft' && contract.renewalAccepted !== 'pending'
              && !contract.renewalChild && perms.renewals && (
              <button className="btn btn-jade btn-sm" onClick={() => void onSendRenewalDraft()}>
                <RotateCcw size={14} /> Send to customer
              </button>
            )}
            {/* Record view bridge — the read-only contract page has no workflow
                actions; this is the one-click path into the Operations pipeline
                so landing here (from a report/deposit/unit link) is never a dead
                end. Hidden on terminated leases (nothing left to do). */}
            {/* Leases (record) view: surface the two lease actions directly. Each
                jumps into Operations (full view) and auto-opens that action,
                replacing the generic "Manage in Operations" bridge. */}
            {!showPipeline && contract.status !== 'terminated' && (() => {
              const opsBase = `${isManagerView ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations'}/${contract.id}`;
              const canRenew = contract.status === 'active'
                && !hasRenewalInFlight(contract)
                && contract.termination?.response !== 'accepted'
                && perms.renewals;
              const canTerminate = (contract.status === 'active' || contract.status === 'expired')
                && contract.termination?.response !== 'accepted' && perms.agreements;
              // Not-yet-active leases (pending/issued): a renewal child is
              // CANCELLED outright (ends the next term), a standalone lease is
              // sent back to setup. Either way, no move-out/settlement.
              const canCancel = (contract.status === 'pending' || contract.status === 'issued')
                && perms.agreements;
              const cancelIsRenewal = isRenewalChild(contract);
              return (
                <>
                  {canRenew && (
                    <Link href={`${opsBase}?action=renew`} className="btn btn-jade btn-sm">
                      <RotateCcw size={14} /> Propose renewal
                    </Link>
                  )}
                  {canTerminate && (
                    <Link href={`${opsBase}?action=terminate`} className="btn btn-ghost btn-sm" style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }}>
                      <X size={14} /> Terminate
                    </Link>
                  )}
                  {canCancel && (
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }} onClick={() => setModal('cancel-lease')}>
                      <X size={14} /> {cancelIsRenewal ? 'Cancel renewal' : 'Reset to setup'}
                    </button>
                  )}
                </>
              );
            })()}
            {/* A cancelled (pre-active void) lease can be rolled back to its
                previous issued state — cheques reinstated. A cancelled RENEWAL
                cannot: the parent's renewal markers were cleared, so a new term
                is re-proposed rather than restored. */}
            {!showPipeline && contract.status === 'terminated' && !isRenewalChild(contract)
              && contract.termination?.method === 'cancelled' && perms.agreements && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void onRestoreCancelled()}
                title="Undo the cancellation and return this lease to its issued state"
              >
                <RotateCcw size={14} /> Restore lease
              </button>
            )}
            {/* Always-available renewal entry — surfaces the existing renewal
                feature on any live lease (incl. active renewal children, for
                chained renewals) without hunting inside the Active step. Hidden
                when a renewal is already in flight or the lease is terminating.
                The backend (proposeRenewal) requires status=active, so it is not
                shown on expired/terminated/draft rows. */}
            {showPipeline && contract.status === 'active'
              && !hasRenewalInFlight(contract)
              && contract.termination?.response !== 'accepted'
              && perms.renewals && (
              <button className="btn btn-ghost btn-sm" onClick={() => setModal('renew')}>
                <RotateCcw size={14} /> Propose renewal
              </button>
            )}
            {/* Always-available direct-termination entry — visible on every live
                (active) or ended (expired) lease so the RP never has to hunt for
                it inside a journey step. Hidden once a termination is already
                accepted/direct (wind-down in progress) and on draft/terminated
                rows where it doesn't apply. */}
            {showPipeline && (contract.status === 'active' || contract.status === 'expired')
              && contract.termination?.response !== 'accepted'
              && perms.agreements && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }}
                onClick={() => setModal('direct-terminate')}
              >
                <X size={14} /> Terminate directly
              </button>
            )}
            {/* Not-yet-active (pending/issued) row — the tenant never started,
                so neither action needs a move-out/settlement wind-down. On a
                RENEWAL child this is a real cancellation (ends the next term,
                parent lease keeps running); on a standalone lease it sends the
                row back to setup. Distinct from "Terminate directly". */}
            {showPipeline && (contract.status === 'pending' || contract.status === 'issued')
              && perms.agreements && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }}
                onClick={() => setModal('cancel-lease')}
              >
                <X size={14} /> {isRenewalChild(contract) ? 'Cancel renewal' : 'Reset to setup'}
              </button>
            )}
            {/* Cancel/undo a termination that is still winding down (not yet
                closed). Shows in place of "Terminate directly" once accepted. */}
            {showPipeline && contract.status !== 'terminated'
              && contract.termination?.response === 'accepted'
              && perms.agreements && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }}
                onClick={() => void onCancelTermination()}
              >
                <RotateCcw size={14} /> Cancel termination
              </button>
            )}
            {/* No "You signed" pill here — the signature stop in the pipeline (and the
                signatures section below) already say who signed and when, and in a
                manager's view "you" was the wrong actor anyway. */}
          </div>
        </div>

        {/* Record view: boarding-pass contract summary (Unit + parties + term +
            rent). Payment + document detail render below. The full/pipeline view
            keeps the compact info row instead. */}
        {view === 'record' && <ContractPass contract={contract} payments={contract.payments ?? []} tenantHref={customerHref} />}

        {/* Customer + rental period — ONE info row under the header (replaces
            the old Parties and Rental period sections). */}
        {view !== 'record' && (
        <div className="infobar">
          <span className="pitem">
            <span className="pk">Customer</span>
            <span className="pv">
              {customerHref ? (
                <Link href={customerHref} className="chain-link" title="Open customer details">
                  {contract.tenant.name ?? 'Customer'}
                </Link>
              ) : (
                contract.tenant.name ?? '—'
              )}
            </span>
          </span>
          {contract.tenant.phone && (
            <span className="pitem">
              <span className="pk">Phone</span>
              <span className="pv"><a href={`tel:${contract.tenant.phone}`} className="chain-link">{contract.tenant.phone}</a></span>
            </span>
          )}
          <span className="isep" />
          <span className="pitem"><span className="pk">Start</span><span className="pv">{fmtDate(contract.startDate)}</span></span>
          <span className="pitem"><span className="pk">End</span><span className="pv">{fmtDate(contract.endDate)}</span></span>
          <span className="pitem"><span className="pk">Duration</span><span className="pv">{contract.durationYears ? `${contract.durationYears * 12} months` : '12 months'}</span></span>
          <span className="pitem"><span className="pk">Instalments</span><span className="pv">{contract.numberOfInstallments ? `${contract.numberOfInstallments} payments` : '—'}</span></span>
          <span className="pitem"><span className="pk">Mode</span><span className="pv">{contract.modeOfPayment ? contract.modeOfPayment.charAt(0).toUpperCase() + contract.modeOfPayment.slice(1) : '—'}</span></span>
        </div>
        )}

        {/* Vacate-on-renewal-decline — customer won't renew and is moving out.
            The move-out inspection + deposit settlement steps are surfaced below. */}
        {showPipeline && contract.vacateAtEnd && (
          <div className="qbanner waiting" style={{ marginBottom: 4 }}>
            <span className="bic"><Key size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Customer is vacating — renewal declined</p>
              <p className="bp">
                {contract.tenant.name ?? 'The customer'} won’t renew and will move out
                {contract.endDate ? ` on ${fmtDate(contract.endDate)}` : ' at lease end'}. Complete the move-out inspection and deposit settlement.
              </p>
              {contract.renewalRejectionReason && <div className="quote">&ldquo;{contract.renewalRejectionReason}&rdquo;</div>}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => setSelKey('moveout')}>Go to move-out</button>
          </div>
        )}

        {/* Running-but-never-activated lease (imported/synced records land like
            this). The list calls it "Needs Activation" — give the RP the fix
            right here instead of a journey step that contradicts reality. */}
        {showPipeline && isRunningPending && (
          <div className="qbanner waiting" style={{ marginBottom: 4 }}>
            <span className="bic"><RotateCcw size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">This lease is already running — it just needs activation</p>
              <p className="bp">
                The term started {fmtDate(contract.startDate)} and the tenant is in place, but the
                contract was never switched to Active. Activate it so it counts as a live tenancy
                everywhere; you can backfill documents and cheques afterwards.
              </p>
            </div>
            <button className="btn btn-jade btn-sm" style={{ alignSelf: 'center' }} onClick={() => void onActivate()}>
              Activate now
            </button>
          </div>
        )}

        {/* Ended / overdue lease with no close-out recorded — the customer may
            already have vacated (outdated/imported data). Offer a direct
            termination + wind-down (move-out, utility closeout, settlement)
            right here, mirroring the "needs activation" fix above. */}
        {showPipeline && (contract.status === 'expired' || (contract.status === 'active' && !!endIso && endIso < todayIso))
          && contract.termination?.method !== 'direct'
          && contract.termination?.response !== 'accepted'
          && !contract.vacateAtEnd
          && !contract.hasSuccessor
          && !isSuperseded && !isDeclinedRenewal && !isCancelledRenewal && (
          <div className="qbanner waiting" style={{ marginBottom: 4 }}>
            <span className="bic"><Key size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">
                {contract.status === 'expired' ? 'This lease has ended' : 'This lease is overdue'} — record the close-out if the customer has vacated
              </p>
              <p className="bp">
                The term ended {fmtDate(contract.endDate)}. If {contract.tenant.name ?? 'the customer'} has
                already moved out, terminate it directly to record the move-out, utility closeout and final
                deposit settlement. The lease stays active until you mark the settlement paid.
              </p>
            </div>
            {perms.agreements && (
              <button className="btn btn-brick btn-sm" style={{ alignSelf: 'center' }} onClick={() => setModal('direct-terminate')}>
                Terminate directly
              </button>
            )}
          </div>
        )}

        {/* Missing strip */}
        {showPipeline && !isSuperseded && !isDeclinedRenewal && !isCancelledRenewal && (
          <MissingStrip
            missing={missingSteps}
            allActive={allActive}
            onJump={(k) => setSelKey(k)}
          />
        )}

        {showPipeline && (
        <div className="quest">
          {!isSuperseded && !isDeclinedRenewal && !isCancelledRenewal && (
            <QuestMap
              steps={steps}
              doneArr={doneArr}
              selectedIdx={selIdx}
              onSelect={(i) => setSelKey(steps[i].key)}
              mode={mode}
            />
          )}
          <div className="acard" style={isSuperseded || isDeclinedRenewal || isCancelledRenewal ? { gridColumn: '1 / -1' } : undefined}>
            <div className="ahead">
              <div className="ahl">
                <HeroIcon tone={content.tone} icon={content.icon} />
                <div style={{ minWidth: 0 }}>
                  <div className="eyebrow">{content.sub}</div>
                  <h2>{content.headline}</h2>
                </div>
              </div>
              <span className={'pill ' + content.tone}>{content.label}</span>
            </div>
            <p className="abody">{content.body}</p>
            <div className="action-body">{content.node}</div>
            {/* Send the customer a secure link to upload documents + sign — shown
                 at the Signatures / Move-in steps where tenant action is needed. */}
            {(selStep.key === 'sign' || selStep.key === 'movein') && contract.tenant.id && !readOnlyWorkflow && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  {selStep.key === 'movein' ? 'Customer move-in signing link' : 'Customer contract signing link'}
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section={selStep.key === 'movein' ? 'move_in' : 'contract'}
                  label={selStep.key === 'movein' ? 'Send move-in link' : 'Send signing link'}
                />
              </div>
            )}
            {/* Landlord signing link — the lessor's counterpart to the customer
                 link above. Opens the same no-login page (every document in full
                 preview + a sticky sign menu) so the landlord / authorised
                 signatory can review and sign as the lessor from any device. */}
            {selStep.key === 'sign' && contract.tenant.id && !readOnlyWorkflow && perms.sendLandlordLink && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  Rental provider contract signing link
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section="contract"
                  role="landlord"
                  label="Send landlord link"
                />
              </div>
            )}
            {/* Inline landlord signature pad — placed after the signing links so
                 the step reads top-to-bottom: statuses → send links →
                 countersign here. */}
            {selStep.key === 'sign' && canLandlordSign && perms.signLandlord && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <InlineLandlordSign contract={contract} signerName={landlordSignerName} onBehalfOf={landlordOnBehalfOf} onSigned={() => void reload()} />
              </div>
            )}
            {/* Move-in: second link for the on-site inspection manager — they
                 fill the move-in form, attach photos, submit and counter-sign
                 the RP side via the same no-login portal, so no separate account
                 is needed. Provisioning the counter-sign → canManageInspections. */}
            {selStep.key === 'movein' && contract.tenant.id && !readOnlyWorkflow && perms.inspections && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  Inspection manager link
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section="move_in"
                  role="inspector"
                  label="Send inspector link"
                />
              </div>
            )}
            {/* Inline RP counter-signature — appears once the customer has signed
                 the move-in inspection, so it can be completed right here. */}
            {selStep.key === 'movein' && derived.moveIn.rpSubmitted && derived.moveIn.tenantSig && !derived.moveIn.rpCounterSig && perms.inspections && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <InlineInspectionCounterSign contractId={contract.id} type="move_in" signerName={landlordSignerName} onBehalfOf={landlordOnBehalfOf} onSigned={() => void reload()} />
              </div>
            )}
            {/* Move-out signing link — available during wind-down even though the
                 onboarding workflow is otherwise frozen (status === active). */}
            {selStep.key === 'moveout' && contract.tenant.id && !derived.moveOut.rpCounterSig && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  Customer move-out signing link
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section="move_out"
                  label="Send move-out link"
                />
              </div>
            )}
            {/* Move-out: second link for the on-site inspection manager — they
                 fill the move-out form, attach photos, submit and counter-sign
                 the RP side via the same no-login portal. Mirrors the move-in
                 inspector link above; backend already supports move_out.
                 Provisioning the counter-sign → canManageInspections. */}
            {selStep.key === 'moveout' && contract.tenant.id && !derived.moveOut.rpCounterSig && perms.inspections && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  Inspection manager link
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section="move_out"
                  role="inspector"
                  label="Send inspector link"
                />
              </div>
            )}
            {/* Customer settlement signing link — a persistent section on the
                 settlement step, laid out exactly like the move-out signing link
                 above: generate a secure no-login link, then copy / open / share it
                 (and see it here). Generating the link promotes a still-draft
                 settlement to "sent" on the backend so the customer can actually
                 review + sign it. Hidden only once fully paid/closed. */}
            {selStep.key === 'settlement' && contract.tenant.id && perms.settleDeposits
              && derived.settlementStatus != null && derived.settlementStatus !== 'paid' && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  Customer settlement signing link
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section="settlement"
                  label="Send settlement link"
                />
              </div>
            )}
            {/* Flow 4: Redo Ejari — roll back to issued so a corrected certificate
                 can be uploaded. Shown on the Ejari step once it is registered and
                 the workflow has not yet frozen (active / expired / terminated). */}
            {selStep.key === 'ejari' && derived.ejariStatus === 'registered' && !readOnlyWorkflow && (
              <button className="ca" style={{ justifySelf: 'start', marginTop: -4, padding: 0, color: 'var(--brick)' }} onClick={() => void onRedoEjari()}>
                <RotateCcw size={12} /> Redo Contract Registration (reset &amp; re-upload)
              </button>
            )}
            {content.timing && (
              <div className="timing"><Clock size={12} /> {content.timing}</div>
            )}
          </div>
        </div>
        )}

        {/* Contract details — ALL sections visible on the page (CEO doctrine:
            no small tabs / slide-in drawer hiding information). Parties,
            Period, Payments (incl. payment documents) and Documents render
            stacked; property info is NOT duplicated here — the header chain
            links to the property / unit detail pages instead. */}
        {showRecord && (
        <div className="details-wrap">
          <div className="section-eyebrow">
            <span className="se-t">Contract details</span>
            <span className="se-line" />
          </div>
          <DetailsDrawer
            inline
            open
            tab="payments"
            setTab={() => undefined}
            onClose={() => undefined}
            contract={contract}
            payments={contract.payments ?? []}
            kycDocs={kycDocs}
            onApproveDoc={onApproveDoc}
            onRejectDoc={onRejectDoc}
            onDocsChanged={() => void reload()}
            onRecordPayment={onRecordPayment}
            onUpdatePayment={onUpdatePayment}
            onDeletePayment={onDeletePayment}
            onUpdateDeposit={onUpdateDeposit}
            onCreateDeposit={onCreateDeposit}
            onSaveClauses={onSaveClauses}
            editLocked={editLocked}
            onConfirmPdc={onConfirmPdc}
            onUploadDoc={onUploadDoc}
            onRequestDoc={onRequestDoc}
            notes={notes}
            onAddNote={onAddNote}
            perms={perms}
            paymentRefs={paymentRefs}
            showExtras={view !== 'record'}
          />
        </div>
        )}
      </div>

      {modal === 'sign' && perms.signLandlord && <SignModal contract={contract} signerName={landlordSignerName} onBehalfOf={landlordOnBehalfOf} onClose={() => setModal(null)} onSigned={() => { setModal(null); void reload(); }} />}
      {modal === 'terminate' && perms.agreements && <TerminateModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); loadNotes(); }} />}
      {modal === 'direct-terminate' && perms.agreements && <DirectTerminateModal contract={contract} onClose={closeDeepLinkedModal} onSubmitted={() => { closeDeepLinkedModal(); setSelKey('moveout'); void reload(); loadNotes(); }} />}
      {modal === 'cancel-lease' && perms.agreements && <CancelLeaseModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); loadNotes(); }} />}
      {modal === 'renew' && perms.renewals && <RenewalProposeModal contract={contract} onClose={closeDeepLinkedModal} onSubmitted={() => { closeDeepLinkedModal(); void reload(); }} />}
      {modal === 'reject-utility' && perms.agreements && <RejectUtilityModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); }} />}

      {/* Hidden file pickers for inline Ejari / utility upload (self-contained, no redirect to the old page). */}
      <input ref={ejariInputRef} type="file" accept="application/pdf,image/jpeg,image/png" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onEjariFilePicked(f); }} />
      <input ref={utilityInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUtilityFilePicked(f); }} />
      {/* Renewal Cheques/PDC picker — RP uploads the Payment Advice on the customer's behalf. */}
      <input ref={chequesInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onChequesFilePicked(f); }} />
      {/* Wind-down doc picker (move-out report / utility clearance / final bill) — routed by windDownKind. */}
      <input ref={windDownInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; const k = windDownKind; if (f && k) void onWindDownFilePicked(f, k); }} />
      {(ejariUploading || utilityUploading || chequesUploading || windDownUploading) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 9999, color: '#fff', font: '600 14px system-ui' }}>
          Uploading {ejariUploading ? 'Contract Registration' : utilityUploading ? 'utility' : chequesUploading ? 'Payment Confirmation' : 'wind-down'} document…
        </div>
      )}

      {/* Reject a customer document — replaces window.prompt(). Names the document,
          makes the reason a real (optional) field, and reports failures instead of
          swallowing them. */}
      {rejectTarget && (
        <div role="dialog" aria-modal="true" aria-label="Reject document"
          style={{ position: 'fixed', inset: 0, zIndex: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }}
            onClick={() => { if (!rejectBusy) setRejectTarget(null); }} />
          <div style={{ position: 'relative', width: 'min(440px, 100%)', background: 'var(--paper, #fff)', borderRadius: 16, padding: '20px 22px', boxShadow: '0 24px 60px -24px rgba(0,0,0,.45)' }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, fontWeight: 700, color: 'var(--ink, #1a1916)', margin: 0 }}>
              <X size={15} style={{ color: 'var(--brick)' }} /> Reject document
            </p>
            <p style={{ fontSize: 13, color: 'var(--ink-2, #3d3b35)', margin: '8px 0 12px', lineHeight: 1.5 }}>
              Rejecting <strong>{rejectTarget.label}</strong>. {contract.tenant.name || 'The customer'} sees it as a re-upload slot, and your reason as the instruction.
            </p>
            <textarea
              autoFocus rows={3} value={rejectReason} disabled={rejectBusy}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason (optional — shown to the customer)…"
              style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mist-strong, #e8e6e0)', font: 'inherit', fontSize: 13, color: 'var(--ink, #1a1916)', background: 'var(--surface, #fafaf8)' }}
            />
            {rejectErr && <p style={{ fontSize: 12, color: 'var(--brick)', margin: '8px 0 0' }}>{rejectErr}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-sm" disabled={rejectBusy}
                style={{ background: 'var(--brick)', color: '#fff' }}
                onClick={() => void confirmRejectDoc()}>
                <X size={14} /> {rejectBusy ? 'Rejecting…' : 'Reject'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={rejectBusy}
                onClick={() => setRejectTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyle />
    </div>
  );
}

/**
 * The standalone contract page (reached from the Leases register). Renders the
 * RECORD view — header + summary + Payments + Documents, read-only. The setup
 * pipeline + workflow actions live in Operations now (which mounts this same
 * component with view="full"). The manager contract route re-exports this default.
 */
export default function ContractV2Page() {
  return <ContractV2View view="record" />;
}

// ────────────────────────────────────────────────────────────────────────────
// Global style block (scoped to .quest-page wrapper)
// ────────────────────────────────────────────────────────────────────────────

function GlobalStyle() {
  return (
    <style jsx global>{`
      .quest-page {
        --ink: #1a1916; --ink-2: #3d3b35; --ink-3: #54534c;
        --mute: #9b9890; --mute-2: #bdbab2;
        --paper: #ffffff; --surface: #f9f8f6; --mist: #f0ede8; --mist-strong: #e8e6e0;
        --jade: #2e9f82; --jade-deep: #1f5a3f; --jade-soft: #d8f2e8; --jade-tint: #eef8f4;
        --saffron: #f59e0b; --saffron-deep: #c2410c; --saffron-soft: #fff7ed; --saffron-edge: #f0d68f;
        --brick: #c8492c; --brick-deep: #9a3520; --brick-soft: #fdede7; --brick-edge: #f3cabb;
        --r-lg: 22px; --r-md: 16px; --r-sm: 12px;
        --sh-card: 0 1px 2px rgba(26,23,20,.04);
        --sh-hero: 0 24px 60px -32px rgba(26,23,20,.2);
        --sh-pop:  0 30px 70px -24px rgba(26,23,20,.34);
        background: var(--surface); color: var(--ink); min-height: 100vh;
        font-family: inherit;
      }
      .quest-page .wrap { max-width: 1240px; margin: 0 auto; padding: 26px 28px 64px; width: 100%; }
      .quest-page button, .quest-page input, .quest-page select, .quest-page textarea { font-family: inherit; color: inherit; }
      .quest-page .eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; color: var(--mute); }
      .quest-page .note { font-size: 11.5px; color: var(--mute); line-height: 1.5; }

      .quest-page .qhead { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
      .quest-page .qhead .lhs { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .quest-page .backbtn { width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--mist-strong); background: #fff; display: grid; place-items: center; color: var(--ink-2); cursor: pointer; flex-shrink: 0; }
      .quest-page .backbtn:hover { border-color: var(--mute-2); color: var(--ink); }
      .quest-page .qhead h1 { margin: 0; font-size: 25px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .quest-page .qhead .hsub { font-size: 13px; color: var(--mute); margin-top: 3px; display: flex; align-items: center; gap: 7px; }
      .quest-page .qhead .rhs { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; justify-content: flex-end; }

      .quest-page .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 20px; border-radius: 12px; font-weight: 700; font-size: 14px; border: 1px solid transparent; cursor: pointer; transition: all .15s; line-height: 1; white-space: nowrap; font-family: inherit; text-decoration: none; }
      .quest-page .btn:disabled { opacity: .55; cursor: not-allowed; }
      .quest-page .btn-jade { background: var(--jade); color: #fff; }
      .quest-page .btn-jade:hover:not(:disabled) { background: #268d72; }
      .quest-page .btn-brick { background: var(--brick); color: #fff; }
      .quest-page .btn-brick:hover:not(:disabled) { background: var(--brick-deep); }
      .quest-page .btn-ghost { background: #fff; color: var(--ink-2); border-color: var(--mist-strong); font-weight: 600; }
      .quest-page .btn-ghost:hover:not(:disabled) { border-color: var(--mute-2); color: var(--ink); }
      .quest-page .btn-sm { padding: 10px 15px; font-size: 13px; border-radius: 10px; }
      .quest-page .btn-lg { padding: 15px 24px; font-size: 14.5px; }
      .quest-page .btn-block { width: 100%; }

      .quest-page .pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 99px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
      .quest-page .pill.action { background: var(--brick-soft); color: var(--brick); }
      .quest-page .pill.waiting { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .pill.celebrate { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .pill.declined { background: var(--mist); color: var(--ink-2); }
      .quest-page .flag { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; padding: 9px 15px; border-radius: 99px; border: 1px solid; white-space: nowrap; }
      .quest-page .flag.waiting { background: var(--saffron-soft); color: var(--saffron-deep); border-color: var(--saffron-edge); }

      .quest-page .quest { display: grid; grid-template-columns: minmax(300px,360px) minmax(0,1fr); gap: 26px; align-items: start; }
      @media (max-width: 1040px) { .quest-page .quest { grid-template-columns: 1fr; } }

      .quest-page .qmap { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: var(--r-lg); padding: 22px 14px; position: sticky; top: 84px; }
      @media (max-width: 1040px) { .quest-page .qmap { position: static; } }
      .quest-page .qmap-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 0 8px; }
      .quest-page .qmap-l { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
      .quest-page .qmap-l svg { color: var(--brick); }
      .quest-page .qmap-c { font-size: 12px; color: var(--mute); }
      .quest-page .youare { margin-top: 6px; padding: 12px 14px; background: #fff; border: 1px solid var(--mist-strong); border-radius: 14px; display: flex; align-items: center; gap: 11px; }
      .quest-page .youare .yi { width: 30px; height: 30px; border-radius: 99px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
      .quest-page .youare .yi.here { background: var(--brick); animation: qpulse 2s ease-in-out infinite; }
      .quest-page .youare .yi.done { background: var(--jade-deep); }
      .quest-page .youare .yl { font-size: 9px; color: var(--mute); text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
      .quest-page .youare .yv { font-size: 13.5px; font-weight: 700; margin-top: 2px; }
      @keyframes qpulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.09); } }

      .quest-page .acard { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-lg); padding: 30px 34px; box-shadow: var(--sh-hero); display: flex; flex-direction: column; }
      @media (max-width: 560px) { .quest-page .acard { padding: 24px 20px; } }
      .quest-page .acard .ahead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .quest-page .acard .ahl { display: flex; align-items: flex-start; gap: 15px; flex: 1; min-width: 0; }
      .quest-page .heroicon { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; color: #fff; flex-shrink: 0; box-shadow: 0 8px 20px -8px rgba(26,23,20,.4); }
      .quest-page .heroicon.action { background: var(--brick); }
      .quest-page .heroicon.waiting { background: var(--saffron-deep); }
      .quest-page .heroicon.celebrate { background: var(--jade-deep); }
      .quest-page .heroicon.declined { background: var(--ink); }
      .quest-page .acard h2 { margin: 5px 0 0; font-size: 27px; line-height: 1.14; letter-spacing: -.02em; font-weight: 700; }
      .quest-page .acard .abody { font-size: 14.5px; color: var(--ink-2); line-height: 1.6; margin: 18px 0 0; }
      .quest-page .acard .action-body { margin-top: 22px; display: grid; gap: 16px; }
      .quest-page .acard .timing { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--mute); margin-top: 22px; padding-top: 16px; border-top: 1px dashed var(--mist-strong); }

      .quest-page .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
      .quest-page .stat { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 12px; padding: 14px 16px; }
      .quest-page .stat .sl { font-size: 10px; color: var(--mute); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
      .quest-page .stat .sv { font-size: 19px; font-weight: 700; letter-spacing: -.02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .quest-page .stat .sv.jade { color: var(--jade-deep); }

      .quest-page .qbanner { display: flex; gap: 14px; border: 1px solid; border-radius: var(--r-md); padding: 16px 18px; }
      .quest-page .qbanner .bic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; background: #fff; }
      .quest-page .qbanner .bt { font-size: 14.5px; font-weight: 700; margin: 0 0 3px; }
      .quest-page .qbanner .bp { font-size: 13px; margin: 0; line-height: 1.5; }
      .quest-page .qbanner .quote { margin-top: 10px; background: #fff; border-radius: 11px; padding: 10px 13px; font-size: 13px; line-height: 1.45; border: 1px solid; }
      .quest-page .qbanner.action { background: var(--brick-soft); border-color: var(--brick-edge); }
      .quest-page .qbanner.action .bic { color: var(--brick); }
      .quest-page .qbanner.action .bt { color: var(--brick-deep); }
      .quest-page .qbanner.action .bp { color: var(--brick); }
      .quest-page .qbanner.action .quote { border-color: var(--brick-edge); color: var(--ink-2); }
      .quest-page .qbanner.waiting { background: var(--saffron-soft); border-color: var(--saffron-edge); }
      .quest-page .qbanner.waiting .bic { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .bt { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .bp { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .quote { border-color: var(--saffron-edge); color: var(--ink-2); }

      .quest-page .missing { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--saffron-soft); border: 1px solid var(--saffron-edge); border-radius: 14px; padding: 11px 16px; margin-bottom: 20px; }
      .quest-page .missing .ml { font-size: 11.5px; font-weight: 700; color: var(--saffron-deep); display: flex; align-items: center; gap: 7px; white-space: nowrap; }
      .quest-page .missing .mchip { font-size: 12.5px; font-weight: 600; color: var(--saffron-deep); background: #fff; border: 1px solid var(--saffron-edge); border-radius: 99px; padding: 6px 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .quest-page .missing .mchip:hover { background: var(--saffron-soft); }
      .quest-page .missing.allgood { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .missing.allgood .ml { color: var(--jade-deep); }

      .quest-page .donepanel { display: flex; align-items: center; gap: 13px; background: var(--jade-tint); border: 1px solid #cfe9df; border-radius: 14px; padding: 14px 16px; }
      .quest-page .donepanel .dp-ic { width: 36px; height: 36px; border-radius: 99px; background: var(--jade); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
      .quest-page .donepanel .dp-t { font-size: 14px; font-weight: 700; color: var(--jade-deep); }
      .quest-page .donepanel .dp-s { font-size: 12px; color: var(--ink-3); margin-top: 1px; }

      .quest-page .chklist { display: flex; flex-direction: column; gap: 9px; }
      .quest-page .chkrow { display: flex; align-items: center; gap: 12px; font-size: 13.5px; padding: 11px 14px; border: 1px solid var(--mist-strong); border-radius: 12px; background: #fff; }
      .quest-page .chkrow.on { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .chkrow .cb { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; flex-shrink: 0; font-weight: 800; border: 1.5px solid var(--mist-strong); background: #fff; color: transparent; cursor: pointer; transition: all .14s; }
      .quest-page .chkrow.on .cb { background: var(--jade); border-color: var(--jade); color: #fff; }
      .quest-page .chkrow .ct { flex: 1; min-width: 0; }
      .quest-page .chkrow.on .ct { font-weight: 600; }
      .quest-page .ca { display: inline-flex; align-items: center; gap: 4px; width: fit-content; font-size: 12px; font-weight: 700; color: var(--jade-deep); background: none; border: 0; cursor: pointer; text-decoration: underline; white-space: nowrap; }

      .quest-page .upbox { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--surface); border: 1.5px dashed var(--mist-strong); border-radius: 12px; padding: 14px 16px; }
      .quest-page .upbox .uf { display: inline-flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
      .quest-page .upbox .uf .ufi { width: 34px; height: 34px; border-radius: 9px; background: #fff; border: 1px solid var(--mist-strong); display: grid; place-items: center; color: var(--jade-deep); }

      .quest-page .details-wrap { margin-top: 32px; }
      .quest-page .section-eyebrow { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
      .quest-page .section-eyebrow .se-t { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
      .quest-page .section-eyebrow .se-line { flex: 1; height: 1px; background: var(--mist-strong); }
      .quest-page .section-eyebrow .se-link { font-size: 12.5px; font-weight: 600; color: var(--jade-deep); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; background: none; border: 0; }
      .quest-page .detail-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
      .quest-page .dcard { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); padding: 18px 20px; cursor: pointer; transition: all .15s; text-align: left; font-family: inherit; }
      .quest-page .dcard:hover { border-color: var(--mute-2); box-shadow: var(--sh-card); transform: translateY(-2px); }
      .quest-page .dcard .dch { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .quest-page .dcard .dci { width: 34px; height: 34px; border-radius: 10px; background: var(--jade-tint); color: var(--jade-deep); display: grid; place-items: center; }
      .quest-page .dcard .dct { font-size: 13.5px; font-weight: 700; flex: 1; }
      .quest-page .dcard .dca { color: var(--mute-2); }
      .quest-page .dcard .drow { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12.5px; }
      .quest-page .dcard .drow .k { color: var(--mute); }
      .quest-page .dcard .drow .v { font-weight: 600; text-align: right; }
      .quest-page .dcard .dbadge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: var(--saffron-soft); color: var(--saffron-deep); }

      .quest-page .scrim { position: fixed; inset: 0; background: rgba(26,23,20,.4); z-index: 60; opacity: 0; pointer-events: none; transition: opacity .22s; }
      .quest-page .scrim.open { opacity: 1; pointer-events: auto; }
      .quest-page .drawer { position: fixed; top: 0; right: 0; height: 100%; width: 640px; max-width: 94vw; background: var(--surface); z-index: 61; transform: translateX(100%); transition: transform .26s cubic-bezier(.4, 0, .2, 1); display: flex; flex-direction: column; box-shadow: var(--sh-pop); }
      .quest-page .drawer.open { transform: none; }
      .quest-page .drawer .dh { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; background: #fff; border-bottom: 1px solid var(--mist-strong); flex-shrink: 0; }
      .quest-page .drawer .dh .t { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
      .quest-page .drawer .dh .x { width: 36px; height: 36px; border-radius: 9px; background: var(--surface); border: 0; display: grid; place-items: center; color: var(--ink-2); cursor: pointer; }
      .quest-page .dtabs { display: flex; gap: 2px; overflow-x: auto; background: #fff; border-bottom: 1px solid var(--mist-strong); padding: 0 14px; flex-shrink: 0; scrollbar-width: none; }
      .quest-page .dtabs::-webkit-scrollbar { display: none; }
      .quest-page .dtab { display: flex; align-items: center; gap: 7px; padding: 13px; font-size: 12.5px; font-weight: 700; color: var(--mute); background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
      .quest-page .dtab:hover { color: var(--ink-2); }
      .quest-page .dtab.on { color: var(--jade-deep); border-bottom-color: var(--jade); }
      .quest-page .dbody { flex: 1; overflow-y: auto; padding: 18px 22px; }
      .quest-page .chain-link { color: var(--jade-deep); font-weight: 600; text-decoration: none; }
      .quest-page .chain-link:hover { text-decoration: underline; }
      /* Inline contract sections — full-width stacked cards. Anchors
         (span[id]) span the grid with zero height so they don't create
         empty cells. */
      .quest-page .dbody-inline { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
      .quest-page .dbody-inline > .sec { margin-bottom: 0; grid-column: 1 / -1; }
      .quest-page .dbody-inline > span[id] { grid-column: 1 / -1; height: 0; margin: 0; padding: 0; }
      @media (max-width: 980px) { .quest-page .dbody-inline { grid-template-columns: 1fr; } }
      /* Info bar — customer + rental period in one row under the header */
      .quest-page .infobar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 26px; background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); padding: 10px 18px; margin-bottom: 16px; }
      .quest-page .infobar .pitem { display: flex; flex-direction: column; gap: 1px; }
      .quest-page .infobar .pk { font-size: 9.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--mute); }
      .quest-page .infobar .pv { font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; }
      /* divider pushes the rental fields to the right edge of the bar */
      .quest-page .infobar .isep { width: 1px; align-self: stretch; background: var(--mist-strong); margin-left: auto; }
      .quest-page .sec { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); overflow: hidden; margin-bottom: 14px; }
      .quest-page .sec .sech { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--mist); }
      .quest-page .sec .sech .si { color: var(--jade-deep); }
      .quest-page .sec .sech .st { font-size: 14px; font-weight: 700; flex: 1; }
      .quest-page .sec .secb { padding: 14px 18px; }
      .quest-page .subhead { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--jade-deep); margin: 0 0 8px; }
      .quest-page .subhead.mut { color: var(--mute); }
      .quest-page .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 520px) { .quest-page .grid2 { grid-template-columns: 1fr; } }
      .quest-page .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      @media (max-width: 620px) { .quest-page .grid3 { grid-template-columns: 1fr; } }
      /* Propose renewal — the "Current contract" summary: four labelled facts across,
         divided, wrapping to 2×2 on a narrow screen. */
      .quest-page .curcontract { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .quest-page .curcontract > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .quest-page .curcontract > div + div { border-left: 1px solid var(--mist-strong); padding-left: 12px; }
      .quest-page .curcontract b { font-size: 13px; font-weight: 800; color: var(--ink); line-height: 1.35; }
      @media (max-width: 760px) {
        .quest-page .curcontract { grid-template-columns: 1fr 1fr; }
        .quest-page .curcontract > div + div { border-left: 0; padding-left: 0; }
      }
      /* Propose renewal — "Annual Rent − Discount = Contract Value" as one row, with
         the operators between the fields. Stacks (operators hidden) when narrow. */
      .quest-page .rentcalc { display: grid; grid-template-columns: 1fr 14px 1.3fr 14px 1fr; gap: 10px; align-items: start; }
      .quest-page .rentcalc .disc { display: grid; grid-template-columns: 1.25fr 1fr; gap: 8px; }
      .quest-page .rentcalc .op { margin-top: 34px; text-align: center; font-size: 15px; font-weight: 800; color: var(--mute-2); }
      @media (max-width: 760px) {
        .quest-page .rentcalc { grid-template-columns: 1fr; }
        .quest-page .rentcalc .op { display: none; }
      }
      .quest-page .ptable { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .quest-page .ptable th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--mute); font-weight: 700; padding: 8px 8px; border-bottom: 1px solid var(--mist-strong); }
      .quest-page .ptable td { padding: 10px 8px; border-bottom: 1px solid var(--mist); color: var(--ink-2); overflow-wrap: anywhere; }
      .quest-page .ptable tr:last-child td { border-bottom: 0; }
      .quest-page .ptable .amt { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
      .quest-page .ptable tfoot td { border-top: 2px solid #bfe3d5; background: var(--jade-tint); font-weight: 800; }
      .quest-page .ptable tfoot .tot { color: var(--jade-deep); }
      /* Bounce → replacement group. The bounced cheque and every payment recorded
         against it share one warm band with a brick rail down its left edge, so
         the pair reads as a single event rather than as unrelated rent lines
         sitting at their own due dates. */
      .quest-page .ptable tr.replgrp > td { background: var(--brick-soft); border-bottom-color: var(--brick-edge); }
      .quest-page .ptable tr.replgrp > td:first-child { box-shadow: inset 3px 0 0 var(--brick); }
      .quest-page .ptable tr.replkid > td { font-size: 12px; }
      .quest-page .ptable .replarrow { color: var(--brick); font-weight: 800; }
      .quest-page .ptable .repltag { display: inline-block; margin-right: 6px; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--brick-deep); background: #fff; border: 1px solid var(--brick-edge); border-radius: 99px; padding: 1px 7px; vertical-align: 1px; }
      /* Record-payment card — the SAME markup + class names as the lead's
         Record Cheques panel (leads/[id]), so the renewal Cheques step and the
         new-lease cheque recording are one design. Keep the two blocks in step:
         a change here belongs in the lead page's stylesheet too. */
      .quest-page .chqbox { border: 1px solid var(--mist-strong); border-radius: var(--r-md); background: var(--surface); padding: 16px; }
      .quest-page .qinput { width: 100%; font-size: 12.5px; border: 1px solid var(--mist-strong); border-radius: 9px; padding: 8px 10px; background: #fff; color: var(--ink); outline: none; }
      .quest-page .qinput:focus { border-color: var(--jade); }
      .quest-page .qinput:disabled { background: var(--mist); color: var(--ink-3); }
      .quest-page .errline { font-size: 11.5px; color: var(--brick); background: var(--brick-soft); border: 1px solid var(--brick-edge); border-radius: 9px; padding: 7px 10px; margin-bottom: 8px; }
      .quest-page .paygrid { display: grid; gap: 6px; }
      .quest-page .payhead { display: grid; grid-template-columns: minmax(0, 1fr) 108px 122px 136px; gap: 8px; padding: 0 10px 2px; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--mute); }
      .quest-page .payrow { display: grid; grid-template-columns: minmax(0, 1fr) 108px 122px 136px; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--mist-strong); border-radius: 10px; background: #fff; }
      .quest-page .payrow-info { display: flex; align-items: center; gap: 9px; min-width: 0; }
      .quest-page .payrow-n { font-size: 10px; font-weight: 800; color: var(--jade-deep); background: var(--jade-soft); border-radius: 6px; padding: 2px 6px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
      .quest-page .payrow-lbl { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .quest-page .payrow-desc { font-size: 12.5px; color: var(--ink-2); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .quest-page .payrow-sub { font-size: 11px; color: var(--mute); font-variant-numeric: tabular-nums; }
      .quest-page .payrow-ctl { width: 100%; min-width: 0; }
      .quest-page .payrow-rec { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .quest-page .payrow-rec > select { flex: 1 1 auto; min-width: 0; }
      .quest-page .payrow-rec > .btn { flex: 1 1 auto; justify-content: center; }
      .quest-page .payrow-rec > .mini-btn { flex: 0 0 auto; }
      /* The step card's status control is a <select>, so it needs the pill
         palette AND a visible control affordance the read-only .cstat pill
         doesn't carry. Scoped to .chqbox — the record's Payments table sizes its
         own status pills and must not grow to match. */
      .quest-page .chqbox select.cstat { border: 1px solid var(--mist-strong); border-radius: 9px; padding: 7px 8px; font-size: 11.5px; cursor: pointer; }
      @media (max-width: 640px) {
        .quest-page .payhead { display: none; }
        .quest-page .payrow { grid-template-columns: 1fr; }
      }
      .quest-page .linkbtn { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--jade-deep); background: none; border: 0; cursor: pointer; padding: 0; }
      .quest-page .linkbtn:hover { text-decoration: underline; }
      .quest-page .uprow { display: flex; gap: 11px; background: #fff; border: 1px solid var(--mist-strong); border-radius: 12px; padding: 10px; }
      .quest-page .uprow .upthumb { width: 52px; height: 52px; border-radius: 9px; border: 1px solid var(--mist-strong); overflow: hidden; background: var(--surface); display: grid; place-items: center; cursor: pointer; flex-shrink: 0; color: var(--mute); }
      .quest-page .uprow .upthumb:disabled { cursor: default; }
      .quest-page .uprow .upthumb img { width: 100%; height: 100%; object-fit: cover; }
      .quest-page .uprow .upmeta { flex: 1; min-width: 0; }
      .quest-page .uprow .upmeta .dn { font-size: 12.5px; font-weight: 700; color: var(--ink); }
      .quest-page .uprow .upmeta .ds { font-size: 11px; color: var(--mute); margin-top: 1px; }
      .quest-page .uprow .upctl { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; }
      .quest-page .cstat { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 99px; border: 0; }
      .quest-page .cstat.cleared { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .cstat.pending { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .cstat.bounced { background: var(--brick-soft); color: var(--brick); }
      .quest-page .cstat.cancelled { background: var(--mist); color: var(--ink-3); }
      /* deposit settlement (deposit_status) — distinct palette from cheque status */
      .quest-page .cstat.held { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .cstat.returned { background: var(--mist); color: var(--ink-3); }
      .quest-page .cstat.partial_return { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .cstat.forfeited { background: var(--brick-soft); color: var(--brick); }
      .quest-page .doclist { display: flex; flex-direction: column; gap: 5px; }
      .quest-page .docitem { display: flex; align-items: center; gap: 9px; border: 1px solid; border-radius: 9px; padding: 5px 10px; min-height: 32px; }
      .quest-page .docitem > svg { flex-shrink: 0; }
      /* name + status share one line — keeps long checklists short */
      .quest-page .docitem > div:not(.dacts) { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
      .quest-page .docitem .dn { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .quest-page .docitem .ds { font-size: 10.5px; font-weight: 700; white-space: nowrap; flex-shrink: 0; }
      .quest-page .docitem.approved { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .docitem.approved svg, .quest-page .docitem.approved .ds { color: var(--jade-deep); }
      .quest-page .docitem.pending { background: var(--saffron-soft); border-color: var(--saffron-edge); }
      .quest-page .docitem.pending svg, .quest-page .docitem.pending .ds { color: var(--saffron-deep); }
      .quest-page .docitem.rejected { background: var(--brick-soft); border-color: var(--brick-edge); }
      .quest-page .docitem.rejected svg, .quest-page .docitem.rejected .ds { color: var(--brick); }
      /* Missing slots — identical anatomy to on-file rows, dashed border.
         Class is "docmiss" (NOT "missing") to avoid inheriting the journey
         MissingStrip's padding/margin rules. */
      .quest-page .docitem.docmiss { background: #fff; border-style: dashed; border-color: var(--saffron-edge); }
      .quest-page .docitem.docmiss svg, .quest-page .docitem.docmiss .ds { color: var(--saffron-deep); }
      .quest-page .docitem.docmiss .dn { color: var(--mute); }
      .quest-page .docitem.docmiss.req { border-color: var(--brick-edge); }
      .quest-page .docitem.docmiss.req svg, .quest-page .docitem.docmiss.req .ds { color: var(--brick); }
      .quest-page .docitem .dacts { margin-left: auto; display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
      .quest-page .docitem .mini-btn { padding: 3px 8px; }
      .quest-page .docitem .mini-btn:disabled { opacity: .45; cursor: not-allowed; }
      /* Inline expiry capture on an undated KYC copy. The date field + Approve don't fit
         beside the status text in a narrow panel, so this row alone is allowed to wrap its
         action strip onto a second line rather than overflow the card. */
      .quest-page .docitem.needsexp { flex-wrap: wrap; row-gap: 6px; }
      .quest-page .docitem.needsexp .dacts { margin-left: auto; }
      .quest-page .docitem .dexp { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 7px; border: 1px solid var(--saffron-edge); background: #fff; color: var(--ink); font-family: inherit; }
      .quest-page .docitem .dexp:focus { outline: 2px solid var(--saffron-deep); outline-offset: 1px; }
      .quest-page .mini-btn { font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 8px; border: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
      .quest-page .mini-btn.ok { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .mini-btn.no { background: var(--brick-soft); color: var(--brick); }
      .quest-page .mini-btn.view { background: #fff; color: var(--jade-deep); border: 1px solid var(--mist-strong); }
      .quest-page .clause { display: flex; gap: 11px; background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 12px; padding: 11px 14px; margin-bottom: 8px; }
      .quest-page .clause .cn { width: 22px; height: 22px; border-radius: 99px; background: var(--jade); color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center; flex-shrink: 0; }
      .quest-page .clause .ct { flex: 1; font-size: 13px; color: var(--ink-2); line-height: 1.45; }
      .quest-page .drow2 { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--mist); font-size: 13px; }
      .quest-page .drow2:last-child { border-bottom: 0; }
      .quest-page .drow2 .k { color: var(--mute); }
      .quest-page .drow2 .v { font-weight: 600; text-align: right; }

      .quest-page .mscrim { position: fixed; inset: 0; background: rgba(26,23,20,.45); backdrop-filter: blur(3px); z-index: 70; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .quest-page .modal { background: #fff; border-radius: 20px; box-shadow: var(--sh-pop); width: 100%; display: flex; flex-direction: column; max-height: 92vh; overflow: hidden; }
      .quest-page .modal.sm { max-width: 460px; }
      .quest-page .modal.lg { max-width: 680px; }
      /* Propose renewal: a whole term's terms + fee grid + planned schedule in one
         pass, so it gets more room than a regular lg modal. */
      .quest-page .modal.xl { max-width: 980px; }
      .quest-page .modal .mh { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--mist); flex-shrink: 0; }
      .quest-page .modal .mt { font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
      .quest-page .modal .mt .mti { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: #fff; }
      .quest-page .modal .x { width: 34px; height: 34px; border-radius: 9px; border: 0; background: var(--surface); color: var(--ink-2); display: grid; place-items: center; cursor: pointer; }
      .quest-page .modal .mb { padding: 22px; overflow-y: auto; }
      .quest-page .modal .mf { padding: 14px 22px; border-top: 1px solid var(--mist); display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0; }
      .quest-page .sigpad { border: 1.5px dashed var(--mist-strong); border-radius: 12px; background: var(--surface); position: relative; overflow: hidden; }
      .quest-page .sigpad canvas { display: block; width: 100%; height: 170px; cursor: crosshair; touch-action: none; }
      .quest-page .sigpad .ph { position: absolute; inset: 0; display: grid; place-items: center; color: var(--mute-2); font-size: 13.5px; pointer-events: none; }
      .quest-page .signas { display: flex; align-items: center; gap: 11px; background: var(--jade-tint); border: 1px solid #cfe9df; border-radius: 12px; padding: 12px 15px; margin-bottom: 16px; }
      .quest-page .signas .sa-ic { color: var(--jade-deep); }
      .quest-page .signas .sa-l { font-size: 11px; color: var(--mute); }
      .quest-page .signas .sa-n { font-size: 14px; font-weight: 700; }
      .quest-page .field { margin-bottom: 13px; }
      .quest-page .field label { display: block; font-size: 11.5px; font-weight: 700; color: var(--ink-3); margin-bottom: 5px; }
      .quest-page .input { width: 100%; font-size: 13.5px; padding: 11px 13px; border: 1px solid var(--mist-strong); border-radius: 10px; background: #fff; }
      .quest-page .input:focus { outline: none; border-color: var(--jade); }
      .quest-page textarea.input { resize: vertical; min-height: 70px; }
      .quest-page .infopanel { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 14px; padding: 16px 18px; }
    `}</style>
  );
}
