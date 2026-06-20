/**
 * PaymentReceipt — a proper, accounting-grade payment receipt document.
 *
 * Shared by the RP/manager receipt route (/api/contracts/:id) and the customer
 * receipt route (/api/contracts/tenant/:id). Both endpoints return a compatible
 * shape, so each route just fetches and hands the contract object in here.
 *
 * Three render modes, chosen by props:
 *   • kind="deposit"  → "Security Deposit Receipt" (the security_deposit payment,
 *                        or synthesised from contract.securityDepositAmount).
 *   • kind="contract" → consolidated "Contract Payment Receipt": every non-deposit
 *                        payment, itemised as Administration Fee / Ejari / Commission
 *                        / Rent (+VAT), with the full cheque schedule beneath.
 *   • default (pid)   → one payment: rent instalment (instalment #1 itemises the
 *                        bundled Admin + Ejari fees) or a single fee.
 *
 * Select a single payment by `selectedId` (payment id, order-safe) or
 * `selectedIdx` (legacy ?p= index). `kind` overrides both.
 *
 * IMPORTANT (money units): contract-level adminFeeFils / ejariFeeFils are a
 * misnomer — they store WHOLE AED, not fils. Do NOT divide by 100. Payment
 * `amount` is gross (VAT included); net = amount − vatAmount. annualRent is NET.
 * Commission isn't stored on the contract; it's derived as the residual of the
 * collected payments (sumNet − admin − ejari − annualRent).
 */
'use client';

import React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ReceiptPayment {
  id: number;
  paymentType: string | null;
  description: string | null;
  amount: number;        // gross (VAT included)
  vatAmount?: number;    // VAT portion already inside `amount`
  chequeNumber: string | null;
  chequeStatus: string | null;
  paymentMethod?: string | null;
  transactionDate: string | null;
}

export interface ReceiptContract {
  id: number;
  ref: string;
  contractType?: string | null;
  startDate: string;
  endDate: string;
  annualRent?: number;             // NET annual rent
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  pdcConfirmed?: boolean;
  securityDepositAmount?: number | null;   // contract's own deposit column (often null on renewals)
  securityDepositHeld?: number | null;     // resolved held amount (own or carried down the renewal chain)
  securityDeposit?: {                      // resolved deposit entity (RP endpoint) — richer detail
    amount?: number | null;
    chequeNumber?: string | null;
    paymentMethod?: string | null;
    chequeStatus?: string | null;
    dueDate?: string | null;
    isCarried?: boolean;
    sourceContractId?: number | null;
  } | null;
  adminFeeFils?: number;   // WHOLE AED (misnomer) — first-bundle admin fee
  ejariFeeFils?: number;   // WHOLE AED (misnomer) — first-bundle ejari fee
  landlord: {
    name: string | null;
    companyName: string | null;
    phone?: string | null;
    email?: string | null;
    emiratesId?: string | null;
    licenseNumber?: string | null;
    licenseAuthority?: string | null;
  };
  tenant: { name: string | null; emiratesId?: string | null; phone?: string | null };
  unit: { number: string | null; name: string | null };
  property: { buildingName: string | null; community?: string | null; emirate?: string | null; fullAddress?: string | null };
  payments?: ReceiptPayment[];
}

interface Props {
  contract: ReceiptContract;
  selectedId?: number | null;
  selectedIdx?: number;
  kind?: 'deposit' | 'contract' | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getDate().toString().padStart(2, '0')}-${(dt.getMonth() + 1).toString().padStart(2, '0')}-${dt.getFullYear()}`;
}

/** Plain amount with 2dp + thousands separators (no currency prefix). */
function fmtAmt(v: number): string {
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(v: number): number {
  return Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
}

// Contract-level admin/ejari fee columns are stored INCONSISTENTLY across the
// data: some rows hold whole AED (e.g. 1000), others hold fils (e.g. 100000) for
// the SAME real fee. We can't trust the column unit, so normalise against the
// actual bundled fees+commission (`referenceExtras`), which is derived from the
// real payment amounts (always AED): if admin+ejari can't fit inside it, the
// values must be in fils → divide by 100. See project_money_units / receipts memo.
function normalizeFees(adminCol: number, ejariCol: number, referenceExtras: number): { admin: number; ejari: number } {
  let admin = adminCol || 0;
  let ejari = ejariCol || 0;
  if (admin + ejari > referenceExtras + 1) { admin = round2(admin / 100); ejari = round2(ejari / 100); }
  return { admin, ejari };
}

function numWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n === 0) return 'Zero';
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
  if (n < 1_000_000) return numWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numWords(n % 1000) : '');
  return numWords(Math.floor(n / 1_000_000)) + ' Million' + (n % 1_000_000 ? ' ' + numWords(n % 1_000_000) : '');
}

/** "Twelve Thousand Five Hundred Dirhams Only" (+ "and 50/100 Fils" if any). */
function amountInWords(v: number): string {
  const whole = Math.floor(v);
  const fils = Math.round((v - whole) * 100);
  const head = `${numWords(whole)} Dirham${whole === 1 ? '' : 's'}`;
  return fils > 0 ? `${head} and ${fils}/100 Fils Only` : `${head} Only`;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

function methodLabel(p: ReceiptPayment, contract: ReceiptContract): string {
  if (p.paymentMethod) return titleCase(p.paymentMethod);
  if (p.chequeNumber) return 'Cheque';
  return titleCase(contract.modeOfPayment) || 'Bank Transfer';
}

interface StatusInfo { label: string; bg: string; fg: string; }
function statusInfoFor(chequeStatus: string | null | undefined, pdcConfirmed?: boolean): StatusInfo {
  switch ((chequeStatus ?? '').toLowerCase()) {
    case 'cleared':   return { label: 'Cleared',       bg: '#dcfce7', fg: '#166534' };
    case 'bounced':   return { label: 'Bounced',       bg: '#fee2e2', fg: '#b91c1c' };
    case 'cancelled': return { label: 'Cancelled',     bg: '#e5e7eb', fg: '#374151' };
    default:
      return pdcConfirmed
        ? { label: 'Collected (PDC)', bg: '#dbeafe', fg: '#1e40af' }
        : { label: 'Pending',         bg: '#fef3c7', fg: '#92400e' };
  }
}

// Rent line items exclude the standalone security deposit. Admin-fee rows (rare)
// are also excluded so the rent ordinal counts only true instalments.
function isRental(p: ReceiptPayment): boolean {
  const t = (p.paymentType ?? '').toLowerCase();
  return t !== 'security_deposit' && t !== 'admin_fee';
}
function isDeposit(p: ReceiptPayment): boolean {
  return (p.paymentType ?? '').toLowerCase() === 'security_deposit';
}

interface LineItem { desc: string; net: number; vat: number; total: number; }
interface Receipt {
  kind: 'deposit' | 'rent' | 'fee' | 'contract';
  title: string;
  titleAr: string;
  receiptNo: string;
  date: string | null;
  lines: LineItem[];
  single?: ReceiptPayment;       // single-payment receipts → payment-details block
  schedule?: ReceiptPayment[];   // consolidated receipt → cheque schedule table
}

function buildSingleReceipt(sel: ReceiptPayment, contract: ReceiptContract, rentals: ReceiptPayment[]): Receipt {
  const type = (sel.paymentType ?? '').toLowerCase();
  const gross = sel.amount || 0;
  const vat = sel.vatAmount || 0;
  const net = Math.max(0, gross - vat);

  if (type === 'security_deposit') {
    return {
      kind: 'deposit', title: 'SECURITY DEPOSIT RECEIPT', titleAr: 'إيصال استلام التأمين',
      receiptNo: `RCP-${contract.ref}-DEP`, date: sel.transactionDate, single: sel,
      lines: [{ desc: 'Refundable Security Deposit', net: gross, vat: 0, total: gross }],
    };
  }
  if (type === 'admin_fee') {
    return {
      kind: 'fee', title: 'FEE RECEIPT', titleAr: 'إيصال رسوم',
      receiptNo: `RCP-${contract.ref}-ADM`, date: sel.transactionDate, single: sel,
      lines: [{ desc: sel.description || 'Administration Fee', net, vat, total: gross }],
    };
  }

  const rentalIdx = rentals.findIndex(p => p.id === sel.id);
  const ordinal = rentalIdx >= 0 ? rentalIdx + 1 : 1;
  const n = contract.numberOfInstallments ?? rentals.length ?? 1;
  // Fees bundled into THIS payment = its net minus a plain rent instalment.
  const perInstallmentNet = n > 0 ? round2((contract.annualRent ?? 0) / n) : (contract.annualRent ?? 0);
  const extras = round2(net - perInstallmentNet);
  const { admin, ejari } = normalizeFees(contract.adminFeeFils ?? 0, contract.ejariFeeFils ?? 0, extras);
  const isFirstBundle = rentalIdx === 0 && extras >= 1 && admin + ejari > 0;

  const lines: LineItem[] = [];
  if (isFirstBundle) {
    if (admin > 0) lines.push({ desc: 'Administration Fee', net: admin, vat: 0, total: admin });
    if (ejari > 0) lines.push({ desc: 'Ejari Registration Fee', net: ejari, vat: 0, total: ejari });
    const rentNet = Math.max(0, net - admin - ejari);
    lines.push({ desc: `Rent — Instalment ${ordinal} of ${n}`, net: rentNet, vat, total: rentNet + vat });
  } else {
    lines.push({ desc: `Rent — Instalment ${ordinal} of ${n}`, net, vat, total: gross });
  }

  return {
    kind: 'rent', title: 'RENT RECEIPT', titleAr: 'إيصال إيجار',
    receiptNo: `RCP-${contract.ref}-${String(ordinal).padStart(2, '0')}`, date: sel.transactionDate, single: sel,
    lines,
  };
}

// Consolidated receipt over every NON-deposit payment. Commission is the residual
// (sumNet − admin − ejari − annualRent) so the lines reconcile exactly to the
// total of all collected contract payments.
function buildContractReceipt(contract: ReceiptContract, payments: ReceiptPayment[]): Receipt | null {
  const nonDeposit = payments.filter(p => !isDeposit(p));
  if (nonDeposit.length === 0) return null;

  const sumGross = round2(nonDeposit.reduce((s, p) => s + (p.amount || 0), 0));
  const sumVat = round2(nonDeposit.reduce((s, p) => s + (p.vatAmount || 0), 0));
  const sumNet = round2(sumGross - sumVat);
  const annualRent = contract.annualRent ?? 0;
  // Total fees + commission actually collected = everything above the rent.
  const feesPlusComm = round2(sumNet - annualRent);
  const { admin, ejari } = normalizeFees(contract.adminFeeFils ?? 0, contract.ejariFeeFils ?? 0, feesPlusComm);
  // Commission isn't a stored field — derive it as the residual. Ignore sub-1-AED
  // residue (rounding drift in the cheque split), which would otherwise show a
  // bogus "Commission 0.01" line; any such remainder folds into the rent line.
  const commissionRaw = round2(feesPlusComm - admin - ejari);
  const commission = commissionRaw >= 1 ? commissionRaw : 0;
  const rentNet = Math.max(0, round2(sumNet - admin - ejari - commission));

  const lines: LineItem[] = [];
  if (admin > 0) lines.push({ desc: 'Administration Fee', net: admin, vat: 0, total: admin });
  if (ejari > 0) lines.push({ desc: 'Ejari Registration Fee', net: ejari, vat: 0, total: ejari });
  if (commission > 0) lines.push({ desc: 'Agency Commission', net: commission, vat: 0, total: commission });
  lines.push({ desc: 'Rent (full lease term)', net: rentNet, vat: sumVat, total: round2(rentNet + sumVat) });

  return {
    kind: 'contract', title: 'CONTRACT PAYMENT RECEIPT', titleAr: 'إيصال دفعات العقد',
    receiptNo: `RCP-${contract.ref}-PAY`, date: nonDeposit[0]?.transactionDate ?? null,
    lines, schedule: nonDeposit,
  };
}

// ─── Small presentational atoms ─────────────────────────────────────────────

const BRAND = '#1a3c6e';

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <span style={{ fontSize: 8.5, color: '#6b7280', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 9, color: '#111827', fontWeight: value ? 600 : 400 }}>{value || '—'}</span>
    </>
  );
}

const defGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '108px 1fr', rowGap: 5, columnGap: 8, alignItems: 'baseline' };
const card: React.CSSProperties = { border: '1px solid #d1d5db', borderRadius: 6, padding: '10px 12px' };
const cardTitle: React.CSSProperties = { fontSize: 8, fontWeight: 700, color: BRAND, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 };

// ─── Component ──────────────────────────────────────────────────────────────

export default function PaymentReceipt({ contract, selectedId, selectedIdx = 0, kind }: Props) {
  const payments = contract.payments ?? [];
  const rentals = payments.filter(isRental);

  // ── Resolve which receipt to render ──
  let receipt: Receipt | null = null;
  if (kind === 'contract') {
    receipt = buildContractReceipt(contract, payments);
  } else if (kind === 'deposit') {
    let dep = payments.find(isDeposit);
    if (!dep) {
      // The deposit is usually NOT a payment row — it's the resolved deposit
      // entity (own, or carried down a renewal chain). Prefer that, then the
      // resolved held amount, then the contract's own column.
      const sd = contract.securityDeposit;
      const amt = (sd?.amount ?? 0) > 0 ? Number(sd!.amount)
        : (contract.securityDepositHeld ?? 0) > 0 ? Number(contract.securityDepositHeld)
        : (contract.securityDepositAmount ?? 0) > 0 ? Number(contract.securityDepositAmount)
        : 0;
      if (amt > 0) {
        dep = {
          id: -1, paymentType: 'security_deposit', description: 'Security deposit',
          amount: amt, vatAmount: 0,
          chequeNumber: sd?.chequeNumber ?? null,
          chequeStatus: sd?.chequeStatus ?? (contract.pdcConfirmed ? 'cleared' : 'pending'),
          paymentMethod: sd?.paymentMethod ?? contract.modeOfPayment ?? null,
          transactionDate: sd?.dueDate ?? null,
        };
      }
    }
    if (dep) receipt = buildSingleReceipt(dep, contract, rentals);
  } else {
    let sel: ReceiptPayment | undefined;
    if (selectedId != null) sel = payments.find(p => p.id === selectedId);
    if (!sel) sel = payments[Math.min(Math.max(selectedIdx, 0), Math.max(payments.length - 1, 0))];
    if (sel) receipt = buildSingleReceipt(sel, contract, rentals);
  }

  if (!receipt) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
        {kind === 'deposit' ? 'No security deposit is recorded for this contract.' : 'No payment is available to receipt for this contract yet.'}
      </div>
    );
  }

  const subtotal = round2(receipt.lines.reduce((s, l) => s + l.net, 0));
  const totalVat = round2(receipt.lines.reduce((s, l) => s + l.vat, 0));
  const grandTotal = round2(receipt.lines.reduce((s, l) => s + l.total, 0));
  const showVat = totalVat > 0;

  const single = receipt.single;
  const status = statusInfoFor(single?.chequeStatus, contract.pdcConfirmed);
  const landlordName = contract.landlord.companyName || contract.landlord.name || '';
  const propertyDesc = [
    contract.property.buildingName,
    contract.unit.number || contract.unit.name,
    contract.property.community || contract.property.emirate,
  ].filter(Boolean).join(', ');

  // Nav tabs: the two generated receipts + each individual payment.
  const hasDeposit = payments.some(isDeposit)
    || (contract.securityDeposit?.amount ?? 0) > 0
    || (contract.securityDepositHeld ?? 0) > 0
    || (contract.securityDepositAmount ?? 0) > 0;
  const tabBase = '';
  function tabStyle(active: boolean): React.CSSProperties {
    return { margin: '0 3px', color: active ? BRAND : '#9ca3af', fontWeight: active ? 700 : 400, textDecoration: 'none' };
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#fff', overflow: 'auto' }}>
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } html, body { background: #fff !important; } } * { box-sizing: border-box; }`}</style>

      {/* Toolbar (screen only) */}
      <div className="no-print" style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 1px 4px rgba(0,0,0,.08)', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#111827' }}>{titleCase(receipt.title)} — {receipt.receiptNo}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>{contract.ref}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            <a href={`${tabBase}?kind=contract`} style={tabStyle(receipt.kind === 'contract')}>Contract</a>
            {hasDeposit && <a href={`${tabBase}?kind=deposit`} style={tabStyle(receipt.kind === 'deposit')}>Deposit</a>}
            {rentals.map((p, i) => (
              <a key={p.id} href={`${tabBase}?pid=${p.id}`} style={tabStyle(receipt.kind === 'rent' && single?.id === p.id)}>#{i + 1}</a>
            ))}
          </span>
          <button onClick={() => window.close()} style={{ padding: '6px 16px', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' }}>✕ Close</button>
          <button onClick={() => window.print()} style={{ padding: '6px 16px', background: BRAND, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>⬇ Download PDF</button>
        </div>
      </div>

      {/* Document */}
      <div style={{ maxWidth: 794, margin: '0 auto', padding: '22px 26px', fontFamily: 'Arial, sans-serif', color: '#111827' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: `2px solid ${BRAND}` }}>
          <div style={{ maxWidth: '58%' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: BRAND }}>{landlordName}</div>
            {(contract.landlord.licenseNumber || contract.landlord.licenseAuthority) && (
              <div style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>
                Licence {contract.landlord.licenseNumber || '—'}{contract.landlord.licenseAuthority ? ` · ${contract.landlord.licenseAuthority}` : ''}
              </div>
            )}
            {contract.landlord.phone && <div style={{ fontSize: 8, color: '#6b7280' }}>Tel {contract.landlord.phone}</div>}
            {contract.landlord.email && <div style={{ fontSize: 8, color: '#6b7280' }}>{contract.landlord.email}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: BRAND, letterSpacing: 0.5 }}>{receipt.title}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: BRAND, direction: 'rtl', fontFamily: 'Georgia, serif', marginBottom: 6 }}>{receipt.titleAr}</div>
            <div style={{ display: 'inline-block', textAlign: 'left', border: `1.5px solid ${BRAND}`, borderRadius: 4, padding: '5px 10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 8, rowGap: 2 }}>
                <span style={{ fontSize: 8, color: '#6b7280' }}>Receipt No.</span>
                <span style={{ fontSize: 9.5, fontWeight: 900, color: BRAND }}>{receipt.receiptNo}</span>
                <span style={{ fontSize: 8, color: '#6b7280' }}>Date</span>
                <span style={{ fontSize: 9.5, fontWeight: 700 }}>{fmtDate(receipt.date) || fmtDate(new Date().toISOString())}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Received from + property */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div style={card}>
            <div style={cardTitle}>Received From / المستلم منه</div>
            <div style={defGrid}>
              <Field label="Tenant" value={contract.tenant.name} />
              <Field label="Emirates ID" value={contract.tenant.emiratesId} />
              {contract.tenant.phone && <Field label="Phone" value={contract.tenant.phone} />}
            </div>
          </div>
          <div style={card}>
            <div style={cardTitle}>Property / العقار</div>
            <div style={defGrid}>
              <Field label="Premises" value={propertyDesc} />
              <Field label="Lease Period" value={`${fmtDate(contract.startDate)} → ${fmtDate(contract.endDate)}`} />
              <Field label="Contract Ref" value={contract.ref} />
            </div>
          </div>
        </div>

        {/* Itemised line items */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
          <thead>
            <tr style={{ background: BRAND, color: '#fff' }}>
              <th style={{ fontSize: 8, textAlign: 'left', padding: '7px 8px', width: 26 }}>#</th>
              <th style={{ fontSize: 8, textAlign: 'left', padding: '7px 8px' }}>Description / البيان</th>
              {showVat && <th style={{ fontSize: 8, textAlign: 'right', padding: '7px 8px', width: 90 }}>Net (AED)</th>}
              {showVat && <th style={{ fontSize: 8, textAlign: 'right', padding: '7px 8px', width: 90 }}>VAT 5%</th>}
              <th style={{ fontSize: 8, textAlign: 'right', padding: '7px 8px', width: 100 }}>Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((l, i) => (
              <tr key={i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                <td style={{ fontSize: 9, padding: '7px 8px', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>{i + 1}</td>
                <td style={{ fontSize: 9, padding: '7px 8px', borderBottom: '1px solid #e5e7eb', color: '#111827' }}>{l.desc}</td>
                {showVat && <td style={{ fontSize: 9, padding: '7px 8px', borderBottom: '1px solid #e5e7eb', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(l.net)}</td>}
                {showVat && <td style={{ fontSize: 9, padding: '7px 8px', borderBottom: '1px solid #e5e7eb', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.vat ? fmtAmt(l.vat) : '—'}</td>}
                <td style={{ fontSize: 9, padding: '7px 8px', borderBottom: '1px solid #e5e7eb', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {showVat && (
              <>
                <tr>
                  <td colSpan={2} style={{ fontSize: 8.5, padding: '5px 8px', textAlign: 'right', color: '#6b7280' }}>Subtotal (Net)</td>
                  <td colSpan={2} style={{ fontSize: 9, padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(subtotal)}</td>
                  <td style={{ fontSize: 9, padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ fontSize: 8.5, padding: '5px 8px', textAlign: 'right', color: '#6b7280' }}>VAT (5%)</td>
                  <td colSpan={2} style={{ fontSize: 9, padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(totalVat)}</td>
                  <td style={{ fontSize: 9, padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(totalVat)}</td>
                </tr>
              </>
            )}
            <tr style={{ background: '#eef2f9' }}>
              <td colSpan={showVat ? 4 : 2} style={{ fontSize: 10, padding: '8px', textAlign: 'right', fontWeight: 800, color: BRAND }}>TOTAL RECEIVED</td>
              <td style={{ fontSize: 11, padding: '8px', textAlign: 'right', fontWeight: 900, color: BRAND, fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Amount in words */}
        <div style={{ fontSize: 8.5, fontStyle: 'italic', color: '#374151', margin: '6px 2px 12px' }}>
          Amount in words: <strong>AED {amountInWords(grandTotal)}</strong>
        </div>

        {/* Payment details / summary + issued-by */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: receipt.schedule ? 12 : 14 }}>
          <div style={card}>
            <div style={cardTitle}>Payment Details / تفاصيل الدفع</div>
            {single ? (
              <div style={defGrid}>
                <Field label="Method" value={methodLabel(single, contract)} />
                {single.chequeNumber && <Field label="Cheque / Ref No." value={single.chequeNumber} />}
                <Field label="Value Date" value={fmtDate(single.transactionDate)} />
                <span style={{ fontSize: 8.5, color: '#6b7280' }}>Status</span>
                <span><span style={{ display: 'inline-block', fontSize: 8, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: status.bg, color: status.fg }}>{status.label}</span></span>
              </div>
            ) : (
              <div style={defGrid}>
                <Field label="Mode" value={titleCase(contract.modeOfPayment) || 'Cheque'} />
                <Field label="No. of Cheques" value={String(receipt.schedule?.length ?? contract.numberOfInstallments ?? '—')} />
                <span style={{ fontSize: 8.5, color: '#6b7280' }}>Collection</span>
                <span><span style={{ display: 'inline-block', fontSize: 8, fontWeight: 700, padding: '2px 8px', borderRadius: 999, ...(contract.pdcConfirmed ? { background: '#dbeafe', color: '#1e40af' } : { background: '#fef3c7', color: '#92400e' }) }}>{contract.pdcConfirmed ? 'PDCs Collected' : 'Pending Collection'}</span></span>
              </div>
            )}
          </div>
          <div style={card}>
            <div style={cardTitle}>Issued By / صادر من</div>
            <div style={defGrid}>
              <Field label="Landlord / Agent" value={landlordName} />
              <Field label="Phone" value={contract.landlord.phone} />
              <Field label="Email" value={contract.landlord.email} />
            </div>
          </div>
        </div>

        {/* The Contract Payment Receipt shows the TOTAL contract amount (composed of
            admin/ejari/commission/rent), NOT the per-cheque payment split — the
            cheque schedule lives on the Payments tab and the per-cheque receipts. */}

        {/* Note */}
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '6px 10px', marginBottom: 18, fontSize: 7.5, color: '#92400e' }}>
          This receipt acknowledges the payment{receipt.schedule ? 's' : ''} described above against tenancy contract {contract.ref}. Please retain it for your records.
          <span style={{ direction: 'rtl', display: 'block', marginTop: 2 }}>يُقرّ هذا الإيصال باستلام الدفعات الموضحة أعلاه بموجب عقد الإيجار. يُرجى الاحتفاظ به للسجلات.</span>
        </div>

        {/* System-generated — no signature required (replaces the signature/stamp boxes). */}
        <div style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '10px 14px', textAlign: 'center', background: '#f8fafc' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: BRAND }}>This is a system-generated receipt.</div>
          <div style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>
            It is computer-generated and valid without a signature or stamp. No physical signature is required.
          </div>
          <div style={{ fontSize: 8, color: '#6b7280', direction: 'rtl', marginTop: 2 }}>
            هذا إيصال صادر آليًا عن النظام، وهو صالح بدون توقيع أو ختم.
          </div>
        </div>

        <div style={{ marginTop: 18, borderTop: '1px solid #e5e7eb', paddingTop: 6, textAlign: 'center', fontSize: 7, color: '#9ca3af' }}>
          UpNow Property Management · {receipt.receiptNo} · Generated {fmtDate(new Date().toISOString())} · This is a computer-generated receipt.
        </div>
      </div>
    </div>
  );
}
