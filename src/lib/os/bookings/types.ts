/**
 * Booking engine contract — short stays, venues, sports courts, yacht charters.
 *
 * These models have NO backend yet (owner decision, Oct 2026), so the engine runs as a
 * PREVIEW service in the browser (localStorage, synced across tabs). Every screen that uses
 * it must show <PreviewBanner/>. The state machines, timers and money rules below follow the
 * research in reports/Short stay venue court booking flows.md (Airbnb, Booking.com, Tagvenue /
 * Peerspace / Hire Space, Playtomic / MATCHi, Dubai charter operators). When a real API
 * arrives, the same types become the API contract.
 *
 * Money is INTEGER FILS everywhere (AED × 100). Times are ISO strings (UTC); display in
 * Asia/Dubai.
 */

export type BookingModel = 'shortstay' | 'venue' | 'court' | 'charter';

/**
 * Who takes the money — chosen by the provider PER LISTING (owner decision, Oct 2026).
 *   'platform' — paid ON UpNow (simulated card): instant book, deposits / card holds, refunds by
 *                policy, payouts. Airbnb / Booking.com style.
 *   'direct'   — lead marketplace (MarketSpace): "Nothing is charged on UpNow. <host> confirms
 *                availability and you pay the provider directly." Enquiries and requests only; the
 *                provider confirms and records payments they receive; no holds, refunds or payouts.
 */
export type PaymentMode = 'platform' | 'direct';

/** How the lead reached the provider: the booking form or a contact button on the listing. */
export type LeadSource = 'form' | 'call' | 'whatsapp' | 'email';

// ---------------------------------------------------------------------------- listings

export interface PreviewListingBase {
  id: string;                 // e.g. 'ss-palm-villa'
  model: BookingModel;
  title: string;
  area: string;               // 'Palm Jumeirah, Dubai'
  images: string[];           // /marketspace/images/*.jpg
  description: string;
  providerName: string;       // the business shown to customers
  providerPhone: string;      // Call / WhatsApp buttons (fictitious in the seed)
  providerEmail: string;
  /** 'own' = belongs to the signed-in provider's business (shows in their OS). */
  owner: 'own' | 'other';
  rating: number | null;      // 0–5, null = new
  reviewCount: number;
  responseHours: number;      // typical first response, shown on the page
  instantBook: boolean;       // shortstay / venue / court(always true on platform) / charter — always false when direct
  paymentMode: PaymentMode;   // provider-editable (store listingSettings); new bookings copy it
  cancellation: CancellationPolicyId;
  amenities: string[];
}

export interface ShortStayListing extends PreviewListingBase {
  model: 'shortstay';
  permitNumber: string;       // Dubai DET holiday-home permit — must show on the listing
  bedrooms: number;
  maxGuests: number;
  nightlyFils: number;
  weekendNightlyFils?: number; // Fri/Sat nights
  cleaningFeeFils: number;
  minNights: number;
  tourismDirhamPerBedroomNightFils: number; // AED 10 standard / 15 deluxe → 1000 / 1500
  damageDepositFils: number;  // card hold at arrival, released after checkout
  checkInTime: string;        // '15:00'
  checkOutTime: string;       // '11:00'
}

export type VenueLayout = 'standing' | 'theatre' | 'banquet' | 'classroom' | 'boardroom';
export interface VenueListing extends PreviewListingBase {
  model: 'venue';
  capacity: Partial<Record<VenueLayout, number>>;
  /** Optional per-guest catering packages (MarketSpace venue form) — priced × guests, before service charge and VAT. */
  packages?: { id: string; label: string; perGuestFils: number }[];
  hourlyFils?: number;        // hire fee per hour (if hourly)
  minSpendFils?: number;      // F&B minimum spend (hotels)
  dayRateFils?: number;
  minHours: number;
  serviceChargePct: number;   // Dubai hotels: 10
  vatPct: number;             // 5
  holdingDepositPct: number;  // e.g. 30
  permitNote?: string;        // e.g. 'DET event permit required for public events'
}

export interface Court {
  id: string;
  name: string;               // 'Court 1'
  indoor: boolean;
}
export interface CourtListing extends PreviewListingBase {
  model: 'court';
  sport: string;              // 'Padel'
  /** Sports the courts can be booked for (default [sport]). */
  sports?: string[];
  courts: Court[];
  openHour: number;           // 7  (07:00)
  closeHour: number;          // 23 (23:00)
  slotMinutes: number;        // 30 grid step
  durations: number[];        // [60, 90, 120]
  offPeakPer60Fils: number;   // before 16:00 weekdays
  peakPer60Fils: number;      // 16:00+ and weekends
  maxPlayers: number;         // 4 for padel
  freeCancelHours: number;    // 24
  payAtVenueAllowed: boolean;
}

export interface CharterListing extends PreviewListingBase {
  model: 'charter';
  lengthFt: number;
  capacity: number;           // licensed guests
  hourlyFils: number;
  minHours: number;
  depositPct: number;         // 30–50
  securityHoldFils: number;   // card hold
  departurePoint: string;     // 'Dubai Marina'
  addOns: { id: string; label: string; fils: number }[];
  /** VAT on charter hire + add-ons (MarketSpace detail/spaces.js: 5%). Default 5. */
  vatPct?: number;
}

export type PreviewListing = ShortStayListing | VenueListing | CourtListing | CharterListing;

// ---------------------------------------------------------------------------- policies

export type CancellationPolicyId =
  | 'flexible' | 'moderate' | 'limited' | 'firm' | 'non_refundable'   // stays (Airbnb tiers)
  | 'venue_standard' | 'venue_strict'                                  // venues
  | 'court_24h'                                                        // courts
  | 'charter_72h';                                                     // charters

export interface RefundQuote {
  refundFils: number;
  keptFils: number;
  rule: string;               // human-readable rule that applied
}

// ---------------------------------------------------------------------------- bookings

/** All states across the four models. Each model uses a subset (see MODEL_FLOW in engine). */
export type BookingState =
  // shared request phase
  | 'enquiry'            // contact lead: no hold, first-reply clock (15 min target); dates optional (openDates)
  | 'offer_sent'         // provider pre-approved / special offer / quote sent — customer has 24h (stays) or quote validity (venues)
  | 'requested'          // request to book — dates/slot HELD, provider must answer by respondBy (24h stays, 48h venues/charters)
  | 'held'               // court checkout hold (10 min) / venue provisional option hold
  | 'awaiting_payment'   // accepted — customer must pay deposit/total by payBy
  | 'provisional'        // direct venues / yachts: provider confirmed, date held until releaseAt while the deposit is paid to them
  | 'confirmed'
  // fulfilment
  | 'checked_in'         // stays: arrived; courts: checked in; charters: departed
  | 'in_progress'        // venue event day / charter at sea
  | 'completed'          // checked out / event over / match played / returned
  // endings
  | 'declined' | 'expired' | 'cancelled_by_customer' | 'cancelled_by_provider' | 'no_show'
  | 'lost'               // provider marked the lead lost / released a provisional hold (reason in the event)
  | 'closed';            // review + deposit windows finished, payout done

export interface Party {
  name: string;
  phone: string;
  email?: string;
  idProvided?: boolean;  // stays: DET guest registration needs ID per guest; charters: manifest
}

export interface LineItem {
  key: string;
  label: string;          // 'AED 950 × 4 nights', 'Tourism Dirham', 'Service charge 10%', 'VAT 5%'
  fils: number;
  kind: 'base' | 'fee' | 'tax' | 'addon' | 'discount' | 'deposit_hold';
}

export interface PaymentRecord {
  id: string;
  label: string;          // 'Deposit 30%', 'Balance', 'Share — Player 2'
  dueAt: string | null;
  fils: number;
  status: 'due' | 'paid' | 'refunded' | 'waived' | 'failed';
  paidAt?: string;
  /**
   * Platform: 'card' (paid in the app) or what the provider recorded.
   * Direct: while due, how the customer is expected to pay ('pay_direct' | 'pay_at_venue');
   * once the provider marks it received, how it was received ('cash' | 'card_at_venue' | 'bank_transfer').
   */
  method?: 'card' | 'pay_at_venue' | 'bank_transfer' | 'pay_direct' | 'cash' | 'card_at_venue';
}

export interface BookingEvent {
  at: string;
  actor: 'customer' | 'provider' | 'system';
  type: string;           // 'requested', 'accepted', 'expired', 'paid', 'checked_in', 'message'…
  text: string;
  /** What the event is about, e.g. the payment id of a reminder. */
  ref?: string;
}

/** A date / slot change waiting for the other side (see CHANGE in engine). */
export interface PendingChange {
  by: 'customer' | 'provider';
  start: string;
  end: string;
  guests: number;
  details: Booking['details'];
  lineItems: LineItem[];
  totalFils: number;
  at: string;
  expiresAt: string;
  note?: string;
}

export interface Booking {
  id: string;                     // 'BK-1042'
  model: BookingModel;
  listingId: string;
  state: BookingState;
  /** Copied from the listing at creation; later listing changes do not affect it. Missing = 'platform' (older data). */
  paymentMode?: PaymentMode;
  /** Where the lead came from. Missing = 'form'. */
  source?: LeadSource;
  createdAt: string;
  updatedAt: string;
  customer: Party;
  /** Stays/charters: dates; venues: event date+time; courts: slot. */
  start: string;                  // ISO
  end: string;                    // ISO
  guests: number;
  /** Model-specific selections. */
  details: {
    courtId?: string;
    durationMin?: number;
    players?: number;
    splitPayment?: boolean;
    layout?: VenueLayout;
    eventType?: string;
    catering?: boolean;
    addOnIds?: string[];
    bedrooms?: number;
    message?: string;
    // stays (MarketSpace form): guests = adults + children; infants are extra
    adults?: number;
    children?: number;
    infants?: number;
    tripType?: string;           // 'Holiday' | 'Business' | 'Family visit' | 'Relocation stay'
    // venues
    budgetFils?: number;
    session?: string;            // 'Morning' | 'Afternoon' | 'Evening' | 'Full day'
    packageIds?: string[];
    // courts
    sport?: string;
    seriesId?: string;           // weekly series: id of the first booking
    seriesIndex?: number;        // 1-based
    seriesCount?: number;        // occurrences booked
    seriesSkipped?: string[];    // ISO starts of weeks skipped because the court was taken
    // yachts
    occasion?: string;           // 'Leisure' | 'Birthday' | 'Proposal' | 'Corporate' | 'Photoshoot'
  };
  /** Enquiry without dates (call-back / email): start and end are '' until the provider adds them. */
  openDates?: boolean;
  lineItems: LineItem[];          // the price the customer saw / accepted
  totalFils: number;
  payments: PaymentRecord[];
  cancellation: CancellationPolicyId;
  /** Deadlines that drive the timers and the Today queue. */
  respondBy?: string;             // provider must accept/decline (requested)
  offerExpiresAt?: string;        // customer must accept offer/quote (offer_sent)
  holdExpiresAt?: string;         // checkout / provisional hold (held)
  payBy?: string;                 // customer must pay (awaiting_payment)
  releaseAt?: string;             // provisional: the date is released if the deposit is not recorded by then
  offerHolds?: boolean;           // offer_sent: a counter-offer to a request keeps the dates held until it expires
  pendingChange?: PendingChange;  // a date / slot change waiting for the other side
  quoteVersion?: number;          // venues
  /** Post-stay windows. */
  reviewBy?: string;              // 14 days after end
  depositClaimBy?: string;        // stays: 14 days after checkout
  payoutAt?: string;              // platform only — stays: 24h after check-in; venues/charters: 3 days after end; courts: weekly
  siteVisitAt?: string;           // venues: site visit arranged by the provider (both modes; does not change state)
  tasks: { key: string; label: string; done: boolean; dueAt?: string }[]; // DET guest registration, manifest, final numbers…
  events: BookingEvent[];
  review?: { rating: number; text: string; at: string };
}

/** A calendar block set by the provider (maintenance, owner use, external booking). */
export interface AvailabilityBlock {
  id: string;
  listingId: string;
  courtId?: string;
  start: string;
  end: string;
  reason: string;
}

// ---------------------------------------------------------------------------- store API

/** New dates / slot / guests for an offer, a provider confirmation or a change. */
export interface DatesPatch {
  start?: string;
  end?: string;
  guests?: number;
  details?: Booking['details'];
}

export type ProviderAction =
  | { type: 'accept' }                          // requested → awaiting_payment (platform) / confirmed | provisional (direct)
  | { type: 'decline'; reason: string }
  | ({ type: 'send_offer'; lineItems: LineItem[]; validHours: number; note?: string } & DatesPatch) // enquiry / requested (counter) → offer_sent
  | ({ type: 'confirm_booking'; lineItems?: LineItem[]; note?: string } & DatesPatch) // enquiry / offer_sent → awaiting_payment (platform) / confirmed | provisional (direct)
  | { type: 'mark_lost'; reason: string }       // enquiry / offer_sent → lost
  | { type: 'reply'; text: string }             // stops the enquiry first-reply clock
  | { type: 'check_in' } | { type: 'start' } | { type: 'complete' }
  | { type: 'mark_no_show' }
  | { type: 'cancel'; reason: string }          // provider cancellation (penalty noted)
  | { type: 'record_payment'; paymentId: string; method: PaymentRecord['method'] }
  | { type: 'waive_payment'; paymentId: string; reason: string }
  | { type: 'send_reminder'; paymentId: string }
  | { type: 'extend_hold'; until: string }      // provisional: move the release date
  | { type: 'release_hold'; reason: string }    // provisional → lost
  | ({ type: 'change_dates'; mode: 'propose' | 'apply'; note?: string } & DatesPatch)
  | { type: 'accept_change' } | { type: 'decline_change' }
  | { type: 'complete_task'; key: string }
  | { type: 'schedule_visit'; at: string }       // venues: arrange a site visit (adds a task + event; no state change)
  | { type: 'release_deposit' } | { type: 'claim_deposit'; fils: number; reason: string };

export type CustomerAction =
  | { type: 'accept_offer' }                    // offer_sent → awaiting_payment / held / confirmed / provisional
  | { type: 'decline_offer'; reason?: string }  // offer_sent → enquiry (conversation stays open)
  | ({ type: 'request_change'; note?: string } & DatesPatch)
  | { type: 'accept_change' } | { type: 'decline_change' }
  | { type: 'pay'; paymentId: string }          // simulated card payment
  | { type: 'cancel' }                          // refund per policy
  | { type: 'message'; text: string }
  | { type: 'provide_ids' }                     // DET registration / manifest
  | { type: 'review'; rating: number; text: string };

export interface NewBookingInput {
  listingId: string;
  kind: 'enquiry' | 'request' | 'instant';      // instant: stays with instantBook, courts (checkout hold), venues with instantBook
  /** '' (both) only for an enquiry without dates — the provider adds them before offering / confirming. */
  start: string;
  end: string;
  guests: number;
  details: Booking['details'];
  customer: Party;
  source?: LeadSource;                          // default 'form'
}

/** Provider-editable listing settings, persisted by the store and merged over the seed. */
export interface ListingSettings {
  paymentMode?: PaymentMode;
  instantBook?: boolean;
}

export interface BookingStore {
  /** Seed listings with the provider's listingSettings applied (see effectiveListing). */
  listings: PreviewListing[];
  listingSettings: Record<string, ListingSettings>;
  /** Change an own listing's payment model / instant booking. Affects NEW bookings only. */
  updateListing: (listingId: string, patch: ListingSettings) => { error?: string };
  bookings: Booking[];
  blocks: AvailabilityBlock[];
  /** Demo clock offset (ms) so reviewers can test expiries: now() = Date.now() + offset. */
  clockOffsetMs: number;
  now: () => number;
  advanceClock: (ms: number) => void;
  resetDemo: () => void;
  quote: (input: Omit<NewBookingInput, 'customer' | 'kind'>) => { lineItems: LineItem[]; totalFils: number; error?: string };
  isAvailable: (listingId: string, start: string, end: string, courtId?: string) => boolean;
  create: (input: NewBookingInput) => { booking?: Booking; error?: string };
  /** Courts: the same slot every week for `weeks` weeks (taken weeks are skipped and listed). */
  createSeries: (input: NewBookingInput, weeks: number) => { bookings: Booking[]; skipped: string[]; error?: string };
  providerAct: (bookingId: string, action: ProviderAction) => { error?: string };
  customerAct: (bookingId: string, action: CustomerAction) => { error?: string };
  addBlock: (block: Omit<AvailabilityBlock, 'id'>) => void;
  removeBlock: (id: string) => void;
  refundQuote: (bookingId: string) => RefundQuote | null;
}
