'use client';

/**
 * Team — the OWNER's visual overview of their managers, on top of the
 * activity log.
 *
 * One payload (`GET /api/reports/team-overview`) drives everything: who is on
 * right now and what they are doing, the tasks on the Operations board and how
 * many closed in the range, how much of the journey the team completed, how
 * idle they were, and the latest activity as a feed. Every figure comes from
 * what the platform records — changes made and pages opened — so calls,
 * WhatsApp and off-platform work do not appear. Fridays are the weekend and
 * never a working day.
 *
 * The range picker (Day · Week · Month · Year, Day by default) governs every
 * card on the page bar "Last seen", which is always live.
 *
 * Reports linked from here (Activity Log · Activity by Side · Manage team)
 * own the detail; this page is the picture.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Users, ArrowUpRight, RefreshCw, Info, ClipboardList, CheckCircle2, CalendarDays, UserPlus,
  ChevronDown, ChevronLeft, ChevronRight, MapPin, Monitor, ArrowLeft, ExternalLink,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from 'recharts';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { useSlideOver } from '@/lib/useSlideOver';

// ── Payload (mirror of TeamOverviewService.getTeamOverview) ────────────────

type Status = 'active' | 'idle' | 'today' | 'offline';
interface Last { kind: 'change' | 'page'; at: string; label: string; category: string; subject: string | null; href: string | null }
interface Person {
  userId: number; name: string; email: string | null; jobTitle: string | null; avatarUrl: string | null;
  access: boolean; status: Status;
  lastAt: string | null; lastChangeAt: string | null; lastPageAt: string | null; last: Last | null;
  today: { changes: number; pages: number; minutes: number; leadsCreated: number };
  period: {
    changes: number; stepsDone: number; responses: number;
    /** Leads this person entered (creation-note author) in the window. */
    leadsCreated: number;
    /** Journey steps completed — what "Activity by step" totals for them. */
    tasksDone: number;
    avgResponseHours: number | null; onTimePct: number | null; slaPct: number | null;
    pages: number;
    activeDays: number; workingDays: number; idleDays: number; minutes: number;
    idle: {
      totalMinutes: number; pct: number | null; longestMinutes: number;
      /** The other half of the same span — on-platform minutes over the days
       *  idle is measured on. worked + idle = span, so the two never overlap. */
      workedMinutes: number; spanMinutes: number;
    };
  };
  spark: number[];
  sparkPages: number[];
}
interface FeedRow {
  id: string; at: string; userId: number; who: string; kind: 'change' | 'page';
  label: string; category: string; subject: string | null; href: string | null; why: string | null; repeats: number;
  /** Where the work happens — a step needing somebody at the unit, or desk work. */
  where: 'ground' | 'remote';
}
interface Bucket { key: string; label: string; changes: number; responses: number; onTime: number; closed: number }
interface Resp { measured: number; avgResponseHours: number | null; onTimePct: number | null; slaPct: number | null; breached: number; slaHours: number }
interface StepRow {
  key: string; label: string; source: 'table' | 'audit'; inferred: boolean;
  /** The Operations tab this step belongs to — the table groups by it. */
  group: string;
  /** Whose step it is — anything but `manager` is a gate the team chases but
   *  cannot perform, so it stays out of the ring and out of "steps done". */
  side: 'manager' | 'customer' | 'landlord';
  /** `ground` = it needs somebody at the unit; `remote` = desk work. */
  where: 'ground' | 'remote';
  /** Outstanding work today (registration pending) — not a step done. */
  live: boolean;
  total: number; repeats: number | null; people: Record<string, number> | null; owner: number | null;
  /** Leases waiting AT this step on the Operations board; null = not measurable. */
  open: number | null; openPeople: Record<string, number> | null;
  response: Resp; peopleResponse: Record<string, Resp> | null;
}
interface CalItem {
  kind: 'viewing' | 'move_in' | 'move_out'; at: string; day: string; timed: boolean;
  title: string; subject: string | null; status: string | null; who: string | null; href: string | null;
}
interface Payload {
  generatedAt: string;
  window: {
    from: string; to: string; days: number; workingDays: number; hourly: boolean; timezone: string;
    /** Steps are counted from here, not from `from` — the work log starts later. */
    countingFrom: string | null;
    /** false = the previous period predates the work log; no comparison shown. */
    prevComparable: boolean;
  };
  prev: { from: string; to: string };
  targets: {
    onTimeHours: number; slaHours: number; idleCapMinutes: number; activeNowMinutes: number;
    /** The office day idle is measured against — Fridays off. */
    officeOpen: string; officeClose: string; officeBreakMinutes: number; expectedDayMinutes: number;
  };
  teamSize: number; ownerUserId: number; activeNow: number;
  status: Record<Status, number>;
  kpis: {
    stepsDone: { v: number; prev: number }; changes: { v: number; prev: number };
    /** Journey steps recorded in the window — what Activity by step totals. */
    tasksDone: { v: number; prev: number | null };
    /** Whole leases that left the Operations board in the window. */
    leasesClosed: { v: number; prev: number | null; setup: number; ended: number };
    openWork: { v: number; setup: number; windDown: number; leads: number; byPerson: Array<{ name: string; count: number }> };
    /** Leads CREATED in the window and by whom — manager, landlord or the customer themselves. */
    leadsCreated: {
      v: number; prev: number; today: number;
      byPerson: Array<{ name: string; count: number; userId: number | null; role: string }>;
      list: Array<{ id: number; at: string; customer: string | null; source: string | null; by: string; byUserId: number | null; byRole: string }>;
    };
    avgResponseHours: { v: number | null; prev: number | null };
    onTimePct: { v: number | null; prev: number | null };
    slaPct: { v: number | null; prev: number | null };
  };
  trend: Bucket[];
  steps: StepRow[];
  team: Person[];
  calendar: { today: CalItem[]; upcoming: CalItem[] };
  feed: FeedRow[];
}

// ── Tokens (the dashboard's) ────────────────────────────────────────────────

const JADE = '#2e9f82', AMBER = '#b45309', PURPLE = '#8250df';
/** Step colours in journey order — jade → blue → amber → purple → rose → teal…, cycling. */
/** One hue per team member, by roster id — the same person keeps the same colour everywhere on the page. */
const PERSON_COLORS = ['#2e9f82', '#1e5fae', '#e8a020', '#8250df', '#c2410c', '#0e7490'];
/** The Operations tabs, in the board's own order, as the step table's groups
 *  (owner, 15 Sep 2026: "group them as per the tabs we have in operations"). */
const STEP_GROUPS: Array<[string, string]> = [
  ['lead', 'Lead'], ['new', 'New Lease'], ['renewal', 'Renewal'], ['terminated', 'Terminated'],
  ['maintenance', 'Maintenance'], ['amc', 'AMC'], ['breach', 'Breach'], ['legal', 'Legal'], ['other', 'Other'],
];
const STEP_COLORS = ['#2e9f82', '#1e5fae', '#e8a020', '#8250df', '#c2410c', '#0e7490', '#16a34a', '#7c3aed', '#b45309', '#2563eb', '#be185d', '#0f766e', '#9333ea', '#dc2626', '#4f46e5', '#65a30d'];
const GRID = '#f0ede8';
const TICK = { fontSize: 11, fill: '#9b9890' } as const;
const POLL_MS = 30_000;
/** Mirrors `WORK_LOG_FROM` on the server — where the work log starts. Used only
 *  to word the page; every figure is cut server-side. */
const WORK_LOG_FROM = '2026-08-01';

const STATUS_META: Record<Status, { word: string; dot: string; bg: string; fg: string }> = {
  active:  { word: 'Active now', dot: '#16a34a', bg: '#ecfdf5', fg: '#166534' },
  idle:    { word: 'Idle',       dot: '#d97706', bg: '#fffbeb', fg: '#92400e' },
  today:   { word: 'Seen today', dot: '#2563eb', bg: '#eff6ff', fg: '#1e40af' },
  offline: { word: 'Offline',    dot: '#9ca3af', bg: '#f3f4f6', fg: '#4b5563' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(new Date());
const shiftDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/**
 * The shortcut rail: the four periods an owner actually asks for, each running
 * up to today. Anything historical is a job for the calendars beside them —
 * offering "last month" and "last 30 days" as buttons too only made the reader
 * work out which of seven near-identical ranges they were looking at.
 */
type Preset = 'today' | 'week' | 'month' | 'year';
const PRESETS: Array<{ key: Preset; label: string; word: string; vs: string }> = [
  { key: 'today', label: 'Today',      word: 'today',      vs: 'vs yesterday' },
  { key: 'week',  label: 'This Week',  word: 'this week',  vs: 'vs last week' },
  { key: 'month', label: 'This Month', word: 'this month', vs: 'vs last month' },
  { key: 'year',  label: 'This Year',  word: 'this year',  vs: 'vs last year' },
];
/** Today · Monday → today · the 1st → today · 1 Jan → today. */
function rangeOf(p: Preset): [string, string] {
  const t = todayISO();
  switch (p) {
    case 'today': return [t, t];
    case 'week': {
      const dow = new Date(`${t}T12:00:00Z`).getUTCDay();  // 0 Sun … 6 Sat
      return [shiftDay(t, -((dow + 6) % 7)), t];
    }
    case 'month': return [`${t.slice(0, 7)}-01`, t];
    default:      return [`${t.slice(0, 4)}-01-01`, t];
  }
}

// ── Calendar maths, all on YYYY-MM-DD strings in UTC so no timezone drifts ──
const addMonthsYM = (ym: string, n: number) => {
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const y = Number(ym.slice(0, 4)) + Math.floor(m / 12);
  return `${y}-${String(((m % 12) + 12) % 12 + 1).padStart(2, '0')}`;
};
const daysInMonth = (ym: string) =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const monthTitle = (ym: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${ym}-01T00:00:00Z`));
/** One month as grid cells: leading blanks (week starts Sunday) then its days. */
function monthCells(ym: string): Array<string | null> {
  const lead = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`),
  ];
}
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const dubaiDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(new Date(iso));
const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const fmtDay = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short' }).format(new Date(iso));
const fmtDayKey = (key: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${key}T00:00:00Z`));
const fmtLongDay = (key: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${key}T00:00:00Z`));

/** How every card names the picked range. A range matching a preset speaks the
 *  preset's language; anything else names its own dates, and a single day says
 *  the day. `vs` is what the comparison figure is measured against. */
function wordsFor(from: string, to: string): { word: string; vs: string; label: string } {
  const p = PRESETS.find((x) => { const [f, t] = rangeOf(x.key); return f === from && t === to; });
  if (p) return { word: p.word, vs: p.vs, label: p.label };
  if (from === to) return { word: `on ${fmtDayKey(from)}`, vs: 'vs the day before', label: fmtDayKey(from) };
  return { word: `${fmtDayKey(from)} – ${fmtDayKey(to)}`, vs: 'vs the period before', label: `${fmtDayKey(from)} – ${fmtDayKey(to)}` };
}

function ago(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 14) return `${Math.floor(d)}d ago`;
  return fmtDay(iso);
}
const fmtMin = (m: number) => {
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
};
/** Hours as an owner reads them: "2h 30m", "1.5d". */
const fmtResp = (h: number | null) => {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
  return `${(h / 24).toFixed(1)}d`;
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
const nfmt = (n: number) => n.toLocaleString('en-AE');
const pctStr = (p: number | null) => (p == null ? '—' : `${p}%`);
/** Change against the previous window; `goodWhenUp` flips the colour for response time. */
function delta(v: number | null, prev: number | null, goodWhenUp = true): { text: string; good: boolean } | null {
  if (v == null || prev == null || (!prev && !v)) return null;
  if (!prev) return { text: '↗ new', good: goodWhenUp };
  const p = Math.round(((v - prev) / prev) * 100);
  const up = p >= 0;
  return { text: `${up ? '↗' : '↘'} ${Math.abs(p)}%`, good: up === goodWhenUp };
}

// ── Small visual parts ──────────────────────────────────────────────────────

function Sparkline({ values, color, height = 34 }: { values: number[]; color: string; height?: number }) {
  const w = 120, h = height, max = Math.max(1, ...values), n = values.length;
  if (!n) return <div style={{ height }} />;
  const bw = Math.max(1.5, w / n - 1.5);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      {values.map((v, i) => {
        const bh = Math.max(v ? 2 : 1, (v / max) * (h - 2));
        return <rect key={i} x={(i * w) / n} y={h - bh} width={bw} height={bh} rx={1} fill={color} opacity={v ? 0.85 : 0.18} />;
      })}
    </svg>
  );
}

function StatusChip({ status, lastAt, now }: { status: Status; lastAt: string | null; now: number }) {
  const m = STATUS_META[status];
  const tail = status === 'active' ? null : status === 'idle' ? ago(lastAt, now) : status === 'today' ? (lastAt ? fmtTime(lastAt) : null) : ago(lastAt, now);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap" style={{ background: m.bg, color: m.fg }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot, boxShadow: status === 'active' ? `0 0 0 3px ${m.dot}33` : undefined }} />
      {m.word}{tail ? <span className="font-normal opacity-80">· {tail}</span> : null}
    </span>
  );
}

function Avatar({ p, size = 34 }: { p: Pick<Person, 'name' | 'avatarUrl'>; size?: number }) {
  return p.avatarUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.avatarUrl} alt="" width={size} height={size} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
    : <span className="rounded-full shrink-0 inline-flex items-center justify-center font-bold text-white" style={{ width: size, height: size, background: 'var(--primary)', fontSize: size * 0.36 }}>{initials(p.name)}</span>;
}

function Card({ title, sub, action, children, className = '' }: {
  title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white rounded-2xl border border-[var(--base-200)] shadow-sm p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-[15px] font-bold text-[var(--neutral-900)] leading-tight">{title}</h3>
          {sub && <p className="text-[12px] text-[var(--neutral-400)] mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Says a figure is a snapshot of NOW, not of the picked window — used only
 *  where the source genuinely has no history to rewind (the Operations board). */
const NowChip = () => (
  <span className="rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide bg-amber-50 text-amber-800 align-middle"
    title="A snapshot of right now — the Operations board records no history, so it cannot be shown as it stood on a past date">now</span>
);

function Tile({ icon, label, value, sub, d, spark, color, hint, now }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode;
  d?: { text: string; good: boolean } | null; spark?: number[]; color: string; hint?: string; now?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--base-200)] shadow-sm p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] inline-flex items-center gap-1">{label}{now && <NowChip />}{hint && <Hint text={hint} />}</span>
        <span className="w-7 h-7 rounded-full inline-flex items-center justify-center" style={{ background: `${color}18`, color }}>{icon}</span>
      </div>
      <div className="text-[28px] font-bold tracking-tight leading-none tabular-nums text-[var(--neutral-900)]">{value}</div>
      <div className="text-[12px] text-[var(--neutral-400)] font-medium h-4 flex items-center gap-1.5 whitespace-nowrap overflow-hidden">
        {d ? <span className={d.good ? 'text-emerald-700' : 'text-rose-700'}>{d.text}</span> : null}
        {d && sub ? <span>·</span> : null}
        {sub}
      </div>
      {spark && <Sparkline values={spark} color={color} />}
    </div>
  );
}

const Hint = ({ text }: { text: string }) => (
  <span title={text} className="inline-flex text-[var(--neutral-400)] cursor-help align-middle"><Info size={13} /></span>
);

/** Which list sits behind a figure. `open` reads the Operations board (a
 *  snapshot of now); `done` and `breached` read the period's own records. */
interface Drill {
  key: string; label: string; mode: 'open' | 'done' | 'breached';
  /** Whose records — overrides the card's person tab. `null` = everybody. */
  person?: number | null;
}

/** Every number in Activity by step opens its own list, so the same underline
 *  means the same thing wherever it appears. */
function Fig({ tone, onClick, title, children }: {
  tone: 'open' | 'done' | 'bad'; onClick: () => void; title: string; children: React.ReactNode;
}) {
  const colour = tone === 'open' ? 'text-amber-700 hover:text-amber-900'
    : tone === 'bad' ? 'text-rose-700 hover:text-rose-900'
      : 'text-[var(--neutral-900)] hover:text-[var(--primary-dark)]';
  return (
    <button type="button" onClick={onClick} title={title}
      className={`tabular-nums font-semibold underline decoration-dotted underline-offset-2 ${colour}`}>
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-[13px] text-[var(--neutral-400)]">{text}</div>;
}

/** One month of the range picker's calendar. `shown` is the range being drawn —
 *  the committed draft, or the half-drawn one following the cursor. */
function PickerMonth({ ym, today, shown, onPick, onHover }: {
  ym: string; today: string; shown: { from: string; to: string };
  onPick: (d: string) => void; onHover: (d: string) => void;
}) {
  return (
    <div className="w-[188px]">
      <div className="text-center text-[12px] font-bold text-[var(--neutral-900)] h-6 leading-6">{monthTitle(ym)}</div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {DOW.map((d) => <div key={d} className="text-center text-[10px] font-bold text-[var(--neutral-400)] h-5 leading-5">{d}</div>)}
        {monthCells(ym).map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const off = d > today;
          const edge = d === shown.from || d === shown.to;
          const inside = d > shown.from && d < shown.to;
          return (
            <button key={d} type="button" disabled={off}
              onClick={() => onPick(d)} onMouseEnter={() => onHover(d)}
              className={`h-[26px] text-[11.5px] tabular-nums transition-colors ${
                off ? 'text-[var(--neutral-300)] cursor-not-allowed'
                  : edge ? 'bg-[var(--primary)] text-white font-bold rounded-md'
                    : inside ? 'bg-[var(--primary)]/12 text-[var(--neutral-900)]'
                      : 'text-[var(--neutral-700)] hover:bg-[var(--base-100)] rounded-md'}`}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The page's ONE date filter, in the shape of daterangepicker.com: a rail of
 * shortcuts on the left, two months side by side on the right, and the range
 * only committed on Apply. The presets write into the SAME from–to range the
 * calendars do, so there is never a question of which of two controls is
 * winning — whatever the button reads IS what every card on the page shows.
 *
 * Built natively rather than with the jQuery plugin: the page is React, and the
 * plugin brings jQuery + moment for a control this size.
 */
function RangePicker({ range, onChange, open, setOpen }: {
  range: { from: string; to: string };
  onChange: (r: { from: string; to: string }) => void;
  open: boolean; setOpen: (v: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const today = todayISO();
  /** Nothing is applied until Apply — Cancel and click-away both discard. */
  const [draft, setDraft] = useState(range);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [leftYM, setLeftYM] = useState(() => range.from.slice(0, 7));

  const reveal = () => {
    setDraft(range); setAnchor(null); setHover(null); setLeftYM(range.from.slice(0, 7));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open, setOpen]);

  const activePreset = PRESETS.find((p) => { const [f, t] = rangeOf(p.key); return f === draft.from && t === draft.to; })?.key ?? null;
  const buttonLabel = range.from === range.to ? fmtLongDay(range.from) : `${fmtLongDay(range.from)} – ${fmtLongDay(range.to)}`;

  /** First click drops the anchor, second closes the range — either way round,
   *  so dragging backwards through the calendar still means what it looks like. */
  const pick = (d: string) => {
    if (anchor == null) { setAnchor(d); setDraft({ from: d, to: d }); return; }
    setDraft(d < anchor ? { from: d, to: anchor } : { from: anchor, to: d });
    setAnchor(null);
  };
  /** While a range is half-drawn, the hovered day stands in for its far end. */
  const shown = anchor != null && hover
    ? (hover < anchor ? { from: hover, to: anchor } : { from: anchor, to: hover })
    : draft;

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => (open ? setOpen(false) : reveal())} aria-expanded={open} aria-haspopup="dialog"
        className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12.5px] font-semibold shadow-sm ${open ? 'border-[var(--primary)] text-[var(--primary-dark)]' : 'border-[var(--base-200)] text-[var(--neutral-700)] hover:border-[var(--neutral-400)]'}`}>
        <CalendarDays size={14} />
        {buttonLabel}
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="dialog" aria-label="Date range"
          className="absolute right-0 z-30 mt-2 rounded-2xl border border-[var(--base-200)] bg-white shadow-lg flex overflow-hidden">
          <ul className="w-[132px] shrink-0 border-r border-[var(--base-100)] py-2 bg-[var(--base-50,#fbfaf8)]">
            {PRESETS.map((p) => (
              <li key={p.key}>
                <button type="button"
                  onClick={() => { const [f, t] = rangeOf(p.key); onChange({ from: f, to: t }); setOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] font-semibold transition-colors ${activePreset === p.key ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-700)] hover:bg-[var(--base-100)]'}`}>
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="p-3" onMouseLeave={() => setHover(null)}>
            <div className="flex items-center justify-between mb-1">
              <button type="button" aria-label="Previous month" onClick={() => setLeftYM(addMonthsYM(leftYM, -1))}
                className="w-6 h-6 rounded-md inline-flex items-center justify-center text-[var(--neutral-600)] hover:bg-[var(--base-100)]"><ChevronLeft size={15} /></button>
              <button type="button" aria-label="Next month" disabled={addMonthsYM(leftYM, 1) > today.slice(0, 7)}
                onClick={() => setLeftYM(addMonthsYM(leftYM, 1))}
                className="w-6 h-6 rounded-md inline-flex items-center justify-center text-[var(--neutral-600)] hover:bg-[var(--base-100)] disabled:text-[var(--neutral-300)] disabled:hover:bg-transparent"><ChevronRight size={15} /></button>
            </div>
            <div className="flex gap-4">
              <PickerMonth ym={leftYM} today={today} shown={shown} onPick={pick} onHover={setHover} />
              <PickerMonth ym={addMonthsYM(leftYM, 1)} today={today} shown={shown} onPick={pick} onHover={setHover} />
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--base-100)] flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-[var(--neutral-700)] tabular-nums">
                {draft.from === draft.to ? fmtLongDay(draft.from) : `${fmtLongDay(draft.from)} – ${fmtLongDay(draft.to)}`}
              </span>
              <span className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)}
                  className="rounded-lg border border-[var(--base-200)] px-3 py-1.5 text-[12px] font-semibold text-[var(--neutral-700)] hover:bg-[var(--base-100)]">Cancel</button>
                <button type="button" onClick={() => { onChange(draft); setOpen(false); }}
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[12px] font-semibold text-white">Apply</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── The page ────────────────────────────────────────────────────────────────

export function TeamOverviewView({ endpoint, manageHref, reportsHref, operationsHref, leadsHref: leadsHrefProp }: {
  endpoint: string; manageHref: string; reportsHref: string; operationsHref: string;
  /** Leads page of the same portal — defaults to the Operations href's sibling. */
  leadsHref?: string;
}) {
  const leadsHref = leadsHrefProp ?? operationsHref.replace(/\/operations(\?.*)?$/, '/leads$1');
  /** ONE filter for the whole page: a from–to range. The presets are shortcuts
   *  that write into it, not a second control with its own state.
   *
   *  Opens on TODAY — the page is read to see what the team is doing now, and
   *  the month is one click away on the rail. */
  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const [f, t] = rangeOf('today');
    return { from: f, to: t };
  });
  const [rangeOpen, setRangeOpen] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Tasks by default: the journey being moved along, not every recorded edit. */
  const [feedKind, setFeedKind] = useState<'task' | 'change' | 'page'>('task');
  /** Live feed: everyone, or one team member. */
  const [feedPerson, setFeedPerson] = useState<number | 'all'>('all');
  // The feed is PAGED from its own endpoint (the page payload only carries the
  // newest few): first page on every filter / window / poll change, more as the
  // list is scrolled to its end.
  const [feedRows, setFeedRows] = useState<FeedRow[]>([]);
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [feedMore, setFeedMore] = useState(false);
  const [feedBusy, setFeedBusy] = useState(false);
  const feedReq = useRef(0);
  const [stepPerson, setStepPerson] = useState<number | 'all'>('all');
  /** Where the work happens: everything, only what needs somebody at the unit,
   *  or only what can be done from a desk. */
  const [stepWhere, setStepWhere] = useState<'all' | 'ground' | 'remote'>('all');
  const [drill, setDrill] = useState<Drill | null>(null);
  /** Trend legend: click a name to see only them; click again for everyone. */
  const [trendPerson, setTrendPerson] = useState<number | 'all'>('all');
  const [now, setNow] = useState(() => Date.now());

  // Loading is DERIVED (no data yet, or data for a different window than the
  // one picked) rather than a flag set on the way into the fetch — a derived
  // value cannot get out of step with the payload.
  const { from, to } = range;
  const loading = !data || data.window.from !== from || data.window.to !== to;
  // The fetch re-runs whenever the window changes, on the poll timer, and on
  // Refresh — all three just bump `tick`. State is only set in the promise
  // chain, never synchronously in the effect body.
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${endpoint}?from=${from}&to=${to}`, { credentials: 'include', signal: ac.signal })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as Payload; })
      .then((d) => { setData(d); setError(null); setNow(Date.now()); })
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message || 'Could not load'); });
    return () => ac.abort();
  }, [endpoint, from, to, tick]);
  const feedUrl = useCallback((before: string | null) => {
    const qs = new URLSearchParams({ from, to, kind: feedKind, limit: '40' });
    if (feedPerson !== 'all') qs.set('person', String(feedPerson));
    if (before) qs.set('before', before);
    return `${endpoint}/feed?${qs}`;
  }, [endpoint, from, to, feedKind, feedPerson]);
  useEffect(() => {
    const ac = new AbortController();
    const req = ++feedReq.current;
    fetch(feedUrl(null), { credentials: 'include', signal: ac.signal })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as { rows: FeedRow[]; nextBefore: string | null; hasMore: boolean }; })
      .then((d) => { if (req !== feedReq.current) return; setFeedRows(d.rows); setFeedCursor(d.nextBefore); setFeedMore(d.hasMore); })
      .catch(() => { /* the page's own error banner covers the endpoint being down */ });
    return () => ac.abort();
  }, [feedUrl, tick]);
  const loadMoreFeed = useCallback(() => {
    if (feedBusy || !feedMore || !feedCursor) return;
    setFeedBusy(true);
    const req = feedReq.current;
    fetch(feedUrl(feedCursor), { credentials: 'include' })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as { rows: FeedRow[]; nextBefore: string | null; hasMore: boolean }; })
      .then((d) => {
        if (req !== feedReq.current) return;
        setFeedRows((prev) => { const seen = new Set(prev.map((r) => r.id)); return [...prev, ...d.rows.filter((r) => !seen.has(r.id))]; });
        setFeedCursor(d.nextBefore); setFeedMore(d.hasMore);
      })
      .catch(() => {})
      .finally(() => setFeedBusy(false));
  }, [feedBusy, feedMore, feedCursor, feedUrl]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, []);

  const trend = useMemo(() => (data?.trend ?? []).map((b) => ({ ...b, x: data?.window.hourly ? b.label : fmtDayKey(b.key) })), [data]);
  const sortedTeam = useMemo(() => [...(data?.team ?? [])].sort((a, b) => a.userId - b.userId), [data]);
  /** Top managers first — activities in the period, then page visits. */
  const rankedTeam = useMemo(() => [...(data?.team ?? [])].sort((a, b) => b.period.changes - a.period.changes || b.sparkPages.reduce((x, y) => x + y, 0) - a.sparkPages.reduce((x, y) => x + y, 0)), [data]);
  /** One row per bucket: u<uid> = changes, p<uid> = pages, per team member. */
  const trendByPerson = useMemo(() => trend.map((b, i) => {
    const row: Record<string, string | number> = { x: b.x };
    for (const p of data?.team ?? []) {
      row[`u${p.userId}`] = p.spark[i] ?? 0; row[`p${p.userId}`] = p.sparkPages[i] ?? 0;
      // The owner reads one figure per person: everything they did that day.
      row[`a${p.userId}`] = (p.spark[i] ?? 0) + (p.sparkPages[i] ?? 0);
    }
    return row;
  }), [trend, data]);
  /* Three figures on this page come from the Operations board, which is derived
   * from each lease's CURRENT state — there is no history of when a checklist
   * gate was ticked, so the board cannot be rewound to a past date. Rather than
   * show a stale number as if it belonged to the window, they are marked. */
  const pastWindow = to < todayISO();
  // The words every card uses to say WHICH period it is showing. A range that
  // happens to match a preset borrows its wording ("this month"); any other
  // range names its own dates.
  const P = useMemo(() => wordsFor(from, to), [from, to]);
  const T = data?.targets;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--neutral-900)]">Team</h1>
          <p className="mt-1 text-sm text-[var(--neutral-500)]">
            Live overview of your team — what they are doing, and the tasks they closed{' '}
            <Hint text="Everything here is read from what the platform records — activities and page visits. Calls, WhatsApp and anything done off the platform leave no trace. Fridays are the weekend and never counted as a working day." />
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RangePicker range={range} onChange={setRange} open={rangeOpen} setOpen={setRangeOpen} />
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--base-200)] bg-white px-3 py-2 text-[12.5px] font-semibold text-[var(--neutral-700)] shadow-sm hover:border-[var(--neutral-400)]">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link href={manageHref} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--base-200)] bg-white px-3 py-2 text-[12.5px] font-semibold text-[var(--neutral-700)] shadow-sm hover:border-[var(--neutral-400)]">
            <Users size={13} /> Manage team
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-center justify-between">
          <span>Could not load the team overview ({error}).</span>
          <button type="button" onClick={load} className="font-semibold underline">Retry</button>
        </div>
      )}

      {!data && !error && <Skeleton />}

      {data && data.teamSize === 0 && (
        <div className="bg-white rounded-2xl border border-[var(--base-200)] p-10 text-center">
          <Users size={28} className="mx-auto text-[var(--neutral-400)]" />
          <p className="mt-3 font-bold text-[var(--neutral-900)]">No managers on this portfolio yet</p>
          <p className="text-sm text-[var(--neutral-500)] mt-1">Invite a manager and their work will appear here as it happens.</p>
          <Link href={manageHref} className="inline-flex mt-4 rounded-xl bg-[var(--primary)] text-white px-4 py-2 text-sm font-semibold">Invite a manager</Link>
        </div>
      )}

      {data && T && data.teamSize > 0 && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-white rounded-2xl border border-[var(--base-200)] shadow-sm p-4 flex flex-col gap-2 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] inline-flex items-center gap-1">Active now{pastWindow && <NowChip />}</span>
                <span className="w-7 h-7 rounded-full inline-flex items-center justify-center" style={{ background: '#16a34a18', color: '#16a34a' }}><Users size={14} /></span>
              </div>
              <div className="text-[28px] font-bold tracking-tight leading-none tabular-nums text-[var(--neutral-900)]">{data.activeNow}<span className="text-[15px] text-[var(--neutral-400)] font-semibold"> / {data.teamSize}</span></div>
              <div className="text-[12px] text-[var(--neutral-400)] font-medium h-4">of {data.teamSize} team member{data.teamSize === 1 ? '' : 's'} · last {T.activeNowMinutes} min</div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {(['active', 'idle', 'today', 'offline'] as Status[]).filter((s) => data.status[s]).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: STATUS_META[s].bg, color: STATUS_META[s].fg }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_META[s].dot }} />{data.status[s]} {STATUS_META[s].word.toLowerCase()}
                  </span>
                ))}
              </div>
            </div>
            <Tile icon={<ClipboardList size={14} />} label="Opened Tasks" color={AMBER} now={pastWindow}
              value={<Link href={operationsHref} className="hover:underline">{nfmt(data.kpis.openWork.v)}</Link>}
              sub={data.kpis.openWork.byPerson.length
                ? data.kpis.openWork.byPerson.map((b) => `${b.name.split(' ')[0]} ${b.count}`).join(' · ')
                : `${data.kpis.openWork.setup} in setup · ${data.kpis.openWork.windDown} winding down · ${data.kpis.openWork.leads} lead${data.kpis.openWork.leads === 1 ? '' : 's'}`}
              hint={`Everything on the Operations page right now — ${data.kpis.openWork.setup} lease${data.kpis.openWork.setup === 1 ? '' : 's'} in setup, ${data.kpis.openWork.windDown} winding down and ${data.kpis.openWork.leads} lead${data.kpis.openWork.leads === 1 ? '' : 's'} still in the funnel — by whose queue it sits in. A lease's queue is the board's own handler rule (the manager most active on it); a lead's is whoever it is assigned to. The Open tasks column below breaks the same figure down by step.`} />
            <Tile icon={<CheckCircle2 size={14} />} label="Tasks completed" color={JADE}
              value={nfmt(data.kpis.tasksDone.v)} d={delta(data.kpis.tasksDone.v, data.kpis.tasksDone.prev)}
              sub={`${nfmt(data.kpis.leasesClosed.v)} lease${data.kpis.leasesClosed.v === 1 ? '' : 's'} closed`}
              hint={`Journey steps the team recorded ${P.word} — the same figure Activity by step totals below, so the two always agree. ${data.window.prevComparable
                ? `${P.vs.replace('vs', 'Compared with')}.`
                : `No comparison is shown: the period before this one falls before ${fmtDayKey(WORK_LOG_FROM)} ${WORK_LOG_FROM.slice(0, 4)}, where the work log starts. Everything earlier is import history and bulk stamps, so comparing against it would read a gap in the data as a fall in output.`} Separately, ${data.kpis.leasesClosed.v} whole lease${data.kpis.leasesClosed.v === 1 ? '' : 's'} left the Operations board in that time (${data.kpis.leasesClosed.setup} set up, ${data.kpis.leasesClosed.ended} ended) — a coarser unit than a step, which is why it is named apart.`} />
            <Tile icon={<UserPlus size={14} />} label="Leads created" color="#2563eb"
              value={<Link href={leadsHref} className="hover:underline">{nfmt(data.kpis.leadsCreated.v)}</Link>}
              d={delta(data.kpis.leadsCreated.v, data.kpis.leadsCreated.prev)}
              sub={data.kpis.leadsCreated.byPerson.length
                ? data.kpis.leadsCreated.byPerson.map((b) => `${b.userId == null ? 'Self-service' : b.name.split(' ')[0]} ${b.count}`).join(' · ')
                : `No leads created ${P.word}`}
              hint={`Leads entered ${P.word} and who entered them — a manager or the landlord (the lead's creation note names them), or the customer themselves through a viewing request or Book Now (self-service). ${data.window.days === 1 ? '' : `${nfmt(data.kpis.leadsCreated.today)} of them today. `}${P.vs.replace('vs', 'Compared with')}.`} />
          </div>

          {/* Live team activity + idle time */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 mb-4">
            <Card title="Live team activity" sub={`Newest first, ${P.word}`} action={
              <div className="flex items-center gap-3">
                <div className="inline-flex rounded-lg border border-[var(--base-200)] p-0.5 text-[11.5px] font-semibold">
                  {([['task', 'Tasks'], ['change', 'Activities'], ['page', 'Page Visits']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setFeedKind(k)}
                      className={`px-2 py-1 rounded-md ${feedKind === k ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-600)] hover:bg-[var(--base-100)]'}`}>{l}</button>
                  ))}
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--neutral-400)] whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE · {ago(data.generatedAt, now)}
                </span>
              </div>}>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <div className="inline-flex rounded-lg border border-[var(--base-200)] p-0.5 text-[11.5px] font-semibold">
                    <button type="button" onClick={() => setFeedPerson('all')}
                      className={`px-2 py-1 rounded-md ${feedPerson === 'all' ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-600)] hover:bg-[var(--base-100)]'}`}>All</button>
                    {rankedTeam.map((p, i) => (
                      <button key={p.userId} type="button" onClick={() => setFeedPerson(p.userId)}
                        title={`#${i + 1} · ${nfmt(p.period.tasksDone)} tasks · ${nfmt(p.period.changes)} activities ${P.word}`}
                        className={`px-2 py-1 rounded-md ${feedPerson === p.userId ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-600)] hover:bg-[var(--base-100)]'}`}>
                        {p.name.split(' ')[0]}
                      </button>
                    ))}
                    {/* The landlord is in this feed too — their own work is
                        counted by Activity by step, so it belongs here. */}
                    <button type="button" onClick={() => setFeedPerson(data.ownerUserId)}
                      title="What the rental provider did"
                      className={`px-2 py-1 rounded-md ${feedPerson === data.ownerUserId ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-600)] hover:bg-[var(--base-100)]'}`}>
                      Rental Provider
                    </button>
                  </div>
                </div>
                {feedRows.length === 0 ? <Empty text={`${feedKind === 'task' ? 'No journey steps' : feedKind === 'page' ? 'No page visits' : 'Nothing'} recorded ${feedPerson === 'all' ? '' : 'for them '}in this period.`} /> : (
                  <div className="overflow-auto -mx-5 max-h-[560px]"
                    onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMoreFeed(); }}>
                    <table className="w-full text-[13px] table-fixed">
                      <colgroup><col style={{ width: '26%' }} /><col style={{ width: '40%' }} /><col style={{ width: '16%' }} /><col style={{ width: '18%' }} /></colgroup>
                      <thead className="sticky top-0 bg-white z-[1]">
                        <tr className="text-[10.5px] font-bold tracking-[0.1em] uppercase text-[var(--neutral-400)] border-b border-[var(--base-200)]">
                          <th className="text-left font-bold pl-5 pr-3 py-2">Team member</th>
                          <th className="text-left font-bold px-3 py-2">Activity</th>
                          <th className="text-left font-bold px-2 py-2 leading-tight">On ground / Remote</th>
                          <th className="text-right font-bold pl-3 pr-5 py-2">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feedRows.map((r) => {
                          const who = data.team.find((t) => t.userId === r.userId);
                          return (
                            <tr key={r.id} className="border-b border-[var(--base-100)] last:border-0 align-top">
                              <td className="pl-5 pr-3 py-2.5">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <Avatar p={who ?? { name: r.who, avatarUrl: null }} size={30} />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-[var(--neutral-900)] truncate">{r.who.split(' ').slice(0, 2).join(' ')}</div>
                                    <div className="text-[11.5px] text-[var(--neutral-400)] truncate">{who?.jobTitle ?? 'Manager'}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="font-medium text-[var(--neutral-900)] leading-snug break-words">
                                  {r.kind === 'page' ? r.label.replace(/^Viewed /, 'Viewing ') : r.label}
                                  {r.repeats > 1 && <span className="ml-1 text-[11px] font-semibold text-[var(--neutral-400)]">×{r.repeats}</span>}
                                </div>
                                <div className="text-[11.5px] text-[var(--neutral-500)] truncate">
                                  {r.subject
                                    ? (r.href ? <Link href={r.href} className="text-[var(--primary-dark)] hover:underline">{r.subject}</Link> : r.subject)
                                    : <span className="text-[var(--neutral-400)]">—</span>}
                                  {r.why ? <> · <em>{r.why}</em></> : null}
                                </div>
                              </td>
                              <td className="px-2 py-2.5">
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                                  style={r.where === 'ground' ? { background: '#e3f1f0', color: '#1f5e5c' } : { background: '#f3f4f6', color: '#4b5563' }}>
                                  {r.where === 'ground' ? <MapPin size={11} /> : <Monitor size={11} />}
                                  {r.where === 'ground' ? 'On ground' : 'Remote'}
                                </span>
                              </td>
                              <td className="pl-2 pr-5 py-2.5 text-right tabular-nums text-[var(--neutral-700)] whitespace-nowrap">
                                <div>{fmtTime(r.at)}</div>
                                {!data.window.hourly && <div className="text-[11px] text-[var(--neutral-500)]">{fmtDay(r.at)}</div>}
                                <div className="text-[11px] text-[var(--neutral-400)]">{ago(r.at, now)}</div>
                              </td>
                            </tr>
                          );
                        })}
                        <tr>
                          <td colSpan={4} className="py-2 text-center text-[11.5px] text-[var(--neutral-400)]">
                            {feedBusy ? 'Loading more…' : feedMore
                              ? <button type="button" onClick={loadMoreFeed} className="font-semibold text-[var(--primary-dark)] hover:underline">Load more</button>
                              : 'That is everything in this period.'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-4 text-[11.5px] font-semibold text-[var(--neutral-600)]">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: JADE }} />{nfmt(feedRows.filter((r) => r.kind === 'change').length)} {feedKind === 'task' ? 'tasks' : 'activities'}</span>
                  {feedKind !== 'task' && (
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: PURPLE }} />{nfmt(feedRows.filter((r) => r.kind === 'page').length)} page visits</span>
                  )}
                  <span className="text-[var(--neutral-400)] font-medium">loaded so far{feedMore ? ' · scroll for more' : ''}</span>
                </div>
            </Card>

            <div className="space-y-4">
            <Card title="Time" sub={`${P.word[0].toUpperCase()}${P.word.slice(1)}`} action={
              <Hint text={`Time on the platform ${P.word}, measured from the gaps between what they did, breaks over ${T.idleCapMinutes} minutes excluded — a floor, not a timesheet. Last seen = the last thing recorded for them, and is always live whatever the range.`} />}>
              <table className="w-full text-[13px] table-fixed">
                <colgroup><col style={{ width: '50%' }} /><col style={{ width: '26%' }} /><col style={{ width: '24%' }} /></colgroup>
                <thead>
                  <tr className="text-[10.5px] font-bold tracking-[0.1em] uppercase text-[var(--neutral-400)] border-b border-[var(--base-200)]">
                    <th className="text-left font-bold pr-2 py-2">Team member</th>
                    <th className="text-right font-bold px-2 py-2 leading-tight">On the platform</th>
                    <th className="text-right font-bold pl-2 py-2 leading-tight">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.map((p) => (
                    <tr key={p.userId} className="border-b border-[var(--base-100)] last:border-0">
                      <td className="pr-2 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar p={p} size={28} />
                          <div className="min-w-0">
                            <div className="font-semibold text-[var(--neutral-900)] truncate text-[12.5px]">{p.name.split(' ').slice(0, 2).join(' ')}</div>
                            <div className="mt-0.5"><StatusChip status={p.status} lastAt={p.lastAt} now={now} /></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-[var(--neutral-900)] whitespace-nowrap">{fmtMin(p.period.minutes)}</td>
                      <td className="pl-2 py-2.5 text-right tabular-nums text-[var(--neutral-700)] whitespace-nowrap">
                        {p.lastAt ? <><div>{dubaiDay(p.lastAt) === todayISO() ? fmtTime(p.lastAt) : `${fmtDay(p.lastAt)}, ${fmtTime(p.lastAt)}`}</div><div className="text-[11px] text-[var(--neutral-400)]">{ago(p.lastAt, now)}</div></> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Idle time"
              sub={`${P.word[0].toUpperCase()}${P.word.slice(1)} · ${T.officeOpen}–${T.officeClose}, Fridays off`} action={
              <Hint text={`Measured against the OFFICE DAY: ${T.officeOpen} to ${T.officeClose} less a ${T.officeBreakMinutes}-minute break, so ${Math.round(T.expectedDayMinutes / 60)} hours are expected of every working day and Fridays expect nothing. Idle is that day less the time on the platform in it — a break counts as work up to ${T.idleCapMinutes} minutes, since a short pause is still working. A late start, an early finish and a day with nothing recorded all count, and work done outside office hours counts for you. Capped at the day both ways: a long Tuesday cannot pay for an empty Wednesday. Phone calls and off-platform work are invisible here, so read it as a floor on activity, not a verdict. Longest = the longest single break inside a day. Idle days = working days with nothing recorded at all.`} />}>
              {/* Three columns on fixed widths, like the Time card above it. Five
                  did not fit the card and spilled out of it — and one of the
                  five was on-platform time, which that card already shows. The
                  split is carried in the idle cell instead: the share, and the
                  span it is a share OF, so what is left is on the platform. */}
              <table className="w-full text-[13px] table-fixed">
                <colgroup><col style={{ width: '46%' }} /><col style={{ width: '30%' }} /><col style={{ width: '24%' }} /></colgroup>
                <thead>
                  <tr className="text-[10.5px] font-bold tracking-[0.1em] uppercase text-[var(--neutral-400)] border-b border-[var(--base-200)]">
                    <th className="text-left font-bold pr-2 py-2">Team member</th>
                    <th className="text-right font-bold px-2 py-2 leading-tight">Total idle</th>
                    <th className="text-right font-bold pl-2 py-2 leading-tight">Longest break</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.map((p) => (
                    <tr key={p.userId} className="border-b border-[var(--base-100)] last:border-0">
                      <td className="pr-2 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar p={p} size={26} />
                          <div className="min-w-0">
                            <div className="font-semibold text-[var(--neutral-900)] truncate text-[12.5px]">{p.name.split(' ').slice(0, 2).join(' ')}</div>
                            <div className="text-[11px] text-[var(--neutral-400)]">{p.period.idleDays ? `${p.period.idleDays} idle day${p.period.idleDays === 1 ? '' : 's'}` : 'no idle days'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-[var(--neutral-900)]">{fmtMin(p.period.idle.totalMinutes)}</div>
                        <div className="text-[11px] text-[var(--neutral-400)]">
                          {p.period.idle.pct != null ? `${pctStr(p.period.idle.pct)} of ${fmtMin(p.period.idle.spanMinutes)}` : '—'}
                        </div>
                      </td>
                      <td className="pl-2 py-2.5 text-right tabular-nums text-[var(--neutral-700)] whitespace-nowrap">{fmtMin(p.period.idle.longestMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Top performers" sub={`${P.word[0].toUpperCase()}${P.word.slice(1)} · by tasks completed`} action={
              <Link href={`${reportsHref}/activity-log`} className="text-[12px] font-semibold text-[var(--primary-dark)] hover:underline inline-flex items-center gap-1 whitespace-nowrap">View all <ArrowUpRight size={11} /></Link>}>
              {(() => {
                // Ranked on TASKS COMPLETED — the journey steps each person took a
                // record through, the same figure their column in "Activity by
                // step" totals. Ranking on raw activity counted every edit and
                // re-save alike, which put the busiest keyboard on top rather
                // than the most work finished. Activity stays on the row as
                // context, never as the score.
                const ranked = [...data.team].sort((a, b) => b.period.tasksDone - a.period.tasksDone || b.period.changes - a.period.changes);
                const total = ranked.reduce((x, p) => x + p.period.tasksDone, 0);
                if (!total) return <Empty text={`No tasks completed ${P.word}.`} />;
                return (
                  <ul className="space-y-3">
                    {ranked.map((p, i) => {
                      const share = Math.round((p.period.tasksDone / total) * 100);
                      return (
                        <li key={p.userId} className="flex items-center gap-3">
                          <span className="text-[11px] font-bold text-[var(--neutral-400)] w-3">{i + 1}</span>
                          <Avatar p={p} size={30} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-[13px] text-[var(--neutral-900)] truncate">{p.name.split(' ').slice(0, 2).join(' ')}</span>
                              <span className="tabular-nums text-[12px] text-[var(--neutral-700)] whitespace-nowrap"><span className="font-semibold text-[var(--neutral-900)]">{nfmt(p.period.tasksDone)}</span> {p.period.tasksDone === 1 ? 'task' : 'tasks'} · <span className="font-semibold text-[var(--neutral-900)]">{share}%</span></span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-[var(--base-100)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${share}%`, background: 'var(--primary)' }} /></div>
                            <div className="mt-0.5 text-[11px] text-[var(--neutral-400)] tabular-nums text-right">{p.period.leadsCreated ? `${nfmt(p.period.leadsCreated)} lead${p.period.leadsCreated === 1 ? '' : 's'} created · ` : ''}{nfmt(p.period.changes)} activities · {nfmt(p.period.pages)} page visits · {fmtMin(p.period.minutes)}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </Card>
            </div>
          </div>

          {/* Activity by step + trend */}
          <div className="grid grid-cols-1 xl:grid-cols-[640px_minmax(0,1fr)] gap-4 mb-4">
            <Card title="Activity by step"
              sub={`${stepWhere === 'ground' ? 'Steps needing somebody at the unit' : stepWhere === 'remote' ? 'Steps that can be done from a desk' : 'Open now, and completed'} ${stepWhere === 'all' ? P.word : `· ${P.word}`} — records, counted once${data.window.countingFrom ? ` · counted from ${fmtDayKey(data.window.countingFrom)} ${data.window.countingFrom.slice(0, 4)}` : ''}`} action={
              <Link href={`${reportsHref}/manager-activity-counters`} className="text-[12px] font-semibold text-[var(--primary-dark)] hover:underline inline-flex items-center gap-1 whitespace-nowrap">Activity by Side <ArrowUpRight size={11} /></Link>}>
              {/* Who on the left, where-the-work-happens on the right. */}
              <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
                <div className="inline-flex rounded-lg border border-[var(--base-200)] p-0.5 text-[11.5px] font-semibold flex-wrap">
                  <button type="button" onClick={() => setStepPerson('all')}
                    className={`px-2.5 py-1 rounded-md ${stepPerson === 'all' ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-600)] hover:bg-[var(--base-100)]'}`}>All</button>
                  {[...data.team].sort((a, b) => a.userId - b.userId).map((p) => (
                    <button key={p.userId} type="button" onClick={() => setStepPerson(p.userId)}
                      className={`px-2.5 py-1 rounded-md ${stepPerson === p.userId ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-600)] hover:bg-[var(--base-100)]'}`}>{p.name.split(' ')[0]}</button>
                  ))}
                  {/* The landlord's own work is counted here too, so it can be
                      read on its own like anybody else's. */}
                  <button type="button" onClick={() => setStepPerson(data.ownerUserId)} title="What the rental provider did"
                    className={`px-2.5 py-1 rounded-md whitespace-nowrap ${stepPerson === data.ownerUserId ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-600)] hover:bg-[var(--base-100)]'}`}>Rental Provider</button>
                </div>
                <div className="inline-flex rounded-lg border border-[var(--base-200)] p-0.5 text-[11.5px] font-semibold flex-wrap">
                  {([['all', 'All'], ['ground', 'On ground'], ['remote', 'Remote']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setStepWhere(k)}
                      title={k === 'ground' ? 'Steps that need somebody at the unit' : k === 'remote' ? 'Steps that can be done from a desk' : 'Every step'}
                      className={`px-2.5 py-1 rounded-md ${stepWhere === k ? 'bg-[var(--primary)] text-white' : 'text-[var(--neutral-600)] hover:bg-[var(--base-100)]'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <StepDonut steps={data.steps} team={data.team} person={stepPerson} where={stepWhere}
                ownerUserId={data.ownerUserId} onDrill={setDrill} operationsHref={operationsHref} />
            </Card>

            <Card title="Activity trend" sub={
              <span className="inline-flex items-center gap-x-3 gap-y-1 flex-wrap">
                <span>{sortedTeam.map((p) => p.name.split(' ')[0]).join(' vs ')} — all activity (activities + page visits), {data.window.hourly ? `hour by hour, ${P.word}` : `day by day, ${P.word}`}</span>
                {sortedTeam.map((p, i) => {
                  const on = trendPerson === 'all' || trendPerson === p.userId;
                  return (
                    <button key={p.userId} type="button" onClick={() => setTrendPerson(trendPerson === p.userId ? 'all' : p.userId)}
                      title={trendPerson === p.userId ? 'Show everyone' : `Show only ${p.name.split(' ')[0]}`}
                      className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap rounded-md px-1.5 py-0.5 border transition-colors ${trendPerson === p.userId ? 'border-[var(--base-200)] bg-[var(--base-100)]' : 'border-transparent hover:bg-[var(--base-100)]'} ${on ? '' : 'opacity-40'}`}>
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PERSON_COLORS[i % PERSON_COLORS.length] }} />{p.name.split(' ')[0]}
                    </button>
                  );
                })}
              </span>} action={
              <Hint text="One line per person: everything they did on the platform that day — activities plus page visits. Hover a day to see the split. Click a name to see only them; click it again for everyone." />}>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendByPerson} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      {sortedTeam.map((p, i) => (
                        <linearGradient key={p.userId} id={`gP${p.userId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PERSON_COLORS[i % PERSON_COLORS.length]} stopOpacity={0.28} />
                          <stop offset="100%" stopColor={PERSON_COLORS[i % PERSON_COLORS.length]} stopOpacity={0.02} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="x" tick={TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6e0', fontSize: 12 }}
                      formatter={(v, name, item) => {
                        const uid = String(name).replace(/^a/, '');
                        const row = item?.payload as Record<string, number> | undefined;
                        const who = sortedTeam.find((p) => String(p.userId) === uid)?.name.split(' ')[0] ?? '';
                        return [`${nfmt(Number(v))} (${nfmt(row?.[`u${uid}`] ?? 0)} activities · ${nfmt(row?.[`p${uid}`] ?? 0)} page visits)`, who];
                      }}
                      labelFormatter={(l) => String(l)} />
                    {sortedTeam.filter((p) => trendPerson === 'all' || trendPerson === p.userId).map((p) => { const i = sortedTeam.indexOf(p); return (
                      <Area key={`a${p.userId}`} type="monotone" dataKey={`a${p.userId}`} name={`a${p.userId}`}
                        stroke={PERSON_COLORS[i % PERSON_COLORS.length]} strokeWidth={2.2} fill={`url(#gP${p.userId})`} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                    ); })}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}
      {drill && data && (
        <StepDrill endpoint={endpoint} from={from} to={to}
          person={drill.person !== undefined ? drill.person : (stepPerson === 'all' ? null : stepPerson)}
          personName={(() => {
            const uid = drill.person !== undefined ? drill.person : (stepPerson === 'all' ? null : stepPerson);
            if (uid == null) return null;
            if (uid === data.ownerUserId) return 'Rental Provider';
            return data.team.find((p) => p.userId === uid)?.name.split(' ')[0] ?? null;
          })()}
          drill={drill} periodWord={P.word} now={now} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

/** The team's side of the journey as the mockup draws it: a donut of the steps
 *  completed (records, counted once) with the legend beside it — label · count
 *  · share — in journey order. `person` narrows it to one team member (their
 *  own distinct records per step); steps whose source names nobody are then
 *  left out and said so. Steps with nothing are listed beneath in one line. */
function StepDonut({ steps, team, person, where, ownerUserId, onDrill, operationsHref }: {
  steps: StepRow[]; team: Person[]; person: number | 'all'; where: 'all' | 'ground' | 'remote';
  ownerUserId: number; onDrill: (d: Drill) => void; operationsHref: string;
}) {
  const nameOf = new Map(team.map((p) => [String(p.userId), p.name.split(' ')[0]]));
  /** The landlord is not on the roster, so their share of a step is `owner`,
   *  not an entry in `people` (which only ever holds manager ids). */
  const isOwner = person === ownerUserId;
  const valueOf = (s: StepRow) =>
    (person === 'all' ? s.total : isOwner ? (s.owner ?? 0) : (s.people ? (s.people[String(person)] ?? 0) : 0));
  // Live rows (Contract registration pending) are NOT drawn: they are work
  // outstanding, which every step now states in its own Open tasks column, and
  // an owner reads one registration line rather than two. The payload still
  // carries the row — the drill behind the registration figure is its records.
  const listed = steps.filter((s) => !s.live && (where === 'all' || s.where === where));
  // Every row stays on the list when one person is picked. Dropping the rows
  // whose source names nobody made the table SHRINK, which read as those steps
  // not existing — they show "—" instead, the same "not measured" the Open
  // column uses.
  const scoped = listed;
  const unattributable = person === 'all' ? [] : listed.filter((s) => !s.people && s.total > 0);
  /** Is this step's figure knowable for ONE person? */
  const attributed = (s: StepRow) => person === 'all' || (isOwner ? s.owner != null : !!s.people);
  // EVERY other step of the sheet stays on the list, zero or not — a stage with
  // nothing on it today is part of the picture, never hidden.
  const active = scoped;
  /** Every listed step counts towards the ring, the borrowed customer/landlord
   *  gates included — they are steps of the same journey and the page's own
   *  totals and the Tasks-completed tile both count them, so leaving them out
   *  of the ring alone would be the odd one out. */
  const total = active.reduce((a, s) => a + valueOf(s), 0);
  const whoDid = (s: StepRow) => {
    const parts = s.people ? Object.entries(s.people).filter(([, n]) => n > 0).map(([uid, n]) => `${nameOf.get(uid) ?? uid} ${n}`) : [];
    if (s.owner) parts.push(`You ${s.owner}`);
    return parts.length ? parts.join(' · ') : (s.people ? 'not attributed' : 'no actor recorded');
  };
  if (!active.length) return <Empty text="No journey steps are defined." />;
  const respOf = (s: StepRow): Resp => (person === 'all' ? s.response : (s.peopleResponse?.[String(person)] ?? { measured: 0, avgResponseHours: null, onTimePct: null, slaPct: null, breached: 0, slaHours: s.response.slaHours }));
  /** Outstanding work at this step — the same person scoping as the done
   *  figure. null = the step has no Operations stage, so nothing is waiting
   *  "at" it in any sense the board can state. */
  const openOf = (s: StepRow): number | null =>
    (person === 'all' ? s.open
      // The board names a handler from the manager roster only, so it cannot say
      // how much of the backlog is the landlord's — "—", not a misleading 0.
      : isOwner ? null
        : (s.openPeople ? (s.openPeople[String(person)] ?? 0) : null));
  const data = active.map((s) => ({
    ...s, value: valueOf(s), open: openOf(s), resp: respOf(s), name: s.label,
    color: STEP_COLORS[listed.indexOf(s) % STEP_COLORS.length],
  }));
  /* Totals of exactly what the rows show, so the column adds up on screen. The
   * completed total covers every listed row; `total` above is the TEAM's share
   * of it — the part the ring draws. */
  const sum = {
    open: data.reduce((a, d) => a + (d.open ?? 0), 0),
    done: data.reduce((a, d) => a + (attributed(d) ? d.value : 0), 0),
    breached: data.reduce((a, d) => a + d.resp.breached, 0),
    measured: data.reduce((a, d) => a + d.resp.measured, 0),
  };
  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: 150, height: 150 }}>
          {total === 0 && <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--base-200)" strokeWidth="14" /></svg>}
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={1.5} stroke="#fff" strokeWidth={1} isAnimationActive={false}>
                {data.filter((d) => d.value > 0).map((d) => <Cell key={d.key} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6e0', fontSize: 12 }}
                formatter={(v, _n, item) => {
                  const s = item?.payload as StepRow | undefined;
                  return [`${nfmt(Number(v))}${person === 'all' && s ? ` · ${whoDid(s)}` : ''}`, s?.label ?? ''];
                }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[26px] font-bold tracking-tight text-[var(--neutral-900)] tabular-nums leading-none">{nfmt(total)}</span>
            <span className="text-[11px] text-[var(--neutral-400)] mt-1">steps done</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-[10px_minmax(0,1fr)_52px_54px_56px_58px] gap-x-2 text-[10px] font-bold tracking-[0.08em] uppercase text-[var(--neutral-400)] leading-tight pb-1 border-b border-[var(--base-100)] mb-1">
            <span /><span>Step</span>
            <span className="text-right" title="Leases sitting at this step on the Operations board right now — the work still owed">Open tasks</span>
            <span className="text-right" title="Records the team took through this step in the period, each counted once">Completed tasks</span>
            <span className="text-right" title="Records that took longer than the stage's SLA — or, for outstanding work, have already waited longer">SLA breached</span>
            <span className="text-right" title="The stage's SLA target as the system applies it today — 72h everywhere, no per-stage targets are configured yet">SLA criteria</span>
          </div>
          <ul className="space-y-1 text-[12.5px]">
            {/* One block per Operations tab, in the board's order, each with its
                own subtotal — the same shape the reader sees on the tracker. */}
            {STEP_GROUPS.filter(([g]) => data.some((d) => (d.group ?? 'other') === g)).map(([g, gLabel]) => {
              const rows = data.filter((d) => (d.group ?? 'other') === g);
              const gOpen = rows.every((d) => d.open == null) ? null : rows.reduce((a, d) => a + (d.open ?? 0), 0);
              const gDone = rows.reduce((a, d) => a + (attributed(d) ? d.value : 0), 0);
              const gBreached = rows.reduce((a, d) => a + d.resp.breached, 0);
              return [
              <li key={`g-${g}`} className="grid grid-cols-[10px_minmax(0,1fr)_52px_54px_56px_58px] gap-x-2 items-center pt-2 mt-1 first:mt-0 first:pt-0">
                <span />
                <span className="text-[10px] font-bold tracking-[0.08em] uppercase text-[var(--neutral-500)]">
                  {g === 'other'
                    ? gLabel
                    : <Link href={`${operationsHref}?tab=${g}`} className="hover:text-[var(--primary-dark)] hover:underline" title={`Open the ${gLabel} board`}>{gLabel}</Link>}
                </span>
                <span className="text-right tabular-nums text-[11px] font-semibold text-[var(--neutral-500)]">{gOpen == null ? '' : nfmt(gOpen)}</span>
                <span className="text-right tabular-nums text-[11px] font-semibold text-[var(--neutral-500)]">{nfmt(gDone)}</span>
                <span className="text-right tabular-nums text-[11px] font-semibold text-[var(--neutral-500)]">{gBreached ? nfmt(gBreached) : ''}</span>
                <span />
              </li>,
              ...rows.map((s) => (
              <li key={s.key} className="grid grid-cols-[10px_minmax(0,1fr)_52px_54px_56px_58px] gap-x-2 items-center" title={`${s.label}: ${whoDid(s)}${s.repeats ? ` · ${s.repeats}× recorded` : ''}${s.resp.measured ? ` · avg response ${fmtResp(s.resp.avgResponseHours)} over ${s.resp.measured}` : ' · response not measurable for this step'}`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="text-[var(--neutral-700)] leading-tight">
                  {s.label}
                  {s.where === 'ground' && (
                    <span className="ml-1.5 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide bg-teal-50 text-teal-800 align-middle whitespace-nowrap"
                      title="On ground — needs somebody at the unit">ground</span>
                  )}
                </span>
                {/* Open — leases sitting at this step on the Operations board.
                    Worked there, not here, so it is a figure and not a drill. */}
                <span className="text-right">
                  {s.open == null
                    ? <span className="text-[var(--neutral-400)]" title="No Operations stage waits at this step">—</span>
                    : s.open
                      ? <Fig tone="open" onClick={() => onDrill({ key: s.key, label: s.label, mode: 'open' })} title="See what is waiting">{nfmt(s.open)}</Fig>
                      : <span className="tabular-nums text-[var(--neutral-400)]">0</span>}
                </span>
                <span className="text-right">
                  {!attributed(s)
                    ? <span className="text-[var(--neutral-400)]" title="Nobody is recorded as having done this step, so it cannot be split by person">—</span>
                    : s.value
                      ? <Fig tone="done" onClick={() => onDrill({ key: s.key, label: s.label, mode: 'done' })} title="See the records">{nfmt(s.value)}</Fig>
                      : <span className="tabular-nums text-[var(--neutral-400)]">0</span>}
                </span>
                <span className="text-right">
                  {s.resp.measured === 0
                    ? <span className="text-[var(--neutral-400)]" title="not measurable for this step">—</span>
                    : s.resp.breached
                      ? <Fig tone="bad" onClick={() => onDrill({ key: s.key, label: s.label, mode: 'breached' })} title={`${s.resp.breached} of ${s.resp.measured} measured · avg ${fmtResp(s.resp.avgResponseHours)} — see which`}>{nfmt(s.resp.breached)}</Fig>
                      : <span className="tabular-nums text-emerald-700" title={`0 of ${s.resp.measured} measured · avg ${fmtResp(s.resp.avgResponseHours)}`}>0</span>}
                </span>
                <span className="tabular-nums text-right whitespace-nowrap text-[var(--neutral-700)]">{fmtResp(s.resp.slaHours)}</span>
              </li>
              ))];
            })}
            <li className="grid grid-cols-[10px_minmax(0,1fr)_52px_54px_56px_58px] gap-x-2 items-center border-t border-[var(--base-200)] mt-1.5 pt-2 font-bold text-[var(--neutral-900)]">
              <span />
              <span>Total</span>
              <span className="text-right">
                {data.every((d) => d.open == null)
                  ? <span className="text-[var(--neutral-400)]" title="The Operations board names a handler from the manager roster only">—</span>
                  : sum.open
                    ? <Fig tone="open" onClick={() => onDrill({ key: 'all', label: 'Every step', mode: 'open' })} title={`All ${nfmt(sum.open)} leases waiting on the Operations board`}>{nfmt(sum.open)}</Fig>
                    : <span className="tabular-nums text-[var(--neutral-400)]">0</span>}
              </span>
              <span className="text-right">
                {sum.done
                  ? <Fig tone="done" onClick={() => onDrill({ key: 'all', label: 'Every step', mode: 'done' })} title="Every step recorded in the period — the Tasks completed tile shows the same figure">{nfmt(sum.done)}</Fig>
                  : <span className="tabular-nums text-[var(--neutral-400)]">0</span>}
              </span>
              <span className="text-right">
                {sum.breached
                  ? <Fig tone="bad" onClick={() => onDrill({ key: 'all', label: 'Every step', mode: 'breached' })} title={`${nfmt(sum.breached)} of ${nfmt(sum.measured)} measured`}>{nfmt(sum.breached)}</Fig>
                  : <span className="tabular-nums text-emerald-700">0</span>}
              </span>
              <span className="text-right font-normal text-[var(--neutral-400)]">—</span>
            </li>
          </ul>
        </div>
      </div>
      {listed.some((s) => s.side !== 'manager') && (
        <p className="mt-1 text-[11px] text-[var(--neutral-400)] leading-relaxed">
          {`${listed.filter((s) => s.side !== 'manager').map((s) => s.label).join(' · ')} — gates the team chases but cannot perform: the customer and the landlord sign these themselves.`}
        </p>
      )}
      {person === 'all' && (() => {
        /* The team's own tally and the step total are not the same number, and
         * the difference is not a fault: a customer signing their lease is a
         * completed step nobody on the team performed, so it can never appear
         * in "Live team activity" beside it. Said here once, in figures, so the
         * two cards stop looking like they disagree. */
        const outside = listed
          .map((st) => ({ st, n: st.total - (Object.values(st.people ?? {}).reduce((a, b) => a + b, 0) + (st.owner ?? 0)) }))
          .filter((x) => x.n > 0);
        const n = outside.reduce((a, x) => a + x.n, 0);
        if (!n) return null;
        return (
          <p className="mt-1 text-[11px] text-[var(--neutral-400)] leading-relaxed">
            {nfmt(sum.done - n)} of these {nfmt(sum.done)} were done by the team.
            The other {nfmt(n)} the customer did themselves ({outside.map((x, i) => (
              <span key={x.st.key}>
                {i ? ', ' : ''}
                <button type="button" onClick={() => onDrill({ key: x.st.key, label: x.st.label, mode: 'done', person: null })}
                  className="font-semibold text-[var(--neutral-600)] underline decoration-dotted underline-offset-2 hover:text-[var(--primary-dark)]">
                  {nfmt(x.n)} {x.st.label.toLowerCase()}
                </button>
              </span>
            ))}), which is why Live team activity shows {nfmt(sum.done - n)}.
          </p>
        );
      })()}
      {person !== 'all' && (() => {
        // One person's column can never add up to the team's total, and leaving
        // the reader to work out why invites the conclusion that figures are
        // missing. They are not: the rest is the landlord's own work, steps
        // whose source names nobody, and whatever the other people did.
        const teamTotal = listed.reduce((a, s) => a + s.total, 0);
        // Already the figure on screen when the landlord IS the pick — counting
        // it again as "the rest" would subtract it twice.
        const ownWork = isOwner ? 0 : listed.reduce((a, s) => a + (s.owner ?? 0), 0);
        const noActor = unattributable.reduce((a, s) => a + s.total, 0);
        const elsewhere = Math.max(0, teamTotal - sum.done - ownWork - noActor);
        // Both figures OPEN, like every other number on this card — being told
        // 11 steps are yours is no use without being able to see which.
        const Link_ = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
          <button type="button" onClick={onClick}
            className="font-semibold text-[var(--neutral-600)] underline decoration-dotted underline-offset-2 hover:text-[var(--primary-dark)]">{children}</button>
        );
        return (
          <p className="mt-1 text-[11px] text-[var(--neutral-400)] leading-relaxed">
            {nfmt(sum.done)} of the team&apos;s {nfmt(teamTotal)} completed steps — the rest is{' '}
            {ownWork > 0 && (
              <>
                <Link_ onClick={() => onDrill({ key: 'all', label: 'Rental Provider', mode: 'done', person: ownerUserId })}>
                  {nfmt(ownWork)} the Rental Provider did
                </Link_>
                {(noActor > 0 || elsewhere > 0) ? ', ' : ''}
              </>
            )}
            {noActor > 0 && (
              <>
                {nfmt(noActor)} with nobody recorded as having done it ({unattributable.map((st, i) => (
                  <span key={st.key}>
                    {i ? ', ' : ''}
                    <Link_ onClick={() => onDrill({ key: st.key, label: st.label, mode: 'done', person: null })}>{st.label}</Link_>
                  </span>
                ))}){elsewhere > 0 ? ', ' : ''}
              </>
            )}
            {elsewhere > 0 && `${nfmt(elsewhere)} recorded to someone else`}
            {'.'}
          </p>
        );
      })()}
    </div>
  );
}

interface DrillRecord {
  id: number; kind: string; ref: string; href: string | null; viewHref: string | null;
  title: string | null; person: string | null; item: string | null; items: Array<{ label: string; href: string | null }>;
  times: number | null; at: string | null; firstAt: string | null; by: string | null;
  waitHours: number | null; breached: boolean;
  /** Which step this row is here for — set when several are unioned ("all"). */
  step?: string | null;
  /** Whose act it was — what tells a customer's signature from the landlord's
   *  once both sit under one heading. */
  side?: 'manager' | 'customer' | 'landlord' | null;
  /** Whose column the step is counted in — not always the person in `by`. */
  creditedTo?: string | null;
  /** Which flow the record is in — a lead, a first lease, or a renewal. */
  via?: 'lead' | 'lease' | 'renewal' | null;
  /** Where the lease is on the Operations board right now (null = not on the board). */
  stage: string | null;
}
interface DrillPayload { key: string; label: string | null; live?: boolean; inferred?: boolean; slaHours: number; records: DrillRecord[] }

/** The records behind one Tasks / SLA-breached figure — a slide-over listing
 *  record · what was actioned · when · who · how long it waited · open. */
function StepDrill({ endpoint, from, to, person, personName, drill, periodWord, now, onClose }: {
  endpoint: string; from: string; to: string; person: number | null; personName: string | null;
  drill: Drill; periodWord: string; now: number; onClose: () => void;
}) {
  const { closing, dismiss } = useSlideOver(onClose);
  const [data, setData] = useState<DrillPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    // Outstanding work has no window — it is the board as it stands. The other
    // two are the period's records, so they carry from/to.
    const qs = new URLSearchParams(drill.mode === 'open' ? { key: drill.key } : { key: drill.key, from, to });
    if (person != null) qs.set('person', String(person));
    if (drill.mode === 'breached') qs.set('breached', '1');
    fetch(`${endpoint}/${drill.mode === 'open' ? 'open' : 'step'}?${qs}`, { credentials: 'include', signal: ac.signal })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as DrillPayload; })
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message || 'Could not load'); });
    return () => ac.abort();
  }, [endpoint, from, to, person, drill]);
  const title = `${drill.label}${drill.mode === 'breached' ? ' — SLA breached' : drill.mode === 'open' ? ' — open tasks' : ''}`;
  const scope = [personName, drill.mode === 'open' ? 'waiting right now' : periodWord].filter(Boolean).join(' · ');
  /** Records by whose act it was, biggest first — only meaningful when the list
   *  mixes sides, which is exactly what a merged row does. */
  const sideSplit = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of data?.records ?? []) { const k = r.side ?? 'team'; c.set(k, (c.get(k) ?? 0) + 1); }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  return (
    <div onClick={dismiss} className={`slideover-scrim${closing ? ' closing' : ''}`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,25,.46)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className={`slideover-panel${closing ? ' closing' : ''}`}
        style={{ width: 'min(880px, 100%)', height: '100dvh', background: '#fff', boxShadow: '0 24px 70px rgba(15,30,22,.30)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header className="flex items-center gap-3 px-6 py-4 border-b border-[var(--base-200)] shrink-0">
          <button type="button" onClick={dismiss} aria-label="Back" className="w-[34px] h-[34px] rounded-[10px] border border-[var(--base-200)] bg-white inline-flex items-center justify-center text-[var(--neutral-700)]"><ArrowLeft size={16} /></button>
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-[var(--neutral-900)] leading-tight">{title}</h2>
            <p className="text-[12px] text-[var(--neutral-400)]">{scope}{data ? ` · ${data.records.length} record${data.records.length === 1 ? '' : 's'} · SLA ${fmtResp(data.slaHours)}` : ''}{data?.inferred ? ' · whose queue is inferred, not who did it' : ''}</p>
            {/* A merged row holds two parties' work — Contract Signature is the
                landlord's and the customer's under one heading. Say the split
                out loud rather than leaving it to be counted down the list. */}
            {sideSplit.length > 1 && (
              <p className="mt-1 flex items-center gap-2 flex-wrap">
                {sideSplit.map(([side, n]) => (
                  <span key={side} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={side === 'landlord' ? { background: '#eef0fa', color: '#3a4a7f' }
                      : side === 'customer' ? { background: '#fdf6ea', color: '#8a6410' }
                        : { background: '#ecfdf5', color: '#166534' }}>
                    {nfmt(n)} {side === 'landlord' ? 'landlord' : side === 'customer' ? 'customer' : 'team'}
                    {n === 1 ? ' signature' : ' signatures'}
                  </span>
                ))}
              </p>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-auto px-6 py-4">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Could not load ({error}).</div>}
          {!data && !error && <div className="text-[13px] text-[var(--neutral-400)]">Loading…</div>}
          {data && data.records.length === 0 && <Empty text="No records behind this figure." />}
          {data && data.records.length > 0 && (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10.5px] font-bold tracking-[0.1em] uppercase text-[var(--neutral-400)] border-b border-[var(--base-200)]">
                  <th className="text-left font-bold pr-3 py-2">Record</th>
                  <th className="text-left font-bold px-3 py-2">Actioned</th>
                  <th className="text-left font-bold px-3 py-2 whitespace-nowrap">Stage now</th>
                  <th className="text-left font-bold px-3 py-2 whitespace-nowrap">{data.live ? 'Waiting since' : 'When'}</th>
                  <th className="text-right font-bold px-3 py-2 whitespace-nowrap">Waited</th>
                  <th className="text-left font-bold px-3 py-2">{data.inferred ? 'Whose queue' : 'By'}</th>
                  <th className="text-right font-bold pl-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r, i) => (
                  <tr key={`${r.kind}-${r.id}-${r.side ?? ''}-${i}`} className="border-b border-[var(--base-100)] last:border-0 align-top">
                    <td className="pr-3 py-2.5">
                      <div className="font-semibold text-[var(--neutral-900)]">
                        {r.ref}{r.title ? <span className="font-normal text-[var(--neutral-700)]"> · {r.title}</span> : null}
                        {/* Which flow the step was worked in — the same step is
                            reached on a lead, on a first lease and again on a
                            renewal, and the rows are otherwise identical. */}
                        {r.via === 'lead' && <span className="ml-1.5 rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wide bg-blue-50 text-blue-800 align-middle">lead</span>}
                        {r.via === 'renewal' && <span className="ml-1.5 rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wide bg-violet-50 text-violet-800 align-middle">renewal</span>}
                      </div>
                      {r.person && <div className="text-[11.5px] text-[var(--neutral-500)]">{r.person}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--neutral-700)]">
                      {r.items.length > 3 ? `${r.items.length} items` : (r.item ?? '—')}{r.times ? <span className="text-[11px] text-[var(--neutral-400)]"> ×{r.times}</span> : null}
                      {(() => {
                        // Whose act, and which step — the two things a row loses
                        // when several counters are shown under one heading.
                        const party = r.side === 'customer' ? 'Customer' : r.side === 'landlord' ? 'Landlord' : null;
                        return (party || (drill.key === 'all' && r.step)) ? (
                          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                            {party && (
                              <span className="inline-flex rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide"
                                style={r.side === 'landlord' ? { background: '#eef0fa', color: '#3a4a7f' } : { background: '#fdf6ea', color: '#8a6410' }}>
                                {party}
                              </span>
                            )}
                            {drill.key === 'all' && r.step && <span className="text-[11.5px] text-[var(--neutral-400)]">{r.step}</span>}
                          </div>
                        ) : null;
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--neutral-700)] whitespace-nowrap">{r.stage ?? <span className="text-[var(--neutral-400)]">{r.kind === 'contract' ? 'Not on the board' : '—'}</span>}</td>
                    <td className="px-3 py-2.5 tabular-nums text-[var(--neutral-700)] whitespace-nowrap">
                      {data.live
                        ? (r.waitHours != null ? `${fmtDay(new Date(now - r.waitHours * 3_600_000).toISOString())}` : '—')
                        : (r.at ? `${fmtDay(r.at)}, ${fmtTime(r.at)}` : '—')}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold ${r.waitHours == null ? 'text-[var(--neutral-400)]' : r.breached ? 'text-rose-700' : 'text-emerald-700'}`}>{fmtResp(r.waitHours)}</td>
                    <td className="px-3 py-2.5 text-[var(--neutral-700)]">
                      {/* Two people can sit on one row: the step is counted
                          against whoever's login captured it, while the paper
                          was signed by somebody else (a POA holder, the
                          customer). Showing one alone reads as a contradiction. */}
                      {r.creditedTo && r.by && r.creditedTo !== r.by ? (
                        <>
                          <div>{r.creditedTo}</div>
                          <div className="text-[11.5px] text-[var(--neutral-500)] leading-snug">signed by {r.by}</div>
                        </>
                      ) : (r.creditedTo ?? r.by ?? <span className="text-[var(--neutral-400)]">—</span>)}
                    </td>
                    <td className="pl-3 py-2.5 text-right whitespace-nowrap">
                      {r.href && <Link href={r.href} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--primary-dark)] hover:underline">Open <ExternalLink size={11} /></Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[124px] rounded-2xl bg-white border border-[var(--base-200)]" />)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4">
        <div className="h-[260px] rounded-2xl bg-white border border-[var(--base-200)]" />
        <div className="h-[260px] rounded-2xl bg-white border border-[var(--base-200)]" />
      </div>
    </div>
  );
}
