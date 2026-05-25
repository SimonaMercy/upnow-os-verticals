'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, X, RefreshCw, Phone, Mail, Building2,
  Clock, CheckCircle2, MessageSquare, User, Calendar,
  FileText, ExternalLink, Loader2, MoreVertical, ArrowRight,
  StickyNote, ShieldAlert, Copy, Check, CreditCard, Plus, Trash2,
  ClipboardList, BadgeCheck, Printer, Eye, ZoomIn,
} from 'lucide-react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import { toast } from 'sonner';
import { PreferredDayPicker } from '@/components/PreferredDayPicker';

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
  | 'cheques_submitted' | 'cheques_collected' | 'contract_issued'
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
  cheques_submitted:    'Cheques Ready',
  cheques_collected:    'Cheques Collected',
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
  cheques_submitted:    'bg-[#fef9c3] text-[#854d0e]',
  cheques_collected:    'bg-[#d8f2e8] text-[#1a7a5a]',
  contract_issued:      'bg-[#d1fae5] text-[#065f46]',
  rejected:             'bg-[#fee2e2] text-[#b91c1c]',
  converted:            'bg-[#e0f2fe] text-[#0369a1]',
};

const TABS: { key: 'all' | LeadStage; label: string }[] = [
  { key: 'all',                  label: 'All' },
  { key: 'new',                  label: 'New' },
  { key: 'contacted',            label: 'Contacted' },
  { key: 'viewing_scheduled',    label: 'Viewing' },
  { key: 'documents_collection', label: 'Docs' },
  { key: 'payment_plan_shared',  label: 'Plan Shared' },
  { key: 'cheques_submitted',    label: 'Cheques Ready' },
  { key: 'cheques_collected',    label: 'Collected' },
  { key: 'contract_issued',      label: 'Contract' },
  { key: 'approved',             label: 'Approved' },
  { key: 'rejected',             label: 'Rejected' },
  { key: 'converted',            label: 'Converted' },
];

interface ApiViewing {
  id: number;
  scheduledAt: string;
  createdAt?: string;
  updatedAt?: string;
  status: string;
  desiredMoveIn?: string | null;
  notes?: string | null;
  outcome?: string | null;
  preferredChequeCount?: number | null;
  paymentType?: string | null;
}

interface PaymentPlanItem {
  index: number;
  amountFils: number;
  dueDate: string;
  description?: string;
  type?: 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
}

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
  items: PaymentPlanItem[];
  notes?: string;
  rentalIndexReportUrl?: string;
  chequesPayableTo?: string;
  issuedAt: string;
}

interface LeadChequeRecord {
  id: number;
  chequeSerial: string;
  bankName: string;
  amountFils: number;
  dueDate: string;
  status: string;
  notes?: string | null;
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
}

type TenantDoc = {
  id: number; documentKey: string; displayName: string | null;
  fileUrl: string; mimeType: string | null; status: string;
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai',
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });
}

function getPendingViewing(lead: ApiLead) {
  return (
    lead.viewings
      ?.filter(v => v.status === 'scheduled' || v.status === 'confirmed')
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0] ?? null
  );
}

/* ─── Primary action per stage ────────────────────────────────────────────── */
type PrimaryAction =
  | { kind: 'stage'; label: string; target: LeadStage; cls: string }
  | { kind: 'mark_visited'; label: string; cls: string }
  | { kind: 'issue_plan'; label: string; cls: string }
  | { kind: 'record_cheques'; label: string; cls: string }
  | { kind: 'confirm_collected'; label: string; cls: string }
  | { kind: 'convert'; label: string; cls: string };

function getPrimary(lead: ApiLead): PrimaryAction | null {
  const viewing = getPendingViewing(lead);

  switch (lead.stage) {
    case 'new':
      return { kind: 'stage', label: 'Mark Contacted', target: 'contacted',
        cls: 'bg-[#eef2ff] text-[#4338ca] hover:bg-[#e0e7ff]' };
    case 'contacted':
      return { kind: 'stage', label: 'Viewing Booked', target: 'viewing_scheduled',
        cls: 'bg-[#fef3c7] text-[#92400e] hover:bg-[#fde68a]' };
    case 'viewing_scheduled':
      return viewing
        ? { kind: 'mark_visited', label: 'Mark Visited', cls: 'bg-[#d8f2e8] text-[#1a7a5a] hover:bg-[#bbf0d8]' }
        : null;
    // Legacy stages
    case 'applied':
      return { kind: 'stage', label: 'Send Offer', target: 'offer_made',
        cls: 'bg-[#fce7f3] text-[#9d174d] hover:bg-[#fbcfe8]' };
    case 'offer_made':
      return { kind: 'stage', label: 'Approve', target: 'approved',
        cls: 'bg-[#d1fae5] text-[#065f46] hover:bg-[#a7f3d0]' };
    case 'approved':
      return lead.unit?.id && lead.convertedTenant?.id
        ? { kind: 'convert', label: 'Convert', cls: 'bg-[#2e9f82] text-white hover:bg-[#1f6655]' }
        : null;
    // New pipeline stages
    case 'documents_collection':
      return { kind: 'issue_plan', label: 'Issue Payment Plan',
        cls: 'bg-[#f0f9ff] text-[#0369a1] hover:bg-[#e0f2fe]' };
    case 'payment_plan_shared':
      return null; // waiting for tenant to confirm cheques ready
    case 'cheques_submitted':
      return { kind: 'record_cheques', label: 'Record Cheques',
        cls: 'bg-[#fef9c3] text-[#854d0e] hover:bg-[#fef08a]' };
    case 'cheques_collected':
      return lead.unit?.id && lead.convertedTenant?.id
        ? { kind: 'convert', label: 'Issue Contract', cls: 'bg-[#2e9f82] text-white hover:bg-[#1f6655]' }
        : null;
    case 'contract_issued':
      return lead.unit?.id && lead.convertedTenant?.id
        ? { kind: 'convert', label: 'Convert', cls: 'bg-[#2e9f82] text-white hover:bg-[#1f6655]' }
        : null;
    case 'rejected':
      return { kind: 'stage', label: 'Reopen', target: 'new',
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
  lead, onMoveStage, moving, onConvert, setLeads, feeRules, preferredStartDays,
}: {
  lead: ApiLead;
  onMoveStage: (id: number, s: LeadStage) => void;
  moving: boolean;
  onConvert: (lead: ApiLead) => void;
  setLeads: React.Dispatch<React.SetStateAction<ApiLead[]>>;
  feeRules: FeeRulesMap | null;
  preferredStartDays: number[];
}) {
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
  const [planRentAed,         setPlanRentAed]         = useState<string>(_existingPlan ? String(_existingPlan.rentFils / 100) : _unitRentAed);
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
  // Auto-fill suggestions: index-in-sortedItems → suggested serial (propagated when user types in any row)
  const [chequeSuggestions, setChequeSuggestions] = useState<Record<number, string>>({});
  const [chequeError, setChequeError]   = useState<string | null>(null);
  const [confirmingCollection, setConfirmingCollection] = useState(false);
  const [tenantDocs, setTenantDocs]   = useState<TenantDoc[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [viewAllOpen, setViewAllOpen]   = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [docActioning, setDocActioning]     = useState<number | null>(null);
  const [docActionError, setDocActionError] = useState<string | null>(null);
  const [rejectingDoc, setRejectingDoc]     = useState<{ id: number; label: string } | null>(null);
  const [rejectReason, setRejectReason]     = useState('');
  const [docsNoteItems, setDocsNoteItems] = useState<string[]>(() => {
    try { const p = JSON.parse(lead.additionalDocsNote ?? ''); return Array.isArray(p) ? p : []; }
    catch { return []; }
  });
  const [newDocItem, setNewDocItem]       = useState('');
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

  const displayName  = lead.convertedTenant?.user?.name ?? lead.customerName;
  const email        = lead.leadEmail ?? lead.convertedTenant?.user?.email ?? null;
  const phone        = lead.leadPhone ?? lead.convertedTenant?.user?.phone ?? null;
  const unitLabel    = lead.unit?.unitName ?? (lead.unit ? `Unit ${lead.unit.unitNumber}` : null);
  const building     = lead.unit?.property?.buildingName ?? null;
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
  const canCheques  = ['payment_plan_shared', 'cheques_submitted', 'cheques_collected'].includes(lead.stage) && !!lead.paymentPlan;
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

  // Open a print-preview popup that mirrors what the tenant sees — RP can verify or hand over to print.
  function handlePreviewPlan() {
    const plan = lead.paymentPlan;
    if (!plan) return;
    const sorted = plan.items.slice().sort((a, b) => {
      if (a.dueDate !== b.dueDate) return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
      const order: Record<string, number> = { first_bundle: 0, installment: 1, extra_installment: 2, security_deposit: 3 };
      return (order[a.type ?? 'installment'] ?? 1) - (order[b.type ?? 'installment'] ?? 1);
    });
    const firstDate = sorted[0]?.dueDate ?? null;
    const endDate = firstDate ? (() => {
      const d = new Date(firstDate + 'T00:00:00');
      d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })() : null;
    const fmtD = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const aed = (fils: number) => `AED ${(fils / 100).toLocaleString('en-AE')}`;
    const tenantName = lead.convertedTenant?.user?.name?.trim() || '—';
    const buildingName = lead.unit?.property?.buildingName ?? '—';
    const unitNo = lead.unit?.unitNumber ?? '—';
    const rows = sorted.map((it, i) => `<tr><td>#${i + 1}</td><td>${(it.description ?? '').replace(/</g, '&lt;')}</td><td style="text-align:right">${aed(it.amountFils)}</td><td>${it.dueDate}</td></tr>`).join('');
    const discountLine = plan.originalRentFils
      ? `<div class="l">Annual Rent</div><div class="v"><span style="text-decoration:line-through;color:#9b9890">${aed(plan.originalRentFils)}</span> → ${aed(plan.rentFils)} ${plan.discountType === 'percent' ? `(${plan.discountPercent}% discount)` : `(${aed(plan.discountFils ?? 0)} discount)`}</div>`
      : `<div class="l">Annual Rent</div><div class="v">${aed(plan.rentFils)}</div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Payment Plan Preview — ${buildingName}</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1916;padding:32px;max-width:780px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;margin:24px 0 8px;color:#0369a1;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e0f2fe;padding-bottom:4px}
.sub{font-size:11px;color:#6b6860;margin-bottom:16px}
.grid{display:grid;grid-template-columns:180px 1fr;gap:6px 16px;font-size:12px;margin-bottom:8px}
.grid .l{color:#9b9890;text-transform:uppercase;font-size:10px;letter-spacing:.05em;padding-top:2px}
.grid .v{color:#1a1916;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e8e6e0}
th{background:#f4f3ef;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b6860}
tfoot td{font-weight:700;background:#f0f9ff;color:#0369a1;border-top:2px solid #bae6fd}
.footer{margin-top:32px;font-size:10px;color:#9b9890;text-align:center;border-top:1px solid #e8e6e0;padding-top:12px}
@media print{body{padding:16px}.noprint{display:none}}
.btnrow{margin:0 0 24px;display:flex;gap:8px}
.btn{display:inline-block;padding:8px 14px;background:#2e9f82;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer}
.btn.alt{background:#f4f3ef;color:#3d3b35}
</style></head>
<body>
<div class="btnrow noprint"><button class="btn" onclick="window.print()">Print / Save as PDF</button><button class="btn alt" onclick="window.close()">Close</button></div>
<h1>Payment Plan — Customer Preview</h1>
<p class="sub">${buildingName} · Issued ${plan.issuedAt ? new Date(plan.issuedAt).toLocaleDateString('en-AE',{day:'numeric',month:'short',year:'numeric'}) : '—'}</p>
<h2>Contract &amp; Cheque Details</h2>
<div class="grid">
  <div class="l">Cheque Drawer (Tenant)</div><div class="v">${tenantName}</div>
  <div class="l">Building</div><div class="v">${buildingName}</div>
  <div class="l">Unit No.</div><div class="v">${unitNo}</div>
  <div class="l">Contract Period</div><div class="v">${fmtD(firstDate)} → ${fmtD(endDate)} (12 months)</div>
  <div class="l">Contract Value</div><div class="v">${aed(plan.totalAmountFils)}</div>
</div>
<h2>Rent &amp; Fees</h2>
<div class="grid">
  ${discountLine}
  <div class="l">Security Deposit</div><div class="v">${aed(plan.securityDepositFils)}</div>
  ${plan.adminFeeFils ? `<div class="l">Admin Fee</div><div class="v">${aed(plan.adminFeeFils)}</div>` : ''}
  ${plan.ejariFils ? `<div class="l">Ejari Fee</div><div class="v">${aed(plan.ejariFils)}</div>` : ''}
  ${plan.commissionFils ? `<div class="l">Commission</div><div class="v">${aed(plan.commissionFils)}</div>` : ''}
</div>
<h2>Cheque Schedule (${plan.chequeCount} cheques)</h2>
<table><thead><tr><th>#</th><th>Description</th><th style="text-align:right">Amount</th><th>Due Date</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="2">Total</td><td style="text-align:right">${aed(plan.totalAmountFils)}</td><td></td></tr></tfoot>
</table>
${plan.notes ? `<h2>Notes</h2><p style="font-size:12px;color:#3d3b35">${plan.notes.replace(/</g, '&lt;')}</p>` : ''}
<div class="footer">UpNow · Customer preview · ${new Date().toLocaleDateString('en-AE',{day:'numeric',month:'short',year:'numeric'})}</div>
</body></html>`;
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) { alert('Please allow pop-ups to preview the plan.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  async function loadCheques() {
    if (chequesLoaded) return;
    setChequesLoading(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/cheques`, { credentials: 'include' });
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
      const res = await fetch(`/api/leads/${lead.id}/issue-payment-plan`, {
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
          ...(planInstallmentCount === 1 && planDiscountType !== 'none' && planDiscountValue && parseFloat(planDiscountValue) > 0 && {
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
    const res = await fetch(`/api/leads/${lead.id}/cheques/${chequeId}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) setCheques(prev => prev.filter(c => c.id !== chequeId));
  }

  async function handleConfirmCollected() {
    setConfirmingCollection(true); setChequeError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/confirm-cheques-collected`, {
        method: 'PATCH', credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setChequeError(body.message ?? 'Failed'); return; }
      setPanel('none');
      setLeads(prev => prev.map(l =>
        l.id !== lead.id ? l : { ...l, stage: 'cheques_collected' as LeadStage },
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
      const res = await fetch(`/api/leads/${lead.id}/additional-docs-note`, {
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

  async function handleMarkVisited() {
    if (!viewing) return;
    setMarkingVisit(true); setVisitError(null);
    try {
      const res = await fetch(`/api/leads/viewings/${viewing.id}/status`, {
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
    if (primary.kind === 'issue_plan') { openPanel('plan'); return; }
    if (primary.kind === 'record_cheques') { openPanel('cheques'); return; }
    if (primary.kind === 'confirm_collected') { handleConfirmCollected(); return; }
  }

  return (
    <div className="bg-white rounded-xl border border-[#ede9e3]">

      {/* ── Single row ── */}
      <div className="flex items-center">

        {/* Scrollable section — avatar through date */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div className="flex items-center gap-5 px-5 py-4" style={{ minWidth: 580 }}>

            {/* Avatar */}
            <div
              className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: '#2e9f82' }}
            >
              {initials(displayName)}
            </div>

            {/* Name + contact */}
            <div className="min-w-0" style={{ width: 190 }}>
              <p className="text-sm font-semibold text-[#1a1916] truncate">{displayName}</p>
              <p className="text-xs text-[#9b9890] truncate mt-0.5">
                {email ?? 'No email'}{phone ? ` · ${phone}` : ''}
              </p>
            </div>

            {/* Property */}
            <div className="min-w-0" style={{ width: 155 }}>
              {unitLabel ? (
                <>
                  <p className="text-sm text-[#1a1916] font-medium truncate flex items-center gap-1">
                    <Building2 size={11} className="text-[#c8c6c0] shrink-0" />
                    {unitLabel}
                  </p>
                  {building && <p className="text-xs text-[#9b9890] truncate pl-4">{building}</p>}
                </>
              ) : (
                <span className="text-xs text-[#c8c6c0]">No unit</span>
              )}
            </div>

            {/* Stage */}
            <div style={{ width: 108 }} className="shrink-0">
              <span className={`inline-flex items-center rounded-full text-[11px] font-semibold px-2.5 py-1 ${STAGE_PILL[lead.stage]}`}>
                {STAGE_LABELS[lead.stage]}
              </span>
            </div>

            {/* Date */}
            <div style={{ width: 138 }} className="shrink-0">
              {viewing ? (
                <div className={`flex items-center gap-1.5 text-xs font-medium ${new Date(viewing.scheduledAt) <= new Date() ? 'text-amber-600' : 'text-[#6b6860]'}`}>
                  <Clock size={11} className="shrink-0" />
                  {fmtDateTime(viewing.scheduledAt)}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-[#9b9890]">
                  <Calendar size={11} className="shrink-0" />
                  {fmtDate(lead.createdAt)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fixed right section — CTA + menu (never inside overflow container) */}
        <div className="flex items-center gap-2 pr-4 pl-2 shrink-0">
          {/* Viewing details button — visible whenever there is any viewing */}
          {anyViewing && (
            <button
              onClick={() => openPanel('details')}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                panel === 'details'
                  ? 'bg-[#eef2ff] border-[#c7d2fe] text-[#4338ca]'
                  : 'bg-white border-[#e8e6e0] text-[#6b6860] hover:border-[#c7d2fe] hover:text-[#4338ca]'
              }`}
            >
              <StickyNote size={11} />
              Details
            </button>
          )}

          {/* Doc upload badge */}
          {lead.docStats && lead.docStats.total > 0 && (
            <button
              onClick={() => openPanel('docs')}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                lead.docStats.pending > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              <FileText size={11} />
              {lead.docStats.pending > 0
                ? `${lead.docStats.pending} pending`
                : `${lead.docStats.total} docs`}
            </button>
          )}

          {primary && (
            <button
              disabled={moving}
              onClick={handlePrimary}
              className={`flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap ${primary.cls}`}
            >
              {primary.kind === 'convert' ? <ArrowRight size={12} /> : <CheckCircle2 size={12} />}
              {primary.label}
            </button>
          )}

          {/* ··· menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[#c8c6c0] hover:bg-[#f4f3f0] hover:text-[#3d3b35] transition-colors cursor-pointer"
            >
              <MoreVertical size={15} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-white rounded-xl shadow-2xl border border-[#e8e6e0] py-1 text-sm">
                {email && (
                  <a
                    href={`mailto:${email}`}
                    className="flex items-center gap-2.5 px-3 py-2 text-[#3d3b35] hover:bg-[#f4f3f0]"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Mail size={13} className="text-[#9b9890]" /> Send Email
                  </a>
                )}
                {phone && (
                  <a
                    href={`tel:${phone}`}
                    className="flex items-center gap-2.5 px-3 py-2 text-[#3d3b35] hover:bg-[#f4f3f0]"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Phone size={13} className="text-[#9b9890]" /> Call
                  </a>
                )}

                {/* Notify guard — only for scheduled viewings */}
                {viewing && (viewing.status === 'scheduled' || viewing.status === 'confirmed') && (
                  <>
                    <div className="my-1 border-t border-[#f0ede8]" />
                    <button
                      onClick={() => openPanel('guard')}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[#3d3b35] hover:bg-[#f4f3f0] cursor-pointer"
                    >
                      <ShieldAlert size={13} className="text-[#9b9890]" />
                      {panel === 'guard' ? 'Hide Guard Alert' : 'Notify Guard'}
                    </button>
                  </>
                )}

                {canDocs && (
                  <>
                    <div className="my-1 border-t border-[#f0ede8]" />
                    <button
                      onClick={() => openPanel('docs')}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[#3d3b35] hover:bg-[#f4f3f0] cursor-pointer"
                    >
                      <FileText size={13} className="text-[#9b9890]" />
                      {panel === 'docs' ? 'Hide Documents' : 'Documents'}
                    </button>
                  </>
                )}
                {canCheques && (
                  <>
                    <div className="my-1 border-t border-[#f0ede8]" />
                    <button
                      onClick={() => openPanel('plan_summary')}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[#3d3b35] hover:bg-[#f4f3f0] cursor-pointer"
                    >
                      <ClipboardList size={13} className="text-[#9b9890]" />
                      {panel === 'plan_summary' ? 'Hide Plan' : 'View Payment Plan'}
                    </button>
                  </>
                )}
                {canEditPlan && (
                  <>
                    <div className="my-1 border-t border-[#f0ede8]" />
                    <button
                      onClick={() => openPanel('plan')}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[#3d3b35] hover:bg-[#f4f3f0] cursor-pointer"
                    >
                      <ClipboardList size={13} className="text-[#9b9890]" />
                      {panel === 'plan' ? 'Hide Plan Editor' : 'Edit Payment Plan'}
                    </button>
                  </>
                )}
                {canCheques && (
                  <>
                    <div className="my-1 border-t border-[#f0ede8]" />
                    <button
                      onClick={() => openPanel('cheques')}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[#3d3b35] hover:bg-[#f4f3f0] cursor-pointer"
                    >
                      <CreditCard size={13} className="text-[#9b9890]" />
                      {panel === 'cheques' ? 'Hide Cheques' : 'Add / Record Cheques'}
                    </button>
                  </>
                )}
                {canReject && (
                  <>
                    <div className="my-1 border-t border-[#f0ede8]" />
                    <button
                      onClick={() => openPanel('reject')}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <X size={13} /> Reject Lead
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mark Visited panel ── */}
      {panel === 'visited' && viewing && (
        <div className="border-t border-[#e8f7f1] bg-[#f5fdf9] px-5 py-4">
          <p className="text-sm font-semibold text-[#1a1916] flex items-center gap-2 mb-3">
            <CheckCircle2 size={14} className="text-[#2e9f82]" />
            Mark viewing as completed
            <span className="ml-auto text-xs font-normal text-[#9b9890]">{fmtDateTime(viewing.scheduledAt)}</span>
          </p>
          <label className="block text-xs font-medium text-[#3d3b35] mb-1.5">
            <MessageSquare size={11} className="inline mr-1" />
            Remarks <span className="font-normal text-[#9b9890]">(optional)</span>
          </label>
          <textarea
            value={visitRemarks}
            onChange={e => setVisitRemarks(e.target.value)}
            rows={2}
            placeholder="e.g. Very interested, wants to negotiate rent…"
            className="w-full text-sm border border-[#c5ede2] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 bg-white mb-3"
          />
          {visitError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{visitError}</p>
          )}
          <div className="flex gap-2">
            <button
              disabled={markingVisit}
              onClick={handleMarkVisited}
              className="text-xs px-4 py-2 rounded-lg bg-[#2e9f82] text-white font-semibold hover:bg-[#1f6655] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {markingVisit ? 'Saving…' : 'Confirm Visit'}
            </button>
            <button
              onClick={() => { setPanel('none'); setVisitRemarks(''); setVisitError(null); }}
              className="text-xs px-4 py-2 rounded-lg bg-white border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3f0] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Reject panel ── */}
      {panel === 'reject' && (
        <div className="border-t border-red-100 bg-red-50 px-5 py-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Reject this lead?</p>
          <p className="text-xs text-red-500 mb-3">
            You&apos;re no longer pursuing <strong>{displayName}</strong> for this unit. You can reopen it later.
          </p>
          <div className="flex gap-2">
            <button
              disabled={moving}
              onClick={() => { onMoveStage(lead.id, 'rejected'); setPanel('none'); }}
              className="text-xs px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
            >
              Yes, reject
            </button>
            <button
              onClick={() => setPanel('none')}
              className="text-xs px-4 py-2 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Documents panel ── */}
      {panel === 'docs' && (
        <div className="border-t border-[#e8e6e0] bg-[#fafaf8] px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[#3d3b35] flex items-center gap-1.5">
              <FileText size={12} className="text-[#2e9f82]" /> Customer Documents
            </p>
            <div className="flex items-center gap-2">
              {tenantDocs && tenantDocs.filter(d => d.documentKey !== 'profile_picture').length > 0 && (
                <button
                  onClick={() => setViewAllOpen(true)}
                  className="flex items-center gap-1 text-xs font-semibold text-[#2e9f82] border border-[#2e9f82] rounded-lg px-2.5 py-1 hover:bg-[#f0faf6] transition-colors cursor-pointer"
                >
                  <Printer size={11} /> View All
                </button>
              )}
              <button
                onClick={() => setPanel('none')}
                className="text-xs font-medium text-[#9b9890] hover:text-[#3d3b35] transition-colors cursor-pointer"
              >
                Hide
              </button>
            </div>
          </div>
          {docActionError && <p className="text-[10px] text-[#b91c1c] mb-2">{docActionError}</p>}
          {docsLoading ? (
            <p className="flex items-center gap-2 text-xs text-[#9b9890]">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </p>
          ) : (() => {
            const KYC_1 = new Set(['emirates_id', 'passport', 'uae_visa']);
            const RENTAL = new Set(['employment_letter', 'bank_statement', 'marriage_certificate', 'rental_history', 'credit_report', 'utility_clearance', 'trade_license', 'tax_registration', 'moa', 'business_license', 'utility_proof_of_payment']);
            const docs = (tenantDocs ?? []).filter(d => d.documentKey !== 'profile_picture');

            const occ1Docs    = docs.filter(d => KYC_1.has(d.documentKey));
            const rentalDocs  = docs.filter(d => RENTAL.has(d.documentKey));
            const extraOccMap = new Map<number, TenantDoc[]>();
            const otherDocs: TenantDoc[]  = [];
            for (const d of docs) {
              const m = d.documentKey.match(/^(emirates_id|passport|uae_visa)_(\d+)$/);
              if (m) {
                const n = parseInt(m[2]);
                if (!extraOccMap.has(n)) extraOccMap.set(n, []);
                extraOccMap.get(n)!.push(d);
              } else if (!KYC_1.has(d.documentKey) && !RENTAL.has(d.documentKey)) {
                otherDocs.push(d);
              }
            }
            const extraNs = [...extraOccMap.keys()].sort((a, b) => a - b);
            const hasAny  = occ1Docs.length > 0 || extraNs.length > 0 || rentalDocs.length > 0 || otherDocs.length > 0;

            function DocRow({ doc }: { doc: TenantDoc }) {
              const label = doc.displayName ?? doc.documentKey.replace(/_\d+$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              const isPending    = ['pending', 'attached'].includes(doc.status);
              const isApproved   = doc.status === 'processed';
              const isRejected   = doc.status === 'rejected';
              const isActioning  = docActioning === doc.id;
              return (
                <div className="flex items-center gap-2.5 bg-white rounded-lg border border-[#e8e6e0] px-3 py-2">
                  <FileText size={12} className="text-[#2e9f82] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-[#1a1916] truncate">{label}</p>
                    <p className={`text-[10px] capitalize ${isApproved ? 'text-[#16a34a]' : isRejected ? 'text-[#b91c1c]' : 'text-[#9b9890]'}`}>
                      {isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Uploaded'}
                    </p>
                  </div>
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-[#2e9f82] hover:underline">
                    View <ExternalLink size={10} />
                  </a>
                  {isPending && (
                    <>
                      <button disabled={!!isActioning} onClick={() => handleApproveDoc(doc.id)}
                        className="shrink-0 flex items-center gap-0.5 text-[10px] font-semibold text-[#065f46] bg-[#d1fae5] hover:bg-[#a7f3d0] disabled:opacity-50 rounded px-2 py-0.5 transition-colors cursor-pointer">
                        {isActioning ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />} Approve
                      </button>
                      <button disabled={!!isActioning} onClick={() => { setRejectingDoc({ id: doc.id, label }); setRejectReason(''); }}
                        className="shrink-0 flex items-center gap-0.5 text-[10px] font-semibold text-[#b91c1c] bg-[#fee2e2] hover:bg-[#fecaca] disabled:opacity-50 rounded px-2 py-0.5 transition-colors cursor-pointer">
                        <X size={9} /> Reject
                      </button>
                    </>
                  )}
                  {isApproved && <span className="shrink-0 text-[9px] font-bold text-[#16a34a] bg-[#dcfce7] rounded px-1.5 py-0.5">✓</span>}
                  {isRejected && <span className="shrink-0 text-[9px] font-bold text-[#b91c1c] bg-[#fee2e2] rounded px-1.5 py-0.5">✗</span>}
                </div>
              );
            }

            if (!hasAny) return <p className="text-xs text-[#9b9890]">No documents uploaded yet.</p>;

            return (
              <div className="space-y-3">
                {/* ── Per-occupant identity docs ── */}
                <div className="rounded-xl border border-[#e8e6e0] overflow-hidden">
                  {/* Occupant 1 */}
                  <div className={extraNs.length > 0 ? 'border-b border-[#e8e6e0]' : ''}>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-[#9b9890] px-3 pt-2 pb-1">Occupant 1</p>
                    <div className="px-3 pb-2.5 space-y-1.5">
                      {occ1Docs.length > 0
                        ? occ1Docs.map(doc => <DocRow key={doc.id} doc={doc} />)
                        : <p className="text-[10px] text-[#9b9890]">No identity documents uploaded yet.</p>}
                    </div>
                  </div>
                  {/* Occupants 2+ */}
                  {extraNs.map(n => (
                    <div key={n} className="border-t border-[#e8e6e0]">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-[#9b9890] px-3 pt-2 pb-1 flex items-center justify-between">
                        Occupant {n} <span className="text-[8px] font-normal normal-case text-[#c8c6c0]">optional</span>
                      </p>
                      <div className="px-3 pb-2.5 space-y-1.5">
                        {extraOccMap.get(n)!.map(doc => <DocRow key={doc.id} doc={doc} />)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── Rental docs ── */}
                {rentalDocs.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-[#9b9890] mb-1.5">Rental Documents</p>
                    <div className="space-y-1.5">
                      {rentalDocs.map(doc => <DocRow key={doc.id} doc={doc} />)}
                    </div>
                  </div>
                )}

                {/* ── Other docs ── */}
                {otherDocs.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-[#9b9890] mb-1.5">Other</p>
                    <div className="space-y-1.5">
                      {otherDocs.map(doc => <DocRow key={doc.id} doc={doc} />)}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Additional docs request ── */}
          <div className="mt-4 pt-4 border-t border-[#e8e6e0]">
            <p className="text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">
              Request Additional Documents
            </p>
            <p className="text-[10px] text-[#9b9890] mb-3">
              Each document appears as an individual upload slot in the customer's journey.
            </p>

            {/* Existing items */}
            {docsNoteItems.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {docsNoteItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-white border border-[#e8e6e0] rounded-lg px-3 py-2">
                    <FileText size={12} className="text-[#2e9f82] shrink-0" />
                    <span className="flex-1 text-xs text-[#1a1916]">{item}</span>
                    <button
                      onClick={() => { setDocsNoteItems(prev => prev.filter((_, i) => i !== idx)); setDocsNoteSaved(false); }}
                      className="text-[#9b9890] hover:text-[#b91c1c] transition-colors cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new item */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newDocItem}
                onChange={e => setNewDocItem(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newDocItem.trim()) {
                    setDocsNoteItems(prev => [...prev, newDocItem.trim()]);
                    setNewDocItem('');
                    setDocsNoteSaved(false);
                  }
                }}
                placeholder="e.g. NOC, Bank Statement, Police Clearance…"
                className="flex-1 text-xs border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82] text-[#1a1916]"
              />
              <button
                onClick={() => {
                  if (newDocItem.trim()) {
                    setDocsNoteItems(prev => [...prev, newDocItem.trim()]);
                    setNewDocItem('');
                    setDocsNoteSaved(false);
                  }
                }}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg border border-[#2e9f82] text-[#2e9f82] hover:bg-[#f0faf6] transition-colors cursor-pointer"
              >
                + Add
              </button>
            </div>

            {docsNoteError && <p className="text-[10px] text-[#b91c1c] mb-2">{docsNoteError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={saveDocsNote}
                disabled={docsNoteSaving}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 cursor-pointer"
                style={{ backgroundColor: '#2e9f82' }}
              >
                {docsNoteSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {docsNoteSaving ? 'Saving…' : 'Save Request'}
              </button>
              {docsNoteSaved && <span className="text-[10px] text-[#16a34a] font-medium">Saved ✓</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Viewing Details panel ── */}
      {panel === 'details' && anyViewing && (
        <div className="border-t border-[#e8f0fe] bg-[#f8faff] px-5 py-4">
          <p className="text-xs font-semibold text-[#3d3b35] mb-3 flex items-center gap-1.5">
            <StickyNote size={12} className="text-[#2e9f82]" /> Viewing Details
          </p>
          <div className="space-y-3">
            {/* Date/time + status */}
            <div className="flex items-start gap-2">
              <Clock size={12} className="text-[#9b9890] shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Scheduled</p>
                <p className="text-xs font-semibold text-[#1a1916]">
                  {fmtDateTime(anyViewing.scheduledAt)}
                  <span className="ml-2 text-[10px] font-normal capitalize text-[#9b9890]">({anyViewing.status.replace(/_/g, ' ')})</span>
                </p>
              </div>
            </div>

            {/* Desired move-in */}
            {anyViewing.desiredMoveIn && (
              <div className="flex items-start gap-2">
                <Calendar size={12} className="text-[#9b9890] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Desired Move-in</p>
                  <p className="text-xs font-semibold text-[#1a1916]">{fmtDate(anyViewing.desiredMoveIn)}</p>
                </div>
              </div>
            )}

            {/* Tenant payment preferences */}
            {(anyViewing.preferredChequeCount || anyViewing.desiredMoveIn) && (
              <div className="flex items-start gap-2 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-3 py-2.5">
                <CreditCard size={12} className="text-[#16a34a] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-[#15803d] uppercase font-semibold tracking-wide mb-1">Customer Requested</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {anyViewing.desiredMoveIn && (
                      <p className="text-xs font-semibold text-[#1a1916]">
                        Start: {fmtDate(anyViewing.desiredMoveIn)}
                      </p>
                    )}
                    {anyViewing.preferredChequeCount && (
                      <p className="text-xs font-semibold text-[#1a1916]">
                        Payments: {(() => {
                          const m: Record<number, string> = { 1: 'Annual', 2: 'Semi-Annual', 4: 'Quarterly', 6: 'Bi-Monthly', 12: 'Monthly' };
                          return m[anyViewing.preferredChequeCount!] ?? `${anyViewing.preferredChequeCount} installments`;
                        })()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tenant notes from booking (viewing level) */}
            {anyViewing.notes && (
              <div className="flex items-start gap-2">
                <MessageSquare size={12} className="text-[#9b9890] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Customer Notes & Occupancy</p>
                  <p className="text-xs text-[#3d3b35] whitespace-pre-line leading-relaxed">{anyViewing.notes}</p>
                </div>
              </div>
            )}

            {/* RP visit outcome/remarks */}
            {anyViewing.outcome && (
              <div className="flex items-start gap-2">
                <CheckCircle2 size={12} className="text-[#2e9f82] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Visit Remarks</p>
                  <p className="text-xs text-[#3d3b35] whitespace-pre-line leading-relaxed">{anyViewing.outcome}</p>
                </div>
              </div>
            )}

            {/* RP notes on the lead */}
            {lead.notes && (
              <div className="flex items-start gap-2">
                <StickyNote size={12} className="text-[#9b9890] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Notes</p>
                  <p className="text-xs text-[#3d3b35] whitespace-pre-line leading-relaxed">{lead.notes}</p>
                </div>
              </div>
            )}

            {/* Tenant contact */}
            {(email || phone) && (
              <div className="flex items-start gap-2">
                <User size={12} className="text-[#9b9890] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Customer Contact</p>
                  <div className="flex flex-wrap gap-3">
                    {email && (
                      <a href={`mailto:${email}`} className="flex items-center gap-1 text-xs text-[#2e9f82] hover:underline">
                        <Mail size={10} /> {email}
                      </a>
                    )}
                    {phone && (
                      <a href={`tel:${phone}`} className="flex items-center gap-1 text-xs text-[#2e9f82] hover:underline">
                        <Phone size={10} /> {phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Listing link */}
            {lead.unit?.id && (
              <div className="flex items-start gap-2">
                <ExternalLink size={12} className="text-[#9b9890] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Listing</p>
                  <a
                    href={`/listings/units/${lead.unit.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-[#2e9f82] hover:underline font-medium"
                  >
                    {unitLabel ?? `Unit ${lead.unit.id}`}{building ? ` · ${building}` : ''} <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Payment Plan panel ── */}
      {panel === 'plan' && (() => {
        const _rentFils    = Math.round((parseFloat(planRentAed)       || 0) * 100);
        const _adminFils   = Math.round((parseFloat(planAdminFeeAed)   || 0) * 100);
        const _ejariFils   = Math.round((parseFloat(planEjariAed)      || 0) * 100);
        const _commFils    = Math.round((parseFloat(planCommissionAed) || 0) * 100);
        const _depositFils = Math.round((parseFloat(planDepositAed)    || 0) * 100);
        // Apply discount preview for single-payment plans
        const _discountFils = planInstallmentCount === 1 && planDiscountType !== 'none' && parseFloat(planDiscountValue) > 0
          ? planDiscountType === 'percent'
            ? Math.round(_rentFils * parseFloat(planDiscountValue) / 100)
            : Math.round(parseFloat(planDiscountValue) * 100)
          : 0;
        const _effectiveRentFils = Math.max(0, _rentFils - _discountFils);
        const _per    = _effectiveRentFils > 0 ? Math.floor(_effectiveRentFils / planInstallmentCount) : 0;
        const _last   = _effectiveRentFils > 0 ? _effectiveRentFils - _per * (planInstallmentCount - 1) : 0;
        const _totalFils = _effectiveRentFils + _adminFils + _ejariFils + _commFils + _depositFils;

        // Each row owns its date. Sorted by dueDate ASC for display (deposit tiebreaks last when dates collide).
        type ChequeRow = {
          kind: 'bundle' | 'deposit' | 'installment';
          installmentIndex?: number;  // 0..(installmentCount-2) for installments 2..N
          label: string;
          amountFils: number;
          dueDate: string;
        };
        const KIND_WEIGHT: Record<ChequeRow['kind'], number> = { bundle: 0, installment: 1, deposit: 2 };
        const unsortedRows: ChequeRow[] = _rentFils > 0 ? [
          { kind: 'bundle', label: 'Admin Fee + Ejari + Commission + Installment 1', amountFils: _adminFils + _ejariFils + _commFils + _per, dueDate: planBundleDate },
          ...Array.from({ length: planInstallmentCount - 1 }, (_, i) => ({
            kind: 'installment' as const,
            installmentIndex: i,
            label: `Installment ${i + 2}`,
            amountFils: i === planInstallmentCount - 2 ? _last : _per,
            dueDate: planInstallmentDates[i] ?? '',
          })),
          { kind: 'deposit', label: 'Security Deposit', amountFils: _depositFils, dueDate: planDepositDate },
        ] : [];
        const chequeRows: ChequeRow[] = unsortedRows.slice().sort((a, b) => {
          if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          return KIND_WEIGHT[a.kind] - KIND_WEIGHT[b.kind];
        });

        return (
          <div className="border-t border-[#e0f2fe] bg-[#f0f9ff] px-5 py-4">
            <p className="text-xs font-semibold text-[#0369a1] mb-4 flex items-center gap-1.5">
              <ClipboardList size={12} /> {_existingPlan ? 'Edit Payment Plan' : 'Issue Payment Plan'}
            </p>

            {/* Tenant preferences banner */}
            {(_latestViewing?.desiredMoveIn || _latestViewing?.preferredChequeCount) && (
              <div className="flex items-center gap-2 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-3 py-2 mb-4">
                <BadgeCheck size={13} className="text-[#16a34a] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-[#15803d] mb-0.5">Customer Requested</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {_latestViewing.desiredMoveIn && (
                      <span className="text-[10px] text-[#1a1916]">
                        Start date: <strong>{fmtDate(_latestViewing.desiredMoveIn)}</strong>
                      </span>
                    )}
                    {_latestViewing.preferredChequeCount && (
                      <span className="text-[10px] text-[#1a1916]">
                        Payments: <strong>{(() => {
                          const m: Record<number, string> = { 1: 'Annual', 2: 'Semi-Annual', 4: 'Quarterly', 6: 'Bi-Monthly', 12: 'Monthly' };
                          return m[_latestViewing.preferredChequeCount!] ?? `${_latestViewing.preferredChequeCount} installments`;
                        })()}</strong>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Rent + Installments + Start Date */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">
                  Annual Rent (AED) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={planRentAed}
                  onChange={e => setPlanRentAed(e.target.value)}
                  placeholder="e.g. 85000"
                  className="w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">
                  No. of Installments <span className="text-red-500">*</span>
                </label>
                <select
                  value={planInstallmentCount}
                  onChange={e => { const n = Number(e.target.value); setPlanInstallmentCount(n); resizeInstallmentDates(n); }}
                  className="w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916] cursor-pointer"
                >
                  {([
                    [1,  'Annual'],
                    [2,  'Semi-Annual'],
                    [4,  'Quarterly'],
                    [6,  'Bi-Monthly'],
                    [12, 'Monthly'],
                  ] as const).map(([n, label]) => (
                    <option key={n} value={n}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">
                  Contract Start Date
                </label>
                <PreferredDayPicker
                  value={planStartDate}
                  preferredDays={preferredStartDays}
                  onChange={d => { setPlanStartDate(d); if (d) applyStartDate(d, planInstallmentCount); }}
                  placeholder="Pick start date"
                />
                {planStartDate && (
                  <p className="text-[9px] text-[#0369a1] mt-0.5">Cheque dates auto-generated from start date</p>
                )}
              </div>
            </div>

            {/* Fees */}
            <p className="text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-2">Fees & Deposit</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] text-[#6b6860] mb-1">Admin Fee (AED)</label>
                <input type="number" value={planAdminFeeAed} onChange={e => setPlanAdminFeeAed(e.target.value)}
                  placeholder="0" className="w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#6b6860] mb-1">Ejari Fee (AED)</label>
                <input type="number" value={planEjariAed} onChange={e => setPlanEjariAed(e.target.value)}
                  placeholder="0" className="w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#6b6860] mb-1">Commission (AED)</label>
                <input type="number" value={planCommissionAed} onChange={e => setPlanCommissionAed(e.target.value)}
                  placeholder="0" className="w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#6b6860] mb-1">Security Deposit (AED)</label>
                <input type="number" value={planDepositAed} onChange={e => setPlanDepositAed(e.target.value)}
                  placeholder="0" className="w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]" />
              </div>
            </div>

            {/* Single-payment discount */}
            {planInstallmentCount === 1 && (
              <div className="mb-3 bg-[#fffbeb] border border-[#fde68a] rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-semibold text-[#92400e] uppercase tracking-wide mb-2">Annual Discount (Optional)</p>
                <div className="flex gap-1.5 mb-2">
                  {(['none', 'percent', 'fixed'] as const).map(t => (
                    <button key={t} type="button"
                      onClick={() => { setPlanDiscountType(t); if (t === 'none') setPlanDiscountValue(''); }}
                      className={`text-[10px] px-2.5 py-1 rounded-lg border font-medium cursor-pointer transition-colors ${planDiscountType === t ? 'bg-[#92400e] text-white border-[#92400e]' : 'bg-white border-[#d6d4ce] text-[#3d3b35] hover:border-[#92400e]'}`}
                    >
                      {t === 'none' ? 'No Discount' : t === 'percent' ? '% Off' : 'Fixed AED'}
                    </button>
                  ))}
                </div>
                {planDiscountType !== 'none' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={planDiscountValue}
                      onChange={e => setPlanDiscountValue(e.target.value)}
                      placeholder={planDiscountType === 'percent' ? 'e.g. 5' : 'e.g. 2000'}
                      className="flex-1 text-[11px] border border-[#fde68a] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/30 bg-white text-[#1a1916]"
                    />
                    <span className="text-[10px] text-[#92400e] font-semibold">{planDiscountType === 'percent' ? '%' : 'AED'}</span>
                  </div>
                )}
                {planDiscountType !== 'none' && planDiscountValue && parseFloat(planDiscountValue) > 0 && (() => {
                  const rent = parseFloat(planRentAed) || 0;
                  const disc = planDiscountType === 'percent'
                    ? Math.round(rent * parseFloat(planDiscountValue)) / 100
                    : parseFloat(planDiscountValue) || 0;
                  const effective = Math.max(0, rent - disc);
                  return (
                    <p className="text-[10px] text-[#92400e] mt-1.5">
                      Original: <b>AED {rent.toLocaleString('en-AE')}</b> — Discount: <b>AED {disc.toLocaleString('en-AE', { maximumFractionDigits: 2 })}</b> → Final Rent: <b className="text-[#065f46]">AED {effective.toLocaleString('en-AE')}</b>
                    </p>
                  );
                })()}
              </div>
            )}

            {/* Auto-generated cheque schedule */}
            {chequeRows.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide">
                    Cheque Schedule ({chequeRows.length} cheques)
                  </p>
                  {_totalFils > 0 && (
                    <span className="text-[10px] font-bold text-[#0369a1]">
                      Total: AED {(_totalFils / 100).toLocaleString('en-AE')}
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {chequeRows.map((row, i) => {
                    const key = row.kind === 'bundle' ? 'bundle'
                      : row.kind === 'deposit' ? 'deposit'
                      : `inst-${row.installmentIndex}`;
                    const onChange = (v: string) => {
                      if (row.kind === 'bundle') setPlanBundleDate(v);
                      else if (row.kind === 'deposit') setPlanDepositDate(v);
                      else setPlanInstallmentDates(prev => prev.map((d, j) => j === row.installmentIndex ? v : d));
                    };
                    return (
                      <div key={key} className="flex items-center gap-2 bg-white border border-[#bae6fd] rounded-lg px-3 py-2">
                        <span className="text-[10px] font-bold text-[#0369a1] w-5 shrink-0">#{i + 1}</span>
                        <span className="text-[10px] text-[#1a1916] flex-1 min-w-0 truncate">{row.label}</span>
                        <span className="text-[10px] font-semibold text-[#0369a1] shrink-0 w-24 text-right">
                          {row.amountFils > 0 ? `AED ${(row.amountFils / 100).toLocaleString('en-AE')}` : '—'}
                        </span>
                        <input
                          type="date"
                          value={row.dueDate}
                          onChange={e => onChange(e.target.value)}
                          className="w-32 shrink-0 text-xs border border-[#e0f2fe] rounded px-2 py-1 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Extra installment rows */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide">Extra Installments</p>
                <button
                  type="button"
                  onClick={() => setPlanExtraItems(prev => [...prev, { description: '', amountAed: '', dueDate: '' }])}
                  className="flex items-center gap-1 text-[10px] font-semibold text-[#0369a1] hover:text-[#0284c7] cursor-pointer"
                >
                  <Plus size={10} /> Add Installment
                </button>
              </div>
              {planExtraItems.length > 0 && (
                <div className="space-y-1.5">
                  {planExtraItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-white border border-[#bae6fd] rounded-lg px-3 py-2">
                      <span className="text-[10px] font-bold text-[#0369a1] w-5 shrink-0">
                        #{chequeRows.length + 1 + idx}
                      </span>
                      <input
                        type="text"
                        value={item.description}
                        onChange={e => setPlanExtraItems(prev => prev.map((it, i) => i === idx ? { ...it, description: e.target.value } : it))}
                        placeholder="Label (e.g. VAT, Municipality Fee)"
                        className="flex-1 min-w-0 text-[10px] border border-[#e0f2fe] rounded px-2 py-1 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]"
                      />
                      <input
                        type="number"
                        value={item.amountAed}
                        onChange={e => setPlanExtraItems(prev => prev.map((it, i) => i === idx ? { ...it, amountAed: e.target.value } : it))}
                        placeholder="AED"
                        className="w-20 shrink-0 text-[10px] border border-[#e0f2fe] rounded px-2 py-1 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]"
                      />
                      <input
                        type="date"
                        value={item.dueDate}
                        onChange={e => setPlanExtraItems(prev => prev.map((it, i) => i === idx ? { ...it, dueDate: e.target.value } : it))}
                        className="w-32 shrink-0 text-[10px] border border-[#e0f2fe] rounded px-2 py-1 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]"
                      />
                      <button
                        type="button"
                        onClick={() => setPlanExtraItems(prev => prev.filter((_, i) => i !== idx))}
                        className="text-[#c8c6c0] hover:text-red-500 transition-colors cursor-pointer shrink-0"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-3">
              <label className="block text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">
                Cheques payable to <span className="font-normal normal-case text-[#9b9890]">(name customer writes on cheques)</span>
              </label>
              <input
                type="text"
                value={planChequesPayableTo}
                onChange={e => setPlanChequesPayableTo(e.target.value)}
                placeholder="e.g. ABC Real Estate LLC"
                className="w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]"
              />
              <p className="mt-1 text-[10px] text-[#9b9890]">Auto-filled from your profile. Edit if you need a different name on the cheques.</p>
            </div>

            <div className="mb-3">
              <label className="block text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">Notes (optional)</label>
              <input
                type="text"
                value={planNotes}
                onChange={e => setPlanNotes(e.target.value)}
                placeholder="e.g. 4 quarterly cheques"
                className="w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916]"
              />
            </div>

            {/* ── Rental Index Report attachment ── */}
            <div className="mb-3">
              <label className="block text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">
                Rental Index Report <span className="font-normal normal-case text-[#9b9890]">(optional — visible to customer)</span>
              </label>
              {rentalIndexUrl ? (
                <div className="flex items-center gap-2 bg-[#f0faf6] border border-[#2e9f82] rounded-lg px-3 py-2">
                  <FileText size={13} className="text-[#2e9f82] shrink-0" />
                  <span className="flex-1 text-[11px] font-medium text-[#1a1916] truncate">
                    {rentalIndexFileName || 'Rental Index Report'}
                  </span>
                  <a href={rentalIndexUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-[#2e9f82] hover:underline shrink-0 flex items-center gap-0.5">
                    View <ExternalLink size={9} />
                  </a>
                  <button type="button" onClick={() => { setRentalIndexUrl(''); setRentalIndexFileName(''); setRentalIndexStatus(null); }}
                    className="text-[#9b9890] hover:text-[#b91c1c] transition-colors cursor-pointer shrink-0">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <label className={`flex items-center gap-2 border border-dashed border-[#bae6fd] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-[#f0f9ff] transition-colors ${rentalIndexUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setRentalIndexUploading(true);
                      try {
                        const urlRes = await fetch('/api/documents/upload-url', {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            ownerType: 'rental_provider', ownerId: lead.unit?.id ?? lead.id,
                            documentKey: 'rental_index_report', mimeType: file.type,
                            originalName: file.name,
                          }),
                        });
                        if (!urlRes.ok) {
                          const errBody = await urlRes.json().catch(() => ({})) as { message?: string };
                          const msg = `Upload failed — ${errBody.message ?? urlRes.status}`;
                          setRentalIndexStatus({ ok: false, msg });
                          toast.error(msg);
                          return;
                        }
                        const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
                        // Normalise to a relative path so the PUT stays same-origin (fixes 127.0.0.1 vs localhost mismatch)
                        const safeUploadUrl = (() => {
                          try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
                          catch { return uploadUrl; }
                        })();
                        let putRes: Response;
                        try { putRes = await fetch(safeUploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } }); }
                        catch { setRentalIndexStatus({ ok: false, msg: 'Upload failed — network error' }); toast.error('Upload failed — network error'); return; }
                        if (!putRes.ok) { setRentalIndexStatus({ ok: false, msg: `Upload failed — server error ${putRes.status}` }); toast.error(`Upload failed — server error ${putRes.status}`); return; }
                        setRentalIndexUrl(fileUrl);
                        setRentalIndexFileName(file.name);
                        setRentalIndexStatus({ ok: true, msg: `"${file.name}" uploaded successfully` });
                        toast.success(`Rental Index Report uploaded — "${file.name}"`);
                      } finally { setRentalIndexUploading(false); e.target.value = ''; }
                    }}
                  />
                  {rentalIndexUploading
                    ? <><Loader2 size={13} className="animate-spin text-[#0ea5e9]" /><span className="text-[11px] text-[#0ea5e9]">Uploading…</span></>
                    : <><FileText size={13} className="text-[#9b9890]" /><span className="text-[11px] text-[#9b9890]">Attach PDF or image</span></>}
                </label>
              )}
              {rentalIndexStatus && (
                <p className={`mt-1.5 text-[10px] rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 ${rentalIndexStatus.ok ? 'bg-[#f0faf6] text-[#16a34a] border border-[#bbf7d0]' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                  {rentalIndexStatus.ok ? <CheckCircle2 size={10} /> : <X size={10} />}
                  {rentalIndexStatus.msg}
                </p>
              )}
            </div>

            {planError && (
              <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{planError}</p>
            )}
            <div className="flex gap-2">
              <button
                disabled={planSaving}
                onClick={handleIssuePlan}
                className="text-xs px-4 py-2 rounded-lg bg-[#0ea5e9] text-white font-semibold hover:bg-[#0284c7] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {planSaving ? 'Saving…' : _existingPlan ? 'Update Plan' : 'Issue Payment Plan'}
              </button>
              <button
                onClick={() => { setPanel('none'); setPlanError(null); }}
                className="text-xs px-4 py-2 rounded-lg bg-white border border-[#bae6fd] text-[#0369a1] hover:bg-[#e0f2fe] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Payment Plan summary ── */}
      {panel === 'plan_summary' && lead.paymentPlan && (() => {
        const plan = lead.paymentPlan;
        const sorted = plan.items.slice().sort((a, b) => {
          if (a.dueDate !== b.dueDate) return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
          const order: Record<string, number> = { first_bundle: 0, installment: 1, extra_installment: 2, security_deposit: 3 };
          return (order[a.type ?? 'installment'] ?? 1) - (order[b.type ?? 'installment'] ?? 1);
        });
        return (
          <div className="border-t border-[#e0f2fe] bg-[#f8fbff] px-5 py-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-[#0369a1] flex items-center gap-1.5">
                <ClipboardList size={10} />
                {lead.stage === 'payment_plan_shared' ? 'Payment Plan Shared — waiting for customer' : 'Payment Plan'}
              </p>
              <div className="flex items-center gap-3">
                <button onClick={handlePreviewPlan} className="text-[10px] text-[#0369a1] hover:text-[#0284c7] font-semibold flex items-center gap-1 cursor-pointer">
                  <Eye size={10} /> Preview as customer
                </button>
                <button onClick={handlePreviewPlan} className="text-[10px] text-[#0369a1] hover:text-[#0284c7] font-semibold flex items-center gap-1 cursor-pointer">
                  <Printer size={10} /> Print / Download
                </button>
              </div>
            </div>
            {/* Fee summary row — matches tenant view */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-[#6b6860] border-b border-[#e0f2fe] pb-2">
              {plan.originalRentFils != null ? (
                <span className="col-span-2">
                  Annual Rent: <span className="line-through text-[#9b9890]">AED {(plan.originalRentFils / 100).toLocaleString('en-AE')}</span>
                  {' '}<span className="text-[#16a34a] font-semibold">→ AED {(plan.rentFils / 100).toLocaleString('en-AE')}</span>
                  {' '}<span className="text-[#16a34a] text-[9px]">
                    ({plan.discountType === 'percent' ? `${plan.discountPercent}% discount` : `AED ${((plan.discountFils ?? 0) / 100).toLocaleString('en-AE')} discount`})
                  </span>
                </span>
              ) : (
                <span>Annual Rent: <b className="text-[#1a1916]">AED {(plan.rentFils / 100).toLocaleString('en-AE')}</b></span>
              )}
              <span>Security Deposit: <b className="text-[#1a1916]">AED {(plan.securityDepositFils / 100).toLocaleString('en-AE')}</b></span>
              {plan.adminFeeFils > 0 && <span>Admin Fee: <b className="text-[#1a1916]">AED {(plan.adminFeeFils / 100).toLocaleString('en-AE')}</b></span>}
              {plan.ejariFils > 0 && <span>Ejari Fee: <b className="text-[#1a1916]">AED {(plan.ejariFils / 100).toLocaleString('en-AE')}</b></span>}
              {plan.commissionFils > 0 && <span>Commission: <b className="text-[#1a1916]">AED {(plan.commissionFils / 100).toLocaleString('en-AE')}</b></span>}
              <span className="col-span-2 font-semibold text-[#0369a1] mt-0.5">Total: AED {(plan.totalAmountFils / 100).toLocaleString('en-AE')} · {plan.chequeCount} cheques</span>
            </div>
            {/* Cheque schedule — sorted by date, deposit lands last on ties; single-line per row */}
            <div className="space-y-1">
              {sorted.map((item, i) => (
                <p key={item.index} className="text-[10px] py-0.5 border-b border-[#e0f2fe] last:border-0 leading-snug">
                  <span className="text-[#0369a1]">#{i + 1} {item.description ?? `Cheque ${i + 1}`}</span>
                  <span className="text-[#6b6860]"> — </span>
                  <span className="font-semibold text-[#1a1916]">AED {(item.amountFils / 100).toLocaleString('en-AE')}</span>
                  <span className="text-[#6b6860]"> · {item.dueDate}</span>
                </p>
              ))}
            </div>
            {plan.chequesPayableTo && (
              <p className="text-[10px] text-[#1a1916] bg-[#fef9c3] border border-[#fde68a] rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                <BadgeCheck size={11} className="text-[#854d0e] shrink-0" />
                <span><span className="font-semibold text-[#854d0e]">Cheques payable to:</span> {plan.chequesPayableTo}</span>
              </p>
            )}
            {plan.notes && <p className="text-[10px] text-[#6b6860] italic mt-1">{plan.notes}</p>}
            {plan.rentalIndexReportUrl && (
              <a href={plan.rentalIndexReportUrl} target="_blank" rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#2e9f82] border border-[#2e9f82] rounded-lg px-3 py-1.5 hover:bg-[#f0faf6] transition-colors">
                <FileText size={11} /> View Rental Index Report
              </a>
            )}
          </div>
        );
      })()}

      {/* ── Cheques Collection panel ── */}
      {panel === 'cheques' && (() => {
        const plan = lead.paymentPlan;
        const sortedItems = plan
          ? plan.items.slice().sort((a, b) => {
              if (a.dueDate !== b.dueDate) return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
              const order: Record<string, number> = { first_bundle: 0, installment: 1, extra_installment: 2, security_deposit: 3 };
              return (order[a.type ?? 'installment'] ?? 1) - (order[b.type ?? 'installment'] ?? 1);
            })
          : [];
        // Match each plan item to a recorded cheque by description (stored in cheque.notes)
        const chequeByDesc = new Map<string, LeadChequeRecord>();
        for (const c of cheques) if (c.notes) chequeByDesc.set(c.notes, c);

        return (
          <div className="border-t border-[#fef3c7] bg-[#fffdf0] px-5 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#854d0e] flex items-center gap-1.5">
                <CreditCard size={12} /> Record Cheques — Series View
                {plan && (
                  <span className="ml-2 text-[10px] font-normal text-[#92400e]">
                    {plan.chequeCount} cheques · Total AED {(plan.totalAmountFils / 100).toLocaleString('en-AE')}
                  </span>
                )}
              </p>
              {lead.stage === 'payment_plan_shared' && (
                <button onClick={() => openPanel('plan')} className="text-[10px] text-[#0369a1] hover:underline cursor-pointer">
                  Edit plan instead →
                </button>
              )}
            </div>

            {chequesLoading && (
              <p className="flex items-center gap-2 text-xs text-[#9b9890]">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </p>
            )}

            {/* Series of planned payments — one row per plan item */}
            {!chequesLoading && plan && (
              <div className="space-y-2">
                {sortedItems.map((it, i) => {
                  const desc = it.description ?? `Cheque ${i + 1}`;
                  const recorded = chequeByDesc.get(desc);
                  return (
                    <ChequeRow
                      key={`${it.index}-${desc}`}
                      seq={i + 1}
                      description={desc}
                      amountFils={it.amountFils}
                      dueDate={it.dueDate}
                      recorded={recorded}
                      suggestedSerial={!recorded ? chequeSuggestions[i] : undefined}
                      onSerialChange={(value) => {
                        // Propagate incremented serials to all subsequent unrecorded rows
                        if (!value.trim()) return;
                        setChequeSuggestions(prev => {
                          const next: Record<number, string> = { ...prev };
                          sortedItems.forEach((_, j) => {
                            if (j <= i) return;
                            const jDesc = sortedItems[j]?.description ?? `Cheque ${j + 1}`;
                            if (chequeByDesc.get(jDesc)) return; // already recorded
                            next[j] = nextSerial(value, j - i);
                          });
                          return next;
                        });
                      }}
                      onRecord={async (serial) => {
                        if (!serial.trim()) { setChequeError('Cheque number is required'); return; }
                        setChequeError(null);
                        const res = await fetch(`/api/leads/${lead.id}/cheques`, {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            chequeSerial: serial.trim(),
                            bankName: 'N/A',
                            amountFils: it.amountFils,
                            dueDate: it.dueDate,
                            notes: desc,
                          }),
                        });
                        const body = await res.json().catch(() => ({}));
                        if (!res.ok) { setChequeError(body.message ?? 'Failed to record'); return; }
                        setCheques(prev => [...prev, body]);
                        setChequeSuggestions(prev => { const n = { ...prev }; delete n[i]; return n; });
                      }}
                      onDelete={async () => {
                        if (!recorded) return;
                        const res = await fetch(`/api/leads/${lead.id}/cheques/${recorded.id}`, { method: 'DELETE', credentials: 'include' });
                        if (res.ok) setCheques(prev => prev.filter(c => c.id !== recorded.id));
                      }}
                      onStatusChange={async (status) => {
                        if (!recorded) return;
                        const res = await fetch(`/api/leads/${lead.id}/cheques/${recorded.id}/status`, {
                          method: 'PATCH', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status }),
                        });
                        const body = await res.json().catch(() => ({}));
                        if (res.ok && body?.id) setCheques(prev => prev.map(c => c.id === body.id ? body : c));
                      }}
                    />
                  );
                })}
              </div>
            )}

            {!chequesLoading && !plan && (
              <p className="text-[10px] text-[#92400e] bg-[#fef3c7] rounded-lg px-2.5 py-1.5">
                Issue the payment plan first — the cheque series will appear here once payments are scheduled.
              </p>
            )}

            {/* Any extra cheques that don't match a plan-item description */}
            {!chequesLoading && plan && (() => {
              const planDescs = new Set(sortedItems.map(it => it.description ?? ''));
              const orphans = cheques.filter(c => !c.notes || !planDescs.has(c.notes));
              if (orphans.length === 0) return null;
              return (
                <div className="border-t border-[#fde68a] pt-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-[#854d0e] uppercase tracking-wide">Extra / Unscheduled Cheques</p>
                  {orphans.map(c => (
                    <div key={c.id} className="flex items-center gap-2 bg-white border border-[#fde68a] rounded-lg px-3 py-2">
                      <CreditCard size={11} className="text-[#f59e0b] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-[#1a1916]">{c.chequeSerial} · {c.bankName}</p>
                        <p className="text-[10px] text-[#9b9890]">AED {(c.amountFils / 100).toLocaleString('en-AE')} · Due {c.dueDate} {c.notes ? `· ${c.notes}` : ''}</p>
                      </div>
                      <button onClick={() => handleDeleteCheque(c.id)} className="text-[#c8c6c0] hover:text-red-500 transition-colors cursor-pointer shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}

            {chequeError && (
              <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{chequeError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                disabled={confirmingCollection || cheques.length === 0}
                onClick={handleConfirmCollected}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-[#2e9f82] text-white font-semibold hover:bg-[#1f6655] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {confirmingCollection ? <Loader2 size={11} className="animate-spin" /> : <BadgeCheck size={12} />}
                Confirm All Collected
              </button>
              <button onClick={() => setPanel('none')} className="text-xs px-4 py-2 rounded-lg bg-white border border-[#fde68a] text-[#854d0e] hover:bg-[#fef9c3] transition-colors cursor-pointer">
                Close
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Notify Guard panel ── */}
      {panel === 'guard' && viewing && (
        <div className="border-t border-[#fef3c7] bg-[#fffbeb] px-5 py-4">
          <p className="text-xs font-semibold text-[#92400e] mb-1 flex items-center gap-1.5">
            <ShieldAlert size={12} className="text-[#f59e0b]" /> Notify Security Guard
          </p>
          <p className="text-[11px] text-[#b45309] mb-4">
            Viewing at {unitLabel ?? 'unit'}{building ? ` · ${building}` : ''} — {fmtDateTime(viewing.scheduledAt)}
          </p>

          <div className="mb-3">
            <label className="block text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">Guard Phone or Email <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={guardContact}
              onChange={e => setGuardContact(e.target.value)}
              placeholder="+971 50 123 4567 or guard@building.ae"
              className="w-full text-xs border border-[#fde68a] rounded-lg px-3 py-2 focus:outline-none focus:border-[#f59e0b] bg-white text-[#1a1916]"
            />
          </div>

          <div className="mb-4">
            <label className="block text-[10px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">Message <span className="font-normal normal-case">(editable)</span></label>
            <textarea
              value={guardMsg}
              onChange={e => setGuardMsg(e.target.value)}
              rows={5}
              className="w-full text-xs border border-[#fde68a] rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:border-[#f59e0b] bg-white text-[#3d3b35] leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {/* WhatsApp */}
            {guardContact.replace(/\D/g, '').length >= 8 && (
              <a
                href={`https://wa.me/${guardContact.replace(/\D/g, '')}?text=${encodeURIComponent(guardMsg)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg text-white cursor-pointer"
                style={{ backgroundColor: '#25d366' }}
              >
                <Phone size={12} /> WhatsApp
              </a>
            )}
            {/* Email */}
            {guardContact.includes('@') && (
              <a
                href={`mailto:${guardContact}?subject=${encodeURIComponent(`Viewing Alert — ${unitLabel ?? 'Unit'} on ${fmtDateTime(viewing.scheduledAt)}`)}&body=${encodeURIComponent(guardMsg)}`}
                className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg text-white cursor-pointer"
                style={{ backgroundColor: '#2e9f82' }}
              >
                <Mail size={12} /> Send Email
              </a>
            )}
            {/* Copy */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(guardMsg).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg border border-[#fde68a] text-[#92400e] hover:bg-[#fef3c7] transition-colors cursor-pointer"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy Message'}
            </button>
          </div>
        </div>
      )}

      {/* ── Reject document dialog ── */}
      {rejectingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setRejectingDoc(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[#fee2e2] shrink-0">
                <X size={16} className="text-[#b91c1c]" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#1a1916]">Reject Document</p>
                <p className="text-[11px] text-[#9b9890] mt-0.5">{rejectingDoc.label}</p>
              </div>
            </div>
            <label className="block text-[11px] font-semibold text-[#3d3b35] mb-1.5">
              Reason <span className="font-normal text-[#9b9890]">(optional — customer will see this)</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Document is blurry, please re-upload a clearer copy"
              rows={3}
              className="w-full text-xs border border-[#e8e6e0] rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-[#b91c1c] text-[#1a1916] placeholder:text-[#c8c6c0]"
            />
            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => setRejectingDoc(null)}
                className="flex-1 text-xs font-semibold px-4 py-2.5 rounded-xl border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] transition-colors cursor-pointer">
                Cancel
              </button>
              <button
                disabled={docActioning === rejectingDoc.id}
                onClick={async () => {
                  const { id, label: _l } = rejectingDoc;
                  setRejectingDoc(null);
                  await handleRejectDoc(id, rejectReason);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl bg-[#b91c1c] hover:bg-[#991b1b] text-white disabled:opacity-50 transition-colors cursor-pointer">
                {docActioning === rejectingDoc.id
                  ? <><Loader2 size={12} className="animate-spin" /> Rejecting…</>
                  : <><X size={12} /> Reject Document</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Document viewer modal ── */}
      {(() => {
        const KYC_1  = new Set(['emirates_id', 'passport', 'uae_visa']);
        const RENTAL = new Set(['employment_letter','bank_statement','marriage_certificate','rental_history','credit_report','utility_clearance','trade_license','tax_registration','moa','business_license','utility_proof_of_payment']);
        const allDocs = (tenantDocs ?? []).filter(d => d.documentKey !== 'profile_picture');

        // Build ordered flat list of image-only docs for lightbox navigation
        const imgDocs = allDocs.filter(d => {
          const up = d.fileUrl.split('?')[0].toLowerCase();
          const isPdf = d.mimeType === 'application/pdf' || up.endsWith('.pdf');
          return !isPdf && (d.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(up));
        });
        const lightboxSlides = imgDocs.map(d => ({
          src: d.fileUrl,
          title: d.displayName ?? d.documentKey.replace(/_\d+$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: d.status === 'processed' ? '✓ Approved' : d.status === 'rejected' ? '✗ Rejected' : 'Uploaded',
        }));

        if (!viewAllOpen) {
          // Lightbox can still be open (opened from within modal, then modal closed) — keep it mounted
          return lightboxOpen ? (
            <Lightbox
              open={lightboxOpen}
              close={() => setLightboxOpen(false)}
              index={lightboxIndex}
              slides={lightboxSlides}
              plugins={[Zoom, Captions, Thumbnails]}
              zoom={{ maxZoomPixelRatio: 4 }}
              captions={{ showToggle: true }}
            />
          ) : null;
        }

        // Group docs for the panel
        const occ1   = allDocs.filter(d => KYC_1.has(d.documentKey));
        const rental = allDocs.filter(d => RENTAL.has(d.documentKey));
        const extraMap = new Map<number, TenantDoc[]>();
        const other: TenantDoc[] = [];
        for (const d of allDocs) {
          const m = d.documentKey.match(/^(emirates_id|passport|uae_visa)_(\d+)$/);
          if (m) { const n = parseInt(m[2]); if (!extraMap.has(n)) extraMap.set(n, []); extraMap.get(n)!.push(d); }
          else if (!KYC_1.has(d.documentKey) && !RENTAL.has(d.documentKey)) other.push(d);
        }
        type DocGroup = { heading: string; sub?: string; docs: TenantDoc[] };
        const groups: DocGroup[] = [];
        if (occ1.length)   groups.push({ heading: 'Occupant 1 — Identity', docs: occ1 });
        [...extraMap.keys()].sort((a,b) => a-b).forEach(n =>
          groups.push({ heading: `Occupant ${n} — Identity`, sub: 'optional', docs: extraMap.get(n)! })
        );
        if (rental.length) groups.push({ heading: 'Rental Documents', docs: rental });
        if (other.length)  groups.push({ heading: 'Other', docs: other });

        const tenantName = lead.convertedTenant?.user?.name?.trim() || lead.customerName || '—';
        const unitLabel  = lead.unit?.unitName ?? (lead.unit ? `Unit ${lead.unit.unitNumber}` : '—');

        function StatusChip({ status }: { status: string }) {
          if (status === 'processed') return <span className="text-[9px] font-bold bg-[#dcfce7] text-[#16a34a] rounded px-1.5 py-0.5">Approved</span>;
          if (status === 'rejected')  return <span className="text-[9px] font-bold bg-[#fee2e2] text-[#b91c1c] rounded px-1.5 py-0.5">Rejected</span>;
          return <span className="text-[9px] font-bold bg-[#f4f3ef] text-[#6b6860] rounded px-1.5 py-0.5">Uploaded</span>;
        }

        function DocEntry({ doc }: { doc: TenantDoc }) {
          const label = doc.displayName ?? doc.documentKey.replace(/_\d+$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const urlPath = doc.fileUrl.split('?')[0].toLowerCase();
          const isPdf = doc.mimeType === 'application/pdf' || urlPath.endsWith('.pdf');
          const isImg = !isPdf && (doc.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(urlPath));
          const imgIdx = isImg ? imgDocs.findIndex(d => d.id === doc.id) : -1;
          return (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[12px] font-semibold text-[#1a1916]">{label}</span>
                <StatusChip status={doc.status} />
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-[10px] text-[#2e9f82] hover:underline shrink-0">
                  Open <ExternalLink size={10} />
                </a>
              </div>
              {isPdf ? (
                <iframe src={doc.fileUrl} className="w-full h-[480px] rounded-xl border border-[#e8e6e0]" />
              ) : isImg ? (
                /* Clickable thumbnail → opens YALR lightbox with zoom/nav */
                <button type="button" onClick={() => { setLightboxIndex(imgIdx); setLightboxOpen(true); }}
                  className="group relative block w-full rounded-xl overflow-hidden border border-[#e8e6e0] bg-[#f8f7f4] cursor-zoom-in">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={doc.fileUrl} alt={label} loading="lazy"
                    className="max-h-[320px] w-full object-contain block transition-transform duration-200 group-hover:scale-[1.02]" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                    <span className="bg-white/90 rounded-full p-2 shadow"><ZoomIn size={18} className="text-[#1a1916]" /></span>
                  </div>
                </button>
              ) : (
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-[#2e9f82] hover:underline">
                  <FileText size={14} /> Open file
                </a>
              )}
            </div>
          );
        }

        return (
          <>
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8 px-4"
              onClick={(e) => { if (e.target === e.currentTarget) setViewAllOpen(false); }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl">
                {/* Header */}
                <div className="sticky top-0 bg-white rounded-t-2xl border-b border-[#e8e6e0] px-6 py-4 flex items-center justify-between z-10">
                  <div>
                    <p className="text-sm font-bold text-[#1a1916]">{tenantName}</p>
                    <p className="text-[11px] text-[#9b9890]">{unitLabel} · {allDocs.length} document{allDocs.length !== 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={() => setViewAllOpen(false)}
                    className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-[#f4f3ef] text-[#6b6860] transition-colors cursor-pointer">
                    <X size={16} />
                  </button>
                </div>
                {/* Content */}
                <div className="px-6 py-6 space-y-8">
                  {groups.map((g, gi) => (
                    <section key={gi}>
                      <div className="flex items-baseline gap-2 mb-4 border-b-2 border-[#2e9f82] pb-1.5">
                        <h2 className="text-[13px] font-bold text-[#1a1916]">{g.heading}</h2>
                        {g.sub && <span className="text-[10px] text-[#9b9890]">{g.sub}</span>}
                      </div>
                      {g.docs.map(doc => <DocEntry key={doc.id} doc={doc} />)}
                    </section>
                  ))}
                </div>
              </div>
            </div>
            {/* Lightbox — rendered outside the scrollable modal so z-index stacks correctly */}
            <Lightbox
              open={lightboxOpen}
              close={() => setLightboxOpen(false)}
              index={lightboxIndex}
              slides={lightboxSlides}
              plugins={[Zoom, Captions, Thumbnails]}
              zoom={{ maxZoomPixelRatio: 4 }}
              captions={{ showToggle: true }}
            />
          </>
        );
      })()}
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads]           = useState<ApiLead[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [activeTab, setActiveTab]   = useState<'all' | LeadStage>('all');
  const [movingLead, setMovingLead] = useState<number | null>(null);
  const [feeRules, setFeeRules]         = useState<FeeRulesMap | null>(null);
  const [preferredStartDays, setPreferredStartDays] = useState<number[]>([]);

  const fetchLeads = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/leads', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load leads (${res.status})`);
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // Re-fetch when the tab regains focus so RP always sees tenant's latest submission
  useEffect(() => {
    const onFocus = () => fetchLeads();
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
      .then((data: { profile?: { preferredStartDays?: number[] | null } } | null) => {
        if (Array.isArray(data?.profile?.preferredStartDays)) {
          setPreferredStartDays(data!.profile!.preferredStartDays!);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => { setSearch(''); }, [activeTab]);

  async function moveStage(leadId: number, stage: LeadStage) {
    setMovingLead(leadId);
    try {
      await fetch(`/api/leads/${leadId}/stage`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage } : l));
    } finally { setMovingLead(null); }
  }

  function handleConvert(lead: ApiLead) {
    const name = encodeURIComponent(lead.convertedTenant?.user?.name ?? lead.customerName ?? '');
    // Prefer the payment plan's first_bundle date (the agreed start date) over the
    // tenant's original desiredMoveIn (just their initial preference at viewing time).
    const planStart = lead.paymentPlan?.items?.find(it => it.type === 'first_bundle')?.dueDate
      ?? lead.paymentPlan?.items?.slice().sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]?.dueDate;
    const startDate = planStart ?? lead.viewings?.find(v => v.desiredMoveIn)?.desiredMoveIn ?? '';
    const startParam  = startDate ? `&startDate=${startDate}` : '';
    const chequeParam = lead.paymentPlan?.chequeCount ? `&chequeCount=${lead.paymentPlan.chequeCount}` : '';
    router.push(
      `/rental-provider/dashboard/contracts/new?unitId=${lead.unit?.id}&tenantId=${lead.convertedTenant?.id}&leadId=${lead.id}&tenantName=${name}${startParam}${chequeParam}`,
    );
  }

  const tabCount = (key: 'all' | LeadStage) =>
    key === 'all' ? leads.length : leads.filter(l => l.stage === key).length;

  const filtered = leads.filter(l => {
    if (activeTab !== 'all' && l.stage !== activeTab) return false;
    if (search) {
      const q    = search.toLowerCase();
      const name = (l.convertedTenant?.user?.name ?? l.customerName).toLowerCase();
      const unit = (l.unit?.unitName ?? l.unit?.unitNumber ?? '').toLowerCase();
      const bldg = (l.unit?.property?.buildingName ?? '').toLowerCase();
      const eml  = (l.leadEmail ?? l.convertedTenant?.user?.email ?? '').toLowerCase();
      const ph   = (l.leadPhone ?? '').toLowerCase();
      if (![name, unit, bldg, eml, ph].some(f => f.includes(q))) return false;
    }
    return true;
  });

  return (
    <div className="p-5 sm:p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Leads</h1>
          <p className="text-sm text-[#9b9890] mt-0.5">
            {leads.length} lead{leads.length !== 1 ? 's' : ''} in pipeline
          </p>
        </div>
        <button
          onClick={fetchLeads}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-[#2e9f82] border border-[#2e9f82] rounded-lg px-4 py-2 hover:bg-[#f0fdf4] transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Stage tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-5 scrollbar-none">
        {TABS.map(tab => {
          const count    = tabCount(tab.key);
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-[#1a1916] text-white'
                  : 'bg-white text-[#6b6860] border border-[#e8e6e0] hover:bg-[#f4f3ef]'
              }`}
            >
              {tab.label}
              {!loading && (
                <span className={`rounded-full px-1.5 py-0.5 font-bold text-[10px] ${
                  isActive ? 'bg-white/20 text-white' : 'bg-[#f0ede8] text-[#9b9890]'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

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
          <p className="text-xs text-[#9b9890]">Leads appear when customers book viewings on your units.</p>
        </div>
      )}

      {!loading && leads.length > 0 && filtered.length === 0 && (
        <div className="bg-white rounded-xl p-10 flex flex-col items-center text-center border border-[#ede9e3]">
          <p className="text-sm text-[#9b9890]">No leads match your search.</p>
          <button onClick={() => setSearch('')} className="mt-2 text-xs text-[#2e9f82] hover:underline cursor-pointer">Clear</button>
        </div>
      )}

      {/* List */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(lead => (
            <LeadRow
              key={`${lead.id}-${lead.updatedAt}`}
              lead={lead}
              onMoveStage={moveStage}
              moving={movingLead === lead.id}
              onConvert={handleConvert}
              setLeads={setLeads}
              feeRules={feeRules}
              preferredStartDays={preferredStartDays}
            />
          ))}
        </div>
      )}
    </div>
  );
}
