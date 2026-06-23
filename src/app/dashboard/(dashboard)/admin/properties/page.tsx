/**
 * Admin all-properties browser (SCRUM-591) — every RP's properties with Map /
 * List / Grid views, reusing the shipped RP portfolio map. Read-only; each
 * property drills through to the admin property detail (SCRUM-588).
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Rows3, LayoutGrid, Map as MapIcon, Building2, Search, MapPin, ExternalLink, ArrowLeft } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { PortfolioMapView } from '@/app/rental-provider/dashboard/portfolio/PortfolioMapModal';

interface AdminProperty {
  id: number; buildingName: string; fullAddress: string | null; spaceCategory: string | null;
  latitude: number | null; longitude: number | null; unitCount: number; occupiedCount: number;
  coverPhotoUrl: string | null; rentalProviderId: number; ownerName: string | null; ownerUserId: number | null;
}

const titleCase = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');

export default function AdminPropertiesBrowser() {
  const router = useRouter();
  const [props, setProps] = useState<AdminProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'row' | 'grid' | 'map'>('row');
  const [q, setQ] = useState('');

  const [drill, setDrill] = useState<{ category?: string; emirate?: string; availability?: string }>({});

  useEffect(() => {
    apiGet<AdminProperty[]>('/admin/properties/browser')
      .then((d) => { if (Array.isArray(d)) setProps(d); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  // Deep-link drill filters from the Overview (?category=&emirate=&availability=occupied).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDrill({
      category: p.get('category') ?? undefined,
      emirate: p.get('emirate') ?? undefined,
      availability: p.get('availability') ?? undefined,
    });
  }, []);

  const filtered = useMemo(() => {
    let list = props;
    if (drill.category) list = list.filter((p) => (p.spaceCategory ?? '').toLowerCase() === drill.category!.toLowerCase());
    if (drill.emirate) { const e = drill.emirate!.toLowerCase(); list = list.filter((p) => (p.fullAddress ?? '').toLowerCase().includes(e)); }
    if (drill.availability === 'occupied') list = list.filter((p) => p.occupiedCount > 0);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((p) => [p.buildingName, p.fullAddress, p.ownerName, p.spaceCategory].filter(Boolean).join(' ').toLowerCase().includes(s));
    }
    return list;
  }, [props, q, drill]);

  const activeDrill = [
    drill.category && titleCase(drill.category),
    drill.emirate,
    drill.availability === 'occupied' && 'Occupied only',
  ].filter(Boolean) as string[];

  const withCoords = filtered.filter((p) => p.latitude != null && p.longitude != null).length;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">All properties</h1>
          <p className="text-sm text-stone-500 mt-1">{filtered.length} properties across every rental provider{view === 'map' ? ` · ${withCoords} mapped` : ''}</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-stone-100">
          {([['row', Rows3, 'Row'], ['grid', LayoutGrid, 'Grid'], ['map', MapIcon, 'Map']] as const).map(([v, Icon, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${view === v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
              <Icon size={15} /> <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="relative max-w-md mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search building, owner, address…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-200 text-sm outline-none focus:border-emerald-500" />
      </div>

      {activeDrill.length > 0 && (
        <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
          <span className="text-stone-500">Filtered:</span>
          {activeDrill.map((d) => (
            <span key={d} className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium text-xs">{d}</span>
          ))}
          <button onClick={() => { setDrill({}); router.replace('/dashboard/admin/properties'); }} className="text-xs font-semibold text-stone-500 hover:text-stone-800 underline">Clear</button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center text-stone-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center text-stone-400">No properties match.</div>
      ) : view === 'map' ? (
        <div className="bg-white rounded-2xl p-2 border border-stone-200">
          <PortfolioMapView
            properties={filtered.map((p) => ({ id: p.id, buildingName: p.buildingName, latitude: p.latitude, longitude: p.longitude, fullAddress: p.fullAddress, unitCount: p.unitCount, occupiedCount: p.occupiedCount, coverPhotoUrl: p.coverPhotoUrl, spaceCategory: p.spaceCategory ?? undefined }))}
            heightClass="h-[72vh]"
            onViewDetails={(id) => router.push(`/dashboard/admin/properties/${id}`)}
          />
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <Link key={p.id} href={`/dashboard/admin/properties/${p.id}`} className="rounded-2xl border border-stone-200 bg-white overflow-hidden hover:shadow-md transition group">
              <div className="h-36 bg-stone-100 relative">
                {p.coverPhotoUrl ? <img src={p.coverPhotoUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-stone-300"><Building2 size={28} /></div>}
                {p.spaceCategory && <span className="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/90 text-stone-700">{titleCase(p.spaceCategory)}</span>}
              </div>
              <div className="p-4">
                <p className="font-semibold text-stone-900 truncate group-hover:text-emerald-700">{p.buildingName}</p>
                <p className="text-xs text-stone-500 truncate flex items-center gap-1 mt-0.5"><MapPin size={11} /> {p.fullAddress ?? '—'}</p>
                <div className="flex items-center justify-between mt-3 text-xs text-stone-500">
                  <span className="truncate">{p.ownerName ?? `RP #${p.rentalProviderId}`}</span>
                  <span className="shrink-0 font-medium text-stone-700">{p.occupiedCount}/{p.unitCount} units</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-white divide-y divide-stone-100 overflow-hidden">
          {filtered.map((p) => (
            <Link key={p.id} href={`/dashboard/admin/properties/${p.id}`} className="flex items-center gap-4 p-4 hover:bg-stone-50 transition">
              <div className="w-16 h-16 rounded-xl bg-stone-100 overflow-hidden shrink-0 grid place-items-center text-stone-300">
                {p.coverPhotoUrl ? <img src={p.coverPhotoUrl} alt="" className="w-full h-full object-cover" /> : <Building2 size={22} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-stone-900 truncate">{p.buildingName}</p>
                <p className="text-xs text-stone-500 truncate">{p.fullAddress ?? '—'}</p>
                <p className="text-xs text-stone-400 mt-0.5">{p.ownerName ?? `RP #${p.rentalProviderId}`}{p.spaceCategory ? ` · ${titleCase(p.spaceCategory)}` : ''}</p>
              </div>
              <span className="text-sm font-medium text-stone-700 shrink-0">{p.occupiedCount}/{p.unitCount} units</span>
              <ExternalLink size={14} className="text-stone-300 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
