/**
 * Activity report — a faithful build of the shared canvas ("Manager Activity Matrix").
 *
 * Three views over one scoped query, so no two figures on the page can disagree:
 *
 *   BY LANE  pipeline rail → lanes → the lane's whole action catalogue → the log
 *   MATRIX   time down, lanes across, heat-shaded and clickable → the log
 *   LIVE     the tape, as it happens
 *
 * Every token here is lifted from the canvas rather than approximated:
 * page #fafaf8 · panels #fff · rules #e8e6e0 · ink #1a1916 · mid #4f4c44 ·
 * dim #6b6860 · faint #9b9890 · jade #2e9f82 · deep #1a5a4a · amber #e8a020 ·
 * red #d43f3f. Square corners throughout; Spline Sans Mono for every control,
 * figure and micro-label; Public Sans for prose.
 *
 * Backend: GET /api/reports/activity-log
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { APP_TIME_ZONE } from '@/lib/datetime';
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

  /** Any coarser selection invalidates the finer ones beneath it. */
  const resetDrill = useCallback(() => { setBucket(null); setLane(null); setAction(null); setPage(0); }, []);

  useEffect(() => {
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
  }, [endpoint, view, pipe, actor, person, range, prop, unit, bucket, lane, action, page, size]);

  // Only managers and landlords have named individuals to pick between.
  const people = useMemo(
    () => (data?.filters.people ?? []).filter((p) => p.actor === actor),
    [data, actor],
  );

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

  return (
    <div style={{ minHeight: '100vh', background: PAGE, display: 'flex', flexDirection: 'column', color: INK, fontFamily: SANS }}>

      {/* header */}
      <header style={{ background: PANEL, borderBottom: `1px solid ${LINE}`, padding: '15px 28px 0', display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <Link href={backHref} style={{ color: DIM, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-.015em', color: INK }}>Activity report</h1>
        <p style={{ margin: 0, font: `500 11px ${MONO}`, color: FAINT }}>{data.subject}</p>
        <p style={{ margin: '0 0 0 auto', font: `500 11px ${MONO}`, color: DIM }}>{data.window.label}</p>
      </header>

      {/* controls · row 1 */}
      <div style={{ boxSizing: 'border-box', background: PANEL, borderBottom: `1px solid ${LINE}`,
        padding: '12px 28px 14px', display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label>View</Label>
          <Seg items={VIEWS} value={view} onPick={(k) => { setView(k); resetDrill(); }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label>Who acted</Label>
          <Seg items={ACTORS} value={actor} onPick={(k) => { setActor(k); setPerson(null); resetDrill(); }} />
        </div>
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
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 'auto' }}>
          <Label>Property</Label>
          <select value={prop ?? 'all'} onChange={(e) => { setProp(e.target.value === 'all' ? null : Number(e.target.value)); setUnit(null); resetDrill(); }}
            style={{ boxSizing: 'border-box', border: `1px solid ${LINE}`, background: PANEL, color: '#3d3b35',
              font: `600 10px ${MONO}`, letterSpacing: '.06em', padding: '6px 10px', cursor: 'pointer', minWidth: 150, borderRadius: 0 }}>
            <option value="all">All properties</option>
            {data.filters.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Label>Unit</Label>
          <select value={unit ?? 'all'} onChange={(e) => { setUnit(e.target.value === 'all' ? null : Number(e.target.value)); resetDrill(); }}
            style={{ boxSizing: 'border-box', border: `1px solid ${LINE}`, background: PANEL, color: '#3d3b35',
              font: `600 10px ${MONO}`, letterSpacing: '.06em', padding: '6px 10px', cursor: 'pointer', minWidth: 120, borderRadius: 0 }}>
            <option value="all">All units</option>
            {data.filters.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      {/* outcomes band */}
      <div style={{ boxSizing: 'border-box', background: TINT, borderBottom: `1px solid ${TINT_RULE}`,
        padding: '11px 28px 14px', display: 'flex', flexDirection: 'column', gap: 9, width: '100%' }}>
        <p style={{ ...micro, color: DIM }}>Outcomes · whole period, all stages</p>
        <div style={{ display: 'flex', gap: 1, width: '100%' }}>
          {data.kpis.map((k, i) => (
            <div key={k.k} style={{ boxSizing: 'border-box', flex: '1 1 0', minWidth: 0, display: 'flex',
              flexDirection: 'column', gap: 6, padding: '2px 12px',
              borderLeft: i ? `1px solid ${TINT_RULE}` : undefined }}>
              <span style={{ font: `700 22px ${MONO}`, color: DEEP, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{k.v}</span>
              <span style={{ font: `600 9.5px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: MID, lineHeight: 1.35 }}>{k.k}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── BY LANE ─────────────────────────────────────────────────────── */}
      {view === 'phase' && (
        <div style={{ background: PANEL, borderBottom: `1px solid ${LINE}`, display: 'grid',
          // Handoff: `190px 300px minmax(430px,1fr)`. The 430px floor stops the
          // entries column collapsing under the diff text on a narrow laptop —
          // but it also gives the row a 920px hard minimum, so the container must
          // SCROLL rather than clip. With `overflow:hidden` the entries column and
          // its pager were simply unreachable between ~1024px and ~1160px wide.
          gridTemplateColumns: '190px 300px minmax(430px,1fr)', gridTemplateRows: 'minmax(0,1fr)',
          height: 560, overflowX: 'auto', overflowY: 'hidden' }}>

          {/* pipelines */}
          <div style={{ overflow: 'auto', minHeight: 0, borderRight: `1px solid ${LINE}`, background: RAIL }}>
            <p style={{ ...micro, position: 'sticky', top: 0, background: RAIL, padding: '12px 18px 9px', borderBottom: `1px solid ${LINE}` }}>Pipeline</p>
            {data.pipelines.map((p) => {
              const on = p.key === pipe;
              // "All activity" is not a fifth pipeline — it is the way out of
              // them, and the only tab that lists work with no board lane. Set
              // apart so it does not read as another stage of the journey.
              const isAll = p.key === 'all';
              return (
                <button key={p.key} onClick={() => { setPipe(p.key); resetDrill(); }}
                  style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', border: 0,
                    borderBottom: '1px solid #eeece7', borderLeft: `3px solid ${on ? A : 'transparent'}`,
                    borderTop: isAll ? `1px solid ${LINE}` : undefined,
                    marginTop: isAll ? 10 : undefined,
                    background: on ? TINT : 'transparent', color: p.count ? (on ? DEEP : INK) : FAINT,
                    padding: '14px 18px', cursor: 'pointer', borderRadius: 0 }}>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: on ? 700 : 600, letterSpacing: '-.01em' }}>
                    {p.title}
                    {isAll && (
                      <span style={{ display: 'block', marginTop: 2, font: `500 10px ${MONO}`, color: FAINT, letterSpacing: 0 }}>
                        includes work with no lane
                      </span>
                    )}
                  </span>
                  <span style={{ font: `700 15px ${MONO}`, fontVariantNumeric: 'tabular-nums' }}>{p.count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>

          {/* lanes, then the focused lane's action catalogue */}
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
                    background: on ? A : p.count ? '#d8f2e8' : '#f0ede8' }}>{p.id}</span>
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
                    background: on ? '#f0faf6' : PANEL, padding: '10px 18px',
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
        </div>
      )}

      {/* ── MATRIX ──────────────────────────────────────────────────────── */}
      {view === 'matrix' && (
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
                        const bg = b.future ? 'repeating-linear-gradient(45deg,#f0ede8 0 3px,#fafaf8 3px 6px)'
                          : b.off ? '#f4f3ef'
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
            <p style={{ margin: 0, font: `600 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: '#3d3b35' }}>{filterLabel}</p>
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
      {view === 'live' && (
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
              <p style={{ margin: 0, font: `600 10px ${MONO}`, letterSpacing: '.14em', textTransform: 'uppercase', color: '#3d3b35' }}>Live tape</p>
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
                  <span style={{ font: `700 9px ${MONO}`, background: '#d8f2e8', color: DEEP, padding: '3px 5px' }}>{e.lane ?? '—'}</span>
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
        Calls, WhatsApp and site visits leave no trace in the system — a quiet window here is not proof of an idle one.
        Every figure on this page reads the same event stream, so they cannot disagree.
      </p>
    </div>
  );
}

