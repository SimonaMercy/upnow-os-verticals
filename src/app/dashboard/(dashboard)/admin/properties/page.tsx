/**
 * Admin all-properties browser (SCRUM-591) — every RP's properties with Map /
 * List / Grid views, reusing the shipped RP portfolio map. Read-only; each
 * property drills through to the admin property detail (SCRUM-588).
 *
 * Row and Grid bucket the portfolio under its owning rental provider — the same
 * landlord-first outline the all-units browser uses — so "whose building is this"
 * is answered by where the row sits, not by a caption. Map stays flat (one pin
 * per property, owner named in the pin card) and leans on the provider filter.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Rows3, LayoutGrid, Map as MapIcon, Building2, Search, MapPin, ExternalLink, ArrowLeft, ChevronDown } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { PortfolioMapView } from '@/app/rental-provider/dashboard/portfolio/PortfolioMapModal';

interface AdminProperty {
  id: number; buildingName: string; fullAddress: string | null; spaceCategory: string | null;
  latitude: number | null; longitude: number | null; unitCount: number; occupiedCount: number;
  coverPhotoUrl: string | null; rentalProviderId: number; ownerName: string | null; ownerUserId: number | null;
}

interface OwnerGroup {
  key: string; name: string; ownerUserId: number | null;
  properties: AdminProperty[]; unitCount: number; occupied: number;
}

const titleCase = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
/** Up to two initials for the provider avatar — "Al Nakheel Holdings" → "AN". */
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '—';
const ownerLabel = (p: AdminProperty) => p.ownerName ?? (p.rentalProviderId != null ? `RP #${p.rentalProviderId}` : 'Unassigned');
const ownerKey = (p: AdminProperty) => String(p.rentalProviderId ?? 'none');

/** Bucket the flat property list by owning rental provider, biggest portfolio first. */
function groupByOwner(list: AdminProperty[]): OwnerGroup[] {
  const byOwner = new Map<string, OwnerGroup>();
  for (const p of list) {
    const key = ownerKey(p);
    let g = byOwner.get(key);
    if (!g) {
      g = { key, name: ownerLabel(p), ownerUserId: p.ownerUserId, properties: [], unitCount: 0, occupied: 0 };
      byOwner.set(key, g);
    }
    g.properties.push(p);
    g.unitCount += p.unitCount;
    g.occupied += p.occupiedCount;
  }
  return [...byOwner.values()]
    .map((g) => {
      g.properties.sort((a, b) => a.buildingName.localeCompare(b.buildingName));
      return g;
    })
    .sort((a, b) => b.properties.length - a.properties.length || a.name.localeCompare(b.name));
}

export default function AdminPropertiesBrowser() {
  const router = useRouter();
  const [props, setProps] = useState<AdminProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'row' | 'grid' | 'map'>('row');
  const [q, setQ] = useState('');
  const [rp, setRp] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [drill, setDrill] = useState<{ category?: string; emirate?: string; availability?: string }>({});

  useEffect(() => {
    apiGet<AdminProperty[]>('/admin/properties/browser')
      .then((d) => { if (Array.isArray(d)) setProps(d); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  // Deep-link drill filters from the Overview (?category=&emirate=&availability=occupied),
  // plus ?rp= so an RP's own row anywhere else can land straight on its properties.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDrill({
      category: p.get('category') ?? undefined,
      emirate: p.get('emirate') ?? undefined,
      availability: p.get('availability') ?? undefined,
    });
    if (p.get('rp')) setRp(p.get('rp')!);
  }, []);

  /** Every provider that owns at least one property, biggest portfolio first. */
  const owners = useMemo(() => groupByOwner(props), [props]);

  const filtered = useMemo(() => {
    let list = props;
    if (rp !== 'all') list = list.filter((p) => ownerKey(p) === rp);
    if (drill.category) list = list.filter((p) => (p.spaceCategory ?? '').toLowerCase() === drill.category!.toLowerCase());
    if (drill.emirate) { const e = drill.emirate!.toLowerCase(); list = list.filter((p) => (p.fullAddress ?? '').toLowerCase().includes(e)); }
    if (drill.availability === 'occupied') list = list.filter((p) => p.occupiedCount > 0);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((p) => [p.buildingName, p.fullAddress, p.ownerName, p.spaceCategory].filter(Boolean).join(' ').toLowerCase().includes(s));
    }
    return list;
  }, [props, q, drill, rp]);

  // A handful of providers hold everything, so groups start open — unlike the units
  // browser, where a single RP's 100+ units force its buildings closed by default.
  const groups = useMemo(() => groupByOwner(filtered), [filtered]);

  // A live search always shows what it matched — collapsed state is ignored while typing.
  const searching = q.trim().length > 0;
  const isOpen = (key: string) => searching || !collapsed.has(key);
  const toggle = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

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
          <p className="text-sm text-[#6b6860] mt-1">
            {filtered.length} properties · {groups.length} rental provider{groups.length === 1 ? '' : 's'}{view === 'map' ? ` · ${withCoords} mapped` : ''}
          </p>
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

      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search building, owner, address…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] text-sm outline-none focus:border-[#2e9f82]" />
        </div>
        <select value={rp} onChange={(e) => setRp(e.target.value)} aria-label="Filter by rental provider"
          className={`min-w-[220px] px-3 py-2 rounded-xl border text-sm font-medium outline-none focus:border-[#2e9f82] ${rp === 'all' ? 'border-[#e8e6e0] text-[#3f3d39] bg-white' : 'border-[#2e9f82] text-[#1a7a5a] bg-[#f3faf7]'}`}>
          <option value="all">All rental providers ({owners.length})</option>
          {owners.map((o) => (
            <option key={o.key} value={o.key}>{o.name} ({o.properties.length})</option>
          ))}
        </select>
        {view !== 'map' && !searching && groups.length > 1 && (
          <div className="flex items-center gap-2 text-xs font-semibold">
            <button onClick={() => setCollapsed(new Set())} className="px-3 py-2 rounded-xl border border-[#e8e6e0] text-[#3f3d39] hover:bg-[#faf9f7]">Expand all</button>
            <button onClick={() => setCollapsed(new Set(groups.map((g) => g.key)))} className="px-3 py-2 rounded-xl border border-[#e8e6e0] text-[#3f3d39] hover:bg-[#faf9f7]">Collapse all</button>
          </div>
        )}
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
            properties={filtered.map((p) => ({ id: p.id, buildingName: p.buildingName, latitude: p.latitude, longitude: p.longitude, fullAddress: p.fullAddress, unitCount: p.unitCount, occupiedCount: p.occupiedCount, coverPhotoUrl: p.coverPhotoUrl, spaceCategory: p.spaceCategory ?? undefined, ownerName: ownerLabel(p) }))}
            heightClass="h-[72vh]"
            onViewDetails={(id) => router.push(`/dashboard/admin/properties/${id}`)}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const open = isOpen(g.key);
            const pct = g.unitCount > 0 ? Math.round((g.occupied / g.unitCount) * 100) : 0;
            return (
              /* ─── Tier 1 · RENTAL PROVIDER — own card, green rail + mint band ───── */
              <div key={g.key} className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden shadow-[0_1px_3px_rgba(26,25,22,0.04)]">
                <div className={`flex items-center border-l-[3px] border-l-[#2e9f82] bg-[#f3faf7] ${open ? 'border-b border-b-[#e2e9e5]' : ''}`}>
                  <button onClick={() => toggle(g.key)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left transition hover:bg-[#eaf6f1]">
                    <ChevronDown size={16} className={`text-[#5d9e8a] shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
                    <div className="w-10 h-10 rounded-xl bg-[#2e9f82] text-white grid place-items-center shrink-0 text-xs font-bold tracking-wide">{initials(g.name)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#2e9f82] leading-none mb-1">Rental provider</p>
                      <p className="text-base font-bold text-[#1a1916] truncate leading-tight">{g.name}</p>
                      <p className="text-xs text-[#6b6860] mt-1">
                        {g.properties.length} propert{g.properties.length === 1 ? 'y' : 'ies'} · {g.unitCount} unit{g.unitCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#fef9eb] text-[#b45309]">{g.occupied} occupied · {pct}%</span>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#f2f1ec] text-[#6b6860]">{g.unitCount - g.occupied} vacant</span>
                    </div>
                  </button>
                  {g.ownerUserId != null && (
                    <Link href={`/dashboard/admin/users/${g.ownerUserId}`}
                      className="mr-4 ml-2 shrink-0 rounded-lg border border-[#cfe6dd] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#1a7a5a] hover:bg-[#f0faf6]">
                      Provider
                    </Link>
                  )}
                </div>

                {open && (view === 'grid' ? (
                  /* ─── Tier 2 · PROPERTIES — photo cards on a tinted tray ────────── */
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#faf9f7] p-4">
                    {g.properties.map((p) => (
                      <Link key={p.id} href={`/dashboard/admin/properties/${p.id}`} className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden hover:shadow-md transition group">
                        <div className="h-36 bg-[#f4f3ef] relative">
                          {p.coverPhotoUrl ? <img src={p.coverPhotoUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[#c4c2bc]"><Building2 size={28} /></div>}
                          {p.spaceCategory && <span className="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/90 text-[#3f3d39]">{titleCase(p.spaceCategory)}</span>}
                        </div>
                        <div className="p-4">
                          <p className="font-semibold text-[#1a1916] truncate group-hover:text-[#1a7a5a]">{p.buildingName}</p>
                          <p className="text-xs text-[#6b6860] truncate flex items-center gap-1 mt-0.5"><MapPin size={11} /> {p.fullAddress ?? '—'}</p>
                          <p className="mt-3 text-xs font-medium text-[#3f3d39]">{p.occupiedCount}/{p.unitCount} units</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  /* ─── Tier 2 · PROPERTIES — rows hung off a tree rail ───────────── */
                  <div className="ml-6 border-l border-[#e8e6e0] divide-y divide-[#f4f2ee] bg-white">
                    {g.properties.map((p) => (
                      <Link key={p.id} href={`/dashboard/admin/properties/${p.id}`} className="flex items-center gap-4 p-4 hover:bg-[#faf9f7] transition">
                        <div className="w-14 h-14 rounded-xl bg-[#f4f3ef] overflow-hidden shrink-0 grid place-items-center text-[#c4c2bc]">
                          {p.coverPhotoUrl ? <img src={p.coverPhotoUrl} alt="" className="w-full h-full object-cover" /> : <Building2 size={20} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[#1a1916] truncate">{p.buildingName}</p>
                          <p className="text-xs text-[#6b6860] truncate">{p.fullAddress ?? '—'}</p>
                          {p.spaceCategory && <p className="text-[11px] text-[#9b9890] mt-0.5">{titleCase(p.spaceCategory)}</p>}
                        </div>
                        <span className="text-sm font-medium text-[#3f3d39] shrink-0">{p.occupiedCount}/{p.unitCount} units</span>
                        <ExternalLink size={14} className="text-[#c4c2bc] shrink-0" />
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
