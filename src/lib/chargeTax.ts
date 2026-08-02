/**
 * Which charge rows ARE tax.
 *
 * VAT collected on its own cheque carries `payment_type = 'vat'` and stores the
 * whole amount in `vat_amount` — every surface reads that correctly. The per-unit
 * pass-throughs do NOT: "5% VAT on Rent", and a sub-leased building's "5% VAT on
 * sub-lease", are hand-typed `other` rows with `vat_amount = 0`, so only the
 * LABEL records that the whole amount is tax. Anything that splits a row into net
 * + VAT has to read that label, or the tax prints as a net charge and the VAT
 * total under-reports (CID-393, an industrial shed in a sub-leased building,
 * showed its 1,450 of sub-lease VAT as net and totalled VAT 7,250 not 8,700).
 *
 * The declared rate must be the standard rate, because RPs also word the sub-lease
 * LEVY as VAT: on CID-332 "20% VAT on Sublease" is 20% of rent — the head lessor's
 * cut — and "5% VAT on Sublease" is the tax ON it. The 20% line is a net charge
 * however it is worded. A row that carries its own `vat_amount` has already stated
 * its split and is left alone.
 *
 * Sibling of [[subleaseCharges]], which re-derives what those two lines should
 * AMOUNT to; this only decides how an existing amount is presented.
 */

/** The UAE standard rate — the rate receipts head their VAT column with. */
export const VAT_RATE = 5;

const TAX_LABEL_RE = /\b(vat|tax)\b/i;
const PCT_RE = /(\d+(?:\.\d+)?)\s*%/;

export interface TaxableRow {
  paymentType?: string | null;
  description?: string | null;
  vatAmount?: number | null;
}

/** VAT collected as its own cheque (Rental VAT / Fees VAT), payment_type 'vat'. */
export function isVatCheque(p: TaxableRow): boolean {
  return (p.paymentType ?? '').toLowerCase() === 'vat';
}

/**
 * The label test on its own: does this charge NAME itself as tax at the standard
 * rate? "5% VAT on sub-lease" and "5% VAT on Rent" do; "20% VAT on Sublease" (a
 * levy) and "Fire Fighting" do not.
 */
export function isTaxLabel(description: string | null | undefined): boolean {
  const desc = String(description ?? '');
  if (!TAX_LABEL_RE.test(desc)) return false;
  const m = PCT_RE.exec(desc);
  return !m || Number(m[1]) === VAT_RATE;
}

/**
 * True when the row's WHOLE amount is tax — a VAT cheque, or a custom `other`
 * charge whose label declares it tax at the standard rate. False for every other
 * charge, including a VAT-worded levy at a different rate.
 *
 * A row carrying its own vat_amount has already stated its split, so it is left
 * alone. The backend now stamps `vat_amount = amount_paid` on labelled tax rows
 * as they are saved, so for new rows this returns false and `taxPortionOf` reads
 * the stored (identical) figure — the label rule stays as the reader for legacy
 * rows written before that.
 */
export function isTaxCharge(p: TaxableRow): boolean {
  if (isVatCheque(p)) return true;
  if ((p.paymentType ?? '').toLowerCase() !== 'other') return false;
  if ((p.vatAmount ?? 0) > 0) return false;
  return isTaxLabel(p.description);
}

/** The row's tax portion, in whatever unit `amount` is given in. */
export function taxPortionOf(p: TaxableRow, amount: number): number {
  return isTaxCharge(p) ? (amount || 0) : (p.vatAmount ?? 0);
}
