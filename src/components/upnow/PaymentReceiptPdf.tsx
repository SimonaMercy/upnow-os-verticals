/**
 * PaymentReceiptPdf — the payment receipt as a REAL vector PDF, using the same
 * @react-pdf/renderer approach as the tenancy-contract document (EjariContractPdf)
 * so it prints/downloads cleanly (no browser print-dialog chrome).
 *
 * Default export = a full-screen viewer (PDFViewer + PDFDownloadLink), loaded via
 * next/dynamic ssr:false from the print/receipt routes. The receipt model/logic
 * lives here too (shared by RP/manager + customer routes).
 *
 * Modes (chosen by `kind` / `selectedId`):
 *   • kind="contract" → total contract amount itemised (Admin/Ejari/Commission/Rent)
 *   • kind="deposit"  → Security Deposit Receipt (resolves the held deposit entity)
 *   • default (pid)   → one payment (instalment #1 itemises the bundled fees)
 *
 * Money: contract adminFeeFils/ejariFeeFils are stored inconsistently (AED or fils)
 * → normalizeFees() self-corrects. Commission is the residual of the real payments.
 */
'use client';

import React from 'react';
import { Document, Page, View, Text, Font, PDFViewer, PDFDownloadLink } from '@react-pdf/renderer';

// Roboto — clean modern sans for the whole document (no Bold ttf shipped, so map
// bold → Medium). Arabic falls back to Noto Naskh.
Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 400 },
    { src: '/fonts/Roboto-Medium.ttf', fontWeight: 500 },
    { src: '/fonts/Roboto-Medium.ttf', fontWeight: 700 },
  ],
});
Font.register({
  family: 'NotoAr',
  fonts: [
    { src: '/fonts/NotoNaskhArabic-Regular.ttf' },
    { src: '/fonts/NotoNaskhArabic-Bold.ttf', fontWeight: 700 },
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
const AR = 'NotoAr';

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
  single?: ReceiptPayment;
  scheduleCount?: number;
}

function buildSingleReceipt(sel: ReceiptPayment, contract: ReceiptContract, rentals: ReceiptPayment[]): Receipt {
  const type = (sel.paymentType ?? '').toLowerCase();
  const gross = sel.amount || 0;
  const vat = sel.vatAmount || 0;
  const net = Math.max(0, gross - vat);

  if (type === 'security_deposit') {
    return { kind: 'deposit', title: 'SECURITY DEPOSIT RECEIPT', titleAr: 'إيصال استلام التأمين',
      receiptNo: `RCP-${contract.ref}-DEP`, date: sel.transactionDate, single: sel,
      lines: [{ desc: 'Refundable Security Deposit', net: gross, vat: 0, total: gross }] };
  }
  if (type === 'admin_fee') {
    return { kind: 'fee', title: 'FEE RECEIPT', titleAr: 'إيصال رسوم',
      receiptNo: `RCP-${contract.ref}-ADM`, date: sel.transactionDate, single: sel,
      lines: [{ desc: sel.description || 'Administration Fee', net, vat, total: gross }] };
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
    lines.push({ desc: `Rent — Instalment ${ordinal} of ${n}`, net: rentNet, vat, total: rentNet + vat });
  } else {
    lines.push({ desc: `Rent — Instalment ${ordinal} of ${n}`, net, vat, total: gross });
  }

  return { kind: 'rent', title: 'RENT RECEIPT', titleAr: 'إيصال إيجار',
    receiptNo: `RCP-${contract.ref}-${String(ordinal).padStart(2, '0')}`, date: sel.transactionDate, single: sel, lines };
}

function buildContractReceipt(contract: ReceiptContract, payments: ReceiptPayment[]): Receipt | null {
  const nonDeposit = payments.filter(p => !isDeposit(p));
  if (nonDeposit.length === 0) return null;
  const sumGross = round2(nonDeposit.reduce((s, p) => s + (p.amount || 0), 0));
  const sumVat = round2(nonDeposit.reduce((s, p) => s + (p.vatAmount || 0), 0));
  const sumNet = round2(sumGross - sumVat);
  const annualRent = contract.annualRent ?? 0;
  const feesPlusComm = round2(sumNet - annualRent);
  const { admin, ejari } = normalizeFees(contract.adminFeeFils ?? 0, contract.ejariFeeFils ?? 0, feesPlusComm);
  const commissionRaw = round2(feesPlusComm - admin - ejari);
  const commission = commissionRaw >= 1 ? commissionRaw : 0;
  const rentNet = Math.max(0, round2(sumNet - admin - ejari - commission));

  const lines: LineItem[] = [];
  if (admin > 0) lines.push({ desc: 'Administration Fee', net: admin, vat: 0, total: admin });
  if (ejari > 0) lines.push({ desc: 'Ejari Registration Fee', net: ejari, vat: 0, total: ejari });
  if (commission > 0) lines.push({ desc: 'Agency Commission', net: commission, vat: 0, total: commission });
  lines.push({ desc: 'Rent (full lease term)', net: rentNet, vat: sumVat, total: round2(rentNet + sumVat) });

  return { kind: 'contract', title: 'CONTRACT PAYMENT RECEIPT', titleAr: 'إيصال دفعات العقد',
    receiptNo: `RCP-${contract.ref}-PAY`, date: nonDeposit[0]?.transactionDate ?? null, lines, scheduleCount: nonDeposit.length };
}

/** Resolve the deposit pseudo-payment from the entity / held amount / column. */
function resolveDeposit(contract: ReceiptContract): ReceiptPayment | undefined {
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
  const rentals = payments.filter(isRental);
  if (kind === 'contract') return buildContractReceipt(contract, payments);
  if (kind === 'deposit') {
    const dep = resolveDeposit(contract);
    return dep ? buildSingleReceipt(dep, contract, rentals) : null;
  }
  let sel: ReceiptPayment | undefined;
  if (selectedId != null) sel = payments.find(p => p.id === selectedId);
  if (!sel) sel = payments[Math.min(Math.max(selectedIdx, 0), Math.max(payments.length - 1, 0))];
  return sel ? buildSingleReceipt(sel, contract, rentals) : null;
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

function PaymentReceiptDoc({ contract, kind, selectedId, selectedIdx }: Props) {
  const receipt = resolveReceipt(contract, kind, selectedId, selectedIdx);

  if (!receipt) {
    return (
      <Document>
        <Page size="A4" style={st.page}>
          <Text style={{ marginTop: 40, textAlign: 'center', color: MUTE }}>
            {kind === 'deposit' ? 'No security deposit is recorded for this contract.' : 'No payment is available to receipt for this contract yet.'}
          </Text>
        </Page>
      </Document>
    );
  }

  const subtotal = round2(receipt.lines.reduce((s, l) => s + l.net, 0));
  const totalVat = round2(receipt.lines.reduce((s, l) => s + l.vat, 0));
  const grandTotal = round2(receipt.lines.reduce((s, l) => s + l.total, 0));
  const showVat = totalVat > 0;
  const single = receipt.single;
  const landlordName = contract.landlord.companyName || contract.landlord.name || '';
  const propertyDesc = [contract.property.buildingName, contract.unit.number || contract.unit.name, contract.property.community || contract.property.emirate].filter(Boolean).join(', ');

  const heroStatus = single
    ? statusLabel(single.chequeStatus, contract.pdcConfirmed)
    : 'Receipt';
  const issuerLines = [
    (contract.landlord.licenseNumber || contract.landlord.licenseAuthority)
      ? `Licence ${contract.landlord.licenseNumber || '—'}${contract.landlord.licenseAuthority ? ` · ${contract.landlord.licenseAuthority}` : ''}` : null,
    contract.landlord.phone ? `Tel ${contract.landlord.phone}` : null,
    contract.landlord.email,
  ].filter(Boolean) as string[];

  return (
    <Document title={receipt.receiptNo}>
      <Page size="A4" style={st.page}>

        {/* ── Header band (full-bleed) ── */}
        <View style={{ backgroundColor: HEADER, paddingHorizontal: PAD, paddingTop: 26, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ maxWidth: '56%' }}>
            <Text style={{ fontSize: 15, color: '#fff', fontWeight: 700 }}>{landlordName}</Text>
            {issuerLines.map((l, i) => <Text key={i} style={{ fontSize: 7.5, color: HEADER_SUB, marginTop: 2 }}>{l}</Text>)}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 8, color: '#fff', letterSpacing: 2 }}>{receipt.title}</Text>
            <Text style={{ fontSize: 9, color: HEADER_SUB, fontFamily: AR, marginBottom: 9 }}>{receipt.titleAr}</Text>
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
            <Text style={{ fontSize: 10, color: INK, fontWeight: 500 }}>{contract.tenant.name || '—'}</Text>
            {contract.tenant.emiratesId ? <Text style={{ fontSize: 8, color: MUTE, marginTop: 2 }}>Emirates ID {contract.tenant.emiratesId}</Text> : null}
            {contract.tenant.phone ? <Text style={{ fontSize: 8, color: MUTE }}>{contract.tenant.phone}</Text> : null}
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
              <Text style={[st.td, { flex: 1, color: INK }]}>{l.desc}</Text>
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

        {/* ── Payment details ── */}
        <View style={{ paddingHorizontal: PAD, paddingTop: 18 }}>
          <Text style={[st.metaLbl, { marginBottom: 7 }]}>Payment Details</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {single ? <Detail label="Method" value={methodLabel(single, contract)} /> : <Detail label="Mode" value={titleCase(contract.modeOfPayment) || 'Cheque'} />}
            {single ? <Detail label="Cheque / Ref" value={single.chequeNumber} /> : <Detail label="No. of Cheques" value={String(receipt.scheduleCount ?? contract.numberOfInstallments ?? '—')} />}
            {single ? <Detail label="Value Date" value={fmtDate(single.transactionDate)} /> : null}
          </View>
        </View>

        {/* ── System-generated note ── */}
        <View style={{ paddingHorizontal: PAD, paddingTop: 14 }}>
          <View style={{ borderTopWidth: 1, borderTopColor: LINE, paddingTop: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 8.5, color: INK, fontWeight: 500 }}>This is a system-generated receipt — valid without a signature or stamp.</Text>
            <Text style={{ fontSize: 8, color: MUTE, fontFamily: AR, marginTop: 3 }}>هذا إيصال صادر آليًا عن النظام، وهو صالح بدون توقيع أو ختم.</Text>
            <Text style={{ fontSize: 7.5, color: MUTE, marginTop: 5 }}>Please retain this receipt against tenancy contract {contract.ref} for your records.</Text>
          </View>
        </View>

        {/* Footer */}
        <Text fixed style={{ position: 'absolute', bottom: 14, left: PAD, right: PAD, textAlign: 'center', fontSize: 7, color: MUTE }}>
          UpNow Property Management · {receipt.receiptNo} · Contract {contract.ref}
        </Text>
      </Page>
    </Document>
  );
}

// ─── Full-screen viewer (default export) ──────────────────────────────────────

const VIEWER_WRAP = { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#52555a' } as const;
const VIEWER_BAR = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #ddd', gap: 12, flexWrap: 'wrap' } as const;
const CLOSE_BTN = { padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' } as const;
const DL_BTN = { padding: '6px 16px', background: NAVY, color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none' } as const;

export default function PaymentReceiptViewer({ contract, kind, selectedId, selectedIdx }: Props) {
  const doc = <PaymentReceiptDoc contract={contract} kind={kind} selectedId={selectedId} selectedIdx={selectedIdx} />;
  const receipt = resolveReceipt(contract, kind, selectedId, selectedIdx);
  const fileName = `${receipt?.receiptNo ?? `receipt-${contract.ref}`}.pdf`;

  // Tabs across the receiptable views (same-page query nav).
  const payments = contract.payments ?? [];
  const rentals = payments.filter(isRental);
  const hasDeposit = payments.some(isDeposit) || (contract.securityDeposit?.amount ?? 0) > 0
    || (contract.securityDepositHeld ?? 0) > 0 || (contract.securityDepositAmount ?? 0) > 0;
  const tab = (active: boolean): React.CSSProperties => ({ margin: '0 3px', color: active ? NAVY : '#9ca3af', fontWeight: active ? 700 : 400, textDecoration: 'none', fontSize: 12 });

  return (
    <div style={VIEWER_WRAP}>
      <div style={VIEWER_BAR}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{receipt ? titleCase(receipt.title) : 'Receipt'} — {receipt?.receiptNo ?? contract.ref}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>System-generated payment receipt</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            <a href="?kind=contract" style={tab(receipt?.kind === 'contract')}>Contract</a>
            {hasDeposit && <a href="?kind=deposit" style={tab(receipt?.kind === 'deposit')}>Deposit</a>}
            {rentals.map((p, i) => (
              <a key={p.id} href={`?pid=${p.id}`} style={tab(receipt?.kind === 'rent' && receipt?.single?.id === p.id)}>#{i + 1}</a>
            ))}
          </span>
          <button onClick={() => window.history.back()} style={CLOSE_BTN}>✕ Close</button>
          <PDFDownloadLink document={doc} fileName={fileName} style={DL_BTN}>
            {({ loading }) => (loading ? '⏳ Preparing…' : '⬇ Download PDF')}
          </PDFDownloadLink>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <PDFViewer width="100%" height="100%" style={{ border: 'none' }} showToolbar>{doc}</PDFViewer>
      </div>
    </div>
  );
}
