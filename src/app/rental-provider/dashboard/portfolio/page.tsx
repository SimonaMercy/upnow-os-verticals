/**
 * Rental Provider — Catalogue › Properties (Genspark OS layout).
 *
 * Parity with previous page (portfolio/page.tsx, Row · Grid · Map cards):
 *  Data / API
 *   [x] GET    /properties                       (queryKey ['properties'])
 *   [x] POST   /properties                       (create, formToCreateDto — unchanged)
 *   [x] PATCH  /properties/:id                   (edit, same DTO)
 *   [x] DELETE /properties/:id                   (confirm "Delete this property and all its units?")
 *   [x] Title-deed upload via uploadOwnedDocument (ownerType property, key title_deed, category legal)
 *   [x] Building drawings via uploadOwnedDocument (building_drawing_<ts>_<i>, category property)
 *   [x] Extra named property docs via uploadExtraPropertyDocs
 *   [x] Building photos POST /api/properties/:id/media (multipart) — add flow only
 *   [x] Same alert() messages on partial upload failure
 *   [x] Inspection status per building (useInspectionStatus(null) + InspectionChip → settings?tab=building_inspections)
 *  Controls
 *   [x] Search (building, address, community, emirate)
 *   [x] Property-type filter (canonical SPACE_CATEGORIES + legacy types present)
 *   [x] Ownership filter (Owned / Sub-lease / Managed — leasing_type)
 *   [x] Sort (default · rent high→low · occupancy · vacancies first · name A–Z)
 *   [x] View switch Row · Grid · Map → now Seg Table · Grid · Map (map = PortfolioMapView, unchanged)
 *   [x] Ownership grouping (group header + count) in Table and Grid views
 *   [x] "Showing N of M properties" + "Clear filters" on no-match
 *  Actions / navigation
 *   [x] Add property (PageHead action + first-run empty state) → PropertyFormModal
 *   [x] Edit property (labelled "Edit" button; map pin onEdit) → PropertyFormModal (same initial mapping)
 *   [x] Delete property (labelled "Delete" button)
 *   [x] Open property → PropertyDetailsModal (editable, canEditPricing, stats; its Edit hands off to the form)
 *   [x] Map pin "view details" / "edit"
 *   [x] Deep links ?add=1 (open Add modal) and ?property=<id> (open details once)
 *   [x] Needs-attention nudge when the user has no phone → /rental-provider/dashboard/profile
 *   [+] "Units" button per property → /rental-provider/dashboard/units?propertyId=<id> (existing preselect param)
 *   [+] "Add units" head action → /rental-provider/dashboard/units/add
 *  KPIs: properties · units · occupancy · vacant · market rent / annual rent (all from GET /properties; AED, not fils)
 *  States: skeleton rows while loading · ErrorRow with retry · first-run empty · no-match empty
 *
 * Reused unchanged: PropertyFormModal, PropertyDetailsModal, PortfolioMapView, InspectionChip.
 * portfolio.module.css is kept (the manager Properties page imports it; the grid layout class is reused here).
 */
'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  PropertyFormModal,
  type PropertyFormData,
  categoryDisplayLabel,
  SPACE_CATEGORIES,
} from '@/components/upnow/PropertyFormModal';
import {
  OsPage, PageHead, ScopeStrip, Kpis, Kpi, Pill, Btn, TableWrap, SearchField, Seg, Thumb,
  SkeletonRows, ErrorRow, Callout, Card, fmtAed, fmtAedK, type Tone,
} from '@/components/os/kit';
import s from './portfolio.module.css';
import { PropertyDetailsModal } from './PropertyDetailsModal';
import { InspectionChip } from '@/components/upnow/InspectionChip';
import { inspectionFor, useInspectionStatus } from '@/lib/inspectionStatus';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { uploadExtraPropertyDocs } from '@/lib/propertyDocs';
import { PortfolioMapView } from './PortfolioMapModal';

// ─── Types ────────────────────────────────────────────────
interface Property {
  id: number;
  buildingName: string;
  spaceCategory: string;
  leasingType?: 'direct' | 'sub' | 'management';
  fullAddress: string | null;
  emirateId: number | null;
  cityId: number | null;
  communityId: number | null;
  subCommunityId: number | null;
  emirateName: string | null;
  communityName: string | null;
  street: string | null;
  makaniNumber: string | null;
  plotNumber: string | null;
  latitude: number | null;
  longitude: number | null;
  sharedAmenities: string[] | null;
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  isStandaloneUnit: boolean;
  propertyDescription: string | null;
  numberOfFloors: string | null;
  numberOfUnits: number | null;
  createdAt: string;
  unitCount?: number;
  listedCount?: number;
  occupiedCount?: number;
  rentTotal?: number;        // Σ units.rental_price — Market Rent (asking, all units), AED
  annualRentTotal?: number;  // Σ latest lease annual_rent — contracted Annual Rent (leased units), AED
  coverPhotoUrl?: string | null;
}

type LeasingType = 'direct' | 'sub' | 'management';
const OWNERSHIP_LABEL: Record<LeasingType, string> = { direct: 'Owned', sub: 'Sub-lease', management: 'Managed' };
const OWNERSHIP_TONE: Record<LeasingType, Tone> = { direct: 'primary', sub: 'info', management: 'amber' };
type SortKey = 'default' | 'rent' | 'occ' | 'vac' | 'name';
type View = 'table' | 'grid' | 'map';

const BASE = '/rental-provider/dashboard';
const INSPECTION_SETTINGS = `${BASE}/settings?tab=building_inspections`;

function categoryTone(label: string): Tone {
  if (label === 'Residential') return 'info';
  if (label === 'Industrial') return 'amber';
  if (label === 'Commercial' || label === 'Mixed-use') return 'primary';
  return 'neutral';
}

// ─── API mappers (unchanged from the previous page) ───────
function formToCreateDto(data: PropertyFormData) {
  const parts = [data.street, data.communityName, data.emirateName].filter(Boolean);
  return {
    buildingName: data.buildingName,
    spaceCategory: data.spaceCategory,
    leasingType: data.leasingType,
    street: data.street || undefined,
    // Without a street segment, leave full_address untouched (PATCH omits it)
    // so a legacy row's embedded street isn't recomposed away.
    fullAddress: data.street ? parts.join(', ') : undefined,
    emirateId: data.emirateId ?? undefined,
    cityId: data.cityId ?? undefined,
    communityId: data.communityId ?? undefined,
    subCommunityId: data.subCommunityId ?? undefined,
    numberOfFloors: data.numberOfFloors || undefined,
    numberOfUnits: data.numberOfUnits ? Number(data.numberOfUnits) : undefined,
    makaniNumber: data.makaniNumber || undefined,
    plotNumber: data.plotNumber || undefined,
    latitude: data.latitude ?? undefined,
    longitude: data.longitude ?? undefined,
    sharedAmenities: data.sharedAmenities,
    hasGym: data.hasGym,
    hasPool: data.hasPool,
    hasParking: data.hasParking,
    isStandaloneUnit: data.isStandaloneUnit,
    propertyDescription: data.propertyDescription || undefined,
  };
}

function occOf(p: Property) {
  const units = p.unitCount ?? 0;
  const occ = p.occupiedCount ?? 0;
  return { units, occ, vac: Math.max(0, units - occ), pct: units ? Math.round((occ / units) * 100) : 0 };
}
function areaOf(p: Property): string | null {
  const area = [p.communityName, p.emirateName].filter(Boolean).join(', ');
  return area || p.fullAddress || (p.latitude != null && p.longitude != null ? 'Pinned on map' : null);
}

function OccBar({ p }: { p: Property }) {
  const o = occOf(p);
  if (!o.units) return <span className="sub" style={{ marginTop: 0 }}>No units</span>;
  const tone = o.pct < 50 ? 'danger' : o.pct < 80 ? 'amber' : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className={`gx-bar ${tone}`} style={{ width: 70, display: 'inline-block' }} aria-hidden><i style={{ width: `${o.pct}%` }} /></span>
      <span className="nowrap">{o.occ}/{o.units} · {o.pct}%</span>
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────
export default function PortfolioPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | LeasingType>('all');
  const [sort, setSort] = useState<SortKey>('default');
  const [propertyModal, setPropertyModal] = useState<{ open: boolean; editing?: Property }>({ open: false });
  const [detailsProperty, setDetailsProperty] = useState<Property | null>(null);
  const [view, setView] = useState<View>('table');
  const inspections = useInspectionStatus(null);

  // Deep-link ?add=1 opens the Add Property modal straight away.
  useEffect(() => {
    const add = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('add') : null;
    // One-time, post-hydration init from the URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (add === '1') setPropertyModal({ open: true });
  }, []);

  const { data: properties = [], isLoading, error, refetch } = useQuery<Property[]>({
    queryKey: ['properties'],
    queryFn: () => apiGet<Property[]>('/properties'),
  });

  // Deep-link ?property=<id> opens that property's details once the list loads.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current) return;
    const pid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('property') : null;
    if (!pid) return;
    const match = properties.find((p) => String(p.id) === pid);
    if (match) {
      deepLinkedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailsProperty(match);
    }
  }, [properties]);

  const categoryOptions = useMemo(() => {
    const canonical = SPACE_CATEGORIES.map((c) => c.id as string);
    const present = new Set(properties.map((p) => p.spaceCategory).filter(Boolean));
    const extras = Array.from(present).filter((c) => !canonical.includes(c)).sort();
    return [...canonical, ...extras];
  }, [properties]);

  const visibleProperties = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = properties.filter((p) => {
      if (categoryFilter !== 'all' && p.spaceCategory !== categoryFilter) return false;
      if (ownershipFilter !== 'all' && (p.leasingType ?? 'direct') !== ownershipFilter) return false;
      if (q) {
        return (
          p.buildingName.toLowerCase().includes(q) ||
          (p.fullAddress ?? '').toLowerCase().includes(q) ||
          (p.communityName ?? '').toLowerCase().includes(q) ||
          (p.emirateName ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
    const occRate = (p: Property) => (p.occupiedCount ?? 0) / ((p.unitCount ?? 0) || 1);
    const vacancies = (p: Property) => Math.max(0, (p.unitCount ?? 0) - (p.occupiedCount ?? 0));
    if (sort === 'rent') list.sort((a, b) => (b.rentTotal ?? 0) - (a.rentTotal ?? 0));
    else if (sort === 'occ') list.sort((a, b) => occRate(b) - occRate(a));
    else if (sort === 'vac') list.sort((a, b) => vacancies(b) - vacancies(a));
    else if (sort === 'name') list.sort((a, b) => a.buildingName.localeCompare(b.buildingName));
    return list;
  }, [properties, search, categoryFilter, ownershipFilter, sort]);

  // Ownership groups — largest first, items keep the active sort.
  const ownershipGroups = useMemo(() => {
    const order: LeasingType[] = ['direct', 'sub', 'management'];
    const m = new Map<LeasingType, Property[]>();
    for (const p of visibleProperties) {
      const k = (p.leasingType ?? 'direct') as LeasingType;
      (m.get(k) ?? m.set(k, []).get(k)!).push(p);
    }
    return Array.from(m.entries())
      .map(([own, items]) => ({ own, items }))
      .sort((a, b) => (b.items.length - a.items.length) || (order.indexOf(a.own) - order.indexOf(b.own)));
  }, [visibleProperties]);

  const createProperty = useMutation({
    mutationFn: (dto: ReturnType<typeof formToCreateDto>) => apiPost<Property>('/properties', dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }),
  });
  const updateProperty = useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: object }) => apiPatch<Property>(`/properties/${id}`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }),
  });
  const deleteProperty = useMutation({
    mutationFn: (id: number) => apiDelete<void>(`/properties/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }),
  });

  const handleSaveProperty = useCallback(async (data: PropertyFormData, titleDeed?: File | null, drawings?: File[], extraDocs?: Record<string, File[]>, photos?: File[]) => {
    const dto = formToCreateDto(data);
    let propertyId: number;
    if (propertyModal.editing) {
      await updateProperty.mutateAsync({ id: propertyModal.editing.id, dto });
      propertyId = propertyModal.editing.id;
    } else {
      const created = await createProperty.mutateAsync(dto);
      propertyId = created.id;
    }
    // Standalone properties carry ONE title deed at property level.
    if (titleDeed && propertyId) {
      try {
        await uploadOwnedDocument({
          ownerType: 'property', ownerId: propertyId,
          documentKey: 'title_deed', category: 'legal',
          displayName: 'Title deed', file: titleDeed,
        });
      } catch (e) {
        alert(`The property was saved, but the title deed upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    // Building drawings — property-level, multiple.
    if (drawings?.length && propertyId) {
      for (let i = 0; i < drawings.length; i++) {
        try {
          await uploadOwnedDocument({
            ownerType: 'property', ownerId: propertyId,
            documentKey: `building_drawing_${Date.now()}_${i}`, category: 'property',
            displayName: drawings[i].name || `Property drawing ${i + 1}`, file: drawings[i],
          });
        } catch (e) {
          alert(`The property was saved, but a building drawing upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }
    }
    // Other named document slots (affection plan, completion cert, etc.).
    if (propertyId) {
      const errs = await uploadExtraPropertyDocs(propertyId, extraDocs);
      if (errs.length) alert(`The property was saved, but some documents failed to upload:\n${errs.join('\n')}`);
    }
    // Building photos → property media. Only the Add flow stages photos here.
    if (photos?.length && propertyId) {
      const photoErrs: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        try {
          const fd = new FormData();
          fd.append('file', photos[i]);
          const res = await fetch(`/api/properties/${propertyId}/media`, { method: 'POST', body: fd, credentials: 'include' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) { photoErrs.push(`Property photo ${i + 1}: ${e instanceof Error ? e.message : 'upload failed'}`); }
      }
      if (photoErrs.length) alert(`The property was saved, but some photos failed to upload:\n${photoErrs.join('\n')}`);
    }
  }, [propertyModal.editing, createProperty, updateProperty]);

  // ── KPIs (from the loaded list) ──
  const totalProperties = properties.length;
  const totalUnits      = properties.reduce((sum, p) => sum + (p.unitCount ?? 0), 0);
  const totalOccupied   = properties.reduce((sum, p) => sum + (p.occupiedCount ?? 0), 0);
  const totalVacant     = Math.max(0, totalUnits - totalOccupied);
  const occRate         = totalUnits ? Math.round((totalOccupied / totalUnits) * 100) : 0;
  const totalRent       = properties.reduce((sum, p) => sum + (p.rentTotal ?? 0), 0);
  const totalAnnualRent = properties.reduce((sum, p) => sum + (p.annualRentTotal ?? 0), 0);

  const filtersDirty = !!search || categoryFilter !== 'all' || ownershipFilter !== 'all' || sort !== 'default';
  const clearFilters = () => { setSearch(''); setCategoryFilter('all'); setOwnershipFilter('all'); setSort('default'); };

  const onDelete = (p: Property) => {
    if (confirm('Delete this property and all its units?')) deleteProperty.mutate(p.id);
  };
  const rowActions = (p: Property) => (
    <span className="gx-btn-row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
      <Btn size="xs" variant="primary" onClick={() => setDetailsProperty(p)}>Open</Btn>
      <Btn size="xs" href={`${BASE}/units?propertyId=${p.id}`}>Units</Btn>
      <Btn size="xs" onClick={() => setPropertyModal({ open: true, editing: p })}>Edit</Btn>
      <Btn size="xs" variant="danger" onClick={() => onDelete(p)} disabled={deleteProperty.isPending && deleteProperty.variables === p.id}>Delete</Btn>
    </span>
  );

  const COLS = 7;
  const toolbar = (
    <>
      <SearchField value={search} onChange={setSearch} placeholder="Search building, area, emirate…" />
      <select className="gx-sel" aria-label="Property type" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
        <option value="all">All property types</option>
        {categoryOptions.map((c) => <option key={c} value={c}>{categoryDisplayLabel(c)}</option>)}
      </select>
      <select className="gx-sel" aria-label="Ownership" value={ownershipFilter} onChange={(e) => setOwnershipFilter(e.target.value as typeof ownershipFilter)}>
        <option value="all">All ownership</option>
        <option value="direct">Owned (direct lease)</option>
        <option value="sub">Sub-lease</option>
        <option value="management">Managed</option>
      </select>
      <select className="gx-sel" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
        <option value="default">Sort: Default</option>
        <option value="rent">Rent (high → low)</option>
        <option value="occ">Occupancy</option>
        <option value="vac">Vacancies first</option>
        <option value="name">Name A–Z</option>
      </select>
      <span style={{ flex: 1 }} />
      <Seg<View> label="View" value={view} onChange={setView}
        options={[{ v: 'table', l: 'Table' }, { v: 'grid', l: 'Grid' }, { v: 'map', l: 'Map' }]} />
    </>
  );

  const noMatch = (
    <div className="gx-empty">
      <b>No properties match your search</b>Try a different name, area, or type.
      {filtersDirty && <div style={{ marginTop: 8 }}><Btn size="sm" onClick={clearFilters}>Clear filters</Btn></div>}
    </div>
  );

  return (
    <OsPage>
      <PageHead
        eyebrow="Catalogue › Properties"
        title="Properties"
        lede="Every building you lease, with its units and how full it is. Open a property for its unit mix and documents; add units to a building from Units."
        actions={<>
          <Btn href={`${BASE}/units/add`}>Add units</Btn>
          <Btn variant="primary" onClick={() => setPropertyModal({ open: true })}><Plus size={14} aria-hidden /> Add property</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Catalogue' },
        { label: 'Vertical', value: 'Long-term rentals' },
        { label: 'Data', value: isLoading ? 'Loading…' : `${totalProperties} ${totalProperties === 1 ? 'property' : 'properties'}` },
      ]} />

      {user && !user.phone && (
        <Callout tone="warn" title="Needs attention.">
          Add a phone number to your profile so customers and your team can reach you.{' '}
          <Btn size="xs" variant="primary" href={`${BASE}/profile`}>Add phone number</Btn>
        </Callout>
      )}

      {totalProperties > 0 && (
        <Kpis>
          <Kpi k="Properties" v={totalProperties} d="Buildings under management" />
          <Kpi k="Units" v={totalUnits} d="Across all properties" href={`${BASE}/units`} />
          <Kpi k="Occupancy" v={`${occRate}%`} d={`${totalOccupied} occupied`} />
          <Kpi k="Vacant" v={totalVacant} d={totalVacant ? 'Units ready for a customer' : 'Fully let'} />
          <Kpi dark k="Market rent / Annual rent" v={fmtAedK(totalRent)} d={`Annual rent ${totalAnnualRent ? fmtAedK(totalAnnualRent) : '—'} · asking vs contracted`} />
        </Kpis>
      )}

      {/* First-run empty state */}
      {!isLoading && !error && totalProperties === 0 ? (
        <Card pad>
          <div className="gx-empty">
            <b>No properties yet</b>
            Add your first property — then add as many units as you need without re-entering location details.
            <div style={{ marginTop: 10 }}><Btn variant="primary" onClick={() => setPropertyModal({ open: true })}><Plus size={14} aria-hidden /> Add first property</Btn></div>
          </div>
        </Card>
      ) : (
        <>
          {view === 'table' || isLoading || error ? (
            <TableWrap toolbar={toolbar}>
              <table className="gx-tbl">
                <thead>
                  <tr>
                    <th>Property</th><th>Category</th><th>Ownership</th><th className="num">Units</th>
                    <th>Occupancy</th><th className="num">Market rent / Annual rent</th><th className="act">Actions</th>
                  </tr>
                </thead>
                {isLoading ? <SkeletonRows cols={COLS} />
                  : error ? <ErrorRow cols={COLS} onRetry={() => void refetch()} />
                  : visibleProperties.length === 0 ? <tbody><tr><td colSpan={COLS}>{noMatch}</td></tr></tbody>
                  : ownershipGroups.map((g) => (
                    <tbody key={g.own}>
                      <tr>
                        <td colSpan={COLS} style={{ background: 'var(--ms-surface-2, #f6f8f6)' }}>
                          <span className="strong">{OWNERSHIP_LABEL[g.own]}</span>{' '}
                          <span style={{ color: 'var(--ms-ink-3)' }}>· {g.items.length} {g.items.length === 1 ? 'property' : 'properties'}</span>
                        </td>
                      </tr>
                      {g.items.map((p) => {
                        const cat = categoryDisplayLabel(p.spaceCategory);
                        const o = occOf(p);
                        const own = (p.leasingType ?? 'direct') as LeasingType;
                        return (
                          <tr key={p.id} className="click" onClick={() => setDetailsProperty(p)}>
                            <td>
                              <div className="gx-cell">
                                <Thumb text={p.buildingName} src={p.coverPhotoUrl} />
                                <span>
                                  <span className="strong">{p.buildingName}</span>
                                  <span className="sub">
                                    {areaOf(p) ?? 'No location set'}
                                    {o.vac > 0 && <> · <span style={{ color: 'var(--ms-amber, #b45309)', fontWeight: 600 }}>{o.vac} vacant</span></>}
                                  </span>
                                  <span style={{ display: 'block', marginTop: 4 }}>
                                    <InspectionChip status={inspectionFor(inspections, p.id, null)} settingsHref={INSPECTION_SETTINGS} />
                                  </span>
                                </span>
                              </div>
                            </td>
                            <td><Pill tone={categoryTone(cat)}>{cat}</Pill></td>
                            <td><Pill tone={OWNERSHIP_TONE[own]} dot={false}>{OWNERSHIP_LABEL[own]}</Pill></td>
                            <td className="num">{o.units}</td>
                            <td><OccBar p={p} /></td>
                            <td className="num">
                              <span className="strong">{p.rentTotal ? fmtAed(p.rentTotal) : 'No rent set'}</span>
                              <span className="sub">{p.annualRentTotal ? `Annual ${fmtAed(p.annualRentTotal)}` : 'No lease yet'}</span>
                            </td>
                            <td className="act">{rowActions(p)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
              </table>
            </TableWrap>
          ) : (
            <TableWrap toolbar={toolbar}>
              <div className="gx-pad">
                {visibleProperties.length === 0 && view === 'grid' ? noMatch : view === 'grid' ? (
                  ownershipGroups.map((g) => (
                    <section key={g.own} style={{ marginBottom: 18 }}>
                      <div style={{ margin: '2px 0 10px', fontSize: 12.5 }}>
                        <span className="strong" style={{ fontWeight: 700 }}>{OWNERSHIP_LABEL[g.own]}</span>{' '}
                        <span style={{ color: 'var(--ms-ink-3)' }}>· {g.items.length} {g.items.length === 1 ? 'property' : 'properties'}</span>
                      </div>
                      <div className={s.dxGrid}>
                        {g.items.map((p) => {
                          const cat = categoryDisplayLabel(p.spaceCategory);
                          const o = occOf(p);
                          return (
                            <div key={p.id} className="gx-card" style={{ overflow: 'hidden', cursor: 'pointer' }} onClick={() => setDetailsProperty(p)}>
                              <div style={{ height: 120, background: 'var(--ms-surface-3)', position: 'relative', display: 'grid', placeItems: 'center' }}>
                                {p.coverPhotoUrl
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={p.coverPhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : <Thumb text={p.buildingName} />}
                                <span style={{ position: 'absolute', top: 8, left: 8 }}><Pill tone={categoryTone(cat)}>{cat}</Pill></span>
                                <span style={{ position: 'absolute', top: 8, right: 8 }}>
                                  <InspectionChip status={inspectionFor(inspections, p.id, null)} settingsHref={INSPECTION_SETTINGS} />
                                </span>
                              </div>
                              <div className="gx-pad">
                                <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.buildingName}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 3 }}>
                                  <MapPin size={12} aria-hidden />
                                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{areaOf(p) ?? 'No location set'}</span>
                                  {o.vac > 0 && <span style={{ color: 'var(--ms-amber, #b45309)', fontWeight: 600, flex: '0 0 auto' }}>· {o.vac} vacant</span>}
                                </div>
                                <div style={{ marginTop: 10, fontSize: 11.5 }}><OccBar p={p} /></div>
                                <div style={{ marginTop: 8, fontSize: 11.5 }}>
                                  <b>{p.rentTotal ? `${fmtAed(p.rentTotal)} /yr` : 'No rent set'}</b>
                                  <div style={{ color: 'var(--ms-ink-3)' }}>{p.annualRentTotal ? `Annual rent ${fmtAed(p.annualRentTotal)}` : 'No lease yet'}</div>
                                </div>
                                <div style={{ marginTop: 10 }}>{rowActions(p)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))
                ) : (
                  // Map — unchanged PortfolioMapView. Click a pin to surface details / edit.
                  <PortfolioMapView
                    properties={visibleProperties}
                    heightClass="h-[72vh]"
                    onViewDetails={(id) => {
                      const p = visibleProperties.find((x) => x.id === id);
                      if (p) setDetailsProperty(p);
                    }}
                    onEdit={(id) => {
                      const p = visibleProperties.find((x) => x.id === id);
                      if (p) setPropertyModal({ open: true, editing: p });
                    }}
                  />
                )}
              </div>
            </TableWrap>
          )}
          {!isLoading && !error && (
            <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 8 }}>
              Showing <b>{visibleProperties.length}</b> of {totalProperties} properties
              {filtersDirty && <> · <button type="button" onClick={clearFilters} style={{ background: 'none', border: 0, padding: 0, color: 'var(--ms-primary)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</button></>}
            </div>
          )}
        </>
      )}

      {/* ── Modals (reused unchanged) ── */}
      <PropertyFormModal
        open={propertyModal.open}
        title={propertyModal.editing ? 'Edit Property' : 'Add Property'}
        initial={propertyModal.editing ? {
          buildingName:        propertyModal.editing.buildingName,
          spaceCategory:       propertyModal.editing.spaceCategory,
          leasingType:         propertyModal.editing.leasingType ?? 'direct',
          emirateId:           propertyModal.editing.emirateId ?? null,
          cityId:              propertyModal.editing.cityId ?? null,
          communityId:         propertyModal.editing.communityId ?? null,
          subCommunityId:      propertyModal.editing.subCommunityId ?? null,
          makaniNumber:        propertyModal.editing.makaniNumber ?? '',
          plotNumber:          propertyModal.editing.plotNumber ?? '',
          street:              propertyModal.editing.street ?? '',
          propertyDescription: propertyModal.editing.propertyDescription ?? '',
          latitude:            propertyModal.editing.latitude,
          longitude:           propertyModal.editing.longitude,
          sharedAmenities:     propertyModal.editing.sharedAmenities ?? [],
          hasGym:              propertyModal.editing.hasGym,
          hasPool:             propertyModal.editing.hasPool,
          hasParking:          propertyModal.editing.hasParking,
          isStandaloneUnit:    propertyModal.editing.isStandaloneUnit,
          numberOfFloors:      propertyModal.editing.numberOfFloors ?? '',
          numberOfUnits:       propertyModal.editing.numberOfUnits != null ? String(propertyModal.editing.numberOfUnits) : '',
        } : undefined}
        propertyId={propertyModal.editing?.id}
        unitCount={propertyModal.editing?.unitCount}
        onClose={() => setPropertyModal({ open: false })}
        onSave={handleSaveProperty}
      />

      {detailsProperty && (
        <PropertyDetailsModal
          property={detailsProperty}
          editable
          canEditPricing
          stats={{
            units: detailsProperty.unitCount ?? 0,
            occupied: detailsProperty.occupiedCount ?? 0,
            rentTotal: detailsProperty.rentTotal ?? 0,
          }}
          onEdit={() => {
            const editing = detailsProperty;
            setDetailsProperty(null);
            setPropertyModal({ open: true, editing });
          }}
          onClose={() => setDetailsProperty(null)}
        />
      )}
    </OsPage>
  );
}
