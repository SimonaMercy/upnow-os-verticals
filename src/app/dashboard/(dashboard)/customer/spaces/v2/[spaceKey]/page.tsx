/**
 * Customer — My Spaces v2 (Quest Layout) — full-fledged implementation.
 *
 * Route: /dashboard/customer/spaces/v2/[spaceKey]
 * spaceKey format mirrors v1: `v-<leadId>` for viewing groups, `d-<leadId>` for direct leads.
 *
 * Every action wired to the same backend endpoints v1 uses. No links back to v1.
 * Document uploads + move-in inspection deep-link to their canonical pages
 * (/dashboard/customer/documents and /dashboard/customer/contracts/:id/inspection)
 * because that's where those flows live for the whole product — not a "v1 escape".
 *
 * Endpoints used:
 *   PATCH  /api/leads/my-viewings/:id/reschedule         { scheduledAt }
 *   PATCH  /api/leads/my-viewings/:id/not-interested     { notes? }
 *   PATCH  /api/leads/:leadId/cheques-ready
 *   POST   /api/contracts/tenant/:id/sign                { signatoryName, signatureImage }
 *   PATCH  /api/contracts/tenant/:id/utility             { utilityAccountNumber }
 *   POST   /api/contracts/tenant/:id/termination/request { reason, effectiveDate }
 *   PATCH  /api/contracts/tenant/:id/termination/respond { response }
 *   PATCH  /api/contracts/:parentId/renewal/accept
 *   PATCH  /api/contracts/:parentId/renewal/reject
 *   POST   /api/contracts/tenant/:childId/cheques-submitted
 *   POST   /api/documents/upload-url                     (utility proof; presigned S3)
 *   POST   /api/documents                                (register doc after PUT)
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, AlertCircle, Clock, MapPin, FileText, Pen, Stamp,
  Zap, Key, BadgeCheck, Mail, Phone, Wallet, Binoculars, Calendar, ChevronRight,
  Info, ChevronDown, ChevronLeft,
  X, CheckCircle2, UploadCloud, ExternalLink, Printer,
  Sparkles, ArrowRight, Camera, Trash2, ClipboardCheck,
} from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { openDocViewer } from '@/lib/docViewer';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { KYC_DOCS, RESIDENTIAL_RENTAL_DOCS, getRentalSectionDocs, getRequiredDocs, getOccupantDocs, deriveOccupantCount, isDocKeySatisfied } from '@/lib/docRequirements';
import type { DocReq } from '@/lib/docRequirements';
import { useAuth } from '@/contexts/AuthContext';

/* ─── Brand palette ─────────────────────────────────────────────────── */
const PALETTE: React.CSSProperties = {
  // @ts-expect-error custom CSS props
  '--ink': '#1a1916',
  '--ink-2': '#3d3b35',
  '--mute': '#9b9890',
  '--paper': '#ffffff',
  '--surface': '#f9f8f6',
  '--mist': '#f0ede8',
  '--mist-strong': '#e8e6e0',
  '--jade': '#2e9f82',
  '--jade-deep': '#1f5a3f',
  '--jade-soft': '#d8f2e8',
  '--saffron': '#f59e0b',
  '--saffron-deep': '#c2410c',
  '--saffron-soft': '#fff7ed',
  '--brick': '#c8492c',
  '--brick-soft': '#fee2e2',
};

/* ─── Types ─────────────────────────────────────────────────────────── */
interface ApiRentalProvider {
  companyName?: string | null;
  entityType?: 'individual' | 'company' | null;
  /** Optional: literally the name on the bank account / cheque (set by RP in profile). */
  bankAccountName?: string | null;
  /** Optional RP-restricted day-of-month list (1–28) for contract start dates. */
  preferredStartDays?: number[] | null;
  /** Optional RP-restricted installment plans (subset of [1,2,3,4,6,12]). Empty = all. */
  allowedInstallments?: number[] | null;
  user?: { name?: string | null } | null;
}
interface ApiUnit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType?: string | null;
  bedrooms?: number | null;
  rentalPrice?: number | null;
  premiseNumber?: string | null;
  property?: {
    buildingName?: string;
    fullAddress?: string | null;
    community?: { name: string } | null;
    emirate?: { name: string } | null;
    rentalProvider?: ApiRentalProvider | null;
    /** Backend sometimes serialises with snake_case; v1 also checks both shapes. */
    rental_provider?: ApiRentalProvider | null;
  };
}
interface ApiPaymentPlanItem {
  index: number;
  amountFils: number;
  dueDate: string;
  description?: string;
  type?: 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
}
/** Method classifier for an individual payment (per-cheque on the RP side
 *  in Phase 5b). The customer never picks this — they just attach the
 *  reference (cheque photo, transfer screenshot, card slip, cash receipt);
 *  the landlord tags each one on approval. */
export type PaymentMethodKind = 'cheque' | 'bank_transfer' | 'card' | 'cash';

interface ApiPaymentPlan {
  chequeCount: number;
  /** Rent-only installment count (Annual=1, Semi-annual=2, Quarterly=4, etc.).
   *  Distinct from `chequeCount` which includes the security-deposit row. */
  installmentCount?: number;
  totalAmountFils: number;
  rentFils: number;
  originalRentFils?: number;
  securityDepositFils?: number;
  adminFeeFils?: number;
  ejariFils?: number;
  commissionFils?: number;
  items?: ApiPaymentPlanItem[];
  notes?: string;
  rentalIndexReportUrl?: string;
  chequesPayableTo?: string;
  issuedAt: string;
}
interface ApiNestedLead {
  id: number;
  stage: string;
  paymentPlan?: ApiPaymentPlan | null;
  additionalDocsNote?: string | null;
}
interface ApiViewing {
  id: number;
  scheduledAt: string;
  status: string;
  outcome?: string | null;
  leadId?: number;
  leadStage?: string;
  lead?: ApiNestedLead | null;
  unit?: ApiUnit | null;
  desiredMoveIn?: string | null;
  preferredChequeCount?: number | null;
  paymentType?: string | null;
  occupantsAdults?: number | null;
  occupantsChildren?: number | null;
  occupantsPets?: number | null;
  occupantsDetails?: string | null;
}
interface ApiLead {
  id: number;
  stage: string;
  createdAt: string;
  unit?: ApiUnit | null;
  additionalDocsNote?: string | null;
  paymentPlan?: ApiPaymentPlan | null;
}
interface ApiTermination {
  requestedByRole: 'tenant' | 'rental_provider' | null;
  requestedAt: string | null;
  reason: string | null;
  effectiveDate: string | null;
  response: 'pending' | 'accepted' | 'rejected' | null;
}

interface ApiSettlementLine { id: number; label: string; amount: number; type: 'deduction' | 'due' }
interface ApiSettlement {
  status: 'sent' | 'agreed' | 'paid';
  depositHeld: number;
  notes: string | null;
  refundAmount: number | null;
  lines: ApiSettlementLine[];
  paymentsReceivedTotal?: number;
  balance?: number;
  sentAt: string | null;
  agreedAt: string | null;
  paidAt: string | null;
}
interface ApiContractPayment {
  id: number;
  paymentType: string | null;
  description: string | null;
  amountPaid: number;
  transactionDate: string | null;
  chequeStatus?: string | null;
}

interface ApiContract {
  id: number;
  ref?: string | null;
  status: string;
  contractType?: string | null;
  parentContractId?: number | null;
  /** Soft-archive flag (docs/CONTRACT_LIFECYCLE.md §3.2). For new-lease rows
   *  this becomes false when the unit was leased to a different customer
   *  before this draft activated — the customer sees the "superseded" state. */
  contractActive?: boolean;
  ejariStatus: string | null;
  utilityStatus: string | null;
  utilityAccountNumber: string | null;
  numberOfInstallments: number | null;
  startDate: string | null;
  endDate: string | null;
  annualRent: number;
  contractValue?: number | null;
  securityDepositAmount?: number | null;
  adminFeeFils?: number | null;
  ejariFeeFils?: number | null;
  tenantSignedAt: string | null;
  landlordSignedAt: string | null;
  unit: { id: number | null; number?: string | null; name?: string | null; unitNumber?: string | null; unitName?: string | null; unitType?: string | null; bedrooms?: number | null };
  property?: { id?: number | null; buildingName?: string | null; fullAddress?: string | null } | null;
  renewalAccepted?: 'pending' | 'accepted' | 'rejected' | null;
  /** You declined the renewal to vacate → move-out + deposit settlement wind-down. */
  vacateAtEnd?: boolean;
  moveInInspection?: { submitted: boolean; signedByTenant: boolean; signedAt: string | null } | null;
  moveOutInspection?: { submitted: boolean; signedByTenant: boolean; signedAt: string | null } | null;
  termination?: ApiTermination | null;
  /** Per-installment schedule. Populated for any contract that has Payment
   *  rows; for proposed renewals this drives the inline schedule preview on
   *  the renewal_offered action card. */
  payments?: ApiContractPayment[];
}

/**
 * 8-step customer journey (Phase 1 collapse — May 30, 2026):
 *   booked → docs_required → payment_review → awaiting_rp_confirm
 *          → signature → ejari → utility → move_in → active
 *
 * `docs_required` is conditional — hidden from the timeline when the customer's
 *  KYC is complete AND occupants=1 AND no RP-requested extras. `deriveStateKey`
 *  skips straight to `payment_review` in that case.
 *
 * Cross-cutting states (termination, rejected, terminated) and the renewal
 *  journey are preserved as-is from the previous machine.
 */
type StateKey =
  | 'booked'
  | 'docs_required'
  | 'docs_under_review'
  | 'payment_review'
  | 'awaiting_rp_confirm'
  | 'signature' | 'ejari' | 'utility'
  | 'move_in' | 'active'
  | 'termination_request_received' | 'termination_request_sent'
  | 'renewal_offered' | 'renewal_documents' | 'renewal_cheques'
  | 'renewal_progress' | 'renewal_ejari' | 'renewal_active'
  | 'rejected' | 'terminated' | 'renewal_rejected'
  | 'superseded' | 'terminating';

type Mode = 'new' | 'renewal' | 'rejected';

interface StateDef {
  label: string;
  sub: string;
  mode: Mode;
  currentIndex: number;
  tone: 'action' | 'waiting' | 'celebrate' | 'declined';
  headline: string;
  body: string;
  timing: string | null;
}

// Copy guideline: headline carries the state, body adds the next action or
// new context — never restates what the headline already says. Keep both
// short; the timing row carries the "how long" beat.
const STATE_DEFS: Record<StateKey, StateDef> = {
  booked:                        { label: 'Viewing booked',                sub: 'Step 1 of 8',                     mode: 'new',     currentIndex: 0,  tone: 'action',    headline: 'Your viewing is confirmed.',                              body: 'Look over the cost summary below. Tap “I’m Interested” when you’re ready to commit to this unit.',                                                                                              timing: null },
  docs_required:                 { label: 'Documents required',            sub: 'Step 2 of 8',                     mode: 'new',     currentIndex: 1,  tone: 'action',    headline: 'Almost there. Let us gather your paperwork.',             body: 'Add the missing identity and supporting documents below. Most customers finish in under 5 minutes.',                                                                                            timing: 'Takes ~5 min' },
  docs_under_review:             { label: 'Documents under review',        sub: 'Step 2 of 8',                     mode: 'new',     currentIndex: 1,  tone: 'waiting',   headline: 'Your documents are with our team.',                       body: 'Once approved, your payment summary and contract preview unlock so you can prepare payments.',                                                                                                  timing: 'Usually within 1 business day' },
  payment_review:                { label: 'Payment & references',          sub: 'Step 3 of 8',                     mode: 'new',     currentIndex: 2,  tone: 'action',    headline: 'Review your plan and prepare your cheques or payments accordingly.', body: 'Attach a reference for each one — cheque photo, transfer screenshot, card slip or cash receipt — so it can be verified.',                                                                       timing: 'Takes ~5 min' },
  awaiting_rp_confirm:           { label: 'Payments under review',         sub: 'Step 3 of 8',                     mode: 'new',     currentIndex: 2,  tone: 'waiting',   headline: 'Your rental provider is reviewing your payments.',       body: 'Each reference is being verified against your contract before it’s issued for signature.',                                                                                                       timing: 'Usually within 1 business day' },
  signature:                     { label: 'Awaiting your signature',       sub: 'Step 4 of 8',                     mode: 'new',     currentIndex: 3,  tone: 'action',    headline: 'One signature stands between you and the keys.',          body: 'Open the final contract, then add your signature below.',                                                                                                                                         timing: 'Takes ~2 min' },
  ejari:                         { label: 'Ejari in progress',             sub: 'Step 5 of 8',                     mode: 'new',     currentIndex: 4,  tone: 'waiting',   headline: 'Your rental provider is registering Ejari.',              body: 'The certificate will appear here for download the moment it’s uploaded.',                                                                                                                       timing: '2-5 business days' },
  utility:                       { label: 'Confirm utility account',       sub: 'Step 6 of 8',                     mode: 'new',     currentIndex: 5,  tone: 'action',    headline: 'Confirm your DEWA / utility account.',                    body: 'Premises number is pre-filled. Add your account number, upload a proof of payment, and submit.',                                                                                                timing: 'Takes ~1 min' },
  move_in:                       { label: 'Move-in inspection',            sub: 'Step 7 of 8',                     mode: 'new',     currentIndex: 6,  tone: 'action',    headline: 'Review the inspection. Then collect your keys.',          body: 'Walk through every room and meter reading, then counter-sign so the record is official.',                                                                                                       timing: 'Takes ~3 min' },
  active:                        { label: 'Active tenancy',                sub: 'Step 8 of 8 — tenancy is live',   mode: 'new',     currentIndex: 7,  tone: 'celebrate', headline: 'Your tenancy is live.',                                   body: 'Manage payments, raise issues, or start a renewal request from here any time.',                                                                                                                 timing: null },
  termination_request_received:  { label: 'Provider requested termination',sub: 'Respond required',                mode: 'new',     currentIndex: 7,  tone: 'action',    headline: 'Your rental provider wants to end the contract early.',   body: 'Check the reason and effective date below, then accept or reject.',                                                                                                                             timing: 'Awaiting your response' },
  termination_request_sent:      { label: 'Your termination request',      sub: 'Awaiting rental provider',        mode: 'new',     currentIndex: 7,  tone: 'waiting',   headline: 'Your request is with the rental provider.',               body: "Your contract stays active until they accept. We'll notify you the moment they respond.",                                                                                                       timing: 'Awaiting rental provider response' },

  renewal_offered:               { label: 'Renewal offered',               sub: 'Renewal step 1 of 4',             mode: 'renewal', currentIndex: 0,  tone: 'action',    headline: 'Stay another year? Here are the new terms.',             body: 'Preview the contract, confirm your payments are ready, then accept to lock the terms in.',                                                                                                       timing: 'Awaiting your decision' },
  // Kept defined so the state map stays exhaustive, but no longer rendered
  // as a default timeline step. Routing only lands here if a future phase
  // turns the renewal docs step back on for expired KYC.
  renewal_documents:             { label: 'Renewal documents',             sub: 'Renewal step — documents',           mode: 'renewal', currentIndex: 0,  tone: 'action',    headline: 'Quick paperwork refresh for the renewal.',               body: "Old Emirates ID and visa copies don't carry over — please re-upload.",                                                                                                                         timing: 'Takes ~3 min' },
  // Defined for back-compat with old proposed renewals that never went
  // through accept; new renewals skip this state entirely.
  renewal_cheques:               { label: 'Renewal payments',              sub: 'Renewal step — payments',            mode: 'renewal', currentIndex: 1,  tone: 'action',    headline: 'New year, new payments.',                                 body: 'Prepare each one against the renewal schedule below, then confirm.',                                                                                                                            timing: 'Confirm when ready' },
  renewal_progress:              { label: 'Sign your renewal',             sub: 'Renewal step 2 of 4',             mode: 'renewal', currentIndex: 1,  tone: 'action',    headline: 'Last bit — sign your renewal.',                          body: 'Add your signature to lock in the renewed lease.',                                                                                                                                                timing: 'Takes ~2 min' },
  renewal_ejari:                 { label: 'Renewing Ejari',                sub: 'Renewal step 3 of 4',             mode: 'renewal', currentIndex: 2,  tone: 'waiting',   headline: 'Your rental provider is renewing Ejari.',                 body: 'The Dubai Land Department is updating your record.',                                                                                                                                            timing: '2-5 business days' },
  renewal_active:                { label: 'Renewal active',                sub: 'Renewal step 4 of 4 — done',      mode: 'renewal', currentIndex: 3,  tone: 'celebrate', headline: 'Your renewal is live.',                                   body: 'Everything carries over — same unit, same deposit, fresh paperwork.',                                                                                                                           timing: null },

  rejected:                      { label: 'Application declined',          sub: 'This unit',                       mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'Your rental provider declined this application.',        body: "Sometimes it's the provider, sometimes it's timing. We'll help you find a place that fits.",                                                                                                  timing: null },
  terminated:                    { label: 'Tenancy terminated',            sub: 'Contract closed',                 mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'Your tenancy has ended.',                                body: 'Final settlements processed; security deposit return pending move-out inspection.',                                                                                                             timing: null },
  renewal_rejected:              { label: 'Renewal declined',              sub: 'Renewal closed',                  mode: 'renewal',  currentIndex: -1, tone: 'declined', headline: 'You declined this renewal offer.',                       body: 'New terms can still be proposed, or your tenancy will end as scheduled.',                                                                                                                       timing: null },
  // Phase 6c — a stale draft that the RP archived because the unit was
  // leased to another customer before this draft could activate. The
  // customer journey dead-ends here; we route them to the listings.
  superseded:                    { label: 'Unit no longer available',      sub: 'Browse other listings',           mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'This unit has been leased to another customer.',         body: "Your draft contract has been archived. Browse other listings to find a new home — we've kept your documents on file to speed up the next booking.",                                            timing: null },
  // Phase 6c — accepted termination, contract still ACTIVE until the
  // move-out date. Wind-down view: no renewals, no money flow changes,
  // just a count-down to the effective date.
  terminating:                    { label: 'Move-out scheduled',           sub: 'Tenancy winding down',            mode: 'new',      currentIndex: 7,  tone: 'waiting',  headline: 'Move-out is scheduled.',                                  body: 'Your tenancy stays active until the effective date. Get your move-out checklist ready and arrange the final inspection.',                                                                       timing: 'Until effective date' },
};

interface Step { key: string; label: string; short: string; icon: string }

const STEPS_NEW: Step[] = [
  { key: 'booked',          label: 'Booked',             short: 'Booked',   icon: 'calendar' },
  { key: 'documents',       label: 'Documents',          short: 'Docs',     icon: 'document' },
  { key: 'payment',         label: 'Payment & cheques',  short: 'Payment',  icon: 'wallet'   },
  { key: 'sign',            label: 'Sign contract',      short: 'Sign',     icon: 'pen'      },
  { key: 'ejari',           label: 'Ejari',              short: 'Ejari',    icon: 'stamp'    },
  { key: 'utility',         label: 'Utility',            short: 'Utility',  icon: 'bolt'     },
  { key: 'move_in',         label: 'Move-in',            short: 'Move-in',  icon: 'key'      },
  { key: 'active',          label: 'Active tenancy',     short: 'Active',   icon: 'active'   },
];
// Renewal journey trimmed in Phase 6 to 4 steps. The customer confirms
// payment readiness via a checkbox on the Terms card itself, so the
// dedicated "Cheques" step is gone. Document refresh is handled as a
// conditional gate inside the renewal flow (only fires when KYC has
// actually expired) — so we don't show it as a default step either.
const STEPS_RENEWAL: Step[] = [
  { key: 'terms_offered',   label: 'Terms offered',      short: 'Terms',    icon: 'envelope' },
  { key: 'sign',            label: 'Sign renewal',       short: 'Sign',     icon: 'pen'      },
  { key: 'ejari',           label: 'Ejari renewal',      short: 'Ejari',    icon: 'stamp'    },
  { key: 'active',          label: 'Renewal active',     short: 'Active',   icon: 'active'   },
];

/** A single uploaded cheque photo with its AI-extracted fields. The
 *  full schema is built out in Phase 4 (Step 3 — AI cheque extraction);
 *  this minimal shape is what the ChequesReviewWaitAction list renders. */
interface CustomerCheque {
  id: number;
  index: number;
  chequeNumber?: string | null;
  amountFils?: number | null;
  dueDate?: string | null;
  drawerName?: string | null;
  bankName?: string | null;
  imageUrl?: string | null;
  notes?: string | null;
  status?: 'pending' | 'approved' | 'rejected';
}

interface TenantDoc {
  id?: number;
  documentKey: string;
  displayName?: string | null;
  status?: string;
  fileUrl?: string | null;
}

interface Resolved {
  spaceKey: string;
  unit: ApiUnit | null;
  contract: ApiContract | null;
  renewalContract: ApiContract | null;
  lead: ApiLead | null;
  viewing: ApiViewing | null;
  paymentPlan: ApiPaymentPlan | null;
  stage: string | null;
  allRequiredDocsUploaded: boolean;
  /** Customer has explicitly clicked "Submit documents" (client-side gate,
   *  persisted in localStorage). Until then docs are NOT shown as under review,
   *  even when every required file is uploaded. */
  docsSubmitted?: boolean;
  tenantProfileId: number | null;
  myDocs: TenantDoc[];
}

// Customer "submit documents" gate — persisted per-space in localStorage. The
// uploaded files are already visible to the RP; this just lets the customer
// decide WHEN their docs flip from "upload" to "submitted / under review",
// instead of auto-advancing the moment the last file lands.
const docsSubmitKey = (spaceKey: string) => `upnow_docs_submitted_${spaceKey}`;
function readDocsSubmitted(spaceKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(docsSubmitKey(spaceKey)) === '1'; } catch { return false; }
}
function writeDocsSubmitted(spaceKey: string) {
  try { window.localStorage.setItem(docsSubmitKey(spaceKey), '1'); } catch { /* ignore */ }
}

/**
 * Map current backend state (contract + lead.stage + viewing + docs + payment plan)
 * to one of the 8 customer-visible steps (plus cross-cutting states).
 *
 * Order matters: termination wins over active, renewal-pending wins over the
 * child contract's own state, terminated/rejected dead-ends short-circuit
 * everything else.
 *
 * `pending`-status contracts are treated as "no contract yet" so the customer
 * still sees Steps 1–3 instead of Step 4. The contract object is only consulted
 * once the RP has actually issued it.
 */
function deriveStateKey(r: Resolved): StateKey {
  const c = r.contract?.status === 'pending' ? null : r.contract;
  const rc = r.renewalContract;
  const viewing = r.viewing;
  const stage = r.stage;

  // ── 0. Lifecycle dead-ends that override everything below
  //   (docs/CONTRACT_LIFECYCLE.md §3.2 + §4.3).
  //
  // A new-lease draft whose unit was leased to another customer before it
  // could activate is marked contractActive=false. We dead-end the journey
  // here so the customer is steered back to /listings instead of staring at
  // a half-finished step they can't complete.
  if (
    r.contract &&
    r.contract.contractActive === false &&
    r.contract.contractType !== 'renewal' &&
    (r.contract.status === 'pending' || r.contract.status === 'issued')
  ) {
    return 'superseded';
  }

  // ── 1. Renewal proposal status on the original contract wins over child state.
  if (c?.renewalAccepted === 'pending') return 'renewal_offered';
  if (c?.renewalAccepted === 'rejected') {
    // Declined to VACATE → move-out wind-down on the still-active lease (handled
    // by ActiveAction, which shows the move-out inspection + deposit settlement).
    // Declined to NEGOTIATE → dead-end until the provider re-proposes.
    if (c?.vacateAtEnd && c?.status === 'active') return 'active';
    if (c?.vacateAtEnd && c?.status === 'expired') return 'terminated';
    return 'renewal_rejected';
  }

  // ── 2. Renewal child in flight — only consulted AFTER customer accepted.
  if (rc) {
    if (rc.status === 'terminated') return 'renewal_rejected';
    if (rc.status === 'active') return 'renewal_active';
    if (rc.ejariStatus === 'registered') return 'renewal_ejari';
    if (rc.status === 'issued') {
      // Advance to Ejari only once BOTH parties have signed — not on the
      // tenant's signature alone. Otherwise stay in the signing step.
      if (rc.tenantSignedAt && rc.landlordSignedAt) return 'renewal_ejari';
      return 'renewal_progress';
    }
    return 'renewal_cheques';
  }

  // ── 3. Original contract drives Steps 4–8.
  if (c) {
    if (c.status === 'terminated') return 'terminated';

    const t = c.termination;
    if (t?.response === 'pending') {
      if (t.requestedByRole === 'rental_provider') return 'termination_request_received';
      if (t.requestedByRole === 'tenant') return 'termination_request_sent';
    }
    // Deferred-end termination (docs/CONTRACT_LIFECYCLE.md §4.3): both
    // parties have agreed, contract stays ACTIVE until effective date.
    if (t?.response === 'accepted' && c.status === 'active') return 'terminating';

    if (c.status === 'active') return 'active';

    const hasUtility = c.utilityStatus === 'submitted' || c.utilityStatus === 'verified';
    const inspectionSubmitted = !!c.moveInInspection?.submitted;
    const inspectionSignedByTenant = !!c.moveInInspection?.signedByTenant;

    // Step 7 (move_in) covers both halves of the inspection flow — waiting
    // for the landlord to submit AND awaiting the customer's counter-sign.
    // The MoveInAction component decides which sub-UI to render based on
    // `inspectionSubmitted` + `inspectionSignedByTenant`.
    if (c.ejariStatus === 'registered' && hasUtility) return 'move_in';
    if (c.ejariStatus === 'registered') return 'utility';
    if (c.status === 'issued' && c.tenantSignedAt) return 'ejari';
    if (c.status === 'issued' && !c.tenantSignedAt) return 'signature';
    // Contract is `issued` but tenantSignedAt is null and we haven't matched
    // anything else — still Step 4 (signature). Customer needs to sign.
    return 'signature';
  }

  // ── 4. Dead-end states (no contract yet).
  if (stage === 'rejected') return 'rejected';
  if (viewing?.outcome === 'not_interested') return 'rejected';
  if (viewing?.status === 'no_show' || viewing?.status === 'cancelled') return 'rejected';

  // ── 5. Steps 1–3 (pre-contract). Order matters here.

  // 5a. Cheques flow always wins — once the customer has submitted them,
  // they're past Steps 1 and 2 by definition.
  if (stage === 'cheques_submitted' || stage === 'cheques_collected') return 'awaiting_rp_confirm';

  // 5b. Once the customer expresses interest, check docs FIRST. The
  // backend auto-generates a payment plan on express-interest, so
  // `r.paymentPlan` is truthy from the moment they confirm — but we
  // still owe a manual admin/RP review before unlocking Step 3.
  //
  //   docs missing       → docs_required
  //   docs uploaded      → docs_under_review (admin/RP review gate)
  //   stage `payment_plan_shared` / approved / converted
  //                      → payment_review (review complete, unlocked)
  //
  // The RP/admin issues the payment plan via /leads/:id/issue-payment-plan
  // (or marks the lead approved) which flips lead.stage. On the next
  // customer refresh we drop into the `payment_plan_shared` branch
  // below and Step 3 unlocks.
  if (stage === 'interested') {
    return (r.allRequiredDocsUploaded && r.docsSubmitted) ? 'docs_under_review' : 'docs_required';
  }

  // 5c. Documents-collection stage (legacy path before the 'interested'
  // stage existed) — same gate as above.
  if (stage === 'documents_collection') {
    return (r.allRequiredDocsUploaded && r.docsSubmitted) ? 'docs_under_review' : 'docs_required';
  }

  // 5d. Plan-issued / approved — RP has explicitly shared the plan or
  // accepted the application; review is complete. Customer unlocks
  // Step 3 (`payment_review`) with the cheque schedule + contract
  // preview.
  if (stage === 'payment_plan_shared' || stage === 'approved' || stage === 'converted') return 'payment_review';

  // 5e. Stale auto-generated plan with no stage transition — we still
  // hold the customer at docs_under_review until RP/admin signals
  // approval explicitly. Avoids the previous bug where the auto-plan
  // alone teleported the customer past the review gate.
  if (r.paymentPlan && r.allRequiredDocsUploaded && r.docsSubmitted) return 'docs_under_review';
  if (r.paymentPlan) return 'docs_required';

  // ── 6. Step 1 — booked. Customer hasn't expressed Interest yet (or hasn't
  // attended the viewing). The Booked card carries the "I'm Interested" CTA.
  return 'booked';
}

/**
 * Map state-machine state → timeline step key so we can compute which
 * step is "current" after filtering. Anything not in this map (renewal
 * / termination / dead-end states) falls back to STATE_DEFS.currentIndex
 * since those flows render their own dedicated step list anyway.
 */
const STATE_TO_STEP_KEY: Partial<Record<StateKey, string>> = {
  booked:               'booked',
  docs_required:        'documents',
  docs_under_review:    'documents',
  payment_review:       'payment',
  awaiting_rp_confirm:  'payment',
  signature:            'sign',
  ejari:                'ejari',
  utility:              'utility',
  move_in:              'move_in',
  active:               'active',
};

/**
 * Decide which timeline steps this particular customer needs to walk
 * through. The 8-step journey is fixed for new tenancies — every pin
 * stays visible from Booked → Active so the static "Step N of 8" labels
 * in STATE_DEFS line up with the timeline highlight (previous attempts
 * to hide the Docs pin once uploaded caused exactly that mismatch).
 */
function getVisibleSteps(_resolved: Resolved | null, currentStateKey: StateKey): Step[] {
  const def = STATE_DEFS[currentStateKey];
  return def.mode === 'renewal' ? STEPS_RENEWAL : STEPS_NEW;
}

function stepsFor(stateKey: StateKey, resolved?: Resolved | null):
  { steps: (Step & { state: 'done' | 'current' | 'future' | 'declined' })[]; mode: Mode; currentIndex: number } {
  const def = STATE_DEFS[stateKey];
  const visibleSteps = getVisibleSteps(resolved ?? null, stateKey);
  // Recompute currentIndex against the (possibly filtered) step list so
  // the highlight stays anchored to the right step after hiding Docs.
  const stepKey = STATE_TO_STEP_KEY[stateKey];
  const computedIdx = stepKey ? visibleSteps.findIndex(s => s.key === stepKey) : -1;
  const currentIndex = computedIdx >= 0 ? computedIdx : def.currentIndex;
  return {
    mode: def.mode,
    currentIndex,
    steps: visibleSteps.map((s, i) => ({
      ...s,
      state: def.mode === 'rejected'
        ? 'declined'
        // Celebrate states (active tenancy, renewal active) = journey complete →
        // mark every step including the final one as 'done' (green), not 'current' (red).
        // The brick "now" indicator only makes sense while there's still an action to take.
        : def.tone === 'celebrate'
          ? (i <= currentIndex ? 'done' : 'future')
          : i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
    })),
  };
}

/* ─── Helpers ──────────────────────────────────────────────────────── */
/** Person display name: prefer firstName+lastName; fall back to `name` only
 *  when it isn't a phone number (phone-only signups store the phone there). */
function personName(u: { firstName?: string | null; lastName?: string | null; name?: string | null } | null | undefined): string {
  if (!u) return '';
  const composed = [u.firstName?.trim(), u.lastName?.trim()].filter(Boolean).join(' ');
  if (composed) return composed;
  const name = (u.name ?? '').trim();
  return /^\+?\d[\d\s\-().]{5,}$/.test(name) ? '' : name;
}

function fmtAed(n: number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n);
}
/** PaymentPlan stores money in fils (1 AED = 100 fils). Always divide before display. */
function fmtAedFils(fils: number | null | undefined) {
  if (fils == null) return '—';
  return fmtAed(fils / 100);
}
function fmtDateLong(iso: string) {
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-AE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: APP_TIME_ZONE });
}
function fmtDateShort(iso: string) {
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE });
}

const PLAN_TYPE_ORDER: Record<string, number> = { first_bundle: 0, installment: 1, extra_installment: 2, security_deposit: 3 };
function sortPlanItems(items: ApiPaymentPlanItem[]): ApiPaymentPlanItem[] {
  return [...items].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return a.index - b.index;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    const cmp = a.dueDate.localeCompare(b.dueDate);
    if (cmp !== 0) return cmp;
    const ta = PLAN_TYPE_ORDER[a.type ?? 'installment'] ?? 1;
    const tb = PLAN_TYPE_ORDER[b.type ?? 'installment'] ?? 1;
    return ta !== tb ? ta - tb : a.index - b.index;
  });
}

/* ─── Quest map (SVG path + waypoints) ─────────────────────────────── */
function StepIconPaths({ name }: { name: string }) {
  const sets: Record<string, React.ReactNode> = {
    calendar:   <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 3v4" /><path d="M16 3v4" /></>,
    binoculars: <><path d="M5 8c0-1.7 1.3-3 3-3s3 1.3 3 3v9c0 1.7-1.3 3-3 3s-3-1.3-3-3z" /><path d="M13 8c0-1.7 1.3-3 3-3s3 1.3 3 3v9c0 1.7-1.3 3-3 3s-3-1.3-3-3z" /><path d="M11 11h2" /></>,
    document:   <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
    wallet:     <><path d="M3 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 7l3-3h11" /></>,
    scroll:     <><path d="M4 5c0-1 1-2 2-2h11c1 0 2 1 2 2v12a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2V5" /><path d="M9 9h7M9 13h7" /></>,
    pen:        <><path d="M14 4l6 6L9 21H3v-6z" /></>,
    stamp:      <><path d="M9 3v6.5a2.5 2.5 0 0 1-5 0" /><path d="M15 3v6.5a2.5 2.5 0 0 0 5 0" /><rect x="3" y="13" width="18" height="4" rx="1" /></>,
    bolt:       <><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></>,
    key:        <><circle cx="8" cy="14" r="4.5" /><path d="M12.5 13L21 13" /><path d="M18 13v3" /></>,
    envelope:   <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 7 9-7" /></>,
    active:     <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
  };
  return <>{sets[name] ?? sets.document}</>;
}

function QuestMap({ steps, currentIndex, mode }: { steps: (Step & { state: 'done' | 'current' | 'future' | 'declined' })[]; currentIndex: number; mode: Mode }) {
  const n = steps.length;
  const width = 380;
  const topPad = 60;
  const bottomPad = 60;
  const innerH = 720;
  const xs = steps.map((_, i) => 190 + (i % 4 === 0 ? 0 : i % 4 === 1 ? 1 : i % 4 === 2 ? 0 : -1) * 80);
  const ys = steps.map((_, i) => topPad + (i * (innerH - topPad - bottomPad)) / (n - 1));
  const lastDoneIdx = steps.reduce((acc, s, i) => s.state === 'done' || s.state === 'current' ? i : acc, -1);

  let donePath = '';
  if (lastDoneIdx > 0) {
    donePath = `M ${xs[0]} ${ys[0]}`;
    for (let i = 1; i <= lastDoneIdx; i++) {
      const cx = (xs[i - 1] + xs[i]) / 2;
      const cy = ys[i - 1] + (ys[i] - ys[i - 1]) * 0.5;
      donePath += ` C ${cx} ${cy}, ${cx} ${cy}, ${xs[i]} ${ys[i]}`;
    }
  }
  let futurePath = '';
  if (lastDoneIdx < n - 1) {
    const start = Math.max(0, lastDoneIdx);
    futurePath = `M ${xs[start]} ${ys[start]}`;
    for (let i = start + 1; i < n; i++) {
      const cx = (xs[i - 1] + xs[i]) / 2;
      const cy = ys[i - 1] + (ys[i] - ys[i - 1]) * 0.5;
      futurePath += ` C ${cx} ${cy}, ${cx} ${cy}, ${xs[i]} ${ys[i]}`;
    }
  }

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--mist-strong)', padding: '24px 16px', position: 'sticky', top: 88 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, padding: '0 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MapPin size={14} style={{ color: 'var(--brick)' }} />
          <span style={{ fontSize: 10, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>Your tenancy journey</span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--mute)' }}>{mode === 'renewal' ? 'renewal · 6 stops' : `${n} stops`}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${innerH}`} width="100%" height={innerH} style={{ display: 'block' }}>
        {donePath && <path d={donePath} fill="none" stroke="var(--jade-deep)" strokeWidth="3" strokeLinecap="round" />}
        {futurePath && <path d={futurePath} fill="none" stroke="var(--mute)" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" opacity="0.55" />}
        {steps.map((s, i) => <Waypoint key={s.key} step={s} cx={xs[i]} cy={ys[i]} index={i} />)}
      </svg>
      {currentIndex >= 0 && steps[currentIndex] && (() => {
        // If the journey is complete (final step shows as 'done', i.e. celebrate state),
        // swap the brick "You are here" pulse for a calm jade "All done" indicator.
        const isComplete = steps[currentIndex].state === 'done';
        return (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 28, height: 28, borderRadius: '50%',
              background: isComplete ? 'var(--jade-deep)' : 'var(--brick)',
              color: 'var(--paper)', display: 'grid', placeItems: 'center',
              animation: isComplete ? undefined : 'questPulse 2s ease-in-out infinite',
            }}>
              {isComplete ? <CheckCircle2 size={14} /> : <MapPin size={14} />}
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0, fontWeight: 600 }}>
                {isComplete ? 'Journey complete' : 'You are here'}
              </p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '2px 0 0' }}>{steps[currentIndex].label}</p>
            </div>
          </div>
        );
      })()}
      <style>{`@keyframes questPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }`}</style>
    </div>
  );
}

function Waypoint({ step, cx, cy, index }: { step: Step & { state: 'done' | 'current' | 'future' | 'declined' }; cx: number; cy: number; index: number }) {
  const isDone = step.state === 'done';
  const isCurrent = step.state === 'current';
  const isDeclined = step.state === 'declined';
  const fill = isCurrent ? 'var(--brick)' : isDone ? 'var(--jade-deep)' : 'var(--paper)';
  const stroke = isCurrent ? 'var(--brick)' : isDone ? 'var(--jade-deep)' : 'var(--mist-strong)';
  const iconColor = isCurrent || isDone ? 'var(--paper)' : 'var(--mute)';
  const r = isCurrent ? 22 : 18;
  return (
    <g opacity={isDeclined ? 0.3 : 1}>
      {isCurrent && (
        <circle cx={cx} cy={cy} r={32} fill="var(--brick)" opacity="0.15">
          <animate attributeName="r" values="22;36;22" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.25;0;0.25" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      <ellipse cx={cx + 1} cy={cy + r + 3} rx={r * 0.7} ry={3} fill="var(--ink)" opacity="0.08" />
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth="2" />
      <g transform={`translate(${cx + r - 4}, ${cy - r + 4})`}>
        <circle r="8" fill="var(--ink)" />
        <text textAnchor="middle" dominantBaseline="central" fill="var(--paper)" fontSize="9" fontWeight="700">{index + 1}</text>
      </g>
      <g transform={`translate(${cx - 11}, ${cy - 11})`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <StepIconPaths name={step.icon} />
        </svg>
      </g>
      <text x={cx} y={cy + r + 18} textAnchor="middle" fontSize="11" fontWeight="600" fill={isCurrent ? 'var(--brick)' : isDone ? 'var(--jade-deep)' : 'var(--mute)'}>{step.short}</text>
      <text x={cx} y={cy + r + 30} textAnchor="middle" fontSize="10" fill="var(--mute)">{isCurrent ? 'now →' : isDone ? '✓' : '·'}</text>
    </g>
  );
}

/* ─── Common UI primitives ─────────────────────────────────────────── */
function Pill({ tone, children }: { tone: StateDef['tone']; children: React.ReactNode }) {
  const t = {
    action:    { bg: 'var(--brick-soft)',    fg: 'var(--brick)' },
    waiting:   { bg: 'var(--saffron-soft)',  fg: 'var(--saffron-deep)' },
    celebrate: { bg: 'var(--jade-soft)',     fg: 'var(--jade-deep)' },
    declined:  { bg: 'var(--mist)',          fg: 'var(--ink-2)' },
  }[tone];
  return <span style={{ background: t.bg, color: t.fg, padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}

function HeroIcon({ tone, iconName }: { tone: StateDef['tone']; iconName: string }) {
  const bg = tone === 'action' ? 'var(--brick)' : tone === 'waiting' ? 'var(--saffron-deep)' : tone === 'celebrate' ? 'var(--jade-deep)' : 'var(--ink)';
  const map: Record<string, React.ReactNode> = {
    calendar: <Calendar size={26} />, binoculars: <Binoculars size={26} />, document: <FileText size={26} />,
    wallet: <Wallet size={26} />, scroll: <FileText size={26} />, pen: <Pen size={26} />, stamp: <Stamp size={26} />,
    bolt: <Zap size={26} />, key: <Key size={26} />, envelope: <Mail size={26} />, active: <BadgeCheck size={26} />,
  };
  return (
    <div style={{ width: 56, height: 56, borderRadius: 16, background: bg, color: 'var(--paper)', display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: '0 8px 20px -8px rgba(26,23,20,0.4)' }}>
      {map[iconName] ?? <FileText size={26} />}
    </div>
  );
}

function PrimaryBtn({ onClick, href, disabled, children, danger }: { onClick?: () => void; href?: string; disabled?: boolean; children: React.ReactNode; danger?: boolean }) {
  const style: React.CSSProperties = {
    display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8,
    padding: '14px 22px', borderRadius: 12,
    background: disabled ? 'var(--mist-strong)' : danger ? 'var(--brick)' : 'var(--jade)',
    color: 'var(--paper)', fontSize: 14, fontWeight: 700, textDecoration: 'none',
    border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1,
    fontFamily: 'inherit',
  };
  if (href && !disabled) return <Link href={href} style={style}>{children}</Link>;
  return <button type="button" onClick={onClick} disabled={disabled} style={style}>{children}</button>;
}

function SecondaryBtn({ onClick, href, children }: { onClick?: () => void; href?: string; children: React.ReactNode }) {
  const style: React.CSSProperties = {
    display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8,
    padding: '12px 18px', borderRadius: 12, background: 'var(--paper)', color: 'var(--ink-2)',
    border: '1px solid var(--mist-strong)', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer', fontFamily: 'inherit',
  };
  if (href) return <Link href={href} style={style}>{children}</Link>;
  return <button type="button" onClick={onClick} style={style}>{children}</button>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '14px 16px', display: 'grid', gap: 6, alignContent: 'start' }}>
      <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: accent ? 'var(--jade-deep)' : 'var(--ink)', margin: 0, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--brick-soft)', color: 'var(--brick)', fontSize: 12 }}>
      <AlertCircle size={14} /> {msg}
    </div>
  );
}

/**
 * Slim "no action needed" badge for pure waiting states. We deliberately
 * don't repeat the body text here — the hero already says what's happening
 * and the timing line shows the wait window.
 */
function WaitingBadge() {
  return (
    <div style={{
      background: 'var(--saffron-soft)', border: '1px solid #f0d68f', borderRadius: 999,
      padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    }}>
      <Clock size={14} style={{ color: 'var(--saffron-deep)' }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--saffron-deep)' }}>
        No action needed — we&apos;ll notify you the moment things move forward.
      </span>
    </div>
  );
}

/* ─── Modal primitive ──────────────────────────────────────────────── */
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--paper)', borderRadius: 16, maxWidth: 560, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--mist-strong)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mute)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '22px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: '14px 22px', borderTop: '1px solid var(--mist-strong)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--surface)' }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ─── Signature canvas ────────────────────────────────────────────── */
function SignatureCanvas({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const pos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current; if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width, sy = c.height / r.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - r.left) * sx, y: (t.clientY - r.top) * sy };
    }
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }, []);

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1916';
    setDrawing(true);
  };
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return;
    ctx.lineTo(p.x, p.y); ctx.stroke();
    if (!hasDrawn) setHasDrawn(true);
  };
  const end = () => {
    if (!drawing) return;
    setDrawing(false);
    const c = canvasRef.current; if (c && hasDrawn) onChange(c.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvasRef.current, ctx = c?.getContext('2d');
    if (c && ctx) { ctx.clearRect(0, 0, c.width, c.height); setHasDrawn(false); onChange(null); }
  };

  return (
    <div>
      <div style={{ position: 'relative', border: '1.5px dashed var(--mist-strong)', borderRadius: 12, background: 'var(--surface)' }}>
        <canvas ref={canvasRef} width={560} height={180} style={{ width: '100%', height: 180, cursor: 'crosshair', display: 'block', touchAction: 'none' }}
          onMouseDown={start} onMouseMove={draw} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={draw} onTouchEnd={end} />
        {!hasDrawn && (
          <p style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--mute)', fontSize: 13, pointerEvents: 'none', margin: 0 }}>
            Draw your signature here
          </p>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={clear} disabled={!hasDrawn}
          style={{ background: 'none', border: 'none', color: 'var(--mute)', fontSize: 12, cursor: hasDrawn ? 'pointer' : 'not-allowed', fontFamily: 'inherit', textDecoration: 'underline' }}>
          Clear signature
        </button>
      </div>
    </div>
  );
}

/* ─── Action card shell ────────────────────────────────────────────── */
function QuestActionCard({ stateKey, resolved, onRefresh }: { stateKey: StateKey; resolved: Resolved; onRefresh: () => void }) {
  const def = STATE_DEFS[stateKey];
  const { steps, currentIndex } = stepsFor(stateKey, resolved);
  const currentStep = steps[currentIndex];
  const iconName = currentStep?.icon ?? 'document';

  return (
    <div style={{ background: 'var(--paper)', borderRadius: 22, border: '1px solid var(--mist-strong)', padding: '32px 36px', display: 'grid', gap: 22, boxShadow: '0 24px 60px -32px rgba(26,23,20,0.18)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
          <HeroIcon tone={def.tone} iconName={iconName} />
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0, fontWeight: 600 }}>{def.sub}</p>
            <h2 style={{ fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '4px 0 0', fontWeight: 700 }}>{def.headline}</h2>
          </div>
        </div>
        <Pill tone={def.tone}>{def.label}</Pill>
      </div>
      {def.body && <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>{def.body}</p>}
      <ActionBody stateKey={stateKey} resolved={resolved} onRefresh={onRefresh} />
      {def.timing && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: '1px dashed var(--mist-strong)', flexWrap: 'wrap', gap: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--mute)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} /> {def.timing}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── ACTION BODIES ────────────────────────────────────────────────── */
/**
 * Maps the 8-step state machine to the action component shown in the
 * QuestActionCard. Components prefixed `// PHASE n →` are placeholders that
 * will be replaced (or replaced in part) in the listed phase.
 */
function ActionBody({ stateKey, resolved, onRefresh }: { stateKey: StateKey; resolved: Resolved; onRefresh: () => void }) {
  switch (stateKey) {
    case 'booked':                        return <BookedAction resolved={resolved} onRefresh={onRefresh} />;
    // PHASE 3 → conditional hide + KYC recommendation; reuses existing DocumentsAction
    case 'docs_required':                 return <DocumentsAction resolved={resolved} onRefresh={onRefresh} />;
    case 'docs_under_review':             return <DocsUnderReviewAction resolved={resolved} />;
    // PHASE 4 → replace with new PaymentReviewAction (cheque photos + AI extraction)
    case 'payment_review':                return <PaymentPlanAction resolved={resolved} onRefresh={onRefresh} />;
    case 'awaiting_rp_confirm':           return <ChequesReviewWaitAction resolved={resolved} />;
    case 'signature':                     return <SignatureAction resolved={resolved} onRefresh={onRefresh} />;
    // PHASE 6 → add Ejari certificate download once RP uploads
    case 'ejari':                         return <WaitingBadge />;
    // PHASE 6 → prefill premise number into the utility form
    case 'utility':                       return <UtilityAction resolved={resolved} onRefresh={onRefresh} />;
    // PHASE 6 → MoveInAction handles both halves (awaiting submit + counter-sign);
    //          dispute / reject flow lands here too.
    case 'move_in':                       return <MoveInAction resolved={resolved} />;
    case 'active':                        return <ActiveAction resolved={resolved} onRefresh={onRefresh} />;
    case 'termination_request_sent':      return <TerminationSentAction resolved={resolved} />;
    case 'termination_request_received':  return <TerminationReceivedAction resolved={resolved} onRefresh={onRefresh} />;
    case 'renewal_offered':               return <RenewalOfferedAction resolved={resolved} onRefresh={onRefresh} />;
    case 'renewal_documents':             return <DocumentsAction resolved={resolved} onRefresh={onRefresh} renewal />;
    case 'renewal_cheques':               return <RenewalChequesAction resolved={resolved} onRefresh={onRefresh} />;
    case 'renewal_progress':              return <SignatureAction resolved={resolved} onRefresh={onRefresh} renewal />;
    case 'renewal_ejari':                 return <WaitingBadge />;
    case 'renewal_active':                return <ActiveAction resolved={resolved} onRefresh={onRefresh} />;
    case 'rejected':                      return <EndStateAction primaryLabel="Browse other listings" primaryHref="/listings" />;
    case 'terminated':                    return <EndStateAction primaryLabel="Find a new place" primaryHref="/listings" />;
    case 'renewal_rejected':              return <EndStateAction primaryLabel="Browse other listings" primaryHref="/listings" />;
    case 'superseded':                    return <EndStateAction primaryLabel="Browse other listings" primaryHref="/listings" />;
    // Wind-down window — same active body, just labeled differently in the
    // headline + timing copy (handled by STATE_DEFS). Reusing ActiveAction
    // keeps payment history + move-out CTAs in view.
    case 'terminating':                   return <ActiveAction resolved={resolved} onRefresh={onRefresh} />;
    default:                              return null;
  }
}

/* ─── STEP 1 — BOOKED CARD (viewing + payment summary + "I'm Interested") ─ */

/**
 * Step 1 action body. Mounted when `deriveStateKey` returns `'booked'`.
 *
 * Shows the customer:
 *  - Their scheduled viewing (date / time / property location)
 *  - A full payment summary computed via POST /leads/my-viewings/:id/plan-preview
 *    using the customer's saved preferences (or defaults: 4 cheques, +30 days)
 *  - Reschedule / Not Interested secondary actions
 *  - "I'm Interested" primary CTA → opens InterestedPopup
 *
 * Notes:
 *  - Doesn't gate on `viewing.status === 'completed'` — per the locked design
 *    the customer can commit before they attend (speeds the funnel).
 *  - All currency renders in AED (fils ÷ 100 with en-AE locale).
 */
function BookedAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const v = resolved.viewing;
  const unit = resolved.unit;
  const [modal, setModal] = useState<'reschedule' | 'not_interested' | 'interested' | null>(null);
  const [plan, setPlan] = useState<ApiPaymentPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);

  // Defaults align with what the InterestedPopup pre-fills, so the on-screen
  // summary matches what the customer will commit to if they tap through.
  const defaultStart = (() => {
    const allowed = (unit?.property?.rentalProvider ?? unit?.property?.rental_provider)?.preferredStartDays ?? [];
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const desired = v?.desiredMoveIn?.slice(0, 10);
    // Keep the customer's desired move-in only if it lands on an allowed start day.
    if (desired) {
      const dy = parseInt(desired.slice(8, 10), 10);
      if (allowed.length === 0 || allowed.includes(dy)) return desired;
    }
    // Otherwise preselect the nearest upcoming allowed start day.
    if (allowed.length > 0) {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      for (let i = 0; i < 366; i++) {
        if (allowed.includes(d.getDate())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        d.setDate(d.getDate() + 1);
      }
    }
    if (desired) return desired;
    const d = new Date(); d.setDate(d.getDate() + 30);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();
  const defaultPayments = v?.preferredChequeCount ?? 4;

  useEffect(() => {
    if (!v?.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlanLoading(true); setPlanError(null);
    fetch(`/api/leads/my-viewings/${v.id}/plan-preview`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractStartDate: defaultStart, paymentsCount: defaultPayments }),
    })
      .then(async r => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({} as { message?: string }));
          throw new Error(b?.message ?? `Error ${r.status}`);
        }
        return r.json() as Promise<ApiPaymentPlan>;
      })
      .then(p => setPlan(p))
      .catch((e: Error) => setPlanError(e.message))
      .finally(() => setPlanLoading(false));
  }, [v?.id, defaultStart, defaultPayments]);

  if (!v) return null;

  const when = new Date(v.scheduledAt);
  const dateStr = when.toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: APP_TIME_ZONE });
  const timeStr = when.toLocaleTimeString('en-AE', { hour: 'numeric', minute: '2-digit', timeZone: APP_TIME_ZONE });
  const buildingName = unit?.property?.buildingName ?? null;
  const fullAddress = unit?.property?.fullAddress ?? null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Viewing summary */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 20px' }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, fontWeight: 600 }}>Your viewing</p>
        <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: '6px 0 2px' }}>{dateStr}</p>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: '0 0 8px' }}>{timeStr}</p>
        {(buildingName || fullAddress) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: 'var(--ink-2)', fontSize: 13 }}>
            <MapPin size={14} style={{ marginTop: 2, flexShrink: 0, color: 'var(--mute)' }} />
            <div>
              {buildingName && <p style={{ margin: 0, fontWeight: 600 }}>{buildingName}{unit?.unitNumber ? ` · Unit ${unit.unitNumber}` : ''}</p>}
              {fullAddress && <p style={{ margin: '2px 0 0', color: 'var(--mute)', fontSize: 12 }}>{fullAddress}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Cost summary — totals only. The customer hasn't picked a payment
          frequency yet, so we deliberately omit the cheque schedule + count.
          The breakdown by cheques renders inside the InterestedPopup once
          they actually choose Annual / Quarterly / Monthly etc. */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', fontWeight: 600 }}>Cost summary</p>

        {planLoading ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--mute)', fontSize: 13 }}>
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : planError ? (
          <ErrorBox msg={planError} />
        ) : plan ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <PaymentRow label="Annual rent" amountFils={plan.rentFils} />
            <PaymentRow label="Security deposit" amountFils={plan.securityDepositFils ?? 0} />
            <PaymentRow label="Admin fee" amountFils={plan.adminFeeFils ?? 0} />
            <PaymentRow label="Ejari fee" amountFils={plan.ejariFils ?? 0} />
            <PaymentRow label="Commission" amountFils={plan.commissionFils ?? 0} />
            <div style={{ borderTop: '1px solid var(--mist-strong)', margin: '6px 0' }} />
            <PaymentRow label="Total payable" amountFils={plan.totalAmountFils} bold />
            <p style={{ fontSize: 11, color: 'var(--mute)', margin: '8px 0 0', lineHeight: 1.4 }}>
              You&rsquo;ll pick a payment frequency (annual, semi-annual, quarterly, etc.) when you tap <b>I&rsquo;m Interested</b> — the full cheque schedule appears before you confirm.
            </p>
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <PrimaryBtn onClick={() => setModal('interested')}>
          <CheckCircle2 size={16} /> I&rsquo;m Interested
        </PrimaryBtn>
        <SecondaryBtn onClick={() => setModal('reschedule')}>Reschedule</SecondaryBtn>
        <SecondaryBtn onClick={() => setModal('not_interested')}>Not interested</SecondaryBtn>
      </div>

      {modal === 'interested' && <InterestedPopup
        viewing={v}
        rpPreferredDays={(unit?.property?.rentalProvider ?? unit?.property?.rental_provider)?.preferredStartDays ?? []}
        rpAllowedInstallments={(unit?.property?.rentalProvider ?? unit?.property?.rental_provider)?.allowedInstallments ?? []}
        defaultStart={defaultStart}
        defaultPayments={defaultPayments}
        defaultOccupants={v.occupantsAdults ?? 1}
        onClose={() => setModal(null)}
        onSuccess={() => { setModal(null); onRefresh(); }}
      />}
      {modal === 'reschedule' && <RescheduleModal viewing={v} onClose={() => setModal(null)} onSuccess={() => { setModal(null); onRefresh(); }} />}
      {modal === 'not_interested' && <NotInterestedModal viewing={v} onClose={() => setModal(null)} onSuccess={() => { setModal(null); onRefresh(); }} />}
    </div>
  );
}

function PaymentRow({ label, amountFils, bold }: { label: string; amountFils: number; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: bold ? 14 : 13 }}>
      <span style={{ color: bold ? 'var(--ink)' : 'var(--ink-2)', fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: bold ? 700 : 600, fontVariantNumeric: 'tabular-nums' }}>{fmtAedFils(amountFils)}</span>
    </div>
  );
}

/**
 * Step 1 commit popup. Asks the 3 questions the locked design specifies —
 * occupants, preferred move-in (RP-restricted), payment frequency — and
 * shows a live total that updates as the customer flips between options.
 *
 * Submit → POST /api/leads/my-viewings/:id/express-interest. Backend KYC
 * gate may reject with 400; we surface the message inline (Phase 3 will
 * convert this to a "Complete KYC" deep link with returnTo=).
 */
function InterestedPopup({
  viewing, rpPreferredDays, rpAllowedInstallments, defaultStart, defaultPayments, defaultOccupants,
  onClose, onSuccess,
}: {
  viewing: ApiViewing;
  rpPreferredDays: number[];
  rpAllowedInstallments: number[];
  defaultStart: string;
  defaultPayments: number;
  defaultOccupants: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [occupants, setOccupants] = useState<number>(defaultOccupants);
  const [paymentsCount, setPaymentsCount] = useState<number>(defaultPayments);
  const [moveIn, setMoveIn] = useState<string>(defaultStart);
  // Snap the default plan to one this landlord offers (Settings → Rules).
  const installmentChoices = allowedInstallmentPlans(rpAllowedInstallments);
  useEffect(() => {
    if (installmentChoices.length && !installmentChoices.some(p => p.value === paymentsCount)) {
      setPaymentsCount(installmentChoices[0].value);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpAllowedInstallments]);
  const [calOpen, setCalOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const today = new Date();
  const [calYear, setCalYear] = useState(parseInt(moveIn.slice(0, 4)) || today.getFullYear());
  const [calMonth, setCalMonth] = useState((parseInt(moveIn.slice(5, 7)) || (today.getMonth() + 1)) - 1);

  useEffect(() => {
    if (!calOpen) return;
    const close = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [calOpen]);

  // Live plan preview as the customer flips payments / move-in.
  const [preview, setPreview] = useState<ApiPaymentPlan | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/leads/my-viewings/${viewing.id}/plan-preview`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractStartDate: moveIn, paymentsCount }),
    })
      .then(r => r.ok ? r.json() as Promise<ApiPaymentPlan> : null)
      .then(p => { if (!cancelled) setPreview(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [viewing.id, moveIn, paymentsCount]);

  const dayAllowed = (day: number) => rpPreferredDays.length === 0 || rpPreferredDays.includes(day);
  const calFirstDow = new Date(calYear, calMonth, 1).getDay();
  const calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calMonthLabel = new Date(calYear, calMonth, 1).toLocaleString('en-AE', { month: 'long', year: 'numeric' });
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  function calPrev() { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1); }
  function calNext() { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1); }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}/express-interest`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractStartDate: moveIn,
          paymentsCount,
          paymentMethod: 'postdated_cheque',
          occupantsAdults: occupants,
        }),
      });
      const body = await res.json().catch(() => ({} as { message?: string }));
      if (!res.ok) {
        throw new Error(body?.message ?? `Error ${res.status}`);
      }
      onSuccess();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const niceMoveIn = new Date(moveIn + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Modal title="Let&rsquo;s set up your lease" onClose={onClose} footer={
      <>
        <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={submit} disabled={busy}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <>Confirm interest <ArrowRight size={14} /></>}
        </PrimaryBtn>
      </>
    }>
      <div style={{ display: 'grid', gap: 16 }}>
        {/* Occupants */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Number of occupants</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={() => setOccupants(c => Math.max(1, c - 1))} disabled={occupants <= 1}
              style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--mist-strong)', background: 'var(--paper)', color: 'var(--ink-2)', fontFamily: 'inherit', fontWeight: 700, fontSize: 18, cursor: occupants <= 1 ? 'not-allowed' : 'pointer', opacity: occupants <= 1 ? 0.4 : 1 }}>−</button>
            <span style={{ minWidth: 36, textAlign: 'center', fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{occupants}</span>
            <button type="button" onClick={() => setOccupants(c => c + 1)}
              style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--mist-strong)', background: 'var(--paper)', color: 'var(--ink-2)', fontFamily: 'inherit', fontWeight: 700, fontSize: 18, cursor: 'pointer' }}>+</button>
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--mute)' }}>
              {occupants === 1 ? 'Just me' : `Including ${occupants - 1} additional`}
            </span>
          </div>
          {occupants > 1 && (
            <p style={{ fontSize: 11, color: 'var(--mute)', margin: '8px 0 0', lineHeight: 1.4 }}>
              Each additional occupant will need their Emirates ID + Passport + Visa uploaded in Step 2.
            </p>
          )}
        </div>

        {/* Move-in date */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Preferred move-in date</p>
          <div style={{ position: 'relative' }} ref={calRef}>
            <button type="button" onClick={() => setCalOpen(o => !o)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '11px 14px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', background: 'var(--paper)', border: '1px solid var(--jade)', color: 'var(--ink)', fontFamily: 'inherit' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={14} color="var(--jade-deep)" /> {niceMoveIn}
              </span>
              <ChevronDown size={14} color="var(--mute)" style={{ transition: 'transform 0.15s', transform: calOpen ? 'rotate(180deg)' : 'none' }} />
            </button>
            {calOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--paper)', borderRadius: 12, border: '1px solid var(--mist-strong)', boxShadow: '0 10px 25px rgba(0,0,0,0.12)', zIndex: 30, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <button type="button" onClick={calPrev} style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer' }}><ChevronLeft size={16} /></button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{calMonthLabel}</span>
                  <button type="button" onClick={calNext} style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer' }}><ChevronRight size={16} /></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
                  {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--mute)', padding: '4px 0' }}>{d}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
                  {Array.from({ length: calFirstDow }, (_, i) => <div key={`e${i}`} />)}
                  {Array.from({ length: calDaysInMonth }, (_, i) => {
                    const day = i + 1;
                    const isActive = dayAllowed(day);
                    const isPast = new Date(calYear, calMonth, day) < todayMidnight;
                    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isSelected = dateStr === moveIn;
                    if (!isActive) return <div key={day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 32, fontSize: 11, color: 'var(--mist-strong)' }}>{day}</div>;
                    return (
                      <button key={day} type="button" disabled={isPast}
                        onClick={() => { setMoveIn(dateStr); setCalOpen(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', height: 32, borderRadius: 8,
                          fontSize: 12, fontWeight: 700, border: 'none', fontFamily: 'inherit',
                          background: isSelected ? 'var(--jade)' : isPast ? 'transparent' : 'rgba(46,159,130,0.12)',
                          color: isSelected ? 'var(--paper)' : isPast ? 'var(--mist-strong)' : 'var(--jade-deep)',
                          cursor: isPast ? 'not-allowed' : 'pointer',
                        }}>
                        {day}
                      </button>
                    );
                  })}
                </div>
                {rpPreferredDays.length > 0 && (
                  <p style={{ fontSize: 10, color: 'var(--mute)', margin: '8px 0 0', lineHeight: 1.4 }}>
                    Only days highlighted by the rental provider can be selected as a contract start date.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Payments count */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Payment frequency</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {installmentChoices.map(p => (
              <button key={p.value} type="button" onClick={() => setPaymentsCount(p.value)}
                style={{
                  padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${paymentsCount === p.value ? 'var(--jade)' : 'var(--mist-strong)'}`,
                  background: paymentsCount === p.value ? 'var(--jade)' : 'var(--paper)',
                  color: paymentsCount === p.value ? 'var(--paper)' : 'var(--ink-2)', fontFamily: 'inherit',
                }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live total + full payment schedule — updates every time the
            customer flips occupants, move-in or frequency. Shows the
            mental-model breakdown (e.g. "Semi-annual = 2 rent payments
            + 1 security deposit payment") and then the per-row amounts
            and due dates so the customer sees exactly what they're
            committing to before tapping Confirm. Method (cheque / bank
            transfer / card / cash) is picked later on Step 3 — the
            preview here intentionally stays method-neutral. */}
        {preview && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontWeight: 600 }}>Total payable</p>
                {(() => {
                  const rent = preview.installmentCount ?? Math.max(1, preview.chequeCount - 1);
                  const hasDeposit = (preview.securityDepositFils ?? 0) > 0;
                  return (
                    <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>
                      {rent} rent {rent === 1 ? 'payment' : 'payments'}
                      {hasDeposit ? ' + 1 security deposit payment' : ''}
                    </p>
                  );
                })()}
              </div>
              <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtAedFils(preview.totalAmountFils)}</p>
            </div>

            {preview.items && preview.items.length > 0 && (
              <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px' }}>
                <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px', fontWeight: 600 }}>Payment schedule</p>
                <div style={{ display: 'grid', gap: 6 }}>
                  {sortPlanItems(preview.items).map((it, i) => {
                    const isDeposit = it.type === 'security_deposit';
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: isDeposit ? 'var(--saffron)' : 'var(--jade-deep)', background: isDeposit ? 'var(--saffron-soft)' : 'var(--jade-soft)', borderRadius: 6, padding: '2px 6px', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                            #{i + 1}
                          </span>
                          <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {it.description ?? (isDeposit ? 'Security deposit' : `Installment ${i + 1}`)}
                          </span>
                        </div>
                        <span style={{ color: 'var(--mute)', fontSize: 11, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          {it.dueDate ? new Date(it.dueDate + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short' }) : '—'}
                        </span>
                        <span style={{ fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', minWidth: 90, textAlign: 'right' }}>
                          {fmtAedFils(it.amountFils)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  );
}

function RescheduleModal({ viewing, onClose, onSuccess }: { viewing: ApiViewing; onClose: () => void; onSuccess: () => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
  const today = new Date().toISOString().slice(0, 10);
  async function submit() {
    if (!date || !time) { setErr('Pick both a date and a time.'); return; }
    setBusy(true); setErr(null);
    try {
      const scheduledAt = `${date}T${time}:00`;
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}/reschedule`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduledAt }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onSuccess();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  return (
    <Modal title="Reschedule viewing" onClose={onClose} footer={
      <>
        <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Confirm new time'}</PrimaryBtn>
      </>
    }>
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>New date</label>
          <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Time slot</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {SLOTS.map(s => (
              <button key={s} type="button" onClick={() => setTime(s)}
                style={{ padding: '10px 8px', borderRadius: 10, border: `1.5px solid ${time === s ? 'var(--jade)' : 'var(--mist-strong)'}`, background: time === s ? 'var(--jade-soft)' : 'var(--paper)', color: time === s ? 'var(--jade-deep)' : 'var(--ink-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  );
}

function NotInterestedModal({ viewing, onClose, onSuccess }: { viewing: ApiViewing; onClose: () => void; onSuccess: () => void }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}/not-interested`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: notes.trim() || undefined }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onSuccess();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  return (
    <Modal title="Mark as not interested" onClose={onClose} footer={
      <>
        <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={submit} disabled={busy} danger>{busy ? 'Sending…' : 'Mark as not interested'}</PrimaryBtn>
      </>
    }>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 0 }}>We&rsquo;ll close this lead and remove it from your active spaces. Adding a brief reason helps us recommend better next time.</p>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional — e.g. wrong neighbourhood, found another place…" rows={3}
        style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
      {err && <ErrorBox msg={err} />}
    </Modal>
  );
}

/* ─── INLINE KYC + DOCS FORM (new application flow) ────────────────── */
const COMMERCIAL_UNIT_TYPES = ['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical','coworking_desk','private_office','meeting_room','day_office','event_hall','wedding_venue','conference_hall','private_dining','outdoor_venue','warehouse','open_yard','storage_unit','cold_storage','logistics_facility'];

const KYC_INPUT_STYLE: React.CSSProperties = { border: '1px solid var(--mist-strong)', borderRadius: 9, padding: '9px 12px', fontSize: 13, color: 'var(--ink)', background: 'var(--paper)', outline: 'none', width: '100%' };
const KYC_LABEL_STYLE: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em' };

function KycSection({ title, accent, allDone, children }: { title: string; accent?: boolean; allDone?: boolean; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { if (allDone) setCollapsed(true); }, [allDone]);
  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${allDone && collapsed ? 'rgba(46,159,130,0.35)' : 'var(--mist-strong)'}`, borderRadius: 14, overflow: 'hidden' }}>
      <button type="button" onClick={() => setCollapsed(c => !c)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '9px 14px', background: allDone && collapsed ? 'rgba(46,159,130,0.06)' : accent ? 'var(--jade-soft)' : 'var(--mist)', border: 'none', borderBottom: collapsed ? 'none' : '1px solid var(--mist-strong)', cursor: 'pointer', gap: 8, fontFamily: 'inherit' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: accent ? 'var(--jade-deep)' : 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, flex: 1, textAlign: 'left' }}>{title}</p>
        {allDone && collapsed && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--jade-deep)', background: 'var(--jade-soft)', padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Done</span>}
        <ChevronDown size={14} style={{ color: 'var(--mute)', flexShrink: 0, transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {!collapsed && <div style={{ padding: '12px 14px', display: 'grid', gap: 8 }}>{children}</div>}
    </div>
  );
}

/**
 * Editable grid of the 5 fields the Emirates ID OCR populates. Each
 * field auto-saves on blur via PATCH /auth/me. Customer can correct
 * any OCR mistake inline — they don't need a separate "edit" mode.
 *
 * Per-field "Saving…" and "Saved" indicators sit next to the label so
 * the customer can see exactly what was just persisted.
 *
 * The User object passed in is from useAuth; refreshing it after the
 * patch reads the canonical value back from the server so we don't
 * trust the local state alone.
 */
type AuthUser = ReturnType<typeof useAuth>['user'];
function PersonalDetailsEditor({ user, onSaved }: { user: AuthUser; onSaved: () => Promise<unknown> | void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      <PersonalEditField label="First name" initial={user?.firstName ?? ''} fieldKey="firstName" onSaved={onSaved} />
      <PersonalEditField label="Last name"  initial={user?.lastName ?? ''}  fieldKey="lastName"  onSaved={onSaved} />
      <PersonalGenderField initial={user?.gender ?? ''} onSaved={onSaved} />
      <PersonalEditField label="Nationality" initial={user?.nationality ?? ''} fieldKey="nationality" onSaved={onSaved} />
      <PersonalEditField label="Emirates ID" initial={user?.emiratesIdNumber ?? ''} fieldKey="emiratesIdNumber" mono onSaved={onSaved} placeholder="784-YYYY-NNNNNNN-D" />
    </div>
  );
}

/** Generic editable field that PATCHes /auth/me on blur. */
function PersonalEditField({
  label, initial, fieldKey, mono, placeholder, onSaved,
}: {
  label: string;
  initial: string;
  fieldKey: 'firstName' | 'lastName' | 'nationality' | 'emiratesIdNumber';
  mono?: boolean;
  placeholder?: string;
  onSaved: () => Promise<unknown> | void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editingRef = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync when the parent prop changes (e.g. OCR completes mid-edit for
  // another field) — but ONLY when this field isn't being edited, so a parent
  // refresh can't wipe the user's in-progress text.
  useEffect(() => {
    if (editingRef.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(initial);
  }, [initial]);

  // Clear the "Saved ✓" timer if the field unmounts first.
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  async function maybeSave() {
    editingRef.current = false;
    const next = value.trim();
    if (next === (initial ?? '').trim()) return;
    setSaving(true); setErr(null);
    try {
      await apiPatch('/auth/me', { [fieldKey]: next || null });
      setSaved(true);
      await onSaved();
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
        {label}
        {saving && <span style={{ color: 'var(--saffron)', display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'none', letterSpacing: 0 }}><Loader2 size={10} className="animate-spin" /> Saving</span>}
        {saved && !saving && <span style={{ color: 'var(--jade-deep)', textTransform: 'none', letterSpacing: 0 }}>Saved ✓</span>}
      </span>
      <input
        value={value}
        onFocus={() => { editingRef.current = true; }}
        onChange={e => setValue(e.target.value)}
        onBlur={maybeSave}
        placeholder={placeholder ?? ''}
        style={{
          padding: '8px 10px', borderRadius: 9, border: `1px solid ${err ? 'var(--brick)' : 'var(--mist-strong)'}`,
          background: 'var(--paper)', fontSize: 13, color: 'var(--ink)', outline: 'none',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
          fontVariantNumeric: mono ? 'tabular-nums' : undefined,
        }}
      />
      {err && <span style={{ fontSize: 11, color: 'var(--brick)' }}>{err}</span>}
    </label>
  );
}

/** Gender is a fixed 3-way enum — show a segmented control instead of free text. */
function PersonalGenderField({ initial, onSaved }: { initial: string; onSaved: () => Promise<unknown> | void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(initial);
  }, [initial]);

  async function setAndSave(next: string) {
    if (next === value) return;
    setValue(next);
    setSaving(true);
    try {
      await apiPatch('/auth/me', { gender: next || null });
      setSaved(true);
      await onSaved();
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
        Gender
        {saving && <span style={{ color: 'var(--saffron)', display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'none', letterSpacing: 0 }}><Loader2 size={10} className="animate-spin" /> Saving</span>}
        {saved && !saving && <span style={{ color: 'var(--jade-deep)', textTransform: 'none', letterSpacing: 0 }}>Saved ✓</span>}
      </span>
      <div style={{ display: 'flex', gap: 4, background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 9, padding: 3 }}>
        {(['male', 'female'] as const).map(opt => (
          <button key={opt} type="button" onClick={() => setAndSave(opt)}
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: value === opt ? 'var(--jade)' : 'transparent',
              color: value === opt ? 'var(--paper)' : 'var(--ink-2)',
              fontSize: 12, fontWeight: 600, textTransform: 'capitalize', fontFamily: 'inherit',
            }}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Read-only chip used inside the "Personal details" status card on
 *  Step 2. Each chip is a small key/value tile (label on top, value
 *  below). `mono` switches the value font to a tabular monospace —
 *  used for the Emirates ID number so digits line up. */
function PersonalChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '8px 11px', display: 'grid', gap: 2, alignContent: 'start' }}>
      <p style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, margin: 0, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit', fontVariantNumeric: mono ? 'tabular-nums' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</p>
    </div>
  );
}

function KycContactChip({ icon, value, verified }: { icon: React.ReactNode; value: string; verified: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '8px 11px', borderRadius: 9, background: verified ? 'rgba(46,159,130,0.06)' : 'var(--mist)', border: `1px solid ${verified ? 'rgba(46,159,130,0.3)' : 'var(--mist-strong)'}` }}>
      <span style={{ color: verified ? 'var(--jade-deep)' : 'var(--mute)', flexShrink: 0, display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
      {verified && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--jade-deep)', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--jade-soft)', padding: '2px 7px', borderRadius: 999, flexShrink: 0 }}>Verified</span>}
    </div>
  );
}

function KycDocRow({ req, myDocs, localPreviews, docUploading, onUpload }: {
  req: DocReq;
  myDocs: Resolved['myDocs'];
  localPreviews: Record<string, { url: string; mime: string }>;
  docUploading: string | null;
  onUpload: (req: DocReq, file: File) => void;
}) {
  const existing   = myDocs.find(d => d.documentKey === req.key);
  const local      = localPreviews[req.key];
  const uploaded   = !!existing || !!local;
  const previewUrl = local?.url ?? (existing?.fileUrl ?? null);
  const mime       = local?.mime ?? (existing as { mimeType?: string } | undefined)?.mimeType ?? '';
  const isImg      = mime.startsWith('image/');
  const isUp       = docUploading === req.key;
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, background: uploaded ? 'rgba(46,159,130,0.06)' : 'var(--paper)', border: `1.5px solid ${uploaded ? 'rgba(46,159,130,0.35)' : 'var(--mist-strong)'}`, cursor: isUp ? 'progress' : 'pointer' }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: uploaded ? 'rgba(46,159,130,0.12)' : 'var(--mist)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {uploaded ? <CheckCircle2 size={18} style={{ color: 'var(--jade-deep)' }} /> : <FileText size={18} style={{ color: 'var(--mute)' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{req.label}</p>
          {req.required
            ? <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--brick)', background: 'var(--brick-soft)', padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Required</span>
            : <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--mute)', background: 'var(--mist)', padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Optional</span>}
        </div>
        {req.hint && <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>{req.hint}</p>}
        {previewUrl && (
          <div style={{ marginTop: 6 }}>
            {isImg
              ? <button type="button" onClick={() => openDocViewer({ fileUrl: previewUrl, caption: req.label, mimeType: mime })} style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}><img src={previewUrl} alt={req.label} style={{ width: 80, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--mist-strong)' }} /></button>
              : <button type="button" onClick={() => openDocViewer({ fileUrl: previewUrl, caption: req.label, mimeType: mime })} style={{ fontSize: 11, color: 'var(--jade-deep)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}><FileText size={12} /> View PDF</button>}
          </div>
        )}
      </div>
      {isUp
        ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
        : <UploadCloud size={16} style={{ color: uploaded ? 'var(--jade-deep)' : 'var(--mute)', flexShrink: 0 }} />}
      <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={isUp}
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(req, f); }} />
    </label>
  );
}


function InlineKycDocsForm({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const { user, refresh: refreshUser } = useAuth();
  const tenantProfileId = resolved.tenantProfileId;
  const viewing = resolved.viewing;
  const unitType = resolved.unit?.unitType ?? null;
  const isRes = !unitType || !COMMERCIAL_UNIT_TYPES.includes(unitType);
  const occupantCount = Math.max(viewing?.occupantsAdults ?? 1, 1);

  const emailVerified  = user?.emailVerified ?? false;
  const phoneVerified  = user?.phoneVerified ?? false;
  const isAutoEmail    = /@upnow\.local$/i.test(user?.email ?? '') || /^phone-/.test(user?.email ?? '') || /@upnow\.internal$/i.test(user?.email ?? '');
  const showEmailEdit  = phoneVerified && (!emailVerified || isAutoEmail);
  const showPhoneEdit  = emailVerified && !phoneVerified;

  // Email + phone inputs only — name / gender / nationality / Emirates ID
  // are extracted from the Emirates ID upload (Phase 4 wires the OCR).
  const [emailInput, setEmailInput] = useState(user?.email ?? '');
  const [phoneInput, setPhoneInput] = useState(user?.phone ?? '');

  // Email OTP verification
  const [emailOtpStep, setEmailOtpStep] = useState<'idle' | 'verifying'>('idle');
  const [emailOtp,     setEmailOtp]     = useState('');
  const [emailDevOtp,  setEmailDevOtp]  = useState<string | null>(null);
  const [emailOtpBusy, setEmailOtpBusy] = useState(false);
  const [emailOtpErr,  setEmailOtpErr]  = useState<string | null>(null);

  async function sendEmailOtp() {
    const value = emailInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setEmailOtpErr('Enter a valid email address'); return; }
    setEmailOtpBusy(true); setEmailOtpErr(null); setEmailDevOtp(null);
    try {
      await apiPatch('/auth/me', { email: value });
      const res = await apiPost<{ sent: boolean; devOtp?: string }>('/auth/email/resend', {});
      if (res?.devOtp) setEmailDevOtp(res.devOtp);
      await refreshUser();
      setEmailOtpStep('verifying');
    } catch (e) { setEmailOtpErr(e instanceof Error ? e.message : 'Could not send code'); }
    finally { setEmailOtpBusy(false); }
  }

  async function verifyEmailOtp() {
    if (emailOtp.trim().length !== 6) { setEmailOtpErr('Enter the 6-digit code'); return; }
    setEmailOtpBusy(true); setEmailOtpErr(null);
    try {
      await apiPost('/auth/email/verify-otp', { email: emailInput.trim().toLowerCase(), code: emailOtp.trim() });
      await refreshUser();
      setEmailOtpStep('idle'); setEmailOtp(''); setEmailDevOtp(null);
    } catch (e) { setEmailOtpErr(e instanceof Error ? e.message : 'Invalid or expired code'); }
    finally { setEmailOtpBusy(false); }
  }

  // Phone OTP verification — mirrors the email flow. The auth/me PATCH
  // writes the new phone and resets phoneVerified=false; /auth/otp/request
  // then sends a 6-digit code to that phone; /auth/otp/verify confirms it.
  const [phoneOtpStep, setPhoneOtpStep] = useState<'idle' | 'verifying'>('idle');
  const [phoneOtp,     setPhoneOtp]     = useState('');
  const [phoneDevOtp,  setPhoneDevOtp]  = useState<string | null>(null);
  const [phoneOtpBusy, setPhoneOtpBusy] = useState(false);
  const [phoneOtpErr,  setPhoneOtpErr]  = useState<string | null>(null);

  async function sendPhoneOtp() {
    const value = phoneInput.trim();
    if (!/^\+?\d{8,16}$/.test(value)) { setPhoneOtpErr('Enter a valid phone number'); return; }
    setPhoneOtpBusy(true); setPhoneOtpErr(null); setPhoneDevOtp(null);
    try {
      await apiPatch('/auth/me', { phone: value });
      const res = await apiPost<{ sent: boolean; devOtp?: string }>('/auth/otp/request', {});
      if (res?.devOtp) setPhoneDevOtp(res.devOtp);
      await refreshUser();
      setPhoneOtpStep('verifying');
    } catch (e) { setPhoneOtpErr(e instanceof Error ? e.message : 'Could not send code'); }
    finally { setPhoneOtpBusy(false); }
  }

  async function verifyPhoneOtp() {
    if (phoneOtp.trim().length !== 6) { setPhoneOtpErr('Enter the 6-digit code'); return; }
    setPhoneOtpBusy(true); setPhoneOtpErr(null);
    try {
      await apiPost('/auth/otp/verify', { code: phoneOtp.trim() });
      await refreshUser();
      setPhoneOtpStep('idle'); setPhoneOtp(''); setPhoneDevOtp(null);
    } catch (e) { setPhoneOtpErr(e instanceof Error ? e.message : 'Invalid or expired code'); }
    finally { setPhoneOtpBusy(false); }
  }

  // saveInfo() removed — personal-detail fields (firstName / lastName /
  // gender / nationality / emiratesIdNumber) come from the Emirates ID
  // OCR pipeline in Phase 4, not from a customer-typed form.

  // Upload
  const [docUploading,  setDocUploading]  = useState<string | null>(null);
  const [uploadErr,     setUploadErr]     = useState<string | null>(null);
  const [localPreviews, setLocalPreviews] = useState<Record<string, { url: string; mime: string }>>({});
  const [eidReading, setEidReading] = useState(false);

  // After an Emirates ID upload the backend runs OCR asynchronously and fills
  // name / ID / DOB / nationality / gender on the profile. Poll the profile so
  // those values land and render as auto-filled — with a "reading" state shown
  // meanwhile so it doesn't feel like nothing happened.
  const pollEidExtraction = useCallback(async (beforeId: string | null | undefined) => {
    setEidReading(true);
    try {
      for (let i = 0; i < 7; i++) {
        await new Promise(r => setTimeout(r, 1800));
        let done = false;
        try {
          const me = await apiGet<{ emiratesIdNumber?: string | null }>('/auth/me');
          if (me?.emiratesIdNumber && me.emiratesIdNumber !== (beforeId ?? null)) done = true;
        } catch { /* keep polling */ }
        await refreshUser();
        if (done) break;
      }
    } finally {
      setEidReading(false);
      onRefresh();
    }
  }, [refreshUser, onRefresh]);

  async function uploadDoc(req: DocReq, file: File) {
    if (!tenantProfileId) { setUploadErr('Profile not ready.'); return; }
    if (file.size > 10 * 1024 * 1024) { setUploadErr('File must be under 10 MB.'); return; }
    setDocUploading(req.key); setUploadErr(null);
    const localUrl = URL.createObjectURL(file);
    try {
      const { uploadUrl, fileUrl, fileKey } = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'customer', ownerId: tenantProfileId, documentKey: req.key, mimeType: file.type, originalName: file.name }),
      }).then(r => r.ok ? r.json() : r.json().then((b: { message?: string }) => Promise.reject(b?.message ?? 'Upload URL failed'))) as { uploadUrl: string; fileUrl: string; fileKey: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const put = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('File upload failed');
      await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'customer', ownerId: tenantProfileId, documentKey: req.key, category: req.category, displayName: req.label, fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: 's3' }),
      });
      setLocalPreviews(p => ({ ...p, [req.key]: { url: localUrl, mime: file.type } }));
      onRefresh();
      if (req.key === 'emirates_id' || req.key === 'emirates_id_front') {
        void pollEidExtraction(user?.emiratesIdNumber ?? null);
      }
    } catch (e) {
      URL.revokeObjectURL(localUrl);
      setUploadErr(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Upload failed');
    } finally { setDocUploading(null); }
  }

  const uploadedKeys = useMemo(() => new Set(resolved.myDocs.map(d => d.documentKey)), [resolved.myDocs]);
  const kycRequired      = KYC_DOCS;
  // Supporting documents always include Marriage Certificate alongside the
  // strictly-required Employment Letter + Bank Statement so families have
  // a visible slot. It stays non-blocking — `allRequired` below only
  // counts `required: true` docs for the docs-complete gate.
  // v1 launch policy: KYC trio is the ONLY mandatory gate. Everything
  // else (financial/business docs, marriage cert, occupant identity)
  // is voluntary but still visible so customers know they CAN upload
  // and admin gets richer context for review.

  // Always render these rows in the Supporting Documents section, even
  // though `required: false`. The customer's natural mental model is
  // "Employment Letter + Bank Statement + Marriage Cert" — hiding them
  // because they're optional would feel like missing UI.
  const SUPPORTING_SHOWN_KEYS = isRes
    ? ['employment_letter', 'bank_statement', 'marriage_certificate']
    : getRentalSectionDocs(unitType).slice(0, 3).map(d => d.key);
  const financialReq     = (isRes ? RESIDENTIAL_RENTAL_DOCS : getRentalSectionDocs(unitType)).filter(d => SUPPORTING_SHOWN_KEYS.includes(d.key));
  const financialOpt     = (isRes ? RESIDENTIAL_RENTAL_DOCS : getRentalSectionDocs(unitType)).filter(d => !SUPPORTING_SHOWN_KEYS.includes(d.key));
  const occupantDocList  = isRes && occupantCount > 1 ? getOccupantDocs(occupantCount) : [];

  // Gate counts only the KYC identity rows. Adding occupant or financial
  // rows to this list would block submission for customers who upload
  // their KYC but don't (e.g.) have an employment letter handy.
  const allRequired      = [...kycRequired];
  // Emirates ID counts as done via a combined file OR both sides (isDocKeySatisfied).
  const allRequiredDone  = allRequired.every(d => isDocKeySatisfied(d.key, uploadedKeys));

  const doneCount = allRequired.filter(d => isDocKeySatisfied(d.key, uploadedKeys)).length;
  const totalCount = allRequired.length;

  // Per-section completion flags drive the KycSection "Done ✓" collapse
  // so finished work stays visible (collapsed, with a green pill) instead
  // of vanishing.
  const kycAllDone      = kycRequired.every(d => isDocKeySatisfied(d.key, uploadedKeys));
  const supportingDocs  = financialReq;
  const supportingAllDone = supportingDocs.every(d => uploadedKeys.has(d.key));
  const occupantsAllDone  = occupantDocList.length > 0 && occupantDocList.every(d => uploadedKeys.has(d.key));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {uploadErr && <ErrorBox msg={uploadErr} />}

      {eidReading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--saffron-soft)', border: '1px solid #f0d68f', borderRadius: 12, padding: '12px 14px' }}>
          <Loader2 size={18} className="animate-spin" style={{ color: '#9a6a00', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Reading your Emirates ID…</p>
            <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '2px 0 0', lineHeight: 1.45 }}>We&apos;re extracting your details — your name, ID number, date of birth and nationality will fill in automatically.</p>
          </div>
        </div>
      )}

      {/* Personal Details — for the v1 launch we use an admin-review
          model instead of auto-OCR:
            1. Customer uploads their docs (KYC + supporting)
            2. The UpNow admin reviews the uploaded docs and types in
               the customer's name / gender / nationality / ID number
               / DOB on the User row (out-of-band, via the admin tools).
            3. When that admin update lands the card shows the fields as
               read-only chips so the customer can confirm them. The
               customer can still tap any field to correct an admin typo
               — same PersonalDetailsEditor as before.
          The auto-OCR pipeline (OcrService + runEmiratesIdOcr) is still
          in the codebase but gated off via OCR_ENABLED=false. Flip the
          env back on post-launch to resume auto-extract. */}
      {(() => {
        const personal = {
          firstName: user?.firstName ?? null,
          lastName: user?.lastName ?? null,
          gender: user?.gender ?? null,
          nationality: user?.nationality ?? null,
          emiratesIdNumber: user?.emiratesIdNumber ?? null,
        };
        const populated = !!(personal.firstName || personal.lastName || personal.emiratesIdNumber);
        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, flex: 1 }}>Personal details</p>
              {populated
                ? <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--jade-deep)', background: 'var(--jade-soft)', padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Verified by admin</span>
                : <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mute)', background: 'var(--mist)', padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Awaiting review</span>}
            </div>
            {populated ? (
              <>
                <p style={{ fontSize: 11, color: 'var(--mute)', margin: '0 0 10px', lineHeight: 1.4 }}>
                  An UpNow admin filled these in from your uploaded documents. Tap any field to correct a typo.
                </p>
                <PersonalDetailsEditor user={user} onSaved={refreshUser} />
              </>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
                Your details will be auto-filled.
              </p>
            )}
          </div>
        );
      })()}

      {/* Contact verification — email + phone OTP. Only shown when the
          account needs either (auto-generated email, or phone-only signup
          that hasn't added a real email, etc.). Email is NOT on the
          Emirates ID so we keep this as a customer-driven step. */}
      {(showEmailEdit || showPhoneEdit) && (
        <KycSection title="Verify contact details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ display: 'grid', gap: 5 }}>
              <span style={KYC_LABEL_STYLE}>Email</span>
              {showEmailEdit ? (
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--mist-strong)', borderRadius: 9, background: 'var(--paper)', overflow: 'hidden' }}>
                  <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="your@email.com"
                    style={{ flex: 1, border: 'none', outline: 'none', padding: '9px 12px', fontSize: 13, color: 'var(--ink)', background: 'transparent' }} />
                  <button type="button" onClick={sendEmailOtp} disabled={emailOtpBusy || !emailInput.trim()}
                    style={{ padding: '0 12px', height: '100%', minHeight: 38, border: 'none', borderLeft: '1px solid var(--mist-strong)', background: emailInput.trim() ? 'var(--jade-soft)' : 'var(--mist)', color: emailInput.trim() ? 'var(--jade-deep)' : 'var(--mute)', fontSize: 12, fontWeight: 700, cursor: emailInput.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap', fontFamily: 'inherit', flexShrink: 0 }}>
                    {emailOtpBusy ? <Loader2 size={12} className="animate-spin" /> : 'Verify'}
                  </button>
                </div>
              ) : (
                <KycContactChip icon={<Mail size={13} />} value={isAutoEmail ? '' : (user?.email ?? '')} verified={emailVerified && !isAutoEmail} />
              )}
            </div>
            <div style={{ display: 'grid', gap: 5 }}>
              <span style={KYC_LABEL_STYLE}>Phone</span>
              {showPhoneEdit ? (
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--mist-strong)', borderRadius: 9, background: 'var(--paper)', overflow: 'hidden' }}>
                  <input type="tel" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} placeholder="+971 50 000 0000"
                    style={{ flex: 1, border: 'none', outline: 'none', padding: '9px 12px', fontSize: 13, color: 'var(--ink)', background: 'transparent' }} />
                  <button type="button" onClick={sendPhoneOtp} disabled={phoneOtpBusy || !phoneInput.trim()}
                    style={{ padding: '0 12px', height: '100%', minHeight: 38, border: 'none', borderLeft: '1px solid var(--mist-strong)', background: phoneInput.trim() ? 'var(--jade-soft)' : 'var(--mist)', color: phoneInput.trim() ? 'var(--jade-deep)' : 'var(--mute)', fontSize: 12, fontWeight: 700, cursor: phoneInput.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap', fontFamily: 'inherit', flexShrink: 0 }}>
                    {phoneOtpBusy ? <Loader2 size={12} className="animate-spin" /> : 'Verify'}
                  </button>
                </div>
              ) : (
                <KycContactChip icon={<Phone size={13} />} value={user?.phone ?? ''} verified={phoneVerified} />
              )}
            </div>
          </div>

          {showPhoneEdit && phoneOtpStep === 'verifying' && (
            <div style={{ border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Phone size={13} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>Code sent to <strong>{phoneInput}</strong></span>
                <button type="button" onClick={() => { setPhoneOtpStep('idle'); setPhoneOtp(''); setPhoneOtpErr(null); }}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--jade-deep)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Change</button>
              </div>
              {phoneDevOtp && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef3c7', border: '1px dashed #f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 9, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>Dev OTP</p>
                    <p style={{ fontSize: 18, fontWeight: 700, letterSpacing: '4px', fontFamily: 'monospace', margin: '2px 0 0', color: '#1a1916' }}>{phoneDevOtp}</p>
                  </div>
                  <button type="button" onClick={() => setPhoneOtp(phoneDevOtp)}
                    style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer' }}>Auto-fill</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="6-digit code"
                  value={phoneOtp} onChange={e => setPhoneOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ ...KYC_INPUT_STYLE, letterSpacing: '4px', fontWeight: 700, maxWidth: 150 }} />
                <button type="button" onClick={verifyPhoneOtp} disabled={phoneOtpBusy || phoneOtp.length !== 6}
                  style={{ padding: '9px 20px', borderRadius: 9, background: 'var(--jade)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: phoneOtp.length === 6 ? 'pointer' : 'not-allowed', opacity: phoneOtp.length < 6 ? 0.5 : 1, fontFamily: 'inherit', flexShrink: 0 }}>
                  {phoneOtpBusy ? <Loader2 size={14} className="animate-spin" /> : 'Verify'}
                </button>
                <button type="button" onClick={async () => { try { const r = await apiPost<{ devOtp?: string }>('/auth/otp/request', {}); if (r?.devOtp) setPhoneDevOtp(r.devOtp); } catch { /* ignore */ } }}
                  style={{ fontSize: 12, color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, flexShrink: 0 }}>Resend</button>
              </div>
              {phoneOtpErr && <p style={{ fontSize: 12, color: 'var(--brick)', margin: 0 }}>{phoneOtpErr}</p>}
            </div>
          )}
          {phoneOtpErr && phoneOtpStep === 'idle' && showPhoneEdit && (
            <p style={{ fontSize: 12, color: 'var(--brick)', margin: 0 }}>{phoneOtpErr}</p>
          )}

          {showEmailEdit && emailOtpStep === 'verifying' && (
            <div style={{ border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Mail size={13} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>Code sent to <strong>{emailInput}</strong></span>
                <button type="button" onClick={() => { setEmailOtpStep('idle'); setEmailOtp(''); setEmailOtpErr(null); }}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--jade-deep)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Change</button>
              </div>
              {emailDevOtp && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef3c7', border: '1px dashed #f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 9, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>Dev OTP</p>
                    <p style={{ fontSize: 18, fontWeight: 700, letterSpacing: '4px', fontFamily: 'monospace', margin: '2px 0 0', color: '#1a1916' }}>{emailDevOtp}</p>
                  </div>
                  <button type="button" onClick={() => setEmailOtp(emailDevOtp)}
                    style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer' }}>Auto-fill</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="6-digit code"
                  value={emailOtp} onChange={e => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ ...KYC_INPUT_STYLE, letterSpacing: '4px', fontWeight: 700, maxWidth: 150 }} />
                <button type="button" onClick={verifyEmailOtp} disabled={emailOtpBusy || emailOtp.length !== 6}
                  style={{ padding: '9px 20px', borderRadius: 9, background: 'var(--jade)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: emailOtp.length === 6 ? 'pointer' : 'not-allowed', opacity: emailOtp.length < 6 ? 0.5 : 1, fontFamily: 'inherit', flexShrink: 0 }}>
                  {emailOtpBusy ? <Loader2 size={14} className="animate-spin" /> : 'Verify'}
                </button>
                <button type="button" onClick={async () => { try { const r = await apiPost<{ devOtp?: string }>('/auth/email/resend', {}); if (r?.devOtp) setEmailDevOtp(r.devOtp); } catch { /* ignore */ } }}
                  style={{ fontSize: 12, color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, flexShrink: 0 }}>Resend</button>
              </div>
              {emailOtpErr && <p style={{ fontSize: 12, color: 'var(--brick)', margin: 0 }}>{emailOtpErr}</p>}
            </div>
          )}
          {emailOtpErr && emailOtpStep === 'idle' && showEmailEdit && (
            <p style={{ fontSize: 12, color: 'var(--brick)', margin: 0 }}>{emailOtpErr}</p>
          )}
        </KycSection>
      )}

      {/* Identity documents (KYC). Always rendered; the KycSection
          auto-collapses with a "Done ✓" pill when every required KYC
          doc is uploaded, so finished work stays visible instead of
          disappearing on the customer. */}
      <KycSection title="Identity documents (KYC)" accent allDone={kycAllDone}>
        {kycRequired.map(req => <KycDocRow key={req.key} req={req} myDocs={resolved.myDocs} localPreviews={localPreviews} docUploading={docUploading} onUpload={uploadDoc} />)}
      </KycSection>

      {/* Supporting / business documents. Same persistent-Done pattern. */}
      <KycSection title={isRes ? 'Supporting documents' : 'Business documents'} allDone={supportingAllDone}>
        {supportingDocs.map(req => <KycDocRow key={req.key} req={req} myDocs={resolved.myDocs} localPreviews={localPreviews} docUploading={docUploading} onUpload={uploadDoc} />)}
      </KycSection>

      {/* Optional documents — only surface them once the mandatory work
          is done, so they don't clutter the screen while the customer
          still has required uploads to finish. */}
      {isRes && financialOpt.length > 0 && allRequiredDone && (
        <KycSection title="Optional documents" allDone={financialOpt.every(d => uploadedKeys.has(d.key))}>
          {financialOpt.map(req => <KycDocRow key={req.key} req={req} myDocs={resolved.myDocs} localPreviews={localPreviews} docUploading={docUploading} onUpload={uploadDoc} />)}
        </KycSection>
      )}

      {/* Additional occupants — always rendered when occupantCount > 1.
          Collapses with "Done ✓" once every occupant's required identity
          docs are uploaded. */}
      {occupantDocList.length > 0 && (
        <KycSection title={`Additional occupants (${occupantCount - 1} more)`} allDone={occupantsAllDone}>
          {occupantDocList.map(req => <KycDocRow key={req.key} req={req} myDocs={resolved.myDocs} localPreviews={localPreviews} docUploading={docUploading} onUpload={uploadDoc} />)}
        </KycSection>
      )}

      {/* Submit — explicit gate. Uploading the last file no longer auto-advances;
          the customer must click here to submit their documents for review. */}
      <PrimaryBtn
        onClick={() => { if (allRequiredDone) writeDocsSubmitted(resolved.spaceKey); onRefresh(); }}
        disabled={!allRequiredDone}
      >
        {allRequiredDone ? <CheckCircle2 size={16} /> : <Info size={16} />}
        {allRequiredDone ? 'Submit documents for review' : `Upload all required docs (${doneCount}/${totalCount} done)`}
      </PrimaryBtn>
    </div>
  );
}

/* ─── DOCUMENTS ─────────────────────────────────────────────────────── */
/**
 * Step 2 entry point — dispatches to either the new-lease inline KYC form
 * or the renewal-only doc refresh component. Split because each branch has
 * its own hook footprint; the Rules of Hooks forbid an early return before
 * hook calls.
 */
function DocumentsAction({
  resolved,
  onRefresh,
  renewal,
}: {
  resolved: Resolved;
  onRefresh: () => void;
  renewal?: boolean;
}) {
  return renewal
    ? <RenewalDocumentsAction resolved={resolved} onRefresh={onRefresh} />
    : <InlineKycDocsForm resolved={resolved} onRefresh={onRefresh} />;
}

function RenewalDocumentsAction({
  resolved,
  onRefresh,
}: {
  resolved: Resolved;
  onRefresh: () => void;
}) {
  const viewing = resolved.viewing;
  const unit = resolved.unit;
  const unitType = unit?.unitType ?? null;
  const renewal = true;

  const requiredDocs: DocReq[] = useMemo(() => getRentalSectionDocs(unitType).filter(d => d.required), [unitType]);
  const uploadedKeys = useMemo(() => new Set(resolved.myDocs.map(d => d.documentKey)), [resolved.myDocs]);
  // Occupants — only meaningful for residential. We don't persist count in
  // the DB; the uploaded `occupant_N_*` doc keys are the source of truth.
  const RESIDENTIAL_BLOCKLIST = ['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical','coworking_desk','private_office','meeting_room','day_office','event_hall','wedding_venue','conference_hall','private_dining','outdoor_venue','warehouse','open_yard','storage_unit','cold_storage','logistics_facility'];
  const isResidential = !unitType || !RESIDENTIAL_BLOCKLIST.includes(unitType);
  const initialOccupantCount = useMemo(
    () => Math.max(
      viewing?.occupantsAdults ?? 1,
      deriveOccupantCount(resolved.myDocs.map(d => d.documentKey)),
    ),
    [viewing?.occupantsAdults, resolved.myDocs],
  );
  const [occupantCount, setOccupantCount] = useState<number>(initialOccupantCount);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialOccupantCount > occupantCount) setOccupantCount(initialOccupantCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOccupantCount]);
  const occupantDocs: DocReq[] = useMemo(
    () => isResidential ? getOccupantDocs(occupantCount) : [],
    [isResidential, occupantCount],
  );
  const requiredMissing = [
    ...requiredDocs.filter(d => !uploadedKeys.has(d.key)),
    ...occupantDocs.filter(d => !uploadedKeys.has(d.key)),
  ];
  const docsOk = requiredMissing.length === 0;

  const [prefSaving, setPrefSaving] = useState(false);
  const [prefError,  setPrefError]  = useState<string | null>(null);

  // ── Inline upload ──────────────────────────────────────────────────────
  const [docUploading, setDocUploading] = useState<string | null>(null);
  const [uploadError,  setUploadError]  = useState<string | null>(null);

  async function handleUpload(req: DocReq, file: File) {
    if (!resolved.tenantProfileId) { setUploadError('Customer profile missing.'); return; }
    setDocUploading(req.key); setUploadError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: resolved.tenantProfileId,
          documentKey: req.key, originalName: file.name, mimeType: file.type,
        }),
      });
      if (!urlRes.ok) throw new Error('Failed to start upload');
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error('File upload failed');
      const regRes = await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: resolved.tenantProfileId,
          documentKey: req.key, category: req.category ?? 'identity',
          displayName: req.label, fileUrl, mimeType: file.type, s3Key: fileKey,
          isVisibleToTenant: true,
        }),
      });
      if (!regRes.ok) throw new Error('Registration failed');
      onRefresh();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setDocUploading(null);
    }
  }

  async function handleSubmit() {
    setPrefSaving(true); setPrefError(null);
    try { onRefresh(); }
    finally { setPrefSaving(false); }
  }

  const allDocs: DocReq[] = [...requiredDocs, ...occupantDocs];

  function DocRow({ req }: { req: DocReq }) {
    const rec = resolved.myDocs.find(d => d.documentKey === req.key);
    const isUploaded = !!rec;
    const isUploading = docUploading === req.key;
    return (
      <label style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
        background: isUploaded ? 'rgba(46,159,130,0.08)' : 'var(--paper)',
        border: `1px solid ${isUploaded ? 'rgba(46,159,130,0.35)' : 'var(--mist-strong)'}`,
        cursor: isUploading ? 'progress' : 'pointer',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{req.label}</p>
          <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>
            {isUploaded ? (rec.displayName ?? 'Uploaded') : (req.hint ?? 'Tap to upload')}
          </p>
        </div>
        {isUploading ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
          : isUploaded ? <CheckCircle2 size={16} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
          : <UploadCloud size={16} style={{ color: 'var(--mute)', flexShrink: 0 }} />}
        <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
          disabled={isUploading}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(req, f); }} />
      </label>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {uploadError && <ErrorBox msg={uploadError} />}
      {prefError && <ErrorBox msg={prefError} />}

      {/* All documents — tenant + occupants in one flat list */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '14px 16px', display: 'grid', gap: 8 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
          {renewal ? 'Renewal documents' : 'Required documents'}
          <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--mute)', textTransform: 'none', letterSpacing: 0 }}>
            {allDocs.filter(d => resolved.myDocs.some(u => u.documentKey === d.key)).length}/{allDocs.length} uploaded
          </span>
        </p>
        {allDocs.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--mute)', margin: 0 }}>No documents required for this unit type.</p>
          : allDocs.map(req => <DocRow key={req.key} req={req} />)
        }
      </div>

      {/* Submit */}
      <div style={{ display: 'grid', gap: 8 }}>
        {!docsOk && (
          <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Info size={13} /> Upload all required documents to continue
          </p>
        )}
        <PrimaryBtn onClick={handleSubmit} disabled={!docsOk || prefSaving}>
          {prefSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {prefSaving ? 'Saving…' : 'Continue to payment plan'}
        </PrimaryBtn>
        <SecondaryBtn href="/dashboard/customer/documents">
          <Info size={14} /> Manage all KYC documents
        </SecondaryBtn>
      </div>
    </div>
  );
}

/** Resolve cheque-payee name from the unit's rental provider — shared by
 *  inline display and the printed PDF so they always agree. */
function resolveChequePayee(unit: ApiUnit | null): string {
  const rp = unit?.property?.rentalProvider ?? unit?.property?.rental_provider;
  const userName = rp?.user?.name?.trim() || null;
  const companyName = rp?.companyName?.trim() || null;
  const bankName = rp?.bankAccountName?.trim() || null;
  const byEntity = rp?.entityType === 'individual'
    ? (userName || companyName)
    : rp?.entityType === 'company'
      ? (companyName || userName)
      : (companyName || userName);
  return bankName || byEntity || 'To be confirmed';
}

/* ─── Payment plan PRINT (opens in new window) ─────────────────────── */
function printPaymentPlan(resolved: Resolved, tenantName: string) {
  const plan = resolved.paymentPlan;
  if (!plan) return;
  const u = resolved.unit;
  const startDate = plan.items?.[0]?.dueDate ?? null;
  const endDate = startDate ? (() => {
    const d = new Date(startDate + 'T00:00:00');
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })() : null;
  const fmt = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const ownerName = resolveChequePayee(u);
  const buildingName = u?.property?.buildingName ?? '—';
  const location = [u?.property?.community?.name, u?.property?.emirate?.name].filter(Boolean).join(', ') || u?.property?.fullAddress || '—';
  // Matches v1's print convention exactly: amounts stored in fils, divided to AED for the document.
  const aed = (fils: number | undefined | null) => fils == null ? '—' : `AED ${(fils / 100).toLocaleString('en-AE')}`;

  const itemsHtml = sortPlanItems(plan.items ?? []).map((it, i) => `
    <tr>
      <td>#${i + 1}</td>
      <td>${(it.description ?? `Cheque ${i + 1}`).replace(/</g, '&lt;')}</td>
      <td style="text-align:right">${aed(it.amountFils)}</td>
      <td>${it.dueDate ?? '—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Payment Plan — ${buildingName}</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1916;padding:32px;max-width:780px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-0.02em} h2{font-size:13px;margin:24px 0 8px;color:#1f5a3f;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #d8f2e8;padding-bottom:4px}
  .sub{font-size:11px;color:#6b6860;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:160px 1fr;gap:6px 16px;font-size:12px;margin-bottom:8px}
  .grid .l{color:#9b9890;text-transform:uppercase;font-size:10px;letter-spacing:.05em;padding-top:2px}
  .grid .v{color:#1a1916;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e8e6e0}
  th{background:#f9f8f6;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b6860}
  tfoot td{font-weight:700;background:#d8f2e8;color:#1f5a3f;border-top:2px solid #2e9f82}
  .footer{margin-top:32px;font-size:10px;color:#9b9890;text-align:center;border-top:1px solid #e8e6e0;padding-top:12px}
  @media print{body{padding:16px} .noprint{display:none}}
  .btnrow{margin:0 0 24px;display:flex;gap:8px}
  .btn{display:inline-block;padding:10px 16px;background:#2e9f82;color:#fff;border:none;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer}
  .btn.alt{background:#f9f8f6;color:#3d3b35;border:1px solid #e8e6e0}
</style></head>
<body>
  <div class="btnrow noprint">
    <button class="btn" onclick="window.print()">Print / Save as PDF</button>
    <button class="btn alt" onclick="window.close()">Close</button>
  </div>
  <h1>Payment Plan</h1>
  <p class="sub">${buildingName} · Issued ${plan.issuedAt ? new Date(plan.issuedAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day:'numeric', month:'short', year:'numeric' }) : '—'}</p>

  <h2>Contract &amp; Cheque Details</h2>
  <div class="grid">
    <div class="l">Cheque Drawer (You)</div><div class="v">${tenantName.replace(/</g, '&lt;')}</div>
    <div class="l">Cheque Payee (Landlord)</div><div class="v">${ownerName.replace(/</g, '&lt;')}</div>
    <div class="l">Building</div><div class="v">${buildingName.replace(/</g, '&lt;')}</div>
    <div class="l">Unit No.</div><div class="v">${u?.unitNumber ?? '—'}</div>
    <div class="l">Location</div><div class="v">${location.replace(/</g, '&lt;')}</div>
    <div class="l">Contract Period</div><div class="v">${fmt(startDate)} → ${fmt(endDate)} (12 months)</div>
    <div class="l">Contract Value</div><div class="v">${aed(plan.totalAmountFils)}</div>
  </div>

  <h2>Rent &amp; Fees</h2>
  <div class="grid">
    <div class="l">Annual Rent</div><div class="v">${aed(plan.rentFils)}</div>
    ${plan.securityDepositFils ? `<div class="l">Security Deposit</div><div class="v">${aed(plan.securityDepositFils)}</div>` : ''}
    ${plan.adminFeeFils ? `<div class="l">Admin Fee</div><div class="v">${aed(plan.adminFeeFils)}</div>` : ''}
    ${plan.ejariFils ? `<div class="l">Ejari Fee</div><div class="v">${aed(plan.ejariFils)}</div>` : ''}
    ${plan.commissionFils ? `<div class="l">Commission</div><div class="v">${aed(plan.commissionFils)}</div>` : ''}
  </div>

  <h2>Cheque Schedule (${plan.chequeCount} cheques)</h2>
  <table>
    <thead><tr><th>#</th><th>Description</th><th style="text-align:right">Amount</th><th>Due Date</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td style="text-align:right">${aed(plan.totalAmountFils)}</td><td></td></tr></tfoot>
  </table>

  ${plan.notes ? `<h2>Notes</h2><p style="font-size:12px;color:#3d3b35;white-space:pre-wrap">${plan.notes.replace(/</g, '&lt;')}</p>` : ''}

  <div class="footer">Generated by UpNow · ${new Date().toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day:'numeric', month:'short', year:'numeric' })}</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) { alert('Please allow pop-ups to open the payment plan.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* ─── DOCS UNDER REVIEW ───────────────────────────────────────────────
 * Mounted between Step 2 (docs_required) and Step 3 (payment_review).
 * The customer has uploaded KYC + any supporting docs; admin/RP now
 * reviews them. When admin issues the payment plan (or marks the lead
 * approved) lead.stage flips to `payment_plan_shared` and the next
 * customer refresh routes them into payment_review.
 *
 * Card layout: waiting badge at the top, payment plan summary below
 * (lump-sum fee breakdown + cheque schedule) so the customer can see
 * what they're committing to while admin processes their paperwork.
 */
function DocsUnderReviewAction({ resolved }: { resolved: Resolved }) {
  const plan = resolved.paymentPlan;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <WaitingBadge />
      {plan && <PaymentPlanSummary plan={plan} />}
    </div>
  );
}

/** Reusable summary card showing the lump-sum fee breakdown + the full
 *  cheque schedule from a PaymentPlan. Used by DocsUnderReviewAction
 *  and (later) the contract-preview block on Step 3 (payment_review). */
function PaymentPlanSummary({ plan }: { plan: ApiPaymentPlan }) {
  const items = plan.items ?? [];
  const installments = plan.installmentCount ?? Math.max(1, plan.chequeCount - 1);
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
      <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', fontWeight: 600 }}>Payment plan summary</p>

      <div style={{ display: 'grid', gap: 6, marginBottom: items.length ? 14 : 0 }}>
        <PaymentRow label="Annual rent" amountFils={plan.rentFils} />
        <PaymentRow label="Security deposit" amountFils={plan.securityDepositFils ?? 0} />
        <PaymentRow label="Admin fee" amountFils={plan.adminFeeFils ?? 0} />
        <PaymentRow label="Ejari fee" amountFils={plan.ejariFils ?? 0} />
        <PaymentRow label="Commission" amountFils={plan.commissionFils ?? 0} />
        <div style={{ borderTop: '1px solid var(--mist-strong)', margin: '6px 0' }} />
        <PaymentRow label="Total payable" amountFils={plan.totalAmountFils} bold />
      </div>

      {items.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 8px' }}>
            <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, fontWeight: 600 }}>Payment schedule</p>
            <p style={{ fontSize: 11, color: 'var(--mute)', margin: 0 }}>
              {installments} rent {installments === 1 ? 'payment' : 'payments'}{(plan.securityDepositFils ?? 0) > 0 ? ' + 1 deposit payment' : ''}
            </p>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {sortPlanItems(items).map((it, i) => {
              const isDeposit = it.type === 'security_deposit';
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: isDeposit ? 'var(--saffron)' : 'var(--jade-deep)', background: isDeposit ? 'var(--saffron-soft)' : 'var(--jade-soft)', borderRadius: 6, padding: '2px 6px', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      #{i + 1}
                    </span>
                    <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.description ?? (isDeposit ? 'Security deposit' : `Installment ${i + 1}`)}
                    </span>
                  </div>
                  <span style={{ color: 'var(--mute)', fontSize: 11, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {it.dueDate ? new Date(it.dueDate + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short' }) : '—'}
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', minWidth: 90, textAlign: 'right' }}>
                    {fmtAedFils(it.amountFils)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── PAYMENT PLAN ─────────────────────────────────────────────────── */
function PaymentPlanAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plan = resolved.paymentPlan;
  const leadId = resolved.lead?.id ?? resolved.viewing?.lead?.id ?? resolved.viewing?.leadId ?? null;
  const viewingId = resolved.viewing?.id ?? null;

  // Cheque uploads — customer attaches photos of their physical cheques so
  // the landlord knows which ones to collect. Optional but encouraged.
  const [uploads, setUploads] = useState<CustomerCheque[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(0);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const chequeFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!viewingId) return;
    fetch(`/api/leads/my-viewings/${viewingId}/cheque-uploads`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: CustomerCheque[]) => setUploads(data))
      .catch(() => {});
  }, [viewingId]);

  if (!plan) {
    return (
      <div style={{ background: 'var(--saffron-soft)', border: '1px solid #f0d68f', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Clock size={18} style={{ color: 'var(--saffron-deep)', flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
          Your rental provider is preparing the payment plan. We&apos;ll notify you the moment it&apos;s ready to review.
        </p>
      </div>
    );
  }

  async function uploadOneCheque(file: File, index: number) {
    if (!resolved.tenantProfileId || !viewingId) return;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'customer', ownerId: resolved.tenantProfileId,
        documentKey: 'cheque_upload', originalName: file.name, mimeType: file.type,
      }),
    });
    if (!urlRes.ok) throw new Error('Failed to start upload');
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!putRes.ok) throw new Error('File upload failed');
    const regRes = await fetch(`/api/leads/my-viewings/${viewingId}/cheque-uploads`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: fileUrl, fileKey, label: `Cheque ${index}` }),
    });
    if (!regRes.ok) {
      const b = await regRes.json().catch(() => ({}));
      throw new Error(b?.message ?? 'Cheque registration failed');
    }
    return (await regRes.json()) as CustomerCheque;
  }

  async function handleChequeFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadErr(null);
    setUploadingFiles(files.length);
    let nextIndex = uploads.length + 1;
    try {
      for (const file of Array.from(files)) {
        const saved = await uploadOneCheque(file, nextIndex);
        if (saved) setUploads(prev => [...prev, saved]);
        nextIndex++;
      }
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingFiles(0);
      if (chequeFileInputRef.current) chequeFileInputRef.current.value = '';
    }
  }

  async function removeUpload(chequeId: number) {
    if (!viewingId) return;
    const res = await fetch(`/api/leads/my-viewings/${viewingId}/cheque-uploads/${chequeId}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) setUploads(prev => prev.filter(c => c.id !== chequeId));
  }

  async function confirm() {
    if (!leadId) { setErr('No lead linked to this space.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/cheques-ready`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  const items = sortPlanItems(plan.items ?? []);
  const firstDue = items.find(i => i.dueDate)?.dueDate ?? null;
  const typeMeta = (t?: string) => {
    if (t === 'security_deposit') return { label: 'Before move-in',  bg: 'var(--mist)',         fg: 'var(--ink-2)'     };
    if (t === 'first_bundle')     return { label: 'Before move-in',  bg: 'var(--saffron-soft)', fg: 'var(--saffron-deep)' };
    if (t === 'extra_installment')return { label: 'Extra',    bg: 'var(--jade-soft)',    fg: 'var(--jade-deep)' };
    return                               { label: 'Rent',     bg: 'var(--surface)',      fg: 'var(--mute)'      };
  };

  // Note: the plan is intentionally method-agnostic on the customer side.
  // The customer just declares "here are my payment references" — cheque
  // photos, transfer screenshots, card slips, cash receipts. The landlord
  // classifies each one (cheque / bank transfer / card / cash) when they
  // approve it on the RP side.

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Stat label="Annual rent" value={fmtAedFils(plan.rentFils)} />
        <Stat label="Total contract value" value={fmtAedFils(plan.totalAmountFils)} accent />
        <Stat label="First payment" value={firstDue ? fmtDateShort(firstDue) : '—'} />
      </div>

      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--mist-strong)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payment schedule · {plan.chequeCount} payment{plan.chequeCount === 1 ? '' : 's'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 10, color: 'var(--mute)', fontWeight: 500 }}>Issued {fmtDateShort(plan.issuedAt)}</span>
            <button type="button" onClick={() => printPaymentPlan(resolved, personName(user) || '—')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--jade-deep)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Printer size={12} /> Print / Save PDF
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <p style={{ padding: '14px 16px', fontSize: 12, color: 'var(--mute)', margin: 0 }}>No payment items listed.</p>
        ) : items.map((ch, i) => {
          const meta = typeMeta(ch.type);
          return (
            <div key={ch.index} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto auto', gap: 14, alignItems: 'center', padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--mist)' }}>
              <span style={{ fontSize: 12, color: 'var(--mute)', fontWeight: 600 }}>#{ch.index}</span>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{ch.description ?? (ch.type === 'security_deposit' ? 'Security deposit' : `Payment ${ch.index}`)}</p>
                <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>{ch.dueDate ? fmtDateLong(ch.dueDate) : 'No due date'}</p>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtAedFils(ch.amountFils)}</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 999, background: meta.bg, color: meta.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{meta.label}</span>
            </div>
          );
        })}
      </div>
      {plan.notes && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontWeight: 600 }}>Notes from your rental provider</p>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{plan.notes}</p>
        </div>
      )}
      {/* ── Payment references — cheque photos, transfer screenshots, card slips, cash receipts ── */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
            Attach payment references (optional)
          </p>
          <span style={{ fontSize: 11, color: 'var(--mute)' }}>{uploads.length} uploaded</span>
        </div>
        <label style={{
          marginTop: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--mist-strong)',
          background: 'var(--surface)', cursor: uploadingFiles ? 'progress' : 'pointer',
          fontSize: 13, fontWeight: 600, color: 'var(--jade-deep)',
        }}>
          <input
            ref={chequeFileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            disabled={uploadingFiles > 0}
            onChange={(e) => handleChequeFiles(e.target.files)}
            style={{ display: 'none' }}
          />
          {uploadingFiles > 0
            ? <><Loader2 size={14} className="animate-spin" /> Uploading {uploadingFiles} file{uploadingFiles === 1 ? '' : 's'}…</>
            : <><UploadCloud size={14} /> Choose files</>}
        </label>

        {uploadErr && <div style={{ marginTop: 10 }}><ErrorBox msg={uploadErr} /></div>}

        {uploads.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {uploads.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--mist-strong)' }}>
                {c.imageUrl ? (
                  <button type="button" onClick={() => openDocViewer({ fileUrl: c.imageUrl, caption: c.notes || `Payment ${i + 1}` })} style={{ flexShrink: 0, lineHeight: 0, display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
                    {c.imageUrl.split('?')[0].toLowerCase().endsWith('.pdf') ? (
                      <span style={{ width: 44, height: 30, borderRadius: 4, background: 'var(--mist)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--jade-deep)' }}>
                        <FileText size={16} />
                      </span>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={c.imageUrl} alt="cheque" style={{ width: 44, height: 30, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                    )}
                  </button>
                ) : null}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{c.notes || `Payment ${i + 1}`}</p>
                  {c.bankName && <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>{c.bankName}{c.amountFils ? ` · AED ${(c.amountFils / 100).toLocaleString('en-AE')}` : ''}</p>}
                </div>
                {c.imageUrl && (
                  <button
                    type="button"
                    onClick={() => openDocViewer({ fileUrl: c.imageUrl, caption: c.notes || `Payment ${i + 1}` })}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--jade-deep)', fontSize: 11, fontWeight: 600, textDecoration: 'none', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                  >
                    <ExternalLink size={12} /> View
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeUpload(c.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                  aria-label="Remove payment proof"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <ErrorBox msg={err} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <PrimaryBtn onClick={confirm} disabled={busy || uploadingFiles > 0}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy ? 'Marking…' : 'I’ve made the payments'}
        </PrimaryBtn>
      </div>
      <p style={{ fontSize: 11, color: 'var(--mute)', margin: 0, lineHeight: 1.5 }}>
        Tap when you’ve sent or prepared your payments. Your rental provider will verify each one (cheque, bank transfer, card or cash) and confirm receipt — your contract is then issued automatically.
      </p>
    </div>
  );
}

/* ─── SIGNATURE (new contract OR renewal) ──────────────────────────── */
function SignatureAction({ resolved, onRefresh, renewal }: { resolved: Resolved; onRefresh: () => void; renewal?: boolean }) {
  const { user } = useAuth();
  const c = renewal ? resolved.renewalContract : resolved.contract;
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState(personName(user));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!c) return <ErrorBox msg="Contract not found." />;

  async function sign() {
    if (!sig) { setErr('Please draw your signature.'); return; }
    if (!name.trim()) { setErr('Please enter your full name.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${c!.id}/sign`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signatoryName: name.trim(), signatureImage: sig }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to sign'); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Highlighted "Step 1 — Review" card with a subtle pulsing ring to draw attention */}
      <style>{`
        @keyframes reviewCardPulse {
          0%, 100% { box-shadow: 0 4px 14px -6px rgba(46,159,130,0.45), 0 0 0 0 rgba(46,159,130,0.45); }
          50%      { box-shadow: 0 4px 14px -6px rgba(46,159,130,0.45), 0 0 0 10px rgba(46,159,130,0); }
        }
        .review-card-pulse { animation: reviewCardPulse 1.8s ease-out infinite; }
      `}</style>
      <a href={`/dashboard/customer/contracts/${c.id}/print`} target="_blank" rel="noopener noreferrer"
        className="review-card-pulse"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
          padding: '16px 20px', borderRadius: 14,
          background: 'var(--jade-soft)', border: '2px solid var(--jade)',
          textDecoration: 'none', color: 'var(--ink)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--jade)', color: 'var(--paper)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <FileText size={18} />
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 10, color: 'var(--jade-deep)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>Step 1 — review</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '2px 0 0' }}>Preview your contract before signing</p>
          </div>
        </div>
        <ExternalLink size={16} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
      </a>

      {/* Name */}
      <div>
        <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Full name (as on Emirates ID)</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your full legal name"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit' }} />
      </div>

      {/* Signature */}
      <div>
        <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Signature</label>
        <SignatureCanvas onChange={setSig} />
      </div>

      {err && <ErrorBox msg={err} />}

      <PrimaryBtn onClick={sign} disabled={busy || !sig}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Pen size={16} />}
        {busy ? 'Signing…' : renewal ? 'Sign renewal' : 'Sign contract'}
      </PrimaryBtn>
    </div>
  );
}

/* ─── UTILITY ──────────────────────────────────────────────────────── */
function UtilityAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const c = resolved.contract;
  const premiseNumber = resolved.unit?.premiseNumber ?? '';
  const [acc, setAcc] = useState(c?.utilityAccountNumber ?? premiseNumber);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Locally tracked upload — flips true on a successful POST so the Submit
  // button unlocks immediately, without waiting for a Resolved refresh.
  const [proofJustUploaded, setProofJustUploaded] = useState<{ name: string; fileUrl: string } | null>(null);
  // Existing proof on file from a previous attempt (if any).
  const existingProof = resolved.myDocs.find(d => d.documentKey === 'utility_proof_of_payment');
  const proofUploaded = !!proofJustUploaded || !!existingProof;
  const proofDisplayName = proofJustUploaded?.name ?? existingProof?.displayName ?? 'Utility proof on file';

  if (!c) return <ErrorBox msg="Contract not found." />;

  async function submit() {
    if (!acc.trim()) { setErr('Enter your utility account number.'); return; }
    if (!proofUploaded) { setErr('Upload your utility proof before submitting.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${c!.id}/utility`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ utilityAccountNumber: acc.trim() }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function uploadProof(file: File) {
    if (!resolved.tenantProfileId) { setErr('Customer profile missing.'); return; }
    setProofBusy(true); setErr(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'customer', ownerId: resolved.tenantProfileId, documentKey: 'utility_proof_of_payment', originalName: file.name, mimeType: file.type }) });
      if (!urlRes.ok) throw new Error('Upload URL failed');
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error('File upload failed');
      const regRes = await fetch('/api/documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'customer', ownerId: resolved.tenantProfileId, documentKey: 'utility_proof_of_payment', category: 'payment', displayName: 'Utility Proof of Payment', fileUrl, mimeType: file.type, s3Key: fileKey, isVisibleToTenant: true }) });
      if (!regRes.ok) throw new Error('Failed to register proof');
      setProofJustUploaded({ name: file.name, fileUrl });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed'); } finally { setProofBusy(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>DEWA / utility account number</label>
        <input type="text" value={acc} onChange={e => setAcc(e.target.value)} placeholder="e.g. 12345678"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit' }} />
      </div>
      <div>
        <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span>Proof of payment (required)</span>
          {proofUploaded && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--jade-deep)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={12} /> Uploaded
            </span>
          )}
        </label>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadProof(f); }} />
        <SecondaryBtn onClick={() => fileRef.current?.click()}>
          {proofBusy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
          {proofBusy ? 'Uploading…' : (proofUploaded ? 'Replace proof file' : 'Upload proof file')}
        </SecondaryBtn>
        {proofUploaded && (
          <p style={{ fontSize: 11, color: 'var(--mute)', margin: '6px 0 0' }}>
            On file: <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{proofDisplayName}</span>
          </p>
        )}
      </div>
      {err && <ErrorBox msg={err} />}
      <PrimaryBtn onClick={submit} disabled={busy || proofBusy || !proofUploaded || !acc.trim()}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
        {busy ? 'Submitting…' : 'Submit utility account'}
      </PrimaryBtn>
    </div>
  );
}


/* ─── MOVE-IN — inspection summary (LIVE data) + counter-sign deep link ─── */
// Pulls the full inspection record from /api/contracts/tenant/:id/inspection
// so v2 mirrors exactly what the RP submitted (rooms, conditions, photos count,
// notes, inspector). Counter-signing happens on the dedicated /inspection
// page which has the signature canvas.
interface MoveInInspectionItem { id: string; name: string; inCondition: 'G' | 'F' | 'D' | ''; outCondition?: 'G' | 'F' | 'D' | '' }
interface MoveInInspectionArea { id: string; name: string; items: MoveInInspectionItem[]; remarks?: string }
interface MoveInInspectionData {
  inspectorName?: string;
  inspectionDate?: string;
  moveInDate?: string;
  reportGeneratedDate?: string;
  areas?: MoveInInspectionArea[];
  generalNotes?: string;
  photos?: Array<{ id: string; url: string; caption?: string }>;
  tenantSig?: string | null;
  tenantSignedAt?: string | null;
  landlordSig?: string | null;
  rpCounterSig?: string | null;
}

function condLabel(c?: string) {
  if (c === 'G') return 'good';
  if (c === 'F') return 'fair';
  if (c === 'D') return 'damaged';
  return '—';
}
function condTone(c?: string): { bg: string; fg: string } {
  if (c === 'G') return { bg: 'var(--jade-soft)',    fg: 'var(--jade-deep)' };
  if (c === 'F') return { bg: 'var(--saffron-soft)', fg: 'var(--saffron-deep)' };
  if (c === 'D') return { bg: 'var(--brick-soft)',   fg: 'var(--brick)' };
  return                   { bg: 'var(--mist)',         fg: 'var(--ink-2)' };
}

function MoveInAction({ resolved }: { resolved: Resolved }) {
  const c = resolved.contract;
  const [insp, setInsp] = useState<MoveInInspectionData | null>(null);
  const [loadingInsp, setLoadingInsp] = useState(true);
  const [inspErr, setInspErr] = useState<string | null>(null);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [signBusy, setSignBusy] = useState(false);
  const [signErr, setSignErr] = useState<string | null>(null);

  useEffect(() => {
    if (!c?.id) return;
    const controller = new AbortController();
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingInsp(true);
    setInspErr(null);
    apiGet<MoveInInspectionData>(`/contracts/tenant/${c.id}/inspection?type=move_in`, { signal: controller.signal })
      .then(d => { if (!controller.signal.aborted) setInsp(d); })
      .catch(e => { if (!controller.signal.aborted) setInspErr(e instanceof Error ? e.message : 'Failed to load inspection'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingInsp(false); });
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => controller.abort();
  }, [c?.id]);

  async function signInspection() {
    if (!c?.id) return;
    if (!sigDataUrl) { setSignErr('Please draw your signature.'); return; }
    setSignBusy(true); setSignErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${c.id}/inspection/sign?type=move_in`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureImage: sigDataUrl }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      // Re-fetch so the now-saved signature appears + the journey advances
      const refreshed = await apiGet<MoveInInspectionData>(`/contracts/tenant/${c.id}/inspection?type=move_in`);
      setInsp(refreshed);
    } catch (e) {
      setSignErr(e instanceof Error ? e.message : 'Failed to sign');
    } finally {
      setSignBusy(false);
    }
  }

  if (!c) return <ErrorBox msg="Contract not found." />;

  // Phase 6 — the RP must submit the inspection before the customer can
  // counter-sign. Earlier rendering jumped straight to the signature canvas
  // even when no inspection had been generated; show an explicit waiting
  // card instead so the customer understands what's blocking them.
  const inspectionReady = !!c.moveInInspection?.submitted || (!!insp && (insp.areas?.length ?? 0) > 0);
  if (!loadingInsp && !inspectionReady) {
    return (
      <div style={{ background: 'var(--saffron-soft)', border: '1px solid #f0d68f', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Clock size={18} style={{ color: 'var(--saffron-deep)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ display: 'grid', gap: 4 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Inspection not ready yet</p>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
            Your rental provider is preparing the move-in inspection report. Once they submit it, the report and a counter-signature panel will unlock here.
          </p>
        </div>
      </div>
    );
  }

  const inspectionUrl = `/dashboard/customer/contracts/${c.id}/inspection?type=move_in`;
  const submittedAt = insp?.reportGeneratedDate ?? insp?.inspectionDate ?? c.moveInInspection?.signedAt ?? null;
  const submittedLabel = submittedAt
    ? `Submitted ${new Date(submittedAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', timeZone: APP_TIME_ZONE })}`
    : 'Submitted by rental provider';
  const areas = insp?.areas ?? [];
  const photoCount = insp?.photos?.length ?? 0;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* "Review inspection report" pulsing button — TOP of the section */}
      <style>{`
        @keyframes inspectReviewPulse {
          0%, 100% { box-shadow: 0 4px 14px -6px rgba(46,159,130,0.45), 0 0 0 0 rgba(46,159,130,0.45); }
          50%      { box-shadow: 0 4px 14px -6px rgba(46,159,130,0.45), 0 0 0 10px rgba(46,159,130,0); }
        }
        .inspect-review-pulse { animation: inspectReviewPulse 1.8s ease-out infinite; }
      `}</style>
      <a href={inspectionUrl} target="_blank" rel="noopener noreferrer"
        className="inspect-review-pulse"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
          padding: '16px 20px', borderRadius: 14,
          background: 'var(--jade-soft)', border: '2px solid var(--jade)',
          textDecoration: 'none', color: 'var(--ink)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--jade)', color: 'var(--paper)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <FileText size={18} />
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 10, color: 'var(--jade-deep)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>Step 1 — review</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '2px 0 0' }}>View full inspection report (photos &amp; details)</p>
          </div>
        </div>
        <ExternalLink size={16} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
      </a>

      {/* Inspection summary card — live data */}
      <div style={{ padding: 16, borderRadius: 14, background: 'var(--paper)', border: '1px solid var(--mist-strong)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>
            Inspection report
          </p>
          <span style={{ background: 'var(--saffron-soft)', color: 'var(--saffron-deep)', padding: '4px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>
            {submittedLabel}
          </span>
        </div>

        {/* Meta line — inspector / move-in date */}
        {(insp?.inspectorName || insp?.moveInDate) && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, paddingBottom: 10, borderBottom: '1px dashed var(--mist)' }}>
            {insp?.inspectorName && (
              <div>
                <p style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>Inspector</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '2px 0 0' }}>{insp.inspectorName}</p>
              </div>
            )}
            {insp?.moveInDate && (
              <div>
                <p style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>Move-in date</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '2px 0 0' }}>
                  {new Date(insp.moveInDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Per-area condition rows — live */}
        {loadingInsp ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--mute)' }} />
            <span style={{ fontSize: 12, color: 'var(--mute)' }}>Loading inspection report…</span>
          </div>
        ) : inspErr ? (
          <ErrorBox msg={`Couldn't load inspection: ${inspErr}`} />
        ) : areas.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--mute)', margin: '8px 0', fontStyle: 'italic' }}>
            No inspection areas recorded yet. The full report opens in the inspection view.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {areas.map(a => {
              // Pick the "worst" item condition as the row's overall — damaged > fair > good
              const itemConds = a.items?.map(i => i.inCondition).filter(Boolean) ?? [];
              const worst = itemConds.includes('D') ? 'D' : itemConds.includes('F') ? 'F' : itemConds.includes('G') ? 'G' : '';
              const tone = condTone(worst);
              const itemNames = a.items?.map(i => i.name).filter(Boolean).slice(0, 4).join(' · ') || '—';
              return (
                <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--mist)' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{a.name}</p>
                    <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>{itemNames}</p>
                  </div>
                  <span style={{
                    background: tone.bg, color: tone.fg,
                    padding: '4px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    alignSelf: 'center', whiteSpace: 'nowrap',
                  }}>{condLabel(worst)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer meta — photos + general notes */}
        {(photoCount > 0 || insp?.generalNotes) && (
          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface)', borderRadius: 10, display: 'grid', gap: 8 }}>
            {photoCount > 0 && (
              <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0 }}>
                <strong style={{ color: 'var(--ink)' }}>{photoCount}</strong> photo{photoCount === 1 ? '' : 's'} attached — view in the full inspection.
              </p>
            )}
            {insp?.generalNotes && (
              <div>
                <p style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>Rental provider notes</p>
                <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{insp.generalNotes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Counter-signature card — REAL signing happens here OR on the inspection page */}
      <div style={{ padding: 16, borderRadius: 14, background: 'var(--paper)', border: '1px solid var(--mist-strong)' }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: '0 0 10px' }}>Your counter-signature</p>

        {insp?.tenantSig ? (
          /* Already signed — show the captured signature image */
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{
              border: '1px solid var(--mist-strong)', borderRadius: 10, padding: 12,
              background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={insp.tenantSig} alt="Your signature"
                style={{ maxHeight: 80, maxWidth: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--jade-deep)', fontWeight: 600 }}>
              <CheckCircle2 size={14} />
              Signed {insp.tenantSignedAt ? fmtDateLong(insp.tenantSignedAt) : ''}
            </div>
          </div>
        ) : (
          /* Not signed yet — show the canvas + Sign button so customer can sign without leaving this page */
          <div style={{ display: 'grid', gap: 10 }}>
            <SignatureCanvas onChange={setSigDataUrl} />
            {signErr && <ErrorBox msg={signErr} />}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <PrimaryBtn onClick={signInspection} disabled={signBusy || !sigDataUrl}>
                {signBusy ? <Loader2 size={16} className="animate-spin" /> : <Pen size={16} />}
                {signBusy ? 'Signing…' : 'Counter-sign inspection'}
              </PrimaryBtn>
              <SecondaryBtn href={inspectionUrl}>
                Sign in full view <ExternalLink size={14} />
              </SecondaryBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}




/* ─── CHEQUES REVIEW WAIT ───────────────────────────────────────────── */
function ChequesReviewWaitAction({ resolved }: { resolved: Resolved }) {
  const viewing = resolved.viewing;
  const [cheques, setCheques] = useState<CustomerCheque[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!viewing) return;
    fetch(`/api/leads/my-viewings/${viewing.id}/cheque-uploads`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: CustomerCheque[]) => setCheques(data))
      .finally(() => setLoading(false));
  }, [viewing]);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: 'var(--jade-soft)', border: '1px solid var(--jade)', borderRadius: 14, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Clock size={18} style={{ color: 'var(--jade-deep)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--jade-deep)', margin: '0 0 4px' }}>Payments submitted — rental provider is reviewing</p>
          <p style={{ fontSize: 13, color: 'var(--jade-deep)', margin: 0, lineHeight: 1.5 }}>
            Your rental provider will verify each payment and confirm receipt. This usually takes 1 business day.
          </p>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', gap: 8, color: 'var(--mute)', fontSize: 13, alignItems: 'center' }}>
          <Loader2 size={14} className="animate-spin" /> Loading your cheques…
        </div>
      ) : cheques.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your uploaded cheques</p>
          {cheques.map((c, i) => (
            <div key={c.id} style={{ border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '10px 14px', background: 'var(--paper)', display: 'flex', gap: 12, alignItems: 'center' }}>
              {c.imageUrl && (
                <button type="button" onClick={() => openDocViewer({ fileUrl: c.imageUrl, caption: c.notes || `Cheque ${i + 1}` })} style={{ flexShrink: 0, lineHeight: 0, display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
                  {c.imageUrl.split('?')[0].toLowerCase().endsWith('.pdf') ? (
                    <span style={{ width: 56, height: 36, borderRadius: 6, background: 'var(--mist)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--jade-deep)' }}>
                      <FileText size={18} />
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="cheque" style={{ width: 56, height: 36, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                  )}
                </button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{c.notes || `Cheque ${i + 1}`}</p>
                {c.bankName && <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0' }}>{c.bankName}{c.amountFils ? ` · AED ${(c.amountFils / 100).toLocaleString('en-AE')}` : ''}</p>}
              </div>
              <span style={{ fontSize: 11, background: 'var(--jade-soft)', color: 'var(--jade-deep)', borderRadius: 6, padding: '3px 8px', fontWeight: 600 }}>Submitted</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── ACTIVE ───────────────────────────────────────────────────────── */
const DOC_LABELS: Record<string, string> = {
  emirates_id: 'Emirates ID', passport: 'Passport', uae_visa: 'UAE Visa / Residency',
  employment_letter: 'Employment Letter', bank_statement: 'Bank Statement',
  salary_certificate: 'Salary Certificate', trade_license: 'Trade License',
  moa: 'MOM / MOA', tax_registration: 'Tax Registration',
  utility_proof_of_payment: 'Utility Proof', ejari: 'Ejari Certificate',
  profile_picture: 'Profile Picture',
};

function ActiveAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const c = resolved.contract ?? resolved.renewalContract;
  const pathname = usePathname(); // current space URL — passed as the inspection "back" target
  const [section, setSection] = useState<'payments' | 'documents'>('payments');
  const [showTerm, setShowTerm] = useState(false);
  const tenantDocs = resolved.myDocs;

  if (!c) return null;

  // Wind-down: the lease is ending — either a termination was accepted (still
  // ACTIVE until the effective date, docs/CONTRACT_LIFECYCLE.md §4.3) or you
  // declined the renewal to vacate (move-out at the scheduled lease end). In
  // either case show move-out info + settlement instead of the renew/terminate CTAs.
  const term = c.termination;
  const winding = (term?.response === 'accepted' && c.status === 'active') || !!c.vacateAtEnd;

  // Deposit settlement (shown once the RP shares it during wind-down).
  const [settlement, setSettlement] = useState<ApiSettlement | null>(null);
  const cId = c.id;
  const loadSettlement = useCallback(async () => {
    if (!winding || !cId) { setSettlement(null); return; }
    try {
      const r = await fetch(`/api/contracts/tenant/${cId}/settlement`, { credentials: 'include' });
      setSettlement(r.ok ? ((await r.json()) as ApiSettlement | null) : null);
    } catch { setSettlement(null); }
  }, [winding, cId]);
  useEffect(() => { void loadSettlement(); }, [loadSettlement]);

  const u = resolved.unit;
  const pp = resolved.paymentPlan;
  const fmtD = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE }) : '—';
  const aed = (fils: number) => `AED ${(fils / 100).toLocaleString('en-AE')}`;

  const building = u?.property?.buildingName ?? '—';
  const unitNum  = u?.unitNumber ?? null;
  const unitName = u?.unitName ?? null;
  const community = u?.property?.community?.name ?? '';
  const emirate   = u?.property?.emirate?.name ?? '';
  const location  = [community, emirate].filter(Boolean).join(', ') || '—';
  const rp = u?.property?.rentalProvider ?? u?.property?.rental_provider;
  const landlordName = rp?.user?.name?.trim() || rp?.companyName?.trim() || 'Your rental provider';
  const tenantName   = ''; // not on Resolved; omit rather than guess

  const today = new Date();
  const effDate = term?.effectiveDate ? new Date(term.effectiveDate + 'T00:00:00') : null;
  const daysLeft = effDate ? Math.ceil((effDate.getTime() - today.getTime()) / 86400000) : null;
  // Prefer the contract's REAL cheques (the source of truth once the tenancy is
  // active) and only fall back to the payment-plan preview while the contract has
  // no payment rows yet. Normalised to {description, amountFils, dueDate, status}
  // so the renderer below works for either source. (c.payments.amountPaid is whole
  // AED → ×100 to fils; pp items are already fils.)
  const realCheques = (c.payments ?? [])
    .filter(p => p.paymentType !== 'security_deposit')
    .map(p => ({
      description: p.description ?? (p.paymentType === 'rental_income' ? 'Rent cheque' : (p.paymentType ?? 'Payment').replace(/_/g, ' ')),
      amountFils: Math.round((p.amountPaid ?? 0) * 100),
      dueDate: p.transactionDate ? p.transactionDate.slice(0, 10) : null,
      status: p.chequeStatus ?? null,
    }))
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const planCheques = (pp?.items ?? [])
    .filter(it => it.type !== 'security_deposit')
    .map(it => ({ description: it.description ?? null, amountFils: it.amountFils ?? 0, dueDate: it.dueDate ?? null, status: null as string | null }));
  const chequeItems = realCheques.length ? realCheques : planCheques;
  const chequesTotalFils = chequeItems.reduce((s, it) => s + it.amountFils, 0);
  const nextCheque = chequeItems.find(it => it.dueDate && new Date(it.dueDate + 'T00:00:00') >= today);

  const sections = [
    { k: 'payments'  as const, label: 'Payments',  sub: chequeItems.length ? `${chequeItems.length} cheques · ${aed(chequesTotalFils)}` : 'No schedule yet' },
    { k: 'documents' as const, label: 'Documents', sub: tenantDocs ? `${tenantDocs.filter(d => d.documentKey !== 'profile_picture').length} docs on file` : 'KYC + Ejari + utility' },
  ];

  return (
    <div style={{ display: 'grid', gap: 18 }}>

      {/* ── Action required: review + sign the move-out inspection (top, prominent) ── */}
      {winding && c.moveOutInspection?.submitted && !c.moveOutInspection?.signedByTenant && (
        <div style={{
          background: 'var(--brick-soft)', border: '1.5px solid var(--brick)', borderRadius: 16,
          padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          boxShadow: '0 14px 36px -22px rgba(176,58,46,0.5)',
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--brick)', marginBottom: 7 }}>
              <AlertCircle size={12} /> Action required
            </span>
            <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-0.01em' }}>Review &amp; sign your move-out inspection</p>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '4px 0 0', lineHeight: 1.45 }}>
              Your rental provider recorded the unit&apos;s move-out condition. Check it against move-in, then sign to confirm.
            </p>
          </div>
          <Link href={`/dashboard/customer/contracts/${c.id}/inspection?type=move_out&from=${encodeURIComponent(pathname)}`} style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '13px 22px', borderRadius: 12, fontSize: 14.5, fontWeight: 700,
            background: 'var(--brick)', color: 'var(--paper)', textDecoration: 'none',
          }}>
            <ClipboardCheck size={17} /> Review &amp; sign
          </Link>
        </div>
      )}

      {/* ── Wind-down panel (termination accepted, lease ending) — sits right under the action button ── */}
      {winding && (
        <div style={{ background: 'var(--brick-soft)', border: '1px solid var(--brick)', borderRadius: 14, padding: '18px 20px', display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <X size={16} color="var(--brick)" />
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--brick)', margin: 0 }}>Move-out scheduled</p>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.55 }}>
            {term?.requestedByRole === 'tenant'
              ? 'Your termination request was accepted.'
              : 'Your rental provider scheduled an early end to this tenancy.'}{' '}
            Your lease stays active until <strong>{fmtD(term?.effectiveDate)}</strong>
            {daysLeft != null && daysLeft >= 0 ? ` — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}.
          </p>
          {term?.reason && (
            <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0 }}>Reason: {term.reason}</p>
          )}
          {settlement && (
            <SettlementCard contractId={c.id} settlement={settlement} onAgreed={loadSettlement} />
          )}
        </div>
      )}

      {/* ── Tenancy Pass (boarding-pass card) ── */}
      <div style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1.6fr 24px 1fr',
        background: 'var(--paper)',
        borderRadius: 22,
        border: '1px solid var(--mist-strong)',
        boxShadow: '0 1px 0 var(--mist-strong), 0 24px 60px -32px rgba(31,90,63,0.18)',
        overflow: 'hidden',
      }}>
        {/* LEFT: identity */}
        <div style={{ padding: '24px 28px', display: 'grid', gap: 14, gridTemplateRows: 'auto 1fr auto' }}>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontFamily: 'monospace', fontSize: 10, fontWeight: 600, color: 'var(--jade-deep)',
                textTransform: 'uppercase', letterSpacing: '0.15em',
                padding: '3px 7px', border: '1px solid var(--jade)', borderRadius: 4,
              }}>TENANCY PASS</span>
              {c.ref && (
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--mute)', letterSpacing: '0.08em' }}>
                  {c.ref}
                </span>
              )}
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 999,
              background: winding ? 'var(--brick)' : 'var(--jade-deep)', color: 'var(--paper)',
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {winding ? <><X size={10} /> Move-out scheduled</> : <><Sparkles size={10} /> Active tenancy</>}
            </span>
          </div>

          {/* Building + unit */}
          <div>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Your place</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: '5px 0 2px', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{building}</p>
            {(unitNum || unitName) && (
              <p style={{ fontSize: 30, fontWeight: 700, color: 'var(--jade-deep)', margin: '0 0 10px', letterSpacing: '-0.025em', lineHeight: 1 }}>
                {unitName ?? `Unit ${unitNum}`}
              </p>
            )}
            <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
              <MapPin size={12} /> {location}
            </p>
          </div>

          {/* People row */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {tenantName && <PassField label="Tenant"   value={tenantName} />}
            <PassField label="Landlord" value={landlordName} />
            {u?.unitType && <PassField label={u.unitType.replace(/_/g, ' ')} value={u.bedrooms ? `${u.bedrooms} BR` : '—'} mono />}
          </div>
        </div>

        {/* PERFORATION */}
        <div style={{
          position: 'relative', display: 'grid', placeItems: 'center',
          borderLeft: '1px dashed var(--mist-strong)', borderRight: '1px dashed var(--mist-strong)',
        }}>
          <div style={{ position: 'absolute', top: -12,    left: '50%', transform: 'translateX(-50%)', width: 24, height: 24, background: 'var(--surface)', borderRadius: '50%', border: '1px solid var(--mist-strong)' }} />
          <div style={{ position: 'absolute', bottom: -12, left: '50%', transform: 'translateX(-50%)', width: 24, height: 24, background: 'var(--surface)', borderRadius: '50%', border: '1px solid var(--mist-strong)' }} />
        </div>

        {/* RIGHT: stub */}
        <div style={{ padding: '24px 22px', background: '#f4efe8', display: 'grid', gap: 14, gridAutoRows: 'min-content' }}>
          {/* Period */}
          <div>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>Period</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '4px 0 0', letterSpacing: '-0.015em' }}>{fmtD(c.startDate)}</p>
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--mute)', margin: '2px 0' }}>↓ 12 months</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-0.015em' }}>{fmtD(c.endDate)}</p>
          </div>

          {/* Annual rent */}
          <div style={{ borderTop: '1px dashed var(--mist-strong)', paddingTop: 12 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>Annual rent</p>
            <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--jade-deep)', margin: '4px 0 0', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {pp ? aed(pp.rentFils) : c.annualRent ? `AED ${c.annualRent.toLocaleString('en-AE')}` : '—'}
            </p>
          </div>

          {/* Next cheque */}
          {nextCheque && (
            <div style={{ borderTop: '1px dashed var(--mist-strong)', paddingTop: 12 }}>
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>Next cheque</p>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: '4px 0 0' }}>
                {fmtD(nextCheque.dueDate)} · {aed(nextCheque.amountFils)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Section selector slabs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {sections.map(s => {
          const active = s.k === section;
          return (
            <button key={s.k} onClick={() => setSection(s.k)} style={{
              background: active ? 'var(--jade-deep)' : 'var(--paper)',
              color: active ? 'var(--paper)' : 'var(--ink)',
              border: `1.5px solid ${active ? 'var(--jade-deep)' : 'var(--mist-strong)'}`,
              borderRadius: 14, padding: '14px 16px',
              cursor: 'pointer', textAlign: 'left',
              display: 'grid', gap: 5, fontFamily: 'inherit',
              boxShadow: active ? '0 8px 24px -10px rgba(31,90,63,0.4)' : 'none',
              transition: 'all 180ms ease',
            }}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>{s.label}</p>
              <p style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.7)' : 'var(--mute)', margin: 0 }}>{s.sub}</p>
            </button>
          );
        })}
      </div>

      {/* ── Payments section ── */}
      {section === 'payments' && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 18px', borderBottom: '1px solid var(--mist)',
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-0.015em' }}>Payment runway</p>
              {chequeItems.length > 0 && (
                <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0' }}>{chequeItems.length} instalments through the year</p>
              )}
            </div>
            {(pp || chequeItems.length > 0) && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>{pp ? 'Contract value' : 'Total cheques'}</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--jade-deep)', margin: '2px 0 0', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                  {pp ? aed(pp.totalAmountFils) : aed(chequesTotalFils)}
                </p>
              </div>
            )}
          </div>
          <div style={{ padding: 14, display: 'grid', gap: 8 }}>
            {chequeItems.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--mute)', textAlign: 'center', padding: '12px 0', margin: 0 }}>No payment schedule available</p>
            )}
            {chequeItems.map((it, i) => {
              const isPast = it.dueDate ? new Date(it.dueDate + 'T00:00:00') < today : false;
              const bounced = it.status === 'bounced' || it.status === 'cancelled';
              const cleared = it.status ? it.status === 'cleared' : isPast;
              const badgeTxt = it.status ?? (isPast ? 'cleared' : 'upcoming');
              return (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '36px 1fr auto auto', gap: 12, alignItems: 'center',
                  padding: '10px 14px', background: '#f4efe8', border: '1px solid var(--mist)', borderRadius: 12,
                }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 8, background: 'var(--paper)',
                    border: '1px solid var(--mist-strong)', display: 'grid', placeItems: 'center',
                    fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums',
                  }}>{i + 1}</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{it.description ?? `Cheque ${i + 1}`}</p>
                    {it.dueDate && <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>{fmtD(it.dueDate)}</p>}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{aed(it.amountFils)}</span>
                  <span style={{
                    padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 600, textTransform: 'capitalize',
                    background: bounced ? 'var(--brick-soft)' : cleared ? 'var(--jade-soft)' : 'var(--saffron-soft)',
                    color: bounced ? 'var(--brick)' : cleared ? 'var(--jade-deep)' : 'var(--saffron-deep)',
                  }}>{badgeTxt}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Documents section ── */}
      {section === 'documents' && (
        <div style={{ display: 'grid', gap: 12 }}>

          {/* Your documents — fetched from /api/documents/my.
              Status display intentionally suppressed once the tenancy is
              active — the customer has already finished the verification
              loop, so the per-doc "Approved / Rejected / In review" pills
              and the X/Y counter only add noise on this view. */}
          <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: 18 }}>
            {(() => {
              const visible = (tenantDocs ?? []).filter(d => d.documentKey !== 'profile_picture');
              return (
                <>
                  <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 14px', letterSpacing: '-0.015em' }}>Your documents</p>
                  {visible.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0 }}>No documents uploaded yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      {visible.map((d, i) => {
                        const label = d.displayName || DOC_LABELS[d.documentKey] || d.documentKey.replace(/_/g, ' ');
                        const inner = (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <FileText size={14} color="var(--jade-deep)" />
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                          </div>
                        );
                        const tileStyle: React.CSSProperties = {
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                          padding: '10px 12px', background: '#f4efe8', border: '1px solid var(--mist)',
                          borderRadius: 12, textDecoration: 'none', cursor: d.fileUrl ? 'pointer' : 'default',
                          fontFamily: 'inherit',
                        };
                        return d.fileUrl
                          ? <button key={i} type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: label })} style={{ ...tileStyle, textAlign: 'left', width: '100%' }}>{inner}</button>
                          : <div key={i} style={tileStyle}>{inner}</div>;
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Contract documents */}
          <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: 18 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 12px', letterSpacing: '-0.015em' }}>Contract documents</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { label: 'Signed tenancy contract',   href: `/dashboard/customer/contracts/${c.id}/print`, newTab: false },
                { label: 'Move-in inspection report', href: `/dashboard/customer/contracts/${c.id}/inspection?type=move_in`, newTab: false },
                // Two payment receipts, attached by default once the contract is live.
                { label: 'Contract payment receipt',  href: `/dashboard/customer/contracts/${c.id}/print/receipt?kind=contract`, newTab: true },
                { label: 'Security deposit receipt',  href: `/dashboard/customer/contracts/${c.id}/print/receipt?kind=deposit`, newTab: true },
              ].map((d, i) => (
                <Link key={i} href={d.href} target={d.newTab ? '_blank' : undefined} rel={d.newTab ? 'noopener noreferrer' : undefined} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '11px 14px', background: '#f4efe8', border: '1px solid var(--mist)',
                  borderRadius: 12, textDecoration: 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileText size={16} color="var(--jade-deep)" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{d.label}</span>
                  </div>
                  <ArrowRight size={14} color="var(--ink-2)" />
                </Link>
              ))}
            </div>
          </div>

          {/* "Manage & upload documents" link removed on the active-tenancy
              Documents tab — the customer has finished onboarding by this
              point and shouldn't be nudged back into the upload flow here.
              Uploads still happen during the pre-contract steps and from the
              customer's own profile page. */}
        </div>
      )}

      {/* ── Lease toolbox strip ── */}
      <div style={{
        background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14,
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={16} color="var(--jade-deep)" />
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Lease toolbox</p>
            {c.ref && <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>{c.ref}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href={`/dashboard/customer/contracts/${c.id}/print`} target="_blank" rel="noopener noreferrer" style={{
            padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--mist-strong)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none',
          }}>
            <FileText size={12} /> Preview Tenancy Contract
          </Link>
          {!winding && (
            <button onClick={() => setShowTerm(true)} style={{
              padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              background: 'var(--brick-soft)', color: 'var(--brick)', border: '1px solid var(--brick)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
            }}>
              <X size={12} /> Request Termination
            </button>
          )}
        </div>
      </div>

      {showTerm && <TerminationRequestModal contract={c} onClose={() => setShowTerm(false)} onSuccess={() => { setShowTerm(false); onRefresh(); }} />}
    </div>
  );
}

function PassField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0, fontWeight: 600 }}>{label}</p>
      <p style={{ fontFamily: mono ? 'monospace' : 'inherit', fontSize: 13, color: 'var(--ink)', margin: '4px 0 0', fontWeight: 600 }}>{value}</p>
    </div>
  );
}

function SettlementCard({ contractId, settlement, onAgreed }: { contractId: number; settlement: ApiSettlement; onAgreed: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const aedF = (n: number) => 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 2 }).format(n);
  const fmtDT = (d: string | null) => d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const sumLines = (settlement.lines ?? []).reduce((a, l) => a + Number(l.amount || 0), 0);
  const paid = Number(settlement.paymentsReceivedTotal ?? 0);
  // Final position after deposit, charges AND any money you've paid back are netted.
  // > 0 refund due to you, < 0 you still owe, 0 settled in full.
  const balance = settlement.balance != null
    ? settlement.balance
    : Math.round((settlement.depositHeld - sumLines + paid) * 100) / 100;

  async function agree() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${contractId}/settlement/agree`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      await onAgreed();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '14px 16px', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Deposit settlement</p>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
          padding: '3px 8px', borderRadius: 999,
          background: settlement.status === 'paid' ? 'var(--jade-deep)' : settlement.status === 'agreed' ? '#eef7f3' : 'var(--saffron-soft)',
          color: settlement.status === 'paid' ? 'var(--paper)' : settlement.status === 'agreed' ? 'var(--jade-deep)' : '#9a3412',
        }}>
          {settlement.status === 'paid' ? 'Refund paid' : settlement.status === 'agreed' ? 'You agreed' : 'Review required'}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--ink-2)' }}>Deposit held</span>
          <span style={{ fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{aedF(settlement.depositHeld)}</span>
        </div>
        {/* Customer view: deductions are consolidated into a single
            "Maintenance charges" line (the itemised breakdown stays RP-side). */}
        {sumLines > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--mute)' }}>− Maintenance charges</span>
            <span style={{ fontWeight: 600, color: '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>− {aedF(sumLines)}</span>
          </div>
        )}
        {paid > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--mute)' }}>+ Payments you made</span>
            <span style={{ fontWeight: 600, color: 'var(--jade-deep)', fontVariantNumeric: 'tabular-nums' }}>+ {aedF(paid)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--mist-strong)', paddingTop: 8, marginTop: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
            {balance > 0 ? 'Net refund to you' : balance < 0 ? 'You still owe' : 'Settled in full'}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: balance < 0 ? '#b91c1c' : 'var(--jade-deep)', fontVariantNumeric: 'tabular-nums' }}>{aedF(Math.abs(balance))}</span>
        </div>
      </div>

      {settlement.notes && <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0, lineHeight: 1.45 }}>{settlement.notes}</p>}

      {settlement.status === 'sent' && (
        <>
          {err && <p style={{ fontSize: 12, color: '#b91c1c', margin: 0 }}>{err}</p>}
          <button onClick={agree} disabled={busy} style={{
            padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none',
            background: 'var(--jade-deep)', color: 'var(--paper)', cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1, fontFamily: 'inherit',
          }}>
            {busy ? 'Submitting…' : 'Agree to settlement'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--mute)', margin: 0 }}>
            By agreeing you accept the charges above.{balance > 0 ? ' Your refund will be processed afterwards.' : balance < 0 ? ' Please settle the balance with your landlord.' : ''}
          </p>
        </>
      )}
      {settlement.status === 'agreed' && (
        <p style={{ fontSize: 12, color: 'var(--jade-deep)', margin: 0, fontWeight: 600 }}>
          You agreed{settlement.agreedAt ? ` on ${fmtDT(settlement.agreedAt)}` : ''}{balance < 0 ? ' — please settle the balance with your landlord.' : ' — your refund is being processed.'}
        </p>
      )}
      {settlement.status === 'paid' && (
        <p style={{ fontSize: 12, color: 'var(--jade-deep)', margin: 0, fontWeight: 600 }}>{balance > 0 ? 'Refund processed' : 'Settlement completed'}{settlement.paidAt ? ` on ${fmtDT(settlement.paidAt)}` : ''}.</p>
      )}
    </div>
  );
}

function TerminationRequestModal({ contract, onClose, onSuccess }: { contract: ApiContract; onClose: () => void; onSuccess: () => void }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  async function submit() {
    if (!reason.trim()) { setErr('Please provide a reason.'); return; }
    if (!date) { setErr('Please pick an effective date.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${contract.id}/termination/request`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim(), effectiveDate: date }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onSuccess();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  return (
    <Modal title="Request early termination" onClose={onClose} footer={
      <>
        <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={submit} disabled={busy} danger>{busy ? 'Sending…' : 'Send request'}</PrimaryBtn>
      </>
    }>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 0 }}>Your rental provider must accept the request before the contract terminates. Until then, your lease stays active.</p>
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Effective date</label>
          <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Reason</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Why are you ending the contract early?"
            style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
        </div>
        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  );
}

function TerminationSentAction({ resolved }: { resolved: Resolved }) {
  const t = resolved.contract?.termination;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: 'var(--saffron-soft)', border: '1px solid #f0d68f', borderRadius: 14, padding: '16px 18px' }}>
        <p style={{ fontSize: 10, color: 'var(--saffron-deep)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, fontWeight: 700 }}>Your request</p>
        <p style={{ fontSize: 14, color: 'var(--ink)', margin: '6px 0 2px', fontWeight: 600 }}>Effective {t?.effectiveDate ? fmtDateLong(t.effectiveDate) : '—'}</p>
        {t?.reason && <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{t.reason}</p>}
      </div>
      <WaitingBadge />
    </div>
  );
}

function TerminationReceivedAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const c = resolved.contract;
  const t = c?.termination;
  const [busy, setBusy] = useState<'accepted' | 'rejected' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function respond(response: 'accepted' | 'rejected') {
    if (!c) return;
    setBusy(response); setErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${c.id}/termination/respond`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: 'var(--brick-soft)', border: '1px solid var(--brick)', borderRadius: 14, padding: '16px 18px' }}>
        <p style={{ fontSize: 10, color: 'var(--brick)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, fontWeight: 700 }}>Rental provider&rsquo;s request</p>
        <p style={{ fontSize: 14, color: 'var(--ink)', margin: '6px 0 2px', fontWeight: 600 }}>Effective {t?.effectiveDate ? fmtDateLong(t.effectiveDate) : '—'}</p>
        {t?.reason && <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{t.reason}</p>}
      </div>
      {err && <ErrorBox msg={err} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <PrimaryBtn onClick={() => respond('accepted')} disabled={!!busy}>
          {busy === 'accepted' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy === 'accepted' ? 'Accepting…' : 'Accept termination'}
        </PrimaryBtn>
        <SecondaryBtn onClick={() => respond('rejected')}>
          {busy === 'rejected' ? 'Rejecting…' : 'Reject'}
        </SecondaryBtn>
      </div>
    </div>
  );
}

/* ─── RENEWAL ──────────────────────────────────────────────────────── */
function RenewalOfferedAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const parent = resolved.contract;
  const child = resolved.renewalContract;
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Phase 6 — payment-readiness checkbox replaces the dedicated cheques
  // step. The customer can't accept the renewal until they tick this; their
  // confirmation is captured alongside the accept call below.
  const [paymentReady, setPaymentReady] = useState(false);
  // Phase 6c — reject confirm modal. Reject no longer fires on a single tap;
  // we open this panel, capture an optional reason, then PATCH. The reason
  // is persisted on the parent contract so the RP sees it when deciding
  // whether to re-propose with updated terms.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // Decline intent: negotiate (open to a new offer, lease keeps running) vs
  // vacate (leaving at lease end → move-out inspection + deposit settlement).
  const [rejectIntent, setRejectIntent] = useState<'negotiate' | 'vacate'>('negotiate');

  // Phase 6 — same "Attach payment references" experience as the new-lease
  // payment_review step. The customer drops in cheque photos, transfer
  // screenshots, card slips, or cash receipts so the RP can verify them
  // before collection. Uploads attach to the renewal CHILD contract via
  // ownerType=tenancy_contract; no lead exists at this stage so we can't
  // reuse the lead-cheque-uploads endpoint.
  type RenewalProof = { id: number; displayName?: string | null; fileUrl?: string | null; mimeType?: string | null; documentKey?: string };
  const [renewalProofs, setRenewalProofs] = useState<RenewalProof[]>([]);
  const [uploadingProofs, setUploadingProofs] = useState(0);
  const [proofErr, setProofErr] = useState<string | null>(null);
  const proofFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!child?.id) return;
    fetch(`/api/documents?ownerType=tenancy_contract&ownerId=${child.id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: RenewalProof[]) => {
        if (!Array.isArray(rows)) return;
        setRenewalProofs(rows.filter(d => d.documentKey === 'renewal_payment_proof'));
      })
      .catch(() => {});
  }, [child?.id]);

  async function uploadRenewalProof(file: File) {
    if (!child?.id) throw new Error('Renewal contract not ready');
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'tenancy_contract', ownerId: child.id,
        documentKey: 'renewal_payment_proof',
        originalName: file.name, mimeType: file.type,
      }),
    });
    if (!urlRes.ok) throw new Error('Failed to start upload');
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!putRes.ok) throw new Error('File upload failed');
    const regRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'tenancy_contract', ownerId: child.id,
        documentKey: 'renewal_payment_proof', category: 'payment',
        displayName: file.name, fileUrl, mimeType: file.type, s3Key: fileKey,
        isVisibleToTenant: true,
      }),
    });
    if (!regRes.ok) {
      const b = await regRes.json().catch(() => ({}));
      throw new Error(b?.message ?? 'Reference registration failed');
    }
    return (await regRes.json()) as RenewalProof;
  }

  async function handleRenewalProofFiles(files: FileList | null) {
    if (!files || files.length === 0 || !child?.id) return;
    setProofErr(null);
    setUploadingProofs(files.length);
    try {
      for (const file of Array.from(files)) {
        const saved = await uploadRenewalProof(file);
        setRenewalProofs(prev => [...prev, saved]);
      }
    } catch (e) {
      setProofErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingProofs(0);
      if (proofFileInputRef.current) proofFileInputRef.current.value = '';
    }
  }

  async function removeRenewalProof(docId: number) {
    const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) setRenewalProofs(prev => prev.filter(d => d.id !== docId));
  }

  if (!parent) return <ErrorBox msg="Parent contract not found." />;

  async function act(verb: 'accept' | 'reject') {
    if (verb === 'accept' && !paymentReady) {
      setErr('Please confirm your payments are ready to proceed.');
      return;
    }
    setBusy(verb); setErr(null);
    try {
      const init: RequestInit = { method: 'PATCH', credentials: 'include' };
      if (verb === 'reject') {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify({ reason: rejectReason.trim() || undefined, intent: rejectIntent });
      }
      const res = await fetch(`/api/contracts/${parent!.id}/renewal/${verb}`, init);
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      // Capture the payment-readiness ack on the child contract so the RP
      // sees the customer agreed at accept time. Best-effort — if it errors
      // (e.g. no child fetched yet) we don't block the user; the timeline
      // still routes them to the signature step.
      if (verb === 'accept' && child?.id) {
        await fetch(`/api/contracts/tenant/${child.id}/cheques-submitted`, { method: 'PATCH', credentials: 'include' }).catch(() => undefined);
      }
      if (verb === 'reject') {
        setRejectOpen(false);
        setRejectReason('');
        setRejectIntent('negotiate');
      }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  // ── Derive comparable figures ────────────────────────────────────────
  const currentRent = parent.annualRent ?? 0;
  const newRent = child?.annualRent ?? null;
  const rentDelta = newRent != null && currentRent ? newRent - currentRent : null;
  const rentDeltaPct = newRent != null && currentRent ? Math.round(((newRent - currentRent) / currentRent) * 1000) / 10 : null;

  const newCheques = child?.numberOfInstallments ?? null;
  const newContractValue = child?.contractValue ?? null;
  const securityDeposit = parent.securityDepositAmount ?? null;

  // Renewal payment schedule comes straight from the renewal contract's
  // Payment rows (built by proposeRenewal — first row bundles admin + ejari
  // + commission + rent installment 1). Mirrors the new-lease payment_review
  // step so the customer sees identical detail before they accept.
  const payments = (child?.payments ?? []).slice().sort((a, b) => {
    const ad = a.transactionDate ? new Date(a.transactionDate).getTime() : 0;
    const bd = b.transactionDate ? new Date(b.transactionDate).getTime() : 0;
    return ad - bd;
  });
  const totalScheduled = payments.reduce((s, p) => s + (p.amountPaid ?? 0), 0);

  const fmt = (v: number | null | undefined) => v != null ? fmtAed(v) : '—';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Contract preview — pinned to the top of the renewal card so the
          customer can read the full contract before any of the cost details.
          Same UX as the new-lease signature step's "Step 1 — review" card:
          pulsing jade ring, eyebrow label, filled icon — keeps the two
          flows visually consistent so customers learn the pattern once. */}
      {child?.id && (
        <>
          <style>{`
            @keyframes renewalReviewPulse {
              0%, 100% { box-shadow: 0 4px 14px -6px rgba(46,159,130,0.45), 0 0 0 0 rgba(46,159,130,0.45); }
              50%      { box-shadow: 0 4px 14px -6px rgba(46,159,130,0.45), 0 0 0 10px rgba(46,159,130,0); }
            }
            .renewal-review-pulse { animation: renewalReviewPulse 1.8s ease-out infinite; }
          `}</style>
          <a
            href={`/dashboard/customer/contracts/${child.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="renewal-preview-contract"
            className="renewal-review-pulse"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
              padding: '16px 20px', borderRadius: 14,
              background: 'var(--jade-soft)', border: '2px solid var(--jade)',
              textDecoration: 'none', color: 'var(--ink)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--jade)', color: 'var(--paper)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <FileText size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 10, color: 'var(--jade-deep)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>Step 1 — review</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '2px 0 0' }}>Preview your renewal contract before accepting</p>
              </div>
            </div>
            <ExternalLink size={16} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
          </a>
        </>
      )}

      {/* Headline rent comparison */}
      <div style={{
        background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14,
        padding: '18px 20px', display: 'grid', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>New annual rent</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', margin: '4px 0 0', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
              {fmt(newRent)}
            </p>
            {rentDelta != null && rentDelta !== 0 && (
              <p style={{
                fontSize: 12, fontWeight: 600, margin: '4px 0 0',
                color: rentDelta > 0 ? 'var(--brick)' : 'var(--jade-deep)',
              }}>
                {rentDelta > 0 ? '↑' : '↓'} {fmt(Math.abs(rentDelta))} ({rentDeltaPct! > 0 ? '+' : ''}{rentDeltaPct}%) vs current
              </p>
            )}
            {rentDelta === 0 && (
              <p style={{ fontSize: 12, color: 'var(--jade-deep)', fontWeight: 600, margin: '4px 0 0' }}>
                No change from current rent
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>Currently paying</p>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-2)', margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(currentRent)}
            </p>
          </div>
        </div>
      </div>

      {/* Key stats trio — matches the new-lease payment_review look */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Stat label="Total contract value" value={fmt(newContractValue ?? (newRent ?? 0))} accent />
        <Stat label="Installments" value={newCheques ? `${newCheques}` : '—'} />
        <Stat label="First payment" value={payments[0]?.transactionDate ? fmtDateShort(payments[0].transactionDate) : '—'} />
      </div>

      {/* Cost breakdown — same lines as PaymentPlanSummary */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', fontWeight: 600 }}>Cost breakdown</p>
        <div style={{ display: 'grid', gap: 6 }}>
          <PaymentRow label="Annual rent" amountFils={(newRent ?? 0) * 100} />
          {child?.adminFeeFils != null && child.adminFeeFils > 0 && (
            <PaymentRow label="Admin fee" amountFils={child.adminFeeFils * 100} />
          )}
          {child?.ejariFeeFils != null && child.ejariFeeFils > 0 && (
            <PaymentRow label="Ejari fee" amountFils={child.ejariFeeFils * 100} />
          )}
          {securityDeposit != null && securityDeposit > 0 && (
            <PaymentRow label="Security deposit (carries forward)" amountFils={securityDeposit * 100} />
          )}
          <div style={{ borderTop: '1px solid var(--mist-strong)', margin: '6px 0' }} />
          <PaymentRow label="Total scheduled" amountFils={totalScheduled * 100} bold />
        </div>
      </div>

      {/* Per-installment schedule — driven by the renewal contract's Payment rows */}
      {payments.length > 0 && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--mist-strong)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Payment schedule · {payments.length} payment{payments.length === 1 ? '' : 's'}
            </span>
            {newCheques && (
              <span style={{ fontSize: 10, color: 'var(--mute)', fontWeight: 500 }}>{newCheques} rent installments</span>
            )}
          </div>
          {payments.map((p, i) => {
            const isFirstBundle = i === 0 && (child?.adminFeeFils ?? 0) + (child?.ejariFeeFils ?? 0) > 0;
            const isDeposit = (p.paymentType ?? '').toLowerCase() === 'security_deposit';
            return (
              <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto auto', gap: 14, alignItems: 'center', padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--mist)', background: isFirstBundle ? 'var(--saffron-soft)' : undefined }}>
                <span style={{ fontSize: 12, color: 'var(--mute)', fontWeight: 600 }}>#{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{p.description ?? (isDeposit ? 'Security deposit' : `Payment ${i + 1}`)}</p>
                  <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>{p.transactionDate ? fmtDateLong(p.transactionDate) : 'No due date'}</p>
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(p.amountPaid)}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 999, background: isFirstBundle ? 'var(--saffron)' : isDeposit ? 'var(--mist)' : 'var(--surface)', color: isFirstBundle ? 'var(--saffron-deep)' : isDeposit ? 'var(--ink-2)' : 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {isFirstBundle ? 'Renewal start' : isDeposit ? 'Deposit' : 'Rent'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Attach payment references — mirrors the new-lease payment_review
          step. Optional, multi-file, in-page preview via the existing
          chequePreview lightbox. Hooked to the renewal child contract so
          the RP can verify each reference before collection. */}
      {child?.id && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
              Attach payment references (optional)
            </p>
            <span style={{ fontSize: 11, color: 'var(--mute)' }}>{renewalProofs.length} uploaded</span>
          </div>
          <label style={{
            marginTop: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--mist-strong)',
            background: 'var(--surface)', cursor: uploadingProofs ? 'progress' : 'pointer',
            fontSize: 13, fontWeight: 600, color: 'var(--jade-deep)',
          }}>
            <input
              ref={proofFileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              disabled={uploadingProofs > 0}
              onChange={(e) => handleRenewalProofFiles(e.target.files)}
              style={{ display: 'none' }}
              data-testid="renewal-proof-input"
            />
            {uploadingProofs > 0
              ? <><Loader2 size={14} className="animate-spin" /> Uploading {uploadingProofs} file{uploadingProofs === 1 ? '' : 's'}…</>
              : <><UploadCloud size={14} /> Choose files</>}
          </label>

          {proofErr && <div style={{ marginTop: 10 }}><ErrorBox msg={proofErr} /></div>}

          {renewalProofs.length > 0 && (
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {renewalProofs.map((d, i) => {
                const isPdf = (d.mimeType ?? '').includes('pdf') || (d.fileUrl ?? '').toLowerCase().split('?')[0].endsWith('.pdf');
                return (
                  <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--mist-strong)' }}>
                    {d.fileUrl && !isPdf ? (
                      <button type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? `Payment ${i + 1}`, mimeType: d.mimeType })} style={{ flexShrink: 0, lineHeight: 0, display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={d.fileUrl} alt={d.displayName ?? ''} style={{ width: 44, height: 30, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                      </button>
                    ) : d.fileUrl ? (
                      <span style={{ width: 44, height: 30, display: 'grid', placeItems: 'center', background: 'var(--mist)', borderRadius: 4, flexShrink: 0 }}>
                        <FileText size={14} color="var(--ink-2)" />
                      </span>
                    ) : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.displayName ?? `Payment ${i + 1}`}</p>
                    </div>
                    {d.fileUrl && (
                      <button
                        type="button"
                        onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? `Payment ${i + 1}`, mimeType: d.mimeType })}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--jade-deep)', fontSize: 11, fontWeight: 600, textDecoration: 'none', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                      >
                        <ExternalLink size={12} /> View
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRenewalProof(d.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                      aria-label="Remove payment reference"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Payment-readiness confirmation — replaces the standalone cheques
          step. The customer ticks this to confirm their payments are ready
          to be collected; the accept handler then advances them straight to
          the signature step. */}
      <label
        style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          background: paymentReady ? 'var(--jade-soft)' : 'var(--paper)',
          border: `1px solid ${paymentReady ? 'var(--jade)' : 'var(--mist-strong)'}`,
          borderRadius: 12, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s ease',
        }}
      >
        <input
          type="checkbox"
          checked={paymentReady}
          onChange={(e) => { setPaymentReady(e.target.checked); if (e.target.checked) setErr(null); }}
          data-testid="renewal-payment-ready"
          style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--jade-deep)', cursor: 'pointer' }}
        />
        <div style={{ minWidth: 0, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>I confirm my payments are ready to be collected</p>
          <p style={{ margin: '2px 0 0' }}>
            By ticking this, you agree the renewal payments listed above are prepared and your rental provider can collect them after you sign.
          </p>
        </div>
      </label>

      {err && <ErrorBox msg={err} />}

      {/* Accept / Reject actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
        <PrimaryBtn onClick={() => act('accept')} disabled={!!busy || !paymentReady}>
          {busy === 'accept' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy === 'accept' ? 'Accepting…' : 'Accept renewal terms'}
        </PrimaryBtn>
        <SecondaryBtn onClick={() => { setRejectOpen(true); setErr(null); }} data-testid="renewal-reject-open">
          Reject terms
        </SecondaryBtn>
      </div>

      {/* Reject confirm modal — asks for a reason so the RP knows what
          to adjust before re-proposing. Reason is optional but strongly
          encouraged in the copy. Closes on backdrop click + ESC-equivalent
          Cancel button; the PATCH only fires from the inner Reject button. */}
      {rejectOpen && (
        <div
          onClick={() => !busy && setRejectOpen(false)}
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(20, 18, 14, 0.55)',
            display: 'grid', placeItems: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--paper)', borderRadius: 16, maxWidth: 480, width: '100%',
              boxShadow: '0 16px 48px -8px rgba(20,18,14,0.35)', overflow: 'hidden',
              border: '1px solid var(--mist-strong)',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mist-strong)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Not renewing — what next?</p>
              <button
                type="button"
                onClick={() => !busy && setRejectOpen(false)}
                aria-label="Close"
                style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', padding: 4, lineHeight: 0 }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: '18px 20px', display: 'grid', gap: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
                You won’t be renewing on these terms. What would you like to do?
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {([
                  { v: 'negotiate' as const, t: 'These terms don’t work for me', s: `You’re open to a new offer — your provider can re-propose. Your lease keeps running until ${parent.endDate ? fmtDateLong(parent.endDate) : 'its end date'}.` },
                  { v: 'vacate' as const, t: 'I’ll be moving out', s: `End the tenancy at ${parent.endDate ? fmtDateLong(parent.endDate) : 'lease end'}. You’ll get a move-out inspection and your deposit settlement.` },
                ]).map(o => {
                  const on = rejectIntent === o.v;
                  return (
                    <button key={o.v} type="button" onClick={() => setRejectIntent(o.v)} style={{
                      textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                      border: `1.5px solid ${on ? 'var(--jade-deep)' : 'var(--mist-strong)'}`,
                      background: on ? '#eef7f3' : 'var(--surface)', fontFamily: 'inherit',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 15, height: 15, borderRadius: 999, border: `4px solid ${on ? 'var(--jade-deep)' : 'var(--mist-strong)'}`, background: 'var(--paper)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{o.t}</span>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--mute)', margin: '6px 0 0 23px', lineHeight: 1.45 }}>{o.s}</p>
                    </button>
                  );
                })}
              </div>
              <div>
                <label htmlFor="renewal-reject-reason" style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {rejectIntent === 'vacate' ? 'Note to your provider (optional)' : 'What would make it work? (optional but recommended)'}
                </label>
                <textarea
                  id="renewal-reject-reason"
                  data-testid="renewal-reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={4}
                  maxLength={600}
                  placeholder="e.g. The rent increase is too high, payment plan doesn’t suit me, or I need a longer term."
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    border: '1px solid var(--mist-strong)', fontSize: 13, fontFamily: 'inherit',
                    resize: 'vertical', minHeight: 96, color: 'var(--ink)', background: 'var(--surface)',
                  }}
                />
                <p style={{ fontSize: 10, color: 'var(--mute)', margin: '4px 0 0', textAlign: 'right' }}>{rejectReason.length} / 600</p>
              </div>
              {err && <ErrorBox msg={err} />}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--mist-strong)', display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', background: 'var(--surface)' }}>
              <SecondaryBtn onClick={() => !busy && setRejectOpen(false)}>Cancel</SecondaryBtn>
              <PrimaryBtn
                onClick={() => act('reject')}
                disabled={!!busy}
                data-testid="renewal-reject-submit"
              >
                {busy === 'reject' ? <Loader2 size={16} className="animate-spin" /> : null}
                {busy === 'reject'
                  ? 'Sending…'
                  : rejectIntent === 'vacate' ? 'Confirm move-out' : 'Send to provider'}
              </PrimaryBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RenewalChequesAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const child = resolved.renewalContract;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!child) return <ErrorBox msg="Renewal contract not found." />;
  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${child!.id}/cheques-submitted`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
          Your rental provider prepared the renewal payment schedule on the renewal contract. Once you&rsquo;ve prepared your payments, confirm here and we&rsquo;ll let your rental provider collect them.
        </p>
      </div>
      {err && <ErrorBox msg={err} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <PrimaryBtn onClick={confirm} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy ? 'Confirming…' : 'Confirm renewal cheques ready'}
        </PrimaryBtn>
        <SecondaryBtn href={`/dashboard/customer/contracts/${child.id}`}>View renewal contract <ExternalLink size={14} /></SecondaryBtn>
      </div>
    </div>
  );
}

/* ─── END STATES ───────────────────────────────────────────────────── */
function EndStateAction({ primaryLabel, primaryHref }: { primaryLabel: string; primaryHref: string }) {
  return <PrimaryBtn href={primaryHref}>{primaryLabel} <ChevronRight size={16} /></PrimaryBtn>;
}

/* ─── TopBar ───────────────────────────────────────────────────────── */
function TopBar({ resolved }: { resolved: Resolved }) {
  const u = resolved.unit;
  const building = u?.property?.buildingName ?? '—';
  const unit = u ? (u.unitName ?? `Unit ${u.unitNumber}`) : '';
  const loc = [u?.property?.community?.name, u?.property?.emirate?.name].filter(Boolean).join(', ');
  return (
    <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--mist-strong)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, position: 'sticky', top: 0, zIndex: 10 }}>
      <Link href="/dashboard/customer/spaces" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ink-2)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
        <ArrowLeft size={16} /> My Spaces
      </Link>
      <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0, fontWeight: 600 }}>{loc || 'Tenancy journey'}</p>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{building}{unit ? `, ${unit}` : ''}</p>
      </div>
      <Link href={`/dashboard/customer/spaces?space=${resolved.spaceKey}`}
        style={{ fontSize: 12, color: 'var(--ink-2)', textDecoration: 'none', padding: '6px 12px', border: '1px solid var(--mist-strong)', borderRadius: 999, background: 'var(--surface)', fontWeight: 600, whiteSpace: 'nowrap' }}>
        Legacy view
      </Link>
    </div>
  );
}

/* ─── Main page ────────────────────────────────────────────────────── */
export default function CustomerSpaceV2Page() {
  const params = useParams<{ spaceKey: string }>();
  const spaceKey = params?.spaceKey ?? '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  const fetchAll = useMemo(() => async () => {
    setLoading(true); setError(null);
    try {
      const [viewings, leads, contracts, docsResp] = await Promise.all([
        apiGet<ApiViewing[]>('/leads/my-viewings').catch(() => [] as ApiViewing[]),
        apiGet<ApiLead[]>('/leads/my-applications').catch(() => [] as ApiLead[]),
        apiGet<ApiContract[]>('/contracts/tenant').catch(() => [] as ApiContract[]),
        apiGet<{ documents: TenantDoc[]; tenantProfileId?: number | null }>('/documents/my').catch(() => ({ documents: [], tenantProfileId: null })),
      ]);
      const docs = docsResp.documents ?? [];
      const tenantProfileId = (docsResp as { tenantProfileId?: number | null }).tenantProfileId ?? null;
      const kind = spaceKey.startsWith('v-') ? 'viewing' : spaceKey.startsWith('d-') ? 'direct' : spaceKey.startsWith('c-') ? 'contract' : null;
      const refId = Number(spaceKey.slice(2));
      let unit: ApiUnit | null = null;
      let viewing: ApiViewing | null = null;
      let lead: ApiLead | null = null;
      if (kind === 'viewing') {
        const grouped = viewings.filter(v => (v.leadId ?? v.lead?.id) === refId);
        viewing = grouped.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0] ?? null;
        unit = viewing?.unit ?? null;
      } else if (kind === 'direct') {
        lead = leads.find(l => l.id === refId) ?? null;
        unit = lead?.unit ?? null;
      } else if (kind === 'contract') {
        // Contract-only entry (no lead/viewing behind it). Build the unit from
        // the contract's own unit + property payload.
        const cFound = contracts.find(c => c.id === refId);
        if (cFound) {
          const cu = cFound.unit ?? null;
          unit = cu ? {
            id: cu.id ?? 0,
            unitNumber: cu.unitNumber ?? cu.number ?? '',
            unitName: cu.unitName ?? cu.name ?? null,
            unitType: cu.unitType ?? null,
            bedrooms: cu.bedrooms ?? null,
            property: cFound.property ? {
              buildingName: cFound.property.buildingName ?? undefined,
              fullAddress: cFound.property.fullAddress ?? null,
            } : undefined,
          } : null;
        }
      }
      if (!unit) { setError('Space not found.'); setLoading(false); return; }
      const allForUnit = contracts.filter(c => c.unit?.id === unit?.id);
      const contract = allForUnit.find(c => !c.parentContractId) ?? allForUnit[0] ?? null;
      const renewalContract = contract ? (allForUnit.find(c => c.parentContractId === contract.id) ?? null) : null;
      // Docs-complete gate combines KYC identity + financial/business docs.
      // Use getRequiredDocs (which prepends KYC_DOCS to the rental section)
      // so a customer who's uploaded financials but skipped KYC still gets
      // routed to docs_required, not payment_review.
      const requiredKeys = getRequiredDocs(unit.unitType).filter(d => d.required).map(d => d.key);
      const uploadedKeys = new Set(docs.filter(d => d.status !== 'missing' && d.status !== 'rejected').map(d => d.documentKey));
      // Emirates ID is satisfied by a combined file OR both separate sides.
      const allRequiredDocsUploaded = requiredKeys.length > 0 && requiredKeys.every(k => isDocKeySatisfied(k, uploadedKeys));
      const paymentPlan = lead?.paymentPlan ?? viewing?.lead?.paymentPlan ?? null;
      const stage = lead?.stage ?? viewing?.lead?.stage ?? viewing?.leadStage ?? null;
      setResolved({ spaceKey, unit, viewing, lead, contract, renewalContract, paymentPlan, stage, allRequiredDocsUploaded, docsSubmitted: readDocsSubmitted(spaceKey), tenantProfileId, myDocs: docs });
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setLoading(false);
    }
  }, [spaceKey]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div style={{ ...PALETTE, minHeight: '100vh', background: 'var(--surface)', display: 'grid', placeItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--jade)' }} />
          <p style={{ fontSize: 13, color: 'var(--mute)' }}>Loading your space…</p>
        </div>
      </div>
    );
  }
  if (error || !resolved) {
    return (
      <div style={{ ...PALETTE, minHeight: '100vh', background: 'var(--surface)', display: 'grid', placeItems: 'center' }}>
        <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 18, padding: '32px 40px', maxWidth: 420, textAlign: 'center' }}>
          <AlertCircle size={28} style={{ color: 'var(--brick)', marginBottom: 12 }} />
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px' }}>Something went wrong</p>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 18px' }}>{error ?? 'Space could not be loaded.'}</p>
          <Link href="/dashboard/customer/spaces" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 999, background: 'var(--jade)', color: 'var(--paper)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            <ArrowLeft size={14} /> Back to My Spaces
          </Link>
        </div>
      </div>
    );
  }

  // Dual-view trigger: original lease is still active AND a renewal child is mid-flight
  // (not yet activated, not rejected). In that case render the design's "Old + New" stack.
  const c = resolved.contract;
  const rc = resolved.renewalContract;
  const isDualView = !!(c && c.status === 'active' && rc && rc.status !== 'active' && rc.status !== 'terminated');

  if (isDualView) {
    return (
      <div style={{ ...PALETTE, minHeight: '100vh', background: 'var(--surface)' }}>
        <TopBar resolved={resolved} />
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 24px 60px' }}>
          <DualView resolved={resolved} onRefresh={fetchAll} />
        </div>
      </div>
    );
  }

  const stateKey = deriveStateKey(resolved);
  const { steps, currentIndex } = stepsFor(stateKey, resolved);
  const def = STATE_DEFS[stateKey];

  return (
    <div style={{ ...PALETTE, minHeight: '100vh', background: 'var(--surface)' }}>
      <TopBar resolved={resolved} />
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <QuestMap steps={steps} currentIndex={currentIndex} mode={def.mode} />
          <QuestActionCard stateKey={stateKey} resolved={resolved} onRefresh={fetchAll} />
        </div>
      </div>
    </div>
  );
}

/* ─── DUAL VIEW — original lease + renewal in flight, stacked ─────── */
function DualView({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  // Section 01 — Original lease. Force-derive by hiding the renewal child so
  // the original always reads as 'active' (we already verified c.status==='active').
  const resolvedOriginalOnly: Resolved = { ...resolved, renewalContract: null, contract: resolved.contract ? { ...resolved.contract, renewalAccepted: null } : null };
  const originalStateKey: StateKey = 'active';
  const { steps: originalSteps, currentIndex: originalCurrentIdx } = stepsFor(originalStateKey, resolvedOriginalOnly);
  const originalDef = STATE_DEFS[originalStateKey];

  // Section 02 — Renewal. Full derivation (renewal-aware).
  const renewalStateKey = deriveStateKey(resolved);
  const { steps: renewalSteps, currentIndex: renewalCurrentIdx } = stepsFor(renewalStateKey, resolved);
  const renewalDef = STATE_DEFS[renewalStateKey];

  const c = resolved.contract;
  const rc = resolved.renewalContract;
  const endStr = c?.endDate ? new Date(c.endDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE }) : '—';
  const renewalEndStr = rc?.endDate ? new Date(rc.endDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE }) : '—';

  // Phase 6 — the renewal section moves above the current lease here.
  // The action lives on the renewal track (accept terms, sign, etc.), so
  // surfacing it first matches what the customer needs to act on. The
  // current lease becomes the read-only reference below.
  return (
    <div style={{ display: 'grid', gap: 36 }}>
      <DualHeader />

      <DualSection eyebrow="01 · Renewal" title={renewalDef.label} sub={rc?.endDate ? `Through ${renewalEndStr}` : 'In progress'} tone="brick">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <QuestMap steps={renewalSteps} currentIndex={renewalCurrentIdx} mode={renewalDef.mode} />
          <QuestActionCard stateKey={renewalStateKey} resolved={resolved} onRefresh={onRefresh} />
        </div>
      </DualSection>

      <DualBridge />

      <DualSection eyebrow="02 · Original lease" title="Your current lease" sub={`Until ${endStr}`} tone="jade">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <QuestMap steps={originalSteps} currentIndex={originalCurrentIdx} mode={originalDef.mode} />
          <QuestActionCard stateKey={originalStateKey} resolved={resolvedOriginalOnly} onRefresh={onRefresh} />
        </div>
      </DualSection>
    </div>
  );
}

function DualHeader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 16, padding: '20px 24px',
      background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 18,
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'var(--mute)',
          textTransform: 'uppercase', letterSpacing: '0.15em',
          padding: '4px 10px', border: '1px solid var(--mist-strong)', borderRadius: 4,
        }}>
          RENEWAL IN FLIGHT
        </span>
        <h2 style={{ fontSize: 24, lineHeight: 1.15, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-0.015em' }}>
          Two tenancies, <span style={{ color: 'var(--jade-deep)' }}>one place.</span>
        </h2>
      </div>
      <p style={{ fontSize: 13, color: 'var(--mute)', margin: 0, maxWidth: 360 }}>
        Your current lease is still active. Your renewal is in progress underneath. Both are managed here.
      </p>
    </div>
  );
}

function DualSection({ eyebrow, title, sub, tone, children }: {
  eyebrow: string; title: string; sub: string; tone: 'jade' | 'brick'; children: React.ReactNode;
}) {
  const accent = tone === 'jade' ? 'var(--jade-deep)' : 'var(--brick)';
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 16, flexWrap: 'wrap',
        paddingBottom: 14, borderBottom: `1px solid ${accent}`,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: accent,
          textTransform: 'uppercase', letterSpacing: '0.15em',
        }}>
          {eyebrow}
        </span>
        <h3 style={{ fontSize: 22, lineHeight: 1.15, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-0.015em' }}>
          {title}
        </h3>
        <span style={{ flex: 1, height: 1, background: 'var(--mist-strong)', alignSelf: 'center', minWidth: 20 }} />
        <span style={{ fontSize: 12, color: 'var(--mute)' }}>{sub}</span>
      </div>
      {children}
    </div>
  );
}

function DualBridge() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--mist-strong)' }} />
      <div style={{
        padding: '10px 18px',
        background: 'var(--surface)', border: '1.5px dashed var(--mist-strong)', borderRadius: 999,
        fontSize: 14, color: 'var(--mute)', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600,
      }}>
        <ArrowRight size={16} />
        rolls over to
      </div>
      <div style={{ flex: 1, height: 1, background: 'var(--mist-strong)' }} />
    </div>
  );
}
