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

type LeasingType = 'direct' | 'sub' | 'management';
interface ExternalOwner { name: string | null; ownershipPct: number; isPrimary: boolean }
interface AdminProperty {
  id: number; buildingName: string; fullAddress: string | null; spaceCategory: string | null;
  latitude: number | null; longitude: number | null; unitCount: number; occupiedCount: number;
  coverPhotoUrl: string | null; rentalProviderId: number; ownerName: string | null; ownerUserId: number | null;
  leasingType?: LeasingType | null; externalOwners?: ExternalOwner[];
}

const titleCase = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');

// Ownership / leasing model — mirrors the RP portfolio + manager grouping.
const OWNERSHIP: Record<LeasingType, { label: string; color: string; bg: string }> = {
  direct:     { label: 'Owned',     color: '#1a6b4d', bg: '#e6f3ec' },
  sub:        { label: 'Sub-lease', color: '#6d4fa1', bg: '#f0eaf8' },
  management: { label: 'Managed',   color: '#8a6d2e', bg: '#f6f0e0' },
};
const ownershipOf = (p: AdminProperty): LeasingType => (p.leasingType === 'sub' || p.leasingType === 'management' ? p.leasingType : 'direct');
/** For a managed property show the real owner (primary); else the owning RP. */
const displayOwner = (p: AdminProperty): string => {
  if (p.leasingType === 'management' && p.externalOwners?.length) {
    const primary = p.externalOwners.find((o) => o.isPrimary) ?? p.externalOwners[0];
    const extra = p.externalOwners.length > 1 ? ` +${p.externalOwners.length - 1}` : '';
    return `${primary.name ?? 'Owner'}${extra} · mgd by ${p.ownerName ?? `RP #${p.rentalProviderId}`}`;
  }
  return p.ownerName ?? `RP #${p.rentalProviderId}`;
};

function OwnershipChip({ p }: { p: AdminProperty }) {
  const o = OWNERSHIP[ownershipOf(p)];
  return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0" style={{ color: o.color, background: o.bg }}>{o.label}</span>;
}

export default function AdminPropertiesBrowser() {
  const router = useRouter();
  const [props, setProps] = useState<AdminProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'row' | 'grid' | 'map'>('row');
  const [q, setQ] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | LeasingType>('all');

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
    if (ownershipFilter !== 'all') list = list.filter((p) => ownershipOf(p) === ownershipFilter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((p) => [p.buildingName, p.fullAddress, p.ownerName, p.spaceCategory, ...(p.externalOwners?.map((o) => o.name) ?? [])].filter(Boolean).join(' ').toLowerCase().includes(s));
    }
    return list;
  }, [props, q, drill, ownershipFilter]);

  // Group by ownership model (largest group first; tie → Owned/Sub/Managed order)
  // so the admin browser reads the same way as the RP portfolio + manager pages.
  const ownershipGroups = useMemo(() => {
    const order: LeasingType[] = ['direct', 'sub', 'management'];
    const by = new Map<LeasingType, AdminProperty[]>();
    for (const p of filtered) { const k = ownershipOf(p); (by.get(k) ?? by.set(k, []).get(k)!).push(p); }
    return order.filter((k) => by.has(k))
      .map((k) => ({ key: k, ...OWNERSHIP[k], items: by.get(k)! }))
      .sort((a, b) => b.items.length - a.items.length || order.indexOf(a.key) - order.indexOf(b.key));
  }, [filtered]);

  const activeDrill = [
    drill.category && titleCase(drill.category),
    drill.emirate,
    drill.availability === 'occupied' && 'Occupied only',
  ].filter(Boolean) as string[];

  const withCoords = filtered.filter((p) => p.latitude != null && p.longitude != null).length;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">All properties</h1>
          <p className="text-sm text-[#6b6860] mt-1">{filtered.length} properties across every rental provider{view === 'map' ? ` · ${withCoords} mapped` : ''}</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#f4f3ef]">
          {([['row', Rows3, 'Row'], ['grid', LayoutGrid, 'Grid'], ['map', MapIcon, 'Map']] as const).map(([v, Icon, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${view === v ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860] hover:text-[#3f3d39]'}`}>
              <Icon size={15} /> <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search building, owner, address…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] text-sm outline-none focus:border-[#2e9f82]" />
        </div>
        <select value={ownershipFilter} onChange={(e) => setOwnershipFilter(e.target.value as 'all' | LeasingType)}
          className="py-2 px-3 rounded-xl border border-[#e8e6e0] text-sm outline-none focus:border-[#2e9f82] bg-white">
          <option value="all">All ownership</option>
          <option value="direct">Owned</option>
          <option value="sub">Sub-lease</option>
          <option value="management">Managed</option>
        </select>
      </div>

      {activeDrill.length > 0 && (
        <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
          <span className="text-[#6b6860]">Filtered:</span>
          {activeDrill.map((d) => (
            <span key={d} className="px-2.5 py-1 rounded-full bg-[#f0faf6] text-[#1a7a5a] font-medium text-xs">{d}</span>
          ))}
          <button onClick={() => { setDrill({}); router.replace('/dashboard/admin/properties'); }} className="text-xs font-semibold text-[#6b6860] hover:text-[#3f3d39] underline">Clear</button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center text-[#9b9890]">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center text-[#9b9890]">No properties match.</div>
      ) : view === 'map' ? (
        <div className="bg-white rounded-2xl p-2 border border-[#e8e6e0]">
          <PortfolioMapView
            properties={filtered.map((p) => ({ id: p.id, buildingName: p.buildingName, latitude: p.latitude, longitude: p.longitude, fullAddress: p.fullAddress, unitCount: p.unitCount, occupiedCount: p.occupiedCount, coverPhotoUrl: p.coverPhotoUrl, spaceCategory: p.spaceCategory ?? undefined }))}
            heightClass="h-[72vh]"
            onViewDetails={(id) => router.push(`/dashboard/admin/properties/${id}`)}
          />
        </div>
      ) : view === 'grid' ? (
        <div className="space-y-7">
          {ownershipGroups.map((g) => (
            <section key={g.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: g.color }} />
                <h2 className="text-sm font-bold text-[#1a1916]">{g.label}</h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">{g.items.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {g.items.map((p) => (
                  <Link key={p.id} href={`/dashboard/admin/properties/${p.id}`} className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden hover:shadow-md transition group">
                    <div className="h-36 bg-[#f4f3ef] relative">
                      {p.coverPhotoUrl ? <img src={p.coverPhotoUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[#c4c2bc]"><Building2 size={28} /></div>}
                      {p.spaceCategory && <span className="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/90 text-[#3f3d39]">{titleCase(p.spaceCategory)}</span>}
                      <span className="absolute top-2 right-2"><OwnershipChip p={p} /></span>
                    </div>
                    <div className="p-4">
                      <p className="font-semibold text-[#1a1916] truncate group-hover:text-[#1a7a5a]">{p.buildingName}</p>
                      <p className="text-xs text-[#6b6860] truncate flex items-center gap-1 mt-0.5"><MapPin size={11} /> {p.fullAddress ?? '—'}</p>
                      <div className="flex items-center justify-between mt-3 text-xs text-[#6b6860]">
                        <span className="truncate">{displayOwner(p)}</span>
                        <span className="shrink-0 font-medium text-[#3f3d39]">{p.occupiedCount}/{p.unitCount} units</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-7">
          {ownershipGroups.map((g) => (
            <section key={g.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: g.color }} />
                <h2 className="text-sm font-bold text-[#1a1916]">{g.label}</h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">{g.items.length}</span>
              </div>
              <div className="rounded-2xl border border-[#e8e6e0] bg-white divide-y divide-[#f0ede8] overflow-hidden">
                {g.items.map((p) => (
                  <Link key={p.id} href={`/dashboard/admin/properties/${p.id}`} className="flex items-center gap-4 p-4 hover:bg-[#faf9f7] transition">
                    <div className="w-16 h-16 rounded-xl bg-[#f4f3ef] overflow-hidden shrink-0 grid place-items-center text-[#c4c2bc]">
                      {p.coverPhotoUrl ? <img src={p.coverPhotoUrl} alt="" className="w-full h-full object-cover" /> : <Building2 size={22} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="font-semibold text-[#1a1916] truncate">{p.buildingName}</p><OwnershipChip p={p} /></div>
                      <p className="text-xs text-[#6b6860] truncate">{p.fullAddress ?? '—'}</p>
                      <p className="text-xs text-[#9b9890] mt-0.5">{displayOwner(p)}{p.spaceCategory ? ` · ${titleCase(p.spaceCategory)}` : ''}</p>
                    </div>
                    <span className="text-sm font-medium text-[#3f3d39] shrink-0">{p.occupiedCount}/{p.unitCount} units</span>
                    <ExternalLink size={14} className="text-[#c4c2bc] shrink-0" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
