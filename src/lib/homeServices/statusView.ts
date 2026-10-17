/**
 * serviceStatusView — ONE place that turns a home-services booking into what
 * each side reads: the customer's label, the provider's label, a tone, where
 * it sits on the stepper, and whose move it is next.
 *
 * Used by the customer "My Services" page and the SP job detail page so the
 * two never disagree about where a job stands.
 *
 * The booking state machine (SP_MODULE_MASTER_SRS §1, mirrored in
 * src/lib/homeServices/spPipeline.ts):
 *   booked → confirmed → assigned → en_route → in_progress → completed
 *   → dispute | cancelled          (escrow_release is an unused enum member)
 * Quote bookings (pricingMode 'quote', admin priceUnit 'quote_after_callout')
 * stay `booked` through the inspection: the callout attaches a PROVIDER only
 * (no technician, no status move — see admin/operations/[id]), the provider
 * sends a ServiceQuote (draft → submitted → approved | rejected | expired),
 * and only approval + payment moves the booking on to `confirmed`. From there
 * the WORK runs the same assigned → en_route → in_progress → completed path.
 *
 * No-shows are not a status: the booking is `cancelled` and the refund reason
 * code says who did not show (customer_no_show | provider_no_show).
 *
 * Pure TypeScript — no React, no fetch — so it is unit-testable with tsx.
 */

export type ServiceMode = 'fixed' | 'quote';
export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warn' | 'danger';
export type NextActor = 'customer' | 'landlord' | 'provider' | 'platform' | 'none';
export type Terminal = 'cancelled' | 'customer_no_show' | 'provider_no_show' | 'dispute' | null;

export interface StatusInput {
  status: string | null | undefined;
  /** Booking / catalogue pricing mode: 'quote' or 'quote_after_callout' = quote; anything else = fixed. */
  pricingMode?: string | null;
  /** Latest ServiceQuote status, when known (draft | submitted | approved | rejected | expired). */
  quoteStatus?: string | null;
  /** The customer confirmed the job done (sign-off). */
  customerSignedOff?: boolean | null;
  /** The customer left a review. */
  reviewed?: boolean | null;
  /** Refund reason code on a cancelled booking (customer_no_show | provider_no_show | …). */
  refundReasonCode?: string | null;
  /** A provider is attached to the quote callout (admin "Place callout" / auto-dispatch). */
  providerAttached?: boolean | null;
  /** Who approves the quote — a landlord-paid maintenance job is approved by the landlord. */
  approver?: 'customer' | 'landlord';
}

export interface StatusView {
  mode: ServiceMode;
  /** What the customer reads. */
  label: string;
  /** What the provider reads. */
  spLabel: string;
  tone: StatusTone;
  /** Step labels for this mode, in order. */
  steps: readonly string[];
  /** Index of the CURRENT step in `steps` (0-based). -1 when the booking left the path (cancelled / no-show). */
  step: number;
  /** Off-path outcome, if any. */
  terminal: Terminal;
  /** Whose move it is. */
  nextActor: NextActor;
  /** One line telling the customer what happens next. */
  customerHint: string;
  /** One line telling the provider what to do next. */
  spHint: string;
}

export const FIXED_STEPS = ['Booked', 'Confirmed', 'Pro assigned', 'On the way', 'In progress', 'Done', 'Reviewed'] as const;
/**
 * The inspection itself has no status of its own on the backend (the callout
 * stays `booked`), so the stepper reads: request → provider attached →
 * quote → approve & pay → the WORK visit (on the way → in progress) → done.
 */
export const QUOTE_STEPS = ['Inspection requested', 'Inspector assigned', 'Quote', 'Approved & paid', 'On the way', 'Work in progress', 'Done', 'Reviewed'] as const;

/** Every booking status the frontend knows about (for tests and exhaustive maps). */
export const BOOKING_STATUSES = ['booked', 'confirmed', 'assigned', 'en_route', 'in_progress', 'completed', 'escrow_release', 'dispute', 'cancelled'] as const;
export const QUOTE_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'expired'] as const;

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();

export function isQuoteMode(pricingMode: string | null | undefined): boolean {
  const m = norm(pricingMode);
  return m === 'quote' || m === 'quote_after_callout';
}

const humanize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : 'Unknown');

export function serviceStatusView(input: StatusInput): StatusView {
  const st = norm(input.status);
  const mode: ServiceMode = isQuoteMode(input.pricingMode) ? 'quote' : 'fixed';
  const q = norm(input.quoteStatus);
  const approver = input.approver ?? 'customer';
  const signed = Boolean(input.customerSignedOff);
  const reviewed = Boolean(input.reviewed);
  const reason = norm(input.refundReasonCode);

  const base = (v: Omit<StatusView, 'mode' | 'steps'>): StatusView => ({
    mode, steps: mode === 'quote' ? QUOTE_STEPS : FIXED_STEPS, ...v,
  });
  const S = mode === 'quote'
    ? { done: 6, reviewed: 7, enRoute: 4, inProgress: 5, assigned: 3, confirmed: 3 }
    : { done: 5, reviewed: 6, enRoute: 3, inProgress: 4, assigned: 2, confirmed: 1 };

  /* ── Off-path outcomes (same for both modes) ── */
  if (st === 'cancelled') {
    if (reason === 'provider_no_show') {
      return base({ label: 'Professional didn’t arrive — refunded', spLabel: 'Closed — provider no-show', tone: 'danger', step: -1, terminal: 'provider_no_show', nextActor: 'none',
        customerHint: 'The booking was closed and your payment refunded. You can book again any time.', spHint: 'Recorded as a no-show against your account.' });
    }
    if (reason === 'customer_no_show') {
      return base({ label: 'Closed — nobody was home', spLabel: 'Closed — customer no-show', tone: 'danger', step: -1, terminal: 'customer_no_show', nextActor: 'none',
        customerHint: 'The professional arrived but couldn’t get access, so the no-show fee applied.', spHint: 'The no-show fee is settled per the platform terms.' });
    }
    return base({ label: 'Cancelled', spLabel: 'Cancelled', tone: 'danger', step: -1, terminal: 'cancelled', nextActor: 'none',
      customerHint: 'This booking was cancelled.', spHint: 'Nothing to do — the booking was cancelled.' });
  }
  if (st === 'dispute') {
    return base({ label: 'Issue reported — under review', spLabel: 'In dispute — add your side', tone: 'danger', step: S.done, terminal: 'dispute', nextActor: 'platform',
      customerHint: 'UpNow is reviewing the issue with the provider.', spHint: 'Respond to the customer’s report — UpNow decides the outcome.' });
  }

  /* ── Closed out (same shape for both modes) ── */
  if (st === 'completed' || st === 'escrow_release') {
    if (!signed) {
      return base({ label: 'Done — please confirm', spLabel: 'Completed — awaiting customer sign-off', tone: 'success', step: S.done, terminal: null, nextActor: approver,
        customerHint: 'Check the work and confirm it’s done — or report a problem.', spHint: 'Waiting for the customer to confirm the job.' });
    }
    if (!reviewed) {
      return base({ label: 'Completed', spLabel: 'Completed & signed off', tone: 'success', step: S.done, terminal: null, nextActor: approver,
        customerHint: 'How did it go? Leave a review to help others.', spHint: 'Signed off by the customer.' });
    }
    return base({ label: 'Completed & reviewed', spLabel: 'Completed & reviewed', tone: 'success', step: S.reviewed, terminal: null, nextActor: 'none',
      customerHint: 'All done — thanks for your review.', spHint: 'Closed — the customer reviewed this job.' });
  }

  /* ── Fixed price ── */
  if (mode === 'fixed') {
    switch (st) {
      case 'booked':
        return base({ label: 'Awaiting payment', spLabel: 'Awaiting customer payment', tone: 'warn', step: 0, terminal: null, nextActor: 'customer',
          customerHint: 'Payment didn’t go through — complete it to confirm the slot.', spHint: 'Not confirmed until the customer pays.' });
      case 'confirmed':
        return base({ label: 'Confirmed', spLabel: 'Confirmed — assign a technician', tone: 'info', step: 1, terminal: null, nextActor: 'provider',
          customerHint: 'Paid and confirmed — a professional is being assigned.', spHint: 'Assign a technician for the slot.' });
      case 'assigned':
        return base({ label: 'Professional assigned', spLabel: 'Technician assigned', tone: 'info', step: 2, terminal: null, nextActor: 'provider',
          customerHint: 'Your professional is booked for the slot.', spHint: 'Accept the job, then tap “I’m on my way” when you leave.' });
      case 'en_route':
        return base({ label: 'On the way', spLabel: 'On the way', tone: 'progress', step: 3, terminal: null, nextActor: 'provider',
          customerHint: 'Your professional is on the way.', spHint: 'Start the job when you arrive.' });
      case 'in_progress':
        return base({ label: 'In progress', spLabel: 'In progress', tone: 'progress', step: 4, terminal: null, nextActor: 'provider',
          customerHint: 'The work is under way.', spHint: 'Add proof-of-completion photos, then mark complete.' });
    }
  }

  /* ── Quote (inspection → quote → approve & pay → work) ── */
  if (mode === 'quote') {
    const approved = q === 'approved'
      // A quote booking only leaves `booked` once the quote is approved and
      // paid (or a landlord approved it), so a later status implies approval
      // even when the quote row was not loaded.
      || (st !== 'booked' && !['draft', 'submitted', 'rejected', 'expired'].includes(q));
    if (!approved) {
      if (q === 'submitted') {
        return base({ label: approver === 'landlord' ? 'Quote with your landlord' : 'Quote ready — review', spLabel: `Quote sent — awaiting ${approver}`, tone: 'warn', step: 2, terminal: null, nextActor: approver,
          customerHint: approver === 'landlord' ? 'Your landlord is reviewing the provider’s quote.' : 'Review the itemised quote — approve & pay, or decline.', spHint: `Waiting for the ${approver} to approve your quote.` });
      }
      if (q === 'rejected') {
        return base({ label: 'Quote declined', spLabel: 'Quote declined — send a revised quote', tone: 'warn', step: 2, terminal: null, nextActor: 'provider',
          customerHint: 'You declined the quote — the provider can send a revised one, or you can cancel.', spHint: `The ${approver} declined — revise and resend, or let it go.` });
      }
      if (q === 'expired') {
        return base({ label: 'Quote expired', spLabel: 'Quote expired — send a fresh quote', tone: 'warn', step: 2, terminal: null, nextActor: 'provider',
          customerHint: 'The quote expired — ask the provider for a fresh one, or cancel.', spHint: `Send a fresh quote if the ${approver} still wants the job.` });
      }
      if (q === 'draft') {
        return base({ label: 'Quote being prepared', spLabel: 'Quote drafted — send it', tone: 'info', step: 2, terminal: null, nextActor: 'provider',
          customerHint: 'The provider is pricing the job after the inspection.', spHint: `Finish the quote and send it to the ${approver}.` });
      }
      // No quote yet — the booking is still `booked` (the callout). The visit
      // itself has no status on the backend: the callout attaches a provider
      // only, so "on the way / inspecting" cannot be shown truthfully.
      if (input.providerAttached) {
        return base({ label: 'Inspector assigned', spLabel: 'Inspection booked — visit, then quote', tone: 'info', step: 1, terminal: null, nextActor: 'provider',
          customerHint: 'A provider has your request and will inspect at your slot.', spHint: 'Visit at the slot, inspect, then send an itemised quote.' });
      }
      return base({ label: 'Inspection requested', spLabel: 'Inspection booked — visit, then quote', tone: 'warn', step: 0, terminal: null, nextActor: 'provider',
        customerHint: 'We’re matching a professional to inspect the job.', spHint: 'Visit at the slot, inspect, then send an itemised quote.' });
    }
    switch (st) {
      case 'booked':
        return base({ label: 'Quote approved', spLabel: 'Quote approved — confirming payment', tone: 'info', step: 3, terminal: null, nextActor: 'platform',
          customerHint: 'Quote approved — confirming your payment.', spHint: 'Approved — the job confirms once payment clears.' });
      case 'confirmed':
        return base({ label: 'Work scheduled', spLabel: 'Approved & paid — assign a technician', tone: 'info', step: 3, terminal: null, nextActor: 'provider',
          customerHint: 'Quote approved and paid — the work is being scheduled.', spHint: 'Assign a technician for the work.' });
      case 'assigned':
        return base({ label: 'Work scheduled — pro assigned', spLabel: 'Technician assigned for the work', tone: 'info', step: 3, terminal: null, nextActor: 'provider',
          customerHint: 'Your professional is booked to do the work.', spHint: 'Accept the job, then tap “I’m on my way” when you leave.' });
      case 'en_route':
        return base({ label: 'On the way to do the work', spLabel: 'On the way', tone: 'progress', step: 4, terminal: null, nextActor: 'provider',
          customerHint: 'Your professional is on the way to do the work.', spHint: 'Start the job when you arrive.' });
      case 'in_progress':
        return base({ label: 'Work in progress', spLabel: 'Work in progress', tone: 'progress', step: 5, terminal: null, nextActor: 'provider',
          customerHint: 'The approved work is under way.', spHint: 'Add proof-of-completion photos, then mark complete.' });
    }
  }

  /* ── Unknown status — never blank ── */
  return base({ label: humanize(st), spLabel: humanize(st), tone: 'neutral', step: 0, terminal: null, nextActor: 'platform',
    customerHint: '', spHint: '' });
}

/** Tone → colours, shared by both pages (customer + SP use the same chips). */
export const TONE_COLORS: Record<StatusTone, { bg: string; fg: string }> = {
  neutral:  { bg: '#f3f4f6', fg: '#4b5563' },
  info:     { bg: '#e0f2fe', fg: '#0369a1' },
  progress: { bg: '#e0e7ff', fg: '#4338ca' },
  success:  { bg: '#d8efe3', fg: '#1a7a5a' },
  warn:     { bg: '#fef3c7', fg: '#92400e' },
  danger:   { bg: '#fee2e2', fg: '#991b1b' },
};
