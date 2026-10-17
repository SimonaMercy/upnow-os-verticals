'use client';
/* eslint-disable @next/next/no-img-element -- small static images from /public/marketspace, same as the marketplace cards */

/** Small shared pieces of the customer booking UI (scoped styles: ./booking.css under .bk). */
import Link from 'next/link';
import { CreditCard, HandCoins, Info, Star } from 'lucide-react';
import { formatAED, isEnded, journeyIndexOf, journeyOf } from '@/lib/os/bookings/engine';
import type { Booking, LineItem, PaymentMode, PreviewListing } from '@/lib/os/bookings/types';
import { MODEL_NOUN, PREVIEW_NOTE, fromPrice, metaLine } from './format';
import './booking.css';

export function PreviewNote({ text = PREVIEW_NOTE }: { text?: string }) {
  return (
    <div className="bk-preview" role="note">
      <Info size={15} aria-hidden /> <span>{text}</span>
    </div>
  );
}

export function PreviewTag() {
  return <span className="bk-tag" title="Demonstration listing — no real payment is taken">Preview</span>;
}

/** MarketSpace wording for the two payment models. */
export const PAYMENT_LINE: Record<PaymentMode, string> = {
  platform: 'Pay on UpNow — secure card payment, refunds by policy',
  direct: 'Pay the host directly — nothing is charged on UpNow',
};

/** "Pay on UpNow — …" vs "Pay the host directly — nothing is charged on UpNow". */
export function PaymentModeLine({ listing, compact }: { listing: Pick<PreviewListing, 'paymentMode' | 'providerName' | 'model'>; compact?: boolean }) {
  const direct = listing.paymentMode === 'direct';
  const how = direct
    ? listing.model === 'court' ? `${listing.providerName} confirms the slot and you pay at the venue.` : `${listing.providerName} confirms availability and you pay them directly.`
    : 'Your card is charged on UpNow when the booking is confirmed (simulated in this preview).';
  return (
    <div className={`bk-paymode${direct ? ' direct' : ''}${compact ? ' compact' : ''}`} role="note">
      {direct ? <HandCoins size={18} aria-hidden /> : <CreditCard size={18} aria-hidden />}
      <div><b>{PAYMENT_LINE[listing.paymentMode]}</b>{!compact && <small>{how}</small>}</div>
    </div>
  );
}

/** The customer journey stepper (engine journeyOf / journeyIndexOf). */
export function JourneySteps({ booking }: { booking: Booking }) {
  const steps = journeyOf(booking);
  const at = journeyIndexOf(booking);
  const stopped = isEnded(booking.state) && booking.state !== 'closed';
  return (
    <ol className="bk-journey" aria-label="Booking journey">
      {steps.map((s, i) => {
        const cls = i < at ? 'done' : i === at ? (stopped ? 'stop' : 'now') : '';
        const sr = i < at ? 'done' : i === at ? (stopped ? 'stopped here' : 'current step') : 'to come';
        return <li key={s} className={cls} aria-current={i === at && !stopped ? 'step' : undefined}>{s}<span className="sr">, {sr}</span></li>;
      })}
    </ol>
  );
}

/** Price breakdown: charged lines, total, then card holds shown separately (held, not charged). */
export function PriceLines({ lines, totalFils, extra, direct }: { lines: LineItem[]; totalFils: number; extra?: React.ReactNode; direct?: boolean }) {
  const charged = lines.filter((l) => l.kind !== 'deposit_hold');
  const holds = lines.filter((l) => l.kind === 'deposit_hold');
  return (
    <div className="bk-lines" aria-label="Price breakdown">
      {charged.map((l) => (
        <div key={l.key} className={`ln${l.kind === 'discount' ? ' discount' : ''}`}><span>{l.label}</span><span>{formatAED(l.fils)}</span></div>
      ))}
      <div className="ln total"><span>Total</span><span>{formatAED(totalFils)}</span></div>
      {extra}
      {holds.map((l) => (
        <div key={l.key} className="ln hold"><span>{l.label} — <em>{direct ? 'not part of the total' : 'held, not charged'}</em></span><span>{formatAED(l.fils)}</span></div>
      ))}
    </div>
  );
}

export interface Contact { name: string; phone: string; email: string }

export function ContactFields({ value, onChange, idPrefix }: { value: Contact; onChange: (c: Contact) => void; idPrefix: string }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="bk-label" style={{ marginTop: 14 }}>Your details</legend>
      <div className="bk-field">
        <label className="bk-label" htmlFor={`${idPrefix}-name`}>Full name</label>
        <input id={`${idPrefix}-name`} className="bk-input" autoComplete="name" value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </div>
      <div className="bk-row2">
        <div className="bk-field">
          <label className="bk-label" htmlFor={`${idPrefix}-phone`}>Mobile</label>
          <input id={`${idPrefix}-phone`} className="bk-input" type="tel" autoComplete="tel" placeholder="+971 5x xxx xxxx" value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor={`${idPrefix}-email`}>Email</label>
          <input id={`${idPrefix}-email`} className="bk-input" type="email" autoComplete="email" value={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.value })} />
        </div>
      </div>
    </fieldset>
  );
}

export function contactError(c: Contact): string | null {
  if (!c.name.trim()) return 'Enter your name';
  if (!c.phone.trim() && !c.email.trim()) return 'Enter a mobile number or email so the provider can reach you';
  if (c.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return 'Check the email address';
  return null;
}

export function Rating({ l }: { l: PreviewListing }) {
  return l.rating == null
    ? <span className="star">New</span>
    : <span className="star"><Star size={13} fill="currentColor" aria-hidden /> {l.rating.toFixed(2)} <small>({l.reviewCount})</small></span>;
}

export function ListingCard({ l }: { l: PreviewListing }) {
  const p = fromPrice(l);
  return (
    <Link href={`/book/${l.id}`} className="bk-lcard">
      <div className="media">
        <img src={l.images[0]} alt="" loading="lazy" />
        <PreviewTag />
      </div>
      <div className="t">{l.title}</div>
      <div className="m">{MODEL_NOUN[l.model]} · {metaLine(l)}</div>
      <div className="m">{l.paymentMode === 'direct' ? (l.model === 'court' ? 'Pay at the venue' : 'Pay the host directly') : 'Pay on UpNow'}</div>
      <div className="r"><span><b>{p.price}</b> <small>{p.per}</small></span><Rating l={l} /></div>
    </Link>
  );
}
