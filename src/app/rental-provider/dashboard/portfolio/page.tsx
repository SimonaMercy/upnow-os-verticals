/**
 * Rental Provider — Property Portfolio.
 *
 * Lists all of the RP's properties in three views (Row · Grid · Map). Every
 * card shows PROPERTY details only (cover photo · annual rent · occupied/vacant ·
 * location) and opens the details popup (PropertyDetailsModal) — where the units
 * and documents live. No inline unit expansion.
 *   • Row  — image-left cards.
 *   • Grid — cover-image tiles.
 *   • Map  — full-width map; click a pin to surface that property's detail card.
 *
 * Data: GET /properties (returns properties with unit counts + coverPhotoUrl).
 */
'use client';

import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import {
  Building2, MapPin, Plus, Pencil, Trash2, Search,
  Loader2, AlertCircle, X,
  Map as MapIcon, LayoutGrid, Rows3, Image as ImageIcon,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import {
  PropertyFormModal,
  type PropertyFormData,
  categoryDisplayLabel,
} from '@/components/upnow/PropertyFormModal';
import s from './portfolio.module.css';
import { PropertyDetailsModal } from './PropertyDetailsModal';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { uploadExtraPropertyDocs } from '@/lib/propertyDocs';
import { PortfolioMapView } from './PortfolioMapModal';

const cn = (...x: Array<string | false | null | undefined>) => x.filter(Boolean).join(' ');

// ─── Types ────────────────────────────────────────────────
interface Property {
  id: number;
  buildingName: string;
  spaceCategory: string;
  leasingType?: 'direct' | 'sub';
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
  createdAt: string;
  unitCount?: number;
  listedCount?: number;
  occupiedCount?: number;
  rentTotal?: number;
  coverPhotoUrl?: string | null;
}

interface Unit {
  id: number;
  propertyId: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  unitTier: string;
  floor: string | null;
  premiseNumber: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  view: string | null;
  furnishing: string | null;
  facilities: string | null;
  rentalPrice: number | null;
  marketPrice: number | null;
  securityDeposit: number | null;
  adminFee: number | null;
  ejariFeeFils: number | null;
  commission: number | null;
  serviceCharges: number | null;
  availability: string;
  description: string | null;
  isListed: boolean;
  listingStatus: 'draft' | 'pending' | 'in_review' | 'published' | 'expired' | 'rejected';
  planLabel?: string | null;
  floorPlanUrl?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────
function categoryLabel(cat: string): string {
  return categoryDisplayLabel(cat);
}

// ─── API mappers ──────────────────────────────────────────
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

// Aggregates for a property. Units load lazily on expand; until then fall back
// to the property-level counts from GET /properties so collapsed cards show real
// numbers (count, occupancy, rent) — not 0.
function propertyStats(property: Property, units: Unit[]) {
  const unitsLoaded = units.length > 0;
  const totalRent = unitsLoaded
    ? units.reduce((sum, u) => sum + (Number(u.rentalPrice ?? u.marketPrice) || 0), 0)
    : (property.rentTotal ?? 0);
  const occupied = unitsLoaded
    ? units.filter((u) => u.availability === 'occupied').length
    : (property.occupiedCount ?? 0);
  const available = units.filter((u) => u.availability === 'available').length;
  const maintenance = units.filter((u) => u.availability === 'maintenance').length;
  const totalUnits = property.unitCount ?? units.length;
  return { totalRent, occupied, available, maintenance, totalUnits };
}

// Property-level summary shown on every card: occupied · vacant dots + the
// location pin (green when the property is pinned on the map). Annual rent and
// unit details otherwise live inside the popup.
function OccupancyVacancy({ occupied, vacant }: { occupied: number; vacant: number }) {
  return (
    <div className="flex items-center gap-3 text-xs" style={{ color: '#57544d' }}>
      <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: '#2e9f82' }} />{occupied} occupied</span>
      <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: '#d97706' }} />{vacant} vacant</span>
    </div>
  );
}

function AddressPin({ property }: { property: Property }) {
  const hasPin = property.latitude != null && property.longitude != null;
  if (!property.fullAddress && !hasPin) return null;
  return (
    <p className="text-xs truncate flex items-center gap-1" style={{ color: '#6b6860' }}>
      <MapPin size={12} className="shrink-0" style={{ color: hasPin ? '#2e9f82' : '#c5c3bc' }} />
      {property.fullAddress ?? 'Pinned on map'}
    </p>
  );
}

function AnnualRent({ amount }: { amount: number }) {
  if (amount <= 0) return <span className="text-xs" style={{ color: '#9b9890' }}>No rent set</span>;
  return (
    <div className="whitespace-nowrap">
      <span className="font-bold text-lg" style={{ color: '#2e9f82' }}>AED {Math.round(amount).toLocaleString('en-AE')}</span>
      <span className="text-xs ml-0.5" style={{ color: '#6b6860' }}>/yr</span>
    </div>
  );
}

function PropertyCover({ url, size }: { url?: string | null; size: 'row' | 'grid' }) {
  const cls = size === 'row' ? 'rounded-xl' : 'rounded-t-2xl';
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`w-full h-full object-cover ${cls}`} />;
  }
  return (
    <div className={`w-full h-full flex flex-col items-center justify-center bg-[#fafaf8] ${cls}`} style={{ color: '#c5c3bc' }}>
      <ImageIcon size={size === 'row' ? 22 : 28} />
      <span className="text-[10px] mt-1">No photo</span>
    </div>
  );
}

// ─── Property card (Row view + Map list) ──────────────────
// Image-left card showing PROPERTY details only (annual rent · occupied · vacant
// · location). The whole row opens the details popup, where the units live.
function PropertyCard({
  property, onEdit, onDelete, onShowDetails,
}: {
  property: Property; onEdit: () => void; onDelete: () => void; onShowDetails: () => void;
}) {
  const { totalRent, occupied, totalUnits } = propertyStats(property, []);
  const vacant = Math.max(0, totalUnits - occupied);

  return (
    <div onClick={onShowDetails} role="button" title="View property details"
      className="flex items-stretch gap-4 p-3 sm:p-4 cursor-pointer"
      style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
      <div className="relative shrink-0 overflow-hidden rounded-xl" style={{ width: 132, height: 92 }}>
        <PropertyCover url={property.coverPhotoUrl} size="row" />
      </div>

      <div className="flex flex-col justify-center min-w-0 flex-1 gap-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-base truncate" style={{ color: '#1a1916' }}>{property.buildingName}</h3>
          <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#f1efe9', color: '#57544d' }}>
            {categoryLabel(property.spaceCategory)}
          </span>
        </div>
        <AddressPin property={property} />
        <OccupancyVacancy occupied={occupied} vacant={vacant} />
      </div>

      <div className="flex flex-col items-end justify-center gap-2 shrink-0">
        <AnnualRent amount={totalRent} />
        <div className="flex items-center gap-1">
          <button type="button" className={s.actsBtn} onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit property" aria-label="Edit property">
            <Pencil size={14} />
          </button>
          <button type="button" className={cn(s.actsBtn, s.danger)} onClick={(e) => { e.stopPropagation(); if (confirm('Delete this property and all its units?')) onDelete(); }} title="Delete property" aria-label="Delete property">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Property grid card (Grid view) ───────────────────────
// Cover-image tile showing property details (annual rent · occupied · vacant);
// the whole tile opens the details popup, where the units live.
function PropertyGridCard({
  property, onEdit, onDelete, onShowDetails,
}: {
  property: Property; onEdit: () => void; onDelete: () => void; onShowDetails: () => void;
}) {
  const { totalRent, occupied, totalUnits } = propertyStats(property, []);
  const vacant = Math.max(0, totalUnits - occupied);
  const iconBtn: CSSProperties = {
    width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(255,255,255,0.95)', border: '1px solid #e8e6e0', cursor: 'pointer',
  };
  return (
    <div onClick={onShowDetails} role="button" title="View property details"
      className="flex flex-col overflow-hidden cursor-pointer"
      style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
      {/* Cover photo with overlaid actions */}
      <div className="relative overflow-hidden" style={{ height: 150 }}>
        <PropertyCover url={property.coverPhotoUrl} size="grid" />
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit property" style={iconBtn}><Pencil size={14} color="#6b6860" /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this property and all its units?')) onDelete(); }} title="Delete property"
            style={{ ...iconBtn, borderColor: '#f1d5d5' }}><Trash2 size={14} color="#b91c1c" /></button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-semibold text-base truncate" style={{ color: '#1a1916' }}>{property.buildingName}</h3>
          <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#f1efe9', color: '#57544d' }}>
            {categoryLabel(property.spaceCategory)}
          </span>
        </div>
        <AddressPin property={property} />
        <div className="flex items-center justify-between gap-2 mt-1">
          <OccupancyVacancy occupied={occupied} vacant={vacant} />
          <AnnualRent amount={totalRent} />
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────
export default function PortfolioPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  // Property-type filter (spaceCategory), chosen from a dropdown.
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [propertyModal, setPropertyModal] = useState<{ open: boolean; editing?: Property }>({ open: false });
  // Read-only preview popup (shows the property's units + documents inside).
  const [detailsProperty, setDetailsProperty] = useState<Property | null>(null);
  // Main content view: Row (list) · Grid (tiles) · Map (Airbnb list + map). All
  // cards open the details popup — no inline expansion.
  const [view, setView] = useState<'row' | 'grid' | 'map'>('row');

  // Deep-link ?add=1 (from the dashboard / contract "List Property" CTAs) opens
  // the Add Property modal straight away — property creation lives here now.
  useEffect(() => {
    const add = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('add') : null;
    // One-time, post-hydration init from the URL (avoids an SSR hydration
    // mismatch that a lazy useState initializer would cause).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (add === '1') setPropertyModal({ open: true });
  }, []);

  const { data: properties = [], isLoading, error } = useQuery<Property[]>({
    queryKey: ['properties'],
    queryFn: () => apiGet<Property[]>('/properties'),
  });

  // Distinct property types present, for the dropdown.
  const categoryOptions = Array.from(new Set(properties.map((p) => p.spaceCategory).filter(Boolean))).sort();

  const filteredProperties = properties.filter((p) => {
    if (categoryFilter !== 'all' && p.spaceCategory !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.buildingName.toLowerCase().includes(q) ||
        (p.fullAddress ?? '').toLowerCase().includes(q) ||
        (p.communityName ?? '').toLowerCase().includes(q) ||
        (p.emirateName ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

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
  const handleSaveProperty = useCallback(async (data: PropertyFormData, titleDeed?: File | null, drawings?: File[], extraDocs?: Record<string, File[]>) => {
    const dto = formToCreateDto(data);
    let propertyId: number;
    if (propertyModal.editing) {
      await updateProperty.mutateAsync({ id: propertyModal.editing.id, dto });
      propertyId = propertyModal.editing.id;
    } else {
      const created = await createProperty.mutateAsync(dto);
      propertyId = created.id;
    }
    // Standalone properties carry ONE title deed at property level (multi-unit
    // buildings attach deeds per unit instead — see UnitFormModal).
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
    // Building drawings — property-level, multiple. Key by index+timestamp so
    // each is a distinct document row.
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
  }, [propertyModal.editing, createProperty, updateProperty]);

  // ── Property-level KPIs (from the loaded properties list) ──
  const totalProperties = properties.length;
  const totalUnits     = properties.reduce((sum, p) => sum + (p.unitCount ?? 0), 0);

  const filtersDirty = !!search || categoryFilter !== 'all';

  return (
    <div className={s.app}>
      <div className={s.main}>

        {/* Needs attention — profile completeness nudge (shown until resolved) */}
        {user && !user.phone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff7e6', border: '1px solid #f5d98b', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            <AlertCircle size={18} style={{ color: '#9a6b00', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#7a5600' }}>Needs attention</div>
              <div style={{ fontSize: 12.5, color: '#9a6b00' }}>Add a phone number to your profile so customers and your team can reach you.</div>
            </div>
            <Link href="/rental-provider/dashboard/profile" className={cn(s.btn, s.btnPrimary, s.btnSm)} style={{ flexShrink: 0 }}>
              Add phone number
            </Link>
          </div>
        )}

        {/* Hero */}
        <div className={s.hero}>
          <div className={s.heroLeft}>
            <div className={s.heroEyebrow}><Building2 size={12} /> Portfolio</div>
            <h1 className={s.heroTitle}>Your properties</h1>
            {totalProperties === 0 && (
              <p className={s.heroDesc}>
                You haven&apos;t added a property yet — once you do, manage all buildings, units, and listings from this dashboard.
              </p>
            )}
          </div>
          <div className={s.heroRight}>
            <button type="button" className={cn(s.btn, s.btnPrimary)} onClick={() => setPropertyModal({ open: true })}>
              <Plus size={14} /> Add property
            </button>
          </div>
        </div>

        {/* KPI strip */}
        {totalProperties > 0 && (
          <div className={s.summary}>
            <div className={s.kpi}>
              <div className={s.kpiLbl}>Properties</div>
              <div className={s.kpiVal}>{totalProperties}</div>
              <div className={s.kpiSub}>Buildings under management</div>
            </div>
            <div className={s.kpi}>
              <div className={s.kpiLbl}>Total units</div>
              <div className={s.kpiVal}>{totalUnits}</div>
              <div className={s.kpiSub}>Across all properties</div>
            </div>
          </div>
        )}


        {/* Filters */}
        {totalProperties > 0 && (
          <div className={s.filters}>
            <div className={s.search}>
              <Search size={14} className={s.searchIc} />
              <input
                type="text"
                placeholder="Search building, area, emirate…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button type="button" className={s.searchClear} onClick={() => setSearch('')}><X size={12} /></button>
              )}
            </div>

            {/* Property-type dropdown */}
            {categoryOptions.length > 0 && (
              <div className={s.selWrap}>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={s.sel}>
                  <option value="all">All property types</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>{categoryLabel(c)}</option>
                  ))}
                </select>
              </div>
            )}

            {filtersDirty && (
              <button
                type="button"
                className={s.filtersClear}
                onClick={() => { setSearch(''); setCategoryFilter('all'); }}
              >
                Clear all
              </button>
            )}

            {/* View toggle — Row · Grid · Map */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, padding: 4, borderRadius: 10, background: '#f1efe9' }}>
              {([['row', Rows3, 'Row'], ['grid', LayoutGrid, 'Grid'], ['map', MapIcon, 'Map']] as const).map(([v, Icon, label]) => (
                <button key={v} type="button" onClick={() => setView(v)} title={`${label} view`} aria-pressed={view === v}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
                    fontSize: 12.5, fontWeight: 600, border: 0, cursor: 'pointer',
                    ...(view === v
                      ? { background: '#fff', color: '#1a1916', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                      : { background: 'transparent', color: '#6b6860' }),
                  }}>
                  <Icon size={15} /> <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error / loading / empty / list */}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--danger-bg)', color: 'var(--danger-fg)', borderRadius: 10, marginBottom: 16, fontSize: 13.5 }}>
            <AlertCircle size={14} /> {(error as Error).message}
          </div>
        )}

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 0', color: 'var(--mute)' }}>
            <Loader2 size={18} className="animate-spin" /> Loading properties…
          </div>
        )}

        {!isLoading && properties.length === 0 && (
          <div className={s.empty}>
            <div className={s.emptyIc}><Building2 size={22} /></div>
            <h3 className={s.emptyTtl}>No properties yet</h3>
            <p className={s.emptyDesc}>Add your first property — then add as many units as you need without re-entering location details.</p>
            <button type="button" className={cn(s.btn, s.btnPrimary)} onClick={() => setPropertyModal({ open: true })}>
              <Plus size={14} /> Add first property
            </button>
          </div>
        )}

        {/* ── Main content (Row · Grid · Map). Every card opens the popup. ── */}
        {!isLoading && filteredProperties.length > 0 && view === 'row' && (
          <div className={s.props}>
            {filteredProperties.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                onEdit={() => setPropertyModal({ open: true, editing: p })}
                onDelete={() => deleteProperty.mutate(p.id)}
                onShowDetails={() => setDetailsProperty(p)}
              />
            ))}
          </div>
        )}

        {!isLoading && filteredProperties.length > 0 && view === 'grid' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredProperties.map((p) => (
              <PropertyGridCard
                key={p.id}
                property={p}
                onEdit={() => setPropertyModal({ open: true, editing: p })}
                onDelete={() => deleteProperty.mutate(p.id)}
                onShowDetails={() => setDetailsProperty(p)}
              />
            ))}
          </div>
        )}

        {/* Map — full-width. Click a pin to surface that property's details. */}
        {!isLoading && filteredProperties.length > 0 && view === 'map' && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 8, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
            <PortfolioMapView
              properties={filteredProperties}
              heightClass="h-[78vh]"
              onViewDetails={(id) => {
                const p = filteredProperties.find((x) => x.id === id);
                if (p) setDetailsProperty(p);
              }}
              onEdit={(id) => {
                const p = filteredProperties.find((x) => x.id === id);
                if (p) setPropertyModal({ open: true, editing: p });
              }}
            />
          </div>
        )}

        {/* No matches for the active search / filters (across all views). */}
        {!isLoading && properties.length > 0 && filteredProperties.length === 0 && (
          <div className={s.empty}>
            <div className={s.emptyIc}><Search size={20} /></div>
            <h3 className={s.emptyTtl}>No matches</h3>
            <p className={s.emptyDesc}>No properties match your search or filter.</p>
            <button type="button" className={cn(s.btn)} onClick={() => { setSearch(''); setCategoryFilter('all'); }}>
              Clear filters
            </button>
          </div>
        )}

        {/* ── Modals ── */}
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
          } : undefined}
          propertyId={propertyModal.editing?.id}
          unitCount={propertyModal.editing?.unitCount}
          onClose={() => setPropertyModal({ open: false })}
          onSave={handleSaveProperty}
        />

        {/* Read-only preview popups + portfolio map */}
        {detailsProperty && (
          <PropertyDetailsModal
            property={detailsProperty}
            editable
            stats={{
              units: detailsProperty.unitCount ?? 0,
              occupied: detailsProperty.occupiedCount ?? 0,
              rentTotal: detailsProperty.rentTotal ?? 0,
            }}
            onClose={() => setDetailsProperty(null)}
          />
        )}
      </div>
    </div>
  );
}
