'use client';

/**
 * Catalogue › Spaces listings — "Booking & payment" settings for the provider's own PREVIEW
 * booking listings (short stays, venues, courts, yachts). The provider picks the payment model
 * per listing (owner decision, Oct 2026):
 *   • On UpNow — customers pay by card on UpNow; deposits, refunds by policy and payouts.
 *   • Pay provider directly — MarketSpace lead flow; nothing is charged on UpNow.
 * Instant booking needs payment on UpNow, so the toggle is disabled for direct-pay listings
 * (and for courts on UpNow, which are always instant). Saves through store.updateListing —
 * changes apply to NEW bookings only. Browser-only preview store: nothing reaches the API.
 */
import Link from 'next/link';
import { Card, Evid, Pill, PreviewPill } from '@/components/os/kit';
import { MODEL_LABEL, isEnded, modeOf } from '@/lib/os/bookings/engine';
import type { PaymentMode, PreviewListing } from '@/lib/os/bookings/types';
import { useState } from 'react';
import { MODEL_SHORT, boardHref, useOwn } from './shared';

const MODE_TEXT: Record<PaymentMode, { label: string; text: string }> = {
  platform: { label: 'On UpNow', text: 'Customers pay by card on UpNow. Deposits and card holds, refunds by your cancellation policy and payouts are handled for you.' },
  direct: { label: 'Pay provider directly', text: 'Customers send an enquiry or request and pay you directly — nothing is charged on UpNow. You confirm, then mark payments received.' },
};

function ListingRow({ l }: { l: PreviewListing }) {
  const { store, bookings } = useOwn();
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const live = bookings.filter((b) => b.listingId === l.id && !isEnded(b.state));
  const liveOther = live.filter((b) => modeOf(b) !== l.paymentMode).length;
  const direct = l.paymentMode === 'direct';
  const courtPlatform = l.model === 'court' && !direct;
  const instantDisabled = direct || courtPlatform;
  const group = `pm-${l.id}`;

  const save = (patch: { paymentMode?: PaymentMode; instantBook?: boolean }, done: string) => {
    const r = store.updateListing(l.id, patch);
    setMsg(r.error ? { tone: 'bad', text: r.error } : { tone: 'ok', text: done });
  };

  return (
    <Card title={l.title} sub={`${MODEL_LABEL[l.model]} · ${l.area}`} right={<Pill tone={direct ? 'outline' : 'primary'} dot={false}>{direct ? 'Direct pay' : 'On UpNow'}</Pill>}>
      <div className="gx-pad" style={{ display: 'grid', gap: 12 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend className="gx-lb" style={{ marginBottom: 6 }}>Payment model</legend>
          {(['platform', 'direct'] as PaymentMode[]).map((m) => (
            <label key={m} htmlFor={`${group}-${m}`} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px', borderRadius: 9, cursor: 'pointer',
              border: `1px solid ${l.paymentMode === m ? 'var(--ms-primary)' : 'var(--ms-border)'}`, background: l.paymentMode === m ? 'var(--ms-tint-pale)' : undefined,
            }}>
              <input id={`${group}-${m}`} type="radio" name={group} value={m} checked={l.paymentMode === m} style={{ marginTop: 3, accentColor: 'var(--ms-primary)' }}
                onChange={() => save({ paymentMode: m }, `${MODE_TEXT[m].label} — applies to new bookings`)} />
              <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                <strong style={{ display: 'block', fontSize: 13 }}>{MODE_TEXT[m].label}</strong>
                <span style={{ color: 'var(--ms-ink-2)' }}>{MODE_TEXT[m].text}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div>
          <label htmlFor={`ib-${l.id}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: instantDisabled ? 'not-allowed' : 'pointer', opacity: instantDisabled ? 0.65 : 1 }}>
            <input id={`ib-${l.id}`} type="checkbox" checked={l.instantBook} disabled={instantDisabled} style={{ marginTop: 3, accentColor: 'var(--ms-primary)' }}
              aria-describedby={`ib-${l.id}-why`}
              onChange={(e) => save({ instantBook: e.target.checked }, e.target.checked ? 'Instant booking on — customers can book and pay without waiting for you' : 'Instant booking off — customers send a request first')} />
            <span style={{ fontSize: 12.5 }}>
              <strong style={{ display: 'block', fontSize: 13 }}>Instant booking</strong>
              <span id={`ib-${l.id}-why`} style={{ color: 'var(--ms-ink-2)' }}>
                {direct
                  ? 'Not available with direct payment — direct-pay listings take enquiries and requests only, and you confirm each one.'
                  : courtPlatform
                    ? 'Courts paid on UpNow are always instant — the slot is held for 10 minutes while the player pays.'
                    : 'Customers book and pay straight away, without waiting for you to accept.'}
              </span>
            </span>
          </label>
        </div>

        <Evid>
          Changes apply to new bookings. {live.length ? `${live.length} open booking${live.length === 1 ? '' : 's'} keep${live.length === 1 ? 's' : ''} the model it was made with${liveOther ? ` (${liveOther} still on the other model)` : ''}.` : 'No open bookings on this listing.'}{' '}
          <Link href={boardHref(l.model)} style={{ textDecoration: 'underline' }}>Open the {MODEL_SHORT[l.model].toLowerCase()} board</Link>
        </Evid>
        {msg && <Evid tone={msg.tone === 'ok' ? 'ok' : 'bad'}>{msg.text}</Evid>}
      </div>
    </Card>
  );
}

export function ListingPaymentSettings() {
  const { listings } = useOwn();
  return (
    <section aria-labelledby="bp-h" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px', flexWrap: 'wrap' }}>
        <h2 id="bp-h" style={{ fontSize: 15 }}>Booking &amp; payment</h2>
        <PreviewPill />
        <span style={{ fontSize: 12, color: 'var(--ms-ink-3)' }}>Short stays, venues, courts and yachts — choose per listing how customers pay.</span>
      </div>
      <div className="gx-cols gx-cols-2e">
        {listings.map((l) => <ListingRow key={l.id} l={l} />)}
      </div>
    </section>
  );
}
