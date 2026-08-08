'use client';

/**
 * Platform Status — the internal uptime page for the platform's external
 * dependencies (`/api/admin/status`).
 *
 * Everything drawn here is a probe result. The backend probes Postgres, object
 * storage, SendGrid, the Anthropic API, Google Vision, and Google Places every
 * five minutes and stores one row per component; this page renders the current
 * state and 90 days of daily history. Nothing is inferred, and a component the
 * platform has never probed says "no data" rather than showing a green bar.
 *
 * ── Why state is never carried by colour alone ───────────────────────────────
 * Operational green and down red are the classic red/green confusion pair —
 * they are close to indistinguishable under deuteranopia. So severity is
 * encoded TWICE and independently: by colour, and by the height of each cell in
 * the 90-day strip (operational full height, degraded just over half, down a
 * stub). Height alone reads correctly in greyscale, in print, and to a
 * colourblind operator. Current state is additionally spelled out in words with
 * its own icon on every row, and each cell carries a tooltip.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, AlertTriangle, XCircle, MinusCircle, CircleDashed,
  RefreshCw, Activity,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

/* ── Payload ── */

type ComponentState = 'operational' | 'degraded' | 'down' | 'unconfigured' | 'nodata';
type DayState = 'operational' | 'degraded' | 'down' | 'nodata';

interface StatusDay {
  date: string;
  status: DayState;
  checks: number;
  failed: number;
  uptimePct: number | null;
}
interface StatusComponent {
  key: string;
  label: string;
  impact: string;
  status: ComponentState;
  detail: string | null;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  uptimePct: number | null;
  checks: number;
  days: StatusDay[];
}
interface PlatformStatus {
  generatedAt: string;
  windowDays: number;
  probeIntervalMinutes: number;
  overall: 'operational' | 'degraded' | 'down' | 'nodata';
  components: StatusComponent[];
}

/* ── State vocabulary ─────────────────────────────────────────────────────────
 * The reserved status roles — good / warning / critical — plus a recessive
 * neutral for "never probed". `height` is the redundant severity channel that
 * makes the strip readable without colour at all.
 */
const STATE: Record<
  ComponentState,
  { color: string; label: string; height: string; Icon: typeof CheckCircle2 }
> = {
  operational:  { color: '#0ca30c', label: 'Operational',   height: '100%', Icon: CheckCircle2 },
  degraded:     { color: '#fab219', label: 'Degraded',      height: '55%',  Icon: AlertTriangle },
  down:         { color: '#d03b3b', label: 'Down',          height: '28%',  Icon: XCircle },
  unconfigured: { color: '#c9c6bf', label: 'Not configured', height: '18%', Icon: MinusCircle },
  nodata:       { color: '#e8e6e0', label: 'No data',       height: '12%',  Icon: CircleDashed },
};

const BANNER: Record<PlatformStatus['overall'], { text: string; tone: string; bg: string }> = {
  operational: { text: 'All systems operational', tone: '#0ca30c', bg: '#f1f9f1' },
  degraded:    { text: 'Degraded performance',    tone: '#b07c05', bg: '#fdf6e7' },
  down:        { text: 'Service disruption',      tone: '#d03b3b', bg: '#fcf1f1' },
  nodata:      { text: 'No checks recorded yet',  tone: '#6b6860', bg: '#f4f3ef' },
};

/* ── Bits ── */

function StateChip({ state }: { state: ComponentState }) {
  const s = STATE[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap"
      style={{ color: state === 'degraded' ? '#8a6100' : s.color, background: `${s.color}1a` }}
    >
      <s.Icon size={13} strokeWidth={2.4} aria-hidden />
      {s.label}
    </span>
  );
}

/**
 * The 90-day strip. One cell per Dubai calendar day, oldest on the left. Cells
 * are flex-sized so the strip always fills its row, with a 2px surface gap
 * between them and a floor width so a phone still gets a readable strip
 * (scrolling horizontally rather than crushing 90 cells into a smear).
 */
function UptimeStrip({
  days, hovered, onHover,
}: {
  days: StatusDay[];
  hovered: StatusDay | null;
  onHover: (d: StatusDay | null) => void;
}) {
  return (
    <div className="relative">
      {hovered && (
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full z-10 pointer-events-none
                        bg-[#1a1916] text-white text-[11px] rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg">
          <span className="font-semibold">{formatDay(hovered.date)}</span>
          <span className="text-[#c9c6bf]"> · {STATE[hovered.status].label}</span>
          {hovered.checks > 0 && (
            <span className="text-[#c9c6bf]">
              {' · '}{hovered.uptimePct}% of {hovered.checks} checks
              {hovered.failed > 0 && ` · ${hovered.failed} failed`}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex items-end gap-[2px] h-8 min-w-[520px]" onMouseLeave={() => onHover(null)}>
          {days.map((d) => (
            <div
              key={d.date}
              className="flex-1 min-w-[3px] h-full flex items-end cursor-default"
              onMouseEnter={() => onHover(d)}
              title={`${formatDay(d.date)} — ${STATE[d.status].label}${
                d.checks > 0 ? ` (${d.uptimePct}% of ${d.checks} checks)` : ''
              }`}
            >
              <span
                className="w-full rounded-[2px] block transition-opacity"
                style={{
                  height: STATE[d.status].height,
                  background: STATE[d.status].color,
                  opacity: hovered && hovered.date !== d.date ? 0.45 : 1,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-[#9b9890] mt-1.5">
        <span>90 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Legend() {
  const shown: DayState[] = ['operational', 'degraded', 'down', 'nodata'];
  return (
    <div className="flex flex-wrap items-end gap-4">
      {shown.map((s) => (
        <span key={s} className="flex items-end gap-1.5 text-[11px] text-[#6b6860]">
          <span className="w-[7px] h-4 flex items-end">
            <span
              className="w-full rounded-[2px] block"
              style={{ height: STATE[s].height, background: STATE[s].color }}
            />
          </span>
          {STATE[s].label}
        </span>
      ))}
    </div>
  );
}

/* ── Page ── */

export default function PlatformStatusPage() {
  const [data, setData] = useState<PlatformStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [hover, setHover] = useState<{ key: string; day: StatusDay } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setData(await apiGet<PlatformStatus>('/admin/status', { signal }));
      setError(null);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    // The cron writes every five minutes; refresh on the same cadence so a page
    // left open on a wall display never goes stale.
    const t = setInterval(() => void load(), 5 * 60 * 1000);
    return () => { ac.abort(); clearInterval(t); };
  }, [load]);

  async function probeNow() {
    setProbing(true);
    try {
      setData(await apiPost<PlatformStatus>('/admin/status/probe'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProbing(false);
    }
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 text-[13px] text-[#d03b3b]">
          Could not load platform status: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 animate-pulse space-y-3">
        <div className="h-16 bg-[#f4f3ef] rounded-2xl" />
        {[...Array(6)].map((_, i) => <div key={i} className="h-28 bg-[#f4f3ef] rounded-2xl" />)}
      </div>
    );
  }

  const banner = BANNER[data.overall];
  const unhealthy = data.components.filter(
    (c) => c.status === 'degraded' || c.status === 'down',
  );

  return (
    <div className="p-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[20px] font-bold text-[#1a1916] flex items-center gap-2">
            <Activity size={19} className="text-[#1e5fae]" aria-hidden />
            Platform Status
          </h1>
          <p className="text-[12px] text-[#6b6860] mt-0.5">
            Every dependency probed every {data.probeIntervalMinutes} minutes · last check{' '}
            {relative(lastCheck(data))}
          </p>
        </div>
        <button
          onClick={probeNow}
          disabled={probing}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#1a1916] border border-[#e8e6e0]
                     bg-white rounded-full px-3.5 py-2 hover:border-[#1e5fae] disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={13} className={probing ? 'animate-spin' : ''} aria-hidden />
          {probing ? 'Checking…' : 'Run checks now'}
        </button>
      </div>

      {/* Banner */}
      <div
        className="rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-3 mb-4"
        style={{ background: banner.bg, border: `1px solid ${banner.tone}33` }}
      >
        <div className="flex items-center gap-2.5">
          {(() => {
            const Icon = STATE[data.overall === 'nodata' ? 'nodata' : data.overall].Icon;
            return <Icon size={20} strokeWidth={2.3} style={{ color: banner.tone }} aria-hidden />;
          })()}
          <span className="text-[15px] font-bold" style={{ color: banner.tone }}>{banner.text}</span>
        </div>
        <span className="text-[12px] text-[#6b6860]">
          {unhealthy.length > 0
            ? unhealthy.map((c) => c.label).join(', ')
            : `${data.components.length} components monitored`}
        </span>
      </div>

      {/* Components */}
      <div className="space-y-3">
        {data.components.map((c) => (
          <div key={c.key} className="bg-white rounded-2xl border border-[#e8e6e0] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-[14px] font-semibold text-[#1a1916]">{c.label}</span>
                  <StateChip state={c.status} />
                  {c.latencyMs != null && c.status !== 'unconfigured' && (
                    <span className="text-[11px] text-[#9b9890] tabular-nums">{c.latencyMs} ms</span>
                  )}
                </div>
                <p className="text-[11.5px] text-[#6b6860] mt-1">{c.impact}</p>
                {c.detail && c.status !== 'operational' && (
                  <p className="text-[11.5px] text-[#8a6100] mt-1">{c.detail}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-[15px] font-bold text-[#1a1916] tabular-nums">
                  {c.uptimePct != null ? `${c.uptimePct}%` : '—'}
                </div>
                <div className="text-[10px] text-[#9b9890]">
                  {c.checks > 0 ? `${c.checks.toLocaleString()} checks · ${data.windowDays}d` : 'no checks yet'}
                </div>
              </div>
            </div>

            <UptimeStrip
              days={c.days}
              hovered={hover?.key === c.key ? hover.day : null}
              onHover={(d) => setHover(d ? { key: c.key, day: d } : null)}
            />
          </div>
        ))}
      </div>

      {/* Legend + how to read it */}
      <div className="mt-4 bg-white rounded-2xl border border-[#e8e6e0] px-5 py-4">
        <Legend />
        <p className="text-[11.5px] text-[#6b6860] mt-3 leading-relaxed">
          A day is a Dubai calendar day and takes the colour of the worst result recorded that
          day; the percentage beside each component is the share of all probes in the window that
          came back clean. Bar height repeats severity so the strip reads without colour.
          A component with no credentials on this environment reports{' '}
          <span className="font-semibold text-[#1a1916]">Not configured</span> and is left out of
          the uptime figure entirely — an absent key is not an outage. Probes are read-only and
          free: no mail is sent, no image is processed, no tokens are spent.
        </p>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function lastCheck(d: PlatformStatus): string | null {
  const stamps = d.components.map((c) => c.lastCheckedAt).filter((s): s is string => !!s);
  return stamps.length ? stamps.sort().at(-1)! : null;
}

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
