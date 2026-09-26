/**
 * vatPlan — the Net · VAT · Total payment plan: the same four segregated groups
 * as the Payment Summary (lib/segregatedPlan), but every line states its net, its
 * VAT and its total, and the VAT sits ON the charge it is levied on.
 *
 * Leases record VAT two ways. A row can carry its own `vat_amount` (a fee typed
 * with VAT, a legacy gross rent cheque) — that already reads as net + VAT. Or the
 * VAT is a row of its own: a `payment_type='vat'` cheque ("Rental VAT (5%)",
 * "Rental VAT 2 of 4 (5%)", "Fees VAT") or a hand-typed `other` row whose label
 * declares it ("5% VAT on Rent", "5% VAT on sub-lease"). This plan FOLDS each such
 * row onto the charge it taxes, so "5% VAT on Rent" shows in the Rent line's VAT
 * column under Rental Income instead of as a Third Party charge. Display only —
 * the stored rows, receipts and reports are untouched.
 *
 * A VAT row is matched to the charge whose 5% it is (the rent cheque it rides
 * with, the sub-lease levy). A year's rent VAT collected in one go (the landlord's
 * "annual" Rent VAT setting) matches no single cheque and folds onto the first
 * rent cheque, which is when it is collected. A VAT row that matches nothing
 * stays a line of its own, with its whole amount in the VAT column.
 */
import { isTaxLabel, VAT_RATE } from '@/lib/chargeTax';
import { buildSegregatedPlan, type SegPaymentInput, type SegregatedPlan } from '@/lib/segregatedPlan';

const r2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const typeOf = (p: SegPaymentInput) => (p.paymentType ?? '').toLowerCase();
const RENT_TYPES = new Set(['rental_income', 'rent']);
const FEE_TYPES = new Set(['admin_fee', 'commission', 'ejari_fee']);
const SUBLEASE_RE = /sub[\s-]?lease/i;

/** True when the row's WHOLE amount is VAT (its own cheque / its own charge line). */
export function isWholeVatRow(p: SegPaymentInput): boolean {
  if (typeOf(p) === 'vat') return true;
  if (typeOf(p) !== 'other' || !isTaxLabel(p.description)) return false;
  const vat = Number(p.vatAmount) || 0;
  // Legacy rows store vat 0 and only the label says it is tax; newer ones stamp
  // vat = amount. A row with a PARTIAL vat stated its own split — leave it.
  return vat <= 0 || Math.abs(vat - (p.amount || 0)) < 0.01;
}

type Scope = 'rent' | 'sublease' | 'fees' | 'any';
function scopeOf(desc: string | null | undefined): Scope {
  const d = desc ?? '';
  if (SUBLEASE_RE.test(d)) return 'sublease';
  if (/\bfees?\b/i.test(d)) return 'fees';
  if (/\brent(al)?\b/i.test(d)) return 'rent';
  return 'any';
}

function inScope(base: SegPaymentInput, scope: Scope): boolean {
  const t = typeOf(base);
  if (scope === 'rent') return RENT_TYPES.has(t);
  if (scope === 'sublease') return t === 'other' && SUBLEASE_RE.test(base.description ?? '');
  if (scope === 'fees') return FEE_TYPES.has(t);
  return t !== 'security_deposit';
}

const byDate = (a: SegPaymentInput, b: SegPaymentInput) =>
  (a.transactionDate ?? '9999').localeCompare(b.transactionDate ?? '9999');

/** Rows with every separate VAT row folded onto the charge it taxes. */
export function foldVatRows(rows: SegPaymentInput[]): SegPaymentInput[] {
  const bases = rows.filter(r => !isWholeVatRow(r)).map(r => ({ ...r }));
  const vatRows = rows.filter(isWholeVatRow).slice().sort(byDate);
  const folded = new Set<SegPaymentInput>();
  const leftovers: SegPaymentInput[] = [];

  const fold = (base: SegPaymentInput, vat: number) => {
    base.amount = r2((base.amount || 0) + vat);
    base.vatAmount = r2((Number(base.vatAmount) || 0) + vat);
    folded.add(base);
  };

  for (const v of vatRows) {
    const vat = r2(v.amount || 0);
    const scope = scopeOf(v.description);
    // Charges that carry no VAT yet, in due-date order.
    const open = bases.filter(b => inScope(b, scope) && !folded.has(b) && !(Number(b.vatAmount) > 0)).sort(byDate);
    // 1. The charge this is 5% of — a rent cheque's VAT, the sub-lease levy's VAT.
    const exact = open.find(b => Math.abs(r2(((b.amount || 0) * VAT_RATE) / 100) - vat) <= 1);
    if (exact) { fold(exact, vat); continue; }
    // 2. A whole year's rent VAT taken in one cheque → the first rent cheque.
    if (scope === 'rent') {
      const rent = bases.filter(b => RENT_TYPES.has(typeOf(b))).sort(byDate);
      const rentTotal = rent.reduce((s, b) => s + (b.amount || 0) - (Number(b.vatAmount) || 0), 0);
      if (rent.length && Math.abs(r2((rentTotal * VAT_RATE) / 100) - vat) <= 1) { fold(rent[0], vat); continue; }
    }
    // 3. Nothing to attach to — its own line, all of it VAT.
    leftovers.push({ ...v, vatAmount: vat });
  }
  return [...bases, ...leftovers];
}

/** The four groups with VAT folded in; each line carries `vat` (see SegLine). */
export function buildVatPlan(rows: SegPaymentInput[]): SegregatedPlan & { grandNet: number; grandVat: number } {
  const plan = buildSegregatedPlan(foldVatRows(rows));
  const grandVat = r2(plan.groups.reduce((s, g) => s + g.lines.reduce((t, l) => t + (l.vat ?? 0), 0), 0));
  return { ...plan, grandVat, grandNet: r2(plan.grandTotal - grandVat) };
}
