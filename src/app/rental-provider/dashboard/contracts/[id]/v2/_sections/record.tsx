'use client';
/* Split verbatim out of ../page.tsx (lease detail v2) — the lease figure helpers
   (the old pass / summary strip / rail components were replaced by kit cards in leaseOs.tsx). */
import { taxPortionOf } from '@/lib/chargeTax';
import { ContractDetail, ContractPayment, INCURRED_FEE_TYPES } from './shared';

/**
 * The agreed figures of a tenancy — what the pass (and the record's summary
 * rail) states. Sums the ACTUAL payment rows (gross incl. VAT): rent
 * installments + any extra "other" charges + admin/ejari/commission fees + the
 * security deposit. Falls back to the contract's net rent + computed VAT for a
 * draft that has no rows yet, so the summary is never blank.
 */
export function passFigures(contract: ContractDetail, payments: ContractPayment[]) {
  const isRenewal = contract.contractType === 'renewal';
  const aed = (n: number) => `AED ${Math.round(n || 0).toLocaleString('en-AE')}`;
  // Bounced / cancelled cheques are void (replaced) — never count them in a total.
  const activePmt = (p: ContractPayment) => !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase());
  const g = (arr: ContractPayment[]) => arr.reduce((s, p) => s + (activePmt(p) ? (Number(p.amount) || 0) : 0), 0);
  const v = (arr: ContractPayment[]) => arr.reduce((s, p) => s + (activePmt(p) ? (Number(p.vatAmount) || 0) : 0), 0);
  const rows = payments ?? [];
  const nonDeposit = rows.filter(p => p.paymentType !== 'security_deposit');
  const otherItems = nonDeposit.filter(p => p.paymentType === 'other');
  const rentItems = nonDeposit.filter(p => p.paymentType !== 'other');
  // The pass answers "what was this tenancy agreed at?", so only CONTRACTED fees
  // count — admin, Contract Registration, commission. Penalties and mid-lease
  // charges are money the lease incurred later; they stay in the ledger below
  // (and in its grand total, which answers the different question "what has been
  // charged on this lease?") but must not restate the agreed figure.
  const allFeeItems = contract.fees ?? [];
  const feeItems = allFeeItems.filter(f => !INCURRED_FEE_TYPES.has(f.paymentType ?? ''));
  const incurredGross = g(allFeeItems.filter(f => INCURRED_FEE_TYPES.has(f.paymentType ?? '')));
  const computedRentVat = contract.rentVatRate ? Math.round((contract.annualRent || 0) * Number(contract.rentVatRate)) / 100 : 0;
  const hasRentRows = rentItems.length > 0;
  const rentGross = hasRentRows ? g(rentItems) : (contract.annualRent || 0) + computedRentVat;
  const rentVat = hasRentRows ? v(rentItems) : computedRentVat;
  const otherGross = g(otherItems);
  const feesGross = g(feeItems);
  // Renewals carry the deposit from the original lease (read-only, never re-collected),
  // so it must not appear as a payable line or inflate the headline Total payable here —
  // mirrors the depositForPlan zeroing that feeds the "Payment Plan" modal. The legitimate
  // "Security deposit held (refundable, not in rent total)" ledger footer keeps showing it.
  const deposit = isRenewal ? 0 : (rows.find(p => p.paymentType === 'security_deposit')?.amount ?? contract.securityDeposit?.amount ?? 0);
  // "Other" charges hold their tax in the LABEL, not in vat_amount — a
  // sub-leased building's "5% VAT on sub-lease" row IS tax, so summing
  // vat_amount alone left it out of the header's VAT figure (see lib/chargeTax).
  const otherVat = otherItems.reduce(
    (s, p) => s + (activePmt(p) ? taxPortionOf(p, Number(p.amount) || 0) : 0), 0);
  const totalVat = rentVat + otherVat + v(feeItems);
  const totalPayable = rentGross + otherGross + feesGross + deposit;
  return { aed, rentGross, rentVat, otherGross, feesGross, deposit, totalVat, totalPayable, incurredGross, isRenewal };
}

/** Money actually received on this lease: cleared rent / fee / charge rows,
 *  plus the deposit once cleared (a renewal's carried deposit is not new money). */
export function collectedOf(contract: ContractDetail, payments: ContractPayment[]): number {
  const cleared = (p: ContractPayment) => String(p.effectiveStatus ?? p.chequeStatus ?? '').toLowerCase() === 'cleared';
  const rows = [...(payments ?? []).filter(p => p.paymentType !== 'security_deposit'), ...(contract.fees ?? [])];
  const money = rows.filter(cleared).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const dep = contract.securityDeposit;
  const depCleared = contract.contractType !== 'renewal' && !!dep && !dep.isCarried
    && String(dep.chequeStatus ?? '').toLowerCase() === 'cleared';
  return money + (depCleared ? Number(dep!.amount) || 0 : 0);
}
