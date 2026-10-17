/**
 * Admin — Platform Overview (dashboard/admin/overview)
 *
 * The ORIGINAL admin landing page. /dashboard/admin now renders Platform Pulse
 * instead; this is kept and still reachable at its own route rather than
 * deleted — several cards here have no Pulse equivalent yet.
 *
 * The super-admin's landing: an at-a-glance platform-health snapshot spanning
 * BOTH marketplaces — Rental Providers and Service Providers — plus cross-platform
 * stats. Customer / SP headline counts are ACTIVE-only (SCRUM-595).
 *
 * Risk / watchlist / harm-events live on the dedicated Risk board
 * (/dashboard/admin/risk); the Overview keeps only a compact risk summary.
 * Deep analytics live on /dashboard/admin/analytics. Amounts are WHOLE AED.
 *
 * Parity with previous page (Genspark kit rebuild):
 *  - API: GET /admin/overview, GET /admin/analytics/rp, GET /admin/analytics/sp,
 *    GET /admin/risk/overview (→ .kpis). All four in parallel; each failure is
 *    swallowed individually (widget falls back to "—" / empty state), as before.
 *  - Title switches on role: super_admin → "Platform Overview", else "Admin Overview".
 *  - Header links: Deep analytics (/dashboard/admin/analytics), Risk board (/dashboard/admin/risk).
 *  - Risk summary (watchlist RPs, deposits at risk AED + count, open critical alerts) → /risk.
 *    Now rendered as Attn cards; open-disputes count added from the same /admin/overview data.
 *  - Rental KPIs (Properties, Units, Active customers, Rental providers, Managers, Occupancy)
 *    with the same drill-in hrefs (users?role=…, units?availability=occupied, …).
 *  - Charts: Customer age, Top nationalities (top 8), Properties by emirate (bar click →
 *    /properties?emirate=), Unit mix (bar click → /units?unitType=), New leases (12 mo area),
 *    Customer KYC (→ /kyc?tab=tenants), Top rental providers list (→ /users/:ownerUserId or
 *    /kyc/rental-provider/:rpId), Services by category (bar click → /listings?section=sp&category=),
 *    Zones served, Rating distribution, Users by role pie (slice click → /users?role=),
 *    New signups stacked bars, Disputes case-load (→ /disputes) with open count.
 *  - SP KPIs (Active SPs, Active technicians, Services offered, Avg rating) with same hrefs.
 *  - Loading state (skeleton) and every chart's empty-state copy kept.
 *  - Whole-card links became labelled "View"/"Open" buttons in each Card header (same targets).
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend,
} from 'recharts';
import { apiGet } from '@/lib/api';
import {
  Attn, AttnCard, Btn, Card, Cols, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, fmtAedK,
} from '@/components/os/kit';

/* ── Types ── */
interface Overview {
  counts: {
    properties: number; units: number; occupiedUnits: number; listedUnits: number;
    rentalProviders: number; managers: number; totalTenants: number; activeCustomers: number;
    serviceProviders: number; activeServiceProviders: number; technicians: number;
    activeTechnicians: number; servicesOffered: number;
  };
  financials: { arr: number; depositsHeld: number; occupancyPct: number };
  leases: { active: number; expiring30: number; expiring60: number; expiring90: number; renewalBacklog: number };
  newLeasesByMonth: { month: string; value: number }[];
  signupsByMonth: { month: string; role: string; value: number }[];
  geographic: { name: string; value: number }[];
  categorySplit: { name: string; value: number }[];
  collections: { name: string; value: number; amount: number }[];
  customerKyc: { name: string; value: number }[];
  usersByRole: { name: string; value: number }[];
  disputes: { name: string; value: number }[];
  topRps: { rpId: number; ownerUserId: number | null; name: string; units: number }[];
}
interface RpAnalytics {
  unitMix: { name: string; value: number }[];
  nationalityMix: { name: string; value: number }[];
  ageMix: { name: string; value: number }[];
  rentalByYear: { year: string; total: number }[];
  occupancy: { total: number; listed: number; vacant: number; occupied: number };
  activeCustomers: number;
}
interface SpAnalytics {
  services: { name: string; value: number; available: number }[];
  servicesTotal: number;
  technicians: { active: number; total: number };
  ratings: { distribution: { name: string; value: number }[]; average: number | null; rated: number; unrated: number };
  zones: { name: string; value: number }[];
  providers: number;
}
interface RiskKpis { rpsOnWatchlist: number; depositsAtRiskAed: number; depositsAtRiskCount: number; openCriticalAlerts: number; }
interface RiskOverview { kpis: RiskKpis }

/* ── Chart style ── */
const GREEN = '#047246', BLUE = '#3b6fb5', AMBER = '#d97706', PURPLE = '#7c3aed', TEAL = '#0d9488', ROSE = '#e11d48';
const PALETTE = [GREEN, BLUE, AMBER, PURPLE, TEAL, ROSE, '#5f6b63', '#b45309'];
const ROLE_LABEL: Record<string, string> = {
  customer: 'Customers', rental_provider: 'Rental providers', manager: 'Managers',
  service_provider: 'Service providers', super_admin: 'Admins',
};
const tooltipStyle = { borderRadius: 12, border: '1px solid #e4e9e5', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };
const monthLabel = (m: string) => { const [, mm] = m.split('-'); return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm)] || m; };

function EmptyChart({ text }: { text: string }) {
  return <div className="gx-empty" style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{text}</div>;
}
/** Section divider between the three marketplace blocks. */
function Section({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ margin: '22px 0 10px' }}>
      <div className="gx-eyebrow">{title}</div>
      <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 2 }}>{sub}</p>
    </div>
  );
}
/** Card header affordance: a labelled link, or a hint that the chart itself is clickable. */
const viewBtn = (href: string, label = 'View') => <Btn size="xs" href={href}>{label}</Btn>;
const clickHint = (t: string) => <Pill tone="outline" dot={false}>{t}</Pill>;

/** Simple categorical bar chart (name/value). */
function CatBar({ data, color = GREEN, empty, fmt, onBarClick }: { data: { name: string; value: number }[]; color?: string; empty: string; fmt?: (v: number) => string; onBarClick?: (name: string) => void }) {
  if (!data.length || data.every((d) => !d.value)) return <EmptyChart text={empty} />;
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#8a948d' }} axisLine={false} tickLine={false} interval={0} angle={data.length > 5 ? -20 : 0} textAnchor={data.length > 5 ? 'end' : 'middle'} height={data.length > 5 ? 44 : 24} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8a948d' }} axisLine={false} tickLine={false} width={30} tickFormatter={fmt ? (v) => fmt(Number(v)) : undefined} />
        <Tooltip formatter={(v: unknown) => [fmt ? fmt(Number(v)) : String(v), ''] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#f6f8f6' }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} cursor={onBarClick ? 'pointer' : undefined}
          onClick={onBarClick ? (d: unknown) => { const n = d as { payload?: { name?: string }; name?: string }; onBarClick(String(n?.payload?.name ?? n?.name ?? '')); } : undefined}>
          {data.map((_, i) => <Cell key={i} fill={color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SkeletonCards() {
  return (
    <div aria-busy="true">
      <Kpis>{Array.from({ length: 6 }).map((_, i) => <div key={i} className="gx-kpi"><div className="gx-skel" style={{ height: 10, width: '50%' }} /><div className="gx-skel" style={{ height: 20, width: '40%', marginTop: 8 }} /></div>)}</Kpis>
      <Cols kind="3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} pad><div className="gx-skel" style={{ height: 190 }} /></Card>)}</Cols>
    </div>
  );
}

export default function AdminPlatformOverview() {
  const { user } = useAuth();
  const router = useRouter();
  const isSuperAdmin = user?.role === 'super_admin';

  const [ov, setOv] = useState<Overview | null>(null);
  const [rp, setRp] = useState<RpAnalytics | null>(null);
  const [sp, setSp] = useState<SpAnalytics | null>(null);
  const [risk, setRisk] = useState<RiskKpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<Overview>('/admin/overview').then(setOv).catch(() => null),
      apiGet<RpAnalytics>('/admin/analytics/rp').then(setRp).catch(() => null),
      apiGet<SpAnalytics>('/admin/analytics/sp').then(setSp).catch(() => null),
      apiGet<RiskOverview>('/admin/risk/overview').then((r) => setRisk(r.kpis)).catch(() => null),
    ]).finally(() => setLoading(false));
  }, []);

  const c = ov?.counts;
  const f = ov?.financials;
  const nationalities = useMemo(() => (rp?.nationalityMix ?? []).slice(0, 8), [rp]);
  const newLeases = useMemo(() => (ov?.newLeasesByMonth ?? []).map((r) => ({ month: monthLabel(r.month), value: r.value })), [ov]);

  // Pivot signups (month × role) into stacked series.
  const signups = useMemo(() => {
    const rows = ov?.signupsByMonth ?? [];
    const byMonth = new Map<string, Record<string, number | string>>();
    const roles = new Set<string>();
    for (const r of rows) {
      roles.add(r.role);
      const m = byMonth.get(r.month) ?? { month: r.month };
      m[r.role] = (Number(m[r.role]) || 0) + r.value;
      byMonth.set(r.month, m);
    }
    const series = [...byMonth.values()].sort((a, b) => String(a.month).localeCompare(String(b.month))).map((m) => ({ ...m, month: monthLabel(String(m.month)) }));
    return { series, roles: [...roles] };
  }, [ov]);

  const usersByRole = useMemo(() => (ov?.usersByRole ?? []).map((r) => ({ name: ROLE_LABEL[r.name] ?? r.name, role: r.name, value: r.value })), [ov]);
  const kycData = useMemo(() => (ov?.customerKyc ?? []).map((r) => ({ name: r.name.replace(/_/g, ' '), value: r.value })), [ov]);
  const disputesOpen = (ov?.disputes ?? []).filter((d) => !/resolved|closed/i.test(d.name)).reduce((s, d) => s + d.value, 0);
  const disputesTotal = (ov?.disputes ?? []).reduce((s, d) => s + d.value, 0);

  const n = (v: number | undefined | null) => (v == null ? '—' : String(v));

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Overview"
        title={isSuperAdmin ? 'Platform Overview' : 'Admin Overview'}
        lede="A health snapshot across both marketplaces — rentals and home services. Customer & provider totals are active-only."
        actions={<>
          <Btn href="/dashboard/admin/analytics">Deep analytics</Btn>
          <Btn href="/dashboard/admin/risk" variant="danger">Risk board</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Admin' },
        { label: 'Marketplaces', value: 'Rentals · Home services' },
        { label: 'Totals', value: 'Active-only' },
        { label: 'Amounts', value: 'Whole AED' },
      ]} />

      {loading && !ov ? <SkeletonCards /> : (
        <>
          {/* Risk summary + open disputes — what needs an admin's attention. */}
          <Attn>
            <AttnCard tone={risk && risk.rpsOnWatchlist > 0 ? 'bad' : 'ok'} n={n(risk?.rpsOnWatchlist)} t="RPs on watchlist" s="Open risk board" href="/dashboard/admin/risk" />
            <AttnCard tone={risk && risk.depositsAtRiskCount > 0 ? 'bad' : 'ok'} n={risk ? fmtAedK(risk.depositsAtRiskAed) : '—'} t="Deposits at risk" s={`${risk?.depositsAtRiskCount ?? 0} deposits`} href="/dashboard/admin/risk" />
            <AttnCard tone={risk && risk.openCriticalAlerts > 0 ? 'bad' : 'ok'} n={n(risk?.openCriticalAlerts)} t="Open critical alerts" s="Open risk board" href="/dashboard/admin/risk" />
            <AttnCard tone={disputesOpen > 0 ? 'warn' : 'ok'} n={ov ? String(disputesOpen) : '—'} t="Open disputes" s={`${disputesTotal} total cases`} href="/dashboard/admin/disputes" />
          </Attn>

          {/* ════════ RENTAL ════════ */}
          <Section title="Rental marketplace" sub="Properties, units, active customers and the rental book." />
          <Kpis>
            <Kpi k="Properties" v={n(c?.properties)} d={c ? `${c.units} units` : undefined} href="/dashboard/admin/properties" />
            <Kpi k="Units" v={n(c?.units)} d={c ? `${c.listedUnits} listed` : undefined} href="/dashboard/admin/units" />
            <Kpi k="Active customers" v={n(c?.activeCustomers)} d={c ? `of ${c.totalTenants} total` : undefined} href="/dashboard/admin/users?role=customer&status=active" />
            <Kpi k="Rental providers" v={n(c?.rentalProviders)} d="landlords" href="/dashboard/admin/users?role=rental_provider" />
            <Kpi k="Managers" v={n(c?.managers)} d="delegated" href="/dashboard/admin/users?role=manager" />
            <Kpi k="Occupancy" v={f ? `${f.occupancyPct}%` : '—'} dark
              d={c ? `${c.occupiedUnits}/${c.units} occupied${f && f.occupancyPct < 60 ? ' · below 60%' : ''}` : undefined}
              href="/dashboard/admin/units?availability=occupied" />
          </Kpis>

          <Cols kind="3">
            <Card title="Customer age" sub="customers by age band (from KYC DOB)" right={viewBtn('/dashboard/admin/users?role=customer&status=active')} pad>
              <CatBar data={rp?.ageMix ?? []} color={BLUE} empty="No customer date-of-birth data yet." />
            </Card>
            <Card title="Top nationalities" sub="customers by nationality" right={viewBtn('/dashboard/admin/users?role=customer&status=active')} pad>
              <CatBar data={nationalities} color={PURPLE} empty="No nationality data yet." />
            </Card>
            <Card title="Properties by emirate" sub="geographic spread" right={clickHint('Click a bar')} pad>
              <CatBar data={ov?.geographic ?? []} color={GREEN} empty="No properties yet."
                onBarClick={(name) => router.push(`/dashboard/admin/properties?emirate=${encodeURIComponent(name)}`)} />
            </Card>
          </Cols>

          <Cols kind="2e">
            <Card title="Unit mix" sub="units by type" right={clickHint('Click a bar')} pad>
              <CatBar data={rp?.unitMix ?? []} color={TEAL} empty="No units yet."
                onBarClick={(name) => router.push(`/dashboard/admin/units?unitType=${encodeURIComponent(name)}`)} />
            </Card>
            <Card title="New leases" sub="leases started per month (12 mo)" right={viewBtn('/dashboard/admin/users?role=customer&status=active')} pad>
              {newLeases.length ? (
                <ResponsiveContainer width="100%" height={190}>
                  <AreaChart data={newLeases} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="nl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.3} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8a948d' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8a948d' }} axisLine={false} tickLine={false} width={26} />
                    <Tooltip formatter={(v: unknown) => [String(v), 'New leases'] as [string, string]} contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="value" stroke={GREEN} strokeWidth={2} fill="url(#nl)" dot={{ r: 2, fill: GREEN }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="No leases started in the last 12 months." />}
            </Card>
          </Cols>

          <Cols kind="2e">
            <Card title="Customer KYC" sub="customers by verification status" right={viewBtn('/dashboard/admin/kyc?tab=tenants', 'Open KYC')} pad>
              <CatBar data={kycData} color={BLUE} empty="No customers yet." />
            </Card>
            <Card title="Top rental providers" sub="by unit count">
              <div className="gx-tbl-scroll">
                <table className="gx-tbl">
                  <thead><tr><th>#</th><th>Rental provider</th><th className="num">Units</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
                  {(ov?.topRps ?? []).length ? (
                    <tbody>
                      {ov!.topRps.map((r, i) => {
                        const href = r.ownerUserId != null ? `/dashboard/admin/users/${r.ownerUserId}` : `/dashboard/admin/kyc/rental-provider/${r.rpId}`;
                        return (
                          <tr key={r.rpId} className="click" onClick={() => router.push(href)}>
                            <td className="mono">{i + 1}</td>
                            <td className="strong">{r.name}</td>
                            <td className="num">{r.units}</td>
                            <td className="act" onClick={(e) => e.stopPropagation()}><Btn size="xs" href={href}>Open</Btn></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ) : (
                    <tbody><tr><td colSpan={4}><div className="gx-empty">No rental providers yet.</div></td></tr></tbody>
                  )}
                </table>
              </div>
            </Card>
          </Cols>

          {/* ════════ SERVICE PROVIDERS ════════ */}
          <Section title="Service-provider marketplace" sub="Home-services providers, technicians and the service catalogue. Some metrics populate as SP data lands." />
          <Kpis>
            <Kpi k="Active service providers" v={n(c?.activeServiceProviders)} d={c ? `of ${c.serviceProviders} total` : undefined} href="/dashboard/admin/kyc?tab=service&status=compliant" />
            <Kpi k="Active technicians" v={n(c?.activeTechnicians)} d={c ? `of ${c.technicians} total` : undefined} href="/dashboard/admin/kyc?tab=technicians" />
            <Kpi k="Services offered" v={n(c?.servicesOffered)} d="catalogue SKUs" href="/dashboard/admin/listings?section=sp" />
            <Kpi k="Avg rating" v={sp?.ratings.average != null ? `${sp.ratings.average}★` : '—'} d={sp ? `${sp.ratings.rated} rated · ${sp.ratings.unrated} unrated` : undefined} href="/dashboard/admin/analytics" />
          </Kpis>

          <Cols kind="3">
            <Card title="Services by category" sub="catalogue breakdown" right={clickHint('Click a bar')} pad>
              <CatBar data={sp?.services ?? []} color={TEAL} empty="No service catalogue yet — populates as SPs add services."
                onBarClick={(name) => router.push(`/dashboard/admin/listings?section=sp&category=${encodeURIComponent(name)}`)} />
            </Card>
            <Card title="Zones served" sub="emirates covered by SPs" right={viewBtn('/dashboard/admin/analytics')} pad>
              <CatBar data={sp?.zones ?? []} color={PURPLE} empty="No coverage zones recorded yet." />
            </Card>
            <Card title="Rating distribution" sub="SPs by star rating" right={viewBtn('/dashboard/admin/analytics')} pad>
              <CatBar data={sp?.ratings.distribution ?? []} color={AMBER} empty="No SP ratings yet." />
            </Card>
          </Cols>

          {/* ════════ PLATFORM ════════ */}
          <Section title="Platform" sub="Cross-marketplace — users, growth and disputes." />
          <Cols kind="3">
            <Card title="Users by role" sub="all registered accounts" right={clickHint('Click a slice')} pad>
              {usersByRole.length ? (
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={usersByRole} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={38} paddingAngle={2}
                      onClick={(d: unknown) => { const x = d as { payload?: { role?: string }; role?: string }; const role = x?.payload?.role ?? x?.role; if (role) router.push(`/dashboard/admin/users?role=${role}`); }}>
                      {usersByRole.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} style={{ cursor: 'pointer' }} />)}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="No users yet." />}
            </Card>
            <Card title="New signups" sub="accounts created per month (12 mo)" right={viewBtn('/dashboard/admin/users')} pad>
              {signups.series.length ? (
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={signups.series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8a948d' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8a948d' }} axisLine={false} tickLine={false} width={26} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f6f8f6' }} />
                    {signups.roles.map((role, i) => (
                      <Bar key={role} dataKey={role} stackId="s" name={ROLE_LABEL[role] ?? role} fill={PALETTE[i % PALETTE.length]} radius={i === signups.roles.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="No signups in the last 12 months." />}
            </Card>
            <Card title="Disputes" sub="case load" right={viewBtn('/dashboard/admin/disputes', 'Open disputes')}>
              {disputesTotal > 0 ? (
                <div className="gx-tbl-scroll">
                  <table className="gx-tbl">
                    <thead><tr><th>Status</th><th className="num">Cases</th></tr></thead>
                    <tbody>
                      {(ov?.disputes ?? []).map((d) => (
                        <tr key={d.name}>
                          <td><Pill tone={/resolved|closed/i.test(d.name) ? 'primary' : 'amber'}>{d.name.replace(/_/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase())}</Pill></td>
                          <td className="num strong">{d.value}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="strong">Open</td>
                        <td className="num strong">{disputesOpen}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : <EmptyChart text="No disputes raised — nothing to action." />}
            </Card>
          </Cols>
        </>
      )}
    </OsPage>
  );
}
