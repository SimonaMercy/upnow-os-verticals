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
import { InlineDownloadRow } from '@/components/contract/InlineDownloadRow';
import { leaseDocFileName } from '@/lib/leaseDocName';
import { isVatCheque, isTaxCharge } from '@/lib/chargeTax';

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
  /** The cheque this row was recorded against — one that bounced, or one the
   *  customer swapped (migration 0184 / 0245). A customer handed a SECOND
   *  receipt for an instalment they thought they had already paid needs the
   *  receipt itself to say why, or it reads as being billed twice. */
  replacesPaymentId?: number | null;
  /** Why a cancelled cheque was cancelled (0245) — 'replaced' says the customer
   *  swapped it, which is what makes the two receipts one story. */
  cancellationReason?: string | null;
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
    /** security_deposits.id — the register row this deposit is booked in. Keys the
     *  deposit's issued receipt number (minted with source_kind='deposit'). */
    depositId?: number | null;
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
  tenant: {
    name: string | null;
    companyName?: string | null;
    entityType?: string | null;
    emiratesId?: string | null;
    licenseNumber?: string | null;
    licenseAuthority?: string | null;
    /** FTA Tax Registration Number — printed under "Billed To" only when set. */
    vatTrn?: string | null;
    phone?: string | null;
  };
  unit: { number: string | null; name: string | null };
  property: { buildingName: string | null; community?: string | null; emirate?: string | null; fullAddress?: string | null };
  payments?: ReceiptPayment[];
  /** RP reconciliation references — the SAME numbers on every surface: the RP /
   *  manager refs endpoint, the customer contract payload and the magic-link portal
   *  all shape them through lib/paymentRefs. When present a receipt prints its REAL
   *  gapless number (RCP-<rp>-<year>-<nnnnn>) instead of the derived RCP-<ref>-*
   *  label, and aggregate statements carry the plan number. */
  paymentRefs?: {
    planRefNo?: string | null;
    /** payments.id → gapless receipt number. */
    receiptByPaymentId?: Record<number, string>;
    /** security_deposits.id → gapless receipt number. The backend mints a
     *  register-booked deposit with source_kind='deposit', so its number lives in
     *  a SEPARATE id space and must never be looked up by payments.id. */
    receiptByDepositId?: Record<number, string>;
    /** The contract's single register-booked deposit receipt, for surfaces that
     *  don't carry the register row's id. */
    depositReceipt?: { depositId: number; refNo: string; voided: boolean } | null;
    /** payments.id whose receipt was soft-voided (cheque reverted from cleared) —
     *  the number is retained but the receipt is stamped VOID and reads as unpaid. */
    voidedPaymentIds?: Set<number>;
    /** security_deposits.id whose receipt was soft-voided — same semantics. */
    voidedDepositIds?: Set<number>;
  } | null;
}

interface Props {
  contract: ReceiptContract;
  selectedId?: number | null;
  selectedIdx?: number;
  kind?: 'deposit' | 'contract' | 'rental' | 'management' | 'vat' | 'charges' | 'replacements' | 'all' | null;
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
/**
 * What the customer is charged when a cheque FAILS — the bank returning it, the
 * customer swapping it before it is banked, or deferring it.
 *
 * These are not management fees. An administration fee is what the landlord
 * charges to set a tenancy up; a bounce penalty is what it charges because
 * something went wrong, and putting the two on one "Management Fee" page tells
 * the customer they were billed for administration when they were billed for a
 * returned cheque. They print on their own page, named for the cheque that
 * caused them.
 *
 * Before this they printed NOWHERE. A `cheque_replacement_fee` row is filed by
 * the API under `fees` (it is in FEE_PAYMENT_TYPES), but every builder here read
 * `isFee`, which listed three types and not these — so contract 178's AED 500
 * fee was issued a real gapless number, RCP-2-2026-00384, that appeared on no
 * document anybody could hand over.
 */
const CHEQUE_CHARGE_TYPES = new Set(['bounced_cheque_fee', 'cheque_replacement_fee', 'cheque_deferral_fee']);
function isChequeCharge(p: ReceiptPayment): boolean {
  return CHEQUE_CHARGE_TYPES.has((p.paymentType ?? '').toLowerCase());
}
const CHEQUE_CHARGE_LABEL: Record<string, string> = {
  bounced_cheque_fee: 'Bounced Cheque Charge',
  cheque_replacement_fee: 'Cheque Replacement Charge',
  cheque_deferral_fee: 'Cheque Deferral Charge',
};
/** VAT collected as its own cheque (Rental VAT / Fees VAT), payment_type 'vat'. */
const isVat = isVatCheque;
/** Government / other pass-through charges printed under the receipt's Government
 *  Fee section: VAT cheques ('vat') AND custom "Other" charges ('other' — per-unit
 *  taxes like "20% VAT on Rent", service charges like "Fire Fighting"). These are
 *  NOT rental income — mirrors the Payments ledger, where 'other' is its own
 *  category, not rent. Kept out of isRental below so they never inflate rent. */
const GOVT_TYPES = new Set(['vat', 'other']);
/**
 * Third Party — every pass-through the RP collects but does not earn: VAT cheques
 * ("Fees VAT", "Rental VAT"), the sub-lease levy and its tax, service charges.
 *
 * VAT is SEGREGATED here, all of it, on one receipt (user decision, 8 Aug 2026) —
 * the same rule that moved `vat_rental` out of Rental Income and that already
 * files the sub-lease pass-throughs ("5% VAT on sub-lease") under Third Party. So
 * the Rental Income and Management Fee receipts carry NET only: the fees' tax
 * rides its own "Fees VAT" cheque and prints here beside the other tax lines.
 */
function isGovernment(p: ReceiptPayment): boolean {
  return GOVT_TYPES.has((p.paymentType ?? '').toLowerCase());
}
function isRental(p: ReceiptPayment): boolean {
  const t = (p.paymentType ?? '').toLowerCase();
  // Cheque charges are excluded explicitly. This function decides by exclusion,
  // so any type it has not been told about falls through to RENT — which would
  // have printed a bounce penalty as rental income had one of these rows ever
  // been filed under `payments` instead of `fees`.
  return t !== 'security_deposit' && !GOVT_TYPES.has(t) && !FEE_TYPES.has(t) && !CHEQUE_CHARGE_TYPES.has(t);
}
const FEE_LABEL: Record<string, string> = {
  admin_fee: 'Administration Fee', ejari_fee: 'Contract Registration Fee', commission: 'Commission',
};
function isDeposit(p: ReceiptPayment): boolean {
  return (p.paymentType ?? '').toLowerCase() === 'security_deposit';
}
/** Renewals carry the deposit from the original lease (read-only, never re-collected),
 *  so a renewal issues no security-deposit receipt — only rental income & management fee. */
function isRenewalContract(c: ReceiptContract): boolean {
  return (c.contractType ?? '').toLowerCase() === 'renewal';
}

interface LineItem {
  desc: string; net: number; vat: number; total: number;
  date?: string | null; method?: string | null; reference?: string | null;
  /** The gapless receipt number issued for THIS line's money event. Printed on the
   *  line whenever it differs from the document's own header number, so an
   *  aggregate statement traces every amount to its own receipt instead of
   *  repeating one plan number. */
  receiptNo?: string | null;
  /** That receipt was soft-voided (its cheque was reverted from cleared) — the
   *  number is retained, so say so rather than presenting it as money received. */
  receiptVoided?: boolean;
}
interface Receipt {
  kind: 'deposit' | 'rent' | 'fee' | 'contract' | 'rental' | 'management' | 'vat' | 'charges' | 'replacements';
  title: string;
  receiptNo: string;
  /** receiptNo is the payment-plan number (PP-*) rather than a receipt number
   *  (RCP-*) — the header must label it "PLAN REF", not "RECEIPT NO.". */
  numberIsPlanRef?: boolean;
  date: string | null;
  lines: LineItem[];
  single?: ReceiptPayment;
  scheduleCount?: number;
}

/**
 * Per-segment reference, derived from the payment plan number.
 *
 * A statement page has no money event of its own to number, so it falls back to
 * the plan. Without a suffix all four pages printed the IDENTICAL plan number —
 * most visibly on a lease where nothing has cleared yet, where there is no issued
 * receipt number anywhere to tell them apart. The base stays the real plan ref, so
 * a suffixed reference still reconciles straight back to the plan.
 */
const SEG_SUFFIX = { rental: 'R', deposit: 'D', management: 'M', vat: 'T', contract: 'C', charges: 'H', replacements: 'P' } as const;
function planSegRef(contract: ReceiptContract, seg: keyof typeof SEG_SUFFIX): string | null {
  const plan = contract.paymentRefs?.planRefNo;
  return plan ? `${plan}/${SEG_SUFFIX[seg]}` : null;
}

/**
 * The issued gapless number for the contract's SECURITY DEPOSIT.
 *
 * A deposit is booked one of two ways, each numbered in its own id space:
 *   • as a `payments` row (legacy bookings)   → source_kind='payment', payments.id
 *   • in the `security_deposits` register     → source_kind='deposit', deposit id
 * Check both — looking only in receiptByPaymentId (as this did) silently missed
 * every register-booked deposit, so the deposit page always printed a derived
 * label while the rest of the binder showed the real series.
 *
 * Returns `{ plan: true }` when it can only fall back to the plan number, so the
 * header labels it PLAN REF instead of passing a PP-* off as a receipt number.
 */
function depositRefNo(contract: ReceiptContract, sel: ReceiptPayment): { no: string; plan: boolean } | null {
  const r = contract.paymentRefs;
  if (!r) return null;
  // sel.id is -1 for the pseudo-row synthesised when the deposit has no payments row.
  const byPayment = sel.id > 0 ? r.receiptByPaymentId?.[sel.id] : undefined;
  const depositId = contract.securityDeposit?.depositId;
  const byDeposit = depositId != null
    ? r.receiptByDepositId?.[depositId]
    : r.depositReceipt?.refNo;
  const no = byPayment ?? byDeposit;
  if (no) return { no, plan: false };
  const seg = planSegRef(contract, 'deposit');
  return seg ? { no: seg, plan: true } : null;
}

/**
 * "Replaces cheque #000023, swapped" — the sentence that stops a second receipt
 * for the same instalment reading as a second bill.
 *
 * When a cheque fails, the customer pays that instalment again by another means
 * and receives a receipt for it. Without this line they hold two receipts of the
 * same amount for the same month and no way to tell they are one payment. The
 * cheque it names is looked up among the contract's own rows, so the number
 * printed is the one on the paper they handed over.
 */
function replacesCaption(row: ReceiptPayment, contract: ReceiptContract): string | null {
  if (row.replacesPaymentId == null) return null;
  const target = [...(contract.payments ?? []), ...(contract.fees ?? [])]
    .find(p => p.id === row.replacesPaymentId);
  if (!target) return 'Replaces an earlier cheque';
  const what = target.chequeNumber ? `cheque #${target.chequeNumber}` : `payment #${target.id}`;
  const how = (target.chequeStatus ?? '').toLowerCase() === 'bounced'
    ? 'returned unpaid'
    : (target.cancellationReason ?? '').toLowerCase() === 'replaced'
      ? 'swapped before it was banked'
      : 'no longer in the schedule';
  return `Replaces ${what} — ${how}`;
}

/**
 * The money paid to make good a cheque that failed — its own receipt.
 *
 * When a cheque bounces or the customer swaps it, the instalment is paid again
 * by another means. That is NEW money on a NEW date by a NEW method, and it
 * takes its own receipt: adding it to the Rent Income page would re-issue a
 * document the customer already holds, with a different total and no way for
 * them to see what moved. A separate receipt says exactly one thing — "we
 * received this, against that cheque" — which is what they need to file.
 *
 * Each line names the cheque it replaced, so the pair reads as one story from
 * either end.
 */
function buildReplacementReceipt(contract: ReceiptContract, rentals: ReceiptPayment[]): Receipt | null {
  const rows = rentals.filter(p => p.replacesPaymentId != null);
  if (!rows.length) return null;
  const lines: LineItem[] = rows.map(p => {
    const gross = p.amount || 0;
    const vat = p.vatAmount || 0;
    return {
      desc: replacesCaption(p, contract) ?? 'Replacement payment',
      net: Math.max(0, round2(gross - vat)), vat, total: gross,
      date: p.transactionDate ?? null,
      method: methodLabel(p, contract), reference: p.chequeNumber ?? null,
      receiptNo: contract.paymentRefs?.receiptByPaymentId?.[p.id] ?? null,
      receiptVoided: !!contract.paymentRefs?.voidedPaymentIds?.has(p.id),
    };
  });
  const seg = planSegRef(contract, 'replacements');
  return {
    kind: 'replacements', title: 'REPLACEMENT PAYMENTS RECEIPT',
    receiptNo: seg ?? `RCP-${contract.ref}-REP`, numberIsPlanRef: !!seg,
    date: lines[0]?.date ?? null, lines,
  };
}

/**
 * The charges raised because a cheque failed, as their own receipt.
 *
 * One page for the lease, a line per charge, each naming the cheque it was
 * raised for. Nothing is invented: a charge appears here only if it exists as a
 * row, and only cleared rows carry an issued receipt number.
 */
function buildChequeChargeReceipt(contract: ReceiptContract): Receipt | null {
  const rows = [...(contract.payments ?? []), ...(contract.fees ?? [])].filter(isChequeCharge);
  if (!rows.length) return null;
  const lines: LineItem[] = rows.map(r => {
    const gross = r.amount || 0;
    const vat = r.vatAmount || 0;
    const against = replacesCaption(r, contract);
    return {
      desc: [r.description || CHEQUE_CHARGE_LABEL[(r.paymentType ?? '').toLowerCase()] || 'Cheque charge',
        against].filter(Boolean).join(' · '),
      net: round2(gross - vat), vat, total: gross,
      date: r.transactionDate ?? null,
      method: methodLabel(r, contract), reference: r.chequeNumber ?? null,
      receiptNo: contract.paymentRefs?.receiptByPaymentId?.[r.id] ?? null,
      receiptVoided: contract.paymentRefs?.voidedPaymentIds?.has(r.id) ?? false,
    };
  });
  const seg = planSegRef(contract, 'charges');
  return {
    kind: 'charges', title: 'CHEQUE CHARGES RECEIPT',
    receiptNo: seg ?? `RCP-${contract.ref}-CHG`, numberIsPlanRef: !!seg,
    date: lines[0]?.date ?? null, lines,
  };
}

function buildSingleReceipt(sel: ReceiptPayment, contract: ReceiptContract, rentals: ReceiptPayment[]): Receipt {
  const type = (sel.paymentType ?? '').toLowerCase();
  const gross = sel.amount || 0;
  const vat = sel.vatAmount || 0;
  const net = Math.max(0, gross - vat);
  // The real, issued gapless receipt number for this payment (once cleared),
  // falling back to the derived label for un-receipted / preview rows.
  const realNo = contract.paymentRefs?.receiptByPaymentId?.[sel.id];
  // Payment method + cheque/ref travel ON the line item (shown inline under the
  // description), so every receipt states how each amount was paid without a
  // separate "Payment Details" block.
  const meta = { method: methodLabel(sel, contract), reference: sel.chequeNumber ?? null };

  if (type === 'security_deposit') {
    const dep = depositRefNo(contract, sel);
    return { kind: 'deposit', title: 'SECURITY DEPOSIT RECEIPT',
      receiptNo: dep?.no ?? `RCP-${contract.ref}-DEP`, numberIsPlanRef: dep?.plan,
      date: sel.transactionDate, single: sel,
      lines: [{ desc: 'Security Deposit', net: gross, vat: 0, total: gross, date: sel.transactionDate ?? null, ...meta }] };
  }
  if (isFee(sel)) {
    const code = type === 'ejari_fee' ? 'EJR' : type === 'commission' ? 'COM' : 'ADM';
    return { kind: 'fee', title: 'FEE RECEIPT',
      receiptNo: realNo ?? `RCP-${contract.ref}-${code}`, date: sel.transactionDate, single: sel,
      lines: [{ desc: sel.description || FEE_LABEL[type] || 'Fee', net, vat, total: gross, date: sel.transactionDate ?? null, ...meta }] };
  }
  if (isChequeCharge(sel)) {
    // Its own title, not "FEE RECEIPT" — the customer is being charged because a
    // cheque failed, and the document should say so rather than reading like
    // another administration fee.
    const against = replacesCaption(sel, contract);
    return { kind: 'charges', title: 'CHEQUE CHARGE RECEIPT',
      receiptNo: realNo ?? `RCP-${contract.ref}-CHG`, date: sel.transactionDate, single: sel,
      lines: [{
        desc: [sel.description || CHEQUE_CHARGE_LABEL[type] || 'Cheque charge', against].filter(Boolean).join(' · '),
        net, vat, total: gross, date: sel.transactionDate ?? null, ...meta,
      }] };
  }
  if (isGovernment(sel)) {
    // A pure VAT cheque — or an "Other" charge whose label declares it tax at the
    // standard rate — is entirely tax (net 0, vat = gross). Any other custom
    // charge carries its own net + whatever VAT it was entered with (usually 0),
    // so show its real split — never as net-0 VAT, and never as rent.
    const govVat = isTaxCharge(sel) ? gross : vat;
    const govNet = round2(gross - govVat);
    // Every tax row — the "Fees VAT" cheque included — is a Third Party charge.
    return { kind: 'fee', title: 'THIRD PARTY RECEIPT',
      receiptNo: realNo ?? `RCP-${contract.ref}-VAT`, date: sel.transactionDate, single: sel,
      lines: [{ desc: sel.description || (isVat(sel) ? 'VAT' : 'Government charge'), net: govNet, vat: govVat, total: gross, date: sel.transactionDate ?? null, ...meta }] };
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
    if (ejari > 0) lines.push({ desc: 'Contract Registration Fee', net: ejari, vat: 0, total: ejari });
    const rentNet = Math.max(0, net - admin - ejari);
    lines.push({ desc: `Rent — Installment ${ordinal} of ${n}`, net: rentNet, vat, total: rentNet + vat, date: sel.transactionDate ?? null, ...meta });
  } else {
    lines.push({ desc: `Rent — Installment ${ordinal} of ${n}`, net, vat, total: gross, date: sel.transactionDate ?? null, ...meta });
  }

  return { kind: 'rent', title: 'RENT RECEIPT',
    receiptNo: realNo ?? `RCP-${contract.ref}-${String(ordinal).padStart(2, '0')}`, date: sel.transactionDate, single: sel, lines };
}

/** The Management-Fee lines (Admin / Ejari / Commission), each net + VAT — read
 *  from the real one-off fee rows when present, else reconstructed from the legacy
 *  bundled columns. Also returns `legacyBundle` = the admin+ejari amount that was
 *  folded into the FIRST rent cheque on legacy contracts, so the Rent receipt can
 *  strip it (and the combined receipt can net it out of rent). Commission is NEVER
 *  synthesised from a residual — it only appears from a real commission fee row. */
function feeLinesOf(contract: ReceiptContract, rentRows: ReceiptPayment[]): { lines: LineItem[]; legacyBundle: number; feeCount: number; ejariLine: LineItem | null } {
  const feeRows = (contract.fees ?? []).filter(isFee);
  // Real fee rows store the GROSS amount + their own vatAmount, so each fee shows
  // net / VAT / gross (stripping VAT to net would undercount the printed total).
  const grossOf = (rows: ReceiptPayment[]) => round2(rows.reduce((s, p) => s + (p.amount || 0), 0));
  const vatSumOf = (rows: ReceiptPayment[]) => round2(rows.reduce((s, p) => s + (p.vatAmount || 0), 0));
  const netOf = (rows: ReceiptPayment[]) => round2(rows.reduce((s, p) => s + Math.max(0, (p.amount || 0) - (p.vatAmount || 0)), 0));

  let adminNet = 0, adminVat = 0, ejariNet = 0, ejariVat = 0, commissionNet = 0, commissionVat = 0, legacyBundle = 0;
  let adminRow: ReceiptPayment | undefined, ejariRow: ReceiptPayment | undefined, commRow: ReceiptPayment | undefined;

  if (feeRows.length > 0) {
    // Real fee rows — read each fee (gross + VAT) directly from its own row(s).
    const feeOfType = (t: string) => feeRows.filter(p => (p.paymentType ?? '').toLowerCase() === t);
    const a = feeOfType('admin_fee'), e = feeOfType('ejari_fee'), c = feeOfType('commission');
    adminVat = vatSumOf(a); adminNet = round2(grossOf(a) - adminVat);
    ejariVat = vatSumOf(e); ejariNet = round2(grossOf(e) - ejariVat);
    commissionVat = vatSumOf(c); commissionNet = round2(grossOf(c) - commissionVat);
    // Representative row per fee → its cheque/ref + method for the line.
    adminRow = a[0]; ejariRow = e[0]; commRow = c[0];
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

  // Each fee line carries its own date · method · reference. Legacy fees were
  // folded into the rent cheques (no separate row) → fall back to the contract's
  // mode of payment so the "date - method" line is always present.
  const contractMethod = titleCase(contract.modeOfPayment) || 'Bank Transfer';
  const feeMeta = (row?: ReceiptPayment) => row
    ? { method: methodLabel(row, contract), reference: row.chequeNumber ?? null, date: row.transactionDate ?? null,
        receiptNo: contract.paymentRefs?.receiptByPaymentId?.[row.id] ?? null,
        receiptVoided: !!contract.paymentRefs?.voidedPaymentIds?.has(row.id) }
    : { method: contractMethod, reference: null, receiptNo: null, receiptVoided: false };
  // Management Fee receipt = Admin + Commission only. Ejari is shown IN FULL on the
  // Third Party receipt (buildVatReceipt), so it is returned separately here — never
  // added to the Management lines.
  const ejariGross = round2(ejariNet + ejariVat);
  const lines: LineItem[] = [];
  if (adminNet + adminVat > 0) lines.push({ desc: 'Administration Fee', net: adminNet, vat: adminVat, total: round2(adminNet + adminVat), ...feeMeta(adminRow) });
  if (commissionNet + commissionVat > 0) lines.push({ desc: 'Commission', net: commissionNet, vat: commissionVat, total: round2(commissionNet + commissionVat), ...feeMeta(commRow) });
  const ejariLine: LineItem | null = ejariGross > 0
    ? { desc: 'Contract Registration Fee', net: ejariNet, vat: ejariVat, total: ejariGross, ...feeMeta(ejariRow) }
    : null;
  return { lines, legacyBundle, feeCount: feeRows.length, ejariLine };
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
  // THE RENT RECEIPT IS THE SCHEDULE, and only the schedule. The instalments the
  // lease was agreed at, each at its own value, numbered 1..N.
  //
  // A REPLACEMENT IS NOT AN INSTALMENT. When a cheque fails the customer pays
  // that instalment again, so the lease carries more rent rows than it has
  // instalments. Listing them here printed "Installment 5 of 4" and totalled one
  // instalment twice — AED 61,875 on a lease of four 12,375 cheques, on a
  // document headed "AMOUNT RECEIVED" and handed to the customer.
  //
  // They are not merely re-labelled here, they are REMOVED: a receipt already
  // issued for a lease must not change because something happened afterwards.
  // The replacement is new money and takes a new receipt of its own
  // (buildReplacementReceipt), which is where it belongs — a customer given a
  // corrected copy of a document they already hold cannot tell what changed,
  // whereas a second document is unambiguous.
  const scheduled = rentals.filter(p => p.replacesPaymentId == null);
  const lines: LineItem[] = scheduled.map((p, i) => {
    const gross = p.amount || 0;
    const vat = p.vatAmount || 0;
    let net = Math.max(0, round2(gross - vat));
    if (i === 0 && legacyBundle > 0) net = Math.max(0, round2(net - legacyBundle));
    // The instalment keeps its agreed value whatever became of the cheque —
    // this page states what the tenancy was agreed at. What became of it is
    // said in a note, which changes no figure: a receipt that reads "paid by
    // cheque 000023" without qualification, when that cheque was handed back,
    // would be untrue.
    const status = (p.chequeStatus ?? '').toLowerCase();
    const failed = status === 'bounced' ? 'this cheque was returned unpaid — see the Replacements receipt'
      : status === 'cancelled' && (p.cancellationReason ?? '').toLowerCase() === 'replaced'
        ? 'this cheque was swapped — see the Replacements receipt'
      : status === 'cancelled' ? 'this cheque was cancelled' : null;
    return {
      desc: `Rent — Installment ${i + 1} of ${n}${failed ? ` (${failed})` : ''}`,
      net, vat, total: round2(net + vat),
      date: p.transactionDate ?? null,
      method: methodLabel(p, contract), reference: p.chequeNumber ?? null,
      receiptNo: contract.paymentRefs?.receiptByPaymentId?.[p.id] ?? null,
      receiptVoided: !!contract.paymentRefs?.voidedPaymentIds?.has(p.id) };
  });
  if (!lines.length) return null;
  // Aggregate statement → reference the payment plan (each cleared cheque carries
  // its own gapless receipt number on its line); never a fake "-RENT" number.
  return { kind: 'rental', title: 'RENT INCOME RECEIPT',
    receiptNo: planSegRef(contract, 'rental') ?? `RCP-${contract.ref}-RENT`,
    numberIsPlanRef: !!contract.paymentRefs?.planRefNo,
    date: rentals[0]?.transactionDate ?? contract.startDate ?? null,
    lines, scheduleCount: rentals.length };
}

/** One government / pass-through charge as a receipt line. A pure VAT cheque — or
 *  an "Other" charge whose label declares it tax at the standard rate — is 100%
 *  tax (net 0); every other custom charge keeps its own net + VAT split so it is
 *  never mislabelled as pure VAT. */
function govLine(p: ReceiptPayment, contract: ReceiptContract): LineItem {
  const gross = round2(p.amount || 0);
  const vat = isTaxCharge(p) ? gross : round2(p.vatAmount || 0);
  return {
    desc: p.description || (isVat(p) ? 'VAT' : 'Government charge'),
    net: round2(gross - vat), vat, total: gross,
    date: p.transactionDate ?? null,
    method: methodLabel(p, contract), reference: p.chequeNumber ?? null,
    receiptNo: contract.paymentRefs?.receiptByPaymentId?.[p.id] ?? null,
    receiptVoided: !!contract.paymentRefs?.voidedPaymentIds?.has(p.id),
  };
}

/** MANAGEMENT FEE receipt — Admin / Commission NET, mirroring the Payments
 *  ledger's Management Fee category. Their tax rides the "Fees VAT" cheque, which
 *  prints on the Third Party receipt with every other tax line (isGovernment).
 *  (Ejari is a Third Party charge too — see buildVatReceipt.) */
function buildManagementReceipt(contract: ReceiptContract, rentRows: ReceiptPayment[]): Receipt | null {
  const { lines, feeCount } = feeLinesOf(contract, rentRows);
  if (lines.length === 0) return null;
  const feeRows = (contract.fees ?? []).filter(isFee);
  return { kind: 'management', title: 'MANAGEMENT FEE RECEIPT',
    receiptNo: planSegRef(contract, 'management') ?? `RCP-${contract.ref}-MGMT`,
    numberIsPlanRef: !!contract.paymentRefs?.planRefNo,
    date: feeRows[0]?.transactionDate ?? rentRows[0]?.transactionDate ?? contract.startDate ?? null,
    lines, scheduleCount: feeCount || lines.length };
}

/** GOVERNMENT — VAT receipt. The separate rent/fee VAT cheques (new model), each
 *  a pass-through federal tax carrying its own gapless receipt number. Grouped
 *  under the binder's "Government" section (VAT is a government charge, not rent
 *  income or a management fee). Null for legacy contracts with no vat rows. */
function buildVatReceipt(contract: ReceiptContract): Receipt | null {
  // Smallest → largest, so the section reads tax/small charges up to the biggest
  // (e.g. 5% Tax on VAT · Fire Fighting · 5% VAT on Rent · 20% VAT on Rent).
  // Every tax row lands here, "Fees VAT" included — all VAT is segregated onto
  // this one receipt, so no other page carries a VAT figure.
  const govRows = (contract.payments ?? []).filter(isGovernment)
    .slice().sort((a, b) => (a.amount || 0) - (b.amount || 0));
  // Ejari is shown IN FULL on this Third Party receipt (not split), ALWAYS on top.
  const rentRows = (contract.payments ?? []).filter(isRental);
  const { ejariLine } = feeLinesOf(contract, rentRows);
  if (govRows.length === 0 && !ejariLine) return null;
  const refOf = (p: ReceiptPayment) => contract.paymentRefs?.receiptByPaymentId?.[p.id] ?? null;
  const lines: LineItem[] = [];
  if (ejariLine) lines.push(ejariLine);
  for (const p of govRows) lines.push(govLine(p, contract));
  // A single charge prints its own gapless year-wise number as the header; multiple
  // aggregate under the plan number (each line still carries its own RCP number).
  const segRef = planSegRef(contract, 'vat');
  const header = lines.length === 1 && govRows.length === 1 ? (refOf(govRows[0]) ?? segRef) : segRef;
  return { kind: 'vat', title: 'THIRD PARTY RECEIPT',
    receiptNo: header ?? `RCP-${contract.ref}-TP`,
    numberIsPlanRef: !!header && header === segRef,
    date: ejariLine?.date ?? govRows[0]?.transactionDate ?? contract.startDate ?? null,
    lines, scheduleCount: lines.length };
}

function buildContractReceipt(contract: ReceiptContract, payments: ReceiptPayment[]): Receipt | null {
  // Legacy combined receipt: fee lines + a single rolled-up rent line. The binder
  // now links the three segmented receipts above; this is retained for old links.
  // VAT cheques (new model) are their own rows — keep them OUT of the rent line and
  // show a dedicated VAT line. Legacy contracts have no vat rows; their VAT stays
  // embedded in the rent cheques' vat_amount (rolled into the rent line below).
  const rentRows = payments.filter(p => !isDeposit(p) && !isFee(p) && !isGovernment(p));
  // All tax — fee VAT included — rolls up under "Government & other charges";
  // the fee lines stay NET, matching the segmented receipts.
  const vatRows = payments.filter(isGovernment);
  const feeRows = (contract.fees ?? []).filter(isFee);
  const { lines: feeLines, legacyBundle, feeCount, ejariLine } = feeLinesOf(contract, rentRows);
  if (rentRows.length === 0 && feeLines.length === 0 && vatRows.length === 0) return null;

  const netOf = (rows: ReceiptPayment[]) =>
    round2(rows.reduce((s, p) => s + Math.max(0, (p.amount || 0) - (p.vatAmount || 0)), 0));
  const rentVatEmbedded = round2(rentRows.reduce((s, p) => s + (p.vatAmount || 0), 0)); // legacy embedded
  // legacyBundle = admin+ejari folded into the rent cheques on legacy contracts;
  // 0 when real fee rows exist (those rents are already pure).
  const rentNet = Math.max(0, round2(netOf(rentRows) - legacyBundle));
  // Government/other charges: a tax row (a VAT cheque, or an "Other" charge labelled
  // as tax at the standard rate) is 100% tax; every other custom charge keeps its own
  // net + VAT split so it isn't mislabelled as pure VAT. Ejari is a Third Party charge
  // now — fold its FULL amount in here (feeLinesOf keeps it off the Management lines
  // and returns it as ejariLine).
  const govNet = round2(vatRows.reduce((s, p) => s + (isTaxCharge(p) ? 0 : Math.max(0, (p.amount || 0) - (p.vatAmount || 0))), 0) + (ejariLine?.net ?? 0));
  const govVat = round2(vatRows.reduce((s, p) => s + (isTaxCharge(p) ? (p.amount || 0) : (p.vatAmount || 0)), 0) + (ejariLine?.vat ?? 0));
  const govTotal = round2(govNet + govVat);

  const lines: LineItem[] = [...feeLines,
    { desc: 'Rent (full lease term)', net: rentNet, vat: rentVatEmbedded, total: round2(rentNet + rentVatEmbedded) }];
  if (govTotal > 0) lines.push({ desc: 'Government & other charges', net: govNet, vat: govVat, total: govTotal });

  return { kind: 'contract', title: 'CONTRACT PAYMENT RECEIPT',
    receiptNo: planSegRef(contract, 'contract') ?? `RCP-${contract.ref}-PAY`,
    numberIsPlanRef: !!contract.paymentRefs?.planRefNo,
    date: rentRows[0]?.transactionDate ?? feeRows[0]?.transactionDate ?? null,
    lines, scheduleCount: rentRows.length + vatRows.length + feeCount };
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
  // Cheque charges live in `fees` too and are NOT `isFee` — including them is
  // what lets `?pid=<chargeRowId>` resolve to its own receipt instead of falling
  // through to whatever payment happens to sit at that index.
  const all = [...payments, ...((contract.fees ?? []).filter(f => isFee(f) || isChequeCharge(f)))];
  const rentals = payments.filter(isRental);
  if (kind === 'contract') return buildContractReceipt(contract, payments);
  if (kind === 'rental') return buildRentalReceipt(contract, rentals);
  if (kind === 'management') return buildManagementReceipt(contract, rentals);
  if (kind === 'vat') return buildVatReceipt(contract);
  if (kind === 'charges') return buildChequeChargeReceipt(contract);
  if (kind === 'replacements') return buildReplacementReceipt(contract, rentals);
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

/** The segmented receipts (Rental Income · Security Deposit · Management Fee ·
 *  Government/VAT) in ledger order — only those with data. These become the
 *  pages of the combined document. */
function buildAllReceipts(contract: ReceiptContract): Receipt[] {
  const rentals = (contract.payments ?? []).filter(isRental);
  const out: Receipt[] = [];
  const rent = buildRentalReceipt(contract, rentals);
  if (rent) out.push(rent);
  // Directly after the schedule it corrects, and before the charge it caused.
  const repl = buildReplacementReceipt(contract, rentals);
  if (repl) out.push(repl);
  const dep = resolveDeposit(contract);
  if (dep) { const d = buildSingleReceipt(dep, contract, rentals); if (d) out.push(d); }
  const mgmt = buildManagementReceipt(contract, rentals);
  if (mgmt) out.push(mgmt);
  const charges = buildChequeChargeReceipt(contract);
  if (charges) out.push(charges);
  const vat = buildVatReceipt(contract);
  if (vat) out.push(vat);
  return out;
}

/** Is this a combined (all-three-pages) request? True when no single payment and
 *  no specific category is selected. */
function isCombined(kind: Props['kind'], selectedId?: number | null): boolean {
  return selectedId == null && (kind == null || kind === 'all');
}

/** A stable signature of the RP reconciliation refs, for the PDF doc key — changes
 *  when the plan number or any receipt number resolves, forcing regeneration. */
function receiptRefsSig(contract: ReceiptContract): string {
  const r = contract.paymentRefs;
  if (!r) return '';
  const ids = Object.keys(r.receiptByPaymentId ?? {}).sort().join('.');
  const depIds = Object.keys(r.receiptByDepositId ?? {}).sort().join('.');
  const voided = [...(r.voidedPaymentIds ?? [])].sort((a, b) => a - b).join('.');
  const voidedDeps = [...(r.voidedDepositIds ?? [])].sort((a, b) => a - b).join('.');
  return `${r.planRefNo ?? ''}#${ids}@${depIds}!${voided}~${voidedDeps}`;
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
    case 'Void': return { bg: '#fdecea', fg: '#b3261e' };           // voided receipt
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

// ─── The PDF document ─────────────────────────────────────────────────────────

/** One receipt rendered as a single A4 page — used standalone OR as one page of
 *  the combined three-receipt document. */
function ReceiptPage({ receipt, contract }: { receipt: Receipt; contract: ReceiptContract }) {
  const subtotal = round2(receipt.lines.reduce((s, l) => s + l.net, 0));
  const totalVat = round2(receipt.lines.reduce((s, l) => s + l.vat, 0));
  const grandTotal = round2(receipt.lines.reduce((s, l) => s + l.total, 0));
  const showVat = totalVat > 0;
  const single = receipt.single;
  // Aggregate statements (rent income / management fee / third party / legacy
  // combined) reference the payment plan, as does a receipt whose own number has
  // not been issued yet. Label what the number actually IS — printing a PP-* under
  // "RECEIPT NO." reads as a receipt number that doesn't exist.
  const numberLabel = receipt.numberIsPlanRef ? 'PLAN REF' : 'RECEIPT NO.';
  const landlordName = contract.landlord?.companyName || contract.landlord?.name || '';
  const isTenantCompany = contract.tenant?.entityType === 'company' || !!contract.tenant?.companyName;
  const tenantName = (isTenantCompany ? contract.tenant?.companyName : contract.tenant?.name) || contract.tenant?.name || '—';
  const tenantIdLine = isTenantCompany
    ? (contract.tenant?.licenseNumber || contract.tenant?.licenseAuthority)
      ? `Trade Licence ${contract.tenant?.licenseNumber || '—'}${contract.tenant?.licenseAuthority ? ` · ${contract.tenant.licenseAuthority}` : ''}`
      : null
    : contract.tenant?.emiratesId ? `Emirates ID ${contract.tenant.emiratesId}` : null;
  const propertyDesc = [contract.property?.buildingName, contract.unit?.number || contract.unit?.name, contract.property?.community || contract.property?.emirate].filter(Boolean).join(', ');

  // A receipt acknowledges money received. On the SECURITY DEPOSIT receipt an
  // un-cleared PDC reads as "Receipt" (the deposit is in hand) rather than the
  // ledger's "Collected (PDC)" / "Pending"; cleared/bounced/cancelled keep their label.
  // A soft-voided receipt (its cheque was reverted from cleared) keeps its gapless
  // number but no longer represents money received — stamp it VOID everywhere.
  // A register-booked deposit is voided by security_deposits.id, not payments.id.
  const depositId = contract.securityDeposit?.depositId ?? contract.paymentRefs?.depositReceipt?.depositId;
  const isVoided = !!single && (
    contract.paymentRefs?.voidedPaymentIds?.has(single.id)
    || (receipt.kind === 'deposit' && depositId != null && !!contract.paymentRefs?.voidedDepositIds?.has(depositId))
  );
  const rawStatus = single ? statusLabel(single.chequeStatus, contract.pdcConfirmed) : 'Receipt';
  const heroStatus = isVoided
    ? 'Void'
    : receipt.kind === 'deposit' && (rawStatus === 'Collected (PDC)' || rawStatus === 'Pending')
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

        {/* ── VOID watermark (soft-voided receipt: number retained, no money received) ── */}
        {isVoided ? (
          <View fixed style={{ position: 'absolute', top: 320, left: 0, right: 0, alignItems: 'center', transform: 'rotate(-24deg)' }}>
            <Text style={{ fontSize: 120, fontWeight: 700, color: 'rgba(179,38,30,0.10)', letterSpacing: 8 }}>VOID</Text>
          </View>
        ) : null}

        {/* ── Header band (full-bleed) ── */}
        <View style={{ backgroundColor: HEADER, paddingHorizontal: PAD, paddingTop: 26, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ maxWidth: '56%' }}>
            <Text style={{ fontSize: 15, color: '#fff', fontWeight: 700 }}>{landlordName}</Text>
            {issuerLines.map((l, i) => <Text key={i} style={{ fontSize: 7.5, color: HEADER_SUB, marginTop: 2 }}>{l}</Text>)}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {/* The segmented pages (rental income · security deposit · management
                fee · third party) are already named by the binder tab and the
                section they came from — the title in the band just repeated it. */}
            {!['rental', 'management', 'deposit', 'vat'].includes(receipt.kind)
              ? <Text style={{ fontSize: 8, color: '#fff', letterSpacing: 2, marginBottom: 9 }}>{receipt.title}</Text>
              : null}
            <View style={{ flexDirection: 'row', marginBottom: 2 }}>
              <Text style={{ fontSize: 7, color: HEADER_SUB, letterSpacing: 0.5, marginRight: 6 }}>{numberLabel}</Text>
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
            <Text style={{ fontSize: 10, color: INK, fontWeight: 500 }}>{tenantName}</Text>
            {tenantIdLine ? <Text style={{ fontSize: 8, color: MUTE, marginTop: 2 }}>{tenantIdLine}</Text> : null}
            {contract.tenant?.vatTrn ? <Text style={{ fontSize: 8, color: MUTE }}>TRN {contract.tenant.vatTrn}</Text> : null}
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
              <View style={{ flex: 1, paddingVertical: 8, paddingRight: 8 }}>
                <Text style={{ fontSize: 9, color: INK }}>{l.desc}</Text>
                {(l.date || l.method) ? (
                  <Text style={{ fontSize: 7, color: MUTE, marginTop: 2 }}>
                    {[l.date ? fmtDate(l.date) : null,
                      l.method ? (l.reference ? `${l.method} ${l.reference}` : l.method) : null,
                    ].filter(Boolean).join(' - ')}
                  </Text>
                ) : null}
                {/* Each line's own issued receipt number — shown only when it isn't
                    already the document's header number (so a single-event receipt
                    never prints it twice). An aggregate statement references the
                    payment plan in its header, so this is what makes every amount
                    on it individually traceable and reconcilable. */}
                {l.receiptNo && l.receiptNo !== receipt.receiptNo ? (
                  <Text style={{ fontSize: 7, color: l.receiptVoided ? '#b3261e' : MUTE, marginTop: 2 }}>
                    Receipt {l.receiptNo}{l.receiptVoided ? ' · VOID' : ''}
                  </Text>
                ) : null}
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

        {/* Payment method + cheque/ref now travel inline on each line item above,
           so there's no separate "Payment Details" block. */}

        {/* ── System-generated note ── */}
        <View style={{ paddingHorizontal: PAD, paddingTop: 14 }}>
          <View style={{ borderTopWidth: 1, borderTopColor: LINE, paddingTop: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 8.5, color: INK, fontWeight: 500 }}>This is a system-generated receipt — valid without a signature or stamp.</Text>
            <Text style={{ fontSize: 7.5, color: MUTE, marginTop: 5 }}>Please retain this receipt against tenancy contract {contract.ref}{contract.paymentRefs?.planRefNo ? ` · payment plan ${contract.paymentRefs.planRefNo}` : ''} for your records.</Text>
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
            : kind === 'management' ? 'No management fees (Contract Registration, admin or commission) are recorded for this contract.'
            : kind === 'charges' ? 'No cheque charges are recorded for this contract — no cheque has bounced, been swapped or been deferred.'
            : kind === 'replacements' ? 'No replacement payments are recorded for this contract — every cheque on the schedule stands as it was issued.'
            : kind === 'rental' ? 'No rent payments are recorded for this contract yet.'
            : 'No payments are available to receipt for this contract yet.'}
        </Text>
      </Page>
    </Document>
  );
}

export function PaymentReceiptDoc({ contract, kind, selectedId, selectedIdx }: Props) {
  // Default / kind="all" → ONE document holding the segmented receipts as separate
  // pages (Rental Income · Security Deposit · Management Fee · Third Party). A
  // specific kind / pid → that single page only.
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
export function ReceiptInline({ contract, kind = 'all', height = 100000, showDownload = false }: { contract: ReceiptContract; kind?: Props['kind']; height?: number; showDownload?: boolean }) {
  // The refs load async AFTER the contract — fold them into the doc key so the PDF
  // REGENERATES with real receipt numbers when they arrive (useReactPdfDoc keys on
  // this string only; a stale key would freeze the derived-label version).
  const docKey = `inline|${contract.id}|${kind ?? 'all'}|${receiptRefsSig(contract)}`;
  const { bytes, url, error } = useReactPdfDoc(
    () => <PaymentReceiptDoc contract={contract} kind={kind} selectedId={null} selectedIdx={0} />,
    docKey,
  );
  if (error) return <div style={{ padding: 24, textAlign: 'center', color: '#c00', fontSize: 13 }}>Receipts unavailable.</div>;
  return (
    <>
      {showDownload && <InlineDownloadRow url={url} fileName={`Receipts-${contract.ref}.pdf`} />}
      <EjariCanvas bytes={bytes} height={height} />
    </>
  );
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
  // A segment reference carries a "/" suffix (PP-…-00104/D) — a path separator that
  // browsers mangle or truncate in a download filename, so flatten it to "-".
  const fileName = combined
    ? `Receipts-${contract.ref}.pdf`
    : `${(receipt?.receiptNo ?? `receipt-${contract.ref}`).replace(/\//g, '-')}.pdf`;

  // Render the receipt to PDF bytes and rasterise to <canvas> (pdf.js) — NOT a
  // @react-pdf <PDFViewer> (iframe blob), which renders blank on mobile / in prod.
  // Keyed on the route inputs: the print route fetches `contract` once, so its id is
  // a stable content key.
  const docKey = `${contract.id}|${kind ?? 'all'}|${selectedId ?? ''}|${selectedIdx ?? 0}|${receiptRefsSig(contract)}`;
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
  // Management Fee page carries the NET fee rows only — their VAT is a Third Party
  // line now, so a contract whose only fee row is that VAT gets no Management tab.
  const hasManagement = feeLinesOf(contract, rentals).lines.length > 0;
  // Third Party page appears for VAT/"other" rows (fee VAT included) OR the Ejari
  // government split (buildVatReceipt) — so gate the tab/subtitle on both, else
  // it's hidden for a contract whose only Third Party line is the Ejari 172.50.
  const hasEjariGov = (contract.fees ?? []).some(f => (f.paymentType ?? '').toLowerCase() === 'ejari_fee' && (f.amount || 0) > 0);
  const hasVat = payments.some(isGovernment) || hasEjariGov;
  const hasCharges = [...payments, ...(contract.fees ?? [])].some(isChequeCharge);
  const hasReplacements = payments.some(p => isRental(p) && p.replacesPaymentId != null);
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
              ? [isRenewalContract(contract) ? 'Rental income' : 'Rental income · security deposit', hasReplacements ? 'replacements' : null, 'management fee', hasCharges ? 'cheque charges' : null, hasVat ? 'third party' : null].filter(Boolean).join(' · ') + ' — one file'
              : 'System-generated payment receipt'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            <a href="?kind=all" style={tab(combined)}>All</a>
            {hasRental && <a href="?kind=rental" style={tab(!combined && receipt?.kind === 'rental')}>Rental Income</a>}
            {hasDeposit && <a href="?kind=deposit" style={tab(!combined && receipt?.kind === 'deposit')}>Security Deposit</a>}
            {hasReplacements && <a href="?kind=replacements" style={tab(!combined && receipt?.kind === 'replacements')}>Replacements</a>}
            {hasManagement && <a href="?kind=management" style={tab(!combined && receipt?.kind === 'management')}>Management Fee</a>}
            {hasCharges && <a href="?kind=charges" style={tab(!combined && receipt?.kind === 'charges')}>Cheque Charges</a>}
            {hasVat && <a href="?kind=vat" style={tab(!combined && receipt?.kind === 'vat')}>Third Party</a>}
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

// ─── Receipts as ACTIONS (no inline preview) ──────────────────────────────────
// A "View receipts" button that opens a full-screen canvas viewer + a "Download
// receipts" link — for surfaces that want the receipts as buttons rather than an
// embedded preview (e.g. the customer magic-link portal, where only the tenancy
// contract is previewed inline). Both use the SAME generated bytes. Load via
// next/dynamic ssr:false (pulls in @react-pdf).
//
// Pass `trigger` to supply your own single control instead of the default pair —
// the viewer it opens already carries its own "⬇ Download PDF", so one control is
// enough where a surface wants ONE view-and-download affordance per document.
const RCPT_VIEW_BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 12, background: '#2e9f82', color: '#fff', border: 'none' };
const RCPT_DL_BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 12, background: '#fff', color: '#2e9f82', border: '1px solid #cfe9e0', textDecoration: 'none' };

export function ReceiptButtons({ contract, trigger }: {
  contract: ReceiptContract;
  /** Render your own single control. `open()` shows the in-page viewer, `url` is
   *  the generated blob (open it in a new tab to hand the reader the browser's
   *  own PDF view, save included), and `ready` is false while it is still being
   *  generated. */
  trigger?: (open: () => void, ready: boolean, url: string | null) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const docKey = `portal-actions|${contract.id}|all|${receiptRefsSig(contract)}`;
  const { bytes, url, error } = useReactPdfDoc(
    () => <PaymentReceiptDoc contract={contract} kind="all" selectedId={null} selectedIdx={0} />,
    docKey,
  );
  const fileName = leaseDocFileName('Receipt', { unitNumber: contract.unit?.number, ref: contract.ref });
  return (
    <>
      {trigger ? trigger(() => setOpen(true), !!bytes, url) : (
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(true)} disabled={!bytes}
          style={{ ...RCPT_VIEW_BTN, opacity: bytes ? 1 : 0.6, cursor: bytes ? 'pointer' : 'default' }}>
          View receipts
        </button>
        {url
          ? <a href={url} download={fileName} style={RCPT_DL_BTN}>⬇ Download receipts</a>
          : <span style={{ ...RCPT_DL_BTN, opacity: 0.6 }}>⏳ Preparing…</span>}
      </div>
      )}
      {open && (
        <div style={VIEWER_WRAP} role="dialog" aria-modal="true">
          <div style={VIEWER_BAR}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Receipts — {contract.ref}</p>
              <p style={{ margin: 0, fontSize: 12, color: '#666' }}>System-generated payment receipts</p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={() => setOpen(false)} style={CLOSE_BTN}>✕ Close</button>
              {url && <a href={url} download={fileName} style={DL_BTN}>⬇ Download PDF</a>}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {error
              ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 16, color: '#fff', fontSize: 13 }}>Preview unavailable — use “⬇ Download PDF” above.</div>
              : <EjariCanvas bytes={bytes} fill />}
          </div>
        </div>
      )}
    </>
  );
}
