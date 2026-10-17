/**
 * jobFlow — the two home-services job flows at a glance, counted from the provider's real
 * bookings. Pure (no React / fetch). Partitioning reuses spPipeline (the Operations board's
 * own rules), and every stage's explanation comes from serviceStatusView, so the overview,
 * the board and the customer's "My Services" never disagree about where a job stands.
 *
 *   Fixed price  Request → Confirmed → Technician assigned → On the way → In progress → Done → Paid out
 *   Quote job    Inspection requested → Quote sent → Approved & paid → Work → Done
 */
import { bookingPipeline, bookingStage, isQuotePriced, type PipelineBooking, type SpPipelineTab } from './spPipeline';
import { serviceStatusView } from './statusView';

export interface FlowStageDef { key: string; label: string; hint: string; tab: SpPipelineTab; attention?: boolean }

const fixedHint = (status: string) => serviceStatusView({ status }).spHint;
const quoteHint = (status: string, quoteStatus?: string) => serviceStatusView({ status, pricingMode: 'quote', quoteStatus }).spHint;

export const FIXED_FLOW: FlowStageDef[] = [
  { key: 'booked',      label: 'Request',             tab: 'requests', hint: `Booked, awaiting payment. ${fixedHint('booked')}` },
  { key: 'confirmed',   label: 'Confirmed',           tab: 'requests', hint: fixedHint('confirmed'), attention: true },
  { key: 'assigned',    label: 'Technician assigned', tab: 'requests', hint: fixedHint('assigned') },
  { key: 'en_route',    label: 'On the way',          tab: 'active',   hint: fixedHint('en_route') },
  { key: 'in_progress', label: 'In progress',         tab: 'active',   hint: fixedHint('in_progress') },
  { key: 'done',        label: 'Done',                tab: 'closure',  hint: `${fixedHint('completed')} Disputes sit here too.` },
  { key: 'paid_out',    label: 'Paid out',            tab: 'closure',  hint: 'Signed off — the escrow is released to your earnings.' },
];

export const QUOTE_FLOW: FlowStageDef[] = [
  { key: 'inspection', label: 'Inspection requested', tab: 'quotes',   hint: quoteHint('booked'), attention: true },
  { key: 'quote',      label: 'Quote sent',           tab: 'quotes',   hint: `Drafted, sent or declined. ${quoteHint('booked', 'submitted')}` },
  { key: 'approved',   label: 'Approved & paid',      tab: 'requests', hint: quoteHint('confirmed', 'approved'), attention: true },
  { key: 'work',       label: 'Work',                 tab: 'active',   hint: `On the way or in progress. ${quoteHint('in_progress', 'approved')}` },
  { key: 'done',       label: 'Done',                 tab: 'closure',  hint: quoteHint('completed', 'approved') },
];

export interface JobFlowCounts { fixed: Record<string, number>; quote: Record<string, number>; cancelled: number }

/** Which flow and stage a booking sits in (null = cancelled / unknown status). */
export function jobFlowStage(b: PipelineBooking): { flow: 'fixed' | 'quote'; stage: string } | null {
  const tab = bookingPipeline(b);
  if (!tab) return null;
  const lane = bookingStage(b, tab);
  // A quote still being worked out is a quote job, whatever the catalogue says.
  if (tab === 'quotes') return { flow: 'quote', stage: lane === 'callout' ? 'inspection' : 'quote' };
  if (isQuotePriced(b)) {
    if (tab === 'requests') return { flow: 'quote', stage: 'approved' };
    if (tab === 'active') return { flow: 'quote', stage: 'work' };
    return { flow: 'quote', stage: 'done' };
  }
  if (tab === 'requests' || tab === 'active') return { flow: 'fixed', stage: lane };
  return { flow: 'fixed', stage: lane === 'released' ? 'paid_out' : 'done' };
}

export function countJobFlow(bookings: PipelineBooking[]): JobFlowCounts {
  const fixed: Record<string, number> = Object.fromEntries(FIXED_FLOW.map((s) => [s.key, 0]));
  const quote: Record<string, number> = Object.fromEntries(QUOTE_FLOW.map((s) => [s.key, 0]));
  let cancelled = 0;
  for (const b of bookings) {
    const at = jobFlowStage(b);
    if (!at) { cancelled += 1; continue; }
    const bucket = at.flow === 'fixed' ? fixed : quote;
    if (at.stage in bucket) bucket[at.stage] += 1;
  }
  return { fixed, quote, cancelled };
}
