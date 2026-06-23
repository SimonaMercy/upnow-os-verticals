/**
 * Admin analytics — RP suite (SCRUM-592, 7 widgets) + SP suite (SCRUM-593).
 * Pre-bucketed series from /admin/analytics/rp and /admin/analytics/sp, rendered
 * with recharts. Widgets degrade gracefully when a dataset is empty.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { Users, Home, Building2, Wrench, Star, MapPin, TrendingUp, ChevronRight } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { BackLink } from '@/components/dashboard/DashboardWidgets';

interface NV { name: string; value: number }
interface RpAnalytics {
  unitMix: NV[]; nationalityMix: NV[]; ageMix: NV[];
  rentalByYear: { year: string; total: number }[];
  occupancy: { total: number; listed: number; vacant: number; occupied: number };
  activeCustomers: number;
}
interface SpAnalytics {
  services: { name: string; value: number; available: number }[]; servicesTotal: number;
  technicians: { active: number; total: number };
  ratings: { distribution: NV[]; average: number | null; rated: number; unrated: number };
  zones: NV[]; providers: number;
}
interface Manager { id: number; name: string; email: string; landlordCount: number; status: string }

const tip = { borderRadius: 10, border: '1px solid #e8e6e0', fontSize: 12 };
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e8e6e0] bg-white p-5">
      <div className="mb-3"><h3 className="text-sm font-bold text-[#3f3d39]">{title}</h3>{sub && <p className="text-xs text-[#9b9890]">{sub}</p>}</div>
      {children}
    </div>
  );
}
function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
      <div className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold flex items-center gap-1.5">{icon}{label}</div>
      <div className="text-2xl font-bold text-[#1a1916] mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[#9b9890] mt-0.5">{sub}</div>}
    </div>
  );
}
function Empty({ msg }: { msg: string }) {
  return <div className="h-[180px] grid place-items-center text-sm text-[#9b9890]">{msg}</div>;
}
function HBar({ data, color = '#2e9f82' }: { data: NV[]; color?: string }) {
  if (!data.length) return <Empty msg="No data yet" />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#6b6860' }} axisLine={false} tickLine={false} tickFormatter={titleCase} />
        <Tooltip contentStyle={tip} cursor={{ fill: '#fafaf8' }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={color} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function AdminAnalyticsPage() {
  const [rp, setRp] = useState<RpAnalytics | null>(null);
  const [sp, setSp] = useState<SpAnalytics | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);

  useEffect(() => {
    apiGet<RpAnalytics>('/admin/analytics/rp').then(setRp).catch(() => undefined);
    apiGet<SpAnalytics>('/admin/analytics/sp').then(setSp).catch(() => undefined);
    apiGet<Manager[]>('/admin/team/managers').then((m) => setManagers(Array.isArray(m) ? m : [])).catch(() => undefined);
  }, []);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      <BackLink />
      {/* ── RP analytics ── */}
      <section>
        <h2 className="text-lg font-bold text-[#1a1916] mb-3">Rental Provider analytics</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Kpi icon={<Users size={12} />} label="Active customers" value={rp?.activeCustomers ?? '—'} />
          <Kpi icon={<Home size={12} />} label="Total units" value={rp?.occupancy.total ?? '—'} sub={rp ? `${rp.occupancy.occupied} occupied · ${rp.occupancy.vacant} vacant` : ''} />
          <Kpi icon={<TrendingUp size={12} />} label="Occupancy" value={rp ? `${rp.occupancy.total ? Math.round((rp.occupancy.occupied / rp.occupancy.total) * 100) : 0}%` : '—'} />
          <Kpi icon={<Building2 size={12} />} label="Listed units" value={rp?.occupancy.listed ?? '—'} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Unit mix" sub="Units by type"><HBar data={rp?.unitMix ?? []} color="#2e9f82" /></Card>
          <Card title="Rental income by year" sub="Active leases, annual rent">
            {rp && rp.rentalByYear.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={rp.rentalByYear} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip contentStyle={tip} cursor={{ fill: '#fafaf8' }} formatter={(v: unknown) => [`AED ${Number(v).toLocaleString('en-AE')}`, 'Rent']} />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]} fill="#1f5a3f" />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty msg="No data yet" />}
          </Card>
          <Card title="Tenant nationality mix" sub="Active tenants by KYC nationality"><HBar data={(rp?.nationalityMix ?? []).slice(0, 8)} color="#3b6fb5" /></Card>
          <Card title="Tenant age mix" sub="From date of birth"><HBar data={rp?.ageMix ?? []} color="#7c3aed" /></Card>
          <Card title="Listed vs Vacant" sub="By unit availability">
            {rp ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={[{ name: 'Occupied', value: rp.occupancy.occupied }, { name: 'Vacant', value: rp.occupancy.vacant }, { name: 'Other', value: Math.max(0, rp.occupancy.total - rp.occupancy.occupied - rp.occupancy.vacant) }]} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
                    {[0, 1, 2].map((i) => <Cell key={i} fill={['#2e9f82', '#d97706', '#d6d3cd'][i]} />)}
                  </Pie>
                  <Tooltip contentStyle={tip} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty msg="—" />}
          </Card>
          <Card title="Managers" sub={`${managers.length} delegated · click to open`}>
            {managers.length === 0 ? <Empty msg="No managers" /> : (
              <div className="divide-y divide-[#f0ede8] -mx-1 max-h-[200px] overflow-auto">
                {managers.map((m) => (
                  <Link key={m.id} href={`/dashboard/admin/users/${m.id}`} className="flex items-center gap-2 px-1 py-2 hover:bg-[#faf9f7] rounded transition">
                    <span className="w-7 h-7 rounded-full bg-[#f4f3ef] grid place-items-center text-xs font-bold text-[#6b6860] shrink-0">{(m.name || '?').slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium text-[#3f3d39] truncate">{m.name}</div><div className="text-xs text-[#9b9890] truncate">{m.email}</div></div>
                    <span className="text-xs text-[#6b6860] shrink-0">{m.landlordCount} RP</span>
                    <ChevronRight size={14} className="text-[#c4c2bc] shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ── SP analytics ── */}
      <section>
        <h2 className="text-lg font-bold text-[#1a1916] mb-3">Service Provider analytics</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Kpi icon={<Building2 size={12} />} label="Providers" value={sp?.providers ?? '—'} />
          <Kpi icon={<Wrench size={12} />} label="Active technicians" value={sp?.technicians.active ?? '—'} sub={sp ? `${sp.technicians.total} total` : ''} />
          <Kpi icon={<Star size={12} />} label="Avg rating" value={sp?.ratings.average ?? '—'} sub={sp ? `${sp.ratings.rated} rated · ${sp.ratings.unrated} unrated` : ''} />
          <Kpi icon={<TrendingUp size={12} />} label="Services offered" value={sp?.servicesTotal ?? '—'} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Services by category" sub="From the service catalogue"><HBar data={(sp?.services ?? []).map((s) => ({ name: s.name, value: s.value }))} color="#0891b2" /></Card>
          <Card title="Ratings distribution" sub="Service providers by star band">
            {sp && sp.ratings.rated > 0 ? <HBar data={sp.ratings.distribution} color="#d97706" /> : <Empty msg="No rated providers yet" />}
          </Card>
          <Card title="Zones served" sub="Coverage by emirate / zone"><HBar data={(sp?.zones ?? []).slice(0, 10)} color="#db2777" /></Card>
          <Card title="Technicians" sub="Active workforce">
            {sp ? (
              <div className="h-[180px] grid place-items-center">
                <div className="text-center"><MapPin className="mx-auto text-[#c4c2bc] mb-2" size={28} /><div className="text-4xl font-bold text-[#1a1916]">{sp.technicians.active}</div><div className="text-sm text-[#9b9890]">active of {sp.technicians.total}</div></div>
              </div>
            ) : <Empty msg="—" />}
          </Card>
        </div>
      </section>
    </div>
  );
}
