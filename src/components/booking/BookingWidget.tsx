'use client';

/**
 * Sticky booking widget on /book/[listingId] — one form per model (short stay, venue, court,
 * charter). Prices come from the PREVIEW engine's quote(); create() runs the same rules the
 * provider OS sees. Nothing is sent to the API and no real payment is taken.
 *
 * Payment model is per listing: 'platform' listings book / pay on UpNow (simulated card);
 * 'direct' listings follow MarketSpace — the primary action is a request ("Request to book",
 * "Request a quote", "Check slot availability", "Check availability"), nothing is charged on
 * UpNow and the customer pays the provider directly. Every listing gets Call / WhatsApp / Email
 * contact buttons (ContactButtons): the number shows at once; a lead is logged only when the
 * customer leaves their details (call-back, WhatsApp with details, email) — never an invented slot.
 *
 * MarketSpace form fields (data/listings.js) are stored in booking.details and shown to the
 * provider: stays adults / children / infants + trip type; venues session, budget, event type
 * (incl. Photo / film shoot) and per-guest packages; courts sport + recurring weekly (one booking
 * per free week, taken weeks skipped and listed); yachts occasion.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useBookings, useNow } from '@/lib/os/bookings/store';
import { HOUR_MS, MIN_MS, RULES, formatAED, isCourtPeak, iso, pctOf, sportsOf } from '@/lib/os/bookings/engine';
import type {
  Booking, CharterListing, CourtListing, NewBookingInput, PreviewListing, ShortStayListing, VenueLayout, VenueListing,
} from '@/lib/os/bookings/types';
import { addDays, dubaiDateStr, dubaiInstant, fmtDayShort, fmtTime, fromPrice, hm, providerNoun, timeOptions } from './format';
import { ContactButtons } from './ContactButtons';
import { rememberBooking } from './myBookings';
import { ContactFields, PaymentModeLine, PreviewNote, PriceLines, contactError, type Contact } from './ui';

type Kind = NewBookingInput['kind'];
interface Draft { start: string; end: string; guests: number; details: Booking['details'] }

const safeIso = (t: number) => (Number.isFinite(t) ? iso(t) : '');
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** Contact details, prefilled from the signed-in user until the visitor edits them. */
function useContact(): [Contact, (c: Contact) => void] {
  const { user } = useAuth();
  const [edited, setEdited] = useState<Contact | null>(null);
  const realEmail = user?.email && !/@upnow\.local$/i.test(user.email) && !/^phone-/i.test(user.email) ? user.email : '';
  const fallback: Contact = {
    name: user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '',
    phone: user?.phone ?? '',
    email: realEmail,
  };
  return [edited ?? fallback, setEdited];
}

function useSubmit(listing: PreviewListing) {
  const store = useBookings();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (kind: Kind, draft: Draft, contact: Contact, weeks = 1) => {
    const ce = contactError(contact);
    if (ce) { setErr(ce); return; }
    setErr(null);
    setBusy(true);
    const input = {
      listingId: listing.id, kind, ...draft,
      customer: { name: contact.name.trim(), phone: contact.phone.trim(), email: contact.email.trim() || undefined },
    };
    if (weeks > 1) {
      const r = store.createSeries(input, weeks);
      if (r.error || !r.bookings.length) { setErr(r.error ?? 'Could not create the series'); setBusy(false); return; }
      r.bookings.forEach((b) => rememberBooking(b.id));
      router.push(`/book/confirmation/${r.bookings[0].id}`);
      return;
    }
    const r = store.create(input);
    if (!r.booking) { setErr(r.error ?? 'Could not create the booking'); setBusy(false); return; }
    rememberBooking(r.booking.id);
    router.push(`/book/confirmation/${r.booking.id}`);
  };
  return { err, busy, submit, setErr };
}

function Shell({ listing, children }: { listing: PreviewListing; children: React.ReactNode }) {
  const p = fromPrice(listing);
  return (
    <aside className="bk-widget" aria-label="Book this listing">
      <div className="price">{listing.model === 'venue' && listing.minSpendFils != null ? '' : 'From '}{p.price} <small>{p.per}</small></div>
      <PaymentModeLine listing={listing} compact />
      {children}
      <div style={{ marginTop: 14 }}><PreviewNote /></div>
    </aside>
  );
}

// ---------------------------------------------------------------------------- short stay

function ShortStayWidget({ l }: { l: ShortStayListing }) {
  const store = useBookings();
  const now = useNow(60_000);
  const today = dubaiDateStr(now);
  const [checkIn, setCheckIn] = useState(() => addDays(today, 7));
  const [checkOut, setCheckOut] = useState(() => addDays(today, 7 + Math.max(l.minNights, 3)));
  const [adults, setAdults] = useState(Math.min(2, l.maxGuests));
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [tripType, setTripType] = useState(TRIP_TYPES[0]);
  const [contact, setContact] = useContact();
  const { err, busy, submit } = useSubmit(l);
  const guests = adults + children;

  const [ih, im] = hm(l.checkInTime);
  const [oh, om] = hm(l.checkOutTime);
  const draft: Draft = { start: safeIso(dubaiInstant(checkIn, ih, im)), end: safeIso(dubaiInstant(checkOut, oh, om)), guests, details: { adults, children, infants, tripType } };
  const q = store.quote({ listingId: l.id, ...draft });
  const problem = q.error ?? (store.isAvailable(l.id, draft.start, draft.end) ? null : 'Those dates are not available — try other dates');
  const direct = l.paymentMode === 'direct';

  return (
    <Shell listing={l}>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="ss-in">Check-in</label>
          <input id="ss-in" type="date" className="bk-input" min={today} value={checkIn}
            onChange={(e) => {
              const v = e.target.value;
              setCheckIn(v);
              if (v && checkOut <= v) setCheckOut(addDays(v, l.minNights));
            }} />
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="ss-out">Check-out</label>
          <input id="ss-out" type="date" className="bk-input" min={checkIn ? addDays(checkIn, 1) : today} value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)} />
        </div>
      </div>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="ss-adults">Adults</label>
          <select id="ss-adults" className="bk-input" value={adults} onChange={(e) => { const a = Number(e.target.value); setAdults(a); setChildren((c) => Math.min(c, l.maxGuests - a)); }}>
            {range(1, l.maxGuests).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="ss-children">Children (2–12)</label>
          <select id="ss-children" className="bk-input" value={children} onChange={(e) => setChildren(Number(e.target.value))}>
            {range(0, l.maxGuests - adults).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="ss-infants">Infants (under 2)</label>
          <select id="ss-infants" className="bk-input" value={infants} onChange={(e) => setInfants(Number(e.target.value))}>
            {range(0, 3).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="ss-trip">Trip type</label>
          <select id="ss-trip" className="bk-input" value={tripType} onChange={(e) => setTripType(e.target.value)}>
            {TRIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="bk-note left">Up to {l.maxGuests} guests (adults + children); infants don&apos;t count.</div>
      <div className="bk-note left">Check-in from {l.checkInTime} · check-out by {l.checkOutTime} · minimum {l.minNights} night{l.minNights === 1 ? '' : 's'}</div>

      {problem ? <div className="bk-err" role="alert">{problem}</div> : <PriceLines lines={q.lineItems} totalFils={q.totalFils} direct={direct} extra={direct ? (
        <div className="ln hold"><span>Paid to {l.providerName} directly once they confirm</span><span>{formatAED(q.totalFils)}</span></div>
      ) : undefined} />}

      <ContactFields idPrefix="ss" value={contact} onChange={setContact} />
      {err && <div className="bk-err" role="alert">{err}</div>}
      <div className="bk-btns">
        <button type="button" className="bk-btn primary block" disabled={!!problem || busy}
          onClick={() => submit(l.instantBook ? 'instant' : 'request', draft, contact)}>
          {l.instantBook ? 'Reserve' : 'Request to book'}
        </button>
        <div className="bk-note" style={{ marginTop: 0 }}>
          {direct
            ? <>Nothing is charged on UpNow. The host confirms your dates within 24h and you pay {l.providerName} directly.</>
            : l.instantBook
              ? <>Instant booking — you pay {formatAED(q.totalFils)} now (simulated) and it is confirmed straight away.</>
              : <>You won&apos;t be charged until the host accepts; host replies within 24h.</>}
        </div>
        <ContactButtons listing={l} draft={q.error ? null : draft} details={draft.details} guests={guests} contact={contact} emailPlaceholder="e.g. Is early check-in possible?" />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------- venue

const TRIP_TYPES = ['Holiday', 'Business', 'Family visit', 'Relocation stay'];
/** MarketSpace venue event types (+ private dinner / other). */
const EVENT_TYPES = ['Wedding', 'Corporate event', 'Birthday / private party', 'Conference / meeting', 'Product launch', 'Photo / film shoot', 'Private dinner', 'Other'];
/** MarketSpace venue sessions → start time + hours (never under the venue's minimum). */
const SESSIONS: { id: string; start: string; hours: number }[] = [
  { id: 'Morning', start: '09:00', hours: 4 }, { id: 'Afternoon', start: '13:00', hours: 4 }, { id: 'Evening', start: '18:00', hours: 5 }, { id: 'Full day', start: '09:00', hours: 12 },
];
const OCCASIONS = ['Leisure', 'Birthday', 'Proposal', 'Corporate', 'Photoshoot'];
const SERIES_WEEKS = [2, 3, 4, 6, 8].filter((n) => n <= RULES.courtSeriesMaxWeeks);
/** 'AED 15,000' / '15000' → fils (null when empty or not a number). */
function budgetFils(text: string): number | null {
  const t = text.replace(/aed|,|\s/gi, '');
  if (!t || !/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
const LAYOUT_LABEL: Record<VenueLayout, string> = { standing: 'Standing reception', theatre: 'Theatre', banquet: 'Banquet', classroom: 'Classroom', boardroom: 'Boardroom' };

function VenueWidget({ l }: { l: VenueListing }) {
  const store = useBookings();
  const now = useNow(60_000);
  const today = dubaiDateStr(now);
  const layouts = Object.keys(l.capacity) as VenueLayout[];
  const [date, setDate] = useState(() => addDays(today, 21));
  const [time, setTime] = useState('18:00');
  const [hours, setHours] = useState(Math.max(l.minHours, 5));
  const [session, setSession] = useState('Evening');
  const [layout, setLayout] = useState<VenueLayout>(layouts[0]);
  const [guests, setGuests] = useState(Math.min(40, l.capacity[layouts[0]] ?? 1));
  const [eventType, setEventType] = useState(EVENT_TYPES[1]);
  const [catering, setCatering] = useState(false);
  const [budget, setBudget] = useState('');
  const [packageIds, setPackageIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useContact();
  const { err, busy, submit } = useSubmit(l);

  const cap = l.capacity[layout] ?? 0;
  const s = dubaiInstant(date, ...hm(time));
  const bud = budgetFils(budget);
  const draft: Draft = {
    start: safeIso(s), end: safeIso(s + hours * HOUR_MS), guests,
    details: {
      layout, eventType, catering, message: message.trim() || undefined, ...(session ? { session } : {}),
      ...(bud != null ? { budgetFils: bud } : {}), ...(packageIds.length ? { packageIds } : {}),
    },
  };
  const pickSession = (id: string) => {
    const x = SESSIONS.find((k) => k.id === id);
    if (!x) return;
    setSession(id); setTime(x.start); setHours(Math.min(12, Math.max(l.minHours, x.hours)));
  };
  const q = store.quote({ listingId: l.id, ...draft });
  const problem = q.error ?? (store.isAvailable(l.id, draft.start, draft.end) ? null : 'That date and time is already booked — try another slot');
  const deposit = pctOf(q.totalFils, l.holdingDepositPct);
  const direct = l.paymentMode === 'direct';

  return (
    <Shell listing={l}>
      <div className="bk-field">
        <label className="bk-label" htmlFor="vn-date">Event date</label>
        <input id="vn-date" type="date" className="bk-input" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="bk-field">
        <span className="bk-label" id="vn-session-l">Time</span>
        <div className="bk-pills" role="group" aria-labelledby="vn-session-l">
          {SESSIONS.map((x) => <button key={x.id} type="button" aria-pressed={session === x.id} onClick={() => pickSession(x.id)}>{x.id}</button>)}
        </div>
      </div>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="vn-time">Start time</label>
          <select id="vn-time" className="bk-input" value={time} onChange={(e) => { setTime(e.target.value); setSession(''); }}>
            {timeOptions(8, 24).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="vn-hours">Hours</label>
          <select id="vn-hours" className="bk-input" value={hours} onChange={(e) => { setHours(Number(e.target.value)); setSession(''); }}>
            {range(l.minHours, 12).map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </div>
      </div>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="vn-budget">Budget (AED, optional)</label>
          <input id="vn-budget" className="bk-input" inputMode="decimal" placeholder="e.g. 15,000" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="vn-guests">Guests (max {cap})</label>
          <input id="vn-guests" type="number" className="bk-input" min={1} max={cap} value={guests}
            onChange={(e) => setGuests(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </div>
      </div>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="vn-layout">Layout</label>
          <select id="vn-layout" className="bk-input" value={layout} onChange={(e) => setLayout(e.target.value as VenueLayout)}>
            {layouts.map((k) => <option key={k} value={k}>{LAYOUT_LABEL[k]} · up to {l.capacity[k]}</option>)}
          </select>
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="vn-type">Event type</label>
          <select id="vn-type" className="bk-input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      {budget && bud == null && <div className="bk-err" role="alert">Budget: enter an amount in AED</div>}
      {(l.packages ?? []).length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0' }}>
          <legend className="bk-label">Catering packages (per guest)</legend>
          {(l.packages ?? []).map((p) => (
            <label key={p.id} className="bk-check" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={packageIds.includes(p.id)} onChange={(e) => setPackageIds((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))} />
              <span>{p.label} <small style={{ display: 'inline' }}>· {formatAED(p.perGuestFils)} per guest</small></span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="bk-check">
        <input type="checkbox" checked={catering} onChange={(e) => setCatering(e.target.checked)} />
        <span>Catering needed<small>{l.minSpendFils != null ? 'In-house catering counts towards the minimum spend.' : 'The venue will include catering options in its quote.'}</small></span>
      </label>
      <div className="bk-field">
        <label className="bk-label" htmlFor="vn-msg">About your event (optional)</label>
        <textarea id="vn-msg" className="bk-input" value={message} placeholder="Timings, AV, dietary needs…" onChange={(e) => setMessage(e.target.value)} />
      </div>

      {problem ? <div className="bk-err" role="alert">{problem}</div> : (
        <PriceLines lines={q.lineItems} totalFils={q.totalFils} direct={direct} extra={
          <div className="ln hold"><span>{direct ? `Deposit ${l.holdingDepositPct}% — paid to the venue directly once confirmed` : `Holding deposit ${l.holdingDepositPct}% — due once the venue confirms`}</span><span>{formatAED(deposit)}</span></div>
        } />
      )}

      <ContactFields idPrefix="vn" value={contact} onChange={setContact} />
      {err && <div className="bk-err" role="alert">{err}</div>}
      <div className="bk-btns">
        <button type="button" className="bk-btn primary block" disabled={!!q.error || busy}
          onClick={() => submit('enquiry', draft, contact)}>Request a quote</button>
        <div className="bk-note" style={{ marginTop: 0 }}>
          Free, no date held. The venue typically replies within {l.responseHours}h{direct ? ' and may offer a site visit' : `; quotes stay valid for ${RULES.offerValidHours.venue / 24} days`}.
        </div>
        <button type="button" className="bk-btn secondary block" disabled={!!problem || busy}
          onClick={() => submit(l.instantBook ? 'instant' : 'request', draft, contact)}>
          {l.instantBook ? 'Book now' : 'Request to book'}
        </button>
        <div className="bk-note" style={{ marginTop: 0 }}>
          {direct
            ? <>Holds the date while the venue answers (48h). Nothing is charged on UpNow — once they accept, the date is provisional until you pay the deposit to {l.providerName} directly.</>
            : l.instantBook
              ? <>Confirms instantly and pays the {l.holdingDepositPct}% holding deposit now (simulated; in full if the event is under 14 days away). Needs 24h notice.</>
              : <>Holds the date while the venue answers (48h). Nothing is charged until they accept.</>}
        </div>
        <ContactButtons listing={l} draft={q.error ? null : draft} details={draft.details} guests={guests} contact={contact} emailPlaceholder="e.g. Can we bring our own DJ?" />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------- court

function CourtWidget({ l }: { l: CourtListing }) {
  const store = useBookings();
  const now = useNow(60_000);
  const today = dubaiDateStr(now);
  const [date, setDate] = useState(today);
  const [dur, setDur] = useState(l.durations[0]);
  const [courtId, setCourtId] = useState(l.courts[0].id);
  const [sel, setSel] = useState<number | null>(null);
  const [players, setPlayers] = useState(Math.min(4, l.maxPlayers));
  const [split, setSplit] = useState(false);
  const sports = sportsOf(l);
  const [sport, setSport] = useState(sports[0]);
  const [weekly, setWeekly] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [contact, setContact] = useContact();
  const { err, busy, submit } = useSubmit(l);

  const durMs = dur * MIN_MS;
  const dayStart = dubaiInstant(date, 0);
  const slots: { t: number; free: boolean; peak: boolean; fils: number }[] = [];
  if (Number.isFinite(dayStart)) {
    const close = dayStart + l.closeHour * HOUR_MS;
    for (let t = dayStart + l.openHour * HOUR_MS; t + durMs <= close; t += l.slotMinutes * MIN_MS) {
      const peak = isCourtPeak(t);
      const free = t > now && store.isAvailable(l.id, iso(t), iso(t + durMs), courtId);
      slots.push({ t, free, peak, fils: Math.round(((peak ? l.peakPer60Fils : l.offPeakPer60Fils) * dur) / 60) });
    }
  }
  const picked = sel != null && slots.some((x) => x.t === sel && x.free) ? sel : null;
  const splitOn = split && players > 1 && !weekly;
  const draft: Draft | null = picked == null ? null : {
    start: iso(picked), end: iso(picked + durMs), guests: players,
    details: { courtId, players, durationMin: dur, splitPayment: splitOn, sport },
  };
  // Weekly: check every week on its own — taken weeks are skipped (shown before booking).
  const weekPlan = draft && weekly ? Array.from({ length: weeks }, (_, i) => {
    const t = picked as number + i * 7 * 86_400_000;
    return { t, free: store.isAvailable(l.id, iso(t), iso(t + durMs), courtId) };
  }) : [];
  const q = draft ? store.quote({ listingId: l.id, ...draft }) : null;
  const freeCount = slots.filter((x) => x.free).length;
  const reset = () => setSel(null);
  const direct = l.paymentMode === 'direct';

  return (
    <Shell listing={l}>
      {sports.length > 1 && (
        <div className="bk-field">
          <span className="bk-label" id="ct-sport-l">Sport</span>
          <div className="bk-pills" role="group" aria-labelledby="ct-sport-l">
            {sports.map((x) => <button key={x} type="button" aria-pressed={sport === x} onClick={() => setSport(x)}>{x}</button>)}
          </div>
        </div>
      )}
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="ct-date">Date</label>
          <input id="ct-date" type="date" className="bk-input" min={today} max={addDays(today, 14)} value={date}
            onChange={(e) => { setDate(e.target.value); reset(); }} />
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="ct-players">Players</label>
          <select id="ct-players" className="bk-input" value={players} onChange={(e) => setPlayers(Number(e.target.value))}>
            {range(1, l.maxPlayers).map((n) => <option key={n} value={n}>{n} player{n === 1 ? '' : 's'}</option>)}
          </select>
        </div>
      </div>
      <div className="bk-field">
        <span className="bk-label" id="ct-dur-l">Duration</span>
        <div className="bk-pills" role="group" aria-labelledby="ct-dur-l">
          {l.durations.map((d) => (
            <button key={d} type="button" aria-pressed={dur === d} onClick={() => { setDur(d); reset(); }}>{d} min</button>
          ))}
        </div>
      </div>
      <div className="bk-field">
        <span className="bk-label" id="ct-court-l">Court</span>
        <div className="bk-pills" role="group" aria-labelledby="ct-court-l">
          {l.courts.map((c) => (
            <button key={c.id} type="button" aria-pressed={courtId === c.id} onClick={() => { setCourtId(c.id); reset(); }}>
              {c.name} · {c.indoor ? 'Indoor' : 'Outdoor'}
            </button>
          ))}
        </div>
      </div>
      <div className="bk-field">
        <span className="bk-label" id="ct-slot-l">Start time · {l.courts.find((c) => c.id === courtId)?.name}</span>
        {slots.length === 0 || freeCount === 0
          ? <div className="bk-err" role="status">No free slots on this court for that day — try another court or date.</div>
          : (
            <div className="bk-slots" role="group" aria-labelledby="ct-slot-l">
              {slots.map((x) => (
                <button key={x.t} type="button" className={`bk-slot${x.peak ? ' peak' : ''}`} disabled={!x.free}
                  aria-pressed={picked === x.t} onClick={() => setSel(x.t)}
                  aria-label={`${fmtTime(x.t)}, ${x.peak ? 'peak' : 'off-peak'}, ${formatAED(x.fils)}${x.free ? '' : ', unavailable'}`}>
                  {fmtTime(x.t)}<small>{x.free ? formatAED(x.fils).replace('AED ', '') : 'Taken'}</small>
                </button>
              ))}
            </div>
          )}
        <div className="bk-legend"><span><i />Off-peak {formatAED(l.offPeakPer60Fils)}/60 min</span><span><i className="peak" />Peak {formatAED(l.peakPer60Fils)}/60 min (from 16:00 &amp; Fri–Sat)</span><span><i className="off" />Taken</span></div>
      </div>
      <div className="bk-field">
        <span className="bk-label" id="ct-rec-l">Recurring booking</span>
        <div className="bk-pills" role="group" aria-labelledby="ct-rec-l">
          <button type="button" aria-pressed={!weekly} onClick={() => setWeekly(false)}>One-off</button>
          <button type="button" aria-pressed={weekly} onClick={() => setWeekly(true)}>Weekly</button>
        </div>
      </div>
      {weekly && (
        <div className="bk-field">
          <label className="bk-label" htmlFor="ct-weeks">Number of weeks</label>
          <select id="ct-weeks" className="bk-input" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {SERIES_WEEKS.map((n) => <option key={n} value={n}>{n} weeks</option>)}
          </select>
          {weekPlan.length > 0 && (
            <ul className="bk-note left" style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gap: 2 }} aria-label="Weekly availability">
              {weekPlan.map((w, i) => <li key={w.t}>Week {i + 1} · {fmtDayShort(w.t)} {fmtTime(w.t)} — {w.free ? 'free' : 'taken, will be skipped'}</li>)}
            </ul>
          )}
          {!draft && <div className="bk-note left">Pick the first week&apos;s start time — the same court and time are checked for each following week.</div>}
          <div className="bk-note left">Each free week becomes its own booking{direct ? ` that ${l.providerName} confirms` : ' you pay for (simulated)'}; weeks where the court is already taken are skipped.</div>
        </div>
      )}
      {!direct && !weekly && (
        <label className="bk-check">
          <input type="checkbox" checked={splitOn} disabled={players < 2} onChange={(e) => setSplit(e.target.checked)} />
          <span>Split payment with players<small>You pay your share now; the others pay theirs until 2h after the match, then any unpaid share is charged to you.</small></span>
        </label>
      )}

      {q?.error && <div className="bk-err" role="alert">{q.error}</div>}
      {q && !q.error && <PriceLines lines={q.lineItems} totalFils={q.totalFils} direct={direct} extra={direct ? (
        <div className="ln hold"><span>Paid at the venue — nothing is charged on UpNow</span><span>{formatAED(q.totalFils)}</span></div>
      ) : splitOn ? (
        <div className="ln hold"><span>Your share now ({players} players)</span><span>{formatAED(q.totalFils - Math.floor(q.totalFils / players) * (players - 1))}</span></div>
      ) : undefined} />}
      {!q && <div className="bk-note left">Pick a start time to see the price. Prices include VAT.</div>}

      <ContactFields idPrefix="ct" value={contact} onChange={setContact} />
      {err && <div className="bk-err" role="alert">{err}</div>}
      <div className="bk-btns">
        <button type="button" className="bk-btn primary block" disabled={!draft || !!q?.error || busy}
          onClick={() => draft && submit(direct ? 'request' : 'instant', { ...draft, details: { ...draft.details, splitPayment: direct ? false : draft.details.splitPayment } }, contact, weekly ? weeks : 1)}>
          {weekly
            ? `${direct ? 'Request' : 'Book'} ${weekPlan.filter((w) => w.free).length || weeks} weekly slot${(weekPlan.filter((w) => w.free).length || weeks) === 1 ? '' : 's'}`
            : direct ? 'Check slot availability' : <>Book &amp; pay</>}
        </button>
        <div className="bk-note" style={{ marginTop: 0 }}>
          {direct
            ? <>The slot is held while {l.providerName} confirms (within 30 minutes). You pay at the venue — nothing is charged on UpNow.</>
            : <>The court is held for 10 minutes while you pay (simulated). Free cancellation until {l.freeCancelHours}h before.</>}
        </div>
        <ContactButtons listing={l} draft={draft} details={{ courtId, players, sport }} guests={players} contact={contact} emailPlaceholder="e.g. Can we book the same slot every week?" />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------- charter

function CharterWidget({ l }: { l: CharterListing }) {
  const store = useBookings();
  const now = useNow(60_000);
  const today = dubaiDateStr(now);
  const [date, setDate] = useState(() => addDays(today, 7));
  const [time, setTime] = useState('16:00');
  const [hours, setHours] = useState(l.minHours);
  const [guests, setGuests] = useState(Math.min(6, l.capacity));
  const [addOns, setAddOns] = useState<string[]>([]);
  const [occasion, setOccasion] = useState(OCCASIONS[0]);
  const [contact, setContact] = useContact();
  const { err, busy, submit } = useSubmit(l);

  const s = dubaiInstant(date, ...hm(time));
  const draft: Draft = { start: safeIso(s), end: safeIso(s + hours * HOUR_MS), guests, details: { addOnIds: addOns, occasion } };
  const q = store.quote({ listingId: l.id, ...draft });
  const problem = q.error ?? (store.isAvailable(l.id, draft.start, draft.end) ? null : 'The yacht is already booked at that time — try another time');
  const deposit = pctOf(q.totalFils, l.depositPct);
  const direct = l.paymentMode === 'direct';

  return (
    <Shell listing={l}>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="ch-date">Date</label>
          <input id="ch-date" type="date" className="bk-input" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="ch-time">Departure</label>
          <select id="ch-time" className="bk-input" value={time} onChange={(e) => setTime(e.target.value)}>
            {timeOptions(6, 23).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor="ch-hours">Hours</label>
          <select id="ch-hours" className="bk-input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {range(l.minHours, 10).map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor="ch-guests">Guests (max {l.capacity})</label>
          <select id="ch-guests" className="bk-input" value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
            {range(1, l.capacity).map((n) => <option key={n} value={n}>{n} guest{n === 1 ? '' : 's'}</option>)}
          </select>
        </div>
      </div>
      <div className="bk-field">
        <label className="bk-label" htmlFor="ch-occasion">Occasion</label>
        <select id="ch-occasion" className="bk-input" value={occasion} onChange={(e) => setOccasion(e.target.value)}>
          {OCCASIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {l.addOns.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0' }}>
          <legend className="bk-label">Add-ons</legend>
          {l.addOns.map((a) => (
            <label key={a.id} className="bk-check" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={addOns.includes(a.id)}
                onChange={(e) => setAddOns((cur) => (e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id)))} />
              <span>{a.label} <small style={{ display: 'inline' }}>· {formatAED(a.fils)}</small></span>
            </label>
          ))}
        </fieldset>
      )}

      {problem ? <div className="bk-err" role="alert">{problem}</div> : (
        <PriceLines lines={q.lineItems} totalFils={q.totalFils} direct={direct} extra={
          <div className="ln hold"><span>{direct ? `Deposit ${l.depositPct}% to the operator directly once confirmed · balance 48h before departure` : `Deposit ${l.depositPct}% once confirmed · balance 48h before departure`}</span><span>{formatAED(deposit)}</span></div>
        } />
      )}

      <ContactFields idPrefix="ch" value={contact} onChange={setContact} />
      {err && <div className="bk-err" role="alert">{err}</div>}
      <div className="bk-btns">
        <button type="button" className="bk-btn primary block" disabled={!!problem || busy}
          onClick={() => submit(l.instantBook ? 'instant' : 'request', draft, contact)}>
          {direct ? 'Check availability' : l.instantBook ? 'Book now' : 'Request to book'}
        </button>
        <div className="bk-note" style={{ marginTop: 0 }}>
          {direct
            ? <>Nothing is charged on UpNow. {l.providerName} answers within 48h; once accepted the date is provisional until you pay the {l.depositPct}% deposit to them directly.</>
            : l.instantBook
              ? <>Confirms instantly and pays the {l.depositPct}% deposit now (simulated). The security hold is a card hold, released after the trip.</>
              : <>No charge until the {providerNoun('charter')} accepts — they reply within 48h. The security hold is a card hold, not a charge.</>}
        </div>
        <ContactButtons listing={l} draft={q.error ? null : draft} details={draft.details} guests={guests} contact={contact} emailPlaceholder="e.g. Can we bring our own cake?" />
      </div>
    </Shell>
  );
}

export function BookingWidget({ listing }: { listing: PreviewListing }) {
  switch (listing.model) {
    case 'shortstay': return <ShortStayWidget l={listing} />;
    case 'venue': return <VenueWidget l={listing} />;
    case 'court': return <CourtWidget l={listing} />;
    case 'charter': return <CharterWidget l={listing} />;
  }
}
