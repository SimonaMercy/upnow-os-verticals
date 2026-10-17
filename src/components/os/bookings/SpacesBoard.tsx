'use client';

/**
 * Operations › Spaces model board (short stays, venues, courts, yacht charters) on the PREVIEW
 * booking engine. Columns are MODEL_FLOW[model]; each booking sits in boardColumnOf(booking)
 * (a venue request-to-book shows in the provisional-hold column). Ended bookings (declined,
 * expired, cancelled, no-show) leave the board for the Ended tab, which also lists closed ones. Click a card → BookingDrawer.
 * Cards show the payment model (On UpNow / Direct pay) and lead source. Columns only platform
 * bookings can reach (checkout hold, awaiting payment) are hidden when every listing of the
 * model is direct-pay and nothing sits in them; the direct-only "Awaiting deposit" (provisional)
 * column is hidden the same way for a platform-only business. Column titles use the same
 * stateLabelFor() words the customer sees on their booking.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Board, BoardCard, BoardCol, Btn, Card, EmptyRow, Flow, OsPage, PageHead, PreviewPill, ScopeStrip, Seg, TableWrap,
} from '@/components/os/kit';
import { DIRECT_ONLY_COLUMNS, MODEL_FLOW, MODEL_LABEL, PLATFORM_ONLY_COLUMNS, RULES, boardColumnOf, formatAED, isEnded, ms, sourceOf, stateLabelFor, timerOf } from '@/lib/os/bookings/engine';
import { useNow } from '@/lib/os/bookings/store';
import type { Booking, BookingModel } from '@/lib/os/bookings/types';
import { BookingDrawer } from './BookingDrawer';
import { BookingsPreview } from './DemoClock';
import {
  BOARD_TONE, CALENDAR_HREF, ENGINE_MODELS, INBOX_HREF, PayModePill, SourcePill, StatePill, TimerChip, boardHref, byUrgency, fmtDT, guestsText, useOwn, whenText,
} from './shared';

const DIRECT_NOTE = ' Direct-pay listings skip the card steps: you confirm (venues and yachts stay provisional until you mark the deposit received), the customer pays you directly and you mark payments received.';
const LEDE: Record<BookingModel, string> = {
  shortstay: `Holiday-home bookings from enquiry to check-out. Reply to enquiries within ${RULES.enquiryFirstReplyMin} minutes; requests hold the dates for 24h; the guest pays within 24h of acceptance; payout lands 24h after check-in; the damage-deposit claim window is 14 days.`,
  venue: `Event enquiries, versioned quotes (valid ${RULES.offerValidHours.venue / 24} days), provisional holds and staged deposits. Requests are answered within 48h; a provisional option lasts 7 days; the holding deposit is due in 3 days, the balance 14 days before the event.`,
  court: 'Court slots held for 10 minutes at checkout. Split shares settle 2h after the match; no check-in within 15 minutes of the start is a no-show; payout is weekly on Thursdays.',
  charter: 'Charter enquiries, quotes and requests. Requests are answered within 48h; deposit within 24h of acceptance, balance 48h before departure; the guest manifest is due by 18:00 the day before.',
};

export function SpacesBoard({ model }: { model: BookingModel }) {
  const { bookings, listings, byId } = useOwn();
  const now = useNow(30_000);
  const [view, setView] = useState<'board' | 'table' | 'ended'>('board');
  const [listingId, setListingId] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const mine = useMemo(() => listings.filter((l) => l.model === model), [listings, model]);
  const items = useMemo(
    () => bookings.filter((b) => b.model === model && (listingId === 'all' || b.listingId === listingId)),
    [bookings, model, listingId],
  );
  const live = useMemo(() => items.filter((b) => boardColumnOf(b) != null).sort(byUrgency(now)), [items, now]);
  const ended = useMemo(() => items.filter((b) => isEnded(b.state)).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt)), [items]);
  const anyPlatform = mine.some((l) => l.paymentMode !== 'direct');
  const anyDirect = mine.some((l) => l.paymentMode === 'direct');
  const cols = MODEL_FLOW[model].filter((c) => live.some((b) => boardColumnOf(b) === c)
    || ((anyPlatform || !PLATFORM_ONLY_COLUMNS[model].includes(c)) && (anyDirect || !DIRECT_ONLY_COLUMNS[model].includes(c))));

  const row = (b: Booking) => {
    const l = byId.get(b.listingId);
    return (
      <tr key={b.id} className="click" onClick={() => setOpenId(b.id)}>
        <td className="strong">{b.customer.name}<span className="sub mono">{b.id}</span></td>
        <td>{l?.title}<span className="sub">{whenText(b, l)}</span></td>
        <td>{guestsText(b)}</td>
        <td><StatePill b={b} /> <PayModePill b={b} />{sourceOf(b) !== 'form' && <> <SourcePill b={b} /></>}</td>
        <td>{isEnded(b.state) ? <span className="sub">Ended {fmtDT(b.updatedAt)}</span> : <TimerChip timer={timerOf(b, now)} />}</td>
        <td className="num">{formatAED(b.totalFils)}</td>
        <td className="act"><Btn size="sm" onClick={() => setOpenId(b.id)}>Open</Btn></td>
      </tr>
    );
  };

  return (
    <OsPage>
      <PageHead
        eyebrow="Operations"
        title={MODEL_LABEL[model]}
        lede={`${LEDE[model]}${anyDirect ? DIRECT_NOTE : ''}`}
        actions={<>
          <Btn href={CALENDAR_HREF}>Calendar</Btn>
          <Btn variant="primary" href={INBOX_HREF}>All demand</Btn>
        </>}
      />
      <BookingsPreview />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Spaces' },
        { label: 'Model', value: MODEL_LABEL[model] },
        { label: 'Data', value: <PreviewPill /> },
      ]} />

      <div className="gx-btn-row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <div className="gx-chips" role="group" aria-label="Switch booking model">
          {ENGINE_MODELS.map((m) => (
            <Link key={m} href={boardHref(m)} className="gx-chip" aria-pressed={m === model} aria-current={m === model ? 'page' : undefined}>{MODEL_LABEL[m]}</Link>
          ))}
        </div>
        <div className="gx-btn-row">
          {mine.length > 1 && (
            <select className="gx-sel" style={{ width: 230 }} aria-label="Filter by listing" value={listingId} onChange={(e) => setListingId(e.target.value)}>
              <option value="all">All {mine.length} listings</option>
              {mine.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          )}
          <Seg label="View" value={view} onChange={setView} options={[
            { v: 'board', l: 'Board', n: live.length }, { v: 'table', l: 'List' }, { v: 'ended', l: 'Ended', n: ended.length },
          ]} />
        </div>
      </div>

      {mine.length === 0 ? (
        <Card pad><div className="gx-empty"><b>No {MODEL_LABEL[model].toLowerCase()} listings</b>Your business has no listings of this kind yet.</div></Card>
      ) : view === 'board' ? (
        <Board>
          {cols.map((c) => {
            const col = live.filter((b) => boardColumnOf(b) === c);
            return (
              <BoardCol key={c} title={stateLabelFor(model, c)} count={col.length} tone={BOARD_TONE[model]}>
                {col.map((b) => {
                  const l = byId.get(b.listingId);
                  return (
                    <BoardCard
                      key={b.id}
                      t={b.customer.name}
                      m={<>{l?.title}<br />{whenText(b, l)} · {guestsText(b)}{b.state !== c ? <><br />{stateLabelFor(model, b.state)}</> : null}</>}
                      amt={formatAED(b.totalFils)}
                      tag={<span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}><TimerChip timer={timerOf(b, now)} /><PayModePill b={b} />{sourceOf(b) !== 'form' && <SourcePill b={b} />}</span>}
                      onClick={() => setOpenId(b.id)}
                    />
                  );
                })}
              </BoardCol>
            );
          })}
        </Board>
      ) : (
        <TableWrap>
          <table className="gx-tbl">
            <thead><tr><th>Customer</th><th>Listing</th><th>{model === 'court' ? 'Players' : 'Guests'}</th><th>Status</th><th>{view === 'ended' ? 'Ended' : 'Clock'}</th><th className="num">Total</th><th className="act">Action</th></tr></thead>
            {(view === 'ended' ? ended : live).length === 0
              ? <EmptyRow cols={7} title={view === 'ended' ? 'Nothing has ended yet' : 'No open bookings'} text={view === 'ended' ? 'Declined, expired, cancelled, no-show and closed bookings land here.' : undefined} />
              : <tbody>{(view === 'ended' ? ended : live).map(row)}</tbody>}
          </table>
        </TableWrap>
      )}

      <div style={{ marginTop: 14 }}>
        <Card title="Lifecycle" sub="The engine's stages for this model — each card shows the one clock that matters and whose turn it is">
          <div className="gx-pad"><Flow steps={cols.map((c) => stateLabelFor(model, c))} /></div>
        </Card>
      </div>

      <BookingDrawer bookingId={openId} onClose={() => setOpenId(null)} />
    </OsPage>
  );
}
