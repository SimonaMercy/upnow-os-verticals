/**
 * Activity report — a faithful build of the shared canvas ("Manager Activity Matrix").
 *
 * Three views over one scoped query, so no two figures on the page can disagree:
 *
 *   BY LANE  pipeline rail → lanes → the lane's whole action catalogue → the log
 *   MATRIX   time down, lanes across, heat-shaded and clickable → the log
 *   LIVE     the tape, as it happens
 *
 * The rail carries a sixth tab beneath the pipelines: PAGE VIEWS. It reads
 * `page_views`, not `audit_logs`, and it is its own tab rather than a fourth
 * view because presence is not work — a view has no lane, no wait and no
 * before → after, so it can neither sit on the board nor be listed in the
 * six-line record shape. Picking it swaps the two columns beside the rail for
 * the same drill shape: the pages opened → the tape of individual views.
 *
 * Every token here is lifted from the canvas rather than approximated:
 * page #f6f8f6 · panels #fff · rules #e4e9e5 · ink #14201a · mid #46534c ·
 * dim #5f6b63 · faint #8a948d · jade #047246 · deep #0f4f36 · amber #e8a020 ·
 * red #c2413b. Square corners throughout; Spline Sans Mono for every control,
 * figure and micro-label; Public Sans for prose.
 *
 * Backend: GET /api/reports/activity-log · GET /api/reports/activity-log/page-views
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { APP_TIME_ZONE } from '@/lib/datetime';
// There is no per-unit route — a unit is read in the Units workspace with its
// preview open, and this is the one place that destination is decided.
import { unitHref } from '@/lib/unitHref';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
// The canvas primitives — tokens, period picker, log table, filter bar. Shared
// with the Manager Activity Performance report so the two boards cannot drift.
import {
  A, DEEP, AMB, RED, INK, MID, DIM, FAINT, LINE, PANEL, PAGE, RAIL, TINT, TINT_RULE, MONO, SANS,
  ACTOR_COLOR, ACTOR_RGB, ACTOR_CHIP, ACTOR_WORD,
  todayISO, presetRange,
  micro, seg, navBtn, hcell, Seg, Label,
  PeriodPicker, LogTable, FilterBar, fmtWait,
  type Entry,
} from '@/components/upnow/activityLogKit';

/* ── types ────────────────────────────────────────────────────────────────── */
type ViewKey = 'phase' | 'matrix' | 'live';
type ActorKey = 'manager' | 'customer' | 'rp' | 'system' | 'all';

interface Bucket { key: string; label: string; sub: string; off: boolean; future: boolean }
interface LaneDef { id: string; name: string; pipe: string }
interface Phase { id: string; name: string; count: number; records: number; avgWaitHours: number; rework: number }
interface ActionRow {
  key: string; label: string; actor: string; lane: string;
  count: number; records: number; avgWaitHours: number; rework: number; slow: boolean;
}
interface Payload {
  window: { from: string | null; to: string | null; timezone: string; label: string };
  subject: string; view: ViewKey; pipe: string; actor: ActorKey;
  span: string; rowAxis: string;
  totals: { rows: number; onBoard: number; offBoard: number };
  kpis: Array<{ k: string; v: number }>;
  /** False on the "All activity" tab, where the log deliberately lists work the
   *  board cannot place and so stops matching the rail's lane counts. */
  boardOnly?: boolean;
  pipelines: Array<{ key: string; title: string; count: number }>;
  buckets: Bucket[];
  lanes: LaneDef[];
  matrix: { cells: number[][]; rework: number[][]; rowTotals: number[]; colTotals: number[]; grandTotal: number; max: number };
  phases: Phase[];
  focusLane: string;
  actions: ActionRow[];
  entries: Entry[];
  total: number; page: number; size: number; pages: number;
  filters: {
    people: Array<{ id: number; name: string; actor: string }>;
    properties: Array<{ id: number; name: string }>;
    units: Array<{ id: number; name: string }>;
  };
}

/**
 * Page views — presence, not writes. Its own tab and its own endpoint: the four
 * pipelines are built from `audit_logs`, and a view has no lane, no wait and no
 * before → after, so it cannot sit on the board or in the six-line record shape.
 * Counted beside the actions, never added to them — opening a page is not work
 * delivered.
 */
interface PvEntry {
  id: number; at: string; who: string | null; actor: string; portal: string;
  label: string; route: string; subject: string | null; href: string | null;
}
interface PvPayload {
  window: { from: string | null; to: string | null; timezone: string; label: string };
  subject: string; actor: ActorKey; person: number | null; pageKey: string | null;
  kpis: Array<{ k: string; v: number }>;
  byDay: Array<{ day: string; views: number }>;
  topPages: Array<{ key: string; label: string; route: string; views: number; people: number; lastAt: string | null }>;
  entries: PvEntry[];
  total: number; page: number; size: number; pages: number;
  filters: { people: Array<{ id: number; name: string; actor: string; views: number }> };
}

/**
 * Public visits — the traffic that arrives BEFORE anyone signs in.
 *
 * A different table (`page_visits`, 0155) written by a different beacon
 * (SiteHeader, no auth) from the one behind Page views (`page_views`, 0126,
 * mounted per dashboard layout). Kept as its own tab so the public/internal
 * split is a fact of where the row came from, not a filter someone has to
 * remember. The two are never summed — and neither is `listing_views`, which is
 * a SECOND beacon for the same listing-detail event.
 *
 * `yours` vs `platform` is the point: public traffic has no owner, so only
 * visits to this landlord's own listing pages are theirs.
 */
interface PubEntry {
  id: number; at: string; label: string; route: string; visitor: string;
  source: string; unitId: number | null; subject: string | null; signedIn: boolean;
}
interface PubPayload {
  window: { from: string | null; to: string | null; timezone: string; label: string };
  subject: string; pageKey: string | null; unitId: number | null;
  yours: Array<{ k: string; v: number }>;
  platform: Array<{ k: string; v: number }>;
  byDay: Array<{ day: string; views: number }>;
  yourListings: Array<{ unitId: number; label: string; visits: number; visitors: number; lastAt: string | null }>;
  topPages: Array<{ key: string; label: string; route: string; visits: number; visitors: number; lastAt: string | null }>;
  sources: Array<{ label: string; visits: number }>;
  entries: PubEntry[];
  total: number; page: number; size: number; pages: number;
}

/** The board's own tabs, plus the two presence tabs no pipeline can hold. */
type TabKey = 'lead' | 'newlease' | 'renewal' | 'terminated' | 'breach' | 'legal' | 'maintenance' | 'amc' | 'all' | 'pageviews' | 'publicvisits';
const VIEWS_TAB: TabKey = 'pageviews';
const PUBLIC_TAB: TabKey = 'publicvisits';

const VIEWS: Array<[ViewKey, string]> = [['phase', 'By lane'], ['matrix', 'Matrix'], ['live', 'Live']];
const ACTORS: Array<[ActorKey, string]> = [
  ['manager', 'Managers'], ['customer', 'Customers'], ['rp', 'Landlords'], ['system', 'System'], ['all', 'Everyone'],
];
/* ── view ─────────────────────────────────────────────────────────────────── */
export function ActivityLogView({ endpoint, backHref }: { endpoint: string; backHref: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [view, setView] = useState<ViewKey>('phase');
  const [actor, setActor] = useState<ActorKey>('all');
  const [person, setPerson] = useState<number | null>(null);
  // `tab` is what the reader clicked; `pipe` is the last PIPELINE among them.
  // Kept apart so switching to Page views and back does not refetch the board —
  // that query is the heaviest read on the page.
  const [tab, setTab] = useState<TabKey>('lead');
  const [pipe, setPipe] = useState('lead');
  const [preset, setPreset] = useState('This month');
  const [range, setRange] = useState<[string, string]>(() => presetRange('This month')!);
  const [prop, setProp] = useState<number | null>(null);
  const [unit, setUnit] = useState<number | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);
  const [lane, setLane] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);

  /* The two presence tabs live in their own state: their own fetch, their own
   * paging and their own drill, so nothing here can move the board's numbers. */
  const isViews = tab === VIEWS_TAB;
  const isPublic = tab === PUBLIC_TAB;
  /** Neither presence tab has a lane, a matrix or an actor to filter by. */
  const isPresence = isViews || isPublic;
  const [pv, setPv] = useState<PvPayload | null>(null);
  const [pvLoading, setPvLoading] = useState(false);
  const [pvErr, setPvErr] = useState<string | null>(null);
  const [pvKey, setPvKey] = useState<string | null>(null);
  const [pvPage, setPvPage] = useState(0);

  const [pub, setPub] = useState<PubPayload | null>(null);
  const [pubLoading, setPubLoading] = useState(false);
  const [pubErr, setPubErr] = useState<string | null>(null);
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [pubUnit, setPubUnit] = useState<number | null>(null);
  const [pubPage, setPubPage] = useState(0);

  /** Any coarser selection invalidates the finer ones beneath it. */
  const resetDrill = useCallback(() => {
    setBucket(null); setLane(null); setAction(null); setPage(0);
    setPvKey(null); setPvPage(0);
    setPubKey(null); setPubUnit(null); setPubPage(0);
  }, []);

  useEffect(() => {
    // The board query builds the matrix, the rail and the action catalogue from
    // a window over every event in scope. Neither presence tab needs any of it.
    if (isPresence) return;
    let alive = true;
    const qs = new URLSearchParams({
      view, pipe, actor, from: range[0], to: range[1], page: String(page), size: String(size),
    });
    if (person) qs.set('person', String(person));
    if (prop) qs.set('propertyId', String(prop));
    if (unit) qs.set('unitId', String(unit));
    if (bucket) qs.set('bucket', bucket);
    if (lane) qs.set('lane', lane);
    if (action) qs.set('action', action);
    Promise.resolve()
      .then(() => { if (alive) setLoading(true); })
      .then(() => fetch(`${endpoint}?${qs}`, { credentials: 'include' }))
      .then(async (r) => { if (!r.ok) throw new Error(`Failed to load (${r.status})`); return r.json(); })
      .then((j) => { if (alive) { setData(j); setErr(null); } })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpoint, isPresence, view, pipe, actor, person, range, prop, unit, bucket, lane, action, page, size]);

  useEffect(() => {
    if (!isViews) return;
    let alive = true;
    const qs = new URLSearchParams({
      actor, from: range[0], to: range[1], page: String(pvPage), size: String(size),
    });
    if (person) qs.set('person', String(person));
    if (pvKey) qs.set('pageKey', pvKey);
    Promise.resolve()
      .then(() => { if (alive) setPvLoading(true); })
      .then(() => fetch(`${endpoint}/page-views?${qs}`, { credentials: 'include' }))
      .then(async (r) => { if (!r.ok) throw new Error(`Failed to load (${r.status})`); return r.json(); })
      .then((j) => { if (alive) { setPv(j); setPvErr(null); } })
      .catch((e) => { if (alive) setPvErr(e.message); })
      .finally(() => { if (alive) setPvLoading(false); });
    return () => { alive = false; };
  }, [endpoint, isViews, actor, person, range, pvKey, pvPage, size]);

  useEffect(() => {
    if (!isPublic) return;
    let alive = true;
    // No actor and no person: these visitors are anonymous by construction.
    const qs = new URLSearchParams({
      from: range[0], to: range[1], page: String(pubPage), size: String(size),
    });
    if (pubKey) qs.set('pageKey', pubKey);
    if (pubUnit) qs.set('unitId', String(pubUnit));
    Promise.resolve()
      .then(() => { if (alive) setPubLoading(true); })
      .then(() => fetch(`${endpoint}/public-visits?${qs}`, { credentials: 'include' }))
      .then(async (r) => { if (!r.ok) throw new Error(`Failed to load (${r.status})`); return r.json(); })
      .then((j) => { if (alive) { setPub(j); setPubErr(null); } })
      .catch((e) => { if (alive) setPubErr(e.message); })
      .finally(() => { if (alive) setPubLoading(false); });
    return () => { alive = false; };
  }, [endpoint, isPublic, range, pubKey, pubUnit, pubPage, size]);

  // Only managers and landlords have named individuals to pick between. On the
  // Page views tab the roster is whoever actually READ something — a different
  // set, and the only one whose ids that tab's `person` filter understands.
  const people = useMemo(() => {
    const src: Array<{ id: number; name: string; actor: string }> =
      isViews ? (pv?.filters.people ?? []) : (data?.filters.people ?? []);
    return src.filter((p) => p.actor === actor);
  }, [isViews, pv, data, actor]);

  if (loading && !data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0', color: DIM, fontFamily: SANS }}>
      <Loader2 size={17} className="animate-spin" style={{ marginRight: 8 }} /> Loading activity…
    </div>;
  }
  if (err) {
    return <div style={{ maxWidth: 640, margin: '64px auto', border: '1px solid #f3d0d0', background: '#fdeeee', padding: 18, display: 'flex', gap: 10, fontFamily: SANS }}>
      <AlertCircle size={17} color={RED} />
      <div><p style={{ margin: 0, fontWeight: 700, color: INK }}>Could not load the activity report</p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: DIM }}>{err}</p></div>
    </div>;
  }
  if (!data) return null;

  const focus = data.phases.find((p) => p.id === (lane ?? data.focusLane));
  const laneActions = data.actions;
  const pageLabel = data.total
    ? `${data.page * data.size + 1}–${Math.min(data.total, (data.page + 1) * data.size)} of ${data.total}`
    : '0';
  const bucketLabel = data.buckets.find((b) => b.key === bucket)?.label ?? null;
  const actionLabel = action ? laneActions.find((a) => `${a.key}|${a.actor}` === action)?.label ?? null : null;
  const filterLabel = [
    bucketLabel,
    view === 'phase' ? data.pipelines.find((p) => p.key === pipe)?.title : null,
    lane ? `${lane} · ${data.lanes.find((l) => l.id === lane)?.name ?? ''}` : null,
    actionLabel,
  ].filter(Boolean).join('  ›  ') || 'All entries';
  const hasFilter = !!(bucket || lane || action);

  /* The rail's tabs: the four pipelines, "All activity", and the two presence
   * tabs — which join them there rather than anywhere new, because that rail IS
   * where this board's coarsest choice is made.
   *
   * Page views and Public visits are two tabs and not one because they are two
   * TABLES, written by two beacons: `page_views` needs a session, `page_visits`
   * cannot have one. Merging them would be the only way to produce a "traffic"
   * number nobody could take apart again. */
  const TABS: Array<{ key: TabKey; title: string; count: number | null; sub?: string }> = [
    ...data.pipelines.map((p) => ({ key: p.key as TabKey, title: p.title, count: p.count,
      sub: p.key === 'all' ? 'includes work with no lane' : undefined })),
    // The WINDOW's total, not `pv.total` — that one narrows with the page
    // drill, and a rail count that shrinks when you click inside the tab reads
    // as the tab having lost rows. Blank until the tab is first opened, because
    // nothing has been fetched to count.
    { key: VIEWS_TAB, title: 'Page views', count: pv ? (pv.kpis[0]?.v ?? pv.total) : null,
      sub: 'signed in · pages opened' },
    // YOUR listings, not the platform's 400. A landlord reading "Public visits
    // 400" beside their own name would take it for their reach; the platform
    // band is inside the tab, labelled as the platform's.
    { key: PUBLIC_TAB, title: 'Public visits', count: pub ? (pub.yours[0]?.v ?? 0) : null,
      sub: 'anonymous · your listings' },
  ];
  const pickTab = (k: TabKey) => {
    setTab(k);
    // Neither presence tab has a matrix or a tape of its own; both are only ever
    // shown in the By-lane frame, which is the one that carries the rail.
    if (k === VIEWS_TAB || k === PUBLIC_TAB) setView('phase'); else setPipe(k);
    resetDrill();
  };

  return (
    <div style={{ minHeight: '100vh', background: PAGE, display: 'flex', flexDirection: 'column', color: INK, fontFamily: SANS }}>

      {/* header */}
      <header style={{ background: PANEL, borderBottom: `1px solid ${LINE}`, padding: '15px 28px 0', display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <Link href={backHref} style={{ color: DIM, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-.015em', color: INK }}>Activity report</h1>
        <p style={{ margin: 0, font: `500 11px ${MONO}`, color: FAINT }}>
          {isPublic ? (pub?.subject ?? '—') : isViews ? (pv?.subject ?? '—') : data.subject}
        </p>
        <p style={{ margin: '0 0 0 auto', font: `500 11px ${MONO}`, color: DIM }}>{data.window.label}</p>
      </header>

      {/* controls · row 1 */}
      <div style={{ boxSizing: 'border-box', background: PANEL, borderBottom: `1px solid ${LINE}`,
        padding: '12px 28px 14px', display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {!isPresence && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>View</Label>
            <Seg items={VIEWS} value={view} onPick={(k) => { setView(k); resetDrill(); }} />
          </div>
        )}
        {/* A public visitor is anonymous by construction — there is no actor to
            pick, and offering the filter would imply the rows carry one. */}
        {!isPublic && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>{isViews ? 'Who read' : 'Who acted'}</Label>
            <Seg items={ACTORS} value={actor} onPick={(k) => { setActor(k); setPerson(null); resetDrill(); }} />
          </div>
        )}
        <PeriodPicker preset={preset} from={range[0]} to={range[1]} label={data.window.label}
          onApply={(p, f, t) => { setPreset(p); setRange([f, t]); resetDrill(); }} />
      </div>

      {/* controls · row 2 */}
      <div style={{ boxSizing: 'border-box', background: PANEL, borderBottom: `1px solid ${LINE}`,
        padding: '11px 28px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {people.length > 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Label minWidth={60}>{actor === 'rp' ? 'Landlord' : 'Manager'}</Label>
            <Seg
              items={[...people.map((p) => [String(p.id), p.name.split(' ')[0]] as [string, string]), ['all', 'Both']]}
              value={person ? String(person) : 'all'}
              onPick={(k) => { setPerson(k === 'all' ? null : Number(k)); resetDrill(); }} />
          </div>
        )}
        {/* A view or a visit names a ROUTE, not a lease — there is nothing to
            scope to a property or a unit, so the two pickers are hidden rather
            than left on screen doing nothing. */}
        {!isPresence && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 'auto' }}>
            <Label>Property</Label>
            <select value={prop ?? 'all'} onChange={(e) => { setProp(e.target.value === 'all' ? null : Number(e.target.value)); setUnit(null); resetDrill(); }}
              style={{ boxSizing: 'border-box', border: `1px solid ${LINE}`, background: PANEL, color: '#46534c',
                font: `600 10px ${MONO}`, letterSpacing: '.06em', padding: '6px 10px', cursor: 'pointer', minWidth: 150, borderRadius: 0 }}>
              <option value="all">All properties</option>
              {data.filters.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Label>Unit</Label>
            <select value={unit ?? 'all'} onChange={(e) => { setUnit(e.target.value === 'all' ? null : Number(e.target.value)); resetDrill(); }}
              style={{ boxSizing: 'border-box', border: `1px solid ${LINE}`, background: PANEL, color: '#46534c',
                font: `600 10px ${MONO}`, letterSpacing: '.06em', padding: '6px 10px', cursor: 'pointer', minWidth: 120, borderRadius: 0 }}>
              <option value="all">All units</option>
              {data.filters.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* band. Public visits gets TWO, side by side and separately labelled:
          only the first is this landlord's, and one merged row of figures is
          exactly how the platform's landing-page traffic would end up being
          read as their reach. */}
      {isPublic ? (
        <div style={{ boxSizing: 'border-box', background: TINT, borderBottom: `1px solid ${TINT_RULE}`,
          padding: '11px 28px 14px', display: 'flex', gap: 26, width: '100%', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: '0 0 auto' }}>
            <p style={{ ...micro, color: DEEP }}>Yours · your listing pages</p>
            <div style={{ display: 'flex', gap: 1 }}>
              {(pub?.yours ?? []).map((k, i) => (
                <div key={k.k} style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                  gap: 6, padding: '2px 16px 2px 0', minWidth: 128,
                  borderLeft: i ? `1px solid ${TINT_RULE}` : undefined, paddingLeft: i ? 16 : 0 }}>
                  <span style={{ font: `700 22px ${MONO}`, color: DEEP, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{k.v.toLocaleString()}</span>
                  <span style={{ font: `600 9.5px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: MID, lineHeight: 1.35 }}>{k.k}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: '1 1 0', minWidth: 320,
            borderLeft: `1px solid ${TINT_RULE}`, paddingLeft: 26 }}>
            <p style={{ ...micro, color: FAINT }}>Platform-wide · not yours, shown for context</p>
            <div style={{ display: 'flex', gap: 1, width: '100%' }}>
              {(pub?.platform ?? []).map((k, i) => (
                <div key={k.k} style={{ boxSizing: 'border-box', flex: '1 1 0', minWidth: 0, display: 'flex',
                  flexDirection: 'column', gap: 6, padding: '2px 12px',
                  borderLeft: i ? `1px solid ${TINT_RULE}` : undefined }}>
                  <span style={{ font: `700 19px ${MONO}`, color: MID, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{k.v.toLocaleString()}</span>
                  <span style={{ font: `600 9.5px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT, lineHeight: 1.35 }}>{k.k}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
      <div style={{ boxSizing: 'border-box', background: TINT, borderBottom: `1px solid ${TINT_RULE}`,
        padding: '11px 28px 14px', display: 'flex', flexDirection: 'column', gap: 9, width: '100%' }}>
        <p style={{ ...micro, color: DIM }}>
          {isViews ? 'Reading · whole period, every portal' : 'Outcomes · whole period, all stages'}
        </p>
        <div style={{ display: 'flex', gap: 1, width: '100%' }}>
          {(isViews ? (pv?.kpis ?? []) : data.kpis).map((k, i) => (
            <div key={k.k} style={{ boxSizing: 'border-box', flex: '1 1 0', minWidth: 0, display: 'flex',
              flexDirection: 'column', gap: 6, padding: '2px 12px',
              borderLeft: i ? `1px solid ${TINT_RULE}` : undefined }}>
              <span style={{ font: `700 22px ${MONO}`, color: DEEP, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{k.v.toLocaleString()}</span>
              <span style={{ font: `600 9.5px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: MID, lineHeight: 1.35 }}>{k.k}</span>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ── BY LANE ─────────────────────────────────────────────────────────
       * Also the frame for both presence tabs: the rail stays exactly where it
       * is and the two columns beside it swap to that tab's pages and tape. */}
      {(isPresence || view === 'phase') && (
        <div style={{ background: PANEL, borderBottom: `1px solid ${LINE}`, display: 'grid',
          // Handoff: `190px 300px minmax(430px,1fr)`. The 430px floor stops the
          // entries column collapsing under the diff text on a narrow laptop —
          // but it also gives the row a 920px hard minimum, so the container must
          // SCROLL rather than clip. With `overflow:hidden` the entries column and
          // its pager were simply unreachable between ~1024px and ~1160px wide.
          gridTemplateColumns: '190px 300px minmax(430px,1fr)', gridTemplateRows: 'minmax(0,1fr)',
          height: 560, overflowX: 'auto', overflowY: 'hidden' }}>

          {/* pipelines, and — set apart below them — page views */}
          <div style={{ overflow: 'auto', minHeight: 0, borderRight: `1px solid ${LINE}`, background: RAIL }}>
            <p style={{ ...micro, position: 'sticky', top: 0, background: RAIL, padding: '12px 18px 9px', borderBottom: `1px solid ${LINE}` }}>Pipeline</p>
            {TABS.map((t) => {
              const on = t.key === tab;
              // Neither "All activity" nor "Page views" is a fifth pipeline.
              // "All activity" is the way out of them — the only tab that lists
              // work with no board lane; "Page views" is not work at all. Both
              // are set apart so they do not read as stages of the journey.
              const apart = t.key === 'all' || t.key === VIEWS_TAB;
              return (
                <button key={t.key} onClick={() => pickTab(t.key)}
                  style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', border: 0,
                    borderBottom: '1px solid #eeece7', borderLeft: `3px solid ${on ? A : 'transparent'}`,
                    borderTop: apart ? `1px solid ${LINE}` : undefined,
                    marginTop: apart ? 10 : undefined,
                    background: on ? TINT : 'transparent', color: t.count ? (on ? DEEP : INK) : FAINT,
                    padding: '14px 18px', cursor: 'pointer', borderRadius: 0 }}>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: on ? 700 : 600, letterSpacing: '-.01em' }}>
                    {t.title}
                    {t.sub && (
                      <span style={{ display: 'block', marginTop: 2, font: `500 10px ${MONO}`, color: FAINT, letterSpacing: 0 }}>
                        {t.sub}
                      </span>
                    )}
                  </span>
                  <span style={{ font: `700 15px ${MONO}`, fontVariantNumeric: 'tabular-nums' }}>
                    {t.count == null ? '·' : t.count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>

          {/* PAGE VIEWS — the two columns beside the rail, swapped */}
          {isViews && (
            <PageViewsPanel
              pv={pv} loading={pvLoading} err={pvErr}
              pageKey={pvKey} onPickPage={(k) => { setPvKey(k); setPvPage(0); }}
              onPage={setPvPage} size={size} onSize={(n) => { setSize(n); setPvPage(0); }} />
          )}

          {/* PUBLIC VISITS — same two columns, the anonymous side */}
          {isPublic && (
            <PublicVisitsPanel
              pub={pub} loading={pubLoading} err={pubErr}
              pageKey={pubKey} unitId={pubUnit}
              onPickPage={(k) => { setPubKey(k); setPubUnit(null); setPubPage(0); }}
              onPickUnit={(u) => { setPubUnit(u); setPubKey(null); setPubPage(0); }}
              onPage={setPubPage} size={size} onSize={(n) => { setSize(n); setPubPage(0); }} />
          )}

          {/* lanes, then the focused lane's action catalogue */}
          {!isPresence && (<>
          <div style={{ overflow: 'auto', minHeight: 0, borderRight: `1px solid ${LINE}` }}>
            <p style={{ ...micro, position: 'sticky', top: 0, background: PANEL, padding: '12px 18px 9px',
              borderBottom: `1px solid ${LINE}`, zIndex: 1 }}>
              Lanes · {data.pipelines.find((p) => p.key === pipe)?.title}
            </p>
            {data.phases.map((p) => {
              const on = p.id === (lane ?? data.focusLane);
              const heavy = p.rework > p.count / 4 && p.count > 3;
              return (
                <button key={p.id} onClick={() => { if (!p.count) return; setLane(lane === p.id ? null : p.id); setAction(null); setPage(0); }}
                  style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', border: 0,
                    borderBottom: '1px solid #eeece7', borderLeft: `3px solid ${on ? A : 'transparent'}`,
                    background: on ? TINT : 'transparent', padding: '10px 18px',
                    cursor: p.count ? 'pointer' : 'default', borderRadius: 0 }}>
                  <span style={{ font: `700 10.5px ${MONO}`, letterSpacing: '.06em', minWidth: 26, textAlign: 'center', padding: '4px 0',
                    color: on ? '#fff' : p.count ? DEEP : FAINT,
                    background: on ? A : p.count ? '#d8efe3' : '#f0ede8' }}>{p.id}</span>
                  <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: p.count ? INK : FAINT, letterSpacing: '-.01em' }}>{p.name}</span>
                    <span style={{ font: `500 9.5px ${MONO}`, color: heavy ? AMB : FAINT }}>
                      {p.count ? `${p.records} records · avg wait ${fmtWait(p.avgWaitHours)}${heavy ? ` · ${p.rework} rework` : ''}` : 'no activity'}
                    </span>
                  </span>
                  <span style={{ font: `700 15px ${MONO}`, fontVariantNumeric: 'tabular-nums',
                    color: p.count ? (on ? A : INK) : FAINT }}>{p.count.toLocaleString()}</span>
                </button>
              );
            })}

            {/* focus header for the action catalogue below */}
            <div style={{ position: 'sticky', top: 37, background: PANEL, display: 'flex', gap: 9, alignItems: 'baseline',
              padding: '12px 18px 9px', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, zIndex: 1 }}>
              <span style={{ font: `600 10px ${MONO}`, letterSpacing: '.08em', color: A }}>{focus?.id ?? '—'}</span>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, letterSpacing: '-.015em', color: INK }}>
                {focus?.count ? focus.name : 'No activity in this window'}
              </p>
              {focus?.count ? (
                <span style={{ font: `500 9.5px ${MONO}`, color: FAINT, marginLeft: 'auto' }}>
                  {focus.records} records · avg wait {fmtWait(focus.avgWaitHours)}
                </span>
              ) : null}
            </div>

            {laneActions.map((a, i) => {
              const id = `${a.key}|${a.actor}`;
              const on = action === id;
              return (
                <button key={id} onClick={() => { if (!a.count) return; setAction(on ? null : id); setPage(0); }}
                  style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', border: 0,
                    borderBottom: '1px solid #f0ede8', borderLeft: `3px solid ${on ? A : 'transparent'}`,
                    background: on ? '#eef7f2' : PANEL, padding: '10px 18px',
                    cursor: a.count ? 'pointer' : 'default', opacity: a.count ? 1 : 0.55, borderRadius: 0 }}>
                  <span style={{ font: `600 10px ${MONO}`, color: FAINT, minWidth: 16 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, letterSpacing: '-.01em' }}>{a.label}</span>
                      {a.slow && (
                        <span style={{ font: `600 9px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase',
                          padding: '2px 5px', color: RED, background: 'rgba(212,63,63,.12)' }}>slow</span>
                      )}
                    </span>
                    <span style={{ font: `500 9.5px ${MONO}`, color: FAINT }}>
                      {a.count ? `${ACTOR_WORD[a.actor]} · avg wait ${fmtWait(a.avgWaitHours)}` : `${ACTOR_WORD[a.actor]} · nothing in this window`}
                    </span>
                  </span>
                  <span style={{ font: `700 14px ${MONO}`, fontVariantNumeric: 'tabular-nums',
                    color: a.count ? (on ? A : INK) : FAINT }}>{a.count}</span>
                </button>
              );
            })}
          </div>

          {/* the log */}
          <div style={{ overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <FilterBar pad="10px 20px 9px" label={filterLabel} hasFilter={hasFilter} onClear={resetDrill}
              pageLabel={pageLabel} page={data.page} pages={data.pages} onPage={setPage} />
            <LogTable entries={data.entries} compact />
          </div>
          </>)}
        </div>
      )}

      {/* ── MATRIX ──────────────────────────────────────────────────────── */}
      {!isViews && view === 'matrix' && (
        <>
          <div style={{ background: PANEL, padding: '0 28px', overflow: 'auto', maxHeight: '54vh', borderBottom: `1px solid ${LINE}` }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 760, tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, background: PANEL, textAlign: 'left',
                    font: `500 9.5px ${MONO}`, letterSpacing: '.14em', textTransform: 'uppercase', color: FAINT,
                    padding: '12px 10px 10px 0', borderBottom: `1px solid ${LINE}` }}>{data.rowAxis}</th>
                  {data.lanes.map((c) => (
                    <th key={c.id} title={`${c.id} · ${c.name}`}
                      style={{ position: 'sticky', top: 0, zIndex: 2, boxSizing: 'border-box', background: PANEL,
                        font: `500 10px ${MONO}`, color: DIM, padding: '12px 2px 10px', borderBottom: `1px solid ${LINE}`, width: 34 }}>{c.id}</th>
                  ))}
                  <th style={{ position: 'sticky', top: 0, right: 0, zIndex: 4, boxSizing: 'border-box', background: PANEL,
                    font: `600 10px ${MONO}`, letterSpacing: '.1em', color: DEEP, padding: '12px 0 10px 12px',
                    borderBottom: `1px solid ${LINE}`, borderLeft: `1px solid ${LINE}`, width: 62 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.map((b, ri) => {
                  const rowSel = bucket === b.key && !lane;
                  const tot = data.matrix.rowTotals[ri];
                  return (
                    <tr key={b.key}>
                      <th style={{ position: 'sticky', left: 0, zIndex: 1, background: PANEL, textAlign: 'left',
                        whiteSpace: 'nowrap', font: `600 11px ${MONO}`, padding: '8px 12px 8px 0',
                        borderBottom: '1px solid #f0ede8',
                        color: b.off || b.future ? FAINT : tot ? INK : DIM }}>
                        {b.label}<span style={{ color: FAINT, fontWeight: 400 }}> {b.sub}</span>
                      </th>
                      {data.lanes.map((c, ci) => {
                        const n = data.matrix.cells[ri][ci];
                        const rw = data.matrix.rework[ri][ci];
                        const sel = bucket === b.key && lane === c.id;
                        // Heat: 12% floor so a single step is still visible,
                        // amber when the cell contains rework.
                        const t = n ? 0.12 + (n / data.matrix.max) * 0.88 : 0;
                        const bg = b.future ? 'repeating-linear-gradient(45deg,#f0ede8 0 3px,#f6f8f6 3px 6px)'
                          : b.off ? '#eef1ef'
                          : n ? (rw > 0 ? `rgba(232,160,32,${t})` : `rgba(${ACTOR_RGB[actor] ?? '46,159,130'},${t})`)
                          : 'transparent';
                        return (
                          <td key={c.id} style={{ padding: 0, borderBottom: '1px solid #f0ede8' }}>
                            <button
                              title={`${b.label} · ${c.id} · ${c.name} — ${n} steps${rw ? `, ${rw} rework` : ''}`}
                              onClick={() => { if (b.off || b.future || !n) return; setBucket(sel ? null : b.key); setLane(sel ? null : c.id); setAction(null); setPage(0); }}
                              style={{ width: '100%', border: 0, background: bg, borderRadius: 0,
                                font: `600 11px ${MONO}`, fontVariantNumeric: 'tabular-nums', padding: '8px 0',
                                cursor: n && !b.off && !b.future ? 'pointer' : 'default', textAlign: 'center', display: 'block',
                                color: n ? (t > 0.5 ? '#fff' : INK) : FAINT,
                                outline: sel ? `2px solid ${DEEP}` : undefined, outlineOffset: sel ? -2 : undefined }}>
                              {n || (b.off ? 'off' : b.future ? '·' : '0')}
                            </button>
                          </td>
                        );
                      })}
                      <td style={{ position: 'sticky', right: 0, zIndex: 2, boxSizing: 'border-box', background: PANEL,
                        padding: 0, width: 62, borderLeft: `1px solid ${LINE}`, borderBottom: '1px solid #f0ede8' }}>
                        <button onClick={() => { if (b.off || b.future || !tot) return; setBucket(rowSel ? null : b.key); setLane(null); setAction(null); setPage(0); }}
                          style={{ width: '100%', border: 0, background: 'transparent', borderRadius: 0,
                            font: `600 11px ${MONO}`, fontVariantNumeric: 'tabular-nums', padding: '8px 0 8px 12px',
                            cursor: tot ? 'pointer' : 'default', textAlign: 'center', display: 'block',
                            color: b.future ? FAINT : tot ? DEEP : FAINT,
                            outline: rowSel ? `2px solid ${DEEP}` : undefined, outlineOffset: rowSel ? -2 : undefined }}>
                          {b.off ? 'off' : b.future ? '·' : tot}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: PANEL, textAlign: 'left', font: `600 10px ${MONO}`,
                    letterSpacing: '.1em', textTransform: 'uppercase', color: DEEP, padding: '11px 10px 11px 0', borderTop: `1px solid ${LINE}` }}>Total</th>
                  {data.lanes.map((c, ci) => {
                    const n = data.matrix.colTotals[ci];
                    const sel = lane === c.id && !bucket;
                    return (
                      <td key={c.id} style={{ borderTop: `1px solid ${LINE}`, padding: 0 }}>
                        <button onClick={() => { if (!n) return; setLane(sel ? null : c.id); setBucket(null); setAction(null); setPage(0); }}
                          style={{ width: '100%', border: 0, background: 'transparent', borderRadius: 0,
                            font: `600 11px ${MONO}`, fontVariantNumeric: 'tabular-nums', padding: '11px 0',
                            cursor: n ? 'pointer' : 'default', textAlign: 'center', display: 'block',
                            color: n ? DEEP : FAINT,
                            outline: sel ? `2px solid ${DEEP}` : undefined, outlineOffset: sel ? -2 : undefined }}>{n || '0'}</button>
                      </td>
                    );
                  })}
                  <td style={{ position: 'sticky', right: 0, zIndex: 2, boxSizing: 'border-box', background: PANEL, width: 62,
                    borderTop: `1px solid ${LINE}`, borderLeft: `1px solid ${LINE}`, textAlign: 'center',
                    font: `700 12px ${MONO}`, color: DEEP, fontVariantNumeric: 'tabular-nums', padding: '11px 0' }}>{data.matrix.grandTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ padding: '12px 28px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${LINE}` }}>
            <p style={{ margin: 0, font: `600 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: '#46534c' }}>{filterLabel}</p>
            {hasFilter && (
              <button onClick={resetDrill} style={{ border: `1px solid ${LINE}`, background: PANEL, color: DIM,
                font: `500 10px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', padding: '5px 9px', cursor: 'pointer', borderRadius: 0 }}>clear</button>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
              <p style={{ margin: 0, font: `500 11px ${MONO}`, color: DIM }}>{pageLabel}</p>
              <button disabled={data.page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={navBtn(data.page > 0)}>←</button>
              <button disabled={data.page >= data.pages - 1} onClick={() => setPage((p) => p + 1)} style={navBtn(data.page < data.pages - 1)}>→</button>
              <div style={{ display: 'flex', border: `1px solid ${LINE}` }}>
                {[25, 50, 100].map((n, i) => (
                  <button key={n} onClick={() => { setSize(n); setPage(0); }}
                    style={{ ...seg(size === n, i === 0), padding: '5px 10px' }}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '0 28px 60px', background: PANEL }}>
            <LogTable entries={data.entries} />
          </div>
        </>
      )}

      {/* ── LIVE ────────────────────────────────────────────────────────── */}
      {!isViews && view === 'live' && (
        <div style={{ background: PANEL, borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', gap: 1, background: LINE, borderBottom: `1px solid ${LINE}` }}>
            {data.pipelines.map((p) => (
              <div key={p.key} style={{ flex: 1, background: PANEL, padding: '15px 20px', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ font: `600 9.5px ${MONO}`, letterSpacing: '.14em', textTransform: 'uppercase', color: DIM }}>{p.title}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ font: `700 24px ${MONO}`, color: INK, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{p.count.toLocaleString()}</span>
                  <span style={{ font: `500 10px ${MONO}`, color: FAINT }}>steps in window</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'sticky', top: 0, background: PANEL, zIndex: 1, display: 'flex', gap: 10,
              alignItems: 'center', padding: '11px 20px 9px', borderBottom: `1px solid ${LINE}` }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: A }} />
              <p style={{ margin: 0, font: `600 10px ${MONO}`, letterSpacing: '.14em', textTransform: 'uppercase', color: '#46534c' }}>Live tape</p>
              <p style={{ margin: '0 0 0 auto', font: `500 10px ${MONO}`, color: FAINT }}>{data.total.toLocaleString()} on tape</p>
            </div>
            {data.entries.map((e) => {
              const chip = ACTOR_CHIP[e.actor] ?? ACTOR_CHIP.system;
              const diff = (e.changed ?? []).map((c) => `${c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`).join('  ·  ');
              return (
                <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 20px', borderBottom: '1px solid #f0ede8' }}>
                  <span style={{ font: `500 10.5px ${MONO}`, color: DIM, minWidth: 44 }}>
                    {new Date(e.at).toLocaleTimeString('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ font: `700 9px ${MONO}`, color: chip[1], background: chip[2], padding: '3px 5px' }}>{chip[0]}</span>
                  <span style={{ font: `700 9px ${MONO}`, background: '#d8efe3', color: DEEP, padding: '3px 5px' }}>{e.lane ?? '—'}</span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, letterSpacing: '-.01em' }}>
                      {e.label} <span style={{ fontWeight: 400, color: DIM }}>· {e.cid ?? '—'}</span>
                    </span>
                    {diff && <span style={{ font: `11px ${MONO}`, color: MID }}>{diff}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p style={{ padding: '14px 28px 40px', font: `500 11px ${MONO}`, color: FAINT, lineHeight: 1.6 }}>
        {isPublic ? (
          <>
            Public traffic is anonymous by construction — a per-day hash of address and browser, never a person, and never joined to
            one. It lives in its own table because it is written before anyone signs in, so it is never added to Page views, and never
            to the listing-detail beacon that records the same visit a second time. Only your own listing pages are yours; the
            platform band beside them is the marketplace&apos;s, not your reach.
          </>
        ) : isViews ? (
          <>
            A page opened is presence, not work delivered — these figures are counted beside the action tabs and never added to them.
            Views are portal-wide telemetry with no owning landlord, so a manager who also serves someone else contributes the same
            view to both reports; the record behind a page is named here only when it is yours.
          </>
        ) : (
          <>
            Calls, WhatsApp and site visits leave no trace in the system — a quiet window here is not proof of an idle one.
            Every figure on this page reads the same event stream, so they cannot disagree.
          </>
        )}
      </p>
    </div>
  );
}


/* ── PAGE VIEWS ────────────────────────────────────────────────────────────
 * The two columns that sit beside the rail when Page views is the selected
 * tab — same frame, same widths, same drill shape as Lanes → the log: the
 * pages that were actually opened on the left, the tape of individual views
 * on the right, and clicking a page narrows the tape to it.
 *
 * Deliberately NOT the LogTable. That table's columns are lane · action ·
 * changed · wait — every one of which a view has nothing to put in, and a row
 * of five em-dashes reads as broken instrumentation rather than as a different
 * kind of event.
 *
 * Returns two grid children and no wrapper: a wrapper would make the pair one
 * cell and collapse the layout the rail was built around. */
function PageViewsPanel({ pv, loading, err, pageKey, onPickPage, onPage, size, onSize }: {
  pv: PvPayload | null; loading: boolean; err: string | null;
  pageKey: string | null; onPickPage: (k: string | null) => void;
  onPage: (n: number) => void; size: number; onSize: (n: number) => void;
}) {
  if (err) {
    return (
      <div style={{ gridColumn: 'span 2', overflow: 'auto', minHeight: 0, padding: 28 }}>
        <div style={{ border: '1px solid #f3d0d0', background: '#fdeeee', padding: 16, display: 'flex', gap: 10 }}>
          <AlertCircle size={17} color={RED} />
          <div><p style={{ margin: 0, fontWeight: 700, color: INK }}>Could not load page views</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: DIM }}>{err}</p></div>
        </div>
      </div>
    );
  }
  if (!pv) {
    return (
      <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: DIM }}>
        <Loader2 size={17} className="animate-spin" style={{ marginRight: 8 }} /> Loading page views…
      </div>
    );
  }

  const maxDay = Math.max(1, ...pv.byDay.map((d) => d.views));
  const pageLabel = pv.total
    ? `${pv.page * pv.size + 1}–${Math.min(pv.total, (pv.page + 1) * pv.size)} of ${pv.total}`
    : '0';
  const picked = pageKey ? pv.topPages.find((t) => t.key === pageKey) : null;

  return (
    <>
      {/* the pages, most-opened first — the rail's second level, as Lanes is */}
      <div style={{ overflow: 'auto', minHeight: 0, borderRight: `1px solid ${LINE}` }}>
        <p style={{ ...micro, position: 'sticky', top: 0, background: PANEL, padding: '12px 18px 9px',
          borderBottom: `1px solid ${LINE}`, zIndex: 1 }}>Pages · most opened</p>

        {/* where the reading actually fell in the window */}
        {pv.byDay.length > 1 && (
          <div style={{ padding: '11px 18px 12px', borderBottom: `1px solid ${LINE}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 40 }}>
              {pv.byDay.map((d) => (
                <div key={d.day} title={`${d.day} · ${d.views.toLocaleString()} opened`}
                  style={{ flex: '1 1 0', minWidth: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ height: `${Math.max(2, (d.views / maxDay) * 100)}%`, background: d.views ? A : '#f0ede8' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
              <span style={{ font: `500 9px ${MONO}`, color: FAINT }}>{pv.byDay[0]?.day}</span>
              <span style={{ font: `500 9px ${MONO}`, color: FAINT }}>peak {maxDay.toLocaleString()}</span>
              <span style={{ font: `500 9px ${MONO}`, color: FAINT }}>{pv.byDay[pv.byDay.length - 1]?.day}</span>
            </div>
          </div>
        )}

        {pv.topPages.length === 0 && (
          <p style={{ padding: 18, margin: 0, fontSize: 12.5, color: FAINT }}>Nothing was opened in this window.</p>
        )}
        {pv.topPages.map((t) => {
          const on = t.key === pageKey;
          return (
            <button key={t.key} onClick={() => onPickPage(on ? null : t.key)}
              style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', border: 0,
                borderBottom: '1px solid #eeece7', borderLeft: `3px solid ${on ? A : 'transparent'}`,
                background: on ? TINT : 'transparent', padding: '10px 18px', cursor: 'pointer', borderRadius: 0 }}>
              <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: INK, letterSpacing: '-.01em' }}>{t.label}</span>
                <span style={{ font: `500 9.5px ${MONO}`, color: FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.people} {t.people === 1 ? 'person' : 'people'} · {t.route}
                </span>
              </span>
              <span style={{ font: `700 15px ${MONO}`, fontVariantNumeric: 'tabular-nums', color: on ? A : INK }}>
                {t.views.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* the tape */}
      <div style={{ overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FilterBar pad="10px 20px 9px" label={picked ? `Page views  ›  ${picked.label}` : 'All page views'}
          hasFilter={!!pageKey} onClear={() => onPickPage(null)}
          pageLabel={pageLabel} page={pv.page} pages={pv.pages} onPage={onPage} />
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>{['When', 'Who', 'Page', 'Record'].map((c, i) => (
              <th key={c} style={{ ...hcell, top: 38, ...(i === 0 ? { paddingLeft: 20 } : null) }}>{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {pv.entries.map((e) => {
              const chip = ACTOR_CHIP[e.actor] ?? ACTOR_CHIP.system;
              const when = new Date(e.at).toLocaleString('en-GB', {
                timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
              });
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #f0ede8' }}>
                  <td style={{ font: `500 10.5px ${MONO}`, color: DIM, padding: '9px 8px 9px 20px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{when}</td>
                  <td style={{ padding: '9px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    <span style={{ font: `700 9px ${MONO}`, color: chip[1], background: chip[2], padding: '3px 5px', marginRight: 7 }}>{chip[0]}</span>
                    <span style={{ fontSize: 12, color: INK }}>{e.who ?? ACTOR_WORD[e.actor] ?? '—'}</span>
                  </td>
                  <td style={{ padding: '9px 8px', verticalAlign: 'top', minWidth: 170 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: INK, letterSpacing: '-.01em' }}>{e.label}</span>
                    <span style={{ display: 'block', marginTop: 3, font: `500 10px ${MONO}`, color: FAINT }}>{e.route}</span>
                  </td>
                  <td style={{ padding: '9px 20px 9px 8px', verticalAlign: 'top', fontSize: 12 }}>
                    {/* Named and linked ONLY when the record is this landlord's.
                        A view carries no owner, so anything else stays blank
                        rather than naming someone else's lease. */}
                    {e.subject
                      ? (e.href
                          ? <Link href={e.href} style={{ color: DEEP, textDecoration: 'none', borderBottom: `1px solid ${TINT_RULE}` }}>{e.subject}</Link>
                          : <span style={{ color: MID }}>{e.subject}</span>)
                      : <span style={{ color: FAINT }}>—</span>}
                  </td>
                </tr>
              );
            })}
            {pv.entries.length === 0 && !loading && (
              <tr><td colSpan={4} style={{ padding: '22px 20px', fontSize: 12.5, color: FAINT }}>
                No page views in this window.
              </td></tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 'auto', position: 'sticky', bottom: 0, background: PANEL,
          borderTop: `1px solid ${LINE}`, padding: '9px 20px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Label>Rows</Label>
          <div style={{ display: 'flex', border: `1px solid ${LINE}` }}>
            {[25, 50, 100].map((n, i) => (
              <button key={n} onClick={() => onSize(n)} style={{ ...seg(size === n, i === 0), padding: '5px 10px' }}>{n}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── PUBLIC VISITS ─────────────────────────────────────────────────────────
 * The same two columns as Page views, over the anonymous side of the split:
 * `page_visits` (0155), written by the SiteHeader beacon before anyone signs
 * in. Never summed with page views, and never with `listing_views` — that is a
 * second beacon for the same listing-detail visit.
 *
 * The left column is deliberately in two parts. YOUR LISTINGS is the only
 * public traffic a landlord owns, so it comes first and is the section that
 * carries unit names and links. Everything under it is the platform's, named by
 * page and owned by nobody. Both drill the tape.
 *
 * Returns two grid children and no wrapper, for the same reason PageViewsPanel
 * does: a wrapper would make the pair one cell. */
function PublicVisitsPanel({ pub, loading, err, pageKey, unitId, onPickPage, onPickUnit, onPage, size, onSize }: {
  pub: PubPayload | null; loading: boolean; err: string | null;
  pageKey: string | null; unitId: number | null;
  onPickPage: (k: string | null) => void; onPickUnit: (u: number | null) => void;
  onPage: (n: number) => void; size: number; onSize: (n: number) => void;
}) {
  if (err) {
    return (
      <div style={{ gridColumn: 'span 2', overflow: 'auto', minHeight: 0, padding: 28 }}>
        <div style={{ border: '1px solid #f3d0d0', background: '#fdeeee', padding: 16, display: 'flex', gap: 10 }}>
          <AlertCircle size={17} color={RED} />
          <div><p style={{ margin: 0, fontWeight: 700, color: INK }}>Could not load public visits</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: DIM }}>{err}</p></div>
        </div>
      </div>
    );
  }
  if (!pub) {
    return (
      <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: DIM }}>
        <Loader2 size={17} className="animate-spin" style={{ marginRight: 8 }} /> Loading public visits…
      </div>
    );
  }

  const maxDay = Math.max(1, ...pub.byDay.map((d) => d.views));
  const maxSource = Math.max(1, ...pub.sources.map((s) => s.visits));
  const pageLabel = pub.total
    ? `${pub.page * pub.size + 1}–${Math.min(pub.total, (pub.page + 1) * pub.size)} of ${pub.total}`
    : '0';
  const pickedUnit = unitId != null ? pub.yourListings.find((u) => u.unitId === unitId) : null;
  const pickedPage = pageKey ? pub.topPages.find((t) => t.key === pageKey) : null;
  const drillLabel = pickedUnit ? `Public visits  ›  ${pickedUnit.label}`
    : pickedPage ? `Public visits  ›  ${pickedPage.label}`
    : 'All public visits';

  return (
    <>
      <div style={{ overflow: 'auto', minHeight: 0, borderRight: `1px solid ${LINE}` }}>
        {/* where the traffic actually fell in the window */}
        {pub.byDay.length > 1 && (
          <div style={{ padding: '11px 18px 12px', borderBottom: `1px solid ${LINE}` }}>
            <p style={{ ...micro, marginBottom: 9 }}>Visits per day · Asia/Dubai</p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 40 }}>
              {pub.byDay.map((d) => (
                <div key={d.day} title={`${d.day} · ${d.views.toLocaleString()} visits`}
                  style={{ flex: '1 1 0', minWidth: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ height: `${Math.max(2, (d.views / maxDay) * 100)}%`, background: d.views ? A : '#f0ede8' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
              <span style={{ font: `500 9px ${MONO}`, color: FAINT }}>{pub.byDay[0]?.day}</span>
              <span style={{ font: `500 9px ${MONO}`, color: FAINT }}>peak {maxDay.toLocaleString()}</span>
              <span style={{ font: `500 9px ${MONO}`, color: FAINT }}>{pub.byDay[pub.byDay.length - 1]?.day}</span>
            </div>
          </div>
        )}

        {/* YOURS — the only public traffic this landlord owns */}
        <p style={{ ...micro, color: DEEP, padding: '12px 18px 9px', borderBottom: `1px solid ${LINE}`, background: TINT }}>
          Your listings
        </p>
        {pub.yourListings.length === 0 && (
          <p style={{ padding: '14px 18px', margin: 0, fontSize: 12, color: FAINT, borderBottom: `1px solid ${LINE}` }}>
            None of your listing pages were opened in this window.
          </p>
        )}
        {pub.yourListings.map((u) => {
          const on = u.unitId === unitId;
          return (
            <button key={u.unitId} onClick={() => onPickUnit(on ? null : u.unitId)}
              style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', border: 0,
                borderBottom: '1px solid #eeece7', borderLeft: `3px solid ${on ? A : 'transparent'}`,
                background: on ? TINT : 'transparent', padding: '10px 18px', cursor: 'pointer', borderRadius: 0 }}>
              <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: INK, letterSpacing: '-.01em' }}>{u.label}</span>
                <span style={{ font: `500 9.5px ${MONO}`, color: FAINT }}>
                  {u.visitors} {u.visitors === 1 ? 'visitor' : 'visitors'}
                </span>
              </span>
              <span style={{ font: `700 15px ${MONO}`, fontVariantNumeric: 'tabular-nums', color: on ? A : INK }}>
                {u.visits.toLocaleString()}
              </span>
            </button>
          );
        })}

        {/* THEIRS — the platform's, owned by nobody */}
        <p style={{ ...micro, padding: '12px 18px 9px', borderTop: `1px solid ${LINE}`,
          borderBottom: `1px solid ${LINE}`, marginTop: 10 }}>
          All public pages · platform-wide
        </p>
        {pub.topPages.map((t) => {
          const on = t.key === pageKey;
          return (
            <button key={t.key} onClick={() => onPickPage(on ? null : t.key)}
              style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', border: 0,
                borderBottom: '1px solid #eeece7', borderLeft: `3px solid ${on ? A : 'transparent'}`,
                background: on ? TINT : 'transparent', padding: '10px 18px', cursor: 'pointer', borderRadius: 0 }}>
              <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, letterSpacing: '-.01em' }}>{t.label}</span>
                <span style={{ font: `500 9.5px ${MONO}`, color: FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.visitors} {t.visitors === 1 ? 'visitor' : 'visitors'} · {t.route}
                </span>
              </span>
              <span style={{ font: `700 14px ${MONO}`, fontVariantNumeric: 'tabular-nums', color: on ? A : INK }}>
                {t.visits.toLocaleString()}
              </span>
            </button>
          );
        })}

        {/* attribution. "Own site" is called out because a referrer of our own
            domain is somebody in the portal clicking back out to the public
            site — counting it as a channel would flatter every campaign. */}
        {pub.sources.length > 0 && (
          <>
            <p style={{ ...micro, padding: '12px 18px 9px', borderTop: `1px solid ${LINE}`,
              borderBottom: `1px solid ${LINE}`, marginTop: 10 }}>Where they came from</p>
            <div style={{ padding: '10px 18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pub.sources.slice(0, 8).map((sc) => (
                <div key={sc.label} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ flex: '0 0 92px', font: `500 10.5px ${MONO}`, color: sc.label === 'Own site' ? FAINT : MID,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.label}</span>
                  <span style={{ flex: 1, height: 7, background: '#f0ede8' }}>
                    <span style={{ display: 'block', height: '100%', width: `${(sc.visits / maxSource) * 100}%`,
                      background: sc.label === 'Own site' ? '#cfe8dd' : A }} />
                  </span>
                  <span style={{ font: `600 10.5px ${MONO}`, color: DIM, fontVariantNumeric: 'tabular-nums' }}>{sc.visits}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* the tape */}
      <div style={{ overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FilterBar pad="10px 20px 9px" label={drillLabel}
          hasFilter={!!(pageKey || unitId)}
          onClear={() => { onPickPage(null); onPickUnit(null); }}
          pageLabel={pageLabel} page={pub.page} pages={pub.pages} onPage={onPage} />
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>{['When', 'Page', 'Came from', 'Visitor'].map((c, i) => (
              <th key={c} style={{ ...hcell, top: 38, ...(i === 0 ? { paddingLeft: 20 } : null) }}>{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {pub.entries.map((e) => {
              const when = new Date(e.at).toLocaleString('en-GB', {
                timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
              });
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #f0ede8' }}>
                  <td style={{ font: `500 10.5px ${MONO}`, color: DIM, padding: '9px 8px 9px 20px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{when}</td>
                  <td style={{ padding: '9px 8px', verticalAlign: 'top', minWidth: 170 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: INK, letterSpacing: '-.01em' }}>{e.label}</span>
                    {/* Only YOUR unit is named, and only yours is linked. */}
                    {e.subject && e.unitId != null ? (
                      <Link href={unitHref(e.unitId)}
                        style={{ display: 'block', marginTop: 3, font: `600 10px ${MONO}`, color: DEEP, textDecoration: 'none' }}>
                        {e.subject}
                      </Link>
                    ) : (
                      <span style={{ display: 'block', marginTop: 3, font: `500 10px ${MONO}`, color: FAINT }}>{e.route}</span>
                    )}
                  </td>
                  <td style={{ padding: '9px 8px', verticalAlign: 'top', fontSize: 12, color: e.source === 'Direct' || e.source === 'Own site' ? FAINT : MID }}>
                    {e.source}
                  </td>
                  <td style={{ padding: '9px 20px 9px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    <span style={{ font: `500 10.5px ${MONO}`, color: DIM }}>{e.visitor}</span>
                    {/* The anonymous → signed-in handoff, per session (0156). */}
                    {e.signedIn && (
                      <span style={{ marginLeft: 7, font: `700 9px ${MONO}`, color: DEEP, background: '#d8efe3', padding: '3px 5px' }}>
                        SIGNED IN
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {pub.entries.length === 0 && !loading && (
              <tr><td colSpan={4} style={{ padding: '22px 20px', fontSize: 12.5, color: FAINT }}>
                No public visits in this window.
              </td></tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 'auto', position: 'sticky', bottom: 0, background: PANEL,
          borderTop: `1px solid ${LINE}`, padding: '9px 20px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Label>Rows</Label>
          <div style={{ display: 'flex', border: `1px solid ${LINE}` }}>
            {[25, 50, 100].map((n, i) => (
              <button key={n} onClick={() => onSize(n)} style={{ ...seg(size === n, i === 0), padding: '5px 10px' }}>{n}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
