'use client';

/**
 * "Live Overview" — the Service Provider Overview dashboard once a provider
 * is fully job-ready (see ServiceProviderOverview's `live` flag). Replaces
 * the go-live journey strip with operational data: KPIs, an 8-week earnings
 * chart, today's schedule, the booking pipeline, revenue mix and the team
 * roster.
 *
 * Visuals follow the claude.ai/design project "UpNow SP Onboarding" screen
 * 2a TO THE TOKEN: canvas-on-white cards, border #E4E7E2 r14, green
 * #0B7A4E/#08603D/#0A3D26, amber #C77D0A/#FEF6E7 action strip, Schibsted
 * Grotesk (loaded by the page, scoped via className).
 *
 * Data honesty: bookings for a service provider are ALWAYS EMPTY today —
 * BookingsService#listForRole never sets serviceProviderId at intake
 * (dispatch/S3 not wired), so every booking-derived widget below computes
 * real values that read as zero until dispatch ships, exactly like the rest
 * of this dashboard already does. Two widgets have no backing data model at
 * all yet and are rendered as honest empty states rather than invented
 * numbers: ratings (reviews module has zero HTTP endpoints) and per-technician
 * utilization (no such field exists on Technician) — the Team card shows the
 * real roster + status instead of a fabricated load %.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Inbox, CalendarClock, Wallet, Star, ArrowRight, Users, Clock,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { bookingPipeline, type SpBooking, type SpPipelineTab } from '@/components/upnow/SpOperationsPipelines';

/* ── Tokens (extracted from design 2a) ──────────────────────────────────── */
const GREEN = '#0B7A4E';
const GREEN_DEEP = '#0A3D26';
const INK = '#182420';
const MUTE = '#55645B';
const FAINT = '#8A968D';
const FAINTER = '#B7C0BA';
const BORDER = '1px solid #E4E7E2';
const HAIRLINE = '1px solid #EEF1EE';
const TINT_GREEN = '#E9F4EE';
const TINT_AMBER = '#FEF6E7';
const AMBER_BORDER = '1px solid #F0D9A6';
const AMBER = '#C77D0A';
const AMBER_TEXT = '#92400E';
const AMBER_SUBTEXT = '#7A5410';
const CHART_MINT = '#9DC9B2';
const MIX_MID = '#8FBFA4';
const MIX_LIGHT = '#CFE3D7';
const GREY_TRACK = '#F0F2EF';

const card = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: '#fff', border: BORDER, borderRadius: 14, ...extra,
});
const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: FAINT,
};

/* ── Server shapes ───────────────────────────────────────────────────────── */
type Booking = SpBooking & { addressText?: string | null };
interface Technician { id: number; status?: string | null; isLeadCapable?: boolean; user?: { name?: string | null } | null }

const asArray = <T,>(d: unknown): T[] =>
  Array.isArray(d) ? d as T[] : (Array.isArray((d as { data?: T[] })?.data) ? (d as { data: T[] }).data : []);

/* ── Dubai-aware date helpers (bookings must bucket by UAE calendar day) ──── */
function dubaiYMD(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .reduce((acc, p) => { if (p.type !== 'literal') acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}
const dubaiDayKey = (date: Date) => { const { y, m, d } = dubaiYMD(date); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
const dubaiDateOnly = (date: Date) => { const { y, m, d } = dubaiYMD(date); return new Date(Date.UTC(y, m - 1, d)); };
const dubaiHour = (date: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: 'numeric', hour12: false }).format(date));
const dubaiTime = (date: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
const dubaiTodayLabel = () => new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
function mondayOf(dateOnly: Date) {
  const day = dateOnly.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(dateOnly);
  m.setUTCDate(m.getUTCDate() + diff);
  return m;
}
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };
const fmtAED = (n: number) => `AED ${Math.round(n).toLocaleString('en-AE')}`;
const norm = (s?: string | null) => (s ?? '').toLowerCase();
const DONE = new Set(['completed', 'escrow_release']);
const ACTIVE = new Set(['en_route', 'in_progress']);

const PIPE_DEFS: { key: SpPipelineTab; label: string; color: string }[] = [
  { key: 'requests', label: 'New requests', color: AMBER },
  { key: 'quotes', label: 'Quoted, awaiting customer', color: MIX_LIGHT },
  { key: 'active', label: 'In progress', color: GREEN },
  { key: 'closure', label: 'Awaiting closure', color: GREEN_DEEP },
];

function scheduleBadge(status?: string | null): { label: string; bg: string; fg: string; border?: string } {
  const s = norm(status);
  if (DONE.has(s)) return { label: 'Done ✓', bg: TINT_GREEN, fg: GREEN };
  if (ACTIVE.has(s)) return { label: 'In progress', bg: '#F2FAF5', fg: GREEN, border: `1px solid ${MIX_MID}` };
  if (s === 'cancelled') return { label: 'Cancelled', bg: GREY_TRACK, fg: FAINT };
  return { label: 'Up next', bg: GREY_TRACK, fg: MUTE };
}

function sparklinePoints(values: number[], w = 84, h = 28) {
  const max = Math.max(1, ...values);
  const n = values.length;
  return values.map((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * w : 0;
    const y = h - (v / max) * h * 0.82 - h * 0.09;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

/* ── Small presentational pieces ─────────────────────────────────────────── */
function Kpi({ label, icon: Icon, value, trend, trendColor, spark }: {
  label: string; icon: React.ElementType; value: React.ReactNode; trend: React.ReactNode; trendColor?: string; spark?: number[];
}) {
  return (
    <div style={card({ padding: '15px 17px' })}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 12, fontWeight: 600, color: MUTE }}>{label}</span>
        {spark ? (
          <svg width="84" height="28" viewBox="0 0 84 28" fill="none">
            <polyline points={sparklinePoints(spark)} stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <div style={{ width: 30, height: 30, borderRadius: 9, background: TINT_GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={14} color={GREEN} />
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 27, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1, color: INK }}>{value}</div>
      <div style={{ marginTop: 7, fontSize: 12, color: trendColor ?? MUTE, display: 'flex', alignItems: 'center', gap: 5 }}>{trend}</div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: FAINT, textAlign: 'center', padding: '18px 4px' }}>{children}</div>;
}

/* ── Main component ──────────────────────────────────────────────────────── */
export function SpLiveOverview({ businessName }: { businessName?: string | null }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [granularity, setGranularity] = useState<'weekly' | 'monthly'>('weekly');
  // Captured once per mount (empty deps) rather than read fresh during render.
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    apiGet<unknown>('/bookings').then(d => setBookings(asArray<Booking>(d))).catch(() => {});
    apiGet<unknown>('/team/technicians').then(d => setTechnicians(asArray<Technician>(d))).catch(() => {});
    apiGet<unknown>('/invitations?status=pending').then(d => setPendingInvites(asArray(d).length)).catch(() => {});
  }, []);

  const todayKey = dubaiDayKey(now);
  const todayOnly = dubaiDateOnly(now);
  const todayOnlyMs = todayOnly.getTime();
  const weekStart = mondayOf(todayOnly);
  const weekStartMs = weekStart.getTime();
  const weekEnd = addDays(weekStart, 7);

  const greeting = dubaiHour(now) < 12 ? 'Good morning' : dubaiHour(now) < 18 ? 'Good afternoon' : 'Good evening';

  const withDate = useMemo(() => bookings
    .filter(b => !!b.scheduledAt)
    .map(b => ({ ...b, _at: new Date(b.scheduledAt as string), _value: Number(b.totalAmount ?? b.price ?? 0) })), [bookings]);

  const inProgressNow = withDate.filter(b => ACTIVE.has(norm(b.status)));
  const upcoming = withDate.filter(b => b._at.getTime() > now.getTime() && !['cancelled', ...DONE].includes(norm(b.status)))
    .sort((a, b) => a._at.getTime() - b._at.getTime());
  const nextVisit = upcoming[0];

  const headerSub = inProgressNow.length > 0
    ? `${inProgressNow.length} job${inProgressNow.length === 1 ? '' : 's'} in progress right now${nextVisit ? ` · next visit ${dubaiTime(nextVisit._at)}${nextVisit.emirate ? ` in ${nextVisit.emirate}` : ''}` : ''}`
    : nextVisit
      ? `Next visit ${dubaiTime(nextVisit._at)}${nextVisit.emirate ? ` in ${nextVisit.emirate}` : ''}`
      : 'No jobs in progress right now.';

  const newRequests = withDate.filter(b => bookingPipeline(b) === 'requests');

  const thisWeek = withDate.filter(b => b._at >= weekStart && b._at < weekEnd);
  const weekDone = thisWeek.filter(b => DONE.has(norm(b.status))).length;
  const weekActive = thisWeek.filter(b => ACTIVE.has(norm(b.status))).length;
  const weekAhead = thisWeek.length - weekDone - weekActive;

  const last30Start = addDays(todayOnly, -30);
  const prev30Start = addDays(todayOnly, -60);
  const earned30 = withDate.filter(b => DONE.has(norm(b.status)) && b._at >= last30Start && b._at < addDays(todayOnly, 1))
    .reduce((s, b) => s + b._value, 0);
  const earnedPrev30 = withDate.filter(b => DONE.has(norm(b.status)) && b._at >= prev30Start && b._at < last30Start)
    .reduce((s, b) => s + b._value, 0);
  const earningsTrend = earned30 === 0 && earnedPrev30 === 0
    ? 'No completed jobs yet'
    : earnedPrev30 === 0
      ? 'First earnings this period'
      : `${earned30 >= earnedPrev30 ? '↑' : '↓'} ${Math.abs(Math.round(((earned30 - earnedPrev30) / earnedPrev30) * 100))}% vs previous 30 days`;

  // Cheap array math over a handful of bookings — left as plain consts
  // (React Compiler auto-memoizes render output; wrapping Date-derived
  // primitives in manual useMemo fights its dependency analysis instead).
  const sparkBuckets = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(todayOnlyMs - (30 - i * 5) * 86_400_000);
    const end = new Date(start.getTime() + 5 * 86_400_000);
    return withDate.filter(b => DONE.has(norm(b.status)) && b._at >= start && b._at < end).reduce((s, b) => s + b._value, 0);
  });

  /* 8-week / 6-month earnings chart */
  const chartBuckets = granularity === 'weekly'
    ? Array.from({ length: 8 }, (_, i) => {
        const start = new Date(weekStartMs - 7 * (7 - i) * 86_400_000);
        const end = new Date(start.getTime() + 7 * 86_400_000);
        const rows = withDate.filter(b => DONE.has(norm(b.status)) && b._at >= start && b._at < end);
        return { start, end, total: rows.reduce((s, b) => s + b._value, 0), count: rows.length, isCurrent: i === 7 };
      })
    : Array.from({ length: 6 }, (_, i) => {
        const monthsAgo = 5 - i;
        const anchor = new Date(todayOnlyMs);
        const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - monthsAgo, 1));
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        const rows = withDate.filter(b => DONE.has(norm(b.status)) && b._at >= start && b._at < end);
        return { start, end, total: rows.reduce((s, b) => s + b._value, 0), count: rows.length, isCurrent: monthsAgo === 0 };
      });
  const chartMax = Math.max(1, ...chartBuckets.map(b => b.total));
  const chartTotal = chartBuckets.reduce((s, b) => s + b.total, 0);
  const pendingPayout = withDate.filter(b => norm(b.status) === 'completed').reduce((s, b) => s + b._value, 0);

  /* Today's schedule */
  const todaysJobs = withDate
    .filter(b => dubaiDayKey(b._at) === todayKey && norm(b.status) !== 'cancelled')
    .sort((a, b) => a._at.getTime() - b._at.getTime());
  const todayDoneCount = todaysJobs.filter(b => DONE.has(norm(b.status))).length;
  const todayActiveCount = todaysJobs.filter(b => ACTIVE.has(norm(b.status))).length;

  /* Booking pipeline */
  const pipelineRows = PIPE_DEFS.map(def => {
    const rows = withDate.filter(b => bookingPipeline(b) === def.key);
    return { ...def, count: rows.length, value: rows.reduce((s, b) => s + b._value, 0) };
  });
  const pipeline = {
    rows: pipelineRows,
    total: pipelineRows.reduce((s, r) => s + r.count, 0),
    totalValue: pipelineRows.reduce((s, r) => s + r.value, 0),
  };

  /* Revenue mix — grouped by service (category taxonomy isn't loaded on /bookings today) */
  const mixStart = new Date(todayOnlyMs - 30 * 86_400_000);
  const mixCompleted = withDate.filter(b => DONE.has(norm(b.status)) && b._at >= mixStart);
  const mixTotal = mixCompleted.reduce((s, b) => s + b._value, 0);
  const mixByName = new Map<string, number>();
  for (const b of mixCompleted) {
    const name = b.serviceName ?? b.service?.name ?? 'Other';
    mixByName.set(name, (mixByName.get(name) ?? 0) + b._value);
  }
  const mixSorted = [...mixByName.entries()].sort((a, b) => b[1] - a[1]);
  const mixTop = mixSorted.slice(0, 3);
  const mixOtherValue = mixSorted.slice(3).reduce((s, [, v]) => s + v, 0);
  const revenueMix = {
    total: mixTotal,
    slices: [...mixTop, ...(mixOtherValue > 0 ? [['Other', mixOtherValue] as [string, number]] : [])]
      .map(([name, value], i) => ({ name, value, pct: mixTotal > 0 ? Math.round((value / mixTotal) * 100) : 0, color: [GREEN, MIX_MID, MIX_LIGHT, GREY_TRACK][i] ?? GREY_TRACK })),
  };

  const techCount = technicians.length;
  const activeTechs = technicians.filter(t => norm(t.status) === 'active').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* header */}
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.015em', color: INK }}>
            {greeting}, {businessName || 'there'}
          </div>
          <div style={{ marginTop: 3, fontSize: 13, color: MUTE }}>{headerSub}</div>
        </div>
        <Link
          href="/dashboard/service-provider/services"
          className="flex items-center gap-2 flex-shrink-0"
          style={{ height: 40, padding: '0 16px', borderRadius: 11, background: GREEN, color: '#fff', fontSize: 13.5, fontWeight: 600, boxShadow: '0 5px 14px -7px rgba(11,122,78,.55)' }}
        >
          <Plus size={14} /> Add Service
        </Link>
      </div>

      {/* amber action strip — only when there is something time-critical */}
      {newRequests.length > 0 && (
        <div style={{ background: TINT_AMBER, border: AMBER_BORDER, borderRadius: 13, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: AMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Clock size={16} color="#fff" />
          </div>
          <div className="flex-1 min-w-0">
            <span style={{ fontSize: 13.5, fontWeight: 700, color: AMBER_TEXT }}>
              {newRequests.length} new request{newRequests.length === 1 ? '' : 's'} waiting for a response.
            </span>{' '}
            <span style={{ fontSize: 13, color: AMBER_SUBTEXT }}>Responding quickly keeps your response rate high.</span>
          </div>
          <Link
            href="/dashboard/service-provider/operations?tab=requests"
            className="flex-shrink-0 flex items-center gap-1"
            style={{ height: 36, padding: '0 15px', borderRadius: 10, background: '#fff', border: AMBER_BORDER, color: AMBER_TEXT, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            Review requests <ArrowRight size={13} />
          </Link>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi
          label="New requests" icon={Inbox} value={newRequests.length}
          trend={newRequests.length > 0
            ? <><span style={{ width: 6, height: 6, borderRadius: '50%', background: AMBER, display: 'inline-block' }} />Awaiting confirmation</>
            : 'No incoming requests'}
          trendColor={newRequests.length > 0 ? AMBER : undefined}
        />
        <Kpi
          label="Jobs this week" icon={CalendarClock} value={thisWeek.length}
          trend={thisWeek.length > 0
            ? <><b style={{ color: GREEN }}>{weekDone} done</b>&nbsp;· {weekActive} in progress · {weekAhead} ahead</>
            : 'No jobs scheduled this week'}
        />
        <Kpi
          label="Earnings · last 30 days" icon={Wallet} spark={sparkBuckets}
          value={fmtAED(earned30)}
          trend={<b style={{ color: earned30 > 0 && earned30 >= earnedPrev30 ? GREEN : undefined }}>{earningsTrend}</b>}
        />
        <Kpi
          label="Rating" icon={Star} value="—"
          trend="No reviews yet"
        />
      </div>

      {/* row B: earnings chart + today's schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3.5">
        <div style={card({ padding: '17px 18px 14px' })}>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div style={sectionLabel}>Earnings · last {granularity === 'weekly' ? '8 weeks' : '6 months'}</div>
              <div className="flex items-baseline gap-2" style={{ marginTop: 5 }}>
                <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: INK }}>{fmtAED(chartTotal)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', background: '#F5F7F4', border: BORDER, borderRadius: 9, padding: 2 }}>
              {(['weekly', 'monthly'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  style={{
                    fontSize: 11.5, fontWeight: g === granularity ? 600 : 500, padding: '5px 11px', borderRadius: 7,
                    background: g === granularity ? '#fff' : 'transparent',
                    border: g === granularity ? BORDER : '1px solid transparent',
                    color: g === granularity ? INK : FAINT, textTransform: 'capitalize', cursor: 'pointer',
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div style={{ position: 'relative', height: 148, marginTop: 22 }}>
            <div style={{ position: 'absolute', left: 0, right: 6, bottom: 0, height: 1, background: '#E4E7E2' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 1, left: 4, right: 6, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
              {chartBuckets.map((b, i) => {
                const h = Math.max(3, (b.total / chartMax) * 140);
                return (
                  <div key={i} className="flex-1 flex justify-center relative">
                    {b.total > 0 && (
                      <div style={{ position: 'absolute', bottom: h + 8, fontSize: 10, color: FAINT, whiteSpace: 'nowrap' }}>{fmtAED(b.total)}</div>
                    )}
                    <div style={{
                      width: 26, height: h, borderRadius: '7px 7px 2px 2px',
                      background: b.isCurrent ? GREEN : b.total > 0 ? CHART_MINT : GREY_TRACK,
                    }} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex gap-3" style={{ marginTop: 7 }}>
            {chartBuckets.map((b, i) => (
              <span key={i} className="flex-1 text-center" style={{ fontSize: 10.5, color: b.isCurrent ? GREEN : FAINT, fontWeight: b.isCurrent ? 700 : 400 }}>
                {granularity === 'weekly'
                  ? (b.isCurrent ? 'this wk' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(b.start))
                  : (b.isCurrent ? 'this mo' : new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(b.start))}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 13, borderTop: HAIRLINE, paddingTop: 11, fontSize: 12, color: MUTE }}>
            {pendingPayout > 0
              ? <>Pending payout <b style={{ color: INK }}>{fmtAED(pendingPayout)}</b></>
              : chartTotal === 0
                ? 'Earnings will appear here once jobs are completed.'
                : 'No pending payouts.'}
          </div>
        </div>

        <div style={card({ padding: '17px 18px 12px', display: 'flex', flexDirection: 'column' })}>
          <div className="flex items-baseline gap-2">
            <div style={{ ...sectionLabel, flex: 1 }}>Today · {dubaiTodayLabel()}</div>
            <Link href="/dashboard/service-provider/operations" style={{ fontSize: 12, fontWeight: 600, color: GREEN }}>View all →</Link>
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: MUTE }}>
            {todaysJobs.length > 0
              ? <><b style={{ color: INK }}>{todaysJobs.length} job{todaysJobs.length === 1 ? '' : 's'}</b> · {todayDoneCount} done · {todayActiveCount} in progress</>
              : 'Nothing on the books yet'}
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column' }}>
            {todaysJobs.length === 0 && <EmptyNote>No jobs scheduled today.</EmptyNote>}
            {todaysJobs.map((b, i) => {
              const badge = scheduleBadge(b.status);
              const isPast = DONE.has(norm(b.status));
              return (
                <div key={b.id} className="flex items-center gap-2.5" style={{ padding: '9px 0', borderBottom: i < todaysJobs.length - 1 ? '1px solid #F0F2EF' : undefined, opacity: isPast ? 0.62 : 1 }}>
                  <span style={{ width: 46, fontSize: 12, fontWeight: 700, color: isPast ? MUTE : INK, flexShrink: 0 }}>{dubaiTime(b._at)}</span>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 13, fontWeight: 600, color: INK, textDecoration: isPast ? 'line-through' : undefined, textDecorationColor: CHART_MINT }}>
                      {b.serviceName ?? b.service?.name ?? 'Service'}
                    </div>
                    <div style={{ fontSize: 11.5, color: FAINT }}>{b.emirate ?? b.addressText ?? '—'}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: badge.fg, background: badge.bg, border: badge.border, borderRadius: 999, padding: '4px 9px', flexShrink: 0 }}>{badge.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* row C: pipeline + revenue mix + team */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_.95fr_1fr] gap-3.5">
        <div style={card({ padding: '17px 18px' })}>
          <div style={sectionLabel}>Booking pipeline</div>
          <div style={{ marginTop: 5, fontSize: 13, color: MUTE }}>
            <b style={{ color: INK }}>{pipeline.total} booking{pipeline.total === 1 ? '' : 's'}</b> in play · est. <b style={{ color: INK }}>{fmtAED(pipeline.totalValue)}</b>
          </div>
          <div style={{ marginTop: 13, display: 'flex', height: 14, borderRadius: 99, overflow: 'hidden', gap: pipeline.total > 0 ? 2 : 0, background: pipeline.total === 0 ? GREY_TRACK : undefined }}>
            {pipeline.total > 0 && pipeline.rows.filter(r => r.count > 0).map(r => (
              <div key={r.key} style={{ width: `${(r.count / pipeline.total) * 100}%`, background: r.color }} />
            ))}
          </div>
          <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pipeline.rows.map(r => (
              <div key={r.key} className="flex items-center gap-2" style={{ fontSize: 12.5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: r.color, flexShrink: 0 }} />
                <span className="flex-1" style={{ color: MUTE }}>{r.label}</span>
                <b style={{ color: INK }}>{r.count}</b>
                <span style={{ width: 74, textAlign: 'right', color: FAINT }}>{fmtAED(r.value)}</span>
              </div>
            ))}
          </div>
          {pipeline.total === 0 && <EmptyNote>No bookings yet.</EmptyNote>}
        </div>

        <div style={card({ padding: '17px 18px' })}>
          <div style={sectionLabel}>Revenue mix · 30 days</div>
          <div className="flex items-center gap-4" style={{ marginTop: 14 }}>
            <div style={{ position: 'relative', width: 112, height: 112, flexShrink: 0 }}>
              <svg width="112" height="112" viewBox="0 0 96 96">
                <circle cx="48" cy="48" r="38" fill="none" stroke={GREY_TRACK} strokeWidth="12" />
                {revenueMix.total > 0 && (() => {
                  const circumference = 238.76;
                  let offset = 0;
                  return revenueMix.slices.map((s, i) => {
                    const len = (s.pct / 100) * circumference;
                    const el = (
                      <circle key={i} cx="48" cy="48" r="38" fill="none" stroke={s.color} strokeWidth="12"
                        strokeDasharray={`${len} ${circumference}`} transform={`rotate(${-90 + (offset / circumference) * 360} 48 48)`} />
                    );
                    offset += len;
                    return el;
                  });
                })()}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', color: INK }}>{revenueMix.total >= 1000 ? `${(revenueMix.total / 1000).toFixed(1)}k` : revenueMix.total}</span>
                <span style={{ fontSize: 9.5, color: FAINT }}>AED · 30 days</span>
              </div>
            </div>
            <div className="flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {revenueMix.slices.length > 0 ? revenueMix.slices.map(s => (
                <div key={s.name} className="flex items-center gap-2" style={{ fontSize: 12.5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span className="flex-1 truncate" style={{ color: MUTE }}>{s.name}</span>
                  <b style={{ color: INK }}>{s.pct}%</b>
                </div>
              )) : <EmptyNote>No completed jobs in the last 30 days.</EmptyNote>}
            </div>
          </div>
        </div>

        <div style={card({ padding: '17px 18px' })}>
          <div className="flex items-baseline">
            <div style={{ ...sectionLabel, flex: 1 }}>Team</div>
            <Link href="/dashboard/service-provider/settings?tab=team" style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>Manage →</Link>
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {technicians.length > 0 ? technicians.slice(0, 6).map(t => (
              <div key={t.id} className="flex items-center gap-2.5" style={{ fontSize: 12.5 }}>
                <Users size={13} color={FAINTER} />
                <span className="flex-1 truncate" style={{ fontWeight: 600, color: INK }}>{t.user?.name ?? 'Technician'}</span>
                {t.isLeadCapable && <span style={{ fontSize: 10, fontWeight: 700, color: GREEN, background: TINT_GREEN, borderRadius: 999, padding: '2px 7px' }}>Lead</span>}
                <span style={{ fontSize: 11, fontWeight: 600, color: norm(t.status) === 'active' ? GREEN : FAINT }}>
                  {norm(t.status) === 'active' ? 'Active' : (t.status ?? '—')}
                </span>
              </div>
            )) : <EmptyNote>No technicians on your team yet.</EmptyNote>}
          </div>
          <div style={{ marginTop: 13, borderTop: HAIRLINE, paddingTop: 10, fontSize: 12, color: MUTE }}>
            {techCount} technician{techCount === 1 ? '' : 's'}{activeTechs !== techCount ? ` · ${activeTechs} active` : ''}
            {pendingInvites > 0 ? ` · ${pendingInvites} invite${pendingInvites === 1 ? '' : 's'} pending` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
