'use client';
/* eslint-disable @next/next/no-img-element -- small static images from /public/marketspace, same as the marketplace cards */

/**
 * One PREVIEW booking, customer side — used by /book/confirmation/[bookingId] and
 * /dashboard/customer/bookings/[id]. Shows what happens next (with the live timer), the
 * actions the engine allows right now (nextActions — rendered exactly as returned), the
 * receipt, payment schedule, tasks, messages and the event timeline, plus the journey stepper
 * (engine journeyOf / journeyIndexOf).
 *
 * Direct-pay bookings (paymentMode 'direct'): no pay buttons — a confirmed booking says "Pay
 * AED X directly to <provider> by <date>" (or "at the venue"); payments show as due until the
 * provider marks them received; the cancel dialog says refunds are handled by the host. Direct
 * venues / yachts are "Provisional — pay the deposit to <provider> by <date>" until the provider
 * records it.
 *
 * Loops: "Decline offer" (back to the conversation), "Request new dates / a different slot"
 * (free until the policy's free-cancellation cutoff; re-priced live), answering the provider's
 * date proposal, messaging until the booking is closed, and "Pay all weeks" for a weekly court
 * series paid on UpNow.
 */
import Link from 'next/link';
import { useRef, useState } from 'react';
import { CheckCircle2, Circle, Clock, Star } from 'lucide-react';
import { Modal, Pill, type Tone } from '@/components/os/kit';
import { useBookings, useNow } from '@/lib/os/bookings/store';
import {
  METHOD_LABEL, MODEL_LABEL, STATE_TONE, customerStateLabel, datesText, depositHoldFils, depositStatus, dueFils, findConflicts, formatAED, isDirect, mergeDates, ms,
  netPaidFils, nextActions, priceFor, timerOf, type ActionOption, type BookingTimer,
} from '@/lib/os/bookings/engine';
import { POLICY_LABEL, freeChangeCutoff, policySummary } from '@/lib/os/bookings/policies';
import { DatesFields, defaultDates, type DatesValue } from './DatesFields';
import type { Booking, CustomerAction, PaymentRecord, PreviewListing } from '@/lib/os/bookings/types';
import { TIMER_TONE, fmtCountdown, fmtDateTime, fmtDay, providerNoun, whenLabel } from './format';
import { JourneySteps, PriceLines } from './ui';

const PAY_TONE: Record<PaymentRecord['status'], Tone> = { due: 'amber', paid: 'primary', refunded: 'info', waived: 'neutral', failed: 'danger' };
const PAY_LABEL: Record<PaymentRecord['status'], string> = { due: 'Due', paid: 'Paid', refunded: 'Refunded', waived: 'Not charged', failed: 'Failed' };

function whoseText(t: BookingTimer, noun: string): string {
  return t.whose === 'customer' ? 'Your turn' : t.whose === 'provider' ? `Waiting on the ${noun}` : '';
}

export function TimerPill({ b, now }: { b: Booking; now: number }) {
  const t = timerOf(b, now, 'customer');
  if (!t) return null;
  const who = whoseText(t, providerNoun(b.model));
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <Pill tone={TIMER_TONE[t.tone]} dot={false}><Clock size={11} aria-hidden /> {t.label}</Pill>
      {who && <span className="bk-whose">{who}</span>}
    </span>
  );
}

interface Step { tone: 'primary' | 'amber' | 'danger' | 'neutral'; eyebrow: string; title: string; text: React.ReactNode; countdown?: number }

/** Direct mode: "Pay AED X directly to <provider> by <date>" / "at the venue". */
function payDirectText(b: Booking, l: PreviewListing): string | null {
  const due = b.payments.filter((p) => p.status === 'due').sort((x, y) => ms(x.dueAt ?? b.start) - ms(y.dueAt ?? b.start));
  if (!due.length) return null;
  const p = due[0];
  if (p.method === 'pay_at_venue') return `Pay ${formatAED(p.fils)} at the venue when you arrive — nothing is charged on UpNow.`;
  const rest = due.slice(1).reduce((t, x) => t + x.fils, 0);
  return `Pay ${formatAED(p.fils)} (${p.label.toLowerCase()}) directly to ${l.providerName}${p.dueAt ? ` by ${fmtDateTime(p.dueAt)}` : ''}${rest ? `, then ${formatAED(rest)} later` : ''} — nothing is charged on UpNow.`;
}

function nextStepDirect(b: Booking, l: PreviewListing): Step | null {
  const noun = providerNoun(b.model);
  const pay = payDirectText(b, l);
  switch (b.state) {
    case 'enquiry':
      return { tone: 'primary', eyebrow: 'Enquiry sent', title: `Your enquiry is with ${l.providerName}`,
        text: <>They typically reply within {l.responseHours}h{b.model === 'venue' ? ' with a quote' : ''}. Nothing is charged on UpNow — you pay the {noun} directly once they confirm.</> };
    case 'requested':
      return { tone: 'primary', eyebrow: 'Request sent', title: b.respondBy ? `${l.providerName} confirms by ${fmtDateTime(b.respondBy)}` : `Waiting for ${l.providerName}`,
        text: <>Your {b.model === 'shortstay' ? 'dates are' : b.model === 'court' ? 'slot is' : 'date is'} held while they check. Nothing is charged on UpNow — once confirmed you pay {b.model === 'court' ? 'at the venue' : `${l.providerName} directly`}.</> };
    case 'offer_sent':
      return { tone: 'amber', eyebrow: b.model === 'shortstay' ? 'Offer received' : 'Quote received', title: 'Review and accept to confirm',
        text: <>{l.providerName} sent the price below{b.offerExpiresAt ? <> — it expires {fmtDateTime(b.offerExpiresAt)}</> : null}. Accepting confirms the booking; you then pay the {noun} directly.</> };
    case 'provisional': {
      const visit = b.tasks.find((t) => t.key === 'site_visit' && !t.done);
      const gate = b.payments.find((p) => p.status === 'due' && (p.id.endsWith('-dep') || p.id.endsWith('-full')));
      return { tone: 'amber', eyebrow: 'Provisional', title: `Provisional — pay the deposit to ${l.providerName}${b.releaseAt ? ` by ${fmtDateTime(b.releaseAt)}` : ''}`,
        text: <>{l.providerName} is holding your date. Pay {gate ? <>the {gate.label.toLowerCase()} ({formatAED(gate.fils)})</> : 'the deposit'} to them directly — nothing is charged on UpNow. They confirm the booking once they receive it; if it isn&apos;t paid by then, the date is released.{visit?.dueAt ? <> Site visit: {fmtDateTime(visit.dueAt)}.</> : null}</> };
    }
    case 'confirmed': {
      const visit = b.tasks.find((t) => t.key === 'site_visit' && !t.done);
      return { tone: pay ? 'amber' : 'primary', eyebrow: `${l.providerName} confirmed`, title: pay ? 'Pay the provider directly' : 'You’re booked — paid to the provider',
        text: <>{pay ?? `${l.providerName} has marked your payment as received.`}{visit?.dueAt ? <> Site visit: {fmtDateTime(visit.dueAt)}.</> : null}{' '}
          {b.model === 'shortstay' ? 'Upload an ID for every guest so the host can register you with DET.' : b.model === 'charter' ? 'Send an ID for every guest for the Coast Guard manifest by 18:00 the day before.' : ''}</> };
    }
    case 'completed':
      if (pay) return { tone: 'amber', eyebrow: 'Completed', title: 'Settle up with the provider', text: <>{pay} Message them below if anything is unclear.{b.review ? '' : ' Then leave a review within 14 days.'}</> };
      return null;
    case 'cancelled_by_customer':
    case 'cancelled_by_provider':
      return { tone: 'danger', eyebrow: 'Cancelled', title: b.state === 'cancelled_by_customer' ? 'You cancelled this booking' : `${l.providerName} cancelled this booking`,
        text: <>{netPaidFils(b) > 0 ? `You paid ${formatAED(netPaidFils(b))} to ${l.providerName} directly — any refund comes from them under their policy.` : 'Nothing was paid, nothing is charged on UpNow.'}</> };
    case 'no_show':
      return { tone: 'danger', eyebrow: 'No-show', title: 'Marked as a no-show', text: <>Any charge is between you and {l.providerName} under their policy.</> };
    default:
      return null;
  }
}

function lostText(b: Booking, l: PreviewListing): Step {
  const why = [...b.events].reverse().find((e) => e.type === 'lost')?.text.replace(/^(Marked lost|Hold released) — /, '') ?? '';
  return { tone: 'neutral', eyebrow: 'Closed', title: `${l.providerName} closed this ${b.events.some((e) => e.type === 'provisional') ? 'booking' : 'enquiry'}`,
    text: <>{why ? `${why.charAt(0).toUpperCase()}${why.slice(1)}. ` : ''}Nothing was charged on UpNow. You can send a new enquiry any time.</> };
}

function nextStep(b: Booking, l: PreviewListing, now: number): Step {
  const noun = providerNoun(b.model);
  const due = b.payments.filter((p) => p.status === 'due');
  if (b.state === 'lost') return lostText(b, l);
  if (isDirect(b)) {
    const d = nextStepDirect(b, l);
    if (d) return d;
  }
  switch (b.state) {
    case 'enquiry':
      return { tone: 'primary', eyebrow: 'Message sent', title: `Your question is with the ${noun}`,
        text: <>{l.providerName} typically replies within {l.responseHours}h. Nothing is held or charged yet — the {noun} may reply with {b.model === 'shortstay' ? 'a special offer' : b.model === 'court' ? 'a slot' : 'a quote'} you can accept, or confirm it for you.</> };
    case 'requested':
      return { tone: 'primary', eyebrow: 'Request sent', title: b.respondBy ? `The ${noun} must reply by ${fmtDateTime(b.respondBy)}` : `Waiting for the ${noun}`,
        text: <>Your {b.model === 'shortstay' ? 'dates are' : 'date is'} held while {l.providerName} decides. You won&apos;t be charged until they accept; if they don&apos;t reply in time the request expires at no cost.</> };
    case 'offer_sent':
      return { tone: 'amber', eyebrow: b.offerHolds ? 'Counter-offer' : b.model === 'venue' || b.model === 'charter' ? 'Quote received' : 'Offer received', title: 'Review and accept to continue',
        text: <>{b.offerHolds ? <>{l.providerName} suggested {datesText(b.model, b.start, b.end)} instead — those dates are held for you. </> : null}The price below is what {l.providerName} offered{b.offerExpiresAt ? <> — it expires {fmtDateTime(b.offerExpiresAt)}</> : null}. Accepting {b.model === 'venue' ? 'holds the date as a provisional option' : b.model === 'court' ? 'holds the court for 10 minutes while you pay' : 'asks you to pay within 24h'}; declining keeps the conversation open.</> };
    case 'held':
      if (b.model === 'court') {
        return { tone: 'amber', eyebrow: 'Court held', title: 'Pay now to confirm your slot',
          text: <>The slot is reserved for you for 10 minutes. If it isn&apos;t paid in time it is released to other players.</>,
          countdown: b.holdExpiresAt ? ms(b.holdExpiresAt) - now : undefined };
      }
      return { tone: 'amber', eyebrow: 'Provisional option', title: 'Your date is held',
        text: <>The venue will confirm the option and request the holding deposit{b.holdExpiresAt ? <>. The option lapses {fmtDateTime(b.holdExpiresAt)}</> : null}.{due.length ? ' You can also pay the deposit now.' : ''}</> };
    case 'awaiting_payment':
      if (b.model === 'court') {
        return { tone: 'primary', eyebrow: 'Court booked', title: 'Waiting for the other players’ shares',
          text: <>Other players can pay their shares until {b.payBy ? fmtDateTime(b.payBy) : '2h after the match'}. Any unpaid share is then charged to you. You can pay a share for them below.</> };
      }
      return { tone: 'amber', eyebrow: b.events.some((e) => e.type === 'awaiting_payment' && e.text.startsWith('Confirmed by the provider')) ? 'Confirmed by the provider' : 'Accepted', title: 'Pay to confirm your booking',
        text: <>{l.providerName} accepted. Pay {due[0] ? formatAED(due[0].fils) : 'the amount due'}{b.payBy ? <> by {fmtDateTime(b.payBy)}</> : null} or the booking is released.</> };
    case 'confirmed': {
      const what = {
        shortstay: l.model === 'shortstay' ? `Check-in ${fmtDay(b.start)} from ${l.checkInTime}. Upload an ID for every guest so the host can register you with DET.` : '',
        venue: `Your event is on ${fmtDay(b.start)}. Final guest numbers are due 7 days before; the balance 14 days before.`,
        court: `Check in at reception up to 60 minutes before ${fmtDateTime(b.start)}. Free cancellation until ${l.model === 'court' ? l.freeCancelHours : 24}h before.`,
        charter: `Departure ${fmtDateTime(b.start)}${l.model === 'charter' ? ` from ${l.departurePoint}` : ''}. Send an ID for every guest for the Coast Guard manifest by 18:00 the day before.`,
      }[b.model];
      return { tone: 'primary', eyebrow: 'Confirmed', title: 'You’re booked', text: what };
    }
    case 'checked_in':
    case 'in_progress':
      return { tone: 'primary', eyebrow: 'Under way', title: { shortstay: 'Enjoy your stay', venue: 'Enjoy your event', court: 'Enjoy the match', charter: 'Enjoy the trip' }[b.model], text: <>Message the {noun} below if you need anything.</> };
    case 'completed':
      return { tone: 'primary', eyebrow: 'Completed', title: b.review ? 'Thanks for your review' : 'How was it?',
        text: b.review ? <>You rated it {b.review.rating}/5.</> : <>Leave a review within 14 days to help other customers.</> };
    case 'declined':
      return { tone: 'danger', eyebrow: 'Declined', title: `The ${noun} declined this request`, text: <>Nothing was charged. Try other dates or another listing.</> };
    case 'expired':
      return { tone: 'neutral', eyebrow: 'Expired', title: 'This booking expired', text: <>{b.events.at(-1)?.text ?? 'A deadline passed.'} Nothing more is charged.</> };
    case 'cancelled_by_customer':
    case 'cancelled_by_provider':
      return { tone: 'danger', eyebrow: 'Cancelled', title: b.state === 'cancelled_by_customer' ? 'You cancelled this booking' : `The ${noun} cancelled this booking`,
        text: <>Any refund is shown in the payments below.</> };
    case 'no_show':
      return { tone: 'danger', eyebrow: 'No-show', title: 'Marked as a no-show', text: <>The booking was charged in full.</> };
    case 'closed':
      return { tone: 'neutral', eyebrow: 'Closed', title: 'This booking is closed', text: <>The review and deposit windows have finished.</> };
    case 'provisional':
      return { tone: 'amber', eyebrow: 'Provisional', title: `Pay the deposit to ${l.providerName}`, text: <>Your date is held until {b.releaseAt ? fmtDateTime(b.releaseAt) : 'the release date'}.</> };
  }
}

function actionLabel(o: ActionOption<CustomerAction>, b: Booking): string {
  if (o.action === 'pay' && o.payload?.type === 'pay') {
    const pid = o.payload.paymentId;
    const p = b.payments.find((x) => x.id === pid);
    if (p) return `Pay ${formatAED(p.fils)} — ${p.label} (simulated)`;
  }
  return o.label;
}

export function BookingPanel({ booking: b, listing: l }: { booking: Booking; listing: PreviewListing }) {
  const store = useBookings();
  const now = useNow(1000);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [msg, setMsg] = useState('');
  const [changeOpen, setChangeOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);

  const step = nextStep(b, l, now);
  const timer = timerOf(b, now, 'customer');
  const direct = isDirect(b);
  const actions = nextActions(b, 'customer', l, now);
  const canMessage = actions.some((a) => a.action === 'message');
  const cancelOpt = actions.find((a) => a.action === 'cancel');
  const refund = cancelOpen ? store.refundQuote(b.id) : null;
  const noun = providerNoun(b.model);

  const run = (a: CustomerAction, done: string) => {
    const r = store.customerAct(b.id, a);
    if (r.error) { setErr(r.error); setOk(null); return false; }
    setErr(null); setOk(done);
    return true;
  };
  const onAction = (o: ActionOption<CustomerAction>) => {
    if (o.action === 'cancel') { setCancelOpen(true); return; }
    if (o.needs === 'text') { composer.current?.focus(); composer.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (o.needs === 'review') { setReviewOpen(true); return; }
    if (o.needs === 'change') { setChangeOpen(true); return; }
    if (!o.payload) return;
    const done = o.action === 'pay' ? 'Payment recorded (simulated — no real money moved).'
      : o.action === 'accept_offer' ? 'Accepted.' : o.action === 'decline_offer' ? `Offer declined — your conversation with the ${noun} stays open.`
        : o.action === 'accept_change' ? 'New dates accepted.' : o.action === 'decline_change' ? 'Done — the booking stays as it was.'
          : o.action === 'provide_ids' ? 'Guest IDs marked as provided.' : 'Done.';
    run(o.payload, done);
  };

  const messages = b.events.filter((e) => e.type === 'message');
  const timeline = b.events.filter((e) => e.type !== 'message');
  const hold = depositHoldFils(b);
  const dep = depositStatus(b);
  const needsIds = (b.model === 'shortstay' || b.model === 'charter') && b.events.some((e) => e.type === 'confirmed' || e.type === 'awaiting_payment');

  return (
    <div className="bk-split">
      <div>
        <section className={`bk-next ${step.tone}`} aria-live="polite">
          <div className="ey">{step.eyebrow} · {b.id}</div>
          <h2>{step.title}</h2>
          <p>{step.text}</p>
          {step.countdown != null ? (
            <div className={`clock ${step.countdown < 3 * 60_000 ? 'bad' : 'warn'}`} role="timer" aria-label="Time left to pay">
              <Clock size={18} aria-hidden /> <span className="big">{fmtCountdown(step.countdown)}</span> left to pay
            </div>
          ) : timer && (
            <div className={`clock ${timer.tone}`} role="timer">
              <Clock size={16} aria-hidden /> {timer.label}{whoseText(timer, noun) && <span className="bk-whose" style={{ fontWeight: 600 }}> · {whoseText(timer, noun)}</span>}
            </div>
          )}
          {actions.filter((a) => a.action !== 'message').length > 0 && (
            <div className="bk-actions" style={{ marginTop: 14 }}>
              {actions.filter((a) => a.action !== 'message').map((o) => (
                <button key={`${o.action}-${o.payload && 'paymentId' in o.payload ? o.payload.paymentId : ''}`} type="button"
                  className={`bk-btn ${o.variant}`} onClick={() => onAction(o)}>{actionLabel(o, b)}</button>
              ))}
            </div>
          )}
          {err && <div className="bk-err" role="alert">{err}</div>}
          {ok && <div className="bk-ok" role="status">{ok}</div>}
          <JourneySteps booking={b} />
        </section>

        {b.pendingChange && (
          <section className="bk-card" style={{ marginTop: 14 }} aria-label="Date change">
            <h3>{b.pendingChange.by === 'customer' ? 'Your date change request' : `${l.providerName} proposed new ${b.model === 'court' ? 'slot' : 'dates'}`}</h3>
            <div className="bk-lines">
              <div className="ln"><span>Now</span><span>{datesText(b.model, b.start, b.end)}</span></div>
              <div className="ln"><span>{b.pendingChange.by === 'customer' ? 'Requested' : 'Proposed'}</span><span>{datesText(b.model, b.pendingChange.start, b.pendingChange.end)}</span></div>
              <div className="ln total"><span>New total</span><span>{formatAED(b.pendingChange.totalFils)}</span></div>
            </div>
            {b.pendingChange.note && <p className="bk-note left">“{b.pendingChange.note}”</p>}
            <p className="bk-note left">{b.pendingChange.by === 'customer' ? `Waiting for ${l.providerName}` : 'Answer above'} — lapses {fmtDateTime(b.pendingChange.expiresAt)}. Until then your booking stays exactly as it is.</p>
          </section>
        )}

        {changeOpen && <ChangeRequest b={b} l={l} now={now} onClose={() => setChangeOpen(false)} onDone={(m) => { setOk(m); setErr(null); setChangeOpen(false); }} />}

        <SeriesCard b={b} l={l} now={now} onResult={(e, m) => { setErr(e); setOk(m); }} />

        {reviewOpen && !b.review && (
          <section className="bk-card" style={{ marginTop: 14 }} aria-label="Leave a review">
            <h3>Leave a review</h3>
            <div className="bk-stars" role="group" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-pressed={rating === n} onClick={() => setRating(n)}>
                  <Star size={13} fill={n <= rating ? 'currentColor' : 'none'} aria-hidden /> {n} star{n === 1 ? '' : 's'}
                </button>
              ))}
            </div>
            <div className="bk-field">
              <label className="bk-label" htmlFor={`rv-${b.id}`}>Your review</label>
              <textarea id={`rv-${b.id}`} className="bk-input" value={reviewText} onChange={(e) => setReviewText(e.target.value)} placeholder="What went well? What could be better?" />
            </div>
            <div className="bk-actions" style={{ marginTop: 10 }}>
              <button type="button" className="bk-btn primary sm" onClick={() => { if (run({ type: 'review', rating, text: reviewText }, 'Thanks — your review is posted.')) setReviewOpen(false); }}>Submit review</button>
              <button type="button" className="bk-btn secondary sm" onClick={() => setReviewOpen(false)}>Cancel</button>
            </div>
          </section>
        )}
        {b.review && (
          <section className="bk-card" style={{ marginTop: 14 }}>
            <h3>Your review</h3>
            <p><b>{b.review.rating}/5</b>{b.review.text ? ` — ${b.review.text}` : ''}</p>
          </section>
        )}

        <section className="bk-card" style={{ marginTop: 14 }}>
          <h3>Messages with the {noun}</h3>
          {messages.length === 0 && <p className="bk-note left" style={{ marginTop: 0 }}>No messages yet.</p>}
          {messages.length > 0 && (
            <div className="bk-thread">
              {messages.map((m, i) => (
                <div key={i} className={`bk-msg${m.actor === 'customer' ? ' me' : ''}`}>
                  {m.text}<small>{m.actor === 'customer' ? 'You' : l.providerName} · {fmtDateTime(m.at)}</small>
                </div>
              ))}
            </div>
          )}
          {canMessage ? (
            <form onSubmit={(e) => { e.preventDefault(); if (run({ type: 'message', text: msg }, 'Message sent.')) setMsg(''); }}>
              <label className="bk-label" htmlFor={`msg-${b.id}`}>Write a message</label>
              <textarea ref={composer} id={`msg-${b.id}`} className="bk-input" style={{ marginTop: 4 }} value={msg} onChange={(e) => setMsg(e.target.value)} />
              <div className="bk-actions" style={{ marginTop: 8 }}>
                <button type="submit" className="bk-btn secondary sm" disabled={!msg.trim()}>Send message</button>
              </div>
            </form>
          ) : <p className="bk-note left">Messaging is closed for this booking.</p>}
        </section>

        <section className="bk-card" style={{ marginTop: 14 }}>
          <h3>Timeline</h3>
          <ol className="bk-tl">
            {timeline.map((e, i) => (
              <li key={i} className={e.actor === 'system' ? 'sys' : ''}>
                {e.text}<small>{fmtDateTime(e.at)} · {e.actor === 'customer' ? 'You' : e.actor === 'provider' ? l.providerName : 'UpNow'}</small>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div>
        <section className="bk-card">
          <div className="bk-summary">
            <img src={l.images[0]} alt="" />
            <div style={{ minWidth: 0 }}>
              <Link href={`/book/${l.id}`} className="t" style={{ display: 'block' }}>{l.title}</Link>
              <div className="m">{MODEL_LABEL[b.model]} · {l.providerName}</div>
              <div className="m">{whenLabel(b, l)} · {b.guests} {b.model === 'court' ? 'player' : 'guest'}{b.guests === 1 ? '' : 's'}</div>
              <div className="pills"><Pill tone={STATE_TONE[b.state]}>{customerStateLabel(b.model, b.state)}</Pill><TimerPill b={b} now={now} /></div>
            </div>
          </div>
          <PriceLines lines={b.lineItems} totalFils={b.totalFils} direct={direct} />
          {hold > 0 && dep !== 'none' && <p className="bk-note left">Deposit hold: {dep === 'held' ? 'on your card, not charged' : dep === 'released' ? 'released' : 'partly claimed — see payments'}.</p>}
          {hold > 0 && direct && <p className="bk-note left">Any deposit is collected and returned by {l.providerName} — UpNow holds nothing.</p>}
          <p className="bk-note left" style={{ fontWeight: 700 }}>{direct ? `Paid to ${l.providerName} directly — nothing is charged on UpNow` : 'Paid on UpNow — secure card payment, refunds by policy'}</p>
        </section>

        <section className="bk-card">
          <h3>Payments</h3>
          {b.payments.length === 0 ? <p className="bk-note left" style={{ marginTop: 0 }}>Nothing to pay yet{b.state === 'enquiry' || b.state === 'requested' ? ` — the ${noun} has to accept first` : ''}.</p> : (
            <table className="bk-pay">
              <thead><tr><th>Payment</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {b.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}<small style={{ display: 'block', color: 'var(--ms-ink-3)', fontSize: 11.5 }}>
                      {p.status === 'paid' || p.status === 'refunded' ? `${p.paidAt ? fmtDateTime(p.paidAt) : ''}${direct && p.method ? ` · ${METHOD_LABEL[p.method]}` : ''}` : p.dueAt ? `Due ${fmtDateTime(p.dueAt)}` : ''}</small></td>
                    <td><Pill tone={PAY_TONE[p.status]} dot={false}>{direct && p.status === 'paid' ? 'Received' : direct && p.status === 'due' ? 'Pay directly' : PAY_LABEL[p.status]}</Pill></td>
                    <td className="amt">{p.status === 'refunded' ? '−' : ''}{formatAED(p.fils)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {b.payments.length > 0 && (
            <div className="bk-lines" style={{ marginTop: 6 }}>
              <div className="ln"><span>Paid (net of refunds)</span><span>{formatAED(netPaidFils(b))}</span></div>
              <div className="ln"><span>Still due</span><span>{formatAED(dueFils(b))}</span></div>
            </div>
          )}
          <p className="bk-note left">{direct
            ? `You pay ${l.providerName} directly (${b.model === 'court' ? 'at the venue' : 'cash, card or bank transfer — as agreed with them'}). They mark each payment received; there is nothing to pay in UpNow.`
            : 'Payments in this preview are simulated — no card is charged.'}</p>
        </section>

        {(needsIds || b.tasks.length > 0) && (
          <section className="bk-card">
            <h3>Tasks</h3>
            <ul className="bk-list">
              {needsIds && (
                <li>{b.customer.idProvided ? <CheckCircle2 size={16} color="var(--ms-primary)" aria-hidden /> : <Circle size={16} color="var(--ms-amber)" aria-hidden />}
                  <span>{b.model === 'shortstay' ? 'Provide guest IDs for DET registration' : 'Provide guest IDs for the Coast Guard manifest'}
                    <small>You · {b.customer.idProvided ? 'done' : 'to do'}</small></span></li>
              )}
              {b.tasks.map((t) => (
                <li key={t.key}>{t.done ? <CheckCircle2 size={16} color="var(--ms-primary)" aria-hidden /> : <Circle size={16} color="var(--ms-ink-3)" aria-hidden />}
                  <span>{t.label}<small>{l.providerName} · {t.done ? 'done' : t.dueAt ? `due ${fmtDateTime(t.dueAt)}` : 'to do'}</small></span></li>
              ))}
            </ul>
          </section>
        )}

        <section className="bk-card">
          <h3>Cancellation policy</h3>
          <p style={{ fontSize: 13.5, color: 'var(--ms-ink-2)' }}><b>{POLICY_LABEL[b.cancellation]}.</b> {policySummary(b.cancellation, l)}</p>
          {direct && <p className="bk-note left">Refunds are handled by {l.providerName} under this policy — UpNow holds no money for this booking.</p>}
          <ChangePolicyNote b={b} l={l} />
        </section>
      </div>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={cancelOpt?.label ?? 'Cancel booking'} width={460}
        footer={(
          <div className="bk" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
            <button type="button" className="bk-btn secondary sm" onClick={() => setCancelOpen(false)}>Keep booking</button>
            <button type="button" className="bk-btn solid-danger sm"
              onClick={() => { run({ type: 'cancel' }, b.state === 'requested' ? 'Request withdrawn — nothing was charged.' : 'Booking cancelled.'); setCancelOpen(false); }}>
              Confirm — {cancelOpt?.label ?? 'cancel'}
            </button>
          </div>
        )}>
        <div className="bk">
          {refund && direct ? (
            <>
              <p style={{ marginBottom: 10 }}>{refund.rule}: <b>{POLICY_LABEL[b.cancellation]}</b> — {policySummary(b.cancellation, l)}</p>
              <div className="bk-lines">
                <div className="ln"><span>Paid to {l.providerName} directly</span><span>{formatAED(netPaidFils(b))}</span></div>
                <div className="ln total"><span>Charged or refunded on UpNow</span><span>{formatAED(0)}</span></div>
              </div>
              <p className="bk-note left">{netPaidFils(b) > 0 ? `Ask ${l.providerName} for any refund you are due — they handle it directly.` : 'You have not paid anything yet, so there is nothing to refund.'}</p>
            </>
          ) : refund ? (
            <>
              <p style={{ marginBottom: 10 }}>{refund.rule}.</p>
              <div className="bk-lines">
                <div className="ln"><span>Paid so far</span><span>{formatAED(netPaidFils(b))}</span></div>
                <div className="ln total"><span>You get back</span><span>{formatAED(refund.refundFils)}</span></div>
                <div className="ln"><span>Kept by the {noun}</span><span>{formatAED(refund.keptFils)}</span></div>
              </div>
              <p className="bk-note left">Refunds in this preview are simulated.</p>
            </>
          ) : <p>Nothing has been paid — cancelling is free.</p>}
        </div>
      </Modal>
    </div>
  );
}

/** "Free date changes until …" (the policy's free-cancellation cutoff). */
function ChangePolicyNote({ b, l }: { b: Booking; l: PreviewListing }) {
  if (!['held', 'awaiting_payment', 'provisional', 'confirmed'].includes(b.state)) return null;
  const cut = freeChangeCutoff(b, l);
  return <p className="bk-note left">{cut == null ? `Date changes are at ${l.providerName}'s discretion on this rate — message them.` : `You can request new ${b.model === 'court' ? 'slot details' : 'dates'} until ${fmtDateTime(cut)}; ${l.providerName} accepts or declines.`}</p>;
}

/** Customer: request new dates / a different slot (re-priced live, conflict-checked). */
function ChangeRequest({ b, l, now, onClose, onDone }: { b: Booking; l: PreviewListing; now: number; onClose: () => void; onDone: (msg: string) => void }) {
  const store = useBookings();
  const [v, setV] = useState<DatesValue>(() => defaultDates(l, b, now));
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = mergeDates(b, v);
  const price = priceFor(l, m);
  const discounts = b.lineItems.filter((x) => x.kind === 'discount').reduce((t, x) => t + x.fils, 0);
  const total = price.error ? 0 : price.totalFils + discounts;
  const c = findConflicts({ listingId: b.listingId, start: m.start, end: m.end, courtId: m.details.courtId, excludeBookingId: b.id, now }, store.bookings, store.blocks);
  const taken = c.bookings.length + c.blocks.length > 0;
  const diff = total - b.totalFils;
  return (
    <section className="bk-card" style={{ marginTop: 14 }} aria-label="Request new dates">
      <h3>{b.model === 'court' ? 'Request a different slot' : 'Request new dates'}</h3>
      <p className="bk-note left" style={{ marginTop: 0 }}>Now: {datesText(b.model, b.start, b.end)} · {formatAED(b.totalFils)}</p>
      <DatesFields listing={l} value={v} onChange={setV} idPrefix={`rc-${b.id}`} cls={{ input: 'bk-input', label: 'bk-label', field: 'bk-field', row: 'bk-row2' }} now={now} />
      {price.error ? <div className="bk-err" role="alert">{price.error}</div> : taken ? <div className="bk-err" role="alert">Not available — pick other {b.model === 'court' ? 'times' : 'dates'}.</div> : (
        <div className="bk-lines" style={{ marginTop: 8 }}>
          <div className="ln total"><span>New total</span><span>{formatAED(total)}</span></div>
          <div className="ln"><span>Difference</span><span>{diff === 0 ? 'Same price' : diff > 0 ? `+${formatAED(diff)}` : `−${formatAED(-diff)}`}</span></div>
        </div>
      )}
      <div className="bk-field">
        <label className="bk-label" htmlFor={`rc-note-${b.id}`}>Note to {l.providerName} (optional)</label>
        <textarea id={`rc-note-${b.id}`} className="bk-input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="bk-note left">{l.providerName} accepts or declines within 24h. {isDirect(b) ? 'Any difference is settled with them directly.' : diff > 0 ? 'If accepted, you pay the difference on UpNow.' : diff < 0 ? 'If accepted, the difference is refunded.' : ''}</p>
      {err && <div className="bk-err" role="alert">{err}</div>}
      <div className="bk-actions" style={{ marginTop: 8 }}>
        <button type="button" className="bk-btn primary sm" disabled={!!price.error || taken}
          onClick={() => {
            const r = store.customerAct(b.id, { type: 'request_change', start: m.start, end: m.end, guests: m.guests, details: v.details, note: note.trim() || undefined });
            if (r.error) setErr(r.error); else onDone(`Request sent — ${l.providerName} will accept or decline.`);
          }}>Send request</button>
        <button type="button" className="bk-btn secondary sm" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}

/** Weekly court series: the other weeks, the skipped ones, and "Pay all weeks" (platform). */
function SeriesCard({ b, l, now, onResult }: { b: Booking; l: PreviewListing; now: number; onResult: (err: string | null, ok: string | null) => void }) {
  const store = useBookings();
  const sid = b.details.seriesId;
  if (!sid) return null;
  const siblings = store.bookings.filter((x) => x.details.seriesId === sid).sort((x, y) => (x.details.seriesIndex ?? 0) - (y.details.seriesIndex ?? 0));
  const payable = siblings.map((x) => ({ x, p: nextActions(x, 'customer', l, now).find((o) => o.action === 'pay') })).filter((r) => r.p?.payload?.type === 'pay');
  const total = payable.reduce((t, r) => t + (r.x.payments.find((p) => r.p?.payload?.type === 'pay' && p.id === r.p.payload.paymentId)?.fils ?? 0), 0);
  return (
    <section className="bk-card" style={{ marginTop: 14 }} aria-label="Weekly series">
      <h3>Weekly series — {siblings.length} booking{siblings.length === 1 ? '' : 's'}</h3>
      <ul className="bk-list">
        {siblings.map((x) => (
          <li key={x.id}><span><Link href={`/dashboard/customer/bookings/${x.id}`} style={{ textDecoration: 'underline' }}>Week {x.details.seriesIndex}</Link> · {whenLabel(x, l)}<small>{customerStateLabel(x.model, x.state)}</small></span></li>
        ))}
      </ul>
      {(b.details.seriesSkipped ?? []).length > 0 && <p className="bk-note left">Skipped (court already taken): {(b.details.seriesSkipped ?? []).map((t) => fmtDay(t)).join(', ')}.</p>}
      {payable.length > 1 && (
        <div className="bk-actions" style={{ marginTop: 8 }}>
          <button type="button" className="bk-btn primary sm" onClick={() => {
            for (const r of payable) {
              if (r.p?.payload?.type !== 'pay') continue;
              const res = store.customerAct(r.x.id, r.p.payload);
              if (res.error) { onResult(`Week ${r.x.details.seriesIndex}: ${res.error}`, null); return; }
            }
            onResult(null, `Paid all ${payable.length} weeks (simulated — no real money moved).`);
          }}>Pay all {payable.length} weeks — {formatAED(total)} (simulated)</button>
        </div>
      )}
    </section>
  );
}
