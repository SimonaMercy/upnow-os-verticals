'use client';

/**
 * Calendar — every dated event in one calendar, across every subcategory.
 *
 * Sources (GET only; nothing is written):
 *   • Viewings / site visits — long-term leads (GET /api/leads, viewings[].scheduledAt — the same
 *     data the Leads page's calendar view paints). Click → the lead page.
 *   • Lease milestones — GET /api/contracts (the contracts list's call): lease start, lease end and
 *     the 90-day renewal notice for live leases. Click → the contract page.
 *   • Maintenance visits — GET /api/maintenance/requests, only rows that carry a visit date
 *     (preferredAt / scheduledAt / visitAt). Click → the maintenance request.
 *   • Bookings — PREVIEW booking engine, own listings: stays (check-in → check-out), venue events,
 *     court slots, yacht charters, plus availability blocks. Click → the booking drawer.
 *
 * Tabs (?type=): All · Long-term leases · Holiday homes · Venues · Courts · Yachts. Category chips
 * toggle Viewings · Lease milestones · Maintenance · Bookings · Blocks. Views: Month · Week · Day ·
 * List (List by default on a phone). Days are Dubai days.
 */
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Btn, Callout, OsPage, PageHead, Seg } from '@/components/os/kit';
import { BookingDrawer } from '@/components/os/bookings/BookingDrawer';
import { dayStart, fmtDay, fmtMonth, fmtTime, useIsNarrow, useOwn, whenText } from '@/components/os/bookings/shared';
import { DAY_MS, dubaiParts, hasDates, ms, stateLabelFor } from '@/lib/os/bookings/engine';
import { useNow } from '@/lib/os/bookings/store';
import type { Booking } from '@/lib/os/bookings/types';
import { leadDisplayName, type ApiLead } from '@/lib/leadJourney';
import { PreviewTag, SubcatTabs, useSubcatParam, type Subcat } from '@/components/os/SubcatTabs';

const RP = '/rental-provider/dashboard';

type Cat = 'viewing' | 'milestone' | 'maintenance' | 'booking' | 'block';
type Color = 'viewing' | 'milestone' | 'maintenance' | 'shortstay' | 'venue' | 'court' | 'charter' | 'block';
const COLORS: Record<Color, { fg: string; bg: string; bd: string; label: string }> = {
  viewing: { fg: '#9d174d', bg: '#fce7f3', bd: '#db2777', label: 'Viewings & site visits' },
  milestone: { fg: '#0f4f36', bg: '#d8efe3', bd: '#047246', label: 'Lease milestones' },
  maintenance: { fg: '#7c4a1e', bg: '#f3e8dc', bd: '#a16207', label: 'Maintenance' },
  shortstay: { fg: '#1d4f8a', bg: '#e8eff9', bd: '#2f6fc4', label: 'Holiday homes' },
  venue: { fg: '#6b3d9a', bg: '#f1eafb', bd: '#8b5cc7', label: 'Venues' },
  court: { fg: '#9a3412', bg: '#ffedd5', bd: '#ea580c', label: 'Courts' },
  charter: { fg: '#0b6170', bg: '#e1f3f5', bd: '#1597a8', label: 'Yachts' },
  block: { fg: '#46534c', bg: '#eef1ef', bd: '#9aa39d', label: 'Availability blocks' },
};
const CATS: { v: Cat; l: string }[] = [
  { v: 'viewing', l: 'Viewings' }, { v: 'milestone', l: 'Lease milestones' }, { v: 'maintenance', l: 'Maintenance' },
  { v: 'booking', l: 'Bookings' }, { v: 'block', l: 'Blocks' },
];
const HIDDEN_STATES: Booking['state'][] = ['declined', 'expired', 'cancelled_by_customer', 'cancelled_by_provider', 'lost'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Ev {
  key: string;
  cat: Cat;
  color: Color;
  subcat: Exclude<Subcat, 'all'>;
  title: string;
  sub: string;
  start: number;
  /** End instant for spans (stays, charters, slots); null = a point in time / all-day marker. */
  end: number | null;
  allDay?: boolean;
  preview?: boolean;
  href?: string;
  bookingId?: string;
}

type ApiContract = { id: number; ref?: string; status: string; startDate: string | null; endDate: string | null; tenant?: { name?: string | null; companyName?: string | null } | null; unit?: { number?: string | null; name?: string | null } | null; property?: { buildingName?: string | null } | null };
type ApiMaint = { id: number; ref?: string; title?: string; stage?: string; preferredAt?: string | null; scheduledAt?: string | null; visitAt?: string | null; unit?: { unitNumber?: string | null; unitName?: string | null } | null; property?: { buildingName?: string | null } | null };

function useJson<T>(url: string): { data: T | null; failed: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setData(d as T); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);
  return { data, failed };
}
const arr = <T,>(d: unknown): T[] => (Array.isArray(d) ? d as T[] : Array.isArray((d as { items?: unknown })?.items) ? (d as { items: T[] }).items : []);

export default function CalendarPage() {
  return (
    <Suspense fallback={<OsPage><PageHead eyebrow="Calendar" title="Calendar" /></OsPage>}>
      <UnifiedCalendar />
    </Suspense>
  );
}

type View = 'month' | 'week' | 'day' | 'list';

function UnifiedCalendar() {
  const narrow = useIsNarrow();
  const now = useNow(60_000);
  const [sub, setSub] = useSubcatParam(['all', 'leases', 'shortstay', 'venue', 'court', 'charter']);
  const [viewPicked, setView] = useState<View | null>(null);
  const view: View = viewPicked ?? (narrow ? 'list' : 'month');
  const [cats, setCats] = useState<Record<Cat, boolean>>({ viewing: true, milestone: true, maintenance: true, booking: true, block: true });
  const [anchorPicked, setAnchor] = useState<number | null>(null);
  const anchor = anchorPicked ?? dayStart(now);
  const [openBooking, setOpenBooking] = useState<string | null>(null);

  const leadsQ = useJson<ApiLead[]>('/api/leads');
  const contractsQ = useJson<unknown>('/api/contracts');
  const maintQ = useJson<unknown>('/api/maintenance/requests?scope=all');
  const { bookings, blocks, byId } = useOwn();

  const events: Ev[] = useMemo(() => {
    const out: Ev[] = [];
    for (const x of arr<ApiLead>(leadsQ.data)) {
      for (const v of x.viewings ?? []) {
        const t = ms(v.scheduledAt);
        if (!Number.isFinite(t) || v.status === 'cancelled') continue;
        const unit = x.unit ? `${x.unit.unitName || x.unit.unitNumber}${x.unit.property?.buildingName ? ` · ${x.unit.property.buildingName}` : ''}` : 'No unit';
        out.push({ key: `V-${v.id}`, cat: 'viewing', color: 'viewing', subcat: 'leases', title: `Viewing · ${leadDisplayName(x)}`, sub: unit, start: t, end: null, href: `${RP}/leads/${x.id}` });
      }
    }
    for (const c of arr<ApiContract>(contractsQ.data)) {
      if (!['active', 'issued', 'pending'].includes(c.status)) continue;
      const who = c.tenant?.companyName || c.tenant?.name || 'Customer';
      const where = [c.unit?.name || c.unit?.number, c.property?.buildingName].filter(Boolean).join(' · ');
      const base = { cat: 'milestone' as const, color: 'milestone' as const, subcat: 'leases' as const, end: null, allDay: true, href: `${RP}/contracts/${c.id}` };
      const sd = c.startDate ? ms(c.startDate) : NaN;
      const ed = c.endDate ? ms(c.endDate) : NaN;
      if (Number.isFinite(sd)) out.push({ ...base, key: `CS-${c.id}`, title: `Lease starts · ${who}`, sub: where || c.ref || `Contract ${c.id}`, start: sd });
      if (Number.isFinite(ed)) {
        out.push({ ...base, key: `CE-${c.id}`, title: `Lease ends · ${who}`, sub: where || c.ref || `Contract ${c.id}`, start: ed });
        if (c.status === 'active') out.push({ ...base, key: `CR-${c.id}`, title: `Renewal notice (90 days) · ${who}`, sub: where || c.ref || `Contract ${c.id}`, start: ed - 90 * DAY_MS });
      }
    }
    for (const r of arr<ApiMaint>(maintQ.data)) {
      const at = r.scheduledAt || r.visitAt || r.preferredAt;
      const t = at ? ms(at) : NaN;
      if (!Number.isFinite(t)) continue;
      const where = [r.unit?.unitName || r.unit?.unitNumber, r.property?.buildingName].filter(Boolean).join(' · ');
      out.push({ key: `M-${r.id}`, cat: 'maintenance', color: 'maintenance', subcat: 'leases', title: `Maintenance · ${r.title ?? r.ref ?? r.id}`, sub: where, start: t, end: null, href: `${RP}/maintenance/${r.id}` });
    }
    for (const b of bookings) {
      if (HIDDEN_STATES.includes(b.state) || !hasDates(b)) continue;
      const l = byId.get(b.listingId);
      out.push({
        key: `B-${b.id}`, cat: 'booking', color: b.model, subcat: b.model, preview: true, bookingId: b.id,
        title: `${b.customer.name} · ${stateLabelFor(b.model, b.state)}`, sub: `${l?.title ?? b.listingId} · ${whenText(b, l)}`,
        start: ms(b.start), end: ms(b.end),
      });
    }
    for (const k of blocks) {
      const l = byId.get(k.listingId);
      if (!l) continue;
      out.push({ key: `K-${k.id}`, cat: 'block', color: 'block', subcat: l.model, preview: true, title: `Blocked · ${k.reason}`, sub: l.title, start: ms(k.start), end: ms(k.end), href: `${RP}/v/spaces/calendar` });
    }
    return out.sort((a, b) => a.start - b.start);
  }, [leadsQ.data, contractsQ.data, maintQ.data, bookings, blocks, byId]);

  const visible = useMemo(() => events.filter((e) => cats[e.cat] && (sub === 'all' || e.subcat === sub)), [events, cats, sub]);
  const tabCounts = useMemo(() => {
    const c: Partial<Record<Subcat, number>> = { all: 0 };
    for (const e of events) if (cats[e.cat]) { c.all = (c.all ?? 0) + 1; c[e.subcat] = (c[e.subcat] ?? 0) + 1; }
    return c;
  }, [events, cats]);

  /** Events touching the Dubai day starting at d. */
  const onDay = (d: number) => visible.filter((e) => {
    const s = dayStart(e.start);
    const end = e.end != null && e.end > e.start ? dayStart(e.end - 1) : s;
    return s <= d && d <= end;
  });

  // ---- navigation
  const p = dubaiParts(anchor);
  const monthStart = dayStart(Date.UTC(p.y, p.m - 1, 1) + 8 * 3_600_000);
  const weekStart = anchor - (((p.dow + 6) % 7) * DAY_MS);
  const step = (dir: 1 | -1) => {
    if (view === 'month' || view === 'list') setAnchor(dayStart(Date.UTC(p.y, p.m - 1 + dir, 1) + 8 * 3_600_000));
    else if (view === 'week') setAnchor(anchor + dir * 7 * DAY_MS);
    else setAnchor(anchor + dir * DAY_MS);
  };
  const title = view === 'month' || view === 'list' ? fmtMonth(anchor)
    : view === 'week' ? `${fmtDay(weekStart)} – ${fmtDay(weekStart + 6 * DAY_MS)}` : fmtDay(anchor);

  const failed = [leadsQ.failed && 'viewings', contractsQ.failed && 'lease milestones'].filter(Boolean);
  const today = dayStart(now);

  const open = (e: Ev) => { if (e.bookingId) setOpenBooking(e.bookingId); };

  return (
    <OsPage>
      <PageHead
        eyebrow="Calendar"
        title="Calendar"
        lede="Viewings, lease milestones, maintenance visits and every booking — holiday homes, venues, courts and yachts — in one calendar."
        actions={<>
          <Btn href={`${RP}/leads?view=calendar`}>Viewings calendar</Btn>
          <Btn href={`${RP}/v/spaces/calendar`}>Bookings calendar</Btn>
        </>}
      />
      <SubcatTabs value={sub} onChange={setSub} counts={tabCounts} options={['all', 'leases', 'shortstay', 'venue', 'court', 'charter']} label="Filter by subcategory" />

      <div className="gx-btn-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div className="gx-chips" role="group" aria-label="Filter by category">
          {CATS.map((c) => (
            <button key={c.v} type="button" className="gx-chip" aria-pressed={cats[c.v]} onClick={() => setCats((x) => ({ ...x, [c.v]: !x[c.v] }))}>
              {c.l} · {events.filter((e) => e.cat === c.v && (sub === 'all' || e.subcat === sub)).length}
            </button>
          ))}
        </div>
        <Seg<View> value={view} onChange={setView} label="Calendar view"
          options={[{ v: 'month', l: 'Month' }, { v: 'week', l: 'Week' }, { v: 'day', l: 'Day' }, { v: 'list', l: 'List' }]} />
      </div>

      {failed.length > 0 && (
        <div style={{ marginBottom: 10 }}><Callout tone="warn" title="Some events could not be loaded.">Missing: {failed.join(', ')}. Everything else is shown.</Callout></div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Btn size="sm" onClick={() => step(-1)} title="Previous"><ChevronLeft size={14} aria-hidden /> Prev</Btn>
        <Btn size="sm" onClick={() => setAnchor(today)}>Today</Btn>
        <Btn size="sm" onClick={() => step(1)} title="Next">Next <ChevronRight size={14} aria-hidden /></Btn>
        <h2 style={{ margin: '0 0 0 6px', fontSize: 16, fontWeight: 800 }}>{title}</h2>
      </div>

      <div style={{ border: '1px solid var(--ms-border)', borderRadius: 12, background: 'var(--ms-surface)', overflow: 'hidden' }}>
        {view === 'month' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', background: 'var(--ms-surface-2)', borderBottom: '1px solid var(--ms-border)' }}>
              {DOW.map((d) => <div key={d} style={{ padding: '6px 8px', fontSize: 10.5, fontWeight: 800, color: 'var(--ms-ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{d}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
              {Array.from({ length: 42 }, (_, i) => {
                const first = monthStart - (((dubaiParts(monthStart).dow + 6) % 7) * DAY_MS);
                const d = first + i * DAY_MS;
                const inMonth = dubaiParts(d).m === p.m;
                const evs = onDay(d);
                return (
                  <div key={i} style={{ minHeight: 104, padding: 5, borderRight: (i % 7) < 6 ? '1px solid var(--ms-surface-3)' : 0, borderBottom: i < 35 ? '1px solid var(--ms-surface-3)' : 0, background: inMonth ? undefined : 'var(--ms-surface-2)', minWidth: 0 }}>
                    <button type="button" onClick={() => { setAnchor(d); setView('day'); }}
                      style={{ border: 0, background: d === today ? 'var(--ms-primary)' : 'none', color: d === today ? '#fff' : inMonth ? 'var(--ms-ink)' : 'var(--ms-ink-3)', fontSize: 11.5, fontWeight: 700, borderRadius: 99, minWidth: 22, height: 22, cursor: 'pointer', padding: '0 5px' }}
                      aria-label={`Open ${fmtDay(d)}`}>{dubaiParts(d).d}</button>
                    <div style={{ display: 'grid', gap: 2, marginTop: 3 }}>
                      {evs.slice(0, 3).map((e) => <Chip key={e.key} e={e} onOpen={open} compact />)}
                      {evs.length > 3 && (
                        <button type="button" onClick={() => { setAnchor(d); setView('day'); }} style={{ border: 0, background: 'none', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--ms-primary-dark)', cursor: 'pointer', padding: '0 4px' }}>+{evs.length - 3} more</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === 'week' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
            {Array.from({ length: 7 }, (_, i) => {
              const d = weekStart + i * DAY_MS;
              const evs = onDay(d);
              return (
                <div key={i} style={{ minHeight: 360, borderRight: i < 6 ? '1px solid var(--ms-surface-3)' : 0, minWidth: 0 }}>
                  <button type="button" onClick={() => { setAnchor(d); setView('day'); }}
                    style={{ width: '100%', textAlign: 'left', padding: '7px 8px', borderWidth: '0 0 1px 0', borderStyle: 'solid', borderColor: 'var(--ms-border)', background: d === today ? 'var(--ms-tint-light)' : 'var(--ms-surface-2)', fontSize: 11.5, fontWeight: 800, color: d === today ? 'var(--ms-primary-dark)' : 'var(--ms-ink-2)', cursor: 'pointer' }}>
                    {fmtDay(d)}
                  </button>
                  <div style={{ display: 'grid', gap: 3, padding: 5 }}>
                    {evs.length === 0 && <span style={{ fontSize: 10.5, color: 'var(--ms-ink-disabled)', padding: '2px 4px' }}>—</span>}
                    {evs.map((e) => <Chip key={e.key} e={e} onOpen={open} showTime day={d} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === 'day' && (
          <AgendaDay d={anchor} evs={onDay(anchor)} onOpen={open} />
        )}

        {view === 'list' && (() => {
          const end = dayStart(Date.UTC(p.y, p.m, 1) + 8 * 3_600_000);
          const days: number[] = [];
          for (let d = monthStart; d < end; d += DAY_MS) if (onDay(d).length) days.push(d);
          if (!days.length) return <div className="gx-empty" style={{ padding: 24 }}><b>Nothing this month</b>No events match these tabs and categories in {fmtMonth(anchor)}.</div>;
          return <div>{days.map((d) => <AgendaDay key={d} d={d} evs={onDay(d)} onOpen={open} heading />)}</div>;
        })()}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10, fontSize: 11.5, color: 'var(--ms-ink-2)' }} aria-label="Legend">
        {(Object.keys(COLORS) as Color[]).map((c) => (
          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <i aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[c].bg, border: `1.5px solid ${COLORS[c].bd}`, display: 'inline-block' }} />{COLORS[c].label}
          </span>
        ))}
      </div>

      <BookingDrawer bookingId={openBooking} onClose={() => setOpenBooking(null)} />
    </OsPage>
  );
}

function chipStyle(e: Ev): CSSProperties {
  const c = COLORS[e.color];
  return {
    display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0, padding: '2px 5px', borderRadius: 5, textAlign: 'left',
    fontSize: 10.5, fontWeight: 600, lineHeight: 1.35, color: c.fg, background: e.cat === 'block'
      ? 'repeating-linear-gradient(135deg, #eef1ef, #eef1ef 4px, #f6f8f6 4px, #f6f8f6 8px)' : c.bg,
    borderLeft: `3px solid ${c.bd}`, borderTop: 0, borderRight: 0, borderBottom: 0, textDecoration: 'none', cursor: 'pointer', font: 'inherit',
  };
}

function timeLabel(e: Ev, day?: number): string {
  if (e.allDay) return 'All day';
  if (e.end != null && e.end - e.start >= DAY_MS) {
    if (day == null) return `${fmtDay(e.start)} → ${fmtDay(e.end)}`;
    if (dayStart(e.start) === day) return `From ${fmtTime(e.start)}`;
    if (dayStart(e.end - 1) === day) return `Until ${fmtTime(e.end)}`;
    return 'All day';
  }
  return e.end != null ? `${fmtTime(e.start)}–${fmtTime(e.end)}` : fmtTime(e.start);
}

function Chip({ e, onOpen, compact, showTime, day }: { e: Ev; onOpen: (e: Ev) => void; compact?: boolean; showTime?: boolean; day?: number }) {
  const inner = (
    <>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compact ? 'nowrap' : 'normal' }}>
        {showTime && <b style={{ fontWeight: 800 }}>{timeLabel(e, day)} </b>}{e.title}
      </span>
    </>
  );
  const title = `${e.title} — ${e.sub}${e.preview ? ' (preview data)' : ''}`;
  if (e.href) return <Link href={e.href} style={chipStyle(e)} title={title}>{inner}</Link>;
  return <button type="button" style={chipStyle(e)} title={title} onClick={() => onOpen(e)}>{inner}</button>;
}

function AgendaDay({ d, evs, onOpen, heading }: { d: number; evs: Ev[]; onOpen: (e: Ev) => void; heading?: boolean }) {
  return (
    <div>
      {heading && <div style={{ padding: '7px 12px', fontSize: 11.5, fontWeight: 800, color: 'var(--ms-ink-2)', background: 'var(--ms-surface-2)', borderBottom: '1px solid var(--ms-border)', borderTop: '1px solid var(--ms-border)' }}>{fmtDay(d)}</div>}
      {evs.length === 0 && <div className="gx-empty" style={{ padding: 24 }}><b>Nothing on {fmtDay(d)}</b>No events match these tabs and categories.</div>}
      {evs.map((e) => {
        const c = COLORS[e.color];
        const body = (
          <>
            <span style={{ width: 84, flex: 'none', fontSize: 11.5, fontWeight: 700, color: 'var(--ms-ink-2)' }}>{timeLabel(e, d)}</span>
            <i aria-hidden style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: c.bd, flex: 'none' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ms-ink)' }}>{e.title}</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--ms-ink-3)', marginTop: 1 }}>{e.sub}</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, color: c.fg, background: c.bg }}>{c.label}</span>
                {e.preview && <PreviewTag />}
              </span>
            </span>
          </>
        );
        const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', textDecoration: 'none', width: '100%', background: 'none', borderWidth: '0 0 1px 0', borderStyle: 'solid', borderColor: 'var(--ms-surface-3)', textAlign: 'left', cursor: 'pointer', font: 'inherit' };
        return e.href
          ? <Link key={e.key} href={e.href} style={rowStyle}>{body}</Link>
          : <button key={e.key} type="button" style={rowStyle} onClick={() => onOpen(e)}>{body}</button>;
      })}
    </div>
  );
}
