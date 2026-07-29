'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, X, RefreshCw, Phone, Mail, Building2,
  Clock, CheckCircle2, MessageSquare, User, Calendar,
  FileText, ExternalLink, Loader2, MoreVertical, ArrowRight,
  StickyNote, ShieldAlert, Copy, Check, CreditCard, Plus, Trash2,
  ClipboardList, BadgeCheck, Printer, Eye, LayoutGrid, LayoutList, UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { PreferredDayPicker } from '@/components/PreferredDayPicker';
import { LeadsCalendarView } from '@/components/leads/LeadsCalendarView';
import { NewLeadModal } from '@/components/leads/NewLeadModal';
import { getRequiredDocs, type DocReq } from '@/lib/docRequirements';
import { openDocsTogether } from '@/lib/openDocsTogether';
import { openDocViewer } from '@/lib/docViewer';
import { putKycSlot } from '@/lib/kycSlotUpload';
import { docLabel } from '@/lib/docLabel';
import { REQUESTABLE_DOCS, additionalDocKey, parseAdditionalDocs, resolveRequestedDocKey } from '@/lib/requestableDocs';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { leadContactPerson, leadDisplayName } from '@/lib/leadJourney';

/* ─── Types ───────────────────────────────────────────────────────────────── */

interface FeeRuleDto {
  feeType: string;
  valueType: 'fixed_aed' | 'percentage';
  value: number;
  vatApplicable: boolean;
  vatRate: number;
  isActive?: boolean;
}
type FeeRulesMap = Record<string, FeeRuleDto[]>;

const COMMERCIAL_UNIT_TYPES = new Set([
  'retail_shop','showroom','office_fitted','office_shell_core',
  'restaurant_fnb','clinic_medical','coworking_desk','private_office',
  'meeting_room','day_office','event_hall','wedding_venue',
  'conference_hall','private_dining','outdoor_venue',
]);
const INDUSTRIAL_UNIT_TYPES = new Set([
  'warehouse','open_yard','storage_unit','cold_storage','logistics_facility',
]);


function unitSpaceCategory(unitType?: string | null): 'residential' | 'commercial' | 'industrial' {
  if (!unitType) return 'residential';
  if (INDUSTRIAL_UNIT_TYPES.has(unitType)) return 'industrial';
  if (COMMERCIAL_UNIT_TYPES.has(unitType)) return 'commercial';
  return 'residential';
}

function feeToAed(rule: FeeRuleDto, annualRentAed: number): string {
  if (rule.valueType === 'percentage') {
    return String(Math.round(annualRentAed * rule.value / 100));
  }
  return String(rule.value);
}

type LeadStage =
  | 'new' | 'contacted' | 'viewing_scheduled'
  | 'offer_made' | 'applied' | 'approved'
  | 'documents_collection' | 'payment_plan_shared'
  | 'interested' | 'cheques_submitted' | 'cheques_collected' | 'contract_issued'
  | 'rejected' | 'converted';

const STAGE_LABELS: Record<LeadStage, string> = {
  new:                  'New',
  contacted:            'Contacted',
  viewing_scheduled:    'Viewing',
  offer_made:           'Offer Made',
  applied:              'Applied',
  approved:             'Approved',
  documents_collection: 'Docs Collection',
  payment_plan_shared:  'Plan Shared',
  interested:           'Interested',
  cheques_submitted:    'Payment Confirmation Ready',
  cheques_collected:    'Payment Confirmation Collected',
  contract_issued:      'Contract Issued',
  rejected:             'Rejected',
  converted:            'Converted',
};

const STAGE_PILL: Record<LeadStage, string> = {
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

// The live pipeline stages, in funnel order — see FUNNEL_COLS below, which
// drives the (only) stage filter. Legacy/never-reached stages (new, contacted,
// approved, offer_made, applied) are intentionally omitted there; their
// labels/colors are still defined above so any stray record renders a badge
// and remains visible under "All".

interface ApiViewing {
  id: number;
  scheduledAt: string;
  createdAt?: string;
  updatedAt?: string;
  status: string;
  desiredMoveIn?: string | null;
  notes?: string | null;
  outcome?: string | null;
  reopenNote?: string | null;   // RP → customer message on reopen
  declineNote?: string | null;  // customer → RP reason on "not interested"
  preferredChequeCount?: number | null;
  paymentType?: string | null;
}

interface PaymentPlanItem {
  index: number;
  amountFils: number;
  dueDate: string;
  description?: string;
  type?: 'fee' | 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
  /** RP-assigned payment method for this installment (default cheque). */
  paymentMethod?: PaymentMethodKind | null;
  /** RP-entered reference for this installment (cheque #, transfer ID, auth code). */
  reference?: string | null;
}

type PaymentMethodKind = 'cheque' | 'bank_transfer' | 'card' | 'cash';

const PAYMENT_METHOD_LABEL: Record<PaymentMethodKind, string> = {
  cheque:        'Cheque',
  bank_transfer: 'Bank transfer',
  card:          'Card',
  cash:          'Cash',
};

interface PaymentPlan {
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
  /** RP-defined extra unit charges (net + VAT, fils); gross = net + vat. */
  customFees?: Array<{ label: string; netFils: number; vatFils: number }>;
  customFeesFils?: number;
  items: PaymentPlanItem[];
  notes?: string;
  rentalIndexReportUrl?: string;
  chequesPayableTo?: string;
  issuedAt: string;
}

interface LeadChequeRecord {
  id: number;
  /** Generic payment reference. For cheques this is the serial; for bank
   *  transfers, the transaction id; for cards/cash, any tracking string.
   *  Nullable for customer-uploaded rows that haven't been tagged yet. */
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
  /** Phase 5b — set by the RP when they verify the customer's reference.
   *  Null until the landlord taps one of the method pills on review. */
  paymentMethod?: PaymentMethodKind | null;
  /** Phase 5b — which PaymentPlan item this upload settles. Null until
   *  the RP picks one from the dropdown on the customer-uploaded row. */
  planItemIndex?: number | null;
}

interface ApiLead {
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
  convertedTenant: {
    id: number;
    entityType?: string | null;
    companyName?: string | null;
    user?: { name?: string; email?: string; phone?: string };
  } | null;
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
  /** Live GROSS cost summary (VAT-inclusive) computed by the backend the same way
   *  the customer's "I'm Interested" screen is — present only while no firm plan
   *  exists, so the lead Details matches what the customer is shown. */
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
}

type TenantDoc = {
  id: number; documentKey: string; displayName: string | null;
  fileUrl: string; mimeType: string | null; status: string;
  notes?: string | null;
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE,
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE,
  });
}

function getPendingViewing(lead: ApiLead) {
  return (
    lead.viewings
      ?.filter(v => v.status === 'scheduled' || v.status === 'confirmed')
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0] ?? null
  );
}

/* ─── Needs-attention triage ──────────────────────────────────────────────── */
// Derived purely from data already on the lead — no backend involvement.
// A lead is urgent when its viewing date passed without an outcome being
// recorded, or its stage has sat without movement past a small SLA.
type Urgency = { level: 'red' | 'amber'; label: string };

const DAY_MS = 86_400_000;

function getUrgency(lead: ApiLead): Urgency | null {
  const now = Date.now();
  const daysSince = (iso?: string | null) =>
    iso ? Math.floor((now - new Date(iso).getTime()) / DAY_MS) : null;

  if (lead.stage === 'viewing_scheduled') {
    const v = getPendingViewing(lead);
    if (v && new Date(v.scheduledAt).getTime() < now) {
      const d = daysSince(v.scheduledAt) ?? 0;
      return d < 1
        ? { level: 'amber', label: 'Viewing passed — record outcome' }
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
      return idle >= 2 ? { level: idle >= 5 ? 'red' : 'amber', label: `Payment confirmation ready ${idle}d — collect` } : null;
    default:
      return null;
  }
}

const URGENCY_PILL: Record<'red' | 'amber', string> = {
  red:   'bg-[#fee2e2] text-[#b91c1c]',
  amber: 'bg-[#fef3c7] text-[#92400e]',
};

// Short phrases for the needs-action banner breakdown, per urgent stage.
const URGENCY_PHRASE: Partial<Record<LeadStage, [string, string]>> = {
  viewing_scheduled:    ['overdue viewing', 'overdue viewings'],
  interested:           ['no next step', 'no next step'],
  documents_collection: ['docs pending', 'docs pending'],
  payment_plan_shared:  ['stale plan', 'stale plans'],
  cheques_submitted:    ['payment advice to collect', 'payment advice to collect'],
};

// Pipeline header columns, in funnel order; terminal stages last.
const FUNNEL_COLS: [LeadStage, string][] = [
  ['viewing_scheduled',    'Viewing'],
  ['interested',           'Interested'],
  ['documents_collection', 'Docs'],
  ['payment_plan_shared',  'Plan'],
  ['cheques_submitted',    'Payment Confirmation'],
  // `cheques_collected` is normally transient — the contract auto-issues and the
  // lead jumps straight to `converted`. It only ever rests here if the auto-create
  // failed (e.g. unit still occupied), so it stays in the funnel as the recovery
  // lane (its "Issue Contract" CTA re-runs the conversion). `contract_issued` is
  // retired from the UI: a lead with a contract now lives under Converted.
  ['cheques_collected',    'Collected'],
  ['converted',            'Converted'],
  ['rejected',             'Rejected'],
];

/* ─── Primary action per stage ────────────────────────────────────────────── */
type PrimaryAction =
  | { kind: 'stage'; label: string; target: LeadStage; cls: string }
  | { kind: 'mark_visited'; label: string; cls: string }
  | { kind: 'approve_docs'; label: string; cls: string }
  | { kind: 'record_cheques'; label: string; cls: string }
  | { kind: 'confirm_collected'; label: string; cls: string }
  | { kind: 'convert'; label: string; cls: string };

function getPrimary(lead: ApiLead): PrimaryAction | null {
  const viewing = getPendingViewing(lead);

  switch (lead.stage) {
    case 'viewing_scheduled':
      return viewing
        ? { kind: 'mark_visited', label: 'Mark Visited', cls: 'bg-[#d8f2e8] text-[#1a7a5a] hover:bg-[#bbf0d8]' }
        : null;
    // Live pipeline stages — `interested` and `documents_collection` both
    // sit at "customer has uploaded their docs and is waiting for RP to
    // confirm". The payment plan was already auto-generated when the
    // customer expressed interest, so RP just needs a one-click "looks
    // good" action — no modal, no re-entry of plan fields. Approving
    // flips the lead to `payment_plan_shared` and unlocks Step 3 on the
    // customer side (cheque upload / ready-to-collect).
    case 'documents_collection':
    case 'interested':
      return { kind: 'approve_docs', label: 'Review Documents',
        cls: 'bg-[#2e9f82] text-white hover:bg-[#1f6655]' };
    case 'payment_plan_shared':
      return null; // waiting for customer to upload cheques
    case 'cheques_submitted':
      return { kind: 'record_cheques', label: 'Payment Review & Approve',
        cls: 'bg-[#fef9c3] text-[#854d0e] hover:bg-[#fef08a]' };
    case 'cheques_collected':
      // Recovery lane only: on the happy path the contract auto-issues and the lead
      // is already `converted` by the time it reloads, so this CTA is never seen.
      // It surfaces if the auto-create failed — "Issue Contract" re-runs conversion.
      return lead.unit?.id && lead.convertedTenant?.id
        ? { kind: 'convert', label: 'Issue Contract', cls: 'bg-[#2e9f82] text-white hover:bg-[#1f6655]' }
        : null;
    case 'rejected':
      return { kind: 'stage', label: 'Reopen', target: 'viewing_scheduled',
        cls: 'bg-[#f4f3f0] text-[#3d3b35] hover:bg-[#e8e6e0]' };
    default:
      return null;
  }
}

/* ─── Cheque Row — one planned payment in the Record Cheques series ─────── */
const CHEQUE_STATUSES = ['pending', 'cleared', 'bounced', 'cancelled'] as const;
type ChequeRowStatus = typeof CHEQUE_STATUSES[number];
const CHEQUE_STATUS_STYLE: Record<ChequeRowStatus, string> = {
  pending:   'bg-[#fef3c7] text-[#854d0e] border-[#fde68a]',
  cleared:   'bg-[#d1fae5] text-[#065f46] border-[#86efac]',
  bounced:   'bg-[#fee2e2] text-[#991b1b] border-[#fca5a5]',
  cancelled: 'bg-[#f4f3ef] text-[#6b6860] border-[#d6d4ce]',
};

/** Increment the trailing numeric portion of a cheque serial, e.g. "CK001234" → "CK001235" */
function nextSerial(base: string, offset = 1): string {
  const match = base.match(/^(.*?)(\d+)$/);
  if (!match) return base;
  const [, prefix, digits] = match;
  const next = (parseInt(digits, 10) + offset).toString().padStart(digits.length, '0');
  return prefix + next;
}

/** Rewrites an RP lead URL to the manager-scoped equivalent when acting as a
 *  manager (swaps /api/leads → /api/manager/leads + appends ?rp=). In RP mode
 *  (manager undefined) the URL is returned unchanged. */
function leadUrl(path: string, manager?: { rp: number } | null): string {
  if (!manager) return path;
  const swapped = path.replace('/api/leads', '/api/manager/leads');
  return swapped + (swapped.includes('?') ? '&' : '?') + `rp=${manager.rp}`;
}

function ChequeRow({
  seq, description, amountFils, dueDate, recorded,
  suggestedSerial, onRecord, onDelete, onStatusChange, onSerialChange,
}: {
  seq: number;
  description: string;
  amountFils: number;
  dueDate: string;
  recorded?: LeadChequeRecord;
  suggestedSerial?: string;
  onRecord: (serial: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onStatusChange: (status: ChequeRowStatus) => void | Promise<void>;
  onSerialChange?: (serial: string) => void;
}) {
  const [serial, setSerial] = useState(suggestedSerial ?? '');
  const [saving, setSaving] = useState(false);

  // Apply parent suggestion only when the field is still empty
  useEffect(() => {
    if (suggestedSerial && !serial) setSerial(suggestedSerial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedSerial]);

  if (recorded) {
    const status = (recorded.status as ChequeRowStatus) || 'pending';
    return (
      <div className="bg-white border border-[#bae6fd] rounded-lg px-3 py-2 flex items-center gap-2">
        <span className="text-[10px] font-bold text-[#0369a1] w-5 shrink-0">#{seq}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-[#1a1916] truncate">{description}</p>
          <p className="text-[10px] text-[#6b6860]">
            Cheque <span className="font-semibold text-[#0369a1]">{recorded.chequeSerial}</span> ·{' '}
            <span className="font-semibold">AED {(amountFils / 100).toLocaleString('en-AE')}</span> · {dueDate}
          </p>
        </div>
        <select
          value={status}
          onChange={e => onStatusChange(e.target.value as ChequeRowStatus)}
          className={`text-[10px] font-semibold border rounded-lg px-2 py-1 cursor-pointer ${CHEQUE_STATUS_STYLE[status]}`}
        >
          {CHEQUE_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={onDelete} className="text-[#c8c6c0] hover:text-red-500 transition-colors cursor-pointer shrink-0" title="Remove this cheque record">
          <Trash2 size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#fde68a] rounded-lg px-3 py-2 flex items-center gap-2">
      <span className="text-[10px] font-bold text-[#0369a1] w-5 shrink-0">#{seq}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-[#1a1916] truncate">{description}</p>
        <p className="text-[10px] text-[#6b6860]">AED {(amountFils / 100).toLocaleString('en-AE')} · {dueDate}</p>
      </div>
      <input
        type="text"
        value={serial}
        onChange={e => { setSerial(e.target.value); onSerialChange?.(e.target.value); }}
        placeholder="Cheque #"
        className="w-40 shrink-0 text-[10px] border border-[#fde68a] rounded px-2 py-1 focus:outline-none focus:border-[#f59e0b] bg-white"
      />
      <button
        disabled={saving || !serial.trim()}
        onClick={async () => { setSaving(true); try { await onRecord(serial); setSerial(''); } finally { setSaving(false); } }}
        className="text-[10px] font-semibold px-2.5 py-1 rounded bg-[#f59e0b] text-white hover:bg-[#d97706] disabled:opacity-40 cursor-pointer shrink-0"
      >
        {saving ? '…' : 'Record'}
      </button>
    </div>
  );
}

/* ─── Lead Row ────────────────────────────────────────────────────────────── */
function LeadRow({
  lead, onMoveStage, moving, onConvert, setLeads, feeRules, preferredStartDays, allowedInstallments, manager,
  layout = 'row',
}: {
  lead: ApiLead;
  onMoveStage: (id: number, s: LeadStage) => void;
  moving: boolean;
  onConvert: (lead: ApiLead) => void;
  setLeads: React.Dispatch<React.SetStateAction<ApiLead[]>>;
  feeRules: FeeRulesMap | null;
  preferredStartDays: number[];
  allowedInstallments: number[];
  manager?: { rp: number };
  /** 'row' = full-width horizontal row (default); 'grid' = compact card for the grid view. */
  layout?: 'row' | 'grid';
}) {
  const rowRouter = useRouter();
  // Open the full Lead Detail page. RP → /rental-provider/dashboard/leads/:id;
  // manager acts on the same route with ?rp=<landlord> so leadUrl() rewrites the
  // API calls to /api/manager/leads.
  const openDetail = () =>
    rowRouter.push(manager
      ? `/dashboard/manager/leads/${lead.id}?rp=${manager.rp}`
      : `/rental-provider/dashboard/leads/${lead.id}`);
  const [panel, setPanel]             = useState<'none' | 'visited' | 'reject' | 'docs' | 'details' | 'guard' | 'plan' | 'plan_summary' | 'cheques'>('none');
  const [visitRemarks, setVisitRemarks] = useState('');
  const [markingVisit, setMarkingVisit] = useState(false);
  const [visitError, setVisitError]   = useState<string | null>(null);

  // Payment plan form state
  const _existingPlan = lead.paymentPlan;
  const _unitRentAed = lead.unit?.rentalPrice ? String(Number(lead.unit.rentalPrice)) : '';
  // Sort by updatedAt DESC so we always prefill from the viewing where preferences were last saved
  const _latestViewing = lead.viewings?.slice().sort((a, b) => {
    const at = (v: ApiViewing) => new Date(v.updatedAt ?? v.createdAt ?? v.scheduledAt).getTime();
    return at(b) - at(a);
  })[0] ?? null;
  const _defaultInstallments = _existingPlan?.installmentCount ?? _latestViewing?.preferredChequeCount ?? 4;
  const _startDateInit = _existingPlan?.items?.find(it => it.type === 'first_bundle')?.dueDate
    ?? _existingPlan?.items?.[0]?.dueDate
    ?? _latestViewing?.desiredMoveIn?.slice(0, 10) ?? '';
  // Prefill the LISTED (pre-discount) rent when editing an existing plan — the
  // discount fields below re-apply the reduction, so prefilling the net rent
  // (rentFils) would double-discount on every re-save. originalRentFils is only
  // set when a discount was applied; otherwise rentFils already IS the listed rent.
  const [planRentAed,         setPlanRentAed]         = useState<string>(_existingPlan ? String((_existingPlan.originalRentFils ?? _existingPlan.rentFils) / 100) : _unitRentAed);
  const [planInstallmentCount, setPlanInstallmentCount] = useState<number>(_defaultInstallments);
  const [planStartDate,       setPlanStartDate]       = useState<string>(_startDateInit);
  const [planAdminFeeAed,     setPlanAdminFeeAed]     = useState<string>(_existingPlan ? String(_existingPlan.adminFeeFils / 100) : '');
  const [planEjariAed,        setPlanEjariAed]        = useState<string>(_existingPlan ? String(_existingPlan.ejariFils / 100) : '');
  const [planCommissionAed,   setPlanCommissionAed]   = useState<string>(_existingPlan ? String(_existingPlan.commissionFils / 100) : '');
  const [planDepositAed,      setPlanDepositAed]      = useState<string>(_existingPlan ? String(_existingPlan.securityDepositFils / 100) : '');
  // Named dates per item kind — no positional slots.
  const _bundleDateInit = _existingPlan?.items.find(it => it.type === 'first_bundle')?.dueDate ?? '';
  const _depositDateInit = _existingPlan?.items.find(it => it.type === 'security_deposit')?.dueDate ?? '';
  // Standard installments 2..N (sorted by index so order is stable)
  const _installmentDatesInit = (_existingPlan?.items ?? [])
    .filter(it => it.type === 'installment' && it.description && /^Installment \d+$/.test(it.description))
    .sort((a, b) => {
      const n = (d?: string) => Number((d?.match(/(\d+)/) ?? [])[1] ?? 0);
      return n(a.description) - n(b.description);
    })
    .map(it => it.dueDate);
  const [planBundleDate,      setPlanBundleDate]      = useState<string>(_bundleDateInit);
  const [planDepositDate,     setPlanDepositDate]     = useState<string>(_depositDateInit);
  const [planInstallmentDates, setPlanInstallmentDates] = useState<string[]>(
    _installmentDatesInit.length === _defaultInstallments - 1
      ? _installmentDatesInit
      : Array.from({ length: Math.max(0, _defaultInstallments - 1) }, (_, i) => _installmentDatesInit[i] ?? ''),
  );
  const [planNotes, setPlanNotes] = useState(_existingPlan?.notes ?? '');
  const [planChequesPayableTo, setPlanChequesPayableTo] = useState(_existingPlan?.chequesPayableTo ?? '');
  // Hydrate Extra Installments from the existing plan (items typed 'extra_installment',
  // or legacy plans where extras live as type='installment' beyond installmentCount+1).
  const _extrasFromPlan: { description: string; amountAed: string; dueDate: string }[] = (() => {
    if (!_existingPlan?.items) return [];
    const extras = _existingPlan.items.filter(it => {
      if (it.type === 'extra_installment') return true;
      if (it.type === 'installment' && it.description && !/^Installment \d+$/.test(it.description)) return true;
      return false;
    });
    return extras.map(it => ({
      description: it.description ?? '',
      amountAed: String(it.amountFils / 100),
      dueDate: it.dueDate,
    }));
  })();
  const [planExtraItems, setPlanExtraItems] = useState<{ description: string; amountAed: string; dueDate: string }[]>(_extrasFromPlan);
  const [planDiscountType,  setPlanDiscountType]  = useState<'none' | 'percent' | 'fixed'>(_existingPlan?.discountType ?? 'none');
  const [planDiscountValue, setPlanDiscountValue] = useState<string>(
    _existingPlan?.discountType === 'percent' ? String(_existingPlan.discountPercent ?? '') :
    _existingPlan?.discountType === 'fixed'   ? String((_existingPlan.discountFils ?? 0) / 100) : '',
  );
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError]   = useState<string | null>(null);
  const [rentalIndexUrl, setRentalIndexUrl]         = useState<string>(_existingPlan?.rentalIndexReportUrl ?? '');
  const [rentalIndexUploading, setRentalIndexUploading] = useState(false);
  const [rentalIndexFileName, setRentalIndexFileName]   = useState<string>('');
  const [rentalIndexStatus, setRentalIndexStatus]       = useState<{ ok: boolean; msg: string } | null>(null);

  // Cheque collection state
  const [cheques, setCheques] = useState<LeadChequeRecord[]>([]);
  const [chequesLoaded, setChequesLoaded] = useState(false);
  const [chequesLoading, setChequesLoading] = useState(false);
  // Per-plan-item payment method + reference overrides (optimistic; PATCHed to the lead's plan).
  const [itemMethods, setItemMethods] = useState<Record<number, PaymentMethodKind>>({});
  const [itemRefs, setItemRefs] = useState<Record<number, string>>({});
  // Auto-fill suggestions: index-in-sortedItems → suggested serial (propagated when user types in any row)
  const [chequeSuggestions, setChequeSuggestions] = useState<Record<number, string>>({});
  const [chequeError, setChequeError]   = useState<string | null>(null);
  const [confirmingCollection, setConfirmingCollection] = useState(false);
  const [approvingDocs, setApprovingDocs] = useState(false);
  const [approveDocsError, setApproveDocsError] = useState<string | null>(null);
  const [tenantDocs, setTenantDocs]   = useState<TenantDoc[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  // RP uploading a KYC document on the customer's behalf (keyed by requirement).
  const [rpUploadingKey, setRpUploadingKey] = useState<string | null>(null);
  const [rpUploadError, setRpUploadError]   = useState<string | null>(null);
  const [docActioning, setDocActioning]     = useState<number | null>(null);
  const [docActionError, setDocActionError] = useState<string | null>(null);
  const [rejectingDoc, setRejectingDoc]     = useState<{ id: number; label: string } | null>(null);
  const [rejectReason, setRejectReason]     = useState('');
  const [docsNoteItems, setDocsNoteItems] = useState<string[]>(() => parseAdditionalDocs(lead.additionalDocsNote));
  const [docSearch, setDocSearch]         = useState('');
  const [docMenuOpen, setDocMenuOpen]     = useState(false);
  // Add a document (a standard one, or a typed custom name) to the request list.
  const addDocByName = (raw: string) => {
    const name = raw.trim();
    if (!name || docsNoteItems.includes(name)) return;
    setDocsNoteItems(prev => [...prev, name]);
    setDocSearch(''); setDocMenuOpen(false); setDocsNoteSaved(false);
  };
  const [docsNoteSaving, setDocsNoteSaving] = useState(false);
  const [docsNoteSaved, setDocsNoteSaved]   = useState(false);
  const [docsNoteError, setDocsNoteError]   = useState<string | null>(null);
  const [menuOpen, setMenuOpen]       = useState(false);
  const menuRef                       = useRef<HTMLDivElement>(null);

  // Guard notification state
  const [guardContact, setGuardContact] = useState('');
  const [guardMsg, setGuardMsg]       = useState('');
  const [copied, setCopied]           = useState(false);

  // Sync rentalIndexUrl when the plan's report URL changes (e.g. after a within-session save updates lead.paymentPlan)
  const _existingReportUrl = _existingPlan?.rentalIndexReportUrl;
  useEffect(() => {
    if (_existingReportUrl && !rentalIndexUrl) setRentalIndexUrl(_existingReportUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_existingReportUrl]);

  // Auto-fill "Cheques payable to" from RP profile when the plan form opens
  useEffect(() => {
    if (panel !== 'plan' || planChequesPayableTo) return;
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { profile?: { bankAccountName?: string | null; companyName?: string | null; user?: { name?: string | null } } } | null) => {
        if (!data?.profile) return;
        const p = data.profile;
        const name = p.bankAccountName?.trim() || p.companyName?.trim() || p.user?.name?.trim() || '';
        if (name) setPlanChequesPayableTo(name);
      })
      .catch(() => {/* silent — field stays blank, backend will fill from profile on submit */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const displayName  = leadDisplayName(lead);
  // On a company lead the person who called is the CONTACT, shown beside the company.
  const contactPerson = leadContactPerson(lead);
  const email        = lead.leadEmail ?? lead.convertedTenant?.user?.email ?? null;
  const phone        = lead.leadPhone ?? lead.convertedTenant?.user?.phone ?? null;
  const unitLabel    = lead.unit?.unitNumber ? `Unit ${lead.unit.unitNumber}` : (lead.unit?.unitName ?? null);
  const building     = lead.unit?.property?.buildingName ?? null;
  // Annual rent — the firm plan's rent once issued, else the unit's listed price.
  const annualRentAed = lead.paymentPlan ? Math.round(lead.paymentPlan.rentFils / 100)
    : (lead.unit?.rentalPrice != null ? Number(lead.unit.rentalPrice) : null);
  const fmtRent = (n: number) => `AED ${n.toLocaleString('en-AE')}`;
  const viewing      = getPendingViewing(lead);
  // Latest viewing by updatedAt — used for Details panel and Tenant Requested banner
  const anyViewing = lead.viewings?.slice().sort((a, b) => {
    const at = (v: ApiViewing) => new Date(v.updatedAt ?? v.createdAt ?? v.scheduledAt).getTime();
    return at(b) - at(a);
  })[0] ?? null;
  const primary     = getPrimary(lead);
  const canReject   = !['approved', 'rejected', 'converted'].includes(lead.stage);
  const canDocs     = !!lead.convertedTenant?.id &&
    (lead.viewings?.some(v => ['completed', 'no_show'].includes(v.status)) ?? false);
  const canCheques  = ['payment_plan_shared', 'cheques_submitted', 'cheques_collected', 'interested'].includes(lead.stage);
  const canEditPlan = lead.stage === 'payment_plan_shared' && !!lead.paymentPlan;

  // Timezone-safe month shift on a YYYY-MM-DD string — Date.toISOString() drops a day in UTC+ zones.
  function addMonthsToISO(dateStr: string, months: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    let newY = y;
    let newM = m + months;
    while (newM > 12) { newM -= 12; newY += 1; }
    while (newM < 1)  { newM += 12; newY -= 1; }
    const lastDay = new Date(Date.UTC(newY, newM, 0)).getUTCDate();
    const newD = Math.min(d, lastDay);
    return `${newY}-${String(newM).padStart(2, '0')}-${String(newD).padStart(2, '0')}`;
  }

  // Compute installment 2..N dates from a contract start date (length = installments - 1).
  function installmentsFromStart(startDate: string, installments: number): string[] {
    if (!startDate || installments <= 1) return Array.from({ length: Math.max(0, installments - 1) }, () => '');
    const interval = 12 / installments;
    return Array.from({ length: installments - 1 }, (_, i) => addMonthsToISO(startDate, Math.round((i + 1) * interval)));
  }

  // When the contract start date changes, seed bundle + installments from it.
  // Security deposit is intentionally NOT auto-set — the RP fills it in manually
  // (it commonly differs from the contract start, e.g. paid earlier as a reservation cheque).
  function applyStartDate(startDate: string, installments: number) {
    setPlanBundleDate(startDate);
    setPlanInstallmentDates(installmentsFromStart(startDate, installments));
  }

  // When installment count changes, resize the installment-dates array (preserve any user entries).
  function resizeInstallmentDates(installments: number) {
    if (planStartDate) {
      setPlanInstallmentDates(installmentsFromStart(planStartDate, installments));
    } else {
      setPlanInstallmentDates(prev => Array.from({ length: Math.max(0, installments - 1) }, (_, i) => prev[i] ?? ''));
    }
  }

  async function loadCheques() {
    if (chequesLoaded) return;
    setChequesLoading(true);
    try {
      const res = await fetch(leadUrl(`/api/leads/${lead.id}/cheques`, manager), { credentials: 'include' });
      if (res.ok) setCheques(await res.json());
    } finally { setChequesLoading(false); setChequesLoaded(true); }
  }

  async function handleIssuePlan() {
    const rentFils = Math.round(parseFloat(planRentAed) * 100);
    if (!planRentAed || isNaN(rentFils) || rentFils <= 0) {
      setPlanError('Enter a valid annual rent'); return;
    }
    if (!planBundleDate || !planDepositDate || planInstallmentDates.some(d => !d)) {
      setPlanError('All cheque due dates are required'); return;
    }
    const adminFeeFils        = Math.round((parseFloat(planAdminFeeAed)    || 0) * 100);
    const ejariFils           = Math.round((parseFloat(planEjariAed)       || 0) * 100);
    const commissionFils      = Math.round((parseFloat(planCommissionAed)  || 0) * 100);
    const securityDepositFils = Math.round((parseFloat(planDepositAed)     || 0) * 100);

    const validExtra = planExtraItems.filter(e => e.description.trim() && e.dueDate && parseFloat(e.amountAed) > 0);
    const extraItemsPayload = validExtra.map(e => ({
      description: e.description.trim(),
      amountFils: Math.round(parseFloat(e.amountAed) * 100),
      dueDate: e.dueDate,
    }));

    setPlanSaving(true); setPlanError(null);
    try {
      const res = await fetch(leadUrl(`/api/leads/${lead.id}/issue-payment-plan`, manager), {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentFils,
          installmentCount: planInstallmentCount,
          adminFeeFils,
          ejariFils,
          commissionFils,
          securityDepositFils,
          bundleDueDate: planBundleDate,
          depositDueDate: planDepositDate,
          installmentDueDates: planInstallmentDates,
          notes: planNotes.trim() || undefined,
          extraItems: extraItemsPayload.length ? extraItemsPayload : undefined,
          rentalIndexReportUrl: rentalIndexUrl || undefined,
          chequesPayableTo: planChequesPayableTo.trim() || undefined,
          ...(planDiscountType !== 'none' && planDiscountValue && parseFloat(planDiscountValue) > 0 && {
            discountType: planDiscountType,
            ...(planDiscountType === 'percent' ? { discountPercent: parseFloat(planDiscountValue) } : { discountFils: Math.round(parseFloat(planDiscountValue) * 100) }),
          }),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setPlanError(body.message ?? 'Failed'); return; }
      setPanel('none');
      setLeads(prev => prev.map(l =>
        l.id !== lead.id ? l : { ...l, stage: 'payment_plan_shared' as LeadStage, paymentPlan: body.paymentPlan },
      ));
    } finally { setPlanSaving(false); }
  }

  async function handleDeleteCheque(chequeId: number) {
    const res = await fetch(leadUrl(`/api/leads/${lead.id}/cheques/${chequeId}`, manager), {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) setCheques(prev => prev.filter(c => c.id !== chequeId));
  }

  async function handleApproveDocs() {
    setApprovingDocs(true); setApproveDocsError(null);
    try {
      const res = await fetch(leadUrl(`/api/leads/${lead.id}/approve-documents`, manager), {
        method: 'PATCH', credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setApproveDocsError(body.message ?? 'Failed to approve'); return; }
      // approve-documents now lands on the RP-only "approved" plan-draft stage.
      // The list keeps its one-click "approve & share" (the granular review-then-
      // share two-step lives on the lead detail page), so immediately share the
      // plan with the customer.
      const shareRes = await fetch(leadUrl(`/api/leads/${lead.id}/share-plan`, manager), {
        method: 'PATCH', credentials: 'include',
      });
      if (!shareRes.ok) {
        const sb = await shareRes.json().catch(() => ({}));
        setApproveDocsError(sb.message ?? 'Approved, but sharing the plan failed');
        setLeads(prev => prev.map(l => l.id !== lead.id ? l : { ...l, stage: 'approved' as LeadStage }));
        return;
      }
      setLeads(prev => prev.map(l =>
        l.id !== lead.id ? l : { ...l, stage: 'payment_plan_shared' as LeadStage },
      ));
    } finally { setApprovingDocs(false); }
  }

  async function handleConfirmCollected() {
    setConfirmingCollection(true); setChequeError(null);
    try {
      const res = await fetch(leadUrl(`/api/leads/${lead.id}/confirm-cheques-collected`, manager), {
        method: 'PATCH', credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setChequeError(body.message ?? 'Failed'); return; }
      setPanel('none');
      // Success ⇒ the contract auto-issued and the lead is now CONVERTED (server
      // truth). Move it straight to the Converted column.
      setLeads(prev => prev.map(l =>
        l.id !== lead.id ? l : { ...l, stage: 'converted' as LeadStage },
      ));
    } finally { setConfirmingCollection(false); }
  }

  function openPanel(p: 'visited' | 'reject' | 'docs' | 'details' | 'guard' | 'plan' | 'plan_summary' | 'cheques') {
    setPanel(prev => prev === p ? 'none' : p);
    setMenuOpen(false);
    if (p === 'plan' && !lead.paymentPlan) {
      // No existing plan — seed bundle + deposit + installments from the tenant's preferred start date
      // (planStartDate is initialised from the tenant's desiredMoveIn). Falls back to a blank resize when no date.
      if (planStartDate) applyStartDate(planStartDate, planInstallmentCount);
      else resizeInstallmentDates(planInstallmentCount);
      // Prefill fees: unit-specific values take priority over global fee rules
      const u = lead.unit;
      const hasUnitAdmin   = u?.adminFee    != null;
      const hasUnitEjari   = u?.ejariFeeFils != null;
      const hasUnitComm    = u?.commission   != null;
      const hasUnitDeposit = u?.securityDeposit != null;

      if (hasUnitAdmin)   setPlanAdminFeeAed(String(Number(u!.adminFee)));
      if (hasUnitEjari)   setPlanEjariAed(String(Number(u!.ejariFeeFils)));
      if (hasUnitComm)    setPlanCommissionAed(String(Number(u!.commission)));
      if (hasUnitDeposit) setPlanDepositAed(String(Number(u!.securityDeposit)));

      // Fill any remaining gaps from global fee rules
      if (feeRules && (!hasUnitAdmin || !hasUnitEjari || !hasUnitComm || !hasUnitDeposit)) {
        const cat   = unitSpaceCategory(lead.unit?.unitType);
        const rules = feeRules[cat] ?? feeRules['residential'] ?? [];
        const rent  = parseFloat(planRentAed) || 0;
        const find  = (ft: string) => rules.find(r => r.feeType === ft);
        if (!hasUnitAdmin)   { const r = find('admin_fee');        if (r) setPlanAdminFeeAed(feeToAed(r, rent)); }
        if (!hasUnitEjari)   { const r = find('ejari_fee');        if (r) setPlanEjariAed(feeToAed(r, rent)); }
        if (!hasUnitComm)    { const r = find('commission');       if (r) setPlanCommissionAed(feeToAed(r, rent)); }
        if (!hasUnitDeposit) { const r = find('security_deposit'); if (r) setPlanDepositAed(feeToAed(r, rent)); }
      }
    }
    if (p === 'cheques') loadCheques();
    if (p === 'guard' && viewing) {
      const unitStr = unitLabel ?? 'the unit';
      const bldgStr = building ? `, ${building}` : '';
      const timeStr = fmtDateTime(viewing.scheduledAt);
      setGuardMsg(`Hi,\n\nPlease be advised that a customer viewing has been scheduled at ${unitStr}${bldgStr} on ${timeStr}.\n\nKindly ensure you are available at the building entrance during this time to assist the customer with access to the property.\n\nThank you.`);
    }
  }

  async function saveDocsNote() {
    setDocsNoteSaving(true);
    setDocsNoteError(null);
    setDocsNoteSaved(false);
    try {
      const res = await fetch(leadUrl(`/api/leads/${lead.id}/additional-docs-note`, manager), {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: docsNoteItems }),
      });
      if (!res.ok) { setDocsNoteError('Failed to save'); return; }
      setDocsNoteSaved(true);
      setTimeout(() => setDocsNoteSaved(false), 3000);
    } catch { setDocsNoteError('Unexpected error'); }
    finally { setDocsNoteSaving(false); }
  }

  async function loadDocs() {
    if (!lead.convertedTenant?.id || tenantDocs !== null) return;
    setDocsLoading(true);
    try {
      const res = await fetch(
        `/api/documents?ownerType=customer&ownerId=${lead.convertedTenant.id}`,
        { credentials: 'include' },
      );
      if (res.ok) setTenantDocs(await res.json());
    } finally { setDocsLoading(false); }
  }

  useEffect(() => {
    if (panel === 'docs') loadDocs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  async function handleApproveDoc(docId: number) {
    setDocActioning(docId); setDocActionError(null);
    try {
      const res = await fetch(`/api/documents/${docId}/verify`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { setDocActionError('Failed to approve'); return; }
      setTenantDocs(prev => prev ? prev.map(d => d.id === docId ? { ...d, status: 'processed' } : d) : null);
    } finally { setDocActioning(null); }
  }

  async function handleRejectDoc(docId: number, reason?: string) {
    setDocActioning(docId); setDocActionError(null);
    try {
      const res = await fetch(`/api/documents/${docId}/reject`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      if (!res.ok) { setDocActionError('Failed to reject'); return; }
      setTenantDocs(prev => prev ? prev.map(d => d.id === docId ? { ...d, status: 'rejected' } : d) : null);
    } finally { setDocActioning(null); }
  }

  // Refetch docs bypassing loadDocs's "already loaded" guard — used after an
  // RP-side upload so the new file + recomputed checklist re-render. (loadDocs
  // early-returns when tenantDocs !== null via a stale closure, so it can't.)
  async function refetchDocs() {
    if (!lead.convertedTenant?.id) return;
    const res = await fetch(`/api/documents?ownerType=customer&ownerId=${lead.convertedTenant.id}`, { credentials: 'include' });
    if (res.ok) setTenantDocs(await res.json());
  }

  // RP uploads a required document on the customer's behalf. Written under the
  // customer owner (the same key the panel lists with) — the backend authorizes
  // the RP via the lead relationship and auto-verifies RP/manager uploads.
  async function handleRpUpload(req: { key: string; label: string; category: string }, file: File) {
    const ownerId = lead.convertedTenant?.id;
    if (!ownerId) { setRpUploadError('Convert the lead to a customer first.'); return; }
    setRpUploadingKey(req.key); setRpUploadError(null);
    try {
      const existing = (tenantDocs ?? []).find(d => d.documentKey === req.key);
      await putKycSlot({
        ownerType: 'customer', ownerId,
        canonicalKey: req.key, category: req.category, displayName: req.label,
        file, existingDocId: existing?.id ?? null, existingKey: existing?.documentKey ?? null,
      });
      await refetchDocs();
    } catch (e) {
      setRpUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setRpUploadingKey(null); }
  }

  async function handleMarkVisited() {
    if (!viewing) return;
    setMarkingVisit(true); setVisitError(null);
    try {
      const res = await fetch(leadUrl(`/api/leads/viewings/${viewing.id}/status`, manager), {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', outcome: visitRemarks.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setVisitError(body.message ?? 'Failed'); return; }
      setPanel('none'); setVisitRemarks('');
      setLeads(prev => prev.map(l =>
        l.id !== lead.id ? l : {
          ...l,
          viewings: l.viewings?.map(v =>
            v.id === viewing.id ? { ...v, status: 'completed' } : v,
          ),
        },
      ));
    } finally { setMarkingVisit(false); }
  }

  function handlePrimary() {
    if (!primary) return;
    if (primary.kind === 'stage') { onMoveStage(lead.id, primary.target); return; }
    if (primary.kind === 'convert') { onConvert(lead); return; }
    if (primary.kind === 'mark_visited') { openPanel('visited'); return; }
    // Show the customer's documents first; the actual approve happens from the
    // "Approve Documents" button inside the docs panel (no more blind one-click).
    if (primary.kind === 'approve_docs') { openPanel('docs'); return; }
    if (primary.kind === 'record_cheques') { openPanel('cheques'); return; }
    if (primary.kind === 'confirm_collected') { handleConfirmCollected(); return; }
  }

  // Action cluster — Details · docs badge · primary CTA · ··· menu. Shared
  // verbatim by the row layout and the grid card so behaviour is identical.

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); } }}
      className="bg-white rounded-xl border border-[#ede9e3] cursor-pointer transition-colors hover:border-[#2e9f82]/50 hover:bg-[#fafdfb] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
    >

      {layout === 'grid' ? (
        /* ── Grid card ── */
        <div className="p-4 flex flex-col h-full">
          {/* Identity + stage */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: '#2e9f82' }}>
              {initials(displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#1a1916] truncate">{displayName}</p>
              <p className="text-xs text-[#9b9890] truncate mt-0.5">
                {contactPerson ? `${contactPerson} · ` : ''}{email ?? 'No email'}{phone ? ` · ${phone}` : ''}
              </p>
            </div>
            <span className={`inline-flex items-center rounded-full text-[11px] font-semibold px-2.5 py-1 shrink-0 ${STAGE_PILL[lead.stage]}`}>
              {STAGE_LABELS[lead.stage]}
            </span>
          </div>

          {/* Key facts */}
          <div className="mt-3.5 pt-3.5 border-t border-[#f4f3ef] space-y-2 text-xs">
            <div className="flex items-center gap-2 text-[#3d3b35] min-w-0">
              <Building2 size={13} className="text-[#c8c6c0] shrink-0" />
              <span className="truncate">{unitLabel ? `${unitLabel}${building ? ` · ${building}` : ''}` : 'No unit assigned'}</span>
            </div>
            <div className="flex items-center gap-2">
              {viewing ? (
                <>
                  <Clock size={13} className={`shrink-0 ${new Date(viewing.scheduledAt) <= new Date() ? 'text-amber-500' : 'text-[#c8c6c0]'}`} />
                  <span className={new Date(viewing.scheduledAt) <= new Date() ? 'text-amber-600 font-medium' : 'text-[#6b6860]'}>{fmtDateTime(viewing.scheduledAt)}</span>
                </>
              ) : (
                <>
                  <Calendar size={13} className="text-[#c8c6c0] shrink-0" />
                  <span className="text-[#9b9890]">Added {fmtDate(lead.createdAt)}</span>
                </>
              )}
            </div>
            {annualRentAed != null && (
              <div className="flex items-center gap-2">
                <CreditCard size={13} className="text-[#c8c6c0] shrink-0" />
                <span className="font-semibold text-[#1a1916] tabular-nums">{fmtRent(annualRentAed)}</span>
                <span className="text-[#9b9890]">/ yr</span>
              </div>
            )}
          </div>

          {/* Urgency / decline */}
          {(() => {
            const u = getUrgency(lead);
            return u ? (
              <p className={`inline-flex items-center gap-1 rounded-full text-[10px] font-semibold px-1.5 py-0.5 mt-2.5 max-w-full ${URGENCY_PILL[u.level]}`} title={u.label}>
                <Clock size={9} className="shrink-0" /><span className="truncate">{u.label}</span>
              </p>
            ) : null;
          })()}
          {lead.stage === 'rejected' && anyViewing?.status === 'cancelled' && anyViewing?.outcome === 'not_interested' && (
            <p className="text-[10px] text-[#b91c1c] truncate mt-1.5" title={anyViewing.declineNote?.trim() ? anyViewing.declineNote : 'Customer declined'}>
              {anyViewing.declineNote?.trim() ? anyViewing.declineNote : 'Customer declined'}
            </p>
          )}

          {/* Footer pinned to the bottom so cards in a row align */}
          <div className="mt-auto pt-3 flex items-center justify-end">
            <span className="text-xs font-semibold text-[#2e9f82] inline-flex items-center gap-1">Open <ArrowRight size={12} /></span>
          </div>
        </div>
      ) : (
      /* ── Single row (responsive columns; no horizontal scroll) ── */
      <div className="flex items-center gap-4 px-5 py-3.5">

        {/* Avatar */}
        <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: '#2e9f82' }}>
          {initials(displayName)}
        </div>

        {/* Customer */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1a1916] truncate">{displayName}</p>
          <p className="text-xs text-[#9b9890] truncate mt-0.5">
            {contactPerson ? `${contactPerson} · ` : ''}{email ?? 'No email'}{phone ? ` · ${phone}` : ''}
          </p>
        </div>

        {/* Property */}
        <div className="min-w-0 flex-1 hidden md:block">
          {unitLabel ? (
            <>
              <p className="text-sm text-[#1a1916] font-medium truncate flex items-center gap-1.5">
                <Building2 size={12} className="text-[#c8c6c0] shrink-0" />{unitLabel}
              </p>
              {building && <p className="text-xs text-[#9b9890] truncate pl-[19px]">{building}</p>}
            </>
          ) : (
            <span className="text-xs text-[#c8c6c0]">No unit</span>
          )}
        </div>

        {/* Stage + urgency */}
        <div className="shrink-0 w-[128px]">
          <span className={`inline-flex items-center rounded-full text-[11px] font-semibold px-2.5 py-1 ${STAGE_PILL[lead.stage]}`}>
            {STAGE_LABELS[lead.stage]}
          </span>
          {(() => {
            const u = getUrgency(lead);
            return u ? (
              <p className={`flex items-center gap-1 rounded-full text-[10px] font-semibold px-1.5 py-0.5 mt-1 max-w-full ${URGENCY_PILL[u.level]}`} title={u.label}>
                <Clock size={9} className="shrink-0" /><span className="truncate">{u.label}</span>
              </p>
            ) : null;
          })()}
          {lead.stage === 'rejected' && anyViewing?.status === 'cancelled' && anyViewing?.outcome === 'not_interested' && (
            <p className="text-[10px] text-[#b91c1c] truncate mt-1" title={anyViewing.declineNote?.trim() ? anyViewing.declineNote : 'Customer declined'}>
              {anyViewing.declineNote?.trim() ? anyViewing.declineNote : 'Customer declined'}
            </p>
          )}
        </div>

        {/* Date */}
        <div className="shrink-0 w-[136px] hidden lg:block">
          {viewing ? (
            <div className={`flex items-center gap-1.5 text-xs font-medium ${new Date(viewing.scheduledAt) <= new Date() ? 'text-amber-600' : 'text-[#6b6860]'}`}>
              <Clock size={12} className="shrink-0" />{fmtDateTime(viewing.scheduledAt)}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-[#9b9890]">
              <Calendar size={12} className="shrink-0" />{fmtDate(lead.createdAt)}
            </div>
          )}
        </div>

        {/* Rent */}
        <div className="shrink-0 w-[104px] text-right hidden lg:block">
          {annualRentAed != null ? (
            <>
              <p className="text-sm font-semibold text-[#1a1916] tabular-nums leading-tight">{fmtRent(annualRentAed)}</p>
              <p className="text-[10px] text-[#9b9890]">per year</p>
            </>
          ) : (
            <span className="text-xs text-[#c8c6c0]">—</span>
          )}
        </div>

        {/* Open */}
        <div className="shrink-0 pl-1">
          <span className="text-xs font-semibold text-[#2e9f82] inline-flex items-center gap-1 whitespace-nowrap">Open <ArrowRight size={13} /></span>
        </div>
      </div>
      )}


    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
/**
 * Leads pipeline workspace. Used by the RP portal (default export below) and the
 * Manager portal (rendered with `manager={{ rp }}`), which swaps every action to
 * the landlord-scoped /api/manager/leads/* endpoints via leadUrl().
 */
/**
 * `canCreateLeads` gates the "Add Lead" affordance. The RP owns their pipeline,
 * so the RP route passes nothing and gets it; a manager only gets it when the
 * landlord granted them "Add new leads" (per-landlord — see migration 0165).
 */
export function LeadsWorkspace({ manager, canCreateLeads = true }: { manager?: { rp: number }; canCreateLeads?: boolean }) {
  const router = useRouter();
  const [leads, setLeads]           = useState<ApiLead[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [activeTab, setActiveTab]   = useState<'all' | LeadStage>('all');
  const [view, setView]             = useState<'row' | 'grid' | 'calendar'>('row');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [movingLead, setMovingLead] = useState<number | null>(null);
  const [feeRules, setFeeRules]         = useState<FeeRulesMap | null>(null);
  const [preferredStartDays, setPreferredStartDays] = useState<number[]>([]);
  // Installment plans this RP offers (Settings → Rules). Empty = all allowed.
  const [allowedInstallments, setAllowedInstallments] = useState<number[]>([]);
  // "Add lead" — enquiries that came in off-platform (walk-in, call, WhatsApp).
  const [addingLead, setAddingLead] = useState(false);
  const createdLeadRef = useRef<number | null>(null);

  const openLead = useCallback((id: number) => {
    router.push(manager ? `/dashboard/manager/leads/${id}?rp=${manager.rp}` : `/rental-provider/dashboard/leads/${id}`);
  }, [router, manager]);

  const fetchLeads = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(leadUrl('/api/leads', manager), { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load leads (${res.status})`);
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // Re-fetch when the tab regains focus so RP always sees tenant's latest
  // submission — but throttled (≤ once / 10s) and only when actually visible,
  // so rapid focus/blur churn doesn't hammer /api/leads. Seeded to "now" so it
  // won't fire right on top of the initial mount fetch.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 10_000) return;
      last = Date.now();
      fetchLeads();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchLeads]);

  useEffect(() => {
    fetch('/api/fee-rules', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: FeeRulesMap | null) => { if (data) setFeeRules(data); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { profile?: { preferredStartDays?: number[] | null; allowedInstallments?: number[] | null } } | null) => {
        if (Array.isArray(data?.profile?.preferredStartDays)) {
          setPreferredStartDays(data!.profile!.preferredStartDays!);
        }
        if (Array.isArray(data?.profile?.allowedInstallments)) {
          setAllowedInstallments(data!.profile!.allowedInstallments!);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => { setSearch(''); }, [activeTab]);

  // Needs-attention triage (derived client-side; see getUrgency)
  const urgentLeads = leads.filter(l => getUrgency(l) !== null);
  const urgencySummary = (() => {
    const byStage = new Map<LeadStage, number>();
    urgentLeads.forEach(l => byStage.set(l.stage, (byStage.get(l.stage) ?? 0) + 1));
    return [...byStage.entries()]
      .map(([s, n]) => { const p = URGENCY_PHRASE[s]; return p ? `${n} ${n === 1 ? p[0] : p[1]}` : null; })
      .filter(Boolean)
      .join(' · ');
  })();
  // If the last urgent lead is resolved while the urgent-only filter is on,
  // the banner (and its toggle) disappears — release the filter with it.
  const urgentCount = urgentLeads.length;
  useEffect(() => { if (urgentOnly && urgentCount === 0) setUrgentOnly(false); }, [urgentOnly, urgentCount]);

  async function moveStage(leadId: number, stage: LeadStage) {
    setMovingLead(leadId);
    try {
      await fetch(leadUrl(`/api/leads/${leadId}/stage`, manager), {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage } : l));
    } finally { setMovingLead(null); }
  }

  function handleConvert(lead: ApiLead) {
    const name = encodeURIComponent(leadDisplayName(lead) ?? '');
    // Prefer the payment plan's first_bundle date (the agreed start date) over the
    // tenant's original desiredMoveIn (just their initial preference at viewing time).
    const planStart = lead.paymentPlan?.items?.find(it => it.type === 'first_bundle')?.dueDate
      ?? lead.paymentPlan?.items?.slice().sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]?.dueDate;
    const startDate = planStart ?? lead.viewings?.find(v => v.desiredMoveIn)?.desiredMoveIn ?? '';
    const startParam  = startDate ? `&startDate=${startDate}` : '';
    const chequeParam = lead.paymentPlan?.chequeCount ? `&chequeCount=${lead.paymentPlan.chequeCount}` : '';
    router.push(
      manager
        ? `/dashboard/manager/contracts?rp=${manager.rp}`
        : `/rental-provider/dashboard/contracts/new?unitId=${lead.unit?.id}&tenantId=${lead.convertedTenant?.id}&leadId=${lead.id}&tenantName=${name}${startParam}${chequeParam}`,
    );
  }

  const tabCount = (key: 'all' | LeadStage) =>
    key === 'all' ? leads.length : leads.filter(l => l.stage === key).length;

  const filtered = leads.filter(l => {
    if (urgentOnly && !getUrgency(l)) return false;
    if (activeTab !== 'all' && l.stage !== activeTab) return false;
    if (search) {
      const q    = search.toLowerCase();
      // Search matches the company AND the person who called for a company lead.
      const name = `${leadDisplayName(l)} ${leadContactPerson(l) ?? ''}`.toLowerCase();
      const unit = (l.unit?.unitName ?? l.unit?.unitNumber ?? '').toLowerCase();
      const bldg = (l.unit?.property?.buildingName ?? '').toLowerCase();
      const eml  = (l.leadEmail ?? l.convertedTenant?.user?.email ?? '').toLowerCase();
      const ph   = (l.leadPhone ?? '').toLowerCase();
      if (![name, unit, bldg, eml, ph].some(f => f.includes(q))) return false;
    }
    return true;
  });

  return (
    <div className="p-5 sm:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Leads</h1>
          <p className="text-sm text-[#9b9890] mt-0.5">
            {leads.length} lead{leads.length !== 1 ? 's' : ''} in pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="inline-flex bg-[#f4f3ef] rounded-lg p-0.5 border border-[#e8e6e0]">
            <button
              onClick={() => setView('row')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                view === 'row' ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860] hover:text-[#1a1916]'
              }`}
            >
              <LayoutList size={12} /> Row
            </button>
            <button
              onClick={() => setView('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                view === 'grid' ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860] hover:text-[#1a1916]'
              }`}
            >
              <LayoutGrid size={12} /> Grid
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                view === 'calendar' ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860] hover:text-[#1a1916]'
              }`}
            >
              <Calendar size={12} /> Calendar
            </button>
          </div>
          <button
            onClick={fetchLeads}
            disabled={loading}
            className="flex items-center gap-2 text-sm text-[#2e9f82] border border-[#2e9f82] rounded-lg px-4 py-2 hover:bg-[#f0fdf4] transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {canCreateLeads && (
            <button
              onClick={() => setAddingLead(true)}
              className="flex items-center gap-2 text-sm font-semibold text-white bg-[#2e9f82] rounded-lg px-4 py-2 hover:bg-[#27856d] transition-colors cursor-pointer"
            >
              <Plus size={14} /> Add Lead
            </button>
          )}
        </div>
      </div>

      {/* Stage filter + search are SHARED across all three views (Row · Grid ·
          Calendar) so switching views keeps the same filter/search context; only
          the body (further below) differs. */}
      {/* Pipeline strip — every stage (plus All) on a SINGLE line in one
          bordered card; columns flex to fit so there is no horizontal scroll.
          Always shown once loaded (even at zero leads). Doubles as the stage
          filter: click a column to filter, click again / click All to clear. */}
      {!loading && (
        <div className="bg-white rounded-xl border border-[#e8e6e0] shadow-sm mb-6 flex items-stretch divide-x divide-[#f0ede8] overflow-hidden">
          {([['all', 'All'], ...FUNNEL_COLS] as ['all' | LeadStage, string][]).map(([s, label]) => {
            const n = tabCount(s);
            const isActive = activeTab === s;
            return (
              <button
                key={s}
                onClick={() => setActiveTab(isActive ? 'all' : s)}
                className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-2 py-3 text-center transition-colors cursor-pointer ${
                  isActive ? 'bg-[#f5fdf9]' : 'hover:bg-[#fafaf8]'
                }`}
              >
                <span className={`text-[10px] font-semibold uppercase tracking-[0.05em] truncate max-w-full ${
                  isActive ? 'text-[#2e9f82]' : 'text-[#9b9890]'
                }`}>
                  {label}
                </span>
                <span className={`text-lg font-bold leading-none tabular-nums ${
                  n > 0 ? 'text-[#1a1916]' : 'text-[#c8c6c0]'
                }`}>
                  {n}
                </span>
                {isActive && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#2e9f82]" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Needs-action banner — leads whose viewing passed without an outcome,
          or whose stage idled past its follow-up window. [Show] filters to
          just those; default list order is never changed. */}
      {!loading && urgentLeads.length > 0 && (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
          <ShieldAlert size={16} className="text-[#d97706] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#92400e]">
              {urgentLeads.length} lead{urgentLeads.length !== 1 ? 's' : ''} need{urgentLeads.length === 1 ? 's' : ''} action
            </p>
            {urgencySummary && <p className="text-xs text-[#b45309] truncate">{urgencySummary}</p>}
          </div>
          <button
            onClick={() => { if (!urgentOnly) setActiveTab('all'); setUrgentOnly(o => !o); }}
            className={`text-xs font-semibold rounded-lg px-3 py-1.5 cursor-pointer transition-colors shrink-0 ${
              urgentOnly
                ? 'bg-[#92400e] text-white'
                : 'bg-white border border-[#fde68a] text-[#92400e] hover:bg-[#fef3c7]'
            }`}
          >
            {urgentOnly ? 'Show all' : 'Show'}
          </button>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8c6c0]" />
          <input
            type="text"
            placeholder="Search name, email, phone, unit…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82] bg-white"
          />
        </div>
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-xs text-[#9b9890] hover:text-[#3d3b35] flex items-center gap-1 cursor-pointer"
          >
            <X size={12} /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-[#9b9890]">
          {!loading && `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl h-16 animate-pulse border border-[#ede9e3]" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && leads.length === 0 && (
        <div className="bg-white rounded-xl p-14 flex flex-col items-center text-center border border-[#ede9e3]">
          <div className="w-12 h-12 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-3">
            <User size={22} className="text-[#2e9f82]" />
          </div>
          <p className="font-semibold text-[#1a1916] text-sm mb-1">No leads yet</p>
          <p className="text-xs text-[#9b9890]">
            {canCreateLeads
              ? 'Leads appear when customers book viewings on your units — or add one yourself for a walk-in or phone enquiry.'
              : 'Leads appear when customers book viewings on your units.'}
          </p>
          {canCreateLeads && (
            <button
              onClick={() => setAddingLead(true)}
              className="mt-4 flex items-center gap-2 text-sm font-semibold text-white bg-[#2e9f82] rounded-lg px-4 py-2 hover:bg-[#27856d] transition-colors cursor-pointer"
            >
              <Plus size={14} /> Add Lead
            </button>
          )}
        </div>
      )}

      {view !== 'calendar' && !loading && leads.length > 0 && filtered.length === 0 && (
        <div className="bg-white rounded-xl p-10 flex flex-col items-center text-center border border-[#ede9e3]">
          <p className="text-sm text-[#9b9890]">No leads match your search.</p>
          <button onClick={() => setSearch('')} className="mt-2 text-xs text-[#2e9f82] hover:underline cursor-pointer">Clear</button>
        </div>
      )}

      {/* View body — Calendar, or the Row/Grid list. All three respect the stage
          filter + search chrome above. */}
      {view === 'calendar' ? (
        !loading && leads.length > 0 && (
          <LeadsCalendarView leads={filtered} onOpenLead={openLead} />
        )
      ) : (
        !loading && filtered.length > 0 && (
          <div className={view === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4' : 'space-y-2'}>
            {filtered.map(lead => (
              <div key={`${lead.id}-${lead.updatedAt}`} id={`lead-${lead.id}`}>
                <LeadRow
                  lead={lead}
                  onMoveStage={moveStage}
                  moving={movingLead === lead.id}
                  onConvert={handleConvert}
                  setLeads={setLeads}
                  feeRules={feeRules}
                  preferredStartDays={preferredStartDays}
                  allowedInstallments={allowedInstallments}
                  manager={manager}
                  layout={view === 'grid' ? 'grid' : 'row'}
                />
              </div>
            ))}
          </div>
        )
      )}

      {addingLead && canCreateLeads && (
        <NewLeadModal
          manager={manager}
          preferredStartDays={preferredStartDays}
          allowedInstallments={allowedInstallments}
          // Navigate on CLOSE, not on create: the overlay closes through
          // history.back() (see useBackClose), which would undo a router.push
          // fired in the same tick. The id is parked until the overlay is gone.
          onClose={() => {
            setAddingLead(false);
            const id = createdLeadRef.current;
            createdLeadRef.current = null;
            if (id) openLead(id);
          }}
          onCreated={(leadId) => { createdLeadRef.current = leadId; fetchLeads(); }}
        />
      )}
    </div>
  );
}

// RP portal route — the workspace with the default (RP-scoped) API.
export default function LeadsPage() {
  return <LeadsWorkspace />;
}
