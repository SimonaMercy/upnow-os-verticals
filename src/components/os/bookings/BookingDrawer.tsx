'use client';

/**
 * Booking record for the provider OS — PREVIEW booking engine (short stays, venues, courts,
 * charters). Used as the inbox's right pane (<BookingDetail/>) and as a drawer on the boards,
 * the calendar and the inbox on mobile (<BookingDrawer/>).
 *
 * The buttons are exactly the engine's nextActions(booking, 'provider', listing, now). Actions
 * that need input (decline / cancel reason, offer lines, reply text, deposit claim, payment
 * method, site visit time) open an inline form first. Labelled buttons only.
 *
 * Direct-pay bookings (customer pays the provider, nothing on UpNow) show a "Direct pay" pill,
 * "Mark received" on each payment (cash / card at venue / bank transfer), the engine's "Chase …"
 * timer for overdue payments, and no deposit-release or payout block. Venues get "Schedule site
 * visit" in both modes.
 *
 * Lead and booking loops (engine STATE MACHINE): "Confirm booking" on enquiries (collects the
 * dates / slot / guests when the lead had none, re-prices, checks conflicts), counter-offers on
 * requests, "Mark lost", provisional holds (record deposit → confirmed, Extend hold, Release
 * hold), "Change dates / slot" (propose or apply) and answering the customer's change request,
 * and per payment "Send reminder" and "Waive / write off".
 */
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Btn, Callout, Card, Checklist, Drawer, Evid, Field, KV, Pill, Timeline, type Tone,
} from '@/components/os/kit';
import { getListing, useBookings, useNow } from '@/lib/os/bookings/store';
import {
  DIRECT_RECEIVED_METHODS, METHOD_LABEL, MODEL_LABEL, RULES, SOURCE_LABEL, canMessage, datesText, depositHoldFils, depositStatus, findConflicts, formatAED,
  hasDates, isDirect, isEnded, mergeDates, ms, netPaidFils, nextActions, priceFor, sourceOf, stateLabelFor, sumLines, timerOf,
  type ActionOption, type DirectReceivedMethod,
} from '@/lib/os/bookings/engine';
import { DatesFields, defaultDates, type DatesValue } from '@/components/booking/DatesFields';
import { POLICY_LABEL, providerCancellationFor } from '@/lib/os/bookings/policies';
import type { Booking, LineItem, PaymentRecord, PreviewListing, ProviderAction } from '@/lib/os/bookings/types';
import {
  ModelPill, PayModePill, SourcePill, StatePill, TimerChip, courtName, dubaiMs, dubaiYmd, fmtDT, fmtDay, guestsText, parseHm, whenText,
} from './shared';

type Opt = ActionOption<ProviderAction>;
type PanelKind = 'reason' | 'cancel' | 'offer' | 'reply' | 'claim' | 'payment' | 'visit' | 'confirm' | 'change' | 'hold';
interface Panel { kind: PanelKind; opt: Opt }

/** Actions rendered inside their own section rather than the main action bar. */
const SECTION_ACTIONS: Opt['action'][] = ['complete_task', 'record_payment', 'send_reminder', 'waive_payment', 'release_deposit', 'claim_deposit'];

const btnVariant = (v: Opt['variant']) => (v === 'primary' ? 'primary' : v === 'danger' ? 'danger' : undefined);

function panelFor(o: Opt): PanelKind | null {
  switch (o.needs) {
    case 'reason': return o.action === 'cancel' ? 'cancel' : 'reason';
    case 'offer': return 'offer';
    case 'text': return 'reply';
    case 'claim': return 'claim';
    case 'payment_method': return 'payment';
    case 'datetime': return 'visit';
    case 'confirm': return 'confirm';
    case 'change': return 'change';
    case 'hold_until': return 'hold';
    default: return null;
  }
}

// ---------------------------------------------------------------------------- drawer

export function BookingDrawer({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  const { bookings } = useBookings();
  const b = bookingId ? bookings.find((x) => x.id === bookingId) : undefined;
  const l = b ? getListing(b.listingId) : undefined;
  return (
    <Drawer
      open={!!b}
      onClose={onClose}
      title={b ? b.customer.name : ''}
      sub={b ? `${b.id} · ${l?.title ?? b.listingId} · ${MODEL_LABEL[b.model]}` : undefined}
    >
      {b && <BookingDetail booking={b} hideHeader />}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------- detail

export function BookingDetail({ booking, hideHeader }: { booking: Booking; hideHeader?: boolean }) {
  // Re-mount per booking so open forms and messages never leak between records.
  return <Detail key={booking.id} b={booking} hideHeader={hideHeader} />;
}

function Detail({ b, hideHeader }: { b: Booking; hideHeader?: boolean }) {
  const store = useBookings();
  const now = useNow(30_000);
  const l = getListing(b.listingId);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  if (!l) return <Callout tone="bad" title="Listing not found.">This booking points at a listing that no longer exists.</Callout>;

  const timer = timerOf(b, now);
  const opts = nextActions(b, 'provider', l, now);
  const main = opts.filter((o) => !SECTION_ACTIONS.includes(o.action));
  const ended = isEnded(b.state);

  const run = (action: ProviderAction, done: string) => {
    const r = store.providerAct(b.id, action);
    if (r.error) { setError(r.error); setFlash(null); return false; }
    setError(null); setPanel(null); setFlash(done);
    return true;
  };
  const click = (o: Opt) => {
    setFlash(null); setError(null);
    const k = panelFor(o);
    if (k) { setPanel({ kind: k, opt: o }); return; }
    if (o.payload) run(o.payload, `${o.label} — done`);
  };
  const actionBtn = (o: Opt, size: 'sm' | 'xs' = 'sm') => (
    <Btn key={o.label} size={size} variant={btnVariant(o.variant)} onClick={() => click(o)}>{o.label}</Btn>
  );
  const sectionOpts = (pred: (o: Opt) => boolean) => opts.filter((o) => SECTION_ACTIONS.includes(o.action) && pred(o));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {!hideHeader && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 17 }}>{b.customer.name}</h2>
            <ModelPill model={b.model} />
            <StatePill b={b} />
            <PayModePill b={b} />
            <SourcePill b={b} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ms-ink-3)', marginTop: 3 }}>
            <span className="mono">{b.id}</span> · {l.title} · {l.area}
          </div>
        </div>
      )}
      {hideHeader && (
        <div className="gx-btn-row"><ModelPill model={b.model} /><StatePill b={b} /><PayModePill b={b} /><SourcePill b={b} /></div>
      )}

      {timer && (
        <div className="gx-btn-row">
          <TimerChip timer={timer} />
          <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>Deadline {fmtDT(timer.deadline)} (Dubai)</span>
        </div>
      )}

      {/* ---- actions (exactly the engine's nextActions) ---- */}
      {main.length > 0 ? (
        <div className="gx-btn-row" role="group" aria-label="Booking actions">{main.map((o) => actionBtn(o))}</div>
      ) : (
        <Evid>{ended ? 'This booking has ended — no further actions.' : 'Nothing for you to do right now — the next step is on the customer or the clock.'}</Evid>
      )}
      {flash && <Callout>{flash}</Callout>}
      {error && <Callout tone="bad" title="Not done.">{error}</Callout>}
      {b.state === 'provisional' && b.releaseAt && (
        <Callout tone="warn" title="Provisional — awaiting the deposit.">
          The date is held for {b.customer.name} until {fmtDT(b.releaseAt)} (Dubai). Mark the deposit received below to confirm the booking, extend the hold if they need longer, or release the date.
          If nothing happens by then the date is released automatically.
        </Callout>
      )}
      {b.pendingChange && <ChangeCard b={b} />}
      {b.state === 'offer_sent' && b.offerHolds && (
        <Evid>Counter-offer — the dates stay held for the customer until {b.offerExpiresAt ? fmtDT(b.offerExpiresAt) : 'the offer lapses'}.</Evid>
      )}
      {panel && (
        <ActionPanel
          key={panel.opt.label}
          panel={panel}
          b={b}
          l={l}
          now={now}
          onCancel={() => setPanel(null)}
          onSubmit={(a, msg) => run(a, msg)}
        />
      )}

      {/* ---- request ---- */}
      <Card title="Request" pad>
        <KV items={[
          { k: b.model === 'shortstay' ? 'Dates' : b.model === 'court' ? 'Slot' : 'When', v: hasDates(b) ? whenText(b, l) : 'Not given yet — add them when you confirm or send an offer' },
          { k: b.model === 'court' ? 'Players' : 'Guests', v: guestsText(b) },
          ...detailRows(b, l),
          { k: 'Payment', v: isDirect(b) ? (b.model === 'court' ? 'Customer pays at the venue — nothing on UpNow' : 'Customer pays you directly — nothing on UpNow') : 'On UpNow (card, refunds by policy, payout)' },
          { k: 'Lead source', v: sourceOf(b) === 'form' ? 'Booking form' : `${SOURCE_LABEL[sourceOf(b)]} button on the listing` },
          ...(b.siteVisitAt ? [{ k: 'Site visit', v: `${fmtDT(b.siteVisitAt)} (Dubai)` }] : []),
          { k: 'Phone', v: b.customer.phone || '—' },
          ...(b.customer.email ? [{ k: 'Email', v: b.customer.email }] : []),
          ...((b.model === 'shortstay' || b.model === 'charter') ? [{ k: b.model === 'shortstay' ? 'Guest IDs (DET)' : 'Manifest IDs', v: b.customer.idProvided ? 'Provided' : 'Not yet provided' }] : []),
          { k: 'Received', v: fmtDT(b.createdAt) },
          { k: 'Cancellation policy', v: POLICY_LABEL[b.cancellation] },
        ]} />
        {!ended && <RefundLine b={b} />}
      </Card>

      {!ended && hasDates(b) && <ConflictCheck b={b} l={l} now={now} />}

      {/* ---- price ---- */}
      <Card title="Price" sub={b.quoteVersion ? `${b.model === 'shortstay' ? 'Special offer' : 'Quote'} v${b.quoteVersion}` : 'What the customer saw'}>
        <LineTable lines={b.lineItems} total={b.totalFils} />
      </Card>

      {b.payments.length > 0 && (
        <Card title="Payments" sub={isDirect(b) ? `Received ${formatAED(netPaidFils(b))} of ${formatAED(b.totalFils)} — paid to you directly` : `Paid ${formatAED(netPaidFils(b))} of ${formatAED(b.totalFils)}`}>
          <PaymentsTable payments={b.payments} direct={isDirect(b)} now={now} reminded={(p) => lastReminder(b, p.id)} actions={(p) => sectionOpts((o) => !!o.payload && 'paymentId' in o.payload && o.payload.paymentId === p.id).map((o) => (
            <Btn key={o.label} size="xs" variant={o.action === 'record_payment' && isDirect(b) ? 'primary' : undefined} onClick={() => click(o)}>
              {o.action === 'record_payment' ? (isDirect(b) ? 'Mark received' : 'Record payment') : o.action === 'send_reminder' ? 'Send reminder' : 'Waive / write off'}
            </Btn>
          ))} />
        </Card>
      )}

      {b.tasks.length > 0 && (
        <Card title="Tasks" sub="Compliance and preparation before the start">
          <div className="gx-pad">
            <div style={{ display: 'grid', gap: 8 }}>
              {b.tasks.map((t) => {
                const overdue = !t.done && t.dueAt && ms(t.dueAt) < now;
                const o = sectionOpts((x) => x.action === 'complete_task' && x.payload?.type === 'complete_task' && x.payload.key === t.key)[0];
                return (
                  <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <Checklist items={[{ l: t.label, sub: t.dueAt ? `${t.done ? 'Was due' : overdue ? 'Overdue — was due' : 'Due'} ${fmtDT(t.dueAt)}` : undefined, state: t.done ? 'pass' : overdue ? 'fail' : 'wait' }]} />
                    </div>
                    {o && <Btn size="xs" variant="primary" onClick={() => click(o)}>Mark done</Btn>}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {!isDirect(b) && depositHoldFils(b) > 0 && (b.model === 'shortstay' || b.model === 'charter') && ['confirmed', 'checked_in', 'in_progress', 'completed', 'closed', 'no_show'].includes(b.state) && (
        <DepositCard b={b} now={now} actions={sectionOpts((o) => o.action === 'release_deposit' || o.action === 'claim_deposit').map((o) => actionBtn(o, 'xs'))} />
      )}
      {isDirect(b) && depositHoldFils(b) > 0 && (
        <Evid><strong>{b.model === 'shortstay' ? 'Damage deposit' : 'Security deposit'} {formatAED(depositHoldFils(b))}</strong> — collected and returned by you directly if you take one. UpNow holds nothing on this booking.</Evid>
      )}

      {isDirect(b) ? (
        !['declined', 'expired', 'enquiry', 'offer_sent', 'requested'].includes(b.state) && (
          <Evid><strong>No UpNow payout.</strong> The customer pays you directly — mark each payment received as it comes in so the booking shows what is still owed.</Evid>
        )
      ) : <PayoutLine b={b} now={now} />}

      <Thread b={b} ended={!canMessage(b)} onSend={(text) => run({ type: 'reply', text }, 'Message sent')} />

      <Card title="Activity" sub="Every state change, payment and deadline, oldest first">
        <div className="gx-pad">
          <Timeline items={b.events.filter((e) => e.type !== 'message').map((e) => ({
            t: e.text,
            s: `${fmtDT(e.at)} · ${e.actor === 'provider' ? 'You' : e.actor === 'customer' ? b.customer.name : 'System'}`,
            state: ['expired', 'declined', 'cancelled_by_customer', 'cancelled_by_provider', 'no_show', 'lost'].includes(e.type) ? 'bad' as const : 'done' as const,
            mark: e.actor === 'provider' ? 'Y' : e.actor === 'customer' ? 'C' : 'S',
          }))} />
        </div>
      </Card>
    </div>
  );
}

function detailRows(b: Booking, l: PreviewListing): { k: string; v: ReactNode }[] {
  const d = b.details;
  const out: { k: string; v: ReactNode }[] = [];
  if (b.model === 'shortstay') {
    if (d.adults != null) out.push({ k: 'Party', v: `${d.adults} adult${d.adults === 1 ? '' : 's'}${d.children ? `, ${d.children} child${d.children === 1 ? '' : 'ren'}` : ''}${d.infants ? `, ${d.infants} infant${d.infants === 1 ? '' : 's'}` : ''}` });
    if (d.tripType) out.push({ k: 'Trip type', v: d.tripType });
  }
  if (b.model === 'court') {
    if (hasDates(b)) out.push({ k: 'Court', v: courtName(l, d.courtId) });
    if (d.sport) out.push({ k: 'Sport', v: d.sport });
    out.push({ k: 'Payment', v: d.splitPayment ? 'Split between players' : 'Paid by the booker' });
    if (d.seriesId) out.push({ k: 'Weekly series', v: `Booking ${d.seriesIndex} of ${d.seriesCount}${d.seriesSkipped?.length ? ` · skipped ${d.seriesSkipped.map((x) => fmtDay(x)).join(', ')} (court taken)` : ''}` });
  }
  if (b.model === 'venue') {
    if (d.eventType) out.push({ k: 'Event type', v: d.eventType });
    if (d.session) out.push({ k: 'Session', v: d.session });
    if (d.budgetFils != null) out.push({ k: 'Budget', v: formatAED(d.budgetFils) });
    out.push({ k: 'Catering', v: d.catering ? 'Requested' : 'Not requested' });
    if (d.packageIds?.length && l.model === 'venue') out.push({ k: 'Packages', v: d.packageIds.map((id) => l.packages?.find((p) => p.id === id)?.label ?? id).join(', ') });
  }
  if (b.model === 'charter' && l.model === 'charter') {
    if (d.occasion) out.push({ k: 'Occasion', v: d.occasion });
    const names = (d.addOnIds ?? []).map((id) => l.addOns.find((a) => a.id === id)?.label ?? id);
    out.push({ k: 'Add-ons', v: names.length ? names.join(', ') : 'None' });
    out.push({ k: 'Departs from', v: l.departurePoint });
  }
  if (b.model === 'shortstay' && l.model === 'shortstay') out.push({ k: 'Permit', v: l.permitNumber });
  return out;
}

function lastReminder(b: Booking, paymentId: string): string | undefined {
  for (let i = b.events.length - 1; i >= 0; i--) if (b.events[i].type === 'reminder' && b.events[i].ref === paymentId) return b.events[i].at;
  return undefined;
}

/** The pending date / slot change and who has to answer it (the buttons are in the action bar). */
function ChangeCard({ b }: { b: Booking }) {
  const pc = b.pendingChange;
  if (!pc) return null;
  const diff = pc.totalFils - b.totalFils;
  const mine = pc.by === 'provider';
  return (
    <Card title={mine ? 'Your date change proposal' : `${b.customer.name.split(' ')[0]} asked for new ${b.model === 'court' ? 'slot' : 'dates'}`}
      sub={`${mine ? 'Waiting for the customer' : 'Accept or decline above'} · lapses ${fmtDT(pc.expiresAt)}`}>
      <div className="gx-pad" style={{ display: 'grid', gap: 6 }}>
        <KV items={[
          { k: 'Now', v: datesText(b.model, b.start, b.end) },
          { k: 'Proposed', v: datesText(b.model, pc.start, pc.end) },
          { k: 'New total', v: `${formatAED(pc.totalFils)} (${diff === 0 ? 'same price' : diff > 0 ? `+${formatAED(diff)}` : `−${formatAED(-diff)}`})` },
          ...(pc.note ? [{ k: 'Note', v: pc.note }] : []),
        ]} />
        <Evid>Accepting moves the booking and adjusts the payments; declining (or letting it lapse) leaves the booking exactly as it is.</Evid>
      </div>
    </Card>
  );
}

function RefundLine({ b }: { b: Booking }) {
  const { refundQuote } = useBookings();
  if (isDirect(b)) {
    if (b.state !== 'confirmed') return null;
    return <div style={{ marginTop: 10 }}><Evid>If the customer cancels: refunds are yours to handle under your {POLICY_LABEL[b.cancellation].toLowerCase()} policy — UpNow holds no money{netPaidFils(b) > 0 ? ` (you have received ${formatAED(netPaidFils(b))})` : ''}.</Evid></div>;
  }
  if (!['held', 'awaiting_payment', 'confirmed'].includes(b.state) || netPaidFils(b) <= 0) return null;
  const q = refundQuote(b.id);
  if (!q) return null;
  return <div style={{ marginTop: 10 }}><Evid>If the customer cancels now: refund {formatAED(q.refundFils)}, kept {formatAED(q.keptFils)}. {q.rule}.</Evid></div>;
}

function ConflictCheck({ b, l, now }: { b: Booking; l: PreviewListing; now: number }) {
  const { bookings, blocks } = useBookings();
  const c = findConflicts({ listingId: b.listingId, start: b.start, end: b.end, courtId: b.details.courtId, excludeBookingId: b.id, now }, bookings, blocks);
  const n = c.bookings.length + c.blocks.length;
  return (
    <Card title="Conflict check" sub={b.model === 'court' ? `${courtName(l, b.details.courtId)} at this time` : 'Other bookings and blocks on these dates'}>
      <div className="gx-pad">
        {n === 0 ? (
          <Evid tone="ok"><strong>No conflicts.</strong> Nothing else holds {b.model === 'court' ? 'this court at this time' : 'these dates'}.</Evid>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {c.bookings.map((x) => (
              <Evid key={x.id} tone="bad"><strong>{x.id} · {x.customer.name}</strong> — {stateLabelFor(x.model, x.state)}, {whenText(x, l)}</Evid>
            ))}
            {c.blocks.map((k) => (
              <Evid key={k.id} tone="warn"><strong>Blocked</strong> — {k.reason}, {fmtDay(k.start)} → {fmtDay(k.end)}</Evid>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function LineTable({ lines, total }: { lines: LineItem[]; total: number }) {
  const holds = lines.filter((x) => x.kind === 'deposit_hold');
  return (
    <div className="gx-tbl-scroll">
      <table className="gx-tbl">
        <tbody>
          {lines.filter((x) => x.kind !== 'deposit_hold').map((x) => (
            <tr key={x.key}><td>{x.label}</td><td className="num">{formatAED(x.fils)}</td></tr>
          ))}
          <tr><td className="strong">Total</td><td className="num strong">{formatAED(total)}</td></tr>
          {holds.map((x) => (
            <tr key={x.key}><td style={{ color: 'var(--ms-ink-3)' }}>{x.label}</td><td className="num" style={{ color: 'var(--ms-ink-3)' }}>{formatAED(x.fils)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PAY_TONE: Record<PaymentRecord['status'], Tone> = { due: 'amber', paid: 'primary', refunded: 'info', waived: 'neutral', failed: 'danger' };

function PaymentsTable({ payments, actions, direct, now, reminded }: { payments: PaymentRecord[]; actions: (p: PaymentRecord) => ReactNode; direct?: boolean; now: number; reminded?: (p: PaymentRecord) => string | undefined }) {
  return (
    <div className="gx-tbl-scroll">
      <table className="gx-tbl">
        <thead><tr><th>Payment</th><th>Status</th><th className="num">Amount</th><th className="act">Action</th></tr></thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td className="strong">{p.label}
                <span className="sub">{p.status === 'paid' && p.paidAt
                  ? `${direct ? 'Received' : 'Paid'} ${fmtDT(p.paidAt)}${p.method ? ` · ${METHOD_LABEL[p.method]}` : ''}`
                  : p.dueAt ? `${direct && p.status === 'due' && ms(p.dueAt) < now ? 'Overdue — was due' : 'Due'} ${fmtDT(p.dueAt)}${direct && p.status === 'due' && p.method ? ` · ${METHOD_LABEL[p.method]}` : ''}` : ''}
                  {p.status === 'due' && reminded?.(p) ? ` · reminder sent ${fmtDT(reminded(p) as string)}` : ''}</span>
              </td>
              <td><Pill tone={direct && p.status === 'due' && p.dueAt && ms(p.dueAt) < now ? 'danger' : PAY_TONE[p.status]}>{direct && p.status === 'paid' ? 'Received' : p.status[0].toUpperCase() + p.status.slice(1)}</Pill></td>
              <td className="num">{formatAED(p.fils)}</td>
              <td className="act"><span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>{actions(p)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepositCard({ b, now, actions }: { b: Booking; now: number; actions: ReactNode[] }) {
  const st = depositStatus(b);
  const placed = b.state !== 'confirmed';
  const label = st === 'held' && !placed ? 'Taken at arrival' : { none: 'No hold', held: 'Held on card', released: 'Released', claimed: 'Claimed' }[st];
  return (
    <Card title={b.model === 'shortstay' ? 'Damage deposit' : 'Security deposit'} sub={`${formatAED(depositHoldFils(b))} card hold — never charged unless you claim`}
      right={<Pill tone={st === 'held' ? 'amber' : st === 'claimed' ? 'danger' : 'neutral'}>{label}</Pill>}>
      <div className="gx-pad" style={{ display: 'grid', gap: 8 }}>
        {st === 'held' && b.depositClaimBy && (
          <Evid tone={ms(b.depositClaimBy) - now < 2 * 86_400_000 ? 'warn' : undefined}>
            Claim window closes {fmtDT(b.depositClaimBy)}. Release the hold if everything is in order, or claim for damage with a reason.
          </Evid>
        )}
        {st === 'held' && !b.depositClaimBy && <Evid>{placed ? 'Release the hold once the guests have left, or claim after check-out.' : 'The card hold is placed at arrival and can be released or claimed after check-out.'}</Evid>}
        {actions.length > 0 && <div className="gx-btn-row">{actions}</div>}
      </div>
    </Card>
  );
}

function PayoutLine({ b, now }: { b: Booking; now: number }) {
  if (!b.payoutAt || ['declined', 'expired', 'cancelled_by_customer', 'cancelled_by_provider'].includes(b.state)) return null;
  const due = ms(b.payoutAt) <= now;
  return (
    <Evid tone={due ? 'ok' : undefined}>
      <strong>{due ? 'Paid out' : 'Payout expected'}</strong> {fmtDT(b.payoutAt)} — {formatAED(netPaidFils(b))} collected so far
      {b.model === 'court' ? ' (weekly court payout, Thursdays)' : b.model === 'shortstay' ? ' (24h after check-in)' : ' (3 days after the end)'}.
    </Evid>
  );
}

function Thread({ b, ended, onSend }: { b: Booking; ended: boolean; onSend: (text: string) => boolean }) {
  const [text, setText] = useState('');
  const msgs = b.events.filter((e) => e.type === 'message');
  return (
    <Card title="Messages" sub={b.state === 'enquiry' && b.respondBy ? 'Your first reply stops the reply clock' : `${msgs.length} message${msgs.length === 1 ? '' : 's'}`}>
      <div className="gx-pad" style={{ display: 'grid', gap: 8 }}>
        {msgs.length === 0 && <div style={{ fontSize: 12, color: 'var(--ms-ink-3)' }}>No messages yet.</div>}
        {msgs.map((m, i) => {
          const mine = m.actor === 'provider';
          return (
            <div key={i} style={{ justifySelf: mine ? 'end' : 'start', maxWidth: '85%' }}>
              <div style={{
                padding: '8px 11px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
                background: mine ? 'var(--ms-tint)' : 'var(--ms-surface-3)', color: 'var(--ms-ink)',
              }}>{m.text}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)', marginTop: 2, textAlign: mine ? 'right' : 'left' }}>
                {mine ? 'You' : m.actor === 'customer' ? b.customer.name : 'System'} · {fmtDT(m.at)}
              </div>
            </div>
          );
        })}
        {!ended && (
          <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            <label className="gx-lb" htmlFor={`msg-${b.id}`}>Message {b.customer.name.split(' ')[0]}</label>
            <textarea id={`msg-${b.id}`} className="gx-ta" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" />
            <div className="gx-btn-row">
              <Btn size="sm" disabled={!text.trim()} onClick={() => { if (onSend(text)) setText(''); }}>Send message</Btn>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------- action input panels

const REASONS: Partial<Record<Opt['action'], string[]>> = {
  decline: ['Dates unavailable', 'Doesn’t fit house rules', 'Event type not allowed', 'Other'],
  mark_lost: ['No reply from the customer', 'Booked elsewhere', 'Budget too low', 'Dates not available', 'Other'],
  release_hold: ['Deposit not received', 'Customer asked to release the date', 'Other'],
  waive_payment: ['Goodwill / repeat customer', 'Customer disputes the charge', 'Not recoverable — written off', 'Other'],
};
const REASON_HINT: Partial<Record<Opt['action'], string>> = {
  decline: 'Declining counts as a response; letting a request expire counts against you.',
  mark_lost: 'The lead leaves your open demand. The customer sees it as closed.',
  release_hold: 'The date becomes free for other customers straight away.',
  waive_payment: 'Recorded on the booking; the customer no longer owes this amount.',
};
const CANCEL_REASONS = ['Weather / Coast Guard order', 'Listing unavailable (maintenance)', 'Double booking', 'Other'];

function ActionPanel({ panel, b, l, now, onCancel, onSubmit }: {
  panel: Panel; b: Booking; l: PreviewListing; now: number; onCancel: () => void; onSubmit: (a: ProviderAction, msg: string) => boolean;
}) {
  const { kind, opt } = panel;
  return (
    <Card title={opt.label} right={<Btn size="xs" variant="ghost" onClick={onCancel}>Close form</Btn>}>
      <div className="gx-pad">
        {kind === 'reason' && <ReasonForm opt={opt} b={b} onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'cancel' && <CancelForm b={b} l={l} now={now} onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'offer' && <OfferForm b={b} l={l} now={now} opt={opt} onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'reply' && <ReplyForm onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'claim' && <ClaimForm b={b} onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'payment' && <PaymentForm b={b} opt={opt} onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'visit' && <VisitForm b={b} now={now} onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'confirm' && <ConfirmForm b={b} l={l} now={now} onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'change' && <ChangeForm b={b} l={l} now={now} onCancel={onCancel} onSubmit={onSubmit} />}
        {kind === 'hold' && <HoldForm b={b} now={now} onCancel={onCancel} onSubmit={onSubmit} />}
      </div>
    </Card>
  );
}

type FormProps = { onCancel: () => void; onSubmit: (a: ProviderAction, msg: string) => boolean };

function FormButtons({ submit, disabled, onSubmit, onCancel, danger }: { submit: string; disabled?: boolean; onSubmit: () => void; onCancel: () => void; danger?: boolean }) {
  return (
    <div className="gx-btn-row">
      <Btn variant={danger ? 'danger' : 'primary'} disabled={disabled} onClick={onSubmit}>{submit}</Btn>
      <Btn variant="ghost" onClick={onCancel}>Back</Btn>
    </div>
  );
}

/** Decline · Mark lost · Release hold · Waive / write off — a reason picked from a list (+ free text). */
function ReasonForm({ opt, b, onCancel, onSubmit }: FormProps & { opt: Opt; b: Booking }) {
  const list = REASONS[opt.action] ?? REASONS.decline as string[];
  const [reason, setReason] = useState(list[0]);
  const [detail, setDetail] = useState('');
  const needDetail = reason === 'Other' && !detail.trim();
  const full = detail.trim() ? (reason === 'Other' ? detail.trim() : `${reason} — ${detail.trim()}`) : reason;
  const pay = opt.payload && 'paymentId' in opt.payload ? b.payments.find((p) => p.id === (opt.payload as { paymentId: string }).paymentId) : undefined;
  const build = (): ProviderAction | null => {
    const p = opt.payload;
    if (!p) return null;
    if (p.type === 'decline' || p.type === 'mark_lost' || p.type === 'release_hold' || p.type === 'waive_payment') return { ...p, reason: full };
    return null;
  };
  return (
    <>
      {pay && <div style={{ marginBottom: 8 }}><Evid><strong>{pay.label}</strong> — {formatAED(pay.fils)}</Evid></div>}
      <Field label="Reason" htmlFor="rsn-reason">
        <select id="rsn-reason" className="gx-sel" value={reason} onChange={(e) => setReason(e.target.value)}>
          {list.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      <Field label={reason === 'Other' ? 'Explain (required)' : 'Note (optional)'} htmlFor="rsn-detail" hint={REASON_HINT[opt.action]}>
        <textarea id="rsn-detail" className="gx-ta" value={detail} onChange={(e) => setDetail(e.target.value)} />
      </Field>
      <FormButtons danger submit={`Confirm: ${opt.label.replace(/:.*$/, '').toLowerCase()}`} disabled={needDetail} onCancel={onCancel}
        onSubmit={() => { const a = build(); if (a) onSubmit(a, `${opt.label.replace(/:.*$/, '')} — done`); }} />
    </>
  );
}

const DATES_CLS = { input: 'gx-inp', label: 'gx-lb' };

/** New dates + live list price and conflicts (shared by confirm / offer / change). */
function useDraftDates(b: Booking, l: PreviewListing, now: number) {
  const { bookings, blocks } = useBookings();
  const [v, setV] = useState<DatesValue>(() => defaultDates(l, b, now));
  const m = mergeDates(b, v);
  const price = priceFor(l, m);
  const conflicts = useMemo(() => findConflicts({ listingId: b.listingId, start: m.start, end: m.end, courtId: m.details.courtId, excludeBookingId: b.id, now }, bookings, blocks), [b.listingId, b.id, m.start, m.end, m.details.courtId, now, bookings, blocks]);
  const clash = conflicts.bookings.length + conflicts.blocks.length > 0;
  const changed = m.start !== b.start || m.end !== b.end || m.guests !== b.guests || (m.details.courtId ?? '') !== (b.details.courtId ?? '') || m.details.layout !== b.details.layout;
  return { v, setV, m, price, clash, conflicts, changed };
}

function ConflictLine({ conflicts, l }: { conflicts: ReturnType<typeof findConflicts>; l: PreviewListing }) {
  if (!conflicts.bookings.length && !conflicts.blocks.length) return <Evid tone="ok">Free — nothing else holds this {l.model === 'court' ? 'court at this time' : 'time'}.</Evid>;
  return (
    <Evid tone="bad">
      <strong>Not free:</strong> {[...conflicts.bookings.map((x) => `${x.id} ${x.customer.name} (${stateLabelFor(x.model, x.state)})`), ...conflicts.blocks.map((k) => `blocked — ${k.reason}`)].join('; ')}
    </Evid>
  );
}

function ConfirmForm({ b, l, now, onCancel, onSubmit }: FormProps & { b: Booking; l: PreviewListing; now: number }) {
  const d = useDraftDates(b, l, now);
  const [note, setNote] = useState('');
  const keepOffer = b.state === 'offer_sent' && !d.changed && b.lineItems.length > 0;
  const total = keepOffer ? b.totalFils : d.price.totalFils;
  const direct = isDirect(b);
  const provisional = direct && (b.model === 'venue' || b.model === 'charter');
  const outcome = direct
    ? provisional
      ? `Provisional: the date is held while ${b.customer.name.split(' ')[0]} pays the deposit to you directly (due in ${b.model === 'venue' ? `${RULES.venueDepositDueDays} days` : `${RULES.payWithinHours.charter}h`}); you mark it received to confirm.`
      : `Confirmed straight away — the customer pays ${b.model === 'court' ? 'at the venue' : 'you directly'}; nothing is charged on UpNow.`
    : `The customer gets ${RULES.confirmPayWithinHours[b.model]}h to pay on UpNow (card); unpaid, it is released automatically.`;
  return (
    <>
      <div style={{ display: 'grid', gap: 10 }}>
        {!hasDates(b) && <Callout tone="info" title="This enquiry has no dates yet.">Add what you agreed with the customer.</Callout>}
        <DatesFields listing={l} value={d.v} onChange={d.setV} idPrefix={`cf-${b.id}`} cls={DATES_CLS} now={now} />
        {d.price.error ? <Evid tone="bad">{d.price.error}</Evid> : (
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--ms-tint-pale)', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>{keepOffer ? 'Total (as offered)' : 'Total (list price)'}</span><span>{formatAED(total)}</span>
          </div>
        )}
        <ConflictLine conflicts={d.conflicts} l={l} />
        <Evid>{outcome}</Evid>
        <Field label="Note to the customer (optional)" htmlFor={`cf-note-${b.id}`}>
          <textarea id={`cf-note-${b.id}`} className="gx-ta" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <FormButtons submit={`Confirm booking — ${formatAED(total)}`} disabled={!!d.price.error || d.clash || ms(d.m.start) <= now} onCancel={onCancel}
        onSubmit={() => onSubmit({ type: 'confirm_booking', start: d.m.start, end: d.m.end, guests: d.m.guests, details: d.v.details, note: note.trim() || undefined },
          provisional ? 'Confirmed as provisional — waiting for the deposit' : direct ? 'Booking confirmed' : 'Confirmed — the customer has been asked to pay')} />
    </>
  );
}

function ChangeForm({ b, l, now, onCancel, onSubmit }: FormProps & { b: Booking; l: PreviewListing; now: number }) {
  const d = useDraftDates(b, l, now);
  const [note, setNote] = useState('');
  const discounts = b.lineItems.filter((x) => x.kind === 'discount').reduce((t, x) => t + x.fils, 0);
  const total = d.price.error ? 0 : d.price.totalFils + discounts;
  const diff = total - b.totalFils;
  const canApply = isDirect(b) || diff <= 0;
  const [mode, setMode] = useState<'propose' | 'apply'>('propose');
  const effective = canApply ? mode : 'propose';
  return (
    <>
      <div style={{ display: 'grid', gap: 10 }}>
        <Evid>Now: {datesText(b.model, b.start, b.end)} · {formatAED(b.totalFils)}</Evid>
        <DatesFields listing={l} value={d.v} onChange={d.setV} idPrefix={`ch-${b.id}`} cls={DATES_CLS} now={now} />
        {d.price.error ? <Evid tone="bad">{d.price.error}</Evid> : (
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--ms-tint-pale)', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>New total{discounts ? ' (offer discount kept)' : ''}</span><span>{formatAED(total)} · {diff === 0 ? 'same price' : diff > 0 ? `+${formatAED(diff)}` : `−${formatAED(-diff)}`}</span>
          </div>
        )}
        <ConflictLine conflicts={d.conflicts} l={l} />
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          <legend className="gx-lb">How</legend>
          <label style={{ display: 'flex', gap: 8, fontSize: 12.5 }}><input type="radio" name={`chm-${b.id}`} checked={effective === 'propose'} onChange={() => setMode('propose')} /> Propose — the customer accepts or declines (lapses in {RULES.changeProposalValidHours}h)</label>
          <label style={{ display: 'flex', gap: 8, fontSize: 12.5, opacity: canApply ? 1 : 0.6 }}><input type="radio" name={`chm-${b.id}`} disabled={!canApply} checked={effective === 'apply'} onChange={() => setMode('apply')} />
            Apply now{isDirect(b) ? ' — you agreed it with the customer' : ''}{!canApply ? ` — not available: it costs ${formatAED(diff)} more, so the customer must accept` : ''}</label>
        </fieldset>
        <Evid>Payments are adjusted: {isDirect(b) ? 'any difference is added to (or taken off) what the customer owes you' : 'extra is added as a payment due on UpNow; a cheaper change is refunded'}. The booking keeps its status.</Evid>
        <Field label="Note to the customer (optional)" htmlFor={`ch-note-${b.id}`}>
          <textarea id={`ch-note-${b.id}`} className="gx-ta" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <FormButtons submit={effective === 'apply' ? 'Apply new dates' : 'Send proposal'} disabled={!!d.price.error || d.clash || !d.changed || ms(d.m.start) <= now} onCancel={onCancel}
        onSubmit={() => onSubmit({ type: 'change_dates', mode: effective, start: d.m.start, end: d.m.end, guests: d.m.guests, details: d.v.details, note: note.trim() || undefined },
          effective === 'apply' ? 'Dates changed' : 'Proposal sent to the customer')} />
    </>
  );
}

function HoldForm({ b, now, onCancel, onSubmit }: FormProps & { b: Booking; now: number }) {
  const cur = b.releaseAt ? ms(b.releaseAt) : now;
  const start = ms(b.start);
  const [date, setDate] = useState(dubaiYmd(Math.min(cur + 2 * 86_400_000, start)));
  const [time, setTime] = useState(fmtDT(cur).slice(-5));
  const at = dubaiMs(date, ...parseHm(time));
  const err = !Number.isFinite(at) ? 'Choose a date and time' : at <= cur ? 'Pick a time after the current release date' : at > start ? 'The hold cannot run past the start' : undefined;
  return (
    <>
      <Evid>Currently held until {b.releaseAt ? fmtDT(b.releaseAt) : '—'} (Dubai). The deposit due date moves with it.</Evid>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Field label="Hold until" htmlFor={`hd-date-${b.id}`}>
          <input id={`hd-date-${b.id}`} type="date" className="gx-inp" min={dubaiYmd(cur)} max={dubaiYmd(start)} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time (Dubai)" htmlFor={`hd-time-${b.id}`} error={err}>
          <input id={`hd-time-${b.id}`} type="time" className="gx-inp" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <FormButtons submit="Extend hold" disabled={!!err} onCancel={onCancel}
        onSubmit={() => onSubmit({ type: 'extend_hold', until: new Date(at).toISOString() }, `Hold extended to ${fmtDT(at)}`)} />
    </>
  );
}

function CancelForm({ b, l, now, onCancel, onSubmit }: FormProps & { b: Booking; l: PreviewListing; now: number }) {
  const reasons = b.model === 'shortstay' ? CANCEL_REASONS.slice(1) : CANCEL_REASONS;
  const [reason, setReason] = useState(reasons[0]);
  const [detail, setDetail] = useState('');
  const full = detail.trim() ? (reason === 'Other' ? detail.trim() : `${reason} — ${detail.trim()}`) : reason;
  const pc = providerCancellationFor(b, l, now, full);
  return (
    <>
      <Callout tone="warn" title="Provider cancellation.">
        {isDirect(b) ? <>{pc.rule}.</> : <>The customer is refunded in full ({formatAED(pc.refundFils)}). {pc.rule}.</>}
      </Callout>
      <div style={{ height: 10 }} />
      <Field label="Reason" htmlFor="can-reason">
        <select id="can-reason" className="gx-sel" value={reason} onChange={(e) => setReason(e.target.value)}>
          {reasons.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      <Field label={reason === 'Other' ? 'Explain (required)' : 'Details (optional)'} htmlFor="can-detail">
        <textarea id="can-detail" className="gx-ta" value={detail} onChange={(e) => setDetail(e.target.value)} />
      </Field>
      <FormButtons danger submit={isDirect(b) ? 'Cancel booking' : `Cancel booking — refund ${formatAED(pc.refundFils)}`} disabled={reason === 'Other' && !detail.trim()} onCancel={onCancel}
        onSubmit={() => onSubmit({ type: 'cancel', reason: full }, isDirect(b) ? 'Booking cancelled — return anything you collected to the customer directly' : 'Booking cancelled — customer refunded in full')} />
    </>
  );
}

interface DraftLine { key: string; label: string; aed: string; kind: LineItem['kind'] }
const KIND_LABEL: Record<LineItem['kind'], string> = { base: 'Base', fee: 'Fee', tax: 'Tax', addon: 'Add-on', discount: 'Discount', deposit_hold: 'Card hold' };

/** AED text → integer fils (null when not a number). Discounts are stored negative. */
function draftFils(d: DraftLine): number | null {
  const t = d.aed.trim().replace(/,/g, '');
  if (!t || !/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const f = Math.round(Number(t) * 100);
  return d.kind === 'discount' ? -Math.abs(f) : f;
}
const toAedText = (fils: number) => (Math.abs(fils) / 100).toFixed(2).replace(/\.00$/, '');

const toDraft = (xs: LineItem[]): DraftLine[] => xs.map((x) => ({ key: x.key, label: x.label, aed: x.kind === 'discount' ? toAedText(x.fils) : (x.fils / 100).toFixed(2).replace(/\.00$/, ''), kind: x.kind }));

function OfferForm({ b, l, now, opt, onCancel, onSubmit }: FormProps & { b: Booking; l: PreviewListing; now: number; opt: Opt }) {
  const d = useDraftDates(b, l, now);
  const [lines, setLines] = useState<DraftLine[]>(() => toDraft(b.lineItems.length ? b.lineItems : d.price.lineItems));
  const [hours, setHours] = useState(String(RULES.offerValidHours[b.model]));
  const counter = b.state === 'requested' || !!b.offerHolds;
  const [note, setNote] = useState('');
  const [seq, setSeq] = useState(1);
  const parsed = lines.map((d) => ({ d, fils: draftFils(d) }));
  const bad = parsed.some((p) => p.fils == null || !p.d.label.trim());
  const items: LineItem[] = parsed.map((p) => ({ key: p.d.key, label: p.d.label.trim(), fils: p.fils ?? 0, kind: p.d.kind }));
  const total = sumLines(items);
  const h = Number(hours);
  const hoursBad = !Number.isInteger(h) || h < 1 || h > 24 * 30;
  const upd = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = (kind: LineItem['kind']) => {
    setLines((ls) => [...ls, { key: `${kind}_${Date.now().toString(36)}_${seq}`, label: kind === 'discount' ? 'Discount' : 'Extra', aed: '', kind }]);
    setSeq((n) => n + 1);
  };
  const what = b.model === 'shortstay' ? 'offer' : b.model === 'court' ? 'slot offer' : 'quote';
  return (
    <>
      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        {counter && <Evid>Counter-offer: change the price and / or the dates. The dates stay held for the customer until the offer lapses.</Evid>}
        {!hasDates(b) && <Callout tone="info" title="This enquiry has no dates yet.">Add the dates you are offering.</Callout>}
        <DatesFields listing={l} value={d.v} onChange={d.setV} idPrefix={`of-${b.id}`} cls={DATES_CLS} now={now} />
        {d.price.error ? <Evid tone="bad">{d.price.error}</Evid> : (
          <div className="gx-btn-row">
            <span style={{ fontSize: 12, color: 'var(--ms-ink-3)' }}>List price for these {b.model === 'court' ? 'slot details' : 'dates'}: {formatAED(d.price.totalFils)}</span>
            <Btn size="xs" onClick={() => setLines(toDraft(d.price.lineItems))}>Use list price lines</Btn>
          </div>
        )}
        {counter && d.changed && <ConflictLine conflicts={d.conflicts} l={l} />}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {lines.map((d, i) => {
          const f = draftFils(d);
          return (
            <div key={d.key} style={{ display: 'grid', gap: 5, padding: 9, border: '1px solid var(--ms-border)', borderRadius: 8, background: d.kind === 'deposit_hold' ? 'var(--ms-surface-2)' : undefined }}>
              <input className="gx-inp" aria-label={`Line ${i + 1} label`} value={d.label} onChange={(e) => upd(i, { label: e.target.value })} />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <select className="gx-sel" aria-label={`Line ${i + 1} type`} style={{ width: 120 }} value={d.kind} onChange={(e) => upd(i, { kind: e.target.value as LineItem['kind'] })}>
                  {(Object.keys(KIND_LABEL) as LineItem['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>AED {d.kind === 'discount' ? '−' : ''}</span>
                <input className="gx-inp" aria-label={`Line ${i + 1} amount in AED`} inputMode="decimal" style={{ width: 120 }} value={d.aed} onChange={(e) => upd(i, { aed: e.target.value })} />
                <Btn size="xs" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove line</Btn>
              </div>
              {f == null && <div className="gx-err">Enter an amount in AED (up to 2 decimals)</div>}
              {d.kind === 'deposit_hold' && <div className="gx-hint">Card hold — shown to the customer, not charged.</div>}
            </div>
          );
        })}
        <div className="gx-btn-row">
          <Btn size="sm" onClick={() => add('fee')}>Add line</Btn>
          <Btn size="sm" onClick={() => add('discount')}>Add discount</Btn>
        </div>
      </div>
      <div style={{ margin: '12px 0', padding: '10px 12px', borderRadius: 8, background: 'var(--ms-tint-pale)', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>{what === 'offer' ? 'Offer' : 'Quote'} total</span><span>{formatAED(total)}</span>
      </div>
      <Field label="Valid for (hours)" htmlFor="off-hours" hint={`The customer must accept within this window (never past the start); ${isDirect(b) ? (b.model === 'venue' || b.model === 'charter' ? 'accepting makes it provisional until they pay you the deposit.' : 'accepting confirms the booking and they pay you directly.') : 'then they have to pay.'} Default ${RULES.offerValidHours[b.model]}h${b.model === 'venue' ? ` (${RULES.offerValidHours.venue / 24} days)` : ''}.`}
        error={hoursBad ? 'Whole hours, 1 to 720' : undefined}>
        <input id="off-hours" className="gx-inp" inputMode="numeric" style={{ width: 120 }} value={hours} onChange={(e) => setHours(e.target.value)} />
      </Field>
      <Field label="Note to the customer (optional)" htmlFor="off-note">
        <textarea id="off-note" className="gx-ta" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormButtons submit={`${opt.label} — ${formatAED(total)}`} disabled={bad || hoursBad || total <= 0 || lines.length === 0 || !!d.price.error || ms(d.m.start) <= now || (counter && d.changed && d.clash)} onCancel={onCancel}
        onSubmit={() => onSubmit({ type: 'send_offer', start: d.m.start, end: d.m.end, guests: d.m.guests, details: d.v.details, lineItems: items, validHours: h, note: note.trim() || undefined }, `${what[0].toUpperCase()}${what.slice(1)} sent — ${formatAED(total)}, valid ${h}h`)} />
    </>
  );
}

function ReplyForm({ onCancel, onSubmit }: FormProps) {
  const [text, setText] = useState('');
  return (
    <>
      <Field label="Reply" htmlFor="rep-text" hint="Replying stops the first-reply clock. No dates are held until the customer requests or accepts an offer.">
        <textarea id="rep-text" className="gx-ta" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <FormButtons submit="Send reply" disabled={!text.trim()} onCancel={onCancel} onSubmit={() => onSubmit({ type: 'reply', text }, 'Reply sent')} />
    </>
  );
}

function ClaimForm({ b, onCancel, onSubmit }: FormProps & { b: Booking }) {
  const hold = depositHoldFils(b);
  const [aed, setAed] = useState('');
  const [reason, setReason] = useState('');
  const fils = draftFils({ key: 'c', label: 'c', aed, kind: 'fee' });
  const err = fils == null ? (aed ? 'Enter an amount in AED' : undefined) : fils <= 0 ? 'Above zero' : fils > hold ? `At most ${formatAED(hold)}` : undefined;
  return (
    <>
      <Field label={`Claim amount (AED, up to ${formatAED(hold)})`} htmlFor="clm-aed" error={err}>
        <input id="clm-aed" className="gx-inp" inputMode="decimal" style={{ width: 160 }} value={aed} onChange={(e) => setAed(e.target.value)} />
      </Field>
      <Field label="Reason (shown to the customer)" htmlFor="clm-reason">
        <textarea id="clm-reason" className="gx-ta" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Broken glass table on the terrace" />
      </Field>
      <FormButtons danger submit={fils != null && !err ? `Claim ${formatAED(fils)} from deposit` : 'Claim from deposit'} disabled={fils == null || !!err || !reason.trim()} onCancel={onCancel}
        onSubmit={() => fils != null && onSubmit({ type: 'claim_deposit', fils, reason }, 'Deposit claim recorded — the rest of the hold is released')} />
    </>
  );
}

function PaymentForm({ b, opt, onCancel, onSubmit }: FormProps & { b: Booking; opt: Opt }) {
  const pid = opt.payload?.type === 'record_payment' ? opt.payload.paymentId : '';
  const p = b.payments.find((x) => x.id === pid);
  const direct = isDirect(b);
  const [method, setMethod] = useState<NonNullable<PaymentRecord['method']>>(
    direct ? (b.model === 'court' ? 'card_at_venue' : b.model === 'shortstay' ? 'cash' : 'bank_transfer') : b.model === 'court' ? 'pay_at_venue' : b.model === 'shortstay' ? 'card' : 'bank_transfer',
  );
  if (!p) return <Evid tone="bad">Payment not found.</Evid>;
  if (direct) {
    return (
      <>
        <Field label="How did you receive it?" htmlFor="pay-method" hint="The customer paid you directly — this only records it in UpNow. Nothing is charged.">
          <select id="pay-method" className="gx-sel" value={method} onChange={(e) => setMethod(e.target.value as DirectReceivedMethod)}>
            {DIRECT_RECEIVED_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </Field>
        <FormButtons submit={`Mark ${p.label.toLowerCase()} received — ${formatAED(p.fils)}`} onCancel={onCancel}
          onSubmit={() => onSubmit({ type: 'record_payment', paymentId: p.id, method }, `${p.label} marked received (${METHOD_LABEL[method].toLowerCase()})`)} />
      </>
    );
  }
  return (
    <>
      <Field label="How was it paid?" htmlFor="pay-method" hint="Recording a payment marks it paid in UpNow; nothing is charged.">
        <select id="pay-method" className="gx-sel" value={method} onChange={(e) => setMethod(e.target.value as NonNullable<PaymentRecord['method']>)}>
          <option value="pay_at_venue">Paid at venue (cash / card terminal)</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="card">Card</option>
        </select>
      </Field>
      <FormButtons submit={`Record ${p.label} as paid — ${formatAED(p.fils)}`} onCancel={onCancel}
        onSubmit={() => onSubmit({ type: 'record_payment', paymentId: p.id, method }, `${p.label} recorded as paid`)} />
    </>
  );
}

function VisitForm({ b, now, onCancel, onSubmit }: FormProps & { b: Booking; now: number }) {
  const startDay = dubaiYmd(ms(b.start));
  const initial = b.siteVisitAt ? ms(b.siteVisitAt) : Math.min(now + 2 * 86_400_000, ms(b.start) - 86_400_000);
  const [date, setDate] = useState(dubaiYmd(Math.max(initial, now)));
  const [time, setTime] = useState(b.siteVisitAt ? fmtDT(b.siteVisitAt).slice(-5) : '11:00');
  const at = dubaiMs(date, ...parseHm(time));
  const err = !Number.isFinite(at) ? 'Choose a date and time' : at <= now ? 'Pick a time in the future' : at >= ms(b.start) ? 'The visit must be before the event' : undefined;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Field label="Visit date" htmlFor="sv-date">
          <input id="sv-date" type="date" className="gx-inp" min={dubaiYmd(now)} max={startDay} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time (Dubai)" htmlFor="sv-time" error={err}>
          <input id="sv-time" type="time" className="gx-inp" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Evid>The customer sees the visit on their booking. It does not change the booking&apos;s status{isDirect(b) ? ' — the deposit is still paid to you directly' : ''}.</Evid>
      <div style={{ height: 8 }} />
      <FormButtons submit={b.siteVisitAt ? 'Reschedule site visit' : 'Schedule site visit'} disabled={!!err} onCancel={onCancel}
        onSubmit={() => onSubmit({ type: 'schedule_visit', at: new Date(at).toISOString() }, `Site visit ${b.siteVisitAt ? 'rescheduled' : 'scheduled'} for ${fmtDT(at)}`)} />
    </>
  );
}

/** A link to the listing's board, for headers. */
export function BoardLink({ b }: { b: Booking }) {
  return <Link href={`/rental-provider/dashboard/v/spaces/${b.model}`} className="gx-btn sm">Open {MODEL_LABEL[b.model].toLowerCase()} board</Link>;
}
