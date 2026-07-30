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

/* ── tokens ───────────────────────────────────────────────────────────────── */
const A = '#2e9f82', DEEP = '#1a5a4a', AMB = '#e8a020', RED = '#d43f3f';
const INK = '#1a1916', MID = '#4f4c44', DIM = '#6b6860', FAINT = '#9b9890', LINE = '#e8e6e0';
const PANEL = '#fff', PAGE = '#fafaf8', RAIL = '#f9f8f6', TINT = '#edf7f3', TINT_RULE = '#cfe8dd';
const MONO = "'Spline Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SANS = "'Public Sans', system-ui, sans-serif";

/** Per-actor colour, as the canvas defines it. */
const ACTOR_COLOR: Record<string, string> = { manager: DEEP, customer: '#1f6f9c', rp: '#8a6a1e', system: FAINT };
const ACTOR_RGB: Record<string, string> = { manager: '46,159,130', customer: '31,111,156', rp: '212,168,32', system: '155,152,144' };
const ACTOR_CHIP: Record<string, [string, string, string]> = {
  manager: ['MGR', '#1a5a4a', '#d8f2e8'], customer: ['CUS', '#1f6f9c', '#e3f0f8'],
  rp: ['LLD', '#8a6a1e', '#fdf3dd'], system: ['SYS', '#6b6860', '#f0ede8'],
};
const ACTOR_WORD: Record<string, string> = { manager: 'manager', customer: 'customer', rp: 'landlord', system: 'system' };

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
interface Entry {
  id: number; at: string; lane: string | null; label: string; cid: string | null;
  changed: Array<{ field: string; from: string | null; to: string | null }> | null;
  why: string | null; wait: number; waitLabel: string; waitBy: string;
  rework: boolean; actor: string; who: string | null; onBehalfOf: string | null; detail: string;
}
interface Payload {
  window: { from: string | null; to: string | null; timezone: string; label: string };
  subject: string; view: ViewKey; pipe: string; actor: ActorKey;
  span: string; rowAxis: string;
  totals: { rows: number; onBoard: number; offBoard: number };
  kpis: Array<{ k: string; v: number }>;
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
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

/* ── date helpers, all Asia/Dubai ─────────────────────────────────────────── */
const todayISO = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseKey = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

/** The canvas's eight presets, in its order. */
function presetRange(label: string): [string, string] | null {
  const t = parseKey(todayISO());
  const back = (n: number) => { const d = new Date(t); d.setDate(d.getDate() - n); return d; };
  switch (label) {
    case 'Today':        return [keyOf(t), keyOf(t)];
    case 'Yesterday':    return [keyOf(back(1)), keyOf(back(1))];
    case 'Last 7 days':  return [keyOf(back(6)), keyOf(t)];
    case 'Last 30 days': return [keyOf(back(29)), keyOf(t)];
    case 'This month':   return [keyOf(new Date(t.getFullYear(), t.getMonth(), 1)), keyOf(t)];
    case 'Last month':   return [keyOf(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
                                 keyOf(new Date(t.getFullYear(), t.getMonth(), 0))];
    case 'This year':    return [keyOf(new Date(t.getFullYear(), 0, 1)), keyOf(t)];
    default:             return null;   // Custom range
  }
}
const PRESETS = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'This month', 'Last month', 'This year', 'Custom range'];

/* ── shared styles ────────────────────────────────────────────────────────── */
const micro: React.CSSProperties = {
  margin: 0, font: `600 9px ${MONO}`, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT,
};
const seg = (active: boolean, first: boolean): React.CSSProperties => ({
  border: 0, borderLeft: first ? undefined : `1px solid ${LINE}`,
  background: active ? A : PANEL, color: active ? '#fff' : DIM,
  font: `600 10px ${MONO}`, letterSpacing: '.06em', textTransform: 'uppercase',
  padding: '7px 9px', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 0,
});
const navBtn = (enabled: boolean): React.CSSProperties => ({
  border: `1px solid ${enabled ? LINE : '#f0ede8'}`, background: PANEL, color: enabled ? INK : FAINT,
  font: `600 11px ${MONO}`, padding: '5px 11px', cursor: enabled ? 'pointer' : 'default', borderRadius: 0,
});
const hcell: React.CSSProperties = {
  textAlign: 'left', font: `500 9.5px ${MONO}`, letterSpacing: '.14em', textTransform: 'uppercase',
  color: FAINT, padding: '11px 10px 9px', borderBottom: `1px solid ${LINE}`,
  position: 'sticky', top: 0, background: PANEL, whiteSpace: 'nowrap',
};

function Seg<T extends string>({ items, value, onPick }: {
  items: Array<[T, string]>; value: T; onPick: (k: T) => void;
}) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${LINE}` }}>
      {items.map(([k, label], i) => (
        <button key={k} onClick={() => onPick(k)} style={seg(k === value, i === 0)}>{label}</button>
      ))}
    </div>
  );
}
const Label = ({ children, minWidth }: { children: React.ReactNode; minWidth?: number }) => (
  <p style={{ ...micro, minWidth }}>{children}</p>
);

/* ── period picker: presets beside a two-month calendar, with Apply ───────── */
function PeriodPicker({ preset, from, to, label, onApply }: {
  preset: string; from: string | null; to: string | null; label: string;
  onApply: (preset: string, from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dFrom, setDFrom] = useState<string | null>(from);
  const [dTo, setDTo] = useState<string | null>(to);
  const [month, setMonth] = useState(() => (from ?? todayISO()).slice(0, 7));

  const openDp = () => { setDFrom(from); setDTo(to); setOpen((o) => !o); };
  const cancel = () => { setDFrom(from); setDTo(to); setOpen(false); };
  const apply = () => { if (dFrom && dTo) { onApply('Custom range', dFrom, dTo); setOpen(false); } };

  // First click opens a range, second closes it. An earlier second pick
  // restarts rather than producing an inverted range.
  const pickDay = (k: string) => {
    if (!dFrom || (dFrom && dTo) || k < dFrom) { setDFrom(k); setDTo(null); }
    else setDTo(k);
  };

  const [my, mm] = month.split('-').map(Number);
  const today = todayISO();

  const monthGrid = (offset: number) => {
    const first = new Date(my, mm - 1 + offset, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = keyOf(d);
      return { k, d: d.getDate(), inMonth: d.getMonth() === first.getMonth(), future: k > today };
    });
    return { first, cells };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 'auto', position: 'relative' }}>
      <Label>Period</Label>
      <button onClick={openDp}
        style={{ display: 'flex', gap: 9, alignItems: 'center', boxSizing: 'border-box',
          border: `1px solid ${LINE}`, background: PANEL, padding: '7px 12px', cursor: 'pointer', borderRadius: 0 }}>
        <span style={{ font: `600 11px ${MONO}`, color: A }}>{preset}</span>
        <span style={{ font: `600 11px ${MONO}`, color: '#3d3b35' }}>{label}</span>
        <span style={{ font: `600 9px ${MONO}`, color: FAINT }}>▼</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 40, display: 'flex',
          background: PANEL, border: '1px solid #d9d5cd', boxShadow: '0 10px 28px rgba(26,25,22,.14)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: PAGE,
            borderRight: `1px solid ${LINE}`, padding: '6px 0', minWidth: 132 }}>
            {PRESETS.map((p) => (
              <button key={p}
                onClick={() => {
                  const r = presetRange(p);
                  if (!r) { setDFrom(null); setDTo(null); return; }   // Custom range: pick on the calendar
                  onApply(p, r[0], r[1]); setOpen(false);
                }}
                style={{ border: 0, textAlign: 'left', padding: '8px 14px', cursor: 'pointer', borderRadius: 0,
                  font: `600 11px ${MONO}`,
                  background: preset === p ? A : 'transparent', color: preset === p ? '#fff' : MID }}>
                {p}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              {[0, 1].map((off) => {
                const { first, cells } = monthGrid(off);
                return (
                  <div key={off} style={{ display: 'flex', flexDirection: 'column', gap: 7, width: 196 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => setMonth(keyOf(new Date(my, mm - 2, 1)).slice(0, 7))}
                        style={{ border: 0, background: 'transparent', color: DIM, font: `700 14px ${MONO}`,
                          cursor: 'pointer', padding: '0 4px', visibility: off === 0 ? 'visible' : 'hidden' }}>‹</button>
                      <p style={{ margin: '0 auto', font: `700 11px ${MONO}`, letterSpacing: '.06em', color: INK }}>
                        {MON[first.getMonth()]} {first.getFullYear()}
                      </p>
                      <button onClick={() => setMonth(keyOf(new Date(my, mm, 1)).slice(0, 7))}
                        style={{ border: 0, background: 'transparent', color: DIM, font: `700 14px ${MONO}`,
                          cursor: 'pointer', padding: '0 4px', visibility: off === 1 ? 'visible' : 'hidden' }}>›</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
                      {DOW.map((d) => (
                        <span key={d} style={{ textAlign: 'center', font: `600 9px ${MONO}`, color: FAINT, padding: '3px 0' }}>{d}</span>
                      ))}
                      {cells.map((c, i) => {
                        const isEdge = c.k === dFrom || c.k === dTo;
                        const inRange = !!(dFrom && dTo && c.k > dFrom && c.k < dTo);
                        return (
                          <button key={i} onClick={() => !c.future && pickDay(c.k)}
                            style={{ border: 0, borderRadius: 0, textAlign: 'center', padding: '5px 0',
                              font: `${isEdge ? 700 : 600} 10.5px ${MONO}`,
                              background: isEdge ? A : inRange ? TINT : 'transparent',
                              color: c.future ? '#dcd8d0' : isEdge ? '#fff' : c.inMonth ? INK : '#cfcbc3',
                              cursor: c.future ? 'default' : 'pointer' }}>
                            {c.d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
              <p style={{ margin: 0, font: `600 10.5px ${MONO}`, color: DIM }}>{dFrom ?? '—'}&nbsp;&nbsp;→&nbsp;&nbsp;{dTo ?? '—'}</p>
              <button onClick={cancel}
                style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, background: PANEL, color: MID,
                  font: `600 10px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase',
                  padding: '7px 12px', cursor: 'pointer', borderRadius: 0 }}>Cancel</button>
              <button onClick={apply} disabled={!dFrom || !dTo}
                style={{ border: 0, background: dFrom && dTo ? A : '#d9d5cd', color: '#fff',
                  font: `600 10px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase',
                  padding: '8px 14px', cursor: dFrom && dTo ? 'pointer' : 'default', borderRadius: 0 }}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── the log table, shared by By-lane and Matrix ──────────────────────────── */
function LogTable({ entries, compact }: { entries: Entry[]; compact?: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const cols = compact
    ? ['When', 'Lane', 'Action', 'Changed', 'Wait']
    : ['When', 'Lane', 'Action', 'Record', 'Changed', 'Wait', 'By'];
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: compact ? undefined : 1040 }}>
      <thead>
        <tr>{cols.map((c, i) => (
          <th key={c} style={{ ...hcell, ...(i === 0 ? { paddingLeft: compact ? 20 : 0 } : null) }}>{c}</th>
        ))}</tr>
      </thead>
      <tbody>
        {entries.map((e) => {
          const isOpen = !!open[e.id];
          const when = new Date(e.at).toLocaleString('en-GB', {
            timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
          });
          const diff = (e.changed ?? []).map((c) => `${c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`).join('  ·  ');
          return (
            <tr key={e.id} onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
              style={{ borderBottom: '1px solid #f0ede8', cursor: 'pointer', background: isOpen ? '#f0faf6' : undefined }}>
              <td style={{ font: `500 ${compact ? 10.5 : 11}px ${MONO}`, color: DIM,
                padding: compact ? '9px 8px 9px 20px' : '8px 10px 8px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{when}</td>
              <td style={{ padding: compact ? '9px 8px' : '8px 10px', verticalAlign: 'top' }}>
                <span style={{ font: `700 9px ${MONO}`, background: '#d8f2e8', color: DEEP, padding: '3px 5px' }}>{e.lane ?? '—'}</span>
              </td>
              <td style={{ padding: compact ? '9px 8px' : '8px 10px', verticalAlign: 'top', minWidth: compact ? 150 : undefined }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, letterSpacing: '-.01em',
                  color: e.rework ? '#8a6a1e' : INK }}>{e.label}</span>
                {compact && (
                  <span style={{ display: 'block', marginTop: 3, font: `500 10px ${MONO}`, color: FAINT }}>
                    {e.cid ?? '—'} · {e.who ?? '—'}
                  </span>
                )}
              </td>
              {!compact && (
                <td style={{ font: `500 11px ${MONO}`, color: DIM, padding: '8px 10px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{e.cid ?? '—'}</td>
              )}
              <td style={{ font: `${compact ? 11 : 11.5}px ${MONO}`, color: INK, padding: compact ? '9px 8px' : '8px 10px', verticalAlign: 'top' }}>
                {diff || <span style={{ color: FAINT }}>—</span>}
                {e.why && (
                  <span style={{ display: 'block', marginTop: 3, fontFamily: SANS, fontSize: 11.5, color: DIM }}>why: {e.why}</span>
                )}
                {isOpen && (
                  <span style={{ display: 'block', marginTop: 4, fontFamily: SANS, fontSize: 11.5, color: MID }}>{e.detail}</span>
                )}
              </td>
              <td style={{ font: `500 ${compact ? 10.5 : 11}px ${MONO}`, padding: compact ? '9px 20px 9px 8px' : '8px 10px',
                whiteSpace: 'nowrap', verticalAlign: 'top', textAlign: compact ? 'right' : 'left',
                // A long wait is only a warning when it belonged to OUR side.
                color: e.waitBy === 'manager' && e.wait > 48 ? RED : DIM }}>{e.waitLabel}</td>
              {!compact && (
                <td style={{ padding: '8px 0 8px 10px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                  <span style={{ font: `500 10px ${MONO}`, letterSpacing: '.06em', textTransform: 'uppercase',
                    padding: '3px 7px', color: ACTOR_COLOR[e.actor], background: `rgba(${ACTOR_RGB[e.actor]},.12)` }}>
                    {e.who ?? ACTOR_WORD[e.actor]}
                  </span>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Sticky bar above the log: breadcrumb, clear, pagination.
 *  Module scope — defined inside the view it would remount on every render. */
function FilterBar({ pad, label, hasFilter, onClear, pageLabel, page, pages, onPage }: {
  pad: string; label: string; hasFilter: boolean; onClear: () => void;
  pageLabel: string; page: number; pages: number; onPage: (p: number) => void;
}) {
  return (
    <div style={{ position: 'sticky', top: 0, background: PANEL, zIndex: 2, display: 'flex', gap: 12,
      alignItems: 'center', padding: pad, borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
      <p style={{ margin: 0, font: `600 10px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: '#3d3b35' }}>{label}</p>
      {hasFilter && (
        <button onClick={onClear}
          style={{ border: `1px solid ${LINE}`, background: PANEL, color: DIM, font: `500 9px ${MONO}`,
            letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 8px', cursor: 'pointer', borderRadius: 0 }}>clear</button>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <p style={{ margin: 0, font: `500 10.5px ${MONO}`, color: DIM }}>{pageLabel}</p>
        <button disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))} style={navBtn(page > 0)}>←</button>
        <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)} style={navBtn(page < pages - 1)}>→</button>
      </div>
    </div>
  );
}

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
          // entries column collapsing under the diff text on a narrow laptop.
          gridTemplateColumns: '190px 300px minmax(430px,1fr)', gridTemplateRows: 'minmax(0,1fr)', height: 560, overflow: 'hidden' }}>

          {/* pipelines */}
          <div style={{ overflow: 'auto', minHeight: 0, borderRight: `1px solid ${LINE}`, background: RAIL }}>
            <p style={{ ...micro, position: 'sticky', top: 0, background: RAIL, padding: '12px 18px 9px', borderBottom: `1px solid ${LINE}` }}>Pipeline</p>
            {data.pipelines.map((p) => {
              const on = p.key === pipe;
              return (
                <button key={p.key} onClick={() => { setPipe(p.key); resetDrill(); }}
                  style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', border: 0,
                    borderBottom: '1px solid #eeece7', borderLeft: `3px solid ${on ? A : 'transparent'}`,
                    background: on ? TINT : 'transparent', color: p.count ? (on ? DEEP : INK) : FAINT,
                    padding: '14px 18px', cursor: 'pointer', borderRadius: 0 }}>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: on ? 700 : 600, letterSpacing: '-.01em' }}>{p.title}</span>
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

/** Design: hours under a day, otherwise one decimal of a day. */
function fmtWait(h: number): string {
  return h < 24 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;
}
