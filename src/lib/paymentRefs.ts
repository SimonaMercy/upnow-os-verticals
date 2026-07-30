/**
 * RP reconciliation references for a contract.
 *
 * The backend (PaymentRefsService, migration 0119) issues per-rental-provider,
 * gapless-per-year numbers so an RP can reconcile against its own bank statement:
 *   • planRefNo           — one per payment plan   (PP-<rp>-<year>-<nnnnn>)
 *   • receiptByPaymentId  — one per received cheque/payment (RCP-<rp>-<year>-<nnnnn>)
 *   • receiptByDepositId  — one per received security deposit, when the deposit is
 *     booked in the `security_deposits` register rather than as a `payments` row
 *     (the backend mints those with source_kind='deposit', so they are keyed by
 *     security_deposits.id and must NOT be looked up in receiptByPaymentId)
 *
 * Two sources, ONE shape, so both sides print the same numbers:
 *   • RP / manager — GET /api/contracts/:id/payment-refs (fetchPaymentRefs below)
 *   • customer     — embedded on GET /api/contracts/tenant/:id as `paymentRefs`
 *     (read-only; the customer endpoint never mints), shaped via shapePaymentRefs.
 *
 * Safe to call anywhere: returns empty refs on any failure so the surrounding page
 * never breaks over a missing number.
 */
export interface PaymentRefs {
  planRefNo: string | null;
  /** payments.id → gapless receipt number (retained even when voided). */
  receiptByPaymentId: Record<number, string>;
  /** security_deposits.id → gapless receipt number (register-booked deposits). */
  receiptByDepositId: Record<number, string>;
  /** The contract's ONE register-booked deposit receipt. A lease holds a single
   *  security deposit, so surfaces that don't carry the register row's id (the
   *  customer contract payload, the magic-link portal) can still resolve its
   *  number. Null when there is none — or, defensively, when a contract somehow
   *  has more than one, since then there is nothing to guess from. */
  depositReceipt: { depositId: number; refNo: string; voided: boolean } | null;
  /** payments.id whose receipt was soft-voided (cheque reverted to a non-cleared
   *  status). The number is kept for the gapless series; surfaces label it VOID
   *  and exclude it from received-money figures. */
  voidedPaymentIds: Set<number>;
  /** security_deposits.id whose receipt was soft-voided — same semantics. */
  voidedDepositIds: Set<number>;
}

interface RefRow {
  series: 'plan' | 'receipt';
  refNo: string;
  sourceKind: 'payment' | 'deposit' | null;
  sourceId: number | null;
  voidedAt?: string | null;
}

/** The wire shape both endpoints return (PaymentRefsService.listForContract). */
export interface RawPaymentRefs {
  planRef?: RefRow | null;
  receipts?: RefRow[];
}

export const EMPTY_PAYMENT_REFS: PaymentRefs = {
  planRefNo: null,
  receiptByPaymentId: {},
  receiptByDepositId: {},
  depositReceipt: null,
  voidedPaymentIds: new Set(),
  voidedDepositIds: new Set(),
};

export function shapePaymentRefs(data: RawPaymentRefs): PaymentRefs {
  const receiptByPaymentId: Record<number, string> = {};
  const receiptByDepositId: Record<number, string> = {};
  const voidedPaymentIds = new Set<number>();
  const voidedDepositIds = new Set<number>();
  for (const r of data.receipts ?? []) {
    if (r.series !== 'receipt' || r.sourceId == null) continue;
    // Deposits are minted against security_deposits.id, payments against payments.id
    // — two different id spaces, so they get their own maps (folding them together
    // would collide and mis-label receipts).
    if (r.sourceKind === 'payment') {
      receiptByPaymentId[r.sourceId] = r.refNo;
      if (r.voidedAt) voidedPaymentIds.add(r.sourceId);
    } else if (r.sourceKind === 'deposit') {
      receiptByDepositId[r.sourceId] = r.refNo;
      if (r.voidedAt) voidedDepositIds.add(r.sourceId);
    }
  }
  const depositIds = Object.keys(receiptByDepositId).map(Number);
  const depositReceipt = depositIds.length === 1
    ? { depositId: depositIds[0], refNo: receiptByDepositId[depositIds[0]], voided: voidedDepositIds.has(depositIds[0]) }
    : null;
  return {
    planRefNo: data.planRef?.refNo ?? null,
    receiptByPaymentId, receiptByDepositId, depositReceipt,
    voidedPaymentIds, voidedDepositIds,
  };
}

export async function fetchPaymentRefs(contractId: number | string, signal?: AbortSignal): Promise<PaymentRefs> {
  try {
    const res = await fetch(`/api/contracts/${contractId}/payment-refs`, { credentials: 'include', signal });
    if (!res.ok) return EMPTY_PAYMENT_REFS;
    return shapePaymentRefs(await res.json());
  } catch {
    return EMPTY_PAYMENT_REFS;
  }
}
