/**
 * Admin — Platform Overview (dashboard/admin)
 *
 * The super-admin's landing: an at-a-glance platform-health snapshot spanning
 * BOTH marketplaces — Rental Providers and Service Providers — plus cross-platform
 * stats. Customer / SP headline counts are ACTIVE-only (SCRUM-595).
 *
 * Risk / watchlist / harm-events now live on the dedicated Risk board
 * (/dashboard/admin/risk); the Overview keeps only a compact risk-summary tile.
 * Deep analytics live on /dashboard/admin/analytics. Amounts are WHOLE AED.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  Building2, Home, Users, UserCog, ShieldCheck, Wallet, Banknote, TrendingUp, Loader2,
  ArrowUpRight, ShieldAlert, Wrench, HardHat, ListChecks, Globe, Scale, Star, CalendarClock, Gauge,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend,
} from 'recharts';
import { apiGet } from '@/lib/api';

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
  topRps: { rpId: number; name: string; units: number }[];
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

/* ── Style ── */
const GREEN = '#2e9f82', BLUE = '#3b6fb5', AMBER = '#d97706', PURPLE = '#7c3aed', RED = '#dc2626', TEAL = '#0d9488', ROSE = '#e11d48';
const PALETTE = [GREEN, BLUE, AMBER, PURPLE, TEAL, ROSE, '#6b6860', '#b45309'];
const ROLE_LABEL: Record<string, string> = {
  customer: 'Customers', rental_provider: 'Rental providers', manager: 'Managers',
  service_provider: 'Service providers', super_admin: 'Admins',
};
const tooltipStyle = { borderRadius: 12, border: '1px solid #e8e6e0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };
function fmtAED(aed: number | null | undefined): string {
  if (aed == null) return '—';
  const a = Math.abs(aed);
  if (a >= 1_000_000) return `AED ${(aed / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `AED ${Math.round(aed / 1_000)}K`;
  return `AED ${Math.round(aed).toLocaleString('en-AE')}`;
}
const aedAxis = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K` : String(v));
const monthLabel = (m: string) => { const [, mm] = m.split('-'); return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm)] || m; };

function KpiTile({ icon: Icon, label, value, sub, tone = 'neutral', href }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; value: string; sub?: string; tone?: 'neutral' | 'good' | 'bad' | 'warn'; href?: string;
}) {
  const vc = tone === 'bad' ? 'text-[#b91c1c]' : tone === 'warn' ? 'text-[#b45309]' : tone === 'good' ? 'text-[#1a7a5a]' : 'text-[#1a1916]';
  const body = (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3.5 h-full hover:border-[#d4d2cc] transition-colors">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold"><Icon size={12} /> {label}</div>
      <p className={`text-xl font-bold mt-1.5 leading-none ${vc}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#9b9890] mt-1.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
      <h3 className="text-sm font-bold text-[#1a1916]">{title}</h3>
      {sub && <p className="text-[11px] text-[#9b9890] mt-0.5 mb-1">{sub}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
function SectionHeader({ icon: Icon, title, sub }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mt-7 mb-3">
      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#f0faf6] text-[#1a7a5a]"><Icon size={15} /></span>
      <div>
        <h2 className="text-[14px] font-bold text-[#1a1916] leading-none">{title}</h2>
        {sub && <p className="text-[11px] text-[#9b9890] mt-1">{sub}</p>}
      </div>
    </div>
  );
}
function EmptyChart({ text }: { text: string }) {
  return <div className="h-[190px] flex items-center justify-center text-center text-[12px] text-[#9b9890] px-4">{text}</div>;
}
/** Simple categorical bar chart (name/value). */
function CatBar({ data, color = GREEN, empty, fmt }: { data: { name: string; value: number }[]; color?: string; empty: string; fmt?: (v: number) => string }) {
  if (!data.length || data.every((d) => !d.value)) return <EmptyChart text={empty} />;
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9b9890' }} axisLine={false} tickLine={false} interval={0} angle={data.length > 5 ? -20 : 0} textAnchor={data.length > 5 ? 'end' : 'middle'} height={data.length > 5 ? 44 : 24} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={30} tickFormatter={fmt ? (v) => fmt(Number(v)) : undefined} />
        <Tooltip formatter={(v: unknown) => [fmt ? fmt(Number(v)) : String(v), ''] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>{data.map((_, i) => <Cell key={i} fill={color} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function AdminPlatformOverview() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const [ov, setOv] = useState<Overview | null>(null);
  const [rp, setRp] = useState<RpAnalytics | null>(null);
  const [sp, setSp] = useState<SpAnalytics | null>(null);
  const [risk, setRisk] = useState<RiskKpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
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

  const usersByRole = useMemo(() => (ov?.usersByRole ?? []).map((r) => ({ name: ROLE_LABEL[r.name] ?? r.name, value: r.value })), [ov]);
  const kycData = useMemo(() => (ov?.customerKyc ?? []).map((r) => ({ name: r.name.replace(/_/g, ' '), value: r.value })), [ov]);
  const collections = useMemo(() => (ov?.collections ?? []).map((r) => ({ name: (r.name || 'unknown').replace(/_/g, ' '), value: r.value })), [ov]);
  const disputesOpen = (ov?.disputes ?? []).filter((d) => !/resolved|closed/i.test(d.name)).reduce((s, d) => s + d.value, 0);
  const disputesTotal = (ov?.disputes ?? []).reduce((s, d) => s + d.value, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-lg font-bold text-[#1a1916]">{isSuperAdmin ? 'Platform Overview' : 'Admin Overview'}</h1>
          <p className="text-[12px] text-[#9b9890] mt-0.5">A health snapshot across both marketplaces — rentals and home services. Customer &amp; provider totals are active-only.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href="/dashboard/admin/analytics" className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-white text-[#3f3d39] border border-[#e8e6e0] hover:border-[#d4d2cc] transition-colors">
            Deep analytics <ArrowUpRight size={13} />
          </Link>
          <Link href="/dashboard/admin/risk" className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-[#fef2f2] text-[#b91c1c] border border-[#f3c9c9] hover:border-[#dc2626] transition-colors">
            Risk board <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>

      {loading && !ov ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-10 flex items-center justify-center mt-4">
          <Loader2 size={18} className="animate-spin text-[#2e9f82]" /><span className="ml-2 text-sm text-[#6b6860]">Loading…</span>
        </div>
      ) : (
        <>
          {/* Risk summary strip */}
          <Link href="/dashboard/admin/risk" className="block">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-[#f3c9c9] bg-[#fef6f6] px-4 py-2.5 mb-2 hover:border-[#dc2626] transition-colors">
              <span className="flex items-center gap-1.5 text-[12px] font-bold text-[#b91c1c]"><ShieldAlert size={14} /> Risk</span>
              <span className="text-[12px] text-[#6b6860]"><b className="text-[#b91c1c]">{risk?.rpsOnWatchlist ?? '—'}</b> RPs on watchlist</span>
              <span className="text-[12px] text-[#6b6860]"><b className="text-[#b91c1c]">{risk ? fmtAED(risk.depositsAtRiskAed) : '—'}</b> deposits at risk ({risk?.depositsAtRiskCount ?? 0})</span>
              <span className="text-[12px] text-[#6b6860]"><b className="text-[#b91c1c]">{risk?.openCriticalAlerts ?? '—'}</b> open critical alerts</span>
              <span className="ml-auto text-[11px] font-semibold text-[#b91c1c] flex items-center gap-1">Open risk board <ArrowUpRight size={12} /></span>
            </div>
          </Link>

          {/* ════════ RENTAL ════════ */}
          <SectionHeader icon={Building2} title="Rental marketplace" sub="Properties, units, active customers and the rental book." />

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
            <KpiTile icon={Building2} label="Properties" value={c ? String(c.properties) : '—'} sub={c ? `${c.units} units` : ''} href="/dashboard/admin/properties" />
            <KpiTile icon={Home} label="Units" value={c ? String(c.units) : '—'} sub={c ? `${c.listedUnits} listed` : ''} href="/dashboard/admin/properties" />
            <KpiTile icon={Users} label="Active customers" value={c ? String(c.activeCustomers) : '—'} sub={c ? `of ${c.totalTenants} total` : ''} tone="good" />
            <KpiTile icon={UserCog} label="Rental providers" value={c ? String(c.rentalProviders) : '—'} sub="landlords" />
            <KpiTile icon={ShieldCheck} label="Managers" value={c ? String(c.managers) : '—'} sub="delegated" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <KpiTile icon={Gauge} label="Occupancy" value={f ? `${f.occupancyPct}%` : '—'} sub={c ? `${c.occupiedUnits}/${c.units} occupied` : ''} tone={f && f.occupancyPct < 60 ? 'warn' : 'neutral'} />
            <KpiTile icon={Wallet} label="Annual rent roll" value={f ? fmtAED(f.arr) : '—'} sub="active leases" tone="good" />
            <KpiTile icon={Banknote} label="Deposits held" value={f ? fmtAED(f.depositsHeld) : '—'} sub="liability" />
            <KpiTile icon={ListChecks} label="Active leases" value={ov ? String(ov.leases.active) : '—'} sub={ov ? `${ov.leases.expiring90} expiring ≤90d` : ''} />
            <KpiTile icon={CalendarClock} label="Renewal backlog" value={ov ? String(ov.leases.renewalBacklog) : '—'} sub="active but past end-date" tone={ov && ov.leases.renewalBacklog > 0 ? 'warn' : 'good'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <ChartCard title="Customer age" sub="tenants by age band (from KYC DOB)">
              <CatBar data={rp?.ageMix ?? []} color={BLUE} empty="No tenant date-of-birth data yet." />
            </ChartCard>
            <ChartCard title="Top nationalities" sub="tenants by nationality">
              <CatBar data={nationalities} color={PURPLE} empty="No nationality data yet." />
            </ChartCard>
            <ChartCard title="Properties by emirate" sub="geographic spread">
              <CatBar data={ov?.geographic ?? []} color={GREEN} empty="No properties yet." />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <ChartCard title="Unit mix" sub="units by type">
              <CatBar data={rp?.unitMix ?? []} color={TEAL} empty="No units yet." />
            </ChartCard>
            <ChartCard title="Property categories" sub="properties by category">
              {(ov?.categorySplit ?? []).length ? (
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={ov!.categorySplit} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => `${e.name} (${e.value})`} labelLine={false} fontSize={10}>
                      {ov!.categorySplit.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="No properties yet." />}
            </ChartCard>
            <ChartCard title="New leases" sub="leases started per month (12 mo)">
              {newLeases.length ? (
                <ResponsiveContainer width="100%" height={190}>
                  <AreaChart data={newLeases} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="nl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.3} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={26} />
                    <Tooltip formatter={(v: unknown) => [String(v), 'New leases'] as [string, string]} contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="value" stroke={GREEN} strokeWidth={2} fill="url(#nl)" dot={{ r: 2, fill: GREEN }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="No leases started in the last 12 months." />}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <ChartCard title="Cheque collections" sub="rent cheques by status">
              <CatBar data={collections} color={AMBER} empty="No payment records yet." />
            </ChartCard>
            <ChartCard title="Customer KYC" sub="tenants by verification status">
              <CatBar data={kycData} color={BLUE} empty="No customers yet." />
            </ChartCard>
            <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
              <h3 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5"><TrendingUp size={14} className="text-[#2e9f82]" /> Top rental providers</h3>
              <p className="text-[11px] text-[#9b9890] mt-0.5 mb-2">by unit count</p>
              {(ov?.topRps ?? []).length ? (
                <ul className="divide-y divide-[#f0ede8]">
                  {ov!.topRps.map((r, i) => (
                    <li key={r.rpId} className="flex items-center justify-between py-1.5 text-[12px]">
                      <span className="truncate"><span className="text-[#9b9890] font-semibold mr-2">{i + 1}</span>{r.name}</span>
                      <span className="font-bold text-[#1a1916] flex-shrink-0">{r.units} <span className="font-normal text-[#9b9890]">units</span></span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyChart text="No rental providers yet." />}
            </div>
          </div>

          {/* ════════ SERVICE PROVIDERS ════════ */}
          <SectionHeader icon={Wrench} title="Service-provider marketplace" sub="Home-services providers, technicians and the service catalogue. Some metrics populate as SP data lands." />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <KpiTile icon={Wrench} label="Active service providers" value={c ? String(c.activeServiceProviders) : '—'} sub={c ? `of ${c.serviceProviders} total` : ''} tone={c && c.activeServiceProviders > 0 ? 'good' : 'neutral'} />
            <KpiTile icon={HardHat} label="Active technicians" value={c ? String(c.activeTechnicians) : '—'} sub={c ? `of ${c.technicians} total` : ''} />
            <KpiTile icon={ListChecks} label="Services offered" value={c ? String(c.servicesOffered) : '—'} sub="catalogue SKUs" />
            <KpiTile icon={Star} label="Avg rating" value={sp?.ratings.average != null ? `${sp.ratings.average}★` : '—'} sub={sp ? `${sp.ratings.rated} rated · ${sp.ratings.unrated} unrated` : ''} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <ChartCard title="Services by category" sub="catalogue breakdown">
              <CatBar data={sp?.services ?? []} color={TEAL} empty="No service catalogue yet — populates as SPs add services." />
            </ChartCard>
            <ChartCard title="Zones served" sub="emirates covered by SPs">
              <CatBar data={sp?.zones ?? []} color={PURPLE} empty="No coverage zones recorded yet." />
            </ChartCard>
            <ChartCard title="Rating distribution" sub="SPs by star rating">
              <CatBar data={sp?.ratings.distribution ?? []} color={AMBER} empty="No SP ratings yet." />
            </ChartCard>
          </div>

          {/* ════════ PLATFORM ════════ */}
          <SectionHeader icon={Globe} title="Platform" sub="Cross-marketplace — users, growth and disputes." />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <ChartCard title="Users by role" sub="all registered accounts">
              {usersByRole.length ? (
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={usersByRole} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={38} paddingAngle={2}>
                      {usersByRole.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="No users yet." />}
            </ChartCard>
            <ChartCard title="New signups" sub="accounts created per month (12 mo)">
              {signups.series.length ? (
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={signups.series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={26} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                    {signups.roles.map((role, i) => (
                      <Bar key={role} dataKey={role} stackId="s" name={ROLE_LABEL[role] ?? role} fill={PALETTE[i % PALETTE.length]} radius={i === signups.roles.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="No signups in the last 12 months." />}
            </ChartCard>
            <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
              <h3 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5"><Scale size={14} className="text-[#2e9f82]" /> Disputes</h3>
              <p className="text-[11px] text-[#9b9890] mt-0.5 mb-2">case load</p>
              {disputesTotal > 0 ? (
                <div className="space-y-2">
                  {(ov?.disputes ?? []).map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-[12px]">
                      <span className="capitalize text-[#3f3d39]">{d.name.replace(/_/g, ' ')}</span>
                      <span className="font-bold text-[#1a1916]">{d.value}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-[12px] pt-2 border-t border-[#f0ede8]">
                    <span className="font-semibold text-[#b45309]">Open</span>
                    <span className="font-bold text-[#b45309]">{disputesOpen}</span>
                  </div>
                </div>
              ) : <EmptyChart text="No disputes raised — nothing to action. 🎉" />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
