/**
 * Shared, pure lead-journey helpers — extracted so both the Leads LIST page
 * and the new Lead DETAIL page (/leads/[id]) render the exact same state from
 * the exact same data, with zero divergence.
 *
 * Nothing here touches the network or React; it is the single source of truth
 * for: the lead stage vocabulary, stage labels/pills, the pending-viewing
 * selector, the client-side urgency triage (getUrgency), and the primary-action
 * resolver (getPrimary). Keep this file dependency-free.
 */

/* ─── Stage vocabulary ────────────────────────────────────────────────────── */
export type LeadStage =
  | 'new' | 'contacted' | 'viewing_scheduled'
  | 'offer_made' | 'applied' | 'approved'
  | 'documents_collection' | 'payment_plan_shared'
  | 'interested' | 'cheques_submitted' | 'cheques_collected' | 'contract_issued'
  | 'rejected' | 'converted';

export const STAGE_LABELS: Record<LeadStage, string> = {
  new:                  'New',
  contacted:            'Contacted',
  viewing_scheduled:    'Viewing',
  offer_made:           'Offer Made',
  applied:              'Applied',
  approved:             'Approved',
  documents_collection: 'Docs Collection',
  payment_plan_shared:  'Plan Shared',
  interested:           'Interested',
  cheques_submitted:    'Payment Advice Ready',
  cheques_collected:    'Payment Advice Collected',
  contract_issued:      'Contract Issued',
  rejected:             'Rejected',
  converted:            'Converted',
};

/** Tailwind pill classes (used by the list page). The detail page maps stages
 *  to the .quest-page pill tones instead — see nodeToneForStage there. */
export const STAGE_PILL: Record<LeadStage, string> = {
  new:                  'bg-[#dbeafe] text-[#1e40af]',
  contacted:            'bg-[#ede9fe] text-[#6d28d9]',
  viewing_scheduled:    'bg-[#fef3c7] text-[#92400e]',
  offer_made:           'bg-[#d8f2e8] text-[#1a7a5a]',
  applied:              'bg-[#fce7f3] text-[#9d174d]',
  approved:             'bg-[#d1fae5] text-[#065f46]',
  documents_collection: 'bg-[#fff7ed] text-[#c2410c]',
  payment_plan_shared:  'bg-[#f0f9ff] text-[#0369a1]',
  interested:           'bg-[#d8f2e8] text-[#1f5a3f]',
  cheques_submitted:    'bg-[#fef9c3] text-[#854d0e]',
  cheques_collected:    'bg-[#d8f2e8] text-[#1a7a5a]',
  contract_issued:      'bg-[#d1fae5] text-[#065f46]',
  rejected:             'bg-[#fee2e2] text-[#b91c1c]',
  converted:            'bg-[#e0f2fe] text-[#0369a1]',
};

/* ─── API shapes (mirror leads.service.ts getLeadById) ────────────────────── */
export interface ApiViewing {
  id: number;
  scheduledAt: string;
  createdAt?: string;
  updatedAt?: string;
  status: string;
  desiredMoveIn?: string | null;
  notes?: string | null;
  outcome?: string | null;
  reopenNote?: string | null;   // RP → customer message on reopen (revised price / negotiation)
  declineNote?: string | null;  // customer → RP reason when they marked "not interested"
  preferredChequeCount?: number | null;
  paymentType?: string | null;
}

export type PaymentMethodKind = 'cheque' | 'bank_transfer' | 'card' | 'cash';

export interface PaymentPlanItem {
  index: number;
  amountFils: number;
  dueDate: string;
  description?: string;
  type?: 'fee' | 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
  paymentMethod?: PaymentMethodKind | null;
  reference?: string | null;
}

export interface PaymentPlan {
  chequeCount: number;
  totalAmountFils: number;
  rentFils: number;
  originalRentFils?: number;
  discountType?: 'percent' | 'fixed';
  discountPercent?: number;
  discountFils?: number;
  installmentCount: number;
  adminFeeFils: number;
  ejariFils: number;
  commissionFils: number;
  securityDepositFils: number;
  customFees?: Array<{ label: string; netFils: number; vatFils: number }>;
  customFeesFils?: number;
  items: PaymentPlanItem[];
  notes?: string;
  rentalIndexReportUrl?: string;
  chequesPayableTo?: string;
  issuedAt: string;
}

export interface LeadChequeRecord {
  id: number;
  chequeSerial: string | null;
  bankName: string;
  amountFils: number;
  dueDate: string;
  status: string;
  notes?: string | null;
  imageUrl?: string | null;
  payeeName?: string | null;
  accountNumber?: string | null;
  ocrStatus?: 'pending' | 'done' | 'failed' | null;
  isCustomerUpload?: boolean;
  paymentMethod?: PaymentMethodKind | null;
  planItemIndex?: number | null;
}

export interface ApiLead {
  id: number;
  stage: LeadStage;
  priority: string;
  customerName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  source: string | null;
  notes: string | null;
  additionalDocsNote: string | null;
  createdAt: string;
  updatedAt: string;
  viewings?: ApiViewing[];
  convertedTenant: { id: number; user?: { name?: string; email?: string; phone?: string } } | null;
  unit: {
    id: number; unitNumber: string; unitName: string | null;
    unitType: string | null;
    rentalPrice: number | null;
    securityDeposit: number | null;
    adminFee: number | null;
    ejariFeeFils: number | null;
    commission: number | null;
    property?: { id: number; buildingName: string };
  } | null;
  docStats: { total: number; pending: number } | null;
  paymentPlan?: PaymentPlan | null;
  costPreview?: {
    rentFils: number; rentVatFils: number; rentVatRate: number;
    securityDepositFils: number;
    adminFeeFils: number; adminFeeVatFils: number;
    ejariFils: number; ejariVatFils: number;
    commissionFils: number; commissionVatFils: number;
    customFees?: Array<{ label: string; netFils: number; vatFils: number }>;
    customFeesFils?: number;
    totalFils: number;
  } | null;
  /** Rejection reason, when the lead is rejected and one was captured. Optional —
   *  getLeadById may not surface it; the detail page guards for its absence. */
  rejectionReason?: string | null;
  /** Set on converted leads when getLeadById links the created contract. Optional
   *  — falls back to a contracts search when absent. */
  contractId?: number | null;
}

/* ─── Pending viewing selector ────────────────────────────────────────────── */
export function getPendingViewing(lead: ApiLead): ApiViewing | null {
  return (
    lead.viewings
      ?.filter(v => v.status === 'scheduled' || v.status === 'confirmed')
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0] ?? null
  );
}

/** Latest viewing by updatedAt (any status) — used for the "record outcome" view. */
export function getLatestViewing(lead: ApiLead): ApiViewing | null {
  return (
    lead.viewings?.slice().sort((a, b) => {
      const at = (v: ApiViewing) => new Date(v.updatedAt ?? v.createdAt ?? v.scheduledAt).getTime();
      return at(b) - at(a);
    })[0] ?? null
  );
}

/* ─── Needs-attention triage (client-side, from data on the lead) ─────────── */
export type Urgency = { level: 'red' | 'amber'; label: string };

const DAY_MS = 86_400_000;

export function getUrgency(lead: ApiLead): Urgency | null {
  const now = Date.now();
  const daysSince = (iso?: string | null) =>
    iso ? Math.floor((now - new Date(iso).getTime()) / DAY_MS) : null;

  if (lead.stage === 'viewing_scheduled') {
    const v = getPendingViewing(lead);
    // Grace period — a viewing that just passed may be happening now or just
    // finished, so don't raise a "passed / overdue" alarm the instant the clock
    // ticks past the slot. Stay calm (the customer still sees it as confirmed /
    // upcoming) until it's genuinely missed — 4h later, or a later day.
    const GRACE_MS = 4 * 60 * 60 * 1000;
    if (v && now > new Date(v.scheduledAt).getTime() + GRACE_MS) {
      const d = daysSince(v.scheduledAt) ?? 0;
      return d < 1
        ? { level: 'amber', label: 'Viewing time passed — record the outcome' }
        : { level: d >= 2 ? 'red' : 'amber', label: `Viewing ${d}d overdue` };
    }
    return null;
  }

  const idle = daysSince(lead.updatedAt);
  if (idle == null) return null;
  switch (lead.stage) {
    case 'payment_plan_shared':
      return idle >= 3 ? { level: idle >= 7 ? 'red' : 'amber', label: `Plan shared ${idle}d — follow up` } : null;
    case 'documents_collection':
      return idle >= 3 ? { level: idle >= 7 ? 'red' : 'amber', label: `Docs pending ${idle}d` } : null;
    case 'interested':
      return idle >= 3 ? { level: idle >= 7 ? 'red' : 'amber', label: `No next step ${idle}d` } : null;
    case 'cheques_submitted':
      return idle >= 2 ? { level: idle >= 5 ? 'red' : 'amber', label: `Payment advice ready ${idle}d — collect` } : null;
    default:
      return null;
  }
}

/* ─── Primary action per stage ────────────────────────────────────────────── */
export type PrimaryAction =
  | { kind: 'stage'; label: string; target: LeadStage }
  | { kind: 'mark_visited'; label: string }
  | { kind: 'approve_docs'; label: string }
  | { kind: 'record_cheques'; label: string }
  | { kind: 'confirm_collected'; label: string }
  | { kind: 'convert'; label: string };

export function getPrimary(lead: ApiLead): PrimaryAction | null {
  const viewing = getPendingViewing(lead);

  switch (lead.stage) {
    case 'viewing_scheduled':
      return viewing ? { kind: 'mark_visited', label: 'Mark Visited' } : null;
    case 'documents_collection':
    case 'interested':
      return { kind: 'approve_docs', label: 'Review Documents' };
    case 'payment_plan_shared':
      return null; // waiting for customer to upload cheques
    case 'cheques_submitted':
      return { kind: 'record_cheques', label: 'Payment Review & Approve' };
    case 'cheques_collected':
      // Recovery lane only — surfaces if the auto-create failed.
      return lead.unit?.id && lead.convertedTenant?.id
        ? { kind: 'convert', label: 'Issue Contract' }
        : null;
    case 'rejected':
      return { kind: 'stage', label: 'Reopen', target: 'viewing_scheduled' };
    default:
      return null;
  }
}
