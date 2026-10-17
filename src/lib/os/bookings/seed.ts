/**
 * PREVIEW seed data for the booking engine: 11 listings (4 short stays, 3 venues, 2 padel
 * clubs, 2 yachts) and ~55 bookings spread across every board column — including the
 * provisional "awaiting deposit" holds (direct venues / yachts), counter-offers, lost leads,
 * pending date changes (both directions), a call-back lead without dates, a weekly court series
 * with a skipped week, a direct trip still waiting to be settled and a platform no-show.
 *
 * Payment modes are mixed (the provider picks per listing): own — Palm villa, Marina 1BR
 * (instant) and the ballroom are paid ON UpNow; JBR 2BR, the rooftop, Padel Hub Al Quoz (pay at
 * venue) and the 56ft yacht are paid to the provider DIRECTLY. Others — Downtown studio direct;
 * private dining, Jumeirah Racquet House and the 42ft cruiser on UpNow. A few enquiries arrive
 * by call / WhatsApp (the listing's contact buttons) rather than the form.
 *
 * Bookings are not hand-written records: each one is PLAYED through the engine (create →
 * provider/customer actions at earlier simulated times → sweep at `now`), so every seeded
 * state, deadline, payment and event is one the engine itself would produce. Timestamps are
 * relative to the seed time, so timers always have live data (a request expiring in 3h, an
 * offer about to lapse, a 10-minute court hold, a stay checking in today…).
 *
 * Permit numbers, businesses and people are fictitious. Images: /public/marketspace/images only.
 */
import type {
  AvailabilityBlock, Booking, CustomerAction, NewBookingInput, Party, PreviewListing, ProviderAction,
} from './types';
import { DAY_MS, HOUR_MS, MIN_MS, applyCustomer, applyProvider, createBooking, createSeries, dubaiAt, iso, isTransitionError, priceFor, sweep } from './engine';

const IMG = (n: string) => `/marketspace/images/${n}.jpg`;
const OWN = 'Coastline Hospitality';
const OWN_PHONE = '+971 4 555 0142';
const OWN_EMAIL = 'bookings@coastline.example';

export const SEED_LISTINGS: PreviewListing[] = [
  // ------------------------------------------------------------------ short stays
  {
    id: 'ss-palm-villa', model: 'shortstay', owner: 'own', providerName: OWN, providerPhone: OWN_PHONE, providerEmail: OWN_EMAIL,
    title: 'Signature 4BR beach villa', area: 'Palm Jumeirah, Dubai', images: [IMG('villa1'), IMG('hero')],
    description: 'Four-bedroom deluxe villa on the Palm fronds with a private pool, beach access and skyline views across the Gulf.',
    rating: 4.92, reviewCount: 38, responseHours: 1, instantBook: false, paymentMode: 'platform', cancellation: 'firm',
    amenities: ['Private pool', 'Beach access', 'Wi-Fi', 'Kitchen', 'Free parking', 'BBQ terrace', 'Maid’s room'],
    permitNumber: 'DET-HH-482917', bedrooms: 4, maxGuests: 8, nightlyFils: 420_000, weekendNightlyFils: 520_000,
    cleaningFeeFils: 75_000, minNights: 3, tourismDirhamPerBedroomNightFils: 1_500, damageDepositFils: 500_000,
    checkInTime: '15:00', checkOutTime: '11:00',
  },
  {
    id: 'ss-marina-1br', model: 'shortstay', owner: 'own', providerName: OWN, providerPhone: OWN_PHONE, providerEmail: OWN_EMAIL,
    title: 'Marina view 1BR apartment', area: 'Dubai Marina, Dubai', images: [IMG('apt2'), IMG('apt3')],
    description: 'Bright one-bedroom on a high floor with a balcony over the Marina, walking distance to the tram and JBR beach.',
    rating: 4.81, reviewCount: 112, responseHours: 1, instantBook: true, paymentMode: 'platform', cancellation: 'moderate',
    amenities: ['Balcony', 'Wi-Fi', 'Pool', 'Gym', 'Washer', 'Workspace'],
    permitNumber: 'DET-HH-317604', bedrooms: 1, maxGuests: 3, nightlyFils: 65_000, weekendNightlyFils: 78_000,
    cleaningFeeFils: 20_000, minNights: 2, tourismDirhamPerBedroomNightFils: 1_000, damageDepositFils: 150_000,
    checkInTime: '15:00', checkOutTime: '11:00',
  },
  {
    id: 'ss-downtown-studio', model: 'shortstay', owner: 'other', providerName: 'Boulevard Homes',
    providerPhone: '+971 4 555 0310', providerEmail: 'stay@boulevardhomes.example',
    title: 'Downtown studio with Burj view', area: 'Downtown Dubai', images: [IMG('aerial1'), IMG('apt3')],
    description: 'Compact studio steps from Dubai Mall and the fountains, with a full-height window facing the Burj Khalifa.',
    rating: 4.67, reviewCount: 54, responseHours: 3, instantBook: false, paymentMode: 'direct', cancellation: 'flexible',
    amenities: ['Wi-Fi', 'Pool', 'Gym', 'Kitchenette', 'Smart TV'],
    permitNumber: 'DET-HH-205581', bedrooms: 1, maxGuests: 2, nightlyFils: 52_000,
    cleaningFeeFils: 15_000, minNights: 1, tourismDirhamPerBedroomNightFils: 1_000, damageDepositFils: 100_000,
    checkInTime: '15:00', checkOutTime: '11:00',
  },
  {
    id: 'ss-jbr-2br', model: 'shortstay', owner: 'own', providerName: OWN, providerPhone: OWN_PHONE, providerEmail: OWN_EMAIL,
    title: 'Beachfront 2BR at JBR', area: 'Jumeirah Beach Residence, Dubai', images: [IMG('apt3'), IMG('apt2')],
    description: 'Two-bedroom family apartment on The Walk with direct beach access, sea views and a kids’ pool in the building.',
    rating: 4.75, reviewCount: 71, responseHours: 2, instantBook: false, paymentMode: 'direct', cancellation: 'limited',
    amenities: ['Sea view', 'Beach access', 'Wi-Fi', 'Kids’ pool', 'Kitchen', 'Parking'],
    permitNumber: 'DET-HH-659032', bedrooms: 2, maxGuests: 5, nightlyFils: 110_000, weekendNightlyFils: 135_000,
    cleaningFeeFils: 35_000, minNights: 3, tourismDirhamPerBedroomNightFils: 1_000, damageDepositFils: 200_000,
    checkInTime: '15:00', checkOutTime: '11:00',
  },
  // ------------------------------------------------------------------ venues
  {
    id: 'vn-rooftop', model: 'venue', owner: 'own', providerName: OWN, providerPhone: OWN_PHONE, providerEmail: OWN_EMAIL,
    title: 'Skyline rooftop terrace', area: 'Business Bay, Dubai', images: [IMG('venue2'), IMG('aerial1')],
    description: 'Open-air rooftop with a lounge bar, DJ booth and canal views. Shaded seating and misting fans for summer evenings.',
    rating: 4.7, reviewCount: 26, responseHours: 4, instantBook: false, paymentMode: 'direct', cancellation: 'venue_standard',
    amenities: ['Bar', 'DJ booth', 'Sound system', 'Outdoor', 'Valet parking', 'Outside catering allowed'],
    capacity: { standing: 150, banquet: 80, theatre: 100 }, hourlyFils: 250_000, dayRateFils: 1_800_000,
    packages: [
      { id: 'canapes', label: 'Canapés & soft drinks', perGuestFils: 12_000 },
      { id: 'bbq', label: 'Live BBQ buffet', perGuestFils: 18_000 },
    ],
    minHours: 3, serviceChargePct: 0, vatPct: 5, holdingDepositPct: 30,
    permitNote: 'DET event permit required for public or ticketed events',
  },
  {
    id: 'vn-ballroom', model: 'venue', owner: 'own', providerName: OWN, providerPhone: OWN_PHONE, providerEmail: OWN_EMAIL,
    title: 'Grand hotel ballroom', area: 'Al Sufouh, Dubai', images: [IMG('hotel1'), IMG('venue2')],
    description: 'Pillarless ballroom with a pre-function foyer, in-house banqueting and AV. Priced as a food & beverage minimum spend.',
    rating: 4.85, reviewCount: 19, responseHours: 6, instantBook: false, paymentMode: 'platform', cancellation: 'venue_strict',
    amenities: ['In-house catering', 'AV & stage', 'Dance floor', 'Bridal suite', 'Valet parking'],
    capacity: { banquet: 300, theatre: 450, standing: 500, classroom: 200 }, minSpendFils: 8_500_000,
    minHours: 5, serviceChargePct: 10, vatPct: 5, holdingDepositPct: 50,
    permitNote: 'DET entertainment permit required for corporate and private events',
  },
  {
    id: 'vn-private-dining', model: 'venue', owner: 'other', providerName: 'Gulf Table Dining',
    providerPhone: '+971 4 555 0477', providerEmail: 'events@gulftable.example',
    title: 'Private dining room — chef’s table', area: 'DIFC, Dubai', images: [IMG('hotel1'), IMG('office3')],
    description: 'An 18-seat private room beside the open kitchen, with a set tasting menu and a dedicated host.',
    rating: 4.9, reviewCount: 44, responseHours: 2, instantBook: true, paymentMode: 'platform', cancellation: 'venue_standard',
    amenities: ['Set menu', 'Sommelier', 'Screen & HDMI', 'Wheelchair access'],
    capacity: { banquet: 18, boardroom: 14 }, hourlyFils: 90_000, minHours: 3, serviceChargePct: 10, vatPct: 5, holdingDepositPct: 30,
  },
  // ------------------------------------------------------------------ courts
  {
    id: 'ct-padel-alquoz', model: 'court', owner: 'own', providerName: OWN, providerPhone: OWN_PHONE, providerEmail: OWN_EMAIL,
    title: 'Padel Hub Al Quoz', area: 'Al Quoz, Dubai', images: [IMG('padel1'), IMG('padel2')],
    description: 'Four air-conditioned panoramic courts, open 24 hours. Racket hire and balls at reception.',
    rating: 4.6, reviewCount: 203, responseHours: 1, instantBook: false, paymentMode: 'direct', cancellation: 'court_24h',
    amenities: ['Air-conditioned', 'Racket hire', 'Changing rooms', 'Parking', 'Café'],
    sport: 'Padel', sports: ['Padel', 'Pickleball'], courts: [
      { id: 'c1', name: 'Court 1', indoor: true }, { id: 'c2', name: 'Court 2', indoor: true },
      { id: 'c3', name: 'Court 3', indoor: true }, { id: 'c4', name: 'Court 4', indoor: true },
    ],
    openHour: 0, closeHour: 24, slotMinutes: 30, durations: [60, 90, 120],
    offPeakPer60Fils: 24_000, peakPer60Fils: 36_000, maxPlayers: 4, freeCancelHours: 24, payAtVenueAllowed: true,
  },
  {
    id: 'ct-padel-jumeirah', model: 'court', owner: 'other', providerName: 'Jumeirah Racquet House',
    providerPhone: '+971 4 555 0629', providerEmail: 'courts@jrh.example',
    title: 'Jumeirah Racquet House', area: 'Jumeirah 1, Dubai', images: [IMG('padel2'), IMG('fit1')],
    description: 'Two courts — one indoor, one floodlit outdoor court for the cooler months.',
    rating: 4.4, reviewCount: 87, responseHours: 2, instantBook: true, paymentMode: 'platform', cancellation: 'court_24h',
    amenities: ['Floodlights', 'Racket hire', 'Showers'],
    sport: 'Padel', courts: [{ id: 'j1', name: 'Indoor court', indoor: true }, { id: 'j2', name: 'Outdoor court', indoor: false }],
    openHour: 7, closeHour: 23, slotMinutes: 30, durations: [60, 90],
    offPeakPer60Fils: 20_000, peakPer60Fils: 30_000, maxPlayers: 4, freeCancelHours: 24, payAtVenueAllowed: false,
  },
  // ------------------------------------------------------------------ charters
  {
    id: 'ch-42ft', model: 'charter', owner: 'other', providerName: 'Harbour Line Charters',
    providerPhone: '+971 4 555 0815', providerEmail: 'charter@harbourline.example',
    title: '42ft sport cruiser', area: 'Dubai Marina', images: [IMG('yacht2')],
    description: 'Sporty cruiser with a sun deck and swim platform — Marina, JBR, Ain Dubai and the Palm Atlantis loop.',
    rating: 4.5, reviewCount: 61, responseHours: 1, instantBook: true, paymentMode: 'platform', cancellation: 'charter_72h',
    amenities: ['Captain & crew', 'Soft drinks & water', 'Bluetooth sound', 'Swim platform', 'Life jackets'],
    lengthFt: 42, capacity: 12, hourlyFils: 75_000, minHours: 2, depositPct: 50, securityHoldFils: 200_000,
    departurePoint: 'Dubai Marina', addOns: [
      { id: 'bbq', label: 'BBQ on board', fils: 45_000 }, { id: 'cake', label: 'Celebration cake', fils: 25_000 },
      { id: 'decor', label: 'Balloon & flower decoration', fils: 60_000 },
    ],
  },
  {
    id: 'ch-56ft', model: 'charter', owner: 'own', providerName: OWN, providerPhone: OWN_PHONE, providerEmail: OWN_EMAIL,
    title: '56ft luxury yacht', area: 'Dubai Harbour', images: [IMG('yacht2'), IMG('aerial1')],
    description: 'Three-cabin flybridge yacht with a shaded aft deck, flybridge lounge and a crew of three.',
    rating: 4.88, reviewCount: 33, responseHours: 2, instantBook: false, paymentMode: 'direct', cancellation: 'charter_72h',
    amenities: ['Captain & 2 crew', 'Flybridge', '3 cabins', 'Towels', 'Snorkelling gear'],
    lengthFt: 56, capacity: 20, hourlyFils: 140_000, minHours: 3, depositPct: 30, securityHoldFils: 500_000,
    departurePoint: 'Dubai Harbour', addOns: [
      { id: 'bbq', label: 'BBQ catering (up to 20)', fils: 120_000 }, { id: 'dj', label: 'DJ on board', fils: 150_000 },
      { id: 'fishing', label: 'Fishing gear', fils: 30_000 }, { id: 'jetski', label: 'Jet ski (30 min)', fils: 35_000 },
    ],
  },
];

export function listingById(id: string): PreviewListing | undefined {
  return SEED_LISTINGS.find((l) => l.id === id);
}

// ---------------------------------------------------------------------------- bookings

const P = (name: string, phone: string, email?: string): Party => ({ name, phone, email });
const PEOPLE = {
  layla: P('Layla Haddad', '+971 50 214 7781', 'layla.h@example.com'),
  james: P('James Whitfield', '+971 55 903 1146', 'j.whitfield@example.com'),
  priya: P('Priya Nair', '+971 52 660 4093', 'priya.nair@example.com'),
  omar: P('Omar Al Suwaidi', '+971 50 118 2234'),
  sofia: P('Sofia Rossi', '+971 58 447 9020', 'sofia.rossi@example.com'),
  chen: P('Chen Wei', '+971 54 302 5518'),
  fatima: P('Fatima Al Mansoori', '+971 50 771 6402', 'fatima.m@example.com'),
  daniel: P('Daniel Okafor', '+971 56 239 8817'),
  anna: P('Anna Kowalska', '+971 52 915 3370', 'anna.k@example.com'),
  rashid: P('Rashid Khan', '+971 55 480 1269'),
  marie: P('Marie Laurent', '+971 58 120 7745', 'marie.l@example.com'),
  yusuf: P('Yusuf Demir', '+971 54 667 0912'),
  hana: P('Hana Saeed', '+971 50 390 2281', 'hana.saeed@example.com'),
  tom: P('Tom Brennan', '+971 56 804 6635'),
};

type Step = [at: number, side: 'provider', action: ProviderAction] | [at: number, side: 'customer', action: CustomerAction];
interface Script {
  listingId: string;
  at: number;
  kind: NewBookingInput['kind'];
  /** NaN + open: an enquiry without dates (call-back lead). */
  start: number;
  end: number;
  open?: boolean;
  guests: number;
  customer: Party;
  details?: Booking['details'];
  steps?: Step[];
  source?: NewBookingInput['source'];
}

export interface SeedResult { bookings: Booking[]; blocks: AvailabilityBlock[]; errors: string[] }

/** Build the demo bookings relative to `now` (ms). */
export function seedBookings(now: number): SeedResult {
  const H = (n: number) => now + n * HOUR_MS;
  const D = (dayOffset: number, hh: number, mm = 0) => dubaiAt(now, hh, mm, dayOffset);
  const slot = (t: number) => Math.floor(t / (30 * MIN_MS)) * 30 * MIN_MS; // Dubai is UTC+4 → same 30-min grid
  const pid = (id: string, s: string) => `${id}-${s}`;
  const offerLines = (listingId: string, start: number, end: number, guests: number, details: Booking['details'], discountPct: number) => {
    const l = listingById(listingId) as PreviewListing;
    const p = priceFor(l, { start: iso(start), end: iso(end), guests, details });
    const lines = p.lineItems.map((x) => ({ ...x }));
    if (discountPct) {
      const base = lines.filter((x) => x.kind === 'base').reduce((s, x) => s + x.fils, 0);
      lines.push({ key: 'discount', label: `Special offer −${discountPct}%`, fils: -Math.round((base * discountPct) / 100), kind: 'discount' });
    }
    return lines;
  };

  const c3Start = slot(now + 3 * HOUR_MS);
  const c4Start = slot(now) - 30 * MIN_MS;
  const c5Start = slot(now) - 6 * HOUR_MS;
  const c6Start = slot(now) - 26 * HOUR_MS;
  const c7Start = slot(now) + 4 * HOUR_MS;

  const scripts: Script[] = [
    // ---------------- short stays (Palm villa + Marina 1BR on UpNow; JBR 2BR + Downtown studio direct)
    { listingId: 'ss-palm-villa', at: H(-21), kind: 'request', start: D(10, 15), end: D(14, 11), guests: 6, customer: PEOPLE.layla,
      details: { adults: 4, children: 2, infants: 0, tripType: 'Family visit', message: 'Family trip for my parents’ anniversary — 4 adults, 2 children.' } },
    { listingId: 'ss-marina-1br', at: H(-0.67), kind: 'enquiry', source: 'whatsapp', start: D(5, 15), end: D(8, 11), guests: 2, customer: PEOPLE.james,
      details: { message: 'Hi! Is early check-in around 11:00 possible? We land at 8am.' } },
    { listingId: 'ss-jbr-2br', at: H(-23), kind: 'enquiry', start: D(18, 15), end: D(21, 11), guests: 4, customer: PEOPLE.priya,
      details: { message: 'Could you do a better rate for 3 nights?' },
      steps: [[H(-22), 'provider', { type: 'send_offer', lineItems: offerLines('ss-jbr-2br', D(18, 15), D(21, 11), 4, {}, 10), validHours: 24, note: 'Happy to offer 10% off for your dates.' }]] },
    { listingId: 'ss-palm-villa', at: H(-10), kind: 'request', start: D(20, 15), end: D(24, 11), guests: 8, customer: PEOPLE.omar,
      steps: [[H(-6), 'provider', { type: 'accept' }]] },
    { listingId: 'ss-marina-1br', at: now - 5 * DAY_MS, kind: 'instant', start: D(0, 15), end: D(3, 11), guests: 2, customer: PEOPLE.sofia,
      steps: [
        [now - 3 * DAY_MS, 'provider', { type: 'complete_task', key: 'checkin_instructions' }],
        [H(-20), 'customer', { type: 'provide_ids' }],
      ] },
    { listingId: 'ss-palm-villa', at: now - 9 * DAY_MS, kind: 'request', start: D(-1, 15), end: D(3, 11), guests: 7, customer: PEOPLE.chen,
      steps: [
        [now - 9 * DAY_MS + 2 * HOUR_MS, 'provider', { type: 'accept' }],
        [now - 9 * DAY_MS + 5 * HOUR_MS, 'customer', { type: 'pay', paymentId: '$full' }],
        [now - 3 * DAY_MS, 'provider', { type: 'complete_task', key: 'checkin_instructions' }],
        [now - 2 * DAY_MS, 'customer', { type: 'provide_ids' }],
        [D(-1, 16), 'provider', { type: 'check_in' }],
        [D(-1, 17), 'provider', { type: 'complete_task', key: 'det_registration' }],
      ] },
    // direct: host confirmed, paid in cash at check-in, checked out
    { listingId: 'ss-jbr-2br', at: now - 20 * DAY_MS, kind: 'request', start: D(-8, 15), end: D(-4, 11), guests: 3, customer: PEOPLE.fatima,
      steps: [
        [now - 20 * DAY_MS + 2 * HOUR_MS, 'provider', { type: 'accept' }],
        [D(-10, 10), 'provider', { type: 'complete_task', key: 'checkin_instructions' }],
        [D(-9, 10), 'customer', { type: 'provide_ids' }],
        [D(-8, 15, 30), 'provider', { type: 'check_in' }],
        [D(-8, 15, 35), 'provider', { type: 'record_payment', paymentId: '$full', method: 'cash' }],
        [D(-8, 16), 'provider', { type: 'complete_task', key: 'det_registration' }],
        [D(-4, 10, 30), 'provider', { type: 'complete' }],
      ] },
    { listingId: 'ss-marina-1br', at: now - 40 * DAY_MS, kind: 'instant', start: D(-30, 15), end: D(-27, 11), guests: 1, customer: PEOPLE.daniel,
      steps: [
        [D(-32, 9), 'provider', { type: 'complete_task', key: 'checkin_instructions' }],
        [D(-31, 9), 'customer', { type: 'provide_ids' }],
        [D(-30, 15, 20), 'provider', { type: 'check_in' }],
        [D(-30, 16), 'provider', { type: 'complete_task', key: 'det_registration' }],
        [D(-27, 10), 'provider', { type: 'complete' }],
        [D(-27, 13), 'provider', { type: 'release_deposit' }],
        [D(-26, 12), 'customer', { type: 'review', rating: 5, text: 'Spotless flat, great view and super quick replies.' }],
      ] },
    { listingId: 'ss-downtown-studio', at: now - 3 * DAY_MS, kind: 'request', start: D(15, 15), end: D(17, 11), guests: 2, customer: PEOPLE.anna,
      steps: [
        [now - 3 * DAY_MS + 2 * HOUR_MS, 'provider', { type: 'accept' }],
        [now - 3 * DAY_MS + 4 * HOUR_MS, 'provider', { type: 'record_payment', paymentId: '$full', method: 'bank_transfer' }],
        [H(-24), 'customer', { type: 'cancel' }],
      ] },
    { listingId: 'ss-palm-villa', at: H(-30), kind: 'request', start: D(30, 15), end: D(33, 11), guests: 5, customer: PEOPLE.rashid },
    // direct: confirmed, "Pay host directly" still due
    { listingId: 'ss-jbr-2br', at: H(-7), kind: 'request', start: D(12, 15), end: D(15, 11), guests: 4, customer: PEOPLE.hana,
      details: { message: 'Two adults and two kids — is a cot available?' },
      steps: [[H(-5), 'provider', { type: 'accept' }]] },
    // direct: confirmed and already paid to the host by bank transfer
    { listingId: 'ss-jbr-2br', at: now - 6 * DAY_MS, kind: 'request', start: D(25, 15), end: D(28, 11), guests: 3, customer: PEOPLE.tom,
      steps: [
        [now - 6 * DAY_MS + 3 * HOUR_MS, 'provider', { type: 'accept' }],
        [now - 4 * DAY_MS, 'provider', { type: 'record_payment', paymentId: '$full', method: 'bank_transfer' }],
      ] },
    // direct: lead from the Call button
    { listingId: 'ss-jbr-2br', at: H(-1.2), kind: 'enquiry', source: 'call', start: D(40, 15), end: D(43, 11), guests: 2, customer: PEOPLE.yusuf,
      details: { message: 'Called from the listing — asked about a monthly rate.' } },

    // ---------------- venues (rooftop direct; ballroom + private dining on UpNow)
    { listingId: 'vn-rooftop', at: H(-3), kind: 'enquiry', source: 'call', start: D(12, 19), end: D(12, 23), guests: 75, customer: PEOPLE.marie,
      details: { layout: 'banquet', eventType: 'Corporate event', catering: true, session: 'Evening', budgetFils: 4_000_000, message: 'Called about a team dinner for ~75 — wants a quote with a DJ.' } },
    { listingId: 'vn-ballroom', at: now - 3 * DAY_MS, kind: 'enquiry', start: D(45, 18), end: D(46, 0), guests: 250, customer: PEOPLE.hana,
      details: { layout: 'banquet', eventType: 'Wedding reception', catering: true },
      steps: [[now - 2 * DAY_MS, 'provider', { type: 'send_offer', lineItems: offerLines('vn-ballroom', D(45, 18), D(46, 0), 250, { layout: 'banquet' }, 0), validHours: 168, note: 'Quote attached — includes the bridal suite on the night.' }]] },
    // direct: quote accepted → confirmed, site visit booked, deposit to venue due
    { listingId: 'vn-rooftop', at: now - 4 * DAY_MS, kind: 'enquiry', start: D(25, 18), end: D(25, 23), guests: 120, customer: PEOPLE.yusuf,
      details: { layout: 'standing', eventType: 'Product launch' },
      steps: [
        [now - 3 * DAY_MS, 'provider', { type: 'send_offer', lineItems: offerLines('vn-rooftop', D(25, 18), D(25, 23), 120, { layout: 'standing' }, 0), validHours: 168 }],
        [now - 2 * DAY_MS, 'customer', { type: 'accept_offer' }],
        [now - 2 * DAY_MS + HOUR_MS, 'provider', { type: 'schedule_visit', at: iso(D(3, 11)) }],
      ] },
    // direct: request accepted → confirmed with the deposit to the venue due
    { listingId: 'vn-rooftop', at: H(-30), kind: 'request', start: D(16, 19), end: D(16, 23), guests: 70, customer: PEOPLE.tom,
      details: { layout: 'banquet', eventType: 'Birthday dinner' },
      steps: [[H(-24), 'provider', { type: 'accept' }]] },
    { listingId: 'vn-ballroom', at: now - 6 * DAY_MS, kind: 'request', start: D(20, 18), end: D(21, 0), guests: 280, customer: PEOPLE.fatima,
      details: { layout: 'banquet', eventType: 'Annual gala dinner', catering: true },
      steps: [
        [now - 5 * DAY_MS, 'provider', { type: 'accept' }],
        [now - 4 * DAY_MS, 'customer', { type: 'pay', paymentId: '$dep' }],
      ] },
    { listingId: 'vn-rooftop', at: now - 5 * DAY_MS, kind: 'request', start: H(-2), end: H(2), guests: 60, customer: PEOPLE.chen,
      details: { layout: 'banquet', eventType: 'Engagement party' },
      steps: [
        [now - 5 * DAY_MS + 3 * HOUR_MS, 'provider', { type: 'accept' }],
        [now - 4 * DAY_MS, 'provider', { type: 'record_payment', paymentId: '$full', method: 'bank_transfer' }],
        [now - 3 * DAY_MS, 'provider', { type: 'complete_task', key: 'final_numbers' }],
        [now - 3 * DAY_MS, 'provider', { type: 'complete_task', key: 'det_permit' }],
        [H(-2), 'provider', { type: 'start' }],
      ] },
    { listingId: 'vn-rooftop', at: H(-18), kind: 'request', start: D(40, 18), end: D(40, 22), guests: 60, customer: PEOPLE.layla,
      details: { layout: 'theatre', eventType: 'Product launch', session: 'Evening', packageIds: ['canapes'] } },
    { listingId: 'vn-rooftop', at: now - 20 * DAY_MS, kind: 'request', start: D(-4, 19), end: D(-4, 23), guests: 75, customer: PEOPLE.james,
      details: { layout: 'banquet', eventType: 'Farewell dinner' },
      steps: [
        [now - 20 * DAY_MS + 5 * HOUR_MS, 'provider', { type: 'accept' }],
        [now - 19 * DAY_MS, 'provider', { type: 'record_payment', paymentId: '$full', method: 'bank_transfer' }],
        [now - 12 * DAY_MS, 'provider', { type: 'complete_task', key: 'final_numbers' }],
        [now - 12 * DAY_MS, 'provider', { type: 'complete_task', key: 'det_permit' }],
        [D(-4, 19), 'provider', { type: 'start' }],
        [D(-4, 23), 'provider', { type: 'complete' }],
      ] },
    { listingId: 'vn-private-dining', at: now - 45 * DAY_MS, kind: 'instant', start: D(-25, 19), end: D(-25, 22), guests: 14, customer: PEOPLE.rashid,
      details: { layout: 'banquet', eventType: 'Board dinner' },
      steps: [
        [now - 30 * DAY_MS, 'customer', { type: 'pay', paymentId: '$bal' }],
        [D(-25, 19), 'provider', { type: 'start' }],
        [D(-25, 22), 'provider', { type: 'complete' }],
        [D(-24, 10), 'customer', { type: 'review', rating: 5, text: 'Faultless service and a memorable menu.' }],
      ] },
    { listingId: 'vn-private-dining', at: now - 2 * DAY_MS, kind: 'instant', start: D(6, 19), end: D(6, 22), guests: 12, customer: PEOPLE.priya,
      details: { layout: 'banquet', eventType: 'Client dinner' } },
    // platform: accepted, holding deposit due on UpNow
    { listingId: 'vn-ballroom', at: H(-40), kind: 'request', start: D(35, 18), end: D(36, 0), guests: 200, customer: PEOPLE.anna,
      details: { layout: 'banquet', eventType: 'Corporate awards night', catering: true },
      steps: [[H(-20), 'provider', { type: 'accept' }]] },
    // platform: quote accepted → provisional option
    { listingId: 'vn-ballroom', at: now - 5 * DAY_MS, kind: 'enquiry', start: D(28, 18), end: D(29, 0), guests: 220, customer: PEOPLE.omar,
      details: { layout: 'banquet', eventType: 'Wedding reception', catering: true },
      steps: [
        [now - 4 * DAY_MS, 'provider', { type: 'send_offer', lineItems: offerLines('vn-ballroom', D(28, 18), D(29, 0), 220, { layout: 'banquet' }, 0), validHours: 168 }],
        [now - DAY_MS, 'customer', { type: 'accept_offer' }],
      ] },

    // ---------------- courts (Padel Hub Al Quoz direct, pay at venue; Jumeirah Racquet House on UpNow)
    { listingId: 'ct-padel-jumeirah', at: now - 2 * MIN_MS, kind: 'instant', start: D(1, 18), end: D(1, 19, 30), guests: 4, customer: PEOPLE.omar,
      details: { courtId: 'j1', players: 4 } },
    { listingId: 'ct-padel-jumeirah', at: H(-1), kind: 'instant', start: D(1, 19), end: D(1, 20, 30), guests: 4, customer: PEOPLE.daniel,
      details: { courtId: 'j2', players: 4, splitPayment: true },
      steps: [[H(-1) + 2 * MIN_MS, 'customer', { type: 'pay', paymentId: '$share-1' }]] },
    { listingId: 'ct-padel-alquoz', at: H(-24), kind: 'request', start: c3Start, end: c3Start + 60 * MIN_MS, guests: 2, customer: PEOPLE.rashid,
      details: { courtId: 'c3', players: 2 },
      steps: [[H(-24) + 10 * MIN_MS, 'provider', { type: 'accept' }]] },
    { listingId: 'ct-padel-alquoz', at: H(-24), kind: 'request', start: c4Start, end: c4Start + 90 * MIN_MS, guests: 4, customer: PEOPLE.sofia,
      details: { courtId: 'c4', players: 4 },
      steps: [
        [H(-24) + 5 * MIN_MS, 'provider', { type: 'accept' }],
        [c4Start - 5 * MIN_MS, 'provider', { type: 'check_in' }],
        [c4Start - 4 * MIN_MS, 'provider', { type: 'record_payment', paymentId: '$full', method: 'card_at_venue' }],
      ] },
    { listingId: 'ct-padel-alquoz', at: H(-48), kind: 'request', start: c5Start, end: c5Start + 60 * MIN_MS, guests: 4, customer: PEOPLE.yusuf,
      details: { courtId: 'c1', players: 4 },
      steps: [
        [H(-48) + 5 * MIN_MS, 'provider', { type: 'accept' }],
        [c5Start - 10 * MIN_MS, 'provider', { type: 'check_in' }],
        [c5Start - 9 * MIN_MS, 'provider', { type: 'record_payment', paymentId: '$full', method: 'cash' }],
      ] },
    { listingId: 'ct-padel-alquoz', at: H(-72), kind: 'request', start: c6Start, end: c6Start + 60 * MIN_MS, guests: 2, customer: PEOPLE.tom,
      details: { courtId: 'c2', players: 2 },
      steps: [[H(-72) + 5 * MIN_MS, 'provider', { type: 'accept' }]] },
    { listingId: 'ct-padel-jumeirah', at: H(-5), kind: 'instant', start: D(1, 10), end: D(1, 11, 30), guests: 4, customer: PEOPLE.anna,
      details: { courtId: 'j2', players: 4 },
      steps: [[H(-5) + 2 * MIN_MS, 'customer', { type: 'pay', paymentId: '$full' }]] },
    // direct: slot request waiting on the club (30-minute window)
    { listingId: 'ct-padel-alquoz', at: now - 10 * MIN_MS, kind: 'request', start: c7Start, end: c7Start + 90 * MIN_MS, guests: 4, customer: PEOPLE.marie,
      details: { courtId: 'c2', players: 4 } },
    // direct: lead from the WhatsApp button
    { listingId: 'ct-padel-alquoz', at: H(-0.5), kind: 'enquiry', source: 'whatsapp', start: D(2, 20), end: D(2, 21, 30), guests: 4, customer: PEOPLE.chen,
      details: { courtId: 'c1', players: 4, sport: 'Padel', message: 'Hi, any court free for 4 of us in the evening? Weekly if possible.' } },

    // ---------------- charters (56ft direct; 42ft on UpNow)
    { listingId: 'ch-56ft', at: H(-6), kind: 'enquiry', start: D(9, 16), end: D(9, 20), guests: 14, customer: PEOPLE.marie,
      details: { addOnIds: ['bbq'], occasion: 'Birthday', message: 'Sunset cruise for a birthday — can we add a cake?' },
      steps: [[H(-5), 'provider', { type: 'send_offer', lineItems: offerLines('ch-56ft', D(9, 16), D(9, 20), 14, { addOnIds: ['bbq'] }, 0), validHours: 24, note: 'Cake can be arranged — quote includes the BBQ.' }]] },
    { listingId: 'ch-56ft', at: H(-1.5), kind: 'enquiry', source: 'whatsapp', start: D(21, 10), end: D(21, 14), guests: 8, customer: PEOPLE.sofia,
      details: { addOnIds: ['fishing'], occasion: 'Leisure', message: 'Morning fishing trip — is the gear suitable for beginners?' },
      steps: [[H(-1.4), 'provider', { type: 'reply', text: 'Yes — the crew sets everything up and shows beginners how to cast.' }]] },
    { listingId: 'ch-56ft', at: H(-8), kind: 'request', start: D(14, 17), end: D(14, 21), guests: 18, customer: PEOPLE.hana,
      details: { addOnIds: ['dj'] } },
    // direct: confirmed, deposit to operator due
    { listingId: 'ch-56ft', at: H(-30), kind: 'request', start: D(6, 15), end: D(6, 18), guests: 10, customer: PEOPLE.james,
      steps: [[H(-4), 'provider', { type: 'accept' }]] },
    // direct: deposit received by bank transfer, balance still due (chase)
    { listingId: 'ch-56ft', at: now - 5 * DAY_MS, kind: 'request', start: D(2, 16), end: D(2, 20), guests: 16, customer: PEOPLE.omar,
      details: { addOnIds: ['bbq', 'jetski'] },
      steps: [
        [now - 5 * DAY_MS + HOUR_MS, 'provider', { type: 'accept' }],
        [now - 4 * DAY_MS, 'provider', { type: 'record_payment', paymentId: '$dep', method: 'bank_transfer' }],
      ] },
    { listingId: 'ch-56ft', at: now - 4 * DAY_MS, kind: 'request', start: H(-1), end: H(2), guests: 12, customer: PEOPLE.layla,
      steps: [
        [now - 4 * DAY_MS + 2 * HOUR_MS, 'provider', { type: 'accept' }],
        [now - 4 * DAY_MS + 5 * HOUR_MS, 'provider', { type: 'record_payment', paymentId: '$dep', method: 'bank_transfer' }],
        [now - 3 * DAY_MS, 'provider', { type: 'record_payment', paymentId: '$bal', method: 'bank_transfer' }],
        [now - 2 * DAY_MS, 'customer', { type: 'provide_ids' }],
        [now - 2 * DAY_MS, 'provider', { type: 'complete_task', key: 'manifest' }],
        [H(-1), 'provider', { type: 'start' }],
      ] },
    { listingId: 'ch-42ft', at: now - 6 * DAY_MS, kind: 'instant', start: D(-1, 16), end: D(-1, 19), guests: 8, customer: PEOPLE.chen,
      details: { addOnIds: ['cake'] },
      steps: [
        [now - 4 * DAY_MS, 'customer', { type: 'pay', paymentId: '$bal' }],
        [D(-2, 12), 'customer', { type: 'provide_ids' }],
        [D(-2, 12), 'provider', { type: 'complete_task', key: 'manifest' }],
        [D(-1, 16), 'provider', { type: 'start' }],
        [D(-1, 19), 'provider', { type: 'complete' }],
      ] },
    { listingId: 'ch-56ft', at: now - 50 * DAY_MS, kind: 'request', start: D(-30, 16), end: D(-30, 20), guests: 15, customer: PEOPLE.anna,
      steps: [
        [now - 50 * DAY_MS + 3 * HOUR_MS, 'provider', { type: 'accept' }],
        [now - 50 * DAY_MS + 6 * HOUR_MS, 'provider', { type: 'record_payment', paymentId: '$dep', method: 'bank_transfer' }],
        [D(-33, 12), 'provider', { type: 'record_payment', paymentId: '$bal', method: 'bank_transfer' }],
        [D(-32, 12), 'customer', { type: 'provide_ids' }],
        [D(-32, 12), 'provider', { type: 'complete_task', key: 'manifest' }],
        [D(-30, 16), 'provider', { type: 'start' }],
        [D(-30, 20), 'provider', { type: 'complete' }],
        [D(-29, 9), 'customer', { type: 'review', rating: 4, text: 'Great crew; the BBQ could have been hotter.' }],
      ] },
    // platform: accepted, customer to pay the deposit on UpNow within 24h
    { listingId: 'ch-42ft', at: H(-6), kind: 'request', start: D(8, 16), end: D(8, 19), guests: 8, customer: PEOPLE.james,
      details: { addOnIds: ['decor'], occasion: 'Corporate' },
      steps: [[H(-3), 'provider', { type: 'accept' }]] },

    // ---------------- new states and loops
    // stay (platform): counter-offer to a request — different dates, 8% off; the dates stay held for the customer
    { listingId: 'ss-palm-villa', at: H(-5), kind: 'request', start: D(45, 15), end: D(48, 11), guests: 6, customer: PEOPLE.daniel,
      details: { adults: 6, children: 0, tripType: 'Holiday' },
      steps: [[H(-3), 'provider', { type: 'send_offer', start: iso(D(46, 15)), end: iso(D(49, 11)), lineItems: offerLines('ss-palm-villa', D(46, 15), D(49, 11), 6, {}, 8), validHours: 24, note: 'Those exact dates are tight for cleaning — one day later is free, with 8% off.' }]] },
    // stay (direct): lead marked lost after the reply went unanswered
    { listingId: 'ss-jbr-2br', at: now - 3 * DAY_MS, kind: 'enquiry', start: D(30, 15), end: D(34, 11), guests: 3, customer: PEOPLE.rashid,
      details: { adults: 2, children: 1, tripType: 'Relocation stay', message: 'Need a place while our villa is being renovated.' },
      steps: [
        [now - 3 * DAY_MS + 10 * MIN_MS, 'provider', { type: 'reply', text: 'Available — monthly rate on request. Shall I send an offer?' }],
        [now - DAY_MS, 'provider', { type: 'mark_lost', reason: 'Booked elsewhere' }],
      ] },
    // stay (direct): confirmed and paid; the customer asked for new dates → provider to answer
    { listingId: 'ss-jbr-2br', at: now - 9 * DAY_MS, kind: 'request', start: D(50, 15), end: D(53, 11), guests: 2, customer: PEOPLE.layla,
      details: { adults: 2, children: 0, tripType: 'Holiday' },
      steps: [
        [now - 9 * DAY_MS + HOUR_MS, 'provider', { type: 'accept' }],
        [now - 8 * DAY_MS, 'provider', { type: 'record_payment', paymentId: '$full', method: 'bank_transfer' }],
        [H(-2), 'customer', { type: 'request_change', start: iso(D(51, 15)), end: iso(D(54, 11)), note: 'Flights moved by a day — could we shift?' }],
      ] },
    // stay (platform): no-show — the damage-deposit hold can still be released or claimed
    { listingId: 'ss-marina-1br', at: now - 10 * DAY_MS, kind: 'instant', start: D(-3, 15), end: D(-1, 11), guests: 2, customer: PEOPLE.tom,
      steps: [[D(-3, 23), 'provider', { type: 'mark_no_show' }]] },
    // venue (direct): call-back lead with no dates yet — the provider collects them when confirming
    { listingId: 'vn-rooftop', at: H(-0.1), kind: 'enquiry', open: true, source: 'call', start: NaN, end: NaN, guests: 40, customer: PEOPLE.sofia,
      details: { message: 'Call-back requested — birthday drinks for about 40, dates flexible.' } },
    // venue (platform): confirmed; the venue moved the start one hour later at the same price
    { listingId: 'vn-ballroom', at: now - 8 * DAY_MS, kind: 'request', start: D(60, 18), end: D(61, 0), guests: 180, customer: PEOPLE.tom,
      details: { layout: 'banquet', eventType: 'Wedding / engagement', catering: true, session: 'Evening' },
      steps: [
        [now - 7 * DAY_MS, 'provider', { type: 'accept' }],
        [now - 6 * DAY_MS, 'customer', { type: 'pay', paymentId: '$dep' }],
        [now - 2 * DAY_MS, 'provider', { type: 'change_dates', mode: 'apply', start: iso(D(60, 19)), end: iso(D(61, 1)), note: 'The foyer is booked until 19:00 — moved you an hour later, same price.' }],
      ] },
    // court (platform): enquiry answered with a slot offer the player has not accepted yet
    { listingId: 'ct-padel-jumeirah', at: H(-1), kind: 'enquiry', source: 'email', start: D(2, 10), end: D(2, 11), guests: 4, customer: PEOPLE.fatima,
      details: { courtId: 'j1', players: 4, sport: 'Padel', message: 'Any indoor court Thursday morning?' },
      steps: [[H(-0.5), 'provider', { type: 'send_offer', lineItems: offerLines('ct-padel-jumeirah', D(2, 10), D(2, 11), 4, { courtId: 'j1', players: 4 }, 0), validHours: 2, note: 'Indoor court is free at 10:00 — accept and pay to lock it in.' }]] },
    // court (direct): confirmed, then the player did not show — the club wrote the fee off
    { listingId: 'ct-padel-alquoz', at: H(-80), kind: 'request', start: slot(now) - 50 * HOUR_MS, end: slot(now) - 49 * HOUR_MS, guests: 2, customer: PEOPLE.hana,
      details: { courtId: 'c3', players: 2, sport: 'Pickleball' },
      steps: [
        [H(-80) + 5 * MIN_MS, 'provider', { type: 'accept' }],
        [slot(now) - 48 * HOUR_MS, 'provider', { type: 'waive_payment', paymentId: '$full', reason: 'No-show — regular player, not charged' }],
      ] },
    // yacht (direct): confirmed, operator proposes a later departure — customer to answer
    { listingId: 'ch-56ft', at: now - 7 * DAY_MS, kind: 'request', start: D(12, 10), end: D(12, 14), guests: 10, customer: PEOPLE.priya,
      details: { occasion: 'Proposal' },
      steps: [
        [now - 7 * DAY_MS + HOUR_MS, 'provider', { type: 'accept' }],
        [now - 6 * DAY_MS, 'provider', { type: 'record_payment', paymentId: '$dep', method: 'bank_transfer' }],
        [H(-3), 'provider', { type: 'change_dates', mode: 'propose', start: iso(D(12, 16)), end: iso(D(12, 20)), note: 'Sunset slot is free that day — far better light for a proposal. Same price.' }],
      ] },
    // yacht (direct): trip done, balance still owed — the booking stays open until it is received or written off
    { listingId: 'ch-56ft', at: now - 12 * DAY_MS, kind: 'request', start: D(-2, 10), end: D(-2, 14), guests: 8, customer: PEOPLE.rashid,
      details: { occasion: 'Leisure' },
      steps: [
        [now - 12 * DAY_MS + HOUR_MS, 'provider', { type: 'accept' }],
        [now - 11 * DAY_MS, 'provider', { type: 'record_payment', paymentId: '$dep', method: 'bank_transfer' }],
        [D(-2, 10), 'provider', { type: 'start' }],
        [D(-2, 14), 'provider', { type: 'complete' }],
        [H(-3), 'provider', { type: 'send_reminder', paymentId: '$bal' }],
      ] },
  ];

  const bookings: Booking[] = [];
  const errors: string[] = [];
  const blocks: AvailabilityBlock[] = [
    { id: 'BL-1', listingId: 'ss-palm-villa', start: iso(D(16, 0)), end: iso(D(18, 0)), reason: 'Pool maintenance' },
    { id: 'BL-2', listingId: 'ct-padel-alquoz', courtId: 'c4', start: iso(D(1, 7)), end: iso(D(1, 9)), reason: 'Court resurfacing' },
    { id: 'BL-3', listingId: 'ct-padel-alquoz', courtId: 'c2', start: iso(D(17, 18)), end: iso(D(17, 22)), reason: 'League night' },
  ];
  let n = 1001;
  for (const sc of scripts) {
    const listing = listingById(sc.listingId);
    const id = `BK-${n++}`;
    if (!listing) { errors.push(`${id}: unknown listing ${sc.listingId}`); continue; }
    const made = createBooking({
      listingId: sc.listingId, kind: sc.kind, start: sc.open ? '' : iso(sc.start), end: sc.open ? '' : iso(sc.end), guests: sc.guests, details: sc.details ?? {}, customer: { ...sc.customer }, source: sc.source,
    }, listing, sc.at, id, { bookings: sweep(bookings, sc.at), blocks });
    if (isTransitionError(made)) { errors.push(`${id} create: ${made.error}`); continue; }
    let b: Booking = made;
    let ok = true;
    for (const [at, side, action] of sc.steps ?? []) {
      const a = 'paymentId' in action && action.paymentId.startsWith('$') ? { ...action, paymentId: pid(id, action.paymentId.slice(1)) } : action;
      [b] = sweep([b], at);
      const r = side === 'provider' ? applyProvider(b, a as ProviderAction, listing, at) : applyCustomer(b, a as CustomerAction, listing, at);
      if (isTransitionError(r)) { errors.push(`${id} ${side}.${action.type}: ${r.error}`); ok = false; break; }
      b = r;
    }
    if (ok) bookings.push(b);
  }
  // court (direct): weekly series — the same 19:00 slot on Court 2 for 4 weeks; week 3 is taken (league night) and skipped; the club confirmed the rest
  {
    const listing = listingById('ct-padel-alquoz') as PreviewListing;
    const at = H(-2);
    const first = D(3, 19);
    const first0 = n;
    const r = createSeries({
      listingId: listing.id, kind: 'request', start: iso(first), end: iso(first + 90 * MIN_MS), guests: 4, details: { courtId: 'c2', players: 4, sport: 'Padel', message: 'Same court every week please.' },
      customer: { ...PEOPLE.omar },
    }, listing, at, (i) => `BK-${first0 + i}`, 4, { bookings: sweep(bookings, at), blocks });
    if (r.error) errors.push(`series: ${r.error}`);
    else {
      n += r.bookings.length;
      for (const made of r.bookings) {
        const acc = applyProvider(sweep([made], at + 5 * MIN_MS)[0], { type: 'accept' }, listing, at + 5 * MIN_MS);
        if (isTransitionError(acc)) errors.push(`${made.id} series accept: ${acc.error}`);
        else bookings.push(acc);
      }
    }
  }
  return { bookings: sweep(bookings, now), blocks, errors };
}
