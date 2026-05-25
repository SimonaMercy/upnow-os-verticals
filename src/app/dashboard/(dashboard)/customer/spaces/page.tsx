/**
 * Customer — My Spaces page (dashboard/customer/spaces)
 *
 * Central page for the tenant's rental journey. Renders:
 *   - Active viewings calendar
 *   - Direct leads (inquiries not yet converted to a contract)
 *   - Active/past tenancy spaces with full contract context
 *   - DocumentsStatusBanner — compact chip linking to /dashboard/customer/documents
 *
 * CID-328-FE: Document uploads now live at /dashboard/customer/documents
 * (Unified Document Hub). The contract detail page (contracts/[id]) is
 * intentionally read-only for documents. See AGENTS.md §9a, CID-326-FE / CID-327-FE.
 *
 * DocumentsStatusBanner fetches /api/documents/my and shows upload progress
 * with a "Manage Documents →" link to the document hub.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getRequiredDocs, getRenewalRequiredDocs, KYC_DOCS, getRentalSectionDocs, getOccupantDocs, deriveOccupantCount } from '@/lib/docRequirements';
import type { DocReq } from '@/lib/docRequirements';
import {
  Calendar, Clock, MapPin, X, CheckCircle2, Ban, Home,
  ChevronLeft, ChevronRight, ChevronDown, ThumbsDown, Pencil,
  Building2, FileText, ArrowRight, Loader2, AlertCircle, Info,
  BedDouble, DollarSign, CheckCheck, CreditCard, ClipboardList,
  User, FileSignature, BadgeCheck, RotateCcw, UploadCloud, ExternalLink, AlertTriangle, Clock as ClockIcon, Printer,
} from 'lucide-react';

/* ──────────────────────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────────────────────── */

interface SpaceUnit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType?: string | null;
  bedrooms?: number | null;
  marketPrice?: number | null;
  rentalPrice?: number | null;
  property?: {
    id: number;
    buildingName: string;
    fullAddress: string | null;
    emirate?: { name: string } | null;
    community?: { name: string } | null;
    rentalProvider?: { id: number; companyName: string | null; user?: { name?: string | null } | null; preferredStartDays?: number[] | null } | null;
    rental_provider?: { id: number; companyName: string | null; user?: { name?: string | null } | null; preferredStartDays?: number[] | null } | null;
  };
}

interface PaymentPlanItem {
  index: number;
  amountFils: number;
  dueDate: string;
  description?: string;
  type?: 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
}

// Sort cheque schedule by due date — the natural order tenants write/post cheques in.
// Same-date tiebreaker: bundle → installment → extra → security deposit (deposit always last
// when it shares a date with a rent row).
const PLAN_TYPE_ORDER: Record<string, number> = {
  first_bundle: 0,
  installment: 1,
  extra_installment: 2,
  security_deposit: 3,
};
function sortPlanItems(items: PaymentPlanItem[]): PaymentPlanItem[] {
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
  issuedAt: string;
}

interface Lead {
  id: number;
  stage: string;
  additionalDocsNote?: string | null;
  paymentPlan?: PaymentPlan | null;
}

interface Viewing {
  id: number;
  scheduledAt: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  notes: string | null;
  outcome: string | null;
  preferredChequeCount: number | null;
  desiredMoveIn: string | null;
  paymentType: string | null;
  unit: SpaceUnit | null;
  lead: Lead | null;
}

interface DirectLead {
  id: number;
  stage: string;
  additionalDocsNote?: string | null;
  paymentPlan?: PaymentPlan | null;
  unit: SpaceUnit | null;
  createdAt: string;
}

interface TenantContract {
  id: number;
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
  tenantSignedAt: string | null;
  unit: { id: number | null };
  // Renewal state — surfaced by listForTenant so we can swap the right column to the renewal timeline
  // and so the helpers (`pickPrimaryContract`, the renewal pill on the tile) can read it.
  renewalAccepted?: 'pending' | 'accepted' | 'rejected' | null;
  renewalStatus?: string | null;
  moveInInspection?: { submitted: boolean; signedByTenant: boolean; signedAt: string | null } | null;
  moveOutInspection?: { submitted: boolean; signedByTenant: boolean; signedAt: string | null } | null;
}

interface ContractDraft {
  unitId: number;
  contractStartDate: string;
  contractEndDate: string;
  annualRent: string;
  modeOfPayment: string;
  numberOfInstallments: string;
  securityDepositAmount: string;
}

interface FullContractDoc {
  id: number; category: string; documentKey: string;
  displayName: string | null; fileUrl: string; status: string;
  expiryDate: string | null; isVisibleToTenant: boolean;
}
interface FullContractPayment {
  id: number; description: string | null; paymentType: string | null;
  amount: number; chequeNumber: string | null; chequeStatus: string;
  transactionDate: string | null;
}
interface FullContractSig {
  id: number; role: string; signatoryName: string; signedAt: string;
}
interface FullContractSecurityDeposit {
  id: number; amountOnCheck: number | null; amountOnReceipt: number | null;
  nameOnCheck: string | null; checkNumber: string | null;
  depositStatus: string | null; fromYear: number | null; toYear: number | null;
}
interface FullContractDetail {
  id: number; ref: string; status: string; ejariStatus: string | null; utilityStatus: string | null;
  startDate: string; endDate: string; annualRent: number;
  contractValue: number | null;
  adminFeeFils: number; ejariFeeFils: number;
  securityDepositAmount: number | null; numberOfInstallments: number | null;
  modeOfPayment: string | null; customClauses: string[]; notes: string | null;
  // Renewal — SCRUM-272/273
  renewalAccepted: 'pending' | 'accepted' | 'rejected' | null;
  renewalStatus: string | null;
  termination?: {
    requestedByRole: 'tenant' | 'rental_provider' | null;
    requestedAt: string | null;
    reason: string | null;
    effectiveDate: string | null;
    response: 'pending' | 'accepted' | 'rejected' | null;
    respondedAt: string | null;
  } | null;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null };
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null };
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
  unit: { number: string | null; name: string | null; type: string | null; floor: string | null; bedrooms: number | null };
  documents: FullContractDoc[];
  payments: FullContractPayment[];
  securityDeposits: FullContractSecurityDeposit[];
  signatures: FullContractSig[];
}


/* ──────────────────────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────────────────────── */

const PAYMENT_METHODS = [
  { value: 'cheque', label: 'Post-Dated Cheques' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online Payment' },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
}

/**
 * Pick the contract to surface as the tenant's "current contract" for a unit.
 *
 * When a renewal is in flight there can be TWO rows for the same unit:
 *   • original (contract_type='new', status='active', renewal_accepted='pending')
 *   • renewal child (contract_type='renewal', status='pending', parent_contract_id=:original)
 *
 * The tenant should keep seeing the ORIGINAL contract as their active tenancy —
 * the renewal child surfaces as a "Renewal Offered" card inside the same tile.
 * So: prefer non-renewal contracts; among those prefer active > issued > others.
 */
function pickPrimaryContract(contracts: TenantContract[], unitId: number | null | undefined): TenantContract | undefined {
  if (!unitId) return undefined;
  const onUnit = contracts.filter(c => c.unit?.id === unitId);
  if (onUnit.length === 0) return undefined;
  const nonRenewal = onUnit.filter(c => c.contractType !== 'renewal' && !c.parentContractId);
  const pool = nonRenewal.length > 0 ? nonRenewal : onUnit;
  const rank = (s: string) => (s === 'active' ? 0 : s === 'issued' ? 1 : s === 'pending' ? 2 : 3);
  return [...pool].sort((a, b) => rank(a.status) - rank(b.status))[0];
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
}
function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}
function addMonths(dateStr: string, months: number) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Mini Calendar
────────────────────────────────────────────────────────────────────────────── */

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS_LABEL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function MiniCalendar({ value, onChange, minDate }: { value: string; onChange: (v: string) => void; minDate?: string }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const min = minDate ? new Date(minDate + 'T00:00:00') : today;
  const selected = value ? new Date(value + 'T00:00:00') : null;
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const first = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div className="rounded-2xl border border-[#e8e6e0] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-[#f9f8f6]">
        <button type="button" onClick={() => setCursor(c => { const m = c.month === 0 ? 11 : c.month - 1; return { year: c.month === 0 ? c.year - 1 : c.year, month: m }; })} className="p-1.5 rounded-lg hover:bg-[#e8e6e0] cursor-pointer">
          <ChevronLeft size={15} className="text-[#6b6860]" />
        </button>
        <span className="text-sm font-semibold text-[#1a1916]">{MONTHS_LABEL[cursor.month]} {cursor.year}</span>
        <button type="button" onClick={() => setCursor(c => { const m = c.month === 11 ? 0 : c.month + 1; return { year: c.month === 11 ? c.year + 1 : c.year, month: m }; })} className="p-1.5 rounded-lg hover:bg-[#e8e6e0] cursor-pointer">
          <ChevronRight size={15} className="text-[#6b6860]" />
        </button>
      </div>
      <div className="grid grid-cols-7 border-b border-[#e8e6e0]">
        {DAYS.map(d => <div key={d} className="text-center text-xs font-medium py-2 text-[#9b9890]">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 p-2 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const cell = new Date(cursor.year, cursor.month, day);
          const disabled = cell < min;
          const iso = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
          const isSel = selected?.getFullYear() === cursor.year && selected?.getMonth() === cursor.month && selected?.getDate() === day;
          const isToday = cell.getTime() === today.getTime();
          return (
            <button key={i} type="button" disabled={disabled} onClick={() => onChange(iso)}
              className="text-xs rounded-lg py-1.5 w-full text-center transition-all cursor-pointer"
              style={{ backgroundColor: isSel ? '#2e9f82' : isToday && !isSel ? '#edf7f3' : 'transparent', color: isSel ? '#fff' : disabled ? '#c8c6c0' : '#1a1916', fontWeight: isSel || isToday ? 600 : 400, cursor: disabled ? 'not-allowed' : 'pointer' }}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Reschedule Modal
────────────────────────────────────────────────────────────────────────────── */

const TIME_SLOTS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
function fmtSlot(t: string) {
  const [h] = t.split(':').map(Number);
  return `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
}

function RescheduleModal({ viewing, onClose, onSuccess }: { viewing: Viewing; onClose: () => void; onSuccess: () => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleSave() {
    if (!date) { setError('Please pick a date.'); return; }
    setSaving(true); setError(null);
    try {
      const scheduledAt = new Date(`${date}T${time || '10:00'}:00`).toISOString();
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}/reschedule`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduledAt }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.message ?? 'Failed'); return; }
      onSuccess();
    } finally { setSaving(false); }
  }
  const unitLabel = viewing.unit?.unitName ?? (viewing.unit ? `Unit ${viewing.unit.unitNumber}` : 'Property');
  const building = viewing.unit?.property?.buildingName ?? '';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl p-7 w-full max-w-md shadow-xl overflow-y-auto max-h-[90vh]">
        <button className="absolute top-4 right-4 text-[#9b9890] hover:text-[#1a1916] cursor-pointer" onClick={onClose}><X size={20} /></button>
        <h3 className="font-bold text-xl text-[#1a1916] mb-0.5">Reschedule Viewing</h3>
        <p className="text-sm text-[#9b9890] mb-5">{unitLabel}{building ? ` · ${building}` : ''}</p>
        {error && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}
        <label className="block text-sm font-medium text-[#3d3b35] mb-2">Pick a new date</label>
        <MiniCalendar value={date} onChange={setDate} />
        <label className="block text-sm font-medium text-[#3d3b35] mt-4 mb-2">Preferred time <span className="text-[#9b9890] font-normal">(optional)</span></label>
        <div className="grid grid-cols-5 gap-2 mb-6">
          {TIME_SLOTS.map(slot => (
            <button key={slot} type="button" onClick={() => setTime(time === slot ? '' : slot)}
              className="py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer"
              style={{ borderColor: time === slot ? '#2e9f82' : '#e8e6e0', backgroundColor: time === slot ? '#edf7f3' : '#fff', color: time === slot ? '#2e9f82' : '#3d3b35' }}>
              {fmtSlot(slot)}
            </button>
          ))}
        </div>
        <button disabled={!date || saving} onClick={handleSave}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 cursor-pointer"
          style={{ backgroundColor: '#2e9f82' }}>
          {saving ? 'Saving…' : 'Confirm New Time'}
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Not Interested Modal
────────────────────────────────────────────────────────────────────────────── */

function NotInterestedModal({ viewing, onClose, onSuccess }: { viewing: Viewing; onClose: () => void; onSuccess: () => void }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleSubmit() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}/not-interested`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: notes.trim() || undefined }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.message ?? 'Something went wrong'); return; }
      onSuccess();
    } finally { setSaving(false); }
  }
  const unitLabel = viewing.unit?.unitName ?? (viewing.unit ? `Unit ${viewing.unit.unitNumber}` : 'this property');
  const building = viewing.unit?.property?.buildingName ?? '';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl p-7 w-full max-w-sm shadow-xl">
        <button className="absolute top-4 right-4 text-[#9b9890] hover:text-[#1a1916] cursor-pointer" onClick={onClose}><X size={20} /></button>
        <div className="w-11 h-11 rounded-full bg-[#fee2e2] flex items-center justify-center mb-4">
          <ThumbsDown size={18} className="text-[#b91c1c]" />
        </div>
        <h3 className="font-bold text-lg text-[#1a1916] mb-1">Not interested?</h3>
        <p className="text-sm text-[#6b6860] mb-4">{unitLabel}{building ? ` · ${building}` : ''} will be removed from your active spaces.</p>
        {error && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}
        <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">Notes <span className="text-[#9b9890] font-normal">(optional)</span></label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="e.g. Too far from work, price too high…" className="w-full text-sm mb-5 border border-[#e8e6e0] rounded-xl px-3 py-2.5 text-[#1a1916] resize-none focus:outline-none focus:ring-2 focus:ring-[#e8e6e0]" />
        <button disabled={saving} onClick={handleSubmit} className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-[#b91c1c] hover:bg-red-700 disabled:opacity-50 transition-colors cursor-pointer">
          {saving ? 'Saving…' : 'Mark as Not Interested'}
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Contract Form (inline, shown after tenant confirms reservation)
────────────────────────────────────────────────────────────────────────────── */

function ContractForm({ unit, onSuccess, onCancel }: { unit: SpaceUnit; onSuccess: (contractId: number) => void; onCancel: () => void }) {
  const annualPrice = unit.rentalPrice ?? unit.marketPrice ?? 0;
  const [form, setForm] = useState<ContractDraft>({
    unitId: unit.id,
    contractStartDate: '',
    contractEndDate: '',
    annualRent: annualPrice > 0 ? String(annualPrice) : '',
    modeOfPayment: 'cheque',
    numberOfInstallments: '4',
    securityDepositAmount: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof ContractDraft, v: string) {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'contractStartDate' && v && !f.contractEndDate) {
        next.contractEndDate = addMonths(v, 12);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (!form.contractStartDate || !form.contractEndDate) { setError('Please select contract start and end dates.'); return; }
    if (!form.annualRent || Number(form.annualRent) <= 0) { setError('Please enter the annual rent.'); return; }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        unitId: unit.id,
        contractStartDate: form.contractStartDate,
        contractEndDate: form.contractEndDate,
        annualRent: Number(form.annualRent),
        modeOfPayment: form.modeOfPayment,
      };
      if (form.numberOfInstallments) body.numberOfInstallments = Number(form.numberOfInstallments);
      if (form.securityDepositAmount) body.securityDepositAmount = Number(form.securityDepositAmount);
      const res = await fetch('/api/contracts/tenant/initiate', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.message ?? 'Failed to create contract'); return; }
      onSuccess(data.id);
    } finally { setSaving(false); }
  }

  return (
    <div className="border-t border-[#e8f7f1] bg-[#f7fdfb] px-5 py-5">
      <div className="flex items-center gap-2 mb-5">
        <FileText size={15} className="text-[#2e9f82]" />
        <p className="text-sm font-bold text-[#1a1916]">Confirm Your Reservation Details</p>
      </div>

      {error && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Start date */}
        <div>
          <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Tenancy Start Date <span className="text-red-500">*</span></label>
          <MiniCalendar value={form.contractStartDate} onChange={v => set('contractStartDate', v)} />
          {form.contractStartDate && <p className="mt-1.5 text-xs text-center text-[#2e9f82] font-medium">{new Date(form.contractStartDate + 'T00:00:00').toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>}
        </div>
        {/* End date */}
        <div>
          <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Tenancy End Date <span className="text-red-500">*</span></label>
          <MiniCalendar value={form.contractEndDate} onChange={v => set('contractEndDate', v)} minDate={form.contractStartDate || undefined} />
          {form.contractEndDate && <p className="mt-1.5 text-xs text-center text-[#2e9f82] font-medium">{new Date(form.contractEndDate + 'T00:00:00').toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Annual rent */}
        <div>
          <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Annual Rent (AED) <span className="text-red-500">*</span></label>
          <div className="relative">
            <DollarSign size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
            <input type="number" min="1" value={form.annualRent} onChange={e => set('annualRent', e.target.value)}
              placeholder="e.g. 120000"
              className="w-full pl-8 pr-3 py-2.5 text-sm border border-[#e8e6e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 text-[#1a1916]" />
          </div>
          {form.annualRent && Number(form.annualRent) > 0 && <p className="mt-1 text-xs text-[#6b6860]">{fmtAed(Number(form.annualRent))} / year</p>}
        </div>
        {/* Security deposit */}
        <div>
          <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Security Deposit (AED) <span className="text-[#9b9890] font-normal">(optional)</span></label>
          <div className="relative">
            <DollarSign size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
            <input type="number" min="0" value={form.securityDepositAmount} onChange={e => set('securityDepositAmount', e.target.value)}
              placeholder="e.g. 10000"
              className="w-full pl-8 pr-3 py-2.5 text-sm border border-[#e8e6e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 text-[#1a1916]" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {/* Payment method */}
        <div>
          <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Payment Method</label>
          <select value={form.modeOfPayment} onChange={e => set('modeOfPayment', e.target.value)}
            className="w-full py-2.5 px-3 text-sm border border-[#e8e6e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 text-[#1a1916] bg-white">
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        {/* Installments */}
        <div>
          <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">No. of Cheques / Installments</label>
          <select value={form.numberOfInstallments} onChange={e => set('numberOfInstallments', e.target.value)}
            className="w-full py-2.5 px-3 text-sm border border-[#e8e6e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 text-[#1a1916] bg-white">
            {[1,2,3,4,6,12].map(n => <option key={n} value={n}>{n} {n === 1 ? 'cheque' : 'cheques'}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-3">
        <button disabled={saving} onClick={handleSubmit}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-all cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #2e9f82 0%, #1f6655 100%)', boxShadow: '0 4px 14px rgba(46,159,130,0.30)' }}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCheck size={15} />}
          {saving ? 'Submitting…' : 'Submit Reservation Request'}
        </button>
        <button onClick={onCancel} className="px-5 py-3 rounded-xl text-sm font-medium text-[#6b6860] border border-[#e8e6e0] hover:bg-[#f4f3f0] transition-colors cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Journey step tracker component
────────────────────────────────────────────────────────────────────────────── */

interface StepDef { key: string; label: string; icon: React.ElementType }

function StepTracker({ steps, currentStep }: { steps: StepDef[]; currentStep: number }) {
  return (
    <div className="flex items-center px-5 pb-4">
      {steps.map((step, i) => {
        const done = i <= currentStep;
        const active = i === currentStep;
        const Icon = step.icon;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 min-w-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${done ? 'bg-[#2e9f82] text-white' : 'bg-[#f4f3ef] text-[#c5c2bb]'} ${active ? 'ring-2 ring-[#2e9f82] ring-offset-1' : ''}`}>
                <Icon size={14} />
              </div>
              <span className={`text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap ${done ? 'text-[#2e9f82]' : 'text-[#c5c2bb]'}`}>{step.label}</span>
            </div>
            {i < steps.length - 1 && <div className={`flex-1 h-0.5 mb-4 mx-1 ${i < currentStep ? 'bg-[#2e9f82]' : 'bg-[#e8e6e0]'}`} />}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   StepRow + Tenancy Journey Panel (6-step, mirrors RP page)
────────────────────────────────────────────────────────────────────────────── */

type TLState = 'done' | 'current' | 'upcoming';

function StepRow({ num, label, state, last, children }: {
  num: number; label: string; state: TLState; last: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 text-[10px] font-bold shrink-0 ${
          state === 'done'    ? 'bg-[#2e9f82] border-[#2e9f82] text-white' :
          state === 'current' ? 'bg-white border-[#2e9f82] text-[#2e9f82]' :
                                'bg-white border-[#e8e6e0] text-[#c0bdb8]'
        }`}>{state === 'done' ? '✓' : num}</div>
        {!last && <div className={`w-0.5 flex-1 min-h-[14px] mt-1 mb-1 ${state === 'done' ? 'bg-[#2e9f82]' : 'bg-[#e8e6e0]'}`} />}
      </div>
      <div className={`flex-1 min-w-0 ${last ? 'pb-1' : 'pb-3'}`}>
        <p className={`text-[13px] font-semibold leading-tight ${
          state === 'done'    ? 'text-[#2e9f82]' :
          state === 'current' ? 'text-[#1a1916]' : 'text-[#c0bdb8]'
        }`}>{label}</p>
        {children}
      </div>
    </div>
  );
}


/* ─── Compact doc row for inline uploads inside the journey panel ────────── */
type InlineDoc = { id: number; documentKey: string; status?: string; fileUrl?: string };
function InlineDocRow({
  req, docRecord, uploading, onUpload,
}: {
  req: DocReq;
  docRecord: InlineDoc | undefined;
  uploading: boolean;
  onUpload: (req: DocReq, file: File, existingId?: number) => void;
}) {
  const uploaded   = !!docRecord && docRecord.status !== 'pending';
  const isRejected = docRecord?.status === 'rejected';
  const isApproved = docRecord?.status === 'complete' || docRecord?.status === 'processed';
  const isPending  = uploaded && !isRejected && !isApproved;
  const needsUpload = !uploaded || isRejected;

  return (
    <div className={[
      'rounded-lg px-2.5 py-2 flex items-center gap-2',
      isRejected    ? 'bg-[#fff1f2] border border-[#fecaca]'
      : needsUpload && req.required ? 'bg-[#fffbeb] border border-[#fde68a]'
      : isPending   ? 'bg-[#eff6ff] border border-[#bfdbfe]'
      : isApproved  ? 'bg-[#f0faf6] border border-[#bbf7d0]'
      : 'bg-[#f9f8f6] border border-[#e8e6e0] opacity-75',
    ].join(' ')}>
      <div className="shrink-0">
        {isApproved  && <CheckCircle2 size={12} className="text-[#16a34a]" />}
        {isPending   && <Clock size={12} className="text-[#2563eb]" />}
        {isRejected  && <AlertCircle size={12} className="text-[#ef4444]" />}
        {!uploaded   && <UploadCloud size={12} className={req.required ? 'text-[#d97706]' : 'text-[#c5c3bc]'} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-semibold truncate ${
          isRejected ? 'text-[#b91c1c]'
          : needsUpload && req.required ? 'text-[#92400e]'
          : isApproved ? 'text-[#166534]'
          : 'text-[#1a1916]'
        }`}>
          {req.label}
          {!uploaded && req.required  && <span className="ml-1 text-[9px] font-bold uppercase tracking-wide text-[#d97706]">Required</span>}
          {!uploaded && !req.required && <span className="ml-1 text-[9px] text-[#9b9890]">Optional</span>}
        </p>
        {isRejected && <p className="text-[9px] text-[#ef4444] mt-0.5">Rejected — re-upload required</p>}
        {isPending  && <p className="text-[9px] text-[#6b6860] mt-0.5">Under review</p>}
        {isApproved && <p className="text-[9px] text-[#16a34a] mt-0.5">Approved ✓</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {uploaded && docRecord?.fileUrl && !isRejected && (
          <a href={docRecord.fileUrl} target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-medium text-[#2e9f82] hover:underline flex items-center gap-0.5">
            <ExternalLink size={10} /> View
          </a>
        )}
        <label className={[
          'flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md cursor-pointer text-white transition-opacity',
          uploading ? 'opacity-50 pointer-events-none' : '',
          isRejected ? 'bg-[#ef4444]'
            : needsUpload && req.required ? 'bg-[#f59e0b]'
            : 'bg-[#9b9890]',
        ].join(' ')}>
          {uploading ? <Loader2 size={10} className="animate-spin" /> : <UploadCloud size={10} />}
          {isRejected ? 'Re-upload' : uploaded ? 'Replace' : 'Upload'}
          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onUpload(req, f, docRecord?.id);
              e.target.value = '';
            }} />
        </label>
      </div>
    </div>
  );
}


function TenancyJourneyPanel({
  contract,
  viewingStatus,
  leadStage,
  leadId,
  viewingId,
  initialPreferredChequeCount,
  initialDesiredMoveIn,
  paymentPlan,
  kycStatus,
  unitType,
  additionalDocsNote,
  unit,
  onReserve,
  onUtilitySubmitted,
  onStageChange,
}: {
  contract?: TenantContract;
  viewingStatus?: string;
  leadStage?: string;
  leadId?: number;
  viewingId?: number;
  initialPreferredChequeCount?: number | null;
  initialDesiredMoveIn?: string | null;
  paymentPlan?: PaymentPlan | null;
  kycStatus?: string;
  unitType?: string | null;
  additionalDocsNote?: string | null;
  unit?: SpaceUnit | null;
  onReserve?: () => void;
  onUtilitySubmitted?: () => void;
  onStageChange?: (newStage: string) => void;
}) {
  const { user, refresh } = useAuth();
  const kycApproved = kycStatus === 'approved';
  const [utilityInput, setUtilityInput] = useState('');
  const [utilitySaving, setUtilitySaving] = useState(false);
  const [utilityError, setUtilityError] = useState<string | null>(null);
  const [utilitySuccess, setUtilitySuccess] = useState(false);
  const [utilityProofUploading, setUtilityProofUploading] = useState(false);
  const [utilityProofUploaded, setUtilityProofUploaded] = useState(false);

  // ---------- Payment plan / cheques ready ----------
  const [chequesDone, setChequesDone]     = useState(false);
  const [chequesLoading, setChequesLoading] = useState(false);
  const [chequesError, setChequesError]   = useState<string | null>(null);

  // ---------- Tenant name (cheque drawer) — allow inline add if missing ----------
  const [nameInput,   setNameInput]   = useState<string>(user?.name ?? '');
  const [nameSaving,  setNameSaving]  = useState(false);
  const [nameError,   setNameError]   = useState<string | null>(null);
  function handlePrintPlan() {
    if (!paymentPlan) return;
    const startDate = paymentPlan.items?.[0]?.dueDate ?? null;
    const endDate = startDate ? (() => {
      const d = new Date(startDate + 'T00:00:00');
      d.setFullYear(d.getFullYear() + 1);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })() : null;
    const fmt = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const rp = unit?.property?.rentalProvider ?? unit?.property?.rental_provider;
    const landlordName = rp?.user?.name?.trim() || null;
    const landlordCompany = rp?.companyName?.trim() || null;
    const ownerName = landlordName && landlordCompany ? `${landlordName} (${landlordCompany})` : (landlordName || landlordCompany || 'To be confirmed');
    const buildingName = unit?.property?.buildingName ?? '—';
    const location = [unit?.property?.community?.name, unit?.property?.emirate?.name].filter(Boolean).join(', ') || unit?.property?.fullAddress || '—';
    const tenantName = user?.name?.trim() || '—';
    const aed = (fils: number) => `AED ${(fils / 100).toLocaleString('en-AE')}`;

    const itemsHtml = sortPlanItems(paymentPlan.items).map((it, i) => `
      <tr>
        <td>#${i + 1}</td>
        <td>${(it.description ?? `Cheque ${i + 1}`).replace(/</g, '&lt;')}</td>
        <td style="text-align:right">${aed(it.amountFils)}</td>
        <td>${it.dueDate}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Payment Plan — ${buildingName}</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1916;padding:32px;max-width:780px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:13px;margin:24px 0 8px;color:#0369a1;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e0f2fe;padding-bottom:4px}
  .sub{font-size:11px;color:#6b6860;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:160px 1fr;gap:6px 16px;font-size:12px;margin-bottom:8px}
  .grid .l{color:#9b9890;text-transform:uppercase;font-size:10px;letter-spacing:.05em;padding-top:2px}
  .grid .v{color:#1a1916;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e8e6e0}
  th{background:#f4f3ef;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b6860}
  tfoot td{font-weight:700;background:#f0f9ff;color:#0369a1;border-top:2px solid #bae6fd}
  .footer{margin-top:32px;font-size:10px;color:#9b9890;text-align:center;border-top:1px solid #e8e6e0;padding-top:12px}
  @media print{body{padding:16px} .noprint{display:none}}
  .btnrow{margin:0 0 24px;display:flex;gap:8px}
  .btn{display:inline-block;padding:8px 14px;background:#2e9f82;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer}
  .btn.alt{background:#f4f3ef;color:#3d3b35}
</style></head>
<body>
  <div class="btnrow noprint">
    <button class="btn" onclick="window.print()">Print / Save as PDF</button>
    <button class="btn alt" onclick="window.close()">Close</button>
  </div>
  <h1>Payment Plan</h1>
  <p class="sub">${buildingName} · Issued ${paymentPlan.issuedAt ? new Date(paymentPlan.issuedAt).toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' }) : '—'}</p>

  <h2>Contract &amp; Cheque Details</h2>
  <div class="grid">
    <div class="l">Cheque Drawer (You)</div><div class="v">${tenantName}</div>
    <div class="l">Cheque Payee (Landlord)</div><div class="v">${ownerName}</div>
    <div class="l">Building</div><div class="v">${buildingName}</div>
    <div class="l">Unit No.</div><div class="v">${unit?.unitNumber ?? '—'}</div>
    <div class="l">Location</div><div class="v">${location}</div>
    <div class="l">Contract Period</div><div class="v">${fmt(startDate)} → ${fmt(endDate)} (12 months)</div>
    <div class="l">Contract Value</div><div class="v">${aed(paymentPlan.totalAmountFils)}</div>
  </div>

  <h2>Rent &amp; Fees</h2>
  <div class="grid">
    ${paymentPlan.originalRentFils ? `<div class="l">Annual Rent</div><div class="v"><span style="text-decoration:line-through;color:#9b9890">${aed(paymentPlan.originalRentFils)}</span> → ${aed(paymentPlan.rentFils)} ${paymentPlan.discountType === 'percent' ? `(${paymentPlan.discountPercent}% discount)` : `(${aed(paymentPlan.discountFils ?? 0)} discount)`}</div>` : `<div class="l">Annual Rent</div><div class="v">${aed(paymentPlan.rentFils)}</div>`}
    <div class="l">Security Deposit</div><div class="v">${aed(paymentPlan.securityDepositFils)}</div>
    ${paymentPlan.adminFeeFils ? `<div class="l">Admin Fee</div><div class="v">${aed(paymentPlan.adminFeeFils)}</div>` : ''}
    ${paymentPlan.ejariFils ? `<div class="l">Ejari Fee</div><div class="v">${aed(paymentPlan.ejariFils)}</div>` : ''}
    ${paymentPlan.commissionFils ? `<div class="l">Commission</div><div class="v">${aed(paymentPlan.commissionFils)}</div>` : ''}
  </div>

  <h2>Cheque Schedule (${paymentPlan.chequeCount} cheques)</h2>
  <table>
    <thead><tr><th>#</th><th>Description</th><th style="text-align:right">Amount</th><th>Due Date</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td style="text-align:right">${aed(paymentPlan.totalAmountFils)}</td><td></td></tr></tfoot>
  </table>

  ${paymentPlan.notes ? `<h2>Notes</h2><p style="font-size:12px;color:#3d3b35">${paymentPlan.notes.replace(/</g, '&lt;')}</p>` : ''}

  <div class="footer">Generated by UpNow · ${new Date().toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' })}</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) { alert('Please allow pop-ups to print the payment plan.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function handleSaveName() {
    if (!nameInput.trim()) { setNameError('Please enter your full name'); return; }
    setNameSaving(true); setNameError(null);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: nameInput.trim() }),
      });
      if (!res.ok) { setNameError('Failed to save name'); return; }
      await refresh();
    } finally { setNameSaving(false); }
  }

  async function handleChequesReady() {
    if (!leadId) return;
    setChequesLoading(true); setChequesError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/cheques-ready`, {
        method: 'PATCH', credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setChequesError(body.message ?? 'Failed'); return; }
      setChequesDone(true);
      onStageChange?.('cheques_submitted');
    } finally { setChequesLoading(false); }
  }

  // ---------- Document collection (inline upload) ----------
  const viewed = ['completed', 'no_show'].includes(viewingStatus ?? '');
  const requiredDocs = getRequiredDocs(unitType);
  const isResidential = !unitType || !['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical','coworking_desk','private_office','meeting_room','day_office','event_hall','wedding_venue','conference_hall','private_dining','outdoor_venue','warehouse','open_yard','storage_unit','cold_storage','logistics_facility'].includes(unitType);
  const [occupantCount, setOccupantCount] = useState<number>(1);
  const rentalSectionDocs = getRentalSectionDocs(unitType);
  const [myDocsLoading, setMyDocsLoading] = useState(false);
  const [myDocs, setMyDocs]               = useState<InlineDoc[] | null>(null);
  const [tenantProfileId, setTenantPId]   = useState<number | null>(null);
  const [docUploading, setDocUploading]   = useState<string | null>(null);
  const [uploadError, setUploadError]     = useState<string | null>(null);

  // ---------- Contract preferences (start date, installments) ----------
  const _initMoveIn = initialDesiredMoveIn?.slice(0, 10) ?? '';
  const rpPreferredDays: number[] = (unit?.property?.rentalProvider ?? unit?.property?.rental_provider)?.preferredStartDays ?? [];
  const _initDay = _initMoveIn ? parseInt(_initMoveIn.slice(8, 10)) || 1 : 1;

  const [prefMonth,      setPrefMonth]      = useState<string>(_initMoveIn.slice(0, 7) || '');
  const [prefDay,        setPrefDay]        = useState<number>(_initMoveIn ? _initDay : (rpPreferredDays[0] ?? 1));
  const [prefCheques,    setPrefCheques]    = useState<number>(initialPreferredChequeCount ?? 4);
  const [prefSaving,   setPrefSaving]   = useState(false);
  const [prefSaved,    setPrefSaved]    = useState(false);
  const [prefError,    setPrefError]    = useState<string | null>(null);

  // Calendar dropdown state
  const _today = new Date();
  const [calOpen,  setCalOpen]  = useState(false);
  const [calYear,  setCalYear]  = useState(_initMoveIn ? parseInt(_initMoveIn.slice(0,4)) : _today.getFullYear());
  const [calMonth, setCalMonth] = useState(_initMoveIn ? parseInt(_initMoveIn.slice(5,7)) - 1 : _today.getMonth());
  const calRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!calOpen) return;
    const close = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [calOpen]);

  const prefMoveIn = prefMonth ? `${prefMonth}-${String(prefDay).padStart(2, '0')}` : '';

  function calPrev() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  }
  function calNext() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  }
  function selectCalDate(year: number, month: number, day: number) {
    const mm = `${year}-${String(month + 1).padStart(2, '0')}`;
    setPrefMonth(mm);
    setPrefDay(day);
    setCalOpen(false);
  }

  async function handleSavePreferences() {
    if (!viewingId) return;
    setPrefSaving(true);
    setPrefError(null);
    setPrefSaved(false);
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
    } finally { setPrefSaving(false); }
  }

  function reloadDocs() {
    if (!viewed) return;
    setMyDocsLoading(true);
    fetch('/api/documents/my', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { tenantProfileId: number; documents: InlineDoc[] }) => {
        setTenantPId(data.tenantProfileId ?? null);
        setMyDocs(data.documents);
      })
      .catch(() => setMyDocs([]))
      .finally(() => setMyDocsLoading(false));
  }

  useEffect(() => {
    reloadDocs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed]);

  async function handleUpload(req: DocReq, file: File, existingDocId?: number) {
    if (!tenantProfileId) return;
    setDocUploading(req.key);
    setUploadError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantProfileId,
          documentKey: req.key, originalName: file.name, mimeType: file.type,
        }),
      });
      if (!urlRes.ok) { setUploadError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };

      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
        catch { return uploadUrl; }
      })();

      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUploadError('File upload failed'); return; }

      let docRes: Response;
      if (existingDocId) {
        docRes = await fetch(`/api/documents/${existingDocId}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey }),
        });
      } else {
        docRes = await fetch('/api/documents', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerType: 'customer', ownerId: tenantProfileId,
            documentKey: req.key, category: req.category,
            displayName: req.label, fileUrl, mimeType: file.type, s3Key: fileKey,
          }),
        });
      }
      if (!docRes.ok) {
        const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
        setUploadError(Array.isArray(b.message) ? b.message[0] : (b.message ?? 'Failed to save'));
        return;
      }
      reloadDocs();
    } catch { setUploadError('Unexpected error during upload'); }
    finally { setDocUploading(null); }
  }

  async function handleUtilitySubmit() {
    if (!utilityInput.trim()) { setUtilityError('Please enter your utility account number.'); return; }
    if (!contract) return;
    setUtilitySaving(true); setUtilityError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${contract.id}/utility`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utilityAccountNumber: utilityInput.trim() }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setUtilityError(b.message ?? 'Failed to submit'); return; }
      setUtilitySuccess(true);
      onUtilitySubmitted?.();
    } finally { setUtilitySaving(false); }
  }

  async function handleUtilityProofUpload(file: File) {
    if (!tenantProfileId) return;
    setUtilityProofUploading(true); setUtilityError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantProfileId,
          documentKey: 'utility_proof_of_payment', originalName: file.name, mimeType: file.type,
        }),
      });
      if (!urlRes.ok) { setUtilityError('Upload failed'); return; }
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };

      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
        catch { return uploadUrl; }
      })();

      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUtilityError('File upload failed'); return; }

      const existingUtility = myDocs?.find(d => d.documentKey === 'utility_proof_of_payment');
      const docRes = existingUtility
        ? await fetch(`/api/documents/${existingUtility.id}`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey, documentNumber: utilityInput.trim() || null }),
          })
        : await fetch('/api/documents', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ownerType: 'customer', ownerId: tenantProfileId,
              documentKey: 'utility_proof_of_payment', category: 'payment',
              displayName: 'Utility Proof of Payment',
              fileUrl, mimeType: file.type, s3Key: fileKey,
              documentNumber: utilityInput.trim() || null,
            }),
          });
      if (!docRes.ok) { setUtilityError('Failed to save proof'); return; }
      setUtilityProofUploaded(true);
      reloadDocs();
    } catch { setUtilityError('Unexpected error'); }
    finally { setUtilityProofUploading(false); }
  }

  function ss(prev: boolean, curr: boolean): TLState {
    if (!prev) return 'upcoming';
    return curr ? 'done' : 'current';
  }

  // Pre-contract steps driven by viewing/lead
  const isNewPipeline = ['documents_collection', 'payment_plan_shared', 'cheques_submitted', 'cheques_collected', 'contract_issued'].includes(leadStage ?? '') || !!paymentPlan;
  const reserved = ['applied', 'offer_made', 'approved', 'converted', 'payment_plan_shared', 'cheques_submitted', 'cheques_collected', 'contract_issued', 'converted'].includes(leadStage ?? '');

  // Parse RP-requested document names from the JSON-serialised additionalDocsNote
  const rpRequestedItems: string[] = (() => {
    if (!additionalDocsNote) return [];
    try { const p = JSON.parse(additionalDocsNote); return Array.isArray(p) ? p.filter((s): s is string => typeof s === 'string') : []; }
    catch { return []; }
  })();
  const rpRequestedDocs: DocReq[] = rpRequestedItems.map((name, i) => ({
    key: `rp_req_${i}`, label: name, category: 'other', required: true,
    hint: 'Requested by your landlord / rental provider',
  }));

  // Docs step: all required + RP-requested docs uploaded and not rejected
  const uploadedKeys = new Set((myDocs ?? []).filter(d => d.status !== 'pending').map(d => d.documentKey));
  const rejectedDocs = (myDocs ?? []).filter(d => d.status === 'rejected');
  const rejectedKeys = new Set(rejectedDocs.map(d => d.documentKey));
  // Identity docs for additional occupants (2..n). Only applies to residential.
  const occupantDocs = isResidential ? getOccupantDocs(occupantCount) : [];
  const requiredMissing   = [
    ...requiredDocs.filter(d => d.required && !uploadedKeys.has(d.key)),
    ...occupantDocs.filter(d => !uploadedKeys.has(d.key)),
  ];
  const rpDocsUploaded    = rpRequestedDocs.every(req => uploadedKeys.has(req.key) && !rejectedKeys.has(req.key));
  const docsOk = myDocs !== null && requiredMissing.length === 0 && rpDocsUploaded && rejectedDocs.length === 0;

  // Auto-hydrate occupant count from previously-uploaded occupant_N_* docs so
  // the stepper survives reload (we don't persist count in the DB — the docs
  // themselves are the source of truth).
  useEffect(() => {
    if (!myDocs) return;
    const derived = deriveOccupantCount(myDocs.map(d => d.documentKey));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (derived > occupantCount) setOccupantCount(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDocs]);

  // Contract-driven steps
  const isIssued  = contract?.status === 'issued' || contract?.status === 'active';
  const isActive  = contract?.status === 'active';
  const hasEjari  = contract?.ejariStatus === 'registered';
  const hasUtility   = contract?.utilityStatus === 'submitted' || contract?.utilityStatus === 'verified';
  // hasSigned falls back to later-stage indicators — if Ejari/Utility has advanced,
  // signing must have happened even if tenantSignedAt wasn't recorded.
  const hasSigned = !!contract?.tenantSignedAt || isActive || hasEjari || hasUtility;

  // New-pipeline payment plan step states
  const planShared   = isNewPipeline && (!!paymentPlan || ['payment_plan_shared', 'cheques_submitted', 'cheques_collected', 'contract_issued', 'converted'].includes(leadStage ?? ''));
  const chequesOk    = chequesDone || ['cheques_submitted', 'cheques_collected', 'contract_issued', 'converted'].includes(leadStage ?? '');
  const s_plan: TLState = isNewPipeline
    ? (chequesOk ? 'done' : planShared ? 'current' : docsOk ? 'current' : 'upcoming')
    : 'done';

  // 10 steps (mirrors the RP timeline so customer and RP always agree on the current stage):
  // 1 Viewing Booked  2 Viewing Completed  3 Application Documents
  // 4 Payment Plan (new pipeline) / Submit Reservation (legacy)
  // 5 Contract Issued  6 Signatures  7 Ejari Registration  8 Utility  9 Move-In Inspection  10 Active Tenancy
  const s1: TLState = 'done';
  const s2 = ss(true, viewed);
  const s_docs = ss(viewed, docsOk);
  const s3 = ss(docsOk, reserved);
  // Contract Issued must wait for docs to be uploaded even if backend already
  // advanced the lead stage to offer_made/approved when the RP marked visited.
  const s4 = ss(reserved && (docsOk || isIssued), isIssued);
  const s5 = ss(isIssued, hasSigned);
  const s6 = ss(hasSigned, hasEjari);
  const s7 = ss(hasEjari, hasUtility);
  // Move-in inspection — done once tenant counter-signed OR contract is active.
  const inspectionSubmitted = !!contract?.moveInInspection?.submitted;
  const inspectionSignedByTenant = !!contract?.moveInInspection?.signedByTenant;
  const moveInDone = inspectionSignedByTenant || isActive;
  const s_movein = ss(hasUtility, moveInDone);
  const s8: TLState = isActive ? 'current' : 'upcoming';

  const headerSub = leadStage === 'rejected'
    ? 'This application has been declined by the rental provider.'
    : isActive
    ? 'Your tenancy is active'
    : hasUtility
    ? 'Utility submitted. Waiting for final activation.'
    : hasEjari
    ? 'Ejari is done. Add your utility account number.'
    : hasSigned
    ? 'Contract signed. Ejari registration is in progress.'
    : isIssued
    ? 'Your contract is ready. Please review and sign.'
    : leadStage === 'cheques_collected'
    ? 'All cheques received. Contract is being prepared.'
    : leadStage === 'cheques_submitted'
    ? 'Cheques confirmed. Provider is collecting them.'
    : leadStage === 'payment_plan_shared'
    ? 'Your payment plan is ready. Review it and confirm your cheques.'
    : leadStage === 'documents_collection'
    ? (docsOk ? 'Documents complete. Waiting for your payment plan.' : 'Viewing completed. Upload your required documents.')
    : docsOk && reserved
    ? 'Reservation submitted. Waiting for provider confirmation.'
    : docsOk
    ? 'Documents are complete. Submit your reservation.'
    : viewed
    ? 'Viewing completed. Upload your required documents.'
    : 'Viewing scheduled. Attend it to move forward.';

  const currentStage = leadStage === 'rejected'
    ? 'Application Declined'
    : isActive
    ? 'Tenancy Active'
    : hasUtility
    ? 'Activation Pending'
    : hasEjari
    ? 'Utility Required'
    : hasSigned
    ? 'Ejari In Progress'
    : isIssued
    ? 'Contract Signing'
    : leadStage === 'cheques_collected'
    ? 'Cheques Collected'
    : leadStage === 'cheques_submitted'
    ? 'Cheques Submitted'
    : leadStage === 'payment_plan_shared'
    ? 'Payment Plan Shared'
    : leadStage === 'documents_collection'
    ? 'Documents Requested'
    : docsOk && reserved
    ? 'Reservation Review'
    : docsOk
    ? 'Ready to Reserve'
    : viewed
    ? 'Documents Needed'
    : 'Viewing Scheduled';

  const nextAction = leadStage === 'rejected'
    ? 'No further action required for this application.'
    : isActive
    ? 'Manage your tenancy and payments from this space.'
    : hasUtility
    ? 'No action needed right now. We will notify you once activated.'
    : hasEjari
    ? 'Add your utility account number in Step 8 below.'
    : hasSigned
    ? 'No action needed right now. Provider is completing Ejari.'
    : isIssued
    ? 'Open contract details and complete your signature.'
    : leadStage === 'cheques_collected'
    ? 'No action needed. Provider is finalising your contract.'
    : leadStage === 'cheques_submitted'
    ? 'No action needed. Wait for the provider to collect your cheques.'
    : leadStage === 'payment_plan_shared'
    ? 'Review the payment plan in Step 4 and click "Confirm Cheques Ready".'
    : leadStage === 'documents_collection'
    ? (docsOk ? 'Waiting for your payment plan — no action needed now.' : 'Upload required documents in Step 3.')
    : docsOk && reserved
    ? 'Wait for provider approval and contract issuance.'
    : docsOk
    ? 'Click "Proceed to Reservation" in Step 4.'
    : viewed
    ? 'Upload required documents in Step 3.'
    : 'Attend the scheduled viewing in Step 2.';

  if (leadStage === 'rejected') {
    return (
      <div className="overflow-hidden border-t border-[#e8e6e0]">
        <div className="px-4 py-2.5 bg-[#b91c1c]">
          <p className="text-xs font-bold text-white uppercase tracking-wider">Application Declined</p>
          <p className="text-[10px] text-white/80 mt-0.5">This application has been declined by the rental provider.</p>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-start gap-3 bg-[#fff1f2] border border-[#fecaca] rounded-xl px-4 py-3">
            <Ban size={18} className="text-[#b91c1c] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#b91c1c]">Your application was not progressed</p>
              <p className="text-xs text-[#6b6860] mt-1 leading-relaxed">
                The rental provider has declined this application. If you have any questions, please contact them directly.
                You can continue browsing other available properties on UpNow.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="overflow-hidden border-t border-[#e8e6e0]">
      {/* Green header */}
      <div className="px-4 py-2.5" style={{ background: '#2e9f82' }}>
        <p className="text-xs font-bold text-white uppercase tracking-wider">Your Journey</p>
        <p className="text-[10px] text-white/80 mt-0.5">{headerSub}</p>
        <div className="mt-2 rounded-lg bg-white/15 px-2.5 py-2 text-[10px] leading-relaxed text-white">
          <p><span className="font-semibold">Current stage:</span> {currentStage}</p>
          <p className="mt-0.5"><span className="font-semibold">Next action:</span> {nextAction}</p>
        </div>
      </div>

      {/* Steps */}
      <div className="px-4 pt-3 pb-2">

        <StepRow num={1} label="Viewing Scheduled" state={s1} last={false}>
          <p className="text-[10px] text-[#2e9f82] mt-0.5">Viewing scheduled ✓</p>
        </StepRow>

        <StepRow num={2} label="Attend Viewing" state={s2} last={false}>
          {s2 === 'current' && <p className="text-[10px] text-[#9b9890] mt-0.5">Your viewing is upcoming — attend to move forward</p>}
          {s2 === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Viewing done ✓</p>}
        </StepRow>

        {/* ── Step 3: Rental Documents & Preferences ── */}
        <StepRow num={3} label="Rental Documents" state={s_docs} last={false}>
          {/* Collapsed state: once submitted, show a one-liner and let Step 4 take focus */}
          {viewed && (prefSaved || (docsOk && isNewPipeline)) && (
            <p className="text-[10px] text-[#2e9f82] mt-0.5">Documents & preferences submitted ✓</p>
          )}
          {viewed && !(prefSaved || (docsOk && isNewPipeline)) && (() => {
            const calFirstDow    = new Date(calYear, calMonth, 1).getDay();
            const calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
            const calMonthLabel  = new Date(calYear, calMonth, 1).toLocaleString('en-AE', { month: 'long', year: 'numeric' });
            const todayMidnight  = new Date(_today.getFullYear(), _today.getMonth(), _today.getDate());
            // RP-restricted day-of-month list (empty = all days allowed)
            const dayAllowed = (day: number) => rpPreferredDays.length === 0 || rpPreferredDays.includes(day);

            return (
              <div className="mt-2 space-y-3">
                {uploadError && <p className="text-[10px] text-[#b91c1c] bg-[#fff1f2] border border-[#fecaca] rounded-lg px-2.5 py-1.5">{uploadError}</p>}
                {prefError   && <p className="text-[10px] text-[#b91c1c] bg-[#fff1f2] border border-[#fecaca] rounded-lg px-2.5 py-1.5">{prefError}</p>}

                {/* Contract Start Date */}
                {viewingId && (
                  <div className="bg-[#f4f3ef] rounded-xl px-3 py-2.5">
                    <p className="text-[10px] font-semibold text-[#3d3b35] uppercase tracking-wide mb-2">
                      Contract Start Date <span className="text-red-500">*</span>
                    </p>
                    <div className="relative" ref={calRef}>
                      <button type="button" onClick={() => setCalOpen(o => !o)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors ${prefMoveIn ? 'bg-white border-[#2e9f82] text-[#1a1916]' : 'bg-white border-[#d6d4ce] text-[#9b9890] hover:border-[#2e9f82]'}`}>
                        <span className="flex items-center gap-1.5">
                          <Calendar size={11} className={prefMoveIn ? 'text-[#2e9f82]' : 'text-[#9b9890]'} />
                          {prefMoveIn ? new Date(`${prefMoveIn}T00:00:00`).toLocaleDateString('en-AE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Choose start date'}
                        </span>
                        <ChevronDown size={11} className={`transition-transform ${calOpen ? 'rotate-180' : ''} text-[#9b9890]`} />
                      </button>
                      {calOpen && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-[#e8e6e0] shadow-lg z-20 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <button type="button" onClick={calPrev} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-[#f4f3ef] text-[#3d3b35] cursor-pointer"><ChevronLeft size={12} /></button>
                            <span className="text-[11px] font-semibold text-[#1a1916]">{calMonthLabel}</span>
                            <button type="button" onClick={calNext} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-[#f4f3ef] text-[#3d3b35] cursor-pointer"><ChevronRight size={12} /></button>
                          </div>
                          <div className="grid grid-cols-7 mb-1">
                            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <div key={d} className="text-center text-[8px] font-semibold text-[#9b9890] py-0.5">{d}</div>)}
                          </div>
                          <div className="grid grid-cols-7 gap-y-0.5">
                            {Array.from({ length: calFirstDow }, (_, i) => <div key={`e${i}`} />)}
                            {Array.from({ length: calDaysInMonth }, (_, i) => {
                              const day = i + 1;
                              const isActive = dayAllowed(day);
                              const isPast = new Date(calYear, calMonth, day) < todayMidnight;
                              const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                              const isSelected = dateStr === prefMoveIn;
                              if (!isActive) return <div key={day} className="flex items-center justify-center h-7 text-[9px] text-[#e0deda]">{day}</div>;
                              return (
                                <button key={day} type="button" disabled={isPast}
                                  onClick={() => selectCalDate(calYear, calMonth, day)}
                                  className={`flex items-center justify-center h-7 rounded-lg text-[10px] font-bold transition-colors ${isSelected ? 'bg-[#2e9f82] text-white cursor-pointer' : isPast ? 'text-[#c8c6c0] cursor-not-allowed' : 'bg-[#e8f5f1] text-[#2e9f82] hover:bg-[#2e9f82] hover:text-white cursor-pointer'}`}>
                                  {day}
                                </button>
                              );
                            })}
                          </div>
                          {rpPreferredDays.length > 0 && (
                            <p className="text-[8px] text-[#9b9890] mt-2 leading-relaxed">
                              Only days highlighted by the landlord can be selected as a start date.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Number of Payments */}
                {viewingId && (
                  <div className="bg-[#f4f3ef] rounded-xl px-3 py-3">
                    <p className="text-[10px] font-semibold text-[#3d3b35] uppercase tracking-wide mb-2">Number of Payments</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {([[ 1,'Annual'],[2,'Semi-Annual'],[4,'Quarterly'],[6,'Bi-Monthly'],[12,'Monthly']] as const).map(([n, label]) => (
                        <button key={n} type="button" onClick={() => setPrefCheques(n)}
                          className={`text-[10px] px-3 py-1.5 rounded-lg border font-semibold cursor-pointer transition-colors ${prefCheques === n ? 'bg-[#2e9f82] border-[#2e9f82] text-white' : 'bg-white border-[#d6d4ce] text-[#3d3b35] hover:border-[#2e9f82]'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Number of Occupants (residential only) */}
                {viewingId && isResidential && (
                  <div className="bg-[#f4f3ef] rounded-xl px-3 py-3">
                    <p className="text-[10px] font-semibold text-[#3d3b35] uppercase tracking-wide mb-2">Number of Occupants</p>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setOccupantCount(c => Math.max(1, c - 1))}
                        disabled={occupantCount <= 1}
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#d6d4ce] bg-white text-[#3d3b35] hover:border-[#2e9f82] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">−</button>
                      <span className="text-[12px] font-bold text-[#1a1916] tabular-nums min-w-[18px] text-center">{occupantCount}</span>
                      <button type="button" onClick={() => setOccupantCount(c => c + 1)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#d6d4ce] bg-white text-[#3d3b35] hover:border-[#2e9f82] cursor-pointer">+</button>
                      <span className="ml-2 text-[10px] text-[#6b6860]">
                        {occupantCount === 1 ? 'Just me' : `${occupantCount - 1} additional ${occupantCount === 2 ? 'occupant' : 'occupants'}`}
                      </span>
                    </div>
                    {occupantCount > 1 && (
                      <p className="text-[10px] text-[#6b6860] mt-2 leading-relaxed">
                        Each additional occupant needs Emirates ID, Passport, and UAE Visa uploaded below.
                      </p>
                    )}
                  </div>
                )}

                {/* Documents */}
                {myDocsLoading ? (
                  <p className="text-[10px] text-[#9b9890] flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Loading documents…</p>
                ) : (
                  <div className="space-y-1.5">
                    {requiredDocs.filter(d => d.required).map(req => (
                      <InlineDocRow key={req.key} req={req} docRecord={(myDocs ?? []).find(d => d.documentKey === req.key)} uploading={docUploading === req.key} onUpload={handleUpload} />
                    ))}
                    {occupantDocs.length > 0 && (
                      <>
                        <p className="text-[10px] font-semibold text-[#3d3b35] mt-2 mb-0.5 flex items-center gap-1">
                          <Info size={10} /> Identity documents for additional occupants
                        </p>
                        {occupantDocs.map(req => (
                          <InlineDocRow key={req.key} req={req} docRecord={(myDocs ?? []).find(d => d.documentKey === req.key)} uploading={docUploading === req.key} onUpload={handleUpload} />
                        ))}
                      </>
                    )}
                    {rpRequestedDocs.length > 0 && (
                      <>
                        <p className="text-[10px] font-semibold text-[#1e40af] mt-2 mb-0.5 flex items-center gap-1"><Info size={10} /> Additional documents requested by provider</p>
                        {rpRequestedDocs.map(req => (
                          <InlineDocRow key={req.key} req={req} docRecord={(myDocs ?? []).find(d => d.documentKey === req.key)} uploading={docUploading === req.key} onUpload={handleUpload} />
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* Submit */}
                {viewingId && (
                  <div className="pt-1 space-y-1.5">
                    {/* Checklist — show what's still missing */}
                    {(!prefMonth || !docsOk) && (
                      <div className="bg-[#f4f3ef] rounded-lg px-2.5 py-2 space-y-1">
                        <p className="text-[9px] font-semibold text-[#6b6860] uppercase tracking-wide mb-1">Complete before submitting</p>
                        <p className={`text-[10px] flex items-center gap-1.5 ${prefMonth ? 'text-[#2e9f82]' : 'text-[#9b9890]'}`}>
                          {prefMonth
                            ? <CheckCircle2 size={10} />
                            : <span className="w-2.5 h-2.5 rounded-full border border-[#c8c6c0] inline-block shrink-0" />}
                          Contract start date
                        </p>
                        <p className={`text-[10px] flex items-center gap-1.5 ${docsOk ? 'text-[#2e9f82]' : 'text-[#9b9890]'}`}>
                          {docsOk
                            ? <CheckCircle2 size={10} />
                            : <span className="w-2.5 h-2.5 rounded-full border border-[#c8c6c0] inline-block shrink-0" />}
                          All required documents uploaded
                        </p>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={!prefMonth || !docsOk || prefSaving}
                      onClick={handleSavePreferences}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-white rounded-xl px-3 py-2.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                      style={{ background: '#2e9f82' }}
                    >
                      {prefSaving
                        ? <><Loader2 size={11} className="animate-spin" /> Submitting…</>
                        : <><CheckCircle2 size={11} /> Submit</>}
                    </button>
                    {prefSaved && (
                      <p className="text-[10px] text-[#16a34a] font-medium text-center">
                        Submitted ✓ — Your rental provider will review and issue the payment plan.
                      </p>
                    )}
                    {prefError && (
                      <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">{prefError}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {s_docs === 'done' && !prefSaved && !docsOk && (
            <p className="text-[10px] text-[#2e9f82] mt-0.5">All documents uploaded ✓</p>
          )}
        </StepRow>

        {/* Step 4: Payment Plan (new pipeline) or Reserve Unit (legacy) */}
        {isNewPipeline ? (
          <StepRow num={4} label="Payment Plan" state={s_plan} last={false}>
            {s_plan === 'current' && paymentPlan && (() => {
              const aed = (fils: number) => `AED ${(fils / 100).toLocaleString('en-AE')}`;
              const items = sortPlanItems(paymentPlan.items);
              return (
                <div className="mt-2 space-y-2">
                  <p className="text-[10px] text-[#9b9890]">
                    {paymentPlan.chequeCount} cheque{paymentPlan.chequeCount !== 1 ? 's' : ''} · {aed(paymentPlan.rentFils)} annual rent
                  </p>
                  {items.slice(0, 3).map((it, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] bg-[#f4f2ef] rounded-lg px-2.5 py-1.5">
                      <span className="text-[#6b6860]">{it.description ?? `Cheque ${i + 1}`}</span>
                      <span className="font-semibold text-[#1a1916] tabular-nums">{aed(it.amountFils)}</span>
                      {it.dueDate && <span className="text-[#9b9890]">{new Date(it.dueDate + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}</span>}
                    </div>
                  ))}
                  {chequesOk ? (
                    <p className="text-[10px] text-[#2e9f82] flex items-center gap-1"><CheckCircle2 size={10} /> Cheques confirmed ✓</p>
                  ) : (
                    <button
                      disabled={chequesLoading}
                      onClick={async () => {
                        if (!leadId) return;
                        setChequesLoading(true); setChequesError(null);
                        try {
                          const r = await fetch(`/api/leads/${leadId}/cheques-submitted`, { method: 'PATCH', credentials: 'include' });
                          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
                          setChequesDone(true); onStageChange?.('cheques_submitted');
                        } catch (e) { setChequesError(e instanceof Error ? e.message : 'Failed'); }
                        finally { setChequesLoading(false); }
                      }}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white rounded-lg px-3 py-2 disabled:opacity-50 cursor-pointer"
                      style={{ background: '#2e9f82' }}
                    >
                      {chequesLoading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      Confirm Cheques Ready
                    </button>
                  )}
                  {chequesError && <p className="text-[10px] text-red-600">{chequesError}</p>}
                </div>
              );
            })()}
            {s_plan === 'current' && !paymentPlan && (
              <p className="text-[10px] text-[#9b9890] mt-0.5">Waiting for your payment plan from the landlord</p>
            )}
            {s_plan === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Cheques confirmed ✓</p>}
          </StepRow>
        ) : (
          <StepRow num={4} label="Submit Reservation" state={s3} last={false}>
            {s3 === 'current' && (
              <div className="mt-2 space-y-2">
                {!docsOk ? (
                  <p className="text-[10px] text-[#92400e] bg-[#fef3c7] rounded-lg px-2.5 py-1.5 leading-relaxed">
                    Upload all required documents in Step 3 before reserving this unit.
                  </p>
                ) : !kycApproved ? (
                  <>
                    <p className="text-[10px] text-[#92400e] bg-[#fef3c7] rounded-lg px-2.5 py-1.5 leading-relaxed">
                      ⚠️ KYC verification required before you can reserve this unit.
                    </p>
                    <a
                      href="/dashboard/customer/documents"
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white rounded-lg px-3 py-2 cursor-pointer"
                      style={{ background: '#f59e0b' }}
                    >
                      Complete KYC <ArrowRight size={11} />
                    </a>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-[#9b9890]">Documents complete — confirm your reservation to proceed</p>
                    <button
                      onClick={onReserve}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white rounded-lg px-3 py-2 cursor-pointer"
                      style={{ background: '#2e9f82' }}
                    >
                      <CheckCircle2 size={12} /> Proceed to Reservation
                    </button>
                  </>
                )}
              </div>
            )}
            {s3 === 'done' && (
              <p className="text-[10px] text-[#2e9f82] mt-0.5">
                {leadStage === 'approved' ? 'Approved by landlord ✓' : 'Reservation submitted ✓'}
              </p>
            )}
          </StepRow>
        )}

        <StepRow num={5} label="Contract Issued" state={s4} last={false}>
          {s4 === 'current' && <p className="text-[10px] text-[#9b9890] mt-0.5">Landlord is preparing your contract</p>}
          {s4 === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Issued ✓</p>}
        </StepRow>

        <StepRow num={6} label="Sign Contract" state={s5} last={false}>
          {s5 === 'current' && contract && (
            <div className="mt-1 space-y-1.5">
              <p className="text-[10px] text-[#9b9890]">Review and sign the contract above</p>
              <Link href={`/dashboard/customer/contracts/${contract.id}`}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white rounded-lg px-3 py-2 cursor-pointer"
                style={{ background: '#2e9f82' }}>
                Sign Contract <ArrowRight size={11} />
              </Link>
            </div>
          )}
          {s5 === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">All parties signed ✓</p>}
        </StepRow>

        <StepRow num={7} label="Ejari Registration" state={s6} last={false}>
          {s6 === 'current' && <p className="text-[10px] text-[#9b9890] mt-0.5">DLD registration in progress</p>}
          {s6 === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Registered with DLD ✓</p>}
        </StepRow>

        <StepRow num={8} label="Add Utility Account" state={s7} last={false}>
          {s7 === 'current' && (
            <div className="mt-2 space-y-2">
              {utilitySuccess || contract?.utilityAccountNumber ? (
                <p className="text-[10px] text-[#2e9f82]">Utility account submitted ✓{contract?.utilityAccountNumber ? ` · ${contract.utilityAccountNumber}` : ''}</p>
              ) : (
                <>
                  <p className="text-[10px] text-[#9b9890]">Ejari registered — please provide your utility account number</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={utilityInput}
                      onChange={e => setUtilityInput(e.target.value)}
                      placeholder="e.g. 1234567890"
                      className="flex-1 text-xs px-2.5 py-1.5 border border-[#e8e6e0] rounded-lg focus:outline-none focus:border-[#2e9f82] text-[#1a1916]"
                    />
                    <button
                      onClick={handleUtilitySubmit}
                      disabled={utilitySaving}
                      className="text-[11px] font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50 cursor-pointer"
                      style={{ background: '#2e9f82' }}
                    >
                      {utilitySaving ? '…' : 'Submit'}
                    </button>
                  </div>
                  {utilityError && <p className="text-[10px] text-red-600">{utilityError}</p>}
                </>
              )}
            </div>
          )}
          {s7 === 'done' && (
            <p className="text-[10px] text-[#2e9f82] mt-0.5">Utility submitted ✓{contract?.utilityAccountNumber ? ` · ${contract.utilityAccountNumber}` : ''}</p>
          )}
        </StepRow>

        <StepRow num={9} label="Move-In Inspection" state={s_movein} last={false}>
          {s_movein === 'current' && (
            <div className="mt-1 space-y-1.5">
              {!inspectionSubmitted ? (
                <p className="text-[10px] text-[#9b9890]">Landlord is preparing the move-in inspection</p>
              ) : !inspectionSignedByTenant && contract ? (
                <>
                  <p className="text-[10px] text-[#c2410c]">Action required — review and counter-sign the inspection</p>
                  <Link href={`/dashboard/customer/contracts/${contract.id}/inspection?type=move_in`}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white rounded-lg px-3 py-2"
                    style={{ background: '#c2410c' }}>
                    Review &amp; Sign <ArrowRight size={11} />
                  </Link>
                </>
              ) : (
                <p className="text-[10px] text-[#2e9f82] flex items-center gap-1"><CheckCircle2 size={10} /> Counter-signed ✓</p>
              )}
            </div>
          )}
          {s_movein === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Inspection counter-signed ✓</p>}
        </StepRow>

        <StepRow num={10} label="Active Tenancy" state={s8} last={true}>
          {s8 === 'current' && (
            <div className="mt-1">
              <p className="text-[10px] text-[#2e9f82] font-medium">Your tenancy is live 🎉</p>
              {contract?.endDate && (
                <p className="text-[10px] text-[#9b9890] mt-0.5">
                  Ends {new Date(contract.endDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          )}
        </StepRow>

      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Documents Status Banner
   Compact replacement for the old full-inline RentalDocumentsCard.
   Shows upload progress and links to /dashboard/customer/documents.
────────────────────────────────────────────────────────────────────────────── */

function DocumentsStatusBanner({ unitType }: { unitType?: string | null }) {
  const requiredDocs = getRequiredDocs(unitType);
  const [summary, setSummary] = useState<{
    uploaded: number; total: number; rejected: number; pendingLandlord: number;
  } | null>(null);

  useEffect(() => {
    fetch('/api/documents/my', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { documents: { documentKey: string; status?: string }[] }) => {
        const docs = data.documents ?? [];
        const uploadedKeys = new Set(docs.filter(d => d.status !== 'pending').map(d => d.documentKey));
        const required = requiredDocs.filter(d => d.required);
        const uploaded = required.filter(d => uploadedKeys.has(d.key) && docs.find(x => x.documentKey === d.key)?.status !== 'rejected').length;
        const rejected = docs.filter(d => d.status === 'rejected').length;
        const pendingLandlord = docs.filter(d => d.status === 'pending').length;
        setSummary({ uploaded, total: required.length, rejected, pendingLandlord });
      })
      .catch(() => setSummary({ uploaded: 0, total: requiredDocs.filter(d => d.required).length, rejected: 0, pendingLandlord: 0 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitType]);

  const isComplete  = summary !== null && summary.uploaded === summary.total && summary.rejected === 0;
  const hasRejected = summary !== null && summary.rejected > 0;
  const hasLandlord = summary !== null && summary.pendingLandlord > 0;

  return (
    <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2.5">
        <FileText size={14} className="text-[#2e9f82] shrink-0" />
        <span className="text-sm font-semibold text-[#1a1916]">Rental Documents</span>
        <div className="flex-1" />
        {summary === null ? (
          <Loader2 size={12} className="animate-spin text-[#9b9890]" />
        ) : hasRejected ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#fee2e2] text-[#b91c1c]">Action needed</span>
        ) : hasLandlord ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#fff7ed] text-[#f97316]">Landlord requested</span>
        ) : isComplete ? (
          <span className="text-[10px] font-semibold text-[#16a34a]">All required uploaded ✓</span>
        ) : (
          <span className="text-[10px] font-semibold text-[#92400e]">{summary.uploaded}/{summary.total} uploaded</span>
        )}
        <a
          href="/dashboard/customer/documents"
          className="flex items-center gap-1 text-[11px] font-semibold text-[#2e9f82] hover:underline ml-2 shrink-0">
          Manage Documents <ArrowRight size={11} />
        </a>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Viewing-based Space Card
────────────────────────────────────────────────────────────────────────────── */

interface ViewingGroup {
  leadId: number;
  leadStage: string;
  leadAdditionalDocsNote?: string | null;
  leadPaymentPlan?: PaymentPlan | null;
  unit: SpaceUnit | null;
  primary: Viewing;
  others: Viewing[];
}

function groupByLead(viewings: Viewing[]): ViewingGroup[] {
  const map = new Map<number, Viewing[]>();
  for (const v of viewings) {
    const key = v.lead?.id ?? -v.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(v);
  }
  const groups: ViewingGroup[] = [];
  for (const [, list] of map) {
    const sorted = [...list].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    const primary = sorted.find(v => ['scheduled', 'confirmed', 'completed'].includes(v.status)) ?? sorted[0];
    const others = sorted.filter(v => v.id !== primary.id);
    groups.push({ leadId: primary.lead?.id ?? -primary.id, leadStage: primary.lead?.stage ?? 'new', leadAdditionalDocsNote: primary.lead?.additionalDocsNote ?? null, leadPaymentPlan: primary.lead?.paymentPlan ?? null, unit: primary.unit, primary, others });
  }
  groups.sort((a, b) => new Date(a.primary.scheduledAt).getTime() - new Date(b.primary.scheduledAt).getTime());
  return groups;
}

function viewingStatusLabel(status: string) {
  if (status === 'confirmed') return { label: 'Confirmed', bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]' };
  if (status === 'completed') return { label: 'Visited',   bg: 'bg-[#dbeafe]', text: 'text-[#1e40af]' };
  if (status === 'cancelled') return { label: 'Cancelled', bg: 'bg-[#f4f3ef]', text: 'text-[#9b9890]' };
  if (status === 'no_show')   return { label: 'No show',   bg: 'bg-[#fee2e2]', text: 'text-[#b91c1c]' };
  return                               { label: 'Scheduled', bg: 'bg-[#fef3c7]', text: 'text-[#92400e]' };
}

function leadStageLabel(stage: string) {
  const map: Record<string, { label: string; bg: string; text: string }> = {
    new:                  { label: 'New',                bg: 'bg-[#f4f3ef]', text: 'text-[#9b9890]' },
    viewing_scheduled:    { label: 'Viewing Booked',     bg: 'bg-[#fef3c7]', text: 'text-[#92400e]' },
    contacted:            { label: 'In Discussion',      bg: 'bg-[#ede9fe]', text: 'text-[#6d28d9]' },
    applied:              { label: 'Application Sent',   bg: 'bg-[#ede9fe]', text: 'text-[#6d28d9]' },
    offer_made:           { label: 'Offer Received',     bg: 'bg-[#fef3c7]', text: 'text-[#92400e]' },
    approved:             { label: 'Approved',           bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]' },
    documents_collection: { label: 'Docs Requested',     bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]' },
    payment_plan_shared:  { label: 'Payment Plan Ready', bg: 'bg-[#f0f9ff]', text: 'text-[#0369a1]' },
    cheques_submitted:    { label: 'Cheques Submitted',  bg: 'bg-[#fef9c3]', text: 'text-[#854d0e]' },
    cheques_collected:    { label: 'Cheques Collected',  bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]' },
    contract_issued:      { label: 'Contract Issued',    bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]' },
    converted:            { label: 'Contract Active',    bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]' },
    rejected:             { label: 'Not Progressed',     bg: 'bg-[#fee2e2]', text: 'text-[#b91c1c]' },
  };
  return map[stage] ?? { label: stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), bg: 'bg-[#f4f3ef]', text: 'text-[#9b9890]' };
}

const LEAD_STAGE_FLOW = [
  'new', 'documents_collection', 'payment_plan_shared',
  'cheques_submitted', 'cheques_collected', 'contract_issued', 'converted',
] as const;

function leadStageProgress(stage: string) {
  const idx = LEAD_STAGE_FLOW.indexOf(stage as (typeof LEAD_STAGE_FLOW)[number]);
  const current = idx >= 0 ? idx + 1 : 1;
  const total = LEAD_STAGE_FLOW.length;
  const ratio = Math.min(1, Math.max(0, current / total));
  const nextByStage: Record<string, string> = {
    new: 'Complete viewing and upload documents',
    viewing_scheduled: 'Attend your scheduled viewing',
    applied: 'Provider is reviewing your application',
    offer_made: 'Offer shared by provider',
    approved: 'Contract will be issued next',
    documents_collection: 'Upload your required documents',
    payment_plan_shared: 'Review the payment plan and confirm your cheques',
    cheques_submitted: 'Provider is collecting your cheques',
    cheques_collected: 'All cheques received — contract is being prepared',
    contract_issued: 'Sign your contract to activate',
    converted: 'Moved to active contract',
    rejected: 'Lead closed',
  };
  return {
    current,
    total,
    ratio,
    next: nextByStage[stage] ?? 'In progress',
  };
}


/* ──────────────────────────────────────────────────────────────────────────────
   Row expand detail panel
────────────────────────────────────────────────────────────────────────────── */

function ExpandedDetail({
  group, contract, renewalContract, onRefresh, kycStatus,
}: {
  group: ViewingGroup; contract?: TenantContract; renewalContract?: TenantContract; onRefresh: () => void; kycStatus?: string;
}) {
  const v = group.primary;
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [notInterestedOpen, setNotInterestedOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [contractDone, setContractDone] = useState(false);
  const [contractId, setContractId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const dt = new Date(v.scheduledAt);
  const hourMs = 60 * 60 * 1000;
  const canModify = ['scheduled', 'confirmed'].includes(v.status) &&
    (dt.getTime() - Date.now() > hourMs || dt.getTime() < Date.now());
  const hasVisited = v.status === 'completed' && !['applied','offer_made','approved','converted'].includes(group.leadStage);

  async function handleCancel() {
    setCancelling(true); setActionError(null);
    try {
      const res = await fetch(`/api/leads/my-viewings/${v.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setActionError(b.message ?? 'Failed to cancel'); return; }
      onRefresh();
    } finally { setCancelling(false); }
  }

  const statusUi: Record<string, { bg: string; text: string; label: string }> = {
    scheduled: { bg: '#dbeafe', text: '#1e40af', label: 'Scheduled' },
    confirmed:  { bg: '#d8f2e8', text: '#1a7a5a',  label: 'Confirmed' },
    completed:  { bg: '#f4f3ef', text: '#6b6860',  label: 'Attended' },
    no_show:    { bg: '#fee2e2', text: '#b91c1c',  label: 'No Show' },
    cancelled:  { bg: '#f4f3ef', text: '#9b9890',  label: 'Cancelled' },
  };
  const su = statusUi[v.status] ?? { bg: '#f4f3ef', text: '#6b6860', label: v.status };
  const buildingInitial = (v.unit?.property?.buildingName ?? v.unit?.unitName ?? 'P').charAt(0).toUpperCase();

  return (
    <>
      {rescheduleOpen && <RescheduleModal viewing={v} onClose={() => setRescheduleOpen(false)} onSuccess={() => { setRescheduleOpen(false); onRefresh(); }} />}
      {notInterestedOpen && <NotInterestedModal viewing={v} onClose={() => setNotInterestedOpen(false)} onSuccess={() => { setNotInterestedOpen(false); onRefresh(); }} />}

      {/* When a contract exists: Contract | Your Journey on top, Viewing Appointment below.
          Move-In Inspection banner is now rendered INSIDE the active ContractInlineSection (Row 2)
          via the moveInInspection prop, so it's grouped with the contract it belongs to. */}
      {contract ? (
        <div className="space-y-5">
          {/* ── ROW 1 (only when a renewal is in flight):
                  Renewal Contract details (left, scoped to the renewal CHILD) | Renewal Journey (right) */}
          {renewalContract && contract.renewalAccepted && (
            <>
              {/* ── RENEWAL IN FLIGHT header ── */}
              <div className="rounded-2xl border border-[#2e9f82] bg-[#f0faf6] overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[9px] font-bold text-[#1a7a5a] uppercase tracking-widest">Renewal in flight</p>
                    <p className="text-sm font-semibold text-[#2e9f82] mt-0.5">Two tenancies, one place.</p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-[#2e9f82] flex items-center justify-center">
                    <RotateCcw size={16} className="text-white" />
                  </div>
                </div>
              </div>
              {/* 01 · Original Lease label */}
              <p className="text-[9px] font-bold text-[#9b9890] uppercase tracking-widest px-1">01 · Original Lease</p>
            </>
          )}

          {/* ── ROW 2: Contract (left, original/active parent) | Contract Journey (right) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <ContractInlineSection contractId={contract.id} onRefresh={onRefresh} moveInInspection={contract.moveInInspection} />
            <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
              <TenancyJourneyPanel
                contract={contract}
                viewingStatus={v.status}
                leadStage={group.leadStage}
                leadId={group.leadId > 0 ? group.leadId : undefined}
                viewingId={v.id}
                initialPreferredChequeCount={v.preferredChequeCount}
                initialDesiredMoveIn={v.desiredMoveIn}
                paymentPlan={group.leadPaymentPlan}
                additionalDocsNote={group.leadAdditionalDocsNote}
                kycStatus={kycStatus}
                unitType={group.unit?.unitType ?? null}
                unit={group.unit}
                onReserve={() => setContractOpen(true)}
                onUtilitySubmitted={onRefresh}
                onStageChange={onRefresh}
              />
            </div>
          </div>

          {/* After ROW 2 */}
          {renewalContract && contract.renewalAccepted && (
            <>
              {/* Bridge */}
              <div className="flex items-center justify-center py-1">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-dashed border-[#2e9f82] bg-white text-[11px] text-[#2e9f82] font-semibold">
                  <RotateCcw size={12} /> rolls over to
                </div>
              </div>
              {/* 02 · Renewal label */}
              <p className="text-[9px] font-bold text-[#9b9890] uppercase tracking-widest px-1">02 · Renewal</p>
              {/* Renewal content */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                <ContractInlineSection contractId={renewalContract.id} onRefresh={onRefresh} isRenewal />
                <RenewalJourneyPanel parentContractId={contract.id} onRefresh={onRefresh} layout="journey" />
              </div>
            </>
          )}

          {/* ── BOTTOM: Viewing Appointment ── */}
          <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-[#f4f3ef] bg-[#fafaf8]">
              <Clock size={13} className="text-[#9b9890]" />
              <span className="text-xs font-semibold text-[#6b6860]">Viewing Appointment</span>
              <span className="ml-auto text-[10px] font-semibold rounded-full px-2.5 py-0.5"
                style={{ background: su.bg, color: su.text }}>{su.label}</span>
            </div>
            <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex items-center gap-2">
                <Calendar size={13} className="text-[#2e9f82] shrink-0" />
                <span className="text-sm font-bold text-[#1a1916]">{fmtDate(v.scheduledAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={12} className="text-[#9b9890] shrink-0" />
                <span className="text-xs text-[#6b6860]">{fmtTime(v.scheduledAt)}</span>
              </div>
              {v.unit?.property?.fullAddress && (
                <div className="flex items-start gap-2">
                  <MapPin size={12} className="text-[#9b9890] shrink-0 mt-0.5" />
                  <span className="text-xs text-[#6b6860]">{v.unit.property.fullAddress}</span>
                </div>
              )}
            </div>
            {canModify && (
              <div className="px-4 pb-4 flex gap-2.5">
                <button onClick={() => setRescheduleOpen(true)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold border border-[#2e9f82] hover:bg-[#edf7f3] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  style={{ color: '#2e9f82' }}>
                  <Pencil size={11} /> Reschedule
                </button>
                <button disabled={cancelling} onClick={handleCancel}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold border border-[#fee2e2] text-[#b91c1c] hover:bg-red-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
                  <X size={11} /> {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              </div>
            )}
            {actionError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg mx-4 mb-3 px-3 py-2">{actionError}</div>}
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-5 items-start">

        {/* ── LEFT: Booking Details Card ── */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-3 border-b border-[#e8e6e0]"
            style={{ background: 'linear-gradient(135deg, #f0faf6 0%, #edf7f3 100%)' }}>
            <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white text-base font-bold shadow-sm"
              style={{ background: 'linear-gradient(135deg, #2e9f82, #1f6655)' }}>
              {buildingInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-[#1a1916] truncate">
                  {v.unit?.property?.buildingName ?? v.unit?.unitName ?? 'Property'}
                </span>
                <span className="flex-shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-[#d8f2e8] text-[#1a7a5a] flex items-center gap-1">
                  <CheckCircle2 size={9} /> Verified
                </span>
              </div>
              <p className="text-xs text-[#9b9890] mt-0.5 flex items-center gap-1">
                <Clock size={10} /> Viewing appointment
              </p>
            </div>
            <span className="flex-shrink-0 text-[10px] font-semibold rounded-full px-2.5 py-1"
              style={{ background: su.bg, color: su.text }}>
              {su.label}
            </span>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="bg-[#f4f3ef] rounded-xl p-4 space-y-2">
              <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide">Viewing Appointment</p>
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-[#2e9f82] shrink-0" />
                <span className="text-base font-bold text-[#1a1916]">{fmtDate(v.scheduledAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-[#9b9890] shrink-0" />
                <span className="text-sm font-semibold text-[#3d3b35]">{fmtTime(v.scheduledAt)}</span>
              </div>
            </div>

            {v.unit?.property?.fullAddress && (
              <div className="flex items-start gap-2 text-sm text-[#6b6860]">
                <MapPin size={14} className="text-[#9b9890] shrink-0 mt-0.5" />
                <span>{v.unit.property.fullAddress}</span>
              </div>
            )}

            {(v.unit?.bedrooms != null || v.unit?.unitType) && (
              <div className="flex items-center gap-4 text-sm text-[#6b6860]">
                {v.unit?.unitType && (
                  <span className="flex items-center gap-1.5">
                    <Building2 size={13} className="text-[#9b9890]" />
                    {v.unit.unitType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                )}
                {v.unit?.bedrooms != null && (
                  <span className="flex items-center gap-1.5">
                    <BedDouble size={13} className="text-[#9b9890]" />
                    {v.unit.bedrooms} Bed
                  </span>
                )}
              </div>
            )}

            {v.unit?.rentalPrice != null && v.unit.rentalPrice > 0 && (
              <div className="flex items-center justify-between text-sm border-t border-[#f4f3ef] pt-3">
                <span className="text-[#6b6860]">Annual Rent</span>
                <span className="font-bold text-[#1a1916]">{fmtAed(v.unit.rentalPrice)}</span>
              </div>
            )}

            {v.notes && (
              <p className="text-xs text-[#9b9890] italic border-t border-[#f4f3ef] pt-3">{v.notes}</p>
            )}

            {group.others.length > 0 && (
              <div className="border-t border-[#f4f3ef] pt-3 space-y-1.5">
                <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide">Previous Viewings</p>
                <div className="flex flex-col gap-1">
                  {group.others.map(ov => (
                    <span key={ov.id} className={`inline-flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 font-medium w-fit ${
                      ov.status === 'no_show'   ? 'bg-[#fee2e2] text-[#b91c1c]' :
                      ov.status === 'cancelled' ? 'bg-[#f4f3ef] text-[#9b9890]' : 'bg-[#fef3c7] text-[#92400e]'
                    }`}>
                      <Calendar size={10} />
                      {fmtDate(ov.scheduledAt)} · {fmtTime(ov.scheduledAt)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(canModify || (hasVisited && !contractOpen && !contractDone)) && (
              <div className="border-t border-[#f4f3ef] pt-4 flex flex-col gap-2.5">
                {canModify && (
                  <>
                    <button onClick={() => setRescheduleOpen(true)}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold border border-[#2e9f82] hover:bg-[#edf7f3] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      style={{ color: '#2e9f82' }}>
                      <Pencil size={13} /> Reschedule Viewing
                    </button>
                    <button disabled={cancelling} onClick={handleCancel}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold border border-[#fee2e2] text-[#b91c1c] hover:bg-red-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer">
                      <X size={13} /> {cancelling ? 'Cancelling…' : 'Cancel Viewing'}
                    </button>
                  </>
                )}
                {hasVisited && !contractOpen && !contractDone && (
                  <button onClick={() => setNotInterestedOpen(true)}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold border border-[#e8e6e0] text-[#9b9890] hover:text-[#b91c1c] hover:border-[#fee2e2] transition-colors flex items-center justify-center gap-2 cursor-pointer">
                    <ThumbsDown size={13} /> Not Interested
                  </button>
                )}
              </div>
            )}

            {actionError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>}

            {contractOpen && group.unit && !contractDone && (
              <div className="border-t border-[#f4f3ef] pt-4">
                <ContractForm unit={group.unit} onSuccess={id => { setContractId(id); setContractDone(true); setContractOpen(false); }} onCancel={() => setContractOpen(false)} />
              </div>
            )}
            {contractDone && (
              <div className="rounded-xl bg-[#f0faf6] border border-[#c5e8df] px-4 py-3">
                <p className="text-sm font-bold text-[#1a7a5a] mb-1">Reservation submitted!</p>
                <p className="text-xs text-[#3d8c6e]">The rental provider will review and issue your contract.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Timeline (no contract yet — no renewal possible without a contract) ── */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
            <TenancyJourneyPanel
              contract={contract}
              viewingStatus={v.status}
              leadStage={group.leadStage}
              leadId={group.leadId > 0 ? group.leadId : undefined}
              viewingId={v.id}
              initialPreferredChequeCount={v.preferredChequeCount}
              initialDesiredMoveIn={v.desiredMoveIn}
              paymentPlan={group.leadPaymentPlan}
              additionalDocsNote={group.leadAdditionalDocsNote}
              kycStatus={kycStatus}
              unitType={group.unit?.unitType ?? null}
              unit={group.unit}
              onReserve={() => setContractOpen(true)}
              onUtilitySubmitted={onRefresh}
              onStageChange={onRefresh}
            />
          </div>
        </div>

      </div>
      )}
    </>
  );
}

function DirectExpandedDetail({
  lead, contract, renewalContract, onRefresh, kycStatus,
}: {
  lead: DirectLead; contract?: TenantContract; renewalContract?: TenantContract; onRefresh: () => void; kycStatus?: string;
}) {
  const [contractOpen, setContractOpen] = useState(false);
  const [contractDone, setContractDone] = useState(false);
  const [contractId, setContractId] = useState<number | null>(null);
  const { label: stageLabel, bg: stageBg, text: stageText } = leadStageLabel(lead.stage);
  const buildingInitial = (lead.unit?.property?.buildingName ?? lead.unit?.unitName ?? 'P').charAt(0).toUpperCase();

  const appDateLabel = new Date(lead.createdAt).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });

  if (contract) {
    return (
      <div className="space-y-5">
        {/* ── ROW 1 (only when a renewal is in flight):
                Renewal Contract details (renewal child) | Renewal Journey */}
        {renewalContract && contract.renewalAccepted && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <ContractInlineSection contractId={renewalContract.id} onRefresh={onRefresh} isRenewal />
              <RenewalJourneyPanel parentContractId={contract.id} onRefresh={onRefresh} layout="journey" />
            </div>
            {/* Visible separator between the in-flight renewal and the still-active original contract */}
            <div className="border-t border-[#e8e6e0]" />
          </>
        )}

        {/* ── ROW 2: Contract (left, parent) | Contract Journey (right) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <ContractInlineSection contractId={contract.id} onRefresh={onRefresh} moveInInspection={contract.moveInInspection} />
          <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
            <TenancyJourneyPanel
              contract={contract}
              leadStage={lead.stage}
              leadId={lead.id}
              paymentPlan={lead.paymentPlan}
              additionalDocsNote={lead.additionalDocsNote}
              kycStatus={kycStatus}
              unitType={lead.unit?.unitType ?? null}
              unit={lead.unit}
              onReserve={() => setContractOpen(true)}
              onUtilitySubmitted={onRefresh}
              onStageChange={onRefresh}
            />
          </div>
        </div>

        {/* ── BOTTOM: Application info ── */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-[#f4f3ef] bg-[#fafaf8]">
            <FileText size={13} className="text-[#9b9890]" />
            <span className="text-xs font-semibold text-[#6b6860]">Direct Application</span>
            <span className="ml-auto text-[10px] font-semibold rounded-full px-2.5 py-0.5"
              style={{ background: stageBg, color: stageText }}>{stageLabel}</span>
          </div>
          <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              <Calendar size={13} className="text-[#2e9f82] shrink-0" />
              <span className="text-sm font-bold text-[#1a1916]">{appDateLabel}</span>
            </div>
            {lead.unit?.property?.fullAddress && (
              <div className="flex items-start gap-2 sm:col-span-2">
                <MapPin size={12} className="text-[#9b9890] shrink-0 mt-0.5" />
                <span className="text-xs text-[#6b6860]">{lead.unit.property.fullAddress}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-5 items-start">

      {/* ── LEFT: Application Details Card ── */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[#e8e6e0]"
          style={{ background: 'linear-gradient(135deg, #f0faf6 0%, #edf7f3 100%)' }}>
          <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white text-base font-bold shadow-sm"
            style={{ background: 'linear-gradient(135deg, #2e9f82, #1f6655)' }}>
            {buildingInitial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-[#1a1916] truncate">
                {lead.unit?.property?.buildingName ?? lead.unit?.unitName ?? 'Property'}
              </span>
              <span className="flex-shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-[#d8f2e8] text-[#1a7a5a] flex items-center gap-1">
                <CheckCircle2 size={9} /> Verified
              </span>
            </div>
            <p className="text-xs text-[#9b9890] mt-0.5">Direct Application</p>
          </div>
          <span className="flex-shrink-0 text-[10px] font-semibold rounded-full px-2.5 py-1"
            style={{ background: stageBg, color: stageText }}>
            {stageLabel}
          </span>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-[#f4f3ef] rounded-xl p-4 space-y-2">
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide">Application Submitted</p>
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-[#2e9f82] shrink-0" />
              <span className="text-base font-bold text-[#1a1916]">
                {new Date(lead.createdAt).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })}
              </span>
            </div>
            <p className="text-xs text-[#9b9890]">Your application is being reviewed</p>
          </div>

          {lead.unit?.property?.fullAddress && (
            <div className="flex items-start gap-2 text-sm text-[#6b6860]">
              <MapPin size={14} className="text-[#9b9890] shrink-0 mt-0.5" />
              <span>{lead.unit.property.fullAddress}</span>
            </div>
          )}

          {(lead.unit?.bedrooms != null || lead.unit?.unitType) && (
            <div className="flex items-center gap-4 text-sm text-[#6b6860]">
              {lead.unit?.unitType && (
                <span className="flex items-center gap-1.5">
                  <Building2 size={13} className="text-[#9b9890]" />
                  {lead.unit.unitType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </span>
              )}
              {lead.unit?.bedrooms != null && (
                <span className="flex items-center gap-1.5">
                  <BedDouble size={13} className="text-[#9b9890]" />
                  {lead.unit.bedrooms} Bed
                </span>
              )}
            </div>
          )}

          {lead.unit?.rentalPrice != null && lead.unit.rentalPrice > 0 && (
            <div className="flex items-center justify-between text-sm border-t border-[#f4f3ef] pt-3">
              <span className="text-[#6b6860]">Annual Rent</span>
              <span className="font-bold text-[#1a1916]">{fmtAed(lead.unit.rentalPrice)}</span>
            </div>
          )}

          {contractOpen && lead.unit && !contractDone && (
            <div className="border-t border-[#f4f3ef] pt-4">
              <ContractForm unit={lead.unit} onSuccess={id => { setContractId(id); setContractDone(true); setContractOpen(false); }} onCancel={() => setContractOpen(false)} />
            </div>
          )}
          {contractDone && (
            <div className="rounded-xl bg-[#f0faf6] border border-[#c5e8df] px-4 py-3">
              <p className="text-sm font-bold text-[#1a7a5a]">Reservation submitted!</p>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT column (no contract yet — no renewal possible) ── */}
      <div className="space-y-5">
        <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
          <TenancyJourneyPanel
            contract={contract}
            leadStage={lead.stage}
            leadId={lead.id}
            paymentPlan={lead.paymentPlan}
            additionalDocsNote={lead.additionalDocsNote}
            kycStatus={kycStatus}
            unitType={lead.unit?.unitType ?? null}
            unit={lead.unit}
            onReserve={() => setContractOpen(true)}
            onUtilitySubmitted={onRefresh}
            onStageChange={onRefresh}
          />
        </div>
      </div>

    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Contract inline helpers
────────────────────────────────────────────────────────────────────────────── */

function CRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-[#f4f3ef] last:border-0">
      <span className="text-xs text-[#9b9890] shrink-0 w-24">{label}</span>
      <span className="text-xs font-semibold text-[#1a1916] text-right">{value ?? '—'}</span>
    </div>
  );
}

function SigPad({ onChange }: { onChange: (url: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) { const t = e.touches[0]; return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }; }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }
  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath(); ctx.moveTo(x, y);
    setIsDrawing(true);
  }
  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
  }
  function stopDraw() {
    if (!isDrawing) return;
    setIsDrawing(false); setHasDrawn(true);
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
  }
  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) { ctx.clearRect(0, 0, canvas.width, canvas.height); setHasDrawn(false); onChange(null); }
  }
  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-[#e8e6e0] rounded-xl overflow-hidden">
        <canvas ref={canvasRef} width={560} height={140}
          className="w-full cursor-crosshair touch-none" style={{ height: '140px' }}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[#c0bdb8] text-sm">Draw your signature here</span>
          </div>
        )}
      </div>
      {hasDrawn && (
        <button onClick={clear} type="button" className="flex items-center gap-1.5 text-xs text-[#9b9890] hover:text-[#1a1916] cursor-pointer">
          <RotateCcw size={12} /> Clear
        </button>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Contract Inline Section (full contract detail embedded in detail view)
────────────────────────────────────────────────────────────────────────────── */

const C_STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700', issued: 'bg-blue-50 text-blue-700',
  pending: 'bg-amber-50 text-amber-700', expired: 'bg-[#f4f3ef] text-[#6b6860]',
  terminated: 'bg-red-50 text-red-700',
};
const C_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending Review', issued: 'Awaiting Signature', active: 'Active',
  expired: 'Expired', terminated: 'Terminated',
};

interface TenantDocItem {
  id: number;
  documentKey: string;
  category: string;
  fileUrl?: string;
  status?: string;
  displayName?: string | null;
  notes?: string | null;
}

/**
 * Renewal Journey Panel — SCRUM-273
 *
 * Renders separately BELOW the active-contract panel when a renewal is in flight.
 * Shows a 4-step timeline: Terms Offered → Signatures → Ejari Renewal → Active Renewal.
 *
 * Step 1 (Terms Offered) is the only one with tenant-driven actions (Accept / Reject).
 * Steps 2-4 reflect the renewal child contract's progress driven by the RP.
 *
 * The panel auto-hides if the parent contract has no renewal in flight
 * (`renewalAccepted` is null) — it only renders when there's something to show.
 */
function RenewalJourneyPanel({ parentContractId, onRefresh, layout = 'full' }: {
  parentContractId: number;
  onRefresh: () => void;
  // 'full' renders the contract card + timeline stacked inside one panel (legacy/default).
  // 'contract' renders only the Renewal Contract & Payment Plan card (left column).
  // 'journey'  renders only the header + 6-step timeline (right column).
  layout?: 'full' | 'contract' | 'journey';
}) {
  interface ChildPayment {
    id: number;
    paymentType: string | null;
    amount: number;
    description: string | null;
    chequeStatus: string;
    dueDate: string | null;
  }
  interface ChildContract {
    id: number;
    contractStartDate?: string; startDate?: string;
    contractEndDate?: string;   endDate?: string;
    annualRent: number;
    numberOfInstallments: number | null;
    modeOfPayment: string | null;
    status: string;
    ejariStatus: string | null;
    notes: string | null;
    adminFeeFils?: number;
    ejariFeeFils?: number;
    payments?: ChildPayment[];
    pdcConfirmed?: boolean;
    tenantChequesSubmittedAt?: string | null;
    signatures?: Array<{ role: 'landlord' | 'tenant'; signedAt: string }>;
  }
  interface ParentSnapshot {
    renewalAccepted: 'pending' | 'accepted' | 'rejected' | null;
    renewalStatus: string | null;
    endDate: string;
    tenant: { name: string | null };
    landlord: { name: string | null; companyName: string | null };
    property: { buildingName: string | null; community: string | null; emirate: string | null; fullAddress: string | null };
    unit: { number: string | null; type: string | null };
  }
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [parent, setParent] = useState<ParentSnapshot | null>(null);
  const [child, setChild] = useState<ChildContract | null>(null);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Renewal docs are scoped to the RENEWAL CHILD CONTRACT (ownerType=tenancy_contract, ownerId=child.id)
  // — NOT the customer profile. This isolates them from the tenant's pre-existing uploads, so each
  // renewal requires a fresh submission and doesn't surface stale residency/employment docs.
  const [renewalDocs, setRenewalDocs] = useState<InlineDoc[] | null>(null);
  const [docUploading, setDocUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Tenant cheques-submitted gesture (renewal-only; mirrors lead.tenantChequesReady).
  // Declared up here with the other hooks so they sit ABOVE the early returns below.
  const [chequesSubmittedLocal, setChequesSubmittedLocal] = useState(false);
  const [submittingCheques, setSubmittingCheques] = useState(false);
  const [chequesError, setChequesError] = useState<string | null>(null);

  // Inline Sign Renewal Contract modal — keeps the tenant on this page instead of deep-linking.
  const { user: authUser } = useAuth();
  const [showSignRenewalModal, setShowSignRenewalModal] = useState(false);
  const [renewalSigImg, setRenewalSigImg] = useState<string | null>(null);
  const [signingRenewal, setSigningRenewal] = useState(false);
  const [signRenewalError, setSignRenewalError] = useState<string | null>(null);
  const [signRenewalSuccess, setSignRenewalSuccess] = useState(false);
  async function handleSignRenewal() {
    if (!child?.id) return;
    const sigName = (authUser?.name ?? '').trim();
    if (!renewalSigImg) { setSignRenewalError('Please draw your signature.'); return; }
    if (!sigName) { setSignRenewalError('Your profile name is empty. Update your profile first.'); return; }
    setSigningRenewal(true); setSignRenewalError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${child.id}/sign`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatoryName: sigName, signatureImage: renewalSigImg }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSignRenewalError((body as { message?: string }).message ?? 'Failed to sign');
        return;
      }
      setSignRenewalSuccess(true);
      setShowSignRenewalModal(false);
      onRefresh();
    } finally { setSigningRenewal(false); }
  }

  const reloadDocs = useCallback(() => {
    if (!child?.id) { setRenewalDocs([]); return; }
    fetch(`/api/documents?ownerType=tenancy_contract&ownerId=${child.id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((docs: InlineDoc[]) => setRenewalDocs(Array.isArray(docs) ? docs : []))
      .catch(() => setRenewalDocs([]));
  }, [child?.id]);

  // Explicit "Submit Documents" gesture — persisted in localStorage per renewal child so it
  // survives page reloads without a new backend column.
  const [docsSubmittedAt, setDocsSubmittedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!child?.id) { setDocsSubmittedAt(null); return; }
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem(`renewalDocsSubmittedAt:${child.id}`);
    setDocsSubmittedAt(v);
  }, [child?.id]);
  function handleSubmitRenewalDocs() {
    if (!child?.id) return;
    const ts = new Date().toISOString();
    try { window.localStorage.setItem(`renewalDocsSubmittedAt:${child.id}`, ts); } catch { /* swallow private-mode errors */ }
    setDocsSubmittedAt(ts);
  }

  async function handleRenewalDocUpload(req: DocReq, file: File, existingDocId?: number) {
    if (!child?.id) { setUploadError('Renewal contract not ready'); return; }
    setDocUploading(req.key); setUploadError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: child.id, documentKey: req.key, originalName: file.name, mimeType: file.type }),
      });
      if (!urlRes.ok) { setUploadError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; }
      })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUploadError('File upload failed'); return; }
      const docRes = existingDocId
        ? await fetch(`/api/documents/${existingDocId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey }) })
        // isVisibleToTenant must be set explicitly — it defaults to false on the backend, which
        // would hide the tenant's own renewal uploads from their own contract card.
        : await fetch('/api/documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: child.id, documentKey: req.key, category: req.category, displayName: req.label, fileUrl, mimeType: file.type, s3Key: fileKey, isVisibleToTenant: true }) });
      if (!docRes.ok) {
        const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
        setUploadError(Array.isArray(b.message) ? b.message[0] : (b.message ?? 'Failed to save'));
        return;
      }
      reloadDocs();
    } catch { setUploadError('Unexpected error during upload'); }
    finally { setDocUploading(null); }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch(`/api/contracts/tenant/${parentContractId}`, { credentials: 'include' }),
        fetch(`/api/contracts/${parentContractId}/renewal`, { credentials: 'include' }),
      ]);
      if (pRes.ok) {
        const p = await pRes.json();
        setParent({
          renewalAccepted: p.renewalAccepted ?? null,
          renewalStatus: p.renewalStatus ?? null,
          endDate: p.endDate,
          tenant: { name: p.tenant?.name ?? null },
          landlord: { name: p.landlord?.name ?? null, companyName: p.landlord?.companyName ?? null },
          property: {
            buildingName: p.property?.buildingName ?? null,
            community: p.property?.community ?? null,
            emirate: p.property?.emirate ?? null,
            fullAddress: p.property?.fullAddress ?? null,
          },
          unit: { number: p.unit?.number ?? null, type: p.unit?.type ?? null },
        });
      }
      if (cRes.ok) {
        const c = await cRes.json();
        // Once accepted, the child is status=ISSUED and the tenant can fetch its full detail (signatures, pdcConfirmed).
        if (c?.id && c?.status && c.status !== 'pending') {
          try {
            const detRes = await fetch(`/api/contracts/tenant/${c.id}`, { credentials: 'include' });
            if (detRes.ok) {
              const det = await detRes.json();
              setChild({ ...c, pdcConfirmed: det.pdcConfirmed, signatures: det.signatures ?? [] });
            } else {
              setChild(c);
            }
          } catch { setChild(c); }
        } else {
          setChild(c ?? null);
        }
      } else {
        setChild(null);
      }
    } finally {
      setLoading(false);
    }
  }, [parentContractId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { reloadDocs(); }, [reloadDocs]);

  // Refetch on tab focus so RP-side updates to the renewal child contract
  // (Ejari registered, renewal activated) flow through automatically.
  useEffect(() => {
    function refetchIfVisible() {
      if (document.visibilityState === 'visible') { load(); reloadDocs(); }
    }
    window.addEventListener('focus', refetchIfVisible);
    document.addEventListener('visibilitychange', refetchIfVisible);
    return () => {
      window.removeEventListener('focus', refetchIfVisible);
      document.removeEventListener('visibilitychange', refetchIfVisible);
    };
  }, [load, reloadDocs]);

  async function handleAccept() {
    setBusy('accept'); setError(null);
    try {
      const res = await fetch(`/api/contracts/${parentContractId}/renewal/accept`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `Error ${res.status}`); }
      await load(); onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to accept');
    } finally { setBusy(null); }
  }
  function handlePrintRenewal() {
    if (!child || !parent) return;
    const tenantName = (parent.tenant?.name ?? user?.name ?? '—').trim() || '—';
    const landlordName = parent.landlord?.name?.trim() || null;
    const landlordCompany = parent.landlord?.companyName?.trim() || null;
    const ownerName = landlordName && landlordCompany ? `${landlordName} (${landlordCompany})` : (landlordName || landlordCompany || 'To be confirmed');
    const buildingName = parent.property?.buildingName ?? '—';
    const location = [parent.property?.community, parent.property?.emirate].filter(Boolean).join(', ') || parent.property?.fullAddress || '—';
    const startD = child.startDate ?? child.contractStartDate ?? '';
    const endD   = child.endDate   ?? child.contractEndDate   ?? '';
    const fmt = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const aed = (n: number) => `AED ${Number(n).toLocaleString('en-AE')}`;
    const months = startD && endD ? (() => {
      const s = new Date(startD), e = new Date(endD);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
      return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
    })() : null;
    const ch = child.payments ?? [];
    const total = ch.reduce((s, p) => s + Number(p.amount), 0);
    const itemsHtml = ch.map((it, i) => `
      <tr>
        <td>#${i + 1}</td>
        <td>${(it.description ?? `Cheque ${i + 1}`).replace(/</g, '&lt;')}</td>
        <td style="text-align:right">${aed(Number(it.amount))}</td>
        <td>${it.dueDate ?? '—'}</td>
      </tr>`).join('');
    const adminF = Number(child.adminFeeFils ?? 0);
    const ejariF = Number(child.ejariFeeFils ?? 0);
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Renewal — ${buildingName}</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1916;padding:32px;max-width:780px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:13px;margin:24px 0 8px;color:#0369a1;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e0f2fe;padding-bottom:4px}
  .sub{font-size:11px;color:#6b6860;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:170px 1fr;gap:6px 16px;font-size:12px;margin-bottom:8px}
  .grid .l{color:#9b9890;text-transform:uppercase;font-size:10px;letter-spacing:.05em;padding-top:2px}
  .grid .v{color:#1a1916;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e8e6e0}
  th{background:#f4f3ef;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b6860}
  tfoot td{font-weight:700;background:#f0f9ff;color:#0369a1;border-top:2px solid #bae6fd}
  .footer{margin-top:32px;font-size:10px;color:#9b9890;text-align:center;border-top:1px solid #e8e6e0;padding-top:12px}
  @media print{body{padding:16px} .noprint{display:none}}
  .btnrow{margin:0 0 24px;display:flex;gap:8px}
  .btn{display:inline-block;padding:8px 14px;background:#2e9f82;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer}
  .btn.alt{background:#f4f3ef;color:#3d3b35}
  .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;background:#e7f5f0;color:#1f7e66;margin-left:6px;vertical-align:middle}
</style></head>
<body>
  <div class="btnrow noprint">
    <button class="btn" onclick="window.print()">Print / Save as PDF</button>
    <button class="btn alt" onclick="window.close()">Close</button>
  </div>
  <h1>Renewal Contract &amp; Payment Plan <span class="badge">RENEWAL</span></h1>
  <p class="sub">${buildingName}${parent.unit?.number ? ` · Unit ${parent.unit.number}` : ''} · Generated ${new Date().toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' })}</p>

  <h2>Contract &amp; Cheque Details</h2>
  <div class="grid">
    <div class="l">Cheque Drawer (Tenant)</div><div class="v">${tenantName}</div>
    <div class="l">Cheque Payee (Landlord)</div><div class="v">${ownerName}</div>
    <div class="l">Building</div><div class="v">${buildingName}</div>
    <div class="l">Unit No.</div><div class="v">${parent.unit?.number ?? '—'}</div>
    <div class="l">Location</div><div class="v">${location}</div>
    <div class="l">Renewal Period</div><div class="v">${fmt(startD)} → ${fmt(endD)}${months ? ` (${months} months)` : ''}</div>
    <div class="l">Total Renewal Value</div><div class="v">${aed(total)}</div>
  </div>

  <h2>Rent &amp; Fees</h2>
  <div class="grid">
    <div class="l">New Annual Rent</div><div class="v">${aed(Number(child.annualRent))}</div>
    <div class="l">Security Deposit</div><div class="v">Carries forward from original contract</div>
    ${adminF > 0 ? `<div class="l">Admin Fee</div><div class="v">${aed(adminF)}</div>` : ''}
    ${ejariF > 0 ? `<div class="l">Ejari Fee</div><div class="v">${aed(ejariF)}</div>` : ''}
  </div>

  <h2>Cheque Schedule (${ch.length} ${ch.length === 1 ? 'cheque' : 'cheques'})</h2>
  <table>
    <thead><tr><th>#</th><th>Description</th><th style="text-align:right">Amount</th><th>Due Date</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td style="text-align:right">${aed(total)}</td><td></td></tr></tfoot>
  </table>

  ${child.notes ? `<h2>Notes</h2><p style="font-size:12px;color:#3d3b35">${child.notes.replace(/</g, '&lt;')}</p>` : ''}

  <div class="footer">Generated by UpNow · Renewal of original tenancy contract</div>
</body></html>`;
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) { alert('Please allow pop-ups to print the renewal.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function handleReject() {
    setBusy('reject'); setError(null);
    try {
      const reason = window.prompt('Optional — reason for rejecting:') ?? '';
      const res = await fetch(`/api/contracts/${parentContractId}/renewal/reject`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `Error ${res.status}`); }
      await load(); onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to reject');
    } finally { setBusy(null); }
  }

  if (loading) return null;
  // Nothing to render when there's no renewal in flight
  if (!parent || !parent.renewalAccepted) return null;

  const childStart = child?.startDate ?? child?.contractStartDate ?? '';
  const childEnd   = child?.endDate   ?? child?.contractEndDate   ?? '';
  function fmtD(d: string) { return d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

  // Step state — 6 steps mirroring the new-lease pipeline (minus Issued + Utility, which don't apply to a renewal)
  //   1. Terms Offered
  //   2. Rental Documents          — tenant must submit fresh docs for the renewal; done when RP collects cheques
  //                                  (PDC confirmation implies docs were reviewed and accepted upstream)
  //   3. Payment Plan & Cheques    — done when RP marks pdcConfirmed on the child contract
  //   4. Signatures                — done when both landlord + tenant have signed the child
  //   5. Ejari Renewal             — done when child.ejariStatus === 'registered'
  //   6. Active Renewal            — done when child.status === 'active'
  const accepted = parent.renewalAccepted === 'accepted';
  const rejected = parent.renewalAccepted === 'rejected';
  const ejariDone = child?.ejariStatus === 'registered';
  const active = child?.status === 'active';
  const pdcDone = !!child?.pdcConfirmed;
  const chequesSubmittedAt = child?.tenantChequesSubmittedAt ?? null;
  const chequesSubmitted = !!chequesSubmittedAt || chequesSubmittedLocal;
  async function handleConfirmRenewalCheques() {
    if (!child?.id) return;
    setSubmittingCheques(true); setChequesError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${child.id}/cheques-submitted`, {
        method: 'PATCH', credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setChequesError((body as { message?: string }).message ?? 'Failed to submit');
        return;
      }
      setChequesSubmittedLocal(true);
      onRefresh();
    } finally { setSubmittingCheques(false); }
  }
  const sigs = child?.signatures ?? [];
  const landlordSigned = sigs.some(s => s.role === 'landlord');
  const tenantSigned = sigs.some(s => s.role === 'tenant');
  const bothSigned = landlordSigned && tenantSigned;

  type StepState = 'done' | 'current' | 'upcoming' | 'rejected';
  function stepState(prevDone: boolean, thisDone: boolean): StepState {
    if (!prevDone) return 'upcoming';
    if (thisDone) return 'done';
    return 'current';
  }
  const s1: StepState = rejected ? 'rejected' : accepted ? 'done' : 'current';
  // Step 2 is "done" when the tenant has uploaded every required renewal doc (no rejections),
  // OR the RP has already moved past this stage (PDC confirmed / signed / Ejari / active —
  // backstops for contracts where docs were collected offline).
  const renewalRequired = getRenewalRequiredDocs(parent?.unit?.type ?? null).filter(d => d.required);
  const uploadedKeys    = new Set((renewalDocs ?? []).filter(d => d.status !== 'rejected').map(d => d.documentKey));
  // All required docs uploaded with no rejections — gates the Submit button.
  const renewalDocsReady = renewalDocs !== null
    && renewalRequired.every(req => uploadedKeys.has(req.key))
    && (renewalDocs ?? []).every(d => d.status !== 'rejected');
  // Step 2 is only "done" when the tenant explicitly submits (or the RP has already moved past).
  const s2: StepState = stepState(accepted, !!docsSubmittedAt || pdcDone || bothSigned || !!ejariDone || !!active);
  const s3: StepState = stepState(s2 === 'done', pdcDone);
  const s4: StepState = stepState(s3 === 'done', bothSigned);
  const s5: StepState = stepState(s4 === 'done', !!ejariDone);
  const s6: StepState = stepState(s5 === 'done', !!active);

  return (
    <div className="bg-white rounded-2xl border border-[#c5e8df] shadow-sm overflow-hidden">
      {/* Header — only on journey or full layout. Contract-only layout uses its own header. */}
      {layout !== 'contract' && (
        <div className="px-5 py-4 border-b border-[#c5e8df] flex items-center justify-between gap-3 flex-wrap" style={{ background: 'linear-gradient(180deg, #f0faf6 0%, #fafff7 100%)' }}>
          <div className="flex items-center gap-2.5">
            <RotateCcw size={16} className="text-[#2e9f82]" />
            <div>
              <p className="text-sm font-bold text-[#166651]">Renewal Journey</p>
              <p className="text-[11px] text-[#1f7e66]">
                {rejected   ? 'You rejected the proposed renewal.' :
                 accepted   ? 'Renewal terms accepted — signing & Ejari renewal in progress.' :
                              `Your landlord has proposed new terms. Current lease ends ${fmtD(parent.endDate)}.`}
              </p>
            </div>
          </div>
          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
            rejected ? 'bg-red-100 text-red-700'
                     : accepted ? 'bg-[#e7f5f0] text-[#1f7e66]'
                                : 'bg-[#fdf3e3] text-[#a85b15]'
          }`}>
            {rejected ? 'Rejected' : accepted ? 'In Progress' : 'Action Required'}
          </span>
        </div>
      )}

      {/* Proposed Renewal — Contract & Payment Plan (matches the new-lease "Payment Plan & Cheques" layout) */}
      {layout !== 'journey' && child && (() => {
        const tenantName = (parent?.tenant?.name ?? user?.name ?? '').trim() || null;
        const landlordName = parent?.landlord?.name?.trim() || null;
        const landlordCompany = parent?.landlord?.companyName?.trim() || null;
        const ownerName = landlordName && landlordCompany
          ? `${landlordName} (${landlordCompany})`
          : (landlordName || landlordCompany);
        const location = [parent?.property?.community, parent?.property?.emirate].filter(Boolean).join(', ') || parent?.property?.fullAddress || null;
        const adminFee = Number(child.adminFeeFils ?? 0);
        const ejariFee = Number(child.ejariFeeFils ?? 0);
        const cheques = child.payments ?? [];
        // Total = sum of every row in the schedule. The schedule already includes
        // admin + ejari + rent installments + any extras, so this is the single
        // source of truth and matches what the tenant actually owes.
        const totalContractValue = cheques.reduce((sum, c) => sum + Number(c.amount), 0);
        // Calculate duration in months
        const durationMonths = childStart && childEnd ? (() => {
          const s = new Date(childStart); const e = new Date(childEnd);
          if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
          return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
        })() : null;
        return (
          <div className="px-5 py-4 border-b border-[#f0ede8]">
            <div className="bg-white border border-[#bae6fd] rounded-lg overflow-hidden">
              {/* Header */}
              <div className="bg-[#f0f9ff] border-b border-[#bae6fd] px-3 py-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-[#0369a1] flex items-center gap-1.5">
                  <FileSignature size={11} /> Renewal Contract &amp; Payment Plan
                </p>
                <button
                  type="button"
                  onClick={handlePrintRenewal}
                  className="text-[10px] font-semibold text-[#0369a1] hover:text-[#0284c7] flex items-center gap-1 cursor-pointer"
                >
                  <Printer size={10} /> Print / Download
                </button>
              </div>

              {/* Details grid */}
              <div className="p-3 border-b border-[#e0f2fe] grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                <div className="col-span-2">
                  <p className="text-[9px] text-[#9b9890] uppercase tracking-wide">Cheque Drawer (You)</p>
                  <p className="text-[#1a1916] font-semibold">{tenantName ?? <span className="text-[#9b9890] font-normal italic">Update your profile to add your name</span>}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[9px] text-[#9b9890] uppercase tracking-wide">Cheque Payee (Landlord)</p>
                  <p className="text-[#1a1916] font-semibold">{ownerName ?? <span className="text-[#9b9890] font-normal italic">Will be confirmed by your landlord</span>}</p>
                </div>
                {parent?.property?.buildingName && (
                  <div>
                    <p className="text-[9px] text-[#9b9890] uppercase tracking-wide">Building</p>
                    <p className="text-[#1a1916] font-semibold">{parent.property.buildingName}</p>
                  </div>
                )}
                {parent?.unit?.number && (
                  <div>
                    <p className="text-[9px] text-[#9b9890] uppercase tracking-wide">Unit No.</p>
                    <p className="text-[#1a1916] font-semibold">{parent.unit.number}</p>
                  </div>
                )}
                {location && (
                  <div className="col-span-2">
                    <p className="text-[9px] text-[#9b9890] uppercase tracking-wide">Location</p>
                    <p className="text-[#1a1916] font-semibold">{location}</p>
                  </div>
                )}
                {childStart && childEnd && (
                  <div className="col-span-2">
                    <p className="text-[9px] text-[#9b9890] uppercase tracking-wide">Renewal Period</p>
                    <p className="text-[#1a1916] font-semibold">{fmtD(childStart)} → {fmtD(childEnd)}{durationMonths ? <span className="text-[#9b9890] font-normal"> ({durationMonths} months)</span> : null}</p>
                  </div>
                )}
              </div>

              {/* Fee summary — high level only; per-line detail is in the schedule below */}
              <div className="px-3 py-2 border-b border-[#e0f2fe] bg-[#fafaf8]">
                <p className="text-[9px] text-[#9b9890] uppercase tracking-wide mb-1">Rent &amp; Fees</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-[#6b6860]">
                  <span>New Annual Rent: <b className="text-[#1a1916]">AED {Number(child.annualRent).toLocaleString('en-AE')}</b></span>
                  <span>Security Deposit: <b className="text-[#1a1916]">Carries forward</b></span>
                  {adminFee > 0 && <span>Admin Fee: <b className="text-[#1a1916]">AED {adminFee.toLocaleString('en-AE')}</b><span className="text-[#9b9890]"> · in schedule</span></span>}
                  {ejariFee > 0 && <span>Ejari Fee: <b className="text-[#1a1916]">AED {ejariFee.toLocaleString('en-AE')}</b><span className="text-[#9b9890]"> · in schedule</span></span>}
                </div>
                <p className="text-[10px] font-bold text-[#0369a1] mt-1">
                  Total Renewal Value: AED {totalContractValue.toLocaleString('en-AE')} · {cheques.length} {cheques.length === 1 ? 'cheque' : 'cheques'}
                </p>
                <p className="text-[9px] text-[#9b9890] mt-0.5">
                  Sum of every line in the cheque schedule below.
                </p>
              </div>

              {/* Cheque schedule */}
              {cheques.length > 0 && (
                <div className="px-3 py-2">
                  <p className="text-[9px] text-[#9b9890] uppercase tracking-wide mb-1">Cheque Schedule</p>
                  <div className="space-y-1">
                    {cheques.map((c, i) => (
                      <p key={c.id} className="text-[10px] py-0.5 border-b border-[#e0f2fe] last:border-0 leading-snug">
                        <span className="text-[#0369a1]">#{i + 1} {c.description ?? `Cheque ${i + 1}`}</span>
                        <span className="text-[#6b6860]"> — </span>
                        <span className="font-semibold text-[#1a1916]">AED {Number(c.amount).toLocaleString('en-AE')}</span>
                        {c.dueDate && <span className="text-[#6b6860]"> · {c.dueDate}</span>}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {child.notes && (
                <p className="text-[10px] text-[#6b6860] italic px-3 py-2 border-t border-[#e0f2fe]">{child.notes}</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* 6-step timeline — hidden when only rendering the contract card */}
      {layout !== 'contract' && (
      <div className="px-5 py-4">
        <ol className="space-y-3">
          <RenewalStep num={1} label="Terms Offered" state={s1}>
            {s1 === 'current' && (
              <div className="mt-2 flex gap-2">
                <button onClick={handleAccept} disabled={!!busy}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: '#2e9f82' }}>
                  {busy === 'accept' ? <Loader2 size={12} className="animate-spin" /> : <BadgeCheck size={12} />}
                  Accept Renewal
                </button>
                <button onClick={handleReject} disabled={!!busy}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f7f6f2] transition-colors disabled:opacity-50">
                  {busy === 'reject' ? <Loader2 size={12} className="animate-spin" /> : null}
                  Reject
                </button>
              </div>
            )}
            {s1 === 'done'     && <p className="text-[11px] text-[#2e9f82] mt-0.5">Accepted ✓</p>}
            {s1 === 'rejected' && <p className="text-[11px] text-red-700 mt-0.5">You rejected this renewal. Your landlord can propose new terms.</p>}
          </RenewalStep>

          <RenewalStep num={2} label="Rental Documents" state={s2}>
            {s2 === 'current' && (() => {
              // Renewal docs are a *subset* of the new-lease pack — only identity refresh
              // (residential) or commercial licensing re-verification is required.
              const requiredDocs = getRenewalRequiredDocs(parent?.unit?.type ?? null);
              return (
                <div className="mt-1.5 space-y-1.5">
                  <p className="text-[11px] text-[#6b6860]">
                    Submit fresh documents for the renewal — existing documents do not auto-carry over.
                  </p>
                  {uploadError && (
                    <p className="text-[10px] text-[#b91c1c] bg-[#fff1f2] border border-[#fecaca] rounded-lg px-2.5 py-1.5">{uploadError}</p>
                  )}
                  {!renewalDocs ? (
                    <p className="text-[10px] text-[#9b9890] flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Loading documents…</p>
                  ) : (
                    <div className="space-y-1.5">
                      {requiredDocs.filter(d => d.required).map(req => (
                        <InlineDocRow
                          key={req.key}
                          req={req}
                          docRecord={renewalDocs.find(d => d.documentKey === req.key)}
                          uploading={docUploading === req.key}
                          onUpload={handleRenewalDocUpload}
                        />
                      ))}
                      {requiredDocs.filter(d => !d.required).length > 0 && (
                        <details className="mt-1">
                          <summary className="text-[10px] font-semibold text-[#6b6860] cursor-pointer hover:text-[#1a1916]">+ Optional documents</summary>
                          <div className="mt-1.5 space-y-1.5">
                            {requiredDocs.filter(d => !d.required).map(req => (
                              <InlineDocRow
                                key={req.key}
                                req={req}
                                docRecord={renewalDocs.find(d => d.documentKey === req.key)}
                                uploading={docUploading === req.key}
                                onUpload={handleRenewalDocUpload}
                              />
                            ))}
                          </div>
                        </details>
                      )}
                      {/* Submit gesture — enabled once every required renewal doc is uploaded. */}
                      <button
                        type="button"
                        onClick={handleSubmitRenewalDocs}
                        disabled={!renewalDocsReady}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-white rounded-xl px-3 py-2.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                        style={{ background: '#2e9f82' }}
                      >
                        <CheckCircle2 size={11} /> Submit Documents
                      </button>
                      {!renewalDocsReady && (
                        <p className="text-[10px] text-[#9b9890] text-center">Upload every required document above to enable submit.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Done state stays compact — the docs panel only re-appears when this step is current. */}
            {s2 === 'done' && (
              <p className="text-[11px] text-[#2e9f82] mt-0.5">Documents submitted ✓</p>
            )}
          </RenewalStep>

          <RenewalStep num={3} label="Payment Plan & Cheques" state={s3}>
            {s3 === 'current' && (
              <div className="mt-1 space-y-1.5">
                {/* Mirrors the new-lease cheques-ready gesture: tenant explicitly confirms
                    they've prepared the cheques and handed them over. RP then records each
                    one and finalises with "Confirm PDC Received" on their side. */}
                <p className="text-[11px] text-[#6b6860]">
                  Prepare cheques per the schedule above and hand them to your landlord. When done, confirm below — your landlord will then record each cheque and mark collection complete.
                </p>
                {chequesError && (
                  <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">{chequesError}</p>
                )}
                {chequesSubmitted ? (
                  <p className="text-[11px] text-[#2e9f82] flex items-center gap-1.5">
                    <CheckCircle2 size={11} /> Cheques submission confirmed — waiting for your landlord to record &amp; confirm collection.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={submittingCheques}
                    onClick={handleConfirmRenewalCheques}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white rounded-lg px-3 py-2 cursor-pointer disabled:opacity-50"
                    style={{ background: '#2e9f82' }}
                  >
                    {submittingCheques ? <><Loader2 size={11} className="animate-spin" /> Submitting…</> : <><CheckCircle2 size={11} /> Confirm Cheques Submitted</>}
                  </button>
                )}
              </div>
            )}
            {s3 === 'done' && <p className="text-[11px] text-[#2e9f82] mt-0.5">Cheques collected by your landlord ✓</p>}
          </RenewalStep>

          <RenewalStep num={4} label="Signatures" state={s4}>
            {s4 === 'current' && (
              <div className="mt-0.5">
                <p className="text-[11px] text-[#6b6860]">
                  Landlord {landlordSigned ? <span className="text-[#2e9f82] font-semibold">signed ✓</span> : <span className="text-[#9b9890]">— awaiting</span>} ·
                  You {tenantSigned ? <span className="text-[#2e9f82] font-semibold">signed ✓</span> : <span className="text-[#9b9890]">— pending</span>}
                </p>
                {!tenantSigned && child?.id && (
                  <button type="button"
                    onClick={() => { setSignRenewalError(null); setRenewalSigImg(null); setShowSignRenewalModal(true); }}
                    className="inline-flex items-center gap-1.5 mt-1.5 text-[11px] font-semibold text-white rounded-lg px-3 py-1.5 cursor-pointer"
                    style={{ background: '#2e9f82' }}>
                    <FileSignature size={11} /> Sign Renewal Contract
                  </button>
                )}
                {signRenewalSuccess && tenantSigned && (
                  <p className="text-[10px] text-[#16a34a] mt-1">Signature recorded ✓</p>
                )}
              </div>
            )}
            {s4 === 'done' && <p className="text-[11px] text-[#2e9f82] mt-0.5">Both parties signed ✓</p>}
          </RenewalStep>

          <RenewalStep num={5} label="Ejari Renewal" state={s5}>
            {s5 === 'current' && <p className="text-[11px] text-[#6b6860] mt-0.5">Your landlord will renew Ejari with the Dubai Land Department.</p>}
            {s5 === 'done'    && <p className="text-[11px] text-[#2e9f82] mt-0.5">Ejari renewed ✓</p>}
          </RenewalStep>

          <RenewalStep num={6} label="Active Renewal" state={s6} last>
            {s6 === 'current' && <p className="text-[11px] text-[#6b6860] mt-0.5">Final activation by landlord — your renewed tenancy will begin.</p>}
            {s6 === 'done'    && <p className="text-[11px] text-[#2e9f82] mt-0.5">Renewal is live ✓ until {fmtD(childEnd)}.</p>}
          </RenewalStep>
        </ol>

        {error && (
          <p className="text-xs text-red-700 mt-3"><AlertCircle size={11} className="inline mr-1" />{error}</p>
        )}
      </div>
      )}

      {/* Inline Sign Renewal Contract modal — same UX as the new-lease contract sign modal */}
      {showSignRenewalModal && child?.id && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !signingRenewal && setShowSignRenewalModal(false)} />
          <div className="relative bg-white rounded-2xl p-6 w-full max-w-md shadow-xl overflow-y-auto max-h-[90vh]">
            <button type="button" className="absolute top-3 right-3 text-[#9b9890] hover:text-[#1a1916] cursor-pointer"
              onClick={() => !signingRenewal && setShowSignRenewalModal(false)}>
              <X size={18} />
            </button>
            <h3 className="font-bold text-lg text-[#1a1916] mb-0.5">Sign Renewal Contract</h3>
            <p className="text-xs text-[#9b9890] mb-4">Renewal #{child.id}</p>
            {signRenewalError && (
              <div className="mb-3 rounded-lg px-3 py-2 text-xs bg-red-50 text-red-700 border border-red-200">{signRenewalError}</div>
            )}
            {/* Signing as the authenticated profile — no second name entry */}
            {authUser?.name && (
              <div className="mb-3 rounded-lg border border-[#e8e6e0] bg-[#f7f6f2] px-3 py-2">
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide">Signing as</p>
                <p className="text-sm font-semibold text-[#1a1916]">{authUser.name}</p>
              </div>
            )}
            <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Draw your signature <span className="text-red-500">*</span></label>
            <SigPad onChange={setRenewalSigImg} />
            <button type="button" disabled={!renewalSigImg || signingRenewal} onClick={handleSignRenewal}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 cursor-pointer"
              style={{ background: '#2e9f82' }}>
              {signingRenewal ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
              {signingRenewal ? 'Signing…' : 'Sign & Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RenewalStep({ num, label, state, last = false, children }: {
  num: number; label: string;
  state: 'done' | 'current' | 'upcoming' | 'rejected';
  last?: boolean;
  children?: React.ReactNode;
}) {
  const dot = state === 'done'     ? { bg: '#2e9f82', color: '#fff', icon: '✓' }
            : state === 'current'  ? { bg: '#fff',    color: '#2e9f82', icon: String(num) }
            : state === 'rejected' ? { bg: '#fef2f2', color: '#b91c1c', icon: '✕' }
            :                        { bg: '#f7f6f2', color: '#9b9890', icon: String(num) };
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border"
          style={{
            background: dot.bg,
            color: dot.color,
            borderColor: state === 'current' ? '#2e9f82' : state === 'rejected' ? '#fecaca' : state === 'done' ? '#2e9f82' : '#e8e6e0',
          }}
        >
          {dot.icon}
        </div>
        {!last && <div className="flex-1 w-px bg-[#e8e6e0] my-1" style={{ minHeight: 8 }} />}
      </div>
      <div className="flex-1 pb-3">
        <p className={`text-sm font-semibold ${state === 'upcoming' ? 'text-[#9b9890]' : state === 'rejected' ? 'text-red-700' : 'text-[#1a1916]'}`}>{label}</p>
        {children}
      </div>
    </li>
  );
}

function ContractInlineSection({
  contractId, onRefresh, isRenewal = false, moveInInspection,
}: {
  contractId: number; onRefresh: () => void; isRenewal?: boolean;
  /** Render the Move-In Inspection CTA / signed-confirmation strip inside this card's header instead of as a separate page-level banner. */
  moveInInspection?: { submitted: boolean; signedByTenant: boolean } | null;
}) {
  // The signed name comes straight from the authenticated user's profile — no second entry required.
  const { user } = useAuth();
  const [detail, setDetail] = useState<FullContractDetail | null>(null);
  const [sigs, setSigs] = useState<FullContractSig[]>([]);
  const [tenantDocs, setTenantDocs] = useState<TenantDocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'payments' | 'documents'>('overview');
  const [showSign, setShowSign] = useState(false);
  const [showTerminate, setShowTerminate] = useState(false);
  const [termReason, setTermReason] = useState('');
  const [termDate, setTermDate] = useState('');
  const [termSubmitting, setTermSubmitting] = useState(false);
  const [termError, setTermError] = useState<string | null>(null);
  const [termResponding, setTermResponding] = useState(false);
  // sigName retained internally so the API payload still carries signatoryName, but it's not
  // captured from a form input — it's just the profile name.
  const sigName = (user?.name ?? '').trim();
  const [sigImg, setSigImg] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signSuccess, setSignSuccess] = useState(false);
  const load = useCallback(async () => {
    try {
      const [dRes, myDocsRes] = await Promise.all([
        fetch(`/api/contracts/tenant/${contractId}`, { credentials: 'include' }),
        fetch('/api/documents/my', { credentials: 'include' }),
      ]);
      if (dRes.ok) {
        const d = await dRes.json();
        setDetail(d);
        setSigs(Array.isArray(d.signatures) ? d.signatures : []);
      }
      if (myDocsRes.ok) {
        const md = await myDocsRes.json() as { documents: TenantDocItem[] };
        setTenantDocs(md.documents ?? []);
      }
    } finally { setLoading(false); }
  }, [contractId]);

  useEffect(() => { load(); }, [load]);

  // Refetch when tab regains focus so RP-side updates (Ejari registered,
  // contract activated, etc.) flow into this panel without a hard reload.
  useEffect(() => {
    function refetchIfVisible() {
      if (document.visibilityState === 'visible') load();
    }
    window.addEventListener('focus', refetchIfVisible);
    document.addEventListener('visibilitychange', refetchIfVisible);
    return () => {
      window.removeEventListener('focus', refetchIfVisible);
      document.removeEventListener('visibilitychange', refetchIfVisible);
    };
  }, [load]);

  if (loading) return (
    <div className="mt-4 bg-white rounded-2xl border border-[#e8e6e0] p-6 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-[#2e9f82]" />
    </div>
  );
  if (!detail) return null;

  const tenantSig   = sigs.find(s => s.role === 'tenant');
  const landlordSig = sigs.find(s => s.role === 'landlord');
  const canSign     = detail.status === 'issued' && !tenantSig;
  const visibleDocs = detail.documents.filter(d => d.isVisibleToTenant);
  const detailEjariDone = detail.ejariStatus === 'registered';
  const detailUtilityDone = detail.utilityStatus === 'submitted' || detail.utilityStatus === 'verified';
  const issuedLabel = detailEjariDone && detailUtilityDone ? 'Awaiting Activation'
    : detailEjariDone ? 'Ejari Registered'
    : tenantSig ? 'Awaiting Ejari'
    : 'Awaiting Signature';
  const rentPayments = detail.payments.filter(p => p.paymentType !== 'admin_fee' && p.paymentType !== 'security_deposit');

  async function handleSign() {
    if (!sigImg) { setSignError('Please draw your signature.'); return; }
    if (!sigName) { setSignError('Your profile name is empty. Update your profile name above before signing.'); return; }
    setSigning(true); setSignError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${detail!.id}/sign`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatoryName: sigName.trim(), signatureImage: sigImg }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? `Error ${res.status}`); }
      setSignSuccess(true); setShowSign(false);
      await load(); onRefresh();
    } catch (e: unknown) {
      setSignError(e instanceof Error ? e.message : 'Failed to sign');
    } finally { setSigning(false); }
  }

  async function submitTerminationRequest() {
    const reason = termReason.trim();
    if (!reason) { setTermError('Please provide a reason'); return; }
    if (!termDate) { setTermError('Please pick an effective date'); return; }
    setTermSubmitting(true); setTermError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${detail!.id}/termination/request`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, effectiveDate: termDate }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? `Error ${res.status}`); }
      setShowTerminate(false); setTermReason(''); setTermDate('');
      await load(); onRefresh();
    } catch (e: unknown) {
      setTermError(e instanceof Error ? e.message : 'Failed to send termination request');
    } finally { setTermSubmitting(false); }
  }

  async function respondToTermination(response: 'accepted' | 'rejected') {
    setTermResponding(true); setTermError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${detail!.id}/termination/respond`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? `Error ${res.status}`); }
      await load(); onRefresh();
    } catch (e: unknown) {
      setTermError(e instanceof Error ? e.message : 'Failed to respond to termination request');
    } finally { setTermResponding(false); }
  }

  // Upload moved to /dashboard/customer/documents hub (CID-328-FE).

  function fmtD(d: string | null | undefined) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <div id="contract-inline-section">
      <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#f0ede8] flex-wrap">
          <div className="flex items-center gap-2.5">
            <FileText size={16} className="text-[#2e9f82]" />
            <div>
              <p className="text-sm font-bold text-[#1a1916]">{isRenewal ? 'Renewal Contract' : 'Contract'}</p>
              <p className="text-[11px] text-[#9b9890]">{detail.ref}</p>
            </div>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${C_STATUS_COLOR[detail.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
              {detail.status === 'issued' ? issuedLabel : (C_STATUS_LABEL[detail.status] ?? detail.status)}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a href={`/dashboard/customer/contracts/${detail.id}/print`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] transition-colors">
              Preview
            </a>
            {tenantSig && (
              <span className="flex items-center gap-1.5 text-xs text-[#2e9f82] font-semibold bg-[#f0faf6] px-2.5 py-1 rounded-full border border-[#c5e8df]">
                <BadgeCheck size={12} /> Signed
              </span>
            )}
            {detail.status === 'active' && detail.termination?.response !== 'pending' && (
              <button
                onClick={() => setShowTerminate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                <X size={12} /> Request Termination
              </button>
            )}
          </div>
        </div>

        {/* Termination banner — shows at the top of the contract card when a request is in flight */}
        {detail.termination?.response === 'pending' && detail.termination.requestedByRole === 'rental_provider' && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-900">Landlord has requested termination</p>
              <p className="text-xs text-amber-800 mt-0.5">Effective <b>{fmtD(detail.termination.effectiveDate)}</b></p>
              {detail.termination.reason && (
                <p className="text-xs text-amber-900 mt-2 whitespace-pre-wrap">“{detail.termination.reason}”</p>
              )}
              {termError && <p className="text-xs text-red-600 mt-2">{termError}</p>}
            </div>
            <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
              <button
                onClick={() => respondToTermination('accepted')}
                disabled={termResponding}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {termResponding ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Accept
              </button>
              <button
                onClick={() => respondToTermination('rejected')}
                disabled={termResponding}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-50 flex items-center justify-center gap-1.5">
                <X size={12} /> Reject
              </button>
            </div>
          </div>
        )}
        {detail.termination?.response === 'pending' && detail.termination.requestedByRole === 'tenant' && (
          <div className="bg-[#fafaf8] border-b border-[#e8e6e0] px-5 py-3.5 flex items-start gap-3">
            <Loader2 size={14} className="text-[#6b6860] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#1a1916]">Termination request sent</p>
              <p className="text-xs text-[#6b6860] mt-0.5">Awaiting landlord response · effective <b>{fmtD(detail.termination.effectiveDate)}</b></p>
              {detail.termination.reason && (
                <p className="text-xs text-[#6b6860] mt-2 whitespace-pre-wrap">“{detail.termination.reason}”</p>
              )}
            </div>
          </div>
        )}
        {detail.termination?.response === 'rejected' && (
          <div className="bg-[#fafaf8] border-b border-[#e8e6e0] px-5 py-2.5">
            <p className="text-xs text-[#6b6860]">
              Last termination request was rejected on {fmtD(detail.termination.respondedAt)}.
            </p>
          </div>
        )}

        {/* Termination request modal */}
        {showTerminate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <AlertCircle size={18} className="text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1a1916]">Request termination</p>
                  <p className="text-xs text-[#6b6860] mt-1">The landlord must accept this request before the contract terminates.</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#1a1916] mb-1">Reason</label>
                  <textarea
                    value={termReason}
                    onChange={e => setTermReason(e.target.value)}
                    rows={3}
                    placeholder="Explain why you want to terminate this contract…"
                    className="w-full text-xs px-2.5 py-2 border border-[#e8e6e0] rounded-lg focus:outline-none focus:border-[#2e9f82]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#1a1916] mb-1">Effective date</label>
                  <input type="date" value={termDate} onChange={e => setTermDate(e.target.value)}
                    className="w-full text-xs px-2.5 py-2 border border-[#e8e6e0] rounded-lg focus:outline-none focus:border-[#2e9f82]" />
                </div>
                {termError && <p className="text-xs text-red-600">{termError}</p>}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowTerminate(false); setTermError(null); }}
                  disabled={termSubmitting}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f7f6f2] disabled:opacity-50 transition-colors">
                  Cancel
                </button>
                <button onClick={submitTerminationRequest}
                  disabled={termSubmitting}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                  {termSubmitting && <Loader2 size={12} className="animate-spin" />}
                  Send Request
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action banner */}
        {canSign && (
          <div className="flex items-start gap-3 bg-[#fff7ed] border-b border-[#fed7aa] px-5 py-3.5">
            <AlertCircle size={15} className="text-[#c2410c] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#9a3412]">Action required — your signature is needed</p>
              <p className="text-xs text-[#c2410c] mt-0.5">Review the details below and sign to proceed with your tenancy.</p>
            </div>
            <button onClick={() => setShowSign(true)}
              className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer"
              style={{ background: '#c2410c' }}>Sign Now</button>
          </div>
        )}

        {/* Signed success */}
        {signSuccess && (
          <div className="flex items-center gap-2 bg-[#f0faf6] border-b border-[#c5e8df] px-5 py-3">
            <CheckCircle2 size={14} className="text-[#2e9f82]" />
            <p className="text-sm font-medium text-[#1a7a5a]">Contract signed successfully.</p>
          </div>
        )}

        {/* Move-In Inspection strip — folded into the contract card rather than floating above the page */}
        {/* RP preparing the inspection (utility + ejari done, RP hasn't submitted yet) — matches the
            "Step 5 — Move-In Inspection" current state on the RP timeline, so the tenant sees the
            same stage instead of an empty gap between utility and signing. */}
        {detailEjariDone && detailUtilityDone && !moveInInspection?.submitted && detail.status !== 'active' && (
          <div className="flex items-start gap-3 bg-[#fff7ed] border-b border-[#fed7aa] px-5 py-3">
            <Clock size={15} className="text-[#c2410c] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#9a3412]">Move-In Inspection in progress</p>
              <p className="text-xs text-[#c2410c] mt-0.5">Your rental provider is walking through the unit and preparing the move-in checklist (photos, meter readings, key count). You&apos;ll be notified the moment it&apos;s ready to counter-sign.</p>
            </div>
            <span className="shrink-0 self-center px-3 py-1.5 rounded-xl text-xs font-semibold text-[#9a3412] bg-white border border-[#fed7aa]">Awaiting</span>
          </div>
        )}
        {moveInInspection?.submitted && !moveInInspection.signedByTenant && (
          <Link
            href={`/dashboard/customer/contracts/${detail.id}/inspection?type=move_in`}
            className="flex items-start gap-3 bg-[#fff7ed] border-b border-[#fed7aa] px-5 py-3 hover:bg-[#ffedd5] transition-colors"
          >
            <AlertCircle size={15} className="text-[#c2410c] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#9a3412]">Sign your Move-In Inspection</p>
              <p className="text-xs text-[#c2410c] mt-0.5">Your rental provider has submitted the move-in checklist. Review the unit&apos;s condition and add your signature.</p>
            </div>
            <span className="shrink-0 self-center px-3 py-1.5 rounded-xl text-xs font-semibold text-white" style={{ background: '#c2410c' }}>Review &amp; Sign</span>
          </Link>
        )}
        {moveInInspection?.signedByTenant && (
          <Link
            href={`/dashboard/customer/contracts/${detail.id}/inspection?type=move_in`}
            className="flex items-center justify-between gap-3 bg-[#f0faf6] border-b border-[#c5e8df] px-5 py-3 hover:bg-[#e6f4ee] transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 size={15} className="text-[#2e9f82] shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1a7a5a]">Move-In Inspection signed ✓</p>
                <p className="text-xs text-[#1a7a5a] mt-0.5 truncate">You can view or print your signed copy at any time.</p>
              </div>
            </div>
            <span className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#1a7a5a] bg-white border border-[#c5e8df]">View</span>
          </Link>
        )}

        {/* Tabs */}
        {(() => {
          const uploadedTenantDocs = tenantDocs.filter(d => d.status !== 'pending').length;
          // For renewal contracts we don't surface the tenant's lifetime KYC pack — only the
          // renewal-scoped uploads. So the badge counter must mirror that filtering.
          const totalDocCount = isRenewal ? visibleDocs.length : (uploadedTenantDocs + visibleDocs.length);
          return (
            <div className="flex border-b border-[#f0ede8] bg-[#fafaf8] overflow-x-auto">
              {(['overview', 'payments', 'documents'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap capitalize cursor-pointer flex items-center gap-1.5 ${
                    tab === t ? 'border-[#2e9f82] text-[#2e9f82]' : 'border-transparent text-[#9b9890] hover:text-[#1a1916]'
                  }`}>
                  {t}
                  {t === 'documents' && totalDocCount > 0 && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      tab === 'documents' ? 'bg-[#c5e8df] text-[#1a7a5a]' : 'bg-[#e8e6e0] text-[#6b6860]'
                    }`}>{totalDocCount}</span>
                  )}
                </button>
              ))}
            </div>
          );
        })()}

        {/* Tab: Overview */}
        {tab === 'overview' && (
          <div className="p-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold text-[#2e9f82] uppercase tracking-wide mb-2">Landlord</p>
              <CRow label="Name"    value={detail.landlord.companyName ?? detail.landlord.name} />
              <CRow label="Email"   value={detail.landlord.email} />
              <CRow label="Phone"   value={detail.landlord.phone} />
            </div>

            {detail.property.buildingName && (
              <div>
                <p className="text-[10px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">Property</p>
                <CRow label="Building"  value={detail.property.buildingName} />
                {detail.unit.number && <CRow label="Unit"    value={`Unit ${detail.unit.number}`} />}
                {detail.property.community && <CRow label="Community" value={detail.property.community} />}
                {detail.property.emirate   && <CRow label="Emirate"   value={detail.property.emirate} />}
              </div>
            )}
          </div>
        )}

        {/* Tab: Payments — render the actual payment rows from the contract (mirrored from the lead's plan).
            No synthetic per-cheque math: every row's amount is exactly what the RP stored on the lead. */}
        {tab === 'payments' && (() => {
          const sorted = (detail.payments ?? []).slice().sort((a, b) => {
            const ad = a.transactionDate ?? ''; const bd = b.transactionDate ?? '';
            if (ad !== bd) return ad.localeCompare(bd);
            // Same-date tiebreaker: security deposit last
            if (a.paymentType === 'security_deposit' && b.paymentType !== 'security_deposit') return 1;
            if (b.paymentType === 'security_deposit' && a.paymentType !== 'security_deposit') return -1;
            return a.id - b.id;
          });
          const grandTotal = sorted.reduce((sum, p) => sum + (p.amount || 0), 0);
          return (
            <div className="p-5 space-y-6">
              {sorted.length === 0 ? (
                <p className="text-sm text-[#9b9890] text-center py-4">No payment schedule recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[380px]">
                    <thead>
                      <tr className="text-left text-[10px] text-[#9b9890] uppercase border-b border-[#f4f3ef]">
                        <th className="px-2 py-2 font-medium">#</th>
                        <th className="px-2 py-2 font-medium">Description</th>
                        <th className="px-2 py-2 font-medium">Amount</th>
                        <th className="px-2 py-2 font-medium">Due</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p, i) => (
                        <tr key={p.id} className={`border-b border-[#f4f3ef] last:border-0 ${i % 2 !== 0 ? 'bg-[#fafaf8]' : ''}`}>
                          <td className="px-2 py-2 text-[#9b9890]">{i + 1}</td>
                          <td className="px-2 py-2 text-[#1a1916]">{p.description ?? `Payment ${i + 1}`}</td>
                          <td className="px-2 py-2 font-semibold text-[#1a1916] align-top">{fmtAed(p.amount)}</td>
                          <td className="px-2 py-2 text-[#6b6860] align-top">{fmtD(p.transactionDate)}</td>
                          <td className="px-2 py-2 align-top">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              p.chequeStatus === 'cleared' ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                              p.chequeStatus === 'bounced' ? 'bg-red-50 text-red-700' :
                              'bg-amber-50 text-amber-700'
                            }`}>{p.chequeStatus}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#c5e8df] bg-[#f0faf6]">
                        <td colSpan={2} className="px-2 py-2.5 text-xs font-bold text-[#1a1916]">Contract Value ({sorted.length} cheques)</td>
                        <td className="px-2 py-2.5 text-sm font-bold" style={{ color: '#2e9f82' }}>{fmtAed(grandTotal)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          );
        })()}

        {/* Tab: Documents */}
        {tab === 'documents' && (
          <div className="p-5 space-y-5">

            {/* ── Your tenant documents (Emirates ID, passport, etc.) — hidden for renewal contracts,
                  which scope their docs to the renewal child and shouldn't surface the lifetime KYC pack. */}
            {!isRenewal && (
            <div>
              <p className="text-[10px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">Your Documents</p>
              {tenantDocs.filter(d => d.status !== 'pending').length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-xs text-[#9b9890]">No documents uploaded yet.</p>
                  <a href="/dashboard/customer/documents"
                    className="inline-flex items-center gap-1 text-xs text-[#2e9f82] font-semibold mt-1.5 hover:underline">
                    Upload documents <ArrowRight size={11} />
                  </a>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {tenantDocs.filter(d => d.status !== 'pending').map(d => {
                    const label = d.displayName ?? d.documentKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    const isApproved = d.status === 'complete' || d.status === 'processed';
                    const isRejected = d.status === 'rejected';
                    return (
                      <div key={d.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#f4f3ef] last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {isApproved
                            ? <CheckCircle2 size={12} className="text-[#16a34a] shrink-0" />
                            : isRejected
                            ? <AlertTriangle size={12} className="text-[#ef4444] shrink-0" />
                            : <ClockIcon size={12} className="text-[#2563eb] shrink-0" />
                          }
                          <p className="text-xs font-semibold text-[#1a1916] truncate">{label}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                            isApproved ? 'bg-[#dcfce7] text-[#166534]'
                            : isRejected ? 'bg-[#fee2e2] text-[#b91c1c]'
                            : 'bg-[#dbeafe] text-[#1e40af]'
                          }`}>
                            {isApproved ? 'Approved' : isRejected ? 'Rejected' : 'In Review'}
                          </span>
                        </div>
                        {d.fileUrl && (
                          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-[#2e9f82] hover:underline shrink-0">
                            <ExternalLink size={11} /> View
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {/* ── Contract-level documents (Ejari cert, addendums, etc.) — relabelled to
                  "Renewal Documents" when this card is rendering a renewal child. */}
            {visibleDocs.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">{isRenewal ? 'Renewal Documents' : 'Contract Documents'}</p>
                <div className="space-y-0.5">
                  {visibleDocs.map(d => (
                    <div key={d.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-[#f4f3ef] last:border-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText size={13} className="text-[#9b9890] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#1a1916] truncate">{d.displayName ?? d.documentKey}</p>
                          {d.status && (
                            <p className={`text-[9px] mt-0.5 ${
                              d.status === 'complete' ? 'text-[#16a34a]'
                              : d.status === 'rejected' ? 'text-[#ef4444]'
                              : 'text-[#9b9890]'
                            }`}>
                              {d.status === 'complete' ? 'Verified ✓' : d.status === 'rejected' ? 'Rejected' : d.status}
                            </p>
                          )}
                        </div>
                      </div>
                      <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-[#2e9f82] hover:underline shrink-0">
                        <ExternalLink size={11} /> View
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── CTA to document hub ── */}
            <a href="/dashboard/customer/documents"
              className="flex items-center justify-between rounded-xl border border-[#c5e8df] bg-[#f0faf6] px-4 py-3 hover:bg-[#e5f5ef] transition-colors">
              <div>
                <p className="text-sm font-semibold text-[#1a7a5a]">Manage all documents</p>
                <p className="text-xs text-[#2e9f82] mt-0.5">Upload or replace KYC and rental documents</p>
              </div>
              <ArrowRight size={15} className="text-[#2e9f82] shrink-0" />
            </a>

          </div>
        )}


      </div>

      {/* Sign Modal */}
      {showSign && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSign(false)} />
          <div className="relative bg-white rounded-2xl p-7 w-full max-w-lg shadow-xl overflow-y-auto max-h-[90vh]">
            <button className="absolute top-4 right-4 text-[#9b9890] hover:text-[#1a1916] cursor-pointer" onClick={() => setShowSign(false)}>
              <X size={20} />
            </button>
            <h3 className="font-bold text-xl text-[#1a1916] mb-0.5">Sign Contract</h3>
            <p className="text-sm text-[#9b9890] mb-5">{detail.ref}</p>
            {signError && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{signError}</div>}
            {/* Signing as the authenticated profile — no second name entry */}
            {sigName && (
              <div className="mb-4 rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide">Signing as</p>
                  <p className="text-sm font-semibold text-[#1a1916]">{sigName}</p>
                </div>
              </div>
            )}
            <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Draw your signature <span className="text-red-500">*</span></label>
            <SigPad onChange={setSigImg} />
            <button disabled={!sigImg || !sigName || signing} onClick={handleSign}
              className="mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 cursor-pointer"
              style={{ background: '#2e9f82' }}>
              {signing ? <Loader2 size={15} className="animate-spin" /> : <FileSignature size={15} />}
              {signing ? 'Signing…' : 'Sign & Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Past / Inactive Card
────────────────────────────────────────────────────────────────────────────── */

function InactiveCard({ label, subLabel, dateStr, reason }: { label: string; subLabel?: string; dateStr: string; reason: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-[#e8e6e0] flex items-center gap-3 opacity-60">
      <div className="w-8 h-8 rounded-full bg-[#f4f3ef] flex items-center justify-center flex-shrink-0">
        <Ban size={14} className="text-[#9b9890]" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#3d3b35] truncate">{label}</p>
        {subLabel && <p className="text-xs text-[#9b9890]">{subLabel}</p>}
        <p className="text-xs text-[#9b9890]">{dateStr} · {reason}</p>
      </div>
      <a href="/listings" className="ml-auto flex-shrink-0 text-xs text-[#2e9f82] hover:underline font-medium">Find another →</a>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Space Row type
────────────────────────────────────────────────────────────────────────────── */

type SpaceRow =
  | { kind: 'viewing'; key: string; group: ViewingGroup; contract?: TenantContract; renewalContract?: TenantContract }
  | { kind: 'direct';  key: string; lead: DirectLead;    contract?: TenantContract; renewalContract?: TenantContract };

/* ──────────────────────────────────────────────────────────────────────────────
   Detail view
────────────────────────────────────────────────────────────────────────────── */

function SpaceDetailView({ row, onBack, onRefresh, kycStatus }: {
  row: SpaceRow;
  onBack: () => void;
  onRefresh: () => void;
  kycStatus?: string;
}) {
  const unitLabel = row.kind === 'viewing'
    ? row.group.unit?.unitName ?? (row.group.unit ? `Unit ${row.group.unit.unitNumber}` : 'Property')
    : row.lead.unit?.unitName ?? (row.lead.unit ? `Unit ${row.lead.unit.unitNumber}` : 'Property');
  const building = row.kind === 'viewing'
    ? row.group.unit?.property?.buildingName ?? ''
    : row.lead.unit?.property?.buildingName ?? '';
  const address = row.kind === 'viewing'
    ? row.group.unit?.property?.fullAddress ?? ''
    : row.lead.unit?.property?.fullAddress ?? '';
  const c = row.contract;
  const cEjariDone = c?.ejariStatus === 'registered';
  const cUtilityDone  = c?.utilityStatus === 'submitted' || c?.utilityStatus === 'verified';
  const contractSigned = !!c?.tenantSignedAt || c?.status === 'active' || cEjariDone || cUtilityDone;

  return (
    <div className="p-4 md:p-6 w-full">
      {/* Back nav */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4 transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> My Spaces
      </button>

      {/* Section card */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm p-5 md:p-6 space-y-5">

        {/* Header */}
        <div className="pb-4 border-b border-[#f4f3ef]">
          <h1 className="text-xl font-bold text-[#1a1916] leading-tight">
            {[unitLabel, building].filter(Boolean).join(' · ')}
          </h1>
          {address && (
            <p className="text-xs text-[#9b9890] mt-1 flex items-center gap-1">
              <MapPin size={11} className="shrink-0" />{address}
            </p>
          )}
        </div>

        {/* Contract summary strip */}
        {c && (
          <div className="bg-[#f9f8f6] rounded-xl border border-[#e8e6e0] px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <div>
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Contract Status</p>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${
              c.status === 'active' ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
              c.status === 'issued' && contractSigned ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
              c.status === 'issued' ? 'bg-[#fef3c7] text-[#92400e]' :
              'bg-[#f4f3ef] text-[#6b6860]'
            }`}>
              {c.status === 'active' ? 'Active'
                : c.status === 'issued' && cEjariDone && cUtilityDone ? 'Awaiting Activation'
                : c.status === 'issued' && cEjariDone ? 'Ejari Registered'
                : c.status === 'issued' && contractSigned ? 'Issued — Signed'
                : c.status === 'issued' ? 'Issued — Sign required'
                : c.status}
            </span>
          </div>
          {c.startDate && (
            <>
              <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
              <div>
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Start Date</p>
                <p className="text-sm font-semibold text-[#1a1916]">{new Date(c.startDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
            </>
          )}
          {c.endDate && (
            <>
              <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
              <div>
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">End Date</p>
                <p className="text-sm font-semibold text-[#1a1916]">{new Date(c.endDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
            </>
          )}
          {c.annualRent > 0 && (
            <>
              <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
              <div>
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Annual Rent</p>
                <p className="text-sm font-bold" style={{ color: '#2e9f82' }}>{fmtAed(c.annualRent)}</p>
              </div>
            </>
          )}
          {c.numberOfInstallments != null && (
            <>
              <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
              <div>
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Cheques</p>
                <p className="text-sm font-semibold text-[#1a1916]">{c.numberOfInstallments}</p>
              </div>
            </>
          )}
          {c.utilityStatus && c.utilityStatus !== 'not_submitted' && (
            <>
              <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
              <div>
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Utility</p>
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  c.utilityStatus === 'verified'  ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                  c.utilityStatus === 'submitted' ? 'bg-[#dbeafe] text-[#1e40af]' :
                  'bg-[#f4f3ef] text-[#6b6860]'
                }`}>
                  {c.utilityStatus === 'verified' ? 'Verified' : 'Submitted'}
                </span>
                {c.utilityAccountNumber && <p className="text-[10px] text-[#6b6860] mt-0.5">{c.utilityAccountNumber}</p>}
              </div>
            </>
          )}
        </div>
        )}

        {/* Detail: compact info + Contract | Journey */}
        {row.kind === 'viewing'
          ? <ExpandedDetail group={row.group} contract={row.contract} renewalContract={row.renewalContract} onRefresh={onRefresh} kycStatus={kycStatus} />
          : <DirectExpandedDetail lead={row.lead} contract={row.contract} renewalContract={row.renewalContract} onRefresh={onRefresh} kycStatus={kycStatus} />
        }

      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Page
────────────────────────────────────────────────────────────────────────────── */

export default function MySpacesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const kycStatus = user?.kycStatus;
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [directLeads, setDirectLeads] = useState<DirectLead[]>([]);
  const [contracts, setContracts] = useState<TenantContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [vRes, lRes, cRes] = await Promise.all([
        fetch('/api/leads/my-viewings', { credentials: 'include' }),
        fetch('/api/leads/my-applications', { credentials: 'include' }),
        fetch('/api/contracts/tenant', { credentials: 'include' }),
      ]);
      if (!vRes.ok) throw new Error(`Failed to load viewings (${vRes.status})`);
      const vData = await vRes.json();
      setViewings(Array.isArray(vData) ? vData : []);
      if (lRes.ok) { const lData = await lRes.json(); setDirectLeads(Array.isArray(lData) ? lData : []); }
      if (cRes.ok) { const cData = await cRes.json(); setContracts(Array.isArray(cData) ? cData : []); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refetch whenever the tab regains focus so the customer sees the latest
  // contract/Ejari/utility status pushed from the RP side without a hard reload.
  useEffect(() => {
    function refetchIfVisible() {
      if (document.visibilityState === 'visible') fetchAll();
    }
    window.addEventListener('focus', refetchIfVisible);
    document.addEventListener('visibilitychange', refetchIfVisible);
    return () => {
      window.removeEventListener('focus', refetchIfVisible);
      document.removeEventListener('visibilitychange', refetchIfVisible);
    };
  }, [fetchAll]);

  const groups = groupByLead(viewings);
  const activeGroups = groups.filter(g =>
    g.primary.outcome !== 'not_interested' &&
    !(['cancelled', 'no_show'].includes(g.primary.status) && g.primary.outcome === 'not_interested')
  );
  const inactiveGroups = groups.filter(g => ['cancelled', 'no_show'].includes(g.primary.status) || g.primary.outcome === 'not_interested');
  const activeDirectLeads = directLeads.filter(l => l.stage !== 'rejected');
  const inactiveDirectLeads = directLeads.filter(l => l.stage === 'rejected');
  const isEmpty = !loading && viewings.length === 0 && directLeads.length === 0;

  // Build unified row list. Each row also carries the renewal CHILD contract (if any) so the
  // detail view can render a dedicated "Renewal Contract details | Renewal Journey" row alongside
  // the original "Contract details | Contract Journey" row.
  function findRenewalChild(parentId: number | undefined): TenantContract | undefined {
    if (!parentId) return undefined;
    return contracts.find(c => c.contractType === 'renewal' && c.parentContractId === parentId);
  }
  const activeRows: SpaceRow[] = [
    ...activeGroups.map(g => {
      const c = pickPrimaryContract(contracts, g.unit?.id);
      return { kind: 'viewing' as const, key: `v-${g.leadId}`, group: g, contract: c, renewalContract: findRenewalChild(c?.id) };
    }),
    ...activeDirectLeads.map(l => {
      const c = pickPrimaryContract(contracts, l.unit?.id);
      return { kind: 'direct' as const, key: `d-${l.id}`, lead: l, contract: c, renewalContract: findRenewalChild(c?.id) };
    }),
  ];

  const selectedKey = searchParams.get('space');
  const selectedRow = selectedKey ? (activeRows.find(r => r.key === selectedKey) ?? null) : null;

  function openSpaceDetail(key: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('space', key);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function closeSpaceDetail() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('space');
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function rowLabel(row: SpaceRow) {
    if (row.kind === 'viewing') return row.group.unit?.unitName ?? (row.group.unit ? `Unit ${row.group.unit.unitNumber}` : 'Property');
    return row.lead.unit?.unitName ?? (row.lead.unit ? `Unit ${row.lead.unit.unitNumber}` : 'Property');
  }
  function rowBuilding(row: SpaceRow) {
    if (row.kind === 'viewing') return row.group.unit?.property?.buildingName ?? '';
    return row.lead.unit?.property?.buildingName ?? '';
  }
  function rowDate(row: SpaceRow) {
    if (row.kind === 'viewing') return fmtDate(row.group.primary.scheduledAt);
    return fmtDate(row.lead.createdAt);
  }
  function rowStatusBadge(row: SpaceRow) {
    if (row.kind === 'viewing') {
      const { label, bg, text } = viewingStatusLabel(row.group.primary.status);
      return <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${bg} ${text}`}>{label}</span>;
    }
    const { label, bg, text } = leadStageLabel(row.lead.stage);
    return <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${bg} ${text}`}>{label}</span>;
  }
  function rowStatusConfig(row: SpaceRow): { label: string; bg: string; text: string; isAction: boolean } {
    const c = row.contract;
    const stage = row.kind === 'viewing' ? row.group.leadStage : row.lead.stage;
    const vstatus = row.kind === 'viewing' ? row.group.primary.status : undefined;

    // 1. Contract-driven states take highest priority — same as before
    if (c) {
      if (c.status === 'active') return { label: 'Active Tenancy', bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false };
      const hasUtility = c.utilityStatus === 'submitted' || c.utilityStatus === 'verified';
      const inspectionSubmitted = !!c.moveInInspection?.submitted;
      const inspectionSignedByTenant = !!c.moveInInspection?.signedByTenant;

      // Move-in flow — match the RP's step 5 progression
      if (inspectionSubmitted && !inspectionSignedByTenant) return { label: 'Sign Move-In Inspection', bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true };
      if (c.ejariStatus === 'registered' && hasUtility && inspectionSignedByTenant) return { label: 'Awaiting Activation', bg: 'bg-[#dbeafe]', text: 'text-[#1e40af]', isAction: false };
      if (c.ejariStatus === 'registered' && hasUtility) return { label: 'Move-In Inspection in Progress', bg: 'bg-[#fef9c3]', text: 'text-[#854d0e]', isAction: false };
      if (c.ejariStatus === 'registered') return { label: 'Submit Utility Number', bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true };
      if (c.status === 'issued' && !c.tenantSignedAt) return { label: 'Sign Contract', bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true };
      if (c.status === 'issued' && c.tenantSignedAt) return { label: 'Awaiting Ejari', bg: 'bg-[#f0faf6]', text: 'text-[#2e9f82]', isAction: false };
      return { label: 'Contract Pending', bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', isAction: false };
    }

    // 2. Pre-contract — map every lead stage to a clear label so the card
    //    advances as the RP moves the lead forward (no stale "upload docs" text).
    const stageMap: Record<string, { label: string; bg: string; text: string; isAction: boolean }> = {
      documents_collection: { label: 'Documents in Review',    bg: 'bg-[#f0f9ff]', text: 'text-[#0369a1]', isAction: false },
      payment_plan_shared:  { label: 'Review Payment Plan',    bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true  },
      cheques_submitted:    { label: 'Cheques Under Review',   bg: 'bg-[#fef9c3]', text: 'text-[#854d0e]', isAction: false },
      cheques_collected:    { label: 'Preparing Your Contract', bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false },
      contract_issued:      { label: 'Contract Being Issued',  bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false },
      approved:             { label: 'Provider Preparing Contract', bg: 'bg-[#f0faf6]', text: 'text-[#2e9f82]', isAction: false },
      converted:            { label: 'Provider Preparing Contract', bg: 'bg-[#f0faf6]', text: 'text-[#2e9f82]', isAction: false },
      applied:              { label: 'Reservation Under Review', bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', isAction: false },
      offer_made:           { label: 'Offer Received — Review', bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true },
      contacted:            { label: 'In Discussion',           bg: 'bg-[#ede9fe]', text: 'text-[#6d28d9]', isAction: false },
    };
    if (stageMap[stage]) return stageMap[stage];

    // 3. Fallbacks — viewing-state only
    if (vstatus === 'completed') return { label: 'Awaiting Next Step', bg: 'bg-[#f0faf6]', text: 'text-[#2e9f82]', isAction: false };
    return { label: 'Attend Your Viewing', bg: 'bg-[#fef3c7]', text: 'text-[#92400e]', isAction: false };
  }
  function rowContextualDate(row: SpaceRow): string {
    const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
    const c = row.contract;
    if (c?.status === 'active' && c.startDate) return `Tenancy from ${fmtShort(c.startDate)}`;
    if (c?.status === 'issued' && c.startDate) return `Starts ${fmtShort(c.startDate)}`;
    if (c) return 'Contract issued';
    if (row.kind === 'direct') return `Applied ${fmtShort(row.lead.createdAt)}`;
    const v = row.group.primary;
    const prefix = v.status === 'completed' ? 'Viewed' : v.status === 'scheduled' || v.status === 'confirmed' ? 'Viewing' : 'Viewing';
    return `${prefix} ${fmtShort(v.scheduledAt)}`;
  }

  if (selectedRow) {
    return (
      <SpaceDetailView
        row={selectedRow}
        onBack={closeSpaceDetail}
        onRefresh={fetchAll}
        kycStatus={kycStatus}
      />
    );
  }

  return (
    <div className="p-6 w-full">
      {(() => {
        const firstName = (user?.name ?? '').trim().split(/\s+/)[0] || 'there';
        const activeCount = activeRows.filter(r => r.contract?.status === 'active').length;
        const renewingCount = activeRows.filter(r => !!r.renewalContract).length;
        const inProgressCount = activeRows.filter(r => !r.contract || r.contract.status !== 'active').length;
        const chips = [
          { label: 'Active',      value: activeCount,     bg: 'bg-[#1f5a3f]',   fg: 'text-white' },
          { label: 'In progress', value: inProgressCount, bg: 'bg-[#fbe5dc]',   fg: 'text-[#c8492c]' },
          { label: 'Renewing',    value: renewingCount,   bg: 'bg-[#fbebcc]',   fg: 'text-[#a0641b]' },
        ];
        return (
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9890]">
                Hello {firstName}
              </p>
              <h1 className="text-3xl font-bold text-[#1a1916] mt-1.5 leading-[1.1] tracking-tight">
                Your <span className="text-[#1f5a3f]">spaces</span>
              </h1>
              <p className="text-sm text-[#6b6860] mt-2 max-w-md">
                Everything in motion — current leases, applications, viewings on the calendar. Tap any card to drill in.
              </p>
            </div>
            <div className="flex gap-2.5 flex-wrap">
              {chips.map(c => (
                <div key={c.label} className={`px-4 py-2.5 rounded-2xl min-w-[92px] ${c.bg} ${c.fg}`}>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] opacity-90">{c.label}</p>
                  <p className="text-2xl font-bold leading-none mt-1 tabular-nums">{c.value}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {error && <div className="mb-5 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200 flex items-start gap-2"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</div>}

      {/* Action-required animations — applied only to cards where sc.isAction is true */}
      <style>{`
        @keyframes actionRing {
          0%   { box-shadow: 0 0 0 0   rgba(200, 73, 44, 0.55); }
          70%  { box-shadow: 0 0 0 10px rgba(200, 73, 44, 0);    }
          100% { box-shadow: 0 0 0 0   rgba(200, 73, 44, 0);    }
        }
        .upnow-action-dot { animation: actionRing 1.8s ease-out infinite; }

        @keyframes arrowNudge {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(4px); }
        }
        .upnow-action-arrow { animation: arrowNudge 1.4s ease-in-out infinite; }

        @keyframes pillBlink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.65; }
        }
        .upnow-action-pill { animation: pillBlink 2s ease-in-out infinite; }
      `}</style>

      {/* Active rows — card grid */}
      {!loading && activeRows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          {activeRows.map((row, idx) => {
            const sc = rowStatusConfig(row);
            const v2Url = `/dashboard/customer/spaces/v2/${row.key}`;
            const unit = row.kind === 'viewing' ? row.group.unit : row.lead.unit;
            const c = row.contract;
            const isActive = c?.status === 'active';
            const community = unit?.property?.community?.name ?? null;
            const emirate = unit?.property?.emirate?.name ?? null;
            const location = [community, emirate].filter(Boolean).join(', ') || null;
            const bedrooms = unit?.bedrooms;
            // Fallback chain: contract rent → unit rental price → unit market price.
            // Means pre-contract rows still show the asking rent so the card isn't blank.
            const annual = c?.annualRent ?? unit?.rentalPrice ?? unit?.marketPrice ?? null;
            const annualIsAsking = !c?.annualRent && annual != null;
            const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Dubai' });
            // Period column adapts: contract dates → viewing date → applied date.
            const periodLabel = c?.startDate && c?.endDate
              ? { label: 'Period', value: `${fmtShort(c.startDate)} → ${fmtShort(c.endDate)}` }
              : row.kind === 'viewing'
                ? { label: 'Viewing', value: fmtShort(row.group.primary.scheduledAt) }
                : { label: 'Applied', value: fmtShort(row.lead.createdAt) };
            const buildingName = rowBuilding(row);
            const unitLabel = rowLabel(row);

            // Rotating dummy apartment photos (Unsplash) — keyed by index for stability
            const DUMMY_PHOTOS = [
              'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=900&q=80',
              'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900&q=80',
              'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=900&q=80',
              'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&q=80',
            ];
            const photo = DUMMY_PHOTOS[idx % DUMMY_PHOTOS.length];

            // Tone for the action chip — derived from the SAME sc.label as the status pill,
            // so card and detail-view show consistent state.
            const tone: 'action' | 'waiting' | 'settled' = sc.isAction ? 'action' : isActive ? 'settled' : 'waiting';
            const toneCfg = {
              action:  { bg: 'bg-[#fbe5dc]', border: 'border-[#f3c4b3]', dot: 'bg-[#c8492c]', label: 'text-[#c8492c]', icon: <AlertCircle size={14} className="text-white" />, eyebrow: 'Action required' },
              waiting: { bg: 'bg-[#fbebcc]', border: 'border-[#f0d68f]', dot: 'bg-[#a0641b]', label: 'text-[#a0641b]', icon: <Clock size={14} className="text-white" />,        eyebrow: 'In progress' },
              settled: { bg: 'bg-[#e0eddE]', border: 'border-[#bdd9b8]', dot: 'bg-[#1f5a3f]', label: 'text-[#1f5a3f]', icon: <CheckCircle2 size={14} className="text-white" />, eyebrow: 'Active' },
            }[tone];

            return (
              <button
                key={row.key}
                onClick={() => openSpaceDetail(row.key)}
                className="text-left bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-[#1a1916]/30 cursor-pointer flex flex-col"
              >
                {/* Hero — apartment photo with status pill + renewal pin overlay */}
                <div className="relative h-44 overflow-hidden bg-[#f4f3ef]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo}
                    alt={buildingName || unitLabel || 'Apartment'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {/* Darkening gradient for badge legibility */}
                  <div className="absolute inset-0 pointer-events-none" style={{
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,0) 60%, rgba(26,23,20,0.55) 100%)',
                  }} />

                  {/* Renewal pin top-right — only when renewal is actually in flight */}
                  {c?.renewalAccepted === 'pending' && (
                    <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] bg-[#1a1916] text-white inline-flex items-center gap-1 backdrop-blur-sm">
                      <RotateCcw size={10} /> Renewal — Action
                    </span>
                  )}
                  {c?.renewalAccepted === 'accepted' && (
                    <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] bg-[#1f5a3f] text-white inline-flex items-center gap-1 backdrop-blur-sm">
                      <RotateCcw size={10} /> Renewing
                    </span>
                  )}

                  {/* Single status pill — bottom-left, sourced from sc.label (same as detail view) */}
                  <span className={`absolute bottom-3 left-3 text-[11px] font-semibold rounded-full px-3 py-1.5 ${sc.bg} ${sc.text} shadow-sm ${sc.isAction ? 'upnow-action-pill' : ''}`}>
                    {sc.isAction && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5 align-middle" />}
                    {sc.label}
                  </span>
                </div>

                {/* Body */}
                <div className="p-5 flex flex-col gap-4 flex-1">
                  <div>
                    {location && (
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9890] mb-1">
                        {location}
                      </p>
                    )}
                    <h3 className="text-lg font-bold text-[#1a1916] leading-tight tracking-tight">
                      {buildingName || unitLabel}
                      {buildingName && unitLabel && (
                        <>, <span className="font-semibold text-[#1f5a3f]">{unitLabel}</span></>
                      )}
                    </h3>
                  </div>

                  {/* Stats strip */}
                  <div className="grid grid-cols-3 gap-3 py-3 border-y border-[#f0ede8]">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#9b9890]">Beds</p>
                      <p className="text-sm font-semibold text-[#1a1916] mt-0.5">{bedrooms != null ? (bedrooms === 0 ? 'Studio' : `${bedrooms} BR`) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#9b9890]">
                        {annualIsAsking ? 'Asking' : 'Annual'}
                      </p>
                      <p className="text-sm font-semibold text-[#1a1916] mt-0.5 tabular-nums">
                        {annual != null ? `AED ${(annual / 1000).toFixed(0)}K` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#9b9890]">{periodLabel.label}</p>
                      <p className="text-sm font-semibold text-[#1a1916] mt-0.5">{periodLabel.value}</p>
                    </div>
                  </div>

                  {/* Action chip — answers "what now" (not duplicating the status pill) */}
                  <div className={`mt-auto flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border ${toneCfg.bg} ${toneCfg.border}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${toneCfg.dot} ${sc.isAction ? 'upnow-action-dot' : ''}`}>
                        {toneCfg.icon}
                      </span>
                      <p className={`text-xs font-semibold ${toneCfg.label}`}>{toneCfg.eyebrow}</p>
                    </div>
                    <span className="text-xs font-semibold text-[#1a1916] inline-flex items-center gap-1">
                      Open <ChevronRight size={14} className={sc.isAction ? 'upnow-action-arrow' : ''} />
                    </span>
                  </div>

                  {/* v2 quick link — opens this space in the new Quest layout */}
                  <Link
                    href={v2Url}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] font-semibold text-[#1f5a3f] hover:text-[#1a1916] inline-flex items-center gap-1 self-end transition-colors"
                  >
                    ✨ Try the new view →
                  </Link>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="bg-white rounded-xl h-14 animate-pulse shadow-sm" />)}
        </div>
      )}

      {isEmpty && (
        <div className="bg-white rounded-2xl p-16 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
            <BedDouble size={24} className="text-[#2e9f82]" />
          </div>
          <h3 className="font-semibold text-[#1a1916] mb-1">No spaces yet</h3>
          <p className="text-sm text-[#6b6860] max-w-xs">Browse listings and book a viewing or apply directly to get started.</p>
          <a href="/listings" className="mt-4 text-sm font-medium text-[#2e9f82] hover:underline">Browse listings →</a>
        </div>
      )}

      {/* Past / inactive */}
      {!loading && (inactiveGroups.length > 0 || inactiveDirectLeads.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold text-[#3d3b35] uppercase tracking-wide mb-3">Past</h2>
          <div className="space-y-3">
            {inactiveGroups.map(g => (
              <InactiveCard key={`iv-${g.leadId}`}
                label={g.unit?.unitName ?? (g.unit ? `Unit ${g.unit.unitNumber}` : 'Property')}
                subLabel={g.unit?.property?.buildingName}
                dateStr={fmtDate(g.primary.scheduledAt)}
                reason={g.primary.outcome === 'not_interested' ? 'Not interested' : g.primary.status === 'no_show' ? 'No show' : 'Cancelled'}
              />
            ))}
            {inactiveDirectLeads.map(l => (
              <InactiveCard key={`id-${l.id}`}
                label={l.unit?.unitName ?? (l.unit ? `Unit ${l.unit.unitNumber}` : 'Property')}
                subLabel={l.unit?.property?.buildingName}
                dateStr={fmtDate(l.createdAt)}
                reason="Application rejected"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
