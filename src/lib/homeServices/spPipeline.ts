/**
 * Pure partition of SP bookings into the Operations pipelines (tabs) and
 * their lanes — extracted from SpOperationsPipelines so it can be unit-tested
 * and so the SP dashboard's counts reuse the exact same rules.
 *
 * Every booking lands in exactly ONE tab and ONE lane of that tab, or is
 * excluded (cancelled / unknown status — those live in the Jobs register).
 *
 *   Requests  booked / confirmed / assigned that are NOT waiting on a quote
 *   Quotes    quote-priced bookings still before approval:
 *               - Callout booked      no quote yet (visit, then quote)
 *               - Quote drafted       draft
 *               - Sent to customer    submitted
 *               - Declined / expired  rejected | expired (revise or let go)
 *   Active    en_route / in_progress
 *   Closure   completed / escrow_release / dispute
 */

export type SpPipelineTab = 'requests' | 'quotes' | 'active' | 'closure';

export interface PipelineBooking {
  status?: string | null;
  /** Top-level pricing mode (booking row) — the service object is the fallback. */
  pricingMode?: string | null;
  service?: { pricingMode?: string | null } | null;
  quote?: { status?: string | null } | null;
  escrowStatus?: string | null;
  source?: 'marketplace' | 'rp_maintenance' | null;
  payer?: 'customer' | 'rental_provider' | null;
}

export interface StageDef { key: string; title: string; match: string[] }

export const REQUEST_STAGES: StageDef[] = [
  { key: 'booked',    title: 'New request',         match: ['booked'] },
  { key: 'confirmed', title: 'Confirmed',           match: ['confirmed'] },
  { key: 'assigned',  title: 'Technician assigned', match: ['assigned'] },
];
// Quotes: lane = the ServiceQuote state. `callout` matches "no quote yet" —
// the empty string is what norm(undefined) yields.
export const QUOTE_STAGES: StageDef[] = [
  { key: 'callout',   title: 'Callout booked',     match: [''] },
  { key: 'draft',     title: 'Quote drafted',      match: ['draft'] },
  { key: 'submitted', title: 'Sent to customer',   match: ['submitted'] },
  { key: 'revise',    title: 'Declined / expired', match: ['rejected', 'expired'] },
];
export const ACTIVE_STAGES: StageDef[] = [
  { key: 'en_route',    title: 'En route',    match: ['en_route'] },
  { key: 'in_progress', title: 'In progress', match: ['in_progress'] },
];
// Closure lanes partition on TWO sources: Dispute reads the booking status;
// Payment released reads the escrow row (bookingStage handles this).
export const CLOSURE_STAGES: StageDef[] = [
  { key: 'completed', title: 'Completion & sign-off', match: ['completed'] },
  { key: 'released',  title: 'Payment released',      match: ['escrow_release'] },
  { key: 'dispute',   title: 'Dispute',               match: ['dispute'] },
];
export const STAGES_FOR_TAB: Record<SpPipelineTab, StageDef[]> = {
  requests: REQUEST_STAGES,
  quotes: QUOTE_STAGES,
  active: ACTIVE_STAGES,
  closure: CLOSURE_STAGES,
};

const REQUEST_SET = new Set(['booked', 'confirmed', 'assigned']);
const ACTIVE_SET = new Set(['en_route', 'in_progress']);
const CLOSURE_SET = new Set(['completed', 'escrow_release', 'dispute']);
const OPEN_QUOTE = new Set(['draft', 'submitted', 'rejected', 'expired']);

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();

export function isQuotePriced(b: PipelineBooking): boolean {
  const m = norm(b.pricingMode ?? b.service?.pricingMode);
  return m === 'quote' || m === 'quote_after_callout';
}

/** Which pipeline a booking belongs to (null = cancelled / unknown → excluded). */
export function bookingPipeline(b: PipelineBooking): SpPipelineTab | null {
  const st = norm(b.status);
  if (st === 'cancelled') return null;
  const q = norm(b.quote?.status);
  // Waiting on a quote: still in the request phase, and either
  //  - quote-priced and not yet approved (callout booked, no quote / draft /
  //    sent / declined / expired) — a quote booking only leaves `booked` once
  //    the quote is approved and paid, so only `booked` counts when the quote
  //    row is absent; or
  //  - any booking carrying a draft/sent quote (e.g. a maintenance estimate).
  const quotePending = REQUEST_SET.has(st) && (
    (isQuotePriced(b) && q !== 'approved' && (st === 'booked' || OPEN_QUOTE.has(q)))
    || q === 'draft' || q === 'submitted'
  );
  if (quotePending) return 'quotes';
  if (REQUEST_SET.has(st)) return 'requests';
  if (ACTIVE_SET.has(st)) return 'active';
  if (CLOSURE_SET.has(st)) return 'closure';
  return null;
}

/** The lane key of a booking inside its tab. */
export function bookingStage(b: PipelineBooking, tab: SpPipelineTab): string {
  const stages = STAGES_FOR_TAB[tab];
  if (tab === 'quotes') {
    const q = norm(b.quote?.status);
    return stages.find(s => s.match.includes(q))?.key ?? 'callout';
  }
  const st = norm(b.status);
  if (tab === 'closure') {
    if (st === 'dispute') return 'dispute';
    if (st === 'escrow_release' || norm(b.escrowStatus) === 'released') return 'released';
    // A landlord-paid maintenance job has no escrow to release — the landlord
    // settles it off-platform at close-out. Once completed it is done here.
    if (b.source === 'rp_maintenance' && b.payer === 'rental_provider' && st === 'completed') return 'released';
    return 'completed';
  }
  return stages.find(s => s.match.includes(st))?.key ?? stages[0].key;
}
