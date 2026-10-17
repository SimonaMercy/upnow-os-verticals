'use client';
/* eslint-disable @next/next/no-img-element -- small static images from /public/marketspace, same as the marketplace cards */

/**
 * Listing detail for a PREVIEW booking listing (/book/[listingId]): gallery, facts, amenities,
 * rules, cancellation policy, DET permit for holiday homes, and the model-specific booking widget.
 * The listing is read from the store once hydrated, so the provider's payment-model setting
 * (pay on UpNow vs pay the host directly) shows here straight away.
 */
import Link from 'next/link';
import { Anchor, CalendarClock, Check, ChevronRight, Clock, MapPin, ShieldCheck, Users } from 'lucide-react';
import { MODEL_LABEL } from '@/lib/os/bookings/engine';
import { POLICY_LABEL, policySummary } from '@/lib/os/bookings/policies';
import type { PreviewListing } from '@/lib/os/bookings/types';
import { RULES, formatAED, sportsOf } from '@/lib/os/bookings/engine';
import { BookingWidget } from './BookingWidget';
import { MODEL_NOUN, MODEL_PLURAL, maxVenueCapacity } from './format';
import { useHydrated } from './myBookings';
import { useBookings } from '@/lib/os/bookings/store';
import { PaymentModeLine, PreviewNote, PreviewTag, Rating } from './ui';

function Facts({ l }: { l: PreviewListing }) {
  const items: [string, string][] = [];
  switch (l.model) {
    case 'shortstay':
      items.push(['Bedrooms', String(l.bedrooms)], ['Sleeps', `${l.maxGuests} guests`], ['Check-in', `From ${l.checkInTime}`],
        ['Check-out', `By ${l.checkOutTime}`], ['Minimum stay', `${l.minNights} night${l.minNights === 1 ? '' : 's'}`],
        ['Damage deposit', `${formatAED(l.damageDepositFils)} ${l.paymentMode === 'direct' ? 'collected by the host' : 'card hold'}`]);
      if (l.weekendNightlyFils != null) items.push(['Fri / Sat nights', formatAED(l.weekendNightlyFils)]);
      items.push(['Tourism Dirham', `${formatAED(l.tourismDirhamPerBedroomNightFils)} / bedroom / night`]);
      break;
    case 'venue':
      for (const [k, v] of Object.entries(l.capacity)) items.push([`${k[0].toUpperCase()}${k.slice(1)}`, `${v} guests`]);
      items.push(['Minimum booking', `${l.minHours} hours`]);
      if (l.minSpendFils != null) items.push(['F&B minimum spend', formatAED(l.minSpendFils)]);
      if (l.hourlyFils != null) items.push(['Hire per hour', formatAED(l.hourlyFils)]);
      if (l.dayRateFils != null) items.push(['Day rate', formatAED(l.dayRateFils)]);
      if (l.serviceChargePct) items.push(['Service charge', `${l.serviceChargePct}%`]);
      for (const p of l.packages ?? []) items.push([p.label, `${formatAED(p.perGuestFils)} / guest`]);
      items.push(['VAT', `${l.vatPct}%`], ['Holding deposit', `${l.holdingDepositPct}% ${l.paymentMode === 'direct' ? 'paid to the venue' : 'to confirm'}`]);
      break;
    case 'court':
      items.push(['Sport', sportsOf(l).join(' · ')], ['Courts', l.courts.map((c) => `${c.name} (${c.indoor ? 'indoor' : 'outdoor'})`).join(', ')],
        ['Opening hours', l.openHour === 0 && l.closeHour >= 24 ? 'Open 24 hours' : `${String(l.openHour).padStart(2, '0')}:00–${String(l.closeHour).padStart(2, '0')}:00`],
        ['Off-peak', `${formatAED(l.offPeakPer60Fils)} / 60 min`], ['Peak (16:00+, Fri–Sat)', `${formatAED(l.peakPer60Fils)} / 60 min`],
        ['Players', `Up to ${l.maxPlayers}`], ['Durations', l.durations.map((d) => `${d} min`).join(' · ')]);
      break;
    case 'charter':
      items.push(['Length', `${l.lengthFt} ft`], ['Licensed guests', String(l.capacity)], ['Departs from', l.departurePoint],
        ['Per hour', formatAED(l.hourlyFils)], ['Minimum', `${l.minHours} hours`], ['VAT', `${l.vatPct ?? RULES.charterVatPct}% on hire + add-ons`], ['Deposit', `${l.depositPct}% ${l.paymentMode === 'direct' ? 'paid to the operator' : 'to confirm'}`],
        ['Security deposit', `${formatAED(l.securityHoldFils)} ${l.paymentMode === 'direct' ? 'collected by the operator' : 'card hold'}`]);
      break;
  }
  return <div className="bk-facts">{items.map(([k, v]) => <div key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>;
}

function Rules({ l }: { l: PreviewListing }) {
  const rows: string[] = [];
  if (l.model === 'shortstay') {
    rows.push(`Check-in from ${l.checkInTime}, check-out by ${l.checkOutTime}.`,
      'Every guest must be registered with Dubai DET — the host will ask for an ID per guest before arrival.',
      l.paymentMode === 'direct'
        ? `The host may collect a refundable damage deposit of ${formatAED(l.damageDepositFils)} at check-in.`
        : `A damage deposit of ${formatAED(l.damageDepositFils)} is held on your card at arrival and released after check-out.`,
      'Tourism Dirham is a government fee charged per bedroom per night.');
  } else if (l.model === 'venue') {
    rows.push('Final guest numbers are due 7 days before the event.', 'The balance is due 14 days before the event.');
    if (l.permitNote) rows.push(`${l.permitNote}.`);
  } else if (l.model === 'court') {
    rows.push('Check in at reception up to 60 minutes before your slot.', 'No check-in within 15 minutes of the start counts as a no-show and is charged in full.',
      'Prices include 5% VAT.');
    if (l.paymentMode === 'direct') rows.push('You pay at the venue — nothing is charged on UpNow.');
    else if (!l.payAtVenueAllowed) rows.push('Online payment only — pay at venue is not available.');
  } else {
    rows.push('Every guest needs an ID for the Coast Guard manifest, due by 18:00 the day before.',
      'The balance is due 48 hours before departure.', l.paymentMode === 'direct'
        ? 'Trips can be cancelled by the operator for weather or Coast Guard orders — the operator refunds you directly.'
        : 'Trips can be cancelled by the operator for weather or Coast Guard orders — then you get a full refund.');
  }
  return <ul className="bk-list">{rows.map((r) => <li key={r}><Check size={15} color="var(--ms-primary)" aria-hidden /><span>{r}</span></li>)}</ul>;
}

export function ListingDetail({ listing: seed }: { listing: PreviewListing }) {
  const hydrated = useHydrated();
  const store = useBookings();
  const l = (hydrated && store.listings.find((x) => x.id === seed.id)) || seed;
  const [main, ...rest] = l.images;
  return (
    <div className="bk bk-page">
      <div className="wrap">
        <nav className="bk-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link><ChevronRight size={13} aria-hidden />
          <Link href={`/book?model=${l.model}`}>{MODEL_PLURAL[l.model]}</Link><ChevronRight size={13} aria-hidden />
          <span aria-current="page">{l.title}</span>
        </nav>
        <PreviewNote />
        <div className="bk-head" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}><PreviewTag /><span className="bk-label">{MODEL_NOUN[l.model]}</span></div>
          <h1>{l.title}</h1>
          <div className="sub">
            <span><MapPin size={14} aria-hidden /> {l.area}</span>
            <span><ShieldCheck size={14} aria-hidden /> {l.providerName}</span>
            <span className="bk-lcard" style={{ display: 'inline' }}><Rating l={l} /></span>
            <span><Clock size={14} aria-hidden /> Typically replies within {l.responseHours}h</span>
            {l.instantBook && <span><CalendarClock size={14} aria-hidden /> Instant booking</span>}
          </div>
        </div>
        {hydrated && <div style={{ marginTop: 14, maxWidth: 640 }}><PaymentModeLine listing={l} /></div>}
        <div className={`bk-gallery${rest.length ? '' : ' one'}`}>
          <div className="main"><img src={main} alt={l.title} /></div>
          {rest.length > 0 && <div className="side">{rest.slice(0, 2).map((src) => <img key={src} src={src} alt="" />)}</div>}
        </div>

        <div className="bk-layout">
          <div>
            {l.model === 'shortstay' && (
              <section className="bk-section">
                <div className="bk-permit">
                  <ShieldCheck size={22} aria-hidden />
                  <div><small>Dubai DET holiday home permit</small><b>{l.permitNumber}</b></div>
                </div>
              </section>
            )}
            <section className="bk-section">
              <h2>About this {MODEL_NOUN[l.model].toLowerCase()}</h2>
              <p>{l.description}</p>
              <p style={{ marginTop: 8, fontSize: 13 }}>{MODEL_LABEL[l.model]} by <b>{l.providerName}</b>{l.model === 'charter' && <> · <Anchor size={13} aria-hidden style={{ display: 'inline', verticalAlign: -2 }} /> departs {l.departurePoint}</>}
                {l.model === 'venue' && <> · <Users size={13} aria-hidden style={{ display: 'inline', verticalAlign: -2 }} /> up to {maxVenueCapacity(l)} guests</>}</p>
            </section>
            <section className="bk-section"><h2>Key details</h2><Facts l={l} /></section>
            <section className="bk-section">
              <h2>What&apos;s included</h2>
              <ul className="bk-amen">{l.amenities.map((a) => <li key={a}><Check size={14} aria-hidden />{a}</li>)}</ul>
            </section>
            <section className="bk-section"><h2>{l.model === 'shortstay' ? 'House rules & check-in' : 'Things to know'}</h2><Rules l={l} /></section>
            <section className="bk-section">
              <h2>Cancellation policy</h2>
              <p><b>{POLICY_LABEL[l.cancellation]}.</b> {policySummary(l.cancellation, l)}</p>
              {l.paymentMode === 'direct' && <p style={{ marginTop: 6 }}>You pay {l.providerName} directly, so any refund is handled by them under this policy — UpNow holds no money for this booking.</p>}
            </section>
          </div>
          {hydrated ? <BookingWidget listing={l} /> : (
            <aside className="bk-widget" aria-busy="true"><div className="bk-note left">Loading availability…</div></aside>
          )}
        </div>
      </div>
    </div>
  );
}
