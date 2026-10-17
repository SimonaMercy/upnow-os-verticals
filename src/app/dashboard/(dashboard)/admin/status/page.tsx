'use client';

/**
 * Admin › Platform › Platform status — Genspark OS rebuild.
 *
 * Parity with previous page (same endpoints):
 *  - GET /api/admin/status (AbortController on mount) + 5-minute auto refresh interval.
 *  - "Run checks now" → POST /api/admin/status/probe (replaces data; busy label "Checking…").
 *  - Load error with no data → error Callout (now with Try again); loading → skeletons.
 *  - Overall banner (operational / degraded / down / nodata) + unhealthy component names, now a
 *    kit Callout + Kpis (overall, monitored, unhealthy, last check).
 *  - Per component: label, state chip (now kit Pill + icon, words always shown), latency,
 *    impact, detail when not operational, uptime % + checks/window, 90-day UptimeStrip with
 *    hover tooltip (local component KEPT — height encodes severity redundantly) and Legend.
 *  - "How to read it" explanatory copy kept (now a Callout).
 *
 * Original notes — Platform Status: the internal uptime page for the platform's external
 * dependencies (`/api/admin/status`).
 *
 * Everything drawn here is a probe result. The backend probes the frontend, its
 * own HTTP layer, Postgres, object storage and SendGrid every five minutes and
 * stores one row per component; this page renders the current state and 90 days
 * of daily history. Nothing is inferred, and a component the platform has never
 * probed says "no data" rather than showing a green bar.
 *
 * The component list lives entirely in the backend service — this page maps
 * whatever it is handed, in order, so adding or dropping a component needs no
 * change here.
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
  CheckCircle2, AlertTriangle, XCircle, MinusCircle, CircleDashed, RefreshCw,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { Btn, Callout, Card, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, type Tone } from '@/components/os/kit';

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
  nodata:       { color: '#e4e9e5', label: 'No data',       height: '12%',  Icon: CircleDashed },
};

const BANNER: Record<PlatformStatus['overall'], { text: string; tone: 'warn' | 'bad' | 'info' | undefined }> = {
  operational: { text: 'All systems operational', tone: undefined },
  degraded:    { text: 'Degraded performance',    tone: 'warn' },
  down:        { text: 'Service disruption',      tone: 'bad' },
  nodata:      { text: 'No checks recorded yet',  tone: 'info' },
};
const PILL_TONE: Record<ComponentState, Tone> = {
  operational: 'primary', degraded: 'amber', down: 'danger', unconfigured: 'neutral', nodata: 'outline',
};

/* ── Bits ── */

function StateChip({ state }: { state: ComponentState }) {
  const s = STATE[state];
  return (
    <Pill tone={PILL_TONE[state]} dot={false}>
      <s.Icon size={12} strokeWidth={2.4} aria-hidden style={{ marginRight: 4, verticalAlign: '-2px' }} />
      {s.label}
    </Pill>
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
                        bg-[#14201a] text-white text-[11px] rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg">
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

      <div className="flex justify-between text-[10px] text-[#8a948d] mt-1.5">
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
        <span key={s} className="flex items-end gap-1.5 text-[11px] text-[#5f6b63]">
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
    // Deferred a tick so no setState runs synchronously in the effect body.
    const first = setTimeout(() => void load(ac.signal), 0);
    // The cron writes every five minutes; refresh on the same cadence so a page
    // left open on a wall display never goes stale.
    const t = setInterval(() => void load(), 5 * 60 * 1000);
    return () => { ac.abort(); clearTimeout(first); clearInterval(t); };
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

  const head = (
    <PageHead
      eyebrow="Admin › Platform"
      title="Platform status"
      lede={data
        ? <>Every dependency probed every {data.probeIntervalMinutes} minutes · last check {relative(lastCheck(data))}. Nothing here is inferred — a component never probed says “no data”.</>
        : 'Live probe results for the platform’s external dependencies, with 90 days of daily history.'}
      actions={<Btn size="sm" variant="primary" onClick={probeNow} disabled={probing}>
        <RefreshCw size={13} className={probing ? 'animate-spin' : ''} aria-hidden /> {probing ? 'Checking…' : 'Run checks now'}
      </Btn>}
    />
  );

  if (error && !data) {
    return (
      <OsPage>
        {head}
        <Callout tone="bad" title="Could not load platform status:">
          {error} <Btn size="xs" onClick={() => void load()}>Try again</Btn>
        </Callout>
      </OsPage>
    );
  }

  if (!data) {
    return (
      <OsPage>
        {head}
        <div aria-busy="true" style={{ display: 'grid', gap: 12 }}>
          <div className="gx-skel" style={{ height: 64, borderRadius: 12 }} />
          {[...Array(5)].map((_, i) => <div key={i} className="gx-skel" style={{ height: 110, borderRadius: 12 }} />)}
        </div>
      </OsPage>
    );
  }

  const banner = BANNER[data.overall];
  const unhealthy = data.components.filter(
    (c) => c.status === 'degraded' || c.status === 'down',
  );

  return (
    <OsPage>
      {head}
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Platform' },
        { label: 'Window', value: `${data.windowDays} days` },
        { label: 'Generated', value: new Date(data.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }) },
      ]} />

      {error && <div style={{ marginBottom: 14 }}><Callout tone="bad" title="Last refresh failed:">{error}</Callout></div>}

      <div style={{ marginBottom: 14 }}>
        <Callout tone={banner.tone} title={`${banner.text}.`}>
          {unhealthy.length > 0
            ? `Affected: ${unhealthy.map((c) => c.label).join(', ')}`
            : `${data.components.length} components monitored`}
        </Callout>
      </div>

      <Kpis>
        <Kpi k="Overall" v={STATE[data.overall === 'nodata' ? 'nodata' : data.overall].label} dark={data.overall === 'down'} />
        <Kpi k="Components" v={data.components.length} d="monitored" />
        <Kpi k="Unhealthy" v={unhealthy.length} d="degraded or down" />
        <Kpi k="Last check" v={relative(lastCheck(data))} d={`every ${data.probeIntervalMinutes} min`} />
      </Kpis>

      <div style={{ display: 'grid', gap: 12 }}>
        {data.components.map((c) => (
          <Card
            key={c.key}
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {c.label} <StateChip state={c.status} />
              {c.latencyMs != null && c.status !== 'unconfigured' && <span className="sub" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.latencyMs} ms</span>}
            </span>}
            sub={<>{c.impact}{c.detail && c.status !== 'operational' && <span style={{ display: 'block', color: '#8a6100', marginTop: 2 }}>{c.detail}</span>}</>}
            right={<div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.uptimePct != null ? `${c.uptimePct}%` : '—'}</div>
              <div className="sub">{c.checks > 0 ? `${c.checks.toLocaleString()} checks · ${data.windowDays}d` : 'no checks yet'}</div>
            </div>}
            pad
          >
            <UptimeStrip
              days={c.days}
              hovered={hover?.key === c.key ? hover.day : null}
              onHover={(d) => setHover(d ? { key: c.key, day: d } : null)}
            />
          </Card>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <Card title="How to read this" right={<Legend />} pad>
          <Callout tone="info">
            A day is a Dubai calendar day and takes the colour of the worst result recorded that
            day; the percentage beside each component is the share of all probes in the window that
            came back clean. Bar height repeats severity so the strip reads without colour.
            A component with no credentials on this environment reports <b>Not configured</b> and is
            left out of the uptime figure entirely — an absent key is not an outage. Probes are
            read-only and free: no mail is sent, no image is processed, no tokens are spent.
          </Callout>
        </Card>
      </div>
    </OsPage>
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
