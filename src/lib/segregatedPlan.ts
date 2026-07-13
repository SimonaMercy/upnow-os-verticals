/**
 * segregatedPlan — the single source of truth for how a contract's money is split
 * into the four customer-facing groups shown on BOTH the Payment Plan document and
 * the payment Receipts, so the two always match:
 *
 *   1. Security Deposit  — the held deposit (never on renewals; carried forward)
 *   2. Rental Income     — the rent instalment cheques
 *   3. Management Fee    — Admin fee, Commission
 *   4. Third Party       — Ejari (in FULL, always on top), then VAT / "other"
 *                          pass-throughs (sub-lease %, VAT, service charge, cheque
 *                          penalties, …)
 *
 * Ejari is shown in FULL under Third Party (not split) and always sits at the top of
 * that section — it's a government registration the manager merely collects.
 *
 * Money is WHOLE-AED throughout (see docs/PAYMENTS_REFERENCE.md) — amounts are the
 * GROSS cheque figures, so each section total and the grand total reconcile to what
 * the customer actually pays. Empty groups are dropped (the surfaces hide them).
 */

export type SegKey = 'deposit' | 'rental' | 'management' | 'third_party';

export interface SegPaymentInput {
  paymentType: string | null;
  description?: string | null;
  amount: number;                 // AED gross
  vatAmount?: number | null;
  chequeNumber?: string | null;
  transactionDate?: string | null;
  chequeStatus?: string | null;
  paymentMethod?: string | null;
}

export interface SegLine {
  item: string;
  chequeNo: string | null;
  dueDate: string | null;
  amount: number;                 // AED gross
  method?: string | null;
  status?: string | null;
}

export interface SegGroup {
  key: SegKey;
  title: string;
  lines: SegLine[];
  total: number;                  // AED
}

export interface SegregatedPlan {
  groups: SegGroup[];             // non-empty groups only, in display order
  grandTotal: number;            // AED
}

const round2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

/** Payment-ref label for the "Payment Ref" column: prefixes the cheque/transfer
 *  number by how it was actually paid ("Chq 000173", "Cash …", "Transfer …") so a
 *  cash or bank-transfer payment is never mislabelled a cheque. */
export function paymentRefLabel(chequeNo?: string | null, method?: string | null): string {
  if (!chequeNo) return '—';
  const m = (method ?? '').toLowerCase();
  const prefix = m.includes('cash') ? 'Cash'
    : (m.includes('transfer') || m.includes('bank')) ? 'Transfer'
    : 'Chq';
  return `${prefix} ${chequeNo}`;
}

// ── Row extraction (kept here, react-pdf-free, so any surface can build rows) ──

interface RawPayment {
  paymentType?: string | null; description?: string | null; amount?: number | null;
  vatAmount?: number | null; chequeNumber?: string | null; cheque_number?: string | null;
  transactionDate?: string | null; chequeStatus?: string | null; paymentMethod?: string | null;
}
interface RawContract {
  contractType?: string | null; fees?: RawPayment[] | null;
  securityDeposit?: { amount?: number | null; dueDate?: string | null; recordedDate?: string | null } | null;
  securityDepositHeld?: number | null; securityDepositAmount?: number | null;
}

const toRow = (p: RawPayment): SegPaymentInput => ({
  paymentType: p.paymentType ?? null,
  description: p.description ?? null,
  amount: p.amount ?? 0,
  vatAmount: p.vatAmount ?? null,
  chequeNumber: p.chequeNumber ?? p.cheque_number ?? null,
  transactionDate: p.transactionDate ?? null,
  chequeStatus: p.chequeStatus ?? null,
  paymentMethod: p.paymentMethod ?? null,
});

/** Every payment + one-off fee row the four groups build from. On non-renewals with
 *  a recorded deposit but no deposit payment row, a Security Deposit line is synthesised
 *  (renewals carry the deposit forward and never re-collect it). */
export function segRowsFromContract(contract: RawContract, payments: RawPayment[]): SegPaymentInput[] {
  const isRenewal = (contract.contractType ?? '').toLowerCase() === 'renewal';
  let rows: SegPaymentInput[] = [...payments.map(toRow), ...(contract.fees ?? []).map(toRow)];
  // Renewals carry the deposit forward (read-only, never re-collected) — drop any
  // deposit row so no Security Deposit section shows, matching the receipts.
  if (isRenewal) rows = rows.filter(r => (r.paymentType ?? '').toLowerCase() !== 'security_deposit');
  const hasDeposit = rows.some(r => (r.paymentType ?? '').toLowerCase() === 'security_deposit');
  if (!isRenewal && !hasDeposit) {
    const amt = Number(contract.securityDeposit?.amount ?? contract.securityDepositHeld ?? contract.securityDepositAmount ?? 0);
    if (amt > 0) rows.push({ paymentType: 'security_deposit', description: 'Security Deposit', amount: amt,
      chequeNumber: null, transactionDate: contract.securityDeposit?.dueDate ?? contract.securityDeposit?.recordedDate ?? null });
  }
  return rows;
}

// ── Adapters from the OTHER plan models → SegPaymentInput[] (all money in fils on
//    those models; ×/100 here). These keep the four-group segregation CENTRALISED:
//    every surface (contract, proposal, lead, renewal, creation) maps into the same
//    builder, so the on-screen view and the PDF never drift. ──

/** OfferPlan (the fils-based current-plan bridge, lib/currentPlan) → rows. Amounts &
 *  dates are exact; cheque numbers aren't on the OfferPlan (shown as "—"). */
export function segRowsFromOfferPlan(plan: {
  items?: Array<{ amountFils?: number | null; vatFils?: number | null; dueDate?: string | null; description?: string | null; paymentType?: string | null; status?: string | null }> | null;
}): SegPaymentInput[] {
  return (plan.items ?? []).map(it => ({
    paymentType: it.paymentType ?? null,
    description: it.description ?? null,
    amount: (it.amountFils ?? 0) / 100,
    vatAmount: (it.vatFils ?? 0) / 100,
    chequeNumber: null,
    transactionDate: it.dueDate ?? null,
    chequeStatus: it.status ?? null,
  }));
}

/** Aggregate plan shape shared by the customer `ApiPaymentPlan` (spaces) and the
 *  lead `PaymentPlan`/`costPreview` — category totals in fils + a rent schedule.
 *  De-bundled into clean segregation rows: rent split across its instalments (fees
 *  are shown as their own lines, never folded into the first cheque). */
export interface AggregatePlanInput {
  rentFils?: number | null;
  rentVatFils?: number | null;
  securityDepositFils?: number | null;
  adminFeeFils?: number | null; adminFeeVatFils?: number | null;
  ejariFils?: number | null; ejariVatFils?: number | null;
  commissionFils?: number | null; commissionVatFils?: number | null;
  installmentCount?: number | null;
  customFees?: Array<{ label: string; netFils: number; vatFils: number }> | null;
  /** Rent schedule — used only for the instalment due dates. */
  items?: Array<{ dueDate?: string | null; type?: string | null }> | null;
}

export function segRowsFromAggregatePlan(p: AggregatePlanInput): SegPaymentInput[] {
  const rows: SegPaymentInput[] = [];
  const rentGross = (p.rentFils ?? 0) + (p.rentVatFils ?? 0);
  // Instalment due dates from the rent rows of the schedule (exclude deposit/fee rows).
  const rentDates = (p.items ?? [])
    .filter(it => { const t = (it.type ?? '').toLowerCase(); return t !== 'security_deposit' && t !== 'fee'; })
    .map(it => it.dueDate ?? null);
  const n = Math.max(1, p.installmentCount ?? rentDates.length ?? 1);
  if (rentGross > 0) {
    const per = round2(rentGross / n / 100);
    for (let i = 0; i < n; i++) rows.push({ paymentType: 'rental_income', description: n > 1 ? `Instalment ${i + 1} of ${n}` : 'Rent', amount: per, transactionDate: rentDates[i] ?? null, chequeNumber: null });
  }
  if ((p.securityDepositFils ?? 0) > 0) rows.push({ paymentType: 'security_deposit', description: 'Security Deposit', amount: (p.securityDepositFils ?? 0) / 100, chequeNumber: null });
  const admin = (p.adminFeeFils ?? 0) + (p.adminFeeVatFils ?? 0);
  if (admin > 0) rows.push({ paymentType: 'admin_fee', description: 'Admin Fee', amount: admin / 100, chequeNumber: null });
  const comm = (p.commissionFils ?? 0) + (p.commissionVatFils ?? 0);
  if (comm > 0) rows.push({ paymentType: 'commission', description: 'Commission', amount: comm / 100, chequeNumber: null });
  const ejari = (p.ejariFils ?? 0) + (p.ejariVatFils ?? 0);
  if (ejari > 0) rows.push({ paymentType: 'ejari_fee', description: 'Contract Registration Fee', amount: ejari / 100, chequeNumber: null });
  for (const f of (p.customFees ?? [])) rows.push({ paymentType: 'other', description: f.label, amount: (f.netFils + f.vatFils) / 100, chequeNumber: null });
  return rows;
}

/** Customer `ApiPaymentPlan` (spaces page) items → segregation rows. Its items
 *  carry a `type` (fee / first_bundle / installment / extra_installment /
 *  security_deposit) + a human description, NOT a paymentType — so classify by
 *  type, and fees by their description (Admin / Commission → Management Fee;
 *  Ejari + anything else → Third Party). The per-item gross amounts + due dates
 *  are authoritative, so the on-screen plan matches exactly what the RP issued
 *  (no even-split re-derivation, so extra installments are never dropped). */
export function segRowsFromCustomerPlan(plan: {
  items?: Array<{ amountFils?: number | null; dueDate?: string | null; description?: string | null; type?: string | null }> | null;
}): SegPaymentInput[] {
  const feePaymentType = (desc: string): string => {
    const d = desc.toLowerCase();
    if (d.includes('admin')) return 'admin_fee';
    if (d.includes('commission')) return 'commission';
    if (d.includes('ejari') || d.includes('contract registration')) return 'ejari_fee';
    return 'other';
  };
  return (plan.items ?? []).map(it => {
    const t = (it.type ?? '').toLowerCase();
    const desc = it.description ?? '';
    const paymentType =
      t === 'security_deposit' ? 'security_deposit'
      : (t === 'first_bundle' || t === 'installment' || t === 'extra_installment') ? 'rental_income'
      : t === 'fee' ? feePaymentType(desc)
      : 'other';
    return {
      paymentType,
      description: desc || null,
      amount: (it.amountFils ?? 0) / 100,
      chequeNumber: null,
      transactionDate: it.dueDate ?? null,
    };
  });
}

const RENTAL_TYPES = new Set(['rental_income', 'rent']);
const typeOf = (p: SegPaymentInput) => (p.paymentType ?? '').toLowerCase();
const isDeposit = (p: SegPaymentInput) => typeOf(p) === 'security_deposit';
// Rental Income is POSITIVE — only true rent, so a cheque-charge penalty, VAT, or
// any unknown fee can never be mislabelled a rent instalment / inflate the rent total.
const isRental = (p: SegPaymentInput) => RENTAL_TYPES.has(typeOf(p));
const isAdmin = (p: SegPaymentInput) => typeOf(p) === 'admin_fee';
const isCommission = (p: SegPaymentInput) => typeOf(p) === 'commission';
const isEjari = (p: SegPaymentInput) => typeOf(p) === 'ejari_fee';
// Third Party is the CATCH-ALL: everything that isn't the deposit, rent, or a
// management fee (admin/commission/ejari) — VAT, "other" pass-throughs, sub-lease
// charges, service charges, bounced-/replacement-/deferral-cheque fees, and any
// future/unknown type. Nothing is dropped and rent is never inflated.
const isThirdParty = (p: SegPaymentInput) =>
  !isDeposit(p) && !isRental(p) && !isAdmin(p) && !isCommission(p) && !isEjari(p);

const GROUP_TITLE: Record<SegKey, string> = {
  deposit: 'Security Deposit',
  rental: 'Rental Income',
  management: 'Management Fee',
  third_party: 'Third Party',
};

/** Per-group accent + a light header tint. Shared by the PDF (SegregatedSections)
 *  and the on-screen card so the two read identically. Currently uniform (brand
 *  green) across all groups — swap per-group hues back here to make it colourful. */
export const SEG_COLORS: Record<SegKey, { accent: string; tint: string }> = {
  deposit: { accent: '#1a5a4a', tint: '#eef2f0' },
  rental: { accent: '#1a5a4a', tint: '#eef2f0' },
  management: { accent: '#1a5a4a', tint: '#eef2f0' },
  third_party: { accent: '#1a5a4a', tint: '#eef2f0' },
};

/** Order rows by real due date; blanks sort last (keeps the schedule readable). */
function byDate(a: SegPaymentInput, b: SegPaymentInput): number {
  const da = a.transactionDate ?? '', db = b.transactionDate ?? '';
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.localeCompare(db);
}

function lineOf(p: SegPaymentInput, item: string, amount: number): SegLine {
  return {
    item,
    chequeNo: p.chequeNumber ?? null,
    dueDate: p.transactionDate ?? null,
    amount: round2(amount),
    method: p.paymentMethod ?? null,
    status: p.chequeStatus ?? null,
  };
}

/**
 * Build the four segregated groups from a contract's rows (rent + deposit + fees +
 * government/other charges). `rows` should include every payment and every one-off
 * fee row; classification is by `paymentType`.
 */
export function buildSegregatedPlan(rows: SegPaymentInput[]): SegregatedPlan {
  const deposits = rows.filter(isDeposit).slice().sort(byDate);
  const rentals = rows.filter(isRental).slice().sort(byDate);
  const thirdParty = rows.filter(isThirdParty).slice().sort(byDate);
  const admin = rows.filter(isAdmin).slice().sort(byDate);
  const commission = rows.filter(isCommission).slice().sort(byDate);
  const ejari = rows.filter(isEjari).slice().sort(byDate);

  // ── Security Deposit ──
  const depositLines: SegLine[] = deposits.map(p => lineOf(p, 'Security Deposit', p.amount || 0));

  // ── Rental Income ── (labelled by instalment position)
  const n = rentals.length;
  const rentalLines: SegLine[] = rentals.map((p, i) =>
    lineOf(p, n > 1 ? `Instalment ${i + 1} of ${n}` : 'Rent', p.amount || 0));

  // ── Ejari → Third Party in FULL (not split), always on TOP of the section ──
  const ejariLines: SegLine[] = ejari.map(p => lineOf(p, p.description || 'Contract Registration Fee', p.amount || 0));

  // ── Management Fee ── (Admin, Commission)
  const managementLines: SegLine[] = [
    ...admin.map(p => lineOf(p, p.description || 'Admin Fee', p.amount || 0)),
    ...commission.map(p => lineOf(p, p.description || 'Commission', p.amount || 0)),
  ];

  // ── Third Party ── (Ejari on top, then VAT / other pass-throughs, cheque-charge fees, …)
  const thirdLines: SegLine[] = [
    ...ejariLines,
    ...thirdParty.map(p => lineOf(p, p.description || (typeOf(p) === 'vat' ? 'VAT' : 'Charge'), p.amount || 0)),
  ];

  const built: Array<{ key: SegKey; lines: SegLine[] }> = [
    { key: 'deposit', lines: depositLines },
    { key: 'rental', lines: rentalLines },
    { key: 'management', lines: managementLines },
    { key: 'third_party', lines: thirdLines },
  ];

  // Fees/charges in a section are collected together, so the plan shows ONE due
  // date per section (its latest). Rental Income keeps its per-instalment dates.
  const sectionDate = (ls: SegLine[]): string | null => {
    const dates = ls.map(l => l.dueDate).filter((d): d is string => !!d).sort();
    return dates.length ? dates[dates.length - 1] : null;
  };
  const groups: SegGroup[] = built
    .filter(g => g.lines.length > 0)
    .map(g => {
      const lines = g.key === 'rental' ? g.lines
        : (() => { const d = sectionDate(g.lines); return g.lines.map(l => ({ ...l, dueDate: d })); })();
      return { key: g.key, title: GROUP_TITLE[g.key], lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)) };
    });

  const grandTotal = round2(groups.reduce((s, g) => s + g.total, 0));
  return { groups, grandTotal };
}
