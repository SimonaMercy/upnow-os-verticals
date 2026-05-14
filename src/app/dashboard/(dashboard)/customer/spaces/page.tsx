/**
 * Customer — My Spaces page (dashboard/customer/spaces)
 *
 * This is the central page for the tenant's rental journey. It renders:
 *   - Active viewings calendar
 *   - Direct leads (inquiries not yet converted to a contract)
 *   - Active/past tenancy spaces with full contract context
 *   - RentalDocumentsCard — THE single upload hub for all tenant documents
 *     (required KYC, landlord-requested, and free-form attachments)
 *
 * IMPORTANT — do not move document upload UI anywhere else. The contract
 * detail page (contracts/[id]) is intentionally read-only for documents.
 * See AGENTS.md §9a and CID-326-FE / CID-327-FE for the locked decision.
 *
 * RentalDocumentsCard (~line 849): handles presigned-URL upload flow,
 * priority sorting, summary banner, and free-form "attach additional doc".
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  Calendar, Clock, MapPin, X, CheckCircle2, Ban, Home,
  ChevronLeft, ChevronRight, ChevronDown, ThumbsDown, Pencil,
  Building2, FileText, ArrowRight, ArrowDown, Loader2, AlertCircle, Info,
  BedDouble, DollarSign, CheckCheck,
  User, FileSignature, BadgeCheck, RotateCcw, UploadCloud, ExternalLink, AlertTriangle, Clock as ClockIcon,
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
  property?: { id: number; buildingName: string; fullAddress: string | null };
}

interface Lead {
  id: number;
  stage: string;
}

interface Viewing {
  id: number;
  scheduledAt: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  notes: string | null;
  outcome: string | null;
  unit: SpaceUnit | null;
  lead: Lead | null;
}

interface DirectLead {
  id: number;
  stage: string;
  unit: SpaceUnit | null;
  createdAt: string;
}

interface TenantContract {
  id: number;
  status: string;
  ejariStatus: string | null;
  dewaStatus: string | null;
  dewaAccountNumber: string | null;
  numberOfInstallments: number | null;
  startDate: string | null;
  endDate: string | null;
  annualRent: number;
  unit: { id: number | null };
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
  id: number; ref: string; status: string; ejariStatus: string | null;
  startDate: string; endDate: string; annualRent: number;
  contractValue: number | null;
  adminFeeFils: number; ejariFeeFils: number;
  securityDepositAmount: number | null; numberOfInstallments: number | null;
  modeOfPayment: string | null; customClauses: string[]; notes: string | null;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null };
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null };
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
  unit: { number: string | null; name: string | null; type: string | null; floor: string | null; bedrooms: number | null };
  documents: FullContractDoc[];
  payments: FullContractPayment[];
  securityDeposits: FullContractSecurityDeposit[];
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

/* ──────────────────────────────────────────────────────────────────────────────
   Document requirements by property category
────────────────────────────────────────────────────────────────────────────── */
interface DocReq { key: string; label: string; category: string; required: boolean; hint?: string; }

const RESIDENTIAL_TYPES = ['apartment','villa','townhouse','studio','penthouse','duplex_loft'];
const COMMERCIAL_TYPES  = ['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical'];
const INDUSTRIAL_TYPES  = ['warehouse','open_yard','storage_unit','cold_storage','logistics_facility'];

const RESIDENTIAL_DOCS: DocReq[] = [
  { key: 'emirates_id',      label: 'Emirates ID',        category: 'identity', required: true,  hint: 'Both sides of your Emirates ID' },
  { key: 'passport',         label: 'Passport',           category: 'identity', required: true,  hint: 'Bio-data page of your valid passport' },
  { key: 'bank_statement',   label: 'Bank Statement',     category: 'banking',  required: true,  hint: 'Last 3 months bank statement' },
  { key: 'employment_letter',label: 'Employment Letter',  category: 'banking',  required: true,  hint: 'From your current employer on company letterhead' },
];

const COMMERCIAL_DOCS: DocReq[] = [
  { key: 'trade_license',     label: 'Trade License',             category: 'license',  required: true,  hint: 'Valid UAE trade license' },
  { key: 'emirates_id',       label: 'Emirates ID / Passport of Owner/Partners', category: 'identity', required: true, hint: 'All partners & authorised signatories' },
  { key: 'bank_statement',    label: 'Financial Statements',      category: 'banking',  required: false, hint: 'Latest 2 years audited financials or bank statements' },
  { key: 'rental_history',    label: 'Rental History',            category: 'legal',    required: false, hint: 'Previous landlord clearance' },
  { key: 'utility_clearance', label: 'Previous Utility Closing',  category: 'legal',    required: false, hint: 'DEWA clearance from previous premises' },
  { key: 'moa',               label: 'MOM / MOA',                 category: 'legal',    required: false, hint: 'Memorandum of Association or Minutes of Meeting' },
];

const INDUSTRIAL_DOCS: DocReq[] = [
  { key: 'trade_license',     label: 'Trade License',             category: 'license',  required: true,  hint: 'Valid UAE trade license' },
  { key: 'business_license',  label: 'Business / Activity License', category: 'license', required: true,  hint: 'License specific to warehouse/industrial activity' },
  { key: 'emirates_id',       label: 'Emirates ID / Passport',    category: 'identity', required: true,  hint: 'Owner or authorised signatory' },
  { key: 'bank_statement',    label: 'Financial Statements',      category: 'banking',  required: false, hint: 'Latest audited financials or bank statements' },
  { key: 'rental_history',    label: 'Rental History',            category: 'legal',    required: false, hint: 'Previous landlord clearance' },
  { key: 'utility_clearance', label: 'Previous Utility Closing',  category: 'legal',    required: false, hint: 'Previous DEWA or utility clearance' },
];

function getRequiredDocs(unitType: string | null | undefined): DocReq[] {
  const t = unitType ?? '';
  if (COMMERCIAL_TYPES.includes(t)) return COMMERCIAL_DOCS;
  if (INDUSTRIAL_TYPES.includes(t)) return INDUSTRIAL_DOCS;
  return RESIDENTIAL_DOCS; // default + all residential types
}

function TenancyJourneyPanel({
  contract,
  viewingStatus,
  leadStage,
  kycStatus,
  unitType,
  onReserve,
  onDewaSubmitted,
}: {
  contract?: TenantContract;
  viewingStatus?: string;
  leadStage?: string;
  kycStatus?: string;
  unitType?: string | null;
  onReserve?: () => void;
  onDewaSubmitted?: () => void;
}) {
  const { refresh } = useAuth();
  const kycApproved = kycStatus === 'approved';
  const [dewaInput, setDewaInput] = useState('');
  const [dewaSaving, setDewaSaving] = useState(false);
  const [dewaError, setDewaError] = useState<string | null>(null);
  const [dewaSuccess, setDewaSuccess] = useState(false);

  // ---------- Document collection step state (for step status display only) ----------
  const viewed = ['completed', 'no_show'].includes(viewingStatus ?? '');
  const requiredDocs = getRequiredDocs(unitType);
  const [myDocsLoading, setMyDocsLoading] = useState(false);
  const [myDocs, setMyDocs] = useState<{ id: number; documentKey: string; status?: string }[] | null>(null);

  function reloadDocs() {
    if (!viewed) return;
    setMyDocsLoading(true);
    fetch('/api/documents/my', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { tenantProfileId: number; documents: { id: number; documentKey: string; status?: string }[] }) => {
        setMyDocs(data.documents);
      })
      .catch(() => setMyDocs([]))
      .finally(() => setMyDocsLoading(false));
  }

  useEffect(() => {
    reloadDocs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed]);

  async function handleDewaSubmit() {
    if (!dewaInput.trim()) { setDewaError('Please enter your DEWA account number.'); return; }
    if (!contract) return;
    setDewaSaving(true); setDewaError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${contract.id}/dewa`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dewaAccountNumber: dewaInput.trim() }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setDewaError(b.message ?? 'Failed to submit'); return; }
      setDewaSuccess(true);
      onDewaSubmitted?.();
    } finally { setDewaSaving(false); }
  }

  function ss(prev: boolean, curr: boolean): TLState {
    if (!prev) return 'upcoming';
    return curr ? 'done' : 'current';
  }

  // Pre-contract steps driven by viewing/lead
  const reserved = ['applied', 'offer_made', 'approved', 'converted'].includes(leadStage ?? '');

  // Docs step: required docs all uploaded and not rejected
  const uploadedKeys = new Set((myDocs ?? []).filter(d => d.status !== 'pending').map(d => d.documentKey));
  const requiredMissing = requiredDocs.filter(d => d.required && !uploadedKeys.has(d.key));
  const rejectedDocs = (myDocs ?? []).filter(d => d.status === 'rejected');
  // RP-requested docs that still have no file attached
  const pendingRequestedDocs = (myDocs ?? []).filter(d => d.status === 'pending');
  const docsOk = myDocs !== null && requiredMissing.length === 0 && pendingRequestedDocs.length === 0 && rejectedDocs.length === 0;

  // Contract-driven steps
  const isIssued  = contract?.status === 'issued' || contract?.status === 'active';
  const isActive  = contract?.status === 'active';
  const hasSigned = !!(contract as any)?.tenantSignedAt || contract?.status === 'active';
  const hasEjari  = contract?.ejariStatus === 'registered';
  const hasDewa   = contract?.dewaStatus === 'submitted' || contract?.dewaStatus === 'verified';

  // 9 steps:
  // 1 Viewing Booked  2 Viewing Completed  3 Application Documents
  // 4 Reserved  5 Contract Issued  6 Signatures  7 Ejari Registration  8 DEWA  9 Active Tenancy
  const s1: TLState = 'done';
  const s2 = ss(true, viewed);
  const s_docs = ss(viewed, docsOk);
  const s3 = ss(docsOk, reserved);
  const s4 = ss(reserved, isIssued);
  const s5 = ss(isIssued, hasSigned);
  const s6 = ss(hasSigned, hasEjari);
  const s7 = ss(hasEjari, hasDewa);
  const s8: TLState = isActive ? 'current' : 'upcoming';

  const headerSub = isActive
    ? 'Your tenancy is active'
    : hasDewa
    ? 'DEWA submitted. Waiting for final activation.'
    : hasEjari
    ? 'Ejari is done. Add your DEWA account number.'
    : hasSigned
    ? 'Contract signed. Ejari registration is in progress.'
    : isIssued
    ? 'Your contract is ready. Please review and sign.'
    : reserved
    ? 'Reservation submitted. Waiting for provider confirmation.'
    : docsOk
    ? 'Documents are complete. Submit your reservation.'
    : viewed
    ? 'Viewing completed. Upload your required documents.'
    : 'Viewing scheduled. Attend it to move forward.';

  const currentStage = isActive
    ? 'Tenancy Active'
    : hasDewa
    ? 'Activation Pending'
    : hasEjari
    ? 'DEWA Required'
    : hasSigned
    ? 'Ejari In Progress'
    : isIssued
    ? 'Contract Signing'
    : reserved
    ? 'Reservation Review'
    : docsOk
    ? 'Ready to Reserve'
    : viewed
    ? 'Documents Needed'
    : 'Viewing Scheduled';

  const nextAction = isActive
    ? 'Manage your tenancy and payments from this space.'
    : hasDewa
    ? 'No action needed right now. We will notify you once activated.'
    : hasEjari
    ? 'Add your DEWA account number in Step 8 below.'
    : hasSigned
    ? 'No action needed right now. Provider is completing Ejari.'
    : isIssued
    ? 'Open contract details and complete your signature.'
    : reserved
    ? 'Wait for provider approval and contract issuance.'
    : docsOk
    ? 'Click "Proceed to Reservation" in Step 4.'
    : viewed
    ? 'Upload required documents in Step 3.'
    : 'Attend the scheduled viewing in Step 2.';

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

        {/* ── Step 3: Rental Documents ── */}
        <StepRow num={3} label="Rental Documents" state={s_docs} last={false}>
          {s_docs === 'current' && (
            <div className="mt-1 space-y-1">
              {myDocsLoading
                ? <p className="text-[10px] text-[#9b9890] flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Checking…</p>
                : (
                  <button
                    type="button"
                    onClick={() => document.getElementById('rental-docs-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="flex items-center gap-1.5 text-left group"
                  >
                    <span className={`text-[10px] underline underline-offset-2 group-hover:opacity-80 ${
                      rejectedDocs.length > 0 ? 'text-[#b91c1c]'
                      : pendingRequestedDocs.length > 0 ? 'text-[#f97316]'
                      : 'text-[#9b9890]'
                    }`}>
                      {rejectedDocs.length > 0
                        ? `${rejectedDocs.length} document${rejectedDocs.length > 1 ? 's' : ''} rejected — re-upload required`
                        : pendingRequestedDocs.length > 0
                        ? `${pendingRequestedDocs.length} document${pendingRequestedDocs.length > 1 ? 's' : ''} requested by landlord`
                        : `${requiredMissing.length} of ${requiredDocs.filter(d => d.required).length} required documents remaining`
                      }
                    </span>
                    <ArrowDown size={9} className={`shrink-0 group-hover:translate-y-0.5 transition-transform ${
                      rejectedDocs.length > 0 ? 'text-[#b91c1c]'
                      : pendingRequestedDocs.length > 0 ? 'text-[#f97316]'
                      : 'text-[#9b9890]'
                    }`} />
                  </button>
                )
              }
            </div>
          )}
          {s_docs === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">All documents uploaded ✓</p>}
        </StepRow>

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

        <StepRow num={5} label="Contract Issued" state={s4} last={false}>
          {s4 === 'current' && <p className="text-[10px] text-[#9b9890] mt-0.5">Landlord is preparing your contract</p>}
          {s4 === 'done' && contract && (
            <p className="text-[10px] text-[#2e9f82] mt-0.5">Issued ✓</p>
          )}
        </StepRow>

        <StepRow num={6} label="Sign Contract" state={s5} last={false}>
          {s5 === 'current' && <p className="text-[10px] text-[#9b9890] mt-0.5">Awaiting signature — review and sign the contract above</p>}
          {s5 === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">All parties signed ✓</p>}
        </StepRow>

        <StepRow num={7} label="Ejari Registration" state={s6} last={false}>
          {s6 === 'current' && <p className="text-[10px] text-[#9b9890] mt-0.5">DLD registration in progress</p>}
          {s6 === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Registered with DLD ✓</p>}
        </StepRow>

        <StepRow num={8} label="Add DEWA Account" state={s7} last={false}>
          {s7 === 'current' && (
            <div className="mt-2 space-y-2">
              {dewaSuccess || hasDewa ? (
                <p className="text-[10px] text-[#2e9f82]">DEWA account submitted ✓{contract?.dewaAccountNumber ? ` · ${contract.dewaAccountNumber}` : ''}</p>
              ) : (
                <>
                  <p className="text-[10px] text-[#9b9890]">Ejari registered — please provide your DEWA account number</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={dewaInput}
                      onChange={e => setDewaInput(e.target.value)}
                      placeholder="e.g. 1234567890"
                      className="flex-1 text-xs px-2.5 py-1.5 border border-[#e8e6e0] rounded-lg focus:outline-none focus:border-[#2e9f82] text-[#1a1916]"
                    />
                    <button
                      onClick={handleDewaSubmit}
                      disabled={dewaSaving}
                      className="text-[11px] font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50 cursor-pointer"
                      style={{ background: '#2e9f82' }}
                    >
                      {dewaSaving ? '…' : 'Submit'}
                    </button>
                  </div>
                  {dewaError && <p className="text-[10px] text-red-600">{dewaError}</p>}
                </>
              )}
            </div>
          )}
          {s7 === 'done' && (
            <p className="text-[10px] text-[#2e9f82] mt-0.5">DEWA submitted ✓{contract?.dewaAccountNumber ? ` · ${contract.dewaAccountNumber}` : ''}</p>
          )}
        </StepRow>

        <StepRow num={9} label="Active Tenancy" state={s8} last={true}>
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
   Rental Documents Card (separate section, shown after viewing)
────────────────────────────────────────────────────────────────────────────── */

function RentalDocumentsCard({
  unitType,
  kycStatus,
}: {
  unitType?: string | null;
  kycStatus?: string;
}) {
  const requiredDocs = getRequiredDocs(unitType);
  const [myDocs, setMyDocs] = useState<{ id: number; documentKey: string; category: string; fileUrl?: string; status?: string; displayName?: string | null; notes?: string | null }[] | null>(null);
  const [tenantProfileId, setTenantProfileId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [docUploading, setDocUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Free-form attach
  const [showAttach, setShowAttach] = useState(false);
  const [attachLabel, setAttachLabel] = useState('');
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const { refresh } = useAuth();

  function reloadDocs() {
    setLoading(true);
    fetch('/api/documents/my', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { tenantProfileId: number; entityType: string; documents: { id: number; documentKey: string; category: string; fileUrl?: string; status?: string; displayName?: string | null; notes?: string | null }[] }) => {
        setTenantProfileId(data.tenantProfileId);
        setMyDocs(data.documents);
      })
      .catch(() => setMyDocs([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reloadDocs(); }, []);

  async function handleFreeUpload() {
    if (!attachFile) return;
    setAttaching(true); setAttachError(null);
    const docKey = `tenant_doc_${Date.now()}`;
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'tenant_profile', ownerId: tenantProfileId,
          documentKey: docKey, mimeType: attachFile.type || 'application/octet-stream',
          originalName: attachFile.name,
        }),
      });
      if (!urlRes.ok) { setAttachError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': attachFile.type || 'application/octet-stream' }, body: attachFile });
      if (!putRes.ok) { setAttachError('File upload failed'); return; }
      const docRes = await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'tenant_profile', ownerId: tenantProfileId,
          category: 'identity', documentKey: docKey,
          displayName: attachLabel.trim() || attachFile.name,
          fileUrl, mimeType: attachFile.type || 'application/octet-stream',
          isVisibleToTenant: true,
        }),
      });
      if (!docRes.ok) { setAttachError('Failed to record document'); return; }
      setAttachFile(null); setAttachLabel('');
      setShowAttach(false);
      if (attachInputRef.current) attachInputRef.current.value = '';
      reloadDocs();
    } catch { setAttachError('Unexpected error'); }
    finally { setAttaching(false); }
  }

  async function handleUpload(req: DocReq, file: File, existingDocId?: number) {
    if (!tenantProfileId) return;
    setDocUploading(req.key);
    setUploadError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'customer', ownerId: tenantProfileId, documentKey: req.key, originalName: file.name, mimeType: file.type }),
      });
      if (!urlRes.ok) { setUploadError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUploadError('Upload failed'); return; }
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
          body: JSON.stringify({ ownerType: 'customer', ownerId: tenantProfileId, documentKey: req.key, category: req.category, displayName: req.label, fileUrl, mimeType: file.type, s3Key: fileKey }),
        });
      }
      if (!docRes.ok) {
        const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
        setUploadError(Array.isArray(b.message) ? b.message[0] : (b.message ?? 'Failed to save'));
        return;
      }
      reloadDocs();
      await refresh().catch(() => null);
    } catch { setUploadError('Unexpected error during upload'); }
    finally { setDocUploading(null); }
  }

  const uploadedKeys = new Set((myDocs ?? []).filter(d => d.status !== 'pending').map(d => d.documentKey));
  const uploadedByKey = new Map((myDocs ?? []).filter(d => d.status !== 'pending').map(d => [d.documentKey, d]));
  const pendingRequestedDocs = (myDocs ?? []).filter(d => d.status === 'pending');
  const extraDocs = (myDocs ?? []).filter(d => d.status !== 'pending' && !requiredDocs.find(r => r.key === d.documentKey));

  const missingRequired = requiredDocs.filter(d => d.required && (!uploadedKeys.has(d.key) || uploadedByKey.get(d.key)?.status === 'rejected'));
  const totalRequired = requiredDocs.filter(d => d.required).length;
  const uploadedRequired = totalRequired - missingRequired.length;
  const hasRejected = (myDocs ?? []).some(d => d.status === 'rejected');
  const hasPendingLandlord = pendingRequestedDocs.length > 0;

  return (
    <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2 border-b border-[#f4f3ef] bg-[#fafaf8]">
        <FileText size={14} className="text-[#2e9f82]" />
        <span className="text-sm font-semibold text-[#1a1916]">Rental Documents</span>
        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader2 size={12} className="animate-spin text-[#9b9890]" />}
          {!loading && hasRejected && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#fee2e2] text-[#b91c1c]">Action needed</span>
          )}
          {!loading && !hasRejected && hasPendingLandlord && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#fff7ed] text-[#f97316]">Landlord requested</span>
          )}
          {!loading && !hasRejected && !hasPendingLandlord && myDocs !== null && uploadedRequired < totalRequired && (
            <span className="text-[10px] font-semibold text-[#92400e]">{uploadedRequired}/{totalRequired} uploaded</span>
          )}
          {!loading && !hasRejected && !hasPendingLandlord && myDocs !== null && uploadedRequired === totalRequired && (
            <span className="text-[10px] font-semibold text-[#16a34a]">All required uploaded ✓</span>
          )}
        </div>
      </div>

      {/* Missing required docs summary banner */}
      {!loading && myDocs !== null && missingRequired.length > 0 && (
        <div className="px-4 py-2.5 bg-[#fffbeb] border-b border-[#fde68a]">
          <p className="text-[10px] font-semibold text-[#92400e] mb-1.5">
            {missingRequired.some(d => uploadedByKey.get(d.key)?.status === 'rejected')
              ? 'Documents needing action:'
              : 'Still required to upload:'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missingRequired.map(d => {
              const isRej = uploadedByKey.get(d.key)?.status === 'rejected';
              return (
                <span key={d.key} className={[
                  'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full',
                  isRej
                    ? 'bg-[#fee2e2] text-[#991b1b]'
                    : 'bg-[#fef3c7] text-[#92400e]',
                ].join(' ')}>
                  {isRej ? <X size={9} /> : <UploadCloud size={9} />}
                  {d.label}
                  {isRej && <span className="text-[9px] font-normal opacity-75">· rejected</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-4 py-3 space-y-1.5">
        {loading ? (
          <p className="text-xs text-[#9b9890] text-center py-4">Loading documents…</p>
        ) : (
          <>
            {uploadError && <p className="text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5">{uploadError}</p>}

            {(() => {
              // Build a unified sorted list: rejected → required missing → landlord requested → pending review → approved → optional
              type DocItem =
                | { kind: 'required'; req: DocReq; docRecord: typeof uploadedByKey extends Map<string, infer V> ? V : never; uploaded: boolean; isRejected: boolean; isApproved: boolean }
                | { kind: 'landlord-pending'; doc: typeof pendingRequestedDocs[number] }
                | { kind: 'landlord-uploaded'; doc: typeof extraDocs[number]; isRejected: boolean; isApproved: boolean };

              const items: DocItem[] = [];
              for (const req of requiredDocs) {
                const docRecord = uploadedByKey.get(req.key);
                const uploaded = uploadedKeys.has(req.key);
                const isRejected = docRecord?.status === 'rejected';
                const isApproved = docRecord?.status === 'complete' || docRecord?.status === 'processed';
                items.push({ kind: 'required', req, docRecord: docRecord as DocItem extends { kind: 'required'; docRecord: infer D } ? D : never, uploaded, isRejected, isApproved });
              }
              for (const doc of pendingRequestedDocs) items.push({ kind: 'landlord-pending', doc });
              for (const doc of extraDocs) {
                const isRejected = doc.status === 'rejected';
                const isApproved = doc.status === 'processed' || doc.status === 'complete';
                items.push({ kind: 'landlord-uploaded', doc, isRejected, isApproved });
              }

              const rank = (item: DocItem) => {
                // ── TOP: needs upload ──────────────────────────────────────
                if (item.kind === 'required' && item.isRejected) return 0;           // rejected required
                if (item.kind === 'landlord-uploaded' && item.isRejected) return 1;  // rejected landlord doc
                if (item.kind === 'required' && !item.uploaded && item.req.required) return 2; // required missing
                if (item.kind === 'landlord-pending') return 3;                       // landlord requested (no file yet)
                if (item.kind === 'required' && !item.uploaded && !item.req.required) return 4; // optional missing
                // ── BOTTOM: already uploaded ────────────────────────────────
                if (item.kind === 'required' && item.uploaded && !item.isApproved) return 5;    // uploaded, pending review
                if (item.kind === 'landlord-uploaded' && !item.isApproved) return 6;            // landlord uploaded, pending
                if (item.kind === 'required' && item.isApproved) return 7;                      // approved required
                if (item.kind === 'landlord-uploaded' && item.isApproved) return 8;             // approved landlord
                return 9;
              };
              items.sort((a, b) => rank(a) - rank(b));

              return items.map((item, idx) => {
                if (item.kind === 'required') {
                  const { req, docRecord, uploaded, isRejected, isApproved } = item;
                  const needsAction = isRejected || (!uploaded && req.required);
                  const isPendingReview = uploaded && !isRejected && !isApproved;
                  return (
                    <div key={req.key}
                      className={[
                        'rounded-lg px-3 py-2.5 text-[11px] flex items-start gap-2.5',
                        isRejected
                          ? 'bg-[#fff1f2] border-l-4 border-l-[#ef4444] border border-[#fecaca]'
                          : needsAction
                          ? 'bg-[#fffbeb] border-l-4 border-l-[#f59e0b] border border-[#fde68a]'
                          : isPendingReview
                          ? 'bg-[#eff6ff] border border-[#bfdbfe]'
                          : isApproved
                          ? 'bg-[#f0faf6] border border-[#bbf7d0]'
                          : 'bg-[#f9f8f6] border border-[#e8e6e0] opacity-70',
                      ].join(' ')}>
                      {/* Icon */}
                      <div className="mt-0.5 shrink-0">
                        {isRejected
                          ? <div className="w-5 h-5 rounded-full bg-[#fee2e2] flex items-center justify-center"><AlertTriangle size={10} className="text-[#ef4444]" /></div>
                          : isApproved
                          ? <div className="w-5 h-5 rounded-full bg-[#dcfce7] flex items-center justify-center"><CheckCircle2 size={11} className="text-[#16a34a]" /></div>
                          : isPendingReview
                          ? <div className="w-5 h-5 rounded-full bg-[#dbeafe] flex items-center justify-center"><ClockIcon size={10} className="text-[#2563eb]" /></div>
                          : needsAction
                          ? <div className="w-5 h-5 rounded-full bg-[#fef3c7] flex items-center justify-center"><UploadCloud size={11} className="text-[#d97706]" /></div>
                          : <div className="w-5 h-5 rounded-full bg-[#f4f3ef] flex items-center justify-center"><UploadCloud size={11} className="text-[#c5c3bc]" /></div>
                        }
                      </div>
                      {/* Label + status */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-[11px] leading-tight ${isRejected ? 'text-[#991b1b]' : needsAction ? 'text-[#92400e]' : isApproved ? 'text-[#166534]' : 'text-[#3d3b35]'}`}>
                          {req.label}
                          {!uploaded && req.required && <span className="ml-1.5 text-[9px] font-bold tracking-wide text-[#d97706] uppercase">Required</span>}
                          {!uploaded && !req.required && <span className="ml-1.5 text-[9px] text-[#9b9890]">Optional</span>}
                        </p>
                        {isRejected && (
                          <p className="text-[10px] font-semibold text-[#ef4444] mt-0.5">
                            Rejected — re-upload required
                            {docRecord?.notes && <span className="font-normal text-[#9b9890]"> · {docRecord.notes}</span>}
                          </p>
                        )}
                        {isPendingReview && <p className="text-[10px] text-[#6b6860] mt-0.5">Uploaded · awaiting landlord review</p>}
                        {isApproved && <p className="text-[10px] text-[#16a34a] font-medium mt-0.5">Approved ✓</p>}
                        {needsAction && !isRejected && req.hint && <p className="text-[9px] text-[#9b9890] mt-0.5">{req.hint}</p>}
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                        {uploaded && docRecord?.fileUrl && !isRejected && (
                          <a href={docRecord.fileUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-0.5 text-[10px] font-medium text-[#2e9f82] hover:underline">
                            <ExternalLink size={10} /> View
                          </a>
                        )}
                        <label className={[
                          'flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-md cursor-pointer text-white transition-opacity',
                          docUploading === req.key ? 'opacity-50 pointer-events-none' : '',
                          isRejected ? 'bg-[#ef4444] hover:bg-[#dc2626]'
                            : needsAction ? 'bg-[#f59e0b] hover:bg-[#d97706]'
                            : 'bg-[#9b9890] hover:bg-[#6b6860]',
                        ].join(' ')}>
                          {docUploading === req.key ? <Loader2 size={10} className="animate-spin" /> : <UploadCloud size={10} />}
                          {isRejected ? 'Re-upload' : uploaded ? 'Replace' : 'Upload'}
                          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(req, f, docRecord?.id); e.target.value = ''; }} />
                        </label>
                      </div>
                    </div>
                  );
                }

                if (item.kind === 'landlord-pending') {
                  const { doc } = item;
                  const reqKey = doc.documentKey;
                  const reqLabel = doc.displayName ?? reqKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                  const fakeReq: DocReq = { key: reqKey, label: reqLabel, category: 'contract', required: true };
                  return (
                    <div key={doc.id}
                      className="rounded-lg px-3 py-2.5 text-[11px] flex items-start gap-2.5 bg-[#fff7ed] border-l-4 border-l-[#f97316] border border-[#fed7aa]">
                      <div className="mt-0.5 shrink-0">
                        <div className="w-5 h-5 rounded-full bg-[#ffedd5] flex items-center justify-center"><UploadCloud size={11} className="text-[#f97316]" /></div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[11px] text-[#9a3412] leading-tight">{reqLabel}</p>
                        <p className="text-[10px] font-semibold text-[#f97316] mt-0.5">Requested by landlord — upload required</p>
                        {doc.notes && <p className="text-[9px] text-[#9b9890] mt-0.5">{doc.notes}</p>}
                      </div>
                      <label className={[
                        'flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-md cursor-pointer text-white bg-[#f97316] hover:bg-[#ea6b00] transition-opacity mt-0.5',
                        docUploading === reqKey ? 'opacity-50 pointer-events-none' : '',
                      ].join(' ')}>
                        {docUploading === reqKey ? <Loader2 size={10} className="animate-spin" /> : <UploadCloud size={10} />}
                        Upload
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(fakeReq, f, doc.id); e.target.value = ''; }} />
                      </label>
                    </div>
                  );
                }

                // landlord-uploaded
                const { doc, isRejected, isApproved } = item;
                const docKey = doc.documentKey;
                const docLabel = doc.displayName ?? docKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const isPendingReview = !isApproved && !isRejected;
                const fakeReq: DocReq = { key: docKey, label: docLabel, category: 'contract', required: true };
                return (
                  <div key={doc.id}
                    className={[
                      'rounded-lg px-3 py-2.5 text-[11px] flex items-start gap-2.5',
                      isRejected
                        ? 'bg-[#fff1f2] border-l-4 border-l-[#ef4444] border border-[#fecaca]'
                        : isApproved
                        ? 'bg-[#f0faf6] border border-[#bbf7d0]'
                        : 'bg-[#eff6ff] border border-[#bfdbfe]',
                    ].join(' ')}>
                    <div className="mt-0.5 shrink-0">
                      {isRejected
                        ? <div className="w-5 h-5 rounded-full bg-[#fee2e2] flex items-center justify-center"><AlertTriangle size={10} className="text-[#ef4444]" /></div>
                        : isApproved
                        ? <div className="w-5 h-5 rounded-full bg-[#dcfce7] flex items-center justify-center"><CheckCircle2 size={11} className="text-[#16a34a]" /></div>
                        : <div className="w-5 h-5 rounded-full bg-[#dbeafe] flex items-center justify-center"><ClockIcon size={10} className="text-[#2563eb]" /></div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold text-[11px] leading-tight ${isRejected ? 'text-[#991b1b]' : isApproved ? 'text-[#166534]' : 'text-[#3d3b35]'}`}>
                        {docLabel}
                        <span className="ml-1.5 text-[9px] font-normal text-[#9b9890]">Landlord requested</span>
                      </p>
                      {isRejected && (
                        <p className="text-[10px] font-semibold text-[#ef4444] mt-0.5">
                          Rejected — re-upload required
                          {doc.notes && <span className="font-normal text-[#9b9890]"> · {doc.notes}</span>}
                        </p>
                      )}
                      {isPendingReview && <p className="text-[10px] text-[#6b6860] mt-0.5">Uploaded · awaiting landlord review</p>}
                      {isApproved && <p className="text-[10px] text-[#16a34a] font-medium mt-0.5">Approved ✓</p>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      {doc.fileUrl && !isRejected && (
                        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[10px] font-medium text-[#2e9f82] hover:underline">
                          <ExternalLink size={10} /> View
                        </a>
                      )}
                      <label className={[
                        'flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-md cursor-pointer text-white transition-opacity',
                        docUploading === docKey ? 'opacity-50 pointer-events-none' : '',
                        isRejected ? 'bg-[#ef4444] hover:bg-[#dc2626]' : 'bg-[#9b9890] hover:bg-[#6b6860]',
                      ].join(' ')}>
                        {docUploading === docKey ? <Loader2 size={10} className="animate-spin" /> : <UploadCloud size={10} />}
                        {isRejected ? 'Re-upload' : 'Replace'}
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(fakeReq, f, doc.id); e.target.value = ''; }} />
                      </label>
                    </div>
                  </div>
                );
              });
            })()}

            {/* ── Free-form attach ───────────────────────────────────────── */}
            <div className="mt-2 pt-3 border-t border-[#f4f3ef]">
              {!showAttach ? (
                <button
                  onClick={() => setShowAttach(true)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-[#2e9f82] hover:opacity-80 transition-opacity">
                  <UploadCloud size={13} /> Attach additional document
                </button>
              ) : (
                <div className="space-y-2.5 bg-[#f7f6f2] rounded-lg px-3 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-[#1a1916] uppercase tracking-wide">Attach document</p>
                    <button
                      onClick={() => { setShowAttach(false); setAttachFile(null); setAttachLabel(''); setAttachError(null); }}
                      className="text-[10px] text-[#9b9890] hover:text-[#1a1916]">Cancel</button>
                  </div>
                  <input
                    type="text" value={attachLabel} onChange={e => setAttachLabel(e.target.value)}
                    placeholder="Document name (e.g. Visa Copy)"
                    className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none" />
                  <input
                    ref={attachInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => setAttachFile(e.target.files?.[0] ?? null)}
                    className="w-full text-xs text-[#6b6860] file:mr-3 file:text-xs file:font-semibold file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-[#f0faf6] file:text-[#2e9f82] hover:file:bg-[#e0f5ee] cursor-pointer" />
                  {attachError && <p className="text-[10px] text-red-600">{attachError}</p>}
                  <button
                    onClick={handleFreeUpload}
                    disabled={!attachFile || attaching}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-opacity"
                    style={{ background: '#2e9f82' }}>
                    {attaching ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                    {attaching ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
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
    groups.push({ leadId: primary.lead?.id ?? -primary.id, leadStage: primary.lead?.stage ?? 'new', unit: primary.unit, primary, others });
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
    new:       { label: 'New',      bg: 'bg-[#f4f3ef]', text: 'text-[#9b9890]' },
    applied:   { label: 'Applied',  bg: 'bg-[#ede9fe]', text: 'text-[#6d28d9]' },
    offer_made:{ label: 'Offer',    bg: 'bg-[#fef3c7]', text: 'text-[#92400e]' },
    approved:  { label: 'Approved', bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]' },
    converted: { label: 'Converted',bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]' },
    rejected:  { label: 'Rejected', bg: 'bg-[#fee2e2]', text: 'text-[#b91c1c]' },
  };
  return map[stage] ?? { label: stage, bg: 'bg-[#f4f3ef]', text: 'text-[#9b9890]' };
}

const LEAD_STAGE_FLOW = ['new', 'applied', 'offer_made', 'approved', 'converted'] as const;

function leadStageProgress(stage: string) {
  const idx = LEAD_STAGE_FLOW.indexOf(stage as (typeof LEAD_STAGE_FLOW)[number]);
  const current = idx >= 0 ? idx + 1 : 1;
  const total = LEAD_STAGE_FLOW.length;
  const ratio = Math.min(1, Math.max(0, current / total));
  const nextByStage: Record<string, string> = {
    new: 'Complete viewing and upload documents',
    applied: 'Provider is reviewing your application',
    offer_made: 'Offer shared by provider',
    approved: 'Contract will be issued next',
    converted: 'Moved to contract flow',
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
  group, contract, onRefresh, kycStatus,
}: {
  group: ViewingGroup; contract?: TenantContract; onRefresh: () => void; kycStatus?: string;
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
  const canModify = v.status === 'scheduled' && (dt.getTime() - Date.now() > hourMs);
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

      {/* When a contract exists: Contract | Your Journey on top, Viewing Appointment below */}
      {contract ? (
        <div className="space-y-5">
          {/* ── TOP ROW: Contract (left) | Your Journey (right) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <ContractInlineSection contractId={contract.id} onRefresh={onRefresh} />
            <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
              <TenancyJourneyPanel
                contract={contract}
                viewingStatus={v.status}
                leadStage={group.leadStage}
                kycStatus={kycStatus}
                unitType={group.unit?.unitType ?? null}
                onReserve={() => setContractOpen(true)}
                onDewaSubmitted={onRefresh}
              />
            </div>
          </div>

          {/* ── Rental Documents (separate section, shown after viewing) ── */}
          {['completed', 'no_show'].includes(v.status) && (
            <div id="rental-docs-section">
              <RentalDocumentsCard unitType={group.unit?.unitType ?? null} kycStatus={kycStatus} />
            </div>
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

        {/* ── RIGHT: Timeline + Contract ── */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
            <TenancyJourneyPanel
              contract={contract}
              viewingStatus={v.status}
              leadStage={group.leadStage}
              kycStatus={kycStatus}
              unitType={group.unit?.unitType ?? null}
              onReserve={() => setContractOpen(true)}
              onDewaSubmitted={onRefresh}
            />
          </div>
          {contract && <ContractInlineSection contractId={contract.id} onRefresh={onRefresh} />}
        </div>

      </div>
      )}

      {/* ── Rental Documents (separate section, shown after viewing, no-contract branch) ── */}
      {!contract && ['completed', 'no_show'].includes(v.status) && (
        <div id="rental-docs-section" className="mt-5">
          <RentalDocumentsCard unitType={group.unit?.unitType ?? null} kycStatus={kycStatus} />
        </div>
      )}
    </>
  );
}

function DirectExpandedDetail({
  lead, contract, onRefresh, kycStatus,
}: {
  lead: DirectLead; contract?: TenantContract; onRefresh: () => void; kycStatus?: string;
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
        {/* ── TOP ROW: Contract (left) | Your Journey (right) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <ContractInlineSection contractId={contract.id} onRefresh={onRefresh} />
          <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
            <TenancyJourneyPanel
              contract={contract}
              leadStage={lead.stage}
              kycStatus={kycStatus}
              unitType={lead.unit?.unitType ?? null}
              onReserve={() => setContractOpen(true)}
              onDewaSubmitted={onRefresh}
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

        {/* ── Rental Documents (separate section) ── */}
        {!['new', 'rejected'].includes(lead.stage) && (
          <div id="rental-docs-section">
            <RentalDocumentsCard unitType={lead.unit?.unitType ?? null} kycStatus={kycStatus} />
          </div>
        )}
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

      {/* ── RIGHT: Timeline + Contract ── */}
      <div className="space-y-5">
        <div className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
          <TenancyJourneyPanel
            contract={contract}
            leadStage={lead.stage}
            kycStatus={kycStatus}
            unitType={lead.unit?.unitType ?? null}
            onReserve={() => setContractOpen(true)}
            onDewaSubmitted={onRefresh}
          />
        </div>
        {contract && <ContractInlineSection contractId={contract.id} onRefresh={onRefresh} />}
        {/* ── Rental Documents (separate section, direct application) ── */}
        {!['new', 'rejected'].includes(lead.stage) && (
          <div id="rental-docs-section">
            <RentalDocumentsCard unitType={lead.unit?.unitType ?? null} kycStatus={kycStatus} />
          </div>
        )}
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

function ContractInlineSection({ contractId, onRefresh }: { contractId: number; onRefresh: () => void }) {
  const [detail, setDetail] = useState<FullContractDetail | null>(null);
  const [sigs, setSigs] = useState<FullContractSig[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'payments' | 'documents'>('overview');
  const [showSign, setShowSign] = useState(false);
  const [sigName, setSigName] = useState('');
  const [sigImg, setSigImg] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signSuccess, setSignSuccess] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [dRes, sRes] = await Promise.all([
        fetch(`/api/contracts/tenant/${contractId}`, { credentials: 'include' }),
        fetch(`/api/contracts/${contractId}/signatures`, { credentials: 'include' }),
      ]);
      if (dRes.ok) setDetail(await dRes.json());
      if (sRes.ok) { const s = await sRes.json(); setSigs(Array.isArray(s) ? s : []); }
    } finally { setLoading(false); }
  }, [contractId]);

  useEffect(() => { load(); }, [load]);

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
  const rentPayments = detail.payments.filter(p => p.paymentType !== 'admin_fee' && p.paymentType !== 'security_deposit');

  async function handleSign() {
    if (!sigName.trim()) { setSignError('Please enter your full legal name.'); return; }
    if (!sigImg) { setSignError('Please draw your signature.'); return; }
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

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true); setUploadError(null);
    const docKey = `tenant_doc_${Date.now()}`;
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contractId, documentKey: docKey, mimeType: uploadFile.type || 'application/octet-stream', originalName: uploadFile.name }),
      });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': uploadFile.type || 'application/octet-stream' }, body: uploadFile });
      if (!putRes.ok) throw new Error('File upload failed');
      await fetch('/api/documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contractId, category: 'identity', documentKey: docKey, displayName: uploadLabel || uploadFile.name, fileUrl, mimeType: uploadFile.type || 'application/octet-stream', isVisibleToTenant: true }) });
      setUploadFile(null); setUploadLabel('');
      if (docRef.current) docRef.current.value = '';
      await load();
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setUploading(false); }
  }

  function fmtD(d: string | null | undefined) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <div>
      <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#f0ede8] flex-wrap">
          <div className="flex items-center gap-2.5">
            <FileText size={16} className="text-[#2e9f82]" />
            <div>
              <p className="text-sm font-bold text-[#1a1916]">Contract</p>
              <p className="text-[11px] text-[#9b9890]">{detail.ref}</p>
            </div>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${C_STATUS_COLOR[detail.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
              {C_STATUS_LABEL[detail.status] ?? detail.status}
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
          </div>
        </div>

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

        {/* Tabs */}
        <div className="flex border-b border-[#f0ede8] bg-[#fafaf8] overflow-x-auto">
          {(['overview', 'payments', 'documents'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap capitalize cursor-pointer ${
                tab === t ? 'border-[#2e9f82] text-[#2e9f82]' : 'border-transparent text-[#9b9890] hover:text-[#1a1916]'
              }`}>{t}
            </button>
          ))}
        </div>

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

        {/* Tab: Payments */}
        {tab === 'payments' && (() => {
          const n = rentPayments.length || detail.numberOfInstallments || 1;
          const baseInst = detail.annualRent / n;
          const contractVal = detail.contractValue ?? detail.annualRent;
          const commission = contractVal * 0.05;
          const adminFee = detail.adminFeeFils / 100;
          const ejariAmt = detail.ejariFeeFils / 100;
          const firstExtra = commission + adminFee + ejariAmt;
          const firstAmt = baseInst + firstExtra;
          const grandTotal = detail.annualRent + firstExtra;
          return (
            <div className="p-5 space-y-6">
              {rentPayments.length === 0 ? (
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
                      {rentPayments.map((p, i) => {
                        const instAmt = p.amount > 0 ? p.amount : baseInst;
                        const displayAmt = i === 0 ? instAmt + firstExtra : instAmt;
                        return (
                          <tr key={p.id} className={`border-b border-[#f4f3ef] last:border-0 ${i % 2 !== 0 ? 'bg-[#fafaf8]' : ''}`}>
                            <td className="px-2 py-2 text-[#9b9890]">{i + 1}</td>
                            <td className="px-2 py-2 text-[#1a1916]">
                              <div className="flex items-center gap-1.5">
                                <span>{p.description ?? `Rental Instalment ${i + 1} of ${n}`}</span>
                                {i === 0 && firstExtra > 0 && (
                                  <span className="relative group">
                                    <Info size={11} className="text-[#9b9890] cursor-pointer hover:text-[#2e9f82] shrink-0" />
                                    <div className="absolute left-0 top-5 z-20 hidden group-hover:block w-52 bg-[#1a1916] text-white text-[10px] rounded-xl px-3 py-2.5 shadow-lg space-y-1">
                                      <p className="font-semibold text-[#a8f0dc] mb-1">Includes on 1st cheque</p>
                                      {commission > 0 && <div className="flex justify-between"><span>Commission (5%)</span><span>{fmtAed(commission)}</span></div>}
                                      {adminFee > 0 && <div className="flex justify-between"><span>Admin fee</span><span>{fmtAed(adminFee)}</span></div>}
                                      {ejariAmt > 0 && <div className="flex justify-between"><span>Ejari fee</span><span>{fmtAed(ejariAmt)}</span></div>}
                                      <div className="flex justify-between border-t border-white/20 pt-1 font-semibold"><span>Extra total</span><span>{fmtAed(firstExtra)}</span></div>
                                    </div>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2 font-semibold text-[#1a1916] align-top">{fmtAed(displayAmt)}</td>
                            <td className="px-2 py-2 text-[#6b6860] align-top">{fmtD(p.transactionDate)}</td>
                            <td className="px-2 py-2 align-top">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                p.chequeStatus === 'cleared' ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                                p.chequeStatus === 'bounced' ? 'bg-red-50 text-red-700' :
                                'bg-amber-50 text-amber-700'
                              }`}>{p.chequeStatus}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#c5e8df] bg-[#f0faf6]">
                        <td colSpan={2} className="px-2 py-2.5 text-xs font-bold text-[#1a1916]">Total</td>
                        <td className="px-2 py-2.5 text-sm font-bold" style={{ color: '#2e9f82' }}>{fmtAed(grandTotal)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Security Deposits */}
              {(detail.securityDeposits?.length > 0 || detail.securityDepositAmount != null) && (() => {
                const sdAmt = detail.securityDeposits?.find(d => d.amountOnCheck != null)?.amountOnCheck
                  ?? detail.securityDepositAmount;
                const sdStatus = detail.securityDeposits?.[0]?.depositStatus ?? null;
                return (
                  <div className="flex items-center justify-between rounded-xl border border-[#e8e6e0] bg-[#fafaf8] px-4 py-3">
                    <div>
                      <p className="text-[10px] font-bold text-[#6b6860] uppercase tracking-wide mb-0.5">Security Deposit</p>
                      <p className="text-sm font-bold text-[#1a1916]">{sdAmt != null ? fmtAed(sdAmt) : '—'}</p>
                    </div>
                    {sdStatus ? (
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                        sdStatus === 'returned' ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                        sdStatus === 'held'     ? 'bg-[#fef3c7] text-[#92400e]' :
                        'bg-[#f4f3ef] text-[#9b9890]'
                      }`}>{sdStatus}</span>
                    ) : (
                      <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-semibold bg-[#f4f3ef] text-[#9b9890]">pending</span>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* Tab: Documents */}
        {tab === 'documents' && (
          <div className="p-5 space-y-5">
            {visibleDocs.length > 0 ? (
              <div className="space-y-1">
                {visibleDocs.map(d => (
                  <div key={d.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-[#f4f3ef] last:border-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText size={13} className="text-[#9b9890] shrink-0" />
                      <p className="text-xs font-semibold text-[#1a1916] truncate">{d.displayName ?? d.documentKey}</p>
                    </div>
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-[#2e9f82] hover:underline shrink-0">
                      <ExternalLink size={11} /> View
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#9b9890]">No documents shared yet.</p>
            )}
            <div className="border-t border-[#f4f3ef] pt-4">
              <p className="text-xs font-semibold text-[#3d3b35] mb-3">Upload Your Documents</p>
              <div className="space-y-2">
                <input type="text" value={uploadLabel} onChange={e => setUploadLabel(e.target.value)}
                  placeholder="Document name (e.g. Emirates ID)"
                  className="w-full text-xs px-3 py-2.5 border border-[#e8e6e0] rounded-xl focus:outline-none focus:border-[#2e9f82] text-[#1a1916]" />
                <input ref={docRef} type="file" accept=".pdf,.jpg,.jpeg,.png"
                  onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-[#6b6860] file:mr-3 file:text-xs file:font-semibold file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-[#f0faf6] file:text-[#2e9f82] hover:file:bg-[#e0f5ee] cursor-pointer" />
                {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
                <button onClick={handleUpload} disabled={!uploadFile || uploading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                  style={{ background: '#2e9f82' }}>
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </div>
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
            <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Your full legal name <span className="text-red-500">*</span></label>
            <input type="text" value={sigName} onChange={e => setSigName(e.target.value)}
              placeholder="As it appears on your Emirates ID"
              className="w-full text-sm px-3 py-2.5 border border-[#e8e6e0] rounded-xl focus:outline-none focus:border-[#2e9f82] mb-5 text-[#1a1916]" />
            <label className="block text-xs font-semibold text-[#3d3b35] mb-1.5">Draw your signature <span className="text-red-500">*</span></label>
            <SigPad onChange={setSigImg} />
            <button disabled={!sigName.trim() || !sigImg || signing} onClick={handleSign}
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
  | { kind: 'viewing'; key: string; group: ViewingGroup; contract?: TenantContract }
  | { kind: 'direct';  key: string; lead: DirectLead;    contract?: TenantContract };

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
              c.status === 'issued' ? 'bg-[#fef3c7] text-[#92400e]' :
              'bg-[#f4f3ef] text-[#6b6860]'
            }`}>
              {c.status === 'active' ? 'Active' : c.status === 'issued' ? 'Issued — Sign required' : c.status}
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
          {c.dewaStatus && c.dewaStatus !== 'not_submitted' && (
            <>
              <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
              <div>
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">DEWA</p>
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  c.dewaStatus === 'verified'  ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                  c.dewaStatus === 'submitted' ? 'bg-[#dbeafe] text-[#1e40af]' :
                  'bg-[#f4f3ef] text-[#6b6860]'
                }`}>
                  {c.dewaStatus === 'verified' ? 'Verified' : 'Submitted'}
                </span>
                {c.dewaAccountNumber && <p className="text-[10px] text-[#6b6860] mt-0.5">{c.dewaAccountNumber}</p>}
              </div>
            </>
          )}
        </div>
        )}

        {/* Detail: compact info + Contract | Journey */}
        {row.kind === 'viewing'
          ? <ExpandedDetail group={row.group} contract={row.contract} onRefresh={onRefresh} kycStatus={kycStatus} />
          : <DirectExpandedDetail lead={row.lead} contract={row.contract} onRefresh={onRefresh} kycStatus={kycStatus} />
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

  const groups = groupByLead(viewings);
  const activeGroups = groups.filter(g =>
    g.primary.outcome !== 'not_interested' &&
    !(['cancelled', 'no_show'].includes(g.primary.status) && g.primary.outcome === 'not_interested')
  );
  const inactiveGroups = groups.filter(g => ['cancelled', 'no_show'].includes(g.primary.status) || g.primary.outcome === 'not_interested');
  const activeDirectLeads = directLeads.filter(l => l.stage !== 'rejected');
  const inactiveDirectLeads = directLeads.filter(l => l.stage === 'rejected');
  const isEmpty = !loading && viewings.length === 0 && directLeads.length === 0;

  // Build unified row list
  const activeRows: SpaceRow[] = [
    ...activeGroups.map(g => ({
      kind: 'viewing' as const, key: `v-${g.leadId}`, group: g,
      contract: contracts.find(c => c.unit?.id !== null && c.unit.id === g.unit?.id),
    })),
    ...activeDirectLeads.map(l => ({
      kind: 'direct' as const, key: `d-${l.id}`, lead: l,
      contract: contracts.find(c => c.unit?.id !== null && c.unit.id === l.unit?.id),
    })),
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
    if (c) {
      if (c.status === 'active') return { label: 'Active Tenancy', bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false };
      const hasDewa = c.dewaStatus === 'submitted' || c.dewaStatus === 'verified';
      if (c.ejariStatus === 'registered' && hasDewa) return { label: 'Awaiting Activation', bg: 'bg-[#dbeafe]', text: 'text-[#1e40af]', isAction: false };
      if (c.ejariStatus === 'registered') return { label: 'Submit DEWA Number', bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true };
      if (c.status === 'issued') return { label: 'Sign Contract', bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true };
      return { label: 'Contract Pending', bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', isAction: false };
    }
    if (['approved', 'converted'].includes(stage)) return { label: 'Provider preparing contract', bg: 'bg-[#f0faf6]', text: 'text-[#2e9f82]', isAction: false };
    if (['applied', 'offer_made'].includes(stage)) return { label: 'Reservation under review', bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', isAction: false };
    if (vstatus === 'completed') return { label: 'Upload documents to continue', bg: 'bg-[#f0faf6]', text: 'text-[#2e9f82]', isAction: false };
    return { label: 'Attend your viewing', bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', isAction: false };
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1916]">My Spaces</h1>
        <p className="text-sm text-[#6b6860] mt-0.5">Track your property journey — from viewing to contract.</p>
      </div>

      {error && <div className="mb-5 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200 flex items-start gap-2"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</div>}

      {/* Active rows */}
      {!loading && activeRows.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden mb-6">
          {activeRows.map((row, idx) => {
            const sc = rowStatusConfig(row);
            const stageKey = row.kind === 'viewing' ? row.group.leadStage : row.lead.stage;
            const stageUi = leadStageLabel(stageKey);
            const stageProg = leadStageProgress(stageKey);
            return (
              <div key={row.key} className={`${idx > 0 ? 'border-t border-[#f0ede8]' : ''}`}>
                <button
                  onClick={() => openSpaceDetail(row.key)}
                  className={`w-full flex items-center gap-4 px-5 py-4 hover:bg-[#fafaf8] transition-colors cursor-pointer text-left ${sc.isAction ? 'bg-[#fffbf7]' : ''}`}
                >
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    sc.isAction ? 'bg-[#fff3cd]' : row.contract?.status === 'active' ? 'bg-[#d8f2e8]' : 'bg-[#f4f3ef]'
                  }`}>
                    {sc.isAction
                      ? <AlertCircle size={16} className="text-[#c2410c]" />
                      : row.contract?.status === 'active'
                      ? <CheckCircle2 size={16} className="text-[#2e9f82]" />
                      : <Home size={16} className="text-[#6b6860]" />}
                  </div>

                  {/* Unit info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1a1916] truncate leading-tight">{rowLabel(row)}</p>
                    <p className="text-[11px] text-[#9b9890] truncate mt-0.5">{rowBuilding(row) ? `${rowBuilding(row)} · ` : ''}{rowContextualDate(row)}</p>
                    <div className="mt-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] font-medium text-[#6b6860]">Lead stage</span>
                        <span className="text-[10px] text-[#9b9890]">{stageProg.current}/{stageProg.total}</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#f1efe9] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${stageProg.ratio * 100}%`, backgroundColor: '#2e9f82' }} />
                      </div>
                      <p className="text-[10px] text-[#9b9890] mt-1 truncate">{stageProg.next}</p>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${stageUi.bg} ${stageUi.text}`}>{stageUi.label}</span>
                    <span className={`text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap ${sc.bg} ${sc.text}`}>{sc.label}</span>
                    {sc.isAction && <span className="text-[10px] text-[#c2410c] font-medium">Action required</span>}
                  </div>

                  <ChevronRight size={15} className="text-[#9b9890] shrink-0" />
                </button>
              </div>
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
