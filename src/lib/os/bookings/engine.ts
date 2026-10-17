/**
 * PREVIEW booking engine — pure functions, no React, no storage.
 *
 * Implements the contract in ./types for the four booking models (short stays, venues,
 * courts, yacht charters). The store (./store) wires these into localStorage; a future API
 * can reuse the same rules server-side.
 *
 * Rules follow research_notes/Short stay venue court booking flows/*.md and MarketSpace
 * (upnow-marketspace data/listings.js, pw/demand.js, pw/packs.js):
 *   • stays (Airbnb/Booking.com): request answered within 24h; pre-approval / special offer
 *     valid 24h; a pending request holds the dates, an enquiry or offer does not; guest pays
 *     within 24h of acceptance; payout 24h after check-in; 14-day review + damage-claim window;
 *     every guest registered with DET (ID per guest); Tourism Dirham per bedroom per night.
 *   • venues (Tagvenue/Peerspace/Hire Space, Dubai hotels): request answered within 48h;
 *     quotes valid 7 days (RULES.offerValidHours.venue — the one value every screen uses);
 *     provisional option hold 7 days; holding deposit due within 3 days, balance 14 days before
 *     the event; final numbers 7 days before; 10% service charge then 5% VAT on (hire + service).
 *   • courts (Playtomic/MATCHi/Playo): 10-minute checkout hold; split shares payable until
 *     2h after the match, then charged to the booking owner; no-show 15 min after start
 *     without check-in; peak from 16:00 and Fri/Sat; prices VAT-inclusive; weekly payout.
 *   • charters (Dubai operators): request answered within 48h; deposit within 24h, balance
 *     48h before departure; guest manifest (ID per guest) by 18:00 the day before; 5% VAT on
 *     hire + add-ons (MarketSpace detail/spaces.js); payout 3 days after the trip.
 *   • enquiries (MarketSpace demand.js SLA = 15): first reply within 15 minutes; an enquiry
 *     closes itself when the requested start passes or after 7 days with no activity.
 *
 * Money is integer fils; each line is rounded once. Day boundaries / weekends use
 * Asia/Dubai, which is a fixed UTC+4 (no daylight saving), so the offset is a constant.
 *
 * PAYMENT MODE (per listing, copied onto each booking at creation — see types.PaymentMode):
 *   P = 'platform' — paid on UpNow (simulated card): holds, refunds by policy, payouts.
 *   D = 'direct'   — MarketSpace lead flow: no instant book; nothing is charged on UpNow; the
 *       provider confirms and marks payments received (cash / card at venue / bank transfer);
 *       no UpNow deposit hold, payout or refund (refundFor → 'Refund is handled by the host').
 *       Direct venues and yachts are PROVISIONAL until the deposit is recorded; stays and
 *       courts are confirmed at once (pay at check-in / at the venue).
 *
 * ============================================================================ STATE MACHINE
 * Models: S stay · V venue · C court · Y yacht charter.  Modes: P platform · D direct.
 * Every deadline is capped at the booking start (except the court split settlement, end + 2h).
 *
 * CREATE (customer)
 *   enquiry   all models, both modes. Dates optional (openDates: call-back / email lead)
 *             → enquiry, respondBy = now + 15 min. Call-button clicks are NOT logged; a lead is
 *             created only when the customer leaves name + phone ("Request a call back").
 *   request   S/V/Y both modes, C direct only → requested, respondBy = now + 24h S · 48h V/Y · 30 min C(D)
 *   instant   P only. S/V with instantBook (V ≥ 24h ahead): card charged → confirmed.
 *             C(P) always → held, holdExpiresAt = now + 10 min.
 *   series    C only, 2–8 weekly occurrences of the same slot (createSeries). Week 1 must be
 *             free; every other week is availability-checked on its own — taken weeks are
 *             SKIPPED (listed on every occurrence) and the free ones are booked: instant (P,
 *             each held 10 min — "Pay all weeks") or request (D, the club confirms each).
 *
 * STATE            ACTOR     ACTION                         GUARD                                       → NEXT
 * enquiry          provider  reply                          text                                        enquiry (stops the 15-min clock)
 *                  provider  send_offer (+dates)            lines, total>0, dates present, free if req  offer_sent; offerExpiresAt = now + 24h S/Y · 168h V · 2h C
 *                  provider  confirm_booking (+dates)       dates/slot/guests present (collected in the drawer when missing), priced,
 *                                                           start > now, no conflict                    P: awaiting_payment (pay within 24h S/Y · 3d V · 2h C)
 *                                                                                                       D: confirmed (S/C) · provisional (V/Y)
 *                  provider  decline (reason)                                                           declined
 *                  provider  mark_lost (reason)             reason                                      lost
 *                  provider  schedule_visit (V)             future, before start                        enquiry (+task, event)
 *                  customer  message                        text                                        enquiry (re-arms the 15-min clock once answered)
 *                  customer  cancel "Withdraw enquiry"                                                  cancelled_by_customer
 *                  system    sweep                          dated & start passed, or 7d no activity    expired
 * offer_sent       customer  accept_offer                   before offerExpiresAt / start, no conflict  P: S/Y awaiting_payment (24h) · V held (option 7d) · C held (10 min)
 *                                                                                                       D: S/C confirmed · V/Y provisional
 *                  customer  decline_offer                                                              enquiry (offer withdrawn, hold released, provider reply clock 15 min)
 *                  customer  cancel "Withdraw enquiry"                                                  cancelled_by_customer
 *                  provider  send_offer (revise)            as above                                    offer_sent (version + 1, new deadline)
 *                  provider  confirm_booking                as above                                    as above
 *                  provider  decline "Withdraw offer"                                                   declined
 *                  provider  mark_lost                                                                  lost
 *                  system    sweep                          offerExpiresAt passed                       expired
 *                  (a counter-offer to a request — offerHolds — keeps the dates held until it lapses)
 * requested        provider  accept                         before respondBy                            P: awaiting_payment (24h S/Y · 3d V)   D: confirmed S/C · provisional V/Y
 *                  provider  send_offer "Counter-offer"     new dates free                              offer_sent + offerHolds (dates stay held, customer gets a new deadline)
 *                  provider  decline                                                                    declined
 *                  customer  cancel "Withdraw request"                                                  cancelled_by_customer
 *                  system    sweep                          respondBy passed                            expired
 * held (P)         customer  pay (gating)                   before holdExpiresAt                        confirmed (C split → awaiting_payment)
 *  V option /      provider  accept (V)                                                                 awaiting_payment (deposit in 3d)
 *  C checkout      provider  decline "Release option" (V)                                               declined
 *                  provider  record_payment / waive_payment (gating)                                    confirmed
 *                  customer  cancel                                                                     cancelled_by_customer
 *                  system    sweep                          holdExpiresAt passed                        expired (due payments waived)
 * awaiting_payment customer  pay (gating)                   before payBy                                confirmed
 *  (P)             provider  record_payment / waive_payment (gating)                                    confirmed
 *                  provider  send_reminder                  payment due, none for it in the last hour   same (event)
 *                  either    cancel                                                                     cancelled_by_customer / cancelled_by_provider (full refund)
 *                  system    sweep                          payBy passed (not a split court)            expired (due payments waived)
 *                  C split: owner paid → waits until end + 2h; check_in / mark_no_show allowed; sweep charges unpaid shares to the owner → confirmed.
 * provisional (D   provider  record_payment / waive_payment (deposit or full)                           confirmed
 *  V/Y)            provider  extend_hold (until)            releaseAt < until ≤ start                   provisional (releaseAt and deposit due date moved)
 *                  provider  release_hold (reason)          reason                                      lost (due payments waived)
 *                  provider  send_reminder                                                              same
 *                  either    cancel                                                                     cancelled_by_customer / cancelled_by_provider
 *                  system    sweep                          releaseAt passed                            expired (due payments waived)
 * confirmed        provider  check_in / start               C: 60 min before; others from start day     checked_in (S/C) · in_progress (V/Y)
 *                  provider  mark_no_show                   after start (C: + 15 min)                   no_show
 *                  provider  record_payment · waive_payment · send_reminder · complete_task · schedule_visit (V)
 *                  either    cancel                                                                     cancelled_*
 *                  system    sweep (C)                      no check-in by start + 15 min               no_show
 * checked_in /     provider  complete                                                                   completed (reviewBy = end + 14d; S(P) depositClaimBy = end + 14d)
 *  in_progress     provider  release_deposit (P)                                                        same
 *                  system    sweep (C)                      end passed                                  completed
 * completed        customer  review                         before reviewBy                             same
 *                  provider  release_deposit / claim_deposit (P, claim before depositClaimBy)           same
 *                  provider  record_payment · waive_payment · send_reminder ("Settle up")               same
 *                  system    sweep                          review + deposit windows passed AND nothing due → closed
 * no_show          provider  release_deposit / claim_deposit (P; S claim window start + 14d)            same
 *                  provider  record_payment · waive_payment · send_reminder                             same
 * TERMINAL: declined · expired · lost · cancelled_by_customer · cancelled_by_provider · closed
 *           (no_show is terminal for state changes; money on it can still be settled).
 *
 * CHANGE (reschedule) loop — in held, awaiting_payment, provisional, confirmed; before the start;
 * split-payment courts are locked. Re-priced with priceFor (special-offer discount lines carried
 * over) and conflict-checked at proposal and again at acceptance.
 *   provider change_dates 'apply'   → applied at once. D: any price (agreed with the customer
 *                                     outside UpNow). P: only when the total does not go up.
 *   provider change_dates 'propose' → pendingChange{by provider, expires min(now + 24h, start)}
 *                                     → customer accept_change | decline_change
 *   customer request_change         → only until the free-change cutoff (= the policy's free-
 *                                     cancellation cutoff; never on non-refundable) → pendingChange{by customer}
 *                                     → provider accept_change | decline_change
 *   Either side's new proposal replaces the pending one (counter-proposal); the proposer can
 *   withdraw it (decline_change). Accept: new dates + lines; payments adjusted (nothing paid →
 *   schedule rebuilt; else the difference is added as a due payment, or taken off due payments
 *   and refunded on P / returned directly on D); start-relative due dates, tasks and payout move.
 *   The state never changes, so accept / decline / expiry all return to the state it was in.
 *   Sweep clears a lapsed proposal (event 'change_expired').
 *
 * MESSAGES — both sides, until closed: allowed in every state except declined, expired, lost and closed.
 * nextActions(b, side, listing, now) dry-runs every option (or its guard, for options that need
 * input such as dates), so no button is shown that the engine would refuse.
 */
import type {
  AvailabilityBlock, Booking, BookingEvent, BookingModel, BookingState, CharterListing, CourtListing,
  CustomerAction, DatesPatch, LeadSource, LineItem, ListingSettings, NewBookingInput, PaymentMode, PaymentRecord, PendingChange, PreviewListing,
  ProviderAction, ShortStayListing, VenueLayout, VenueListing,
} from './types';
import { POLICY_LABEL, freeChangeCutoff, policySummary, providerCancellationFor, refundFor } from './policies';

// ---------------------------------------------------------------------------- time

export const MIN_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
/** Asia/Dubai = UTC+4 all year (no DST). */
export const DUBAI_OFFSET_MS = 4 * HOUR_MS;

export const ms = (iso: string): number => new Date(iso).getTime();
export const iso = (t: number): string => new Date(t).toISOString();

/** Calendar parts of an instant, as seen in Dubai. dow: 0 = Sunday … 5 = Friday, 6 = Saturday. */
export function dubaiParts(t: number): { y: number; m: number; d: number; dow: number; hour: number; minute: number } {
  const x = new Date(t + DUBAI_OFFSET_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), dow: x.getUTCDay(), hour: x.getUTCHours(), minute: x.getUTCMinutes() };
}
/** 00:00 Dubai of the day containing t. */
export function dubaiDayStart(t: number): number {
  return Math.floor((t + DUBAI_OFFSET_MS) / DAY_MS) * DAY_MS - DUBAI_OFFSET_MS;
}
/** hh:mm Dubai on the day containing t (dayOffset shifts by whole days). */
export function dubaiAt(t: number, hh: number, mm = 0, dayOffset = 0): number {
  return dubaiDayStart(t) + dayOffset * DAY_MS + hh * HOUR_MS + mm * MIN_MS;
}
/** Friday or Saturday in Dubai. */
export function isDubaiWeekend(t: number): boolean {
  const dow = dubaiParts(t).dow;
  return dow === 5 || dow === 6;
}
/** Nights between check-in and check-out, counted on Dubai calendar days. */
export function nightsBetween(startIso: string, endIso: string): number {
  return Math.round((dubaiDayStart(ms(endIso)) - dubaiDayStart(ms(startIso))) / DAY_MS);
}
/** First Thursday 00:00 Dubai strictly after t (weekly court payouts). */
export function nextThursday(t: number): number {
  const day = dubaiDayStart(t);
  const dow = dubaiParts(t).dow;
  const add = ((4 - dow + 7) % 7) || 7;
  return day + add * DAY_MS;
}

/** '5h 12m', '8 min', '3d 4h'. */
export function formatDuration(deltaMs: number): string {
  const m = Math.max(0, Math.round(Math.abs(deltaMs) / MIN_MS));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Sun 25 Oct, 18:00' in Dubai (event text; no Intl so it is identical on server and client). */
export function formatDubai(t: number): string {
  const p = dubaiParts(t);
  return `${DOW_SHORT[p.dow]} ${p.d} ${MON_SHORT[p.m - 1]}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------- money

/** 'AED 1,250' or 'AED 1,250.50' (label text; integer maths only). */
export function formatAED(fils: number): string {
  const neg = fils < 0;
  const a = Math.abs(Math.round(fils));
  const whole = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = a % 100;
  return `${neg ? '−' : ''}AED ${whole}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}
/** pct% of an amount, rounded once to whole fils. */
export const pctOf = (fils: number, pct: number): number => Math.round((fils * pct) / 100);
/** The 5% VAT contained in a VAT-inclusive price (price × 5/105). */
export const vatIncludedFils = (fils: number, vatPct = 5): number => Math.round((fils * vatPct) / (100 + vatPct));
/** Total the customer pays: every line except deposit holds. */
export const sumLines = (lines: LineItem[]): number => lines.reduce((s, l) => (l.kind === 'deposit_hold' ? s : s + l.fils), 0);
/** The card hold shown separately (damage deposit / security hold). */
export const depositHoldFils = (b: Pick<Booking, 'lineItems'>): number => b.lineItems.filter((l) => l.kind === 'deposit_hold').reduce((s, l) => s + l.fils, 0);
export const paidFils = (b: Pick<Booking, 'payments'>): number => b.payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.fils, 0);
export const refundedFils = (b: Pick<Booking, 'payments'>): number => b.payments.filter((p) => p.status === 'refunded').reduce((s, p) => s + p.fils, 0);
export const netPaidFils = (b: Pick<Booking, 'payments'>): number => paidFils(b) - refundedFils(b);
export const dueFils = (b: Pick<Booking, 'payments'>): number => b.payments.filter((p) => p.status === 'due').reduce((s, p) => s + p.fils, 0);


// ---------------------------------------------------------------------------- labels

export const MODEL_LABEL: Record<BookingModel, string> = {
  shortstay: 'Short-term bookings',
  venue: 'Venue reservations',
  court: 'Court bookings',
  charter: 'Yacht charters',
};

export const STATE_LABEL: Record<BookingState, string> = {
  enquiry: 'Enquiry',
  offer_sent: 'Offer sent',
  requested: 'Request pending',
  held: 'On hold',
  awaiting_payment: 'Awaiting payment',
  provisional: 'Awaiting deposit',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled_by_customer: 'Cancelled by customer',
  cancelled_by_provider: 'Cancelled by provider',
  no_show: 'No-show',
  lost: 'Lost',
  closed: 'Closed',
};

/**
 * Model-specific wording. The SAME label is used for the provider's board column and the
 * customer's status pill, so both sides always name a state the same way.
 */
const STATE_LABEL_BY_MODEL: Partial<Record<BookingModel, Partial<Record<BookingState, string>>>> = {
  shortstay: { completed: 'Checked out' },
  venue: { offer_sent: 'Quote sent', held: 'Provisional hold', awaiting_payment: 'Deposit due', in_progress: 'Event day', completed: 'Event completed' },
  court: { offer_sent: 'Slot offered', requested: 'Slot requested', held: 'Checkout hold', completed: 'Played' },
  charter: { offer_sent: 'Quote sent', awaiting_payment: 'Deposit due', checked_in: 'Departed', in_progress: 'At sea', completed: 'Returned' },
};
export function stateLabelFor(model: BookingModel, state: BookingState): string {
  return STATE_LABEL_BY_MODEL[model]?.[state] ?? STATE_LABEL[state];
}
/** Customer-side wording for the one provider-internal state ('lost' reads "Closed by the provider"). */
export function customerStateLabel(model: BookingModel, state: BookingState): string {
  return state === 'lost' ? 'Closed by provider' : stateLabelFor(model, state);
}

export type StateTone = 'neutral' | 'primary' | 'amber' | 'danger' | 'info' | 'dark';
export const STATE_TONE: Record<BookingState, StateTone> = {
  enquiry: 'neutral',
  offer_sent: 'info',
  requested: 'amber',
  held: 'amber',
  awaiting_payment: 'amber',
  provisional: 'amber',
  confirmed: 'primary',
  checked_in: 'primary',
  in_progress: 'primary',
  completed: 'dark',
  declined: 'danger',
  expired: 'neutral',
  cancelled_by_customer: 'danger',
  cancelled_by_provider: 'danger',
  no_show: 'danger',
  lost: 'neutral',
  closed: 'neutral',
};

/** Board columns, in order, per model — every non-ended state the model can reach has its own column. */
export const MODEL_FLOW: Record<BookingModel, BookingState[]> = {
  shortstay: ['enquiry', 'offer_sent', 'requested', 'awaiting_payment', 'confirmed', 'checked_in', 'completed', 'closed'],
  venue: ['enquiry', 'offer_sent', 'requested', 'held', 'awaiting_payment', 'provisional', 'confirmed', 'in_progress', 'completed', 'closed'],
  court: ['enquiry', 'offer_sent', 'requested', 'held', 'awaiting_payment', 'confirmed', 'checked_in', 'completed'],
  charter: ['enquiry', 'offer_sent', 'requested', 'awaiting_payment', 'provisional', 'confirmed', 'in_progress', 'completed', 'closed'],
};

/** The board column a booking sits in (null = ended or not a column, shown in history). */
export function boardColumnOf(b: Pick<Booking, 'model' | 'state'>): BookingState | null {
  return MODEL_FLOW[b.model].includes(b.state) ? b.state : null;
}

/** Columns only platform (pay-on-UpNow) bookings can reach — hidden for a direct-only business when empty. */
export const PLATFORM_ONLY_COLUMNS: Record<BookingModel, BookingState[]> = {
  shortstay: ['awaiting_payment'],
  venue: ['held', 'awaiting_payment'],
  court: ['held', 'awaiting_payment'],
  charter: ['awaiting_payment'],
};
/** Columns only direct-pay bookings can reach — hidden for a platform-only business when empty. */
export const DIRECT_ONLY_COLUMNS: Record<BookingModel, BookingState[]> = {
  shortstay: [],
  venue: ['provisional'],
  court: [],
  charter: ['provisional'],
};

// ---------------------------------------------------------------------------- payment mode

export const modeOf = (b: { paymentMode?: PaymentMode }): PaymentMode => b.paymentMode ?? 'platform';
export const isDirect = (b: { paymentMode?: PaymentMode }): boolean => modeOf(b) === 'direct';
export const sourceOf = (b: { source?: LeadSource }): LeadSource => b.source ?? 'form';

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = { platform: 'On UpNow', direct: 'Direct' };
export const SOURCE_LABEL: Record<LeadSource, string> = { form: 'Form', call: 'Call', whatsapp: 'WhatsApp', email: 'Email' };
export const METHOD_LABEL: Record<NonNullable<PaymentRecord['method']>, string> = {
  card: 'Card', pay_at_venue: 'Pay at venue', bank_transfer: 'Bank transfer', pay_direct: 'Pay provider directly', cash: 'Cash', card_at_venue: 'Card at venue',
};
/** How a provider can record a direct payment as received. */
export const DIRECT_RECEIVED_METHODS = ['cash', 'card_at_venue', 'bank_transfer'] as const;
export type DirectReceivedMethod = (typeof DIRECT_RECEIVED_METHODS)[number];

/** The seed listing with the provider's settings applied. Direct listings never instant-book; platform courts always do. */
export function effectiveListing(l: PreviewListing, settings?: ListingSettings): PreviewListing {
  const paymentMode = settings?.paymentMode ?? l.paymentMode ?? 'platform';
  let instantBook = settings?.instantBook ?? l.instantBook;
  if (paymentMode === 'direct') instantBook = false;
  else if (l.model === 'court') instantBook = true;
  if (paymentMode === l.paymentMode && instantBook === l.instantBook) return l;
  return { ...l, paymentMode, instantBook } as PreviewListing;
}

/** True when the booking has dates (an open-dates enquiry has none until the provider adds them). */
export const hasDates = (b: Pick<Booking, 'start' | 'end'>): boolean => Number.isFinite(ms(b.start)) && Number.isFinite(ms(b.end));

/**
 * Customer journey stepper labels.
 *   P — MarketSpace packs.js: stay Reservation → Payment → Check-in → Stay → Review; venue
 *       Reservation → Deposit → Preparation → Access → Settlement; court Booking → Payment →
 *       Access → Play → Review; yacht Reservation → Deposit → Guest details → Trip → Settlement.
 *   D — MarketSpace listings.js flows (the lead marketplace).
 */
export function journeyOf(x: { model: BookingModel; paymentMode?: PaymentMode }): string[] {
  if (modeOf(x) === 'direct') {
    switch (x.model) {
      case 'shortstay': return ['Enquiry', 'Host confirms dates', 'Pay host directly', 'Check-in', 'Review'];
      case 'venue': return ['Enquiry', 'Quote', 'Site visit', 'Deposit to venue', 'Event day'];
      case 'court': return ['Enquiry', 'Slot confirmed', 'Pay at venue', 'Play', 'Review'];
      case 'charter': return ['Enquiry', 'Deposit to operator', 'Guest list', 'Trip', 'Settlement'];
    }
  }
  switch (x.model) {
    case 'shortstay': return ['Reservation', 'Payment', 'Check-in', 'Stay', 'Review'];
    case 'venue': return ['Reservation', 'Deposit', 'Preparation', 'Access', 'Settlement'];
    case 'court': return ['Booking', 'Payment', 'Access', 'Play', 'Review'];
    case 'charter': return ['Reservation', 'Deposit', 'Guest details', 'Trip', 'Settlement'];
  }
}

/**
 * The step in journeyOf(booking) that is in progress (earlier steps are done). Returns
 * journeyOf().length when every step is done. Ended bookings (declined, expired, lost,
 * cancelled, no-show) return the step they stopped at — show them as stopped there.
 */
export function journeyIndexOf(b: Booking): number {
  let state = b.state;
  if (isEnded(state) && state !== 'closed') {
    const known = (MODEL_FLOW[b.model] as string[]).concat(['requested', 'enquiry', 'provisional']);
    const last = [...b.events].reverse().find((e) => known.includes(e.type) && !ENDED_STATES.includes(e.type as BookingState));
    state = (last?.type as BookingState | undefined) ?? 'enquiry';
  }
  const due = (pred: (p: PaymentRecord) => boolean) => b.payments.some((p) => p.status === 'due' && pred(p));
  const anyDue = due(() => true);
  const reviewed = !!b.review;
  const pre = ['enquiry', 'offer_sent', 'requested', 'held', 'awaiting_payment', 'provisional'].includes(state);
  const manifestPending = !b.customer.idProvided || b.tasks.some((t) => t.key === 'manifest' && !t.done);
  if (state === 'closed') return 5;
  if (isDirect(b)) {
    switch (b.model) {
      case 'shortstay':
      case 'court':
        if (pre) return 1;
        if (state === 'confirmed') return anyDue ? 2 : 3;
        if (state === 'checked_in' || state === 'in_progress') return 3;
        return reviewed ? 5 : 4;
      case 'venue': {
        if (state === 'enquiry' || state === 'requested') return 0;
        const visit = b.tasks.find((t) => t.key === 'site_visit');
        if (state === 'provisional') return visit && !visit.done ? 2 : 3;
        if (pre) return 1;
        if (state === 'confirmed') {
          if (visit && !visit.done) return 2;
          return due((p) => p.id.endsWith('-dep') || p.id.endsWith('-full')) ? 3 : 4;
        }
        if (state === 'in_progress' || state === 'checked_in') return 4;
        return 5;
      }
      case 'charter':
        if (state === 'provisional') return 1;
        if (pre) return 0;
        if (state === 'confirmed') {
          if (due((p) => p.id.endsWith('-dep') || p.id.endsWith('-full'))) return 1;
          return manifestPending ? 2 : 3;
        }
        if (state === 'in_progress' || state === 'checked_in') return 3;
        return anyDue ? 4 : 5;
    }
  }
  switch (b.model) {
    case 'shortstay':
      if (state === 'awaiting_payment') return 1;
      if (pre) return 0;
      if (state === 'confirmed') return 2;
      if (state === 'checked_in' || state === 'in_progress') return 3;
      return reviewed ? 5 : 4;
    case 'venue':
      if (state === 'awaiting_payment') return 1;
      if (pre) return 0;
      if (state === 'confirmed') return 2;
      if (state === 'in_progress' || state === 'checked_in') return 3;
      return anyDue || depositStatus(b) === 'held' ? 4 : 5;
    case 'court':
      if (state === 'enquiry' || state === 'offer_sent' || state === 'requested') return 0;
      if (state === 'held' || (state === 'awaiting_payment' && !isSplitCourt(b))) return 1;
      if (state === 'awaiting_payment' || state === 'confirmed') return 2;
      if (state === 'checked_in' || state === 'in_progress') return 3;
      return reviewed ? 5 : 4;
    case 'charter':
      if (state === 'awaiting_payment') return 1;
      if (pre) return 0;
      if (state === 'confirmed') return manifestPending ? 2 : 3;
      if (state === 'in_progress' || state === 'checked_in') return 3;
      return anyDue || depositStatus(b) === 'held' ? 4 : 5;
  }
}

/** States that occupy the calendar (Airbnb: a request holds the dates, an enquiry/offer does not — except a counter-offer to a request). */
export const HOLDING_STATES: readonly BookingState[] = ['requested', 'held', 'awaiting_payment', 'provisional', 'confirmed', 'checked_in', 'in_progress'];
/** Ending states — no further state changes. */
export const ENDED_STATES: readonly BookingState[] = ['declined', 'expired', 'cancelled_by_customer', 'cancelled_by_provider', 'no_show', 'lost', 'closed'];
export const isEnded = (s: BookingState): boolean => ENDED_STATES.includes(s);
/** States where neither side can message any more (messages stay open until the booking is closed). */
const MESSAGES_CLOSED: readonly BookingState[] = ['declined', 'expired', 'lost', 'closed'];
export const canMessage = (b: Pick<Booking, 'state'>): boolean => !MESSAGES_CLOSED.includes(b.state);
/** States where money on the booking can still be settled (record / waive / remind). */
const SETTLE_STATES: readonly BookingState[] = ['held', 'awaiting_payment', 'provisional', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show', 'closed'];
/** States in which dates / slot can be changed. */
export const CHANGE_STATES: readonly BookingState[] = ['held', 'awaiting_payment', 'provisional', 'confirmed'];

// ---------------------------------------------------------------------------- defaults (research)

export const RULES = {
  enquiryFirstReplyMin: 15,                                    // MarketSpace demand.js SLA = 15 (first reply)
  enquiryStaleDays: 7,                                         // enquiry closes after 7 days with no activity
  requestRespondHours: { shortstay: 24, venue: 48, court: 0, charter: 48 } as Record<BookingModel, number>,
  offerValidHours: { shortstay: 24, venue: 7 * 24, court: 2, charter: 24 } as Record<BookingModel, number>,
  confirmPayWithinHours: { shortstay: 24, venue: 72, court: 2, charter: 24 } as Record<BookingModel, number>, // provider-confirmed enquiry (platform)
  venueOptionHoldDays: 7,
  courtCheckoutHoldMin: 10,
  payWithinHours: { shortstay: 24, charter: 24 },
  venueDepositDueDays: 3,
  venueBalanceDaysBefore: 14,
  charterBalanceHoursBefore: 48,
  courtSplitSettleHoursAfterEnd: 2,
  courtNoShowGraceMin: 15,
  courtPeakFromHour: 16,
  courtSeriesMaxWeeks: 8,
  reviewWindowDays: 14,
  depositClaimDays: 14,
  stayPayoutHoursAfterCheckIn: 24,
  payoutDaysAfterEnd: 3,                                       // venues / charters
  venueFinalNumbersDaysBefore: 7,
  venuePermitDaysBefore: 10,                                   // DET e-permit ~5 working days to process
  stayCheckInInstructionsHoursBefore: 48,
  instantVenueMinLeadHours: 24,                                // Peerspace: instant only if ≥24h away
  directCourtRespondMin: 30,                                   // direct-mode court request: club confirms within 30 min (no checkout hold)
  changeProposalValidHours: 24,                                // a date-change proposal lapses after 24h (or at the start)
  reminderCooldownMin: 60,                                     // one payment reminder per payment per hour
  charterVatPct: 5,
} as const;

/** Hours the provider has to answer a request-to-book, by model and payment mode. */
export function respondHoursFor(model: BookingModel, mode: PaymentMode = 'platform'): number {
  if (model === 'court' && mode === 'direct') return RULES.directCourtRespondMin / 60;
  return RULES.requestRespondHours[model];
}
/** Default validity of an offer / quote, in hours (one value for every screen). */
export const offerValidHoursFor = (model: BookingModel): number => RULES.offerValidHours[model];

// ---------------------------------------------------------------------------- pricing

export interface PriceInput {
  listingId?: string;
  start: string;
  end: string;
  guests: number;
  details: Booking['details'];
}
export interface PriceResult { lineItems: LineItem[]; totalFils: number; error?: string }

const fail = (error: string): PriceResult => ({ lineItems: [], totalFils: 0, error });
const done = (lineItems: LineItem[]): PriceResult => ({ lineItems, totalFils: sumLines(lineItems) });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const hoursText = (minutes: number) => String(minutes / 60);

export function priceFor(listing: PreviewListing, input: PriceInput): PriceResult {
  const s = ms(input.start);
  const e = ms(input.end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return fail('Choose valid dates');
  if (e <= s) return fail('End must be after start');
  if (!Number.isInteger(input.guests) || input.guests < 1) return fail('At least 1 guest');
  switch (listing.model) {
    case 'shortstay': return priceStay(listing, input, s);
    case 'venue': return priceVenue(listing, input, s, e);
    case 'court': return priceCourt(listing, input, s, e);
    case 'charter': return priceCharter(listing, input, s, e);
  }
}

function priceStay(l: ShortStayListing, input: PriceInput, s: number): PriceResult {
  const nights = nightsBetween(input.start, input.end);
  if (nights < 1) return fail('Check-out must be at least one night after check-in');
  if (nights < l.minNights) return fail(`Minimum stay is ${plural(l.minNights, 'night')}`);
  if (input.guests > l.maxGuests) return fail(`This home sleeps up to ${l.maxGuests} guests`);
  const d = input.details;
  if (d.adults != null && (!Number.isInteger(d.adults) || d.adults < 1)) return fail('At least 1 adult');
  if (d.adults != null && d.adults + (d.children ?? 0) !== input.guests) return fail('Guests must equal adults + children');
  let weekday = 0;
  let weekend = 0;
  const first = dubaiDayStart(s);
  for (let i = 0; i < nights; i++) {
    if (l.weekendNightlyFils != null && isDubaiWeekend(first + i * DAY_MS + 12 * HOUR_MS)) weekend++;
    else weekday++;
  }
  const lines: LineItem[] = [];
  if (weekday) lines.push({ key: 'nights', label: `${formatAED(l.nightlyFils)} × ${plural(weekday, 'night')}`, fils: l.nightlyFils * weekday, kind: 'base' });
  if (weekend && l.weekendNightlyFils != null) {
    lines.push({ key: 'weekend_nights', label: `${formatAED(l.weekendNightlyFils)} × ${plural(weekend, 'weekend night')} (Fri/Sat)`, fils: l.weekendNightlyFils * weekend, kind: 'base' });
  }
  if (l.cleaningFeeFils) lines.push({ key: 'cleaning', label: 'Cleaning fee', fils: l.cleaningFeeFils, kind: 'fee' });
  const bedrooms = Math.max(1, Math.min(l.bedrooms, input.details.bedrooms ?? l.bedrooms));
  if (l.tourismDirhamPerBedroomNightFils) {
    lines.push({
      key: 'tourism_dirham',
      label: `Tourism Dirham (${formatAED(l.tourismDirhamPerBedroomNightFils)} × ${plural(bedrooms, 'bedroom')} × ${plural(nights, 'night')})`,
      fils: l.tourismDirhamPerBedroomNightFils * bedrooms * nights,
      kind: 'tax',
    });
  }
  if (l.damageDepositFils) {
    lines.push({
      key: 'damage_deposit',
      label: l.paymentMode === 'direct' ? 'Damage deposit (collected by the host, refundable)' : 'Damage deposit (card hold, released after check-out)',
      fils: l.damageDepositFils, kind: 'deposit_hold',
    });
  }
  return done(lines);
}

export function venueLayoutOf(l: VenueListing, layout?: VenueLayout): VenueLayout | undefined {
  if (layout) return layout;
  return (Object.keys(l.capacity) as VenueLayout[])[0];
}

function priceVenue(l: VenueListing, input: PriceInput, s: number, e: number): PriceResult {
  const minutes = Math.round((e - s) / MIN_MS);
  if (minutes < l.minHours * 60) return fail(`Minimum booking is ${plural(l.minHours, 'hour')}`);
  const layout = venueLayoutOf(l, input.details.layout);
  const cap = layout ? l.capacity[layout] : undefined;
  if (!layout || cap == null) return fail('This layout is not offered here');
  if (input.guests > cap) return fail(`Capacity for ${layout} is ${cap} guests`);
  const lines: LineItem[] = [];
  if (l.minSpendFils != null) {
    lines.push({ key: 'min_spend', label: 'Food & beverage minimum spend', fils: l.minSpendFils, kind: 'base' });
  } else {
    const hourly = l.hourlyFils != null ? Math.round((l.hourlyFils * minutes) / 60) : null;
    if (l.dayRateFils != null && (hourly == null || hourly >= l.dayRateFils)) {
      lines.push({ key: 'hire', label: 'Venue hire — day rate', fils: l.dayRateFils, kind: 'base' });
    } else if (hourly != null && l.hourlyFils != null) {
      lines.push({ key: 'hire', label: `${formatAED(l.hourlyFils)} × ${hoursText(minutes)} hours`, fils: hourly, kind: 'base' });
    } else {
      return fail('This venue has no price set');
    }
  }
  let packages = 0;
  for (const id of input.details.packageIds ?? []) {
    const p = l.packages?.find((x) => x.id === id);
    if (!p) return fail('Unknown package');
    const fils = p.perGuestFils * input.guests;
    packages += fils;
    lines.push({ key: `pkg_${p.id}`, label: `${p.label} (${formatAED(p.perGuestFils)} × ${plural(input.guests, 'guest')})`, fils, kind: 'addon' });
  }
  const base = lines[0].fils + packages;
  const service = l.serviceChargePct ? pctOf(base, l.serviceChargePct) : 0;
  if (service) lines.push({ key: 'service', label: `Service charge ${l.serviceChargePct}%`, fils: service, kind: 'fee' });
  if (l.vatPct) lines.push({ key: 'vat', label: `VAT ${l.vatPct}%`, fils: pctOf(base + service, l.vatPct), kind: 'tax' });
  return done(lines);
}

/** Peak = start at/after 16:00 Dubai, or any time Fri/Sat. */
export function isCourtPeak(startMs: number): boolean {
  return isDubaiWeekend(startMs) || dubaiParts(startMs).hour >= RULES.courtPeakFromHour;
}

export const sportsOf = (l: CourtListing): string[] => (l.sports?.length ? l.sports : [l.sport]);

function priceCourt(l: CourtListing, input: PriceInput, s: number, e: number): PriceResult {
  const court = l.courts.find((c) => c.id === input.details.courtId);
  if (!court) return fail('Choose a court');
  if (input.details.sport && !sportsOf(l).includes(input.details.sport)) return fail(`${input.details.sport} is not played here`);
  const minutes = Math.round((e - s) / MIN_MS);
  if (!l.durations.includes(minutes)) return fail(`Choose ${l.durations.join(' / ')} minutes`);
  if (input.details.durationMin != null && input.details.durationMin !== minutes) return fail('Duration does not match the slot');
  if (Math.round((s - dubaiDayStart(s)) / MIN_MS) % l.slotMinutes !== 0) return fail(`Start on a ${l.slotMinutes}-minute slot`);
  const open24 = l.openHour === 0 && l.closeHour >= 24;
  if (!open24) {
    const opens = dubaiAt(s, l.openHour);
    const closes = dubaiAt(s, 0) + l.closeHour * HOUR_MS;
    if (s < opens || e > closes) return fail(`Open ${String(l.openHour).padStart(2, '0')}:00–${String(l.closeHour).padStart(2, '0')}:00`);
  }
  const players = input.details.players ?? input.guests;
  if (players > l.maxPlayers) return fail(`Up to ${l.maxPlayers} players`);
  const peak = isCourtPeak(s);
  const per60 = peak ? l.peakPer60Fils : l.offPeakPer60Fils;
  const fils = Math.round((per60 * minutes) / 60);
  return done([{
    key: 'court',
    label: `${court.name} · ${minutes} min · ${peak ? 'Peak' : 'Off-peak'} (incl. VAT ${formatAED(vatIncludedFils(fils))})`,
    fils,
    kind: 'base',
  }]);
}

function priceCharter(l: CharterListing, input: PriceInput, s: number, e: number): PriceResult {
  const minutes = Math.round((e - s) / MIN_MS);
  if (minutes < l.minHours * 60) return fail(`Minimum charter is ${plural(l.minHours, 'hour')}`);
  if (input.guests > l.capacity) return fail(`Licensed for up to ${l.capacity} guests`);
  const lines: LineItem[] = [{ key: 'charter', label: `${formatAED(l.hourlyFils)} × ${hoursText(minutes)} hours`, fils: Math.round((l.hourlyFils * minutes) / 60), kind: 'base' }];
  for (const id of input.details.addOnIds ?? []) {
    const a = l.addOns.find((x) => x.id === id);
    if (!a) return fail('Unknown add-on');
    lines.push({ key: `addon_${a.id}`, label: a.label, fils: a.fils, kind: 'addon' });
  }
  const vatPct = l.vatPct ?? RULES.charterVatPct;
  if (vatPct) lines.push({ key: 'vat', label: `VAT ${vatPct}%`, fils: pctOf(sumLines(lines), vatPct), kind: 'tax' });
  if (l.securityHoldFils) {
    lines.push({
      key: 'security_hold',
      label: l.paymentMode === 'direct' ? 'Security deposit (collected by the operator, refundable)' : 'Security deposit (card hold, released after the trip)',
      fils: l.securityHoldFils, kind: 'deposit_hold',
    });
  }
  return done(lines);
}

// ---------------------------------------------------------------------------- availability

export const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && bStart < aEnd;

/** Does this booking occupy its slot at `now`? Lapsed deadlines release it even before the sweep runs. */
export function holdsSlot(b: Booking, now?: number): boolean {
  if (!hasDates(b)) return false;
  const counter = b.state === 'offer_sent' && !!b.offerHolds;
  if (!HOLDING_STATES.includes(b.state) && !counter) return false;
  if (now == null) return true;
  if (counter && b.offerExpiresAt && ms(b.offerExpiresAt) < now) return false;
  if (b.state === 'requested' && b.respondBy && ms(b.respondBy) < now) return false;
  if (b.state === 'held' && b.holdExpiresAt && ms(b.holdExpiresAt) < now) return false;
  if (b.state === 'provisional' && b.releaseAt && ms(b.releaseAt) < now) return false;
  if (b.state === 'awaiting_payment' && b.payBy && ms(b.payBy) < now && !(b.model === 'court' && b.details.splitPayment)) return false;
  return true;
}

export interface OverlapQuery {
  listingId: string;
  start: string;
  end: string;
  courtId?: string;
  excludeBookingId?: string;
  now?: number;
}
export interface Conflicts { bookings: Booking[]; blocks: AvailabilityBlock[] }

export function findConflicts(q: OverlapQuery, bookings: Booking[], blocks: AvailabilityBlock[]): Conflicts {
  const s = ms(q.start);
  const e = ms(q.end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { bookings: [], blocks: [] };
  const sameCourt = (c?: string) => q.courtId == null || c == null || c === q.courtId;
  return {
    bookings: bookings.filter((b) => b.listingId === q.listingId && b.id !== q.excludeBookingId && holdsSlot(b, q.now)
      && sameCourt(b.details.courtId) && rangesOverlap(s, e, ms(b.start), ms(b.end))),
    blocks: blocks.filter((k) => k.listingId === q.listingId && sameCourt(k.courtId) && rangesOverlap(s, e, ms(k.start), ms(k.end))),
  };
}
/** True when the range clashes with an active booking (requested/held/awaiting payment/provisional/confirmed/checked in/in progress, or a counter-offer) or a block. Courts compare per courtId (a block without courtId closes every court). */
export function overlaps(q: OverlapQuery, bookings: Booking[], blocks: AvailabilityBlock[]): boolean {
  const c = findConflicts(q, bookings, blocks);
  return c.bookings.length > 0 || c.blocks.length > 0;
}

// ---------------------------------------------------------------------------- transitions

export interface TransitionError { error: string }
export type TransitionResult = Booking | TransitionError;
export const isTransitionError = (r: unknown): r is TransitionError => typeof r === 'object' && r !== null && 'error' in r && !('id' in r);
export interface EngineContext { bookings: Booking[]; blocks: AvailabilityBlock[] }

const err = (error: string): TransitionError => ({ error });

function withEvent(b: Booking, now: number, actor: BookingEvent['actor'], type: string, text: string, patch: Partial<Booking> = {}, ref?: string): Booking {
  const ev: BookingEvent = ref ? { at: iso(now), actor, type, text, ref } : { at: iso(now), actor, type, text };
  return { ...b, ...patch, updatedAt: iso(now), events: [...b.events, ev] };
}
/** Enter a state: the event type equals the state name so stateEnteredAt() can find it. A pending date change does not survive leaving the change states. */
function enter(b: Booking, state: BookingState, now: number, actor: BookingEvent['actor'], text: string, patch: Partial<Booking> = {}): Booking {
  const drop: Partial<Booking> = CHANGE_STATES.includes(state) ? {} : { pendingChange: undefined };
  return withEvent(b, now, actor, state, text, { ...clearDeadlines(), ...drop, ...patch, state });
}
function clearDeadlines(): Partial<Booking> {
  return { respondBy: undefined, offerExpiresAt: undefined, holdExpiresAt: undefined, payBy: undefined, releaseAt: undefined, offerHolds: undefined };
}
/** A deadline never runs past the booking start. */
const capAtStart = (b: Pick<Booking, 'start' | 'end'>, t: number): number => (hasDates(b) ? Math.min(t, ms(b.start)) : t);
/** When the booking entered its current state (last event of that type), else updatedAt. */
export function stateEnteredAt(b: Booking): number {
  for (let i = b.events.length - 1; i >= 0; i--) if (b.events[i].type === b.state) return ms(b.events[i].at);
  return ms(b.updatedAt);
}
const lastActivityAt = (b: Booking): number => (b.events.length ? ms(b.events[b.events.length - 1].at) : ms(b.updatedAt));
/** An enquiry closes itself when the requested start passes, or after 7 days with no activity. */
export function enquiryCloseAt(b: Booking): number {
  return Math.min(hasDates(b) ? ms(b.start) : Infinity, lastActivityAt(b) + RULES.enquiryStaleDays * DAY_MS);
}

export function paymentId(b: Pick<Booking, 'id'>, suffix: string): string {
  return `${b.id}-${suffix}`;
}

/**
 * Payment schedule per model:
 *   stays — full amount, due at payBy;
 *   venues — holding deposit % (due `dueAt`), balance 14 days before the event;
 *   charters — deposit % (due `dueAt`), balance 48h before departure;
 *   (venues/charters booked inside the balance window pay in full at once);
 *   courts — full, or one share per player (owner = player 1 gets the rounding remainder).
 */
export function buildPayments(b: Booking, listing: PreviewListing, dueAt: number): PaymentRecord[] {
  if (isDirect(b)) return buildDirectPayments(b, listing, dueAt);
  const total = b.totalFils;
  const start = ms(b.start);
  switch (listing.model) {
    case 'shortstay':
      return [{ id: paymentId(b, 'full'), label: 'Full payment', dueAt: iso(dueAt), fils: total, status: 'due' }];
    case 'venue':
    case 'charter': {
      const pct = listing.model === 'venue' ? listing.holdingDepositPct : listing.depositPct;
      const dep = pctOf(total, pct);
      const balDue = listing.model === 'venue' ? start - RULES.venueBalanceDaysBefore * DAY_MS : start - RULES.charterBalanceHoursBefore * HOUR_MS;
      // Booked inside the balance window → one full payment instead of deposit + balance.
      if (balDue <= dueAt) return [{ id: paymentId(b, 'full'), label: 'Full payment', dueAt: iso(dueAt), fils: total, status: 'due' }];
      const out: PaymentRecord[] = [{ id: paymentId(b, 'dep'), label: `${listing.model === 'venue' ? 'Holding deposit' : 'Deposit'} ${pct}%`, dueAt: iso(dueAt), fils: dep, status: 'due' }];
      if (total - dep > 0) out.push({ id: paymentId(b, 'bal'), label: 'Balance', dueAt: iso(Math.max(balDue, dueAt)), fils: total - dep, status: 'due' });
      return out;
    }
    case 'court': {
      const players = Math.max(1, Math.min(listing.maxPlayers, b.details.players ?? b.guests));
      if (!b.details.splitPayment || players < 2) return [{ id: paymentId(b, 'full'), label: 'Court fee', dueAt: iso(dueAt), fils: total, status: 'due' }];
      const share = Math.floor(total / players);
      const settle = ms(b.end) + RULES.courtSplitSettleHoursAfterEnd * HOUR_MS;
      return Array.from({ length: players }, (_, i) => ({
        id: paymentId(b, `share-${i + 1}`),
        label: i === 0 ? 'Share — Player 1 (booking owner)' : `Share — Player ${i + 1}`,
        dueAt: iso(i === 0 ? dueAt : settle),
        fils: i === 0 ? total - share * (players - 1) : share,
        status: 'due' as const,
      }));
    }
  }
}

/**
 * Direct mode: reminders of what the customer pays the provider outside UpNow (status 'due',
 * method 'pay_direct' / 'pay_at_venue'). `now` = when the provider confirmed.
 *   stays — 'Pay host directly', due at check-in;
 *   courts — 'Pay at venue', due at the slot;
 *   venues — 'Deposit to venue N%' due in 3 days, balance 14 days before the event;
 *   charters — 'Deposit to operator N%' due in 24h, balance 48h before departure;
 *   (inside the balance window: one full payment). The venue / charter deposit (or full
 *   payment) is the provisional hold's release date.
 */
export function buildDirectPayments(b: Booking, listing: PreviewListing, now: number): PaymentRecord[] {
  const start = ms(b.start);
  const total = b.totalFils;
  const rec = (suffix: string, label: string, due: number, fils: number, method: PaymentRecord['method'] = 'pay_direct'): PaymentRecord => ({
    id: paymentId(b, suffix), label, dueAt: iso(Math.min(due, start)), fils, status: 'due', method,
  });
  switch (listing.model) {
    case 'shortstay': return [rec('full', 'Pay host directly', start, total)];
    case 'court': return [rec('full', 'Pay at venue', start, total, 'pay_at_venue')];
    case 'venue':
    case 'charter': {
      const venue = listing.model === 'venue';
      const who = venue ? 'venue' : 'operator';
      const pct = listing.model === 'venue' ? listing.holdingDepositPct : listing.depositPct;
      const depDue = now + (venue ? RULES.venueDepositDueDays * DAY_MS : RULES.payWithinHours.charter * HOUR_MS);
      const balDue = venue ? start - RULES.venueBalanceDaysBefore * DAY_MS : start - RULES.charterBalanceHoursBefore * HOUR_MS;
      if (balDue <= depDue) return [rec('full', `Pay ${who} directly`, depDue, total)];
      const dep = pctOf(total, pct);
      const out = [rec('dep', `Deposit to ${who} ${pct}%`, depDue, dep)];
      if (total - dep > 0) out.push(rec('bal', `Balance to ${who}`, balDue, total - dep));
      return out;
    }
  }
}

/** The payments that must be paid (or waived) before the booking is confirmed. */
function gatingPayments(b: Booking): PaymentRecord[] {
  if (b.model === 'court') return b.payments.filter((p) => p.id.endsWith('-full') || p.id.endsWith('-share-1'));
  const dep = b.payments.find((p) => p.id.endsWith('-dep'));
  if (dep) return [dep];
  return b.payments.filter((p) => p.id.endsWith('-full'));
}
const allPaid = (ps: PaymentRecord[]) => ps.length > 0 && ps.every((p) => p.status === 'paid' || p.status === 'waived');

const START_TASKS = ['checkin_instructions', 'det_registration', 'manifest', 'final_numbers', 'det_permit'];
/** Tasks added on confirmation. A due date already passed (late booking) moves to min(start, now + 24h). */
function tasksOnConfirm(b: Booking, listing: PreviewListing, now: number): Booking['tasks'] {
  const s = ms(b.start);
  const have = new Set(b.tasks.map((t) => t.key));
  const add: Booking['tasks'] = [];
  const push = (key: string, label: string, dueAt: number) => {
    if (!have.has(key)) add.push({ key, label, done: false, dueAt: iso(dueAt < now ? Math.max(dueAt, Math.min(s, now + DAY_MS)) : dueAt) });
  };
  if (listing.model === 'shortstay') {
    push('checkin_instructions', 'Send check-in instructions', s - RULES.stayCheckInInstructionsHoursBefore * HOUR_MS);
    push('det_registration', 'Register guests with DET (ID per guest)', dubaiDayStart(s) + DAY_MS - MIN_MS);
  } else if (listing.model === 'charter') {
    push('manifest', 'Collect guest manifest (ID per guest)', dubaiAt(s, 18, 0, -1));
  } else if (listing.model === 'venue') {
    push('final_numbers', 'Final guest numbers', s - RULES.venueFinalNumbersDaysBefore * DAY_MS);
    if (listing.permitNote) push('det_permit', 'DET event permit', s - RULES.venuePermitDaysBefore * DAY_MS);
  }
  return [...b.tasks, ...add];
}

/** Expected payout date: stays 24h after check-in; venues/charters 3 days after the end; courts the next Thursday. */
export function payoutAtFor(b: Pick<Booking, 'model' | 'start' | 'end'>): string {
  if (b.model === 'shortstay') return iso(ms(b.start) + RULES.stayPayoutHoursAfterCheckIn * HOUR_MS);
  if (b.model === 'court') return iso(nextThursday(ms(b.end)));
  return iso(ms(b.end) + RULES.payoutDaysAfterEnd * DAY_MS);
}

function confirm(b: Booking, listing: PreviewListing, now: number, actor: BookingEvent['actor'], text: string): Booking {
  return enter(b, 'confirmed', now, actor, text, { tasks: tasksOnConfirm(b, listing, now), payoutAt: isDirect(b) ? undefined : payoutAtFor(b) });
}

const WHO: Record<BookingModel, string> = { shortstay: 'the host', venue: 'the venue', court: 'the club', charter: 'the operator' };
const DIRECT_CONFIRM_TEXT: Record<BookingModel, string> = {
  shortstay: 'Host confirmed — pay the host directly',
  venue: 'Venue confirmed — pay the venue directly',
  court: 'Slot confirmed — pay at the venue',
  charter: 'Operator confirmed — pay the operator directly',
};
/**
 * Direct mode: attach the pay-the-provider reminders, then — venues / yachts with a deposit (or
 * full payment) still due → PROVISIONAL until the provider records it (release date = its due
 * date); stays / courts → confirmed.
 */
function confirmDirect(b: Booking, listing: PreviewListing, now: number, actor: BookingEvent['actor'], lead?: string): Booking {
  const nb: Booking = { ...b, payments: buildDirectPayments(b, listing, now) };
  if (b.model === 'venue' || b.model === 'charter') {
    const gate = gatingPayments(nb).find((p) => p.status === 'due');
    if (gate?.dueAt) {
      const release = ms(gate.dueAt);
      const text = `${lead ? `${lead} — ` : ''}provisional: ${listing.providerName} holds the date until ${formatDubai(release)} (Dubai). Pay the ${gate.label.toLowerCase()} (${formatAED(gate.fils)}) to ${WHO[b.model]} directly to confirm`;
      return enter(nb, 'provisional', now, actor, text, { releaseAt: iso(release), tasks: tasksOnConfirm(nb, listing, now) });
    }
  }
  const text = lead ? `${lead} — confirmed; ${b.model === 'court' ? 'pay at the venue' : `pay ${WHO[b.model]} directly`}` : DIRECT_CONFIRM_TEXT[b.model];
  return confirm(nb, listing, now, actor, text);
}

function markCompleted(b: Booking, now: number, actor: BookingEvent['actor'], text: string): Booking {
  const end = ms(b.end);
  const direct = isDirect(b);
  return enter(b, 'completed', now, actor, text, {
    payoutAt: direct ? undefined : b.payoutAt ?? payoutAtFor(b),
    reviewBy: iso(end + RULES.reviewWindowDays * DAY_MS),
    depositClaimBy: !direct && b.model === 'shortstay' && depositHoldFils(b) > 0 ? iso(end + RULES.depositClaimDays * DAY_MS) : undefined,
  });
}

/** Deposit hold status, from events: 'none' (no hold) | 'held' | 'released' | 'claimed'. */
export function depositStatus(b: Booking): 'none' | 'held' | 'released' | 'claimed' {
  if (depositHoldFils(b) <= 0 || isDirect(b)) return 'none'; // direct: the host collects any deposit, UpNow holds nothing
  if (b.events.some((e) => e.type === 'deposit_claimed')) return 'claimed';
  if (b.events.some((e) => e.type === 'deposit_released')) return 'released';
  return 'held';
}

export const isSplitCourt = (b: Booking) => b.model === 'court' && !!b.details.splitPayment && b.payments.some((p) => p.id.includes('-share-'));
const fulfilmentState = (model: BookingModel): BookingState => (model === 'shortstay' || model === 'court' ? 'checked_in' : 'in_progress');

/** Earliest moment check-in / start is allowed: courts 60 min before; others from 00:00 Dubai on the start day. */
export function checkInOpensAt(b: Booking): number {
  return b.model === 'court' ? ms(b.start) - HOUR_MS : dubaiDayStart(ms(b.start));
}

// ---------------------------------------------------------------------------- dates helpers

interface Merged { start: string; end: string; guests: number; details: Booking['details'] }
/** The booking's dates / guests / details with a patch applied (court duration and players follow the slot). */
export function mergeDates(b: Pick<Booking, 'model' | 'start' | 'end' | 'guests' | 'details'>, p: DatesPatch): Merged {
  const start = p.start ?? b.start;
  const end = p.end ?? b.end;
  const guests = p.guests ?? b.guests;
  let details: Booking['details'] = { ...b.details, ...(p.details ?? {}) };
  if (b.model === 'court' && Number.isFinite(ms(start)) && Number.isFinite(ms(end))) {
    details = { ...details, durationMin: Math.round((ms(end) - ms(start)) / MIN_MS), players: p.details?.players ?? p.guests ?? details.players ?? guests };
  }
  return { start, end, guests, details };
}
const datesChanged = (b: Booking, m: Merged) => m.start !== b.start || m.end !== b.end || (m.details.courtId ?? '') !== (b.details.courtId ?? '');
function clashes(b: Booking, m: Merged, ctx: EngineContext | undefined, now: number): boolean {
  return !!ctx && overlaps({ listingId: b.listingId, start: m.start, end: m.end, courtId: m.details.courtId, excludeBookingId: b.id, now }, ctx.bookings, ctx.blocks);
}
/** 'Sun 25 Oct → Wed 28 Oct' (stays) / 'Sun 25 Oct, 18:00–20:00' (others), Dubai. */
export function datesText(model: BookingModel, start: string, end: string): string {
  if (!Number.isFinite(ms(start)) || !Number.isFinite(ms(end))) return 'dates to be agreed';
  const s = formatDubai(ms(start));
  const e = formatDubai(ms(end));
  if (model === 'shortstay') return `${s.split(',')[0]} → ${e.split(',')[0]}`;
  return `${s}–${e.split(', ')[1]}`;
}
/** Re-price at list price and carry the booking's special-offer discount lines over. */
function repriceKeepingDiscounts(b: Booking, listing: PreviewListing, m: Merged): PriceResult {
  const p = priceFor(listing, m);
  if (p.error) return p;
  const discounts = b.lineItems.filter((l) => l.kind === 'discount').map((l) => ({ ...l }));
  const lines = [...p.lineItems.filter((l) => l.kind !== 'deposit_hold'), ...discounts, ...p.lineItems.filter((l) => l.kind === 'deposit_hold')];
  const total = sumLines(lines);
  if (total <= 0) return fail('The new price must be above zero');
  return { lineItems: lines, totalFils: total };
}
function checkLines(lines: LineItem[]): string | null {
  if (!lines.length) return 'Add at least one line';
  if (lines.some((l) => !Number.isInteger(l.fils))) return 'Amounts must be whole fils';
  if (sumLines(lines) <= 0) return 'Offer total must be above zero';
  return null;
}

// ---------------------------------------------------------------------------- guards (shared by apply* and nextActions)

/** Can the provider send / revise an offer now? (Dates are collected in the form when missing.) */
export function offerGuard(b: Booking, now: number): string | null {
  if (!['enquiry', 'offer_sent', 'requested'].includes(b.state)) return 'Offers can only be sent on an enquiry, an open offer or a pending request';
  if (b.state === 'requested' && b.respondBy && now > ms(b.respondBy)) return 'This request has expired';
  return null;
}
/** Can the provider confirm this lead themselves (phone / WhatsApp / email agreement)? */
export function confirmGuard(b: Booking): string | null {
  if (b.state !== 'enquiry' && b.state !== 'offer_sent') return 'Only enquiries and open offers can be confirmed this way — use Accept on a request';
  return null;
}
/** Can `by` change the dates / slot now? (The new dates are checked when they are submitted.) */
export function changeGuard(b: Booking, by: 'customer' | 'provider', listing: PreviewListing, now: number): string | null {
  if (!CHANGE_STATES.includes(b.state)) return 'Dates can be changed once the booking is accepted';
  if (!hasDates(b)) return 'This booking has no dates yet';
  if (now >= ms(b.start)) return 'The booking has already started';
  if (isSplitCourt(b)) return 'Split-payment court bookings cannot be moved — cancel and book again';
  if (by === 'customer') {
    const cut = freeChangeCutoff(b, listing);
    if (cut == null) return `${POLICY_LABEL[b.cancellation]} rate — date changes are up to ${listing.providerName}; send them a message`;
    if (now > cut) return `Free date changes ended ${formatDubai(cut)} (Dubai) — send ${listing.providerName} a message`;
  }
  return null;
}

// ---------------------------------------------------------------------------- create

export function createBooking(input: NewBookingInput, listing: PreviewListing, now: number, id: string, ctx?: EngineContext): TransitionResult {
  if (listing.id !== input.listingId) return err('Listing mismatch');
  const openDates = input.kind === 'enquiry' && !input.start && !input.end;
  if (!openDates && !(ms(input.start) > now)) return err(Number.isFinite(ms(input.start)) ? 'Start time has already passed' : 'Choose valid dates');
  if (openDates && (!Number.isInteger(input.guests) || input.guests < 1)) return err('At least 1 guest');
  const price: PriceResult = openDates ? { lineItems: [], totalFils: 0 } : priceFor(listing, input);
  if (price.error) return err(price.error);
  const model = listing.model;
  const mode: PaymentMode = listing.paymentMode ?? 'platform';
  if (mode === 'direct' && input.kind === 'instant') return err(`${listing.providerName} confirms every booking themselves — send a request instead (nothing is charged on UpNow)`);
  if (model === 'court' && mode === 'platform' && input.kind === 'request') return err('Courts are booked instantly');
  if (input.kind === 'instant' && model !== 'court' && !listing.instantBook) return err('Instant booking is not available for this listing');
  if (input.kind === 'instant' && model === 'venue' && ms(input.start) - now < RULES.instantVenueMinLeadHours * HOUR_MS) {
    return err('Instant booking needs at least 24 hours before the event — send a request instead');
  }
  if (!input.customer?.name?.trim()) return err('Customer name is required');
  if (input.kind !== 'enquiry' && ctx && overlaps({ listingId: listing.id, start: input.start, end: input.end, courtId: input.details.courtId, now }, ctx.bookings, ctx.blocks)) {
    return err(model === 'court' ? 'That court is no longer free at this time' : 'Those dates are no longer available');
  }
  const t = iso(now);
  const msg = input.details.message?.trim();
  const details: Booking['details'] = model === 'court' && !openDates
    ? { ...input.details, durationMin: Math.round((ms(input.end) - ms(input.start)) / MIN_MS), players: input.details.players ?? input.guests, ...(mode === 'direct' ? { splitPayment: false } : {}) }
    : { ...input.details, ...(model === 'court' && mode === 'direct' ? { splitPayment: false } : {}) };
  let b: Booking = {
    id, model, listingId: listing.id, state: 'enquiry', paymentMode: mode, source: input.source ?? 'form', createdAt: t, updatedAt: t,
    customer: { ...input.customer }, start: openDates ? '' : input.start, end: openDates ? '' : input.end, guests: input.guests,
    details, ...(openDates ? { openDates: true } : {}),
    lineItems: price.lineItems, totalFils: price.totalFils, payments: [], cancellation: listing.cancellation,
    tasks: [], events: [],
  };
  if (msg) b = withEvent(b, now, 'customer', 'message', msg);
  if (input.kind === 'enquiry') {
    return enter(b, 'enquiry', now, 'customer', openDates ? 'Enquiry sent — no dates yet, nothing held' : 'Enquiry sent — no dates held', {
      respondBy: iso(now + RULES.enquiryFirstReplyMin * MIN_MS),
    });
  }
  if (input.kind === 'request') {
    const h = respondHoursFor(model, mode);
    const text = model === 'court'
      ? `Slot requested — held while the club confirms (${formatDuration(h * HOUR_MS)}); pay at the venue`
      : `Request to book — dates held while the provider responds (${formatDuration(h * HOUR_MS)})${mode === 'direct' ? '; nothing is charged on UpNow' : ''}`;
    return enter(b, 'requested', now, 'customer', text, { respondBy: iso(capAtStart(b, now + h * HOUR_MS)) });
  }
  // instant
  if (model === 'court') {
    const hold = capAtStart(b, now + RULES.courtCheckoutHoldMin * MIN_MS);
    b = enter(b, 'held', now, 'customer', `Court held for ${RULES.courtCheckoutHoldMin} minutes while you pay`, { holdExpiresAt: iso(hold) });
    return { ...b, payments: buildPayments(b, listing, hold) };
  }
  b = { ...b, payments: buildPayments(b, listing, now) };
  const gate = gatingPayments(b).map((p) => p.id);
  b = { ...b, payments: b.payments.map((p) => (gate.includes(p.id) ? { ...p, status: 'paid', paidAt: t, method: 'card' } : p)) };
  b = withEvent(b, now, 'customer', 'paid', `Paid ${formatAED(paidFils(b))} at checkout`);
  return confirm(b, listing, now, 'system', 'Instant booking confirmed');
}

export interface SeriesResult { bookings: Booking[]; skipped: string[]; error?: string }
/**
 * Courts — the same slot every week. Week 1 must be free (else nothing is created); each
 * later week is availability-checked on its own: taken (or otherwise unbookable) weeks are
 * skipped and listed on every occurrence; the free ones are created as instant holds
 * (platform) or requests (direct). Occurrences share details.seriesId (= first booking id).
 */
export function createSeries(input: NewBookingInput, listing: PreviewListing, now: number, ids: (i: number) => string, weeks: number, ctx?: EngineContext): SeriesResult {
  if (listing.model !== 'court') return { bookings: [], skipped: [], error: 'Weekly series are for courts only' };
  if (!Number.isInteger(weeks) || weeks < 2 || weeks > RULES.courtSeriesMaxWeeks) return { bookings: [], skipped: [], error: `Choose 2 to ${RULES.courtSeriesMaxWeeks} weeks` };
  const kind: NewBookingInput['kind'] = (listing.paymentMode ?? 'platform') === 'direct' ? 'request' : 'instant';
  const made: Booking[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = iso(ms(input.start) + i * 7 * DAY_MS);
    const end = iso(ms(input.end) + i * 7 * DAY_MS);
    const c = ctx ? { bookings: [...ctx.bookings, ...made], blocks: ctx.blocks } : { bookings: made, blocks: [] };
    const r = createBooking({ ...input, kind, start, end, details: { ...input.details, message: i === 0 ? input.details.message : undefined } }, listing, now, ids(made.length), c);
    if (isTransitionError(r)) {
      if (i === 0) return { bookings: [], skipped: [], error: r.error };
      skipped.push(start);
      continue;
    }
    made.push(r);
  }
  const seriesId = made[0].id;
  const skippedText = skipped.length ? `; skipped ${skipped.map((s) => formatDubai(ms(s)).split(',')[0]).join(', ')} (court taken)` : '';
  const out = made.map((b, i) => withEvent(
    { ...b, details: { ...b.details, seriesId, seriesIndex: i + 1, seriesCount: made.length, seriesSkipped: skipped } },
    now, 'system', 'series', `Weekly series — booking ${i + 1} of ${made.length} (${weeks} weeks asked${skippedText})`,
  ));
  return { bookings: out, skipped };
}

// ---------------------------------------------------------------------------- provider

export function applyProvider(b: Booking, action: ProviderAction, listing: PreviewListing, now: number, ctx?: EngineContext): TransitionResult {
  if (b.listingId !== listing.id) return err('Listing mismatch');
  const s = b.state;
  switch (action.type) {
    case 'reply': {
      if (!canMessage(b)) return err('Messaging is closed for this booking');
      if (!action.text.trim()) return err('Write a reply');
      return withEvent(b, now, 'provider', 'message', action.text.trim(), s === 'enquiry' ? { respondBy: undefined } : {});
    }
    case 'send_offer': {
      const g = offerGuard(b, now);
      if (g) return err(g);
      const m = mergeDates(b, action);
      if (!hasDates(m)) return err('Add the dates first');
      if (ms(m.start) <= now) return err('The start time has passed — pick new dates');
      const valid = priceFor(listing, m);
      if (valid.error) return err(valid.error);
      const bad = checkLines(action.lineItems);
      if (bad) return err(bad);
      const counter = s === 'requested' || (s === 'offer_sent' && !!b.offerHolds);
      if (counter && datesChanged(b, m) && clashes(b, m, ctx, now)) return err('Those dates are not free — pick other dates');
      const total = sumLines(action.lineItems);
      const hours = action.validHours > 0 ? action.validHours : RULES.offerValidHours[b.model];
      const expires = Math.min(now + hours * HOUR_MS, ms(m.start));
      const version = (b.quoteVersion ?? 0) + 1;
      const what = b.model === 'shortstay' ? 'Special offer' : b.model === 'court' ? 'Slot offer' : `Quote v${version}`;
      const text = counter
        ? `Counter-offer sent — ${formatAED(total)} for ${datesText(b.model, m.start, m.end)}; the dates stay held until ${formatDubai(expires)}`
        : `${what} sent — ${formatAED(total)} for ${datesText(b.model, m.start, m.end)}, valid ${formatDuration(expires - now)}`;
      let nb = enter(b, 'offer_sent', now, 'provider', text, {
        start: m.start, end: m.end, guests: m.guests, details: m.details, openDates: undefined,
        lineItems: action.lineItems.map((l) => ({ ...l })), totalFils: total, offerExpiresAt: iso(expires), quoteVersion: version,
        ...(counter ? { offerHolds: true } : {}),
      });
      if (action.note?.trim()) nb = withEvent(nb, now, 'provider', 'message', action.note.trim());
      return nb;
    }
    case 'confirm_booking': {
      const g = confirmGuard(b);
      if (g) return err(g);
      const m = mergeDates(b, action);
      if (!hasDates(m)) return err(b.model === 'court' ? 'Add the date, time and court first' : 'Add the dates first');
      if (ms(m.start) <= now) return err('The start time has passed — pick new dates');
      const price = priceFor(listing, m);
      if (price.error) return err(price.error);
      let lines = price.lineItems;
      if (action.lineItems?.length) {
        const bad = checkLines(action.lineItems);
        if (bad) return err(bad);
        lines = action.lineItems.map((l) => ({ ...l }));
      } else if (s === 'offer_sent' && !datesChanged(b, m) && m.guests === b.guests && b.lineItems.length) {
        lines = b.lineItems; // confirm the offer as sent
      }
      if (clashes(b, m, ctx, now)) return err(b.model === 'court' ? 'That court is not free at this time' : 'Those dates are not free — pick other dates');
      let nb: Booking = {
        ...b, start: m.start, end: m.end, guests: m.guests, openDates: undefined, offerHolds: undefined,
        details: b.model === 'court' ? { ...m.details, splitPayment: false } : m.details,
        lineItems: lines, totalFils: sumLines(lines),
      };
      if (action.note?.trim()) nb = withEvent(nb, now, 'provider', 'message', action.note.trim());
      if (isDirect(b)) return confirmDirect(nb, listing, now, 'provider', 'Confirmed by the provider');
      const due = capAtStart(nb, now + RULES.confirmPayWithinHours[b.model] * HOUR_MS);
      const after = enter(nb, 'awaiting_payment', now, 'provider', `Confirmed by the provider — pay on UpNow by ${formatDubai(due)} (Dubai) to secure it`, { payBy: iso(due) });
      return { ...after, payments: buildPayments(after, listing, due) };
    }
    case 'mark_lost': {
      if (s !== 'enquiry' && s !== 'offer_sent') return err('Only enquiries and open offers can be marked lost');
      if (!action.reason.trim()) return err('Give a reason');
      return enter(b, 'lost', now, 'provider', `Marked lost — ${action.reason.trim()}`);
    }
    case 'accept': {
      if (s === 'requested' && b.respondBy && now > ms(b.respondBy)) return err('This request has expired');
      if (isDirect(b)) {
        if (s !== 'requested') return err('Only pending requests can be accepted');
        return confirmDirect(b, listing, now, 'provider', 'Request accepted');
      }
      if (s === 'requested') {
        if (b.model === 'venue') {
          const due = capAtStart(b, now + RULES.venueDepositDueDays * DAY_MS);
          const nb = enter(b, 'awaiting_payment', now, 'provider', 'Request accepted — holding deposit due in 3 days', { payBy: iso(due) });
          return { ...nb, payments: buildPayments(nb, listing, due) };
        }
        const due = capAtStart(b, now + (b.model === 'charter' ? RULES.payWithinHours.charter : RULES.payWithinHours.shortstay) * HOUR_MS);
        const nb = enter(b, 'awaiting_payment', now, 'provider', `Request accepted — customer to pay within 24h`, { payBy: iso(due) });
        return { ...nb, payments: buildPayments(nb, listing, due) };
      }
      if (s === 'held' && b.model === 'venue') {
        const due = capAtStart(b, now + RULES.venueDepositDueDays * DAY_MS);
        const nb = enter(b, 'awaiting_payment', now, 'provider', 'Option confirmed — contract issued, holding deposit due in 3 days', { payBy: iso(due) });
        return { ...nb, payments: nb.payments.map((p) => (gatingPayments(nb).some((g) => g.id === p.id) && p.status === 'due' ? { ...p, dueAt: iso(due) } : p)) };
      }
      return err('Only pending requests can be accepted');
    }
    case 'decline': {
      if (!['enquiry', 'offer_sent', 'requested', 'held'].includes(s)) return err('Only enquiries, offers, requests and holds can be declined');
      if (s === 'held' && b.model === 'court') return err('Court checkout holds release on their own');
      const reason = action.reason.trim() || 'No reason given';
      return enter(b, 'declined', now, 'provider', `Declined — ${reason}`, { payments: b.payments.map((p) => (p.status === 'due' ? { ...p, status: 'waived' } : p)) });
    }
    case 'check_in':
    case 'start': {
      const okFrom = s === 'confirmed' || (s === 'awaiting_payment' && isSplitCourt(b));
      if (!okFrom) return err(s === 'provisional' ? 'Record (or waive) the deposit first — the booking is still provisional' : 'Only confirmed bookings can be checked in');
      if (now < checkInOpensAt(b)) return err(b.model === 'court' ? 'Check-in opens 60 minutes before the slot' : 'Check-in opens on the start day');
      const target = fulfilmentState(b.model);
      const text = { shortstay: 'Guest checked in', court: 'Players checked in', venue: 'Event started', charter: 'Departed — charter under way' }[b.model];
      return enter(b, target, now, 'provider', text);
    }
    case 'complete': {
      if (s !== 'checked_in' && s !== 'in_progress') return err('Only bookings in progress can be completed');
      const text = { shortstay: 'Guest checked out', court: 'Match played', venue: 'Event completed', charter: 'Returned to berth' }[b.model];
      return markCompleted(b, now, 'provider', text);
    }
    case 'mark_no_show': {
      const okFrom = s === 'confirmed' || (s === 'awaiting_payment' && isSplitCourt(b));
      if (!okFrom) return err('Only confirmed bookings can be marked no-show');
      const from = b.model === 'court' ? ms(b.start) + RULES.courtNoShowGraceMin * MIN_MS : ms(b.start);
      if (now < from) return err(b.model === 'court' ? 'No-show can be marked 15 minutes after the start' : 'No-show can be marked once the start time has passed');
      const claimBy = !isDirect(b) && b.model === 'shortstay' && depositHoldFils(b) > 0 ? iso(ms(b.start) + RULES.depositClaimDays * DAY_MS) : undefined;
      return enter(b, 'no_show', now, 'provider', isDirect(b) ? 'Marked as no-show' : 'Marked as no-show — booking charged in full', claimBy ? { depositClaimBy: claimBy } : {});
    }
    case 'cancel': {
      if (!['held', 'awaiting_payment', 'provisional', 'confirmed', 'checked_in', 'in_progress'].includes(s)) return err('This booking cannot be cancelled');
      const reason = action.reason.trim() || 'No reason given';
      const pc = providerCancellationFor(b, listing, now, reason);
      if (isDirect(b)) {
        const nd = enter(b, 'cancelled_by_provider', now, 'provider', `Cancelled by provider — ${reason}`, {
          payments: b.payments.map((p) => (p.status === 'due' ? { ...p, status: 'waived' as const } : p)),
        });
        return withEvent(nd, now, 'system', 'refund', pc.rule);
      }
      let nb = enter(b, 'cancelled_by_provider', now, 'provider', `Cancelled by provider — ${reason}`, {
        payments: [
          ...b.payments.map((p) => (p.status === 'due' ? { ...p, status: 'waived' as const } : p)),
          ...(pc.refundFils > 0 ? [{ id: paymentId(b, `refund-${b.events.length}`), label: 'Refund — cancelled by provider', dueAt: null, fils: pc.refundFils, status: 'refunded' as const, paidAt: iso(now), method: 'card' as const }] : []),
        ],
      });
      nb = withEvent(nb, now, 'system', 'refund', `Full refund to customer: ${formatAED(pc.refundFils)}`);
      nb = withEvent(nb, now, 'system', 'provider_penalty', pc.rule);
      return nb;
    }
    case 'record_payment':
      return applyPayment(b, action.paymentId, action.method ?? 'pay_at_venue', listing, now, 'provider');
    case 'waive_payment': {
      const p = b.payments.find((x) => x.id === action.paymentId);
      if (!p) return err('Payment not found');
      if (p.status !== 'due') return err('This payment is not due');
      if (!SETTLE_STATES.includes(s)) return err('This booking has ended');
      if (!action.reason.trim()) return err('Give a reason for waiving it');
      const nb = withEvent(b, now, 'provider', 'payment_waived', `${p.label} (${formatAED(p.fils)}) waived / written off — ${action.reason.trim()}`, {
        payments: b.payments.map((x) => (x.id === p.id ? { ...x, status: 'waived' as const } : x)),
      }, p.id);
      return afterSettle(nb, s, listing, now, 'provider', b.model === 'venue' || b.model === 'charter' ? 'Deposit waived — booking confirmed' : 'Payment waived — booking confirmed');
    }
    case 'send_reminder': {
      const p = b.payments.find((x) => x.id === action.paymentId);
      if (!p) return err('Payment not found');
      if (p.status !== 'due') return err('This payment is not due');
      if (!SETTLE_STATES.includes(s)) return err('This booking has ended');
      const last = [...b.events].reverse().find((e) => e.type === 'reminder' && e.ref === p.id);
      if (last && now - ms(last.at) < RULES.reminderCooldownMin * MIN_MS) return err(`A reminder for this payment was sent ${formatDuration(now - ms(last.at))} ago — try again later`);
      const when = p.dueAt ? `${ms(p.dueAt) < now ? 'was due' : 'due'} ${formatDubai(ms(p.dueAt))}` : 'due now';
      const how = isDirect(b) ? (p.method === 'pay_at_venue' ? 'pay at the venue' : `pay ${listing.providerName} directly`) : 'pay on UpNow';
      return withEvent(b, now, 'provider', 'reminder', `Reminder sent to ${b.customer.name}: ${p.label} ${formatAED(p.fils)} ${when} — ${how}`, {}, p.id);
    }
    case 'extend_hold': {
      if (s !== 'provisional') return err('Only provisional holds can be extended');
      const t = ms(action.until);
      if (!Number.isFinite(t)) return err('Choose the new release date');
      if (t <= now) return err('Pick a time in the future');
      if (b.releaseAt && t <= ms(b.releaseAt)) return err('Pick a date after the current release date');
      if (t > ms(b.start)) return err('The hold cannot run past the start');
      const gate = gatingPayments(b).map((g) => g.id);
      return withEvent(b, now, 'provider', 'hold_extended', `Hold extended — the date is held until ${formatDubai(t)} (Dubai); the deposit is now due then`, {
        releaseAt: iso(t), payments: b.payments.map((p) => (gate.includes(p.id) && p.status === 'due' ? { ...p, dueAt: iso(t) } : p)),
      });
    }
    case 'release_hold': {
      if (s !== 'provisional') return err('Only provisional holds can be released');
      if (!action.reason.trim()) return err('Give a reason');
      return enter(b, 'lost', now, 'provider', `Hold released — ${action.reason.trim()}; the date is free again`, {
        payments: b.payments.map((p) => (p.status === 'due' ? { ...p, status: 'waived' as const } : p)),
      });
    }
    case 'change_dates':
      return proposeOrApply(b, 'provider', action.mode, action, action.note, listing, now, ctx);
    case 'accept_change':
      return acceptChange(b, 'provider', listing, now, ctx);
    case 'decline_change':
      return declineChange(b, 'provider', now);
    case 'schedule_visit': {
      if (b.model !== 'venue') return err('Site visits are arranged for venues only');
      if (!['enquiry', 'offer_sent', 'requested', 'held', 'awaiting_payment', 'provisional', 'confirmed'].includes(s)) return err('Site visits are arranged before the event');
      if (!hasDates(b)) return err('Agree the event date first');
      const t = ms(action.at);
      if (!Number.isFinite(t)) return err('Choose a date and time for the visit');
      if (t <= now) return err('Pick a time in the future');
      if (t >= ms(b.start)) return err('The site visit must be before the event');
      const again = !!b.siteVisitAt;
      return withEvent(b, now, 'provider', 'site_visit', `Site visit ${again ? 'rescheduled' : 'scheduled'} for ${formatDubai(t)} (Dubai)`, {
        siteVisitAt: iso(t),
        tasks: [...b.tasks.filter((x) => x.key !== 'site_visit'), { key: 'site_visit', label: 'Site visit with the customer', done: false, dueAt: iso(t) }],
      });
    }
    case 'complete_task': {
      const t = b.tasks.find((x) => x.key === action.key);
      if (!t) return err('Task not found');
      if (t.done) return err('Task already done');
      if (isEnded(s)) return err('This booking has ended');
      return withEvent(b, now, 'provider', 'task_done', `${t.label} — done`, { tasks: b.tasks.map((x) => (x.key === action.key ? { ...x, done: true } : x)) });
    }
    case 'release_deposit': {
      if (depositStatus(b) !== 'held') return err('No deposit hold to release');
      if (!['checked_in', 'in_progress', 'completed', 'no_show'].includes(s)) return err('Deposits are released after check-out (or a no-show)');
      return withEvent(b, now, 'provider', 'deposit_released', `Deposit hold of ${formatAED(depositHoldFils(b))} released`, b.depositClaimBy ? { depositClaimBy: iso(now) } : {});
    }
    case 'claim_deposit': {
      if (depositStatus(b) !== 'held') return err('No deposit hold to claim from');
      if (s !== 'completed' && s !== 'no_show') return err('Claims are made after check-out (or a no-show)');
      if (b.depositClaimBy && now > ms(b.depositClaimBy)) return err('The 14-day claim window has closed');
      if (!Number.isInteger(action.fils) || action.fils <= 0) return err('Enter a claim amount');
      if (action.fils > depositHoldFils(b)) return err(`Claim cannot exceed the ${formatAED(depositHoldFils(b))} hold`);
      if (!action.reason.trim()) return err('Give a reason for the claim');
      return withEvent(b, now, 'provider', 'deposit_claimed', `Claimed ${formatAED(action.fils)} from the deposit — ${action.reason.trim()}; rest released`, {
        depositClaimBy: b.depositClaimBy ? iso(now) : undefined,
        payments: [...b.payments, { id: paymentId(b, `claim-${b.events.length}`), label: `Damage claim — ${action.reason.trim()}`, dueAt: null, fils: action.fils, status: 'paid', paidAt: iso(now), method: 'card' }],
      });
    }
  }
}

/** After a payment is paid / waived: gating payments settled → confirmed (court split → shares pending). */
function afterSettle(nb: Booking, s: BookingState, listing: PreviewListing, now: number, actor: BookingEvent['actor'], text: string): Booking {
  if (s === 'provisional') return allPaid(gatingPayments(nb)) ? confirm(nb, listing, now, actor, text) : nb;
  if (s !== 'held' && s !== 'awaiting_payment') return nb;
  if (!allPaid(gatingPayments(nb))) return nb;
  if (isSplitCourt(nb) && !allPaid(nb.payments.filter((x) => x.id.includes('-share-')))) {
    return s === 'held'
      ? enter(nb, 'awaiting_payment', now, 'system', 'Court booked — other players can pay their shares until 2h after the match', { payBy: iso(ms(nb.end) + RULES.courtSplitSettleHoursAfterEnd * HOUR_MS) })
      : nb;
  }
  return confirm(nb, listing, now, 'system', text);
}

function applyPayment(b: Booking, pid: string, method: PaymentRecord['method'], listing: PreviewListing, now: number, actor: 'customer' | 'provider'): TransitionResult {
  const p = b.payments.find((x) => x.id === pid);
  if (!p) return err('Payment not found');
  if (p.status !== 'due') return err('This payment is not due');
  const s = b.state;
  if (!SETTLE_STATES.includes(s)) return err('This booking has ended');
  if (isDirect(b)) {
    if (actor === 'customer') return err('This booking is paid directly to the provider — nothing is charged on UpNow');
    if (!['provisional', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show', 'closed'].includes(s)) return err('Payments are recorded once the booking is confirmed');
    const m: DirectReceivedMethod = method === 'bank_transfer' || method === 'card_at_venue' || method === 'cash' ? method : method === 'card' ? 'card_at_venue' : 'cash';
    const nb = withEvent(b, now, 'provider', 'paid', `${p.label} received — ${formatAED(p.fils)} (${METHOD_LABEL[m].toLowerCase()}, paid directly)`, {
      payments: b.payments.map((x) => (x.id === pid ? { ...x, status: 'paid' as const, paidAt: iso(now), method: m } : x)),
    }, p.id);
    return afterSettle(nb, s, listing, now, 'provider', 'Deposit received — booking confirmed');
  }
  if (s === 'closed') return err('This booking has ended');
  // The deposit / full payment can only be taken once the provider has accepted (or on an option / court hold).
  const gating = gatingPayments(b).some((g) => g.id === pid);
  if (gating && !['held', 'awaiting_payment'].includes(s)) return err('This payment is not open yet');
  if (!gating && !['confirmed', 'checked_in', 'in_progress', 'completed', 'no_show'].includes(s) && !(s === 'awaiting_payment' && isSplitCourt(b))) {
    return err('This payment opens once the booking is confirmed');
  }
  if (s === 'held' && b.holdExpiresAt && now > ms(b.holdExpiresAt)) return err('The hold has expired');
  if (s === 'awaiting_payment' && gating && b.payBy && now > ms(b.payBy)) return err('The payment deadline has passed');
  const nb: Booking = withEvent(b, now, actor, 'paid', `${p.label} paid — ${formatAED(p.fils)}${actor === 'provider' ? ` (recorded: ${method === 'pay_at_venue' ? 'paid at venue' : method === 'bank_transfer' ? 'bank transfer' : 'card'})` : ''}`, {
    payments: b.payments.map((x) => (x.id === pid ? { ...x, status: 'paid' as const, paidAt: iso(now), method } : x)),
  }, p.id);
  return afterSettle(nb, s, listing, now, 'system', b.model === 'venue' ? 'Holding deposit received — event confirmed' : 'Payment received — booking confirmed');
}

// ---------------------------------------------------------------------------- change (reschedule)

interface ChangeQuote { m: Merged; lineItems: LineItem[]; totalFils: number }

function quoteChange(b: Booking, listing: PreviewListing, patch: DatesPatch, now: number, ctx?: EngineContext): ChangeQuote | TransitionError {
  const m = mergeDates(b, patch);
  if (!hasDates(m)) return err('Choose the new dates');
  if (ms(m.start) <= now) return err('Pick a new start in the future');
  if (!datesChanged(b, m) && m.guests === b.guests) return err(b.model === 'court' ? 'Pick a different slot' : 'Pick different dates');
  const price = repriceKeepingDiscounts(b, listing, m);
  if (price.error) return err(price.error);
  if (clashes(b, m, ctx, now)) return err(b.model === 'court' ? 'That court is not free at the new time' : 'The new dates are not available');
  return { m, lineItems: price.lineItems, totalFils: price.totalFils };
}
const deltaText = (diff: number) => (diff > 0 ? `+${formatAED(diff)}` : diff < 0 ? `−${formatAED(-diff).replace('−', '')}` : 'same price');

function proposeOrApply(b: Booking, by: 'customer' | 'provider', mode: 'propose' | 'apply', patch: DatesPatch, note: string | undefined, listing: PreviewListing, now: number, ctx?: EngineContext): TransitionResult {
  const g = changeGuard(b, by, listing, now);
  if (g) return err(g);
  const q = quoteChange(b, listing, patch, now, ctx);
  if (isTransitionError(q)) return q;
  const diff = q.totalFils - b.totalFils;
  const what = `${datesText(b.model, q.m.start, q.m.end)} (${formatAED(q.totalFils)}, ${deltaText(diff)})`;
  if (by === 'provider' && mode === 'apply') {
    if (!isDirect(b) && diff > 0) return err(`The new ${b.model === 'court' ? 'slot costs' : 'dates cost'} ${formatAED(diff)} more — propose the change so the customer can accept it`);
    return applyChange(b, listing, q, now, 'provider', 'change_applied', `Dates changed by ${listing.providerName}: ${what}`);
  }
  const pc: PendingChange = {
    by, start: q.m.start, end: q.m.end, guests: q.m.guests, details: q.m.details, lineItems: q.lineItems, totalFils: q.totalFils,
    at: iso(now), expiresAt: iso(Math.min(now + RULES.changeProposalValidHours * HOUR_MS, ms(b.start))), ...(note?.trim() ? { note: note.trim() } : {}),
  };
  const replaced = b.pendingChange ? ' — replaces the earlier proposal' : '';
  let nb = withEvent(b, now, by, 'change_proposed', `${by === 'customer' ? 'Customer asked for' : 'Provider proposed'} new ${b.model === 'court' ? 'slot' : 'dates'}: ${what}${replaced}`, { pendingChange: pc });
  if (note?.trim()) nb = withEvent(nb, now, by, 'message', note.trim());
  return nb;
}

function acceptChange(b: Booking, by: 'customer' | 'provider', listing: PreviewListing, now: number, ctx?: EngineContext): TransitionResult {
  const pc = b.pendingChange;
  if (!pc) return err('There is no date change to answer');
  if (pc.by === by) return err('Waiting for the other side to answer your proposal');
  if (now > ms(pc.expiresAt)) return err('This proposal has expired');
  const g = changeGuard(b, 'provider', listing, now); // the customer's free-change cutoff was checked when they asked
  if (g) return err(g);
  const m: Merged = { start: pc.start, end: pc.end, guests: pc.guests, details: pc.details };
  if (clashes(b, m, ctx, now)) return err('The new dates are no longer available');
  return applyChange(b, listing, { m, lineItems: pc.lineItems, totalFils: pc.totalFils }, now, by, 'change_accepted',
    `New ${b.model === 'court' ? 'slot' : 'dates'} accepted: ${datesText(b.model, pc.start, pc.end)} (${formatAED(pc.totalFils)}, ${deltaText(pc.totalFils - b.totalFils)})`);
}

function declineChange(b: Booking, by: 'customer' | 'provider', now: number): TransitionResult {
  const pc = b.pendingChange;
  if (!pc) return err('There is no date change to answer');
  return withEvent(b, now, by, 'change_declined', pc.by === by ? 'Date change withdrawn — the booking stays as it was' : 'Date change declined — the booking stays as it was', { pendingChange: undefined });
}

/** Payments after a change: nothing paid → schedule rebuilt; else the difference is added / taken off due payments / refunded. */
function adjustPayments(old: Booking, nb: Booking, listing: PreviewListing, now: number): { payments: PaymentRecord[]; notes: string[] } {
  if (!old.payments.length) return { payments: [], notes: [] };
  const direct = isDirect(old);
  const newStart = ms(nb.start);
  const oldStart = ms(old.start);
  if (old.payments.every((p) => p.status === 'due')) {
    const firstDue = Math.min(...old.payments.map((p) => (p.dueAt ? ms(p.dueAt) : now)));
    if (direct) {
      const fresh = buildDirectPayments(nb, listing, now);
      const gate = gatingPayments({ ...nb, payments: fresh }).map((g) => g.id);
      // Keep the current deposit due date (the provisional release date) unless the new start is earlier.
      return { payments: fresh.map((p) => (gate.includes(p.id) && (nb.model === 'venue' || nb.model === 'charter') ? { ...p, dueAt: iso(Math.min(firstDue, newStart)) } : p)), notes: [] };
    }
    return { payments: buildPayments(nb, listing, Math.min(firstDue, newStart)), notes: [] };
  }
  const notes: string[] = [];
  let payments = old.payments.map((p) => {
    if (p.status !== 'due' || !p.dueAt) return { ...p };
    const d = ms(p.dueAt);
    if (p.id.endsWith('-bal')) {
      const win = old.model === 'venue' ? RULES.venueBalanceDaysBefore * DAY_MS : RULES.charterBalanceHoursBefore * HOUR_MS;
      return { ...p, dueAt: iso(Math.min(newStart, Math.max(now, newStart - win))) };
    }
    return { ...p, dueAt: iso(d === oldStart ? newStart : Math.min(d, newStart)) };
  });
  const diff = nb.totalFils - old.totalFils;
  if (diff > 0) {
    const due = direct ? (old.model === 'court' || old.model === 'shortstay' ? newStart : Math.min(now + RULES.venueDepositDueDays * DAY_MS, newStart)) : Math.min(now + 24 * HOUR_MS, newStart);
    payments.push({
      id: paymentId(old, `chg-${old.events.length}`), label: 'Date change — difference', dueAt: iso(due), fils: diff, status: 'due',
      ...(direct ? { method: old.model === 'court' ? 'pay_at_venue' as const : 'pay_direct' as const } : {}),
    });
  } else if (diff < 0) {
    let left = -diff;
    for (let i = payments.length - 1; i >= 0 && left > 0; i--) {
      const p = payments[i];
      if (p.status !== 'due') continue;
      const cut = Math.min(p.fils, left);
      left -= cut;
      payments[i] = cut === p.fils ? { ...p, status: 'waived', label: `${p.label} — covered by the date change` } : { ...p, fils: p.fils - cut };
    }
    if (left > 0) {
      if (direct) notes.push(`The new ${old.model === 'court' ? 'slot costs' : 'dates cost'} ${formatAED(left)} less than already paid — ${old.model === 'shortstay' ? 'the host returns' : 'return'} it to the customer directly`);
      else {
        payments = [...payments, { id: paymentId(old, `refund-${old.events.length}`), label: 'Refund — date change', dueAt: null, fils: left, status: 'refunded', paidAt: iso(now), method: 'card' }];
        notes.push(`Refund ${formatAED(left)} to the customer for the date change`);
      }
    }
  }
  return { payments, notes };
}

function applyChange(b: Booking, listing: PreviewListing, q: ChangeQuote, now: number, actor: 'customer' | 'provider', type: string, text: string): Booking {
  const base: Booking = { ...b, start: q.m.start, end: q.m.end, guests: q.m.guests, details: q.m.details, lineItems: q.lineItems, totalFils: q.totalFils, pendingChange: undefined };
  const { payments, notes } = adjustPayments(b, base, listing, now);
  const newStart = ms(base.start);
  const tasks = b.state === 'confirmed' || b.state === 'provisional'
    ? tasksOnConfirm({ ...base, tasks: b.tasks.filter((t) => t.done || !START_TASKS.includes(t.key)) }, listing, now)
    : b.tasks;
  const gate = gatingPayments({ ...base, payments }).find((p) => p.status === 'due');
  let nb = withEvent({ ...base, payments, tasks }, now, actor, type, text, {
    payoutAt: b.payoutAt ? payoutAtFor(base) : undefined,
    releaseAt: b.state === 'provisional' ? (gate?.dueAt ?? iso(Math.min(ms(b.releaseAt ?? base.start), newStart))) : b.releaseAt,
    payBy: b.payBy ? iso(Math.min(ms(b.payBy), newStart)) : undefined,
    holdExpiresAt: b.holdExpiresAt ? iso(Math.min(ms(b.holdExpiresAt), newStart)) : undefined,
  });
  for (const n of notes) nb = withEvent(nb, now, 'system', 'refund', n);
  return nb;
}

// ---------------------------------------------------------------------------- customer

export function applyCustomer(b: Booking, action: CustomerAction, listing: PreviewListing, now: number, ctx?: EngineContext): TransitionResult {
  if (b.listingId !== listing.id) return err('Listing mismatch');
  const s = b.state;
  switch (action.type) {
    case 'message': {
      if (!canMessage(b)) return err('Messaging is closed for this booking');
      if (!action.text.trim()) return err('Write a message');
      // A new customer message on an answered enquiry puts the provider back on the 15-minute clock.
      return withEvent(b, now, 'customer', 'message', action.text.trim(), s === 'enquiry' && !b.respondBy ? { respondBy: iso(now + RULES.enquiryFirstReplyMin * MIN_MS) } : {});
    }
    case 'accept_offer': {
      if (s !== 'offer_sent') return err('There is no open offer');
      if (b.offerExpiresAt && now > ms(b.offerExpiresAt)) return err('This offer has expired');
      if (!hasDates(b) || ms(b.start) <= now) return err('The start date has passed');
      if (ctx && overlaps({ listingId: b.listingId, start: b.start, end: b.end, courtId: b.details.courtId, excludeBookingId: b.id, now }, ctx.bookings, ctx.blocks)) {
        return err('Those dates were booked by someone else — ask for new dates');
      }
      const word = b.model === 'shortstay' ? 'Offer' : b.model === 'court' ? 'Slot offer' : 'Quote';
      if (isDirect(b)) return confirmDirect(b, listing, now, 'customer', `${word} accepted`);
      if (b.model === 'venue') {
        const hold = capAtStart(b, now + RULES.venueOptionHoldDays * DAY_MS);
        const nb = enter(b, 'held', now, 'customer', 'Quote accepted — date held as a provisional option for 7 days', { holdExpiresAt: iso(hold) });
        return { ...nb, payments: buildPayments(nb, listing, hold) };
      }
      if (b.model === 'court') {
        const hold = capAtStart(b, now + RULES.courtCheckoutHoldMin * MIN_MS);
        const nb = enter({ ...b, details: { ...b.details, splitPayment: false } }, 'held', now, 'customer', `Slot offer accepted — court held for ${RULES.courtCheckoutHoldMin} minutes while you pay`, { holdExpiresAt: iso(hold) });
        return { ...nb, payments: buildPayments(nb, listing, hold) };
      }
      const due = capAtStart(b, now + RULES.payWithinHours.shortstay * HOUR_MS);
      const nb = enter(b, 'awaiting_payment', now, 'customer', `${word} accepted — pay within 24h to confirm`, { payBy: iso(due) });
      return { ...nb, payments: buildPayments(nb, listing, due) };
    }
    case 'decline_offer': {
      if (s !== 'offer_sent') return err('There is no open offer');
      const why = action.reason?.trim();
      return enter(b, 'enquiry', now, 'customer', `Offer declined${why ? ` — ${why}` : ''}; ${b.offerHolds ? 'the dates are released and ' : ''}the conversation stays open`, {
        respondBy: iso(now + RULES.enquiryFirstReplyMin * MIN_MS),
      });
    }
    case 'pay':
      return applyPayment(b, action.paymentId, 'card', listing, now, 'customer');
    case 'cancel': {
      const early = ['enquiry', 'offer_sent', 'requested'].includes(s);
      const earlyText = s === 'requested' ? 'Request withdrawn' : 'Enquiry withdrawn';
      if (isDirect(b)) {
        if (!['enquiry', 'offer_sent', 'requested', 'provisional', 'confirmed'].includes(s)) return err('This booking can no longer be cancelled');
        const paid = netPaidFils(b);
        let nd = enter(b, 'cancelled_by_customer', now, 'customer',
          early ? `${earlyText} — nothing is charged on UpNow`
            : `Cancelled by customer — refund is handled by ${listing.providerName} under their policy (${POLICY_LABEL[b.cancellation]}: ${policySummary(b.cancellation, listing)})`,
          { payments: b.payments.map((p) => (p.status === 'due' ? { ...p, status: 'waived' as const } : p)) });
        if (paid > 0) nd = withEvent(nd, now, 'system', 'refund', `${formatAED(paid)} was paid to ${listing.providerName} directly — any refund comes from them under their policy`);
        return nd;
      }
      if (['enquiry', 'offer_sent', 'requested', 'held'].includes(s) && netPaidFils(b) === 0) {
        return enter(b, 'cancelled_by_customer', now, 'customer', early ? `${earlyText} — no charge` : 'Cancelled — no charge', {
          payments: b.payments.map((p) => (p.status === 'due' ? { ...p, status: 'waived' as const } : p)),
        });
      }
      if (!['held', 'awaiting_payment', 'confirmed'].includes(s)) return err('This booking can no longer be cancelled');
      const q = refundFor(b, listing, now);
      let nb = enter(b, 'cancelled_by_customer', now, 'customer', `Cancelled by customer — ${q.rule}`, {
        payments: [
          ...b.payments.map((p) => (p.status === 'due' ? { ...p, status: 'waived' as const } : p)),
          ...(q.refundFils > 0 ? [{ id: paymentId(b, `refund-${b.events.length}`), label: 'Refund', dueAt: null, fils: q.refundFils, status: 'refunded' as const, paidAt: iso(now), method: 'card' as const }] : []),
        ],
      });
      nb = withEvent(nb, now, 'system', 'refund', `Refund ${formatAED(q.refundFils)} · kept ${formatAED(q.keptFils)}`);
      return nb;
    }
    case 'provide_ids': {
      if (b.model !== 'shortstay' && b.model !== 'charter') return err('IDs are not needed for this booking');
      if (!['awaiting_payment', 'provisional', 'confirmed', 'checked_in', 'in_progress'].includes(s)) return err('IDs are collected after booking');
      if (b.customer.idProvided) return err('IDs already provided');
      return withEvent(b, now, 'customer', 'ids_provided', b.model === 'shortstay' ? 'Guest IDs provided for DET registration' : 'Guest IDs provided for the manifest', { customer: { ...b.customer, idProvided: true } });
    }
    case 'review': {
      if (s !== 'completed') return err('Reviews open after the booking is completed');
      if (b.review) return err('Already reviewed');
      if (b.reviewBy && now > ms(b.reviewBy)) return err('The 14-day review window has closed');
      if (!Number.isInteger(action.rating) || action.rating < 1 || action.rating > 5) return err('Rate 1–5');
      return withEvent(b, now, 'customer', 'review', `Reviewed ${action.rating}/5`, { review: { rating: action.rating, text: action.text.trim(), at: iso(now) } });
    }
    case 'request_change':
      return proposeOrApply(b, 'customer', 'propose', action, action.note, listing, now, ctx);
    case 'accept_change':
      return acceptChange(b, 'customer', listing, now, ctx);
    case 'decline_change':
      return declineChange(b, 'customer', now);
  }
}

// ---------------------------------------------------------------------------- sweep

/** Court split: charge unpaid shares to the owner once their due time (end + 2h) has passed. */
function settleCourtShares(b: Booking, now: number): Booking {
  if (b.model !== 'court' || !['awaiting_payment', 'confirmed', 'checked_in', 'completed', 'no_show'].includes(b.state)) return b;
  const late = b.payments.filter((p) => p.status === 'due' && p.id.includes('-share-') && p.dueAt && ms(p.dueAt) <= now);
  if (!late.length) return b;
  const at = Math.max(...late.map((p) => ms(p.dueAt as string)));
  const sum = late.reduce((t, p) => t + p.fils, 0);
  let nb = withEvent(b, at, 'system', 'settled', `${late.length} unpaid share${late.length === 1 ? '' : 's'} (${formatAED(sum)}) charged to the booking owner`, {
    payments: b.payments.map((p) => (late.includes(p) ? { ...p, status: 'paid' as const, paidAt: iso(at), method: 'card' as const, label: `${p.label} — charged to owner` } : p)),
  });
  if (nb.state === 'awaiting_payment') nb = { ...nb, state: 'confirmed', payBy: undefined, payoutAt: payoutAtFor(nb), events: [...nb.events, { at: iso(at), actor: 'system', type: 'confirmed', text: 'All shares settled' }] };
  return nb;
}

function sweepOne(b0: Booking, now: number): Booking {
  let b = b0;
  for (let guard = 0; guard < 8; guard++) {
    const before = b;
    b = settleCourtShares(b, now);
    const waive = () => b.payments.map((p) => (p.status === 'due' ? { ...p, status: 'waived' as const } : p));
    if (b.pendingChange && now > ms(b.pendingChange.expiresAt)) {
      b = withEvent(b, ms(b.pendingChange.expiresAt), 'system', 'change_expired', 'Date change not answered in time — the booking stays as it was', { pendingChange: undefined });
    } else if (b.state === 'enquiry' && now > enquiryCloseAt(b)) {
      const at = enquiryCloseAt(b);
      const startPassed = hasDates(b) && at === ms(b.start);
      b = enter(b, 'expired', at, 'system', startPassed ? 'Enquiry closed — the requested date has passed' : `Enquiry closed — no activity for ${RULES.enquiryStaleDays} days`);
    } else if (b.state === 'requested' && b.respondBy && now > ms(b.respondBy)) {
      b = enter(b, 'expired', ms(b.respondBy), 'system', 'Request expired — the provider did not respond in time; no charge');
    } else if (b.state === 'offer_sent' && b.offerExpiresAt && now > ms(b.offerExpiresAt)) {
      b = enter(b, 'expired', ms(b.offerExpiresAt), 'system', b.offerHolds ? 'Counter-offer expired — the dates are released' : b.model === 'shortstay' ? 'Offer expired' : b.model === 'court' ? 'Slot offer expired' : 'Quote expired');
    } else if (b.state === 'held' && b.holdExpiresAt && now > ms(b.holdExpiresAt)) {
      b = enter(b, 'expired', ms(b.holdExpiresAt), 'system', b.model === 'court' ? 'Checkout hold released — not paid within 10 minutes' : 'Provisional option lapsed — deposit not received', { payments: waive() });
    } else if (b.state === 'awaiting_payment' && b.payBy && now > ms(b.payBy) && !isSplitCourt(b) && !isDirect(b)) {
      b = enter(b, 'expired', ms(b.payBy), 'system', 'Payment not received in time — booking released', { payments: waive() });
    } else if (b.state === 'provisional' && b.releaseAt && now > ms(b.releaseAt)) {
      b = enter(b, 'expired', ms(b.releaseAt), 'system', 'Provisional hold released — the deposit was not recorded in time; the date is free again', { payments: waive() });
    } else if (b.model === 'court' && (b.state === 'confirmed' || (b.state === 'awaiting_payment' && isSplitCourt(b)))
      && now > ms(b.start) + RULES.courtNoShowGraceMin * MIN_MS) {
      b = enter(b, 'no_show', ms(b.start) + RULES.courtNoShowGraceMin * MIN_MS, 'system', isDirect(b) ? 'No-show — no check-in within 15 minutes of the start' : 'No-show — no check-in within 15 minutes of the start; charged in full', { payBy: b.payBy });
    } else if (b.model === 'court' && b.state === 'checked_in' && now > ms(b.end)) {
      b = markCompleted(b, ms(b.end), 'system', 'Match played');
    } else if (b.state === 'completed' && b.reviewBy && now > ms(b.reviewBy) && (!b.depositClaimBy || now > ms(b.depositClaimBy)) && dueFils(b) === 0) {
      // Never closes while money is owed — the provider records or waives it first.
      const lastPay = Math.max(0, ...b.events.filter((e) => e.type === 'paid' || e.type === 'payment_waived' || e.type === 'settled').map((e) => ms(e.at)));
      const at = Math.max(ms(b.reviewBy), b.depositClaimBy ? ms(b.depositClaimBy) : 0, Math.min(lastPay, now));
      b = enter(b, 'closed', at, 'system', 'Review and deposit windows closed, nothing owed — booking closed');
    }
    if (b === before) break;
  }
  return b;
}

/** Apply every lapsed deadline. Returns the SAME array when nothing changed. */
export function sweep(bookings: Booking[], now: number): Booking[] {
  let changed = false;
  const out = bookings.map((b) => {
    const nb = sweepOne(b, now);
    if (nb !== b) changed = true;
    return nb;
  });
  return changed ? out : bookings;
}

// ---------------------------------------------------------------------------- timers

export interface BookingTimer {
  label: string;
  tone: 'ok' | 'warn' | 'bad';
  deadline: string;
  whose: 'provider' | 'customer' | 'system';
}

function timer(now: number, deadline: number, windowStart: number, whose: BookingTimer['whose'], within: string, overdue: string): BookingTimer {
  const left = deadline - now;
  if (left < 0) return { label: `${overdue} ${formatDuration(-left)}`, tone: 'bad', deadline: iso(deadline), whose };
  const win = Math.max(1, deadline - windowStart);
  return { label: `${within} ${formatDuration(left)}`, tone: left < win * 0.25 ? 'warn' : 'ok', deadline: iso(deadline), whose };
}

const firstDue = (b: Booking): PaymentRecord | undefined =>
  b.payments.filter((p) => p.status === 'due' && p.dueAt).sort((x, y) => ms(x.dueAt as string) - ms(y.dueAt as string))[0];

/**
 * The one clock that matters for this booking right now, or null. Warn under 25% of the window
 * left; bad when overdue. `side` changes the wording where both sides see the same clock
 * (direct payments: provider "Chase …", customer "… due"; date changes: "Answer …").
 */
export function timerOf(b: Booking, now: number, side: 'provider' | 'customer' = 'provider'): BookingTimer | null {
  const base = stateTimer(b, now, side);
  const pc = b.pendingChange;
  if (!pc || !CHANGE_STATES.includes(b.state)) return base;
  const theirs: BookingTimer['whose'] = pc.by === 'customer' ? 'provider' : 'customer';
  const label = theirs === side ? 'Answer the date change within' : side === 'provider' ? 'Customer to answer the date change in' : 'Provider to answer the date change in';
  const t = timer(now, ms(pc.expiresAt), ms(pc.at), theirs, label, 'Date change lapsing —');
  return !base || ms(t.deadline) <= ms(base.deadline) ? t : base;
}

function stateTimer(b: Booking, now: number, side: 'provider' | 'customer'): BookingTimer | null {
  const entered = stateEnteredAt(b);
  const direct = isDirect(b);
  const directPay = (p: PaymentRecord, from: number): BookingTimer => (side === 'provider'
    ? timer(now, ms(p.dueAt as string), from, 'provider', `Chase ${p.label.toLowerCase()} — due in`, `Chase ${p.label.toLowerCase()} — overdue`)
    : timer(now, ms(p.dueAt as string), from, 'customer', `${p.label} — due in`, `${p.label} — overdue`));
  switch (b.state) {
    case 'enquiry':
      if (b.respondBy) return timer(now, ms(b.respondBy), ms(b.respondBy) - RULES.enquiryFirstReplyMin * MIN_MS, 'provider', 'Reply within', 'Reply overdue');
      return timer(now, enquiryCloseAt(b), lastActivityAt(b), 'customer', 'Closes if no reply in', 'Closing —');
    case 'requested':
      return b.respondBy ? timer(now, ms(b.respondBy), entered, 'provider', 'Respond within', 'Response overdue') : null;
    case 'offer_sent':
      return b.offerExpiresAt ? timer(now, ms(b.offerExpiresAt), entered, 'customer', b.offerHolds ? 'Counter-offer expires in' : b.model === 'shortstay' ? 'Offer expires in' : b.model === 'court' ? 'Slot offer expires in' : 'Quote expires in', 'Offer lapsed') : null;
    case 'held':
      if (!b.holdExpiresAt) return null;
      return b.model === 'court'
        ? timer(now, ms(b.holdExpiresAt), entered, 'system', 'Hold expires in', 'Hold lapsed')
        : timer(now, ms(b.holdExpiresAt), entered, 'customer', 'Option expires in', 'Option lapsed');
    case 'awaiting_payment':
      if (!b.payBy) return null;
      if (isSplitCourt(b)) return timer(now, ms(b.payBy), entered, 'customer', 'Shares due in', 'Shares overdue');
      return timer(now, ms(b.payBy), entered, 'customer', b.payments.some((p) => p.id.endsWith('-dep') && p.status === 'due') ? 'Deposit due in' : 'Customer to pay in', 'Payment overdue');
    case 'provisional': {
      if (!b.releaseAt) return null;
      const gate = gatingPayments(b).find((p) => p.status === 'due');
      const what = (gate?.label ?? 'Deposit').toLowerCase();
      return side === 'provider'
        ? timer(now, ms(b.releaseAt), entered, 'provider', `Chase ${what} — hold releases in`, 'Hold lapsed')
        : timer(now, ms(b.releaseAt), entered, 'customer', `Pay the ${what} — date released in`, 'Hold lapsed');
    }
    case 'confirmed': {
      const task = b.tasks.filter((t) => !t.done && t.dueAt).sort((x, y) => ms(x.dueAt as string) - ms(y.dueAt as string))[0];
      const pay = firstDue(b);
      const cands: BookingTimer[] = [];
      if (task) cands.push(timer(now, ms(task.dueAt as string), entered, 'provider', `${task.label.replace(/ \(.*\)$/, '')} due in`, `${task.label.replace(/ \(.*\)$/, '')} overdue`));
      if (pay && b.model !== 'court') cands.push(direct ? directPay(pay, entered) : timer(now, ms(pay.dueAt as string), entered, 'customer', `${pay.label} due in`, `${pay.label} overdue`));
      if (cands.length) return cands.sort((x, y) => ms(x.deadline) - ms(y.deadline))[0];
      const s = ms(b.start);
      if (b.model === 'court' && now >= s) return timer(now, s + RULES.courtNoShowGraceMin * MIN_MS, s, 'customer', 'Check-in closes in', 'No check-in for');
      const word = { shortstay: 'Check-in in', venue: 'Event in', court: 'Starts in', charter: 'Departs in' }[b.model];
      return now < s ? { label: `${word} ${formatDuration(s - now)}`, tone: 'ok', deadline: b.start, whose: 'system' } : timer(now, s, entered, 'provider', word, b.model === 'shortstay' ? 'Check-in pending' : 'Start pending');
    }
    case 'checked_in':
    case 'in_progress': {
      const e = ms(b.end);
      const word = b.model === 'shortstay' ? 'Check-out in' : 'Ends in';
      if (now <= e) return { label: `${word} ${formatDuration(e - now)}`, tone: 'ok', deadline: b.end, whose: 'system' };
      return { label: `${b.model === 'shortstay' ? 'Check-out' : 'Completion'} overdue ${formatDuration(now - e)}`, tone: 'bad', deadline: b.end, whose: 'provider' };
    }
    case 'completed': {
      const end = ms(b.end);
      if (b.depositClaimBy && depositStatus(b) === 'held') return timer(now, ms(b.depositClaimBy), end, 'provider', 'Deposit claim window closes in', 'Deposit claim window closed');
      const settle = firstDue(b);
      if (settle) return direct ? directPay(settle, end) : timer(now, ms(settle.dueAt as string), end, 'customer', `${settle.label} due in`, `${settle.label} overdue`);
      if (b.reviewBy && !b.review) return timer(now, ms(b.reviewBy), end, 'customer', 'Review window closes in', 'Review window closed');
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------- next actions

export type ActionVariant = 'primary' | 'secondary' | 'danger';
/** What extra input the UI must collect before dispatching (payload is then built by the UI). */
export type ActionInput = 'reason' | 'offer' | 'text' | 'review' | 'claim' | 'payment_method' | 'datetime' | 'confirm' | 'change' | 'hold_until';
export interface ActionOption<A extends { type: string }> {
  action: A['type'];
  label: string;
  variant: ActionVariant;
  /** Ready-to-dispatch payload when no input is needed (or a template to fill in). */
  payload?: A;
  needs?: ActionInput;
}

const CHECK_IN_LABEL: Record<BookingModel, string> = { shortstay: 'Check in guest', court: 'Check in players', venue: 'Start event', charter: 'Mark departed' };
const COMPLETE_LABEL: Record<BookingModel, string> = { shortstay: 'Check out guest', court: 'Mark played', venue: 'Complete event', charter: 'Mark returned' };
const OFFER_WORD: Record<BookingModel, string> = { shortstay: 'offer', venue: 'quote', court: 'slot offer', charter: 'quote' };

export function nextActions(b: Booking, side: 'provider', listing?: PreviewListing, now?: number): ActionOption<ProviderAction>[];
export function nextActions(b: Booking, side: 'customer', listing?: PreviewListing, now?: number): ActionOption<CustomerAction>[];
/**
 * Labelled actions valid now. When `listing` and `now` are given, every option is verified by
 * dry-running the transition (or, for options that need input such as new dates, the same
 * guard the transition runs first), so buttons never offer something the engine would refuse.
 */
export function nextActions(b: Booking, side: 'provider' | 'customer', listing?: PreviewListing, now?: number): ActionOption<ProviderAction>[] | ActionOption<CustomerAction>[] {
  const s = b.state;
  const pc = b.pendingChange;
  const slotWord = b.model === 'court' ? 'slot' : 'dates';
  if (side === 'provider') {
    const out: ActionOption<ProviderAction>[] = [];
    const direct = isDirect(b);
    const reason = (action: 'decline' | 'mark_lost' | 'release_hold' | 'cancel', label: string): ActionOption<ProviderAction> =>
      ({ action, label, variant: 'danger', payload: { type: action, reason: '' } as ProviderAction, needs: 'reason' });
    if (s === 'requested') {
      out.push({ action: 'accept', label: 'Accept request', variant: 'primary', payload: { type: 'accept' } });
      out.push({ action: 'send_offer', label: 'Counter-offer', variant: 'secondary', needs: 'offer' });
      out.push(reason('decline', 'Decline'));
    }
    if (s === 'enquiry') {
      out.push({ action: 'confirm_booking', label: 'Confirm booking', variant: direct ? 'primary' : 'secondary', needs: 'confirm' });
      out.push({ action: 'send_offer', label: `Send ${OFFER_WORD[b.model]}`, variant: direct ? 'secondary' : 'primary', needs: 'offer' });
      out.push({ action: 'reply', label: 'Reply', variant: 'secondary', payload: { type: 'reply', text: '' }, needs: 'text' });
      out.push(reason('mark_lost', 'Mark lost'));
      out.push(reason('decline', 'Decline'));
    }
    if (s === 'offer_sent') {
      out.push({ action: 'send_offer', label: `Revise ${OFFER_WORD[b.model]}`, variant: 'secondary', needs: 'offer' });
      out.push({ action: 'confirm_booking', label: 'Confirm booking', variant: 'secondary', needs: 'confirm' });
      out.push(reason('mark_lost', 'Mark lost'));
      out.push(reason('decline', b.offerHolds ? 'Withdraw counter-offer' : `Withdraw ${OFFER_WORD[b.model]}`));
    }
    if (s === 'held' && b.model === 'venue') {
      out.push({ action: 'accept', label: 'Confirm option & request deposit', variant: 'primary', payload: { type: 'accept' } });
      out.push(reason('decline', 'Release option'));
    }
    if (s === 'provisional') {
      out.push({ action: 'extend_hold', label: 'Extend hold', variant: 'secondary', payload: { type: 'extend_hold', until: '' }, needs: 'hold_until' });
      out.push(reason('release_hold', 'Release hold'));
    }
    if (s === 'confirmed' || (s === 'awaiting_payment' && isSplitCourt(b))) {
      const t = b.model === 'venue' || b.model === 'charter' ? 'start' : 'check_in';
      out.push({ action: t, label: CHECK_IN_LABEL[b.model], variant: 'primary', payload: { type: t } });
      out.push({ action: 'mark_no_show', label: 'Mark no-show', variant: 'danger', payload: { type: 'mark_no_show' } });
    }
    if (s === 'checked_in' || s === 'in_progress') out.push({ action: 'complete', label: COMPLETE_LABEL[b.model], variant: 'primary', payload: { type: 'complete' } });
    if (pc?.by === 'customer') {
      out.push({ action: 'accept_change', label: `Accept new ${slotWord}`, variant: 'primary', payload: { type: 'accept_change' } });
      out.push({ action: 'decline_change', label: `Decline new ${slotWord}`, variant: 'danger', payload: { type: 'decline_change' } });
    } else if (pc?.by === 'provider') {
      out.push({ action: 'decline_change', label: `Withdraw ${b.model === 'court' ? 'slot' : 'date'} proposal`, variant: 'secondary', payload: { type: 'decline_change' } });
    }
    if (CHANGE_STATES.includes(s)) out.push({ action: 'change_dates', label: b.model === 'court' ? 'Change slot' : 'Change dates', variant: 'secondary', needs: 'change' });
    if (b.model === 'venue' && ['enquiry', 'offer_sent', 'requested', 'held', 'awaiting_payment', 'provisional', 'confirmed'].includes(s)) {
      out.push({ action: 'schedule_visit', label: b.siteVisitAt ? 'Reschedule site visit' : 'Schedule site visit', variant: 'secondary', payload: { type: 'schedule_visit', at: '' }, needs: 'datetime' });
    }
    for (const t of b.tasks) if (!t.done) out.push({ action: 'complete_task', label: `Done: ${t.label}`, variant: 'secondary', payload: { type: 'complete_task', key: t.key } });
    for (const p of b.payments) {
      if (p.status !== 'due') continue;
      out.push(direct
        ? { action: 'record_payment', label: `Mark received: ${p.label} (${formatAED(p.fils)})`, variant: 'secondary', payload: { type: 'record_payment', paymentId: p.id, method: 'cash' }, needs: 'payment_method' }
        : { action: 'record_payment', label: `Record payment: ${p.label} (${formatAED(p.fils)})`, variant: 'secondary', payload: { type: 'record_payment', paymentId: p.id, method: 'pay_at_venue' }, needs: 'payment_method' });
      out.push({ action: 'send_reminder', label: `Send reminder: ${p.label}`, variant: 'secondary', payload: { type: 'send_reminder', paymentId: p.id } });
      out.push({ action: 'waive_payment', label: `Waive / write off: ${p.label}`, variant: 'secondary', payload: { type: 'waive_payment', paymentId: p.id, reason: '' }, needs: 'reason' });
    }
    if (depositStatus(b) === 'held' && ['checked_in', 'in_progress', 'completed', 'no_show'].includes(s)) {
      out.push({ action: 'release_deposit', label: 'Release deposit', variant: 'secondary', payload: { type: 'release_deposit' } });
      if (s === 'completed' || s === 'no_show') out.push({ action: 'claim_deposit', label: 'Claim from deposit', variant: 'danger', payload: { type: 'claim_deposit', fils: 0, reason: '' }, needs: 'claim' });
    }
    if (['awaiting_payment', 'provisional', 'confirmed', 'checked_in', 'in_progress'].includes(s)) out.push(reason('cancel', 'Cancel booking'));
    if (!listing || now == null) return out;
    return out.filter((o) => {
      switch (o.action) {
        case 'send_offer': return offerGuard(b, now) == null;
        case 'confirm_booking': return confirmGuard(b) == null;
        case 'change_dates': return changeGuard(b, 'provider', listing, now) == null;
        case 'extend_hold': return s === 'provisional' && !!b.releaseAt && ms(b.releaseAt) < ms(b.start) && now < ms(b.start);
        default: {
          const p = dryProvider(o.payload, b, now);
          return p ? !isTransitionError(applyProvider(b, p, listing, now)) : true;
        }
      }
    });
  }
  const opts: ActionOption<CustomerAction>[] = [];
  if (s === 'offer_sent') {
    opts.push({ action: 'accept_offer', label: b.model === 'venue' || b.model === 'charter' ? 'Accept quote' : b.model === 'court' ? 'Accept slot' : 'Accept offer', variant: 'primary', payload: { type: 'accept_offer' } });
    opts.push({ action: 'decline_offer', label: 'Decline offer', variant: 'secondary', payload: { type: 'decline_offer' } });
  }
  for (const p of b.payments) {
    if (p.status === 'due' && !isDirect(b)) opts.push({ action: 'pay', label: `Pay ${p.label.toLowerCase().startsWith('share') ? p.label : p.label.toLowerCase()} — ${formatAED(p.fils)}`, variant: 'primary', payload: { type: 'pay', paymentId: p.id } });
  }
  if ((b.model === 'shortstay' || b.model === 'charter') && !b.customer.idProvided && ['awaiting_payment', 'provisional', 'confirmed', 'checked_in', 'in_progress'].includes(s)) {
    opts.push({ action: 'provide_ids', label: b.model === 'shortstay' ? 'Upload guest IDs' : 'Send guest manifest IDs', variant: 'secondary', payload: { type: 'provide_ids' } });
  }
  if (pc?.by === 'provider') {
    opts.push({ action: 'accept_change', label: `Accept new ${slotWord}`, variant: 'primary', payload: { type: 'accept_change' } });
    opts.push({ action: 'decline_change', label: `Decline new ${slotWord}`, variant: 'secondary', payload: { type: 'decline_change' } });
  } else if (pc?.by === 'customer') {
    opts.push({ action: 'decline_change', label: `Withdraw ${b.model === 'court' ? 'slot' : 'date'} change request`, variant: 'secondary', payload: { type: 'decline_change' } });
  }
  if (CHANGE_STATES.includes(s)) opts.push({ action: 'request_change', label: b.model === 'court' ? 'Request a different slot' : 'Request new dates', variant: 'secondary', needs: 'change' });
  if (s === 'completed' && !b.review) opts.push({ action: 'review', label: 'Leave a review', variant: 'secondary', payload: { type: 'review', rating: 5, text: '' }, needs: 'review' });
  if (canMessage(b)) opts.push({ action: 'message', label: 'Message provider', variant: 'secondary', payload: { type: 'message', text: '' }, needs: 'text' });
  if (['enquiry', 'offer_sent', 'requested', 'held', 'awaiting_payment', 'provisional', 'confirmed'].includes(s)) {
    opts.push({ action: 'cancel', label: s === 'requested' ? 'Withdraw request' : s === 'enquiry' || s === 'offer_sent' ? 'Withdraw enquiry' : 'Cancel booking', variant: 'danger', payload: { type: 'cancel' } });
  }
  if (!listing || now == null) return opts;
  return opts.filter((o) => {
    if (o.action === 'request_change') return changeGuard(b, 'customer', listing, now) == null;
    const p = dryCustomer(o.payload);
    return p ? !isTransitionError(applyCustomer(b, p, listing, now)) : true;
  });
}

function dryProvider(p: ProviderAction | undefined, b: Booking, now: number): ProviderAction | null {
  if (!p) return null;
  if (p.type === 'schedule_visit') return { type: 'schedule_visit', at: iso(hasDates(b) ? Math.min(now + HOUR_MS, Math.floor((now + ms(b.start)) / 2)) : now + HOUR_MS) };
  if (p.type === 'reply') return { type: 'reply', text: 'x' };
  if (p.type === 'decline' || p.type === 'cancel' || p.type === 'mark_lost' || p.type === 'release_hold' || p.type === 'waive_payment') return { ...p, reason: 'x' };
  if (p.type === 'claim_deposit') return { type: 'claim_deposit', fils: 1, reason: 'x' };
  return p;
}
function dryCustomer(p?: CustomerAction): CustomerAction | null {
  if (!p) return null;
  if (p.type === 'message') return { type: 'message', text: 'x' };
  return p;
}
