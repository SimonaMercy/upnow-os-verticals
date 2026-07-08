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

import { useState, useEffect, useRef, useCallback, useMemo, Fragment, type CSSProperties } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { REQUESTABLE_DOCS } from '@/lib/requestableDocs';
import { KYC_DOCS, getRentalSectionDocs, getRenewalRequiredDocs, CONTRACT_DOCS } from '@/lib/docRequirements';
import type { DocReq } from '@/lib/docRequirements';
import {
  ArrowLeft, FileText, FileSignature, Stamp, Zap, Key, BadgeCheck,
  ChevronRight, ChevronDown, MapPin, Clock, Bell, Search,
  User, Building2, Calendar, DollarSign, CreditCard, Paperclip,
  ClipboardList, ListChecks, RotateCcw, X, AlertCircle, Check, StickyNote,
  UploadCloud, Eye, Download, ExternalLink, Pencil, ClipboardCheck, Send, Wallet,
  Trash2, Plus,
} from 'lucide-react';
import { CustomerDocsModal } from '@/components/upnow/CustomerDocsModal';
import { DownloadDocButton } from '@/components/upnow/DownloadDocButton';
import { openDocsTogether } from '@/lib/openDocsTogether';
import { type OfferPlan } from '@/components/upnow/OfferReceiptModal';
import { PaymentPlanCard } from '@/components/upnow/PaymentPlanCard';
import { buildCurrentPlan } from '@/lib/currentPlan';
import { fetchPaymentRefs, EMPTY_PAYMENT_REFS, type PaymentRefs } from '@/lib/paymentRefs';
import { openDocViewer } from '@/lib/docViewer';
import { collectClientMeta, ESIGN_CONSENT_TEXT } from '@/lib/signEvidence';
import { docLabel } from '@/lib/docLabel';
import { tenantDisplayName } from '@/lib/tenantName';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { buildInstallmentDueDates } from '@/lib/installmentDates';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface ContractDoc {
  id: number;
  ownerType: string;
  ownerId: number;
  category: string;
  documentKey: string;
  displayName: string | null;
  fileUrl: string;
  status: string;
  issueDate: string | null;
  expiryDate: string | null;
  isVisibleToTenant: boolean;
}

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
  /** Durable "KYC re-verification was required" flag (snapshotted at accept-time). */
  renewalDocsRequiredAt?: string | null;
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
  adminFeeFils: number;
  ejariFeeFils: number;
  customClauses: string[];
  notes: string | null;
  createdAt: string;
  renewalAccepted: 'pending' | 'accepted' | 'rejected' | null;
  renewalStatus: string | null;
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
    effectiveDate: string | null;
    response: 'pending' | 'accepted' | 'rejected' | null;
    respondedAt: string | null;
    /** 'direct' = RP-side direct termination (no customer approval); the lease
     *  stays active until the settlement is marked paid. 'cancelled' = a
     *  pre-active void (restorable). NULL/'mutual' = legacy. */
    method?: 'mutual' | 'direct' | 'cancelled' | null;
  } | null;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null; entityType?: 'individual' | 'company' | null; companyName?: string | null };
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null; bankAccountName?: string | null };
  property: { id: number | null; buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
  unit: { id: number | null; number: string | null; name: string | null; type: string | null; floor: string | null; bedrooms: number | null; bathrooms: number | null };
  documents: ContractDoc[];
  payments: ContractPayment[];
  /** One-off leasing fees (admin / ejari / commission) — stored as their own
   *  rows, kept out of the rent schedule/totals and shown in their own section. */
  fees?: ContractPayment[];
}

// ────────────────────────────────────────────────────────────────────────────
// Step model
// ────────────────────────────────────────────────────────────────────────────

type StepKey = 'issue' | 'documents' | 'cheques' | 'sign' | 'ejari' | 'utility' | 'movein' | 'active' | 'terms' | 'moveout' | 'closeout' | 'settlement';
type Tone = 'action' | 'waiting' | 'celebrate' | 'declined';
type IconKey = 'document' | 'pen' | 'stamp' | 'bolt' | 'key' | 'active' | 'envelope' | 'alert' | 'clock' | 'wallet';

interface Step { key: StepKey; short: string; label: string; icon: IconKey }

const STEPS_NEW: Step[] = [
  { key: 'issue',   short: 'Issue',   label: 'Contract issued',  icon: 'document' },
  { key: 'sign',    short: 'Sign',    label: 'Signatures',        icon: 'pen'      },
  { key: 'ejari',   short: 'Ejari',   label: 'Ejari registration',icon: 'stamp'    },
  { key: 'utility', short: 'Utility', label: 'Utility account',   icon: 'bolt'     },
  { key: 'movein',  short: 'Move-in', label: 'Move-in inspection',icon: 'key'      },
  { key: 'active',  short: 'Active',  label: 'Active tenancy',    icon: 'active'   },
];
const STEPS_RENEWAL: Step[] = [
  { key: 'terms',     short: 'Terms',   label: 'Terms agreed',    icon: 'envelope' },
  { key: 'documents', short: 'KYC',     label: 'Documents',       icon: 'document' },
  { key: 'cheques',   short: 'Cheques', label: 'Cheques / PDC',   icon: 'wallet'   },
  { key: 'sign',      short: 'Sign',    label: 'Signatures',      icon: 'pen'      },
  { key: 'ejari',     short: 'Ejari',   label: 'Ejari renewal',   icon: 'stamp'    },
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
    // Renewal Cheques/PDC step — done once the RP confirms the cheques collected.
    case 'cheques': return st.pdcConfirmed;
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

/** Generic upload types kept from the legacy page — the contract-specific
 *  checklist types (docRequirements mapping) are merged in front of these. */
const BASE_DOC_TYPES = [
  { value: 'trade_license',          label: 'Trade License',          category: 'license',    needsExpiry: true  },
  { value: 'initial_approval',       label: 'Initial Approval',       category: 'compliance', needsExpiry: false },
  { value: 'trade_name_reservation', label: 'Trade Name Reservation', category: 'compliance', needsExpiry: false },
  { value: 'passport',               label: 'Passport',               category: 'identity',   needsExpiry: true  },
  { value: 'visa',                   label: 'Visa',                   category: 'identity',   needsExpiry: true  },
  { value: 'emirates_id',            label: 'Emirates ID',            category: 'identity',   needsExpiry: true  },
  { value: 'noc',                    label: 'NOC',                    category: 'legal',      needsExpiry: false },
  { value: 'undertaking_letter',     label: 'Undertaking Letter',     category: 'legal',      needsExpiry: false },
  { value: 'ejari_certificate',      label: 'Ejari',                  category: 'property',   needsExpiry: false },
  { value: 'utility_registration',   label: 'Utility Registration',   category: 'property',   needsExpiry: false },
  { value: 'move_out_report',        label: 'Move-out Inspection Report', category: 'inspection', needsExpiry: false },
  { value: 'utility_clearance',      label: 'Utility Clearance',      category: 'property',   needsExpiry: false },
  { value: 'utility_final_bill',     label: 'Utility Final Bill',     category: 'property',   needsExpiry: false },
  { value: 'poa',                    label: 'POA',                    category: 'legal',      needsExpiry: false },
  { value: 'pdc',                    label: 'PDC',                    category: 'payment',    needsExpiry: false },
  { value: 'receipt',                label: 'Receipt',                category: 'payment',    needsExpiry: false },
  { value: 'agreement',              label: 'Agreement',              category: 'contract',   needsExpiry: false },
  // Added per request — tenancy document types not already covered above.
  { value: 'cheque',                  label: 'Cheque',                    category: 'payment',    needsExpiry: false },
  { value: 'signed_tenancy_contract', label: 'Signed Tenancy Contract',   category: 'contract',   needsExpiry: false },
  { value: 'payment_plan',            label: 'Payment Plan',              category: 'payment',    needsExpiry: false },
  { value: 'move_in_report',          label: 'Move-in Inspection Report', category: 'inspection', needsExpiry: false },
  { value: 'sd_refund_form',          label: 'SD Refund Form',            category: 'payment',    needsExpiry: false },
  { value: 'sd_receiving_voucher',    label: 'SD Receiving Voucher',      category: 'payment',    needsExpiry: false },
  { value: 'payment_proof_transfer',  label: 'Payment Proof of Transfer', category: 'payment',    needsExpiry: false },
  { value: 'cheque_receipt_voucher',  label: 'Cheque Receipt Voucher',    category: 'payment',    needsExpiry: false },
  { value: 'cheque_deposit_slip',     label: 'Cheque Deposit Slip',       category: 'payment',    needsExpiry: false },
  { value: 'other',                  label: 'Others',                 category: 'other',      needsExpiry: false },
];

/** Checklist doc keys whose uploads need an expiry date (identity docs + trade
 *  licence). The VAT Tax Registration Certificate and the business / activity
 *  licence are excluded — they carry no expiry. */
const EXPIRY_DOC_KEYS = new Set([
  'emirates_id', 'emirates_id_front', 'emirates_id_back', 'passport', 'uae_visa',
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
    utilityDoc: contract.utilityStatus === 'submitted' || contract.utilityStatus === 'verified',
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

/** RP review of the customer-uploaded utility proof: view the bill + confirm. */
function UtilityReview({ proof, accountNumber, onConfirm, onUpload, lock }: {
  proof: ContractDoc; accountNumber?: string | null; onConfirm: () => void; onUpload: () => void; lock?: boolean;
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
        <button className="btn btn-jade btn-sm" style={{ justifySelf: 'start', marginTop: 6 }} onClick={onConfirm}>
          <Check size={13} /> Confirm utility account
        </button>
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
  /** Sign the LANDLORD signature — needs signing rights AND power of attorney. */
  signLandlord: boolean;
  /** Sign tenant / witness / manager signatures → canSignDocuments. */
  signDocuments: boolean;
  /** Deposit edit + settlement → canManageDeposits OR canManageCollections. */
  deposits: boolean;
  /** Record / edit payments, fees, cheque-status, confirm PDC → canManageCollections. */
  collections: boolean;
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
  /** Confirm the post-dated cheques were collected → PATCH /contracts/:id/confirm-pdc.
   *  Unlocks the Signatures step on a renewal (Cheques/PDC → Signatures). */
  onConfirmPdc: () => Promise<void>;
  /** Accept the customer's re-uploaded renewal KYC documents → PATCH
   *  /contracts/:id/renewal/accept-docs. Unlocks the Cheques step (Documents → Cheques). */
  onAcceptDocs: () => Promise<void>;
  /** Edit a payment/cheque row — number / method / date / status. Used by the
   *  renewal Cheques step so the RP records each cheque against the plan. */
  onUpdatePayment: (paymentId: number, patch: { chequeStatus?: string; amount?: number; vatAmount?: number; chequeNumber?: string | null; description?: string | null; transactionDate?: string | null; paymentMethod?: string }) => Promise<void>;
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
  /** Manager-permission gates for the action affordances in this step. RP
   *  owners get `true` for every flag; a manager gets the per-landlord flag
   *  value. The backend already 403s a manager without the flag — this just
   *  hides the button so they never see an action they can't take. */
  perms: ActorPerms;
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

  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ chequeNumber: '', paymentMethod: 'cheque', transactionDate: '', chequeStatus: 'pending' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const inp: CSSProperties = { width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--mist-strong)', fontSize: 13, fontFamily: 'inherit', background: 'var(--paper)' };
  const lbl: CSSProperties = { fontSize: 11, color: 'var(--ink-2)', fontWeight: 600, display: 'grid', gap: 3 };

  const start = (p: ContractPayment) => { setEditId(p.id); setErr(null); setForm({ chequeNumber: p.chequeNumber ?? '', paymentMethod: p.paymentMethod ?? 'cheque', transactionDate: (p.transactionDate ?? '').slice(0, 10), chequeStatus: p.chequeStatus ?? 'pending' }); };
  const save = async (id: number) => {
    setBusy(true); setErr(null);
    try {
      await h.onUpdatePayment(id, { chequeNumber: form.chequeNumber.trim() || null, paymentMethod: form.paymentMethod, transactionDate: form.transactionDate || null, chequeStatus: form.chequeStatus });
      setEditId(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save'); } finally { setBusy(false); }
  };

  if (!submitted) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--saffron-soft, #fff7ed)', color: 'var(--saffron-deep, #c2410c)', fontSize: 13, fontWeight: 600 }}>
          Waiting for {h.contract.tenant.name || 'the customer'} to upload &amp; submit their cheques. Once they do, record each cheque here and mark them collected to unlock signing.
        </div>
        <button className="ca" style={{ justifySelf: 'start', padding: 0 }} onClick={() => h.openDrawer('payments')}>View the renewal cheque schedule</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {chequeDocs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className="note" style={{ fontWeight: 600 }}>Customer&rsquo;s uploaded cheque{chequeDocs.length === 1 ? '' : 's'}:</span>
          {chequeDocs.map((d, i) => (
            <button key={d.id} type="button" className="mini-btn view" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? `Cheque ${i + 1}` })}>
              <ExternalLink size={12} /> {d.displayName ?? `Cheque ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(p => {
          const editing = editId === p.id;
          return (
            <div key={p.id} style={{ border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.description ?? '—'}</div>
                  <div className="note">{fmtDate(p.transactionDate)} · {fmtAed(p.amount)}{p.chequeNumber ? ` · #${p.chequeNumber}` : ''} · {fmtMethod(p.paymentMethod)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <span className={'cstat ' + (p.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>{p.chequeStatus ?? 'pending'}</span>
                  {canEdit && !editing && <button type="button" className="mini-btn" onClick={() => start(p)}><Pencil size={12} /> Details</button>}
                </div>
              </div>
              {editing && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 10 }}>
                  <label style={lbl}>Cheque no.<input style={inp} value={form.chequeNumber} onChange={e => setForm(f => ({ ...f, chequeNumber: e.target.value }))} /></label>
                  <label style={lbl}>Method<select style={inp} value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>{PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
                  <label style={lbl}>Date<input style={inp} type="date" value={form.transactionDate} onChange={e => setForm(f => ({ ...f, transactionDate: e.target.value }))} /></label>
                  <label style={lbl}>Status<select style={inp} value={form.chequeStatus} onChange={e => setForm(f => ({ ...f, chequeStatus: e.target.value }))}><option value="pending">Pending</option><option value="cleared">Cleared</option><option value="bounced">Bounced</option><option value="cancelled">Cancelled</option></select></label>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                    <button className="btn btn-jade btn-sm" disabled={busy} onClick={() => void save(p.id)}><Check size={14} /> {busy ? 'Saving…' : 'Save'}</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {err && <p className="note" style={{ color: 'var(--brick)' }}>{err}</p>}
      <div className="chklist">
        <ChkRow on={false} label="Post-dated cheques collected" hint="mark once every cheque is in hand" onToggle={() => {}}
          actionLabel={canEdit ? (confirming ? 'Marking…' : 'Mark collected') : undefined}
          onAction={canEdit ? () => { setConfirming(true); void h.onConfirmPdc().finally(() => setConfirming(false)); } : undefined} />
      </div>
    </div>
  );
}

/** Renewal Documents step body (RP side). The customer re-uploads the KYC docs that
 *  expired since the last lease; the RP reviews each fresh copy (with its new expiry)
 *  and ACCEPTS them, which stamps renewal_docs_accepted_at and unlocks the Cheques
 *  step. The "Accept" action stays locked until every flagged base has a fresh valid
 *  copy (expiredKycDocKeys empty). */
function RenewalDocReview({ h }: { h: StepHandlers }) {
  const canEdit = h.perms.renewals || h.perms.agreements;
  const remaining = h.contract.expiredKycDocKeys ?? [];
  const LABELS: Record<string, string> = {
    emirates_id: 'Emirates ID', passport: 'Passport', visa: 'UAE Visa / Residency', trade_license: 'Trade License',
  };
  const baseOf = (k: string): string | null => {
    const s = (k ?? '').toLowerCase();
    if (s.includes('emirates_id') || s.includes('eid')) return 'emirates_id';
    if (s.includes('passport')) return 'passport';
    if (s.includes('visa')) return 'visa';
    if (s.includes('trade_license') || s.includes('licen')) return 'trade_license';
    return null;
  };
  // Every KYC base that was flagged for this renewal = the ones still remaining plus
  // the ones the customer has already refreshed (no longer in `remaining`). Show the
  // freshest uploaded copy per base for the RP to view before accepting.
  const kycDocs = (h.contract.documents ?? []).filter(d => baseOf(d.documentKey ?? ''));
  const freshestByBase = new Map<string, ContractDoc>();
  for (const d of kycDocs) {
    const b = baseOf(d.documentKey ?? '')!;
    const prev = freshestByBase.get(b);
    // Prefer the one with the latest (future) expiry; fall back to highest id.
    if (!prev) { freshestByBase.set(b, d); continue; }
    const de = d.expiryDate ? Date.parse(d.expiryDate) : 0;
    const pe = prev.expiryDate ? Date.parse(prev.expiryDate) : 0;
    if (de > pe || (de === pe && d.id > prev.id)) freshestByBase.set(b, d);
  }
  const bases = Array.from(new Set([...remaining, ...Array.from(freshestByBase.keys())]));

  const [accepting, setAccepting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allRefreshed = remaining.length === 0;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        {bases.map(b => {
          const doc = freshestByBase.get(b);
          const stillMissing = remaining.includes(b);
          return (
            <div key={b} style={{ border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{LABELS[b] ?? b}</div>
                <div className="note">
                  {stillMissing
                    ? 'Awaiting a fresh copy from the customer'
                    : doc?.expiryDate ? `Valid · expires ${fmtDate(doc.expiryDate)}` : 'On file'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {stillMissing
                  ? <span className="cstat bounced">Pending</span>
                  : <span className="cstat cleared">Valid</span>}
                {doc && (
                  <button type="button" className="mini-btn view" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.displayName ?? (LABELS[b] ?? b) })}>
                    <ExternalLink size={12} /> View
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {err && <p className="note" style={{ color: 'var(--brick)' }}>{err}</p>}
      {!allRefreshed && (
        <p className="note">Waiting for {h.contract.tenant.name || 'the customer'} to re-upload the remaining document{remaining.length === 1 ? '' : 's'} before you can accept.</p>
      )}
      <div className="chklist">
        <ChkRow on={false} label="Refreshed KYC documents reviewed" hint="accept once every copy looks good" onToggle={() => {}}
          actionLabel={canEdit && allRefreshed ? (accepting ? 'Accepting…' : 'Accept documents') : undefined}
          onAction={canEdit && allRefreshed ? () => { setAccepting(true); setErr(null); void h.onAcceptDocs().catch(e => setErr(e instanceof Error ? e.message : 'Failed to accept')).finally(() => setAccepting(false)); } : undefined} />
      </div>
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
          tone: 'celebrate', icon: 'stamp', sub: 'Stop 3 · complete', label: 'Ejari',
          headline: mode === 'renewal' ? 'Ejari renewed.' : 'Ejari registered.',
          body: 'Certificate is on file with the Dubai Land Department.',
          timing: null,
          node: <Completed title="Registered with DLD" sub={ejariDoc?.displayName ?? 'Ejari-certificate.pdf'} viewUrl={ejariDoc?.fileUrl} viewLabel="View Ejari" />,
        }
      : {
          tone: 'action', icon: 'stamp', sub: mode === 'renewal' ? 'Renewal · Ejari' : stopOf(3), label: 'Ejari',
          headline: 'Register Ejari with the DLD.',
          body: 'Upload the certificate, or mark it as already on file when importing an existing lease.',
          timing: '2–5 business days',
          node: <UploadAction fileLabel="Ejari-certificate.pdf" onUpload={h.onUploadEjari} onMark={() => h.onMarkEjari()} />,
        };
  }

  if (key === 'utility') {
    const done = isDone('utility', st);
    // Move-in utility activation proof: the customer uploads
    // "utility_proof_of_payment"; the RP's upload here is keyed
    // "utility_registration" (legacy uploads used "utility_<ts>"). Clearance /
    // final-bill are move-out docs and must NOT count as the move-in activation,
    // so we match registration specifically.
    const proof = (h.contract.documents || []).find(d =>
      d.documentKey === 'utility_proof_of_payment' ||
      d.documentKey === 'utility' ||
      /^utility_\d/.test(d.documentKey) ||
      /^utility_registration(_|$)/.test(d.documentKey));
    const acc = h.contract.utilityAccountNumber;
    const accSub = acc ? `Utility account ${acc}` : 'Utility activation proof on file';
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
          headline: proof ? `${TEN} uploaded the utility proof.` : 'Attach the utility activation.',
          body: proof
            ? 'Review the proof the customer uploaded, then confirm the utility account to advance.'
            : `Add the utility proof, let ${TEN} upload it, or mark it on file for imported leases.`,
          timing: proof ? null : 'Takes ~1 min',
          node: proof
            ? <UtilityReview proof={proof} accountNumber={acc} onConfirm={() => h.onVerifyUtility()} onUpload={h.onUploadUtility} lock={lock} />
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
          body: 'Walk the unit, collect signatures and counter-sign. Open the inspection page to act.',
          timing: 'Takes ~2 min',
          node: (
            <>
              <div className="chklist">
                <ChkRow on={st.moveIn.rpSubmitted} label="Inspection submitted" onToggle={() => {}} />
                <ChkRow on={st.moveIn.tenantSig} label={`${TEN} signed`} onToggle={() => {}} />
                <ChkRow on={st.moveIn.rpCounterSig} label="You counter-signed" onToggle={() => {}} />
              </div>
              <Link href={h.inspectionUrl} className="btn btn-jade btn-block">
                <ClipboardCheck size={14} /> Open inspection workspace
              </Link>
              <p className="note" style={{ marginTop: 8 }}>
                Lease already moved in? Upload the move-in document instead of a full inspection.
              </p>
              <button className="btn btn-ghost btn-block" onClick={h.onUploadMoveInDoc}>
                <UploadCloud size={14} /> Upload move-in document instead
              </button>
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
                <ChkRow on={st.moveOut.rpSubmitted} label="Move-out inspection submitted" onToggle={() => {}} />
                <ChkRow on={st.moveOut.tenantSig} label={`${TEN} signed`} onToggle={() => {}} />
                <ChkRow on={st.moveOut.rpCounterSig} label="You counter-signed" onToggle={() => {}} />
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
          {h.perms.deposits && (
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
               A manager without the deposits/collections permission sees it
               locked (read-only). */}
            <ChkRow on={ss === 'sent' || ss === 'agreed'} label="Settlement sent to customer"
              onToggle={h.onUnsendSettlement} locked={ss === 'agreed' || !h.perms.deposits} />
            {/* The customer's agreement and the payout are not the RP's to undo here. */}
            <ChkRow on={ss === 'agreed'} label={`${TEN} agreed`} onToggle={() => {}} locked />
            <ChkRow on={false} label="Refund marked paid" onToggle={() => {}} locked />
          </div>
          {h.perms.deposits && (
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
    const next = h.contract.payments.find(p => (p.chequeStatus === 'pending' || (!p.paidAt && !p.chequeStatus)));
    // Rent/fee payments already settled (cleared cheque or recorded paid date) →
    // "collected". Excludes the security deposit — it has its own tile.
    const collected = h.contract.payments
      .filter(p => p.paymentType !== 'security_deposit' && (p.chequeStatus === 'cleared' || p.paidAt))
      .reduce((s, p) => s + (p.amount || 0), 0);
    return {
      tone: 'celebrate', icon: 'active', sub: mode === 'renewal' ? 'Renewal · live' : 'Stop 6 · live',
      label: mode === 'renewal' ? 'Renewal active' : 'Active tenancy',
      headline: mode === 'renewal' ? 'The renewal is live.' : 'This tenancy is live.',
      body: 'Manage payments, propose a renewal, or end the tenancy at any time.',
      timing: null,
      node: (
        <>
          {/* Live-lease summary — always populated (rent · term · deposit ·
              collected) so a renewal with no pending cheque never shows blank
              tiles; the next instalment, if any, surfaces as a flag below. */}
          <div className="stats">
            <div className="stat">
              <div className="sl">Annual rent{(h.contract.discountAmount ?? 0) > 0 ? ' (after discount)' : ''}</div>
              <div className="sv">
                {(h.contract.discountAmount ?? 0) > 0 && h.contract.listedRent != null && (
                  <span style={{ fontSize: 12, fontWeight: 400, color: '#9b9890', textDecoration: 'line-through', marginRight: 6 }}>{fmtAed(h.contract.listedRent)}</span>
                )}
                {fmtAed(h.contract.annualRent)}
              </div>
              {(h.contract.discountAmount ?? 0) > 0 && (
                <div style={{ fontSize: 11, fontWeight: 600, color: '#b91c1c', marginTop: 2 }}>− {fmtAed(h.contract.discountAmount!)} discount</div>
              )}
            </div>
            <div className="stat">
              <div className="sl">{mode === 'renewal' ? 'Renewal term' : 'Term'}</div>
              <div className="sv" style={{ fontSize: 14 }}>{fmtDate(h.contract.startDate)} → {fmtDate(h.contract.endDate)}</div>
            </div>
            <div className="stat">
              <div className="sl">Deposit held</div>
              <div className="sv jade">{fmtAed(h.contract.securityDepositHeld ?? h.contract.securityDepositAmount)}</div>
            </div>
            <div className="stat">
              <div className="sl">Collected</div>
              <div className="sv jade">{fmtAed(collected)}</div>
            </div>
          </div>
          {next && (
            <div className="flag waiting" style={{ alignSelf: 'flex-start' }}>
              <CreditCard size={13} /> Next payment {fmtAed(next.amount)} due {fmtDate(next.transactionDate)}
            </div>
          )}
          {/* Only the PARENT lease (which owns the proposal) has a renewalChild.
              The child proposal itself sees a mirrored renewalAccepted='pending'
              (from getContractById) but renewalChild=null — gate on renewalChild
              so the banner never self-references on the proposal row. */}
          {h.contract.renewalAccepted === 'pending' && h.contract.renewalChild && (
            <div className="flag waiting" style={{ alignSelf: 'flex-start' }}>
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
            <div className="flag" style={{ alignSelf: 'flex-start', background: '#fdf7ea', borderColor: '#e7d8a8', color: '#8a6d1f' }}>
              <RotateCcw size={13} /> Renewal draft ready — not yet sent to {TEN}
              {' · '}
              <Link href={`${h.contractsBase}/${h.contract.renewalChild.id}/v2`} style={{ fontWeight: 700, textDecoration: 'underline' }}>
                Review draft · CID-{h.contract.renewalChild.id}
              </Link>
            </div>
          )}
          {/* Customer accepted — the renewal now lives in its own contract.
              Without this block the renewal VANISHED from the parent page the
              moment it was accepted/issued. */}
          {h.contract.renewalAccepted === 'accepted' && h.contract.renewalChild && (
            <div className="flag" style={{ alignSelf: 'flex-start', background: 'var(--jade-soft, #e7f5ef)', borderColor: 'var(--jade, #2e9f82)', color: 'var(--jade-deep, #1a7a5a)' }}>
              <RotateCcw size={13} /> Renewal agreed — {fmtDate(h.contract.renewalChild.startDate ?? null)} → {fmtDate(h.contract.renewalChild.endDate ?? null)}
              {h.contract.renewalChild.annualRent ? <> @ {fmtAed(h.contract.renewalChild.annualRent)}</> : null}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {h.perms.collections && (
              <button className="btn btn-jade" onClick={() => h.openDrawer('payments')}>
                <CreditCard size={14} /> Record payment
              </button>
            )}
            {h.contract.renewalAccepted === 'accepted' && h.contract.renewalChild && (
              <Link href={`${h.contractsBase}/${h.contract.renewalChild.id}/v2`} className="btn btn-jade">
                <RotateCcw size={14} /> Open renewal contract · CID-{h.contract.renewalChild.id}
              </Link>
            )}
            {/* Draft review actions — send to the customer, edit the terms, or discard. */}
            {h.contract.renewalStatus === 'draft' && h.contract.renewalAccepted !== 'pending' && h.perms.renewals && (
              <>
                <button className="btn btn-jade" onClick={() => void h.onRenewalDraft('send')}>
                  <RotateCcw size={14} /> Send to {TEN}
                </button>
                <button className="btn btn-ghost" onClick={() => h.openModal('renew')}>
                  <RotateCcw size={14} /> Edit draft
                </button>
                <button className="btn btn-ghost" style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }} onClick={() => void h.onRenewalDraft('discard')}>
                  Discard draft
                </button>
              </>
            )}
            {mode !== 'renewal' && !h.contract.renewalAccepted && h.contract.renewalStatus !== 'draft' && h.perms.renewals && (
              <button className="btn btn-ghost" onClick={() => h.openModal('renew')}>
                <RotateCcw size={14} /> Propose renewal
              </button>
            )}
            {h.perms.agreements && (
              <button className="btn btn-ghost" style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }} onClick={() => h.openModal('direct-terminate')}>
                <X size={14} /> Terminate directly
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
        <button className="btn btn-jade btn-lg btn-block" onClick={() => h.onActivate()}>
          <BadgeCheck size={15} /> Activate tenancy now
        </button>
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
  tenantId: number; contractId: number; section?: 'documents' | 'contract' | 'move_in' | 'move_out'; label?: string; role?: 'tenant' | 'inspector' | 'landlord'; disabled?: boolean;
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

function DetailsDrawer({
  open, tab, setTab, onClose, inline, contract, payments, kycDocs, onApproveDoc, onRejectDoc,
  onRecordPayment, onUpdatePayment, onDeletePayment, onUpdateDeposit, onSaveClauses, onConfirmPdc, onUploadDoc, onRequestDoc,
  notes, onAddNote, perms, paymentRefs = EMPTY_PAYMENT_REFS, showExtras = true, editLocked = false,
}: {
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
  onApproveDoc: (id: number) => void; onRejectDoc: (id: number) => void;
  /** POST /api/contracts/:id/payments — record a new instalment / payment / fee. */
  onRecordPayment: (body: {
    description?: string; amount: number; vatAmount?: number; paymentType?: string; paymentMethod?: string;
    chequeNumber?: string; transactionDate?: string; chequeStatus?: string;
  }) => Promise<void>;
  /** PATCH /api/contracts/:id/payments/:paymentId — edit status / amount / VAT / reference / description. */
  onUpdatePayment: (paymentId: number, patch: {
    chequeStatus?: string; amount?: number; vatAmount?: number; chequeNumber?: string | null;
    description?: string | null; transactionDate?: string | null; paymentMethod?: string;
  }) => Promise<void>;
  /** DELETE /api/contracts/:id/payments/:paymentId — remove a fee / payment line. */
  onDeletePayment: (paymentId: number) => Promise<void>;
  /** PATCH /api/contracts/:id/deposits/:depositId — edit a held security deposit. */
  onUpdateDeposit: (depositId: number, patch: {
    chequeStatus?: string; paymentMethod?: string | null; dueDate?: string | null;
    chequeNumber?: string | null; amount?: number; depositStatus?: string;
  }) => Promise<void>;
  /** PATCH /api/contracts/:id/clauses — save edited custom clauses + notes. */
  onSaveClauses: (customClauses: string[], notes: string | null) => Promise<void>;
  /** PATCH /api/contracts/:id/confirm-pdc — confirm post-dated cheques received. */
  onConfirmPdc: () => Promise<void>;
  /** upload-url → PUT → POST /api/documents — attach a contract document. */
  onUploadDoc: (file: File, meta: { key: string; label: string; category: string }, visibleToTenant: boolean, expiryDate: string) => Promise<void>;
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
  const depositRow = payments.find(p => p.paymentType === 'security_deposit');
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
  });
  const [statusBusy, setStatusBusy] = useState<number | null>(null);
  // ── Inline cheque editor — correct amount / reference / description on existing rows ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ amount: '', chequeNumber: '', description: '', paymentMethod: 'cheque', transactionDate: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const startEdit = (p: ContractPayment) => {
    setEditingId(p.id); setEditErr(null);
    setEditForm({
      amount: p.amount != null ? String(p.amount) : '',
      chequeNumber: p.chequeNumber ?? '',
      description: p.description ?? '',
      paymentMethod: p.paymentMethod ?? 'cheque',
      transactionDate: p.transactionDate ? p.transactionDate.slice(0, 10) : '',
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
      });
      setRec({ description: '', amount: '', paymentType: 'rental_income', paymentMethod: 'cheque', chequeNumber: '', transactionDate: '' });
      setShowRec(false);
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setRecBusy(false);
    }
  };
  const changeStatus = async (paymentId: number, status: string) => {
    setStatusBusy(paymentId);
    try { await onUpdatePayment(paymentId, { chequeStatus: status }); }
    finally { setStatusBusy(null); }
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
  const feeLabel = (t: string | null) =>
    t === 'admin_fee' ? 'Admin fee' : t === 'ejari_fee' ? 'Ejari fee' : t === 'commission' ? 'Commission' : (t ?? 'Fee');
  // ── Fees editor (admin-filled: admin / ejari / commission). Fees are never
  //    auto-fabricated — the RP enters them here. Amount is NET (excl. VAT);
  //    VAT is an optional separate figure; the stored gross = net + VAT. ──
  const FEE_TYPE_OPTIONS = [
    { value: 'admin_fee', label: 'Admin fee' },
    { value: 'ejari_fee', label: 'Ejari fee' },
    { value: 'commission', label: 'Commission' },
  ];
  const emptyFeeForm = { paymentType: 'admin_fee', amount: '', vatAmount: '', transactionDate: '', description: '', paymentMethod: 'cheque', chequeNumber: '' };
  const [showAddFee, setShowAddFee] = useState(false);
  const [feeAdd, setFeeAdd] = useState(emptyFeeForm);
  const [feeAddBusy, setFeeAddBusy] = useState(false);
  const [feeAddErr, setFeeAddErr] = useState<string | null>(null);
  const [feeEditId, setFeeEditId] = useState<number | null>(null);
  const [feeEdit, setFeeEdit] = useState(emptyFeeForm);
  const [feeEditBusy, setFeeEditBusy] = useState(false);
  const [feeEditErr, setFeeEditErr] = useState<string | null>(null);
  const [feeDeleteBusy, setFeeDeleteBusy] = useState<number | null>(null);
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
      });
      setFeeEditId(null);
    } catch (e) { setFeeEditErr(e instanceof Error ? e.message : 'Failed to save changes'); }
    finally { setFeeEditBusy(false); }
  };
  const deleteFee = async (paymentId: number) => {
    setFeeDeleteBusy(paymentId);
    try { await onDeletePayment(paymentId); }
    finally { setFeeDeleteBusy(null); }
  };
  // A bounced or cancelled cheque is void (it never cleared / was replaced by a new
  // cheque), so it must NOT count toward the rent total — otherwise it double-counts
  // with its replacement. It still appears in the table above as history.
  const countsToTotal = (p: { chequeStatus?: string | null }) =>
    !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase());
  // Rent VAT (commercial/industrial): amounts are GROSS; split net vs VAT for display.
  const rentGross = rentRows.reduce((s, p) => s + (countsToTotal(p) ? (p.amount || 0) : 0), 0);
  const rentVat   = rentRows.reduce((s, p) => s + (countsToTotal(p) ? (p.vatAmount || 0) : 0), 0);
  const rentNet   = rentGross - rentVat;
  const showVat   = (contract.rentVatRate ?? 0) > 0 || rentVat > 0;
  // ── Current payment plan (live) — what the customer is actually paying NOW,
  //    assembled from the contract's recorded rent cheques, fees, and deposit.
  //    Replaces the old origin-lead "offer" snapshot in the receipt modal.
  //    Contract money is whole AED; the modal expects fils, so ×100. ──
  const toFils = (aed: number) => Math.round((aed || 0) * 100);
  // Renewals carry the deposit from the original lease (read-only, never re-collected),
  // so it must not appear as a new line/instalment in the renewal's payment plan.
  const depositForPlan = contract.contractType === 'renewal'
    ? 0
    : (depositRow?.amount ?? contract.securityDeposit?.amount
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
      type: 'installment' as const,
    })),
    ...feeRows.map(f => ({
      amountFils: toFils(f.amount), vatFils: toFils(f.vatAmount ?? 0),
      dueDate: f.transactionDate ?? '', description: f.description || feeLabel(f.paymentType),
      type: 'fee' as const,
    })),
    ...(depositForPlan > 0 ? [{
      amountFils: toFils(depositForPlan), vatFils: 0,
      dueDate: contract.securityDeposit?.dueDate ?? contract.securityDeposit?.recordedDate ?? '',
      description: 'Security deposit', type: 'security_deposit' as const,
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
  // Full mapped pack for the unit's category — KYC + commercial / industrial /
  // residential section (company promotions applied). Shown on new contracts;
  // renewals show only the re-verification slots (renewalDocs).
  const fullPackDocs = useMemo<DocReq[]>(
    () => [...KYC_DOCS, ...getRentalSectionDocs(contract.unit.type, contract.tenant.entityType)],
    [contract.unit.type, contract.tenant.entityType]);
  // Renewal-specific re-verification slots (empty for new contracts).
  const renewalDocs = useMemo<DocReq[]>(
    () => contract.contractType === 'renewal' ? getRenewalRequiredDocs(contract.unit.type) : [],
    [contract.contractType, contract.unit.type]);
  // Upload type picker = checklist types first (most relevant), then the
  // legacy generic types — so an upload lands on the exact checklist key.
  const DOC_TYPES = useMemo(() => {
    const fromChecklist: { value: string; label: string; category: string; needsExpiry: boolean }[] = [];
    const seen = new Set<string>();
    for (const d of [...CONTRACT_DOCS, ...renewalDocs, ...fullPackDocs]) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      fromChecklist.push({ value: d.key, label: d.label, category: d.category, needsExpiry: EXPIRY_DOC_KEYS.has(d.key) });
    }
    return [...fromChecklist, ...BASE_DOC_TYPES.filter(t => !seen.has(t.value))];
  }, [renewalDocs, fullPackDocs]);
  const uploadBoxRef = useRef<HTMLDivElement>(null);
  /** Checklist "Upload" / "Replace" → open the upload form with the slot's
   *  type preselected and pop the file picker. */
  const prefillUpload = (d: DocReq) => {
    setShowUpload(true);
    // Only preselect a type the picker actually knows — an unknown legacy key
    // would slip past submitUpload's lookup. Blank → the user picks the type.
    setUpType(DOC_TYPES.some(t => t.value === d.key) ? d.key : '');
    setUpExpiry('');
    setUpErr(null);
    requestAnimationFrame(() => {
      uploadBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      docFileRef.current?.click();
    });
  };
  const upSelected = DOC_TYPES.find(t => t.value === upType);
  const upShowExpiry = upSelected?.needsExpiry ?? false;
  const submitUpload = async () => {
    if (!upFile || !upType) return;
    const meta = DOC_TYPES.find(t => t.value === upType)!;
    setUpBusy(true); setUpErr(null);
    try {
      await onUploadDoc(upFile, { key: meta.value, label: meta.label, category: meta.category }, upVisible, upExpiry);
      setShowUpload(false); setUpFile(null); setUpType(''); setUpVisible(false); setUpExpiry('');
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
              <span id="sec-payments" />
              <div className="sec">
                <div className="sech">
                  <span className="si"><CreditCard size={16} /></span>
                  <span className="st">Payments</span>
                  {perms.collections && (
                    <button type="button" className="mini-btn view" style={{ marginLeft: 'auto' }} onClick={() => { setShowRec(s => !s); setRecErr(null); }}>
                      {showRec ? <><X size={12} /> Close</> : <><CreditCard size={12} /> Record payment</>}
                    </button>
                  )}
                </div>
                <div className="secb">
                  <table className="ptable">
                    <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Reference</th><th>Method</th><th>Due date</th><th>Status</th></tr></thead>
                    <tbody>
                      {/* Security deposit folds in as the first payment row. When
                          the deposit is THIS contract's own payment it's editable;
                          a renewal that only carries the deposit gets a read-only
                          row below (from contract.securityDeposit). */}
                      {depositRow && (
                        <Fragment>
                          <tr>
                            <td><DollarSign size={13} /></td>
                            <td>
                              {depositRow.description?.trim() || 'Security deposit'}
                              {paymentRefs.receiptByPaymentId[depositRow.id] && (
                                <span className="note" title="Issued receipt number — for bank reconciliation" style={{ display: 'block', fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace', color: '#1a5a4a', marginTop: 2 }}>
                                  Receipt {paymentRefs.receiptByPaymentId[depositRow.id]}
                                </span>
                              )}
                            </td>
                            <td className="amt">{fmtAed(depositRow.amount)}</td>
                            <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{depositRow.chequeNumber ?? '—'}</td>
                            <td>{fmtMethod(depositRow.paymentMethod)}</td>
                            <td>{fmtDate(depositRow.transactionDate)}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {perms.deposits ? (
                                  <select
                                    className={'cstat ' + (depositRow.chequeStatus ?? 'cleared')}
                                    style={{ cursor: 'pointer' }}
                                    value={depositRow.chequeStatus ?? 'cleared'}
                                    disabled={statusBusy === depositRow.id}
                                    onChange={e => void changeStatus(depositRow.id, e.target.value)}
                                  >
                                    <option value="pending">Pending</option>
                                    <option value="cleared">Cleared</option>
                                    <option value="bounced">Bounced</option>
                                    <option value="cancelled">Cancelled</option>
                                  </select>
                                ) : (
                                  <span className={'cstat ' + (depositRow.chequeStatus ?? 'cleared')} style={{ textTransform: 'capitalize' }}>
                                    {depositRow.chequeStatus ?? 'cleared'}
                                  </span>
                                )}
                                {perms.deposits && depositRow.chequeStatus !== 'cleared' && (
                                  <button
                                    type="button"
                                    className="mini-btn view"
                                    title="Edit amount / reference / description"
                                    onClick={() => editingId === depositRow.id ? setEditingId(null) : startEdit(depositRow)}
                                  >
                                    <Pencil size={12} /> Edit
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {editingId === depositRow.id && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                                <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                  <p className="subhead">Correct security-deposit details</p>
                                  <div className="field"><label>Description</label>
                                    <input className="input" value={editForm.description} placeholder="e.g. Security deposit"
                                      onChange={e => setEditForm(v => ({ ...v, description: e.target.value }))} />
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Amount (AED)</label>
                                      <input type="number" min="0" step="0.01" className="input" value={editForm.amount}
                                        onChange={e => setEditForm(v => ({ ...v, amount: e.target.value }))} />
                                    </div>
                                    <div className="field"><label>Payment method</label>
                                      <select className="input" value={editForm.paymentMethod}
                                        onChange={e => setEditForm(v => ({ ...v, paymentMethod: e.target.value }))}>
                                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                      </select>
                                    </div>
                                  </div>
                                  <div className="field"><label>Cheque / reference no.</label>
                                    <input className="input" value={editForm.chequeNumber} placeholder="Cheque #, transfer ID…"
                                      onChange={e => setEditForm(v => ({ ...v, chequeNumber: e.target.value }))} />
                                  </div>
                                  {editErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{editErr}</p>}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                    <button className="btn btn-jade btn-sm" disabled={editBusy} onClick={() => void saveEdit(depositRow.id)}>
                                      <Check size={14} /> {editBusy ? 'Saving…' : 'Save changes'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(null); setEditErr(null); }}>Cancel</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )}
                      {/* Held deposit, shown on every contract in the chain. The
                          oldest lease holds the actual record; renewals show it
                          read-only ("carried"). */}
                      {!depositRow && contract.securityDeposit && (() => {
                        const sd = contract.securityDeposit!;
                        // A manager without the deposit permission sees the held
                        // deposit read-only — no status change / edit / settle / set.
                        const editable = !sd.isCarried && sd.depositId != null && perms.deposits;
                        return (
                          <Fragment>
                            <tr style={sd.isCarried ? { opacity: 0.6 } : undefined}>
                              <td><DollarSign size={13} /></td>
                              <td>
                                Security deposit
                                {sd.isCarried && sd.sourceContractId != null && (
                                  <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                    held — carried from{' '}
                                    <Link href={`/rental-provider/dashboard/contracts/${sd.sourceContractId}/v2`} style={{ color: 'var(--jade)', fontWeight: 600, textDecoration: 'underline' }}>
                                      CID-{sd.sourceContractId}
                                    </Link>
                                  </span>
                                )}
                                {editable && !sd.amount && (
                                  <span className="note" style={{ display: 'block', fontSize: 11, color: '#b45309' }}>
                                    amount not recorded yet
                                  </span>
                                )}
                              </td>
                              <td className="amt">{sd.amount ? fmtAed(sd.amount) : <span style={{ color: '#9b9890' }}>—</span>}</td>
                              <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{sd.chequeNumber ?? '—'}</td>
                              <td>{sd.paymentMethod ? fmtMethod(sd.paymentMethod) : '—'}</td>
                              <td>{fmtDate(sd.dueDate ?? sd.recordedDate)}</td>
                              <td>
                                {editable && sd.amount ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                                    {/* One clean action toolbar — status · Edit · Receipt · Settle */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                                      <select className={'cstat ' + (sd.chequeStatus ?? 'pending')} style={{ cursor: 'pointer' }}
                                        title="Cheque / banking status" value={sd.chequeStatus ?? 'pending'} disabled={depStatusBusy}
                                        onChange={e => void changeDepStatus(sd.depositId!, e.target.value)}>
                                        <option value="pending">Pending</option>
                                        <option value="cleared">Cleared</option>
                                        <option value="bounced">Bounced</option>
                                        <option value="cancelled">Cancelled</option>
                                      </select>
                                      {sd.chequeStatus !== 'cleared' && (
                                        <button type="button" className="mini-btn view" title="Edit deposit — method, due date, amount"
                                          onClick={() => depEditing ? setDepEditing(false) : startDepEdit()}>
                                          <Pencil size={12} /> Edit
                                        </button>
                                      )}
                                      {(!sd.status || sd.status === 'held') && (
                                        <Link href={`${contractBase}/settlement`} className="mini-btn view" title="Settle the deposit (refund / deduction)">
                                          <Stamp size={12} /> Settle
                                        </Link>
                                      )}
                                    </div>
                                    {/* Settled outcome (move-out settlement is the source of truth) */}
                                    {sd.status && sd.status !== 'held' && (
                                      <div style={{ textAlign: 'right' }}>
                                        <span className={'cstat ' + sd.status} style={{ textTransform: 'capitalize' }}>{sd.status.replace('_', ' ')}</span>
                                        {(sd.settledRefundAmount != null || sd.settledDeductionAmount != null) && (
                                          <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                                            refunded {fmtAed(sd.settledRefundAmount ?? 0)} · kept {fmtAed(sd.settledDeductionAmount ?? 0)}{sd.settledViaSettlementId != null ? ' · via move-out' : ''}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {depStatusErr && (
                                      <span className="note" style={{ color: 'var(--brick)', fontSize: 11, textAlign: 'right' }}>{depStatusErr}</span>
                                    )}
                                  </div>
                                ) : editable ? (
                                  <button type="button" className="btn btn-jade btn-sm" onClick={() => startDepEdit()}>
                                    <Pencil size={12} /> Set deposit
                                  </button>
                                ) : (
                                  <span className={'cstat ' + (sd.status ?? 'held')} style={{ textTransform: 'capitalize' }}>
                                    {(sd.status ?? 'held').replace('_', ' ')}
                                  </span>
                                )}
                              </td>
                            </tr>
                            {editable && depEditing && (
                              <tr>
                                <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                                  <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                    <p className="subhead">Edit security deposit</p>
                                    <div className="grid2">
                                      <div className="field"><label>Amount (AED)</label>
                                        <input type="number" min="0" step="0.01" className="input" value={depForm.amount}
                                          onChange={e => setDepForm(v => ({ ...v, amount: e.target.value }))} />
                                      </div>
                                      <div className="field"><label>Payment method</label>
                                        <select className="input" value={depForm.paymentMethod}
                                          onChange={e => setDepForm(v => ({ ...v, paymentMethod: e.target.value }))}>
                                          {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                      </div>
                                      <div className="field"><label>Cheque / reference no.</label>
                                        <input className="input" value={depForm.chequeNumber}
                                          onChange={e => setDepForm(v => ({ ...v, chequeNumber: e.target.value }))} />
                                      </div>
                                      <div className="field"><label>Due date</label>
                                        <input type="date" className="input" value={depForm.dueDate}
                                          onChange={e => setDepForm(v => ({ ...v, dueDate: e.target.value }))} />
                                      </div>
                                      <div className="field"><label>Cheque status</label>
                                        <select className="input" value={depForm.chequeStatus}
                                          onChange={e => setDepForm(v => ({ ...v, chequeStatus: e.target.value }))}>
                                          <option value="pending">Pending</option>
                                          <option value="cleared">Cleared</option>
                                          <option value="bounced">Bounced</option>
                                          <option value="cancelled">Cancelled</option>
                                        </select>
                                      </div>
                                    </div>
                                    {depErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{depErr}</p>}
                                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                      <button className="btn btn-jade btn-sm" disabled={depBusy} onClick={() => void saveDep(sd.depositId!)}>
                                        <Check size={14} /> {depBusy ? 'Saving…' : 'Save changes'}
                                      </button>
                                      <button className="btn btn-ghost btn-sm" disabled={depBusy} onClick={() => { setDepEditing(false); setDepErr(null); }}>Cancel</button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })()}
                      {rentRows.map((p, i) => (
                        <Fragment key={p.id}>
                        <tr>
                          <td>{i + 1}</td>
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
                            {/* A VAT cheque is entirely VAT — the "incl. X VAT" note only applies to a gross rent cheque. */}
                            {p.paymentType !== 'vat' && (p.vatAmount ?? 0) > 0 && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>incl. {fmtAed(p.vatAmount ?? 0)} VAT</span>
                            )}
                          </td>
                          <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{p.chequeNumber ?? '—'}</td>
                          <td>{fmtMethod(p.paymentMethod)}</td>
                          <td>{fmtDate(p.transactionDate)}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                                <span className={'cstat ' + (p.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>
                                  {p.chequeStatus ?? 'pending'}
                                </span>
                              )}
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
                            </div>
                          </td>
                        </tr>
                        {editingId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                              <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                <p className="subhead">Correct cheque details</p>
                                <div className="field"><label>Description</label>
                                  <input className="input" value={editForm.description} placeholder="e.g. Rental Instalment 1 of 4"
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
                      {rentRows.length === 0 && (
                        <tr><td colSpan={7}><span className="note">No payments recorded yet.</span></td></tr>
                      )}
                    </tbody>
                    <tfoot>
                      {showVat && (
                        <>
                          <tr><td colSpan={2}>Net rent</td><td className="amt">{fmtAed(rentNet)}</td><td colSpan={4} /></tr>
                          <tr><td colSpan={2}>VAT{(contract.rentVatRate ?? 0) > 0 ? ` (${contract.rentVatRate}%)` : ''}</td><td className="amt">{fmtAed(rentVat)}</td><td colSpan={4} /></tr>
                        </>
                      )}
                      <tr><td colSpan={2}>{showVat ? 'Total rent (incl. VAT)' : 'Total rent'}</td><td className="tot">{fmtAed(rentGross)}</td><td colSpan={4} /></tr>
                      {(depositRow || contract.securityDeposit) && (
                        <tr style={{ opacity: 0.75 }}>
                          <td colSpan={2}>Security deposit held (refundable, not in rent total)</td>
                          <td className="amt">{(depositRow?.amount ?? contract.securityDeposit?.amount) ? fmtAed(depositRow?.amount ?? contract.securityDeposit?.amount ?? 0) : <span style={{ color: '#9b9890', fontWeight: 400 }}>Not set</span>}</td>
                          <td colSpan={4} />
                        </tr>
                      )}
                    </tfoot>
                  </table>

                  {/* Fees — admin / ejari / commission as their own line items,
                      separate from the rent schedule above. Admin-filled: the RP
                      adds / edits / removes them here; nothing is auto-fabricated. */}
                  <div style={{ marginTop: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                      <p className="subhead" style={{ margin: 0 }}>
                        Fees <span className="note" style={{ fontWeight: 400 }}>· one-off charges, separate from rent</span>
                      </p>
                      {perms.collections && (
                        <button
                          type="button"
                          className="mini-btn view"
                          title="Add a fee line"
                          onClick={() => { setShowAddFee(v => !v); setFeeAddErr(null); }}
                        >
                          <Plus size={12} /> Add fee
                        </button>
                      )}
                    </div>
                    <table className="ptable">
                      <thead><tr><th>Fee</th><th>Description</th><th>Amount</th><th>Reference</th><th>Method</th><th>Due date</th><th>Status</th></tr></thead>
                      <tbody>
                        {feeRows.map(f => (
                          <Fragment key={f.id}>
                          <tr>
                            <td>
                              {feeLabel(f.paymentType)}
                              {paymentRefs.receiptByPaymentId[f.id] && (
                                <span className="note" title="Issued receipt number — for bank reconciliation" style={{ display: 'block', fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace', color: '#1a5a4a', marginTop: 2 }}>
                                  Receipt {paymentRefs.receiptByPaymentId[f.id]}
                                </span>
                              )}
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
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
                                {/* A cleared fee is received money (and may carry an issued
                                    receipt number) — no Edit and no Delete once cleared. */}
                                {perms.collections && f.chequeStatus !== 'cleared' && (
                                  <>
                                    <button
                                      type="button"
                                      className="mini-btn view"
                                      title="Edit fee amount / VAT / method / reference / date"
                                      onClick={() => feeEditId === f.id ? setFeeEditId(null) : startFeeEdit(f)}
                                    >
                                      <Pencil size={12} /> Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="mini-btn"
                                      title="Remove this fee"
                                      disabled={feeDeleteBusy === f.id}
                                      onClick={() => void deleteFee(f.id)}
                                      style={{ color: 'var(--brick)' }}
                                    >
                                      <Trash2 size={12} /> {feeDeleteBusy === f.id ? '…' : 'Delete'}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {feeEditId === f.id && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                                <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                  <p className="subhead">Edit {feeLabel(f.paymentType).toLowerCase()}</p>
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
                          </Fragment>
                        ))}
                        {feeRows.length === 0 && !showAddFee && (
                          <tr><td colSpan={7}><span className="note">No fees recorded. Use <strong>Add fee</strong> to enter admin, ejari, or commission charges — amounts are not auto-calculated.</span></td></tr>
                        )}
                      </tbody>
                      {feeRows.length > 0 && (
                        <tfoot><tr><td colSpan={2}>Total fees</td><td className="tot">{fmtAed(feeGross)}</td><td colSpan={4} /></tr></tfoot>
                      )}
                    </table>

                    {/* Add-fee form (admin-filled) */}
                    {showAddFee && (
                      <div style={{ marginTop: 12, padding: 14, border: '1px solid #cfe9df', borderRadius: 12, background: 'var(--jade-tint)' }}>
                        <p className="subhead">Add fee</p>
                        <div className="grid2">
                          <div className="field"><label>Fee type</label>
                            <select className="input" value={feeAdd.paymentType} onChange={e => setFeeAdd(v => ({ ...v, paymentType: e.target.value }))}>
                              {FEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
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
                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                          <button className="btn btn-jade btn-sm" disabled={feeAddBusy} onClick={() => void submitAddFee()}>
                            <Check size={14} /> {feeAddBusy ? 'Adding…' : 'Add fee'}
                          </button>
                          <button className="btn btn-ghost btn-sm" disabled={feeAddBusy} onClick={() => { setShowAddFee(false); setFeeAddErr(null); setFeeAdd(emptyFeeForm); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Record-payment form (Flow 1) */}
                  {showRec && (
                    <div style={{ marginTop: 14, padding: 14, border: '1px solid #cfe9df', borderRadius: 12, background: 'var(--jade-tint)' }}>
                      <p className="subhead">New payment</p>
                      <div className="grid2">
                        <div className="field"><label>Type</label>
                          <select className="input" value={rec.paymentType} onChange={e => setRec(v => ({ ...v, paymentType: e.target.value }))}>
                            <option value="rental_income">Rental income</option>
                            <option value="security_deposit">Security deposit</option>
                            <option value="admin_fee">Admin fee</option>
                            <option value="ejari_fee">Ejari fee</option>
                            <option value="commission">Commission</option>
                            <option value="maintenance_fee">Maintenance fee</option>
                            <option value="service_charge">Service charge</option>
                            <option value="other">Other</option>
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
                        <input className="input" value={rec.description} placeholder={`Rental Instalment ${rentRows.length + 1}`} onChange={e => setRec(v => ({ ...v, description: e.target.value }))} />
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
                      {recErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{recErr}</p>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button className="btn btn-jade btn-sm" disabled={recBusy || !rec.amount} onClick={() => void submitRec()}>
                          <Check size={14} /> {recBusy ? 'Saving…' : 'Save payment'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={recBusy} onClick={() => { setShowRec(false); setRecErr(null); }}>Cancel</button>
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
            const norm = (s: string | null | undefined) =>
              (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            // Upload keys / display names that satisfy a slot without matching its
            // key verbatim (legacy combined EID, common label variants).
            const KEY_ALIASES: Record<string, string[]> = {
              emirates_id_front: ['emirates_id'],
              emirates_id_back: ['emirates_id'],
              emirates_id: ['emirates_id_front', 'emirates_id_back'],
              uae_visa: ['uae_visa_residency', 'uae_visa_residence_visa', 'residence_visa', 'visa'],
              bank_statement: ['financial_statements', 'bank_statement_pay_slip', 'pay_slip'],
              employment_letter: ['employment_salary_certificate', 'salary_certificate', 'employment_offer_letter'],
              utility_clearance: ['previous_utility_closing', 'utility_move_out_clearance'],
              tax_registration: ['tax_registration_certificate', 'vat_tax_registration_trn', 'vat_certificate'],
              moa: ['moa_mom', 'memorandum_of_association', 'memorandum_of_association_moa'],
              business_license: ['business_activity_license'],
              // Universal contract slots. The Ejari certificate is named
              // "Contract Registration" on imported leases; the rent cheques
              // ("Payment Advice") are the same cheques uploaded in the Payments
              // stage (pdc / cheque-copy keys), so the slot snaps onto whichever
              // landed first.
              ejari_certificate: ['ejari', 'ejari_certificate', 'contract_registration', 'tenancy_contract_registration', 'ejari_registration'],
              payment_advice: ['pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques'],
              utility_registration: ['utility_proof_of_payment', 'utility_proof', 'utility_activation'],
            };
            // A slot can hold several files (e.g. Payment Advice = every cheque
            // image the tenant uploaded). Newest first; RP uploads carry a
            // `_<timestamp>` suffix on the key — strip it so a Replace supersedes.
            const matchDocs = (key: string): ContractDoc[] => {
              const accepted = [key, ...(KEY_ALIASES[key] ?? [])];
              const baseKey = (d: ContractDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
              return all
                .filter(d => accepted.includes(baseKey(d)) || accepted.includes(norm(d.displayName)))
                .sort((a, b) => b.id - a.id);
            };
            const askedNames = new Set(pendingAsks.map(d => norm(d.displayName ?? d.documentKey).replace(/_\d{10,}$/, '')));
            const askedFor = (req: DocReq) => askedNames.has(norm(req.label)) || askedNames.has(req.key);
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
                    <div className="ds">{asked ? 'Requested — awaiting upload' : req.required ? 'Missing — required' : 'Not on file — optional'}</div>
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
            const binderSeq: BinderSlot[] = [
              { kind: 'link', key: 'offer',          label: 'Payment Plan', sub: 'Current payment plan', href: null },
              { kind: 'doc',  key: 'payment_advice', label: 'Payment Advice' },
              // One file → three receipts inside (Rental Income · Security Deposit · Management Fee).
              { kind: 'link', key: 'receipts',       label: 'Receipts', sub: isRenewal ? 'Rental income & management fee' : 'Rental income, security deposit & management fee', href: receiptsReady ? receiptBase : null },
              { kind: 'link', key: 'agreement',      label: 'Agreement', sub: 'Tenancy contract', href: `${contractBase}/print` },
              { kind: 'doc',  key: 'ejari_certificate', label: 'Ejari' },
            ];
            if (!isRenewal) {
              binderSeq.push({ kind: 'doc',  key: 'utility_registration', label: 'Utility Proof of Payment' });
              // Stored PDF once the inspection is counter-signed; live page until then.
              binderSeq.push({ kind: 'doc', key: 'move_in_report', label: 'Move-in', fallbackHref: `${contractBase}/inspection?type=move_in`, fallbackSub: 'Move-in inspection report' });
            }
            if (moveOutShown) {
              binderSeq.push({ kind: 'doc', key: 'move_out_report', label: 'Move-out', fallbackHref: `${contractBase}/inspection?type=move_out`, fallbackSub: 'Move-out inspection report' });
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
              const ok  = ['approved', 'processed', 'complete'].includes(doc.status);
              const stt = ok ? 'approved' : doc.status === 'rejected' ? 'rejected' : 'pending';
              const lbl = multi
                ? `${docs.length} files · on file`
                : ok ? 'On file' : doc.status === 'rejected' ? 'Rejected' : 'Pending review';
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
                    <button type="button" className="mini-btn view" title={`Upload a newer ${s.label}`} onClick={() => prefillUpload(req)}><UploadCloud size={12} /> {multi ? 'Add' : 'Replace'}</button>
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
                    <button type="button" className="mini-btn ok" onClick={() => { setShowUpload(s => !s); setUpErr(null); }}>
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
                          const ok = ['processed', 'complete'].includes(d.status);
                          const rejected = d.status === 'rejected';
                          const stt = ok ? 'approved' : rejected ? 'rejected' : 'pending';
                          const lbl = docLabel(d, kycDocs);
                          return (
                            <div key={d.id} className={'docitem ' + stt}>
                              <FileText size={14} />
                              <div>
                                <div className="dn">{lbl}</div>
                                <div className="ds">{ok ? 'Approved' : rejected ? 'Rejected — re-upload requested' : 'Pending review'}</div>
                              </div>
                              <div className="dacts">
                                <button type="button" className="mini-btn view cursor-pointer" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: lbl })}><ExternalLink size={12} /> View</button>
                                {!ok && (
                                  <>
                                    <button type="button" className="mini-btn ok cursor-pointer" onClick={() => onApproveDoc(d.id)}><Check size={12} /> Approve</button>
                                    <button type="button" className="mini-btn view cursor-pointer" onClick={() => onRejectDoc(d.id)}><X size={12} /> Reject</button>
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
                      <div ref={uploadBoxRef} style={{ position: 'relative', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -24px rgba(26,23,20,.5)', width: '100%', maxWidth: 460, padding: 18, maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                          <p className="subhead" style={{ margin: 0 }}>Upload a document</p>
                          <button type="button" className="mini-btn view" onClick={() => { setShowUpload(false); setUpErr(null); }}><X size={12} /></button>
                        </div>
                        <input ref={docFileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }}
                          onChange={e => setUpFile(e.target.files?.[0] ?? null)} />
                        <div className="field">
                          <label>File</label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => docFileRef.current?.click()}>Choose file</button>
                            <span className="note" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{upFile ? upFile.name : 'No file chosen'}</span>
                          </div>
                        </div>
                        <div className="field">
                          <label>Document type</label>
                          <select className="input" value={upType} onChange={e => { setUpType(e.target.value); setUpExpiry(''); }}>
                            <option value="">Select type…</option>
                            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <div className="field">
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
                        {upShowExpiry && (
                          <div className="field">
                            <label>Expiry date (required for {upSelected?.label})</label>
                            <input type="date" className="input" value={upExpiry} onChange={e => setUpExpiry(e.target.value)} />
                          </div>
                        )}
                        {upErr && <p className="note" style={{ color: 'var(--brick)' }}>{upErr}</p>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <button className="btn btn-jade btn-sm" disabled={upBusy || !upFile || !upType || (upShowExpiry && !upExpiry)} onClick={() => void submitUpload()}>
                            <UploadCloud size={14} /> {upBusy ? 'Uploading…' : 'Upload'}
                          </button>
                          <button className="btn btn-ghost btn-sm" disabled={upBusy} onClick={() => { setShowUpload(false); setUpErr(null); }}>Cancel</button>
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
                            {matches.map(d => (
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
                          disabled={reqSelected.length === 0}
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
// SignaturePad + Modals (full feature parity with v1)
// ────────────────────────────────────────────────────────────────────────────

function SignaturePad({ onChange }: { onChange: (d: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [has, setHas] = useState(false);
  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width;
    const sy = c.height / r.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - r.left) * sx, y: (t.clientY - r.top) * sy };
    }
    return { x: ((e as React.MouseEvent).clientX - r.left) * sx, y: ((e as React.MouseEvent).clientY - r.top) * sy };
  };
  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); setDrawing(true);
  };
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.stroke();
  };
  const end = () => {
    if (drawing) { setDrawing(false); setHas(true); onChange(ref.current!.toDataURL()); }
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHas(false);
    onChange(null);
  };
  return (
    <div>
      <div className="sigpad">
        <canvas
          ref={ref} width={600} height={170}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        {!has && <div className="ph">Draw your signature here</div>}
      </div>
      {has && (
        <button className="note" style={{ marginTop: 8, background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={clear}>
          Clear signature
        </button>
      )}
    </div>
  );
}

/** Inline landlord-signature field shown on the page (no modal) so the landlord
 *  can countersign directly. Same role/endpoint as SignModal. */
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

function InlineLandlordSign({ contract, onSigned }: { contract: ContractDetail; onSigned: () => void }) {
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState(contract.landlord.companyName || contract.landlord.name || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'canvas' | 'typed'>('canvas');
  const [consent, setConsent] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const body: { role: 'landlord'; signatoryName: string; method: 'online'; signatureImage?: string; typedName?: string; consent: boolean; clientMeta: Record<string, unknown> } = {
        role: 'landlord',
        signatoryName: name.trim() || (contract.landlord.companyName || 'Landlord'),
        method: 'online',
        consent,
        clientMeta: collectClientMeta(),
      };
      if (mode === 'canvas') body.signatureImage = sig!;
      else                   body.typedName     = name.trim();
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Sign failed: ${res.status}`);
      setDone(true);          // hold the success state until the parent reload swaps this out
      onSigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sign failed');
      setBusy(false);
    }
  };
  const canSubmit = (mode === 'canvas' ? !!sig : name.trim().length > 0) && consent && !busy;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--jade-edge, #bfe3d6)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={16} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink, #1a1916)' }}>Sign this contract</div>
          <div className="note">Add your landlord signature below to countersign — no extra steps.</div>
        </div>
      </div>
      <div className="signas">
        <span className="sa-ic"><BadgeCheck size={20} /></span>
        <div>
          <div className="sa-l">Signing as Landlord</div>
          <div className="sa-n">{contract.landlord.companyName || contract.landlord.name || '—'}</div>
        </div>
      </div>
      <SignaturePad onChange={setSig} />
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
        <span className="note">{ESIGN_CONSENT_TEXT}</span>
      </label>
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-jade" disabled={!canSubmit || done} onClick={submit}>
          <Pencil size={14} /> {done ? 'Signed ✓' : busy ? 'Signing…' : 'Sign as Landlord'}
        </button>
      </div>
    </div>
  );
}

/** Inline RP counter-signature for the move-in / move-out inspection — shown on
 *  the step card once the customer has signed, so the landlord doesn't have to
 *  open the inspection workspace just to countersign. Move-in auto-activates. */
function InlineInspectionCounterSign({ contractId, type, onSigned }: {
  contractId: number; type: 'move_in' | 'move_out'; onSigned: () => void;
}) {
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection/sign?type=${type}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureImage: sig }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.message ?? `Sign failed: ${res.status}`);
      }
      setDone(true);          // hold the success state until the parent reload swaps this out
      onSigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sign failed');
      setBusy(false);
    }
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--jade-edge, #bfe3d6)', borderRadius: 'var(--r-lg)', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={16} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink, #1a1916)' }}>Counter-sign the inspection</div>
          <div className="note">
            {type === 'move_in'
              ? 'The customer has signed — add your signature to complete move-in and activate the tenancy.'
              : 'The customer has signed — add your signature to complete the move-out inspection.'}
          </div>
        </div>
      </div>
      <SignaturePad onChange={setSig} />
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-jade" disabled={!sig || busy || done} onClick={submit}>
          <Pencil size={14} /> {done ? 'Signed ✓' : busy ? 'Signing…' : 'Counter-sign inspection'}
        </button>
      </div>
    </div>
  );
}

function SignModal({
  contract, onClose, onSigned,
}: { contract: ContractDetail; onClose: () => void; onSigned: () => void }) {
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState(contract.landlord.companyName || contract.landlord.name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'canvas' | 'typed'>('canvas');
  const [consent, setConsent] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const body: { role: 'landlord'; signatoryName: string; method: 'online'; signatureImage?: string; typedName?: string; consent: boolean; clientMeta: Record<string, unknown> } = {
        role: 'landlord',
        signatoryName: name.trim() || (contract.landlord.companyName || 'Landlord'),
        method: 'online',
        consent,
        clientMeta: collectClientMeta(),
      };
      if (mode === 'canvas') body.signatureImage = sig!;
      else                   body.typedName     = name.trim();
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Sign failed: ${res.status}`);
      onSigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sign failed');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = (mode === 'canvas' ? !!sig : name.trim().length > 0) && consent && !busy;

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
          <div className="signas">
            <span className="sa-ic"><BadgeCheck size={20} /></span>
            <div>
              <div className="sa-l">Signing as Landlord</div>
              <div className="sa-n">{contract.landlord.companyName || contract.landlord.name || '—'}</div>
            </div>
          </div>
          <SignaturePad onChange={setSig} />
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
            <span className="note">{ESIGN_CONSENT_TEXT}</span>
          </label>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-jade btn-sm" disabled={!canSubmit} onClick={submit}>
            <Pencil size={14} /> Sign as Landlord
          </button>
        </div>
      </div>
    </div>
  );
}

function TerminateModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('');
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
        body: JSON.stringify({ reason, effectiveDate: effective }),
      });
      if (!res.ok) throw new Error(`Termination request failed: ${res.status}`);
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
            <label>Reason</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you ending this contract?" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Effective date</label>
            <input type="date" className="input" value={effective} onChange={e => setEffective(e.target.value)} />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-brick btn-sm" disabled={!reason.trim() || !effective || busy} onClick={submit}>
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
        body: JSON.stringify({ reason, effectiveDate: effective }),
      });
      if (!res.ok) throw new Error(`Direct termination failed: ${res.status}`);
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
            <label>Reason</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you ending this contract?" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Effective date</label>
            <input type="date" className="input" value={effective} onChange={e => setEffective(e.target.value)} />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-brick btn-sm" disabled={!reason.trim() || !effective || busy} onClick={submit}>
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
function CancelLeaseModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
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
      if (!res.ok) throw new Error(`Cancel failed: ${res.status}`);
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
            Cancel lease
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            This lease has not started yet, so cancelling voids it cleanly — no move-out or settlement. The contract is marked terminated and any pending cheques are voided. This cannot be undone.
          </p>
          <div className="field" style={{ margin: 0 }}>
            <label>Reason (optional)</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you cancelling this lease?" />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Keep lease</button>
          <button className="btn btn-brick btn-sm" disabled={busy} onClick={submit}>
            Cancel lease
          </button>
        </div>
      </div>
    </div>
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
    modeOfPayment: contract.modeOfPayment ?? 'cheque',
    chequePayeeName: '',
    adminFee: parentFeeAmt('admin_fee', contract.adminFeeFils),
    ejariFee: parentFeeAmt('ejari_fee', contract.ejariFeeFils),
    commission: parentFeeAmt('commission'),
  });
  // Extra one-off charge lines (Municipality Fee, parking add-on, etc.) — each a
  // separate cheque on top of rent + fees. Posted as `extraCharges`.
  const [extras, setExtras] = useState<{ description: string; amount: string; dueDate: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Installment plans + cheque days come from the contract payload (the OWNING
  // RP's config) so a manager — who has no RP profile of their own — still sees
  // the right filtered list and the preview snaps dates the same way the backend does.
  const allowedInstallments = contract.allowedInstallments ?? [];
  const chequeDays = contract.preferredChequeDays ?? [];

  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
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
  const adminN = parseFloat(f.adminFee) || 0;
  const ejariN = parseFloat(f.ejariFee) || 0;
  const commN = parseFloat(f.commission) || 0;
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
      rows.push({ key: `r${i}`, d: n === 1 ? 'Annual Rent' : `Rental Instalment ${i + 1} of ${n}`, date: dueDates[i] ?? '', net: r, vat: 0 });
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
  if (ejariN > 0) rows.push({ key: 'ejari', d: 'Ejari Fee', date: feeDate, net: ejariN, vat: 0 });
  if (commN > 0)  rows.push({ key: 'comm',  d: 'Commission', date: feeDate, net: commN, vat: 0 });
  extras.forEach((e, i) => {
    const amt = parseFloat(e.amount) || 0;
    if (e.description.trim() && amt > 0) rows.push({ key: `x${i}`, d: e.description.trim(), date: e.dueDate || (dueDates[n - 1] ?? ''), net: amt, vat: 0 });
  });
  const totalVat = rows.reduce((s, r) => s + r.vat, 0);
  const total = rows.reduce((s, r) => s + r.net + r.vat, 0);

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
          chequePayeeName: f.chequePayeeName.trim() || undefined,
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
    <div className="mscrim" onClick={onClose}>
      <div className="modal lg" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--jade)' }}><RotateCcw size={17} /></span>
            Propose renewal
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="subhead mut">Current contract</p>
          <div className="infopanel" style={{ marginBottom: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px' }}>
            <div className="note"><b style={{ color: 'var(--ink)' }}>{contract.tenant.name ?? '—'}</b></div>
            <div className="note">{fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}</div>
            <div className="note">Unit {contract.unit.number ?? '—'} · {contract.property.buildingName ?? '—'}</div>
            <div className="note">Current rent <b style={{ color: 'var(--ink)' }}>{fmtAed(contract.annualRent)}</b></div>
          </div>
          <p className="subhead mut">Renewal period</p>
          <div className="grid2">
            <div className="field"><label>Start date</label><input type="date" className="input" value={f.newStartDate} onChange={e => set('newStartDate', e.target.value)} /></div>
            <div className="field"><label>End date</label><input type="date" className="input" value={f.newEndDate} onChange={e => set('newEndDate', e.target.value)} /></div>
          </div>
          <div className="grid2" style={{ marginBottom: 18 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Installments</label>
              <select className="input" value={f.numberOfInstallments} onChange={e => set('numberOfInstallments', e.target.value)}>
                {allowedInstallmentPlans(allowedInstallments, [Number(f.numberOfInstallments)]).map(p => (
                  <option key={p.value} value={p.value}>{p.value}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Listed annual rent (AED)</label>
              <input type="number" className="input" value={f.listedRent} onChange={e => set('listedRent', e.target.value)} />
            </div>
          </div>
          <div className="grid2" style={{ marginBottom: 18 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Discount</label>
              <select className="input" value={f.discountType} onChange={e => set('discountType', e.target.value)}>
                <option value="none">No discount</option>
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed (AED)</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>{f.discountType === 'percent' ? 'Discount %' : f.discountType === 'fixed' ? 'Discount (AED)' : 'Net annual rent (AED)'}</label>
              {f.discountType === 'none'
                ? <input className="input" value={fmtAed(rent)} disabled style={{ background: 'var(--surface)', color: 'var(--ink-3)' }} />
                : <input type="number" className="input" value={f.discountValue} onChange={e => set('discountValue', e.target.value)} />}
            </div>
          </div>
          {f.discountType !== 'none' && (
            <p className="note mut" style={{ marginTop: -8, marginBottom: 16 }}>
              Net annual rent after discount: <b style={{ color: 'var(--ink)' }}>{fmtAed(rent)}</b>
              {discountAmt > 0 && <> (−{fmtAed(discountAmt)})</>}
            </p>
          )}
          <div className="grid2" style={{ marginBottom: 18 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Mode of payment</label>
              <select className="input" value={f.modeOfPayment} onChange={e => set('modeOfPayment', e.target.value)}>
                <option value="cheque">Cheque</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="online">Online</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Cheques payable to (optional)</label>
              <input className="input" value={f.chequePayeeName} placeholder={contract.landlord.companyName ?? contract.landlord.name ?? ''} onChange={e => set('chequePayeeName', e.target.value)} />
            </div>
          </div>
          <p className="subhead mut">Fees (AED) — billed as their own cheques</p>
          <div className="grid2">
            <div className="field"><label>Admin fee</label><input type="number" className="input" value={f.adminFee} onChange={e => set('adminFee', e.target.value)} /></div>
            <div className="field"><label>Ejari fee</label><input type="number" className="input" value={f.ejariFee} onChange={e => set('ejariFee', e.target.value)} /></div>
          </div>
          <div className="grid2" style={{ marginBottom: 18 }}>
            <div className="field"><label>Commission</label><input type="number" className="input" value={f.commission} onChange={e => set('commission', e.target.value)} /></div>
            <div className="field"><label>Deposit (carries over)</label><input className="input" value={fmtAed(contract.securityDepositAmount)} disabled style={{ background: 'var(--surface)', color: 'var(--ink-3)' }} /></div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <p className="subhead mut" style={{ margin: 0 }}>Additional charges</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addExtra}><Plus size={13} /> Add charge</button>
          </div>
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
              <table className="ptable" style={{ border: '1px solid var(--mist-strong)', borderRadius: 12, overflow: 'hidden' }}>
                <thead><tr><th>#</th><th>Description</th><th>Due date</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key}>
                      <td>{i + 1}</td>
                      <td>{r.d}{r.vat > 0 && <span className="note mut"> · incl. VAT {r.vat.toLocaleString('en-AE')}</span>}</td>
                      <td>{r.date ? fmtDate(r.date) : '—'}</td>
                      <td className="amt" style={{ textAlign: 'right' }}>{(r.net + r.vat).toLocaleString('en-AE')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {totalVat > 0 && (
                    <tr><td colSpan={3} style={{ color: 'var(--mute)' }}>of which VAT</td><td className="amt" style={{ textAlign: 'right', color: 'var(--mute)' }}>{totalVat.toLocaleString('en-AE')}</td></tr>
                  )}
                  <tr><td colSpan={3}>Total</td><td className="tot" style={{ textAlign: 'right' }}>{total.toLocaleString('en-AE')}</td></tr>
                </tfoot>
              </table>
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
  const unitLabel = contract.unit.name ?? (contract.unit.number ? `Unit ${contract.unit.number}` : '—');
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
  const feeItems = contract.fees ?? [];
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
  const totalVat = rentVat + v(otherItems) + v(feeItems);
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
  // Manager permission gate for the Edit affordance — RP owners always see it,
  // managers only when they hold canManageAgreements for this contract's landlord.
  const { canForRp: managerCanForRp } = useManagerPermissions();
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
  const [modal, setModal] = useState<'sign' | 'terminate' | 'renew' | 'direct-terminate' | 'cancel-lease' | null>(null);

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
  // Ejari / utility upload (ported from the old page so v2 is self-contained).
  const ejariInputRef = useRef<HTMLInputElement>(null);
  const utilityInputRef = useRef<HTMLInputElement>(null);
  // Wind-down doc uploads (move-out report + utility close-out). One shared
  // hidden input + a "pending kind" so a single onChange routes to the right key.
  const windDownInputRef = useRef<HTMLInputElement>(null);
  const [windDownKind, setWindDownKind] = useState<'move_in' | 'move_out' | 'clearance' | 'final_bill' | null>(null);
  const [ejariUploading, setEjariUploading] = useState(false);
  const [utilityUploading, setUtilityUploading] = useState(false);
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
  async function uploadContractDoc(file: File, displayName: string, keyPrefix: string) {
    if (!contract) return;
    const docKey = `${keyPrefix}_${Date.now()}`;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
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
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, category: 'property', documentKey: docKey, displayName, fileUrl, mimeType: file.type || 'application/octet-stream', s3Key: fileKey, isVisibleToTenant: true }),
    });
    if (!docRes.ok) throw new Error('Failed to record document');
  }

  const onUploadEjari = () => ejariInputRef.current?.click();
  const onEjariFilePicked = async (file: File) => {
    setEjariUploading(true);
    try {
      await uploadContractDoc(file, 'Ejari', 'ejari_certificate');
      // Register Ejari once the certificate is on file.
      await fetch(`/api/contracts/${contract.id}/ejari`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ejariStatus: 'registered' }),
      });
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Ejari upload failed'); }
    finally { setEjariUploading(false); if (ejariInputRef.current) ejariInputRef.current.value = ''; }
  };
  const onMarkEjari = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/mark-registered`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark Ejari failed: ${res.status}`);
      const data = await res.json().catch(() => ({ matched: true }));
      if (data.matched === false) {
        alert('No Ejari certificate is on file for this lease period yet. Please upload the certificate.');
        return;
      }
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not mark Ejari as on file.');
    }
  };
  const onUploadUtility = () => utilityInputRef.current?.click();
  const onUtilityFilePicked = async (file: File) => {
    setUtilityUploading(true);
    try {
      await uploadContractDoc(file, 'Utility Registration', 'utility_registration');
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

  // KYC approve / reject — use the dedicated verify/reject endpoints. A PATCH
  // with a `status` field is rejected by the API's whitelist validation (it's
  // not on UpdateDocumentDto) and silently does nothing, so this drawer's
  // approve/reject previously never persisted. Reject captures a reason that the
  // customer sees as their re-upload prompt (mirrors the leads page).
  const onApproveDoc = (id: number) => {
    fetch(`/api/documents/${id}/verify`, { method: 'POST', credentials: 'include' })
      .then(r => { if (r.ok) void reload(); }).catch(() => {});
  };
  const onRejectDoc = (id: number) => {
    const reason = window.prompt('Reason for rejection (the customer will see this and be asked to re-upload):');
    if (reason === null) return; // cancelled
    fetch(`/api/documents/${id}/reject`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
    }).then(r => { if (r.ok) void reload(); }).catch(() => {});
  };

  // ── Flow 1: record payment + update status ──
  // POST /api/contracts/:id/payments  (mirrors old page addPaymentInstalment)
  const onRecordPayment = async (body: {
    description?: string; amount: number; vatAmount?: number; paymentType?: string; paymentMethod?: string;
    chequeNumber?: string; transactionDate?: string; chequeStatus?: string;
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
    description?: string | null; transactionDate?: string | null; paymentMethod?: string;
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
    if (!confirm('Roll the tenancy back to issued and clear the existing Ejari? You will then be able to upload a corrected certificate.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/reset`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to reset Ejari'); }
  };

  // ── Flow 5: upload KYC / contract document ──
  // upload-url → PUT → POST /api/documents (mirrors old page uploadDocument payload:
  // ownerType 'tenancy_contract', ownerId = contract.id, with category/visibility/expiry).
  const onUploadDoc = async (
    file: File,
    meta: { key: string; label: string; category: string },
    visibleToTenant: boolean,
    expiryDate: string,
  ) => {
    const docKey = `${meta.key}_${Date.now()}`;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
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
      ownerType: 'tenancy_contract', ownerId: contract.id, category: meta.category,
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
    const docKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
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
  const rpScope = searchParams.get('rp') ?? (contract.landlord?.id != null ? String(contract.landlord.id) : '');
  const mgrCan = (flag: Parameters<typeof managerCanForRp>[0]) =>
    !isManagerView || (rpScope !== '' && managerCanForRp(flag, Number(rpScope)));
  const perms: ActorPerms = {
    renewals:      mgrCan('canManageRenewals'),
    agreements:    mgrCan('canManageAgreements'),
    // "Sign as Landlord" needs POA in addition to signing rights (a manager may
    // only sign the landlord's signature with power of attorney).
    signLandlord:  mgrCan('canSignDocuments') && mgrCan('canActAsPoa'),
    signDocuments: mgrCan('canSignDocuments'),
    // Deposit edit / settlement: either deposits OR collections permission.
    deposits:      mgrCan('canManageDeposits') || mgrCan('canManageCollections'),
    // Record/edit payment + clear-cheque: the backend accepts the granular
    // carve-out flags OR the umbrella, so surface the buttons for any of them.
    collections:   mgrCan('canManageCollections') || mgrCan('canRecordPayments') || mgrCan('canClearCheques'),
  };

  // Step content + jump-to-step handler
  const stopOf = (n: number) => mode === 'renewal' ? `Renewal · Stop ${n}` : `Stop ${n} of 6`;
  const handlers: StepHandlers = {
    contract, state: derived,
    setState: setLocalState,
    openModal: setModal,
    openDrawer: (t) => document.getElementById('sec-' + t)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    patchContract,
    onActivate, onIssue, onUploadEjari, onMarkEjari, onUploadUtility, onMarkUtility, onMarkSignedOnFile, onVerifyUtility, onConfirmPdc, onAcceptDocs, onUpdatePayment, onRevertToDraft,
    onRenewalDraft,
    onUnsendSettlement,
    onCancelTermination,
    onUploadMoveInDoc, onUploadMoveOutDoc, onUploadCloseoutClearance, onUploadCloseoutFinalBill,
    signActionUrl: `${contractsBase}/${contract.id}`,
    inspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_in`,
    moveOutInspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_out`,
    settlementUrl: `${contractsBase}/${contract.id}/settlement`,
    printUrl: `${contractsBase}/${contract.id}/print`,
    contractsBase,
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

  // KYC docs = customer-owned documents in contract.documents.
  // On a RENEWAL, valid documents are already on file, so we only surface the
  // ones that are EXPIRED (they're the only profile docs that need re-collecting).
  // New contracts show the full set.
  const allKycDocs = (contract.documents ?? []).filter(d => d.ownerType === 'customer' || d.ownerType === 'tenant');
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
                    for property details). Manager view stays plain (different base). */}
                {contract.property.id && !isManagerView ? (
                  <Link href={`/rental-provider/dashboard/portfolio?property=${contract.property.id}`} className="chain-link" title="Open property details">
                    {contract.property.buildingName ?? '—'}
                  </Link>
                ) : (
                  <span>{contract.property.buildingName ?? '—'}</span>
                )}
                <ChevronRight size={12} style={{ opacity: .5 }} />
                {contract.property.id && contract.unit.id && !isManagerView ? (
                  <Link href={`/rental-provider/dashboard/units/${contract.unit.id}`} className="chain-link" title="Open unit details">
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
              const rpForEdit = searchParams.get('rp') ?? (contract.landlord?.id != null ? String(contract.landlord.id) : '');
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
                && contract.renewalAccepted !== 'pending' && contract.renewalAccepted !== 'accepted'
                && contract.renewalStatus !== 'draft' && contract.termination?.response !== 'accepted'
                && perms.renewals;
              const canTerminate = (contract.status === 'active' || contract.status === 'expired')
                && contract.termination?.response !== 'accepted' && perms.agreements;
              // Not-yet-active leases (pending/issued) can be cancelled cleanly
              // (no move-out/settlement) — a void rather than a wind-down.
              const canCancel = (contract.status === 'pending' || contract.status === 'issued')
                && perms.agreements;
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
                      <X size={14} /> Cancel lease
                    </button>
                  )}
                </>
              );
            })()}
            {/* A cancelled (pre-active void) lease can be rolled back to its
                previous issued state — cheques reinstated. */}
            {!showPipeline && contract.status === 'terminated'
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
              && contract.renewalAccepted !== 'pending'
              && contract.renewalAccepted !== 'accepted'
              && contract.renewalStatus !== 'draft'
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
            {/* Clean void for a not-yet-active (pending/issued) lease — the
                tenant never started, so this cancels without a move-out/
                settlement wind-down. Distinct from "Terminate directly". */}
            {showPipeline && (contract.status === 'pending' || contract.status === 'issued')
              && perms.agreements && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }}
                onClick={() => setModal('cancel-lease')}
              >
                <X size={14} /> Cancel lease
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
            {derived.landlordSigned && (
              <span className="pill celebrate" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <BadgeCheck size={13} /> You signed
              </span>
            )}
          </div>
        </div>

        {/* Record view: boarding-pass contract summary (Unit + parties + term +
            rent). Payment + document detail render below. The full/pipeline view
            keeps the compact info row instead. */}
        {view === 'record' && <ContractPass contract={contract} payments={contract.payments ?? []} tenantHref={!isManagerView && contract.tenant.id ? `/rental-provider/dashboard/tenants/${contract.tenant.id}` : null} />}

        {/* Customer + rental period — ONE info row under the header (replaces
            the old Parties and Rental period sections). */}
        {view !== 'record' && (
        <div className="infobar">
          <span className="pitem">
            <span className="pk">Customer</span>
            <span className="pv">
              {contract.tenant.id && !isManagerView ? (
                <Link href={`/rental-provider/dashboard/tenants/${contract.tenant.id}`} className="chain-link" title="Open customer details">
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
          && !isSuperseded && !isDeclinedRenewal && (
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
        {showPipeline && !isSuperseded && !isDeclinedRenewal && (
          <MissingStrip
            missing={missingSteps}
            allActive={allActive}
            onJump={(k) => setSelKey(k)}
          />
        )}

        {showPipeline && (
        <div className="quest">
          {!isSuperseded && !isDeclinedRenewal && (
            <QuestMap
              steps={steps}
              doneArr={doneArr}
              selectedIdx={selIdx}
              onSelect={(i) => setSelKey(steps[i].key)}
              mode={mode}
            />
          )}
          <div className="acard" style={isSuperseded || isDeclinedRenewal ? { gridColumn: '1 / -1' } : undefined}>
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
            {selStep.key === 'sign' && contract.tenant.id && !readOnlyWorkflow && perms.signLandlord && (
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
                <InlineLandlordSign contract={contract} onSigned={() => void reload()} />
              </div>
            )}
            {/* Move-in: second link for the on-site inspection manager — they
                 fill the move-in form, attach photos, submit and counter-sign
                 the RP side via the same no-login portal, so no separate account
                 is needed. */}
            {selStep.key === 'movein' && contract.tenant.id && !readOnlyWorkflow && (
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
            {selStep.key === 'movein' && derived.moveIn.rpSubmitted && derived.moveIn.tenantSig && !derived.moveIn.rpCounterSig && perms.signDocuments && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <InlineInspectionCounterSign contractId={contract.id} type="move_in" onSigned={() => void reload()} />
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
                 inspector link above; backend already supports move_out. */}
            {selStep.key === 'moveout' && contract.tenant.id && !derived.moveOut.rpCounterSig && (
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
            {/* Flow 4: Redo Ejari — roll back to issued so a corrected certificate
                 can be uploaded. Shown on the Ejari step once it is registered and
                 the workflow has not yet frozen (active / expired / terminated). */}
            {selStep.key === 'ejari' && derived.ejariStatus === 'registered' && !readOnlyWorkflow && (
              <button className="ca" style={{ justifySelf: 'start', marginTop: -4, padding: 0, color: 'var(--brick)' }} onClick={() => void onRedoEjari()}>
                <RotateCcw size={12} /> Redo Ejari (reset &amp; re-upload)
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
            onRecordPayment={onRecordPayment}
            onUpdatePayment={onUpdatePayment}
            onDeletePayment={onDeletePayment}
            onUpdateDeposit={onUpdateDeposit}
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

      {modal === 'sign' && perms.signLandlord && <SignModal contract={contract} onClose={() => setModal(null)} onSigned={() => { setModal(null); void reload(); }} />}
      {modal === 'terminate' && perms.agreements && <TerminateModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); loadNotes(); }} />}
      {modal === 'direct-terminate' && perms.agreements && <DirectTerminateModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); setSelKey('moveout'); void reload(); loadNotes(); }} />}
      {modal === 'cancel-lease' && perms.agreements && <CancelLeaseModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); loadNotes(); }} />}
      {modal === 'renew' && perms.renewals && <RenewalProposeModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); }} />}

      {/* Hidden file pickers for inline Ejari / utility upload (self-contained, no redirect to the old page). */}
      <input ref={ejariInputRef} type="file" accept="application/pdf,image/jpeg,image/png" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onEjariFilePicked(f); }} />
      <input ref={utilityInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUtilityFilePicked(f); }} />
      {/* Wind-down doc picker (move-out report / utility clearance / final bill) — routed by windDownKind. */}
      <input ref={windDownInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; const k = windDownKind; if (f && k) void onWindDownFilePicked(f, k); }} />
      {(ejariUploading || utilityUploading || windDownUploading) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 9999, color: '#fff', font: '600 14px system-ui' }}>
          Uploading {ejariUploading ? 'Ejari' : utilityUploading ? 'utility' : 'wind-down'} document…
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
      .quest-page .ptable { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .quest-page .ptable th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--mute); font-weight: 700; padding: 8px 8px; border-bottom: 1px solid var(--mist-strong); }
      .quest-page .ptable td { padding: 10px 8px; border-bottom: 1px solid var(--mist); color: var(--ink-2); }
      .quest-page .ptable tr:last-child td { border-bottom: 0; }
      .quest-page .ptable .amt { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
      .quest-page .ptable tfoot td { border-top: 2px solid #bfe3d5; background: var(--jade-tint); font-weight: 800; }
      .quest-page .ptable tfoot .tot { color: var(--jade-deep); }
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
      .quest-page .docitem .dacts { margin-left: auto; display: flex; gap: 5px; flex-shrink: 0; }
      .quest-page .docitem .mini-btn { padding: 3px 8px; }
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
