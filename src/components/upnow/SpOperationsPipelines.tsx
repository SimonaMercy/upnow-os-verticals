/**
 * SpOperationsPipelines — the Service-Provider Operations page as FOUR pipeline
 * trackers, one per tab: Requests · Quotes · Active Jobs · Closure. The SP twin
 * of OperationsPipelines (rentals): same design system (.opsp-page, reused via
 * OpsPipelineStyle), same pure-tracker contract — cards deep-link to the job
 * detail page; no inline actions, no drag.
 *
 * Lanes map the locked SP booking state machine (SP_MODULE_MASTER_SRS §1):
 *   booked → confirmed → assigned → en_route → in_progress → completed
 *   → escrow_release | dispute | cancelled
 * partitioned so a booking shows in exactly ONE tab:
 *   - Requests    booked / confirmed / assigned    (accept → schedule → assign)
 *   - Quotes      quote_after_callout bookings whose quote is not yet approved
 *                 (ServiceQuote: draft → submitted; approved re-enters Requests)
 *   - Active Jobs en_route / in_progress           (work happening today)
 *   - Closure     completed / dispute (sign-off → payout). "Payment released"
 *                 is an ESCROW fact: nothing ever writes booking status
 *                 escrow_release (unused enum member) — the booking stays
 *                 completed and the lane reads escrowStatus === 'released'
 *                 from the booking's escrow row instead (SP-255).
 *   - cancelled bookings are excluded (they live in the Jobs register).
 *
 * Data: GET bookingsPath (default /bookings). The booking engine ships in
 * SP Sprints 2–3 (SP_EXECUTION_PLAN_2026-07-02) — until the BookingsModule is
 * mounted the fetch 404s and this renders every pipeline's shape with zero
 * records, then lights up automatically once the API is live. All field access
 * is defensive because the FE↔BE booking contract is not final yet.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Search, X, RefreshCw, ClipboardList, CheckCircle2, ArrowRight,
  Inbox, FileText, Wrench, Wallet, LayoutList, Columns3, LayoutGrid,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { OpsPipelineStyle } from '@/components/upnow/OperationsPipelines';

/* ── Booking shape (defensive subset of the future GET /bookings) ──────────── */
export interface SpBooking {
  id: number;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  scheduledAt?: string | null;
  scheduledDate?: string | null;
  emirate?: string | null;
  areaName?: string | null;
  totalAmount?: number | null;
  price?: number | null;
  customer?: { name?: string | null; email?: string | null } | null;
  customerName?: string | null;
  service?: { name?: string | null; category?: string | null; pricingMode?: string | null } | null;
  serviceName?: string | null;
  category?: string | null;
  technician?: { name?: string | null } | null;
  quote?: { status?: string | null } | null;
  /** Status of the booking's escrow row ('held' | 'released' | 'refunded' | …). */
  escrowStatus?: string | null;
}

interface Props {
  /** Bookings endpoint (without /api), e.g. '/bookings'. */
  bookingsPath?: string;
  /** Deep-link to a booking's job detail page. */
  bookingHref?: (id: number) => string;
}

/* ── Tabs ──────────────────────────────────────────────────────────────────── */
export type SpPipelineTab = 'requests' | 'quotes' | 'active' | 'closure';
type TabKey = SpPipelineTab;
const TABS: { key: TabKey; label: string; icon: typeof Inbox }[] = [
  { key: 'requests', label: 'Requests',    icon: Inbox },
  { key: 'quotes',   label: 'Quotes',      icon: FileText },
  { key: 'active',   label: 'Active Jobs', icon: Wrench },
  { key: 'closure',  label: 'Closure',     icon: Wallet },
];

/* ── Stage lanes per pipeline (fixed, in lifecycle order) ──────────────────── */
interface StageDef { key: string; title: string; match: string[] }

const REQUEST_STAGES: StageDef[] = [
  { key: 'booked',    title: 'New request',         match: ['booked'] },
  { key: 'confirmed', title: 'Confirmed',           match: ['confirmed'] },
  { key: 'assigned',  title: 'Technician assigned', match: ['assigned'] },
];
// Quotes: lane = the ServiceQuote state (draft → submitted → awaiting customer).
// A booking with NO quote yet sits in the callout lane.
const QUOTE_STAGES: StageDef[] = [
  { key: 'callout',   title: 'Callout booked',  match: [] },
  { key: 'draft',     title: 'Quote drafted',   match: ['draft'] },
  { key: 'submitted', title: 'Sent to customer', match: ['submitted'] },
];
const ACTIVE_STAGES: StageDef[] = [
  { key: 'en_route',    title: 'En route',    match: ['en_route'] },
  { key: 'in_progress', title: 'In progress', match: ['in_progress'] },
];
// Closure lanes partition on TWO sources: Dispute reads the booking status;
// Payment released reads the escrow row (stageOf handles this — the match
// arrays here only cover the defensive booking-status fallback).
const CLOSURE_STAGES: StageDef[] = [
  { key: 'completed', title: 'Completion & sign-off', match: ['completed'] },
  { key: 'released',  title: 'Payment released',      match: ['escrow_release'] },
  { key: 'dispute',   title: 'Dispute',               match: ['dispute'] },
];
const STAGES_FOR_TAB: Record<TabKey, StageDef[]> = {
  requests: REQUEST_STAGES,
  quotes: QUOTE_STAGES,
  active: ACTIVE_STAGES,
  closure: CLOSURE_STAGES,
};

const REQUEST_SET = new Set(['booked', 'confirmed', 'assigned']);
const ACTIVE_SET = new Set(['en_route', 'in_progress']);
const CLOSURE_SET = new Set(['completed', 'escrow_release', 'dispute']);

/* ── Small helpers (same conventions as the rentals tracker) ───────────────── */
function daysSince(dateStr: string | null | undefined, nowMs: number): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}
function ageTone(d: number | null): 'fresh' | 'warn' | 'stale' | '' {
  if (d == null) return '';
  if (d >= 7) return 'stale';   // service jobs go stale much faster than leases
  if (d >= 3) return 'warn';
  return 'fresh';
}
function fmtWhen(d: string | null | undefined) {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short' })
    + ' · ' + t.toLocaleTimeString('en-AE', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' });
}
function fmtAed(n: number) { return n.toLocaleString('en-AE'); }
function initials(name: string | null) {
  if (!name) return '—';
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

/* ── Unified card view-model ───────────────────────────────────────────────── */
interface CardVM {
  key: string;
  name: string;            // customer
  sub: string;             // "Service · Emirate"
  ref: string;             // booking ref
  amountAed: number | null;
  when: string | null;     // scheduled slot
  href: string | null;
  stageKey: string;
  category: string | null;
  ageDays: number | null;
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase();

// Which pipeline a booking belongs to (null = cancelled / unknown → excluded).
// Exported so the SP dashboard's KPI + pipeline-snapshot counts always agree
// with the Operations page.
export function bookingPipeline(b: SpBooking): SpPipelineTab | null {
  const st = norm(b.status);
  if (st === 'cancelled') return null;
  // A quote-mode booking waits in Quotes until the customer approves; approval
  // (or a non-quote booking) flows through the normal status pipelines.
  const q = norm(b.quote?.status);
  const quotePending = (q === 'draft' || q === 'submitted')
    || (norm(b.service?.pricingMode) === 'quote' && REQUEST_SET.has(st) && !b.quote);
  if (quotePending && !ACTIVE_SET.has(st) && !CLOSURE_SET.has(st)) return 'quotes';
  if (REQUEST_SET.has(st)) return 'requests';
  if (ACTIVE_SET.has(st)) return 'active';
  if (CLOSURE_SET.has(st)) return 'closure';
  return null;
}

function stageOf(b: SpBooking, tab: TabKey): string {
  const stages = STAGES_FOR_TAB[tab];
  if (tab === 'quotes') {
    const q = norm(b.quote?.status);
    return stages.find(s => s.match.includes(q))?.key ?? 'callout';
  }
  const st = norm(b.status);
  if (tab === 'closure') {
    if (st === 'dispute') return 'dispute';
    if (st === 'escrow_release' || norm(b.escrowStatus) === 'released') return 'released';
    return 'completed';
  }
  return stages.find(s => s.match.includes(st))?.key ?? stages[0].key;
}

function toCard(b: SpBooking, tab: TabKey, href: string | null, nowMs: number): CardVM {
  const service = b.service?.name ?? b.serviceName ?? 'Service';
  const where = b.emirate ?? b.areaName ?? null;
  const amount = b.totalAmount ?? b.price ?? null;
  return {
    key: `b-${b.id}`,
    name: b.customer?.name ?? b.customerName ?? '—',
    sub: where ? `${service} · ${where}` : service,
    ref: `BK-${b.id}`,
    amountAed: amount != null ? Number(amount) : null,
    when: fmtWhen(b.scheduledAt ?? b.scheduledDate),
    href,
    stageKey: stageOf(b, tab),
    category: b.service?.category ?? b.category ?? null,
    ageDays: daysSince(b.updatedAt ?? b.createdAt, nowMs),
  };
}

export default function SpOperationsPipelines({
  bookingsPath = '/bookings',
  bookingHref = (id: number) => `/dashboard/service-provider/jobs/${id}`,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [nowMs] = useState(() => Date.now());
  const [bookings, setBookings] = useState<SpBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>(() => {
    const t = sp.get('tab'); return TABS.some(x => x.key === t) ? (t as TabKey) : 'requests';
  });
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [view, setView] = useState<'kanban' | 'list' | 'grid'>(() => {
    const v = sp.get('view'); return v === 'list' || v === 'grid' || v === 'kanban' ? v : 'kanban';
  });

  const syncUrl = (next: { tab?: TabKey; view?: string }) => {
    const params = new URLSearchParams(sp.toString());
    params.set('tab', next.tab ?? tab);
    params.set('view', next.view ?? view);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const selectTab = (k: TabKey) => { setTab(k); syncUrl({ tab: k }); };
  const selectView = (v: 'kanban' | 'list' | 'grid') => { setView(v); syncUrl({ view: v }); };

  // Tolerates every shape the endpoint may take while the engine is built:
  // a bare array, the stub's {data:[],total:0}, or a 404 before the module mounts.
  const load = useMemo(() => () =>
    apiGet<SpBooking[] | { data?: SpBooking[] }>(bookingsPath)
      .then(d => Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []))
      .catch(() => [] as SpBooking[])
      .then(setBookings),
    [bookingsPath]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const b of bookings) { const c = b.service?.category ?? b.category; if (c) s.add(c); }
    return [...s].sort();
  }, [bookings]);

  const matchSearch = (hay: (string | null | undefined)[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return hay.filter((x): x is string => Boolean(x)).join(' ').toLowerCase().includes(q);
  };

  const cardsByTab = useMemo(() => {
    const out: Record<TabKey, CardVM[]> = { requests: [], quotes: [], active: [], closure: [] };
    for (const b of bookings) {
      const t = bookingPipeline(b);
      if (!t) continue;
      const cat = b.service?.category ?? b.category ?? null;
      if (filterCat !== 'all' && cat !== filterCat) continue;
      if (!matchSearch([b.customer?.name, b.customerName, b.service?.name, b.serviceName, b.emirate, b.areaName, `BK-${b.id}`])) continue;
      out[t].push(toCard(b, t, bookingHref(b.id), nowMs));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, search, filterCat, bookingHref, nowMs]);

  const activeCards = cardsByTab[tab];
  const stages = STAGES_FOR_TAB[tab];
  const byStage = useMemo(() => {
    const m = new Map<string, CardVM[]>();
    for (const c of activeCards) { const a = m.get(c.stageKey) ?? []; a.push(c); m.set(c.stageKey, a); }
    // Oldest first within a lane — services work is a queue, not a completion race.
    for (const a of m.values()) a.sort((x, y) => (y.ageDays ?? 0) - (x.ageDays ?? 0));
    return m;
  }, [activeCards]);

  const orderIndex = new Map(stages.map((s, i) => [s.key, i]));
  const sortedCards = useMemo(() =>
    [...activeCards].sort((a, b) =>
      ((orderIndex.get(a.stageKey) ?? 0) - (orderIndex.get(b.stageKey) ?? 0)) || ((b.ageDays ?? 0) - (a.ageDays ?? 0))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCards, tab]);
  const stageTitleOf = (key: string) => stages.find(s => s.key === key)?.title ?? key;
  const cardTitle = (c: CardVM) => [
    c.name, c.ref, c.sub,
    c.amountAed != null ? `AED ${fmtAed(c.amountAed)}` : null,
    c.when,
    `Stage: ${stageTitleOf(c.stageKey)}`,
  ].filter(Boolean).join('\n');

  const vcard = (c: CardVM, showStage: boolean) => (
    <article key={c.key} className="card" title={cardTitle(c)}>
      <div className="c-top">
        <span className="av">{initials(c.name)}</span>
        <div className="c-id">
          <div className="c-name">{c.name}</div>
          <div className="c-ref">{c.ref}</div>
        </div>
        {showStage && <span className="c-stage">{stageTitleOf(c.stageKey)}</span>}
        {c.ageDays != null && (
          <span className={'age ' + ageTone(c.ageDays)} title={`${c.ageDays} day${c.ageDays === 1 ? '' : 's'} since last activity`}>{c.ageDays}d</span>
        )}
      </div>
      <div className="c-unit">{c.sub}</div>
      <div className="c-foot">
        <span className="rent">{c.amountAed != null ? `AED ${fmtAed(c.amountAed)}` : 'Quote'}</span>
        {c.when && <span className="term">{c.when}</span>}
      </div>
      {c.href
        ? <Link href={c.href} className="open">Open <ArrowRight size={12} /></Link>
        : <span className="open disabled">No detail</span>}
    </article>
  );

  const rrow = (c: CardVM) => (
    <div key={c.key} className="rrow" title={cardTitle(c)}>
      <span className="av">{initials(c.name)}</span>
      <div className="r-id">
        <div className="c-name">{c.name}</div>
        <div className="c-ref">{c.ref}</div>
      </div>
      <div className="r-sub">{c.sub}</div>
      <span className="c-stage">{stageTitleOf(c.stageKey)}</span>
      {c.ageDays != null && (
        <span className={'age ' + ageTone(c.ageDays)} title={`${c.ageDays} day${c.ageDays === 1 ? '' : 's'} since last activity`}>{c.ageDays}d</span>
      )}
      <span className="r-rent">{c.amountAed != null ? `AED ${fmtAed(c.amountAed)}` : 'Quote'}</span>
      <span className="r-term">{c.when ?? '—'}</span>
      {c.href
        ? <Link href={c.href} className="open">Open <ArrowRight size={12} /></Link>
        : <span className="open disabled">—</span>}
    </div>
  );

  const hasFilters = filterCat !== 'all' || search !== '';

  return (
    <div className="opsp-page">
      <main className="main">
        <div className="hero">
          <div className="left">
            <div className="eyebrow"><ClipboardList size={12} /> Operations</div>
            <h1>Booking <span className="accent">pipelines</span></h1>
            <p>Every booking in flight, from new request to payout. Pick a pipeline, see where each job sits, and <b>open</b> it to do the work on its detail page.</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <div className="pcards">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                className={'pcard' + (tab === t.key ? ' active' : '')}
                onClick={() => selectTab(t.key)}
                aria-pressed={tab === t.key}
              >
                <span className="pc-ic"><Icon size={14} /></span>
                <span className="pc-label">{t.label}</span>
                <span className="pc-val">{cardsByTab[t.key].length}</span>
              </button>
            );
          })}
        </div>

        <div className="filters">
          <div className="search">
            <span className="ic"><Search size={15} /></span>
            <input placeholder="Search customer, service, booking…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button type="button" className="clear" onClick={() => setSearch('')}><X size={14} /></button>}
          </div>
          <div className="sel-wrap">
            <select className="sel" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button type="button" className="reset" onClick={() => { setFilterCat('all'); setSearch(''); }}>
              <X size={12} /> Reset
            </button>
          )}
          <div className="viewtoggle" role="group" aria-label="View">
            <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => selectView('list')} title="List" aria-label="List view"><LayoutList size={15} /></button>
            <button type="button" className={view === 'kanban' ? 'on' : ''} onClick={() => selectView('kanban')} title="Kanban" aria-label="Kanban view"><Columns3 size={15} /></button>
            <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => selectView('grid')} title="Grid" aria-label="Grid view"><LayoutGrid size={15} /></button>
          </div>
          <span className="results">{activeCards.length} in {TABS.find(t => t.key === tab)?.label}</span>
        </div>

        {loading ? (
          <div className="empty"><p>Loading pipelines…</p></div>
        ) : view === 'kanban' ? (
          <div className="board">
            {stages.map(s => {
              const cards = byStage.get(s.key) ?? [];
              return (
                <section key={s.key} className="lane">
                  <header className="lane-head">
                    <span className="lane-title">{s.title}</span>
                    <span className="lane-count">{cards.length}</span>
                  </header>
                  <div className="lane-body">
                    {cards.map(c => vcard(c, false))}
                    {cards.length === 0 && <div className="lane-empty">No bookings</div>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : activeCards.length === 0 ? (
          <div className="empty">
            <div className="ic"><CheckCircle2 size={20} /></div>
            <h3>Nothing here</h3>
            <p>No bookings in the {TABS.find(t => t.key === tab)?.label} pipeline{hasFilters ? ' for these filters' : ''}. Switch to Kanban to see the stages.</p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid">{sortedCards.map(c => vcard(c, true))}</div>
        ) : (
          <div className="list">{sortedCards.map(c => rrow(c))}</div>
        )}

        {!loading && bookings.length === 0 && (
          <p style={{ marginTop: 14, fontSize: 12, color: 'var(--mute)', textAlign: 'center' }}>
            No bookings yet — the customer booking flow feeds these pipelines automatically once it goes live.
          </p>
        )}
      </main>
      <OpsPipelineStyle />
    </div>
  );
}
