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

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, AlertCircle, Clock, MapPin, FileText, Pen, Stamp,
  Zap, Key, BadgeCheck, Mail, Wallet, Binoculars, Calendar, ChevronRight,
  ChevronLeft, ChevronDown, Info,
  X, CheckCircle2, UploadCloud, ExternalLink, Printer, RotateCcw,
  Sparkles, Home, ArrowRight,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { getRequiredDocs, getOccupantDocs, deriveOccupantCount } from '@/lib/docRequirements';
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
  user?: { name?: string | null } | null;
}
interface ApiUnit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType?: string | null;
  bedrooms?: number | null;
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
interface ApiPaymentPlan {
  chequeCount: number;
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
  /** Tenant-chosen preferences captured at Step 3 (Rental Documents). */
  desiredMoveIn?: string | null;
  preferredChequeCount?: number | null;
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
interface ApiContract {
  id: number;
  ref?: string | null;
  status: string;
  contractType?: string | null;
  parentContractId?: number | null;
  ejariStatus: string | null;
  utilityStatus: string | null;
  utilityAccountNumber: string | null;
  numberOfInstallments: number | null;
  startDate: string | null;
  endDate: string | null;
  annualRent: number;
  contractValue?: number | null;
  tenantSignedAt: string | null;
  unit: { id: number | null };
  renewalAccepted?: 'pending' | 'accepted' | 'rejected' | null;
  moveInInspection?: { submitted: boolean; signedByTenant: boolean; signedAt: string | null } | null;
  termination?: ApiTermination | null;
}

type StateKey =
  | 'viewing' | 'application_review'
  | 'documents' | 'documents_submitted'
  | 'payment_plan' | 'cheques_submitted'
  | 'contract_issued' | 'signature' | 'ejari' | 'utility'
  | 'awaiting_movein_inspection' | 'move_in' | 'awaiting_activation' | 'active'
  | 'termination_request_received' | 'termination_request_sent'
  | 'renewal_offered' | 'renewal_documents' | 'renewal_cheques'
  | 'renewal_progress' | 'renewal_ejari' | 'renewal_active'
  | 'rejected' | 'terminated' | 'renewal_rejected';

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

const STATE_DEFS: Record<StateKey, StateDef> = {
  viewing:                       { label: 'Viewing scheduled',           sub: 'Step 1–2 of 10', mode: 'new',     currentIndex: 1, tone: 'waiting',  headline: 'See the place. Then we’ll set you up.',                body: 'Your viewing is confirmed. Once you’ve seen it and you’re ready to move forward, the rest of the journey kicks off automatically.',                 timing: 'See your scheduled time' },
  application_review:            { label: 'Application under review',    sub: 'Step 2 of 10',   mode: 'new',     currentIndex: 1, tone: 'waiting',  headline: 'Your application is with the landlord.',               body: 'Your landlord is reviewing your application. They’ll either approve and request documents next, or reach out with an offer.',                          timing: 'Usually 1–2 business days' },
  documents:                     { label: 'Documents required',          sub: 'Step 3 of 10',   mode: 'new',     currentIndex: 2, tone: 'action',   headline: 'Almost there. Let’s gather your paperwork.',           body: 'Upload a few documents so your landlord can prepare the contract. Most customers finish in under 5 minutes.',                                            timing: 'Takes ~5 min' },
  documents_submitted:           { label: 'Documents under review',      sub: 'Step 3 of 10',   mode: 'new',     currentIndex: 2, tone: 'waiting',  headline: 'Your documents are in. Landlord is reviewing.',        body: 'All your required paperwork has been uploaded. Your landlord is verifying them and preparing the payment plan.',                                       timing: 'Usually 1 business day' },
  payment_plan:                  { label: 'Payment plan ready',          sub: 'Step 4 of 10',   mode: 'new',     currentIndex: 3, tone: 'action',   headline: 'Your payment plan is ready.',                          body: 'Your landlord shared a cheque plan. Prepare the cheques, then confirm they’re ready and we’ll move on to signing.',                                    timing: 'Confirm when ready' },
  cheques_submitted:             { label: 'Cheques being collected',     sub: 'Step 4 of 10',   mode: 'new',     currentIndex: 3, tone: 'waiting',  headline: 'Cheques confirmed. Landlord is collecting them.',      body: 'You’ve confirmed your cheques are ready. Your landlord will record each one and then issue your contract — usually within 24 hours.',                  timing: 'Usually within 1 business day' },
  contract_issued:               { label: 'Contract being prepared',     sub: 'Step 5 of 10',   mode: 'new',     currentIndex: 4, tone: 'waiting',  headline: 'Your contract is being finalised.',                    body: 'Your landlord is finalising the contract and confirming all cheques. You’ll be able to sign as soon as PDC collection is confirmed.',                  timing: 'Usually same day' },
  signature:                     { label: 'Awaiting your signature',     sub: 'Step 6 of 10',   mode: 'new',     currentIndex: 5, tone: 'action',   headline: 'One signature stands between you and the keys.',       body: 'Review the final contract, then add your signature below.',                                                                                              timing: 'Takes ~2 min' },
  ejari:                         { label: 'Ejari in progress',           sub: 'Step 7 of 10',   mode: 'new',     currentIndex: 6, tone: 'waiting',  headline: 'Your landlord is registering Ejari.',                  body: 'The Dubai Land Department typically takes 2–5 business days. We’ll notify you the moment it’s registered.',                                            timing: '2–5 business days' },
  utility:                       { label: 'Add utility account',         sub: 'Step 8 of 10',   mode: 'new',     currentIndex: 7, tone: 'action',   headline: 'Add your utility account number.',                     body: 'Ejari is done. Add your DEWA / utility account number so the activation can be linked to your tenancy.',                                                timing: 'Takes ~1 min' },
  awaiting_movein_inspection:    { label: 'Move-in inspection — landlord', sub: 'Step 9 of 10', mode: 'new',     currentIndex: 8, tone: 'waiting',  headline: 'Landlord is preparing your move-in inspection.',       body: 'Your landlord is walking through the unit and recording its current state — every room, meter reading and key photographed. We’ll notify you the moment it’s submitted so you can review and counter-sign.', timing: 'Usually scheduled within 1–2 business days' },
  move_in:                       { label: 'Sign move-in inspection',     sub: 'Step 9 of 10',   mode: 'new',     currentIndex: 8, tone: 'action',   headline: 'Review the inspection. Then collect your keys.',       body: 'Your landlord submitted the move-in inspection — every room, meter reading and key photographed. Review and counter-sign so the record is official.', timing: 'Takes ~3 min' },
  awaiting_activation:           { label: 'Awaiting activation',         sub: 'Step 10 of 10',  mode: 'new',     currentIndex: 9, tone: 'waiting',  headline: 'Everything’s in. Landlord is activating your tenancy.', body: 'Utility submitted, inspection counter-signed, Ejari live. Your landlord just needs to flip the switch.',                                              timing: 'Usually within hours' },
  active:                        { label: 'Active tenancy',              sub: 'Step 10 of 10 — tenancy is live', mode: 'new', currentIndex: 9, tone: 'celebrate', headline: 'Your tenancy is live.',                              body: 'Manage payments, raise issues, or start a renewal request from here any time.',                                                                    timing: null },
  termination_request_received:  { label: 'Landlord requested termination', sub: 'Respond required', mode: 'new', currentIndex: 9, tone: 'action',  headline: 'Your landlord wants to end the contract early.',       body: 'Your landlord submitted a termination request. Review the reason and effective date, then accept (lease ends on that date) or reject.',                timing: 'Awaiting your response' },
  termination_request_sent:      { label: 'Your termination request',    sub: 'Awaiting landlord', mode: 'new', currentIndex: 9, tone: 'waiting',  headline: 'Your request is with the landlord.',                   body: 'You asked to end the tenancy. Your contract stays active until your landlord accepts. We’ll notify you the moment they respond.',                       timing: 'Awaiting landlord response' },

  renewal_offered:   { label: 'Renewal offered',     sub: 'Renewal step 1 of 6',         mode: 'renewal',  currentIndex: 0, tone: 'action',    headline: 'Stay another year? Here are the new terms.',         body: 'Your landlord proposed renewal terms. Review and accept, or reject and propose changes.',                                          timing: 'Awaiting your decision' },
  renewal_documents: { label: 'Renewal documents',   sub: 'Renewal step 2 of 6',         mode: 'renewal',  currentIndex: 1, tone: 'action',    headline: 'Quick paperwork refresh for the renewal.',           body: 'Renewals need fresh copies of your Emirates ID and visa — old ones don’t carry over.',                                              timing: 'Takes ~3 min' },
  renewal_cheques:   { label: 'Renewal cheques',     sub: 'Renewal step 3 of 6',         mode: 'renewal',  currentIndex: 2, tone: 'action',    headline: 'New year, new cheques.',                              body: 'Your landlord prepared the renewal schedule. Prepare the cheques, then confirm.',                                                   timing: 'Confirm when ready' },
  renewal_progress:  { label: 'Sign your renewal',   sub: 'Renewal step 4 of 6',         mode: 'renewal',  currentIndex: 3, tone: 'action',    headline: 'Last bit — sign your renewal.',                       body: 'Your landlord has signed. Add your signature to lock in the renewed lease.',                                                        timing: 'Takes ~2 min' },
  renewal_ejari:     { label: 'Renewing Ejari',      sub: 'Renewal step 5 of 6',         mode: 'renewal',  currentIndex: 4, tone: 'waiting',   headline: 'Your landlord is renewing Ejari.',                    body: 'The Dubai Land Department is updating your Ejari record. Usually 2–5 business days.',                                              timing: '2–5 business days' },
  renewal_active:    { label: 'Renewal active',      sub: 'Renewal step 6 of 6 — done',  mode: 'renewal', currentIndex: 5, tone: 'celebrate', headline: 'Your renewal is live.',                       body: 'Everything carries over — same unit, same deposit, fresh paperwork.',                                                               timing: null },

  rejected:          { label: 'Application declined', sub: 'This unit',                  mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'Your landlord declined this application.',          body: 'Sometimes it’s the landlord, sometimes it’s timing. We’ll help you find a place that fits.',                                         timing: null },
  terminated:        { label: 'Tenancy terminated',   sub: 'Contract closed',            mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'Your tenancy has ended.',                          body: 'The contract was terminated. Final settlements processed; security deposit return pending move-out inspection.',                    timing: null },
  renewal_rejected:  { label: 'Renewal declined',     sub: 'Renewal closed',             mode: 'renewal',  currentIndex: -1, tone: 'declined', headline: 'You declined this renewal offer.',                 body: 'Your landlord can propose new terms, or your tenancy will end as scheduled.',                                                       timing: null },
};

interface Step { key: string; label: string; short: string; icon: string }

const STEPS_NEW: Step[] = [
  { key: 'viewing_book',    label: 'Viewing booked',     short: 'Booked',   icon: 'calendar' },
  { key: 'viewing_attend',  label: 'Attend viewing',     short: 'Visit',    icon: 'binoculars' },
  { key: 'documents',       label: 'Rental documents',   short: 'Docs',     icon: 'document' },
  { key: 'payment_plan',    label: 'Payment plan',       short: 'Plan',     icon: 'wallet' },
  { key: 'contract_issued', label: 'Contract issued',    short: 'Issued',   icon: 'scroll' },
  { key: 'sign',            label: 'Sign contract',      short: 'Sign',     icon: 'pen' },
  { key: 'ejari',           label: 'Ejari registration', short: 'Ejari',    icon: 'stamp' },
  { key: 'utility',         label: 'Utility account',    short: 'Utility',  icon: 'bolt' },
  { key: 'move_in',         label: 'Move-in inspection', short: 'Move-in',  icon: 'key' },
  { key: 'active',          label: 'Active tenancy',     short: 'Active',   icon: 'active' },
];
const STEPS_RENEWAL: Step[] = [
  { key: 'terms_offered',   label: 'Terms offered',      short: 'Terms',    icon: 'envelope' },
  { key: 'documents',       label: 'Renewal documents',  short: 'Docs',     icon: 'document' },
  { key: 'payment_plan',    label: 'Cheques',            short: 'Cheques',  icon: 'wallet' },
  { key: 'sign',            label: 'Sign renewal',       short: 'Sign',     icon: 'pen' },
  { key: 'ejari',           label: 'Ejari renewal',      short: 'Ejari',    icon: 'stamp' },
  { key: 'active',          label: 'Renewal active',     short: 'Active',   icon: 'active' },
];

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
  tenantProfileId: number | null;
  myDocs: TenantDoc[];
}

function deriveStateKey(r: Resolved): StateKey {
  const c = r.contract;
  const rc = r.renewalContract;
  const viewing = r.viewing;

  // 1. Renewal proposal status on the original contract — wins over child state.
  //    When the RP just proposed, the child contract exists in 'pending' state
  //    BUT the tenant hasn't accepted yet → must show the Terms-Offered screen
  //    (renewal step 1), not the cheques screen. Only after `renewalAccepted` is
  //    `'accepted'` do we walk through the child contract's progress.
  if (c?.renewalAccepted === 'pending') return 'renewal_offered';
  if (c?.renewalAccepted === 'rejected') return 'renewal_rejected';

  // 2. Renewal child in flight — only consulted AFTER tenant has accepted.
  if (rc) {
    if (rc.status === 'terminated') return 'renewal_rejected';
    if (rc.status === 'active') return 'renewal_active';
    if (rc.ejariStatus === 'registered') return 'renewal_ejari';
    if (rc.status === 'issued' && rc.tenantSignedAt) return 'renewal_ejari';
    if (rc.status === 'issued' && !rc.tenantSignedAt) return 'renewal_progress';
    return 'renewal_cheques';
  }

  // 3. Original contract
  if (c) {
    if (c.status === 'terminated') return 'terminated';

    // Termination request in flight on an active/issued contract
    const t = c.termination;
    if (t?.response === 'pending') {
      if (t.requestedByRole === 'rental_provider') return 'termination_request_received';
      if (t.requestedByRole === 'tenant') return 'termination_request_sent';
    }

    if (c.status === 'active') return 'active';
    const hasUtility = c.utilityStatus === 'submitted' || c.utilityStatus === 'verified';
    const inspectionSubmitted = !!c.moveInInspection?.submitted;
    const inspectionSignedByTenant = !!c.moveInInspection?.signedByTenant;
    const moveInSubmittedNeedsSig = inspectionSubmitted && !inspectionSignedByTenant;

    // Move-in flow:
    //  1. inspection submitted + not yet signed by tenant → tenant action (move_in)
    //  2. inspection signed by tenant, contract not yet active → awaiting_activation
    //  3. utility + ejari done but inspection NOT submitted yet → awaiting_movein_inspection
    //     (this is what the customer was previously missing — RP is between step 4
    //     and step 5 on their timeline, customer should see the same).
    if (moveInSubmittedNeedsSig) return 'move_in';
    if (c.ejariStatus === 'registered' && hasUtility && inspectionSignedByTenant) return 'awaiting_activation';
    if (c.ejariStatus === 'registered' && hasUtility) return 'awaiting_movein_inspection';
    if (c.ejariStatus === 'registered') return 'utility';
    if (c.status === 'issued' && c.tenantSignedAt) return 'ejari';
    if (c.status === 'issued' && !c.tenantSignedAt) return 'signature';
    return 'contract_issued';
  }

  // 4. Real-data signal: payment plan exists overrides stale stage flags
  const stage = r.stage;
  if (stage === 'rejected') return 'rejected';
  if (r.paymentPlan && (!stage || ['documents_collection', 'payment_plan_shared', 'applied', 'offer_made', 'approved', 'converted'].includes(stage))) {
    return 'payment_plan';
  }

  // 5. Lead stage
  if (stage === 'contract_issued') return 'contract_issued';
  if (stage === 'cheques_collected') return 'contract_issued';
  if (stage === 'cheques_submitted') return 'cheques_submitted';
  if (stage === 'payment_plan_shared') return 'payment_plan';
  if (stage === 'documents_collection') return r.allRequiredDocsUploaded ? 'documents_submitted' : 'documents';
  if (stage === 'approved' || stage === 'converted') return 'contract_issued';
  if (stage === 'applied' || stage === 'offer_made') return 'application_review';

  // 6. Viewing-derived
  if (viewing) {
    if (viewing.outcome === 'not_interested') return 'rejected';
    if (viewing.status === 'no_show' || viewing.status === 'cancelled') return 'rejected';
    if (viewing.status === 'completed') return r.allRequiredDocsUploaded ? 'documents_submitted' : 'documents';
  }
  return 'viewing';
}

function stepsFor(stateKey: StateKey): { steps: (Step & { state: 'done' | 'current' | 'future' | 'declined' })[]; mode: Mode } {
  const def = STATE_DEFS[stateKey];
  const baseSteps = def.mode === 'renewal' ? STEPS_RENEWAL : STEPS_NEW;
  return {
    mode: def.mode,
    steps: baseSteps.map((s, i) => ({
      ...s,
      state: def.mode === 'rejected'
        ? 'declined'
        // Celebrate states (active tenancy, renewal active) = journey complete →
        // mark every step including the final one as 'done' (green), not 'current' (red).
        // The brick "now" indicator only makes sense while there's still an action to take.
        : def.tone === 'celebrate'
          ? (i <= def.currentIndex ? 'done' : 'future')
          : i < def.currentIndex ? 'done' : i === def.currentIndex ? 'current' : 'future',
    })),
  };
}

/* ─── Helpers ──────────────────────────────────────────────────────── */
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
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-AE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' });
}
function fmtDateShort(iso: string) {
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
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
  const { steps } = stepsFor(stateKey);
  const currentStep = steps[def.currentIndex];
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
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>{def.body}</p>
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
function ActionBody({ stateKey, resolved, onRefresh }: { stateKey: StateKey; resolved: Resolved; onRefresh: () => void }) {
  switch (stateKey) {
    case 'viewing':                       return <ViewingAction resolved={resolved} onRefresh={onRefresh} />;
    case 'application_review':            return <WaitingBadge />;
    case 'documents':                     return <DocumentsAction resolved={resolved} onRefresh={onRefresh} />;
    case 'documents_submitted':           return <WaitingBadge />;
    case 'payment_plan':                  return <PaymentPlanAction resolved={resolved} onRefresh={onRefresh} />;
    case 'cheques_submitted':             return <WaitingBadge />;
    case 'contract_issued':               return <WaitingBadge />;
    case 'signature':                     return <SignatureAction resolved={resolved} onRefresh={onRefresh} />;
    case 'ejari':                         return <WaitingBadge />;
    case 'utility':                       return <UtilityAction resolved={resolved} onRefresh={onRefresh} />;
    case 'awaiting_movein_inspection':    return <AwaitingMoveInAction />;
    case 'move_in':                       return <MoveInAction resolved={resolved} />;
    case 'awaiting_activation':           return <WaitingBadge />;
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
    default:                              return null;
  }
}

/* ─── VIEWING ──────────────────────────────────────────────────────── */
function ViewingAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const [modal, setModal] = useState<'reschedule' | 'not_interested' | null>(null);
  const v = resolved.viewing;
  if (!v) return null;
  const when = new Date(v.scheduledAt);
  const dateStr = when.toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' });
  const timeStr = when.toLocaleTimeString('en-AE', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' });
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '18px 20px' }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, fontWeight: 600 }}>Your viewing</p>
        <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: '6px 0 2px' }}>{dateStr}</p>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0 }}>{timeStr}</p>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <SecondaryBtn onClick={() => setModal('reschedule')}>Reschedule viewing</SecondaryBtn>
        <SecondaryBtn onClick={() => setModal('not_interested')}>Not interested</SecondaryBtn>
      </div>
      {modal === 'reschedule' && v && <RescheduleModal viewing={v} onClose={() => setModal(null)} onSuccess={() => { setModal(null); onRefresh(); }} />}
      {modal === 'not_interested' && v && <NotInterestedModal viewing={v} onClose={() => setModal(null)} onSuccess={() => { setModal(null); onRefresh(); }} />}
    </div>
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
      <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 0 }}>We’ll close this lead and remove it from your active spaces. Adding a brief reason helps us recommend better next time.</p>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional — e.g. wrong neighbourhood, found another place…" rows={3}
        style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1px solid var(--mist-strong)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
      {err && <ErrorBox msg={err} />}
    </Modal>
  );
}

/* ─── DOCUMENTS ────────────────────────────────────────────────────────
 * Inline Step 3: contract preferences (start date + payment schedule) +
 * required-doc uploads + submit. Mirrors the v1 panel exactly so the two
 * pages stay behaviourally identical.
 *
 *   PATCH /api/leads/my-viewings/:viewingId/preferences  →  saves desiredMoveIn + preferredChequeCount
 *   POST  /api/documents/upload-url                      →  3-step upload of each required doc
 *   POST  /api/documents
 *
 * The Document Hub link is kept as a secondary action for KYC and ad-hoc files.
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
  const viewing = resolved.viewing;
  const viewingId = viewing?.id;
  const unit = resolved.unit;
  const unitType = unit?.unitType ?? null;
  const rp = unit?.property?.rentalProvider ?? unit?.property?.rental_provider ?? null;
  const rpPreferredDays: number[] = rp?.preferredStartDays ?? [];

  const requiredDocs: DocReq[] = useMemo(() => getRequiredDocs(unitType).filter(d => d.required), [unitType]);
  const uploadedKeys = useMemo(() => new Set(resolved.myDocs.map(d => d.documentKey)), [resolved.myDocs]);
  // Occupants — only meaningful for residential. We don't persist count in
  // the DB; the uploaded `occupant_N_*` doc keys are the source of truth.
  const RESIDENTIAL_BLOCKLIST = ['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical','coworking_desk','private_office','meeting_room','day_office','event_hall','wedding_venue','conference_hall','private_dining','outdoor_venue','warehouse','open_yard','storage_unit','cold_storage','logistics_facility'];
  const isResidential = !unitType || !RESIDENTIAL_BLOCKLIST.includes(unitType);
  const initialOccupantCount = useMemo(
    () => deriveOccupantCount(resolved.myDocs.map(d => d.documentKey)),
    [resolved.myDocs],
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

  // ── Contract preferences (start date, instalments) ─────────────────────
  const _init = (viewing?.desiredMoveIn ?? '').slice(0, 10);
  const _initDay = _init ? parseInt(_init.slice(8, 10)) || 1 : 1;
  const [prefMonth, setPrefMonth] = useState<string>(_init.slice(0, 7) || '');
  const [prefDay,   setPrefDay]   = useState<number>(_init ? _initDay : (rpPreferredDays[0] ?? 1));
  const [prefCheques, setPrefCheques] = useState<number>(viewing?.preferredChequeCount ?? 4);
  const prefMoveIn = prefMonth ? `${prefMonth}-${String(prefDay).padStart(2, '0')}` : '';
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefSaved,  setPrefSaved]  = useState(false);
  const [prefError,  setPrefError]  = useState<string | null>(null);

  // ── Calendar dropdown ──────────────────────────────────────────────────
  const today = new Date();
  const [calOpen, setCalOpen] = useState(false);
  const [calYear, setCalYear] = useState(_init ? parseInt(_init.slice(0, 4)) : today.getFullYear());
  const [calMonth, setCalMonth] = useState(_init ? parseInt(_init.slice(5, 7)) - 1 : today.getMonth());
  const calRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!calOpen) return;
    const close = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [calOpen]);
  function calPrev() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  }
  function calNext() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  }

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
    if (!viewingId) return;
    setPrefSaving(true); setPrefError(null); setPrefSaved(false);
    try {
      const res = await fetch(`/api/leads/my-viewings/${viewingId}/preferences`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          desiredMoveIn: prefMoveIn || undefined,
          preferredChequeCount: prefCheques,
          paymentType: 'postdated_cheque',
        }),
      });
      if (!res.ok) { setPrefError('Failed to save preferences'); return; }
      setPrefSaved(true);
      onRefresh();
    } finally { setPrefSaving(false); }
  }

  // Once submitted, collapse to a single status line — Step 4 takes focus.
  if (prefSaved) {
    return (
      <div style={{ background: 'var(--saffron-soft)', border: '1px solid #f0d68f', borderRadius: 12, padding: '12px 14px', display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
        <CheckCircle2 size={14} color="var(--jade-deep)" />
        <span style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600 }}>
          Documents &amp; preferences submitted — landlord will issue the payment plan.
        </span>
      </div>
    );
  }

  const calFirstDow = new Date(calYear, calMonth, 1).getDay();
  const calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calMonthLabel = new Date(calYear, calMonth, 1).toLocaleString('en-AE', { month: 'long', year: 'numeric' });
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayAllowed = (day: number) => rpPreferredDays.length === 0 || rpPreferredDays.includes(day);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {uploadError && <ErrorBox msg={uploadError} />}
      {prefError   && <ErrorBox msg={prefError} />}

      {/* Contract Start Date */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
          Contract Start Date <span style={{ color: 'var(--brick)' }}>*</span>
        </p>
        <div style={{ position: 'relative' }} ref={calRef}>
          <button type="button" onClick={() => setCalOpen(o => !o)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'var(--paper)', border: `1px solid ${prefMoveIn ? 'var(--jade)' : 'var(--mist-strong)'}`,
              color: prefMoveIn ? 'var(--ink)' : 'var(--mute)', fontFamily: 'inherit',
            }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={13} color={prefMoveIn ? 'var(--jade-deep)' : 'var(--mute)'} />
              {prefMoveIn ? new Date(`${prefMoveIn}T00:00:00`).toLocaleDateString('en-AE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Choose start date'}
            </span>
            <ChevronDown size={13} color="var(--mute)" style={{ transition: 'transform 0.15s', transform: calOpen ? 'rotate(180deg)' : 'none' }} />
          </button>
          {calOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--paper)', borderRadius: 12, border: '1px solid var(--mist-strong)', boxShadow: '0 10px 25px rgba(0,0,0,0.12)', zIndex: 30, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <button type="button" onClick={calPrev} style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer' }}><ChevronLeft size={14} /></button>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{calMonthLabel}</span>
                <button type="button" onClick={calNext} style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer' }}><ChevronRight size={14} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: 'var(--mute)', padding: '2px 0' }}>{d}</div>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
                {Array.from({ length: calFirstDow }, (_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: calDaysInMonth }, (_, i) => {
                  const day = i + 1;
                  const isActive = dayAllowed(day);
                  const isPast = new Date(calYear, calMonth, day) < todayMidnight;
                  const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const isSelected = dateStr === prefMoveIn;
                  if (!isActive) return <div key={day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 28, fontSize: 10, color: 'var(--mist-strong)' }}>{day}</div>;
                  return (
                    <button key={day} type="button" disabled={isPast}
                      onClick={() => {
                        const mm = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
                        setPrefMonth(mm); setPrefDay(day); setCalOpen(false);
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', height: 28, borderRadius: 8,
                        fontSize: 11, fontWeight: 700, border: 'none', fontFamily: 'inherit',
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
                <p style={{ fontSize: 9, color: 'var(--mute)', margin: '8px 0 0', lineHeight: 1.4 }}>
                  Only days highlighted by the landlord can be selected as a start date.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Number of Payments */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>Number of Payments</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {([[ 1,'Annual'],[2,'Semi-Annual'],[4,'Quarterly'],[6,'Bi-Monthly'],[12,'Monthly']] as const).map(([n, label]) => (
            <button key={n} type="button" onClick={() => setPrefCheques(n)}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${prefCheques === n ? 'var(--jade)' : 'var(--mist-strong)'}`,
                background: prefCheques === n ? 'var(--jade)' : 'var(--paper)',
                color: prefCheques === n ? 'var(--paper)' : 'var(--ink-2)', fontFamily: 'inherit',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Number of Occupants (residential only) */}
      {isResidential && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>Number of Occupants</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={() => setOccupantCount(c => Math.max(1, c - 1))}
              disabled={occupantCount <= 1}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8, border: '1px solid var(--mist-strong)', background: 'var(--paper)',
                color: 'var(--ink-2)', fontFamily: 'inherit', fontWeight: 700,
                cursor: occupantCount <= 1 ? 'not-allowed' : 'pointer', opacity: occupantCount <= 1 ? 0.4 : 1,
              }}>−</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', minWidth: 20, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{occupantCount}</span>
            <button type="button" onClick={() => setOccupantCount(c => c + 1)}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8, border: '1px solid var(--mist-strong)', background: 'var(--paper)',
                color: 'var(--ink-2)', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer',
              }}>+</button>
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--mute)' }}>
              {occupantCount === 1 ? 'Just me' : `${occupantCount - 1} additional ${occupantCount === 2 ? 'occupant' : 'occupants'}`}
            </span>
          </div>
          {occupantCount > 1 && (
            <p style={{ fontSize: 10, color: 'var(--mute)', margin: '8px 0 0', lineHeight: 1.4 }}>
              Each additional occupant needs Emirates ID, Passport, and UAE Visa uploaded below.
            </p>
          )}
        </div>
      )}

      {/* Required documents — inline upload */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 8 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
          {renewal ? 'Renewal documents' : 'Required documents'}
        </p>
        {requiredDocs.length === 0 && occupantDocs.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0 }}>No documents required for this unit type.</p>
        ) : (
          <>
            {requiredDocs.map(req => {
              const rec = resolved.myDocs.find(d => d.documentKey === req.key);
              const isUploaded = !!rec;
              const isUploading = docUploading === req.key;
              return (
                <label key={req.key} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
                  background: isUploaded ? 'rgba(46,159,130,0.08)' : 'var(--paper)',
                  border: `1px solid ${isUploaded ? 'rgba(46,159,130,0.35)' : 'var(--mist-strong)'}`,
                  cursor: isUploading ? 'progress' : 'pointer',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{req.label}</p>
                    <p style={{ fontSize: 10, color: 'var(--mute)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isUploaded ? (rec.displayName ?? 'Uploaded') : 'Tap to upload'}
                    </p>
                  </div>
                  {isUploading ? <Loader2 size={14} className="animate-spin" color="var(--jade-deep)" />
                    : isUploaded ? <CheckCircle2 size={14} color="var(--jade-deep)" />
                    : <UploadCloud size={14} color="var(--mute)" />}
                  <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                    disabled={isUploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(req, f); }} />
                </label>
              );
            })}
            {occupantDocs.length > 0 && (
              <>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '6px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Info size={11} /> Identity documents for additional occupants
                </p>
                {occupantDocs.map(req => {
                  const rec = resolved.myDocs.find(d => d.documentKey === req.key);
                  const isUploaded = !!rec;
                  const isUploading = docUploading === req.key;
                  return (
                    <label key={req.key} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
                      background: isUploaded ? 'rgba(46,159,130,0.08)' : 'var(--paper)',
                      border: `1px solid ${isUploaded ? 'rgba(46,159,130,0.35)' : 'var(--mist-strong)'}`,
                      cursor: isUploading ? 'progress' : 'pointer',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{req.label}</p>
                        <p style={{ fontSize: 10, color: 'var(--mute)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isUploaded ? (rec.displayName ?? 'Uploaded') : 'Tap to upload'}
                        </p>
                      </div>
                      {isUploading ? <Loader2 size={14} className="animate-spin" color="var(--jade-deep)" />
                        : isUploaded ? <CheckCircle2 size={14} color="var(--jade-deep)" />
                        : <UploadCloud size={14} color="var(--mute)" />}
                      <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                        disabled={isUploading}
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(req, f); }} />
                    </label>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      {/* Submit + checklist */}
      <div style={{ display: 'grid', gap: 8 }}>
        {(!prefMoveIn || !docsOk) && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '8px 12px', display: 'grid', gap: 4 }}>
            <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Complete before submitting</p>
            <p style={{ fontSize: 11, color: prefMoveIn ? 'var(--jade-deep)' : 'var(--mute)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {prefMoveIn ? <CheckCircle2 size={11} /> : <span style={{ width: 10, height: 10, borderRadius: 999, border: '1px solid var(--mist-strong)' }} />}
              Contract start date
            </p>
            <p style={{ fontSize: 11, color: docsOk ? 'var(--jade-deep)' : 'var(--mute)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {docsOk ? <CheckCircle2 size={11} /> : <span style={{ width: 10, height: 10, borderRadius: 999, border: '1px solid var(--mist-strong)' }} />}
              All required documents uploaded
            </p>
          </div>
        )}
        <PrimaryBtn onClick={handleSubmit} disabled={!prefMoveIn || !docsOk || prefSaving || !viewingId}>
          {prefSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {prefSaving ? 'Submitting…' : 'Submit'}
        </PrimaryBtn>
        <SecondaryBtn href="/dashboard/customer/documents">
          <Info size={14} /> Manage KYC &amp; other documents
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
  const fmt = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
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
  <p class="sub">${buildingName} · Issued ${plan.issuedAt ? new Date(plan.issuedAt).toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' }) : '—'}</p>

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

  <div class="footer">Generated by UpNow · ${new Date().toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' })}</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) { alert('Please allow pop-ups to open the payment plan.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* ─── PAYMENT PLAN ─────────────────────────────────────────────────── */
function PaymentPlanAction({ resolved, onRefresh }: { resolved: Resolved; onRefresh: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plan = resolved.paymentPlan;
  const leadId = resolved.lead?.id ?? resolved.viewing?.lead?.id ?? resolved.viewing?.leadId ?? null;

  if (!plan) {
    return (
      <div style={{ background: 'var(--saffron-soft)', border: '1px solid #f0d68f', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Clock size={18} style={{ color: 'var(--saffron-deep)', flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
          Your landlord is preparing the payment plan. We&apos;ll notify you the moment it&apos;s ready to review.
        </p>
      </div>
    );
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
    if (t === 'security_deposit') return { label: 'Deposit',  bg: 'var(--mist)',         fg: 'var(--ink-2)' };
    if (t === 'first_bundle')     return { label: 'Move-in',  bg: 'var(--saffron-soft)', fg: 'var(--saffron-deep)' };
    if (t === 'extra_installment')return { label: 'Extra',    bg: 'var(--jade-soft)',    fg: 'var(--jade-deep)' };
    return                            { label: 'Rent',     bg: 'var(--surface)',      fg: 'var(--mute)' };
  };

  const payeeName = plan.chequesPayableTo
    || resolved.unit?.property?.rentalProvider?.companyName
    || resolved.unit?.property?.rentalProvider?.user?.name
    || null;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {payeeName && (
        <div style={{ background: 'var(--saffron-soft, #fef9c3)', border: '1px solid #fde68a', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>✏️</span>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#854d0e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Write on your cheques — Payable to</p>
            <p style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 700, color: '#1a1916' }}>{payeeName}</p>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Stat label="Annual rent" value={fmtAedFils(plan.rentFils)} />
        <Stat label="Total contract value" value={fmtAedFils(plan.totalAmountFils)} accent />
        <Stat label="First payment" value={firstDue ? fmtDateShort(firstDue) : '—'} />
      </div>

      {/* Cheque payee — visible without opening the print view */}
      <div style={{
        background: 'var(--jade-soft)', border: '1px solid var(--jade)', borderRadius: 12,
        padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 10, color: 'var(--jade-deep)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>
            Cheque payee (landlord)
          </p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '4px 0 0', letterSpacing: '-0.01em' }}>
            {resolveChequePayee(resolved.unit)}
          </p>
        </div>
        <p style={{ fontSize: 11, color: 'var(--jade-deep)', margin: 0, fontStyle: 'italic', maxWidth: 240 }}>
          Write your cheques out to this name exactly as shown.
        </p>
      </div>
      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--mist-strong)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cheque schedule · {plan.chequeCount} cheques</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 10, color: 'var(--mute)', fontWeight: 500 }}>Issued {fmtDateShort(plan.issuedAt)}</span>
            <button type="button" onClick={() => printPaymentPlan(resolved, (user?.name ?? '').trim() || '—')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--jade-deep)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Printer size={12} /> Print / Save PDF
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <p style={{ padding: '14px 16px', fontSize: 12, color: 'var(--mute)', margin: 0 }}>No cheque items listed.</p>
        ) : items.map((ch, i) => {
          const meta = typeMeta(ch.type);
          return (
            <div key={ch.index} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto auto', gap: 14, alignItems: 'center', padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--mist)' }}>
              <span style={{ fontSize: 12, color: 'var(--mute)', fontWeight: 600 }}>#{ch.index}</span>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{ch.description ?? (ch.type === 'security_deposit' ? 'Security deposit' : `Cheque ${ch.index}`)}</p>
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
          <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, fontWeight: 600 }}>Notes from your landlord</p>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{plan.notes}</p>
        </div>
      )}
      {err && <ErrorBox msg={err} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <PrimaryBtn onClick={confirm} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy ? 'Confirming…' : 'Confirm cheques are ready'}
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ─── SIGNATURE (new contract OR renewal) ──────────────────────────── */
function SignatureAction({ resolved, onRefresh, renewal }: { resolved: Resolved; onRefresh: () => void; renewal?: boolean }) {
  const { user } = useAuth();
  const c = renewal ? resolved.renewalContract : resolved.contract;
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState(user?.name ?? '');
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
  const [acc, setAcc] = useState(c?.utilityAccountNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!c) return <ErrorBox msg="Contract not found." />;

  async function submit() {
    if (!acc.trim()) { setErr('Enter your utility account number.'); return; }
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
      await fetch('/api/documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'customer', ownerId: resolved.tenantProfileId, documentKey: 'utility_proof_of_payment', category: 'payment', displayName: 'Utility Proof of Payment', fileUrl, mimeType: file.type, s3Key: fileKey, isVisibleToTenant: true }) });
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
        <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Proof of payment (optional)</label>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadProof(f); }} />
        <SecondaryBtn onClick={() => fileRef.current?.click()}>
          {proofBusy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
          {proofBusy ? 'Uploading…' : 'Upload proof file'}
        </SecondaryBtn>
      </div>
      {err && <ErrorBox msg={err} />}
      <PrimaryBtn onClick={submit} disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
        {busy ? 'Submitting…' : 'Submit utility account'}
      </PrimaryBtn>
    </div>
  );
}

/* ─── MOVE-IN — waiting for RP to submit the inspection ─────────── */
// Shown before the landlord submits the move-in inspection record. Walks
// the tenant through what's happening on the RP side and what to expect
// next, so the wait feels intentional rather than empty.
function AwaitingMoveInAction() {
  const checklistItems = [
    'Walking through every room with you (or your representative)',
    'Photographing the unit’s current condition — walls, floors, fittings, appliances',
    'Recording DEWA electricity and water meter readings',
    'Counting keys, fobs, and parking remotes before handover',
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: 'var(--saffron-soft)', border: '1px solid #f0d68f', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Clock size={18} style={{ color: 'var(--saffron-deep)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, lineHeight: 1.5, fontWeight: 600 }}>
              Your landlord is on-site preparing the move-in inspection.
            </p>
            <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '6px 0 0', lineHeight: 1.5 }}>
              The full inspection record is what protects your security deposit at move-out, so they take their time to document everything thoroughly.
            </p>
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: '16px 18px' }}>
        <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: '0 0 10px' }}>
          What the landlord is doing
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {checklistItems.map((item, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%', background: 'var(--surface)',
                border: '1px solid var(--mist-strong)', display: 'grid', placeItems: 'center',
                fontSize: 10, fontWeight: 700, color: 'var(--mute)', flexShrink: 0, marginTop: 1,
              }}>{i + 1}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <p style={{ fontSize: 11, color: 'var(--mute)', margin: 0, fontStyle: 'italic', textAlign: 'center' }}>
        You&apos;ll get a notification the moment the inspection is ready to counter-sign.
      </p>
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

  const inspectionUrl = `/dashboard/customer/contracts/${c.id}/inspection?type=move_in`;
  const submittedAt = insp?.reportGeneratedDate ?? insp?.inspectionDate ?? c.moveInInspection?.signedAt ?? null;
  const submittedLabel = submittedAt
    ? `Submitted ${new Date(submittedAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })}`
    : 'Submitted by landlord';
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
                  {new Date(insp.moveInDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })}
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
                <p style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>Landlord notes</p>
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
  const [section, setSection] = useState<'payments' | 'documents'>('payments');
  const [showTerm, setShowTerm] = useState(false);
  const tenantDocs = resolved.myDocs;

  if (!c) return null;

  const u = resolved.unit;
  const pp = resolved.paymentPlan;
  const fmtD = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : '—';
  const aed = (fils: number) => `AED ${(fils / 100).toLocaleString('en-AE')}`;

  const building = u?.property?.buildingName ?? '—';
  const unitNum  = u?.unitNumber ?? null;
  const unitName = u?.unitName ?? null;
  const community = u?.property?.community?.name ?? '';
  const emirate   = u?.property?.emirate?.name ?? '';
  const location  = [community, emirate].filter(Boolean).join(', ') || '—';
  const rp = u?.property?.rentalProvider ?? u?.property?.rental_provider;
  const landlordName = rp?.user?.name?.trim() || rp?.companyName?.trim() || 'Your landlord';
  const tenantName   = ''; // not on Resolved; omit rather than guess

  const today = new Date();
  const chequeItems = (pp?.items ?? []).filter(it => it.type !== 'security_deposit');
  const nextCheque = chequeItems.find(it => it.dueDate && new Date(it.dueDate + 'T00:00:00') >= today);

  const sections = [
    { k: 'payments'  as const, label: 'Payments',  sub: chequeItems.length ? `${chequeItems.length} cheques · ${pp ? aed(pp.rentFils) : '—'}` : 'No schedule yet' },
    { k: 'documents' as const, label: 'Documents', sub: tenantDocs ? `${tenantDocs.filter(d => d.documentKey !== 'profile_picture').length} docs on file` : 'KYC + Ejari + utility' },
  ];

  return (
    <div style={{ display: 'grid', gap: 18 }}>

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
              background: 'var(--jade-deep)', color: 'var(--paper)',
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <Sparkles size={10} /> Active tenancy
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
              {pp ? aed(pp.rentFils) : c.annualRent ? `AED ${(c.annualRent / 100).toLocaleString('en-AE')}` : '—'}
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
            {pp && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>Contract value</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--jade-deep)', margin: '2px 0 0', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                  {aed(pp.totalAmountFils)}
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
                    padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                    background: isPast ? 'var(--jade-soft)' : 'var(--saffron-soft)',
                    color: isPast ? 'var(--jade-deep)' : 'var(--saffron-deep)',
                  }}>{isPast ? 'cleared' : 'upcoming'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Documents section ── */}
      {section === 'documents' && (
        <div style={{ display: 'grid', gap: 12 }}>

          {/* Your documents — fetched from /api/documents/my */}
          <div style={{ background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 14, padding: 18 }}>
            {(() => {
              const visible = (tenantDocs ?? []).filter(d => d.documentKey !== 'profile_picture');
              const approved = visible.filter(d => d.status === 'processed' || d.status === 'complete').length;
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: 0, letterSpacing: '-0.015em' }}>Your documents</p>
                    {!false && visible.length > 0 && (
                      <p style={{ fontSize: 11, color: 'var(--mute)', margin: 0 }}>{approved}/{visible.length} approved</p>
                    )}
                  </div>
                  {false ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--mute)', fontSize: 13 }}>
                      <Loader2 size={14} className="animate-spin" /> Loading…
                    </div>
                  ) : visible.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0 }}>No documents uploaded yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      {visible.map((d, i) => {
                        const isDone = d.status === 'processed' || d.status === 'complete';
                        const isRejected = d.status === 'rejected';
                        const isPending = d.status === 'pending' || d.status === 'attached';
                        const label = d.displayName || DOC_LABELS[d.documentKey] || d.documentKey.replace(/_/g, ' ');
                        const statusLabel = isDone ? 'Approved' : isRejected ? 'Rejected' : isPending ? 'In Review' : 'Uploaded';
                        const statusBg = isDone ? 'var(--jade-soft)' : isRejected ? 'var(--brick-soft)' : '#fff7ed';
                        const statusFg = isDone ? 'var(--jade-deep)' : isRejected ? 'var(--brick)' : 'var(--saffron-deep)';
                        const inner = (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <CheckCircle2 size={14} color={isDone ? 'var(--jade-deep)' : isRejected ? 'var(--brick)' : 'var(--saffron)'} />
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                            </div>
                            <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600, background: statusBg, color: statusFg, whiteSpace: 'nowrap' }}>{statusLabel}</span>
                          </>
                        );
                        const tileStyle: React.CSSProperties = {
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                          padding: '10px 12px', background: '#f4efe8', border: '1px solid var(--mist)',
                          borderRadius: 12, textDecoration: 'none', cursor: d.fileUrl ? 'pointer' : 'default',
                          fontFamily: 'inherit',
                        };
                        return d.fileUrl
                          ? <a key={i} href={d.fileUrl} target="_blank" rel="noopener noreferrer" style={tileStyle}>{inner}</a>
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
                { label: 'Signed tenancy contract',   href: `/dashboard/customer/contracts/${c.id}` },
                { label: 'Move-in inspection report', href: `/dashboard/customer/contracts/${c.id}/inspection?type=move_in` },
              ].map((d, i) => (
                <Link key={i} href={d.href} style={{
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

          {/* Manage + upload */}
          <Link href="/dashboard/customer/documents" style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '16px 18px',
            background: 'var(--jade-soft)', border: '1.5px dashed var(--jade)',
            borderRadius: 12, textDecoration: 'none',
          }}>
            <UploadCloud size={20} color="var(--jade-deep)" />
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--jade-deep)', margin: 0 }}>Manage &amp; upload documents</p>
              <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0' }}>KYC, rental docs and more</p>
            </div>
            <ArrowRight size={14} color="var(--jade-deep)" style={{ marginLeft: 'auto' }} />
          </Link>
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
          <button onClick={() => setShowTerm(true)} style={{
            padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            background: 'var(--brick-soft)', color: 'var(--brick)', border: '1px solid var(--brick)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
          }}>
            <X size={12} /> Request Termination
          </button>
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
      <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 0 }}>Your landlord must accept the request before the contract terminates. Until then, your lease stays active.</p>
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
        <p style={{ fontSize: 10, color: 'var(--brick)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, fontWeight: 700 }}>Landlord’s request</p>
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
  if (!parent) return <ErrorBox msg="Parent contract not found." />;

  async function act(verb: 'accept' | 'reject') {
    setBusy(verb); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${parent!.id}/renewal/${verb}`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  // ── Derive comparable figures ────────────────────────────────────────
  const currentRent = parent.annualRent ?? 0;
  const newRent = child?.annualRent ?? null;
  const rentDelta = newRent != null && currentRent ? newRent - currentRent : null;
  const rentDeltaPct = newRent != null && currentRent ? Math.round(((newRent - currentRent) / currentRent) * 1000) / 10 : null;

  const newPeriod = child?.startDate && child?.endDate ? `${fmtDateLong(child.startDate)} → ${fmtDateLong(child.endDate)}` : '—';
  const newCheques = child?.numberOfInstallments ?? null;
  const newContractValue = child?.contractValue ?? null;
  const oldEnd = parent.endDate ? fmtDateLong(parent.endDate) : '—';

  const fmt = (v: number | null | undefined) => v != null ? fmtAed(v) : '—';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
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

      {/* Term details grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <TermsCell label="New lease period" value={newPeriod} />
        <TermsCell label="Number of cheques" value={newCheques ? `${newCheques}` : '—'} />
        <TermsCell label="Total contract value" value={fmt(newContractValue)} />
        <TermsCell label="Current lease ends" value={oldEnd} />
      </div>

      {/* Carry-forward note */}
      <div style={{
        background: 'var(--jade-soft)', border: '1px solid var(--jade)', borderRadius: 12,
        padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <CheckCircle2 size={16} style={{ color: 'var(--jade-deep)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--jade-deep)' }}>Carries over:</strong> your existing security deposit moves to the renewed lease — no extra deposit to pay.
        </div>
      </div>

      {/* Cheque schedule link (opens renewal contract for full details) */}
      {child && (
        <SecondaryBtn href={`/dashboard/customer/contracts/${child.id}`}>
          <FileText size={14} /> View full renewal contract + cheque schedule
        </SecondaryBtn>
      )}

      {err && <ErrorBox msg={err} />}

      {/* Accept / Reject actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
        <PrimaryBtn onClick={() => act('accept')} disabled={!!busy}>
          {busy === 'accept' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy === 'accept' ? 'Accepting…' : 'Accept renewal terms'}
        </PrimaryBtn>
        <SecondaryBtn onClick={() => act('reject')}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject terms'}
        </SecondaryBtn>
      </div>
    </div>
  );
}

function TermsCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--paper)', border: '1px solid var(--mist-strong)', borderRadius: 12,
      padding: '12px 14px',
    }}>
      <p style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
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
          Your landlord prepared the renewal cheque schedule on the renewal contract. Once you’ve prepared your cheques, confirm here and we’ll let your landlord collect them.
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
      const kind = spaceKey.startsWith('v-') ? 'viewing' : spaceKey.startsWith('d-') ? 'direct' : null;
      const leadId = Number(spaceKey.slice(2));
      let unit: ApiUnit | null = null;
      let viewing: ApiViewing | null = null;
      let lead: ApiLead | null = null;
      if (kind === 'viewing') {
        const grouped = viewings.filter(v => (v.leadId ?? v.lead?.id) === leadId);
        viewing = grouped.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0] ?? null;
        unit = viewing?.unit ?? null;
      } else if (kind === 'direct') {
        lead = leads.find(l => l.id === leadId) ?? null;
        unit = lead?.unit ?? null;
      }
      if (!unit) { setError('Space not found.'); setLoading(false); return; }
      const allForUnit = contracts.filter(c => c.unit?.id === unit?.id);
      const contract = allForUnit.find(c => !c.parentContractId) ?? null;
      const renewalContract = contract ? (allForUnit.find(c => c.parentContractId === contract.id) ?? null) : null;
      const requiredKeys = getRequiredDocs(unit.unitType).filter(d => d.required).map(d => d.key);
      const uploadedKeys = new Set(docs.filter(d => d.status !== 'missing' && d.status !== 'rejected').map(d => d.documentKey));
      const allRequiredDocsUploaded = requiredKeys.length > 0 && requiredKeys.every(k => uploadedKeys.has(k));
      const paymentPlan = lead?.paymentPlan ?? viewing?.lead?.paymentPlan ?? null;
      const stage = lead?.stage ?? viewing?.lead?.stage ?? viewing?.leadStage ?? null;
      setResolved({ spaceKey, unit, viewing, lead, contract, renewalContract, paymentPlan, stage, allRequiredDocsUploaded, tenantProfileId, myDocs: docs });
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
  const { steps } = stepsFor(stateKey);
  const def = STATE_DEFS[stateKey];

  return (
    <div style={{ ...PALETTE, minHeight: '100vh', background: 'var(--surface)' }}>
      <TopBar resolved={resolved} />
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <QuestMap steps={steps} currentIndex={def.currentIndex} mode={def.mode} />
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
  const originalSteps = stepsFor(originalStateKey).steps;
  const originalDef = STATE_DEFS[originalStateKey];

  // Section 02 — Renewal. Full derivation (renewal-aware).
  const renewalStateKey = deriveStateKey(resolved);
  const renewalSteps = stepsFor(renewalStateKey).steps;
  const renewalDef = STATE_DEFS[renewalStateKey];

  const c = resolved.contract;
  const rc = resolved.renewalContract;
  const endStr = c?.endDate ? new Date(c.endDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : '—';
  const renewalEndStr = rc?.endDate ? new Date(rc.endDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : '—';

  return (
    <div style={{ display: 'grid', gap: 36 }}>
      <DualHeader />

      <DualSection eyebrow="01 · Original lease" title="Your current lease" sub={`Until ${endStr}`} tone="jade">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <QuestMap steps={originalSteps} currentIndex={originalDef.currentIndex} mode={originalDef.mode} />
          <QuestActionCard stateKey={originalStateKey} resolved={resolvedOriginalOnly} onRefresh={onRefresh} />
        </div>
      </DualSection>

      <DualBridge />

      <DualSection eyebrow="02 · Renewal" title={renewalDef.label} sub={rc?.endDate ? `Through ${renewalEndStr}` : 'In progress'} tone="brick">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <QuestMap steps={renewalSteps} currentIndex={renewalDef.currentIndex} mode={renewalDef.mode} />
          <QuestActionCard stateKey={renewalStateKey} resolved={resolved} onRefresh={onRefresh} />
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
