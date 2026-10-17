/**
 * Admin all-units browser — every RP's units, grouped landlord → building, the
 * unit-first counterpart to the properties browser. Read-only; each row drills
 * through to the admin unit detail (which chains on to property · owner · current
 * customer). Deep-linkable from the Overview via ?unitType= and ?availability=.
 *
 * Parity with previous page (Genspark kit rebuild):
 *  - API: GET /admin/units (array; failure → empty list, as before).
 *  - Search (unit no./name, building, address, owner, customer, unit type).
 *  - Deep-link drill filters ?unitType= and ?availability=; "Filtered:" chips + Clear
 *    (resets drill + router.replace to the bare route). Availability is now also switchable from a
 *    Seg (All / Available / Occupied / other statuses present) — same `drill.availability` filter.
 *  - Landlord → building → unit outline, biggest landlord first, buildings A–Z, units
 *    numeric-sorted. Buildings start collapsed (seeded once); landlord and building
 *    headers toggle; Expand all / Collapse all (hidden while searching / when empty);
 *    searching ignores collapse state.
 *  - Landlord header: initials, building + unit counts, occupied · % and vacant pills.
 *  - Building header: name, address, unit + occupied counts, vacant pill.
 *  - Unit row: Unit no., type, beds (residential types only — isResidentialUnitType),
 *    customer name, availability pill, rent/yr (whole AED) → /dashboard/admin/units/:id
 *    (labelled "Open" button + row click).
 *  - Header counts line (units · buildings · landlords); Back button (router.back()).
 *  - Loading skeleton / "No units match" empty state.
 *  - Added: KPI strip derived from the same list (no new data); "All properties" link.
 */
'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import {
  Btn, EmptyRow, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, SearchField, Seg, SkeletonRows, StatusTag, TableWrap,
  fmtAed, humanize, initials,
} from '@/components/os/kit';

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
const isOccupied = (u: AdminUnit) => u.availability === 'occupied';
const COLS = 7;

/** Beds column — residential types only; 0 bedrooms reads as Studio. */
const bedsOf = (u: AdminUnit) =>
  !isResidentialUnitType(u.unitType) || u.bedrooms == null ? '—' : u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} bed`;

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

const headBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', background: 'none', border: 0, padding: 0,
  cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left',
};

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL filter restore after hydration
    setDrill({ unitType: p.get('unitType') ?? undefined, availability: p.get('availability') ?? undefined });
  }, []);

  /** Units after the unit-type drill + search, before the availability filter — feeds the Seg counts. */
  const preAvail = useMemo(() => {
    let list = units;
    if (drill.unitType) list = list.filter((u) => (u.unitType ?? '').toLowerCase() === drill.unitType!.toLowerCase());
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((u) => [u.unitNumber, u.unitName, u.buildingName, u.fullAddress, u.ownerName, u.tenantName, u.unitType].filter(Boolean).join(' ').toLowerCase().includes(s));
    }
    return list;
  }, [units, q, drill.unitType]);

  const filtered = useMemo(
    () => (drill.availability ? preAvail.filter((u) => (u.availability ?? '') === drill.availability) : preAvail),
    [preAvail, drill.availability],
  );

  const availOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of preAvail) if (u.availability) counts.set(u.availability, (counts.get(u.availability) ?? 0) + 1);
    const keys = ['available', 'occupied', ...[...counts.keys()].filter((k) => k !== 'available' && k !== 'occupied').sort()];
    if (drill.availability && !keys.includes(drill.availability)) keys.push(drill.availability);
    return [{ v: 'all', l: 'All', n: preAvail.length }, ...keys.map((k) => ({ v: k, l: humanize(k), n: counts.get(k) ?? 0 }))];
  }, [preAvail, drill.availability]);

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

  const occ = filtered.filter(isOccupied).length;
  const avail = filtered.filter((u) => u.availability === 'available').length;
  const listed = filtered.filter((u) => u.isListed).length;

  const toolbar = (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Search unit, building, owner, customer…" />
      <Seg label="Availability" value={drill.availability ?? 'all'} options={availOptions}
        onChange={(v) => setDrill((d) => ({ ...d, availability: v === 'all' ? undefined : v }))} />
      <span className="sp" />
      {!searching && groups.length > 0 && (
        <>
          <Btn size="sm" onClick={() => setCollapsed(new Set())}>Expand all</Btn>
          <Btn size="sm" onClick={collapseAll}>Collapse all</Btn>
        </>
      )}
    </>
  );

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Inventory"
        title="All units"
        lede={`${filtered.length} units · ${buildingCount} building${buildingCount === 1 ? '' : 's'} · ${groups.length} landlord${groups.length === 1 ? '' : 's'}. Read-only — open a unit for its specs, pricing, documents and current tenancy.`}
        actions={<>
          <Btn onClick={() => router.back()}>Back</Btn>
          <Btn href="/dashboard/admin/properties">All properties</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Inventory' },
        { label: 'Unit type', value: drill.unitType ? titleCase(drill.unitType) : 'All' },
        { label: 'Availability', value: drill.availability ? titleCase(drill.availability) : 'All' },
      ]} />

      {!loading && (
        <Kpis>
          <Kpi k="Units" v={filtered.length} d={`${buildingCount} buildings`} />
          <Kpi k="Occupied" v={occ} d={filtered.length ? `${Math.round((occ / filtered.length) * 100)}% of shown` : undefined} dark />
          <Kpi k="Available" v={avail} />
          <Kpi k="Listed" v={listed} d="published to the marketplace" />
        </Kpis>
      )}

      {activeDrill.length > 0 && (
        <div className="gx-btn-row" style={{ marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Filtered:</span>
          {activeDrill.map((d) => <Pill key={d} tone="primary">{d}</Pill>)}
          <Btn size="xs" variant="ghost" onClick={() => { setDrill({}); router.replace('/dashboard/admin/units'); }}>Clear</Btn>
        </div>
      )}

      {loading || groups.length === 0 ? (
        <TableWrap toolbar={toolbar}>
          <table className="gx-tbl">
            {loading ? <SkeletonRows rows={8} cols={COLS} />
              : <EmptyRow cols={COLS} title="No units match." text=" Clear the search or filters to see every unit." />}
          </table>
        </TableWrap>
      ) : (
        <>
          <div className="gx-tbl-wrap"><div className="gx-tbar" style={{ borderBottom: 0 }}>{toolbar}</div></div>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {groups.map((g) => {
              const open = isOpen(g.key);
              const pct = g.unitCount > 0 ? Math.round((g.occupied / g.unitCount) * 100) : 0;
              return (
                <section key={g.key} className="gx-card" style={{ overflow: 'hidden' }}>
                  {/* Tier 1 · LANDLORD */}
                  <div className="gx-card-hd" style={{ background: 'var(--ms-tint-pale)', borderLeft: '3px solid var(--ms-primary)' }}>
                    <button type="button" onClick={() => toggle(g.key)} aria-expanded={open} style={headBtn}>
                      <ChevronDown size={15} style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform .15s', flexShrink: 0 }} aria-hidden />
                      <span className="gx-thumb">{initials(g.name)}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="gx-eyebrow" style={{ display: 'block' }}>Landlord</span>
                        <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</h3>
                        <span className="sub" style={{ display: 'block' }}>
                          {g.buildings.length} building{g.buildings.length === 1 ? '' : 's'} · {g.unitCount} unit{g.unitCount === 1 ? '' : 's'}
                        </span>
                      </span>
                    </button>
                    <div className="right">
                      <Pill tone="amber">{g.occupied} occupied · {pct}%</Pill>
                      <Pill tone="neutral">{g.unitCount - g.occupied} vacant</Pill>
                    </div>
                  </div>

                  {open && (
                    <div className="gx-tbl-scroll">
                      <table className="gx-tbl">
                        <thead>
                          <tr><th>Unit</th><th>Type</th><th>Beds</th><th>Customer</th><th>Status</th><th className="num">Rent / yr</th><th className="act"><span className="sr-only">Actions</span></th></tr>
                        </thead>
                        <tbody>
                          {g.buildings.map((b) => {
                            const bOpen = isOpen(b.key);
                            const vacant = b.units.length - b.occupied;
                            return (
                              <Fragment key={b.key}>
                                {/* Tier 2 · BUILDING */}
                                <tr>
                                  <td colSpan={COLS} style={{ background: 'var(--ms-surface-2)' }}>
                                    <button type="button" onClick={() => toggle(b.key)} aria-expanded={bOpen} style={headBtn}>
                                      <ChevronDown size={13} style={{ transform: bOpen ? undefined : 'rotate(-90deg)', transition: 'transform .15s', flexShrink: 0 }} aria-hidden />
                                      <span style={{ minWidth: 0, flex: 1 }}>
                                        <span className="strong">{b.name}</span>
                                        {b.address && <span className="sub">{b.address}</span>}
                                      </span>
                                      <span className="nowrap">{b.units.length} unit{b.units.length === 1 ? '' : 's'} · {b.occupied} occupied</span>
                                      {vacant > 0 && <Pill tone="amber">{vacant} vacant</Pill>}
                                    </button>
                                  </td>
                                </tr>
                                {/* Tier 3 · UNITS */}
                                {bOpen && b.units.map((u) => (
                                  <tr key={u.id} className="click" onClick={() => router.push(`/dashboard/admin/units/${u.id}`)}>
                                    <td style={{ paddingLeft: 32 }}>
                                      <span className="strong">Unit {u.unitNumber ?? '—'}</span>
                                      {u.unitName && <span className="sub">{u.unitName}</span>}
                                    </td>
                                    <td>{u.unitType ? <Pill tone="outline" dot={false}>{titleCase(u.unitType)}</Pill> : '—'}</td>
                                    <td className="nowrap">{bedsOf(u)}</td>
                                    <td>{u.tenantName ?? '—'}</td>
                                    <td><StatusTag status={u.availability} label={titleCase(u.availability)} /></td>
                                    <td className="num strong">{u.rentalPrice != null ? fmtAed(u.rentalPrice) : '—'}</td>
                                    <td className="act" onClick={(e) => e.stopPropagation()}><Btn size="xs" href={`/dashboard/admin/units/${u.id}`}>Open</Btn></td>
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </OsPage>
  );
}
