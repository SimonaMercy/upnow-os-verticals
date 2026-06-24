/**
 * RP Lease Detail — v3 ("Tenancy Pass" redesign)
 *
 * Parallel route at /rental-provider/dashboard/contracts/[id]/v3 (and the manager
 * mirror at /dashboard/manager/contracts/[id]/v3 via re-export). It reproduces the
 * Claude Design "Lease Detail" handoff pixel-for-pixel and wires it to the same
 * live backend the v2 page uses, for active / winding-down leases:
 *
 *   - Consolidated header card: tenancy-pass strip · property + payment details
 *     (collected / outstanding bar) · contract-action buttons · security deposit.
 *   - Payments card (rent + sub-lease instalments) with record / status / edit.
 *   - Fees card (one-off charges) with add / status / delete.
 *   - Documents card (commercial/residential checklist) with upload / request /
 *     view / replace, plus payment receipts.
 *
 * The page renders only its own content — the sidebar + topbar come from the
 * shared DashboardShell (RP dashboard layout). Data + handlers mirror v2 so both
 * are powered by the identical endpoints:
 *   GET    /api/contracts/:id
 *   POST   /api/contracts/:id/payments          (record payment / add fee)
 *   PATCH  /api/contracts/:id/payments/:pid      (status / edit)
 *   DELETE /api/contracts/:id/payments/:pid      (delete fee / line)
 *   PATCH  /api/contracts/:id/renewal/propose    (propose renewal)
 *   POST   /api/contracts/:id/termination/request(terminate lease)
 *   /api/documents(/upload-url|/request)         (documents)
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus_Jakarta_Sans } from 'next/font/google';
import {
  ArrowLeft, MapPin, ShieldCheck, CreditCard, Settings, FileText,
  Eye, Download, RotateCcw, XCircle, Pencil, Trash2, ChevronDown, X, UploadCloud, Plus,
} from 'lucide-react';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { openDocViewer } from '@/lib/docViewer';
import { openDocsTogether } from '@/lib/openDocsTogether';
import { CustomerDocsModal } from '@/components/upnow/CustomerDocsModal';
import { tenantDisplayName } from '@/lib/tenantName';
import {
  KYC_DOCS, CONTRACT_DOCS, getRentalSectionDocs, isDocKeySatisfied,
  COMMERCIAL_TYPES, INDUSTRIAL_TYPES, type DocReq,
} from '@/lib/docRequirements';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { buildInstallmentDueDates } from '@/lib/installmentDates';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

// ────────────────────────────────────────────────────────────────────────────
// Types (mirrors the GET /contracts/:id shape consumed by v2)
// ────────────────────────────────────────────────────────────────────────────

interface ContractDoc {
  id: number; ownerType: string; ownerId: number; category: string;
  documentKey: string; displayName: string | null; fileUrl: string; status: string;
  issueDate: string | null; expiryDate: string | null; isVisibleToTenant: boolean;
}
interface ContractPayment {
  id: number; description: string | null; paymentType: string | null; paymentMethod: string | null;
  amount: number; vatAmount?: number; transactionDate: string | null;
  chequeStatus?: string | null; paidAt?: string | null; chequeNumber?: string | null;
}
interface ContractDetail {
  id: number; ref: string;
  contractType: 'new' | 'renewal';
  status: 'pending' | 'issued' | 'active' | 'expired' | 'terminated';
  startDate: string; endDate: string; durationYears: number | null;
  annualRent: number; rentVatRate?: number;
  numberOfInstallments: number | null; modeOfPayment: string | null;
  /** Installment plans the owning RP offers (empty = all) + their cheque days —
   *  let the renewal modal show the same filtered picker + snap due dates the way
   *  the backend stamps them (works for managers too). */
  allowedInstallments?: number[]; preferredChequeDays?: number[];
  adminFeeFils: number; ejariFeeFils: number;
  securityDepositAmount: number | null; securityDepositHeld?: number | null;
  securityDeposit?: {
    depositId: number | null; amount: number; chequeNumber: string | null;
    recordedDate: string | null; dueDate: string | null; paymentMethod: string | null;
    chequeStatus: string | null; status: string | null; isCarried: boolean;
    sourceContractId: number | null;
  } | null;
  vacateAtEnd?: boolean; parentContractId?: number | null;
  renewalChild?: { id: number; status: string } | null;
  termination: {
    requestedByRole: 'tenant' | 'rental_provider' | null; requestedAt: string | null;
    reason: string | null; effectiveDate: string | null;
    response: 'pending' | 'accepted' | 'rejected' | null; respondedAt: string | null;
    method?: 'mutual' | 'direct' | null;
  } | null;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null; entityType?: 'individual' | 'company' | null; companyName?: string | null };
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null };
  property: { id: number | null; buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
  unit: { id: number | null; number: string | null; name: string | null; type: string | null; floor: string | null; bedrooms: number | null; bathrooms: number | null };
  documents: ContractDoc[];
  payments: ContractPayment[];
  fees?: ContractPayment[];
}

// ────────────────────────────────────────────────────────────────────────────
// Formatters (verbatim from v2)
// ────────────────────────────────────────────────────────────────────────────

function fmtAed(n: number | null | undefined): string {
  if (n == null) return '—';
  return 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(n));
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE });
}
function fmtMethod(m: string | null | undefined): string {
  if (!m) return '—';
  return m.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

const STATUS_LABEL: Record<string, string> = {
  cleared: 'Cleared', pending: 'Pending', bounced: 'Bounced', cancelled: 'Cancelled',
};
const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  cleared: { color: '#1a7a4f', bg: '#e6f4ec' },
  pending: { color: '#b07415', bg: '#fbf0dd' },
  bounced: { color: '#c44536', bg: '#fcebe7' },
  cancelled: { color: '#6b756f', bg: '#eef1ec' },
};
const FEE_LABEL: Record<string, string> = {
  admin_fee: 'Admin fee', ejari_fee: 'Ejari fee', commission: 'Commission',
};
const feeLabel = (t: string | null | undefined) => FEE_LABEL[t ?? ''] ?? 'Fee';

// Shared option sets — mirror v2 exactly so both pages offer identical choices.
const PAYMENT_METHODS = [
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online' },
];
const PAYMENT_TYPES = [
  { value: 'rental_income', label: 'Rental income' },
  { value: 'security_deposit', label: 'Security deposit' },
  { value: 'admin_fee', label: 'Admin fee' },
  { value: 'ejari_fee', label: 'Ejari fee' },
  { value: 'commission', label: 'Commission' },
  { value: 'maintenance_fee', label: 'Maintenance fee' },
  { value: 'service_charge', label: 'Service charge' },
  { value: 'other', label: 'Other' },
];
const FEE_TYPE_OPTIONS = [
  { value: 'admin_fee', label: 'Admin fee' },
  { value: 'ejari_fee', label: 'Ejari fee' },
  { value: 'commission', label: 'Commission' },
];

/** RP fee rule (GET /api/fee-rules → { [category]: FeeRuleDto[] }) — the same
 *  shape the leads payment-plan editor uses to compute fees from the rent. */
interface FeeRuleDto { feeType: string; valueType: 'fixed_aed' | 'percentage'; value: number; vatApplicable: boolean; vatRate: number; isActive?: boolean; }
/** Net (excl. VAT) fee for a rule applied to an annual rent — mirrors feeRulesService.computeFees. */
const ruleFeeNet = (rule: FeeRuleDto | undefined, annualRent: number): string | null => {
  if (!rule || rule.isActive === false) return null;
  return rule.valueType === 'percentage' ? String(Math.round(annualRent * rule.value / 100)) : String(rule.value);
};
const spaceCategoryOf = (unitType: string | null | undefined): string =>
  COMMERCIAL_TYPES.includes(unitType ?? '') ? 'commercial'
    : INDUSTRIAL_TYPES.includes(unitType ?? '') ? 'industrial' : 'residential';
/** Net annual rent = listed − discount (the figure fees + cheque split key off). */
const renewalNetRent = (listedRent: string, discountType: string, discountValue: string): number => {
  const listed = parseFloat(listedRent) || 0;
  const dv = parseFloat(discountValue) || 0;
  const da = discountType === 'percent' ? Math.round(listed * dv) / 100 : discountType === 'fixed' ? dv : 0;
  return Math.max(0, listed - Math.min(da, listed));
};

// ────────────────────────────────────────────────────────────────────────────
// Small UI atoms
// ────────────────────────────────────────────────────────────────────────────

/** Cheque-status pill that doubles as a <select> to change the status inline. */
function StatusSelect({
  value, busy, onChange,
}: { value: string; busy: boolean; onChange: (v: string) => void }) {
  const st = STATUS_STYLE[value] ?? STATUS_STYLE.pending;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700,
        color: st.color, background: st.bg, padding: '5px 10px', borderRadius: 7, opacity: busy ? 0.6 : 1,
      }}>
        {STATUS_LABEL[value] ?? value} <ChevronDown size={11} />
      </span>
      <select
        value={value} disabled={busy} onChange={e => onChange(e.target.value)}
        aria-label="Cheque status"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
      >
        <option value="pending">Pending</option>
        <option value="cleared">Cleared</option>
        <option value="bounced">Bounced</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </span>
  );
}

/** Shared modal shell. */
function Modal({ title, onClose, children, footer, width = 460 }: {
  title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; width?: number;
}) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(20,30,25,.34)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: width, background: '#fff', borderRadius: 16,
        boxShadow: '0 30px 70px -24px rgba(20,40,30,.4)', overflow: 'hidden',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #eef1ec' }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: '#1d2823' }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ display: 'flex', background: 'none', border: 'none', color: '#8a938c', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto' }}>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '14px 20px', borderTop: '1px solid #eef1ec', background: '#fbfcfb' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

const labelCss: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: '#6b756f', textTransform: 'uppercase', marginBottom: 5 };
const inputCss: React.CSSProperties = { width: '100%', fontFamily: 'inherit', fontSize: 13.5, color: '#1d2823', padding: '9px 11px', border: '1px solid #e2e7e1', borderRadius: 9, outline: 'none', background: '#fff' };
const ghostBtn: React.CSSProperties = { fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '9px 15px', borderRadius: 9, cursor: 'pointer' };
const jadeBtn: React.CSSProperties = { fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#fff', background: '#1a9a64', border: '1px solid #168a59', padding: '9px 15px', borderRadius: 9, cursor: 'pointer' };
const brickBtn: React.CSSProperties = { fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#fff', background: '#c44536', border: '1px solid #b03a2a', padding: '9px 15px', borderRadius: 9, cursor: 'pointer' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 13 }}><label style={labelCss}>{label}</label>{children}</div>;
}

// ────────────────────────────────────────────────────────────────────────────
// Modals
// ────────────────────────────────────────────────────────────────────────────

function RecordPaymentModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (b: { description?: string; amount: number; paymentType?: string; paymentMethod?: string; chequeNumber?: string; transactionDate?: string }) => Promise<void>;
}) {
  const [f, setF] = useState({ description: '', amount: '', paymentType: 'rental_income', paymentMethod: 'cheque', chequeNumber: '', transactionDate: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  const submit = async () => {
    const amt = Number(f.amount);
    if (!amt || amt <= 0) { setErr('Enter a valid amount'); return; }
    setBusy(true); setErr(null);
    try {
      await onSubmit({
        description: f.description.trim() || undefined, amount: amt, paymentType: f.paymentType,
        paymentMethod: f.paymentMethod, chequeNumber: f.chequeNumber.trim() || undefined,
        transactionDate: f.transactionDate || undefined,
      });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to record payment'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Record payment" onClose={onClose}
      footer={<><button style={ghostBtn} onClick={onClose}>Cancel</button><button style={jadeBtn} disabled={busy} onClick={submit}>Record payment</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Type">
          <select style={inputCss} value={f.paymentType} onChange={e => set('paymentType', e.target.value)}>
            {PAYMENT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Method">
          <select style={inputCss} value={f.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description"><input style={inputCss} value={f.description} placeholder="e.g. Rental Instalment 2 of 4" onChange={e => set('description', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Amount (AED)"><input style={inputCss} type="number" value={f.amount} onChange={e => set('amount', e.target.value)} /></Field>
        <Field label="Cheque / reference no."><input style={inputCss} value={f.chequeNumber} placeholder="Cheque #, transfer ID…" onChange={e => set('chequeNumber', e.target.value)} /></Field>
      </div>
      <Field label="Date"><input style={inputCss} type="date" value={f.transactionDate} onChange={e => set('transactionDate', e.target.value)} /></Field>
      {err && <p style={{ color: '#c44536', fontSize: 12.5, margin: '4px 0 0' }}>{err}</p>}
    </Modal>
  );
}

function EditPaymentModal({ payment, vatRate, onClose, onSubmit }: {
  payment: ContractPayment; vatRate?: number; onClose: () => void;
  onSubmit: (patch: { amount?: number; chequeNumber?: string | null; description?: string | null; paymentMethod?: string; transactionDate?: string | null }) => Promise<void>;
}) {
  const [f, setF] = useState({
    description: payment.description ?? '', amount: payment.amount != null ? String(payment.amount) : '',
    chequeNumber: payment.chequeNumber ?? '', paymentMethod: payment.paymentMethod ?? 'cheque',
    transactionDate: payment.transactionDate ? payment.transactionDate.slice(0, 10) : '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  const submit = async () => {
    const amt = Number(f.amount);
    if (f.amount.trim() === '' || !Number.isFinite(amt) || amt < 0) { setErr('Enter a valid amount'); return; }
    setBusy(true); setErr(null);
    try {
      await onSubmit({
        amount: amt, description: f.description.trim() || null,
        chequeNumber: f.chequeNumber.trim() || null, paymentMethod: f.paymentMethod,
        transactionDate: f.transactionDate || null,
      });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Edit payment" onClose={onClose}
      footer={<><button style={ghostBtn} onClick={onClose}>Cancel</button><button style={jadeBtn} disabled={busy} onClick={submit}>Save changes</button></>}>
      <Field label="Description"><input style={inputCss} value={f.description} placeholder="e.g. Rental Instalment 1 of 4" onChange={e => set('description', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Amount (AED)"><input style={inputCss} type="number" value={f.amount} onChange={e => set('amount', e.target.value)} /></Field>
        <Field label="Due date"><input style={inputCss} type="date" value={f.transactionDate} onChange={e => set('transactionDate', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Payment method">
          <select style={inputCss} value={f.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Cheque / reference no."><input style={inputCss} value={f.chequeNumber} placeholder="Cheque #, transfer ID…" onChange={e => set('chequeNumber', e.target.value)} /></Field>
      </div>
      {!!vatRate && vatRate > 0 && <p style={{ fontSize: 12, color: '#8a938c', margin: 0 }}>VAT ({vatRate}%) is recalculated from the corrected amount automatically.</p>}
      {err && <p style={{ color: '#c44536', fontSize: 12.5, margin: '6px 0 0' }}>{err}</p>}
    </Modal>
  );
}

/** Add fee — net entered + optional VAT; backend stores GROSS (net + VAT). */
function AddFeeModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (b: { description?: string; amount: number; vatAmount?: number; paymentType?: string; paymentMethod?: string; transactionDate?: string; chequeStatus?: string }) => Promise<void>;
}) {
  const [f, setF] = useState({ paymentType: 'admin_fee', amount: '', vatAmount: '', transactionDate: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  const net = Number(f.amount); const vat = Number(f.vatAmount || 0);
  const submit = async () => {
    if (!Number.isFinite(net) || net <= 0) { setErr('Enter a valid amount'); return; }
    if (!Number.isFinite(vat) || vat < 0) { setErr('Enter a valid VAT amount'); return; }
    setBusy(true); setErr(null);
    try {
      await onSubmit({
        paymentType: f.paymentType,
        amount: Math.round((net + vat) * 100) / 100,   // GROSS
        vatAmount: vat,
        description: f.description.trim() || feeLabel(f.paymentType),
        transactionDate: f.transactionDate || undefined,
        paymentMethod: 'cheque', chequeStatus: 'pending',
      });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to add fee'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Add fee" onClose={onClose}
      footer={<><button style={ghostBtn} onClick={onClose}>Cancel</button><button style={jadeBtn} disabled={busy} onClick={submit}>Add fee</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Fee type">
          <select style={inputCss} value={f.paymentType} onChange={e => set('paymentType', e.target.value)}>
            {FEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Amount (excl. VAT, AED)"><input style={inputCss} type="number" value={f.amount} placeholder="e.g. 750" onChange={e => set('amount', e.target.value)} /></Field>
        <Field label="VAT (AED, optional)"><input style={inputCss} type="number" value={f.vatAmount} placeholder="0.00" onChange={e => set('vatAmount', e.target.value)} /></Field>
        <Field label="Due date"><input style={inputCss} type="date" value={f.transactionDate} onChange={e => set('transactionDate', e.target.value)} /></Field>
      </div>
      <Field label="Description (optional)"><input style={inputCss} value={f.description} placeholder={feeLabel(f.paymentType)} onChange={e => set('description', e.target.value)} /></Field>
      <p style={{ fontSize: 12, color: '#6b756f', margin: 0 }}>Total charged: <strong style={{ color: '#1d2823' }}>{fmtAed((Number(f.amount) || 0) + (Number(f.vatAmount) || 0))}</strong></p>
      {err && <p style={{ color: '#c44536', fontSize: 12.5, margin: '6px 0 0' }}>{err}</p>}
    </Modal>
  );
}

/** Edit fee — same net + VAT model as Add fee; submits the recomputed gross. */
function FeeEditModal({ fee, onClose, onSubmit }: {
  fee: ContractPayment; onClose: () => void;
  onSubmit: (patch: { amount?: number; vatAmount?: number; description?: string | null; transactionDate?: string | null }) => Promise<void>;
}) {
  const vat0 = fee.vatAmount ?? 0;
  const [f, setF] = useState({
    amount: String(Math.max(Math.round(((fee.amount ?? 0) - vat0) * 100) / 100, 0)), // NET
    vatAmount: vat0 ? String(vat0) : '',
    transactionDate: fee.transactionDate ? fee.transactionDate.slice(0, 10) : '',
    description: fee.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  const net = Number(f.amount); const vat = Number(f.vatAmount || 0);
  const submit = async () => {
    if (!Number.isFinite(net) || net < 0) { setErr('Enter a valid amount'); return; }
    if (!Number.isFinite(vat) || vat < 0) { setErr('Enter a valid VAT amount'); return; }
    setBusy(true); setErr(null);
    try {
      await onSubmit({ amount: Math.round((net + vat) * 100) / 100, vatAmount: vat, description: f.description.trim() || null, transactionDate: f.transactionDate || null });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save changes'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`Edit ${feeLabel(fee.paymentType).toLowerCase()}`} onClose={onClose}
      footer={<><button style={ghostBtn} onClick={onClose}>Cancel</button><button style={jadeBtn} disabled={busy} onClick={submit}>Save changes</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Amount (excl. VAT, AED)"><input style={inputCss} type="number" value={f.amount} onChange={e => set('amount', e.target.value)} /></Field>
        <Field label="VAT (AED, optional)"><input style={inputCss} type="number" value={f.vatAmount} placeholder="0.00" onChange={e => set('vatAmount', e.target.value)} /></Field>
        <Field label="Due date"><input style={inputCss} type="date" value={f.transactionDate} onChange={e => set('transactionDate', e.target.value)} /></Field>
        <Field label="Description"><input style={inputCss} value={f.description} placeholder={feeLabel(fee.paymentType)} onChange={e => set('description', e.target.value)} /></Field>
      </div>
      <p style={{ fontSize: 12, color: '#6b756f', margin: 0 }}>Total charged: <strong style={{ color: '#1d2823' }}>{fmtAed((Number(f.amount) || 0) + (Number(f.vatAmount) || 0))}</strong></p>
      {err && <p style={{ color: '#c44536', fontSize: 12.5, margin: '6px 0 0' }}>{err}</p>}
    </Modal>
  );
}

function TerminateModal({ contract, onClose, onDone }: { contract: ContractDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [effective, setEffective] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/request`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, effectiveDate: effective }),
      });
      if (!res.ok) throw new Error(`Termination request failed: ${res.status}`);
      onDone(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Termination request failed'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Terminate lease" onClose={onClose}
      footer={<><button style={ghostBtn} onClick={onClose}>Cancel</button><button style={brickBtn} disabled={!reason.trim() || !effective || busy} onClick={submit}>Send request</button></>}>
      <p style={{ fontSize: 13, color: '#6b756f', margin: '0 0 14px' }}>
        {contract.tenant.name ?? 'The customer'} must accept this request before the lease terminates.
      </p>
      <Field label="Reason"><textarea style={{ ...inputCss, minHeight: 80, resize: 'vertical' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you ending this lease?" /></Field>
      <Field label="Effective date"><input style={inputCss} type="date" value={effective} onChange={e => setEffective(e.target.value)} /></Field>
      {err && <p style={{ color: '#c44536', fontSize: 12.5, margin: '4px 0 0' }}>{err}</p>}
    </Modal>
  );
}

/**
 * RenewalModal — faithful port of v2's RenewalProposeModal (the SCRUM-596
 * overhaul): RP-filtered installment picker, de-bundled fee cheques, discount,
 * cheque payee, extra one-off charges, and a live planned-schedule preview whose
 * due dates snap to the RP's cheque days exactly as the backend stamps them.
 * Submits the identical body to PATCH /contracts/:id/renewal/propose.
 */
function RenewalModal({ contract, onClose, onDone }: { contract: ContractDetail; onClose: () => void; onDone: () => void }) {
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const ns = new Date(contract.endDate); ns.setDate(ns.getDate() + 1);
  const ne = new Date(ns); ne.setFullYear(ne.getFullYear() + 1); ne.setDate(ne.getDate() - 1);
  // Prefill one-off fees from the PARENT lease's actual fees (its fee rows, else
  // its stored column) — a sensible default the RP can edit. Blank when none.
  const parentFeeAmt = (t: string, col?: number | null) => {
    const row = (contract.fees ?? []).find(x => x.paymentType === t)?.amount;
    const v = row ?? col ?? 0; return v > 0 ? String(v) : '';
  };
  const [f, setF] = useState({
    listedRent: String(Math.round(contract.annualRent * 1.05)),
    discountType: 'none' as 'none' | 'percent' | 'fixed', discountValue: '',
    newStartDate: iso(ns), newEndDate: iso(ne),
    numberOfInstallments: String(contract.numberOfInstallments ?? 4),
    modeOfPayment: contract.modeOfPayment ?? 'cheque', chequePayeeName: '',
    adminFee: parentFeeAmt('admin_fee', contract.adminFeeFils),
    ejariFee: parentFeeAmt('ejari_fee', contract.ejariFeeFils),
    commission: parentFeeAmt('commission'),
  });
  const [extras, setExtras] = useState<{ description: string; amount: string; dueDate: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // RP fee rules (admin/ejari/commission as a % or fixed of the annual amount) —
  // fetched on open and re-applied as the rent changes, mirroring the lead
  // payment-plan editor and the backend's feeRulesService.computeFees.
  const feeRulesRef = useRef<FeeRuleDto[]>([]);
  const [rulesApplied, setRulesApplied] = useState(false);
  const dirty = useRef<Set<string>>(new Set());   // fee fields the RP manually overrode

  // Installment plans + cheque days come from the contract payload (the OWNING
  // RP's config) so a manager still sees the right filtered list and the preview
  // snaps dates the same way the backend does.
  const allowedInstallments = contract.allowedInstallments ?? [];
  const chequeDays = contract.preferredChequeDays ?? [];

  // Recompute the non-overridden rule-based fees from the current net rent.
  const withRuleFees = (d: typeof f): typeof f => {
    const rules = feeRulesRef.current;
    if (!rules.length) return d;
    const net = renewalNetRent(d.listedRent, d.discountType, d.discountValue);
    const out = { ...d };
    ([['adminFee', 'admin_fee'], ['ejariFee', 'ejari_fee'], ['commission', 'commission']] as const).forEach(([field, ft]) => {
      if (dirty.current.has(field)) return;
      const rv = ruleFeeNet(rules.find(r => r.feeType === ft), net);
      if (rv != null) out[field] = rv;
    });
    return out;
  };
  // Fetch the RP's fee rules once and apply them to the annual amount. The setF
  // runs inside the async .then so it stays clear of the set-state-in-effect rule.
  useEffect(() => {
    let active = true;
    fetch('/api/fee-rules', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((map: Record<string, FeeRuleDto[]> | null) => {
        if (!active || !map) return;
        const rules = map[spaceCategoryOf(contract.unit.type)] ?? map.residential ?? [];
        feeRulesRef.current = rules;
        if (rules.length) { setRulesApplied(true); setF(prev => withRuleFees(prev)); }
      })
      .catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.unit.type]);

  // Rent-affecting fields recompute the rule fees; fee fields mark themselves
  // overridden so a manually-typed figure is never clobbered.
  const set = (k: keyof typeof f, v: string) => setF(prev => {
    const draft = { ...prev, [k]: v };
    return (k === 'listedRent' || k === 'discountType' || k === 'discountValue') ? withRuleFees(draft) : draft;
  });
  const setFee = (k: 'adminFee' | 'ejariFee' | 'commission', v: string) => { dirty.current.add(k); setF(prev => ({ ...prev, [k]: v })); };
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
  // Rent VAT (commercial/industrial) carries on the cheque; rate is a whole %.
  const vatRate = Number(contract.rentVatRate) || 0;
  const vatOf = (x: number) => vatRate ? Math.round(x * vatRate) / 100 : 0;
  // Due dates — spread over the renewal term + snapped to the RP's cheque days,
  // identical to what proposeRenewal stamps server-side.
  const dueDates = buildInstallmentDueDates(f.newStartDate, f.newEndDate, n, chequeDays);

  // Preview schedule: rent cheques (each pure rent + VAT), then separate fee
  // rows, then any extra charges — mirrors the backend's de-bundled rows.
  type Row = { key: string; d: string; date: string; net: number; vat: number };
  const rows: Row[] = [];
  if (n && rent) {
    const base = Math.floor(rent / n);
    const lastA = rent - base * (n - 1);
    for (let i = 0; i < n; i++) {
      const r = i === n - 1 ? lastA : base;
      rows.push({ key: `r${i}`, d: n === 1 ? 'Annual Rent' : `Rental Instalment ${i + 1} of ${n}`, date: dueDates[i] ?? '', net: r, vat: vatOf(r) });
    }
  }
  const feeDate = dueDates[0] ?? f.newStartDate;
  if (adminN > 0) rows.push({ key: 'admin', d: 'Admin Fee', date: feeDate, net: adminN, vat: 0 });
  if (ejariN > 0) rows.push({ key: 'ejari', d: 'Ejari Fee', date: feeDate, net: ejariN, vat: 0 });
  if (commN > 0) rows.push({ key: 'comm', d: 'Commission', date: feeDate, net: commN, vat: 0 });
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
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
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
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? `Renewal propose failed: ${res.status}`); }
      onDone(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Renewal propose failed'); }
    finally { setBusy(false); }
  };

  const subhead: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: '#9aa39c', textTransform: 'uppercase', margin: '0 0 8px' };
  const note: React.CSSProperties = { fontSize: 12, color: '#8a938c', margin: 0 };
  const roInput: React.CSSProperties = { ...inputCss, background: '#f4f6f3', color: '#7d8780' };
  const installmentPlans = allowedInstallmentPlans(allowedInstallments, [n]);

  return (
    <Modal title="Propose renewal" onClose={onClose} width={640}
      footer={<><button style={ghostBtn} onClick={onClose}>Cancel</button><button style={jadeBtn} disabled={busy} onClick={submit}><RotateCcw size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Save renewal draft</button></>}>

      <p style={subhead}>Current contract</p>
      <div style={{ marginBottom: 18, padding: '12px 14px', background: '#f9faf8', border: '1px solid #eef1ec', borderRadius: 11, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px' }}>
        <div style={note}><b style={{ color: '#1d2823' }}>{contract.tenant.name ?? '—'}</b></div>
        <div style={note}>{fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}</div>
        <div style={note}>Unit {contract.unit.number ?? '—'} · {contract.property.buildingName ?? '—'}</div>
        <div style={note}>Current rent <b style={{ color: '#1d2823' }}>{fmtAed(contract.annualRent)}</b></div>
      </div>

      <p style={subhead}>Renewal period</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Start date"><input style={inputCss} type="date" value={f.newStartDate} onChange={e => set('newStartDate', e.target.value)} /></Field>
        <Field label="End date"><input style={inputCss} type="date" value={f.newEndDate} onChange={e => set('newEndDate', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Installments">
          <select style={inputCss} value={f.numberOfInstallments} onChange={e => set('numberOfInstallments', e.target.value)}>
            {installmentPlans.map(p => <option key={p.value} value={p.value}>{p.value}</option>)}
          </select>
        </Field>
        <Field label="Listed annual rent (AED)"><input style={inputCss} type="number" value={f.listedRent} onChange={e => set('listedRent', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Discount">
          <select style={inputCss} value={f.discountType} onChange={e => set('discountType', e.target.value)}>
            <option value="none">No discount</option>
            <option value="percent">Percentage (%)</option>
            <option value="fixed">Fixed (AED)</option>
          </select>
        </Field>
        <Field label={f.discountType === 'percent' ? 'Discount %' : f.discountType === 'fixed' ? 'Discount (AED)' : 'Net annual rent (AED)'}>
          {f.discountType === 'none'
            ? <input style={roInput} value={fmtAed(rent)} disabled />
            : <input style={inputCss} type="number" value={f.discountValue} onChange={e => set('discountValue', e.target.value)} />}
        </Field>
      </div>
      {f.discountType !== 'none' && (
        <p style={{ ...note, margin: '-4px 0 14px' }}>
          Net annual rent after discount: <b style={{ color: '#1d2823' }}>{fmtAed(rent)}</b>{discountAmt > 0 && <> (−{fmtAed(discountAmt)})</>}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Mode of payment">
          <select style={inputCss} value={f.modeOfPayment} onChange={e => set('modeOfPayment', e.target.value)}>
            <option value="cheque">Cheque</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="online">Online</option>
          </select>
        </Field>
        <Field label="Cheques payable to (optional)"><input style={inputCss} value={f.chequePayeeName} placeholder={contract.landlord.companyName ?? contract.landlord.name ?? ''} onChange={e => set('chequePayeeName', e.target.value)} /></Field>
      </div>

      <p style={subhead}>Fees (AED) — billed as their own cheques</p>
      {rulesApplied && <p style={{ ...note, margin: '-2px 0 8px' }}>Auto-filled from your fee rules on the annual amount — edit any to override.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Admin fee"><input style={inputCss} type="number" value={f.adminFee} onChange={e => setFee('adminFee', e.target.value)} /></Field>
        <Field label="Ejari fee"><input style={inputCss} type="number" value={f.ejariFee} onChange={e => setFee('ejariFee', e.target.value)} /></Field>
        <Field label="Commission"><input style={inputCss} type="number" value={f.commission} onChange={e => setFee('commission', e.target.value)} /></Field>
        <Field label="Deposit (carries over)"><input style={roInput} value={fmtAed(contract.securityDepositAmount)} disabled /></Field>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={{ ...subhead, margin: 0 }}>Additional charges</p>
        <button type="button" style={{ ...ghostBtn, padding: '6px 11px', fontSize: 12 }} onClick={addExtra}><Plus size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Add charge</button>
      </div>
      {extras.map((e, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 150px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input style={inputCss} placeholder="Description (e.g. Municipality Fee)" value={e.description} onChange={ev => setExtra(i, 'description', ev.target.value)} />
          <input style={inputCss} type="number" placeholder="Amount" value={e.amount} onChange={ev => setExtra(i, 'amount', ev.target.value)} />
          <input style={inputCss} type="date" value={e.dueDate} onChange={ev => setExtra(i, 'dueDate', ev.target.value)} />
          <button type="button" aria-label="Remove" style={{ display: 'flex', background: 'none', border: 'none', color: '#c44536', cursor: 'pointer', padding: 4 }} onClick={() => removeExtra(i)}><Trash2 size={15} /></button>
        </div>
      ))}

      {rows.length > 0 && (
        <>
          <p style={{ ...subhead, marginTop: 14 }}>Planned schedule</p>
          <div style={{ border: '1px solid #e7ebe6', borderRadius: 11, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 110px', padding: '9px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: '#9aa39c', background: '#fbfcfb' }}>
              <span>#</span><span>DESCRIPTION</span><span>DUE</span><span style={{ textAlign: 'right' }}>AMOUNT</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 110px', alignItems: 'center', padding: '9px 12px', borderTop: '1px solid #f1f3f0', fontSize: 12.5 }}>
                <span style={{ color: '#aab2ab' }}>{i + 1}</span>
                <span style={{ color: '#2b342e' }}>{r.d}{r.vat > 0 && <span style={{ color: '#a0a8a1' }}> · incl. VAT {r.vat.toLocaleString('en-AE')}</span>}</span>
                <span style={{ color: '#6b756f', fontVariantNumeric: 'tabular-nums' }}>{r.date ? fmtDate(r.date) : '—'}</span>
                <span style={{ textAlign: 'right', fontWeight: 700, color: '#1d2823', fontVariantNumeric: 'tabular-nums' }}>{(r.net + r.vat).toLocaleString('en-AE')}</span>
              </div>
            ))}
            {totalVat > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', padding: '8px 12px', borderTop: '1px solid #f1f3f0', fontSize: 12, color: '#9aa39c' }}>
                <span>of which VAT</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalVat.toLocaleString('en-AE')}</span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', padding: '10px 12px', borderTop: '1px solid #e7ebe6', background: '#eef6f1', fontSize: 13, fontWeight: 800, color: '#1a6b4d' }}>
              <span>Total</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total.toLocaleString('en-AE')}</span>
            </div>
          </div>
          {chequeDays.length === 0 && (
            <p style={{ ...note, marginTop: 6 }}>Tip: set preferred cheque days in Settings → Rules to standardise due dates.</p>
          )}
        </>
      )}
      {err && <p style={{ color: '#c44536', fontSize: 12.5, marginTop: 8 }}>{err}</p>}
      <p style={{ ...note, marginTop: 10 }}>This saves a draft for your review — the customer is <b>not</b> notified until you press <b>Send</b> on the contract page.</p>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────

type ModalKind = null | 'record' | 'addFee' | 'renew' | 'terminate'
  | { kind: 'editPayment'; payment: ContractPayment }
  | { kind: 'editFee'; fee: ContractPayment };

export default function LeaseDetailV3() {
  const params = useParams();
  const id = Number(params?.id);
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const { canForRp } = useManagerPermissions();

  const isManagerView = pathname.startsWith('/dashboard/manager');
  const contractsBase = isManagerView ? '/dashboard/manager/contracts' : '/rental-provider/dashboard/contracts';

  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [showDocsHistory, setShowDocsHistory] = useState(false);
  const [statusBusy, setStatusBusy] = useState<number | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // ── data ── (no synchronous setState so it's safe to call from the mount effect)
  const reload = useCallback(() => {
    if (!id) return Promise.resolve();
    return fetch(`/api/contracts/${id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() as Promise<ContractDetail>; })
      .then(data => {
        const normalized: ContractDetail = data?.tenant
          ? { ...data, tenant: { ...data.tenant, name: tenantDisplayName(data.tenant) } }
          : data;
        setContract(normalized);
        setError(null);
      })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);

  // ── manager permission gates (RP owner = all-true) ──
  const rpScope = searchParams.get('rp') ?? (contract?.landlord?.id != null ? String(contract.landlord.id) : '');
  const mgrCan = useCallback((flag: Parameters<typeof canForRp>[0]) =>
    !isManagerView || (rpScope !== '' && canForRp(flag, Number(rpScope))), [isManagerView, rpScope, canForRp]);
  const perms = useMemo(() => ({
    renewals: mgrCan('canManageRenewals'),
    agreements: mgrCan('canManageAgreements'),
    deposits: mgrCan('canManageDeposits') || mgrCan('canManageCollections'),
    collections: mgrCan('canManageCollections'),
    documents: mgrCan('canManageDocuments'),
  }), [mgrCan]);

  // ── mutation handlers (mirror v2; reload() on success) ──
  const onRecordPayment = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/contracts/${id}/payments`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? `Error ${res.status}`); }
    reload();
  };
  const onUpdatePayment = async (paymentId: number, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/contracts/${id}/payments/${paymentId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? `Error ${res.status}`); }
    reload();
  };
  const onDeletePayment = async (paymentId: number) => {
    const res = await fetch(`/api/contracts/${id}/payments/${paymentId}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? `Error ${res.status}`); }
    reload();
  };
  const changeStatus = async (paymentId: number, status: string) => {
    setStatusBusy(paymentId); setActionErr(null);
    try { await onUpdatePayment(paymentId, { chequeStatus: status }); }
    catch (e) { setActionErr(e instanceof Error ? e.message : 'Could not update status'); }
    finally { setStatusBusy(null); }
  };
  const deleteFee = async (feeId: number) => {
    if (!confirm('Delete this fee?')) return;
    setActionErr(null);
    try { await onDeletePayment(feeId); }
    catch (e) { setActionErr(e instanceof Error ? e.message : 'Could not delete fee'); }
  };

  // ── document upload / request ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<{ key: string; label: string; category: string } | null>(null);
  const triggerUpload = (meta: { key: string; label: string; category: string }) => { pendingUpload.current = meta; fileInputRef.current?.click(); };
  const onUploadDoc = async (file: File, meta: { key: string; label: string; category: string }) => {
    const docKey = `${meta.key}_${Date.now()}`;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: id, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
    });
    if (!urlRes.ok) { const b = await urlRes.json().catch(() => ({})) as { message?: string | string[] }; throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${urlRes.status}`)); }
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey?: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
    const docRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: id, category: meta.category, documentKey: docKey, displayName: meta.label, fileUrl, s3Key: fileKey, mimeType: file.type || 'application/octet-stream', isVisibleToTenant: false }),
    });
    if (!docRes.ok) { const b = await docRes.json().catch(() => ({})) as { message?: string | string[] }; throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${docRes.status}`)); }
    reload();
  };
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; const meta = pendingUpload.current;
    e.target.value = '';
    if (!file || !meta) return;
    setActionErr(null);
    try { await onUploadDoc(file, meta); }
    catch (err) { setActionErr(err instanceof Error ? err.message : 'Upload failed'); }
  };
  const onRequestDoc = async (label: string) => {
    if (!contract?.tenant.id) { setActionErr('This lease has no linked customer to request from.'); return; }
    const docKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
    setActionErr(null);
    try {
      const res = await fetch('/api/documents/request', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'customer', ownerId: contract.tenant.id, documentKey: docKey, displayName: label, category: 'contract' }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})) as { message?: string | string[] }; throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${res.status}`)); }
      reload();
    } catch (e) { setActionErr(e instanceof Error ? e.message : 'Request failed'); }
  };

  // ── loading / error ──
  if (loading && !contract) {
    return <div className={jakarta.className} style={{ minHeight: '100%', background: '#f2f4f1', padding: 40, textAlign: 'center', color: '#8a938c' }}>Loading lease…</div>;
  }
  if (error || !contract) {
    return (
      <div className={jakarta.className} style={{ minHeight: '100%', background: '#f2f4f1', padding: 40, textAlign: 'center' }}>
        <p style={{ fontWeight: 700, color: '#1d2823' }}>Lease not found</p>
        <p style={{ color: '#8a938c', fontSize: 13 }}>{error ?? 'No data'}</p>
        <button style={{ ...ghostBtn, marginTop: 12 }} onClick={() => router.back()}>← Go back</button>
      </div>
    );
  }

  // ── derived view-model ──
  const c = contract;
  const isRenewal = c.contractType === 'renewal';
  const winding = (c.termination?.response === 'accepted') || !!c.vacateAtEnd || c.termination?.method === 'direct';
  const building = c.property.buildingName ?? 'Property';
  const unitLabel = c.unit.name ?? (c.unit.number ? `Unit ${c.unit.number}` : '—');
  const unitNumber = c.unit.number ? `Unit ${c.unit.number}` : '';
  const location = [c.property.community, c.property.emirate].filter(Boolean).join(', ') || c.property.fullAddress || '—';
  const landlordName = c.landlord.name ?? c.landlord.companyName ?? '—';

  // status pill (pass strip)
  const statusPill = winding
    ? { label: 'MOVE-OUT SCHEDULED', color: '#c44536', bg: '#fcebe7' }
    : c.status === 'active' ? { label: 'ACTIVE TENANCY', color: '#1a7a4f', bg: '#e6f4ec' }
    : c.status === 'expired' ? { label: 'LEASE ENDED', color: '#6b756f', bg: '#eef1ec' }
    : c.status === 'terminated' ? { label: 'TERMINATED', color: '#9a3520', bg: '#fcebe7' }
    : { label: 'IN SETUP', color: '#b07415', bg: '#fbf0dd' };
  const titleBadge = winding
    ? { label: 'Move-out', color: '#c44536', bg: '#fcebe7' }
    : c.status === 'active' ? { label: 'Active', color: '#1a7a4f', bg: '#e7f3ec' }
    : c.status === 'terminated' ? { label: 'Terminated', color: '#9a3520', bg: '#fcebe7' }
    : c.status === 'expired' ? { label: 'Ended', color: '#6b756f', bg: '#eef1ec' }
    : { label: 'In setup', color: '#b07415', bg: '#fbf0dd' };

  // ── financials (mirrors v2 ContractPass) ──
  const g = (arr: ContractPayment[]) => arr.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const v = (arr: ContractPayment[]) => arr.reduce((s, p) => s + (Number(p.vatAmount) || 0), 0);
  const isCleared = (p: ContractPayment) => p.chequeStatus === 'cleared' || !!p.paidAt;
  const payments = c.payments ?? [];
  const feeItems = c.fees ?? [];
  const nonDeposit = payments.filter(p => p.paymentType !== 'security_deposit');
  const otherItems = nonDeposit.filter(p => p.paymentType === 'other');
  const rentItems = nonDeposit.filter(p => p.paymentType !== 'other');
  const computedRentVat = c.rentVatRate ? Math.round((c.annualRent || 0) * Number(c.rentVatRate)) / 100 : 0;
  const hasRentRows = rentItems.length > 0;
  const rentGross = hasRentRows ? g(rentItems) : (c.annualRent || 0) + computedRentVat;
  const rentVat = hasRentRows ? v(rentItems) : computedRentVat;
  const rentNet = rentGross - rentVat;
  const otherGross = g(otherItems);
  const feesGross = g(feeItems);
  const depositRow = payments.find(p => p.paymentType === 'security_deposit') ?? null;
  const deposit = depositRow?.amount ?? c.securityDeposit?.amount ?? c.securityDepositHeld ?? 0;
  const totalVat = rentVat + v(otherItems) + v(feeItems);
  const totalPayable = rentGross + otherGross + feesGross + deposit;
  const collected = g(payments.filter(isCleared)) + g(feeItems.filter(isCleared));
  const outstanding = Math.max(0, totalPayable - collected);
  const pct = totalPayable > 0 ? Math.min(100, (collected / totalPayable) * 100) : 0;

  const paymentDetails = [
    { label: 'Rent (incl. VAT)', value: fmtAed(rentGross), show: rentGross > 0 },
    { label: 'Other charges', value: fmtAed(otherGross), show: otherGross > 0 },
    { label: 'Fees (incl. VAT)', value: fmtAed(feesGross), show: feesGross > 0 },
  ].filter(r => r.show);

  // deposit pill
  const depStatus = (depositRow?.chequeStatus ?? c.securityDeposit?.chequeStatus ?? 'pending');
  const depPillStyle = STATUS_STYLE[depStatus] ?? STATUS_STYLE.pending;

  // ── documents checklist ──
  const checklist: DocReq[] = [...KYC_DOCS, ...getRentalSectionDocs(c.unit.type, c.tenant.entityType), ...CONTRACT_DOCS];
  const docKeys = new Set(c.documents.map(d => d.documentKey));
  const findDoc = (key: string): ContractDoc | undefined =>
    c.documents.find(d => d.documentKey === key)
    ?? ((key === 'emirates_id_front' || key === 'emirates_id_back') ? c.documents.find(d => d.documentKey === 'emirates_id') : undefined);
  const onFileCount = checklist.filter(d => isDocKeySatisfied(d.key, docKeys)).length;
  const setLabel = COMMERCIAL_TYPES.includes(c.unit.type ?? '') ? 'Commercial set'
    : INDUSTRIAL_TYPES.includes(c.unit.type ?? '') ? 'Industrial set' : 'Residential set';
  // "View all" — every uploaded doc on this contract, checklist order first (rest
  // appended), opened together in the inline viewer. Mirrors v2's View all.
  const viewAllDocs = (() => {
    const seen = new Set<number>();
    const out: { fileUrl: string; displayName: string }[] = [];
    for (const req of checklist) {
      const d = findDoc(req.key);
      if (d?.fileUrl && !seen.has(d.id)) { seen.add(d.id); out.push({ fileUrl: d.fileUrl, displayName: d.displayName ?? req.label }); }
    }
    for (const d of c.documents) {
      if (d.fileUrl && !seen.has(d.id)) { seen.add(d.id); out.push({ fileUrl: d.fileUrl, displayName: d.displayName ?? d.documentKey }); }
    }
    return out;
  })();

  // payment-row number (deposit shows "$", others count up)
  let payCounter = 0;
  const receiptBase = `${contractsBase}/${c.id}/print/receipt`;
  const printUrl = `${contractsBase}/${c.id}/print`;

  // ── shared styles ──
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e7ebe6', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(20,40,30,.03)' };
  const cardHeadIcon: React.CSSProperties = { width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const kvLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: '#a0a8a1' };

  return (
    <div className={jakarta.className} style={{ minHeight: '100%', background: '#f2f4f1', color: '#1d2823' }}>
      <input ref={fileInputRef} type="file" hidden onChange={onFileChosen} />
      <main style={{ padding: '22px 26px 30px' }}>

        {/* TITLE ROW */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
          <button onClick={() => router.back()} aria-label="Back" style={{ width: 38, height: 38, borderRadius: 10, background: '#fff', border: '1px solid #e2e7e1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a544d', cursor: 'pointer', flex: '0 0 auto' }}>
            <ArrowLeft size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>{c.ref}</h1>
              <span style={{ fontSize: 11, fontWeight: 700, color: titleBadge.color, background: titleBadge.bg, padding: '4px 10px', borderRadius: 7 }}>{titleBadge.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#8a938c', marginTop: 5, flexWrap: 'wrap' }}>
              <span>{building}</span><span style={{ color: '#cdd4cd' }}>›</span>
              {unitNumber && <><span style={{ color: '#5a635c', fontWeight: 600 }}>{unitNumber}</span><span style={{ color: '#cdd4cd' }}>›</span></>}
              <span>{c.ref} · {location}</span>
            </div>
          </div>
        </div>

        {actionErr && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fcebe7', border: '1px solid #f0d0c9', borderRadius: 10, color: '#c44536', fontSize: 12.5, fontWeight: 600 }}>{actionErr}</div>
        )}

        {/* CONSOLIDATED HEADER CARD */}
        <section style={{ ...card, marginBottom: 16 }}>
          {/* pass strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 22px', background: 'linear-gradient(90deg,#f6f3ea,#faf8f1)', borderBottom: '1px solid #efe9d9' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: '#1a7a4f', border: '1px solid #bfe0cd', background: '#eaf5ee', padding: '4px 9px', borderRadius: 6 }}>{isRenewal ? 'RENEWAL PASS' : 'TENANCY PASS'}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#9c9888', letterSpacing: '.04em' }}>{c.ref}</span>
            <div style={{ flex: 1 }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: statusPill.color, background: statusPill.bg, padding: '5px 11px', borderRadius: 7 }}>● {statusPill.label}</span>
          </div>

          {/* ROW 1: property info | payment details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr' }}>
            <div style={{ padding: '22px 24px', borderRight: '1px solid #eef1ec' }}>
              <div style={kvLabel}>PROPERTY INFORMATION</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#3a443d', marginTop: 9 }}>{building}</div>
              <div style={{ fontSize: 23, fontWeight: 800, color: '#1a6b4d', letterSpacing: '-.02em', lineHeight: 1.15, marginTop: 2 }}>{unitLabel}</div>
              <div style={{ fontSize: 13, color: '#7d8780', marginTop: 5 }}>
                {unitNumber && <>{unitNumber} · </>}<span style={{ color: '#5a635c' }}><MapPin size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {location}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: 26, marginTop: 20 }}>
                <div>
                  <div style={{ ...kvLabel, letterSpacing: '.08em' }}>TENANT</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#3a443d', marginTop: 4 }}>{c.tenant.name ?? '—'}</div>
                </div>
                <div>
                  <div style={{ ...kvLabel, letterSpacing: '.08em' }}>LANDLORD</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#3a443d', marginTop: 4 }}>{landlordName}</div>
                </div>
                <div>
                  <div style={{ ...kvLabel, letterSpacing: '.08em' }}>LEASE PERIOD</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#3a443d', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(c.startDate)} — {fmtDate(c.endDate)}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '22px 24px', background: '#fbfcfb' }}>
              <div style={{ ...kvLabel, marginBottom: 11 }}>PAYMENT DETAILS</div>
              {paymentDetails.map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 13 }}>
                  <span style={{ color: '#6b756f' }}>{row.label}</span>
                  <span style={{ fontWeight: 600, color: '#3a443d', fontVariantNumeric: 'tabular-nums' }}>{row.value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10, paddingTop: 11, borderTop: '1px solid #e7ebe6' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1d2823' }}>Total payable</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#1a6b4d', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(totalPayable)}</span>
              </div>
              {totalVat > 0 && <div style={{ textAlign: 'right', fontSize: 10.5, color: '#a0a8a1', marginTop: 2 }}>incl. {fmtAed(totalVat)} VAT</div>}
              <div style={{ height: 7, borderRadius: 6, background: '#edf0ec', overflow: 'hidden', marginTop: 14 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#1a9a64', borderRadius: 6 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 6 }}>
                <span style={{ color: '#1a7a4f', fontWeight: 600 }}>{fmtAed(collected)} collected</span>
                <span style={{ color: '#b07415', fontWeight: 600 }}>{fmtAed(outstanding)} outstanding</span>
              </div>
            </div>
          </div>

          {/* ROW 2: contract actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 24px', borderTop: '1px solid #eef1ec', background: '#fff', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: '#9aa39c' }}>Contract actions</span>
            {perms.renewals && (
              <button onClick={() => setModal('renew')} style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#1a7a4f', background: '#e7f3ec', border: '1px solid #cce6d8', padding: '9px 15px', borderRadius: 9, cursor: 'pointer' }}>
                <RotateCcw size={15} /> Propose renewal
              </button>
            )}
            {perms.agreements && (
              <button onClick={() => setModal('terminate')} style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#c44536', background: '#fcebe7', border: '1px solid #f0d0c9', padding: '9px 15px', borderRadius: 9, cursor: 'pointer' }}>
                <XCircle size={15} /> Terminate lease
              </button>
            )}
            <span style={{ marginLeft: 'auto' }} />
            <a href={printUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '9px 15px', borderRadius: 9, cursor: 'pointer' }}>
              <Eye size={15} /> Preview
            </a>
            <a href={printUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '9px 15px', borderRadius: 9, cursor: 'pointer' }}>
              <Download size={15} /> PDF
            </a>
          </div>

          {/* ROW 3: security deposit */}
          {deposit > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 24px', borderTop: '1px solid #eef1ec', background: '#f3f7f4' }}>
              <span style={{ width: 34, height: 34, flex: '0 0 34px', borderRadius: 10, background: '#e1efe7', color: '#1a7a4f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShieldCheck size={18} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1d2823' }}>Security deposit</div>
                <div style={{ fontSize: 11.5, color: '#7d8780' }}>Refundable · held separately, not part of the rent total</div>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: depPillStyle.color, background: depPillStyle.bg, padding: '5px 10px', borderRadius: 7 }}>{STATUS_LABEL[depStatus] ?? depStatus}</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#1a6b4d', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(deposit)}</span>
            </div>
          )}
        </section>

        {/* TWO-COLUMN BODY */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.62fr 1fr', gap: 16, alignItems: 'start' }}>

          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* PAYMENTS CARD */}
            <section style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 18px', borderBottom: '1px solid #eef1ec' }}>
                <span style={{ ...cardHeadIcon, background: '#eef6f1', color: '#1a7a4f' }}><CreditCard size={17} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Payments</div>
                  <div style={{ fontSize: 11.5, color: '#9aa39c' }}>Rent &amp; sub-lease instalments</div>
                </div>
                {perms.collections && (
                  <button onClick={() => setModal('record')} style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: '#1a7a4f', background: '#e7f3ec', border: '1px solid #cce6d8', padding: '8px 13px', borderRadius: 9, cursor: 'pointer' }}>+ Record payment</button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 130px 100px 156px', padding: '11px 18px 9px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: '#9aa39c' }}>
                <span>#</span><span>DESCRIPTION</span><span>AMOUNT</span><span>DUE</span><span style={{ textAlign: 'right' }}>STATUS</span>
              </div>

              {payments.length === 0 && <div style={{ padding: '16px 18px', fontSize: 13, color: '#9aa39c' }}>No payments recorded yet.</div>}
              {payments.map(p => {
                const isDep = p.paymentType === 'security_deposit';
                const num = isDep ? '$' : String(++payCounter);
                const status = p.chequeStatus ?? (p.paidAt ? 'cleared' : 'pending');
                const editable = perms.collections && status !== 'cleared' && !isDep;
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 130px 100px 156px', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid #f1f3f0', fontSize: 13 }}>
                    <span style={{ color: '#aab2ab', fontWeight: 600 }}>{num}</span>
                    <span>
                      <span style={{ display: 'block', color: '#2b342e', fontWeight: 600 }}>{p.description ?? (isDep ? 'Security Deposit' : 'Payment')}</span>
                      <span style={{ display: 'block', fontSize: 10.5, color: '#a0a8a1', marginTop: 1 }}>{fmtMethod(p.paymentMethod)} · Ref {p.chequeNumber ?? '—'}</span>
                    </span>
                    <span style={{ fontWeight: 700, color: '#1d2823', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAed(p.amount)}
                      {p.vatAmount != null && p.vatAmount > 0 && <span style={{ display: 'block', fontSize: 10, fontWeight: 500, color: '#a0a8a1' }}>incl. {fmtAed(p.vatAmount)} VAT</span>}
                    </span>
                    <span style={{ color: '#6b756f', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(p.transactionDate)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }}>
                      {perms.collections
                        ? <StatusSelect value={status} busy={statusBusy === p.id} onChange={s => changeStatus(p.id, s)} />
                        : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: (STATUS_STYLE[status] ?? STATUS_STYLE.pending).color, background: (STATUS_STYLE[status] ?? STATUS_STYLE.pending).bg, padding: '5px 10px', borderRadius: 7 }}>{STATUS_LABEL[status] ?? status}</span>}
                      {editable && (
                        <button onClick={() => setModal({ kind: 'editPayment', payment: p })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '5px 10px', borderRadius: 7, cursor: 'pointer' }}><Pencil size={13} />Edit</button>
                      )}
                    </span>
                  </div>
                );
              })}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, padding: '14px 18px 18px' }}>
                {[
                  { label: 'Net rent', value: fmtAed(rentNet), bg: '#fbfcfb', border: '#e7ebe6', color: '#1d2823' },
                  { label: 'VAT', value: fmtAed(rentVat), bg: '#fbfcfb', border: '#e7ebe6', color: '#1d2823' },
                  { label: 'Total rent (incl. VAT)', value: fmtAed(rentGross), bg: '#eef6f1', border: '#cfe7da', color: '#1a6b4d' },
                ].map(t => (
                  <div key={t.label} style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 11, padding: '12px 13px' }}>
                    <div style={{ fontSize: 10.5, color: '#6b756f', fontWeight: 600 }}>{t.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: t.color, fontVariantNumeric: 'tabular-nums', marginTop: 5 }}>{t.value}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* FEES CARD */}
            <section style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 18px', borderBottom: '1px solid #eef1ec' }}>
                <span style={{ ...cardHeadIcon, background: '#f6f3ea', color: '#8a6d2e' }}><Settings size={17} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Fees</div>
                  <div style={{ fontSize: 11.5, color: '#9aa39c' }}>One-off charges, separate from rent</div>
                </div>
                {perms.collections && (
                  <button onClick={() => setModal('addFee')} style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '8px 13px', borderRadius: 9, cursor: 'pointer' }}>+ Add fee</button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 100px 200px', padding: '11px 18px 9px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: '#9aa39c' }}>
                <span>FEE</span><span>AMOUNT</span><span>DUE</span><span style={{ textAlign: 'right' }}>STATUS</span>
              </div>

              {feeItems.length === 0 && <div style={{ padding: '16px 18px', fontSize: 13, color: '#9aa39c' }}>No fees recorded.</div>}
              {feeItems.map(f => {
                const status = f.chequeStatus ?? (f.paidAt ? 'cleared' : 'pending');
                return (
                  <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 100px 200px', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid #f1f3f0', fontSize: 13 }}>
                    <span style={{ color: '#2b342e', fontWeight: 600 }}>{f.description ?? FEE_LABEL[f.paymentType ?? ''] ?? 'Fee'}</span>
                    <span style={{ fontWeight: 700, color: '#1d2823', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAed(f.amount)}
                      {f.vatAmount != null && f.vatAmount > 0 && <span style={{ display: 'block', fontSize: 10, fontWeight: 500, color: '#a0a8a1' }}>incl. {fmtAed(f.vatAmount)} VAT</span>}
                    </span>
                    <span style={{ color: '#6b756f', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(f.transactionDate)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }}>
                      {perms.collections
                        ? <StatusSelect value={status} busy={statusBusy === f.id} onChange={s => changeStatus(f.id, s)} />
                        : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: (STATUS_STYLE[status] ?? STATUS_STYLE.pending).color, background: (STATUS_STYLE[status] ?? STATUS_STYLE.pending).bg, padding: '5px 10px', borderRadius: 7 }}>{STATUS_LABEL[status] ?? status}</span>}
                      {perms.collections && status !== 'cleared' && (
                        <button onClick={() => setModal({ kind: 'editFee', fee: f })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '5px 10px', borderRadius: 7, cursor: 'pointer' }}><Pencil size={13} />Edit</button>
                      )}
                      {perms.collections && (
                        <button onClick={() => deleteFee(f.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, color: '#c44536', background: '#fff', border: '1px solid #f0d8d3', padding: '5px 10px', borderRadius: 7, cursor: 'pointer' }}><Trash2 size={12} />Delete</button>
                      )}
                    </span>
                  </div>
                );
              })}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 18px 16px', padding: '12px 16px', background: '#eef6f1', borderRadius: 11 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1a6b4d' }}>Total fees</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: '#1a6b4d', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(feesGross)}</span>
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN: DOCUMENTS */}
          <section style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 18px', borderBottom: '1px solid #eef1ec' }}>
              <span style={{ ...cardHeadIcon, background: '#eef6f1', color: '#1a7a4f' }}><FileText size={17} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Documents <span style={{ color: '#9aa39c', fontWeight: 600 }}>({checklist.length})</span></div>
                <div style={{ fontSize: 11.5, color: '#9aa39c' }}>{setLabel} · {onFileCount} of {checklist.length} on file</div>
              </div>
              {viewAllDocs.length > 0 && (
                <button onClick={() => openDocsTogether(viewAllDocs)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '7px 11px', borderRadius: 9, cursor: 'pointer' }}><Eye size={13} /> View all</button>
              )}
              {perms.documents && (
                <button onClick={() => triggerUpload({ key: 'document', label: 'Document', category: 'contract' })} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '7px 11px', borderRadius: 9, cursor: 'pointer' }}><UploadCloud size={13} /> Upload</button>
              )}
              {perms.documents && (
                <button onClick={() => { const l = window.prompt('What document do you want to request from the customer?'); if (l && l.trim()) onRequestDoc(l.trim()); }} style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '7px 11px', borderRadius: 9, cursor: 'pointer' }}>Request</button>
              )}
            </div>

            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {checklist.map(req => {
                  const onFile = isDocKeySatisfied(req.key, docKeys);
                  const doc = findDoc(req.key);
                  const optional = !req.required;
                  return (
                    <div key={req.key} style={{
                      display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 10,
                      border: `1px solid ${onFile ? '#e7ebe6' : '#ecd9b6'}`, background: onFile ? '#fff' : '#fdf8ee',
                    }}>
                      <span style={{ width: 28, height: 28, flex: '0 0 28px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: onFile ? '#eef6f1' : '#f7ecd4', color: onFile ? '#1a7a4f' : '#c08a2a' }}><FileText size={15} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#2b342e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.label}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: onFile ? '#1a7a4f' : '#c08a2a' }}>{onFile ? 'On file' : `Not on file${optional ? ' — optional' : ' — required'}`}</div>
                      </div>
                      {onFile ? (
                        <>
                          <button onClick={() => doc && openDocViewer({ fileUrl: doc.fileUrl, caption: req.label }, req.label)} style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', flex: '0 0 auto' }}>View</button>
                          {perms.documents && <button onClick={() => triggerUpload({ key: req.key, label: req.label, category: req.category })} style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', flex: '0 0 auto' }}>Replace</button>}
                        </>
                      ) : (
                        <>
                          {perms.documents && <button onClick={() => triggerUpload({ key: req.key, label: req.label, category: req.category })} style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: '#b07415', background: '#fff', border: '1px solid #e2e7e1', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', flex: '0 0 auto' }}>Upload</button>}
                          {perms.documents && <button onClick={() => onRequestDoc(req.label)} style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', flex: '0 0 auto' }}>Request</button>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {c.tenant.id != null && (
                <p style={{ margin: '10px 4px 0' }}>
                  <button type="button" onClick={() => setShowDocsHistory(true)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12, fontWeight: 600, color: '#1a7a4f', cursor: 'pointer', textDecoration: 'underline' }}>Document History</button>
                </p>
              )}

              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: '#9aa39c', margin: '16px 4px 9px' }}>PAYMENT RECEIPTS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { name: 'Contract Payment Receipt', sub: 'Admin, Ejari, commission & rent instalments', href: `${receiptBase}?kind=contract` },
                  { name: 'Security Deposit Receipt', sub: 'Refundable security deposit', href: `${receiptBase}?kind=deposit` },
                ].map(r => (
                  <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', border: '1px solid #e7ebe6', borderRadius: 10 }}>
                    <span style={{ width: 28, height: 28, flex: '0 0 28px', borderRadius: 8, background: '#eef6f1', color: '#1a7a4f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🧾</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#2b342e' }}>{r.name}</div>
                      <div style={{ fontSize: 10.5, color: '#8a938c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div>
                    </div>
                    <a href={r.href} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '5px 11px', borderRadius: 7, cursor: 'pointer' }}>View</a>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* MODALS */}
      {modal === 'record' && <RecordPaymentModal onClose={() => setModal(null)} onSubmit={onRecordPayment} />}
      {modal === 'addFee' && <AddFeeModal onClose={() => setModal(null)} onSubmit={onRecordPayment} />}
      {modal === 'terminate' && <TerminateModal contract={c} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'renew' && <RenewalModal contract={c} onClose={() => setModal(null)} onDone={reload} />}
      {modal && typeof modal === 'object' && modal.kind === 'editPayment' && (
        <EditPaymentModal payment={modal.payment} vatRate={c.rentVatRate} onClose={() => setModal(null)} onSubmit={patch => onUpdatePayment(modal.payment.id, patch)} />
      )}
      {modal && typeof modal === 'object' && modal.kind === 'editFee' && (
        <FeeEditModal fee={modal.fee} onClose={() => setModal(null)} onSubmit={patch => onUpdatePayment(modal.fee.id, patch)} />
      )}
      {/* Cross-lease document history — same popup module as v2, no navigation away. */}
      {showDocsHistory && c.tenant.id != null && (
        <CustomerDocsModal tenantId={c.tenant.id} tenantName={c.tenant.name} onClose={() => setShowDocsHistory(false)} />
      )}
    </div>
  );
}
