/**
 * Payment schedule display order (RP spec).
 *
 * Rows are grouped by category, not purely by due date, so the schedule reads:
 *   Security deposit → rent cheques → Rent/Fees VAT → Ejari → Admin → Commission
 *   → custom "Other" charges (per-unit taxes, service fees), smallest → largest.
 * Within a category rows keep their chronological order (custom charges keep an
 * amount order — see the comparator).
 *
 * IMPORTANT: only the platform's STANDARD VAT (payment_type 'vat', or the computed
 * "Rent VAT" / "Fees VAT" plan lines) sits right after rent. Custom "Other" charges
 * that merely mention VAT/tax in their label (e.g. "5% VAT on Rent", "20% VAT on
 * Rent", "5% Tax on VAT") are NOT pulled up there — they sort at the very end with
 * the rest of the custom charges.
 *
 * Works for BOTH shapes we render:
 *   - plan `items`  → carry `type` ('security_deposit' | 'installment' |
 *     'first_bundle' | 'extra_installment' | 'fee') + `description` + `amountFils`
 *   - raw `payments`→ carry `paymentType` ('security_deposit' | 'rental_income' |
 *     'ejari_fee' | 'admin_fee' | 'commission' | 'vat' | 'other' | …) +
 *     `description` + `amountPaid`
 */
export interface SchedulableRow {
  type?: string | null;
  paymentType?: string | null;
  description?: string | null;
  dueDate?: string | null;
  transactionDate?: string | null;
  // Amount, in whatever unit/field the caller's rows use. Only consulted to
  // sub-sort the custom "Other" bucket smallest → largest; a single schedule's
  // rows all share one field, so the unit (fils vs AED) never mixes.
  amountFils?: number | null;
  amountPaid?: number | null;
  netFils?: number | null;
  amount?: number | null;
}

/** Best-available amount for a row (unit varies by caller — see interface note). */
function rowAmount(x: SchedulableRow): number {
  return Number(x.amountFils ?? x.amountPaid ?? x.netFils ?? x.amount ?? 0) || 0;
}

export function paymentCategoryRank(x: SchedulableRow): number {
  const t = (x.type ?? '').toLowerCase();
  const pt = (x.paymentType ?? '').toLowerCase();
  const d = (x.description ?? '').toLowerCase();

  // 1) payment_type is authoritative when present — both raw payments and (now)
  //    plan items carry it, so fees/custom charges are never mistaken for rent.
  //    Rank: deposit → rent → standard VAT → ejari → admin → commission → custom.
  if (pt === 'security_deposit') return 0;
  if (pt === 'rental_income') return 1;
  if (pt === 'vat') return 2;
  if (pt === 'ejari_fee') return 3;
  if (pt === 'admin_fee') return 4;
  if (pt === 'commission') return 5;
  if (pt === 'other') return 6;

  // 2) No payment_type (legacy offer snapshots) → fall back to type + description.
  //    STANDARD VAT is matched NARROWLY ("rent vat"/"fees vat") so custom charges
  //    whose label merely contains "vat" ("20% VAT on Rent") sort with the custom
  //    bucket at the end, not next to rent.
  if (t === 'security_deposit') return 0;
  if (d === 'rent vat' || d === 'fees vat') return d === 'fees vat' ? 2.5 : 2;
  if (d.includes('ejari')) return 3;
  if (d.includes('admin')) return 4;
  if (d.includes('commission')) return 5;
  if (t === 'installment' || t === 'first_bundle'
      || d.includes('rental instal') || d.includes('installment')
      || /^\s*\d+\s+of\s+\d+/.test(d)) return 1;
  // Everything else — custom "Other" charges (per-unit taxes, service fees like
  // "Fire Fighting"). Ordered smallest → largest amount within this bucket.
  return 6;
}

/**
 * Comparator: category rank first; then smallest → largest amount within the
 * custom "Other" bucket; then chronological (and as the tiebreak everywhere else).
 */
export function comparePaymentSchedule(a: SchedulableRow, b: SchedulableRow): number {
  const ra = paymentCategoryRank(a);
  const rb = paymentCategoryRank(b);
  if (ra !== rb) return ra - rb;
  // Custom "Other" charges: smallest → largest, so the section builds up to the
  // biggest charge (e.g. 5% Tax on VAT · Fire Fighting · 5% VAT on Rent · 20% VAT
  // on Rent). Rent/fee rows are left in chronological order below.
  if (ra >= 6) {
    const aa = rowAmount(a), ab = rowAmount(b);
    if (aa !== ab) return aa - ab;
  }
  const da = String(a.dueDate ?? a.transactionDate ?? '');
  const db = String(b.dueDate ?? b.transactionDate ?? '');
  return da.localeCompare(db);
}
