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
  /** VAT inside `amount` (AED). Read by the Net · VAT · Total plan only. */
  vat?: number;
  method?: string | null;
  status?: string | null;
}

export interface SegGroup {
  key: SegKey;
  title: string;
  lines: SegLine[];
  total: number;                  // AED
}

/** A rent discount the landlord granted: the rent the unit was listed at, what
 *  came off it, and how it was expressed. The instalment lines already carry the
 *  NET rent — this is the one place the plan says where that figure came from. */
export interface RentDiscount {
  listedRent: number;             // AED, before the discount
  discountAmount: number;         // AED taken off the listed rent
  discountType?: 'percent' | 'fixed' | null;
  discountPercent?: number | null;
}

export interface SegregatedPlan {
  groups: SegGroup[];             // non-empty groups only, in display order
  grandTotal: number;            // AED
  /** Set when the rent was discounted — rendered as a "Listed rent · Discount ·
   *  Net rent" line on the Rental Income group, on screen and on the PDF. */
  rentDiscount?: RentDiscount | null;
}

const round2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

/**
 * How a plan row is paid when it carries no explicit method — every plan issued
 * before methods existed, and any row the landlord never touched. What is
 * collected at signing (the security deposit, the fees, instalment 1) goes by
 * BANK TRANSFER; the later instalments are the post-dated CHEQUES the customer
 * hands over. The landlord can override any row when editing the plan.
 */
export const UPFRONT_METHOD = 'bank_transfer';
export const RECURRING_METHOD = 'cheque';
export function defaultPlanMethod(kind: 'deposit' | 'fee' | 'first_instalment' | 'later_instalment'): string {
  return kind === 'later_instalment' ? RECURRING_METHOD : UPFRONT_METHOD;
}

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
  /** Set when this row re-pays a BOUNCED cheque rather than being an instalment
   *  of its own (`payments.replaces_payment_id`). */
  replacesPaymentId?: number | null;
}
interface RawContract {
  contractType?: string | null; fees?: RawPayment[] | null;
  /** The deposit REGISTER record — since migration 0191 a deposit is never a
   *  `payments` row, so every cheque fact the plan shows comes from here. */
  securityDeposit?: {
    amount?: number | null; dueDate?: string | null; recordedDate?: string | null;
    chequeNumber?: string | null; paymentMethod?: string | null; chequeStatus?: string | null;
  } | null;
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

/** Every payment + one-off fee row the four groups build from. The Security Deposit
 *  line is ALWAYS synthesised from the register on a non-renewal — deposits stopped
 *  being `payments` rows in migration 0191 — and carries the register's own cheque
 *  number, method, date and status, so the plan does not print a deposit line with
 *  an em-dash where its reference and payer should be. (Renewals carry the deposit
 *  forward and never re-collect it, so they show no deposit line at all.) */
export function segRowsFromContract(contract: RawContract, payments: RawPayment[]): SegPaymentInput[] {
  const isRenewal = (contract.contractType ?? '').toLowerCase() === 'renewal';
  // A payment recorded against a BOUNCED cheque is not an instalment of the plan —
  // it re-pays one the plan already lists. Including it numbered a 4-instalment
  // lease up to 5 and totalled 225,000 on a 180,000 tenancy, on screen and in the
  // PDF the customer receives. The bounced instalment itself stays, at face value:
  // it is one of the four the lease was agreed at, whatever happened to the cheque.
  const scheduled = payments.filter(p => p.replacesPaymentId == null);
  let rows: SegPaymentInput[] = [...scheduled.map(toRow), ...(contract.fees ?? []).map(toRow)];
  // Renewals carry the deposit forward (read-only, never re-collected) — drop any
  // deposit row so no Security Deposit section shows, matching the receipts.
  if (isRenewal) rows = rows.filter(r => (r.paymentType ?? '').toLowerCase() !== 'security_deposit');
  const hasDeposit = rows.some(r => (r.paymentType ?? '').toLowerCase() === 'security_deposit');
  if (!isRenewal && !hasDeposit) {
    const sd = contract.securityDeposit;
    const amt = Number(sd?.amount ?? contract.securityDepositHeld ?? contract.securityDepositAmount ?? 0);
    if (amt > 0) rows.push({
      paymentType: 'security_deposit', description: 'Security Deposit', amount: amt,
      chequeNumber: sd?.chequeNumber ?? null,
      paymentMethod: sd?.paymentMethod ?? null,
      chequeStatus: sd?.chequeStatus ?? null,
      transactionDate: sd?.dueDate ?? sd?.recordedDate ?? null,
    });
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
  /** Rent before the discount; set only when a discount was applied. */
  originalRentFils?: number | null;
  discountFils?: number | null;
  discountType?: 'percent' | 'fixed' | null;
  discountPercent?: number | null;
  rentVatFils?: number | null;
  securityDepositFils?: number | null;
  adminFeeFils?: number | null; adminFeeVatFils?: number | null;
  ejariFils?: number | null; ejariVatFils?: number | null;
  commissionFils?: number | null; commissionVatFils?: number | null;
  installmentCount?: number | null;
  customFees?: Array<{ label: string; netFils: number; vatFils: number }> | null;
  /** Rent schedule — instalment due dates, the payment method the landlord set on
   *  each row (see PaymentPlanItem.paymentMethod), and the amount, which is read
   *  for the extra rows (they exist ONLY here, not in the category totals). */
  items?: Array<{ dueDate?: string | null; type?: string | null; description?: string | null; paymentMethod?: string | null; amountFils?: number | null }> | null;
}

/** The rent discount on an aggregate plan, or null when none was granted. The
 *  Payment Summary showed only the NET instalments, so a customer given AED 2,000
 *  off read a rent of 58,000 with no sign of the 60,000 it was cut from. */
export function rentDiscountFromAggregatePlan(p: Pick<AggregatePlanInput, 'rentFils' | 'originalRentFils' | 'discountFils' | 'discountType' | 'discountPercent'> | null | undefined): RentDiscount | null {
  if (!p) return null;
  const listedFils = p.originalRentFils ?? 0;
  const discountFils = p.discountFils ?? (listedFils > 0 ? listedFils - (p.rentFils ?? 0) : 0);
  if (listedFils <= 0 || discountFils <= 0) return null;
  return {
    listedRent: listedFils / 100,
    discountAmount: discountFils / 100,
    discountType: p.discountType ?? null,
    discountPercent: p.discountType === 'percent' ? (p.discountPercent ?? null) : null,
  };
}

/** The rent discount a LEASE carries (listed_rent − discount_amount = annual_rent),
 *  or null when it has none. For the lease's own Payment Summary and VAT plan. */
export function rentDiscountFromContract(c: { listedRent?: number | null; discountType?: string | null; discountValue?: number | null; discountAmount?: number | null } | null | undefined): RentDiscount | null {
  if (!c) return null;
  const listed = Number(c.listedRent ?? 0);
  const amount = Number(c.discountAmount ?? 0);
  if (listed <= 0 || amount <= 0) return null;
  const type = c.discountType === 'percent' || c.discountType === 'fixed' ? c.discountType : null;
  return { listedRent: listed, discountAmount: amount, discountType: type, discountPercent: type === 'percent' ? Number(c.discountValue ?? 0) || null : null };
}

export function segRowsFromAggregatePlan(p: AggregatePlanInput): SegPaymentInput[] {
  const rows: SegPaymentInput[] = [];
  // Does this plan collect its VAT as its OWN cheques? Plans issued since the VAT
  // split carry `type:'vat'` items and NET rent/fee rows; older ones fold the tax
  // into the gross amounts and have no such item. Reading the category totals as
  // gross for a split plan charges the same tax twice — it inflated every
  // instalment by its share of the rent VAT and hid the VAT cheque the customer
  // was actually issued. Mirrors planFeeVatIsOwnCheque / netFeeInputsForPlan on
  // the backend, which apply exactly this rule when the lead becomes a contract.
  const vatItems = (p.items ?? []).filter(it => (it.type ?? '').toLowerCase() === 'vat');
  const isFeeVat = (desc?: string | null) => /fees\s*vat/i.test(desc ?? '');
  const rentVatIsOwnCheque = vatItems.some(it => !isFeeVat(it.description));
  const feeVatIsOwnCheque = vatItems.some(it => isFeeVat(it.description));
  const rentGross = (p.rentFils ?? 0) + (rentVatIsOwnCheque ? 0 : (p.rentVatFils ?? 0));
  // Instalment due dates from the RENT rows of the schedule only. Deposit, fee,
  // VAT and extra rows are excluded: a row sitting in here shifted every instalment
  // onto the wrong date (instalment 2 inheriting the VAT cheque's date, and so on
  // down, with the last instalment's date dropped off the end).
  const rentRows = (p.items ?? [])
    .filter(it => { const t = (it.type ?? '').toLowerCase(); return t !== 'security_deposit' && t !== 'fee' && t !== 'extra_installment' && t !== 'vat'; });
  const rentDates = rentRows.map(it => it.dueDate ?? null);
  // Payment methods live on the schedule items; the category totals above carry
  // none, so each derived row is matched back to the item it came from.
  const rowOf = (pred: (it: NonNullable<AggregatePlanInput['items']>[number]) => boolean) => (p.items ?? []).find(pred);
  const methodOf = (pred: (it: NonNullable<AggregatePlanInput['items']>[number]) => boolean): string | null =>
    rowOf(pred)?.paymentMethod ?? null;
  // Deposit + fee rows carry their own due date on the schedule; without this
  // they render as "—" while the instalments show dates, which reads as "no date
  // agreed" for the very cheques the customer hands over first.
  const dateOf = (pred: (it: NonNullable<AggregatePlanInput['items']>[number]) => boolean): string | null =>
    rowOf(pred)?.dueDate ?? null;
  const isFee = (prefix: string) => (it: NonNullable<AggregatePlanInput['items']>[number]) =>
    (it.type ?? '') === 'fee' && !!it.description?.startsWith(prefix);
  const feeMethod = (prefix: string) => methodOf(isFee(prefix));
  const n = Math.max(1, p.installmentCount ?? rentDates.length ?? 1);
  if (rentGross > 0) {
    const per = round2(rentGross / n / 100);
    for (let i = 0; i < n; i++) rows.push({ paymentType: 'rental_income', description: n > 1 ? `Instalment ${i + 1}` : 'Rent', amount: per, transactionDate: rentDates[i] ?? null, chequeNumber: null, paymentMethod: rentRows[i]?.paymentMethod ?? defaultPlanMethod(i === 0 ? 'first_instalment' : 'later_instalment') });
  }
  const isDeposit = (it: NonNullable<AggregatePlanInput['items']>[number]) => (it.type ?? '') === 'security_deposit';
  if ((p.securityDepositFils ?? 0) > 0) rows.push({ paymentType: 'security_deposit', description: 'Security Deposit', amount: (p.securityDepositFils ?? 0) / 100, chequeNumber: null, transactionDate: dateOf(isDeposit), paymentMethod: methodOf(isDeposit) ?? defaultPlanMethod('deposit') });
  // Fees are NET when their VAT rides on its own "Fees VAT" cheque (below).
  const feeVat = (fils?: number | null) => feeVatIsOwnCheque ? 0 : (fils ?? 0);
  const admin = (p.adminFeeFils ?? 0) + feeVat(p.adminFeeVatFils);
  if (admin > 0) rows.push({ paymentType: 'admin_fee', description: 'Admin Fee', amount: admin / 100, chequeNumber: null, transactionDate: dateOf(isFee('Admin')), paymentMethod: feeMethod('Admin') ?? defaultPlanMethod('fee') });
  const comm = (p.commissionFils ?? 0) + feeVat(p.commissionVatFils);
  if (comm > 0) rows.push({ paymentType: 'commission', description: 'Commission', amount: comm / 100, chequeNumber: null, transactionDate: dateOf(isFee('Commission')), paymentMethod: feeMethod('Commission') ?? defaultPlanMethod('fee') });
  const ejari = (p.ejariFils ?? 0) + feeVat(p.ejariVatFils);
  if (ejari > 0) rows.push({ paymentType: 'ejari_fee', description: 'Contract Registration Fee', amount: ejari / 100, chequeNumber: null, transactionDate: dateOf(isFee('Contract Registration')), paymentMethod: feeMethod('Contract Registration') ?? defaultPlanMethod('fee') });
  // The VAT cheques themselves — one per rent cheque, or a single annual one, per
  // the landlord's "Rent VAT collection" setting, plus the fee VAT. They are the
  // landlord's to collect and remit, so they file under Third Party, and they are
  // read from the ITEMS: the plan already decided how many there are and when.
  for (const it of vatItems) {
    rows.push({
      paymentType: isFeeVat(it.description) ? 'vat_fees' : 'vat_rental',
      description: it.description || 'VAT',
      amount: (it.amountFils ?? 0) / 100,
      chequeNumber: null,
      transactionDate: it.dueDate ?? null,
      paymentMethod: it.paymentMethod ?? defaultPlanMethod('fee'),
    });
  }
  for (const f of (p.customFees ?? [])) {
    const match = (it: NonNullable<AggregatePlanInput['items']>[number]) => it.description === f.label;
    rows.push({ paymentType: 'other', description: f.label, amount: (f.netFils + f.vatFils) / 100, chequeNumber: null, transactionDate: dateOf(match), paymentMethod: methodOf(match) ?? defaultPlanMethod('fee') });
  }
  // Extra rows the landlord added by hand. They have no category total to derive
  // from — the schedule IS their only record — so they were silently missing from
  // the plan and from its grand total.
  for (const it of (p.items ?? [])) {
    if ((it.type ?? '').toLowerCase() !== 'extra_installment') continue;
    rows.push({
      paymentType: 'other',
      description: it.description || 'Extra payment',
      amount: (it.amountFils ?? 0) / 100,
      chequeNumber: null,
      transactionDate: it.dueDate ?? null,
      paymentMethod: it.paymentMethod ?? defaultPlanMethod('later_instalment'),
    });
  }
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
  items?: Array<{ amountFils?: number | null; dueDate?: string | null; description?: string | null; type?: string | null; paymentMethod?: string | null }> | null;
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
      // How the landlord said this line is paid. A plan issued before methods
      // existed carries none, so it falls back to the same default the editor
      // shows rather than leaving the customer's copy silent.
      paymentMethod: it.paymentMethod
        ?? defaultPlanMethod(
          t === 'security_deposit' ? 'deposit'
          : t === 'fee' ? 'fee'
          : t === 'first_bundle' ? 'first_instalment'
          : 'later_instalment',
        ),
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
// RP-charged penalties + mid-lease admin charges from Settings → Rules (migrations
// 0136 + 0144) — Management Fee, like admin/commission (money the RP earns), NOT
// third-party pass-through. Ejari (government) stays Third Party.
const RULE_FEE_TYPES = new Set([
  'bounced_cheque_fee', 'cheque_replacement_fee', 'cheque_deferral_fee', 'late_renewal_fee',
  'early_termination_fee', 'late_moveout_fee', 'unauthorized_sharing_fee', 'access_card_fee',
  'contract_name_change_fee', 'unit_transfer_fee', 'legal_fee',
]);
const isManagementFee = (p: SegPaymentInput) => isAdmin(p) || isCommission(p) || RULE_FEE_TYPES.has(typeOf(p));
// Third Party is the CATCH-ALL: everything that isn't the deposit, rent, a management
// fee (admin/commission/penalties), or Ejari — VAT, "other" pass-throughs, sub-lease
// charges, service charges, and any future/unknown type. Rent is never inflated.
const isThirdParty = (p: SegPaymentInput) =>
  !isDeposit(p) && !isRental(p) && !isManagementFee(p) && !isEjari(p);

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
    vat: round2(Math.min(Math.max(Number(p.vatAmount) || 0, 0), amount)),
    method: p.paymentMethod ?? null,
    status: p.chequeStatus ?? null,
  };
}

/**
 * Build the four segregated groups from a contract's rows (rent + deposit + fees +
 * government/other charges). `rows` should include every payment and every one-off
 * fee row; classification is by `paymentType`.
 */
/**
 * The attach-slot label of each RENT payment — `Rent — Instalment N` (or
 * `Rent — Rent` on a one-payment plan), numbered exactly as buildSegregatedPlan
 * numbers its rental lines. Lets a screen that holds the payment rows find the
 * cheque file attached against each one (lib/planAttach tags files by this
 * label). Rows that re-pay a bounced cheque are not instalments and get none.
 */
export function rentSlotLabels<T extends RawPayment>(payments: T[]): Map<T, string> {
  const rentals = payments
    .filter(p => p.replacesPaymentId == null && isRental(toRow(p)))
    .slice()
    .sort((x, y) => byDate(toRow(x), toRow(y)));
  const n = rentals.length;
  return new Map(rentals.map((p, i) => [p, `Rent — ${n > 1 ? `Instalment ${i + 1}` : 'Rent'}`]));
}

/**
 * The order the Payment Summary lists payments in: Security Deposit, Rental
 * Income, Management Fee, Third Party — so any other list of the same payments
 * can be sorted to match it. Ties by due date, as the groups are.
 */
export function planOrder(a: SegPaymentInput, b: SegPaymentInput): number {
  const rank = (p: SegPaymentInput) => (isDeposit(p) ? 0 : isRental(p) ? 1 : isManagementFee(p) ? 2 : 3);
  return rank(a) - rank(b) || byDate(a, b);
}

export function buildSegregatedPlan(rows: SegPaymentInput[]): SegregatedPlan {
  const deposits = rows.filter(isDeposit).slice().sort(byDate);
  const rentals = rows.filter(isRental).slice().sort(byDate);
  const thirdParty = rows.filter(isThirdParty).slice().sort(byDate);
  const management = rows.filter(isManagementFee).slice().sort(byDate);
  const ejari = rows.filter(isEjari).slice().sort(byDate);

  // ── Security Deposit ──
  const depositLines: SegLine[] = deposits.map(p => lineOf(p, 'Security Deposit', p.amount || 0));

  // ── Rental Income ── (labelled by instalment position; "Instalment 2", not
  // "Instalment 2 of 4" — the section header already carries the count)
  const n = rentals.length;
  const rentalLines: SegLine[] = rentals.map((p, i) =>
    lineOf(p, n > 1 ? `Instalment ${i + 1}` : 'Rent', p.amount || 0));

  // ── Ejari → Third Party in FULL (not split), always on TOP of the section ──
  const ejariLines: SegLine[] = ejari.map(p => lineOf(p, p.description || 'Contract Registration Fee', p.amount || 0));

  // ── Management Fee ── (Admin, Commission, + RP penalties / admin charges)
  const managementLines: SegLine[] = management.map(p =>
    lineOf(p, p.description || (isAdmin(p) ? 'Admin Fee' : isCommission(p) ? 'Commission' : 'Fee'), p.amount || 0));

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

  // Every line keeps its OWN due date, in every section. Collapsing a section to
  // its latest date hid an edit: a fee moved to 11 Sep still read 14 Sep because
  // another line in the same section was 14 Sep (CID-409, 17 Sep 2026).
  const groups: SegGroup[] = built
    .filter(g => g.lines.length > 0)
    .map(g => ({ key: g.key, title: GROUP_TITLE[g.key], lines: g.lines, total: round2(g.lines.reduce((s, l) => s + l.amount, 0)) }));

  const grandTotal = round2(groups.reduce((s, g) => s + g.total, 0));
  return { groups, grandTotal };
}
