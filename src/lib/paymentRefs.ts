/**
 * RP reconciliation references for a contract (GET /api/contracts/:id/payment-refs).
 *
 * The backend (PaymentRefsService, migration 0119) issues per-rental-provider,
 * gapless-per-year numbers so an RP can reconcile against its own bank statement:
 *   • planRefNo          — one per payment plan   (PP-<rp>-<year>-<nnnnn>)
 *   • receiptByPaymentId  — one per received cheque/payment (RCP-<rp>-<year>-<nnnnn>)
 *
 * This helper flattens the endpoint into the compact shape the plan card / receipt
 * PDF consume, and is safe to call anywhere (returns empty refs on any failure so
 * the surrounding page never breaks over a missing number).
 */
export interface PaymentRefs {
  planRefNo: string | null;
  /** payments.id → gapless receipt number (cleared payments only). */
  receiptByPaymentId: Record<number, string>;
}

interface RefRow {
  series: 'plan' | 'receipt';
  refNo: string;
  sourceKind: 'payment' | 'deposit' | null;
  sourceId: number | null;
}

export const EMPTY_PAYMENT_REFS: PaymentRefs = { planRefNo: null, receiptByPaymentId: {} };

export function shapePaymentRefs(data: { planRef?: RefRow | null; receipts?: RefRow[] }): PaymentRefs {
  const receiptByPaymentId: Record<number, string> = {};
  for (const r of data.receipts ?? []) {
    if (r.series === 'receipt' && r.sourceKind === 'payment' && r.sourceId != null) {
      receiptByPaymentId[r.sourceId] = r.refNo;
    }
  }
  return { planRefNo: data.planRef?.refNo ?? null, receiptByPaymentId };
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
