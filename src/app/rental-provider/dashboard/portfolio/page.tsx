/**
 * Rental Provider — Property Portfolio.
 *
 * Lists all of the RP's properties (accordion) with their units and listing
 * workflow status. Click a property card to expand and manage its units.
 *
 * Data: GET /properties (returns properties with unit counts).
 * Units: GET /properties/:id/units (loaded on expand).
 * Contracts: GET /contracts (used to surface tenant + lease end on unit rows).
 */
'use client';

import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import {
  Building2, MapPin, Plus, Pencil, Trash2, Search,
  ChevronDown, Loader2, AlertCircle, X, Eye, Check, ArrowRight,
  Map as MapIcon, LayoutGrid, Rows3,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import {
  PropertyFormModal,
  type PropertyFormData,
  SPACE_CATEGORIES,
} from '@/components/upnow/PropertyFormModal';
import {
  RESIDENTIAL_UNIT_TYPES,
  COMMERCIAL_UNIT_TYPES,
  INDUSTRIAL_UNIT_TYPES,
} from '@/components/upnow/UnitFormModal';
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

interface ContractSummary {
  id: number;
  status: string;
  contractActive: boolean;
  endDate: string | null;
  tenant: { id: number | null; name: string | null } | null;
  unit: { id: number | null } | null;
}

// ─── View options ─────────────────────────────────────────
const VIEW_OPTIONS = [
  'Sea View', 'Burj Khalifa View', 'City View', 'Marina View',
  'Canal View', 'Creek View', 'Garden View', 'Pool View',
  'Park View', 'Golf View', 'Community View', 'Desert View',
  'Mountain View', 'Skyline View', 'Partial Sea View', 'Lake View',
];

// ─── View multiselect (kept from original; lightly tweaked styles to fit) ─
function ViewMultiSelect({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const label = selected.length === 0
    ? 'Filter by view'
    : selected.length === 1
    ? selected[0]
    : `${selected.length} views selected`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={s.sel}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {selected.length > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: 'var(--green-t)', color: 'var(--green-d)' }}>
            {selected.length}
          </span>
        )}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30, background: '#fff', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 8px 30px -10px rgba(0,0,0,.18)', overflow: 'hidden', width: 224 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mute)' }}>Views</span>
            {selected.length > 0 && (
              <button onClick={() => onChange([])} style={{ background: 'transparent', border: 0, fontSize: 11, color: 'var(--green-d)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
            )}
          </div>
          <ul style={{ maxHeight: 220, overflowY: 'auto', margin: 0, padding: 4, listStyle: 'none' }}>
            {VIEW_OPTIONS.map((v) => {
              const sel = selected.includes(v);
              return (
                <li key={v}>
                  <button
                    type="button"
                    onClick={() => toggle(v)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', background: 'transparent', border: 0, textAlign: 'left', fontSize: 13, borderRadius: 8, cursor: 'pointer', color: sel ? 'var(--ink)' : 'var(--ink-2)' }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 4, border: sel ? 'none' : '1.5px solid var(--mute-2)', background: sel ? 'var(--green)' : '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, color: '#fff' }}>
                      {sel && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    {v}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────
function categoryLabel(cat: string): string {
  return SPACE_CATEGORIES.find((c) => c.id === cat)?.label ?? cat;
}

// ─── API mappers ──────────────────────────────────────────
function formToCreateDto(data: PropertyFormData) {
  const parts = [data.street, data.communityName, data.emirateName].filter(Boolean);
  return {
    buildingName: data.buildingName,
    spaceCategory: data.spaceCategory,
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

// Read-only expanded body — unit names + footer stats. Shared by the Row-view
// accordion (nested) and the Grid-view breakout panel.
function PropertyUnitsBody({ property, units }: { property: Property; units: Unit[] }) {
  const { totalRent, occupied, available, maintenance, totalUnits } = propertyStats(property, units);
  return (
    <div className={s.propBody}>
      <div className={s.unitH}>
        <div className={s.unitHTtl}>Units ({units.length})</div>
        {!property.isStandaloneUnit && (
          <Link
            href={`/rental-provider/dashboard/units?propertyId=${property.id}`}
            className={cn(s.btn, s.btnPrimary, s.btnSm)}>
            Manage units
          </Link>
        )}
      </div>

      {units.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIc}><Building2 size={20} /></div>
          <h3 className={s.emptyTtl}>
            {property.isStandaloneUnit ? 'Standalone property' : 'No units yet'}
          </h3>
          <p className={s.emptyDesc}>
            {property.isStandaloneUnit
              ? 'This is a standalone property — the property itself is the unit.'
              : 'No units yet. Add and manage units from the Units page.'}
          </p>
          {!property.isStandaloneUnit && (
            <Link href={`/rental-provider/dashboard/units?propertyId=${property.id}`} className={cn(s.btn, s.btnPrimary)}>
              Go to Units
            </Link>
          )}
        </div>
      ) : (
        <div className={s.units}>
          {units.map((u) => {
            // Read-only status pill — availability dominates over listing status.
            const pillInfo = (() => {
              if (u.availability === 'occupied')   return { cls: s.pillOcc, label: 'Occupied' };
              if (u.availability === 'maintenance') return { cls: s.pillMaint, label: 'Maintenance' };
              switch (u.listingStatus) {
                case 'published': return { cls: s.pillPublished, label: 'Published' };
                case 'pending':   return { cls: s.pillPending,   label: 'Pending' };
                case 'in_review': return { cls: s.pillReview,    label: 'In review' };
                case 'expired':   return { cls: s.pillPending,   label: 'Expired' };
                case 'rejected':  return { cls: s.pillRejected,  label: 'Rejected' };
                default:          return { cls: s.pillDraft,     label: 'Draft' };
              }
            })();

            const sizeStr = u.unitSizeSqft
              ? `${Number(u.unitSizeSqft).toLocaleString()} sqft`
              : u.unitSizeSqm
              ? `${Number(u.unitSizeSqm).toLocaleString()} sqm`
              : null;

            return (
              <div key={u.id} className={s.unit}>
                <span className={s.unitNum}>{u.unitNumber}</span>

                <div className={s.unitMeta}>
                  <div className={s.unitTop}>
                    {u.unitName && (<><span className={s.unitSpec}>{u.unitName}</span><span className={s.unitDot} /></>)}
                    <span className={s.unitType}>{u.unitType.replace(/_/g, ' ')}</span>
                    {u.bedrooms != null && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.bedrooms} BR</span></>)}
                    {u.bathrooms != null && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.bathrooms} BA</span></>)}
                    {sizeStr && (<><span className={s.unitDot} /><span className={s.unitSpec}>{sizeStr}</span></>)}
                    {u.view && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.view}</span></>)}
                    {u.planLabel && (
                      <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#2e9f82', background: '#f0faf6', borderRadius: 6, padding: '1px 7px' }}>{u.planLabel}</span>
                    )}
                  </div>
                </div>

                <div className={s.unitRight}>
                  <span className={cn(s.pill, pillInfo.cls)}>
                    <span className={s.pdot} /> {pillInfo.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer mini-stats */}
      <div className={s.propFooter}>
        <div className={s.statMini}>
          <div className={s.statMiniL}>Total</div>
          <div className={s.statMiniV}>{totalUnits}</div>
        </div>
        <div className={s.statMini}>
          <div className={s.statMiniL}>Available</div>
          <div className={s.statMiniV}>{available}</div>
        </div>
        <div className={s.statMini}>
          <div className={s.statMiniL}>Occupied</div>
          <div className={s.statMiniV}>{occupied}</div>
        </div>
        <div className={s.statMini}>
          <div className={s.statMiniL}>{maintenance > 0 ? 'Maintenance' : 'Annual revenue'}</div>
          <div className={s.statMiniV}>
            {maintenance > 0 ? maintenance : `AED ${Math.round(totalRent).toLocaleString('en-AE')}`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Property card (Row view) ─────────────────────────────
function PropertyCard({
  property, units, expanded, onToggle, onEdit, onDelete, onShowDetails,
}: {
  property: Property; units: Unit[]; expanded: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void; onShowDetails: () => void;
}) {
  const { totalRent, occupied, totalUnits } = propertyStats(property, units);

  return (
    <div className={cn(s.prop, expanded && s.expanded)}>
      {/* Header row */}
      <div className={s.propH} onClick={onToggle} role="button">
        <div className={s.propInfo}>
          <div className={s.propName}>
            <span
              role="button"
              onClick={e => { e.stopPropagation(); onShowDetails(); }}
              title="View property details"
              style={{ cursor: 'pointer' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none'; }}>
              {property.buildingName}
            </span>
            <span className={s.propCat}>{categoryLabel(property.spaceCategory)}</span>
          </div>
          <div className={s.propAddr}>
            <MapPin size={12} />
            <span>{property.fullAddress ?? '—'}</span>
            {/* Makani shown in the property details popup, not on the list card. */}
          </div>
        </div>

        <div className={s.propAgg}>
          <div className={s.aggItem}>
            <div className={s.aggV}>{totalUnits}</div>
            <div className={s.aggL}>Units</div>
          </div>
          {totalUnits > 0 && (
            <div className={s.aggItem}>
              <div className={s.aggV}>{occupied}/{totalUnits}</div>
              <div className={s.aggL}>Occupied</div>
            </div>
          )}
          {totalRent > 0 && (
            <div className={s.aggItem}>
              <div className={s.aggV}>AED {Math.round(totalRent).toLocaleString('en-AE')}</div>
              <div className={s.aggL}>per year</div>
            </div>
          )}
          <div className={s.propActions}>
            <button
              type="button"
              className={s.actsBtn}
              onClick={(e) => { e.stopPropagation(); onShowDetails(); }}
              title="View property details"
              aria-label="View property details"
            >
              <Eye size={14} />
            </button>
            <button
              type="button"
              className={s.actsBtn}
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              title="Edit property"
              aria-label="Edit property"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className={cn(s.actsBtn, s.danger)}
              onClick={(e) => { e.stopPropagation(); if (confirm('Delete this property and all its units?')) onDelete(); }}
              title="Delete property"
              aria-label="Delete property"
            >
              <Trash2 size={14} />
            </button>
            <ChevronDown size={16} className={s.chev} />
          </div>
        </div>
      </div>

      {/* Expanded body — read-only. Unit management lives on the Units page. */}
      {expanded && <PropertyUnitsBody property={property} units={units} />}
    </div>
  );
}

// ─── Property grid card (Grid view, master–detail) ────────
// Clickable tile; selecting it shows the property's unit listings in the side
// detail panel (handled by the parent). Highlights when selected.
function PropertyGridCard({
  property, selected, onSelect, onEdit, onDelete, onShowDetails,
}: {
  property: Property; selected: boolean;
  onSelect: () => void; onEdit: () => void; onDelete: () => void; onShowDetails: () => void;
}) {
  const { totalRent, occupied, totalUnits } = propertyStats(property, []);
  const iconBtn: CSSProperties = {
    width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#fff', border: '1px solid #e8e6e0', cursor: 'pointer',
  };
  return (
    <div onClick={onSelect} role="button" aria-pressed={selected}
      className="flex flex-col overflow-hidden cursor-pointer transition-shadow"
      style={{
        background: '#fff', borderRadius: 16,
        boxShadow: selected
          ? '0 0 0 2px #2e9f82, 0 2px 12px -2px rgba(0,0,0,0.10)'
          : '0 2px 12px -2px rgba(0,0,0,0.06)',
      }}>
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-base truncate" style={{ color: '#1a1916' }}>{property.buildingName}</div>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1.5 inline-block"
              style={{ background: '#f1efe9', color: '#57544d' }}>
              {categoryLabel(property.spaceCategory)}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={(e) => { e.stopPropagation(); onShowDetails(); }} title="View property details" style={iconBtn}><Eye size={14} color="#6b6860" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit property" style={iconBtn}><Pencil size={14} color="#6b6860" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this property and all its units?')) onDelete(); }} title="Delete property"
              style={{ ...iconBtn, borderColor: '#f1d5d5' }}><Trash2 size={14} color="#b91c1c" /></button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-2.5 text-xs" style={{ color: '#6b6860' }}>
          <MapPin size={12} className="shrink-0" /><span className="truncate">{property.fullAddress ?? '—'}</span>
        </div>

        <div className="flex items-end gap-5 mt-4">
          <div>
            <div className="text-lg font-bold" style={{ color: '#1a1916' }}>{totalUnits}</div>
            <div className="text-[11px]" style={{ color: '#9b9890' }}>Units</div>
          </div>
          {totalUnits > 0 && (
            <div>
              <div className="text-lg font-bold" style={{ color: '#1a1916' }}>{occupied}/{totalUnits}</div>
              <div className="text-[11px]" style={{ color: '#9b9890' }}>Occupied</div>
            </div>
          )}
          {totalRent > 0 && (
            <div className="ml-auto text-right">
              <div className="text-sm font-bold" style={{ color: '#2e9f82' }}>AED {Math.round(totalRent).toLocaleString('en-AE')}</div>
              <div className="text-[11px]" style={{ color: '#9b9890' }}>per year</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold"
        style={{ borderTop: '1px solid #f0ede8', color: selected ? '#2e9f82' : '#6b6860' }}>
        {selected
          ? <>Showing units <Check size={13} /></>
          : <>View units <ArrowRight size={13} /></>}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────
export default function PortfolioPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'residential' | 'commercial' | 'industrial'>('all');
  const [search, setSearch] = useState('');
  const [unitTypeFilter, setUnitTypeFilter] = useState('');
  const [selectedViews, setSelectedViews] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [propertyModal, setPropertyModal] = useState<{ open: boolean; editing?: Property }>({ open: false });
  // Read-only preview popups
  const [detailsProperty, setDetailsProperty] = useState<Property | null>(null);
  // Main content view: Row (accordion) · Grid (tiles) · Map (inline).
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

  const { data: expandedUnits = [] } = useQuery<Unit[]>({
    queryKey: ['units', expandedId],
    queryFn: () => apiGet<Unit[]>(`/properties/${expandedId}/units`),
    enabled: expandedId != null,
  });

  const { data: allContracts = [] } = useQuery<ContractSummary[]>({
    queryKey: ['contracts'],
    queryFn: () => apiGet<ContractSummary[]>('/contracts'),
  });

  const createProperty = useMutation({
    mutationFn: (dto: ReturnType<typeof formToCreateDto>) => apiPost<Property>('/properties', dto),
    onSuccess: (created) => { qc.invalidateQueries({ queryKey: ['properties'] }); setExpandedId(created.id); },
  });
  const updateProperty = useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: object }) => apiPatch<Property>(`/properties/${id}`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }),
  });
  const deleteProperty = useMutation({
    mutationFn: (id: number) => apiDelete<void>(`/properties/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['properties'] }); setExpandedId(null); },
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

  // ── Aggregated KPIs (from the loaded properties list) ──
  const totalProperties = properties.length;
  const totalUnits     = properties.reduce((sum, p) => sum + (p.unitCount ?? 0), 0);
  const totalListed    = properties.reduce((sum, p) => sum + (p.listedCount ?? 0), 0);
  // Active leases = distinct units that hold an in-force lease. After an import
  // a unit and its renewal can BOTH be contract_active, so counting contract
  // rows double-counts (2 leases on 1 unit → the old 200% occupancy). Dedupe by
  // unit so the figure matches reality.
  const activeLeases = new Set(
    allContracts.filter((c) => c.contractActive && c.unit?.id != null).map((c) => c.unit!.id),
  ).size;

  const filtersDirty = !!search || !!unitTypeFilter || selectedViews.length > 0;

  // Units shown under the one expanded property (lazy-loaded), after the
  // unit-type / view filters. Empty for collapsed properties. Used by both views.
  const visibleUnitsFor = (p: Property): Unit[] =>
    expandedId === p.id
      ? expandedUnits.filter((u) => {
          if (unitTypeFilter && u.unitType !== unitTypeFilter) return false;
          if (selectedViews.length > 0 && !selectedViews.some((v) => (u.view ?? '').toLowerCase().includes(v.toLowerCase()))) return false;
          return true;
        })
      : [];

  // Grid view is master–detail: expandedId = the property whose listings show in
  // the side panel. Null (or filtered-out) → the panel shows a prompt.
  const selectedGridProperty = filteredProperties.find((p) => p.id === expandedId) ?? null;

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
            <div className={s.kpi}>
              <div className={s.kpiLbl}>Active leases</div>
              <div className={s.kpiVal}>{activeLeases}</div>
              <div className={s.kpiSub}>Units currently rented</div>
            </div>
            <div className={s.kpi}>
              <div className={s.kpiLbl}>Live listings</div>
              <div className={s.kpiVal}>{totalListed}</div>
              <div className={s.kpiSub}>Published & searchable</div>
            </div>
          </div>
        )}

        {/* Range tabs */}
        <div className={s.rangetabs}>
          <div className={s.rangetabsTabs}>
            {(['all', 'residential', 'commercial', 'industrial'] as const).map((key) => {
              const label = key === 'all' ? 'All' : key.charAt(0).toUpperCase() + key.slice(1);
              const count = key === 'all' ? properties.length : properties.filter((p) => p.spaceCategory === key).length;
              const active = categoryFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCategoryFilter(key); setUnitTypeFilter(''); }}
                  className={cn(s.rangetabBtn, active && s.active)}
                >
                  {label}
                  <span className={s.rangetabCount}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

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

            <div className={s.selWrap}>
              <select
                value={unitTypeFilter}
                onChange={(e) => setUnitTypeFilter(e.target.value)}
                className={s.sel}
              >
                {/* Scope sub-types to the selected category — only show that
                    category's types; "All" keeps the grouped full list. */}
                <option value="">{categoryFilter === 'all' ? 'All unit types' : `All ${categoryFilter} types`}</option>
                {categoryFilter === 'all' ? (
                  <>
                    <optgroup label="Residential">
                      {RESIDENTIAL_UNIT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </optgroup>
                    <optgroup label="Commercial">
                      {COMMERCIAL_UNIT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </optgroup>
                    <optgroup label="Industrial">
                      {INDUSTRIAL_UNIT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </optgroup>
                  </>
                ) : (
                  (categoryFilter === 'residential' ? RESIDENTIAL_UNIT_TYPES
                    : categoryFilter === 'commercial' ? COMMERCIAL_UNIT_TYPES
                    : INDUSTRIAL_UNIT_TYPES
                  ).map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)
                )}
              </select>
            </div>

            <ViewMultiSelect selected={selectedViews} onChange={setSelectedViews} />

            {filtersDirty && (
              <button
                type="button"
                className={s.filtersClear}
                onClick={() => { setSearch(''); setUnitTypeFilter(''); setSelectedViews([]); }}
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

        {/* ── Main content (Row · Grid · Map) ── */}
        {!isLoading && filteredProperties.length > 0 && view === 'map' && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 12, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
            <PortfolioMapView properties={filteredProperties} heightClass="h-[68vh]" />
          </div>
        )}

        {!isLoading && filteredProperties.length > 0 && view === 'row' && (
          <div className={s.props}>
            {filteredProperties.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                units={visibleUnitsFor(p)}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onEdit={() => setPropertyModal({ open: true, editing: p })}
                onDelete={() => deleteProperty.mutate(p.id)}
                onShowDetails={() => setDetailsProperty(p)}
              />
            ))}
          </div>
        )}

        {!isLoading && filteredProperties.length > 0 && view === 'grid' && (
          // Master–detail: property tiles on the left, the selected property's
          // unit listings pinned in a panel on the right.
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(340px,400px)] gap-5 items-start">
            {/* Left — property tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredProperties.map((p) => (
                <PropertyGridCard
                  key={p.id}
                  property={p}
                  selected={expandedId === p.id}
                  onSelect={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  onEdit={() => setPropertyModal({ open: true, editing: p })}
                  onDelete={() => deleteProperty.mutate(p.id)}
                  onShowDetails={() => setDetailsProperty(p)}
                />
              ))}
            </div>

            {/* Right — selected property's unit listings. The `.prop.expanded`
                wrapper supplies the card surface AND reveals `.propBody`. */}
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
              {selectedGridProperty ? (
                <div className={cn(s.prop, s.expanded)}>
                  <div style={{ padding: '16px 18px 0' }}>
                    <div className="font-semibold text-base" style={{ color: '#1a1916' }}>{selectedGridProperty.buildingName}</div>
                    <div className="flex items-center gap-1.5 text-xs mt-1" style={{ color: '#6b6860' }}>
                      <MapPin size={12} className="shrink-0" /><span className="truncate">{selectedGridProperty.fullAddress ?? '—'}</span>
                    </div>
                  </div>
                  <PropertyUnitsBody property={selectedGridProperty} units={visibleUnitsFor(selectedGridProperty)} />
                </div>
              ) : (
                <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
                  <Building2 size={22} className="mx-auto mb-2" style={{ color: '#c5c3bc' }} />
                  <p className="text-sm" style={{ color: '#9b9890' }}>Select a property to see its unit listings.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* No matches for the active search / filters (across all views). */}
        {!isLoading && properties.length > 0 && filteredProperties.length === 0 && (
          <div className={s.empty}>
            <div className={s.emptyIc}><Search size={20} /></div>
            <h3 className={s.emptyTtl}>No matches</h3>
            <p className={s.emptyDesc}>No properties match your search or filters.</p>
            <button type="button" className={cn(s.btn)}
              onClick={() => { setSearch(''); setUnitTypeFilter(''); setSelectedViews([]); setCategoryFilter('all'); }}>
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
