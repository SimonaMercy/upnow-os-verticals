import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';

/**
 * Builds the LIVE payment plan — what the customer is actually paying NOW —
 * from a contract's recorded rent cheques, one-off fees and security deposit.
 * This is the current-plan replacement for the origin-lead "offer" snapshot, so
 * renewals (which have no lead offer) still show a meaningful plan.
 *
 * Money on the contract is stored in WHOLE AED; OfferPlan/OfferReceipt expect
 * fils, so everything is ×100 here. Mirrors the inline `currentPlan` derivation
 * on the contract detail page (contracts/[id]/v2) — keep the two in sync; see
 * docs/PAYMENTS_REFERENCE.md for the money rules.
 */

export interface PlanPayment {
  amount?: number | null;
  vatAmount?: number | null;
  transactionDate?: string | null;
  description?: string | null;
  paymentType?: string | null;
  chequeStatus?: string | null;
  /** Cheque number / bank-transfer reference — surfaced as the "Payment Ref" on the
   *  segregated Payment Plan. Not needed for the legacy fils-based OfferPlan. */
  chequeNumber?: string | null;
  paymentMethod?: string | null;
}

export interface PlanContract {
  contractType?: string | null;
  annualRent?: number | null;
  rentVatRate?: number | null;
  discountAmount?: number | null;
  listedRent?: number | null;
  numberOfInstallments?: number | null;
  securityDeposit?: { amount?: number | null; dueDate?: string | null; recordedDate?: string | null } | null;
  securityDepositHeld?: number | null;
  securityDepositAmount?: number | null;
  fees?: PlanPayment[] | null;
}

const toFils = (aed: number) => Math.round((aed || 0) * 100);
const feeLabel = (t: string | null | undefined) =>
  t === 'admin_fee' ? 'Admin fee' : t === 'ejari_fee' ? 'Contract Registration fee' : t === 'commission' ? 'Commission' : (t ?? 'Fee');

export function buildCurrentPlan(contract: PlanContract, payments: PlanPayment[]): OfferPlan {
  const rentRows = (payments ?? [])
    .filter(p => p.paymentType !== 'security_deposit')
    .slice()
    .sort((a, b) => (a.transactionDate ?? '').localeCompare(b.transactionDate ?? ''));
  const feeRows = contract.fees ?? [];
  const feeGross = feeRows.reduce((s, p) => s + (p.amount || 0), 0);
  const depositRow = (payments ?? []).find(p => p.paymentType === 'security_deposit');
  // Renewals carry the deposit from the original lease (never re-collected), so it
  // must not appear as a new line / instalment in the renewal's payment plan.
  const depositForPlan = contract.contractType === 'renewal'
    ? 0
    : (depositRow?.amount ?? contract.securityDeposit?.amount ?? contract.securityDepositHeld ?? contract.securityDepositAmount ?? 0);

  let adminNet = 0, adminVat = 0, ejariNet = 0, ejariVat = 0, commNet = 0, commVat = 0;
  const customFees: { label: string; netFils: number; vatFils: number }[] = [];
  for (const f of feeRows) {
    const vat = f.vatAmount ?? 0;
    const net = (f.amount ?? 0) - vat;
    if (f.paymentType === 'admin_fee') { adminNet += net; adminVat += vat; }
    else if (f.paymentType === 'ejari_fee') { ejariNet += net; ejariVat += vat; }
    else if (f.paymentType === 'commission') { commNet += net; commVat += vat; }
    else customFees.push({ label: f.description || feeLabel(f.paymentType), netFils: toFils(net), vatFils: toFils(vat) });
  }

  const items: OfferPlan['items'] = [
    // `rentRows` is EVERY non-deposit payment (rent cheques + one-off fees + custom
    // charges stored as payments). Carry each row's real paymentType so the shared
    // schedule sort (lib/paymentPlan) can rank it by category — otherwise fees and
    // custom charges would all read as rent instalments. `type` follows suit.
    ...rentRows.map(p => ({ amountFils: toFils(p.amount ?? 0), vatFils: toFils(p.vatAmount ?? 0), dueDate: p.transactionDate ?? '', description: p.description ?? 'Rent', type: (p.paymentType === 'rental_income' ? 'installment' : 'fee') as 'installment' | 'fee', paymentType: p.paymentType ?? null, status: p.chequeStatus ?? null })),
    ...feeRows.map(f => ({ amountFils: toFils(f.amount ?? 0), vatFils: toFils(f.vatAmount ?? 0), dueDate: f.transactionDate ?? '', description: f.description || feeLabel(f.paymentType), type: 'fee' as const, paymentType: f.paymentType ?? null, status: f.chequeStatus ?? null })),
    ...(depositForPlan > 0 ? [{ amountFils: toFils(depositForPlan), vatFils: 0, dueDate: contract.securityDeposit?.dueDate ?? contract.securityDeposit?.recordedDate ?? '', description: 'Security deposit', type: 'security_deposit' as const, paymentType: 'security_deposit', status: depositRow?.chequeStatus ?? null }] : []),
  ].map((it, i) => ({ ...it, index: i + 1 }));

  // Headline rent = the contract's agreed current rent (annualRent is NET), so it
  // stays correct even before every cheque is recorded. VAT from the rate.
  const planRentNet = contract.annualRent || 0;
  const planRentVat = Math.round((planRentNet * (contract.rentVatRate ?? 0))) / 100;

  return {
    totalAmountFils: toFils(planRentNet + planRentVat + feeGross + depositForPlan),
    rentFils: toFils(planRentNet),
    ...((contract.discountAmount ?? 0) > 0 && contract.listedRent != null
      ? { originalRentFils: toFils(contract.listedRent), discountFils: toFils(contract.discountAmount!) }
      : {}),
    // Count only true rent instalments — the standalone "Rental VAT" cheque is
    // not an instalment.
    installmentCount: rentRows.filter(p => !(p.description ?? '').toLowerCase().includes('vat')).length || (contract.numberOfInstallments ?? 0),
    adminFeeFils: toFils(adminNet), adminFeeVatFils: toFils(adminVat),
    ejariFils: toFils(ejariNet), ejariVatFils: toFils(ejariVat),
    commissionFils: toFils(commNet), commissionVatFils: toFils(commVat),
    securityDepositFils: toFils(depositForPlan),
    rentVatRate: contract.rentVatRate ?? 0,
    rentVatFils: toFils(planRentVat),
    customFees,
    items,
  };
}
