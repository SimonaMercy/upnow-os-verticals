/**
 * PaymentReceiptPdf — the payment receipt as a REAL vector PDF, using the same
 * @react-pdf/renderer approach as the tenancy-contract document (EjariContractPdf)
 * so it prints/downloads cleanly (no browser print-dialog chrome).
 *
 * Default export = a full-screen viewer that renders the receipt to raw PDF bytes
 * and rasterises them onto a <canvas> with pdf.js — NOT an <iframe src="blob:…pdf">
 * (that renders blank on mobile browsers and is unreliable in production; same fix
 * the tenancy contract uses via EjariCanvas). Loaded via next/dynamic ssr:false from
 * the print/receipt routes. The receipt model/logic lives here too (shared by
 * RP/manager + customer routes).
 *
 * The contract issues THREE separate receipts, segmented exactly like the Payments
 * ledger. They are bundled into ONE document (one file → three pages) by default;
 * a single `kind` shows just that page.
 * Modes (chosen by `kind` / `selectedId`):
 *   • default / kind="all" → ONE document, three pages: Rental Income, Security
 *                            Deposit, Management Fee (only those with data)
 *   • kind="rental"     → Rental Income page only (every rent instalment, VAT split)
 *   • kind="deposit"    → Security Deposit page only (resolves the held deposit entity)
 *   • kind="management" → Management Fee page only (Ejari / Admin / Commission lines)
 *   • kind="contract"   → legacy single combined receipt (Admin/Ejari/Commission/Rent)
 *   • pid=<id>          → one payment (instalment #1 itemises the bundled fees)
 *
 * Money: contract adminFeeFils/ejariFeeFils are stored inconsistently (AED or fils)
 * → normalizeFees() self-corrects (legacy/bundled contracts only). Admin/ejari/
 * commission are read from the real fee rows (contract.fees) when present;
 * commission is NEVER synthesised from a residual.
 */
'use client';

import React from 'react';
import { Document, Page, View, Text, Font } from '@react-pdf/renderer';
import EjariCanvas from '@/components/contract/EjariCanvas';
import { useReactPdfDoc } from '@/components/contract/useReactPdfDoc';

// Roboto — clean modern sans for the whole document (no Bold ttf shipped, so map
// bold → Medium). Receipts are English-only — no Arabic font dependency (avoids the
// NotoNaskh fetch + textkit ligature path that can fail PDF generation in prod).
Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 400 },
    { src: '/fonts/Roboto-Medium.ttf', fontWeight: 500 },
    { src: '/fonts/Roboto-Medium.ttf', fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((w) => [w]);

// App color theme — matches the dashboard chrome (--color-primary etc.).
const INK = '#1a1916';        // --ink (warm near-black) — body text
const HEADER = '#2e9f82';     // --color-primary — header band (same as app header/buttons)
const HEADER_SUB = '#e3f5ee'; // light tint — secondary text on the band
const ACCENT = '#1a5a4a';     // --color-primary-dark — base rule
const ACCENT_DK = '#1a5a4a';  // --color-primary-dark — amount + total
const MUTE = '#9b9890';       // --mute (warm gray) — labels
const LINE = '#e8e6e0';       // --mist-strong — borders
const TINT = '#d8f2e8';       // --color-primary-light — total card bg
const NAVY = INK; // keep references working

// ─── Types ────────────────────────────────────────────────────────────────

export interface ReceiptPayment {
  id: number;
  paymentType: string | null;
  description: string | null;
  amount: number;
  vatAmount?: number;
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
  annualRent?: number;
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  pdcConfirmed?: boolean;
  securityDepositAmount?: number | null;
  securityDepositHeld?: number | null;
  securityDeposit?: {
    amount?: number | null;
    chequeNumber?: string | null;
    paymentMethod?: string | null;
    chequeStatus?: string | null;
    dueDate?: string | null;
    isCarried?: boolean;
    sourceContractId?: number | null;
  } | null;
  adminFeeFils?: number;
  ejariFeeFils?: number;
  /** Real one-off fee rows (admin/ejari/commission) — the source of truth for
   *  the receipt's fee lines. When present we read these directly instead of
   *  reconstructing from columns + a commission residual. */
  fees?: ReceiptPayment[];
  landlord: {
    name: string | null;
    companyName: string | null;
    phone?: string | null;
    email?: string | null;
    emiratesId?: string | null;
    licenseNumber?: string | null;
    licenseAuthority?: string | null;
    hasPoa?: boolean | null;
    poaPersonName?: string | null;
    poaPersonPhone?: string | null;
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
  kind?: 'deposit' | 'contract' | 'rental' | 'management' | 'all' | null;
}

// ─── Model helpers ──────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getDate().toString().padStart(2, '0')}-${(dt.getMonth() + 1).toString().padStart(2, '0')}-${dt.getFullYear()}`;
}
function fmtAmt(v: number): string {
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round2(v: number): number {
  return Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
}
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
function statusLabel(chequeStatus: string | null | undefined, pdcConfirmed?: boolean): string {
  switch ((chequeStatus ?? '').toLowerCase()) {
    case 'cleared': return 'Cleared';
    case 'bounced': return 'Bounced';
    case 'cancelled': return 'Cancelled';
    default: return pdcConfirmed ? 'Collected (PDC)' : 'Pending';
  }
}
const FEE_TYPES = new Set(['admin_fee', 'ejari_fee', 'commission']);
function isFee(p: ReceiptPayment): boolean {
  return FEE_TYPES.has((p.paymentType ?? '').toLowerCase());
}
function isRental(p: ReceiptPayment): boolean {
  const t = (p.paymentType ?? '').toLowerCase();
  return t !== 'security_deposit' && !FEE_TYPES.has(t);
}
const FEE_LABEL: Record<string, string> = {
  admin_fee: 'Administration Fee', ejari_fee: 'Ejari Registration Fee', commission: 'Commission',
};
function isDeposit(p: ReceiptPayment): boolean {
  return (p.paymentType ?? '').toLowerCase() === 'security_deposit';
}
/** Renewals carry the deposit from the original lease (read-only, never re-collected),
 *  so a renewal issues no security-deposit receipt — only rental income & management fee. */
function isRenewalContract(c: ReceiptContract): boolean {
  return (c.contractType ?? '').toLowerCase() === 'renewal';
}

interface LineItem { desc: string; net: number; vat: number; total: number; date?: string | null; }
interface Receipt {
  kind: 'deposit' | 'rent' | 'fee' | 'contract' | 'rental' | 'management';
  title: string;
  receiptNo: string;
  date: string | null;
  lines: LineItem[];
  single?: ReceiptPayment;
  scheduleCount?: number;
}

function buildSingleReceipt(sel: ReceiptPayment, contract: ReceiptContract, rentals: ReceiptPayment[]): Receipt {
  const type = (sel.paymentType ?? '').toLowerCase();
  const gross = sel.amount || 0;
  const vat = sel.vatAmount || 0;
  const net = Math.max(0, gross - vat);

  if (type === 'security_deposit') {
    return { kind: 'deposit', title: 'SECURITY DEPOSIT RECEIPT',
      receiptNo: `RCP-${contract.ref}-DEP`, date: sel.transactionDate, single: sel,
      lines: [{ desc: 'Security Deposit', net: gross, vat: 0, total: gross }] };
  }
  if (isFee(sel)) {
    const code = type === 'ejari_fee' ? 'EJR' : type === 'commission' ? 'COM' : 'ADM';
    return { kind: 'fee', title: 'FEE RECEIPT',
      receiptNo: `RCP-${contract.ref}-${code}`, date: sel.transactionDate, single: sel,
      lines: [{ desc: sel.description || FEE_LABEL[type] || 'Fee', net, vat, total: gross }] };
  }

  const rentalIdx = rentals.findIndex(p => p.id === sel.id);
  const ordinal = rentalIdx >= 0 ? rentalIdx + 1 : 1;
  const n = contract.numberOfInstallments ?? rentals.length ?? 1;
  const perInstallmentNet = n > 0 ? round2((contract.annualRent ?? 0) / n) : (contract.annualRent ?? 0);
  const extras = round2(net - perInstallmentNet);
  const { admin, ejari } = normalizeFees(contract.adminFeeFils ?? 0, contract.ejariFeeFils ?? 0, extras);
  const isFirstBundle = rentalIdx === 0 && extras >= 1 && admin + ejari > 0;

  const lines: LineItem[] = [];
  if (isFirstBundle) {
    if (admin > 0) lines.push({ desc: 'Administration Fee', net: admin, vat: 0, total: admin });
    if (ejari > 0) lines.push({ desc: 'Ejari Registration Fee', net: ejari, vat: 0, total: ejari });
    const rentNet = Math.max(0, net - admin - ejari);
    lines.push({ desc: `Rent — Installment ${ordinal} of ${n}`, net: rentNet, vat, total: rentNet + vat, date: sel.transactionDate ?? null });
  } else {
    lines.push({ desc: `Rent — Installment ${ordinal} of ${n}`, net, vat, total: gross, date: sel.transactionDate ?? null });
  }

  return { kind: 'rent', title: 'RENT RECEIPT',
    receiptNo: `RCP-${contract.ref}-${String(ordinal).padStart(2, '0')}`, date: sel.transactionDate, single: sel, lines };
}

/** The Management-Fee lines (Admin / Ejari / Commission), each net + VAT — read
 *  from the real one-off fee rows when present, else reconstructed from the legacy
 *  bundled columns. Also returns `legacyBundle` = the admin+ejari amount that was
 *  folded into the FIRST rent cheque on legacy contracts, so the Rent receipt can
 *  strip it (and the combined receipt can net it out of rent). Commission is NEVER
 *  synthesised from a residual — it only appears from a real commission fee row. */
function feeLinesOf(contract: ReceiptContract, rentRows: ReceiptPayment[]): { lines: LineItem[]; legacyBundle: number; feeCount: number } {
  const feeRows = (contract.fees ?? []).filter(isFee);
  // Real fee rows store the GROSS amount + their own vatAmount, so each fee shows
  // net / VAT / gross (stripping VAT to net would undercount the printed total).
  const grossOf = (rows: ReceiptPayment[]) => round2(rows.reduce((s, p) => s + (p.amount || 0), 0));
  const vatSumOf = (rows: ReceiptPayment[]) => round2(rows.reduce((s, p) => s + (p.vatAmount || 0), 0));
  const netOf = (rows: ReceiptPayment[]) => round2(rows.reduce((s, p) => s + Math.max(0, (p.amount || 0) - (p.vatAmount || 0)), 0));

  let adminNet = 0, adminVat = 0, ejariNet = 0, ejariVat = 0, commissionNet = 0, commissionVat = 0, legacyBundle = 0;

  if (feeRows.length > 0) {
    // Real fee rows — read each fee (gross + VAT) directly from its own row(s).
    const feeOfType = (t: string) => feeRows.filter(p => (p.paymentType ?? '').toLowerCase() === t);
    const a = feeOfType('admin_fee'), e = feeOfType('ejari_fee'), c = feeOfType('commission');
    adminVat = vatSumOf(a); adminNet = round2(grossOf(a) - adminVat);
    ejariVat = vatSumOf(e); ejariNet = round2(grossOf(e) - ejariVat);
    commissionVat = vatSumOf(c); commissionNet = round2(grossOf(c) - commissionVat);
  } else {
    // Legacy / renewal: no separate fee rows — fees were bundled into the rent
    // cheques. Reconstruct admin/ejari from the (RP-entered) columns; everything
    // else in the cheque total is rent.
    const sumNet = netOf(rentRows);
    const feesPlusComm = round2(sumNet - (contract.annualRent ?? 0));
    const n = normalizeFees(contract.adminFeeFils ?? 0, contract.ejariFeeFils ?? 0, feesPlusComm);
    adminNet = n.admin; ejariNet = n.ejari;
    legacyBundle = round2(adminNet + ejariNet);
  }

  const lines: LineItem[] = [];
  if (adminNet + adminVat > 0)           lines.push({ desc: 'Administration Fee',     net: adminNet,      vat: adminVat,      total: round2(adminNet + adminVat) });
  if (ejariNet + ejariVat > 0)           lines.push({ desc: 'Ejari Registration Fee', net: ejariNet,      vat: ejariVat,      total: round2(ejariNet + ejariVat) });
  if (commissionNet + commissionVat > 0) lines.push({ desc: 'Commission',             net: commissionNet, vat: commissionVat, total: round2(commissionNet + commissionVat) });
  return { lines, legacyBundle, feeCount: feeRows.length };
}

/** RENTAL INCOME receipt — every rent instalment as its own line (net / VAT /
 *  gross), mirroring the Payments ledger's Rental Income category. */
function buildRentalReceipt(contract: ReceiptContract, rentals: ReceiptPayment[]): Receipt | null {
  if (rentals.length === 0) return null;
  const n = contract.numberOfInstallments ?? rentals.length ?? 1;
  // On legacy contracts admin+ejari were folded into the first rent cheque — strip
  // that bundle here so the Rent receipt shows pure rent (the fees live on the
  // Management Fee receipt instead).
  const { legacyBundle } = feeLinesOf(contract, rentals);
  const lines: LineItem[] = rentals.map((p, i) => {
    const gross = p.amount || 0;
    const vat = p.vatAmount || 0;
    let net = Math.max(0, round2(gross - vat));
    if (i === 0 && legacyBundle > 0) net = Math.max(0, round2(net - legacyBundle));
    return { desc: `Rent — Installment ${i + 1} of ${n}`, net, vat, total: round2(net + vat), date: p.transactionDate ?? null };
  });
  return { kind: 'rental', title: 'RENT INCOME RECEIPT',
    receiptNo: `RCP-${contract.ref}-RENT`, date: rentals[0]?.transactionDate ?? contract.startDate ?? null,
    lines, scheduleCount: rentals.length };
}

/** MANAGEMENT FEE receipt — Ejari / Admin / Commission only, each net + VAT,
 *  mirroring the Payments ledger's Management Fee category. */
function buildManagementReceipt(contract: ReceiptContract, rentRows: ReceiptPayment[]): Receipt | null {
  const { lines, feeCount } = feeLinesOf(contract, rentRows);
  if (lines.length === 0) return null;
  const feeRows = (contract.fees ?? []).filter(isFee);
  return { kind: 'management', title: 'MANAGEMENT FEE RECEIPT',
    receiptNo: `RCP-${contract.ref}-MGMT`,
    date: feeRows[0]?.transactionDate ?? rentRows[0]?.transactionDate ?? contract.startDate ?? null,
    lines, scheduleCount: feeCount || lines.length };
}

function buildContractReceipt(contract: ReceiptContract, payments: ReceiptPayment[]): Receipt | null {
  // Legacy combined receipt: fee lines + a single rolled-up rent line. The binder
  // now links the three segmented receipts above; this is retained for old links.
  const rentRows = payments.filter(p => !isDeposit(p) && !isFee(p));
  const feeRows = (contract.fees ?? []).filter(isFee);
  const { lines: feeLines, legacyBundle, feeCount } = feeLinesOf(contract, rentRows);
  if (rentRows.length === 0 && feeLines.length === 0) return null;

  const netOf = (rows: ReceiptPayment[]) =>
    round2(rows.reduce((s, p) => s + Math.max(0, (p.amount || 0) - (p.vatAmount || 0)), 0));
  const rentVat = round2(rentRows.reduce((s, p) => s + (p.vatAmount || 0), 0));
  // legacyBundle = admin+ejari folded into the rent cheques on legacy contracts;
  // 0 when real fee rows exist (those rents are already pure).
  const rentNet = Math.max(0, round2(netOf(rentRows) - legacyBundle));

  const lines: LineItem[] = [...feeLines,
    { desc: 'Rent (full lease term)', net: rentNet, vat: rentVat, total: round2(rentNet + rentVat) }];

  return { kind: 'contract', title: 'CONTRACT PAYMENT RECEIPT',
    receiptNo: `RCP-${contract.ref}-PAY`, date: rentRows[0]?.transactionDate ?? feeRows[0]?.transactionDate ?? null,
    lines, scheduleCount: rentRows.length + feeCount };
}

/** Resolve the deposit pseudo-payment from the entity / held amount / column. */
function resolveDeposit(contract: ReceiptContract): ReceiptPayment | undefined {
  // Renewals carry the deposit forward (read-only) — never issue a fresh deposit receipt.
  if (isRenewalContract(contract)) return undefined;
  const found = (contract.payments ?? []).find(isDeposit);
  if (found) return found;
  const sd = contract.securityDeposit;
  const amt = (sd?.amount ?? 0) > 0 ? Number(sd!.amount)
    : (contract.securityDepositHeld ?? 0) > 0 ? Number(contract.securityDepositHeld)
    : (contract.securityDepositAmount ?? 0) > 0 ? Number(contract.securityDepositAmount)
    : 0;
  if (amt <= 0) return undefined;
  return {
    id: -1, paymentType: 'security_deposit', description: 'Security deposit', amount: amt, vatAmount: 0,
    chequeNumber: sd?.chequeNumber ?? null,
    chequeStatus: sd?.chequeStatus ?? (contract.pdcConfirmed ? 'cleared' : 'pending'),
    paymentMethod: sd?.paymentMethod ?? contract.modeOfPayment ?? null,
    transactionDate: sd?.dueDate ?? null,
  };
}

function resolveReceipt(contract: ReceiptContract, kind: Props['kind'], selectedId?: number | null, selectedIdx = 0): Receipt | null {
  const payments = contract.payments ?? [];
  // Fee rows live in their own array — include them so a per-fee receipt
  // (?pid=<feeRowId>) resolves to the right admin/ejari/commission line.
  const all = [...payments, ...((contract.fees ?? []).filter(isFee))];
  const rentals = payments.filter(isRental);
  if (kind === 'contract') return buildContractReceipt(contract, payments);
  if (kind === 'rental') return buildRentalReceipt(contract, rentals);
  if (kind === 'management') return buildManagementReceipt(contract, rentals);
  if (kind === 'deposit') {
    const dep = resolveDeposit(contract);
    return dep ? buildSingleReceipt(dep, contract, rentals) : null;
  }
  let sel: ReceiptPayment | undefined;
  if (selectedId != null) sel = all.find(p => p.id === selectedId);
  if (!sel) sel = payments[Math.min(Math.max(selectedIdx, 0), Math.max(payments.length - 1, 0))];
  // Renewals carry the deposit forward (read-only) — never issue a deposit receipt,
  // even via a direct ?pid=<depositRowId> / ?p=<idx> link (this branch bypasses resolveDeposit).
  if (sel && isDeposit(sel) && isRenewalContract(contract)) return null;
  return sel ? buildSingleReceipt(sel, contract, rentals) : null;
}

/** The three segmented receipts (Rental Income · Security Deposit · Management
 *  Fee) in ledger order — only those with data. These become the three pages of
 *  the combined document. */
function buildAllReceipts(contract: ReceiptContract): Receipt[] {
  const rentals = (contract.payments ?? []).filter(isRental);
  const out: Receipt[] = [];
  const rent = buildRentalReceipt(contract, rentals);
  if (rent) out.push(rent);
  const dep = resolveDeposit(contract);
  if (dep) { const d = buildSingleReceipt(dep, contract, rentals); if (d) out.push(d); }
  const mgmt = buildManagementReceipt(contract, rentals);
  if (mgmt) out.push(mgmt);
  return out;
}

/** Is this a combined (all-three-pages) request? True when no single payment and
 *  no specific category is selected. */
function isCombined(kind: Props['kind'], selectedId?: number | null): boolean {
  return selectedId == null && (kind == null || kind === 'all');
}

// ─── PDF styles ──────────────────────────────────────────────────────────────

const PAD = 34;
const st = {
  page: { paddingTop: 0, paddingBottom: 30, paddingHorizontal: 0, fontSize: 9, fontFamily: 'Roboto', color: INK },
  metaLbl: { fontSize: 6.5, color: MUTE, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 },
  th: { fontSize: 6.5, color: MUTE, letterSpacing: 0.8, textTransform: 'uppercase', paddingVertical: 7 },
  td: { fontSize: 9, paddingVertical: 8, color: '#57534e' },
} as const;

function pillFor(label: string): { bg: string; fg: string } {
  switch (label) {
    case 'Receipt':
    case 'Cleared':
    case 'Collected (PDC)':
    case 'PDCs Collected': return { bg: '#d8f2e8', fg: '#1a5a4a' }; // --color-primary-light / -dark
    case 'Bounced': return { bg: '#fdede7', fg: '#9a3520' };        // --brick-soft / --brick-deep
    case 'Cancelled': return { bg: '#f0ede8', fg: '#6b6860' };      // --mist / warm gray
    default: return { bg: '#fff7ed', fg: '#c2410c' };              // --saffron-soft / --saffron-deep (Pending)
  }
}
function Pill({ text }: { text: string }) {
  const c = pillFor(text);
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 11 }}>
      <Text style={{ fontSize: 8, fontWeight: 700, color: c.fg }}>{text}</Text>
    </View>
  );
}
function Detail({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={{ marginRight: 26, marginBottom: 8 }}>
      <Text style={{ fontSize: 6.5, color: MUTE, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>{label}</Text>
      <Text style={{ fontSize: 9, color: INK, fontWeight: 500 }}>{value}</Text>
    </View>
  );
}

// ─── The PDF document ─────────────────────────────────────────────────────────

/** One receipt rendered as a single A4 page — used standalone OR as one page of
 *  the combined three-receipt document. */
function ReceiptPage({ receipt, contract }: { receipt: Receipt; contract: ReceiptContract }) {
  const subtotal = round2(receipt.lines.reduce((s, l) => s + l.net, 0));
  const totalVat = round2(receipt.lines.reduce((s, l) => s + l.vat, 0));
  const grandTotal = round2(receipt.lines.reduce((s, l) => s + l.total, 0));
  const showVat = totalVat > 0;
  const single = receipt.single;
  const landlordName = contract.landlord?.companyName || contract.landlord?.name || '';
  const propertyDesc = [contract.property?.buildingName, contract.unit?.number || contract.unit?.name, contract.property?.community || contract.property?.emirate].filter(Boolean).join(', ');

  // A receipt acknowledges money received. On the SECURITY DEPOSIT receipt an
  // un-cleared PDC reads as "Receipt" (the deposit is in hand) rather than the
  // ledger's "Collected (PDC)" / "Pending"; cleared/bounced/cancelled keep their label.
  const rawStatus = single ? statusLabel(single.chequeStatus, contract.pdcConfirmed) : 'Receipt';
  const heroStatus = receipt.kind === 'deposit' && (rawStatus === 'Collected (PDC)' || rawStatus === 'Pending')
    ? 'Receipt'
    : rawStatus;
  // When the lessor acts under a Power of Attorney, the contact number on the
  // receipt is the POA holder's (mirrors the Ejari contract renderer).
  const lessorPhone = contract.landlord?.hasPoa
    ? (contract.landlord?.poaPersonPhone || contract.landlord?.phone)
    : contract.landlord?.phone;
  const issuerLines = [
    (contract.landlord?.licenseNumber || contract.landlord?.licenseAuthority)
      ? `Licence ${contract.landlord?.licenseNumber || '—'}${contract.landlord?.licenseAuthority ? ` · ${contract.landlord.licenseAuthority}` : ''}` : null,
    lessorPhone ? `Tel ${lessorPhone}` : null,
    contract.landlord?.email,
  ].filter(Boolean) as string[];

  return (
      <Page size="A4" style={st.page}>

        {/* ── Header band (full-bleed) ── */}
        <View style={{ backgroundColor: HEADER, paddingHorizontal: PAD, paddingTop: 26, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ maxWidth: '56%' }}>
            <Text style={{ fontSize: 15, color: '#fff', fontWeight: 700 }}>{landlordName}</Text>
            {issuerLines.map((l, i) => <Text key={i} style={{ fontSize: 7.5, color: HEADER_SUB, marginTop: 2 }}>{l}</Text>)}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 8, color: '#fff', letterSpacing: 2, marginBottom: 9 }}>{receipt.title}</Text>
            <View style={{ flexDirection: 'row', marginBottom: 2 }}>
              <Text style={{ fontSize: 7, color: HEADER_SUB, letterSpacing: 0.5, marginRight: 6 }}>RECEIPT NO.</Text>
              <Text style={{ fontSize: 8.5, color: '#fff', fontWeight: 500 }}>{receipt.receiptNo}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={{ fontSize: 7, color: HEADER_SUB, letterSpacing: 0.5, marginRight: 6 }}>DATE</Text>
              <Text style={{ fontSize: 8.5, color: '#fff', fontWeight: 500 }}>{fmtDate(receipt.date) || fmtDate(contract.startDate)}</Text>
            </View>
          </View>
        </View>
        <View style={{ height: 3, backgroundColor: ACCENT }} />

        {/* ── Hero amount ── */}
        <View style={{ paddingHorizontal: PAD, paddingTop: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: 6.5, color: MUTE, letterSpacing: 1.2 }}>AMOUNT RECEIVED</Text>
            <Text style={{ fontSize: 25, color: ACCENT_DK, fontWeight: 700, marginTop: 3 }}>AED {fmtAmt(grandTotal)}</Text>
            <Text style={{ fontSize: 7.5, color: MUTE, marginTop: 3 }}>{amountInWords(grandTotal)}</Text>
          </View>
          <View style={{ marginTop: 4 }}><Pill text={heroStatus} /></View>
        </View>

        {/* ── Parties meta ── */}
        <View style={{ paddingHorizontal: PAD, paddingTop: 18, flexDirection: 'row' }}>
          <View style={{ flex: 1, paddingRight: 14 }}>
            <Text style={st.metaLbl}>Billed To</Text>
            <Text style={{ fontSize: 10, color: INK, fontWeight: 500 }}>{contract.tenant?.name || '—'}</Text>
            {contract.tenant?.emiratesId ? <Text style={{ fontSize: 8, color: MUTE, marginTop: 2 }}>Emirates ID {contract.tenant.emiratesId}</Text> : null}
            {contract.tenant?.phone ? <Text style={{ fontSize: 8, color: MUTE }}>{contract.tenant.phone}</Text> : null}
          </View>
          <View style={{ flex: 1.25 }}>
            <Text style={st.metaLbl}>Property</Text>
            <Text style={{ fontSize: 10, color: INK, fontWeight: 500 }}>{propertyDesc || '—'}</Text>
            <Text style={{ fontSize: 8, color: MUTE, marginTop: 2 }}>Lease {fmtDate(contract.startDate)} – {fmtDate(contract.endDate)}</Text>
            <Text style={{ fontSize: 8, color: MUTE }}>Contract {contract.ref}</Text>
          </View>
        </View>

        {/* ── Line items ── */}
        <View style={{ paddingHorizontal: PAD, paddingTop: 18 }}>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1.2, borderBottomColor: INK }}>
            <Text style={[st.th, { flex: 1 }]}>Description</Text>
            {showVat ? <Text style={[st.th, { width: 78, textAlign: 'right' }]}>Net</Text> : null}
            {showVat ? <Text style={[st.th, { width: 60, textAlign: 'right' }]}>VAT 5%</Text> : null}
            <Text style={[st.th, { width: 92, textAlign: 'right' }]}>Amount (AED)</Text>
          </View>
          {receipt.lines.map((l, i) => (
            <View key={i} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE }}>
              <View style={{ flex: 1, paddingVertical: 8 }}>
                <Text style={{ fontSize: 9, color: INK }}>{l.desc}</Text>
                {l.date ? <Text style={{ fontSize: 7, color: MUTE, marginTop: 1 }}>Due {fmtDate(l.date)}</Text> : null}
              </View>
              {showVat ? <Text style={[st.td, { width: 78, textAlign: 'right' }]}>{fmtAmt(l.net)}</Text> : null}
              {showVat ? <Text style={[st.td, { width: 60, textAlign: 'right' }]}>{l.vat ? fmtAmt(l.vat) : '—'}</Text> : null}
              <Text style={[st.td, { width: 92, textAlign: 'right', color: INK, fontWeight: 500 }]}>{fmtAmt(l.total)}</Text>
            </View>
          ))}
          {showVat ? (
            <View style={{ alignItems: 'flex-end', paddingTop: 7 }}>
              <View style={{ flexDirection: 'row', width: 230, justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ fontSize: 8.5, color: MUTE }}>Subtotal (Net)</Text>
                <Text style={{ fontSize: 8.5, color: '#57534e' }}>{fmtAmt(subtotal)}</Text>
              </View>
              <View style={{ flexDirection: 'row', width: 230, justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 8.5, color: MUTE }}>VAT (5%)</Text>
                <Text style={{ fontSize: 8.5, color: '#57534e' }}>{fmtAmt(totalVat)}</Text>
              </View>
            </View>
          ) : null}
          {/* Total card */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, backgroundColor: TINT, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14 }}>
            <Text style={{ fontSize: 9, color: ACCENT_DK, letterSpacing: 0.5, fontWeight: 700 }}>TOTAL RECEIVED</Text>
            <Text style={{ fontSize: 14, color: ACCENT_DK, fontWeight: 700 }}>AED {fmtAmt(grandTotal)}</Text>
          </View>
        </View>

        {/* ── Payment details — single-payment receipts only. The aggregate
             "Mode / No. of Cheques" line was removed (it just restated the
             contract's mode + instalment count, adding nothing to the receipt). ── */}
        {single ? (
          <View style={{ paddingHorizontal: PAD, paddingTop: 18 }}>
            <Text style={[st.metaLbl, { marginBottom: 7 }]}>Payment Details</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Detail label="Method" value={methodLabel(single, contract)} />
              <Detail label="Cheque / Ref" value={single.chequeNumber} />
              <Detail label="Value Date" value={fmtDate(single.transactionDate)} />
            </View>
          </View>
        ) : null}

        {/* ── System-generated note ── */}
        <View style={{ paddingHorizontal: PAD, paddingTop: 14 }}>
          <View style={{ borderTopWidth: 1, borderTopColor: LINE, paddingTop: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 8.5, color: INK, fontWeight: 500 }}>This is a system-generated receipt — valid without a signature or stamp.</Text>
            <Text style={{ fontSize: 7.5, color: MUTE, marginTop: 5 }}>Please retain this receipt against tenancy contract {contract.ref} for your records.</Text>
          </View>
        </View>

        {/* Footer */}
        <Text fixed style={{ position: 'absolute', bottom: 14, left: PAD, right: PAD, textAlign: 'center', fontSize: 7, color: MUTE }}>
          UpNow Property Management · {receipt.receiptNo} · Contract {contract.ref}
        </Text>
      </Page>
  );
}

/** Empty-state document for when the selected receipt has no data. */
function EmptyDoc({ kind }: { kind: Props['kind'] }) {
  return (
    <Document>
      <Page size="A4" style={st.page}>
        <Text style={{ marginTop: 40, textAlign: 'center', color: MUTE }}>
          {kind === 'deposit' ? 'No security deposit is recorded for this contract.'
            : kind === 'management' ? 'No management fees (Ejari, admin or commission) are recorded for this contract.'
            : kind === 'rental' ? 'No rent payments are recorded for this contract yet.'
            : 'No payments are available to receipt for this contract yet.'}
        </Text>
      </Page>
    </Document>
  );
}

function PaymentReceiptDoc({ contract, kind, selectedId, selectedIdx }: Props) {
  // Default / kind="all" → ONE document holding the three segmented receipts as
  // separate pages. A specific kind / pid → that single page only.
  if (isCombined(kind, selectedId)) {
    const receipts = buildAllReceipts(contract);
    if (receipts.length === 0) return <EmptyDoc kind={kind} />;
    return (
      <Document title={`Receipts — ${contract.ref}`}>
        {receipts.map((r, i) => <ReceiptPage key={`${r.kind}-${i}`} receipt={r} contract={contract} />)}
      </Document>
    );
  }
  const receipt = resolveReceipt(contract, kind, selectedId, selectedIdx);
  if (!receipt) return <EmptyDoc kind={kind} />;
  return (
    <Document title={receipt.receiptNo}>
      <ReceiptPage receipt={receipt} contract={contract} />
    </Document>
  );
}

/** Inline (embeddable) receipts for the documents binder: the same receipts the
 *  full-screen viewer shows, rasterised to stacked <canvas> pages at full height
 *  — no toolbar, no download, no inner scroll (the page's outer scroll handles
 *  it). Pass a large `height` so EjariCanvas never engages its scroll cap. */
export function ReceiptInline({ contract, kind = 'all', height = 100000 }: { contract: ReceiptContract; kind?: Props['kind']; height?: number }) {
  const docKey = `inline|${contract.id}|${kind ?? 'all'}`;
  const { bytes, error } = useReactPdfDoc(
    () => <PaymentReceiptDoc contract={contract} kind={kind} selectedId={null} selectedIdx={0} />,
    docKey,
  );
  if (error) return <div style={{ padding: 24, textAlign: 'center', color: '#c00', fontSize: 13 }}>Receipts unavailable.</div>;
  return <EjariCanvas bytes={bytes} height={height} />;
}

// ─── Full-screen viewer (default export) ──────────────────────────────────────

const VIEWER_WRAP = { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#52555a' } as const;
const VIEWER_BAR = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #ddd', gap: 12, flexWrap: 'wrap' } as const;
const CLOSE_BTN = { padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' } as const;
const DL_BTN = { padding: '6px 16px', background: NAVY, color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none' } as const;

export default function PaymentReceiptViewer({ contract, kind, selectedId, selectedIdx }: Props) {
  const combined = isCombined(kind, selectedId);
  const receipt = combined ? null : resolveReceipt(contract, kind, selectedId, selectedIdx);
  // One file by default: "Receipts — <ref>.pdf" holding all three pages.
  const fileName = combined ? `Receipts-${contract.ref}.pdf` : `${receipt?.receiptNo ?? `receipt-${contract.ref}`}.pdf`;

  // Render the receipt to PDF bytes and rasterise to <canvas> (pdf.js) — NOT a
  // @react-pdf <PDFViewer> (iframe blob), which renders blank on mobile / in prod.
  // Keyed on the route inputs: the print route fetches `contract` once, so its id is
  // a stable content key.
  const docKey = `${contract.id}|${kind ?? 'all'}|${selectedId ?? ''}|${selectedIdx ?? 0}`;
  const { bytes, url: downloadUrl, error: genError } = useReactPdfDoc(
    () => <PaymentReceiptDoc contract={contract} kind={kind} selectedId={selectedId} selectedIdx={selectedIdx} />,
    docKey,
  );

  // Tabs: All (the combined three-page file) + jump to a single segmented receipt
  // — mirrors the Payments ledger categories: Rental Income · Security Deposit ·
  // Management Fee.
  const payments = contract.payments ?? [];
  const rentals = payments.filter(isRental);
  const hasRental = rentals.length > 0;
  const hasDeposit = !isRenewalContract(contract) && (payments.some(isDeposit) || (contract.securityDeposit?.amount ?? 0) > 0
    || (contract.securityDepositHeld ?? 0) > 0 || (contract.securityDepositAmount ?? 0) > 0);
  const hasManagement = feeLinesOf(contract, rentals).lines.length > 0;
  const tab = (active: boolean): React.CSSProperties => ({ margin: '0 3px', color: active ? NAVY : '#9ca3af', fontWeight: active ? 700 : 400, textDecoration: 'none', fontSize: 12 });

  return (
    <div style={VIEWER_WRAP}>
      <div style={VIEWER_BAR}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
            {combined ? `Receipts — ${contract.ref}` : `${receipt ? titleCase(receipt.title) : 'Receipt'} — ${receipt?.receiptNo ?? contract.ref}`}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
            {combined
              ? (isRenewalContract(contract) ? 'Rental income · management fee — one file' : 'Rental income · security deposit · management fee — one file, three receipts')
              : 'System-generated payment receipt'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            <a href="?kind=all" style={tab(combined)}>All</a>
            {hasRental && <a href="?kind=rental" style={tab(!combined && receipt?.kind === 'rental')}>Rental Income</a>}
            {hasDeposit && <a href="?kind=deposit" style={tab(!combined && receipt?.kind === 'deposit')}>Security Deposit</a>}
            {hasManagement && <a href="?kind=management" style={tab(!combined && receipt?.kind === 'management')}>Management Fee</a>}
          </span>
          <button onClick={() => window.history.back()} style={CLOSE_BTN}>✕ Close</button>
          {downloadUrl
            ? <a href={downloadUrl} download={fileName} style={DL_BTN}>⬇ Download PDF</a>
            : <span style={{ ...DL_BTN, opacity: 0.6, cursor: 'default' }}>⏳ Preparing…</span>}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {genError
          ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 16, color: '#fff', fontSize: 13 }}>Preview unavailable — use “⬇ Download PDF” above.</div>
          : <EjariCanvas bytes={bytes} fill />}
      </div>
    </div>
  );
}
