'use client';

/**
 * Platform Pulse — the cross-provider login dashboard (SCRUM: admin login
 * redesign). Answers the CEO's questions in order: is the portfolio growing,
 * what is it earning, WHERE DO WE GROW NEXT, is each provider earning its
 * place, are customers staying, what is the exposure, and when is the platform
 * worked.
 *
 * Market sits at 3 deliberately, straight after the two figures that pay for
 * it. Where to expand is a decision taken off the back of growth and cash, and
 * it was previously at 6 — below three operational sections, where it read as
 * an afterthought to today's problems rather than the next call to make.
 *
 * Every lease-derived figure comes from ONE backend payload (`/admin/pulse`),
 * which drives everything through the shared lease-scope fragments — so the
 * numbers here always equal what each provider's own dashboard reports
 * (RP 2: 107 active leases / 93 customers). Sections the platform does not
 * capture yet (provider CRM, complaints) say "not tracked yet" in place of a
 * number, never a fabricated figure. Move-out reasons graduated out of that
 * set once the coded reason field landed — but the card leads with COVERAGE,
 * because most historic exits predate the field and reporting three coded
 * reasons as "why customers leave" would be the same lie by another route.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, Cell, LineChart, Line, AreaChart, Area, LabelList, ReferenceLine, ComposedChart,
} from 'recharts';
import {
  Gauge, ShieldAlert,
  ArrowUpRight, Banknote, Check, ChevronDown, ChevronUp, Clock,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import DirhamSign from '@/components/ui/DirhamSign';

/* ── Payload ── */
interface QueueItem {
  id: number; rpId: number | null; rpName: string | null; tenant: string | null;
  userId: number | null; unit: string | null; building: string | null;
  detail: string | null; amount: number | null; date: string | null;
}
interface Queue {
  key: string; label: string; count: number; amount: number | null;
  oldestDays: number | null; href: string | null; items: QueueItem[]; truncated: boolean;
}
/** Leasing funnel over `days`; the card re-asks GET /admin/pulse/funnel on change. */
interface Funnel {
  days: number; leads: number; drafted: number; signed: number; ejari: number; activated: number;
}
interface ProviderRow {
  rpId: number; ownerUserId: number | null; name: string; arr: number; market: number; units: number;
  occupied: number; occupancyPct: number; overdue: number;
  pageViews30: number; pageViewers30: number; renewalRatePct: number | null;
  feePerUnit: number; lastActive: string | null;
  actions30: number; actionsDeltaPct: number | null;
}
interface Pulse {
  generatedAt: string;
  scope: { rpId: number | null };
  providers: { rpId: number; ownerUserId: number | null; name: string }[];
  topline: {
    rentalProviders: number; customers: number; managers: number; properties: number;
    units: number; activeLeases: number; earningLeases: number; occupiedUnits: number;
    vacantUnits: number; listedVacant: number; draftVacant: number;
  };
  kpis: {
    arr: number; marketValue: number; marketGapPct: number | null;
    earningUnits: number; earningProviders: number;
    occupancy: { pct: number; occupied: number; total: number };
    collections: { dueYtd: number; clearedYtd: number; ratePct: number };
    overdue: { amount: number; cheques: number; customers: number };
    bounced: { count: number; amount: number; ytdCount: number; ytdAmount: number; ratePct: number; chequesDueYtd: number };
    moneyAtRisk: {
      total: number; depositsHeld: number; settlementsPending: number; settlementsCount: number;
      pdcAtRisk: number; pdcCheques: number; bouncedOwed: number;
    };
    fees: { ytdNet: number; ytdVat: number; annualized: number; takeRatePct: number; perUnitAnnualized: number; billedMonths: number };
    unitsGrowth: { total: number; addedThisQuarter: number };
  };
  growth: {
    funnel: Funnel;
    occupancyTrend: { month: string; occupied: number; total: number; pct: number }[];
  };
  money: {
    cashForward: { month: string; total: number; atRisk: number; cheques: number; byProvider: { rpId: number; name: string; amount: number }[] }[];
    pdcAtRisk: {
      amount: number; cheques: number; more: number; moreAmount: number;
      rows: { tenantId: number; userId: number | null; name: string; nextDue: string; amount: number; priorBounces: number }[];
    };
    feeStreams: { subscriptionAed: number; newLeaseAed: number; renewalAed: number; settlementAed: number; netAed: number; vatAed: number };
    feesByMonth: { month: string; netAed: number; vatAed: number }[];
    collectionsByMonth: { month: string; cleared: number; outstanding: number }[];
    renewalPipeline: { month: string; renewed: number; noticeSent: number; noticeDue: number; vacating: number }[];
  };
  queues: Queue[];
  providerTable: ProviderRow[];
  customers: {
    repeat: { count: number; pctOfActive: number };
    portalAdoption: { active30d: number; activeCustomers: number; pct: number };
    moveOuts: {
      last12m: number; allTime: number; coded: number; notRecorded: number; codedRatePct: number;
      reasons: { code: string; label: string; side: 'customer' | 'landlord' | 'breach' | null; count: number; pct: number }[];
      bySide: { side: 'customer' | 'landlord' | 'breach'; label: string; count: number }[];
    };
  };
  exposure: {
    concentration: {
      topProvider: { name: string; sharePct: number } | null;
      topArea: { name: string; sharePct: number } | null;
      topBuilding: { name: string; sharePct: number } | null;
    };
    depositAging: { bucket: string; cases: number; amount: number }[];
  };
  providersOps: {
    vacancy: { buckets: { bucket: string; units: number; monthlyLoss: number }[]; vacantUnits: number; monthlyLoss: number };
    topManagers: { id: number; name: string; actions: number; contractActions: number; landlords: number; pageViews: number; lastSeen: string }[];
  };
  market: {
    topAreas: { name: string; active: number; arr: number }[];
    otherAreas: { active: number; count: number };
    propertyCategories: { name: string; value: number }[];
    unitMix: {
      area: string; type: string; plan: string; units: number; occupied: number;
      earning: number; contracted: number; market: number;
      minAsk: number | null; maxAsk: number | null; avgRent: number;
    }[];
    direction: { quarter: string; marketAvg: number | null; annualAvg: number | null; leases: number; gapPct: number | null }[];
    areaRents: { name: string; avgNewRent: number; leases12m: number; yoyPct: number | null }[];
  };
  usage: {
    daily: { day: string; actions: number; views: number }[];
    heatmap: { dow: number; hour: number; actions: number }[];
    actions30d: number; activeUsers30d: number;
    listings: {
      totalViews: number; visitors: number;
      top: { unitId: number; unit: string; property: string; views: number; visitors: number; leads: number }[];
    };
  };
}

/* ── Style — the validated admin categorical palette (jade → blue → amber → purple) ── */
/** Provider engagement (actions 30d vs prior 30d) is hidden for now — the card and
 *  its `signal()` helper stay wired so flipping this back to true restores it. */
const SHOW_PROVIDER_ENGAGEMENT = false;

/** Windows the Leasing funnel picker offers. Mirrors FUNNEL_DAY_OPTIONS on the
 *  API, which clamps anything else to 1–730 days. */
const FUNNEL_WINDOWS = [30, 90, 180, 365];
/** One label for the option and the card title, so they cannot read differently. */
const funnelWindowLabel = (d: number) =>
  d % 365 === 0 ? `Last ${d / 365 === 1 ? '12 months' : `${d / 365} years`}` : `Last ${d} days`;

const JADE = '#2e9f82', BLUE = '#1e5fae', AMBER = '#b45309', PURPLE = '#8250df';
const GRAY = '#6b6860', RED = '#b91c1c';
const CAT = [JADE, BLUE, AMBER, PURPLE];
const HEAT = ['#f4f3ef', '#dbe7f6', '#b9d1ec', '#8fb4de', '#5f92cc', '#3a6fb0', '#274e85'];
/** ISO weekday order (Mon-first), matching EXTRACT(ISODOW) from the heatmap query. */
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** `YYYY-MM-DD` → "8 Aug". Parsed as UTC so the label can't slip a day. */
const dayTick = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const tooltipStyle = { borderRadius: 12, border: '1px solid #e8e6e0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };
const TICK = { fontSize: 11, fill: '#9b9890' };

function fmtAED(aed: number | null | undefined): string {
  if (aed == null) return '—';
  const a = Math.abs(aed);
  if (a >= 1_000_000) return `AED ${(aed / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `AED ${Math.round(aed / 1_000)}K`;
  return `AED ${Math.round(aed).toLocaleString('en-AE')}`;
}
/**
 * Compact AED for axis ticks and bar labels.
 *
 * The thousands step keeps ONE DECIMAL below 10K, because rounding there
 * corrupts the axis rather than shortening it: the fees chart plots 0/450/900/
 * 1350/1800 — evenly spaced — and `Math.round(v/1000)` labelled the top two
 * ticks "1K" and "2K", so the axis read 0·450·900·1K·2K and the chart looked
 * wrong next to the billing page showing the same money. Above 10K the rounding
 * is harmless (a 538,050 tick as "538K" loses nothing a reader wanted).
 */
const aedShort = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000) return `${Math.round(v / 1000)}K`;
  if (a >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(Math.round(v));
};
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => MONTHS[Number(m.split('-')[1])] || m;
const quarterLabel = (m: string) => { const [y, mm] = m.split('-'); return `Q${Math.floor((Number(mm) - 1) / 3) + 1} ${y.slice(2)}`; };
const dateLabel = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
/**
 * Date plus clock time — the exact moment behind a "3d ago" label. Pinned to the
 * app's display zone so the time shown is the UAE time the action happened at,
 * not the reader's local rendering of it.
 */
const dateTimeLabel = (d: string | null) => (d
  ? new Date(d).toLocaleString('en-GB', {
      timeZone: APP_TIME_ZONE,
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  : '—');
/**
 * How long ago, with the date underneath. "14 Mar 2026" alone makes the reader
 * do the arithmetic that IS the signal — a dormant provider should be obvious at
 * a glance. `null` means no logged activity at all, which is not "quiet lately".
 */
const sinceLabel = (d: string | null) => {
  if (!d) return <span className="text-[#9b9890]">Never</span>;
  // CALENDAR days, not elapsed hours: 22 hours ago can still be yesterday, and
  // "Today" sitting above a date of 7 Aug reads as a bug.
  const midnight = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(new Date(d))) / 86400_000);
  const ago = days <= 0 ? 'Today' : days === 1 ? 'Yesterday'
    : days < 30 ? `${days}d ago`
    : days < 365 ? `${Math.round(days / 30)}mo ago`
    : `${Math.floor(days / 365)}y ago`;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={days >= 30 ? 'text-[#b45309] font-semibold' : 'text-[#1a1916]'}>{ago}</span>
      <span className="text-[10px] text-[#9b9890] whitespace-nowrap">{dateTimeLabel(d)}</span>
    </span>
  );
};
/**
 * Asking price per unit: a single figure when every unit on the plan is listed
 * the same, a RANGE when they are not. The range is the point — same layout at
 * two prices is either a stale list price or a deliberate spread, and averaging
 * it away hides the only pricing question worth asking here.
 */
const askLabel = (r: { minAsk: number | null; maxAsk: number | null }) => {
  if (r.minAsk == null || r.maxAsk == null) return '—';
  return r.minAsk === r.maxAsk ? fmtAED(r.minAsk) : `${aedShort(r.minAsk)}–${aedShort(r.maxAsk)}`;
};
const TYPE_LABEL: Record<string, string> = {
  apartment: 'Apartment', villa: 'Villa', room: 'Room', studio: 'Studio',
  warehouse: 'Warehouse', retail_shop: 'Retail shop', staff_accommodation: 'Staff accomm.',
  commercial_land: 'Commercial land', office: 'Office', unknown: 'Unknown',
};
/** properties.space_category — moved here with the card from the admin overview. */
const CATEGORY_LABEL: Record<string, string> = {
  residential: 'Residential', commercial: 'Commercial', mixed_use: 'Mixed use',
  industrial: 'Industrial', land: 'Land', other: 'Other',
};

/* ── Building blocks (admin house style) ── */
function KpiTile({ icon: Icon, label, value, sub, tone = 'neutral', href }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; value: string; sub?: string; tone?: 'neutral' | 'good' | 'bad' | 'warn'; href?: string;
}) {
  const vc = tone === 'bad' ? 'text-[#b91c1c]' : tone === 'warn' ? 'text-[#b45309]' : tone === 'good' ? 'text-[#1a7a5a]' : 'text-[#1a1916]';
  const body = (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3.5 h-full hover:border-[#d4d2cc] transition-colors">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold"><Icon size={12} /> {label}</div>
      <p className={`text-xl font-bold mt-1.5 leading-none tabular-nums ${vc}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#9b9890] mt-1.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
function ChartCard({ title, sub, children, href, hint, id, action }: {
  title: string; sub?: string; children: React.ReactNode; href?: string; hint?: string; id?: string;
  /** Card-level control (a window picker, say). Never combine with `href` — the
   *  whole card would be a link and the control would navigate on click. */
  action?: React.ReactNode;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#1a1916]">{title}</h3>
        {action}
        {(href || hint) && <span className="flex items-center gap-0.5 text-[10px] font-semibold text-[#9b9890] whitespace-nowrap">{hint ?? 'View'} <ArrowUpRight size={12} /></span>}
      </div>
      {sub && <p className="text-[11px] text-[#9b9890] mt-0.5 mb-1">{sub}</p>}
      <div className="mt-2">{children}</div>
    </>
  );
  return href ? (
    <Link id={id} href={href} className="block bg-white rounded-2xl border border-[#e8e6e0] p-4 hover:border-[#d4d2cc] transition-colors">{inner}</Link>
  ) : (
    <div id={id} className="bg-white rounded-2xl border border-[#e8e6e0] p-4">{inner}</div>
  );
}
function SectionHead({ no, q, id }: { no: string; q: string; id: string }) {
  return (
    <div id={id} className="flex items-baseline gap-3 mt-8 mb-3 pt-4 border-t border-[#e0ded8] scroll-mt-20">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#1e5fae]">{no}</span>
      <h2 className="text-[15px] font-bold text-[#1a1916]">{q}</h2>
    </div>
  );
}
function Meter({ pct, tone = BLUE, width = 'w-24' }: { pct: number; tone?: string; width?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`${width} h-1.5 rounded-full bg-[#e8e6e0] overflow-hidden inline-block`}>
        <span className="h-full rounded-full block" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: tone }} />
      </span>
      <span className="text-[12px] text-[#6b6860] tabular-nums">{pct}%</span>
    </span>
  );
}
function StatusDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: tone }}>
      <span className="w-2 h-2 rounded-full inline-block" style={{ background: tone }} /> {label}
    </span>
  );
}
function EmptyChart({ text, h = 180 }: { text: string; h?: number }) {
  return <div style={{ height: h }} className="flex items-center justify-center text-center text-[12px] text-[#9b9890] px-4">{text}</div>;
}

/* ── System status — the header chip + expanding panel from the mockup ─────────
 * Design source: Mockups/platform-pulse-dashboard.html (#healthChip / #healthPanel).
 * Data is REAL, from /api/admin/status — the same payload the full status page
 * draws, so the two can never disagree. The mockup's past-incidents table and
 * its MTTR / error-rate / p95 footer are deliberately absent: nothing records
 * incidents or request traces, so there is no honest figure to put there.
 */

type SvcState = 'operational' | 'degraded' | 'down' | 'unconfigured' | 'nodata';
interface SvcDay {
  date: string; status: 'operational' | 'degraded' | 'down' | 'nodata';
  checks: number; failed: number; uptimePct: number | null;
}
interface SvcComponent {
  key: string; label: string; impact: string; status: SvcState; detail: string | null;
  latencyMs: number | null; lastCheckedAt: string | null;
  uptimePct: number | null; checks: number; days: SvcDay[];
}
interface PlatformStatusPayload {
  generatedAt: string; windowDays: number; probeIntervalMinutes: number;
  overall: 'operational' | 'degraded' | 'down' | 'nodata';
  components: SvcComponent[];
}

/** Severity carried by colour AND bar height — red/green alone is unreadable to
 *  a colourblind operator, so height repeats the ordering. */
const SVC: Record<SvcState, { color: string; label: string; height: string }> = {
  operational:  { color: '#0ca30c', label: 'Operational',    height: '100%' },
  degraded:     { color: '#fab219', label: 'Degraded',       height: '55%' },
  down:         { color: '#d03b3b', label: 'Outage',         height: '28%' },
  unconfigured: { color: '#c9c6bf', label: 'Not configured', height: '18%' },
  nodata:       { color: '#e8e6e0', label: 'No data',        height: '12%' },
};
const SVC_BANNER: Record<PlatformStatusPayload['overall'], { text: string; tone: string; bg: string }> = {
  operational: { text: 'All systems operational', tone: '#0ca30c', bg: '#f1f9f1' },
  degraded:    { text: 'Degraded performance',    tone: '#b07c05', bg: '#fdf6e7' },
  down:        { text: 'Service disruption',      tone: '#d03b3b', bg: '#fcf1f1' },
  nodata:      { text: 'No checks recorded yet',  tone: '#6b6860', bg: '#f4f3ef' },
};

/** Platform-wide uptime across the window: clean probes ÷ probes that could run. */
function svcUptime(s: PlatformStatusPayload): number | null {
  const scored = s.components.filter((c) => c.checks > 0 && c.uptimePct != null);
  if (!scored.length) return null;
  const checks = scored.reduce((n, c) => n + c.checks, 0);
  const ok = scored.reduce((n, c) => n + (c.uptimePct! / 100) * c.checks, 0);
  return Math.round((ok / checks) * 10000) / 100;
}

/**
 * Provider scope picker. A dropdown rather than a row of chips: the chip row
 * grew a button per provider and would wrap into several lines as providers are
 * onboarded, pushing the whole dashboard down the page.
 *
 * The colour dot is kept on both the trigger and every option — it is the same
 * entity-keyed `rpColor` the charts use, so the picker reads as the legend for
 * everything below it. A native <select> cannot render that, which is why this
 * is a button + popover instead.
 */
function ProviderSelect({ providers, value, onChange, color }: {
  providers: { rpId: number; name: string }[];
  value: number | null;
  onChange: (v: number | null) => void;
  color: Map<number, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value == null ? null : providers.find((p) => p.rpId === value) ?? null;
  const options: { id: number | null; name: string }[] = [
    { id: null, name: 'All rental providers' },
    ...providers.map((p) => ({ id: p.rpId, name: p.name })),
  ];

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu" aria-expanded={open}
        className="flex items-center gap-2 w-[260px] text-[12px] rounded-lg border border-[#e8e6e0]
                   bg-white px-3 py-2 text-left hover:border-[#d4d2cc] transition-colors">
        {selected && (
          <span className="w-2 h-2 rounded-full inline-block shrink-0"
            style={{ background: color.get(selected.rpId) }} aria-hidden />
        )}
        <span className="flex-1 truncate font-semibold text-[#1a1916]">
          {selected ? selected.name : 'All rental providers'}
        </span>
        <ChevronDown size={14} className="text-[#9b9890] shrink-0" aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute z-30 mt-1 w-[260px] bg-white border border-[#e8e6e0]
                                    rounded-xl shadow-lg py-1 max-h-72 overflow-auto">
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button key={String(o.id)} type="button" role="menuitemradio" aria-checked={active}
                onClick={() => { onChange(o.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left transition-colors
                            hover:bg-[#fafaf8] ${active ? 'font-semibold text-[#1a1916]' : 'text-[#6b6860]'}`}>
                <span className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{ background: o.id == null ? 'transparent' : color.get(o.id) }} aria-hidden />
                <span className="flex-1 truncate">{o.name}</span>
                {active && <Check size={13} className="text-[#1e5fae] shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusChip({ status, open, onToggle }: {
  status: PlatformStatusPayload | null; open: boolean; onToggle: () => void;
}) {
  if (!status) return null;
  const bad = status.components.filter((c) => c.status === 'degraded' || c.status === 'down');
  const b = SVC_BANNER[status.overall];
  const up = svcUptime(status);
  return (
    <button onClick={onToggle} aria-expanded={open} aria-controls="pulse-health-panel"
      className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6b6860] border border-[#e8e6e0]
                 bg-white rounded-full px-3 py-1.5 hover:border-[#d4d2cc] transition-colors">
      <span className="w-2 h-2 rounded-full inline-block" style={{ background: b.tone }} aria-hidden />
      {bad.length ? `${b.text} — ${bad.map((c) => c.label).join(', ')}` : b.text}
      {up != null && <span className="text-[#9b9890] font-normal">· {up}% ({status.windowDays}d)</span>}
      {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
    </button>
  );
}

function StatusPanel({ status }: { status: PlatformStatusPayload }) {
  const b = SVC_BANNER[status.overall];
  const bad = status.components.filter((c) => c.status === 'degraded' || c.status === 'down');
  return (
    <div id="pulse-health-panel" className="bg-white rounded-2xl border border-[#e8e6e0] p-4 mt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#1a1916]">System status</h3>
        <Link href="/dashboard/admin/status" className="flex items-center gap-0.5 text-[10px] font-semibold text-[#9b9890] whitespace-nowrap hover:text-[#1a1916]">
          Full status page <ArrowUpRight size={12} />
        </Link>
      </div>
      <p className="text-[11px] text-[#9b9890] mt-0.5">
        Per-component uptime over the last {status.windowDays} days — probed every {status.probeIntervalMinutes} minutes
      </p>

      <div className="rounded-xl px-4 py-3 mt-3 flex items-center gap-2.5"
        style={{ background: b.bg, border: `1px solid ${b.tone}33` }}>
        <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: b.tone }} aria-hidden />
        <div className="min-w-0">
          <strong className="text-[13px]" style={{ color: b.tone }}>
            {b.text}{bad.length ? ` — ${bad.map((c) => c.label).join(', ')}` : ''}
          </strong>
          {bad.length > 0 && (
            <div className="text-[11px] text-[#6b6860] mt-0.5">
              Check this before reading a business metric as a provider problem — a broken
              notification path inflates &ldquo;no action yet&rdquo; renewals.
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 divide-y divide-[#f0ede8]">
        {status.components.map((c) => (
          <div key={c.key} className="py-2.5">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-[12px] font-semibold text-[#1a1916] truncate">{c.label}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] tabular-nums text-[#6b6860]">
                  {c.uptimePct != null ? `${c.uptimePct}% uptime` : 'no checks yet'}
                </span>
                <span className="text-[10px] font-semibold whitespace-nowrap"
                  style={{ color: c.status === 'degraded' ? '#8a6100' : SVC[c.status].color }}>
                  {SVC[c.status].label}
                </span>
              </span>
            </div>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-[2px] h-4 min-w-[420px]">
                {c.days.map((d) => (
                  <span key={d.date} className="flex-1 min-w-[2px] h-full flex items-end"
                    title={`${d.date} — ${SVC[d.status].label}${d.checks ? ` (${d.uptimePct}% of ${d.checks} checks)` : ''}`}>
                    <span className="w-full rounded-[2px] block"
                      style={{ height: SVC[d.status].height, background: SVC[d.status].color }} />
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
/** Market-vs-annual hover card — the gap is the point of the chart, so it is
 *  stated outright rather than left for the reader to subtract. */
function MarketTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { payload?: Record<string, number | string | null> }[];
  label?: string | number;
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const market = row['Market rent'] == null ? null : Number(row['Market rent']);
  const annual = row['Annual rent'] == null ? null : Number(row['Annual rent']);
  const leases = Number(row.leases) || 0;
  return (
    <div className="rounded-xl border border-[#e8e6e0] bg-white px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
      <p className="text-[11px] font-bold text-[#1a1916]">{String(label)}</p>
      <p className="text-[11px] text-[#6b6860]">{leases} lease{leases === 1 ? '' : 's'} started</p>
      <p className="text-[11px] text-[#6b6860] flex items-center gap-1.5 mt-1">
        <span className="w-2 h-2 rounded-full inline-block" style={{ background: AMBER }} />
        Market rent <span className="tabular-nums ml-auto pl-3">{market == null ? '—' : fmtAED(market)}</span>
      </p>
      <p className="text-[11px] text-[#6b6860] flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full inline-block" style={{ background: BLUE }} />
        Annual rent <span className="tabular-nums ml-auto pl-3">{annual == null ? '—' : fmtAED(annual)}</span>
      </p>
      {row.gapPct != null && market != null && annual != null && (
        <p className="text-[11px] font-semibold text-[#1a1916] mt-1 pt-1 border-t border-[#f0ede8] tabular-nums">
          {fmtAED(market - annual)} under asking · {String(row.gapPct)}%
        </p>
      )}
    </div>
  );
}
/**
 * Cash-forward hover card. The default Recharts tooltip can only list the stacked
 * series, and the two facts that decide whether a month is comfortable — how many
 * cheques it rests on, and how much of it sits with customers who have bounced
 * before — are not series, so they have to be carried on the row.
 */
function CashTooltip({ active, payload, label, series }: {
  active?: boolean;
  payload?: { payload?: Record<string, number | string> }[];
  label?: string | number;
  series: { rpId: number; name: string; color: string }[];
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const total = Number(row.total) || 0;
  const atRisk = Number(row.atRisk) || 0;
  const cheques = Number(row.cheques) || 0;
  return (
    <div className="rounded-xl border border-[#e8e6e0] bg-white px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
      <p className="text-[11px] font-bold text-[#1a1916]">{String(label)}</p>
      <p className="text-[13px] font-bold text-[#1a1916] tabular-nums">{fmtAED(total)}</p>
      <p className="text-[11px] text-[#6b6860]">{cheques} cheque{cheques === 1 ? '' : 's'}</p>
      {series.length > 1 && series.map((s) => (
        <p key={s.rpId} className="text-[11px] text-[#6b6860] flex items-center gap-1.5 mt-0.5">
          <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: s.color }} />
          {s.name} <span className="tabular-nums ml-auto pl-3">{fmtAED(Number(row[`rp${s.rpId}`]) || 0)}</span>
        </p>
      ))}
      {atRisk > 0 && (
        <p className="text-[11px] text-[#b45309] mt-1 pt-1 border-t border-[#f0ede8] tabular-nums">
          {fmtAED(atRisk)} from customers with a prior bounce
        </p>
      )}
    </div>
  );
}
/** Horizontal magnitude bars with per-row labels — the funnel / ranked-list form. */
function HBars({ rows, height, color = BLUE, fmt = (v: number) => String(v), labelWidth = 124 }: {
  rows: { name: string; value: number; label?: string; color?: string }[];
  height?: number; color?: string; fmt?: (v: number) => string;
  /** Widen the category gutter for long names (the mockup's `left`). */
  labelWidth?: number;
}) {
  if (!rows.length || rows.every((r) => !r.value)) return <EmptyChart text="Nothing here yet" h={height ?? 160} />;
  const h = height ?? Math.max(120, rows.length * 34);
  const data = rows.map((r) => ({ ...r, label: r.label ?? fmt(r.value) }));
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 96, left: 8, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={labelWidth} tick={{ fontSize: 11, fill: '#6b6860' }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v: unknown) => [fmt(Number(v)), ''] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
          <LabelList dataKey="label" position="right" style={{ fontSize: 11, fill: '#3d3b35' }} />
          {data.map((r, i) => <Cell key={i} fill={r.color ?? color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Move-out reasons — the mockup's `hbars('churn', …)` card, on real data.
 *
 * ONE series, so ONE hue: bar length is the count and the label does the work
 * (`--s1` in the mockup, BLUE here). The only second colour is "Not recorded",
 * which is grey and hatched because it is the ABSENCE of a reason, not a
 * seventh reason — a solid bar would rank it as a peer of the real ones.
 *
 * It is charted rather than dropped on purpose. A code is only ever written at
 * the move-out itself, so every tenancy that ended before the reason field
 * existed is uncoded; hiding those rows would present three coded exits as the
 * whole story of churn. The sub-line carries the coverage, exactly where the
 * mockup carries "41 move-outs, last 12 months — tagged at exit".
 */
function MoveOutReasonsCard({ mo }: { mo: Pulse['customers']['moveOuts'] }) {
  const notRecordedPct = mo.last12m ? Math.round((mo.notRecorded / mo.last12m) * 100) : 0;
  const rows = [
    ...mo.reasons.map((r) => ({ name: r.label, value: r.count, label: `${r.count} · ${r.pct}%` })),
    ...(mo.notRecorded > 0 ? [{
      name: 'Not recorded', value: mo.notRecorded,
      label: `${mo.notRecorded} · ${notRecordedPct}%`, color: 'url(#moNotRecorded)',
    }] : []),
  ];
  const top = mo.reasons[0] ?? null;

  return (
    <ChartCard title="Move-out reasons"
      sub={mo.last12m
        ? `${mo.last12m} move-out${mo.last12m === 1 ? '' : 's'}, last 12 months — reason recorded on ${mo.coded} (${mo.codedRatePct}%)`
        : `No move-outs in the last 12 months${mo.allTime ? ` · ${mo.allTime} since launch` : ''}`}>
      {/* Hatch for the uncoded bar. Lives in its own hidden SVG so the pattern
          survives recharts re-rendering its chart on resize. */}
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <pattern id="moNotRecorded" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(135)">
            <rect width="6" height="6" fill="#f0ede8" />
            <line x1="0" y1="0" x2="0" y2="6" stroke={GRAY} strokeWidth="3" opacity="0.55" />
          </pattern>
        </defs>
      </svg>
      {mo.last12m === 0 ? (
        <EmptyChart text="No tenancy ended in this window" h={160} />
      ) : (
        <>
          <HBars rows={rows} labelWidth={178} fmt={(v) => `${v} move-out${v === 1 ? '' : 's'}`} />
          <p className="text-[11px] text-[#9b9890] mt-2">
            {mo.codedRatePct < 50 ? (
              <>
                Most exits still carry no reason — the code is captured at the move-out itself, so the picture fills in
                from here. Earlier exits were backfilled only where the typed note plainly said why; a guess was never
                written in.
              </>
            ) : (
              <>
                {top ? `“${top.label}” leads at ${top.pct}% of exits — ` : ''}
                churn read against renewal pricing is the retention call, and it is per-area, never portfolio-wide.
              </>
            )}
          </p>
        </>
      )}
    </ChartCard>
  );
}

/* ── Page ── */
export default function PlatformPulsePage() {
  const { user } = useAuth();
  const allowed = user?.role === 'super_admin' || user?.role === 'admin';

  const [rpFilter, setRpFilter] = useState<number | null>(null);
  const [mixArea, setMixArea] = useState<string | null>(null);
  // One type expanded at a time — the card sits in a half-width column and a
  // fully expanded 30-plan table would bury everything under it.
  const [openMixType, setOpenMixType] = useState<string | null>(null);
  const [status, setStatus] = useState<PlatformStatusPayload | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [data, setData] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openQueue, setOpenQueue] = useState<string | null>(null);
  // Leasing-funnel window. `null` = whatever the page payload came with, so the
  // card renders on first paint without a second round trip. The override carries
  // the provider it was fetched for, so a scope change discards it by comparison
  // rather than by a reset effect that would fire an extra render.
  const [funnelDays, setFunnelDays] = useState<number | null>(null);
  const [funnelOverride, setFunnelOverride] = useState<{ rp: number | null; data: Funnel } | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(false);

  // Restore ?rp= on mount; sync on change (house pattern — no history spam).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const rp = Number(p.get('rp'));
    if (Number.isFinite(rp) && rp > 0) setRpFilter(rp);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (rpFilter != null) url.searchParams.set('rp', String(rpFilter));
    else url.searchParams.delete('rp');
    window.history.replaceState(null, '', url.toString());
  }, [rpFilter]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    apiGet<Pulse>(`/admin/pulse${rpFilter != null ? `?rp=${rpFilter}` : ''}`)
      .then((d) => { if (!stale) setData(d); })
      .catch((e) => { if (!stale) setError((e as Error).message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [rpFilter]);

  // Funnel window: fetch ONLY this card, not the whole ~40-query payload. Runs
  // for the provider too, so a chosen window survives a scope change instead of
  // silently snapping back to the default.
  useEffect(() => {
    if (funnelDays == null) return;
    let stale = false;
    setFunnelLoading(true);
    apiGet<Funnel>(`/admin/pulse/funnel?days=${funnelDays}${rpFilter != null ? `&rp=${rpFilter}` : ''}`)
      .then((f) => { if (!stale) setFunnelOverride({ rp: rpFilter, data: f }); })
      .catch(() => { if (!stale) setFunnelOverride(null); })
      .finally(() => { if (!stale) setFunnelLoading(false); });
    return () => { stale = true; };
  }, [funnelDays, rpFilter]);

  // System status rides on its OWN request: it must never delay or fail the
  // dashboard, and it is platform-wide, so the provider filter does not touch it.
  useEffect(() => {
    let stale = false;
    const load = () => apiGet<PlatformStatusPayload>('/admin/status')
      .then((s) => {
        if (stale) return;
        setStatus(s);
        // Mockup behaviour: the panel auto-promotes itself when something is off,
        // so a degradation cannot sit hidden behind a collapsed chip.
        if (s.overall === 'degraded' || s.overall === 'down') setStatusOpen(true);
      })
      .catch(() => { /* status is decoration here — the dashboard stands without it */ });
    void load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { stale = true; clearInterval(t); };
  }, []);

  /* ── Unit mix, filterable by area ──────────────────────────────────────────
   * The payload carries one row per (area, type); the picker re-aggregates them
   * client-side, so changing area costs no round trip. Areas are ordered by
   * contracted rent so the ones that matter sit at the top of the list.
   */
  const mixAreas = useMemo(() => {
    const rent = new Map<string, number>();
    for (const r of data?.market.unitMix ?? []) rent.set(r.area, (rent.get(r.area) ?? 0) + r.contracted);
    return [...rent.entries()].sort((a, b) => b[1] - a[1]).map(([area]) => area);
  }, [data?.market.unitMix]);

  const mixRows = useMemo(() => {
    const src = (data?.market.unitMix ?? []).filter((r) => mixArea == null || r.area === mixArea);
    type Agg = {
      key: string; label: string; units: number; occupied: number; earning: number;
      contracted: number; market: number; minAsk: number | null; maxAsk: number | null;
    };
    const blank = (key: string, label: string): Agg =>
      ({ key, label, units: 0, occupied: 0, earning: 0, contracted: 0, market: 0, minAsk: null, maxAsk: null });
    // min/max fold across areas, so a plan split over two communities still
    // reports one true spread rather than whichever area sorted last.
    const add = (a: Agg, r: typeof src[number]) => {
      a.units += r.units; a.occupied += r.occupied; a.earning += r.earning;
      a.contracted += r.contracted; a.market += r.market;
      if (r.minAsk != null) a.minAsk = a.minAsk == null ? r.minAsk : Math.min(a.minAsk, r.minAsk);
      if (r.maxAsk != null) a.maxAsk = a.maxAsk == null ? r.maxAsk : Math.max(a.maxAsk, r.maxAsk);
    };

    const byType = new Map<string, Agg>();
    const plansByType = new Map<string, Map<string, Agg>>();
    for (const r of src) {
      const t = byType.get(r.type) ?? blank(r.type, r.type);
      add(t, r);
      byType.set(r.type, t);
      const plans = plansByType.get(r.type) ?? new Map<string, Agg>();
      const p = plans.get(r.plan) ?? blank(`${r.type}|${r.plan}`, r.plan);
      add(p, r);
      plans.set(r.plan, p);
      plansByType.set(r.type, plans);
    }
    // Both levels sorted by contracted rent — biggest contributor first. (The
    // per-type average column was dropped; `avgRent` is still on the payload
    // rows, and must be recomputed FROM THE TOTALS if it ever comes back, never
    // averaged across per-area averages — that weights a one-unit area like a
    // forty-unit one.)
    return [...byType.values()]
      .sort((a, b) => b.contracted - a.contracted)
      .map((t) => ({
        ...t,
        plans: [...(plansByType.get(t.key)?.values() ?? [])].sort((a, b) => b.contracted - a.contracted),
      }));
  }, [data?.market.unitMix, mixArea]);

  const mixUnits = useMemo(() => mixRows.reduce((n, r) => n + r.units, 0), [mixRows]);

  // Fixed provider→color assignment, keyed by entity (never by rank or filter).
  const rpColor = useMemo(() => {
    const m = new Map<number, string>();
    (data?.providers ?? []).forEach((p, i) => m.set(p.rpId, i < CAT.length ? CAT[i] : GRAY));
    return m;
  }, [data?.providers]);

  const cashData = useMemo(() => {
    const empty = { rows: [] as Record<string, number | string>[], series: [] as { rpId: number; name: string; color: string }[], total: 0, atRisk: 0, avg: 0, peak: 0, horizon: null as string | null };
    if (!data) return empty;
    const seen = new Map<number, string>();
    for (const m of data.money.cashForward) for (const s of m.byProvider) seen.set(s.rpId, s.name);
    // Colour rides on the series so the tooltip swatches cannot drift from the
    // bars — same entity-keyed map, resolved once.
    const series = [...seen.entries()].map(([rpId, name]) => ({ rpId, name, color: rpColor.get(rpId) ?? GRAY }));
    // Trailing empty months are dead bars, not signal — the horizon is named in
    // the subtitle instead. Interior zero months are kept: a gap mid-window is a
    // real hole in the collection calendar.
    let months = data.money.cashForward;
    while (months.length && months[months.length - 1].total === 0) months = months.slice(0, -1);
    const rows = months.map((m) => {
      // Year on the label: a 12-month window crosses into the next one, and
      // "Jan" alone reads as this year's January.
      const row: Record<string, number | string> = {
        month: `${monthLabel(m.month)} ${m.month.slice(2, 4)}`,
        total: m.total, atRisk: m.atRisk, cheques: m.cheques,
      };
      for (const s of series) row[`rp${s.rpId}`] = m.byProvider.find((b) => b.rpId === s.rpId)?.amount ?? 0;
      return row;
    });
    const total = data.money.cashForward.reduce((s, m) => s + m.total, 0);
    const atRisk = data.money.cashForward.reduce((s, m) => s + m.atRisk, 0);
    const banked = data.money.cashForward.filter((m) => m.total > 0).length;
    const last = months[months.length - 1];
    return {
      rows, series, total, atRisk,
      avg: banked ? Math.round(total / banked) : 0,
      peak: Math.max(0, ...data.money.cashForward.map((m) => m.total)),
      horizon: last ? `${monthLabel(last.month)} ${last.month.slice(0, 4)}` : null,
    };
  }, [data, rpColor]);

  const marketGap = useMemo(() => {
    const dir = data?.market.direction ?? [];
    const rows = dir.map((d) => ({
      name: quarterLabel(d.quarter),
      'Market rent': d.marketAvg,
      'Annual rent': d.annualAvg,
      leases: d.leases,
      gapPct: d.gapPct,
    }));
    // Headline gap is weighted by leases, not a mean of quarterly percentages —
    // a thin quarter would otherwise count as much as a busy one.
    const scored = dir.filter((d) => d.gapPct != null && d.leases > 0);
    const weight = scored.reduce((s, d) => s + d.leases, 0);
    return {
      rows,
      avgPct: weight ? Math.round((scored.reduce((s, d) => s + (d.gapPct as number) * d.leases, 0) / weight) * 10) / 10 : null,
    };
  }, [data]);

  const heat = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    let max = 0;
    for (const c of data?.usage.heatmap ?? []) {
      const d = Math.min(6, Math.max(0, c.dow - 1));
      grid[d][c.hour] = c.actions;
      max = Math.max(max, c.actions);
    }

    /* ── The read, derived from the SAME grid the squares are drawn from ──────
     * A 168-cell heatmap shows the shape but makes you hunt for the answer.
     * These are the three facts someone actually wants off it, computed here
     * rather than in SQL so the summary can never disagree with the picture.
     */
    const byDay = grid.map((row) => row.reduce((s, v) => s + v, 0));
    const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h], 0));
    const total = byDay.reduce((s, v) => s + v, 0);

    let peak = { dow: 0, hour: 0, actions: 0 };
    grid.forEach((row, d) => row.forEach((v, h) => {
      if (v > peak.actions) peak = { dow: d, hour: h, actions: v };
    }));

    const rank = (arr: number[], pick: (a: number, b: number) => boolean) =>
      arr.reduce((best, v, i) => (pick(v, arr[best]) ? i : best), 0);
    const busiestDay = rank(byDay, (a, b) => a > b);
    const quietestDay = rank(byDay, (a, b) => a < b);
    const busiestHour = rank(byHour, (a, b) => a > b);

    // Core hours: the SHORTEST contiguous run of hours holding 70% of all
    // actions — the working window, without hand-picking a start and end.
    let core: { from: number; to: number } | null = null;
    if (total > 0) {
      const target = total * 0.7;
      for (let len = 1; len <= 24 && !core; len++) {
        for (let start = 0; start + len <= 24; start++) {
          let sum = 0;
          for (let h = start; h < start + len; h++) sum += byHour[h];
          if (sum >= target) { core = { from: start, to: start + len - 1 }; break; }
        }
      }
    }

    return { grid, max, byDay, byHour, total, peak, busiestDay, quietestDay, busiestHour, core };
  }, [data]);

  if (!allowed) return <p className="p-8 text-sm text-[#9b9890]">Admin access required.</p>;
  if (loading && !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-3">
          <div className="h-7 w-56 bg-[#e8e6e0] rounded" />
          <div className="h-20 bg-[#f4f3ef] rounded-2xl" />
          <div className="grid grid-cols-4 gap-3">{[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-[#f4f3ef] rounded-2xl" />)}</div>
        </div>
      </div>
    );
  }
  if (error || !data) {
    return <div className="p-8 text-sm text-[#b91c1c]">Couldn&apos;t load Platform Pulse{error ? ` — ${error}` : ''}.</div>;
  }

  const { topline: tl, kpis: k } = data;
  const risk = k.moneyAtRisk;
  const providerHref = (p: { ownerUserId: number | null; rpId: number }) =>
    p.ownerUserId != null ? `/dashboard/admin/users/${p.ownerUserId}` : `/dashboard/admin/kyc/rental-provider/${p.rpId}`;
  // A window fetched for another provider is not this provider's funnel.
  const funnel = funnelOverride?.rp === rpFilter ? funnelOverride.data : data.growth.funnel;
  // Event counts in the window, not a strict cohort — renewals and walk-in
  // contracts enter mid-funnel, so a stage can exceed the one above it and a
  // "% of previous" label would be fiction.
  const funnelRows = [
    { name: 'Leads', value: funnel.leads },
    { name: 'Contracts drafted', value: funnel.drafted },
    { name: 'Signed online', value: funnel.signed },
    { name: 'Ejari registered', value: funnel.ejari },
    { name: 'Activated', value: funnel.activated },
  ];
  const signal = (d: number | null) =>
    d == null ? <span className="text-[12px] text-[#9b9890]">—</span>
    : d <= -15 ? <StatusDot tone={AMBER} label={'Disengaging'} />
    : d < 0 ? <StatusDot tone={GRAY} label={'Softening'} />
    : <StatusDot tone={'#1a7a5a'} label={'Stable'} />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#1a1916]">Platform Pulse</h1>
          <p className="text-[12px] text-[#9b9890] mt-0.5">
            What the platform sees at login — portfolio-wide across all rental providers
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip status={status} open={statusOpen} onToggle={() => setStatusOpen((o) => !o)} />
          <Link href="/dashboard/admin/activity" className="text-[11px] font-semibold text-[#6b6860] border border-[#e8e6e0] bg-white rounded-full px-3 py-1.5 hover:border-[#d4d2cc]">Live activity</Link>
        </div>
      </div>

      {/* Sits between the header and the provider filter, exactly as in the mockup. */}
      {statusOpen && status && <StatusPanel status={status} />}

      {/* Provider filter */}
      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <ProviderSelect providers={data.providers} value={rpFilter} onChange={setRpFilter} color={rpColor} />
        {loading && <span className="text-[11px] text-[#9b9890]">refreshing…</span>}
      </div>

      {/* Asset topline */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] mt-3 px-2 py-3 flex flex-wrap">
        {[
          {
            label: "Who's on the platform",
            cells: [
              { v: tl.rentalProviders, l: 'Rental providers', href: '/dashboard/admin/users?role=rental_provider' },
              { v: tl.customers, l: 'Customers', href: '/dashboard/admin/users?role=customer' },
              { v: tl.managers, l: 'Managers', href: '/dashboard/admin/team' },
            ],
          },
          {
            label: 'Assets under platform',
            cells: [
              { v: tl.properties, l: 'Properties', href: '/dashboard/admin/properties' },
              { v: tl.units, l: 'Units', href: '/dashboard/admin/units' },
            ],
          },
          {
            label: 'Tenancy state',
            cells: [
              { v: tl.activeLeases, l: 'Active leases' },
              { v: tl.vacantUnits, l: 'Vacant', href: '/dashboard/admin/units?availability=available' },
            ],
          },
          {
            label: 'Vacant · Listed',
            cells: [
              { v: tl.listedVacant, l: 'Listed', href: '/dashboard/admin/listings/rental-providers' },
              { v: tl.draftVacant, l: 'Draft' },
            ],
          },
        ].map((g, gi, arr) => (
          <div key={g.label} className={`flex flex-col gap-1.5 px-4 py-1 flex-1 min-w-[150px] ${gi < arr.length - 1 ? 'border-r border-[#f0ede8]' : ''}`}>
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#9b9890]">{g.label}</span>
            <div className="flex gap-6">
              {g.cells.map((c) => {
                const cell = (
                  <span className="flex flex-col">
                    <span className="text-lg font-bold text-[#1a1916] leading-tight tabular-nums">{c.v}</span>
                    <span className="text-[11px] text-[#6b6860] whitespace-nowrap">{c.l}</span>
                  </span>
                );
                return c.href ? <Link key={c.l} href={c.href} className="hover:opacity-70">{cell}</Link> : <span key={c.l}>{cell}</span>;
              })}
            </div>
          </div>
        ))}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <div className="col-span-2 row-span-2">
          <div className="bg-white rounded-2xl border border-[#e8e6e0] px-5 py-4 h-full flex flex-col justify-center hover:border-[#d4d2cc] transition-colors">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold"><DirhamSign size={12} /> Annual rent (GMV) vs market rent</div>
            <p className="text-4xl font-bold text-[#1a1916] mt-2 leading-none tabular-nums">{fmtAED(k.arr)}</p>
            {/* Market rent is the same stock at asking, so it sits BESIDE the
                headline rather than replacing it — the pair is the point. */}
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-[13px] font-semibold text-[#b45309] tabular-nums">{fmtAED(k.marketValue)}</span>
              <span className="text-[11px] text-[#9b9890]">market rent{k.marketGapPct != null ? ` · let ${k.marketGapPct}% under asking` : ''}</span>
            </div>
            <p className="text-[12px] text-[#6b6860] mt-3">
              {k.earningUnits} earning units across {k.earningProviders} provider{k.earningProviders === 1 ? '' : 's'} · platform fees YTD {fmtAED(k.fees.ytdNet)}
            </p>
            <p className="text-[11px] text-[#9b9890] mt-1">
              Annual rent: one counting lease per unit — active, or post-dated cheques confirmed; expired, terminated and wound-down terms excluded. Market rent: asking price across all {tl.units} units, vacant included.
            </p>
          </div>
        </div>
        {/* Lease-derived, not the `availability` flag — so this tile and the last
            point of the Occupancy trend are always the same number. No drill-down:
            the units list filters on the flag, which disagrees by 4 units. */}
        {/* Whole percent: a tenth of a point is a tenth of a UNIT on a 114-unit
            book — false precision. Rounded at display, so the payload keeps the
            exact figure. */}
        <KpiTile icon={Gauge} label="Occupancy" value={`${Math.round(k.occupancy.pct)}%`}
          sub={`${k.occupancy.occupied} of ${k.occupancy.total} units under a lease this month — same basis as the trend below`} />
        <KpiTile icon={Banknote} label="Collection rate YTD" value={`${k.collections.ratePct}%`}
          sub={`${fmtAED(k.collections.clearedYtd)} cleared of ${fmtAED(k.collections.dueYtd)} due`} tone={k.collections.ratePct >= 90 ? 'good' : 'warn'} />
        <KpiTile icon={ShieldAlert} label="Bounced cheque rate" value={`${k.bounced.ratePct}%`}
          sub={`${k.bounced.ytdCount} bounced YTD (${fmtAED(k.bounced.ytdAmount)}) of ${k.bounced.chequesDueYtd} rent cheques due · ${k.bounced.count} still unresolved (${fmtAED(k.bounced.amount)})`}
          tone={k.bounced.count > 0 ? 'warn' : 'good'} />
        <KpiTile icon={DirhamSign} label="Platform fees YTD" value={fmtAED(k.fees.ytdNet)}
          sub={`+ VAT ${fmtAED(k.fees.ytdVat)} · take rate ≈ ${k.fees.takeRatePct}% of contracted rent (annualized over ${k.fees.billedMonths} billed month${k.fees.billedMonths === 1 ? '' : 's'})`}
          href="/dashboard/admin/billing" />
      </div>

      {/* Jump nav */}
      <nav className="flex gap-2 flex-wrap mt-4">
        {[['#sec-growth', '1 · Growth'], ['#sec-money', '2 · Money'], ['#sec-market', '3 · Market'], ['#sec-providers', '4 · Providers'], ['#sec-customers', '5 · Customers'], ['#sec-exposure', '6 · Exposure'], ['#sec-usage', '7 · Usage']].map(([href, label]) => (
          <a key={href} href={href} className="text-[11px] text-[#6b6860] border border-[#e8e6e0] bg-white rounded-full px-3 py-1 hover:border-[#1e5fae] hover:text-[#1a1916]">{label}</a>
        ))}
      </nav>

      {/* ── 1 · GROWTH ── */}
      <SectionHead id="sec-growth" no="Section 1 · Growth" q="Is the portfolio growing?" />
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4 overflow-x-auto">
        <h3 className="text-sm font-bold text-[#1a1916]">Top rental providers — unit economics</h3>
        <p className="text-[11px] text-[#9b9890] mt-0.5 mb-2">
          Ranked by contracted rent, against the asking-price roll and how recently anyone touched the account · Page activity counts
          the provider&apos;s owner plus their assigned managers, so a manager working across two
          providers is counted on both
        </p>
        <table className="w-full text-[13px] min-w-[760px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
              <th className="py-1.5 font-semibold">Provider</th>
              {/* Annual rent and Market rent sit side by side — the pair is only
                  meaningful read together, and the same two names are used for
                  them everywhere on this page. */}
              <th className="py-1.5 font-semibold text-right" title="What the counting leases actually contracted — one lease per unit, active or with post-dated cheques confirmed.">Annual rent</th>
              <th className="py-1.5 font-semibold text-right" title="Asking-price roll — the sum of every unit's list price, vacant units included.">Market rent</th>
              <th className="py-1.5 font-semibold text-right">Units</th>
              <th className="py-1.5 pl-4 font-semibold">Occupancy</th>
              <th className="py-1.5 font-semibold text-right" title="Pages opened in the last 30 days by this provider's owner and the managers assigned to them. Reads, not writes — separate from audit actions.">Page activity</th>
              <th className="py-1.5 font-semibold text-right" title="This provider's billed platform fees, annualized over billed months only, divided by their unit count.">Fee / unit (ann.)</th>
              <th className="py-1.5 font-semibold text-right" title="Most recent audit-logged action on this provider, by anyone — its owner or an assigned manager.">Last active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0ede8]">
            {data.providerTable.map((p) => (
              <tr key={p.rpId}>
                <td className="py-2">
                  <Link href={providerHref(p)} className="text-[#1a1916] hover:underline">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: rpColor.get(p.rpId) }} />{p.name}
                  </Link>
                </td>
                <td className="py-2 text-right tabular-nums">{fmtAED(p.arr)}</td>
                <td className="py-2 text-right tabular-nums">{p.market ? fmtAED(p.market) : '—'}</td>
                <td className="py-2 text-right tabular-nums">{p.units}</td>
                <td className="py-2 pl-4"><Meter pct={p.occupancyPct} /></td>
                <td className="py-2 text-right tabular-nums">
                  {p.pageViews30 ? (
                    <>
                      {p.pageViews30.toLocaleString()}
                      <span className="text-[#9b9890] text-[11px]"> · {p.pageViewers30} {p.pageViewers30 === 1 ? 'person' : 'people'}</span>
                    </>
                  ) : <span className="text-[#9b9890]">—</span>}
                </td>
                <td className="py-2 text-right tabular-nums font-semibold">{p.feePerUnit ? fmtAED(p.feePerUnit) : '—'}</td>
                <td className="py-2 text-right tabular-nums whitespace-nowrap">{sinceLabel(p.lastActive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sits directly under the provider table: who is actually doing the work
          behind those portfolios. "Landlords" is assigned scope from active
          manager permissions — NOT the landlords touched in the window. */}
      <div className="mt-3">
        <ChartCard title="Top managers" sub="Last 30 days · Actions are audit-logged writes; Page activity is pages opened (reads) — the two are counted separately; Landlords is their active assignment count" href="/dashboard/admin/team" hint="Team">
          {data.providersOps.topManagers.length === 0 ? <EmptyChart text="No manager activity in the last 30 days" h={160} /> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <th className="py-1.5 font-semibold">Manager</th>
                  {/* Actions and Page activity sit together on purpose: writes
                      beside reads is the comparison that tells you whether time
                      in the app is turning into work. */}
                  <th className="py-1.5 font-semibold text-right">Actions</th>
                  <th className="py-1.5 font-semibold text-right" title="Pages opened in the last 30 days. Reads, not writes — a manager can spend a day in the app and log zero actions.">Page activity</th>
                  <th className="py-1.5 font-semibold text-right">Landlords</th>
                  <th className="py-1.5 font-semibold text-right">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede8]">
                {data.providersOps.topManagers.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2"><Link href={`/dashboard/admin/users/${m.id}`} className="text-[#1a1916] hover:underline">{m.name}</Link></td>
                    <td className="py-2 text-right tabular-nums">{m.actions.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{m.pageViews ? m.pageViews.toLocaleString() : <span className="text-[#9b9890]">—</span>}</td>
                    <td className="py-2 text-right tabular-nums">{m.landlords}</td>
                    <td className="py-2 text-right text-[#6b6860]">{dateLabel(m.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>
      </div>

      {SHOW_PROVIDER_ENGAGEMENT && (
      <ChartCard title="Provider portfolio — engagement" sub="Leading indicator of a provider quietly leaving: audit-logged actions, last 30 days vs the 30 before">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
              <th className="py-1.5 font-semibold">Provider</th>
              <th className="py-1.5 font-semibold text-right">Actions 30d</th>
              <th className="py-1.5 font-semibold text-right">Δ vs prior 30d</th>
              <th className="py-1.5 font-semibold text-right">Signal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0ede8]">
            {data.providerTable.map((p) => (
              <tr key={p.rpId}>
                <td className="py-2"><Link href={providerHref(p)} className="text-[#1a1916] hover:underline">{p.name}</Link></td>
                <td className="py-2 text-right tabular-nums">{p.actions30.toLocaleString()}</td>
                <td className={`py-2 text-right tabular-nums font-semibold ${p.actionsDeltaPct == null ? 'text-[#9b9890]' : p.actionsDeltaPct < 0 ? 'text-[#b45309]' : 'text-[#1a7a5a]'}`}>
                  {p.actionsDeltaPct == null ? '—' : `${p.actionsDeltaPct > 0 ? '▲ +' : p.actionsDeltaPct < 0 ? '▼ ' : ''}${p.actionsDeltaPct}%`}
                </td>
                <td className="py-2 text-right">{signal(p.actionsDeltaPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-[#9b9890] mt-2">Actions/unit falling + slowing renewals = a provider moving operations off-platform before formally leaving.</p>
      </ChartCard>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <ChartCard title={`Leasing funnel — ${funnelWindowLabel(funnel.days).toLowerCase()}`}
          sub="Pipeline events in the window: leads in, contracts drafted, signed, registered, activated. Signed counts only leases e-signed by BOTH parties in-app — paper signatures marked on file are excluded (bulk-import days excluded; renewals enter mid-funnel)"
          action={(
            <label className="flex items-center gap-1.5 shrink-0">
              <span className="sr-only">Funnel window</span>
              <select
                value={funnel.days}
                onChange={(e) => setFunnelDays(Number(e.target.value))}
                className="text-[11px] font-semibold text-[#3d3b35] border border-[#e8e6e0] rounded-full pl-2.5 pr-6 py-1 bg-white hover:border-[#d4d2cc] focus:outline-none focus:border-[#1e5fae] cursor-pointer appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239b9890%22 stroke-width=%223%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_0.5rem_center] bg-[length:9px_9px]">
                {FUNNEL_WINDOWS.map((d) => <option key={d} value={d}>{funnelWindowLabel(d)}</option>)}
              </select>
              {funnelLoading && <span className="text-[10px] text-[#9b9890]">…</span>}
            </label>
          )}>
          <HBars rows={funnelRows} color={BLUE} height={190} />
        </ChartCard>
        <ChartCard title="Occupancy trend" sub={`Trailing 12 months, derived from lease terms — leases covering each month over today's ${tl.units} units`}>
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={data.growth.occupancyTrend.map((r) => ({ ...r, name: monthLabel(r.month) }))} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
              <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis domain={[(dataMin: number) => Math.max(0, Math.floor(dataMin - 5)), 100]} tick={TICK} axisLine={false} tickLine={false} width={34} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: unknown, _n, item) => {
                const row = (item as { payload?: { occupied?: number; total?: number } }).payload;
                // Same whole-percent rounding as the KPI tile — the tile IS this
                // chart's last point, so the two must not disagree by a decimal.
                return [`${Math.round(Number(v))}% · ${row?.occupied} of ${row?.total} units`, 'Occupancy'] as [string, string];
              }} contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="pct" stroke={BLUE} strokeWidth={2} fill={BLUE} fillOpacity={0.08} dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── 2 · MONEY ── */}
      <SectionHead id="sec-money" no="Section 2 · Money" q="What's flowing, and what does UpNow earn?" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Platform earnings — by stream" href="/dashboard/admin/billing" hint="Billing"
          sub={`What UpNow itself earns, YTD net ${fmtAED(data.money.feeStreams.netAed)} + VAT ${fmtAED(data.money.feeStreams.vatAed)} · billed since Jul 2026`}>
          <HBars height={170} color={BLUE} fmt={fmtAED} rows={[
            { name: 'New lease fees', value: data.money.feeStreams.newLeaseAed },
            { name: 'Renewal fees', value: data.money.feeStreams.renewalAed },
            { name: 'Subscriptions', value: data.money.feeStreams.subscriptionAed },
            { name: 'Settlement fees', value: data.money.feeStreams.settlementAed },
          ].map((r) => ({ ...r, label: `${fmtAED(r.value)}${data.money.feeStreams.netAed ? ` · ${Math.round((r.value / data.money.feeStreams.netAed) * 100)}%` : ''}` }))} />
        </ChartCard>
        <ChartCard title="Fees earned per month" sub="Net of VAT, AED, last 12 months — the same series as Platform Billing's revenue trend" href="/dashboard/admin/billing" hint="Billing">
          {data.money.feesByMonth.every((m) => !m.netAed) ? <EmptyChart text="No billed fees yet" h={170} /> : (
            <ResponsiveContainer width="100%" height={170}>
              {/* "Mon YY", same as the billing page's axis — a 12-month window
                  crosses the year, and a bare "Jan" reads as this year's. */}
              <BarChart data={data.money.feesByMonth.map((m) => ({ name: `${monthLabel(m.month)} ${m.month.slice(2, 4)}`, value: m.netAed }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => aedShort(Number(v))} />
                <Tooltip formatter={(v: unknown) => [fmtAED(Number(v)), 'Fees'] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                <Bar dataKey="value" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <ChartCard title="Cash flow — 12-month forward view"
          sub={`${fmtAED(cashData.total)} in pending cheques on earning leases${cashData.atRisk > 0 ? ` · ${fmtAED(cashData.atRisk)} from customers with a prior bounce` : ''}${cashData.horizon ? ` · on file to ${cashData.horizon} — the tail is the lease-end calendar, not a forecast` : ''}`}>
          {cashData.rows.every((r) => !Number(r.total)) ? <EmptyChart text="No pending cheques in the next 12 months" /> : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={cashData.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                <XAxis dataKey="month" tick={{ ...TICK, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => aedShort(Number(v))} />
                <Tooltip content={<CashTooltip series={cashData.series} />} cursor={{ fill: '#fafaf8' }} />
                {cashData.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {/* Same axis, same unit — the monthly average, so a month reads as
                    above or below a typical one instead of only against its peers. */}
                {cashData.avg > 0 && (
                  <ReferenceLine y={cashData.avg} stroke="#c9c6c0" strokeDasharray="4 4"
                    label={{ value: `avg ${aedShort(cashData.avg)}`, position: 'insideTopRight', fontSize: 10, fill: '#9b9890' }} />
                )}
                {cashData.series.map((s, i) => (
                  <Bar key={s.rpId} dataKey={`rp${s.rpId}`} name={s.name} stackId="cash"
                    fill={rpColor.get(s.rpId) ?? GRAY}
                    radius={i === cashData.series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    maxBarSize={30} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="PDC register at risk"
          sub={`Post-dated cheques from customers with a prior bounce · ${fmtAED(data.money.pdcAtRisk.amount)} exposure, ${data.money.pdcAtRisk.cheques} cheque${data.money.pdcAtRisk.cheques === 1 ? '' : 's'}`}>
          {data.money.pdcAtRisk.rows.length === 0 ? <EmptyChart text="No at-risk post-dated cheques — no customer with a prior bounce has future cheques outstanding" /> : (
            <>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                    <th className="py-1.5 font-semibold">Customer</th>
                    <th className="py-1.5 font-semibold">Next due</th>
                    <th className="py-1.5 font-semibold text-right">Amount</th>
                    <th className="py-1.5 font-semibold text-right">Prior bounces</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0ede8]">
                  {data.money.pdcAtRisk.rows.map((r) => (
                    <tr key={r.tenantId}>
                      <td className="py-2">
                        {r.userId != null
                          ? <Link href={`/dashboard/admin/users/${r.userId}`} className="text-[#1a1916] hover:underline">{r.name}</Link>
                          : r.name}
                      </td>
                      <td className="py-2 text-[#6b6860]">{dateLabel(r.nextDue)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtAED(r.amount)}</td>
                      <td className="py-2 text-right tabular-nums">{r.priorBounces}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.money.pdcAtRisk.more > 0 && (
                <p className="text-[11px] text-[#9b9890] mt-2">…and {data.money.pdcAtRisk.more} more customer{data.money.pdcAtRisk.more === 1 ? '' : 's'} totalling {fmtAED(data.money.pdcAtRisk.moreAmount)}</p>
              )}
            </>
          )}
        </ChartCard>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <ChartCard title="Collections by month" sub="Rent cheques due each month YTD — cleared vs still outstanding">
          {data.money.collectionsByMonth.length === 0 ? <EmptyChart text="No cheques due yet this year" /> : (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={data.money.collectionsByMonth.map((m) => ({ name: monthLabel(m.month), Cleared: m.cleared, Outstanding: m.outstanding }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => aedShort(Number(v))} />
                  <Tooltip formatter={(v: unknown, name) => [fmtAED(Number(v)), String(name)] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Cleared" stackId="c" fill={JADE} maxBarSize={36} />
                  <Bar dataKey="Outstanding" stackId="c" fill={AMBER} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </ChartCard>
        <ChartCard title="Renewal pipeline — next 90 days" sub="Leases reaching their end date in each month, by renewal state · a renewal stays counted here once its successor is issued, and churn shows up as “no offer yet”">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={data.money.renewalPipeline.map((m) => ({
              name: monthLabel(m.month), Renewed: m.renewed, 'Notice sent': m.noticeSent, 'No offer yet': m.noticeDue, Vacating: m.vacating,
            }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
              <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Renewed" stackId="r" fill={JADE} maxBarSize={36} />
              <Bar dataKey="Notice sent" stackId="r" fill={BLUE} maxBarSize={36} />
              <Bar dataKey="No offer yet" stackId="r" fill={AMBER} maxBarSize={36} />
              <Bar dataKey="Vacating" stackId="r" fill={GRAY} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── 3 · MARKET ── */}
      <SectionHead id="sec-market" no="Section 3 · Market" q="Where should we grow next?" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Top areas · by active rentals" sub={`Where the ${tl.earningLeases} earning leases sit — the zone-demand view`}>
          <HBars color={BLUE} fmt={(v) => `${v} leases`} rows={[
            ...data.market.topAreas.map((a) => ({
              name: a.name, value: a.active,
              label: `${a.active} · ${fmtAED(a.arr)}`,
            })),
            ...(data.market.otherAreas.count > 0 ? [{ name: `All other (${data.market.otherAreas.count})`, value: data.market.otherAreas.active, color: '#b9d1ec', label: String(data.market.otherAreas.active) }] : []),
          ]} />
        </ChartCard>
        {/* Moved here from the admin overview page. Provider-scoped now, which
            the overview version was not — it counted every property on the
            platform regardless of the filter. */}
        <ChartCard title="Property categories"
          sub={`How the ${tl.properties} propert${tl.properties === 1 ? 'y' : 'ies'} break down by category`}
          href="/dashboard/admin/properties" hint="Properties">
          <HBars color={BLUE} fmt={(v) => `${v} propert${v === 1 ? 'y' : 'ies'}`}
            rows={data.market.propertyCategories.map((c) => ({
              name: CATEGORY_LABEL[c.name] ?? c.name, value: c.value,
            }))} />
        </ChartCard>
      </div>

      {/* Its own full-width row. As the odd third card in the 2-col grid it took
          half the width and left dead space beside it, and its six columns hit
          the min-width and scrolled horizontally. */}
      <div className="mt-3">
        <ChartCard title="Unit mix & rent by type"
          sub={`What ${mixUnits === tl.units ? `the ${tl.units}` : `these ${mixUnits}`} units are — annual rent contracted against the asking-price roll for the same stock`}>
          <div className="flex items-center gap-2 mb-2">
            <label htmlFor="mix-area" className="text-[11px] text-[#9b9890]">Area</label>
            <select id="mix-area" value={mixArea ?? ''}
              onChange={(e) => setMixArea(e.target.value === '' ? null : e.target.value)}
              className="text-[12px] rounded-lg border border-[#e8e6e0] bg-white px-2.5 py-1.5
                         text-[#1a1916] font-semibold hover:border-[#d4d2cc] max-w-[220px] truncate">
              <option value="">All areas</option>
              {mixAreas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[420px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <th className="py-1.5 font-semibold">Type · plan</th>
                  <th className="py-1.5 font-semibold text-right">Units</th>
                  <th className="py-1.5 font-semibold text-right">Occupied</th>
                  <th className="py-1.5 font-semibold text-right">Annual rent</th>
                  <th className="py-1.5 font-semibold text-right">Market rent</th>
                  <th className="py-1.5 font-semibold text-right" title="Asking price per unit. A range means units on the same plan are listed at different prices.">Ask / unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede8]">
                {mixRows.map((m) => {
                  const open = openMixType === m.key;
                  // A single plan is already the type row — nothing to expand into.
                  const expandable = m.plans.length > 1;
                  return (
                    <Fragment key={m.key}>
                      <tr className={open ? 'bg-[#fafaf8]' : undefined}>
                        <td className="py-2">
                          <span className="flex items-center gap-1.5">
                            {expandable ? (
                              <button onClick={() => setOpenMixType(open ? null : m.key)}
                                aria-expanded={open}
                                className="flex items-center gap-1.5 text-[#1a1916] hover:opacity-70">
                                {open ? <ChevronUp size={13} className="text-[#9b9890]" /> : <ChevronDown size={13} className="text-[#9b9890]" />}
                                {TYPE_LABEL[m.key] ?? m.key}
                                <span className="text-[10px] text-[#9b9890] font-semibold">{m.plans.length} plans</span>
                              </button>
                            ) : (
                              <Link href={`/dashboard/admin/units?unitType=${encodeURIComponent(m.key)}`} className="ml-[18px] text-[#1a1916] hover:underline">{TYPE_LABEL[m.key] ?? m.key}</Link>
                            )}
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums">{m.units}</td>
                        <td className="py-2 text-right tabular-nums">{m.occupied}</td>
                        <td className="py-2 text-right tabular-nums">{m.contracted ? fmtAED(m.contracted) : '—'}</td>
                        <td className="py-2 text-right tabular-nums text-[#b45309]">{m.market ? fmtAED(m.market) : '—'}</td>
                        <td className="py-2 text-right tabular-nums text-[#6b6860]">{askLabel(m)}</td>
                      </tr>
                      {open && m.plans.map((p) => (
                        <tr key={p.key} className="bg-[#fafaf8]">
                          <td className="py-1.5 pl-[26px] text-[12px] text-[#3d3b35]">{p.label}</td>
                          <td className="py-1.5 text-right tabular-nums text-[12px] text-[#6b6860]">{p.units}</td>
                          <td className="py-1.5 text-right tabular-nums text-[12px] text-[#6b6860]">{p.occupied}</td>
                          <td className="py-1.5 text-right tabular-nums text-[12px] text-[#6b6860]">{p.contracted ? fmtAED(p.contracted) : '—'}</td>
                          <td className="py-1.5 text-right tabular-nums text-[12px] text-[#b45309]">{p.market ? fmtAED(p.market) : '—'}</td>
                          <td className="py-1.5 text-right tabular-nums text-[12px] text-[#6b6860]">{askLabel(p)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
      {/* Pricing and demand are one story, so they share a row: what we let
          under asking, beside the stock that isn't letting at all. Vacancy
          aging moved up from Section 4 to sit here. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <ChartCard title="Market rent vs annual rent"
          sub={`Per lease-start quarter: the unit's asking price against what the lease contracted${marketGap.avgPct != null ? ` · let ${marketGap.avgPct}% under asking on average` : ''}. Asking is today's list price — the spread is repricing headroom, not a historical market index.`}>
          {data.market.direction.length === 0 ? <EmptyChart text="Not enough signed leases to draw a trend" /> : (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <LineChart data={marketGap.rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => aedShort(Number(v))} />
                  <Tooltip content={<MarketTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Market rent" stroke={AMBER} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                  <Line type="monotone" dataKey="Annual rent" stroke={BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </ChartCard>
        <ChartCard title="Vacancy aging"
          sub={`${data.providersOps.vacancy.vacantUnits} vacant unit${data.providersOps.vacancy.vacantUnits === 1 ? '' : 's'} by days vacant · est. ${fmtAED(data.providersOps.vacancy.monthlyLoss)} rent lost per month`}
          href="/dashboard/admin/units?availability=available" hint="Units">
          <HBars height={190} fmt={(v) => `${v} units`} rows={data.providersOps.vacancy.buckets.map((b, i) => ({
            name: b.bucket, value: b.units, color: ['#8fb4de', '#5f92cc', '#3a6fb0', '#274e85'][i],
            label: `${b.units} · ${fmtAED(b.monthlyLoss)}/mo`,
          }))} />
        </ChartCard>
      </div>

      {/* ── 4 · PROVIDERS ── */}
      <SectionHead id="sec-providers" no="Section 4 · Providers" q="Is each provider earning its place?" />
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#1a1916]">Needs intervention today</h3>
          <span className="text-[10px] font-semibold text-[#9b9890]">click a row to see the work</span>
        </div>
        <p className="text-[11px] text-[#9b9890] mt-0.5 mb-2">The platform analog of “delayed orders” — each queue mirrors the per-provider Action Center exactly</p>
        <div className="divide-y divide-[#f0ede8]">
          {data.queues.map((qu) => {
            const open = openQueue === qu.key;
            const tone = qu.count === 0 ? '#1a7a5a' : ['kycExpired', 'bounced', 'renewalBacklog'].includes(qu.key) ? RED : ['registration', 'signatures', 'settlements'].includes(qu.key) ? '#c2410c' : AMBER;
            return (
              <div key={qu.key}>
                <button onClick={() => setOpenQueue(open ? null : qu.key)}
                  className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-[#fafaf8] px-1 rounded-lg">
                  <span className="flex-1 text-[13px] text-[#1a1916]">{qu.label}</span>
                  {qu.amount != null && qu.amount > 0 && <span className="text-[12px] text-[#6b6860] tabular-nums">{fmtAED(qu.amount)}</span>}
                  {qu.oldestDays != null && qu.oldestDays > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#9b9890] tabular-nums"><Clock size={11} /> oldest {qu.oldestDays}d</span>
                  )}
                  <span className="min-w-[26px] text-center text-[12px] font-bold tabular-nums rounded-full px-2 py-0.5"
                    style={{ background: qu.count === 0 ? '#f0faf6' : '#fef2f2', color: tone }}>{qu.count}</span>
                  {qu.count > 0 ? (open ? <ChevronUp size={14} className="text-[#9b9890]" /> : <ChevronDown size={14} className="text-[#9b9890]" />) : <span className="w-3.5" />}
                </button>
                {open && qu.count > 0 && (
                  <div className="pb-2 pl-1">
                    <div className="rounded-xl bg-[#fafaf8] border border-[#f0ede8] divide-y divide-[#f0ede8]">
                      {qu.items.map((it) => {
                        const label = [it.unit && `Unit ${it.unit}`, it.building, it.tenant].filter(Boolean).join(' · ') || it.detail || `#${it.id}`;
                        const href = it.userId != null ? `/dashboard/admin/users/${it.userId}` : it.rpId != null ? `/dashboard/admin/kyc/rental-provider/${it.rpId}` : null;
                        const row = (
                          <div className="flex items-center gap-3 px-3 py-2">
                            <span className="flex-1 text-[12px] text-[#3d3b35]">{label}{it.detail && label !== it.detail ? <span className="text-[#9b9890]"> — {it.detail}</span> : null}</span>
                            {it.amount != null && <span className="text-[12px] tabular-nums text-[#6b6860]">{fmtAED(it.amount)}</span>}
                            <span className="text-[11px] text-[#9b9890] whitespace-nowrap">{dateLabel(it.date)}</span>
                            {it.rpName && <span className="text-[10px] text-[#9b9890] border border-[#e8e6e0] rounded-full px-2 py-0.5 whitespace-nowrap">{it.rpName}</span>}
                            {href && <ArrowUpRight size={12} className="text-[#9b9890]" />}
                          </div>
                        );
                        return href
                          ? <Link key={`${qu.key}-${it.id}`} href={href} className="block hover:bg-white">{row}</Link>
                          : <div key={`${qu.key}-${it.id}`}>{row}</div>;
                      })}
                      {qu.truncated && (
                        <p className="px-3 py-2 text-[11px] text-[#9b9890]">Showing {qu.items.length} of {qu.count}{qu.href ? ' — open the linked board for the rest' : ''}</p>
                      )}
                    </div>
                    {qu.href && (
                      <Link href={qu.href} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1e5fae] mt-1.5 hover:underline">
                        Open in {qu.href.includes('kyc') ? 'Profile Verification' : 'Risk board'} <ArrowUpRight size={11} />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 5 · CUSTOMERS ── */}
      <SectionHead id="sec-customers" no="Section 5 · Customers" q="Are customers staying and being served?" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Customer-side health" sub="Retention and adoption — the customer's view of the platform">
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-[#f0ede8]">
              <tr>
                <td className="py-2.5">Repeat customers (more than one lease — renewed or re-leased)</td>
                <td className="py-2.5 text-right tabular-nums"><strong>{data.customers.repeat.count}</strong> · {data.customers.repeat.pctOfActive}% of active customers</td>
              </tr>
              <tr>
                <td className="py-2.5">Customer portal adoption (seen in portal, last 30 days)</td>
                <td className="py-2.5 text-right"><Meter pct={data.customers.portalAdoption.pct} width="w-28" /></td>
              </tr>
              <tr>
                <td className="py-2.5 text-[#9b9890]">Complaints &amp; resolution time</td>
                <td className="py-2.5 text-right text-[11px] text-[#9b9890]">not tracked yet — needs a complaint/ticket category at intake</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-[#9b9890] mt-2">Portal-active customers likely pay faster — adoption is a collections lever, not a vanity metric ({data.customers.portalAdoption.active30d} of {data.customers.portalAdoption.activeCustomers} active customers).</p>
        </ChartCard>
        <MoveOutReasonsCard mo={data.customers.moveOuts} />
      </div>

      {/* ── 6 · EXPOSURE ── */}
      <SectionHead id="sec-exposure" no="Section 6 · Exposure" q="What's at risk?" />
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
        <h3 className="text-sm font-bold text-[#1a1916]">Concentration risk</h3>
        <p className="text-[11px] text-[#9b9890] mt-0.5 mb-2">Platform fragility at a glance — losing one provider or one building should never be invisible until it happens</p>
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-[#f0ede8]">
            {[
              { label: `Top provider share of contracted rent${data.exposure.concentration.topProvider ? ` — ${data.exposure.concentration.topProvider.name}` : ''}`, pct: data.exposure.concentration.topProvider?.sharePct ?? 0, guard: 40 },
              { label: `Top area share of active leases${data.exposure.concentration.topArea ? ` — ${data.exposure.concentration.topArea.name}` : ''}`, pct: data.exposure.concentration.topArea?.sharePct ?? 0, guard: 40 },
              { label: `Top building share of contracted rent${data.exposure.concentration.topBuilding ? ` — ${data.exposure.concentration.topBuilding.name}` : ''}`, pct: data.exposure.concentration.topBuilding?.sharePct ?? 0, guard: 40 },
            ].map((r) => (
              <tr key={r.label}>
                <td className="py-2.5">{r.label}</td>
                <td className="py-2.5 w-56"><Meter pct={r.pct} width="w-40" tone={r.pct > r.guard ? RED : BLUE} /></td>
                <td className="py-2.5 text-right">
                  {r.pct > r.guard
                    ? <StatusDot tone={RED} label={`Above ${r.guard}% guardrail`} />
                    : <StatusDot tone="#1a7a5a" label="Healthy" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <ChartCard title="Deposit settlement aging"
          sub={`${risk.settlementsCount} settlement${risk.settlementsCount === 1 ? '' : 's'} pending, ${fmtAED(risk.settlementsPending)} — how long money owed back has been waiting since the lease ended`}
          href="/dashboard/admin/risk" hint="Risk board">
          {risk.settlementsCount === 0 ? <EmptyChart text="No deposit settlements pending" h={150} /> : (
            <HBars height={150} fmt={(v) => `${v} cases`} rows={data.exposure.depositAging.map((b, i) => ({
              name: b.bucket, value: b.cases, color: ['#8fb4de', '#5f92cc', '#3a6fb0', '#274e85'][i],
              label: `${b.cases} · ${fmtAED(b.amount)}`,
            }))} />
          )}
          <p className="text-[11px] text-[#9b9890] mt-1">The 60+ bucket is the compliance exposure — deposit delays are the top complaint driver in UAE rentals.</p>
        </ChartCard>
      </div>


      {/* ── 7 · USAGE ── */}
      <SectionHead id="sec-usage" no="Section 7 · Usage" q="When is the platform worked?" />

      {/* Day-by-day trend first, then the intraday pattern below it. Mirrors the
          Activity board's "Platform activity / day": actions are WRITES (bars),
          page views are READS (line) — two different things on one timeline, so
          a quiet-but-watched day is visible rather than reading as inactivity. */}
      <ChartCard title="Platform activity / day"
        sub={`Last 30 days · ${data.usage.actions30d.toLocaleString()} actions by ${data.usage.activeUsers30d} users`}
        href="/dashboard/admin/activity" hint="Activity">
        <div className="flex items-center gap-4 text-[11px] text-[#6b6860] mb-1">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: BLUE }} />Actions</span>
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-0.5 inline-block" style={{ background: JADE }} />Page views</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data.usage.daily.map((d) => ({ ...d, name: dayTick(d.day) }))}
            margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
            <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} interval={4} />
            <YAxis yAxisId="a" tick={TICK} axisLine={false} tickLine={false} width={38} />
            <YAxis yAxisId="v" orientation="right" tick={TICK} axisLine={false} tickLine={false} width={38} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar yAxisId="a" dataKey="actions" name="Actions" fill={BLUE} radius={[3, 3, 0, 0]} maxBarSize={14} />
            <Line yAxisId="v" type="monotone" dataKey="views" name="Page views" stroke={JADE} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="mt-3" />
      <ChartCard title="Platform usage heatmap"
        sub={`Audit-logged actions per hour across the week, last 30 days · ${data.usage.actions30d.toLocaleString()} actions by ${data.usage.activeUsers30d} users`}
        href="/dashboard/admin/activity" hint="Activity">
        {/* The answer, before the picture. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          {[
            {
              k: 'Peak',
              v: `${DAY_LONG[heat.peak.dow]} ${String(heat.peak.hour).padStart(2, '0')}:00`,
              s: `${heat.peak.actions.toLocaleString()} action${heat.peak.actions === 1 ? '' : 's'} in that single hour`,
              tone: '#1a7a5a',
            },
            {
              k: 'Busiest day',
              v: DAY_LONG[heat.busiestDay],
              s: `${heat.byDay[heat.busiestDay].toLocaleString()} actions · heaviest hour of the day is ${String(heat.busiestHour).padStart(2, '0')}:00`,
              tone: '#1a1916',
            },
            {
              k: 'Quietest day',
              v: DAY_LONG[heat.quietestDay],
              s: `${heat.byDay[heat.quietestDay].toLocaleString()} actions · ${heat.byDay[heat.busiestDay] ? Math.round((1 - heat.byDay[heat.quietestDay] / heat.byDay[heat.busiestDay]) * 100) : 0}% below the busiest day`,
              tone: '#b45309',
            },
          ].map((c) => (
            <div key={c.k} className="rounded-xl border border-[#e8e6e0] bg-[#fafaf8] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{c.k}</div>
              <div className="text-[14px] font-bold mt-0.5 tabular-nums" style={{ color: c.tone }}>{c.v}</div>
              <div className="text-[11px] text-[#6b6860] mt-0.5">{c.s}</div>
            </div>
          ))}
        </div>
        {heat.core && (
          <p className="text-[11.5px] text-[#6b6860] mb-3">
            Seven in ten actions land between{' '}
            <span className="font-semibold text-[#1a1916]">
              {String(heat.core.from).padStart(2, '0')}:00 and {String(heat.core.to).padStart(2, '0')}:59
            </span>{' '}
            — the working window to schedule maintenance, migrations and bulk sends around.
          </p>
        )}
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, di) => (
              <div key={day} className="flex items-center gap-0.5 mb-0.5">
                <span className="w-9 text-[10px] text-[#9b9890] text-right pr-1.5 shrink-0">{day}</span>
                {heat.grid[di].map((v, h) => {
                  const idx = heat.max === 0 || v === 0 ? 0 : Math.min(HEAT.length - 1, 1 + Math.floor((v / heat.max) * (HEAT.length - 2)));
                  return (
                    <span key={h} title={`${day} ${String(h).padStart(2, '0')}:00 — ${v} action${v === 1 ? '' : 's'}`}
                      className="flex-1 h-4 rounded-[3px] min-w-[16px]" style={{ background: HEAT[idx] }} />
                  );
                })}
              </div>
            ))}
            <div className="flex items-center gap-0.5 mt-1">
              <span className="w-9 shrink-0" />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="flex-1 min-w-[16px] text-center text-[9px] text-[#9b9890]">{h % 4 === 0 ? String(h).padStart(2, '0') : ''}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2 text-[11px] text-[#9b9890]">
          Fewer actions {HEAT.map((c) => <span key={c} className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: c }} />)} More · times in Dubai (GST)
        </div>
      </ChartCard>

      {/* Public demand — a DIFFERENT audience from everything above it. The two
          charts above count signed-in staff; this counts anonymous visitors on
          the public listing pages, so it reads as market interest, not usage.
          Views without leads is the signal worth acting on. */}
      <div className="mt-3">
        <ChartCard title="Most-viewed listings · public"
          sub={`Last 30 days · ${data.usage.listings.totalViews.toLocaleString()} view${data.usage.listings.totalViews === 1 ? '' : 's'} by ${data.usage.listings.visitors.toLocaleString()} visitor${data.usage.listings.visitors === 1 ? '' : 's'} on the public listing pages`}
          href="/dashboard/admin/activity" hint="Activity">
          {data.usage.listings.top.length === 0 ? (
            <EmptyChart text="No public listing views in the last 30 days" h={140} />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <th className="py-1.5 font-semibold">Unit</th>
                  <th className="py-1.5 font-semibold text-right">Views</th>
                  <th className="py-1.5 font-semibold text-right">Visitors</th>
                  <th className="py-1.5 font-semibold text-right" title="Leads created on this unit in the same window. Views with no leads is demand the listing is failing to convert.">Leads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede8]">
                {data.usage.listings.top.map((l, i) => (
                  <tr key={l.unitId}>
                    <td className="py-2">
                      <span className="inline-block w-4 text-[10px] text-[#9b9890] tabular-nums">{i + 1}</span>
                      <Link href={`/listings/units/${l.unitId}`} className="text-[#1a1916] hover:underline">{l.unit}</Link>
                      <span className="text-[11px] text-[#9b9890] ml-1.5">{l.property}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold">{l.views.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-[#6b6860]">{l.visitors.toLocaleString()}</td>
                    <td className={`py-2 text-right tabular-nums font-semibold ${l.leads > 0 ? 'text-[#1a7a5a]' : 'text-[#b45309]'}`}>
                      {l.leads}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>
      </div>

      <p className="text-[11px] text-[#9b9890] mt-5">
        Every figure is live from the platform database, scoped by the shared lease rule (active, or PDCs confirmed; expired / terminated / wound-down excluded) so it matches each provider&apos;s own dashboard.
        Not instrumented yet, shown as such above: complaints and resolution time.
        Generated {new Date(data.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
      </p>
    </div>
  );
}
