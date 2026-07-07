/**
 * Payment schedule display order (RP spec).
 *
 * Rows are grouped by category, not purely by due date, so the schedule reads:
 *   Security deposit → rent cheques → Ejari → Admin → Commission → other/custom
 * ("TAX" = additional per-unit charges the RP adds). Within a category, rows keep
 * their chronological order.
 *
 * Works for BOTH shapes we render:
 *   - plan `items`  → carry `type` ('security_deposit' | 'installment' |
 *     'first_bundle' | 'extra_installment' | 'fee') + `description`
 *   - raw `payments`→ carry `paymentType` ('security_deposit' | 'rental_income' |
 *     'ejari_fee' | 'admin_fee' | 'commission' | …) + `description`
 */
export interface SchedulableRow {
  type?: string | null;
  paymentType?: string | null;
  description?: string | null;
  dueDate?: string | null;
  transactionDate?: string | null;
}

export function paymentCategoryRank(x: SchedulableRow): number {
  const t = (x.type ?? '').toLowerCase();
  const pt = (x.paymentType ?? '').toLowerCase();
  const d = (x.description ?? '').toLowerCase();

  if (t === 'security_deposit' || pt === 'security_deposit') return 0;
  // VAT cheques (payment_type 'vat' / "vat" in desc) sit right after the rent
  // cheques — Rental VAT first (1.4), then Fees VAT (1.6). Base cheques never
  // contain "vat" ("Rental Instalment N of M", "Admin Fee", …), so legacy
  // embedded-VAT contracts (no standalone VAT row) are unaffected.
  if (pt === 'vat' || d.includes('vat')) return d.includes('fees vat') ? 1.6 : 1.4;
  // Rent cheques. `first_bundle` is the first cheque (rent instalment 1 + fees),
  // so it belongs with the rent rows.
  if (t === 'installment' || t === 'first_bundle' || pt === 'rental_income'
      || d.includes('rental instal') || d.includes('installment')) return 1;
  if (pt === 'ejari_fee' || d.includes('ejari')) return 2;
  if (pt === 'admin_fee' || d.includes('admin')) return 3;
  if (pt === 'commission' || d.includes('commission')) return 4;
  // Everything else — extra/custom charges ("TAX"), municipality fees, etc.
  return 5;
}

/** Comparator: category rank first, then chronological within the category. */
export function comparePaymentSchedule(a: SchedulableRow, b: SchedulableRow): number {
  const ra = paymentCategoryRank(a);
  const rb = paymentCategoryRank(b);
  if (ra !== rb) return ra - rb;
  const da = String(a.dueDate ?? a.transactionDate ?? '');
  const db = String(b.dueDate ?? b.transactionDate ?? '');
  return da.localeCompare(db);
}
