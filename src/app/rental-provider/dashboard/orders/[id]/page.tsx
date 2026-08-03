'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, FileText, User, Home, Building2, Calendar, CreditCard,
  RefreshCw, CheckCircle2, Clock, AlertTriangle, XCircle, RotateCcw,
  Hash, Layers, BedDouble, Bath, Maximize2, Phone, Mail, Shield,
  ChevronRight, FileCheck, Banknote, Lock, Download, Receipt,
} from 'lucide-react';
import { openDocViewer } from '@/lib/docViewer';
import { chequeStatusDisplay } from '@/lib/chequeStatusDisplay';

/* ── Types ────────────────────────────────────────────────────────────── */
interface Payment {
  id: number;
  description: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  amount: number;
  charges: number;
  chequeNumber: string | null;
  chequeStatus: string;
  /** Server-derived display status — a made-good bounce reads 'cleared' (money
   *  banked) or 'replaced' (its new cheque still pending). */
  effectiveStatus?: string | null;
  payerName: string | null;
  transactionDate: string | null;
  createdAt: string;
}

interface SecurityDeposit {
  id: number;
  referenceNumber: string | null;
  checkNumber: string | null;
  nameOnCheck: string | null;
  amountOnCheck: number | null;
  nameOnReceipt: string | null;
  amountOnReceipt: number | null;
  receiptChequeNumber: string | null;
  depositStatus: string;
  documentStatus: string;
  fromYear: number | null;
  toYear: number | null;
  recordedDate: string | null;
  notes: string | null;
}

interface ContractDetail {
  id: number;
  ref: string;
  contractType: string | null;
  status: string;
  ejariStatus: string;
  contractActive: boolean;
  contractSent: boolean;
  startDate: string;
  endDate: string;
  durationYears: number | null;
  annualRent: number;
  contractValue: number | null;
  listedRent: number | null;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  discountAmount: number | null;
  securityDepositAmount: number | null;
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  refundRules: string | null;
  partiesInvolved: string | null;
  /** ⚠️ MIRRORED from the parent on a renewal child — these describe the renewal
   *  that CREATED this lease, not a renewal of it. Use `ownRenewal*` to ask
   *  whether THIS lease has a renewal running. */
  renewalAccepted: string | null;
  renewalStatus: string | null;
  /** This row's own markers, never mirrored. */
  ownRenewalAccepted?: string | null;
  ownRenewalStatus?: string | null;
  renewalSignedDate: string | null;
  renewalNoticeId: string | null;
  renderedContent: string | null;
  createdAt: string;
  updatedAt: string;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null };
  unit: { id: number | null; number: string | null; name: string | null; type: string | null; floor: string | null; sizeSqft: number | null; sizeSqm: number | null; bedrooms: number | null; bathrooms: number | null };
  property: { id: number | null; buildingName: string | null; fullAddress: string | null; numberOfFloors: string | null; makaniNumber: string | null; plotNumber: string | null; community: string | null; emirate: string | null };
  payments: Payment[];
  securityDeposits: SecurityDeposit[];
  documents: ContractDocument[];
}

interface ContractDocument {
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
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function fmt(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtAed(n: number | null) {
  if (n == null) return '—';
  return `AED ${n.toLocaleString('en-AE')}`;
}
function humanize(s: string | null) {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  active:     { label: 'Active',     bg: '#dbeafe', text: '#1e40af', icon: <CheckCircle2 size={14} /> },
  expired:    { label: 'Expired',    bg: '#e5e7eb', text: '#374151', icon: <Clock size={14} /> },
  terminated: { label: 'Terminated', bg: '#fee2e2', text: '#b91c1c', icon: <XCircle size={14} /> },
  pending:    { label: 'Pending',    bg: '#fef3c7', text: '#92400e', icon: <AlertTriangle size={14} /> },
  issued:     { label: 'Issued',     bg: '#d8f2e8', text: '#1a7a5a', icon: <FileCheck size={14} /> },
};

const EJARI_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  registered:     { label: 'Registered',     bg: '#d8f2e8', text: '#1a7a5a' },
  pending:        { label: 'Pending',         bg: '#fef3c7', text: '#92400e' },
  not_registered: { label: 'Not Registered', bg: '#fee2e2', text: '#b91c1c' },
  expired:        { label: 'Expired',         bg: '#e5e7eb', text: '#374151' },
};

const RENEWAL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  accepted: { label: 'Accepted', bg: '#d8f2e8', text: '#1a7a5a' },
  rejected: { label: 'Rejected', bg: '#fee2e2', text: '#b91c1c' },
  pending:  { label: 'Pending',  bg: '#fef3c7', text: '#92400e' },
};

/* ── Section wrapper ──────────────────────────────────────────────────── */
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-5">
      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-[#e8e6e0]">
        <span style={{ color: '#2e9f82' }}>{icon}</span>
        <h2 className="font-semibold text-[#1a1916] text-base">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-[#f4f3ef] last:border-0">
      <span className="text-sm text-[#6b6860] flex-shrink-0 mr-6">{label}</span>
      <span className={`text-sm font-medium text-[#1a1916] text-right ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/contracts/${id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setContract)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <RefreshCw size={28} className="text-[#2e9f82] animate-spin mb-3" />
        <p className="text-sm text-[#6b6860]">Loading contract…</p>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <XCircle size={32} className="text-red-400 mb-3" />
        <p className="text-sm text-[#6b6860]">Contract not found.</p>
        <Link href="/rental-provider/dashboard/orders" className="mt-4 text-sm text-[#2e9f82] hover:underline">
          ← Back to orders
        </Link>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[contract.status] ?? { label: humanize(contract.status), bg: '#f4f3ef', text: '#6b6860', icon: null };
  const ejariCfg = EJARI_CONFIG[contract.ejariStatus] ?? { label: humanize(contract.ejariStatus), bg: '#f4f3ef', text: '#6b6860' };
  // This section reports the renewal OF this lease, so it reads the row's own
  // markers. The top-level ones are mirrored from the parent on a renewal child,
  // which made every renewed lease report "Accepted / renewal complete" for a
  // renewal that had never been proposed on it.
  const ownRenewalStatus = contract.ownRenewalStatus !== undefined ? contract.ownRenewalStatus : contract.renewalStatus;
  const ownRenewalAccepted = contract.ownRenewalAccepted !== undefined ? contract.ownRenewalAccepted : contract.renewalAccepted;
  const renewalCfg = ownRenewalAccepted ? (RENEWAL_CONFIG[ownRenewalAccepted] ?? null) : null;

  const now = new Date();
  const endDate = new Date(contract.endDate);
  const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / 86400000);
  const isExpiringSoon = contract.status === 'active' && daysLeft > 0 && daysLeft <= 60;

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Back */}
      <Link
        href="/rental-provider/dashboard/orders"
        className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#2e9f82] mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Rental Orders
      </Link>

      {/* Header */}
      <div className="flex flex-wrap gap-4 items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-[#1a1916]">{contract.ref}</h1>
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
              style={{ backgroundColor: statusCfg.bg, color: statusCfg.text }}
            >
              {statusCfg.icon} {statusCfg.label}
            </span>
            {contract.contractType && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#e8e6e0] text-[#3d3b35]">
                {humanize(contract.contractType)}
              </span>
            )}
          </div>
          <p className="text-sm text-[#6b6860]">
            Created {fmt(contract.createdAt)} · Last updated {fmt(contract.updatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          {contract.renderedContent && (
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e8e6e0] text-sm text-[#3d3b35] hover:bg-[#f4f3ef] transition-colors">
              <Download size={14} /> Download PDF
            </button>
          )}
        </div>
      </div>

      {/* Expiry warning */}
      {isExpiringSoon && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-5">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800 font-medium">
            This contract expires in <strong>{daysLeft} days</strong> ({fmt(contract.endDate)}). Initiate renewal to avoid a gap.
          </p>
        </div>
      )}

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Annual Rent', value: fmtAed(contract.annualRent) },
          { label: 'Security Deposit', value: fmtAed(contract.securityDepositAmount) },
          { label: 'Installments', value: contract.numberOfInstallments ? `${contract.numberOfInstallments} cheques` : '—' },
          { label: 'Duration', value: contract.durationYears ? `${contract.durationYears} year${contract.durationYears > 1 ? 's' : ''}` : '—' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-[#6b6860] mb-1">{s.label}</p>
            <p className="font-bold text-[#1a1916] text-base leading-tight">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Contract Dates & Terms */}
      <Section title="Contract Terms" icon={<FileText size={18} />}>
        <Row label="Start Date" value={fmt(contract.startDate)} />
        <Row label="End Date" value={
          <span className={isExpiringSoon ? 'text-amber-600 font-semibold' : ''}>
            {fmt(contract.endDate)}{isExpiringSoon ? ` (${daysLeft}d left)` : ''}
          </span>
        } />
        <Row label="Duration" value={contract.durationYears ? `${contract.durationYears} year${contract.durationYears > 1 ? 's' : ''}` : null} />
        <Row label="Contract Type" value={humanize(contract.contractType)} />
        <Row label="Payment Method" value={humanize(contract.modeOfPayment)} />
        <Row label="No. of Installments" value={contract.numberOfInstallments ?? null} />
        {!!contract.discountAmount && contract.discountAmount > 0 && (
          <>
            <Row label="Listed Rent" value={fmtAed(contract.listedRent)} />
            <Row label="Discount" value={
              <span className="text-[#b91c1c] font-medium">
                − {fmtAed(contract.discountAmount)}
                {contract.discountType === 'percent' && contract.discountValue ? ` (${contract.discountValue}%)` : ''}
              </span>
            } />
          </>
        )}
        <Row label={contract.discountAmount && contract.discountAmount > 0 ? 'Annual Rent (net)' : 'Annual Rent'} value={fmtAed(contract.annualRent)} />
        <Row label="Contract Value" value={fmtAed(contract.contractValue)} />
        <Row label="Security Deposit" value={fmtAed(contract.securityDepositAmount)} />
        {contract.refundRules && <Row label="Refund Rules" value={contract.refundRules} />}
        {contract.partiesInvolved && <Row label="Parties Involved" value={contract.partiesInvolved} />}
        <Row label="Contract Sent" value={
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${contract.contractSent ? 'bg-[#d8f2e8] text-[#1a7a5a]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
            {contract.contractSent ? <><CheckCircle2 size={11} /> Sent</> : <><Clock size={11} /> Not sent</>}
          </span>
        } />
      </Section>

      {/* Ejari */}
      <Section title="Contract Registration" icon={<Shield size={18} />}>
        <Row label="Contract Registration Status" value={
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={{ backgroundColor: ejariCfg.bg, color: ejariCfg.text }}>
            {ejariCfg.label}
          </span>
        } />
        <Row label="Contract Active" value={
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${contract.contractActive ? 'bg-[#d8f2e8] text-[#1a7a5a]' : 'bg-[#e5e7eb] text-[#374151]'}`}>
            {contract.contractActive ? <><CheckCircle2 size={11} /> Active</> : <>Inactive</>}
          </span>
        } />
      </Section>

      {/* Renewal */}
      <Section title="Renewal Process" icon={<RotateCcw size={18} />}>
        <Row label="Renewal Status" value={
          ownRenewalStatus
            ? <span className="text-sm text-[#1a1916]">{humanize(ownRenewalStatus)}</span>
            : <span className="text-sm text-[#9b9890]">No renewal initiated</span>
        } />
        <Row label="Customer Decision" value={
          renewalCfg
            ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
                style={{ backgroundColor: renewalCfg.bg, color: renewalCfg.text }}>
                {renewalCfg.label}
              </span>
            : null
        } />
        <Row label="Renewal Signed" value={fmt(contract.renewalSignedDate)} />
        {contract.renewalNoticeId && <Row label="Renewal Notice ID" value={contract.renewalNoticeId} mono />}

        {contract.status === 'active' && !ownRenewalStatus && (
          <div className="mt-4 pt-4 border-t border-[#f4f3ef]">
            <button
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#2e9f82' }}
            >
              Initiate Renewal Process
            </button>
            <p className="text-xs text-center text-[#9b9890] mt-2">
              A renewal notice will be sent to the customer via email & SMS.
            </p>
          </div>
        )}
      </Section>

      {/* Tenant */}
      <Section title="Customer Information" icon={<User size={18} />}>
        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-[#f4f3ef]">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #2e9f82, #1f6655)' }}>
            {(contract.tenant.name ?? 'T').charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-[#1a1916]">{contract.tenant.name ?? '—'}</p>
            <p className="text-sm text-[#6b6860]">Customer ID #{contract.tenant.id}</p>
          </div>
        </div>
        {contract.tenant.email && (
          <Row label="Email" value={
            <a href={`mailto:${contract.tenant.email}`} className="text-[#2e9f82] hover:underline inline-flex items-center gap-1">
              <Mail size={12} /> {contract.tenant.email}
            </a>
          } />
        )}
        {contract.tenant.phone && (
          <Row label="Phone" value={
            <a href={`tel:${contract.tenant.phone}`} className="text-[#2e9f82] hover:underline inline-flex items-center gap-1">
              <Phone size={12} /> {contract.tenant.phone}
            </a>
          } />
        )}
        {!contract.tenant.email && !contract.tenant.phone && (
          <p className="text-sm text-[#9b9890]">No contact details available.</p>
        )}
      </Section>

      {/* Unit & Property */}
      <Section title="Unit & Property" icon={<Home size={18} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Unit */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#9b9890] mb-3">Unit</p>
            <Row label="Unit No." value={contract.unit.number} />
            {contract.unit.name && <Row label="Name" value={contract.unit.name} />}
            {contract.unit.type && <Row label="Type" value={humanize(contract.unit.type)} />}
            {contract.unit.floor && <Row label="Floor" value={contract.unit.floor} />}
            {contract.unit.bedrooms != null && <Row label="Bedrooms" value={String(contract.unit.bedrooms)} />}
            {contract.unit.bathrooms != null && <Row label="Bathrooms" value={String(contract.unit.bathrooms)} />}
            {contract.unit.sizeSqft != null && <Row label="Size" value={`${contract.unit.sizeSqft.toLocaleString('en-AE')} sqft`} />}
            {contract.unit.sizeSqm != null && <Row label="Size (sqm)" value={`${contract.unit.sizeSqm.toLocaleString('en-AE')} sqm`} />}
          </div>
          {/* Property */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#9b9890] mb-3">Property</p>
            <Row label="Building" value={contract.property.buildingName} />
            {contract.property.fullAddress && <Row label="Address" value={contract.property.fullAddress} />}
            {contract.property.community && <Row label="Community" value={contract.property.community} />}
            {contract.property.emirate && <Row label="Emirate" value={contract.property.emirate} />}
            {contract.property.numberOfFloors && <Row label="Floors" value={contract.property.numberOfFloors} />}
            {contract.property.makaniNumber && <Row label="Makani No." value={contract.property.makaniNumber} mono />}
            {contract.property.plotNumber && <Row label="Plot No." value={contract.property.plotNumber} mono />}
          </div>
        </div>
      </Section>

      {/* Contract Content */}
      {contract.renderedContent && (
        <Section title="Contract Document" icon={<FileText size={18} />}>
          <div className="bg-[#f9f8f5] border border-[#e8e6e0] rounded-xl p-5 max-h-[400px] overflow-y-auto">
            <pre className="text-xs text-[#3d3b35] whitespace-pre-wrap font-mono leading-relaxed">
              {contract.renderedContent}
            </pre>
          </div>
          <button className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e8e6e0] text-sm text-[#3d3b35] hover:bg-[#f4f3ef] transition-colors">
            <Download size={14} /> Download PDF
          </button>
        </Section>
      )}

      {/* Security Deposit */}
      {contract.securityDeposits.length > 0 && (
        <Section title="Security Deposit" icon={<Lock size={18} />}>
          {contract.securityDeposits.map((dep) => (
            <div key={dep.id} className="mb-4 last:mb-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-[#9b9890] uppercase tracking-wide">{dep.referenceNumber ?? `Deposit #${dep.id}`}</span>
                <div className="flex gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${dep.depositStatus === 'held' ? 'bg-[#dbeafe] text-[#1e40af]' : dep.depositStatus === 'returned' ? 'bg-[#d8f2e8] text-[#1a7a5a]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
                    {dep.depositStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]`}>
                    {dep.documentStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                </div>
              </div>
              <Row label="Amount (Cheque)" value={dep.amountOnCheck != null ? `AED ${dep.amountOnCheck.toLocaleString('en-AE')}` : null} />
              <Row label="Name on Cheque" value={dep.nameOnCheck} />
              <Row label="Cheque Number" value={dep.checkNumber} mono />
              {dep.amountOnReceipt != null && <Row label="Amount (Receipt)" value={`AED ${dep.amountOnReceipt.toLocaleString('en-AE')}`} />}
              {dep.nameOnReceipt && <Row label="Name on Receipt" value={dep.nameOnReceipt} />}
              {dep.receiptChequeNumber && <Row label="Receipt Cheque No." value={dep.receiptChequeNumber} mono />}
              <Row label="Period" value={dep.fromYear && dep.toYear ? `${dep.fromYear} – ${dep.toYear}` : null} />
              <Row label="Recorded Date" value={fmt(dep.recordedDate)} />
              {contract.refundRules && <Row label="Refund Rules" value={contract.refundRules} />}
            </div>
          ))}
        </Section>
      )}

      {/* Payments / Installments */}
      {contract.payments.length > 0 && (
        <Section title={`Payment Schedule (${contract.payments.length} instalment${contract.payments.length !== 1 ? 's' : ''})`} icon={<Banknote size={18} />}>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-xs text-[#9b9890] uppercase border-b border-[#f4f3ef]">
                  <th className="px-2 py-2 font-medium">Description</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Method</th>
                  <th className="px-2 py-2 font-medium">Cheque No.</th>
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {contract.payments.map((p) => (
                  <tr key={p.id} className="border-b border-[#f4f3ef] last:border-0 hover:bg-[#f9f8f5]">
                    <td className="px-2 py-3 text-[#1a1916]">{p.description ?? '—'}</td>
                    <td className="px-2 py-3 font-medium text-[#1a1916]">AED {p.amount.toLocaleString('en-AE')}</td>
                    <td className="px-2 py-3 text-[#6b6860] capitalize">{p.paymentMethod?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="px-2 py-3 font-mono text-xs text-[#6b6860]">{p.chequeNumber ?? '—'}</td>
                    <td className="px-2 py-3 text-[#6b6860] whitespace-nowrap">{fmt(p.transactionDate)}</td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2">
                      {/* A bounce already made good stays red and stays named a
                          bounce — "Bounced · Replaced". It is no longer chased
                          for money, but it did happen, and reading it as
                          Cleared made it look like a cheque that never failed. */}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        chequeStatusDisplay(p).tone === 'cleared' ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                        chequeStatusDisplay(p).tone === 'bounced' ? 'bg-[#fee2e2] text-[#b91c1c]' :
                        chequeStatusDisplay(p).tone === 'cancelled' ? 'bg-[#e5e7eb] text-[#374151]' :
                        'bg-[#fef3c7] text-[#92400e]'
                      }`}>
                        {chequeStatusDisplay(p).label}
                      </span>
                      {(p.chequeStatus === 'cleared' || p.paymentMethod === 'cash') && (
                        <button
                          title="Issue Receipt"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-[#2e9f82] text-[#2e9f82] text-xs font-semibold hover:bg-[#f4f3ef] transition-colors"
                        >
                          <Receipt size={11} /> Receipt
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 pt-4 border-t border-[#f4f3ef] flex justify-between text-sm">
            <span className="text-[#6b6860]">Total Paid</span>
            <span className="font-bold text-[#1a1916]">
              AED {contract.payments.filter(p => p.chequeStatus === 'cleared').reduce((s, p) => s + p.amount, 0).toLocaleString('en-AE')}
            </span>
          </div>
        </Section>
      )}

      {/* Attachments & Documents */}
      <Section title="Attachments & Documents" icon={<FileCheck size={18} />}>
        {contract.documents.length > 0 ? (
          <div className="space-y-2">
            {contract.documents.map(doc => (
              <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl bg-[#f9f8f5] border border-[#e8e6e0]">
                <div className="flex items-center gap-3">
                  <FileText size={16} className="text-[#2e9f82] flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-[#1a1916]">{doc.displayName ?? doc.documentKey}</p>
                    <p className="text-xs text-[#9b9890] capitalize">{doc.category.replace(/_/g, ' ')} &middot; {doc.ownerType.replace(/_/g, ' ')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    doc.status === 'complete' ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                    doc.status === 'pending' ? 'bg-[#fef3c7] text-[#92400e]' :
                    doc.status === 'missing' ? 'bg-[#fee2e2] text-[#b91c1c]' :
                    'bg-[#f4f3ef] text-[#6b6860]'
                  }`}>
                    {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                  </span>
                  {doc.fileUrl && (
                    <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.displayName ?? doc.documentKey })}
                      className="p-1.5 rounded-lg hover:bg-[#e8e6e0] transition-colors cursor-pointer">
                      <Download size={13} className="text-[#6b6860]" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#f4f3ef] flex items-center justify-center mb-3">
              <FileText size={20} className="text-[#9b9890]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">No documents available</p>
            <p className="text-xs text-[#9b9890]">Documents will appear here once they are uploaded.</p>
          </div>
        )}
      </Section>
    </div>
  );
}
