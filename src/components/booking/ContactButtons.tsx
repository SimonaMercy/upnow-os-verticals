'use client';

/**
 * Call / WhatsApp / Email buttons on a PREVIEW listing (MarketSpace components/marketplace/contact.js).
 * A contact becomes a lead in the provider's Demand inbox (with a Call / WhatsApp / Email tag and
 * the 15-minute reply clock) only when the customer tells us who they are — clicks alone are not
 * leads and nothing is invented:
 *   • Call — shows the number straight away ("Call now" tel: / "Copy number"). Nothing is logged.
 *     An optional "Request a call back" form (name + mobile) logs a call lead.
 *   • WhatsApp — opens wa.me with a prefilled message; logged once only when name + mobile are
 *     filled in under "Your details".
 *   • Email — a message form; sending it (name + mobile or email) logs the enquiry.
 * The lead carries the dates / slot the customer picked; with none picked it is an enquiry with
 * no dates (the provider adds them when confirming). Labelled buttons only. Nothing is sent
 * anywhere — the preview store lives in this browser.
 */
import Link from 'next/link';
import { useState } from 'react';
import { Copy, Mail, MessageCircle, Phone } from 'lucide-react';
import { useBookings } from '@/lib/os/bookings/store';
import type { Booking, LeadSource, PreviewListing } from '@/lib/os/bookings/types';
import { fmtDateTime, fmtDayShort, providerNoun } from './format';
import { rememberBooking } from './myBookings';
import { contactError, type Contact } from './ui';

export interface ContactDraft { start: string; end: string; guests: number; details: Booking['details'] }

function draftText(l: PreviewListing, d: ContactDraft | null): string {
  if (!d) return '';
  if (l.model === 'shortstay') return `${fmtDayShort(d.start)} to ${fmtDayShort(d.end)}, ${d.guests} guest${d.guests === 1 ? '' : 's'}`;
  return `${fmtDateTime(d.start)}, ${d.guests} ${l.model === 'court' ? 'player' : 'guest'}${d.guests === 1 ? '' : 's'}`;
}

export function ContactButtons({ listing: l, draft, details, guests, contact, emailPlaceholder }: {
  listing: PreviewListing;
  /** The dates / slot the customer picked — the lead keeps them (null = not picked: the lead has no dates). */
  draft: ContactDraft | null;
  /** Form details to keep on a lead without dates (guests, court, occasion…). */
  details?: Booking['details'];
  guests?: number;
  contact: Contact;
  emailPlaceholder: string;
}) {
  const store = useBookings();
  const [panel, setPanel] = useState<'call' | 'email' | null>(null);
  const [logged, setLogged] = useState<Partial<Record<LeadSource, string>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState('');
  const [cbName, setCbName] = useState<string | null>(null);
  const [cbPhone, setCbPhone] = useState<string | null>(null);
  const [cbWhen, setCbWhen] = useState('As soon as possible');
  const noun = providerNoun(l.model);
  const first = l.providerName.split(' ')[0];
  const when = draftText(l, draft);
  const waMessage = `Hi ${first}, I found "${l.title}" on UpNow.${when ? ` ${when}.` : ''} Is it available?`;
  const digits = l.providerPhone.replace(/[^\d]/g, '');
  const tel = `tel:${l.providerPhone.replace(/\s/g, '')}`;
  const lastId = logged.email ?? logged.whatsapp ?? logged.call;
  const name = cbName ?? contact.name;
  const phone = cbPhone ?? contact.phone;

  const log = (source: LeadSource, message: string, who: { name: string; phone: string; email?: string }): string | null => {
    if (source !== 'email' && logged[source]) return logged[source] as string;
    const base = draft ?? { start: '', end: '', guests: Math.max(1, guests ?? 1), details: { ...(details ?? {}) } };
    const r = store.create({
      listingId: l.id, kind: 'enquiry', source, ...base, details: { ...base.details, message },
      customer: { name: who.name.trim(), phone: who.phone.trim(), email: who.email?.trim() || undefined },
    });
    if (!r.booking) { setErr(r.error ?? 'Could not send'); return null; }
    setErr(null);
    rememberBooking(r.booking.id);
    setLogged((m) => ({ ...m, [source]: r.booking!.id }));
    return r.booking.id;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(l.providerPhone);
      setCopied(true);
    } catch {
      setCopied(false);
      setErr(`Copy did not work in this browser — the number is ${l.providerPhone}`);
    }
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div className="bk-label" style={{ marginBottom: 6 }}>Contact {l.providerName}</div>
      <div className="bk-contact">
        <button type="button" className="bk-btn secondary sm" aria-expanded={panel === 'call'}
          onClick={() => { setPanel(panel === 'call' ? null : 'call'); setCopied(false); setNote(null); }}>
          <Phone size={15} aria-hidden /> Call
        </button>
        <a className="bk-btn secondary sm wa" href={`https://wa.me/${digits}?text=${encodeURIComponent(waMessage)}`} target="_blank" rel="noopener noreferrer"
          onClick={() => {
            if (contact.name.trim() && contact.phone.trim()) { log('whatsapp', waMessage, contact); setNote(null); }
            else setNote(`WhatsApp opened. Add your name and mobile under "Your details" if you want ${l.providerName} to see this request in UpNow too.`);
          }}>
          <MessageCircle size={15} aria-hidden /> WhatsApp
        </a>
        <button type="button" className="bk-btn secondary sm" aria-expanded={panel === 'email'} onClick={() => { setPanel(panel === 'email' ? null : 'email'); setNote(null); }}>
          <Mail size={15} aria-hidden /> Email
        </button>
      </div>

      {panel === 'call' && (
        <div className="bk-callbox">
          <a className="num" href={tel}>{l.providerPhone}</a>
          <div className="bk-actions" style={{ marginTop: 8 }}>
            <a className="bk-btn primary sm" href={tel}><Phone size={14} aria-hidden /> Call now</a>
            <button type="button" className="bk-btn secondary sm" onClick={copy}><Copy size={14} aria-hidden /> {copied ? 'Number copied' : 'Copy number'}</button>
          </div>
          {logged.call ? null : (
            <form style={{ marginTop: 12 }} onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) { setErr('Enter your name for the call back'); return; }
              if (!phone.trim()) { setErr('Enter your mobile number for the call back'); return; }
              log('call', `Call-back requested (${cbWhen.toLowerCase()})${when ? ` — about ${when}` : ''}`, { name, phone, email: contact.email });
            }}>
              <div className="bk-label" style={{ marginBottom: 4 }}>Or request a call back</div>
              <div className="bk-row2">
                <div className="bk-field">
                  <label className="bk-label" htmlFor={`cb-name-${l.id}`}>Name</label>
                  <input id={`cb-name-${l.id}`} className="bk-input" autoComplete="name" value={name} onChange={(e) => setCbName(e.target.value)} />
                </div>
                <div className="bk-field">
                  <label className="bk-label" htmlFor={`cb-phone-${l.id}`}>Mobile</label>
                  <input id={`cb-phone-${l.id}`} className="bk-input" type="tel" autoComplete="tel" placeholder="+971 5x xxx xxxx" value={phone} onChange={(e) => setCbPhone(e.target.value)} />
                </div>
              </div>
              <div className="bk-field">
                <label className="bk-label" htmlFor={`cb-when-${l.id}`}>When</label>
                <select id={`cb-when-${l.id}`} className="bk-input" value={cbWhen} onChange={(e) => setCbWhen(e.target.value)}>
                  {['As soon as possible', 'This morning', 'This afternoon', 'This evening', 'Tomorrow'].map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="bk-actions" style={{ marginTop: 6 }}>
                <button type="submit" className="bk-btn secondary sm">Request a call back</button>
              </div>
              <div className="bk-note left">{when ? `${l.providerName} sees your ${l.model === 'court' ? 'slot' : 'dates'} (${when}).` : `No ${l.model === 'court' ? 'slot' : 'dates'} picked — the ${noun} agrees them with you on the call.`}</div>
            </form>
          )}
        </div>
      )}

      {panel === 'email' && (
        <form className="bk-field" style={{ marginTop: 8 }} onSubmit={(e) => {
          e.preventDefault();
          const ce = contactError(contact);
          if (ce) { setErr(`${ce} (in Your details above)`); return; }
          if (!text.trim()) { setErr('Write your message first'); return; }
          if (log('email', text.trim(), contact)) { setText(''); setPanel(null); }
        }}>
          <label className="bk-label" htmlFor={`em-${l.id}`}>Message to {l.providerName}</label>
          <textarea id={`em-${l.id}`} className="bk-input" value={text} placeholder={emailPlaceholder} onChange={(e) => setText(e.target.value)} />
          <div className="bk-actions" style={{ marginTop: 6 }}>
            <button type="submit" className="bk-btn secondary sm">Send email to {first}</button>
            <button type="button" className="bk-btn secondary sm" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      {note && !err && <div className="bk-note left" role="status">{note}</div>}
      {err && <div className="bk-err" role="alert">{err}</div>}
      {lastId && !err && (
        <div className="bk-ok" role="status">
          {logged.call === lastId ? 'Call back requested' : 'Sent'} — enquiry {lastId}{when ? ` (${when})` : ' (no dates yet)'}. {l.providerName} aims to reply within 15 minutes.{' '}
          <Link href={`/book/confirmation/${lastId}`} style={{ textDecoration: 'underline' }}>Track it</Link>
        </div>
      )}
    </div>
  );
}
