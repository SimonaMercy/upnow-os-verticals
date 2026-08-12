/**
 * Stable keys for the payment-plan rows the RP does not type in directly —
 * client mirror of the backend's `shared/plan-rows.ts` (keep the two in step,
 * they are a wire format).
 *
 * The plan editor's fields describe rent, fees and the deposit. Three kinds of
 * row are DERIVED from those and from the unit — the sub-lease pass-throughs and
 * any other unit charge, the rent VAT cheques, and the fee VAT cheque — so every
 * plan builder rebuilds them from scratch. That is right for their AMOUNTS
 * (a charge declared "20% on sub-lease" must follow the rent) but wrong for when
 * and how they are collected, which is the landlord's call. These keys are how
 * that choice survives the rebuild.
 */

export type PlanRowKey = string;

/** A unit charge is keyed by its label — what the unit's facilities declare. */
export const unitChargeRowKey = (label: string): PlanRowKey => `unit:${String(label ?? '').trim()}`;

/** Rent VAT under `installment` collection: one cheque per rent cheque, keyed by
 *  the instalment it rides with (1-based). Under `annual` collection there is a
 *  single cheque for the year — `rentvat:annual`. */
export const rentVatRowKey = (installment: number | 'annual'): PlanRowKey => `rentvat:${installment}`;

/** The single fee-VAT cheque (admin + commission + registration VAT). */
export const FEE_VAT_ROW_KEY: PlanRowKey = 'feevat';

export interface PlanRowOverride {
  key: PlanRowKey;
  dueDate?: string;
  paymentMethod?: 'cheque' | 'bank_transfer' | 'card' | 'cash';
}
