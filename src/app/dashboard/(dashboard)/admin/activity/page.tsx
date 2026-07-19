/**
 * Admin — Activity Board (dashboard/admin/activity)
 *
 * Live operations board: platform-wide activity for a selectable Dubai-date
 * range (presets + custom From/To — the date filter drives EVERY windowed
 * figure), plus the raw audit-log feed grouped/filterable by role.
 * Point-in-time tiles (active tenancies, overdue, KYC…) always reflect now.
 * Amounts are WHOLE AED. Data: /admin/activity/board + /admin/activity/feed,
 * auto-refreshed every 60s while the range includes today.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart2, Loader2, RefreshCw } from 'lucide-react';
import { apiGet } from '@/lib/api';

/* ── Types (board payload) ── */
interface SeriesPoint { d: string; v: number; n?: number }
interface Board {
  range: { from: string; to: string };
  generatedAt: string;
  listings: {
    total: number; visitors: number;
    top: { unit_id: number; unit: string; property: string; views: number; visitors: number; leads: number }[];
  };
  usage: {
    pageViews: { total: number; users: number };
    actions: { total: number; users: number };
    logins: { total: number; users: number };
    activeUsers: number;
  };
  payments: {
    count: number; aed: number; cleared_count: number; cleared_aed: number;
    methodMix: { method: string; count: number; aed: number }[];
    typeMix: { type: string; count: number; aed: number }[];
    now: {
      overdue_count: number; overdue_aed: number; due30_count: number; due30_aed: number;
      deposits_count: number; deposits_aed: number; bounced_count: number; bounced_aed: number;
    };
  };
  leasing: {
    signatures: { online: number; online_contracts: number; on_file: number };
    activeTenancies: number;
    expiries: { d30: number; d60: number; d90: number };
    renewals: { status: string; count: number }[];
    contractsCreated: number;
    terminationRequests: number;
    addendums: number;
    settlementPayments: { count: number; aed: number };
  };
  operations: {
    documentsUploaded: number;
    verificationEvents: { action: string; count: number }[];
    notificationsSent: number;
    links: { created: number; used: number };
    linkPurposes: { purpose: string; created: number; used: number }[];
    inspections: {
      move_in_submitted: number; move_out_submitted: number;
      move_in_in_progress: number; move_out_in_progress: number;
    };
    kyc: { status: string; count: number }[];
    amc: { done: number; total: number };
    maintenanceRequests: number;
  };
  marketplace: {
    providers: number; job_ready: number; categories: number; templates: number;
    listings: number; bookings: number; quotes: number;
    leads: number; leads_converted: number; viewings: number; viewings_upcoming: number;
  };
  entities: {
    rp_total: number; rp_added: number;
    properties_total: number; properties_added: number;
    units_total: number; units_added: number;
    managers_total: number; managers_added: number;
    technicians_total: number; technicians_added: number;
    sp_total: number; sp_added: number; sp_job_ready: number;
    rentals_active: number; rentals_active_at_start: number;
    rentals_started: number; rentals_ended: number;
  };
  services: {
    topCategories: { name: string; bookings: number; aed: number }[];
    topProviders: { name: string; bookings: number; aed: number }[];
    topTechnicians: { name: string; jobs: number; completed: number }[];
  };
  executive: {
    units_total: number; units_occupied: number;
    arr_aed: number;
    cleared_to_date_aed: number; due_to_date_aed: number;
    ended_total: number; ended_renewed: number;
    renewal_uplift_pct: number | null;
    rentTrend: { d: string; v: number; n: number }[];
    expiryForecast: { d: string; v: number }[];
    topAreas: { area: string; active: number; arr: number }[];
  };
  series: { actions: SeriesPoint[]; pageViews: SeriesPoint[]; moneyAed: SeriesPoint[] };
  roleActivity: { role: string; action_key: string; count: number }[];
  topActors: { id: number; name: string; email: string; role: string; views: number; actions: number; last_seen: string }[];
  topPages: { page: string; portal: string; views: number }[];
}
interface FeedItem {
  id: string; createdAt: string; actionKey: string; entityType: string | null;
  entityId: number | null; role: string; actor: string; email: string | null;
  actorUserId: number | null;
}

/** Admin detail routes per audit entity type; null → click filters the feed instead. */
function entityHref(entityType: string | null, entityId: number | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'user': return `/dashboard/admin/users/${entityId}`;
    case 'unit': return `/dashboard/admin/units/${entityId}`;
    case 'property': return `/dashboard/admin/properties/${entityId}`;
    case 'rental_provider': return '/dashboard/admin/listings/rental-providers';
    default: return null;
  }
}
interface FeedResp { total: number; limit: number; offset: number; items: FeedItem[] }

type BreakdownRow = Record<string, string | number | boolean | null>;
interface Breakdown {
  kind: string;
  rows?: BreakdownRow[];
  byArea?: BreakdownRow[];
  byProperty?: BreakdownRow[];
  commenced?: BreakdownRow[];
  ended?: BreakdownRow[];
}
const BREAKDOWN_META: Record<string, { title: string; href?: string }> = {
  properties: { title: 'All properties', href: '/dashboard/admin/properties' },
  units: { title: 'Units by property', href: '/dashboard/admin/units' },
  rental_providers: { title: 'Rental Providers', href: '/dashboard/admin/listings/rental-providers' },
  rentals: { title: 'Active leases breakdown' },
  managers: { title: 'Managers' },
  service_providers: { title: 'Service Providers', href: '/dashboard/admin/listings/service-providers' },
  technicians: { title: 'Technicians' },
};

/* ── Label maps ── */
const ACTION_LABELS: Record<string, string> = {
  'contract.receipt_issue': 'Payment receipt issued',
  'contract.payment.update': 'Payment status updated',
  'contract.plan_ref_issue': 'Payment-plan reference issued',
  'rp.document.uploadurl': 'Document upload started',
  'contract.update': 'Contract updated',
  'contract.activated': 'Contract activated',
  'contract.inspection.update': 'Move-in inspection updated',
  'rp.document.create': 'Document record created',
  'auth.login': 'Logged in',
  'contract.termination.direct': 'Direct termination started',
  'contract.terminated': 'Contract terminated',
  'contract.renewal.draft': 'Renewal drafted',
  'rp.document.verify': 'Document verified',
  'contract.pdc.confirm': 'Post-dated cheque confirmed',
  'contract.renewal.accept': 'Renewal accepted',
  'contract.addendum.attach-layout': 'Addendum attached',
  'contract.renewal.send': 'Renewal offer sent',
  'contract.inspection.moveout.update': 'Move-out inspection updated',
  'rp.settings.update': 'Settings updated',
  'contract.tenant.cheques.submit': 'Customer cheques submitted',
  'portal.contract.sign': 'Contract signed via secure link',
  'contract.signed_on_file': 'Signature recorded on file',
  'contract.payment.add': 'Payment added',
  'contract.inspection.reopen': 'Inspection reopened',
  'manager.unit.update': 'Unit updated',
  'contract.ejari.markregistered': 'Contract Registration marked done',
  'contract.ejari.update': 'Contract Registration updated',
  'lead.transition': 'Lead stage changed',
  'contract.renewal.propose': 'Renewal proposed',
  'rental_provider.compliance_update': 'Compliance updated',
  'contract.cheques.markonfile': 'Cheques marked on file',
  'rp.document.reject': 'Document rejected',
  'manager.deleted': 'Manager removed',
  'contract.inspection.sign': 'Inspection signed',
  'contract.superseded': 'Contract superseded',
  'contract.cancelled': 'Contract cancelled',
  'contract.termination.cancelled': 'Termination cancelled',
  'portal.inspection.sign': 'Inspection signed via secure link',
  'rp.document.update': 'Document updated',
  'audit.reattributed': 'Audit record re-attributed',
};
const ENTITY_LABELS: Record<string, string> = {
  tenancy_contract: 'Contract', contract_payment_refs: 'Payment ref', document: 'Document',
  payment: 'Payment', user: 'User', rental_provider: 'Rental Provider', unit: 'Unit',
  lead: 'Lead', audit_logs: 'Audit record',
};
const ROLE_META: Record<string, { tag: string; label: string; chip: string }> = {
  manager: { tag: 'MGR', label: 'Manager', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  rental_provider: { tag: 'RP', label: 'Rental Provider', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
  customer: { tag: 'CUST', label: 'Customer', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  service_provider: { tag: 'SP', label: 'Service Provider', chip: 'bg-pink-50 text-pink-700 border-pink-200' },
  super_admin: { tag: 'ADMIN', label: 'Internal', chip: 'bg-gray-100 text-gray-600 border-gray-300' },
  tenant: { tag: 'CUST', label: 'Customer', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};
const ROLE_ORDER = ['manager', 'rental_provider', 'customer', 'service_provider', 'super_admin'];

/** Friendly page names for the Top Pages panel (paths are pre-normalized with :id). */
const PAGE_NAMES: [RegExp, string][] = [
  [/\/(dashboard\/manager|rental-provider\/dashboard)$/, 'Dashboard home'],
  [/contracts\/:id\/inspection/, 'Inspection'],
  [/contracts\/:id/, 'Contract detail'],
  [/contracts\/ended/, 'Ended leases'],
  [/contracts$/, 'Contracts list'],
  [/operations\/:id/, 'Operation detail'],
  [/operations$/, 'Operations pipeline'],
  [/tenants\/:id|customers\/:id/, 'Customer detail'],
  [/tenants$|customers$/, 'Customers list'],
  [/units\/:id/, 'Unit detail'],
  [/units$/, 'Units list'],
  [/properties\/:id|portfolio\/:id/, 'Property detail'],
  [/properties$|portfolio$/, 'Properties list'],
  [/reports/, 'Reports hub'],
  [/orders\/:id/, 'Order detail'],
  [/orders/, 'Orders'],
  [/leads\/:id/, 'Lead detail'],
  [/leads/, 'Leads'],
  [/payments|collections/, 'Payments'],
  [/settings/, 'Settings'],
  [/documents/, 'Documents'],
  [/notifications/, 'Notifications'],
];
function pageName(path: string): string {
  for (const [re, label] of PAGE_NAMES) if (re.test(path)) return label;
  const tail = path.split('/').filter((s) => s && s !== ':id').slice(-2).join(' · ');
  return tail ? tail.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : path;
}
const portalTag = (portal: string) =>
  portal === 'manager' ? 'MGR' : portal === 'rental_provider' || portal === 'rp' ? 'RP' : portal.toUpperCase();

/* ── Date helpers (Dubai) ── */
const dubaiFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
});
const dubaiToday = () => dubaiFmt.format(new Date());
const dubaiDaysAgo = (n: number) => dubaiFmt.format(new Date(Date.now() - n * 86_400_000));
const dubaiMonthStart = () => `${dubaiToday().slice(0, 8)}01`;

const PRESETS: { key: string; label: string; from: () => string }[] = [
  { key: 'today', label: 'Today', from: () => dubaiToday() },
  { key: '7d', label: '7D', from: () => dubaiDaysAgo(6) },
  { key: '30d', label: '30D', from: () => dubaiDaysAgo(29) },
  { key: '90d', label: '90D', from: () => dubaiDaysAgo(89) },
  { key: 'mtd', label: 'This month', from: () => dubaiMonthStart() },
  { key: 'all', label: 'All', from: () => '2023-01-01' },
];

/* ── Formatting ── */
const fmtN = (v: number) => v.toLocaleString('en-US');
function fmtAED(v: number): string {
  if (v >= 1_000_000) return `AED ${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `AED ${Math.round(v / 1000)}K`;
  if (v >= 1_000) return `AED ${Math.round(v / 100) / 10}K`;
  return `AED ${Math.round(v)}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const monthYearLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`;
const quarterLabel = (iso: string) => `Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1} ${iso.slice(2, 4)}`;
const feedTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

/* ── Tiny SVG bar chart (bars + optional overlay line, hover tooltip) ── */
function BarChart({
  bars, line, height = 200, width = 900, color = '#2a78d6', lineColor = '#0a8754', yFmt, tipFmt, xLabel, tipExtra,
}: {
  bars: SeriesPoint[];
  line?: Map<string, number>;
  height?: number;
  width?: number;
  color?: string;
  lineColor?: string;
  yFmt?: (v: number) => string;
  tipFmt?: (v: number) => string;
  xLabel?: (d: string) => string;
  tipExtra?: (d: string) => string;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const W = width, H = height, padL = 48, padR = 8, padT = 16, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const lineVals = line ? Array.from(line.values()) : [];
  const rawMax = Math.max(1, ...bars.map((b) => b.v), ...lineVals);
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const nn = rawMax / pow;
  const max = (nn <= 1 ? 1 : nn <= 2 ? 2 : nn <= 2.5 ? 2.5 : nn <= 5 ? 5 : 10) * pow;
  const n = bars.length, slot = iw / Math.max(n, 1), bw = Math.max(3, Math.min(slot - 3, 22));
  const fmt = tipFmt ?? fmtN;
  const linePts = line
    ? bars.map((b, i) => (line.has(b.d) ? [padL + i * slot + slot / 2, padT + ih - (line.get(b.d)! / max) * ih, line.get(b.d)!] : null)).filter(Boolean) as [number, number, number][]
    : [];
  const peak = bars.reduce((m, b, i) => (b.v > bars[m].v ? i : m), 0);
  const tickIdx = n <= 1 ? [0] : n <= 8 ? bars.map((_, i) => i) : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} y1={padT + ih - f * ih} x2={W - padR} y2={padT + ih - f * ih}
              stroke={f === 0 ? '#d4d2cc' : '#eceae5'} strokeWidth={1} />
            <text x={padL - 7} y={padT + ih - f * ih + 4} textAnchor="end" fontSize={10.5} fill="#9b9890" className="font-mono">
              {(yFmt ?? fmtN)(Math.round(max * f))}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const h = (b.v / max) * ih;
          const x = padL + i * slot + (slot - bw) / 2;
          return (
            <rect key={b.d} x={x} y={padT + ih - h} width={bw} height={Math.max(h, b.v > 0 ? 1.5 : 0)} rx={2}
              fill={color} opacity={0.9} />
          );
        })}
        {bars[peak] && bars[peak].v > 0 && (
          <text x={Math.min(padL + peak * slot + slot / 2, W - 30)} y={padT + ih - (bars[peak].v / max) * ih - 5}
            textAnchor="middle" fontSize={10} fontWeight={700} fill="#6b6963" className="font-mono">
            {fmt(bars[peak].v)}
          </text>
        )}
        {linePts.length > 1 && (
          <polyline points={linePts.map((p) => `${p[0]},${p[1]}`).join(' ')} fill="none"
            stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {linePts.length > 0 && (
          <circle cx={linePts[linePts.length - 1][0]} cy={linePts[linePts.length - 1][1]} r={3.5}
            fill={lineColor} stroke="#fff" strokeWidth={2} />
        )}
        {tickIdx.map((i) => bars[i] && (
          <text key={i} x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#9b9890" className="font-mono">
            {(xLabel ?? dayLabel)(bars[i].d)}
          </text>
        ))}
        <rect x={padL} y={padT} width={iw} height={ih} fill="transparent"
          onMouseMove={(e) => {
            const box = (e.target as SVGRectElement).ownerSVGElement!.getBoundingClientRect();
            const mx = ((e.clientX - box.left) / box.width) * W;
            const i = Math.max(0, Math.min(n - 1, Math.floor((mx - padL) / slot)));
            const b = bars[i];
            if (!b) return;
            let text = `${(xLabel ?? dayLabel)(b.d)} · ${fmt(b.v)}`;
            if (line?.has(b.d)) text += ` · ${fmtN(line.get(b.d)!)} views`;
            if (tipExtra) text += ` · ${tipExtra(b.d)}`;
            setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text });
          }}
          onMouseLeave={() => setTip(null)} />
      </svg>
      {tip && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-[#1a1916] px-2 py-1 font-mono text-[11px] font-semibold text-white"
          style={{ left: tip.x, top: tip.y - 8 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

/* ── Page ── */
export default function AdminActivityPage() {
  const today = dubaiToday();
  const [preset, setPreset] = useState('30d');
  const [from, setFrom] = useState(dubaiDaysAgo(29));
  const [to, setTo] = useState(today);
  const [board, setBoard] = useState<Board | null>(null);
  const [feed, setFeed] = useState<FeedResp | null>(null);
  const [feedRole, setFeedRole] = useState('');
  const [feedQ, setFeedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [liveOn, setLiveOn] = useState(true);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [breakdownKind, setBreakdownKind] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const qDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveBusy = useRef(false);

  const openBreakdown = useCallback(async (kind: string, f: string, t: string) => {
    if (breakdownKind === kind) { setBreakdownKind(null); setBreakdown(null); return; }
    setBreakdownKind(kind);
    setBreakdown(null);
    setBreakdownLoading(true);
    const b = await apiGet<Breakdown>(`/admin/activity/breakdown?kind=${kind}&from=${f}&to=${t}`).catch(() => null);
    setBreakdown(b);
    setBreakdownLoading(false);
  }, [breakdownKind]);

  const loadBoard = useCallback(async (f: string, t: string) => {
    const b = await apiGet<Board>(`/admin/activity/board?from=${f}&to=${t}`).catch(() => null);
    if (b) setBoard(b);
  }, []);

  const loadFeed = useCallback(async (f: string, t: string, role: string, q: string, offset = 0, append = false) => {
    setFeedLoading(true);
    const params = new URLSearchParams({ from: f, to: t, limit: '300', offset: String(offset) });
    if (role) params.set('role', role);
    if (q) params.set('q', q);
    const r = await apiGet<FeedResp>(`/admin/activity/feed?${params}`).catch(() => null);
    if (r) setFeed((prev) => (append && prev ? { ...r, items: [...prev.items, ...r.items] } : r));
    setFeedLoading(false);
  }, []);

  const refresh = useCallback(async (f = from, t = to) => {
    await Promise.all([loadBoard(f, t), loadFeed(f, t, feedRole, feedQ)]);
    setRefreshedAt(new Date());
    setLoading(false);
  }, [from, to, feedRole, feedQ, loadBoard, loadFeed]);

  useEffect(() => { setLoading(true); void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  /* LIVE mode: 5s incremental feed poll (only new events by id) + 60s board refresh */
  const liveTick = useCallback(async () => {
    if (liveBusy.current) return;
    liveBusy.current = true;
    try {
      const newestId = feed?.items[0]?.id;
      if (!newestId) return;
      const params = new URLSearchParams({ from, to, limit: '100', offset: '0', sinceId: newestId });
      if (feedRole) params.set('role', feedRole);
      if (feedQ) params.set('q', feedQ);
      const r = await apiGet<FeedResp>(`/admin/activity/feed?${params}`).catch(() => null);
      if (r && r.items.length > 0) {
        setFeed((prev) => {
          if (!prev) return r;
          const known = new Set(prev.items.map((i) => i.id));
          const fresh = r.items.filter((i) => !known.has(i.id));
          if (fresh.length === 0) return prev;
          setFreshIds(new Set(fresh.map((i) => i.id)));
          setTimeout(() => setFreshIds(new Set()), 1600);
          // r.total counts only events past sinceId — grow the window total instead
          return { ...prev, total: prev.total + fresh.length, items: [...fresh, ...prev.items] };
        });
        setRefreshedAt(new Date());
      }
    } finally {
      liveBusy.current = false;
    }
  }, [feed, from, to, feedRole, feedQ]);

  useEffect(() => {
    if (!liveOn || to < dubaiToday()) return;
    const fast = setInterval(() => { void liveTick(); }, 5_000);
    const slow = setInterval(() => { void loadBoard(from, to).then(() => setRefreshedAt(new Date())); }, 60_000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, [liveOn, to, from, liveTick, loadBoard]);

  /* feed filters (server-side) */
  useEffect(() => { void loadFeed(from, to, feedRole, feedQ); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [feedRole]);
  const onSearch = (v: string) => {
    setFeedQ(v);
    if (qDebounce.current) clearTimeout(qDebounce.current);
    qDebounce.current = setTimeout(() => void loadFeed(from, to, feedRole, v), 350);
  };

  const applyPreset = (key: string) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPreset(key);
    setFrom(p.from());
    setTo(dubaiToday());
  };

  /* click-through: focus the feed on a role/action/entity */
  const filterFeed = (role: string, q: string) => {
    setFeedRole(role);
    setFeedQ(q);
    void loadFeed(from, to, role, q);
  };

  /* derived */
  const filledSeries = useMemo(() => {
    if (!board) return { actions: [] as SeriesPoint[], money: [] as SeriesPoint[], viewsMap: new Map<string, number>() };
    const days: string[] = [];
    const start = new Date(`${board.range.from}T00:00:00Z`);
    const end = new Date(`${board.range.to}T00:00:00Z`);
    for (let d = start; d <= end && days.length < 400; d = new Date(d.getTime() + 86_400_000))
      days.push(d.toISOString().slice(0, 10));
    const cap = days.length > 92 ? days.slice(days.length - 92) : days; // chart caps at ~3 months of daily bars
    const aMap = new Map(board.series.actions.map((p) => [p.d, p.v]));
    const mMap = new Map(board.series.moneyAed.map((p) => [p.d, p.v]));
    return {
      actions: cap.map((d) => ({ d, v: aMap.get(d) ?? 0 })),
      money: cap.map((d) => ({ d, v: mMap.get(d) ?? 0 })),
      viewsMap: new Map(board.series.pageViews.map((p) => [p.d, p.v])),
    };
  }, [board]);

  const roleCards = useMemo(() => {
    if (!board) return [];
    const by = new Map<string, { total: number; acts: { key: string; count: number }[] }>();
    for (const r of board.roleActivity) {
      const k = r.role === 'tenant' ? 'customer' : r.role;
      if (!by.has(k)) by.set(k, { total: 0, acts: [] });
      const e = by.get(k)!;
      e.total += r.count;
      e.acts.push({ key: r.action_key, count: r.count });
    }
    return ROLE_ORDER.filter((r) => by.has(r)).map((r) => ({ role: r, ...by.get(r)! }))
      .concat(Array.from(by.keys()).filter((k) => !ROLE_ORDER.includes(k)).map((r) => ({ role: r, ...by.get(r)! })));
  }, [board]);

  const kycCounts = useMemo(() => {
    const m = new Map((board?.operations.kyc ?? []).map((k) => [k.status, k.count]));
    return { verified: m.get('verified') ?? 0, pending: m.get('pending_review') ?? m.get('pending') ?? 0, unverified: m.get('unverified') ?? 0 };
  }, [board]);

  const renewalCounts = useMemo(() => {
    const m = new Map((board?.leasing.renewals ?? []).map((r) => [r.status, r.count]));
    return { accepted: m.get('accepted') ?? 0, proposed: m.get('proposed') ?? 0, draft: m.get('draft') ?? 0 };
  }, [board]);

  const methodTotal = useMemo(
    () => (board?.payments.methodMix ?? []).reduce((s, m) => s + m.aed, 0) || 1,
    [board],
  );

  /* different raw paths can share a friendly name — aggregate by (name, portal) */
  const topPagesNamed = useMemo(() => {
    const agg = new Map<string, { name: string; portal: string; views: number; paths: string[] }>();
    for (const p of board?.topPages ?? []) {
      const name = pageName(p.page);
      const key = `${p.portal}|${name}`;
      const e = agg.get(key) ?? { name, portal: p.portal, views: 0, paths: [] };
      e.views += p.views;
      e.paths.push(p.page);
      agg.set(key, e);
    }
    return Array.from(agg.values()).sort((a, b) => b.views - a.views);
  }, [board]);
  const METHOD_COLORS = ['#2a78d6', '#1baf7a', '#4a3aa7', '#c98500', '#c2467c', '#6b6963'];

  if (loading || !board) {
    return (
      <div className="flex h-64 items-center justify-center text-[#9b9890]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading activity…
      </div>
    );
  }

  const rangeLabel = `${dayLabel(board.range.from)} – ${dayLabel(board.range.to)}`;
  const live = to >= today;

  return (
    <div className="space-y-4">
      {/* header + DATE FILTER */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-[#1a1916]">Activity</h1>
        <button
          onClick={() => {
            if (liveOn && live) { setLiveOn(false); return; }
            if (to < today) { setPreset('30d'); setFrom(dubaiDaysAgo(29)); setTo(today); }
            setLiveOn(true);
          }}
          title={liveOn && live ? 'Live updates on — pause to pick a historical period' : 'Return to live view'}
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest ${liveOn && live ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#d4d2cc] bg-[#f7f5f0] text-[#6b6963] hover:border-[#b8b6b0]'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${liveOn && live ? 'animate-pulse bg-emerald-500' : 'bg-[#c4c2bc]'}`} />
          {liveOn && live ? 'LIVE · 5s' : 'GO LIVE'}
        </button>
        <span className="font-mono text-[11px] text-[#9b9890]">
          {rangeLabel}{refreshedAt ? ` · refreshed ${refreshedAt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })}` : ''}
          {liveOn && live ? ' · pause to change period' : ''}
        </span>
        <Link href="/dashboard/admin/analytics"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#2a78d6] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#1c5cab]">
          <BarChart2 className="h-3.5 w-3.5" /> Analytics dashboard
        </Link>
        <button onClick={() => void refresh()} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e8e6e0] bg-white px-2.5 py-1 text-[12px] text-[#6b6963] hover:border-[#d4d2cc]">
          <RefreshCw className={`h-3.5 w-3.5 ${feedLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {!(liveOn && live) && (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#e8e6e0] bg-white px-3 py-2.5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#9b9890]">Period</span>
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => applyPreset(p.key)}
            className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold ${preset === p.key ? 'bg-[#1a1916] text-white' : 'border border-[#e8e6e0] text-[#6b6963] hover:border-[#d4d2cc]'}`}>
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[#e8e6e0]" />
        <input type="date" value={from} max={to}
          onChange={(e) => { if (e.target.value) { setPreset('custom'); setFrom(e.target.value); } }}
          className="rounded-lg border border-[#e8e6e0] px-2 py-1 font-mono text-[11.5px] text-[#1a1916]" />
        <span className="text-[11px] text-[#9b9890]">→</span>
        <input type="date" value={to} min={from} max={today}
          onChange={(e) => { if (e.target.value) { setPreset('custom'); setTo(e.target.value); } }}
          className="rounded-lg border border-[#e8e6e0] px-2 py-1 font-mono text-[11.5px] text-[#1a1916]" />
      </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ══ MAIN COLUMN ══ */}
        <div className="min-w-0 space-y-4">
          {/* entity cards — who/what grew this period; click for the breakdown */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {([
              { k: 'properties', l: 'Properties', v: board.entities.properties_total, net: board.entities.properties_added, sub: board.entities.properties_added > 0 ? `+${fmtN(board.entities.properties_added)} this period` : 'no change this period' },
              { k: 'units', l: 'Units', v: board.entities.units_total, net: board.entities.units_added, sub: board.entities.units_added > 0 ? `+${fmtN(board.entities.units_added)} this period` : 'no change this period' },
              { k: 'rental_providers', l: 'Rental Providers', v: board.entities.rp_total, net: board.entities.rp_added, sub: board.entities.rp_added > 0 ? `+${fmtN(board.entities.rp_added)} this period` : 'no change this period' },
              {
                k: 'rentals', l: 'Active Leases', v: board.entities.rentals_active,
                net: board.entities.rentals_active - board.entities.rentals_active_at_start,
                sub: `${board.entities.rentals_started} commenced · ${board.entities.rentals_ended} ended`,
              },
              { k: 'managers', l: 'Managers', v: board.entities.managers_total, net: board.entities.managers_added, sub: board.entities.managers_added > 0 ? `+${fmtN(board.entities.managers_added)} this period` : 'no change this period' },
              { k: 'service_providers', l: 'Service Providers', v: board.entities.sp_total, net: board.entities.sp_added, sub: `${board.entities.sp_job_ready} job-ready` },
              { k: 'technicians', l: 'Technicians', v: board.entities.technicians_total, net: board.entities.technicians_added, sub: board.entities.technicians_added > 0 ? `+${fmtN(board.entities.technicians_added)} this period` : 'no change this period' },
            ] as { k: string; l: string; v: number; net: number; sub: string }[]).map((c) => (
              <button key={c.k} onClick={() => void openBreakdown(c.k, from, to)}
                title={`View ${c.l.toLowerCase()} breakdown`}
                className={`rounded-2xl border bg-white px-3.5 py-3 text-left transition-colors hover:border-[#2a78d6] ${breakdownKind === c.k ? 'border-[#2a78d6] ring-1 ring-[#2a78d6]' : 'border-[#e8e6e0]'}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">{c.l}</div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xl font-bold text-[#1a1916]">{fmtN(c.v)}</span>
                  {c.net !== 0 ? (
                    <span className={`font-mono text-[11px] font-bold ${c.net > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {c.net > 0 ? '▲' : '▼'} {c.net > 0 ? '+' : ''}{fmtN(c.net)}
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-[#c4c2bc]">—</span>
                  )}
                </div>
                <div className="font-mono text-[10.5px] text-[#9b9890]">{c.sub}</div>
              </button>
            ))}
          </div>

          {/* breakdown drill-down */}
          {breakdownKind && (
            <div className="rounded-2xl border border-[#2a78d6]/40 bg-white p-4">
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#1a1916]">
                  {BREAKDOWN_META[breakdownKind]?.title ?? breakdownKind}
                </h2>
                {BREAKDOWN_META[breakdownKind]?.href && (
                  <Link href={BREAKDOWN_META[breakdownKind].href!} className="text-[11.5px] font-semibold text-[#2a78d6] hover:underline">
                    Open full page ↗
                  </Link>
                )}
                <button onClick={() => { setBreakdownKind(null); setBreakdown(null); }}
                  className="ml-auto rounded-lg border border-[#e8e6e0] px-2 py-0.5 text-[11px] text-[#6b6963] hover:border-[#d4d2cc]">
                  Close ✕
                </button>
              </div>
              {breakdownLoading && (
                <div className="flex h-24 items-center justify-center text-[#9b9890]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                </div>
              )}
              {!breakdownLoading && breakdown && (
                <div className="max-h-96 overflow-y-auto overscroll-contain">
                  {breakdown.kind === 'properties' && (
                    <table className="w-full text-[12.5px]">
                      <thead className="sticky top-0 bg-white"><tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                        <th className="py-1.5 pr-3 font-semibold">Property</th><th className="py-1.5 pr-3 font-semibold">Rental Provider</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Units</th><th className="py-1.5 pr-3 text-right font-semibold">Occupied</th>
                        <th className="py-1.5 text-right font-semibold">Added</th></tr></thead>
                      <tbody>{(breakdown.rows ?? []).map((r) => (
                        <tr key={String(r.id)} className="border-t border-[#f2f0eb]">
                          <td className="py-1.5 pr-3 font-medium text-[#1a1916]">{r.name}</td>
                          <td className="py-1.5 pr-3 text-[#6b6963]">{r.rp_name}</td>
                          <td className="py-1.5 pr-3 text-right font-mono font-bold">{fmtN(Number(r.units))}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmtN(Number(r.occupied))} <span className="text-[#9b9890]">({r.units ? Math.round((Number(r.occupied) / Number(r.units)) * 100) : 0}%)</span></td>
                          <td className="py-1.5 text-right font-mono text-[#9b9890]">{r.added}</td>
                        </tr>))}</tbody>
                    </table>
                  )}
                  {breakdown.kind === 'units' && (
                    <div className="space-y-2">
                      {(breakdown.rows ?? []).map((r) => (
                        <div key={String(r.property)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-[#f2f0eb] pb-2 last:border-0">
                          <span className="truncate text-[12.5px] font-medium text-[#1a1916]">{r.property}</span>
                          <span className="whitespace-nowrap font-mono text-[12px]">
                            <b>{fmtN(Number(r.units))}</b> units · <span className="text-emerald-700">{fmtN(Number(r.occupied))} occupied</span> · {fmtN(Number(r.available))} available · {fmtN(Number(r.listed))} listed
                          </span>
                          <div className="col-span-2 flex h-1.5 gap-0.5 overflow-hidden rounded">
                            <div style={{ flex: Math.max(Number(r.occupied), 0.01) }} className="bg-emerald-500" />
                            <div style={{ flex: Math.max(Number(r.available), 0.01) }} className="bg-[#e8e6e0]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {breakdown.kind === 'rental_providers' && (
                    <table className="w-full text-[12.5px]">
                      <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                        <th className="py-1.5 pr-3 font-semibold">Rental Provider</th><th className="py-1.5 pr-3 font-semibold">Compliance</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Properties</th><th className="py-1.5 pr-3 text-right font-semibold">Units</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Active leases</th><th className="py-1.5 text-right font-semibold">Annual rent</th></tr></thead>
                      <tbody>{(breakdown.rows ?? []).map((r) => (
                        <tr key={String(r.id)} className="border-t border-[#f2f0eb]">
                          <td className="py-1.5 pr-3 font-medium text-[#1a1916]">{r.name}</td>
                          <td className="py-1.5 pr-3 text-[#6b6963]">{String(r.compliance).replace(/_/g, ' ')}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmtN(Number(r.properties))}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmtN(Number(r.units))}</td>
                          <td className="py-1.5 pr-3 text-right font-mono font-bold">{fmtN(Number(r.active))}</td>
                          <td className="py-1.5 text-right font-mono font-bold">{fmtAED(Number(r.arr))}</td>
                        </tr>))}</tbody>
                    </table>
                  )}
                  {breakdown.kind === 'rentals' && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-1 text-[12px] font-semibold text-[#6b6963]">Active by area</h3>
                        {(breakdown.byArea ?? []).map((r) => (
                          <div key={String(r.area)} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                            <span className="truncate text-[#6b6963]">{r.area}</span>
                            <span className="whitespace-nowrap font-mono text-[12px] font-bold">{fmtN(Number(r.active))} · {fmtAED(Number(r.arr))}</span>
                          </div>))}
                      </div>
                      <div>
                        <h3 className="mb-1 text-[12px] font-semibold text-[#6b6963]">Active by property</h3>
                        {(breakdown.byProperty ?? []).map((r) => (
                          <div key={String(r.property)} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                            <span className="truncate text-[#6b6963]">{r.property}</span>
                            <span className="whitespace-nowrap font-mono text-[12px] font-bold">{fmtN(Number(r.active))} · {fmtAED(Number(r.arr))}</span>
                          </div>))}
                      </div>
                    </div>
                  )}
                  {breakdown.kind === 'managers' && (
                    <table className="w-full text-[12.5px]">
                      <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                        <th className="py-1.5 pr-3 font-semibold">Manager</th><th className="py-1.5 pr-3 font-semibold">Status</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Views (period)</th><th className="py-1.5 pr-3 text-right font-semibold">Actions</th>
                        <th className="py-1.5 text-right font-semibold">Last seen</th></tr></thead>
                      <tbody>{(breakdown.rows ?? []).map((r) => (
                        <tr key={String(r.id)} className="border-t border-[#f2f0eb]">
                          <td className="py-1.5 pr-3"><Link href={`/dashboard/admin/users/${r.id}`} className="font-medium text-[#1a1916] hover:text-[#2a78d6] hover:underline">{r.name}</Link></td>
                          <td className="py-1.5 pr-3 text-[#6b6963]">{r.status}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmtN(Number(r.views))}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmtN(Number(r.actions))}</td>
                          <td className="py-1.5 text-right font-mono text-[#9b9890]">{r.last_seen ?? '—'}</td>
                        </tr>))}</tbody>
                    </table>
                  )}
                  {breakdown.kind === 'service_providers' && (
                    <table className="w-full text-[12.5px]">
                      <thead className="sticky top-0 bg-white"><tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                        <th className="py-1.5 pr-3 font-semibold">Provider</th><th className="py-1.5 pr-3 font-semibold">Compliance</th>
                        <th className="py-1.5 pr-3 font-semibold">Job-ready</th><th className="py-1.5 pr-3 text-right font-semibold">Bookings (period)</th>
                        <th className="py-1.5 text-right font-semibold">Earnings</th></tr></thead>
                      <tbody>{(breakdown.rows ?? []).map((r) => (
                        <tr key={String(r.id)} className="border-t border-[#f2f0eb]">
                          <td className="py-1.5 pr-3 font-medium text-[#1a1916]">{r.name}</td>
                          <td className="py-1.5 pr-3 text-[#6b6963]">{String(r.compliance).replace(/_/g, ' ')}</td>
                          <td className="py-1.5 pr-3">{r.job_ready ? <span className="text-emerald-700">Yes</span> : <span className="text-[#9b9890]">No</span>}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmtN(Number(r.bookings))}</td>
                          <td className="py-1.5 text-right font-mono font-bold">{fmtAED(Number(r.aed))}</td>
                        </tr>))}</tbody>
                    </table>
                  )}
                  {breakdown.kind === 'technicians' && (
                    <table className="w-full text-[12.5px]">
                      <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
                        <th className="py-1.5 pr-3 font-semibold">Technician</th><th className="py-1.5 pr-3 font-semibold">Provider</th>
                        <th className="py-1.5 pr-3 font-semibold">Status</th><th className="py-1.5 pr-3 text-right font-semibold">Jobs (period)</th>
                        <th className="py-1.5 text-right font-semibold">Completed</th></tr></thead>
                      <tbody>{(breakdown.rows ?? []).map((r) => (
                        <tr key={String(r.id)} className="border-t border-[#f2f0eb]">
                          <td className="py-1.5 pr-3 font-medium text-[#1a1916]">{r.name}</td>
                          <td className="py-1.5 pr-3 text-[#6b6963]">{r.provider}</td>
                          <td className="py-1.5 pr-3 text-[#6b6963]">{r.status}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmtN(Number(r.jobs))}</td>
                          <td className="py-1.5 text-right font-mono">{fmtN(Number(r.completed))}</td>
                        </tr>))}</tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* executive lens — business health & where the market is heading */}
          <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Executive lens</h2>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(() => {
                const ex = board.executive;
                const occ = ex.units_total > 0 ? Math.round((ex.units_occupied / ex.units_total) * 100) : 0;
                const coll = ex.due_to_date_aed > 0 ? Math.round((ex.cleared_to_date_aed / ex.due_to_date_aed) * 100) : null;
                const ret = ex.ended_total > 0 ? Math.round((ex.ended_renewed / ex.ended_total) * 100) : null;
                const uplift = ex.renewal_uplift_pct;
                return [
                  { l: 'Occupancy (now)', v: `${occ}%`, s: `${fmtN(ex.units_occupied)} of ${fmtN(ex.units_total)} units`, good: occ >= 80 },
                  { l: 'Contracted annual rent', v: fmtAED(ex.arr_aed), s: 'active leases, whole AED', good: true },
                  { l: 'Collection rate (to date)', v: coll === null ? '—' : `${coll}%`, s: `${fmtAED(ex.cleared_to_date_aed)} cleared of ${fmtAED(ex.due_to_date_aed)} due`, good: (coll ?? 0) >= 85 },
                  { l: 'Renewal retention', v: ret === null ? '—' : `${ret}%`, s: uplift == null ? `${fmtN(ex.ended_renewed)} of ${fmtN(ex.ended_total)} ended leases renewed` : `rent change on renewal ${uplift >= 0 ? '+' : ''}${uplift.toFixed(1)}%`, good: (ret ?? 0) >= 50 },
                ].map((k) => (
                  <div key={k.l} className="rounded-xl border border-[#f2f0eb] bg-[#fafaf8] px-3.5 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">{k.l}</div>
                    <div className={`font-mono text-xl font-bold ${k.good ? 'text-[#1a1916]' : 'text-amber-700'}`}>{k.v}</div>
                    <div className="font-mono text-[10.5px] text-[#9b9890]">{k.s}</div>
                  </div>
                ));
              })()}
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="min-w-0">
                <h3 className="mb-1 text-[12px] font-semibold text-[#6b6963]">Market direction · avg annual rent of leases starting each quarter</h3>
                <BarChart bars={board.executive.rentTrend} height={190} width={560} color="#4a3aa7"
                  xLabel={quarterLabel} tipFmt={fmtAED}
                  yFmt={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))}
                  tipExtra={(d) => `${board.executive.rentTrend.find((r) => r.d === d)?.n ?? 0} leases`} />
              </div>
              <div className="min-w-0">
                <h3 className="mb-1 text-[12px] font-semibold text-[#6b6963]">Renewal workload ahead · active leases expiring per month</h3>
                <BarChart bars={board.executive.expiryForecast} height={190} width={560} color="#c98500" xLabel={monthYearLabel} />
              </div>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { l: 'Active users (period)', v: fmtN(board.usage.activeUsers), s: `${fmtN(board.usage.logins.total)} logins` },
              { l: 'Actions (period)', v: fmtN(board.usage.actions.total), s: `${board.usage.actions.users} actors` },
              { l: 'Page views (period)', v: fmtN(board.usage.pageViews.total), s: `${board.usage.pageViews.users} users · Mgr+RP portals` },
              { l: 'Overdue (now)', v: fmtAED(board.payments.now.overdue_aed), s: `${board.payments.now.overdue_count} payments past due`, alert: true },
            ].map((k) => (
              <div key={k.l} className={`rounded-2xl border bg-white px-4 py-3 ${k.alert ? 'border-red-300' : 'border-[#e8e6e0]'}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">{k.l}</div>
                <div className={`font-mono text-xl font-bold ${k.alert ? 'text-red-600' : 'text-[#1a1916]'}`}>{k.v}</div>
                <div className="font-mono text-[11px] text-[#9b9890]">{k.s}</div>
              </div>
            ))}
          </div>

          {/* activity chart */}
          <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Platform activity / day</h2>
              <span className="ml-auto flex gap-4 font-mono text-[11px] text-[#6b6963]">
                <span><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[#2a78d6]" />Actions</span>
                <span><span className="mr-1.5 mb-0.5 inline-block h-0.5 w-3.5 bg-[#0a8754]" />Page views</span>
              </span>
            </div>
            <BarChart bars={filledSeries.actions} line={filledSeries.viewsMap} />
          </div>

          {/* money */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Value recorded / day · AED</h2>
              <BarChart bars={filledSeries.money} height={180} width={560} color="#1baf7a"
                yFmt={(v) => (v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))}
                tipFmt={fmtAED} />
            </div>
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Money</h2>
              <div className="mb-1 flex h-4 gap-0.5 overflow-hidden rounded">
                {board.payments.methodMix.map((m, i) => (
                  <div key={m.method} title={`${m.method} · ${fmtAED(m.aed)} · ${Math.round((m.aed / methodTotal) * 100)}%`}
                    style={{ flex: Math.max(m.aed, 1), background: METHOD_COLORS[i % METHOD_COLORS.length] }} />
                ))}
              </div>
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[#6b6963]">
                {board.payments.methodMix.slice(0, 5).map((m, i) => (
                  <span key={m.method}>
                    <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: METHOD_COLORS[i % METHOD_COLORS.length] }} />
                    {m.method} <b className="font-mono text-[#1a1916]">{fmtAED(m.aed)}</b>
                  </span>
                ))}
              </div>
              {[
                ['Due next 30D (now)', `${board.payments.now.due30_count} · ${fmtAED(board.payments.now.due30_aed)}`, ''],
                ['Overdue (now)', `${board.payments.now.overdue_count} · ${fmtAED(board.payments.now.overdue_aed)}`, 'text-red-600'],
                ['Deposits held (now)', `${board.payments.now.deposits_count} · ${fmtAED(board.payments.now.deposits_aed)}`, ''],
                ['Bounced cheques (all time)', `${board.payments.now.bounced_count} · ${fmtAED(board.payments.now.bounced_aed)}`, ''],
                ['Settlement payouts (period)', `${board.leasing.settlementPayments.count} · ${fmtAED(board.leasing.settlementPayments.aed)}`, ''],
              ].map(([l, v, cls]) => (
                <div key={l} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="text-[#6b6963]">{l}</span>
                  <span className={`whitespace-nowrap text-right font-mono text-[12px] font-bold ${cls || 'text-[#1a1916]'}`}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* activity by role */}
          <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Activity by role · audit log</h2>
              <span className="ml-auto font-mono text-[11px] text-[#9b9890]">{fmtN(board.usage.actions.total)} events in period</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {roleCards.map((rc) => {
                const meta = ROLE_META[rc.role] ?? { tag: rc.role.toUpperCase(), label: rc.role, chip: 'bg-gray-100 text-gray-600 border-gray-300' };
                const top = rc.acts.slice(0, 6);
                const maxV = top[0]?.count ?? 1;
                const rest = rc.acts.slice(6).reduce((s, a) => s + a.count, 0);
                return (
                  <div key={rc.role} className="rounded-xl border border-[#f2f0eb] bg-[#fafaf8] p-3">
                    <div className="mb-2 flex items-baseline gap-2">
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-extrabold tracking-wider ${meta.chip}`}>{meta.tag}</span>
                      <span className="text-[13px] font-semibold text-[#1a1916]">{meta.label}</span>
                      <span className="ml-auto font-mono text-[15px] font-bold text-[#1a1916]">{fmtN(rc.total)}</span>
                    </div>
                    {top.map((a) => (
                      <button key={a.key} onClick={() => filterFeed(rc.role, a.key)}
                        title="Show these events in the feed"
                        className="block w-full py-0.5 text-left hover:opacity-70">
                        <div className="flex items-baseline justify-between gap-2 text-[12px]">
                          <span className="truncate text-[#6b6963]">{ACTION_LABELS[a.key] ?? a.key}</span>
                          <span className="font-mono text-[11px] font-bold text-[#1a1916]">{fmtN(a.count)}</span>
                        </div>
                        <div className="h-0.5 rounded bg-[#2a78d6] opacity-70" style={{ width: `${Math.max(3, (a.count / maxV) * 100)}%` }} />
                      </button>
                    ))}
                    {rc.acts.length > 6 && (
                      <div className="mt-1.5 font-mono text-[10px] text-[#9b9890]">+ {rc.acts.length - 6} more types · {fmtN(rest)} events</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* leasing / operations / pages */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Leasing</h2>
              {[
                ['Active tenancies (now)', fmtN(board.leasing.activeTenancies), ''],
                ['Expiries 30 / 60 / 90D', `${board.leasing.expiries.d30} / ${board.leasing.expiries.d60} / ${board.leasing.expiries.d90}`, 'text-amber-700'],
                ['Renewals acc / prop / draft', `${renewalCounts.accepted} / ${renewalCounts.proposed} / ${renewalCounts.draft}`, 'text-emerald-700'],
                ['New contracts (period)', fmtN(board.leasing.contractsCreated), ''],
                ['Signed online (period)', `${board.leasing.signatures.online} · on-file ${board.leasing.signatures.on_file}`, ''],
                ['Termination requests (period)', fmtN(board.leasing.terminationRequests), ''],
                ['Addendums (period)', fmtN(board.leasing.addendums), ''],
              ].map(([l, v, cls]) => (
                <div key={l as string} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="text-[#6b6963]">{l}</span>
                  <span className={`whitespace-nowrap text-right font-mono text-[12px] font-bold ${(cls as string) || 'text-[#1a1916]'}`}>{v}</span>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Operations</h2>
              {[
                ['Customer links sent → opened', `${board.operations.links.created} → ${board.operations.links.used}`, 'text-emerald-700'],
                ...board.operations.linkPurposes.slice(0, 3).map((p) => [`· ${p.purpose.replace(/_/g, ' ')}`, `${p.created} → ${p.used}`, 'text-[#9b9890]']),
                ['Documents uploaded', fmtN(board.operations.documentsUploaded), ''],
                ['Verification events', fmtN(board.operations.verificationEvents.reduce((s, e) => s + e.count, 0)), ''],
                ['Inspections submitted (MI/MO)', `${board.operations.inspections.move_in_submitted} / ${board.operations.inspections.move_out_submitted}`, ''],
                ['Inspections in progress (now)', fmtN(board.operations.inspections.move_in_in_progress + board.operations.inspections.move_out_in_progress), ''],
                ['Notifications sent (in-app)', fmtN(board.operations.notificationsSent), ''],
                ['KYC verified / review / none', `${kycCounts.verified} / ${kycCounts.pending} / ${kycCounts.unverified}`, kycCounts.verified === 0 ? 'text-amber-700' : ''],
              ].map(([l, v, cls], i) => (
                <div key={i} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="text-[#6b6963]">{l}</span>
                  <span className={`whitespace-nowrap text-right font-mono text-[12px] font-bold ${(cls as string) || 'text-[#1a1916]'}`}>{v}</span>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Top pages (period)</h2>
              {topPagesNamed.slice(0, 9).map((p) => (
                <div key={`${p.portal}-${p.name}`} className="flex items-baseline justify-between gap-2 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="truncate text-[#6b6963]" title={p.paths.join('\n')}>{p.name}
                    <span className="ml-1.5 rounded border border-[#e8e6e0] px-1 font-mono text-[9px] font-bold text-[#9b9890]">{portalTag(p.portal)}</span>
                  </span>
                  <span className="whitespace-nowrap font-mono text-[12px] font-bold text-[#1a1916]">{fmtN(p.views)}</span>
                </div>
              ))}
              {topPagesNamed.length === 0 && <div className="py-4 text-center text-[12px] text-[#9b9890]">No page views in this period</div>}
            </div>
          </div>

          {/* top areas + most-viewed listings + top actors */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Top Areas · by active rentals</h2>
              {board.executive.topAreas.map((a, i) => (
                <div key={a.area} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="truncate text-[#1a1916]">
                    <span className="mr-2 inline-block w-4 font-mono text-[10px] text-[#9b9890]">{i + 1}</span>{a.area}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[12px] font-bold text-[#1a1916]">
                    {fmtN(a.active)} <span className="font-normal text-[#9b9890]">· {fmtAED(a.arr)}</span>
                  </span>
                </div>
              ))}
              {board.executive.topAreas.length === 0 && (
                <div className="py-4 text-center text-[12px] text-[#9b9890]">No mapped areas yet</div>
              )}
            </div>
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Most-Viewed Listings · public</h2>
                <span className="ml-auto font-mono text-[10.5px] text-[#9b9890]">
                  {fmtN(board.listings.total)} views · {fmtN(board.listings.visitors)} visitors
                </span>
              </div>
              {board.listings.top.map((l, i) => (
                <div key={l.unit_id} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="truncate text-[#1a1916]">
                    <span className="mr-2 inline-block w-4 font-mono text-[10px] text-[#9b9890]">{i + 1}</span>
                    <Link href={`/listings/units/${l.unit_id}`} className="hover:text-[#2a78d6] hover:underline">{l.unit}</Link>
                    <span className="ml-1.5 text-[11px] text-[#9b9890]">{l.property}</span>
                  </span>
                  <span className="whitespace-nowrap font-mono text-[12px] font-bold text-[#1a1916]">
                    {fmtN(l.views)}
                    <span className="font-normal text-[#9b9890]"> · {fmtN(l.visitors)} vis</span>
                    {l.leads > 0
                      ? <span className="text-emerald-700"> · {fmtN(l.leads)} leads</span>
                      : <span className="text-amber-700"> · 0 leads</span>}
                  </span>
                </div>
              ))}
              {board.listings.top.length === 0 && (
                <div className="py-4 text-center text-[12px] text-[#9b9890]">No public listing views in this period — tracking is live from today</div>
              )}
            </div>
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Top actors (period)</h2>
                <span className="ml-auto font-mono text-[10px] text-[#9b9890]">views / actions · last seen</span>
              </div>
              {board.topActors.slice(0, 10).map((a, i) => {
                const meta = ROLE_META[a.role] ?? { tag: a.role, chip: 'bg-gray-100 text-gray-600 border-gray-300' };
                return (
                  <div key={a.id} className="flex items-baseline justify-between gap-2 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                    <span className="truncate">
                      <span className="mr-2 inline-block w-4 font-mono text-[10px] text-[#9b9890]">{i + 1}</span>
                      <Link href={`/dashboard/admin/users/${a.id}`} className="text-[#1a1916] hover:text-[#2a78d6] hover:underline">{a.name}</Link>
                      <span className={`ml-1.5 rounded border px-1 font-mono text-[9px] font-extrabold ${meta.chip}`}>{meta.tag}</span>
                    </span>
                    <span className="whitespace-nowrap font-mono text-[12px] font-bold text-[#1a1916]">
                      {a.views > 0 ? fmtN(a.views) : '—'} / {fmtN(a.actions)}
                      <span className="ml-1 font-normal text-[#9b9890]">· {a.last_seen ? dayLabel(a.last_seen) : ''}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* services side — separate sections, mirroring the rental-side panels */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Top Earning Categories</h2>
              {board.services.topCategories.map((c, i) => (
                <div key={c.name} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="truncate text-[#1a1916]">
                    <span className="mr-2 inline-block w-4 font-mono text-[10px] text-[#9b9890]">{i + 1}</span>{c.name}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[12px] font-bold text-[#1a1916]">
                    {fmtAED(c.aed)} <span className="font-normal text-[#9b9890]">· {fmtN(c.bookings)} bkg</span>
                  </span>
                </div>
              ))}
              {board.services.topCategories.length === 0 && (
                <div className="py-4 text-center text-[12px] text-[#9b9890]">No bookings in this period</div>
              )}
            </div>
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Best Service Providers</h2>
              {board.services.topProviders.map((p, i) => (
                <div key={p.name} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="truncate text-[#1a1916]">
                    <span className="mr-2 inline-block w-4 font-mono text-[10px] text-[#9b9890]">{i + 1}</span>{p.name}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[12px] font-bold text-[#1a1916]">
                    {fmtAED(p.aed)} <span className="font-normal text-[#9b9890]">· {fmtN(p.bookings)} bkg</span>
                  </span>
                </div>
              ))}
              {board.services.topProviders.length === 0 && (
                <div className="py-4 text-center text-[12px] text-[#9b9890]">No bookings in this period</div>
              )}
            </div>
            <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6b6963]">Best Technicians</h2>
              {board.services.topTechnicians.map((t, i) => (
                <div key={t.name} className="flex items-baseline justify-between gap-3 border-b border-[#f2f0eb] py-1.5 text-[12.5px] last:border-0">
                  <span className="truncate text-[#1a1916]">
                    <span className="mr-2 inline-block w-4 font-mono text-[10px] text-[#9b9890]">{i + 1}</span>{t.name}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[12px] font-bold text-[#1a1916]">
                    {fmtN(t.jobs)} jobs <span className="font-normal text-[#9b9890]">· {fmtN(t.completed)} done</span>
                  </span>
                </div>
              ))}
              {board.services.topTechnicians.length === 0 && (
                <div className="py-4 text-center text-[12px] text-[#9b9890]">No technician assignments in this period</div>
              )}
            </div>
          </div>
        </div>

        {/* ══ LIVE FEED ══ */}
        <aside className="min-w-0">
          <div className="flex max-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-2xl border border-[#e8e6e0] bg-white xl:sticky xl:top-4">
            <div className="border-b border-[#f2f0eb] p-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#1a1916]">Activity feed</h2>
                <span className="ml-auto font-mono text-[10.5px] text-[#9b9890]">
                  {feed ? `${fmtN(feed.items.length)} / ${fmtN(feed.total)}` : '…'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[['', 'ALL'], ['manager', 'MGR'], ['rental_provider', 'RP'], ['customer', 'CUST'], ['service_provider', 'SP'], ['super_admin', 'ADMIN']].map(([val, lab]) => (
                  <button key={lab} onClick={() => setFeedRole(val)}
                    className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${feedRole === val ? 'bg-[#2a78d6] text-white' : 'border border-[#e8e6e0] text-[#6b6963] hover:border-[#d4d2cc]'}`}>
                    {lab}
                  </button>
                ))}
              </div>
              <input type="search" value={feedQ} onChange={(e) => onSearch(e.target.value)}
                placeholder="Filter: actor, action, contract #…"
                className="mt-2 w-full rounded-lg border border-[#e8e6e0] px-2.5 py-1.5 font-mono text-[11.5px] text-[#1a1916] placeholder:text-[#c4c2bc] focus:border-[#2a78d6] focus:outline-none" />
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {(feed?.items ?? []).map((e) => {
                const meta = ROLE_META[e.role] ?? { tag: e.role, chip: 'bg-gray-100 text-gray-600 border-gray-300' };
                const target = e.entityType ? `${ENTITY_LABELS[e.entityType] ?? e.entityType}${e.entityId ? ` #${e.entityId}` : ''}` : '';
                return (
                  <div key={e.id}
                    className={`grid grid-cols-[72px_1fr] gap-x-2.5 border-b border-[#f7f5f0] px-3 py-2 transition-colors duration-1000 hover:bg-[#fafaf8] ${freshIds.has(e.id) ? 'bg-blue-50' : ''}`}>
                    <span className="pt-0.5 font-mono text-[10px] text-[#9b9890]">{feedTime.format(new Date(e.createdAt))}</span>
                    <span className="min-w-0 text-[12px] leading-snug">
                      {e.actorUserId ? (
                        <Link href={`/dashboard/admin/users/${e.actorUserId}`} className="font-semibold text-[#1a1916] hover:text-[#2a78d6] hover:underline">{e.actor}</Link>
                      ) : (
                        <span className="font-semibold text-[#1a1916]">{e.actor}</span>
                      )}
                      <span className={`ml-1.5 rounded border px-1 font-mono text-[8.5px] font-extrabold align-[1px] ${meta.chip}`}>{meta.tag}</span>
                      <br />
                      <span className="text-[#6b6963]">{ACTION_LABELS[e.actionKey] ?? e.actionKey}</span>
                      {target && (() => {
                        const href = entityHref(e.entityType, e.entityId);
                        return href ? (
                          <Link href={href} className="font-mono text-[10.5px] text-[#2a78d6] hover:underline"> → {target}</Link>
                        ) : (
                          <button onClick={() => filterFeed('', String(e.entityId ?? ''))}
                            title={`Show all activity for ${target}`}
                            className="font-mono text-[10.5px] text-[#9b9890] hover:text-[#2a78d6] hover:underline"> → {target}</button>
                        );
                      })()}
                    </span>
                  </div>
                );
              })}
              {feed && feed.items.length === 0 && (
                <div className="p-6 text-center text-[12px] text-[#9b9890]">No activity matches these filters</div>
              )}
              {feed && feed.items.length < feed.total && (
                <button onClick={() => void loadFeed(from, to, feedRole, feedQ, feed.items.length, true)}
                  disabled={feedLoading}
                  className="w-full border-t border-[#f2f0eb] py-2.5 text-[12px] font-semibold text-[#2a78d6] hover:bg-[#fafaf8] disabled:opacity-50">
                  {feedLoading ? 'Loading…' : `Load ${Math.min(300, feed.total - feed.items.length)} more`}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
