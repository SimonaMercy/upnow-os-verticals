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
 *   POST   /api/contracts/tenant/:id/termination/request { reason, reasonCode, effectiveDate }
 *   PATCH  /api/contracts/tenant/:id/termination/respond { response }
 *   PATCH  /api/contracts/:parentId/renewal/accept
 *   PATCH  /api/contracts/:parentId/renewal/reject
 *   PATCH  /api/contracts/tenant/:childId/cheques-submitted
 *   POST   /api/documents/upload-url                     (utility proof; presigned S3)
 *   POST   /api/documents                                (register doc after PUT)
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { comparePaymentSchedule, instalmentLabel } from '@/lib/paymentPlan';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDocumentScanner } from '@/components/upnow/DocumentScanModal';
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
import { MaintenanceSection } from '@/components/customer/MaintenanceSection';
import { LocationMap } from '@/components/upnow/LocationMap';
import { PaymentPlanCard } from '@/components/upnow/PaymentPlanCard';
import type { PlanAttachSlot } from '@/components/upnow/SegregatedPlanView';
import { buildSegregatedPlan, segRowsFromCustomerPlan, segRowsFromContract } from '@/lib/segregatedPlan';
import { openDocViewer } from '@/lib/docViewer';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { NATIONALITIES, normalizeNationality } from '@/lib/nationalities';
import { RESIDENTIAL_RENTAL_DOCS, getKycDocs, getRentalSectionDocs, getRequiredDocs, getOccupantDocs, deriveOccupantCount, isDocKeySatisfied } from '@/lib/docRequirements';
import { authorityLabel, authorityName, isKnownAuthority, licenseAuthorityGroups } from '@/lib/tradeLicenseAuthorities';
import { additionalDocKey, docKeysForSlot, parseAdditionalDocs, resolveRequestedDocKey } from '@/lib/requestableDocs';
// The journey state machine is SHARED with the My Spaces list so both surfaces
// name the same step — see lib/customerJourney.ts.
import {
  deriveStateKey, readDocsSubmitted, writeDocsSubmitted, resolveContractChain,
  CUSTOMER_STATE_DEFS as STATE_DEFS,
  type CustomerStateKey as StateKey,
  type CustomerStateDef as StateDef,
  type CustomerJourneyMode as Mode,
} from '@/lib/customerJourney';
import type { DocReq } from '@/lib/docRequirements';
import { useAuth } from '@/contexts/AuthContext';
import MoveOutReasonSelect from '@/components/upnow/MoveOutReasonSelect';
import { moveOutReason, moveOutReasonLabel, moveOutReasonReady } from '@/lib/moveOutReasons';
import { deriveSpaceCategoryFromUnitType, effectiveSpaceCategory } from '@/lib/unitTaxonomy';

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
    latitude?: number | string | null;
    longitude?: number | string | null;
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
  type?: 'fee' | 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
  /** How the landlord expects this line to be paid — shown on the plan so the
   *  customer knows which rows are cheques and which are transfers. */
  paymentMethod?: 'cheque' | 'bank_transfer' | 'card' | 'cash';
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
  /** Per-fee VAT (fils) — gross fee = net + this. Rent VAT too (residential = 0). */
  adminFeeVatFils?: number;
  ejariVatFils?: number;
  commissionVatFils?: number;
  rentVatFils?: number;
  rentVatRate?: number;
  /** RP-defined extra unit charges — each its own line. netFils + vatFils = gross. */
  customFees?: Array<{ label: string; netFils: number; vatFils: number }>;
  customFeesFils?: number;
  items?: ApiPaymentPlanItem[];
  notes?: string;
  rentalIndexReportUrl?: string;
  chequesPayableTo?: string;
  /** Landlord's account, snapshotted on the plan — shown when a row is a transfer. */
  bankDetails?: { accountName: string | null; bankName: string | null; iban: string | null };
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
  /** RP's message when they reopened the lead (e.g. a revised price offer). */
  reopenNote?: string | null;
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
  /** Coded move-out reason (migration 0198). NULL on pre-0198 terminations. */
  reasonCode: string | null;
  effectiveDate: string | null;
  response: 'pending' | 'accepted' | 'rejected' | null;
}

interface ApiSettlementLine { id: number; label: string; amount: number; type: 'deduction' | 'due' }
interface ApiSettlement {
  status: 'sent' | 'agreed' | 'paid';
  depositHeld: number;
  notes: string | null;
  refundAmount: number | null;
  // How the refund was paid back (0260) — set when the landlord closes a
  // settlement with a refund due.
  refundMethod?: 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'online' | null;
  refundReference?: string | null;
  refundPaidOn?: string | null;
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
  amountPaid: number;       // GROSS (incl. VAT)
  vatAmount?: number;       // VAT portion already inside amountPaid
  transactionDate: string | null;
  chequeStatus?: string | null;
  /** How the landlord expects this line to be paid — feeds the Payment Summary's
   *  "Paid by" column, which hides itself when no row carries a method. */
  paymentMethod?: string | null;
}

interface ApiContract {
  id: number;
  ref?: string | null;
  /** Company tenant party name — set when the tenant is a company, so documents
   *  show the company rather than the individual signatory. */
  tenantCompanyName?: string | null;
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
  /** RP has confirmed the post-dated cheques were collected — gates the renewal
   *  from the Cheques/PDC step to Signatures (mirrors the new-lease flow). */
  pdcConfirmed?: boolean;
  /** Customer has confirmed their renewal cheques are ready → waiting for the RP
   *  to collect/confirm (pdcConfirmed). */
  tenantChequesSubmittedAt?: string | null;
  /** Required KYC docs (EID/passport/visa/licence) that are expired or missing for
   *  this renewal — the customer must re-upload them. Blank expiry counts as expired. */
  expiredKycDocKeys?: string[];
  /** The subset of expiredKycDocKeys flagged ONLY because no expiry date was ever
   *  recorded. Expiry on a customer identity doc is the REVIEWER's to assert, so
   *  these are not the customer's to fix — their copy is on file and it is the RP
   *  who reads the date off it. Shown as done, never as "Replace". */
  kycExpiryMissingKeys?: string[];
  /** Durable "KYC re-verification was required" flag — snapshotted at accept-time.
   *  Present ⇒ the renewal routes through the Documents step until the RP accepts. */
  renewalDocsRequiredAt?: string | null;
  /** Customer pressed "Submit for review" on the renewal paperwork step. */
  renewalDocsSubmittedAt?: string | null;
  /** RP has reviewed + accepted the re-uploaded renewal KYC docs → cheques unlock. */
  renewalDocsAcceptedAt?: string | null;
  numberOfInstallments: number | null;
  startDate: string | null;
  endDate: string | null;
  annualRent: number;           // NET annual rent
  rentVatRate?: number;         // % VAT on rent (0 = residential/exempt)
  contractValue?: number | null;
  securityDepositAmount?: number | null;
  /** The deposit REGISTER record — where a deposit lives since migration 0191
   *  (it is no longer a `payments` row). Chain-resolved, so a renewal carries it. */
  securityDeposit?: {
    depositId: number; amount: number; chequeNumber: string | null;
    paymentMethod: string | null; chequeStatus: string | null;
    recordedDate: string | null; dueDate: string | null;
  } | null;
  adminFeeFils?: number | null;
  ejariFeeFils?: number | null;
  tenantSignedAt: string | null;
  landlordSignedAt: string | null;
  unit: { id: number | null; number?: string | null; name?: string | null; unitNumber?: string | null; unitName?: string | null; unitType?: string | null; bedrooms?: number | null };
  /** community / emirate arrive as plain name strings on the contract list. */
  property?: { id?: number | null; buildingName?: string | null; fullAddress?: string | null; spaceCategory?: string | null; community?: string | null; emirate?: string | null } | null;
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
 *          → signature → utility → move_in → ejari → active
 *
 * `docs_required` is conditional — hidden from the timeline when the customer's
 *  KYC is complete AND occupants=1 AND no RP-requested extras. `deriveStateKey`
 *  skips straight to `payment_review` in that case.
 *
 * StateKey / StateDef / STATE_DEFS / deriveStateKey now live in
 * lib/customerJourney.ts so the My Spaces LIST resolves the very same step
 * (it used to guess from lead.stage alone and contradict this page).
 */

interface Step { key: string; label: string; short: string; icon: string }

// Mirrors the RP rail (contracts/:id/v2): Registration is step 5, BEFORE utility,
// because the utility account is opened against the registration certificate —
// the customer literally cannot do the utility step until registration is done.
// See the note on STEPS_NEW there for the 2026-08-01 → 08-08 detour that had
// Registration last.
const STEPS_NEW: Step[] = [
  { key: 'booked',          label: 'Booked',             short: 'Booked',   icon: 'calendar' },
  { key: 'documents',       label: 'Documents',          short: 'Docs',     icon: 'document' },
  { key: 'payment',         label: 'Payment & cheques',  short: 'Payment',  icon: 'wallet'   },
  { key: 'sign',            label: 'Sign contract',      short: 'Sign',     icon: 'pen'      },
  { key: 'ejari',           label: 'Contract Registration', short: 'Registration', icon: 'stamp' },
  { key: 'utility',         label: 'Utility',            short: 'Utility',  icon: 'bolt'     },
  { key: 'move_in',         label: 'Move-in',            short: 'Move-in',  icon: 'key'      },
  { key: 'active',          label: 'Active tenancy',     short: 'Active',   icon: 'active'   },
];
// Renewal journey mirrors the RP renewal pipeline (Operations kanban):
// Terms → Cheques/PDC → Signatures → Ejari → Active. The customer reviews and
// confirms the renewal cheques BEFORE signing (the RP confirms collection in
// between), matching the new-lease order. Document refresh stays a conditional
// gate (only fires when KYC has actually expired), so it isn't a default step.
const STEPS_RENEWAL: Step[] = [
  { key: 'terms_offered',   label: 'Terms offered',      short: 'Terms',    icon: 'envelope' },
  { key: 'documents',       label: 'Renewal documents',  short: 'Docs',     icon: 'document' },
  { key: 'cheques',         label: 'Cheques / PDC',      short: 'Cheques',  icon: 'wallet'   },
  { key: 'sign',            label: 'Sign renewal',       short: 'Sign',     icon: 'pen'      },
  { key: 'ejari',           label: 'Contract Registration', short: 'Registration', icon: 'stamp' },
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
  /** `/documents/my` merges the customer's OWN docs with the tenant-visible docs
   *  of EVERY contract they hold, so anything that means "this lease's document"
   *  has to filter on these two — the key alone matches other leases as well. */
  ownerType?: string | null;
  ownerId?: number | null;
  displayName?: string | null;
  status?: string;
  /** Rejection reason (set by the RP/admin on reject); lives in documents.notes. */
  notes?: string | null;
  fileUrl?: string | null;
  /** Expiry date (identity / licence docs) — yyyy-mm-dd, prefills the field. */
  expiryDate?: string | null;
}

// yyyy-mm-dd for a native date input, tolerant of full ISO timestamps.

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
  /** Individual or company — decides whether we ask for personal identity docs
   *  or the company's licence + authorised signatory (see docRequirements). */
  entityType: 'individual' | 'company' | null;
  companyName: string | null;
  tradeLicenseNumber: string | null;
  tradeLicenseAuthority: string | null;
  myDocs: TenantDoc[];
  /** Extra documents the RP requested (free-text names from additionalDocsNote).
   *  Rendered as their own upload slots; while any is unfulfilled the customer is
   *  held at the Documents step (see deriveStateKey). */
  requestedAdditionalDocs: string[];
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

const PLAN_TYPE_ORDER: Record<string, number> = { fee: 0, first_bundle: 1, installment: 2, extra_installment: 3, security_deposit: -1 };
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

/* ─── Payment runway model ─────────────────────────────────────────────
 * ONE derivation shared by the left-hand payment summary and the Payments
 * section, so the two can never disagree on order, labels or totals.
 *
 * Prefers the contract's REAL cheques (the source of truth once the tenancy is
 * active) and only falls back to the payment-plan preview while the contract has
 * no payment rows yet. Rows come out in the SHARED schedule order
 * (lib/paymentPlan): rent instalments in date order, then Contract Registration →
 * Admin → Commission → custom charges. Sorting by due date alone interleaved the
 * one-off fees into the rent runway, because the fees and instalment 1 all share
 * the first cheque date. */
interface RunwayRow {
  description: string | null;
  amountFils: number;
  dueDate: string | null;
  status: string | null;
}
interface PaymentRunway {
  items: RunwayRow[];
  /** Rent instalments vs one-off charges — the row count is NOT the instalment count. */
  rentRowCount: number;
  oneOffRowCount: number;
  /** Void (bounced / cancelled) rows are excluded — they'd double-count their replacement. */
  totalFils: number;
  clearedFils: number;
  outstandingFils: number;
  /** Next upcoming RENT instalment, skipping the before-move-in first cheque. */
  next: RunwayRow | null;
  /** The refundable security deposit. Kept OUT of `items` (it is not a rent /
   *  charge cheque, and must never be a "next payment" candidate) but returned
   *  here so a full schedule can show it — first, per the shared category order. */
  deposit: RunwayRow | null;
  /** `totalFils` + the deposit — what the lease is worth end to end. */
  grandTotalFils: number;
}
const isVoidStatus = (s?: string | null) => ['bounced', 'cancelled'].includes((s ?? '').toLowerCase());
const isRentPlanItem = (t?: string | null) =>
  t === 'installment' || t === 'first_bundle' || t === 'extra_installment';

function buildPaymentRunway(c: ApiContract | null, pp: ApiPaymentPlan | null): PaymentRunway {
  // Rent-row totals up front: the uniform "Instalment N" label needs to know how
  // many there are (a single-payment plan keeps its "Annual Rent" label).
  const realRentTotal = (c?.payments ?? []).filter(p => p.paymentType === 'rental_income').length;
  const planRentTotal = pp?.installmentCount ?? (pp?.items ?? []).filter(it => isRentPlanItem(it.type)).length;
  let realRentSeen = 0;
  let planRentSeen = 0;
  const realCheques: RunwayRow[] = (c?.payments ?? [])
    .filter(p => p.paymentType !== 'security_deposit')
    .slice()
    .sort(comparePaymentSchedule)
    .map(p => ({
      description: p.paymentType === 'rental_income'
        ? instalmentLabel(p.description, realRentSeen++, realRentTotal)
        : (p.description ?? (p.paymentType ?? 'Payment').replace(/_/g, ' ')),
      amountFils: Math.round((p.amountPaid ?? 0) * 100),
      dueDate: p.transactionDate ? p.transactionDate.slice(0, 10) : null,
      status: p.chequeStatus ?? null,
    }));
  const planCheques: RunwayRow[] = (pp?.items ?? [])
    .filter(it => it.type !== 'security_deposit')
    .slice()
    .sort(comparePaymentSchedule)
    .map(it => ({
      description: isRentPlanItem(it.type)
        ? instalmentLabel(it.description, planRentSeen++, planRentTotal)
        : (it.description ?? null),
      amountFils: it.amountFils ?? 0,
      dueDate: it.dueDate ?? null,
      status: null,
    }));
  const items = realCheques.length ? realCheques : planCheques;
  const rentRowCount = realCheques.length ? realRentTotal : planRentTotal;
  const live = items.filter(it => !isVoidStatus(it.status));
  const totalFils = live.reduce((s, it) => s + it.amountFils, 0);
  const clearedFils = live
    .filter(it => (it.status ?? '').toLowerCase() === 'cleared')
    .reduce((s, it) => s + it.amountFils, 0);

  // "Next payment" = the next upcoming RENT instalment, NOT the before-move-in
  // first cheque (fees + deposit + installment 1 all share the earliest due
  // date). On an active pass that first cheque is the current/collected one, so
  // skip its date and surface the 2nd instalment. Falls back to any upcoming
  // cheque when there's only the first one (e.g. a 1-installment plan).
  const todayYmd = new Date().toISOString().slice(0, 10);
  const firstDue = items.find(it => it.dueDate)?.dueDate ?? null;
  const upcoming = (it: RunwayRow) => !!it.dueDate && it.dueDate >= todayYmd && !isVoidStatus(it.status);
  const next =
    items.find(it => upcoming(it) && it.dueDate !== firstDue)
    ?? items.find(upcoming)
    ?? null;

  // The deposit row — from the REGISTER record when there is one (so it carries
  // its own cheque status), else the plan item, else the bare contract amount.
  // It used to read a `payments` row here; deposits stopped being payments in
  // migration 0191, and the register is the record that can actually be settled.
  const depositRecord = c?.securityDeposit ?? null;
  const depositPlanItem = (pp?.items ?? []).find(it => it.type === 'security_deposit');
  const depositFallbackFils = pp?.securityDepositFils ?? Math.round((c?.securityDepositAmount ?? 0) * 100);
  const deposit: RunwayRow | null = depositRecord
    ? {
        description: 'Security deposit',
        amountFils: Math.round((depositRecord.amount ?? 0) * 100),
        dueDate: depositRecord.dueDate ?? depositRecord.recordedDate ?? null,
        status: depositRecord.chequeStatus ?? null,
      }
    : depositPlanItem
      ? { description: 'Security deposit', amountFils: depositPlanItem.amountFils ?? 0, dueDate: depositPlanItem.dueDate ?? null, status: null }
      : depositFallbackFils > 0
        ? { description: 'Security deposit', amountFils: depositFallbackFils, dueDate: null, status: null }
        : null;
  const depositLiveFils = deposit && !isVoidStatus(deposit.status) ? deposit.amountFils : 0;

  return {
    items,
    rentRowCount,
    oneOffRowCount: Math.max(0, items.length - rentRowCount),
    totalFils,
    clearedFils,
    outstandingFils: Math.max(0, totalFils - clearedFils),
    next,
    deposit,
    grandTotalFils: totalFils + depositLiveFils,
  };
}

/* ─── Payment summary rail (live tenancy) ──────────────────────────────
 * Once the tenancy is live the journey map has nothing left to tell — every stop
 * is done. This takes its place in the left column: the lease's full payment
 * SCHEDULE — the security deposit first (shared category order), then the rent
 * instalments, then the one-off charges — each with its own status, and the total
 * they add up to. Nothing else: annual rent, lease period and the next cheque
 * already live on the Tenancy Pass. */
/** Monospace uppercase field label used across the payment summary. */
function K({ children }: { children: React.ReactNode }) {
  return <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>{children}</p>;
}

function PaymentSummaryRail({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const [showTerm, setShowTerm] = useState(false);
  const c = resolved.contract;
  const run = buildPaymentRunway(c, resolved.paymentPlan);
  const aed = (fils: number) => `AED ${Math.round(fils / 100).toLocaleString('en-AE')}`;
  // Deposit first — rank 0 in the shared schedule order (lib/paymentPlan).
  const rows = run.deposit ? [run.deposit, ...run.items] : run.items;
  // Grouped by what the customer still owes vs what is already collected.
  // Upcoming leads: it's the only half they can act on. Void (bounced /
  // cancelled) rows are their own group — they've been replaced and are
  // excluded from every total.
  const isCleared = (r: RunwayRow) => (r.status ?? '').toLowerCase() === 'cleared';
  const groups = [
    { key: 'upcoming', label: 'Upcoming', rows: rows.filter(r => !isCleared(r) && !isVoidStatus(r.status)) },
    { key: 'cleared',  label: 'Cleared',  rows: rows.filter(isCleared) },
    { key: 'void',     label: 'Replaced', rows: rows.filter(r => isVoidStatus(r.status)) },
  ].filter(g => g.rows.length > 0);
  const groupTotal = (rs: RunwayRow[]) => rs.reduce((s, r) => s + r.amountFils, 0);

  // A lease can only be ended while it is running — not once a termination has
  // already been accepted and the wind-down has started.
  const canRequestTermination = !!c && c.status === 'active' && (c.termination?.response ?? null) !== 'accepted';

  return (
    <div style={{ display: 'grid', gap: 10, position: 'sticky', top: 88 }}>
      {showTerm && c && (
        <TerminationRequestModal contract={c} onClose={() => setShowTerm(false)} onSuccess={() => { setShowTerm(false); onRefresh(); }} />
      )}
    <div style={{ background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--mist-strong)', padding: 20, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wallet size={14} style={{ color: 'var(--jade-deep)' }} />
          <span style={{ fontSize: 10, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>Payment summary</span>
        </div>
        {c?.id != null && <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--mute)' }}>CID-{c.id}</span>}
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0 }}>No payment schedule on this lease yet.</p>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: 14, display: 'grid', gap: 14 }}>
          {groups.map(g => (
            <div key={g.key} style={{ display: 'grid', gap: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <K>{g.label}</K>
                {g.key !== 'void' && (
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--mute)', fontVariantNumeric: 'tabular-nums' }}>
                    {aed(groupTotal(g.rows))}
                  </span>
                )}
              </div>
              {g.rows.map((it, i) => (
                <ScheduleRow key={i} row={it} />
              ))}
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--mist-strong)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>Total</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--jade-deep)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {aed(run.grandTotalFils)}
            </span>
          </div>
        </div>
      )}
    </div>
      {/* Ending the lease early is a rare, deliberate action — it sits BELOW the
          summary in a soft treatment rather than competing with it. */}
      {canRequestTermination && (
        <button onClick={() => setShowTerm(true)} style={{
          width: '100%', padding: '11px 16px', borderRadius: 14, fontSize: 12.5, fontWeight: 600,
          background: 'var(--brick-soft)', color: 'var(--brick)', border: '1px solid #f3c9c0',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          fontFamily: 'inherit',
        }}>
          <X size={13} /> Request Termination
        </button>
      )}
    </div>
  );
}

/** One scheduled payment: label + due date, amount, and its status. Cleared vs
 *  Upcoming as a plain binary; a bounced / cancelled cheque keeps its own explicit
 *  red label because it has been replaced. */
function ScheduleRow({ row }: { row: RunwayRow }) {
  const st = (row.status ?? '').toLowerCase();
  const bounced = st === 'bounced' || st === 'cancelled';
  const cleared = st === 'cleared';
  const badge = bounced ? (row.status ?? 'bounced') : cleared ? 'Cleared' : 'Upcoming';
  const due = row.dueDate
    ? new Date(row.dueDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE })
    : null;
  // Status reads off the row's own tint: collected = green, still to come = grey,
  // void (bounced / replaced) = red. Colour AND the text label carry it, so it
  // never depends on colour alone.
  const tone = bounced
    ? { bg: 'var(--brick-soft)', border: 'var(--brick)', fg: 'var(--brick)' }
    : cleared
      ? { bg: 'var(--jade-soft)', border: 'var(--jade)', fg: 'var(--jade-deep)' }
      : { bg: 'var(--mist)', border: 'var(--mist-strong)', fg: 'var(--ink-2)' };
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 9, alignItems: 'center',
      padding: '9px 12px', borderRadius: 10, background: tone.bg, border: `1px solid ${tone.border}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.description ?? 'Payment'}
        </p>
        <p style={{ fontSize: 10.5, color: 'var(--mute)', margin: '1px 0 0' }}>
          {due ?? '—'}
          {' · '}
          <span style={{ color: tone.fg, fontWeight: 600, textTransform: 'capitalize' }}>{badge}</span>
        </p>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        AED {Math.round(row.amountFils / 100).toLocaleString('en-AE')}
      </span>
    </div>
  );
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
        <span style={{ fontSize: 12, color: 'var(--mute)' }}>{mode === 'renewal' ? `renewal · ${n} stops` : `${n} stops`}</span>
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

function Stat({ label, value, accent, sub }: { label: string; value: string; accent?: boolean; sub?: string }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '14px 16px', display: 'grid', gap: 4, alignContent: 'start' }}>
      <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: accent ? 'var(--jade-deep)' : 'var(--ink)', margin: 0, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--mute)', fontWeight: 500, margin: 0 }}>{sub}</p>}
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

/* ─── Ongoing-setup downloads: receipts + tenancy contract + Registration cert ─
   Surfaced across the ongoing setup steps (signature → utility → move-in →
   registration) so the customer can grab their receipts the moment the RP confirms
   payment, their signed tenancy contract the moment they've signed it, and their
   Contract Registration certificate the moment it's attached — without waiting
   for the tenancy to go active. Renders nothing until at least one is available. */
/**
 * The Contract Registration certificate uploaded onto ONE specific lease.
 *
 * Scoping to `contractId` is the whole point: `myDocs` carries every contract the
 * customer holds, so an unscoped `documentKey.startsWith('ejari')` matched a
 * certificate from a DIFFERENT lease — which is how a brand-new space still
 * mid-payment offered "your certificate is ready", and how a renewal offered the
 * parent lease's certificate while its own registration was still pending.
 * A certificate existing against this contract IS the proof registration is done.
 *
 * Every variant of the key is `ejari*` ([[Ejari Rename]] kept the DB keys).
 * Highest id wins so a replaced certificate supersedes the one it replaced.
 */
function ejariCertDoc(resolved: Resolved, contractId: number | null | undefined): TenantDoc | undefined {
  if (contractId == null) return undefined;
  return (resolved.myDocs ?? [])
    .filter(d => /^ejari/i.test(d.documentKey) && !!d.fileUrl
      && d.ownerType === 'tenancy_contract' && d.ownerId === contractId)
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
}
function receiptsReadyFor(contract: Resolved['contract'] | Resolved['renewalContract'] | null | undefined): boolean {
  if (!contract) return false;
  return !!contract.pdcConfirmed || (contract.payments ?? []).some(p => (p.chequeStatus ?? '').toLowerCase() === 'cleared');
}
function DownloadCard({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderRadius: 14, background: 'var(--paper)', border: '1.5px solid var(--jade)', textDecoration: 'none', color: 'var(--ink)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--jade)', color: 'var(--paper)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{title}</p>
          <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0' }}>{sub}</p>
        </div>
      </div>
      <ExternalLink size={16} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
    </a>
  );
}
/** States where the downloads panel is surfaced. Deliberately excludes the
 *  active / end states — the active view already lists these documents in full,
 *  so showing them again here would duplicate. Self-hides anyway until a
 *  receipt or certificate actually exists. */
const DOWNLOAD_STATES = new Set<StateKey>([
  'awaiting_rp_confirm', 'signature', 'ejari', 'utility', 'utility_review', 'move_in',
  'renewal_cheques', 'renewal_cheques_review', 'renewal_progress', 'renewal_ejari',
  // Keep the panel through renewal_ready: registration has just COMPLETED, which is
  // exactly when the certificate becomes downloadable. Dropping it here would hide
  // the document at the moment it first exists.
  'renewal_ready',
]);
/**
 * Standalone section (rendered BELOW the current-step card, never inside it) so
 * the customer can grab their payment receipts the moment the RP confirms
 * payment, and their Contract Registration certificate the moment it's attached
 * — kept visually separate from the active step to avoid any confusion about
 * what they still need to do. Renders nothing until at least one is available.
 */
function SetupDownloads({ resolved, stateKey }: { resolved: Resolved; stateKey: StateKey }) {
  // Prefer the renewal contract while a renewal is in-flight (its receipts are
  // the ones the customer is settling); falls back to the primary contract for
  // a brand-new lease, where renewalContract is null.
  const contract = resolved.renewalContract ?? resolved.contract;
  const ejariDoc = ejariCertDoc(resolved, contract?.id);
  const showReceipts = !!contract && receiptsReadyFor(contract);
  // The tenancy contract becomes a document to keep once the customer has signed
  // it. Before that the signature step already shows its own "preview your
  // contract before signing" card, so surfacing it here too would just duplicate.
  const showContract = !!contract?.tenantSignedAt;
  if (!DOWNLOAD_STATES.has(stateKey) || (!showReceipts && !showContract && !ejariDoc)) return null;
  return (
    <div style={{ background: 'var(--paper)', borderRadius: 18, border: '1px solid var(--mist-strong)', padding: '22px 24px', display: 'grid', gap: 12, boxShadow: '0 18px 44px -34px rgba(26,23,20,0.18)' }}>
      <div>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-0.015em' }}>Available to download</p>
        <p style={{ fontSize: 12, color: 'var(--mute)', margin: '3px 0 0' }}>Ready now — you don&apos;t need to wait for the next step.</p>
      </div>
      {showReceipts && contract && (
        <DownloadCard href={`/dashboard/customer/contracts/${contract.id}/print/receipt`}
          icon={<FileText size={18} />} title="View &amp; download receipts"
          sub="Your payments are confirmed — preview and download all your receipts." />
      )}
      {showContract && contract && (
        <DownloadCard href={`/dashboard/customer/contracts/${contract.id}/print`}
          icon={<FileText size={18} />} title="View &amp; download your tenancy contract"
          sub="Your signed tenancy contract — open it or save a copy for your records." />
      )}
      {ejariDoc?.fileUrl && (
        <DownloadCard href={ejariDoc.fileUrl}
          icon={<Stamp size={18} />} title="Download Contract Registration Certificate"
          sub="Your certificate is ready — open or save a copy for your records." />
      )}
    </div>
  );
}

/* ─── Modal primitive ──────────────────────────────────────────────── */
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const body = (
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
  // Portalled to <body>: a `position: sticky` ancestor (the payment summary rail)
  // establishes its own stacking context, which trapped the overlay's z-index and
  // let the following column paint straight over the dialog.
  //
  // PALETTE must ride along — the custom properties (`--paper`, `--mist-strong`,
  // `--brick`, …) are declared on the page's root div, so outside it every
  // `var(--…)` border / background / button colour resolves to nothing.
  if (typeof document === 'undefined') return body;
  return createPortal(<div style={PALETTE}>{body}</div>, document.body);
}

/* ─── Signature canvas ────────────────────────────────────────────── */
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
    case 'docs_under_review':             return <DocsUnderReviewAction />;
    // PHASE 4 → replace with new PaymentReviewAction (cheque photos + AI extraction)
    case 'payment_review':                return <PaymentPlanAction resolved={resolved} onRefresh={onRefresh} />;
    case 'awaiting_rp_confirm':           return <ChequesReviewWaitAction resolved={resolved} />;
    case 'signature':                     return <SignatureAction resolved={resolved} onRefresh={onRefresh} />;
    case 'ejari':                         return <WaitingBadge />;
    // PHASE 6 → prefill premise number into the utility form
    case 'utility':                       return <UtilityAction resolved={resolved} onRefresh={onRefresh} />;
    case 'utility_review':                return <UtilityReviewWaitAction resolved={resolved} />;
    // PHASE 6 → MoveInAction handles every half of step 7: awaiting the RP's
    //          submission, the customer's counter-sign, and (move_in_review) the
    //          wait for the RP/manager counter-signature that activates the tenancy.
    case 'move_in':
    case 'move_in_review':                return <MoveInAction resolved={resolved} />;
    case 'active':                        return <ActiveAction resolved={resolved} onRefresh={onRefresh} />;
    case 'termination_request_sent':      return <TerminationSentAction resolved={resolved} />;
    case 'termination_request_received':  return <TerminationReceivedAction resolved={resolved} onRefresh={onRefresh} />;
    case 'renewal_offered':               return <RenewalOfferedAction resolved={resolved} onRefresh={onRefresh} />;
    case 'renewal_documents':             return <DocumentsAction resolved={resolved} onRefresh={onRefresh} renewal />;
    case 'renewal_cheques':
    case 'renewal_cheques_review':        return <RenewalChequesAction resolved={resolved} onRefresh={onRefresh} />;
    case 'renewal_progress':              return <SignatureAction resolved={resolved} onRefresh={onRefresh} renewal />;
    case 'renewal_ejari':                 return <WaitingBadge />;
    // Registration done, term not started — nothing for the customer to do, so the
    // same waiting body; the copy (STATE_DEFS) is what changes.
    case 'renewal_ready':                 return <WaitingBadge />;
    case 'renewal_active':                return <ActiveAction resolved={resolved} onRefresh={onRefresh} />;
    case 'rejected':                      return <EndStateAction primaryLabel="Browse other listings" primaryHref="/listings" />;
    case 'withdrawn':                     return <EndStateAction primaryLabel="Browse other listings" primaryHref="/listings" />;
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
  // Unit location pin — coords ship from the backend property join; keyless Google embed.
  const lat = Number(unit?.property?.latitude);
  const lng = Number(unit?.property?.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  // Availability window — this unit is offered on a 1-year lease from the upcoming start date.
  const fmtDay = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const availabilityEnd = (() => { const [y, m, d] = defaultStart.slice(0, 10).split('-').map(Number); const dt = new Date(y + 1, m - 1, d); dt.setDate(dt.getDate() - 1); const p = (n: number) => (n < 10 ? `0${n}` : `${n}`); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`; })();

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Message from the RP when they reopened this lead (e.g. a revised price) */}
      {v?.reopenNote && (
        <div style={{ background: 'var(--jade-tint, #eef8f4)', border: '1px solid #bfe3d6', borderRadius: 14, padding: '14px 16px' }}>
          <p style={{ fontSize: 10, color: 'var(--jade-deep, #1f5a3f)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, fontWeight: 700 }}>Message from your rental provider</p>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: '6px 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{v.reopenNote}</p>
        </div>
      )}
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
        {/* Availability window — this unit is offered on a 1-year lease from the upcoming start date */}
        <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--jade-tint, #eef8f4)', border: '1px solid #bfe3d6', borderRadius: 999, padding: '5px 12px' }}>
          <Calendar size={13} style={{ color: 'var(--jade-deep, #1f5a3f)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--jade-deep, #1f5a3f)' }}>
            Available for a 1-year lease · {fmtDay(defaultStart)} – {fmtDay(availabilityEnd)}
          </span>
        </div>
        {/* Unit location pin */}
        {hasCoords && (
          <div style={{ marginTop: 12 }}>
            <LocationMap latitude={lat} longitude={lng} label={buildingName ?? undefined} height={190} />
          </div>
        )}
      </div>

      {/* Cost summary — totals only, and the only place money appears in
          Step 1. No cheque schedule / count here or in the InterestedPopup:
          the customer commits to the unit first, and the payment breakdown
          reaches them with the rental provider's offer. */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', fontWeight: 600 }}>Cost summary</p>

        {planLoading ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--mute)', fontSize: 13 }}>
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : planError ? (
          <ErrorBox msg={planError} />
        ) : plan ? (
          (() => {
          // Admin / Contract Registration / Commission VAT is collected as ONE
          // cheque, so it reads as one line here too (same rule as the plan).
          const feeVatFils = (plan.adminFeeVatFils ?? 0) + (plan.ejariVatFils ?? 0) + (plan.commissionVatFils ?? 0);
          return (
          <div style={{ display: 'grid', gap: 6 }}>
            {/* Every charge is listed NET and the VAT is its OWN line — the same
                way it is collected (a separate VAT cheque, per the landlord's
                Rent VAT collection setting). Rolling it into "Annual rent (incl.
                VAT)" hid what the customer is actually paying tax on. */}
            <PaymentRow label="Annual rent" amountFils={plan.rentFils} />
            <PaymentRow label="Security deposit" amountFils={plan.securityDepositFils ?? 0} />
            <PaymentRow label="Admin fee" amountFils={plan.adminFeeFils ?? 0} />
            <PaymentRow label="Contract Registration Fee" amountFils={plan.ejariFils ?? 0} />
            <PaymentRow label="Commission" amountFils={plan.commissionFils ?? 0} />
            {(plan.customFees ?? []).map((f, i) => (
              <PaymentRow key={i} label={f.label} amountFils={f.netFils + f.vatFils} />
            ))}
            {(plan.rentVatFils ?? 0) > 0 && (
              <PaymentRow label={`Rental VAT${plan.rentVatRate ? ` (${plan.rentVatRate}%)` : ''}`} amountFils={plan.rentVatFils ?? 0} />
            )}
            {feeVatFils > 0 && <PaymentRow label="Fees VAT" amountFils={feeVatFils} />}
            <div style={{ borderTop: '1px solid var(--mist-strong)', margin: '6px 0' }} />
            <PaymentRow label="Total payable" amountFils={plan.totalAmountFils} bold />
            <p style={{ fontSize: 11, color: 'var(--mute)', margin: '8px 0 0', lineHeight: 1.4 }}>
              You&rsquo;ll pick a payment frequency (annual, semi-annual, quarterly, etc.) when you tap <b>I&rsquo;m Interested</b> — your rental provider confirms the payment schedule with your offer.
            </p>
          </div>
          );
          })()
        ) : null}
      </div>

      {/* Actions */}
      {/* Reschedule is only offered while the viewing is still upcoming
          (scheduled / confirmed). Once the RP marks it completed/no-show or it's
          cancelled, the slot can't be moved — hide the button so the customer
          isn't shown an action the backend will reject. */}
      {(() => {
        const canReschedule = v.status === 'scheduled' || v.status === 'confirmed';
        return (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <PrimaryBtn onClick={() => setModal('interested')}>
              <CheckCircle2 size={16} /> I&rsquo;m Interested
            </PrimaryBtn>
            {canReschedule && <SecondaryBtn onClick={() => setModal('reschedule')}>Reschedule</SecondaryBtn>}
            <SecondaryBtn onClick={() => setModal('not_interested')}>Not interested</SecondaryBtn>
          </div>
        );
      })()}

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
  // Occupants are residential-only. Commercial / industrial / mixed-use
  // commercial unit types are leased to a business, so we neither ask for nor
  // send occupant counts (no number-of-occupants, children or pets).
  const residential = isResidentialUnitType(viewing.unit?.unitType ?? null);
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
  const calBodyRef = useRef<HTMLDivElement>(null);
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
    // The calendar expands in flow — if it opens near the bottom of the modal
    // body, bring it fully into view instead of leaving it half cut off.
    calBodyRef.current?.scrollIntoView({ block: 'nearest' });
    return () => document.removeEventListener('mousedown', close);
  }, [calOpen]);

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
          occupantsAdults: residential ? occupants : 1,
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
        {/* Occupants — residential only */}
        {residential && (
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
        )}

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
            {/* Inline (in-flow) calendar, NOT an absolute popover: the modal
                body is a scroll container, so an overlay would be clipped by
                it and collide with the footer. Expanding in flow lets the
                modal grow / scroll around it. */}
            {calOpen && (
              <div ref={calBodyRef} style={{ marginTop: 6, background: 'var(--paper)', borderRadius: 12, border: '1px solid var(--mist-strong)', padding: 14 }}>
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

        {/* No money is shown here by design — the customer only answers the
            three questions above. Amounts, the cheque schedule and payment
            method all come later, once the rental provider has reviewed the
            lead and issued the offer. */}

        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  );
}

function RescheduleModal({ viewing, onClose, onSuccess }: { viewing: ApiViewing; onClose: () => void; onSuccess: () => void }) {
  const SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
  const today = new Date().toISOString().slice(0, 10);
  // Current slot (date + time in app timezone) — used to block rescheduling to
  // the SAME slot the customer already holds (that's a no-op).
  const cur = viewing?.scheduledAt ? new Date(viewing.scheduledAt) : null;
  const curDate = cur ? cur.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE }) : '';
  const curTime = cur ? cur.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: APP_TIME_ZONE }) : '';
  const curLabel = cur ? cur.toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: APP_TIME_ZONE }) : '';
  // Default to the viewing's CURRENT date (fallback today) so the greyed-out
  // current slot is visible. The time is left unselected — the current slot is
  // shown disabled, not pre-picked, so they choose a fresh time.
  const [date, setDate] = useState((curDate && curDate >= today) ? curDate : today);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!date || !time) { setErr('Pick both a date and a time.'); return; }
    if (date === curDate && time === curTime) { setErr('That’s already your current viewing time — pick a different slot.'); return; }
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
        {curLabel && <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }}>Currently: {curLabel}</div>}
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>New date</label>
          <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Time slot</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {SLOTS.map(s => {
              const isCurrent = date === curDate && s === curTime;   // the slot they already hold
              return (
                <button key={s} type="button" disabled={isCurrent} onClick={() => setTime(s)}
                  title={isCurrent ? 'Your current viewing time' : undefined}
                  style={{ padding: '10px 8px', borderRadius: 10, border: `1.5px solid ${time === s ? 'var(--jade)' : 'var(--mist-strong)'}`, background: isCurrent ? 'var(--mist)' : time === s ? 'var(--jade-soft)' : 'var(--paper)', color: isCurrent ? 'var(--mute)' : time === s ? 'var(--jade-deep)' : 'var(--ink-2)', fontSize: 13, fontWeight: 600, cursor: isCurrent ? 'not-allowed' : 'pointer', opacity: isCurrent ? 0.55 : 1, fontFamily: 'inherit' }}>
                  {s}{isCurrent ? ' ·now' : ''}
                </button>
              );
            })}
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
/** "Not residential" — commercial AND industrial, since this flow only splits
 *  the checklist two ways. Defers to lib/unitTaxonomy rather than the inlined
 *  list that used to sit here, which had drifted (it never learned that
 *  accommodation lets are commercial). */
const isNonResidentialUnitType = (unitType?: string | null): boolean =>
  !!unitType && deriveSpaceCategoryFromUnitType(unitType) !== 'residential';

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
      <PersonalNationalityField initial={user?.nationality ?? ''} onSaved={onSaved} />
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

/**
 * Nationality is a closed list, not free text — a typed value would never
 * match what contracts / Ejari expect. Rendered as a dropdown whether the
 * value came from the Emirates ID scan or from the customer.
 *
 * A scanned value is snapped onto the list (the ID prints the COUNTRY,
 * "Pakistan", while we store the demonym, "Pakistani"). If it still can't be
 * matched it is kept as a selectable option flagged "from your Emirates ID",
 * so an unusual scan is never silently dropped — the customer just picks the
 * right entry over it.
 */
function PersonalNationalityField({ initial, onSaved }: { initial: string; onSaved: () => Promise<unknown> | void }) {
  const [value, setValue] = useState(() => normalizeNationality(initial));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(normalizeNationality(initial));
  }, [initial]);

  const scannedExtra = value && !NATIONALITIES.includes(value) ? value : null;

  async function setAndSave(next: string) {
    if (next === value) return;
    setValue(next);
    setSaving(true); setErr(null);
    try {
      await apiPatch('/auth/me', { nationality: next || null });
      setSaved(true);
      await onSaved();
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
        Nationality
        {saving && <span style={{ color: 'var(--saffron)', display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'none', letterSpacing: 0 }}><Loader2 size={10} className="animate-spin" /> Saving</span>}
        {saved && !saving && <span style={{ color: 'var(--jade-deep)', textTransform: 'none', letterSpacing: 0 }}>Saved ✓</span>}
      </span>
      <select
        value={value}
        onChange={e => setAndSave(e.target.value)}
        style={{
          padding: '8px 10px', borderRadius: 9, border: `1px solid ${err ? 'var(--brick)' : 'var(--mist-strong)'}`,
          background: 'var(--paper)', fontSize: 13, color: value ? 'var(--ink)' : 'var(--mute)',
          outline: 'none', fontFamily: 'inherit', width: '100%', appearance: 'auto',
        }}>
        <option value="">Select nationality…</option>
        {scannedExtra && <option value={scannedExtra}>{scannedExtra} (from your Emirates ID)</option>}
        {NATIONALITIES.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
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

/** Blank, NON-editable placeholder for the Personal details section shown
 *  BEFORE the Emirates ID is uploaded/read. The five fields stay empty and
 *  locked — they fill in automatically once the Emirates ID is read. Only if
 *  that auto-read fails, or the customer flags a mistake, do the fields become
 *  editable (see the manual-entry and edit-toggle paths). */
function PersonalDetailsPlaceholder() {
  const fields = ['First name', 'Last name', 'Gender', 'Nationality', 'Emirates ID'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }} aria-hidden>
      {fields.map(label => (
        <div key={label} style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</span>
          <div style={{ padding: '8px 10px', borderRadius: 9, border: '1px dashed var(--mist-strong)', background: 'var(--mist)', fontSize: 13, color: 'var(--mute)', minHeight: 35, display: 'flex', alignItems: 'center' }}>—</div>
        </div>
      ))}
    </div>
  );
}

/** Populated personal details shown as READ-ONLY chips (auto-filled from the
 *  Emirates ID). The customer confirms them at a glance; if something is wrong
 *  they tap "Edit details" to switch the fields into the editable form. */
function PersonalDetailsConfirm({ user, onSaved }: { user: AuthUser; onSaved: () => Promise<unknown> | void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <PersonalDetailsEditor user={user} onSaved={onSaved} />;
  const gender = user?.gender ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) : '—';
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <PersonalChip label="First name"  value={user?.firstName ?? '—'} />
        <PersonalChip label="Last name"   value={user?.lastName ?? '—'} />
        <PersonalChip label="Gender"      value={gender} />
        {/* Shown as the country, matching the dropdown — an older record holding
            the adjective ("Pakistani") reads back as "Pakistan". */}
        <PersonalChip label="Nationality" value={normalizeNationality(user?.nationality) || '—'} />
        <PersonalChip label="Emirates ID" value={user?.emiratesIdNumber ?? '—'} mono />
      </div>
      <button type="button" onClick={() => setEditing(true)}
        style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--jade-deep)', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>
        <Pen size={12} /> Something not right? Edit details
      </button>
    </>
  );
}

/**
 * Company details for a COMPANY customer — who the tenancy is actually with.
 * The company name and trade licence go on the Ejari contract, so they're shown
 * (and editable) here rather than left implicit behind the signatory's ID.
 * Saves through PATCH /profiles/customer/me, the same endpoint the profile page
 * uses, so the value the contract reads is the value edited here.
 */
function CompanyDetailsCard({
  companyName, tradeLicenseNumber, tradeLicenseAuthority, onSaved,
}: {
  companyName: string | null;
  tradeLicenseNumber: string | null;
  tradeLicenseAuthority: string | null;
  onSaved: () => Promise<unknown> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(companyName ?? '');
  const [licence, setLicence] = useState(tradeLicenseNumber ?? '');
  const [authority, setAuthority] = useState(tradeLicenseAuthority ?? '');
  // A legacy free-text authority (or one we don't list) opens the "Other" input
  // instead of silently dropping the value the customer already has.
  const [otherAuthority, setOtherAuthority] = useState(
    !!tradeLicenseAuthority && !isKnownAuthority(tradeLicenseAuthority),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const complete = !!(companyName && tradeLicenseNumber);
  const pill = complete
    ? { text: 'Provided', color: 'var(--jade-deep)', bg: 'var(--jade-soft)' }
    : { text: 'Action needed', color: 'var(--brick)', bg: 'var(--brick-soft)' };

  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/profiles/customer/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: name.trim(),
          tradeLicenseNumber: licence.trim(),
          tradeLicenseAuthority: authority.trim(),
        }),
      });
      if (!res.ok) throw new Error('Could not save your company details');
      await onSaved();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save your company details');
    } finally { setSaving(false); }
  }

  return (
    <div data-testid="company-details" style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, flex: 1 }}>Company details</p>
        <span style={{ fontSize: 10, fontWeight: 700, color: pill.color, background: pill.bg, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{pill.text}</span>
      </div>
      <p style={{ fontSize: 11, color: 'var(--mute)', margin: '0 0 10px', lineHeight: 1.4 }}>
        The tenancy is in the company&rsquo;s name — these go on the contract and its registration.
      </p>

      {editing || !complete ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Company name</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Upnow Trading LLC"
                style={{ fontSize: 13, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--mist-strong)', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'inherit' }} />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Trade licence no.</span>
              <input value={licence} onChange={e => setLicence(e.target.value)} placeholder="123456"
                style={{ fontSize: 13, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--mist-strong)', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
            </label>
            <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Issuing authority</span>
              {/* Options carry the SHORT CODE only — a native select sizes itself
                  to its longest option, and the full authority names blew the
                  field past its column. The full name is shown underneath the
                  chosen code instead. "Other" keeps an unlisted / legacy
                  authority enterable rather than forcing a wrong pick. */}
              <select
                value={otherAuthority ? '__other__' : authority}
                onChange={e => {
                  if (e.target.value === '__other__') { setOtherAuthority(true); setAuthority(''); }
                  else { setOtherAuthority(false); setAuthority(e.target.value); }
                }}
                style={{ width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', fontSize: 13, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--mist-strong)', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'inherit' }}
              >
                <option value="">Select…</option>
                {licenseAuthorityGroups().map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map(a => <option key={a.code} value={a.code} title={a.name}>{a.code}</option>)}
                  </optgroup>
                ))}
                <option value="__other__">Other…</option>
              </select>
              {otherAuthority ? (
                <input value={authority} onChange={e => setAuthority(e.target.value)} placeholder="Name of the issuing authority" autoFocus
                  style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', marginTop: 2, fontSize: 13, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--mist-strong)', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'inherit' }} />
              ) : authorityName(authority) ? (
                <span style={{ fontSize: 10.5, color: 'var(--mute)', lineHeight: 1.35 }}>{authorityName(authority)}</span>
              ) : null}
            </label>
          </div>
          {err && <p style={{ fontSize: 11.5, color: 'var(--brick)', margin: '8px 0 0' }}>{err}</p>}
          <button type="button" onClick={save} disabled={saving || !name.trim() || !licence.trim()}
            style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--jade)', border: 'none', borderRadius: 9, padding: '8px 14px', cursor: saving ? 'default' : 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', opacity: saving || !name.trim() || !licence.trim() ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save company details'}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <PersonalChip label="Company name"     value={companyName ?? '—'} />
            <PersonalChip label="Trade licence no." value={tradeLicenseNumber ?? '—'} mono />
            <PersonalChip label="Issuing authority" value={authorityLabel(tradeLicenseAuthority) || '—'} />
          </div>
          <button type="button" onClick={() => setEditing(true)}
            style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--jade-deep)', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>
            <Pen size={12} /> Something not right? Edit company details
          </button>
        </>
      )}
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
  // The customer only uploads — expiry on identity / licence docs is read off the copy
  // and recorded by the rental provider at review time, so there's no date field here.
  const onPick = (f: File) => onUpload(req, f);
  // A just-uploaded local preview always wins over a stale server status
  // (e.g. re-uploading over a rejected doc before the refetch lands).
  const isRejected = existing?.status === 'rejected' && !local;
  const isApproved = (existing?.status === 'complete' || existing?.status === 'processed') && !local;
  // On-file = uploaded and not in a needs-action state.
  const onFile     = (!!existing && existing.status !== 'rejected' && existing.status !== 'missing') || !!local;
  const isPending  = onFile && !isApproved;
  const uploaded   = onFile && !isRejected; // visual "done" / green
  const previewUrl = local?.url ?? (existing?.fileUrl ?? null);
  const mime       = local?.mime ?? (existing as { mimeType?: string } | undefined)?.mimeType ?? '';
  const isImg      = mime.startsWith('image/');
  const isUp       = docUploading === req.key;
  const actionLabel = isRejected ? 'Re-upload' : uploaded ? 'Replace' : 'Upload';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {/* The row is a plain <div>, never a <label>. A <label> with no `for` takes
        its control from the FIRST *labelable* descendant in tree order — and a
        <button> is labelable. Once a doc is on file the preview button renders
        ahead of the file input, so a row-wide <label> handed every click to the
        viewer button and the file picker never opened: "Replace" did nothing.
        The picker now hangs off its own <label> around the action pill alone —
        the same shape the payment-reference rows below already use. */}
    <div data-doc-key={req.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, background: isRejected ? 'var(--brick-soft)' : uploaded ? 'rgba(46,159,130,0.06)' : 'var(--paper)', border: `1.5px solid ${isRejected ? 'var(--brick)' : uploaded ? 'rgba(46,159,130,0.35)' : 'var(--mist-strong)'}` }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: isRejected ? 'rgba(193,74,52,0.12)' : uploaded ? 'rgba(46,159,130,0.12)' : 'var(--mist)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {isRejected ? <AlertCircle size={18} style={{ color: 'var(--brick)' }} /> : uploaded ? <CheckCircle2 size={18} style={{ color: 'var(--jade-deep)' }} /> : <FileText size={18} style={{ color: 'var(--mute)' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{req.label}</p>
          {req.required
            ? <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--brick)', background: 'var(--brick-soft)', padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Required</span>
            : <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--mute)', background: 'var(--mist)', padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Optional</span>}
        </div>
        {isRejected ? (
          <p style={{ fontSize: 11, color: 'var(--brick)', fontWeight: 600, margin: '3px 0 0' }}>
            Rejected — re-upload required
            {existing?.notes && <span style={{ fontWeight: 400, color: 'var(--ink-2)' }}> · {existing.notes}</span>}
          </p>
        ) : isApproved ? (
          <p style={{ fontSize: 11, color: 'var(--jade-deep)', fontWeight: 600, margin: '3px 0 0' }}>Approved ✓</p>
        ) : isPending ? (
          <p style={{ fontSize: 11, color: 'var(--mute)', margin: '3px 0 0' }}>Uploaded · awaiting review</p>
        ) : req.hint ? (
          <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>{req.hint}</p>
        ) : null}
        {/* Shown for a REJECTED doc too. It used to be hidden because the
            thumbnail button swallowed the row-wide label's click and the
            customer could not re-attach; the picker no longer depends on the
            row, and seeing the copy that was turned down is exactly what tells
            them which file to replace. */}
        {previewUrl && (
          <div style={{ marginTop: 6 }}>
            {isImg
              ? <button type="button" onClick={() => openDocViewer({ fileUrl: previewUrl, caption: req.label, mimeType: mime })} style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}><img src={previewUrl} alt={req.label} style={{ width: 80, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--mist-strong)' }} /></button>
              : <button type="button" onClick={() => openDocViewer({ fileUrl: previewUrl, caption: req.label, mimeType: mime })} style={{ fontSize: 11, color: 'var(--jade-deep)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}><FileText size={12} /> View PDF</button>}
          </div>
        )}
      </div>
      {/* The one and only hit target for the picker. The action word always
          renders (it used to appear only on an uploaded/rejected row, which was
          survivable while the whole row was clickable — now a bare icon would be
          the entire tap target). */}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, padding: '7px 12px', borderRadius: 9, border: `1px solid ${isRejected ? 'var(--brick)' : uploaded ? 'rgba(46,159,130,0.35)' : 'var(--mist-strong)'}`, background: 'var(--paper)', fontSize: 11, fontWeight: 700, color: isRejected ? 'var(--brick)' : uploaded ? 'var(--jade-deep)' : 'var(--ink-2)', cursor: isUp ? 'progress' : 'pointer' }}>
        <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={isUp}
          // Clear the value so re-picking the SAME file still fires onChange —
          // otherwise a customer replacing a doc with a corrected scan of the
          // same name gets silence.
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
        {isUp
          ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--jade-deep)' }} />
          : <UploadCloud size={14} />}
        <span>{isUp ? 'Uploading…' : actionLabel}</span>
      </label>
    </div>
    </div>
  );
}


function InlineKycDocsForm({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const { user, refresh: refreshUser } = useAuth();
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();
  const tenantProfileId = resolved.tenantProfileId;
  const viewing = resolved.viewing;
  const unitType = resolved.unit?.unitType ?? null;
  const isRes = !isNonResidentialUnitType(unitType);
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
    // Images go through the scan modal first; PDFs pass straight through.
    // Null = the user closed the scanner — abort the upload.
    const scanned = await scan(file);
    if (!scanned) return;
    file = scanned;
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
      // The bytes are in the bucket at this point but the document row is what
      // the RP actually sees — an unchecked failure here left an orphaned object
      // and a row still pointing at the OLD file, while the UI claimed success.
      const saved = await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'customer', ownerId: tenantProfileId, documentKey: req.key, category: req.category, displayName: req.label, fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: 's3' }),
      });
      if (!saved.ok) {
        const b = await saved.json().catch(() => ({} as { message?: string }));
        throw new Error(b?.message ?? `Could not save the document (${saved.status})`);
      }
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

  // A rejected (or missing) doc does NOT count as satisfied — mirror the
  // stage resolver so the in-form "Done ✓" pills and Submit gate agree with
  // the top-level "Documents required" routing instead of contradicting it.
  const uploadedKeys = useMemo(() => new Set(resolved.myDocs.filter(d => d.status !== 'missing' && d.status !== 'rejected').map(d => d.documentKey)), [resolved.myDocs]);

  // Base rendered doc lists (keys are stable — promotion below only flips the
  // `required` flag, never the set of rows shown).
  // A COMPANY customer is asked for the company's licence + the identity of the
  // person authorised to sign — never a salary certificate or a marriage
  // certificate, which is what the individual pack asks for.
  const isCompany = resolved.entityType === 'company';
  const kycBase = getKycDocs(resolved.entityType);
  const rentalSection = getRentalSectionDocs(unitType, resolved.entityType);
  // Always render these rows in the Supporting Documents section, even
  // though `required: false`. The customer's natural mental model is
  // "Employment Letter + Bank Statement + Marriage Cert" — hiding them
  // because they're optional would feel like missing UI.
  const SUPPORTING_SHOWN_KEYS = isCompany
    ? rentalSection.map(d => d.key)
    : isRes
      ? ['employment_letter', 'bank_statement', 'marriage_certificate']
      : rentalSection.slice(0, 3).map(d => d.key);
  const supportingPool = isCompany ? rentalSection : (isRes ? RESIDENTIAL_RENTAL_DOCS : rentalSection);
  const financialReqBase = supportingPool.filter(d => SUPPORTING_SHOWN_KEYS.includes(d.key));
  const financialOpt     = supportingPool.filter(d => !SUPPORTING_SHOWN_KEYS.includes(d.key));
  const occupantDocBase  = isRes && occupantCount > 1 ? getOccupantDocs(occupantCount) : [];

  // ── RP-requested additional docs + promotion ────────────────────────────
  // A request that's just another wording of a doc we ALREADY collect (e.g.
  // "UAE Visa / Residence Visa" → the KYC `uae_visa` slot) does NOT create a
  // duplicate slot — it PROMOTES the existing slot to required. We only promote
  // when that slot is actually visible & gateable here, so a request is never
  // silently dropped; anything else becomes its own additional slot as before.
  const requestedNames = resolved.requestedAdditionalDocs ?? [];
  const gateableKeys = new Set<string>([...kycBase.map(d => d.key), 'emirates_id', ...financialReqBase.map(d => d.key), ...occupantDocBase.map(d => d.key)]);
  const promotedKeys = new Set<string>();
  const extraNames: string[] = [];
  for (const name of requestedNames) {
    const std = resolveRequestedDocKey(name);
    const eidSlot = std === 'emirates_id' && (gateableKeys.has('emirates_id_front') || gateableKeys.has('emirates_id'));
    if (std && (eidSlot || gateableKeys.has(std))) {
      promotedKeys.add(std);
      if (std === 'emirates_id') { promotedKeys.add('emirates_id_front'); promotedKeys.add('emirates_id_back'); }
    } else {
      extraNames.push(name);
    }
  }
  const promote = (docs: DocReq[]): DocReq[] => docs.map(d => promotedKeys.has(d.key) ? { ...d, required: true } : d);

  const kycRequired     = promote(kycBase);
  const financialReq    = promote(financialReqBase);
  const occupantDocList = promote(occupantDocBase);

  // Genuinely-new requested docs → their own required upload slots, keyed
  // deterministically (additional_<slug>) so each upload links back to the
  // request on the RP side.
  const additionalDocReqs: DocReq[] = extraNames.map(name => ({
    key: additionalDocKey(name), label: name, category: 'other', required: true,
    hint: 'Requested by your rental provider',
  }));
  const additionalAllDone = additionalDocReqs.length > 0 && additionalDocReqs.every(d => uploadedKeys.has(d.key));

  // Submit gate = every REQUIRED doc across the rendered sections (after
  // promotion) plus any genuinely-additional requests. Optional docs (e.g. an
  // un-promoted UAE Visa, required:false) never block.
  const promotedSupporting = [...financialReq, ...occupantDocList].filter(d => promotedKeys.has(d.key));
  const allRequired      = [...kycRequired, ...additionalDocReqs, ...promotedSupporting].filter(d => d.required);
  // Emirates ID counts as done via a combined file OR both sides (isDocKeySatisfied).
  const allRequiredDone  = allRequired.every(d => isDocKeySatisfied(d.key, uploadedKeys));

  const doneCount = allRequired.filter(d => isDocKeySatisfied(d.key, uploadedKeys)).length;
  const totalCount = allRequired.length;

  // Per-section completion flags drive the KycSection "Done ✓" collapse
  // so finished work stays visible (collapsed, with a green pill) instead
  // of vanishing. Only the REQUIRED KYC rows gate the section's done state.
  const kycAllDone      = kycRequired.filter(d => d.required).every(d => isDocKeySatisfied(d.key, uploadedKeys));
  const supportingDocs  = financialReq;
  const supportingAllDone = supportingDocs.every(d => uploadedKeys.has(d.key));
  const occupantsAllDone  = occupantDocList.length > 0 && occupantDocList.every(d => uploadedKeys.has(d.key));

  // Identity details (name + Emirates ID number) must be present before the
  // customer can submit. Auto-filled by OCR when the Emirates ID is readable;
  // otherwise the customer types them into the Personal Details fallback form.
  // A COMPANY tenancy is identified by the COMPANY — name + trade licence, captured
  // in CompanyDetailsCard above. The signatory's own name/EID number are never
  // collected on this screen: the personal-details card below renders for
  // individuals only ("Individuals only", see !isCompany). Gating a company on
  // those fields is therefore a dead end — when the Emirates ID auto-read returns
  // nothing there is no UI anywhere to fill them, so Submit can never enable.
  const personalDetailsComplete = isCompany
    ? !!(resolved.companyName?.trim() && resolved.tradeLicenseNumber?.trim())
    : !!(user?.firstName?.trim() && user?.emiratesIdNumber?.trim());
  const eidUploaded = uploadedKeys.has('emirates_id') || uploadedKeys.has('emirates_id_front');

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {scannerModal}
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
      {/* A company tenancy is in the COMPANY's name — show (and let them fix)
          the company + trade licence before the signatory's own details. */}
      {isCompany && (
        <CompanyDetailsCard
          companyName={resolved.companyName}
          tradeLicenseNumber={resolved.tradeLicenseNumber}
          tradeLicenseAuthority={resolved.tradeLicenseAuthority}
          onSaved={onRefresh}
        />
      )}

      {/* Individuals only. A company tenancy is identified by the company card
          above; the person signing is captured by their Signatory Emirates ID
          upload, so a second card of personal chips adds nothing. */}
      {!isCompany && (() => {
        const populated = !!(user?.firstName || user?.lastName || user?.emiratesIdNumber);
        // "Error / issue" = the customer uploaded their Emirates ID but we still
        // couldn't capture their details (auto-read failed / returned nothing).
        // Only THEN do we open a manually-editable form. Until an Emirates ID is
        // uploaded, the section stays BLANK and locked — it auto-fills from the ID.
        const needsManual = eidUploaded && !populated && !eidReading;
        const pill = populated
          ? { text: 'Provided',     color: 'var(--jade-deep)', bg: 'var(--jade-soft)' }
          : eidReading
            ? { text: 'Reading…',   color: 'var(--mute)',   bg: 'var(--mist)' }
            : needsManual
              ? { text: 'Action needed', color: 'var(--brick)', bg: 'var(--brick-soft)' }
              : { text: 'From your ID',   color: 'var(--mute)',  bg: 'var(--mist)' };
        return (
          <div data-testid="personal-details" data-state={populated ? 'populated' : eidReading ? 'reading' : needsManual ? 'manual' : 'blank'} style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, flex: 1 }}>
                {isCompany ? 'Authorised signatory' : 'Personal details'}
              </p>
              <span style={{ fontSize: 10, fontWeight: 700, color: pill.color, background: pill.bg, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{pill.text}</span>
            </div>
            {populated ? (
              /* Auto-filled → read-only confirmation. Editable only via the
                 "Something not right? Edit details" toggle (issue path). */
              <>
                <p style={{ fontSize: 11, color: 'var(--mute)', margin: '0 0 10px', lineHeight: 1.4 }}>
                  {isCompany
                    ? 'The person signing for the company — filled from their Emirates ID. Please check it matches exactly.'
                    : 'Filled automatically from your Emirates ID — please check they match it exactly.'}
                </p>
                <PersonalDetailsConfirm user={user} onSaved={refreshUser} />
              </>
            ) : eidReading ? (
              <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
                Reading your Emirates ID… your details will fill in automatically. If they don&apos;t, you can type them in below.
              </p>
            ) : needsManual ? (
              /* Error path — the Emirates ID couldn't be read: unlock the fields
                 so the customer can enter their details manually and not be
                 blocked waiting on the auto-read. */
              <>
                <p style={{ fontSize: 11.5, color: 'var(--brick)', fontWeight: 600, margin: '0 0 10px', lineHeight: 1.45 }}>
                  We couldn&apos;t read your Emirates ID automatically. Please enter your details exactly as they appear on it before continuing.
                </p>
                <PersonalDetailsEditor user={user} onSaved={refreshUser} />
              </>
            ) : (
              /* Default — nothing uploaded yet: keep the section blank and locked.
                 It fills in from the Emirates ID upload below. */
              <>
                <p style={{ fontSize: 11.5, color: 'var(--ink-2)', margin: '0 0 10px', lineHeight: 1.45, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                  <Sparkles size={14} style={{ color: 'var(--jade-deep)', flexShrink: 0, marginTop: 1 }} />
                  <span>These fill in automatically from your Emirates ID. Upload it in the documents below and we&apos;ll do the rest.</span>
                </p>
                <PersonalDetailsPlaceholder />
              </>
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
              {/* The code only appears here when the backend exposes it
                  (EXPOSE_DEV_OTP=true) — and that same flag deliberately
                  suppresses the real email, so say so rather than leaving
                  the tester waiting on an inbox. */}
              {emailDevOtp && (
                <p style={{ fontSize: 11, color: 'var(--mute)', margin: 0, lineHeight: 1.4 }}>
                  Dev environment — the verification email is not sent while the code is shown here. Use the code above.
                </p>
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
      <KycSection title={isCompany ? 'Company & signatory documents' : 'Identity documents (KYC)'} accent allDone={kycAllDone}>
        {kycRequired.map(req => <KycDocRow key={req.key} req={req} myDocs={resolved.myDocs} localPreviews={localPreviews} docUploading={docUploading} onUpload={uploadDoc} />)}
      </KycSection>

      {/* Supporting / business documents. Same persistent-Done pattern. */}
      <KycSection title={isCompany ? 'Company supporting documents' : isRes ? 'Supporting documents' : 'Business documents'} allDone={supportingAllDone}>
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

      {/* Documents your rental provider specifically asked for — each is an
          individual required upload slot. Until they're all on file the journey
          is held at this step (see deriveStateKey's additional-docs gate). */}
      {additionalDocReqs.length > 0 && (
        <KycSection title="Requested by your rental provider" accent allDone={additionalAllDone}>
          {additionalDocReqs.map(req => <KycDocRow key={req.key} req={req} myDocs={resolved.myDocs} localPreviews={localPreviews} docUploading={docUploading} onUpload={uploadDoc} />)}
        </KycSection>
      )}

      {/* Submit — explicit gate. Uploading the last file no longer auto-advances;
          the customer must click here to submit their documents for review. */}
      <PrimaryBtn
        onClick={async () => {
          if (allRequiredDone && personalDetailsComplete) {
            // The local flag is an optimistic echo so the card does not flicker
            // between the click and the refetch. The RECORD is the server call
            // below: this used to write localStorage ONLY, so clearing site data
            // or opening the page on another device silently put the customer
            // back to "documents required", and the landlord had no record a
            // submission had ever happened.
            writeDocsSubmitted(resolved.spaceKey);
            const submitLeadId = resolved.lead?.id ?? resolved.viewing?.leadId ?? null;
            if (submitLeadId) {
              try {
                await apiPatch(`/leads/${submitLeadId}/documents-ready`, {});
              } catch { /* the echo is already shown; the refetch reconciles */ }
            }
          }
          onRefresh();
        }}
        disabled={!allRequiredDone || !personalDetailsComplete}
      >
        {allRequiredDone && personalDetailsComplete ? <CheckCircle2 size={16} /> : <Info size={16} />}
        {!allRequiredDone
          ? `Upload all required docs (${doneCount}/${totalCount} done)`
          : !personalDetailsComplete
            ? (isCompany ? 'Add your company name & trade licence above' : 'Enter your name & Emirates ID above')
            : 'Submit documents for review'}
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
  // A renewal re-verifies ONLY the KYC bases the backend flagged — the full document
  // pack (occupants, financials, the unit category's rental section) was collected on
  // the original lease and is not asked for again. The occupant-count / required-doc
  // scaffolding this component used to carry computed nothing it ever rendered.

  const [prefSaving, setPrefSaving] = useState(false);
  const [prefError,  setPrefError]  = useState<string | null>(null);

  // ── Inline upload ──────────────────────────────────────────────────────
  const [docUploading, setDocUploading] = useState<string | null>(null);
  const [uploadError,  setUploadError]  = useState<string | null>(null);
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();

  /** `slotKey` is the row the customer tapped (what the UI tracks); `targetKey` is
   *  the document key the file is written to, which is the same thing UNLESS this
   *  customer's copy is already filed under a legacy key — then we replace THAT row
   *  rather than adding a second one. Keeping the two apart is the whole fix. */
  async function handleUpload(slotKey: string, req: DocReq, file: File) {
    // Images go through the scan modal first; PDFs pass straight through.
    // Null = the user closed the scanner — abort the upload.
    const scanned = await scan(file);
    if (!scanned) return;
    file = scanned;
    if (!resolved.tenantProfileId) { setUploadError('Customer profile missing.'); return; }
    setDocUploading(slotKey); setUploadError(null);
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
      // No local "just uploaded" flag: onRefresh remounts this tree, so it could not
      // survive anyway — and it isn't needed. A fresh copy is registered undated (the
      // API drops a customer-supplied expiry), so the reload comes back with this base
      // in kycExpiryMissingKeys and the row turns green off server truth alone.
      onRefresh();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setDocUploading(null);
    }
  }

  // Renewal KYC re-verification: re-upload ONLY the expired / blank-expiry KYC docs
  // the backend flagged (EID / passport / visa / trade licence). The RP reviews the
  // fresh copies and accepts them (renewalDocsAcceptedAt) before cheques unlock.
  //
  // Each flagged BASE renders one row per slot the document actually occupies.
  // Emirates ID is TWO slots — front and back — everywhere else in the product
  // (docRequirements.KYC_DOCS, the RP checklist, the tenant binder); asking for
  // "both sides" as one file here was the odd one out, and it forced the customer to
  // choose which side to send.
  const BASE_SLOTS: Record<string, DocReq[]> = {
    emirates_id: [
      { key: 'emirates_id_front', label: 'Emirates ID — Front',  category: 'identity', required: true, hint: 'Clear photo or scan of the FRONT of your current Emirates ID' },
      { key: 'emirates_id_back',  label: 'Emirates ID — Back',   category: 'identity', required: true, hint: 'Clear photo or scan of the BACK of the same Emirates ID' },
    ],
    passport:      [{ key: 'passport',      label: 'Passport',             category: 'identity', required: true, hint: 'Bio-data page of your valid passport' }],
    visa:          [{ key: 'uae_visa',      label: 'UAE Visa / Residency', category: 'identity', required: true, hint: 'Your current UAE residence visa page' }],
    trade_license: [{ key: 'trade_license', label: 'Trade License',        category: 'license',  required: true, hint: 'Current valid UAE trade licence' }],
  };
  /** The document on file for a slot — its own key first, then any legacy key the
   *  same document has historically been filed under (docKeysForSlot). A refresh
   *  must land in the slot the customer's existing copy already occupies, or the
   *  upload creates a second row for one document — the tenant's visa sat under
   *  `visa` while this step wrote to `uae_visa`, so refreshing it left BOTH on file
   *  and the row still read "Tap to upload" over a document they had just sent. */
  const docForSlot = (key: string): TenantDoc | undefined =>
    docKeysForSlot(key).reduce<TenantDoc | undefined>(
      (found, k) => found ?? resolved.myDocs.find(d => d.documentKey === k), undefined);
  /** What COVERS a slot today. Same as docForSlot, except an Emirates ID side also
   *  falls back to a legacy combined `emirates_id` scan: one file showing both sides
   *  does cover both slots (isDocKeySatisfied says so everywhere else), so a customer
   *  holding one must not be told they have sent nothing. It is only the upload
   *  TARGET that stays split — a replacement is sent as two proper sides. */
  const isEidSide = (k: string) => k === 'emirates_id_front' || k === 'emirates_id_back';
  // ...but ONLY while the customer still holds nothing but that combined file. The
  // moment they send one proper side, they have committed to the two-sided form and
  // the combined scan stops standing in for the other one. Without this, replacing
  // just the FRONT marked the whole Emirates ID done: the base went undated, the back
  // row borrowed the old combined file as its cover, and both sides turned green off
  // a single upload — which could carry the whole step to "submitted for review".
  const eidSideOnFile = resolved.myDocs.some(d => isEidSide(d.documentKey) && !!d.fileUrl);
  const coverForSlot = (key: string): TenantDoc | undefined =>
    docForSlot(key)
    ?? (isEidSide(key) && !eidSideOnFile
      ? resolved.myDocs.find(d => d.documentKey === 'emirates_id')
      : undefined);
  /** Where a refresh for this slot is written — the existing row's key, so the
   *  upload REPLACES it in place rather than adding a second copy. */
  const uploadKeyForSlot = (key: string): string => docForSlot(key)?.documentKey ?? key;

  const expiredBases  = resolved.renewalContract?.expiredKycDocKeys ?? [];
  // Flagged only for want of an expiry DATE. The customer cannot supply one — the
  // API ignores a customer-set expiry by design (it is the reviewer's assertion), so
  // their copy is on file and the ball is in the RP's court. Showing these as an
  // amber "Replace" was a dead end: replacing produced another undated copy and the
  // row went amber again, which is exactly what was reported.
  const undatedBases  = resolved.renewalContract?.kycExpiryMissingKeys ?? [];
  const docsAccepted  = !!resolved.renewalContract?.renewalDocsAcceptedAt;
  const docsSubmitted = !!resolved.renewalContract?.renewalDocsSubmittedAt;

  /** Whether this slot still needs a fresh file from the customer. */
  const slotNeedsUpload = (base: string, key: string): boolean => {
    const rec = coverForSlot(key);
    if (rec?.status === 'rejected') return true;      // the RP sent it back — always theirs to redo
    if (!rec?.fileUrl) return true;                   // nothing on file for this side at all
    return !undatedBases.includes(base);              // on file: done unless genuinely expired
  };

  const rows = expiredBases.flatMap(base => (BASE_SLOTS[base] ?? []).map(req => ({ base, req })));
  const outstanding = rows.filter(({ base, req }) => slotNeedsUpload(base, req.key));
  // Nothing outstanding ⇒ ready to hand over. Includes the rows.length === 0 case: a
  // renewal can be routed here by the durable renewalDocsRequiredAt flag and have
  // nothing left flagged, and that customer must still be able to leave the step.
  const allRefreshed = outstanding.length === 0;

  async function handleSubmit() {
    const id = resolved.renewalContract?.id;
    if (!id) return;
    setPrefSaving(true); setPrefError(null);
    try {
      const r = await fetch(`/api/contracts/tenant/${id}/renewal-docs-submitted`, {
        method: 'PATCH', credentials: 'include',
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({} as { message?: string }));
        throw new Error(b?.message ?? `Could not submit (${r.status})`);
      }
      onRefresh();
    } catch (e) {
      setPrefError(e instanceof Error ? e.message : 'Could not submit');
    } finally { setPrefSaving(false); }
  }

  function DocRow({ base, req }: { base: string; req: DocReq }) {
    const rec = coverForSlot(req.key);
    const isRejected = rec?.status === 'rejected';
    const isUploading = docUploading === req.key;
    const needsUpload = slotNeedsUpload(base, req.key);
    // Green = nothing left for the CUSTOMER to do on this row. Either they have just
    // sent a copy, or one is on file and the only thing missing is the expiry date,
    // which only the rental provider can record.
    const done = !needsUpload;
    const accent = needsUpload ? 'var(--saffron-deep, #b45309)' : 'var(--jade-deep)';
    // The customer only uploads — the RP records the expiry when they review the copy.
    const onPick = (f: File) => handleUpload(req.key, { ...req, key: uploadKeyForSlot(req.key) }, f);
    return (
      <label style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
        background: needsUpload ? 'var(--saffron-soft, #fff7ed)' : 'rgba(46,159,130,0.08)',
        border: `1px solid ${needsUpload ? 'var(--saffron, #f59e0b)' : 'rgba(46,159,130,0.35)'}`,
        cursor: isUploading ? 'progress' : 'pointer',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{req.label}</p>
          <p style={{ fontSize: 11, color: needsUpload ? accent : 'var(--jade-deep)', fontWeight: 600, margin: '2px 0 0' }}>
            {/* One instruction for every row still owed, whatever the reason it is
                owed — expired, undated, rejected, or never sent. The customer's
                action is identical in all four cases, so four different sentences
                only made them work out whether they meant different things. A
                rejection reason still rides along: that is information they need,
                not a different instruction. */}
            {needsUpload
              ? <>Upload new copy{isRejected && rec?.notes && <span style={{ fontWeight: 400, color: 'var(--ink-2)' }}> · {rec.notes}</span>}</>
              : 'On file ✓ — your rental provider will confirm its expiry date'}
          </p>
        </div>
        {isUploading ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
          : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: accent, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {done ? <CheckCircle2 size={16} /> : <UploadCloud size={16} />}{done ? 'Replace' : 'Upload'}
            </span>}
        <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
          disabled={isUploading}
          onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); }} />
      </label>
    );
  }

  // Handed over → waiting panel. No button: the RP's acceptance advances the flow,
  // not the customer. A rejected copy re-opens the step (slotNeedsUpload) so the
  // customer is never left waiting on a document the RP already sent back.
  if (!docsAccepted && docsSubmitted && outstanding.length === 0) {
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ background: 'rgba(46,159,130,0.08)', border: '1px solid rgba(46,159,130,0.35)', borderRadius: 14, padding: '16px 18px', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={18} style={{ color: 'var(--jade-deep)' }} />
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Documents submitted for review</p>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0 }}>
            Your rental provider is reviewing your refreshed documents. Once they accept, you&apos;ll move on to prepare your cheques. No further action needed.
          </p>
        </div>
        <WaitingBadge />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {scannerModal}
      {uploadError && <ErrorBox msg={uploadError} />}
      {prefError && <ErrorBox msg={prefError} />}

      {/* Only the expired / undated KYC docs the RP flagged for this renewal. */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '14px 16px', display: 'grid', gap: 8 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 2px' }}>
          Documents to refresh
          <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--mute)', textTransform: 'none', letterSpacing: 0 }}>
            {outstanding.length === 0
              ? `${rows.length} of ${rows.length} ready`
              : `${rows.length - outstanding.length} of ${rows.length} ready`}
          </span>
        </p>
        <p style={{ fontSize: 12, color: 'var(--mute)', margin: '0 0 4px' }}>
          {outstanding.length === 0
            ? 'Everything is in. Submit these for your rental provider to review — they record each document’s expiry date when they check it.'
            : 'These identity documents need a current copy for the renewal. Your rental provider records each expiry date when they review them, so you only need to send the file.'}
        </p>
        {rows.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--mute)', margin: 0 }}>No documents need refreshing.</p>
          : rows.map(({ base, req }) => <DocRow key={req.key} base={base} req={req} />)
        }
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!allRefreshed || prefSaving}
          style={{
            width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none',
            fontSize: 14.5, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: allRefreshed ? 'var(--jade-deep)' : 'var(--mist)',
            color: allRefreshed ? 'var(--paper)' : 'var(--mute)',
            cursor: allRefreshed && !prefSaving ? 'pointer' : 'not-allowed',
          }}
        >
          {prefSaving ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : <><CheckCircle2 size={16} /> Submit for review</>}
        </button>
        <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info size={13} />
          {allRefreshed
            ? 'Your rental provider will review and accept these before you prepare cheques.'
            : `Send the remaining ${outstanding.length === 1 ? 'document' : `${outstanding.length} documents`} to enable this.`}
        </p>
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
<html><head><meta charset="utf-8" /><title>Payment Summary — ${buildingName}</title>
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
  <h1>Payment Summary</h1>
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
    ${plan.ejariFils ? `<div class="l">Contract Registration Fee</div><div class="v">${aed(plan.ejariFils)}</div>` : ''}
    ${plan.commissionFils ? `<div class="l">Commission</div><div class="v">${aed(plan.commissionFils)}</div>` : ''}
    ${(plan.customFees ?? []).map(f => `<div class="l">${String(f.label).replace(/</g, '&lt;')}</div><div class="v">${aed(f.netFils + f.vatFils)}</div>`).join('')}
    ${(plan.rentVatFils ?? 0) > 0 ? `<div class="l">Rental VAT${plan.rentVatRate ? ` (${plan.rentVatRate}%)` : ''}</div><div class="v">${aed(plan.rentVatFils ?? 0)}</div>` : ''}
    ${((plan.adminFeeVatFils ?? 0) + (plan.ejariVatFils ?? 0) + (plan.commissionVatFils ?? 0)) > 0 ? `<div class="l">Fees VAT</div><div class="v">${aed((plan.adminFeeVatFils ?? 0) + (plan.ejariVatFils ?? 0) + (plan.commissionVatFils ?? 0))}</div>` : ''}
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
function DocsUnderReviewAction() {
  // No payment plan / summary at this stage: the stage copy promises the payment
  // summary + contract preview unlock only AFTER the team approves the documents
  // (that's the payment_review step, PaymentPlanAction). Showing it while docs are
  // still under review pre-empts that and contradicts the messaging.
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <WaitingBadge />
    </div>
  );
}

/** Reusable summary card showing the lump-sum fee breakdown + the full cheque
 *  schedule from a PaymentPlan. NOT rendered at docs_under_review anymore (the
 *  plan stays hidden until the team approves and the payment_review step opens);
 *  kept as a reusable card for that later step. */
function PaymentPlanSummary({ plan }: { plan: ApiPaymentPlan }) {
  const items = plan.items ?? [];
  const installments = plan.installmentCount ?? Math.max(1, plan.chequeCount - 1);
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
      <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', fontWeight: 600 }}>Payment summary</p>

      <div style={{ display: 'grid', gap: 6, marginBottom: items.length ? 14 : 0 }}>
        <PaymentRow label={`Annual rent${(plan.rentVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`} amountFils={plan.rentFils + (plan.rentVatFils ?? 0)} />
        <PaymentRow label="Security deposit" amountFils={plan.securityDepositFils ?? 0} />
        <PaymentRow label={`Admin fee${(plan.adminFeeVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`} amountFils={(plan.adminFeeFils ?? 0) + (plan.adminFeeVatFils ?? 0)} />
        <PaymentRow label={`Contract Registration Fee${(plan.ejariVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`} amountFils={(plan.ejariFils ?? 0) + (plan.ejariVatFils ?? 0)} />
        <PaymentRow label={`Commission${(plan.commissionVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`} amountFils={(plan.commissionFils ?? 0) + (plan.commissionVatFils ?? 0)} />
        {(plan.customFees ?? []).map((f, i) => (
          <PaymentRow key={i} label={`${f.label}${f.vatFils > 0 ? ' (incl. VAT)' : ''}`} amountFils={f.netFils + f.vatFils} />
        ))}
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
/**
 * The attach control that sits on a payment row / group heading.
 *
 * It is not just an upload button: whatever the customer attached has to be
 * viewable and removable from the same place. Before this, a reference tagged
 * to a payment was write-only — the thumbnail + View + Remove existed only for
 * the untagged "all together" bucket, so once attaching moved onto the rows the
 * customer could no longer see what they had sent.
 */
function PlanAttachCell({ slot, refs, uploading, onFiles, onRemove }: {
  slot: PlanAttachSlot;
  refs: CustomerCheque[];
  uploading: number;
  /** `replaceIds` are dropped only AFTER the new files are stored. */
  onFiles: (label: string, files: FileList | null, replaceIds?: number[]) => void;
  onRemove: (id: number) => void;
}) {
  const viewable = refs.filter(r => !!r.imageUrl);
  // One line, one control each: open it · add to it · delete it. No thumbnail —
  // it opened the same viewer "View" does, so the row carried the same action
  // twice in the width of a table cell.
  const openAll = () => openDocViewer(
    viewable.map(r => ({ fileUrl: r.imageUrl as string, caption: slot.label })),
    slot.label,
  );
  return (
    // Wraps rather than overflows: in a narrow card the three controls don't fit
    // on one line, and clipping them is what made the row look like it had no
    // attach option at all.
    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 7 }}>
      {viewable.length > 0 && (
        <button type="button" onClick={openAll} title={`View what you attached to ${slot.label}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', padding: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--jade-deep)', cursor: 'pointer' }}>
          <ExternalLink size={11} /> View{viewable.length > 1 ? ` (${viewable.length})` : ''}
        </button>
      )}
      {/* "Replace", not "Attached" — every control on this row is an action, and
          it genuinely replaces: the files picked here become the ONLY ones on
          this payment. The count moves onto View, which is what it describes. */}
      <label
        title={refs.length
          ? `Replace the ${refs.length > 1 ? `${refs.length} files` : 'file'} attached to this payment`
          : 'Attach a cheque photo, transfer screenshot, card slip or cash receipt'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8,
          border: `1px solid ${refs.length ? 'rgba(46,159,130,0.4)' : 'var(--mist-strong)'}`,
          background: refs.length ? 'rgba(46,159,130,0.07)' : 'var(--paper)',
          cursor: uploading ? 'progress' : 'pointer', fontSize: 11, fontWeight: 700,
          color: refs.length ? 'var(--jade-deep)' : 'var(--ink-2)', whiteSpace: 'nowrap',
        }}>
        <input type="file" accept="image/*,application/pdf" multiple disabled={uploading > 0}
          onChange={(e) => { onFiles(slot.label, e.target.files, refs.map(r => r.id)); e.target.value = ''; }}
          style={{ display: 'none' }} />
        <UploadCloud size={12} /> {refs.length ? 'Replace' : 'Attach'}
      </label>
      {refs.length > 0 && (
        <button type="button" onClick={() => refs.forEach(r => onRemove(r.id))}
          title={refs.length > 1 ? `Delete all ${refs.length} files for this payment` : 'Delete this file'}
          aria-label={refs.length > 1 ? `Delete all ${refs.length} files for ${slot.label}` : `Delete the file for ${slot.label}`}
          style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function PaymentPlanAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const { user } = useAuth();
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();
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

  async function uploadOneCheque(file: File, label: string) {
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
      body: JSON.stringify({ imageUrl: fileUrl, fileKey, label }),
    });
    if (!regRes.ok) {
      const b = await regRes.json().catch(() => ({}));
      throw new Error(b?.message ?? 'Cheque registration failed');
    }
    return (await regRes.json()) as CustomerCheque;
  }

  async function handleChequeFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Each cheque photo goes through the scan modal in turn (auto-crop +
    // clean-up); PDFs pass straight through; a cancelled scan skips that file.
    const ready: File[] = [];
    for (const picked of Array.from(files)) {
      const scanned = await scan(picked);
      if (scanned) ready.push(scanned);
    }
    if (ready.length === 0) {
      if (chequeFileInputRef.current) chequeFileInputRef.current.value = '';
      return;
    }
    setUploadErr(null);
    setUploadingFiles(ready.length);
    let nextIndex = uploads.length + 1;
    try {
      for (const file of ready) {
        const saved = await uploadOneCheque(file, `Reference ${nextIndex}`);
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

  /**
   * Attach files to one payment. When `replaceIds` is given the control said
   * "Replace", so those earlier files are dropped — but only AFTER the new ones
   * are safely stored, so a failed upload can never leave the payment with
   * nothing attached where the customer had already provided a reference.
   */
  async function handleSlotFiles(slotLabel: string, files: FileList | null, replaceIds?: number[]) {
    if (!files || files.length === 0) return;
    // Same scan-first pass as the bulk control (see handleChequeFiles).
    const ready: File[] = [];
    for (const picked of Array.from(files)) {
      const scanned = await scan(picked);
      if (scanned) ready.push(scanned);
    }
    if (ready.length === 0) return;
    setUploadErr(null);
    setUploadingFiles(ready.length);
    try {
      const saved: CustomerCheque[] = [];
      for (const file of ready) {
        const one = await uploadOneCheque(file, slotLabel);
        if (one) saved.push(one);
      }
      if (saved.length) setUploads(prev => [...prev, ...saved]);
      if (saved.length && replaceIds?.length) {
        for (const id of replaceIds) await removeUpload(id);
      }
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingFiles(0);
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

  // Full segregated plan — the four customer-facing groups (Security Deposit ·
  // Rental Income · Management Fee · Third Party), built from the RP-issued items
  // so amounts + per-instalment due dates match exactly what was proposed.
  const segRows = segRowsFromCustomerPlan(plan);
  const seg = buildSegregatedPlan(segRows);
  const rp = resolved.unit?.property?.rentalProvider ?? resolved.unit?.property?.rental_provider;
  const planMeta = {
    landlordName: rp?.user?.name?.trim() || rp?.companyName?.trim() || null,
    unitNumber: resolved.unit?.unitNumber ?? null,
    buildingName: resolved.unit?.property?.buildingName ?? null,
    community: resolved.unit?.property?.community?.name ?? null,
  };
  // One payment slot per physical cheque/transfer: Security Deposit ×1, Rent ×N
  // (per instalment), Management Fee combined ×1, Third Party combined ×1 — so a
  // 4-instalment plan is 7 payments. These labels are what an upload is TAGGED
  // with, and SegregatedPlanView now derives the identical labels when it renders
  // the inline attach controls; this list only classifies existing uploads.
  const paymentSlots = seg.groups.flatMap(g =>
    g.key === 'rental'
      ? g.lines.map((l, i) => ({ key: `rent-${i}`, label: `Rent — ${l.item}`, amount: l.amount, dueDate: l.dueDate }))
      : [{ key: g.key, label: g.title, amount: g.total, dueDate: g.lines.map(l => l.dueDate).filter((d): d is string => !!d).sort().pop() ?? null }],
  );
  // Uploads NOT tagged to a specific slot — shown in the "everything together" bucket.
  const bulkUploads = uploads.filter(u => !paymentSlots.some(s => s.label === (u.notes ?? '')));

  // Note: the plan is intentionally method-agnostic on the customer side.
  // The customer just declares "here are my payment references" — cheque
  // photos, transfer screenshots, card slips, cash receipts. The landlord
  // classifies each one (cheque / bank transfer / card / cash) when they
  // approve it on the RP side.

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {scannerModal}

      {/* The SAME Payment Summary card the lease and the landlord's lead view use
          — so the plan the customer is quoted looks like the one they sign. */}
      <PaymentPlanCard
        rows={segRows}
        contractType="new"
        tenantName={resolved.contract?.tenantCompanyName || personName(user) || null}
        landlordName={planMeta.landlordName}
        unitNumber={planMeta.unitNumber}
        buildingName={planMeta.buildingName}
        community={planMeta.community}
        periodStart={resolved.viewing?.desiredMoveIn?.slice(0, 10) ?? null}
        bankDetails={plan.bankDetails}
        // The attach control lives ON each payment row. It used to be a second
        // block underneath that re-listed the very same payments, so the customer
        // read the plan, then matched it line-by-line against a near-identical
        // list to work out which upload went where.
        renderAttach={(slot) => (
          <PlanAttachCell
            slot={slot}
            refs={uploads.filter(u => (u.notes ?? '') === slot.label)}
            uploading={uploadingFiles}
            onFiles={handleSlotFiles}
            onRemove={removeUpload}
          />
        )}
        headerAction={
          <>
            <span style={{ fontSize: 10, color: 'var(--mute)', fontWeight: 500 }}>Issued {fmtDateShort(plan.issuedAt)}</span>
            <button type="button" onClick={() => printPaymentPlan(resolved, resolved.contract?.tenantCompanyName || personName(user) || '—')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--jade-deep)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Printer size={12} /> Print / Save PDF
            </button>
          </>
        }
      />
      {plan.notes && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontWeight: 600 }}>Notes from your rental provider</p>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{plan.notes}</p>
        </div>
      )}
      {/* ── Or upload all references together (bucket) ── */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
            Or upload all your references together
          </p>
          <span style={{ fontSize: 11, color: 'var(--mute)' }}>{bulkUploads.length} uploaded</span>
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

        {bulkUploads.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {bulkUploads.map((c, i) => (
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
  if (!c) return <ErrorBox msg="Contract not found." />;

  // The customer has signed but the landlord hasn't countersigned yet — show a
  // waiting state instead of the sign pad, so they are never asked to sign twice.
  if (c.tenantSignedAt && !c.landlordSignedAt) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderRadius: 12, background: 'var(--jade-soft, #eef8f4)', border: '1px solid var(--jade)', color: 'var(--jade-deep, #1f5a3f)', fontSize: 14, fontWeight: 600 }}>
        <CheckCircle2 size={18} /> You&rsquo;ve signed. Waiting for your rental provider to countersign — we&rsquo;ll notify you the moment it&rsquo;s done.
      </div>
    );
  }

  async function onSign(p: SignaturePayload) {
    const res = await fetch(`/api/contracts/tenant/${c!.id}/sign`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signatoryName: p.signatoryName, signatureImage: p.signatureImage, consent: p.consent, clientMeta: p.clientMeta, geo: p.geo, stampImage: p.stampImage ?? null }) });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
    onRefresh();
  }

  // Company stamp (0258): offered on commercial leases — required for a
  // company customer, optional for an individual. Mirrors the sign endpoint's
  // rule (companyName covers rows that predate entity_type). The renewal child
  // carries the same unit/property, so a renewal follows the same gate.
  const commercialLease = effectiveSpaceCategory(c.unit?.unitType ?? resolved.unit?.unitType, c.property?.spaceCategory) !== 'residential';
  const companyCustomer = resolved.entityType === 'company' || !!resolved.companyName || !!c.tenantCompanyName;
  const stamp = commercialLease ? { required: companyCustomer } : null;

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

      <SignatureBlock
        signerRole="Customer"
        signerName={personName(user)}
        defaultName={personName(user)}
        termsText={renewal
          ? 'I have reviewed and agree to the terms of this renewal.'
          : 'I have reviewed and agree to all terms of this tenancy contract.'}
        submitLabel={renewal ? 'Sign renewal' : 'Sign contract'}
        alreadySigned={false}
        stamp={stamp}
        onSign={onSign}
      />
    </div>
  );
}

/* ─── UTILITY — under review (customer submitted, RP hasn't verified yet) ── */
function UtilityReviewWaitAction({ resolved }: { resolved: Resolved }) {
  const acc = resolved.contract?.utilityAccountNumber;
  const proof = (resolved.myDocs ?? []).find(d => d.documentKey === 'utility_proof_of_payment' && !!d.fileUrl);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: 'var(--jade-soft)', border: '1px solid var(--jade)', borderRadius: 14, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Clock size={18} style={{ color: 'var(--jade-deep)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--jade-deep)', margin: '0 0 4px' }}>Utility submitted — awaiting approval</p>
          <p style={{ fontSize: 13, color: 'var(--jade-deep)', margin: 0, lineHeight: 1.5 }}>
            {acc
              ? <>Account <strong>{acc}</strong> and your proof of payment are with your rental provider for review. We&apos;ll move you to the move-in inspection the moment it&apos;s approved.</>
              : <>Your submission is with your rental provider for review. We&apos;ll move you to the move-in inspection the moment it&apos;s approved.</>}
          </p>
        </div>
      </div>
      {proof?.fileUrl && (
        <button type="button" onClick={() => openDocViewer({ fileUrl: proof.fileUrl, caption: 'Utility proof of payment' })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: '#f4efe8', border: '1px solid var(--mist)', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
          <FileText size={16} color="var(--jade-deep)" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>View the proof you uploaded</span>
        </button>
      )}
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
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();

  // Locally tracked upload — flips true on a successful POST so the Submit
  // button unlocks immediately, without waiting for a Resolved refresh.
  const [proofJustUploaded, setProofJustUploaded] = useState<{ name: string; fileUrl: string } | null>(null);
  // Existing proof on file from a previous attempt (if any).
  const existingProof = resolved.myDocs.find(d => d.documentKey === 'utility_proof_of_payment');
  // A rejected proof does NOT count as uploaded — the customer must replace it
  // with a fresh file before they can submit again.
  const proofUploaded = !!proofJustUploaded || (!!existingProof && existingProof.status !== 'rejected');
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
    // Images go through the scan modal first; PDFs pass straight through.
    // Null = the user closed the scanner — abort the upload.
    const scanned = await scan(file);
    if (!scanned) return;
    file = scanned;
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

  const wasRejected = existingProof?.status === 'rejected' && !proofJustUploaded;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {scannerModal}
      {wasRejected && (
        <div style={{ background: 'var(--brick-soft)', border: '1px solid var(--brick)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} style={{ color: 'var(--brick)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--brick)', margin: '0 0 2px' }}>Your rental provider needs a new utility proof</p>
            <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
              {existingProof?.notes?.trim() || 'Please re-upload a clearer utility proof of payment.'} Replace the file below and submit again.
            </p>
          </div>
        </div>
      )}
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
  /** v2 category model (the current shape); mapped to areas for this summary. */
  categories?: Array<{ sectionId?: string; label?: string; items?: Array<{ id?: string; componentName?: string; inCondition?: string }> }>;
  generalNotes?: string;
  photos?: Array<{ id: string; url: string; caption?: string }>;
  tenantSig?: string | null;
  tenantSignedAt?: string | null;
  landlordSig?: string | null;
  rpCounterSig?: string | null;
}

function MoveInAction({ resolved }: { resolved: Resolved }) {
  const { user } = useAuth();
  const c = resolved.contract;
  const [insp, setInsp] = useState<MoveInInspectionData | null>(null);
  const [loadingInsp, setLoadingInsp] = useState(true);
  const [inspErr, setInspErr] = useState<string | null>(null);

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

  async function signInspection(p: SignaturePayload) {
    if (!c?.id) return;
    const res = await fetch(`/api/contracts/tenant/${c.id}/inspection/sign?type=move_in`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureImage: p.signatureImage, signatoryName: p.signatoryName, consent: p.consent, clientMeta: p.clientMeta, geo: p.geo }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
    // Re-fetch so the now-saved signature appears + the journey advances
    const refreshed = await apiGet<MoveInInspectionData>(`/contracts/tenant/${c.id}/inspection?type=move_in`);
    setInsp(refreshed);
  }

  if (!c) return <ErrorBox msg="Contract not found." />;

  // Phase 6 — the RP must submit the inspection before the customer can
  // counter-sign. Earlier rendering jumped straight to the signature canvas
  // even when no inspection had been generated; show an explicit waiting
  // card instead so the customer understands what's blocking them.
  const inspectionReady = !!c.moveInInspection?.submitted || (!!insp && ((insp.areas?.length ?? 0) > 0 || (insp.categories?.length ?? 0) > 0));
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
  // Once the customer has signed there is nothing left for THEM to do — the
  // inspection sits with the rental provider (or their property manager) to
  // counter-sign, and that counter-signature is what activates the tenancy.
  const customerSigned = !!insp?.tenantSig;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* "Review inspection report" pulsing button — TOP of the section. The pulse
          is an action prompt, so it stops once the customer has signed. */}
      <style>{`
        @keyframes inspectReviewPulse {
          0%, 100% { box-shadow: 0 4px 14px -6px rgba(46,159,130,0.45), 0 0 0 0 rgba(46,159,130,0.45); }
          50%      { box-shadow: 0 4px 14px -6px rgba(46,159,130,0.45), 0 0 0 10px rgba(46,159,130,0); }
        }
        .inspect-review-pulse { animation: inspectReviewPulse 1.8s ease-out infinite; }
      `}</style>

      {/* The "signed — awaiting the rental provider" message is the step's own
          headline (journey state `move_in_review`), so it is NOT repeated here. */}

      <a href={inspectionUrl} target="_blank" rel="noopener noreferrer"
        className={customerSigned ? undefined : 'inspect-review-pulse'}
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
            <p style={{ fontSize: 10, color: 'var(--jade-deep)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>
              {customerSigned ? 'Your document' : 'Step 1 — review'}
            </p>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '2px 0 0' }}>View full inspection report</p>
          </div>
        </div>
        <ExternalLink size={16} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
      </a>

      {/* No inline report summary here — the customer opens the real inspection
          document from the link above; this panel only captures the signature.
          A failed load still gets surfaced so the miss isn't silent. */}
      {inspErr && <ErrorBox msg={`Couldn't load inspection: ${inspErr}`} />}

      {/* Counter-signature card — REAL signing happens here OR on the inspection page */}
      <div style={{ padding: 16, borderRadius: 14, background: 'var(--paper)', border: '1px solid var(--mist-strong)' }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: '0 0 10px' }}>Your counter-signature</p>

        {insp?.tenantSig ? (
          /* Already signed — confirm it and when, but do NOT reproduce the
             signature image here. The signature belongs on the inspection
             document itself (open it from the link above). */
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--jade-deep)', fontWeight: 600 }}>
            <CheckCircle2 size={15} />
            Signed {insp.tenantSignedAt ? fmtDateLong(insp.tenantSignedAt) : ''}
          </div>
        ) : (
          /* Not signed yet — the shared signing block, so customer can sign without leaving this page */
          <div style={{ display: 'grid', gap: 10 }}>
            <SignatureBlock
              signerRole="Customer"
              signerName={personName(user)}
              defaultName={personName(user)}
              termsText="I confirm the condition recorded in this move-in inspection is accurate and agree to it."
              submitLabel="Counter-sign inspection"
              alreadySigned={false}
              onSign={signInspection}
            />
            <SecondaryBtn href={inspectionUrl}>
              Sign in full view <ExternalLink size={14} />
            </SecondaryBtn>
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
  utility_proof_of_payment: 'Utility Proof', ejari: 'Contract Registration Certificate',
  profile_picture: 'Profile Picture',
};

function ActiveAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const c = resolved.contract ?? resolved.renewalContract;
  const pathname = usePathname(); // current space URL — passed as the inspection "back" target
  // The payment runway moved to the left-hand PaymentSummaryRail, so this column
  // only carries Documents now.
  const [section, setSection] = useState<'documents'>('documents');
  const [showTerm, setShowTerm] = useState(false);

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
  // Fall back to the property's street address when the community / emirate
  // lookups are missing, rather than printing a bare em dash.
  const location  = [community, emirate].filter(Boolean).join(', ')
    || u?.property?.fullAddress
    || '—';
  const rp = u?.property?.rentalProvider ?? u?.property?.rental_provider;
  const landlordName = rp?.user?.name?.trim() || rp?.companyName?.trim() || 'Your rental provider';
  const tenantName   = ''; // not on Resolved; omit rather than guess

  const today = new Date();
  const effDate = term?.effectiveDate ? new Date(term.effectiveDate + 'T00:00:00') : null;
  const daysLeft = effDate ? Math.ceil((effDate.getTime() - today.getTime()) / 86400000) : null;
  // One shared derivation (order, "Instalment N" labels, totals, next due) — the
  // same one the left-hand PaymentSummaryRail renders, so they cannot disagree.
  // Only "next cheque" is read here now; the runway itself lives in the rail.
  const nextCheque = buildPaymentRunway(c, pp).next;

  // The Contract Registration certificate the landlord uploaded onto THIS lease.
  // Was matching on the key alone against the customer-wide `myDocs`, so a
  // certificate from another lease surfaced here — and `.reverse().find()` on a
  // newest-first list actually returned the OLDEST match, not "the most recent
  // one on file" as intended. Both are handled by the shared helper.
  const ejariCert = ejariCertDoc(resolved, c?.id) ?? null;
  const sections = [
    // No sub-label: the card below is already headed "Tenancy Documents", so a
    // count line here just repeated it.
    { k: 'documents' as const, label: 'Documents', sub: null as string | null },
  ];

  return (
    <div style={{ display: 'grid', gap: 18 }}>

      {/* Request Termination lives at the top of the left-hand payment summary. */}

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
                {unitNum ? `Unit ${unitNum}` : unitName}
              </p>
            )}
            <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
              <MapPin size={12} /> {location}
            </p>
          </div>

          {/* People row — the landlord is not named on the customer's pass. */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {tenantName && <PassField label="Tenant"   value={tenantName} />}
            {u?.unitType && <PassField label={u.unitType.replace(/_/g, ' ')} value={u.bedrooms ? `${u.bedrooms} BR` : (unitNum ? `No. ${unitNum}` : '—')} mono />}
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
            {(() => {
              const vatAed = pp ? (pp.rentVatFils ?? 0) / 100 : (c.annualRent ?? 0) * (c.rentVatRate ?? 0) / 100;
              return vatAed > 0 ? (
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--mute)', margin: '3px 0 0' }}>+ AED {Math.round(vatAed).toLocaleString('en-AE')} VAT</p>
              ) : null;
            })()}
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
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))`, gap: 10 }}>
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
              {s.sub && <p style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.7)' : 'var(--mute)', margin: 0 }}>{s.sub}</p>}
            </button>
          );
        })}
      </div>

      {/* Payment runway removed from this column — it now lives in the left-hand
          PaymentSummaryRail, instalment by instalment with its status. */}

      {/* ── Documents section ── */}
      {section === 'documents' && (
        <div style={{ display: 'grid', gap: 12 }}>

          {/* Tenancy Documents — EXACTLY the four the lease hands over. The KYC
              uploads the customer supplied during onboarding are deliberately not
              re-listed here: by this point they've been verified, and the customer
              manages them from their own profile page. */}
          <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                // "Payment Summary" — the name the document itself carries
                // (PaymentPlanPdf's heading) and the name of the panel on the
                // left. Calling the link "Payment Plan" made one thing look
                // like three.
                { label: 'Payment Summary',         href: `/dashboard/customer/contracts/${c.id}/print/plan`, newTab: true },
                // One receipts file → a receipt per collected payment inside.
                { label: 'Receipts',                href: `/dashboard/customer/contracts/${c.id}/print/receipt`, newTab: true },
                { label: 'Signed Tenancy Contract', href: `/dashboard/customer/contracts/${c.id}/print`, newTab: false },
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
              {/* The registration certificate is a STORED file (keys stay `ejari*`),
                  opened in a new tab like the other documents — and only once it's
                  actually on file. */}
              {ejariCert?.fileUrl && (
                <a href={ejariCert.fileUrl} target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '11px 14px', background: '#f4efe8', border: '1px solid var(--mist)',
                    borderRadius: 12, textDecoration: 'none',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileText size={16} color="var(--jade-deep)" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Contract Registration Certification</span>
                  </div>
                  <ArrowRight size={14} color="var(--ink-2)" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

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
        <p style={{ fontSize: 12, color: 'var(--jade-deep)', margin: 0, fontWeight: 600 }}>
          {balance > 0 ? 'Refund processed' : 'Settlement completed'}{settlement.paidAt ? ` on ${fmtDT(settlement.paidAt)}` : ''}.
          {settlement.refundMethod ? ` Paid by ${({ cash: 'cash', bank_transfer: 'bank transfer', cheque: 'cheque', card: 'card', online: 'online payment' } as const)[settlement.refundMethod]}` : ''}
          {settlement.refundReference ? ` · ref ${settlement.refundReference}` : ''}
          {settlement.refundPaidOn ? ` · on ${fmtDT(settlement.refundPaidOn)}` : ''}
        </p>
      )}
    </div>
  );
}

function TerminationRequestModal({ contract, onClose, onSuccess }: { contract: ApiContract; onClose: () => void; onSuccess: () => void }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  // The coded reason the Move-out Reasons report counts. Asked of the CUSTOMER
  // because they are the only one who actually knows why they are leaving —
  // staff can only guess after the fact.
  const [reasonCode, setReasonCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  async function submit() {
    if (!reasonCode) { setErr('Please choose a reason for leaving.'); return; }
    if (!moveOutReasonReady(reasonCode, reason)) { setErr('Please tell us a little more about your reason.'); return; }
    if (!date) { setErr('Please pick an effective date.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${contract.id}/termination/request`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim(), reasonCode, effectiveDate: date }) });
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
          <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Why are you leaving?</label>
          <MoveOutReasonSelect
            value={reasonCode} onChange={setReasonCode} audience="customer"
            className=""
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit', background: '#fff' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Anything to add{moveOutReason(reasonCode)?.requiresNote ? '' : ' (optional)'}
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Anything your provider should know"
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
        {t?.reasonCode && <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0', fontWeight: 600 }}>{moveOutReasonLabel(t.reasonCode)}</p>}
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
        {t?.reasonCode && <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0', fontWeight: 600 }}>{moveOutReasonLabel(t.reasonCode)}</p>}
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
/** The renewal child's Payment rows (built by proposeRenewal) mapped onto the
 *  canonical segregation input the landlord's card uses. The customer payload
 *  names the gross amount `amountPaid`, so it maps onto the `amount` the row
 *  builder reads — everything else lines up field-for-field.
 *
 *  Shared by the Payment Summary and the Cheques step, so the rows the customer
 *  sees and the slots their uploads are tagged with can never disagree. */
function renewalSegRows(child: ApiContract | null) {
  return segRowsFromContract(
    { contractType: child?.contractType ?? 'renewal' },
    (child?.payments ?? []).map(p => ({
      paymentType: p.paymentType,
      description: p.description,
      amount: p.amountPaid,
      vatAmount: p.vatAmount ?? null,
      transactionDate: p.transactionDate,
      chequeStatus: p.chequeStatus ?? null,
      paymentMethod: p.paymentMethod ?? null,
    })),
  );
}

/** Every attach-slot label the plan will render, in SegregatedPlanView's own
 *  terms: Rental Income attaches per instalment row, the other groups once at
 *  the heading. Used to spot uploads whose slot no longer exists. */
function renewalSlotLabels(child: ApiContract | null): string[] {
  return buildSegregatedPlan(renewalSegRows(child)).groups.flatMap(g =>
    g.key === 'rental' ? g.lines.map(l => `Rent — ${l.item}`) : [g.title],
  );
}

/** The renewal's Payment Summary. Rendered on BOTH the renewal OFFER step
 *  (before acceptance) and the renewal PAYMENTS step (after acceptance, while
 *  the RP finalises the contract) — link, don't duplicate.
 *
 *  This is the SAME document the RP/manager reads on the Operations "Renewal ·
 *  step 1" card: PaymentPlanCard over the canonical segregatedPlan grouping, so
 *  what the customer is quoted is line-for-line what the landlord sent rather
 *  than a second look-alike table that can drift. `child` is the proposed/renewed
 *  contract carrying the Payment rows; `parent` (the running lease) only backs
 *  up the header meta when the child hasn't got it.
 *
 *  `renderAttach` is passed ONLY by the Cheques/PDC step — that is where the
 *  customer hands over a cheque per instalment. On the Terms step the card stays
 *  read-only: nothing should ask for an upload before the offer is accepted. */
function RenewalTermsSummary({ parent, child, resolved, renderAttach }: { parent: ApiContract | null; child: ApiContract | null; resolved: Resolved; renderAttach?: (slot: PlanAttachSlot) => React.ReactNode }) {
  const { user } = useAuth();

  const segRows = renewalSegRows(child);
  const rp = resolved.unit?.property?.rentalProvider ?? resolved.unit?.property?.rental_provider;
  // Header meta reads off the CONTRACT first, exactly as the landlord's card does.
  // On a `v-` space the unit is resolved from the VIEWING, whose property carries
  // no community — falling back to the unit alone left the Community line blank
  // while the same card on Operations showed it.
  const cp = child?.property ?? parent?.property;
  const place = {
    unitNumber: child?.unit?.unitNumber ?? child?.unit?.number ?? resolved.unit?.unitNumber ?? null,
    buildingName: cp?.buildingName ?? resolved.unit?.property?.buildingName ?? null,
    community: cp?.community ?? cp?.emirate ?? resolved.unit?.property?.community?.name ?? null,
  };

  return (
    /* The SAME Payment Summary the landlord sees on their renewal step — one
       card, one grouping, one grand total. */
    <PaymentPlanCard
      rows={segRows}
      refLabel={child?.ref ?? null}
      contractType={child?.contractType ?? 'renewal'}
      tenantName={child?.tenantCompanyName || parent?.tenantCompanyName || personName(user) || null}
      landlordName={rp?.user?.name?.trim() || rp?.companyName?.trim() || null}
      unitNumber={place.unitNumber}
      buildingName={place.buildingName}
      community={place.community}
      periodStart={child?.startDate ?? null}
      periodEnd={child?.endDate ?? null}
      renderAttach={renderAttach}
    />
  );
}

function RenewalOfferedAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const parent = resolved.contract;
  const child = resolved.renewalContract;
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Phase 6c — reject confirm modal. Reject no longer fires on a single tap;
  // we open this panel, capture an optional reason, then PATCH. The reason
  // is persisted on the parent contract so the RP sees it when deciding
  // whether to re-propose with updated terms.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // Decline intent: negotiate (open to a new offer, lease keeps running) vs
  // vacate (leaving at lease end → move-out inspection + deposit settlement).
  const [rejectIntent, setRejectIntent] = useState<'negotiate' | 'vacate'>('negotiate');
  // Declining to VACATE is a move-out — the single biggest source of them — so
  // it carries the same coded reason as a termination and lands in the same
  // column. Declining to NEGOTIATE is not a move-out and asks for none.
  const [rejectReasonCode, setRejectReasonCode] = useState('');

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
    // Some browsers (and iPhone HEIC files) report an empty file.type; fall back
    // to a generic binary type the backend accepts so the upload can start.
    const mime = file.type || 'application/octet-stream';
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'tenancy_contract', ownerId: child.id,
        documentKey: 'renewal_payment_proof',
        originalName: file.name, mimeType: mime,
      }),
    });
    if (!urlRes.ok) {
      const b = await urlRes.json().catch(() => ({}));
      throw new Error(b?.message ?? 'Failed to start upload');
    }
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': mime } });
    if (!putRes.ok) throw new Error('File upload failed');
    const regRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'tenancy_contract', ownerId: child.id,
        documentKey: 'renewal_payment_proof', category: 'payment',
        displayName: file.name, fileUrl, mimeType: mime, s3Key: fileKey,
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
    // Accepting only agrees the TERMS. Cheque upload + submission now happen on the
    // next step (Cheques/PDC) — the customer isn't marked cheques-submitted here.
    setBusy(verb); setErr(null);
    try {
      const init: RequestInit = { method: 'PATCH', credentials: 'include' };
      if (verb === 'reject') {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify({
          reason: rejectReason.trim() || undefined,
          intent: rejectIntent,
          ...(rejectIntent === 'vacate' ? { reasonCode: rejectReasonCode } : {}),
        });
      }
      const res = await fetch(`/api/contracts/${parent!.id}/renewal/${verb}`, init);
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      if (verb === 'reject') {
        setRejectOpen(false);
        setRejectReason('');
        setRejectIntent('negotiate');
        setRejectReasonCode('');
      }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

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

      <RenewalTermsSummary parent={parent} child={child} resolved={resolved} />

      {/* Cheque / PDC upload moved to the next step (Cheques/PDC) — the customer
          agrees the terms here, then uploads their cheques against the schedule,
          which the RP reviews & collects before signing. */}

      {err && <ErrorBox msg={err} />}

      {/* Accept / Reject actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
        <PrimaryBtn onClick={() => act('accept')} disabled={!!busy}>
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
              {rejectIntent === 'vacate' && (
                <div>
                  <label htmlFor="renewal-vacate-reason-code" style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Why are you leaving?
                  </label>
                  <MoveOutReasonSelect
                    id="renewal-vacate-reason-code"
                    value={rejectReasonCode} onChange={setRejectReasonCode} audience="customer"
                    className=""
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 13, fontFamily: 'inherit', color: 'var(--ink)', background: 'var(--surface)' }}
                  />
                </div>
              )}
              <div>
                <label htmlFor="renewal-reject-reason" style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {rejectIntent === 'vacate'
                    ? `Note to your provider${moveOutReason(rejectReasonCode)?.requiresNote ? '' : ' (optional)'}`
                    : 'What would make it work? (optional but recommended)'}
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
                disabled={!!busy || (rejectIntent === 'vacate' && !moveOutReasonReady(rejectReasonCode, rejectReason))}
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

/**
 * Separates the schedule slot a renewal cheque was attached to from the file's
 * own name inside `documents.display_name` ("Rent — Instalment 2 · cheque.jpg").
 *
 * Documents have no free-text column to tag with, and the slot cannot ride on
 * `document_key`: the binder matches Payment Advice by stripping a trailing
 * `_<10+digits>`, so any other suffix would stop the file snapping into the
 * Payment Advice slot the RP reads cheques from. Carrying it in the display name
 * keeps the binder match intact AND tells the RP which instalment each cheque
 * covers. Untagged (bulk-uploaded) files simply have no separator.
 */
const SLOT_SEP = ' · ';
function slotOfDoc(displayName?: string | null): string | null {
  const i = (displayName ?? '').indexOf(SLOT_SEP);
  return i > 0 ? displayName!.slice(0, i) : null;
}
function fileNameOfDoc(displayName?: string | null): string {
  const i = (displayName ?? '').indexOf(SLOT_SEP);
  return i > 0 ? displayName!.slice(i + SLOT_SEP.length) : (displayName ?? '');
}

function RenewalChequesAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const child = resolved.renewalContract;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();
  // Uploaded cheque images / PDC. These MUST be registered under a Payment-Advice
  // key so they land in the contract's "Payment Advice" binder slot (which both
  // the RP and customer read cheques from). The binder matches documentKey
  // 'payment_advice' + the shared cheque aliases (pdc, cheques, …) after stripping
  // a trailing _<10+digits> suffix — so 'payment_advice_<unique>' snaps in, whereas
  // the old 'renewal_payment_proof' key matched NO slot and orphaned the file.
  type PdcDoc = { id: number; displayName?: string | null; fileUrl?: string | null; mimeType?: string | null; documentKey?: string };
  const [pdcDocs, setPdcDocs] = useState<PdcDoc[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const PAYMENT_ADVICE_KEYS = ['payment_advice', 'pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques', 'renewal_payment_proof'];

  useEffect(() => {
    if (!child?.id) return;
    fetch(`/api/documents?ownerType=tenancy_contract&ownerId=${child.id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: PdcDoc[]) => {
        if (!Array.isArray(rows)) return;
        setPdcDocs(rows.filter(d => PAYMENT_ADVICE_KEYS.includes((d.documentKey ?? '').toLowerCase().replace(/_\d{10,}$/, ''))));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child?.id]);

  if (!child) return <ErrorBox msg="Renewal contract not found." />;
  const submitted = !!child.tenantChequesSubmittedAt;
  // Files no attach row will render: bulk uploads from before per-payment attach
  // existed, plus anything tagged to a slot the plan no longer has (the RP can
  // re-price a renewal, changing the instalment count under an upload). They
  // still count toward submit, so they must stay visible and removable below.
  const slotLabels = renewalSlotLabels(child);
  const untaggedDocs = pdcDocs.filter(d => {
    const s = slotOfDoc(d.displayName);
    return !s || !slotLabels.includes(s);
  });

  async function uploadPdc(file: File, index: number, slotLabel?: string): Promise<PdcDoc> {
    if (!child?.id) throw new Error('Renewal contract not ready');
    const mime = file.type || 'application/octet-stream';
    // Unique Payment-Advice key: the binder strips the _<digits> suffix so each
    // cheque coexists yet snaps into the single Payment Advice slot.
    const key = `payment_advice_${Date.now()}${String(index).padStart(2, '0')}`;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: child.id, documentKey: key, originalName: file.name, mimeType: mime }),
    });
    if (!urlRes.ok) { const b = await urlRes.json().catch(() => ({})); throw new Error(b?.message ?? 'Failed to start upload'); }
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': mime } });
    if (!putRes.ok) throw new Error('File upload failed');
    const regRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: child.id, documentKey: key, category: 'payment', displayName: slotLabel ? `${slotLabel}${SLOT_SEP}${file.name}` : file.name, fileUrl, mimeType: mime, s3Key: fileKey, isVisibleToTenant: true }),
    });
    if (!regRes.ok) { const b = await regRes.json().catch(() => ({})); throw new Error(b?.message ?? 'Reference registration failed'); }
    return (await regRes.json()) as PdcDoc;
  }

  /**
   * Attach files to ONE payment on the schedule. Mirrors the new-lease
   * `handleSlotFiles`: when `replaceIds` is given the control said "Replace", so
   * the earlier files are dropped only AFTER the new ones are safely stored — a
   * failed upload can never leave a payment with nothing attached where the
   * customer had already provided a reference.
   */
  async function handleSlotFiles(slotLabel: string, files: FileList | null, replaceIds?: number[]) {
    if (!files || files.length === 0 || !child?.id) return;
    // Each cheque photo goes through the scan modal in turn (auto-crop +
    // clean-up); PDFs pass straight through; a cancelled scan skips that file.
    const ready: File[] = [];
    for (const picked of Array.from(files)) {
      const scanned = await scan(picked);
      if (scanned) ready.push(scanned);
    }
    if (ready.length === 0) return;
    setUploadErr(null); setUploading(ready.length);
    try {
      const saved: PdcDoc[] = [];
      let i = 0;
      for (const file of ready) saved.push(await uploadPdc(file, i++, slotLabel));
      if (saved.length) setPdcDocs(prev => [...prev, ...saved]);
      if (saved.length && replaceIds?.length) {
        for (const id of replaceIds) await removePdc(id);
      }
    } catch (e) { setUploadErr(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(0); }
  }

  /** Bulk drop — every file lands untagged, for customers who'd rather hand the
   *  whole set over at once than match each cheque to its row. */
  async function handleBulkFiles(files: FileList | null) {
    if (!files || files.length === 0 || !child?.id) return;
    // Same scan-first pass as the per-payment attach (see handleSlotFiles).
    const ready: File[] = [];
    for (const picked of Array.from(files)) {
      const scanned = await scan(picked);
      if (scanned) ready.push(scanned);
    }
    if (ready.length === 0) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploadErr(null); setUploading(ready.length);
    try {
      let i = 0;
      for (const file of ready) {
        const saved = await uploadPdc(file, i++);
        setPdcDocs(prev => [...prev, saved]);
      }
    } catch (e) { setUploadErr(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(0); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function removePdc(docId: number) {
    const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) setPdcDocs(prev => prev.filter(d => d.id !== docId));
  }

  async function submit() {
    if (pdcDocs.length === 0) { setErr('Please upload your cheque(s) / PDC before submitting.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${child!.id}/cheques-submitted`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  // Submitted → the ball is in the RP's court and there is nothing left to do
  // here, so mirror the new-lease waiting step (ChequesReviewWaitAction): the
  // status message and what was sent, nothing else. Re-showing the schedule
  // implies the customer still has to act on it, and the plan stays available
  // from the renewal contract itself.
  if (submitted) {
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ background: 'var(--jade-soft)', border: '1px solid var(--jade)', borderRadius: 14, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Clock size={18} style={{ color: 'var(--jade-deep)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--jade-deep)', margin: '0 0 4px' }}>Cheques submitted — rental provider is reviewing</p>
            <p style={{ fontSize: 13, color: 'var(--jade-deep)', margin: 0, lineHeight: 1.5 }}>
              Your rental provider will review and collect them, then you&rsquo;ll sign the renewal. We&rsquo;ll notify you the moment it&rsquo;s your turn.
            </p>
          </div>
        </div>
        {pdcDocs.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your uploaded cheques</p>
            {pdcDocs.map((d, i) => {
              const isPdf = (d.mimeType ?? '').includes('pdf') || (d.fileUrl ?? '').toLowerCase().split('?')[0].endsWith('.pdf');
              // The slot it was attached against, so the customer can see which
              // payment each cheque covers — the bulk-uploaded ones have none.
              const slot = slotOfDoc(d.displayName);
              return (
                <div key={d.id} style={{ border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '10px 14px', background: 'var(--paper)', display: 'flex', gap: 12, alignItems: 'center' }}>
                  {d.fileUrl && (
                    <button type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl!, caption: slot ?? fileNameOfDoc(d.displayName) ?? `Cheque ${i + 1}`, mimeType: d.mimeType })} style={{ flexShrink: 0, lineHeight: 0, display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
                      {isPdf ? (
                        <span style={{ width: 56, height: 36, borderRadius: 6, background: 'var(--mist)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--jade-deep)' }}>
                          <FileText size={18} />
                        </span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.fileUrl} alt="cheque" style={{ width: 56, height: 36, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                      )}
                    </button>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot ?? `Cheque ${i + 1}`}</p>
                    <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileNameOfDoc(d.displayName)}</p>
                  </div>
                  <span style={{ fontSize: 11, background: 'var(--jade-soft)', color: 'var(--jade-deep)', borderRadius: 6, padding: '3px 8px', fontWeight: 600, flexShrink: 0 }}>Submitted</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {scannerModal}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
          Attach a picture / PDF of each post-dated cheque (or transfer receipt) against the payment it covers. Your rental provider reviews and collects them before you sign.
        </p>
      </div>

      {/* Per-payment attach lives ON the schedule rows — same control the
          new-lease payment step uses, so a 4-instalment renewal gets four
          separate cheque slots instead of one shared bucket. Uploads are filed
          as Payment Advice (see key note above). */}
      <RenewalTermsSummary
        parent={resolved.contract}
        child={child}
        resolved={resolved}
        renderAttach={(slot) => (
          <PlanAttachCell
            slot={slot}
            refs={pdcDocs
              .filter(d => slotOfDoc(d.displayName) === slot.label)
              .map(d => ({ id: d.id, index: 0, imageUrl: d.fileUrl ?? null }))}
            uploading={uploading}
            onFiles={handleSlotFiles}
            onRemove={removePdc}
          />
        )}
      />

      {/* Bulk alternative to the per-row controls: send the whole set at once.
          These files stay untagged, which is also where anything uploaded before
          per-payment attach existed — or tagged to a slot the plan no longer has
          — shows up. They count toward submit, so they must stay visible and
          removable rather than becoming invisible but still gating the button. */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Or send them all together</p>
            {untaggedDocs.length > 0 && <span style={{ fontSize: 11, color: 'var(--mute)' }}>{untaggedDocs.length} file{untaggedDocs.length === 1 ? '' : 's'}</span>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '0 0 4px', lineHeight: 1.5 }}>Rather hand the whole set over at once? Attach every cheque here instead of row by row — your rental provider matches them to the schedule.</p>
          <label style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--mist-strong)', background: 'var(--surface)', cursor: uploading ? 'progress' : 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--jade-deep)' }}>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple disabled={uploading > 0} onChange={(e) => handleBulkFiles(e.target.files)} style={{ display: 'none' }} data-testid="renewal-pdc-input" />
              {uploading > 0 ? <><Loader2 size={14} className="animate-spin" /> Uploading {uploading} file{uploading === 1 ? '' : 's'}…</> : <><UploadCloud size={14} /> Choose files</>}
          </label>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {untaggedDocs.map((d, i) => {
              const isPdf = (d.mimeType ?? '').includes('pdf') || (d.fileUrl ?? '').toLowerCase().split('?')[0].endsWith('.pdf');
              return (
                <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--mist-strong)' }}>
                  {d.fileUrl && !isPdf ? (
                    <button type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl!, caption: fileNameOfDoc(d.displayName) || `Cheque ${i + 1}`, mimeType: d.mimeType })} style={{ flexShrink: 0, lineHeight: 0, display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={d.fileUrl} alt={d.displayName ?? ''} style={{ width: 44, height: 30, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                    </button>
                  ) : d.fileUrl ? (
                    <span style={{ width: 44, height: 30, display: 'grid', placeItems: 'center', background: 'var(--mist)', borderRadius: 4, flexShrink: 0 }}><FileText size={14} color="var(--ink-2)" /></span>
                  ) : null}
                  <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileNameOfDoc(d.displayName) || `Cheque ${i + 1}`}</p></div>
                  {d.fileUrl && <button type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl!, caption: fileNameOfDoc(d.displayName) || `Cheque ${i + 1}`, mimeType: d.mimeType })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--jade-deep)', fontSize: 11, fontWeight: 600, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}><ExternalLink size={12} /> View</button>}
                  <button type="button" onClick={() => removePdc(d.id)} style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }} aria-label="Remove cheque">Remove</button>
                </div>
              );
            })}
        </div>
      </div>

      {uploadErr && <ErrorBox msg={uploadErr} />}

      {err && <ErrorBox msg={err} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <PrimaryBtn onClick={submit} disabled={busy || pdcDocs.length === 0}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy ? 'Submitting…' : 'Submit cheques for review'}
        </PrimaryBtn>
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
  // Identify the unit by its number first (matches contracts/reports/property
  // surfaces app-wide). unitName is a free-text label that often holds a
  // listing headline, so it's only a fallback when there's no unit number.
  const unit = u ? (u.unitNumber ? `Unit ${u.unitNumber}` : (u.unitName ?? '')) : '';
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
      {/* Right-side spacer keeps the title centered (Legacy view link removed). */}
      <div aria-hidden style={{ width: 88, flexShrink: 0 }} />
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
        apiGet<{
          documents: TenantDoc[]; tenantProfileId?: number | null;
          entityType?: 'individual' | 'company' | null; companyName?: string | null;
          tradeLicenseNumber?: string | null; tradeLicenseAuthority?: string | null;
        }>('/documents/my')
          .catch(() => ({ documents: [], tenantProfileId: null, entityType: null, companyName: null, tradeLicenseNumber: null, tradeLicenseAuthority: null })),
      ]);
      // A document the landlord REQUESTED but that hasn't been uploaded yet is a
      // real row carrying no file (status 'pending'). It is the request, not the
      // document — counting it would tick the customer's own checklist off and
      // skip them past the upload step, so it is dropped here, once, for every
      // consumer of myDocs below.
      const docs = (docsResp.documents ?? []).filter(d => !!d.fileUrl);
      const tenantProfileId = (docsResp as { tenantProfileId?: number | null }).tenantProfileId ?? null;
      const entityType = (docsResp as { entityType?: 'individual' | 'company' | null }).entityType ?? null;
      const companyName = (docsResp as { companyName?: string | null }).companyName ?? null;
      const tradeLicenseNumber = (docsResp as { tradeLicenseNumber?: string | null }).tradeLicenseNumber ?? null;
      const tradeLicenseAuthority = (docsResp as { tradeLicenseAuthority?: string | null }).tradeLicenseAuthority ?? null;
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
              // The contract list returns these as plain strings; the unit shape
              // (shared with the viewing / lead paths) nests them as { name }.
              community: cFound.property.community ? { name: cFound.property.community } : null,
              emirate: cFound.property.emirate ? { name: cFound.property.emirate } : null,
            } : undefined,
          } : null;
        }
      }
      if (!unit) { setError('Space not found.'); setLoading(false); return; }
      const allForUnit = contracts.filter(c => c.unit?.id === unit?.id);
      // Renewal chains link each year's lease to the previous via
      // parentContractId and can run many generations deep
      // (root → … → current lease → proposed renewal). The old
      // root-and-first-child resolver collapsed to the ORIGINAL lease and its
      // FIRST renewal, so a customer on their 3rd renewal saw stale year-1
      // amounts (and the renewal panel pointed at a long-expired child). Walk
      // from the TIP instead — the newest contract in the chain:
      //   • If the tip is a renewal still being processed (a pending/issued
      //     child), the current lease is its parent and the tip is the proposed
      //     renewal — this keeps the renewal_* journey framing intact.
      //   • Otherwise the tip is itself the current contract (active lease, or a
      //     brand-new draft with no renewal yet).
      // Recency = latest start date, then highest id (newer rows / superseded
      // re-proposals win, so a stale duplicate proposal never shadows the live
      // one).
      // Shared with the My Spaces list so both surfaces agree on which contract
      // is the in-force lease and which is the renewal in flight.
      const { contract, renewalContract } = resolveContractChain(allForUnit);
      // Docs-complete gate combines KYC identity + financial/business docs.
      // Use getRequiredDocs (which prepends KYC_DOCS to the rental section)
      // so a customer who's uploaded financials but skipped KYC still gets
      // routed to docs_required, not payment_review.
      const requiredKeys = getRequiredDocs(unit.unitType, entityType).filter(d => d.required).map(d => d.key);
      const uploadedKeys = new Set(docs.filter(d => d.status !== 'missing' && d.status !== 'rejected').map(d => d.documentKey));
      // Emirates ID is satisfied by a combined file OR both separate sides.
      const allRequiredDocsUploaded = requiredKeys.length > 0 && requiredKeys.every(k => isDocKeySatisfied(k, uploadedKeys));
      const paymentPlan = lead?.paymentPlan ?? viewing?.lead?.paymentPlan ?? null;
      const stage = lead?.stage ?? viewing?.lead?.stage ?? viewing?.leadStage ?? null;
      const requestedAdditionalDocs = parseAdditionalDocs(lead?.additionalDocsNote ?? viewing?.lead?.additionalDocsNote);
      setResolved({ spaceKey, unit, viewing, lead, contract, renewalContract, paymentPlan, stage, allRequiredDocsUploaded, docsSubmitted: readDocsSubmitted(spaceKey), tenantProfileId, entityType, companyName, tradeLicenseNumber, tradeLicenseAuthority, myDocs: docs, requestedAdditionalDocs });
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
  // A renewal that was activated BEFORE its term starts (double-active glitch) still
  // counts as "mid-flight" here — it belongs stacked under the current lease, not
  // rendered as its own live tenancy.
  const c = resolved.contract;
  const rc = resolved.renewalContract;
  const todayIsoView = new Date().toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
  const rcNotYetLive = !!rc && (rc.status !== 'active' || (rc.startDate ?? '').slice(0, 10) > todayIsoView);
  const isDualView = !!(c && c.status === 'active' && rc && rc.status !== 'terminated' && rcNotYetLive);

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
  const maintCandidate = resolved.contract ?? resolved.renewalContract;
  const maintContract = maintCandidate && ['issued', 'active'].includes(maintCandidate.status) ? maintCandidate : null;
  const { steps, currentIndex } = stepsFor(stateKey, resolved);
  const def = STATE_DEFS[stateKey];

  return (
    <div style={{ ...PALETTE, minHeight: '100vh', background: 'var(--surface)' }}>
      <TopBar resolved={resolved} />
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          {/* Live tenancy → the journey map has nothing left to say (every stop is
              done), so the left column carries the lease's payment summary instead. */}
          {stateKey === 'active' || stateKey === 'renewal_active'
            ? <PaymentSummaryRail resolved={resolved} onRefresh={fetchAll} />
            : <QuestMap steps={steps} currentIndex={currentIndex} mode={def.mode} />}
          <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
            <QuestActionCard stateKey={stateKey} resolved={resolved} onRefresh={fetchAll} />
            {/* Maintenance — ONLY the way in (owner, 31 Aug): raise a request on this
                lease; tracking lives on My Services. My Spaces is where a customer
                actually lands; the backend accepts issued + active leases. */}
            {maintContract && <MaintenanceSection contractId={maintContract.id} variant="raise" />}
            <SetupDownloads resolved={resolved} stateKey={stateKey} />
          </div>
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
          <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
            <QuestActionCard stateKey={renewalStateKey} resolved={resolved} onRefresh={onRefresh} />
            <SetupDownloads resolved={resolved} stateKey={renewalStateKey} />
          </div>
        </div>
      </DualSection>

      <DualBridge />

      <DualSection eyebrow="02 · Original lease" title="Your current lease" sub={`Until ${endStr}`} tone="jade">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <QuestMap steps={originalSteps} currentIndex={originalCurrentIdx} mode={originalDef.mode} />
          <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
            <QuestActionCard stateKey={originalStateKey} resolved={resolvedOriginalOnly} onRefresh={onRefresh} />
            {/* Maintenance stays on the ORIGINAL lease — it is the one being lived in. */}
            {c && <MaintenanceSection contractId={c.id} variant="raise" />}
          </div>
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
