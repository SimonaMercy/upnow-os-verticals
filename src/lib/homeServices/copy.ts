/**
 * Truthful customer copy for home-services pricing and after-care.
 *
 * Callout / inspection: quote-priced services (pricingMode 'quote', admin
 * priceUnit 'quote_after_callout') may carry a `minCalloutCharge`. The admin
 * catalogue defines it as "charged for the assessment visit — credited to
 * the job if the customer goes ahead". The checkout does NOT take that money
 * (a quote booking is created without POST /bookings/:id/pay), so the copy
 * says it is payable to the professional on the visit.
 *
 * Guarantee: the only published after-care promise is the checkout's
 * "48h re-do guarantee". A per-service `warrantyDays` from the catalogue wins
 * when one exists (no such field today).
 */

export interface CalloutCopy {
  /** Card / chip text, e.g. "Inspection AED 99" or "Free inspection". */
  short: string;
  /** Sub-line under the price on cards. */
  sub: string;
  /** Full sentence for the checkout summary. */
  line: string;
  /** Primary button on the checkout. */
  cta: string;
  charge: number | null;
}

const fmt = (n: number) => n.toLocaleString('en-AE');

export function calloutCopy(minCalloutCharge: number | string | null | undefined): CalloutCopy {
  const charge = minCalloutCharge == null || minCalloutCharge === '' ? null : Number(minCalloutCharge);
  if (charge != null && Number.isFinite(charge) && charge > 0) {
    return {
      short: `Inspection AED ${fmt(charge)}`,
      sub: 'credited to your final bill',
      line: `Inspection visit AED ${fmt(charge)} — payable to the professional on the visit, and credited to your final bill if you go ahead with the quote. You approve an itemised quote before any work starts.`,
      cta: `Request inspection · AED ${fmt(charge)} on the visit`,
      charge,
    };
  }
  return {
    short: 'Free inspection',
    sub: 'pay only after you approve a quote',
    line: 'Free inspection — a professional inspects the job and you approve an itemised quote before any work starts. You pay only after approving.',
    cta: 'Request free inspection',
    charge: null,
  };
}

/** Published re-do guarantee on the checkout ("48h re-do guarantee"). */
export const REDO_GUARANTEE_HOURS = 48;

export interface GuaranteeView {
  /** Still inside the guarantee window. */
  active: boolean;
  /** When cover ends (null when the completion time is unknown). */
  until: Date | null;
  /** e.g. "Covered by the UpNow 48h re-do guarantee". */
  label: string;
  /** Prefilled dispute title for a rework claim. */
  reworkTitle: string;
}

export function guaranteeView(completedAt: string | null | undefined, now: Date, warrantyDays?: number | null): GuaranteeView {
  const hours = warrantyDays != null && warrantyDays > 0 ? warrantyDays * 24 : REDO_GUARANTEE_HOURS;
  const span = warrantyDays != null && warrantyDays > 0 ? `${warrantyDays}-day warranty` : `${REDO_GUARANTEE_HOURS}h re-do guarantee`;
  const done = completedAt ? new Date(completedAt) : null;
  const until = done && !Number.isNaN(done.getTime()) ? new Date(done.getTime() + hours * 3_600_000) : null;
  const active = until != null && until.getTime() > now.getTime();
  return {
    active,
    until,
    label: warrantyDays != null && warrantyDays > 0 ? `Covered by a ${span}` : `Covered by the UpNow ${span}`,
    reworkTitle: 'Rework needed — the work was not to standard',
  };
}

/** Recurring plans are not built: cleaning checkout states it plainly. */
export const ONE_TIME_NOTE = 'One-time booking (recurring plans coming soon)';

export function isCleaningCategory(catCode: string | null | undefined, svcCode?: string | null): boolean {
  return /clean/i.test(catCode ?? '') || /clean/i.test(svcCode ?? '');
}
