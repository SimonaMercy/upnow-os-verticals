/**
 * Activity canvas kit — the primitives the shared "Manager Activity Matrix"
 * canvas defines, in one place.
 *
 * These were written for the Activity Log board and are now used by the Manager
 * Activity Performance report as well. They live here rather than being copied
 * because the canvas IS the spec: two copies of the period picker, the log table
 * or the colour tokens would drift, and the first symptom would be two reports
 * built from the same query rendering the same event differently.
 *
 * Every token is lifted from the canvas rather than approximated:
 * page #fafaf8 · panels #fff · rules #e8e6e0 · ink #1a1916 · mid #4f4c44 ·
 * dim #6b6860 · faint #9b9890 · jade #2e9f82 · deep #1a5a4a · amber #e8a020 ·
 * red #d43f3f. Square corners throughout; Spline Sans Mono for every control,
 * figure and micro-label; Public Sans for prose.
 */
'use client';

import { useState } from 'react';
import { APP_TIME_ZONE } from '@/lib/datetime';

/* ── tokens ───────────────────────────────────────────────────────────────── */
export const A = '#2e9f82', DEEP = '#1a5a4a', AMB = '#e8a020', RED = '#d43f3f';
export const INK = '#1a1916', MID = '#4f4c44', DIM = '#6b6860', FAINT = '#9b9890', LINE = '#e8e6e0';
export const PANEL = '#fff', PAGE = '#fafaf8', RAIL = '#f9f8f6', TINT = '#edf7f3', TINT_RULE = '#cfe8dd';
export const MONO = "'Spline Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const SANS = "'Public Sans', system-ui, sans-serif";

/** Per-actor colour, as the canvas defines it. */
export const ACTOR_COLOR: Record<string, string> = { manager: DEEP, customer: '#1f6f9c', rp: '#8a6a1e', system: FAINT };
export const ACTOR_RGB: Record<string, string> = { manager: '46,159,130', customer: '31,111,156', rp: '212,168,32', system: '155,152,144' };
export const ACTOR_CHIP: Record<string, [string, string, string]> = {
  manager: ['MGR', '#1a5a4a', '#d8f2e8'], customer: ['CUS', '#1f6f9c', '#e3f0f8'],
  rp: ['LLD', '#8a6a1e', '#fdf3dd'], system: ['SYS', '#6b6860', '#f0ede8'],
};
export const ACTOR_WORD: Record<string, string> = { manager: 'manager', customer: 'customer', rp: 'landlord', system: 'system' };
export interface Entry {
  id: number; at: string; lane: string | null; label: string; cid: string | null;
  changed: Array<{ field: string; from: string | null; to: string | null }> | null;
  why: string | null; wait: number; waitLabel: string; waitBy: string;
  rework: boolean; actor: string; who: string | null; onBehalfOf: string | null; detail: string;
}
export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

/* ── date helpers, all Asia/Dubai ─────────────────────────────────────────── */
export const todayISO = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
export const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseKey = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

/** The canvas's eight presets, in its order. */
export function presetRange(label: string): [string, string] | null {
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
export const PRESETS = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'This month', 'Last month', 'This year', 'Custom range'];

/* ── shared styles ────────────────────────────────────────────────────────── */
export const micro: React.CSSProperties = {
  margin: 0, font: `600 9px ${MONO}`, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT,
};
export const seg = (active: boolean, first: boolean): React.CSSProperties => ({
  border: 0, borderLeft: first ? undefined : `1px solid ${LINE}`,
  background: active ? A : PANEL, color: active ? '#fff' : DIM,
  font: `600 10px ${MONO}`, letterSpacing: '.06em', textTransform: 'uppercase',
  padding: '7px 9px', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 0,
});
export const navBtn = (enabled: boolean): React.CSSProperties => ({
  border: `1px solid ${enabled ? LINE : '#f0ede8'}`, background: PANEL, color: enabled ? INK : FAINT,
  font: `600 11px ${MONO}`, padding: '5px 11px', cursor: enabled ? 'pointer' : 'default', borderRadius: 0,
});
export const hcell: React.CSSProperties = {
  textAlign: 'left', font: `500 9.5px ${MONO}`, letterSpacing: '.14em', textTransform: 'uppercase',
  color: FAINT, padding: '11px 10px 9px', borderBottom: `1px solid ${LINE}`,
  position: 'sticky', top: 0, background: PANEL, whiteSpace: 'nowrap',
};

export function Seg<T extends string>({ items, value, onPick }: {
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
export const Label = ({ children, minWidth }: { children: React.ReactNode; minWidth?: number }) => (
  <p style={{ ...micro, minWidth }}>{children}</p>
);
/* ── period picker: presets beside a two-month calendar, with Apply ───────── */
export function PeriodPicker({ preset, from, to, label, onApply }: {
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
export function LogTable({ entries, compact }: { entries: Entry[]; compact?: boolean }) {
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
export function FilterBar({ pad, label, hasFilter, onClear, pageLabel, page, pages, onPage }: {
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

/** Design: hours under a day, otherwise one decimal of a day. */
export function fmtWait(h: number): string {
  return h < 24 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;
}
