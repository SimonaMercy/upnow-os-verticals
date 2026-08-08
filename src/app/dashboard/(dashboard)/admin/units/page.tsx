/**
 * Admin all-units browser — every RP's units, grouped landlord → building, the
 * unit-first counterpart to the properties browser. Read-only; each row drills
 * through to the admin unit detail (which chains on to property · owner · current
 * tenant). Deep-linkable from the Overview via ?unitType= and ?availability=.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Home, Search, ChevronRight, ChevronDown, Building2, ArrowLeft } from 'lucide-react';
import { apiGet } from '@/lib/api';

interface AdminUnit {
  id: number; unitNumber: string | null; unitName: string | null; unitType: string | null;
  availability: string | null; rentalPrice: number | null; bedrooms: number | null; sizeSqm: number | null;
  isListed: boolean; propertyId: number | null; buildingName: string | null; spaceCategory: string | null;
  fullAddress: string | null; rentalProviderId: number | null; ownerName: string | null; ownerUserId: number | null;
  contractId: number | null; tenantName: string | null; tenantUserId: number | null;
}

interface BuildingGroup { key: string; name: string; address: string | null; propertyId: number | null; units: AdminUnit[]; occupied: number }
interface LandlordGroup { key: string; name: string; rentalProviderId: number | null; buildings: BuildingGroup[]; unitCount: number; occupied: number }

const titleCase = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const aed = (v: number | null) => (v == null ? '—' : `AED ${Number(v).toLocaleString('en-AE')}`);
const isOccupied = (u: AdminUnit) => u.availability === 'occupied';
/** Up to two initials for the landlord avatar — "Al Nakheel Holdings" → "AN". */
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '—';
const availColor: Record<string, { bg: string; color: string }> = {
  occupied: { bg: '#fef9eb', color: '#b45309' },
  available: { bg: '#f0faf6', color: '#1a7a5a' },
};

/** Bucket the flat unit list into landlord → building, biggest landlord first. */
function groupUnits(units: AdminUnit[]): LandlordGroup[] {
  const byLandlord = new Map<string, { name: string; rentalProviderId: number | null; buildings: Map<string, BuildingGroup> }>();

  for (const u of units) {
    const lKey = u.rentalProviderId != null ? `rp:${u.rentalProviderId}` : 'rp:none';
    let landlord = byLandlord.get(lKey);
    if (!landlord) {
      landlord = {
        name: u.ownerName ?? (u.rentalProviderId != null ? `RP #${u.rentalProviderId}` : 'Unassigned'),
        rentalProviderId: u.rentalProviderId,
        buildings: new Map(),
      };
      byLandlord.set(lKey, landlord);
    }

    const bKey = u.propertyId != null ? `p:${u.propertyId}` : `b:${u.buildingName ?? 'none'}`;
    let building = landlord.buildings.get(bKey);
    if (!building) {
      building = { key: `${lKey}|${bKey}`, name: u.buildingName ?? 'Unnamed building', address: u.fullAddress, propertyId: u.propertyId, units: [], occupied: 0 };
      landlord.buildings.set(bKey, building);
    }
    building.units.push(u);
    if (isOccupied(u)) building.occupied += 1;
  }

  return [...byLandlord.entries()]
    .map(([key, l]) => {
      const buildings = [...l.buildings.values()].sort((a, b) => a.name.localeCompare(b.name));
      for (const b of buildings) {
        b.units.sort((a, c) => (a.unitNumber ?? '').localeCompare(c.unitNumber ?? '', undefined, { numeric: true }));
      }
      return {
        key,
        name: l.name,
        rentalProviderId: l.rentalProviderId,
        buildings,
        unitCount: buildings.reduce((s, b) => s + b.units.length, 0),
        occupied: buildings.reduce((s, b) => s + b.occupied, 0),
      };
    })
    .sort((a, b) => b.unitCount - a.unitCount || a.name.localeCompare(b.name));
}

export default function AdminUnitsBrowser() {
  const router = useRouter();
  const [units, setUnits] = useState<AdminUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [drill, setDrill] = useState<{ unitType?: string; availability?: string }>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    apiGet<AdminUnit[]>('/admin/units')
      .then((d) => { if (Array.isArray(d)) setUnits(d); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  // Deep-link drill filters from the Overview (?unitType=&availability=occupied).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDrill({ unitType: p.get('unitType') ?? undefined, availability: p.get('availability') ?? undefined });
  }, []);

  const filtered = useMemo(() => {
    let list = units;
    if (drill.unitType) list = list.filter((u) => (u.unitType ?? '').toLowerCase() === drill.unitType!.toLowerCase());
    if (drill.availability) list = list.filter((u) => (u.availability ?? '') === drill.availability);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((u) => [u.unitNumber, u.unitName, u.buildingName, u.fullAddress, u.ownerName, u.tenantName, u.unitType].filter(Boolean).join(' ').toLowerCase().includes(s));
    }
    return list;
  }, [units, q, drill]);

  const groups = useMemo(() => groupUnits(filtered), [filtered]);
  const buildingCount = groups.reduce((s, g) => s + g.buildings.length, 0);

  // Open on the landlord → building outline: a single RP can hold 100+ units, so
  // buildings start closed and you drill into the one you want. Seeded once.
  useEffect(() => {
    if (seeded.current || units.length === 0) return;
    seeded.current = true;
    setCollapsed(new Set(groupUnits(units).flatMap((g) => g.buildings.map((b) => b.key))));
  }, [units]);

  // A live search always shows what it matched — collapsed state is ignored while typing.
  const searching = q.trim().length > 0;
  const isOpen = (key: string) => searching || !collapsed.has(key);
  const toggle = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const collapseAll = () => setCollapsed(new Set(groups.flatMap((g) => [g.key, ...g.buildings.map((b) => b.key)])));

  const activeDrill = [
    drill.unitType && titleCase(drill.unitType),
    drill.availability && titleCase(drill.availability),
  ].filter(Boolean) as string[];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">All units</h1>
          <p className="text-sm text-[#6b6860] mt-1">
            {filtered.length} units · {buildingCount} building{buildingCount === 1 ? '' : 's'} · {groups.length} landlord{groups.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search unit, building, owner, tenant…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] text-sm outline-none focus:border-[#2e9f82]" />
        </div>
        {!searching && groups.length > 0 && (
          <div className="flex items-center gap-2 text-xs font-semibold">
            <button onClick={() => setCollapsed(new Set())} className="px-3 py-2 rounded-xl border border-[#e8e6e0] text-[#3f3d39] hover:bg-[#faf9f7]">Expand all</button>
            <button onClick={collapseAll} className="px-3 py-2 rounded-xl border border-[#e8e6e0] text-[#3f3d39] hover:bg-[#faf9f7]">Collapse all</button>
          </div>
        )}
      </div>

      {activeDrill.length > 0 && (
        <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
          <span className="text-[#6b6860]">Filtered:</span>
          {activeDrill.map((d) => (
            <span key={d} className="px-2.5 py-1 rounded-full bg-[#f0faf6] text-[#1a7a5a] font-medium text-xs">{d}</span>
          ))}
          <Link href="/dashboard/admin/units" onClick={() => setDrill({})} className="text-xs font-semibold text-[#6b6860] hover:text-[#3f3d39] underline">Clear</Link>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center text-[#9b9890]">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center text-[#9b9890]">No units match.</div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const open = isOpen(g.key);
            const pct = g.unitCount > 0 ? Math.round((g.occupied / g.unitCount) * 100) : 0;
            return (
              /* ─── Tier 1 · LANDLORD — own card, green rail + mint band ─────────── */
              <div key={g.key} className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden shadow-[0_1px_3px_rgba(26,25,22,0.04)]">
                <button
                  onClick={() => toggle(g.key)}
                  className={`w-full flex items-center gap-3 p-4 text-left border-l-[3px] border-l-[#2e9f82] bg-[#f3faf7] hover:bg-[#eaf6f1] transition ${open ? 'border-b border-b-[#e2e9e5]' : ''}`}
                >
                  <ChevronDown size={16} className={`text-[#5d9e8a] shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
                  <div className="w-10 h-10 rounded-xl bg-[#2e9f82] text-white grid place-items-center shrink-0 text-xs font-bold tracking-wide">{initials(g.name)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#2e9f82] leading-none mb-1">Landlord</p>
                    <p className="text-base font-bold text-[#1a1916] truncate leading-tight">{g.name}</p>
                    <p className="text-xs text-[#6b6860] mt-1">
                      {g.buildings.length} building{g.buildings.length === 1 ? '' : 's'} · {g.unitCount} unit{g.unitCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#fef9eb] text-[#b45309]">{g.occupied} occupied · {pct}%</span>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#f2f1ec] text-[#6b6860]">{g.unitCount - g.occupied} vacant</span>
                  </div>
                </button>

                {open && (
                  <div>
                    {g.buildings.map((b, bi) => {
                      const bOpen = isOpen(b.key);
                      return (
                        /* ─── Tier 2 · BUILDING — grey band, indented, boxed icon ──── */
                        <div key={b.key}>
                          <button
                            onClick={() => toggle(b.key)}
                            className={`w-full flex items-center gap-2.5 py-2.5 pl-6 pr-4 text-left bg-[#f7f6f3] hover:bg-[#f1efe9] transition ${bi > 0 ? 'border-t border-[#eae7e1]' : ''}`}
                          >
                            <ChevronDown size={14} className={`text-[#9b9890] shrink-0 transition-transform ${bOpen ? '' : '-rotate-90'}`} />
                            <div className="w-7 h-7 rounded-lg bg-white border border-[#e4e1da] grid place-items-center text-[#6b6860] shrink-0"><Building2 size={14} /></div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-semibold text-[#3f3d39] truncate leading-tight">
                                <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#a9a69e] mr-2">Building</span>
                                {b.name}
                              </p>
                              {b.address && <p className="text-[11px] text-[#9b9890] truncate mt-0.5">{b.address}</p>}
                            </div>
                            <span className="text-[11px] font-medium text-[#6b6860] shrink-0">{b.units.length} unit{b.units.length === 1 ? '' : 's'} · {b.occupied} occupied</span>
                            {b.units.length - b.occupied > 0 && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white border border-[#e4e1da] text-[#b45309] shrink-0">{b.units.length - b.occupied} vacant</span>
                            )}
                          </button>

                          {/* ─── Tier 3 · UNITS — white, hung off a tree rail ─────── */}
                          {bOpen && (
                            <div className="ml-12 border-l border-[#e8e6e0] divide-y divide-[#f4f2ee] bg-white">
                              {b.units.map((u) => {
                                const ac = availColor[u.availability ?? ''] ?? { bg: '#f5f4f0', color: '#6b6860' };
                                return (
                                  <Link key={u.id} href={`/dashboard/admin/units/${u.id}`} className="flex items-center gap-3 py-2.5 pl-4 pr-4 hover:bg-[#faf9f7] transition">
                                    <div className="w-8 h-8 rounded-lg bg-[#f5f4f0] grid place-items-center text-[#a9a69e] shrink-0">
                                      <Home size={15} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[13px] font-semibold text-[#1a1916] truncate leading-tight">Unit {u.unitNumber ?? '—'}</p>
                                      <p className="text-[11px] text-[#9b9890] mt-0.5 truncate">
                                        {u.unitType ? titleCase(u.unitType) : '—'}
                                        {u.bedrooms != null ? ` · ${u.bedrooms} bed` : ''}
                                        {u.tenantName ? ` · Tenant: ${u.tenantName}` : ''}
                                      </p>
                                    </div>
                                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: ac.bg, color: ac.color }}>{titleCase(u.availability)}</span>
                                    <span className="text-[13px] font-semibold text-[#3f3d39] shrink-0 w-28 text-right">{u.rentalPrice != null ? `${aed(u.rentalPrice)}/yr` : '—'}</span>
                                    <ChevronRight size={15} className="text-[#c4c2bc] shrink-0" />
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
