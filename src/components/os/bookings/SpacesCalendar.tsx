'use client';

/**
 * Operations › Spaces calendar on the PREVIEW booking engine. One own listing at a time:
 *   • short stays & yacht charters → month grid, bookings as bars coloured by state, blocks hatched
 *   • courts → day view, one column per court, one row per slot (listing.slotMinutes)
 *   • venues → week view, hourly rows
 * "Block dates / Block slot" adds an availability block (maintenance / owner use / external
 * booking); blocks are listed under the calendar with a Remove button. Clicking a booking opens
 * the shared BookingDrawer. Enquiries and offers (which hold nothing) are drawn dashed.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Btn, Callout, Card, EmptyRow, Evid, Field, Modal, OsPage, PageHead, Pill, PreviewPill, ScopeStrip, TableWrap,
} from '@/components/os/kit';
import {
  DAY_MS, HOLDING_STATES, HOUR_MS, MIN_MS, MODEL_LABEL, STATE_TONE, dubaiParts, findConflicts, ms, rangesOverlap, stateLabelFor,
  type StateTone,
} from '@/lib/os/bookings/engine';
import { useNow } from '@/lib/os/bookings/store';
import type { AvailabilityBlock, Booking, CourtListing, PreviewListing } from '@/lib/os/bookings/types';
import { BookingDrawer } from './BookingDrawer';
import { BookingsPreview } from './DemoClock';
import {
  INBOX_HREF, MODEL_SHORT, boardHref, courtName, dayStart, dubaiMs, dubaiYmd, fmtDay, fmtMonth, fmtTime, parseHm, useOwn,
} from './shared';

const HIDDEN: Booking['state'][] = ['declined', 'expired', 'cancelled_by_customer', 'cancelled_by_provider', 'lost'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TONE_STYLE: Record<StateTone, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: 'var(--ms-surface-3)', fg: 'var(--ms-ink-2)', bd: 'var(--ms-border-strong)' },
  primary: { bg: 'var(--ms-tint)', fg: 'var(--ms-primary-dark)', bd: 'var(--ms-primary)' },
  amber: { bg: 'var(--ms-amber-bg)', fg: 'var(--ms-amber-text)', bd: 'var(--ms-amber)' },
  danger: { bg: 'var(--ms-danger-bg)', fg: 'var(--ms-danger)', bd: 'var(--ms-danger)' },
  info: { bg: 'var(--ms-info-bg)', fg: 'var(--ms-info)', bd: 'var(--ms-info)' },
  dark: { bg: 'var(--ms-primary-darkest)', fg: '#fff', bd: 'var(--ms-primary-darkest)' },
};
const BLOCK_STYLE: CSSProperties = {
  background: 'repeating-linear-gradient(135deg, var(--ms-surface-3), var(--ms-surface-3) 5px, var(--ms-surface-2) 5px, var(--ms-surface-2) 10px)',
  color: 'var(--ms-ink-2)', border: '1px solid var(--ms-border-strong)',
};
function bookingStyle(b: Booking): CSSProperties {
  const t = TONE_STYLE[STATE_TONE[b.state]];
  const holds = HOLDING_STATES.includes(b.state);
  return { background: holds || b.state === 'completed' || b.state === 'closed' || b.state === 'no_show' ? t.bg : 'transparent', color: t.fg, border: `1px ${holds || !['enquiry', 'offer_sent'].includes(b.state) ? 'solid' : 'dashed'} ${t.bd}` };
}

export function SpacesCalendar() {
  const { listings, bookings, blocks, store } = useOwn();
  const now = useNow(60_000);
  const [listingId, setListingId] = useState(listings[0]?.id ?? '');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const listing = listings.find((l) => l.id === listingId) ?? listings[0];

  const shown = useMemo(() => bookings.filter((b) => b.listingId === listing?.id && !HIDDEN.includes(b.state)), [bookings, listing]);
  const myBlocks = useMemo(() => blocks.filter((k) => k.listingId === listing?.id).sort((a, b) => ms(a.start) - ms(b.start)), [blocks, listing]);

  if (!listing) {
    return <OsPage><PageHead eyebrow="Demand" title="Bookings calendar" /><BookingsPreview /><Card pad><div className="gx-empty"><b>No listings</b>Your business has no short-stay, venue, court or yacht listings.</div></Card></OsPage>;
  }
  const kind = listing.model === 'court' ? 'day' : listing.model === 'venue' ? 'week' : 'month';
  const unit = kind === 'day' ? 'day' : kind === 'week' ? 'week' : 'month';

  return (
    <OsPage>
      <PageHead
        eyebrow="Demand"
        title="Bookings calendar"
        lede="Short-stay, venue, court and yacht bookings for one listing at a time — stays and charters by month, courts by day and slot, venues by week. Block dates or slots for maintenance, owner use or bookings taken elsewhere. (Long-term viewings are in the Viewings calendar.)"
        actions={<>
          <Btn href={INBOX_HREF}>All demand</Btn>
          <Btn href={boardHref(listing.model)}>{MODEL_LABEL[listing.model]} board</Btn>
          <Btn variant="primary" onClick={() => setBlocking(true)}>{listing.model === 'court' || listing.model === 'venue' ? 'Block a slot' : 'Block dates'}</Btn>
        </>}
      />
      <BookingsPreview />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Listing', value: listing.title },
        { label: 'Model', value: MODEL_LABEL[listing.model] },
        { label: 'Data', value: <PreviewPill /> },
      ]} />

      <div className="gx-btn-row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="gx-lb" style={{ margin: 0 }}>Listing</span>
          <select className="gx-sel" style={{ width: 300, maxWidth: '70vw' }} value={listing.id} onChange={(e) => { setListingId(e.target.value); setOffset(0); }}>
            {listings.map((l) => <option key={l.id} value={l.id}>{MODEL_SHORT[l.model]} · {l.title}</option>)}
          </select>
        </label>
        <div className="gx-btn-row">
          <Btn size="sm" onClick={() => setOffset((o) => o - 1)}>Previous {unit}</Btn>
          <Btn size="sm" onClick={() => setOffset(0)} disabled={offset === 0}>Today</Btn>
          <Btn size="sm" onClick={() => setOffset((o) => o + 1)}>Next {unit}</Btn>
        </div>
      </div>

      {kind === 'month' && <MonthGrid now={now} offset={offset} listing={listing} bookings={shown} blocks={myBlocks} onOpen={setOpenId} />}
      {kind === 'day' && listing.model === 'court' && <CourtDay now={now} offset={offset} listing={listing} bookings={shown} blocks={myBlocks} onOpen={setOpenId} />}
      {kind === 'week' && <VenueWeek now={now} offset={offset} bookings={shown} blocks={myBlocks} onOpen={setOpenId} />}

      <Legend />

      <div style={{ marginTop: 14 }}>
        <TableWrap toolbar={<><strong style={{ fontSize: 12.5 }}>Blocks on this listing</strong><span className="sp" /><Btn size="sm" onClick={() => setBlocking(true)}>Add block</Btn></>}>
          <table className="gx-tbl">
            <thead><tr><th>From</th><th>To</th>{listing.model === 'court' && <th>Court</th>}<th>Reason</th><th className="act">Action</th></tr></thead>
            {myBlocks.length === 0 ? <EmptyRow cols={listing.model === 'court' ? 5 : 4} title="No blocks" text="Every free date or slot is bookable." /> : (
              <tbody>
                {myBlocks.map((k) => (
                  <tr key={k.id}>
                    <td className="nowrap">{fmtDay(k.start)} {fmtTime(k.start)}</td>
                    <td className="nowrap">{fmtDay(k.end)} {fmtTime(k.end)}</td>
                    {listing.model === 'court' && <td>{k.courtId ? courtName(listing, k.courtId) : 'All courts'}</td>}
                    <td>{k.reason}</td>
                    <td className="act"><Btn size="sm" variant="danger" onClick={() => store.removeBlock(k.id)}>Remove block</Btn></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </TableWrap>
      </div>

      {blocking && <BlockModal listing={listing} now={now} onClose={() => setBlocking(false)} />}
      <BookingDrawer bookingId={openId} onClose={() => setOpenId(null)} />
    </OsPage>
  );
}

function Legend() {
  const items: { l: string; s: CSSProperties }[] = [
    { l: 'Enquiry / offer (not held)', s: { border: `1px dashed ${TONE_STYLE.info.bd}`, color: TONE_STYLE.info.fg } },
    { l: 'Request / hold / awaiting payment', s: { background: TONE_STYLE.amber.bg, color: TONE_STYLE.amber.fg, border: `1px solid ${TONE_STYLE.amber.bd}` } },
    { l: 'Confirmed / in progress', s: { background: TONE_STYLE.primary.bg, color: TONE_STYLE.primary.fg, border: `1px solid ${TONE_STYLE.primary.bd}` } },
    { l: 'Completed', s: { background: TONE_STYLE.dark.bg, color: TONE_STYLE.dark.fg } },
    { l: 'Blocked', s: BLOCK_STYLE },
  ];
  return (
    <div className="gx-btn-row" style={{ marginTop: 10, fontSize: 11, color: 'var(--ms-ink-3)' }}>
      {items.map((i) => (
        <span key={i.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 16, height: 10, borderRadius: 3, display: 'inline-block', ...i.s }} />{i.l}
        </span>
      ))}
    </div>
  );
}

function Bar({ children, style, onClick, title }: { children: ReactNode; style: CSSProperties; onClick?: () => void; title: string }) {
  const s: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', fontSize: 10, fontWeight: 700, lineHeight: 1.25, padding: '2px 5px', borderRadius: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', cursor: onClick ? 'pointer' : 'default', ...style };
  return onClick
    ? <button type="button" title={title} onClick={onClick} style={s}>{children}</button>
    : <div title={title} style={s}>{children}</div>;
}

// ---------------------------------------------------------------------------- month (stays, charters)

function MonthGrid({ now, offset, listing, bookings, blocks, onOpen }: {
  now: number; offset: number; listing: PreviewListing; bookings: Booking[]; blocks: AvailabilityBlock[]; onOpen: (id: string) => void;
}) {
  const p = dubaiParts(now);
  const mIdx = p.y * 12 + (p.m - 1) + offset;
  const y = Math.floor(mIdx / 12);
  const m = (mIdx % 12) + 1;
  const first = dubaiMs(`${y}-${String(m).padStart(2, '0')}-01`);
  const lead = (dubaiParts(first).dow + 6) % 7; // Monday-first
  const gridStart = first - lead * DAY_MS;
  const nextMonth = dubaiMs(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
  const weeks = Math.ceil((nextMonth - gridStart) / (7 * DAY_MS));
  const today = dayStart(now);
  const stay = listing.model === 'shortstay';
  const occupies = (b: Booking, d: number) => stay
    ? dayStart(ms(b.start)) <= d && d < dayStart(ms(b.end))
    : rangesOverlap(d, d + DAY_MS, ms(b.start), ms(b.end));

  return (
    <div className="gx-cal">
      <div style={{ padding: '8px 12px', fontWeight: 800, fontSize: 13, borderBottom: '1px solid var(--ms-border)' }}>{fmtMonth(first + 12 * HOUR_MS)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(92px, 1fr))', minWidth: 680 }}>
        {DOW.map((d) => <div key={d} className="gx-cal-h">{d}</div>)}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const d = gridStart + i * DAY_MS;
          const inMonth = d >= first && d < nextMonth;
          const dayBookings = bookings.filter((b) => occupies(b, d)).sort((a, b) => ms(a.start) - ms(b.start));
          const dayBlocks = blocks.filter((k) => rangesOverlap(d, d + DAY_MS, ms(k.start), ms(k.end)));
          const checkouts = stay ? bookings.filter((b) => dayStart(ms(b.end)) === d) : [];
          return (
            <div key={i} className={`gx-cal-c${d === today ? ' today' : ''}`} style={{ minHeight: 86, padding: '3px 2px', opacity: inMonth ? 1 : 0.45, display: 'grid', alignContent: 'start', gap: 2 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ms-ink-3)', padding: '0 3px' }}>{dubaiParts(d).d}</div>
              {checkouts.map((b) => (
                <div key={`co-${b.id}`} style={{ fontSize: 9.5, color: 'var(--ms-ink-3)', padding: '0 4px' }}>↳ {b.customer.name.split(' ')[0]} checks out</div>
              ))}
              {dayBookings.map((b) => {
                const startDay = dayStart(ms(b.start)) === d;
                const label = startDay || i % 7 === 0;
                return (
                  <Bar key={b.id} style={bookingStyle(b)} onClick={() => onOpen(b.id)}
                    title={`${b.customer.name} — ${stateLabelFor(b.model, b.state)} (${b.id})`}>
                    {label ? `${b.customer.name.split(' ')[0]} · ${stateLabelFor(b.model, b.state)}` : ' '}
                  </Bar>
                );
              })}
              {dayBlocks.map((k) => <Bar key={k.id} style={BLOCK_STYLE} title={`Blocked — ${k.reason}`}>Blocked · {k.reason}</Bar>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- day (courts)

function CourtDay({ now, offset, listing, bookings, blocks, onOpen }: {
  now: number; offset: number; listing: CourtListing; bookings: Booking[]; blocks: AvailabilityBlock[]; onOpen: (id: string) => void;
}) {
  const day = dayStart(now) + offset * DAY_MS;
  const close = day + listing.closeHour * HOUR_MS;
  // 24h clubs: start the grid at 06:00 unless something that day starts earlier.
  let firstHour = listing.openHour;
  if (listing.openHour === 0) {
    const hasEarly = [...bookings, ...blocks].some((x) => rangesOverlap(day, day + 6 * HOUR_MS, ms(x.start), ms(x.end)));
    firstHour = hasEarly ? 0 : 6;
  }
  const open = day + firstHour * HOUR_MS;
  const slot = listing.slotMinutes * MIN_MS;
  const n = Math.round((close - open) / slot);
  const rowOf = (t: number) => Math.round((Math.max(open, Math.min(close, t)) - open) / slot) + 2;
  const courts = listing.courts;
  const nowRow = now >= open && now < close ? Math.floor((now - open) / slot) + 2 : null;

  return (
    <div className="gx-cal" style={{ maxHeight: 640 }}>
      <div style={{ padding: '8px 12px', fontWeight: 800, fontSize: 13, borderBottom: '1px solid var(--ms-border)' }}>
        {fmtDay(day + 12 * HOUR_MS)} · {listing.sport} · {listing.slotMinutes}-minute slots{firstHour > listing.openHour ? ` · open 24h, showing from ${String(firstHour).padStart(2, '0')}:00` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${courts.length}, minmax(130px, 1fr))`, gridTemplateRows: `30px repeat(${n}, 24px)`, minWidth: 60 + courts.length * 130, position: 'relative' }}>
        <div className="gx-cal-h" style={{ gridRow: 1, gridColumn: 1, position: 'sticky', top: 0, zIndex: 2 }} />
        {courts.map((c, ci) => <div key={c.id} className="gx-cal-h" style={{ gridRow: 1, gridColumn: ci + 2, position: 'sticky', top: 0, zIndex: 2 }}>{c.name}</div>)}
        {Array.from({ length: n }, (_, r) => (
          <div key={`t${r}`} className="gx-cal-t" style={{ gridRow: r + 2, gridColumn: 1, padding: '3px 8px', background: nowRow === r + 2 ? 'var(--ms-amber-bg)' : undefined }}>
            {(open + r * slot - day) % HOUR_MS === 0 ? fmtTime(open + r * slot) : ''}
          </div>
        ))}
        {courts.map((c, ci) => Array.from({ length: n }, (_, r) => (
          <div key={`${c.id}-${r}`} className="gx-cal-c" style={{ gridRow: r + 2, gridColumn: ci + 2, minHeight: 0, padding: 0 }} />
        )))}
        {blocks.filter((k) => rangesOverlap(open, close, ms(k.start), ms(k.end))).map((k) => {
          const ci = k.courtId ? courts.findIndex((c) => c.id === k.courtId) : -1;
          return (
            <div key={k.id} style={{ gridRow: `${rowOf(ms(k.start))} / ${rowOf(ms(k.end))}`, gridColumn: ci >= 0 ? ci + 2 : `2 / ${courts.length + 2}`, padding: 2, zIndex: 1 }}>
              <Bar style={{ ...BLOCK_STYLE, height: '100%', whiteSpace: 'normal' }} title={`Blocked — ${k.reason}`}>Blocked · {k.reason}</Bar>
            </div>
          );
        })}
        {bookings.filter((b) => rangesOverlap(open, close, ms(b.start), ms(b.end))).map((b) => {
          const ci = courts.findIndex((c) => c.id === b.details.courtId);
          if (ci < 0) return null;
          return (
            <div key={b.id} style={{ gridRow: `${rowOf(ms(b.start))} / ${rowOf(ms(b.end))}`, gridColumn: ci + 2, padding: 2, zIndex: 1 }}>
              <Bar style={{ ...bookingStyle(b), height: '100%', whiteSpace: 'normal' }} onClick={() => onOpen(b.id)} title={`${b.customer.name} — ${stateLabelFor(b.model, b.state)} (${b.id})`}>
                {fmtTime(b.start)}–{fmtTime(b.end)} {b.customer.name}<br />{stateLabelFor(b.model, b.state)}
              </Bar>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- week (venues)

const V_FROM = 6;
const V_TO = 24;
function VenueWeek({ now, offset, bookings, blocks, onOpen }: {
  now: number; offset: number; bookings: Booking[]; blocks: AvailabilityBlock[]; onOpen: (id: string) => void;
}) {
  const today = dayStart(now);
  const monday = today - ((dubaiParts(now).dow + 6) % 7) * DAY_MS + offset * 7 * DAY_MS;
  const days = Array.from({ length: 7 }, (_, i) => monday + i * DAY_MS);
  const rows = V_TO - V_FROM;
  const place = (s: number, e: number, d: number) => {
    const a = Math.max(s, d + V_FROM * HOUR_MS);
    const z = Math.min(e, d + V_TO * HOUR_MS);
    if (z <= a) return null;
    return `${Math.floor((a - d) / HOUR_MS) - V_FROM + 2} / ${Math.ceil((z - d) / HOUR_MS) - V_FROM + 2}`;
  };

  return (
    <div className="gx-cal" style={{ maxHeight: 680 }}>
      <div style={{ padding: '8px 12px', fontWeight: 800, fontSize: 13, borderBottom: '1px solid var(--ms-border)' }}>
        Week of {fmtDay(monday + 12 * HOUR_MS)} – {fmtDay(days[6] + 12 * HOUR_MS)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, minmax(110px, 1fr))', gridTemplateRows: `30px repeat(${rows}, 30px)`, minWidth: 830 }}>
        <div className="gx-cal-h" style={{ gridRow: 1, gridColumn: 1, position: 'sticky', top: 0, zIndex: 2 }} />
        {days.map((d, i) => <div key={d} className="gx-cal-h" style={{ gridRow: 1, gridColumn: i + 2, position: 'sticky', top: 0, zIndex: 2, color: d === today ? 'var(--ms-primary-dark)' : undefined }}>{fmtDay(d + 12 * HOUR_MS)}</div>)}
        {Array.from({ length: rows }, (_, r) => (
          <div key={`t${r}`} className="gx-cal-t" style={{ gridRow: r + 2, gridColumn: 1 }}>{String(V_FROM + r).padStart(2, '0')}:00</div>
        ))}
        {days.map((d, di) => Array.from({ length: rows }, (_, r) => (
          <div key={`${d}-${r}`} className={`gx-cal-c${d === today ? ' today' : ''}`} style={{ gridRow: r + 2, gridColumn: di + 2, minHeight: 0, padding: 0 }} />
        )))}
        {days.flatMap((d, di) => blocks.map((k) => {
          const row = place(ms(k.start), ms(k.end), d);
          return row ? (
            <div key={`${k.id}-${d}`} style={{ gridRow: row, gridColumn: di + 2, padding: 2, zIndex: 1 }}>
              <Bar style={{ ...BLOCK_STYLE, height: '100%', whiteSpace: 'normal' }} title={`Blocked — ${k.reason}`}>Blocked · {k.reason}</Bar>
            </div>
          ) : null;
        }))}
        {days.flatMap((d, di) => bookings.map((b) => {
          const row = place(ms(b.start), ms(b.end), d);
          return row ? (
            <div key={`${b.id}-${d}`} style={{ gridRow: row, gridColumn: di + 2, padding: 2, zIndex: 1 }}>
              <Bar style={{ ...bookingStyle(b), height: '100%', whiteSpace: 'normal' }} onClick={() => onOpen(b.id)} title={`${b.customer.name} — ${stateLabelFor(b.model, b.state)} (${b.id})`}>
                {fmtTime(b.start)}–{fmtTime(b.end)} {b.customer.name}<br />{b.details.eventType ?? ''} · {b.guests} guests<br />{stateLabelFor(b.model, b.state)}
              </Bar>
            </div>
          ) : null;
        }))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- block form

const BLOCK_REASONS = ['Maintenance', 'Owner use', 'External booking'];

function BlockModal({ listing, now, onClose }: { listing: PreviewListing; now: number; onClose: () => void }) {
  const { store, bookings, blocks } = useOwn();
  const today = dubaiYmd(now);
  const slotted = listing.model === 'court' || listing.model === 'venue';
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [startT, setStartT] = useState(listing.model === 'court' ? `${String(Math.max(listing.openHour, 7)).padStart(2, '0')}:00` : '09:00');
  const [endT, setEndT] = useState(listing.model === 'court' ? `${String(Math.max(listing.openHour, 7) + 2).padStart(2, '0')}:00` : '13:00');
  const [courtId, setCourtId] = useState('');
  const [reason, setReason] = useState(BLOCK_REASONS[0]);
  const [note, setNote] = useState('');

  let start: number;
  let end: number;
  if (slotted) {
    const [sh, sm] = parseHm(startT);
    const [eh, em] = parseHm(endT);
    start = dubaiMs(from, sh, sm);
    end = endT === '00:00' ? dubaiMs(from) + DAY_MS : dubaiMs(from, eh, em);
  } else {
    start = dubaiMs(from);
    end = dubaiMs(to) + DAY_MS;
  }
  const invalid = !Number.isFinite(start) || !Number.isFinite(end) || end <= start;
  const conflicts = invalid ? null : findConflicts({ listingId: listing.id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), courtId: courtId || undefined, now }, bookings, blocks);
  const fullReason = note.trim() ? `${reason} — ${note.trim()}` : reason;

  const submit = () => {
    if (invalid) return;
    store.addBlock({ listingId: listing.id, courtId: courtId || undefined, start: new Date(start).toISOString(), end: new Date(end).toISOString(), reason: fullReason });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`${slotted ? 'Block a slot' : 'Block dates'} — ${listing.title}`}
      footer={<><span className="sp" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={invalid} onClick={submit}>Add block</Btn></>}>
      <div className="gx-two">
        <Field label={slotted ? 'Date' : 'From (first day)'} htmlFor="bl-from">
          <input id="bl-from" type="date" className="gx-inp" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        {slotted ? (
          <div className="gx-two">
            <Field label="Start" htmlFor="bl-st"><input id="bl-st" type="time" step={listing.model === 'court' ? listing.slotMinutes * 60 : 1800} className="gx-inp" value={startT} onChange={(e) => setStartT(e.target.value)} /></Field>
            <Field label="End" htmlFor="bl-et" hint="00:00 = midnight"><input id="bl-et" type="time" step={listing.model === 'court' ? listing.slotMinutes * 60 : 1800} className="gx-inp" value={endT} onChange={(e) => setEndT(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label="To (last day)" htmlFor="bl-to"><input id="bl-to" type="date" className="gx-inp" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        )}
      </div>
      {listing.model === 'court' && (
        <Field label="Court" htmlFor="bl-court">
          <select id="bl-court" className="gx-sel" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
            <option value="">All courts</option>
            {listing.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Reason" htmlFor="bl-reason">
        <select id="bl-reason" className="gx-sel" value={reason} onChange={(e) => setReason(e.target.value)}>
          {BLOCK_REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      <Field label="Note (optional)" htmlFor="bl-note">
        <input id="bl-note" className="gx-inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === 'External booking' ? 'e.g. Booked via phone' : 'e.g. Pool resurfacing'} />
      </Field>
      {invalid && <Callout tone="bad">The end must be after the start.</Callout>}
      {conflicts && (conflicts.bookings.length > 0 ? (
        <Callout tone="warn" title="Overlaps existing bookings.">
          {conflicts.bookings.map((b) => `${b.id} ${b.customer.name}`).join(', ')} — a block does not cancel them; it only stops new bookings.
        </Callout>
      ) : conflicts.blocks.length > 0 ? (
        <Evid tone="warn">Overlaps an existing block.</Evid>
      ) : (
        <Evid tone="ok">No bookings in this range.</Evid>
      ))}
      <div style={{ marginTop: 8 }}><Pill tone="outline" dot={false}>{slotted ? `${from} ${startT}–${endT}` : `${from} → ${to} (whole days)`}</Pill></div>
    </Modal>
  );
}
