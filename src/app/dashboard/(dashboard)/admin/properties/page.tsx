/**
 * Admin all-properties browser (SCRUM-591) — every RP's properties with Map /
 * List / Grid views, reusing the shipped RP portfolio map. Read-only; each
 * property drills through to the admin property detail (SCRUM-588).
 *
 * List and Grid bucket the portfolio under its owning rental provider — the same
 * landlord-first outline the all-units browser uses — so "whose building is this"
 * is answered by where the row sits, not by a caption. Map stays flat (one pin
 * per property, owner named in the pin card) and leans on the provider filter.
 *
 * Parity with previous page (Genspark kit rebuild):
 *  - API: GET /admin/properties/browser (array; failure → empty list, as before).
 *  - Views Row/Grid/Map (now a kit Seg: List / Grid / Map). Map reuses PortfolioMapView
 *    as-is (same props, heightClass h-[72vh], onViewDetails → /dashboard/admin/properties/:id).
 *  - Search (building, address, owner, category); rental-provider select with counts.
 *  - Deep-link drill filters ?category= ?emirate= ?availability=occupied, plus ?rp=;
 *    "Filtered:" chips with Clear (resets drill + router.replace to the bare route).
 *  - Owner groups (biggest portfolio first) collapsible; Expand all / Collapse all
 *    (hidden on map / while searching / with ≤1 group); searching ignores collapse state.
 *  - Group header: initials avatar, property + unit counts, occupied · % and vacant pills,
 *    "Provider" link → /dashboard/admin/users/:ownerUserId.
 *  - Each property → /dashboard/admin/properties/:id (row: labelled "Open" button; grid: card link).
 *  - Header count line (properties · providers · mapped on map view); Back button (router.back()).
 *  - Loading / "No properties match" empty state.
 *  - Added: KPI strip derived from the same list (no new data).
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, ChevronDown, MapPin } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { PortfolioMapView } from '@/app/rental-provider/dashboard/portfolio/PortfolioMapModal';
import {
  Btn, Card, EmptyRow, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, SearchField, Seg, SkeletonRows, TableWrap, Thumb,
  humanize, initials,
} from '@/components/os/kit';

interface AdminProperty {
  id: number; buildingName: string; fullAddress: string | null; spaceCategory: string | null;
  latitude: number | null; longitude: number | null; unitCount: number; occupiedCount: number;
  coverPhotoUrl: string | null; rentalProviderId: number; ownerName: string | null; ownerUserId: number | null;
}

interface OwnerGroup {
  key: string; name: string; ownerUserId: number | null;
  properties: AdminProperty[]; unitCount: number; occupied: number;
}

type View = 'row' | 'grid' | 'map';

const titleCase = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const ownerLabel = (p: AdminProperty) => p.ownerName ?? (p.rentalProviderId != null ? `RP #${p.rentalProviderId}` : 'Unassigned');
const ownerKey = (p: AdminProperty) => String(p.rentalProviderId ?? 'none');
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

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

/** Occupancy as a small bar + "n/m". */
function OccBar({ occupied, total }: { occupied: number; total: number }) {
  const pct = pctOf(occupied, total);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <span className="gx-bar" style={{ flex: 1, minWidth: 50 }}><i style={{ width: `${pct}%` }} /></span>
      <span className="nowrap">{occupied}/{total}</span>
    </span>
  );
}

export default function AdminPropertiesBrowser() {
  const router = useRouter();
  const [props, setProps] = useState<AdminProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('row');
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL filter restore after hydration
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
  const totalUnits = filtered.reduce((s, p) => s + p.unitCount, 0);
  const totalOcc = filtered.reduce((s, p) => s + p.occupiedCount, 0);

  const toolbar = (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Search building, owner, address…" />
      <select value={rp} onChange={(e) => setRp(e.target.value)} aria-label="Filter by rental provider" className="gx-sel" style={{ minWidth: 220 }}>
        <option value="all">All rental providers ({owners.length})</option>
        {owners.map((o) => (
          <option key={o.key} value={o.key}>{o.name} ({o.properties.length})</option>
        ))}
      </select>
      <span className="sp" />
      {view !== 'map' && !searching && groups.length > 1 && (
        <>
          <Btn size="sm" onClick={() => setCollapsed(new Set())}>Expand all</Btn>
          <Btn size="sm" onClick={() => setCollapsed(new Set(groups.map((g) => g.key)))}>Collapse all</Btn>
        </>
      )}
      <Seg<View> label="View" value={view} onChange={setView}
        options={[{ v: 'row', l: 'List' }, { v: 'grid', l: 'Grid' }, { v: 'map', l: 'Map' }]} />
    </>
  );

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Inventory"
        title="All properties"
        lede={`${filtered.length} properties · ${groups.length} rental provider${groups.length === 1 ? '' : 's'}${view === 'map' ? ` · ${withCoords} mapped` : ''}. Read-only — open a property for its units, documents and owner.`}
        actions={<>
          <Btn onClick={() => router.back()}>Back</Btn>
          <Btn href="/dashboard/admin/units">All units</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Inventory' },
        { label: 'Provider', value: rp === 'all' ? 'All rental providers' : (owners.find((o) => o.key === rp)?.name ?? rp) },
        { label: 'View', value: view === 'row' ? 'List' : view === 'grid' ? 'Grid' : 'Map' },
      ]} />

      {!loading && (
        <Kpis>
          <Kpi k="Properties" v={filtered.length} d={`${withCoords} with map pins`} />
          <Kpi k="Rental providers" v={groups.length} />
          <Kpi k="Units" v={totalUnits} href="/dashboard/admin/units" />
          <Kpi k="Occupied units" v={`${pctOf(totalOcc, totalUnits)}%`} d={`${totalOcc}/${totalUnits} occupied`} dark />
        </Kpis>
      )}

      {activeDrill.length > 0 && (
        <div className="gx-btn-row" style={{ marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Filtered:</span>
          {activeDrill.map((d) => <Pill key={d} tone="primary">{d}</Pill>)}
          <Btn size="xs" variant="ghost" onClick={() => { setDrill({}); router.replace('/dashboard/admin/properties'); }}>Clear</Btn>
        </div>
      )}

      {loading || filtered.length === 0 || view === 'map' ? (
        <TableWrap toolbar={toolbar}>
          {loading ? (
            <table className="gx-tbl"><SkeletonRows rows={6} cols={5} /></table>
          ) : filtered.length === 0 ? (
            <table className="gx-tbl"><EmptyRow cols={1} title="No properties match." text=" Clear the search, provider or drill filters to see every property." /></table>
          ) : (
            <div style={{ padding: 8 }}>
              <PortfolioMapView
                properties={filtered.map((p) => ({ id: p.id, buildingName: p.buildingName, latitude: p.latitude, longitude: p.longitude, fullAddress: p.fullAddress, unitCount: p.unitCount, occupiedCount: p.occupiedCount, coverPhotoUrl: p.coverPhotoUrl, spaceCategory: p.spaceCategory ?? undefined, ownerName: ownerLabel(p) }))}
                heightClass="h-[72vh]"
                onViewDetails={(id) => router.push(`/dashboard/admin/properties/${id}`)}
              />
            </div>
          )}
        </TableWrap>
      ) : (
        <>
          <div className="gx-tbl-wrap"><div className="gx-tbar" style={{ borderBottom: 0 }}>{toolbar}</div></div>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {groups.map((g) => {
              const open = isOpen(g.key);
              const pct = pctOf(g.occupied, g.unitCount);
              return (
                <Card
                  key={g.key}
                  title={
                    <button type="button" onClick={() => toggle(g.key)} aria-expanded={open}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}>
                      <ChevronDown size={15} style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform .15s' }} aria-hidden />
                      <span className="gx-thumb">{initials(g.name)}</span>
                      <span>{g.name}</span>
                    </button>
                  }
                  sub={`Rental provider · ${g.properties.length} propert${g.properties.length === 1 ? 'y' : 'ies'} · ${g.unitCount} unit${g.unitCount === 1 ? '' : 's'}`}
                  right={<>
                    <Pill tone="amber">{g.occupied} occupied · {pct}%</Pill>
                    <Pill tone="neutral">{g.unitCount - g.occupied} vacant</Pill>
                    {g.ownerUserId != null && <Btn size="xs" href={`/dashboard/admin/users/${g.ownerUserId}`}>Provider</Btn>}
                  </>}
                >
                  {open && (view === 'grid' ? (
                    <div className="gx-pad" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                      {g.properties.map((p) => (
                        <Link key={p.id} href={`/dashboard/admin/properties/${p.id}`} className="gx-card" style={{ display: 'block', overflow: 'hidden', marginBottom: 0 }}>
                          <div style={{ height: 130, background: 'var(--ms-surface-3)', position: 'relative', display: 'grid', placeItems: 'center' }}>
                            {p.coverPhotoUrl
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={p.coverPhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <Building2 size={26} style={{ color: 'var(--ms-ink-3)' }} aria-hidden />}
                            {p.spaceCategory && <span style={{ position: 'absolute', top: 8, left: 8 }}><Pill tone="outline" dot={false}>{titleCase(p.spaceCategory)}</Pill></span>}
                          </div>
                          <div style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--ms-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.buildingName}</div>
                            <div style={{ fontSize: 11, color: 'var(--ms-ink-3)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              <MapPin size={11} aria-hidden /> {p.fullAddress ?? '—'}
                            </div>
                            <div style={{ marginTop: 8, fontSize: 11.5 }}><OccBar occupied={p.occupiedCount} total={p.unitCount} /></div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="gx-tbl-scroll">
                      <table className="gx-tbl">
                        <thead><tr><th>Property</th><th>Category</th><th className="num">Units</th><th>Occupancy</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
                        <tbody>
                          {g.properties.map((p) => (
                            <tr key={p.id} className="click" onClick={() => router.push(`/dashboard/admin/properties/${p.id}`)}>
                              <td>
                                <div className="gx-cell">
                                  <Thumb text={p.buildingName} src={p.coverPhotoUrl} />
                                  <span><span className="strong">{p.buildingName}</span><span className="sub">{p.fullAddress ?? '—'}</span></span>
                                </div>
                              </td>
                              <td>{p.spaceCategory ? <Pill tone="outline" dot={false}>{humanize(p.spaceCategory)}</Pill> : '—'}</td>
                              <td className="num">{p.unitCount}</td>
                              <td><OccBar occupied={p.occupiedCount} total={p.unitCount} /></td>
                              <td className="act" onClick={(e) => e.stopPropagation()}><Btn size="xs" href={`/dashboard/admin/properties/${p.id}`}>Open</Btn></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </OsPage>
  );
}
