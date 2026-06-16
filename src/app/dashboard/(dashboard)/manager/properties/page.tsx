'use client';

/**
 * Manager — Properties. Mirrors the RP Portfolio experience (same
 * portfolio.module.css: hero, KPI strip, range tabs, filters, property cards)
 * so a manager sees the identical UI as a landlord. The only differences:
 *   • a LandlordSwitcher (scope to one landlord or "All")
 *   • actions (edit / add) gated by the manager's granted permissions
 */

import { useState, useMemo, type CSSProperties } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, MapPin, Search, X, Loader2, Lock, ChevronDown, Eye, Pencil, Plus,
  LayoutGrid, Rows3, Map as MapIcon, Check, ArrowRight,
} from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { uploadExtraPropertyDocs } from '@/lib/propertyDocs';
import { PropertyDetailsModal } from '@/app/rental-provider/dashboard/portfolio/PropertyDetailsModal';
import { UnitPreviewModal } from '@/components/upnow/UnitPreviewModal';
import { PortfolioMapView } from '@/app/rental-provider/dashboard/portfolio/PortfolioMapModal';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { PropertyFormModal, type PropertyFormData } from '@/components/upnow/PropertyFormModal';
import s from '@/app/rental-provider/dashboard/portfolio/portfolio.module.css';

const cn = (...x: Array<string | false | null | undefined>) => x.filter(Boolean).join(' ');

interface ManagedProperty {
  id:              number;
  buildingName:    string;
  fullAddress:     string | null;
  spaceCategory:   string;
  numberOfFloors:  string | null;
  makaniNumber:    string | null;
  rentalProviderId:number;
  rpName?:         string;
  unitCount?:      number;
  listedCount?:    number;
  emirate?:        { nameEn: string } | null;
  community?:      { nameEn: string } | null;
  // Location FK ids + editable fields (the full Property entity is returned by
  // /manager/properties, so these are present for pre-filling the edit modal).
  emirateId?:      number | null;
  cityId?:         number | null;
  communityId?:    number | null;
  subCommunityId?: number | null;
  plotNumber?:     string | null;
  street?:         string | null;
  propertyDescription?: string | null;
  latitude?:       number | null;
  longitude?:      number | null;
  sharedAmenities?: string[] | null;
  hasGym?:         boolean;
  hasPool?:        boolean;
  hasParking?:     boolean;
  isStandaloneUnit?: boolean;
}

/** Map the property-form values to the create/update DTO (mirrors the RP portfolio). */
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

interface ManagedUnit {
  id:            number;
  unitNumber:    string;
  unitType:      string;
  bedrooms:      number | null;
  bathrooms:     number | null;
  unitSizeSqft:  number | string | null;
  unitSizeSqm:   number | string | null;
  view:          string | null;
  rentalPrice:   number | string | null;
  marketPrice:   number | string | null;
  availability:  string;
  listingStatus: string;
}

interface OverviewStats {
  properties: number; units: number; activeContracts: number; openLeads: number;
  rps: { id: number; name: string; propertyCount: number }[];
}

function categoryLabel(c: string) {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export default function ManagerPropertiesPage() {
  const { can, loading: permsLoading } = useManagerPermissions();
  const params   = useSearchParams();
  const router   = useRouter();
  const rpFilter = params.get('rp') ? Number(params.get('rp')) : null;

  const [category, setCategory] = useState<'all' | 'residential' | 'commercial' | 'industrial'>('all');
  const [search, setSearch]     = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [propertyModal, setPropertyModal] = useState<{ open: boolean; editing?: ManagedProperty }>({ open: false });
  // Read-only preview popups (shared with the landlord portal)
  const [detailsProperty, setDetailsProperty] = useState<ManagedProperty | null>(null);
  const [unitPreview, setUnitPreview] = useState<{ property: ManagedProperty; unit: ManagedUnit } | null>(null);
  // Main content view: Row (accordion) · Grid (tiles + side panel) · Map (inline).
  const [view, setView] = useState<'row' | 'grid' | 'map'>('row');
  const queryClient = useQueryClient();

  // The modal is used only for EDITING property details (Add uses the full
  // wizard at /dashboard/manager/properties/add). Unit add/edit lives in the
  // wizard + accordion, same as the landlord portal.
  async function handleSaveProperty(form: PropertyFormData, titleDeed?: File | null, drawings?: File[], extraDocs?: Record<string, File[]>) {
    if (!propertyModal.editing) return;
    const propertyId = propertyModal.editing.id;
    await apiPatch(`/properties/${propertyId}`, formToCreateDto(form));
    // Standalone title deed (property-level) + building drawings (multiple).
    if (titleDeed) {
      try {
        await uploadOwnedDocument({ ownerType: 'property', ownerId: propertyId, documentKey: 'title_deed', category: 'legal', displayName: 'Title deed', file: titleDeed });
      } catch (e) { alert(`Saved, but the title deed upload failed: ${e instanceof Error ? e.message : 'unknown error'}`); }
    }
    if (drawings?.length) {
      for (let i = 0; i < drawings.length; i++) {
        try {
          await uploadOwnedDocument({ ownerType: 'property', ownerId: propertyId, documentKey: `building_drawing_${Date.now()}_${i}`, category: 'property', displayName: drawings[i].name || `Property drawing ${i + 1}`, file: drawings[i] });
        } catch (e) { alert(`Saved, but a building drawing upload failed: ${e instanceof Error ? e.message : 'unknown error'}`); }
      }
    }
    const docErrs = await uploadExtraPropertyDocs(propertyId, extraDocs);
    if (docErrs.length) alert(`Saved, but some documents failed to upload:\n${docErrs.join('\n')}`);
    await queryClient.invalidateQueries({ queryKey: ['manager-properties'] });
    setPropertyModal({ open: false });
  }

  const { data: properties = [], isLoading } = useQuery<ManagedProperty[]>({
    queryKey: ['manager-properties'],
    queryFn:  () => apiGet<ManagedProperty[]>('/manager/properties'),
  });
  const { data: stats } = useQuery<OverviewStats>({
    queryKey: ['manager-overview'],
    queryFn:  () => apiGet<OverviewStats>('/manager/overview'),
  });

  const scoped = useMemo(
    () => properties.filter(p => !rpFilter || p.rentalProviderId === rpFilter),
    [properties, rpFilter],
  );

  const filtered = scoped.filter(p => {
    if (category !== 'all' && p.spaceCategory !== category) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.buildingName?.toLowerCase().includes(q) ||
        (p.fullAddress ?? '').toLowerCase().includes(q) ||
        (p.community?.nameEn ?? '').toLowerCase().includes(q) ||
        (p.emirate?.nameEn ?? '').toLowerCase().includes(q) ||
        (p.rpName ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Grid view is master–detail: expandedId = the property whose listings show
  // in the side panel. Null (or filtered-out) → the panel shows a prompt.
  const selectedManaged = filtered.find(p => p.id === expandedId) ?? null;

  // KPIs — scoped to the selected landlord, or all
  const kpiProps = rpFilter
    ? (stats?.rps.find(r => r.id === rpFilter)?.propertyCount ?? scoped.length)
    : (stats?.properties ?? properties.length);
  const kpiUnits     = rpFilter ? undefined : stats?.units;
  const kpiContracts = rpFilter ? undefined : stats?.activeContracts;

  // ── Permission gate ──
  if (!permsLoading && !can('canListProperties')) {
    return (
      <div className={s.app}><div className={s.main}>
        <div className={s.empty} style={{ marginTop: 40 }}>
          <div className={s.emptyIc}><Lock size={20} /></div>
          <h3 className={s.emptyTtl}>Permission required</h3>
          <p className={s.emptyDesc}>You need the <strong>View Properties</strong> permission. Ask your landlord to update your access.</p>
        </div>
      </div></div>
    );
  }

  return (
    <div className={s.app}>
      <div className={s.main}>

        {/* Hero — same chrome as RP, switcher replaces "Add property" */}
        <div className={s.hero}>
          <div className={s.heroLeft}>
            <div className={s.heroEyebrow}><Building2 size={12} /> Portfolio</div>
            <h1 className={s.heroTitle}>Managed properties</h1>
            <p className={s.heroDesc}>
              {kpiProps === 0
                ? 'No properties assigned to you yet — your landlords will appear here once they grant access.'
                : `Managing ${kpiProps} propert${kpiProps === 1 ? 'y' : 'ies'}${rpFilter ? '' : ` across your landlords`}.`}
            </p>
          </div>
          <div className={s.heroRight}>
            {can('canEditProperties') && (
              <button
                type="button"
                className={cn(s.btn, s.btnPrimary)}
                style={rpFilter ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
                title={rpFilter ? 'Add a property on this landlord’s behalf' : 'Pick a landlord from the switcher first'}
                onClick={() => rpFilter
                  ? router.push(`/dashboard/manager/properties/add?rp=${rpFilter}`)
                  : alert('Select a specific landlord (top-right) to add a property on their behalf.')}
              >
                <Plus size={14} /> Add property
              </button>
            )}
          </div>
        </div>

        {/* KPI strip */}
        {kpiProps > 0 && (
          <div className={s.summary}>
            <div className={s.kpi}>
              <div className={s.kpiLbl}>Properties</div>
              <div className={s.kpiVal}>{kpiProps}</div>
              <div className={s.kpiSub}>{rpFilter ? 'For this landlord' : 'Across all landlords'}</div>
            </div>
            {kpiUnits != null && (
              <div className={s.kpi}>
                <div className={s.kpiLbl}>Total units</div>
                <div className={s.kpiVal}>{kpiUnits}</div>
                <div className={s.kpiSub}>Across all properties</div>
              </div>
            )}
            {kpiContracts != null && (
              <div className={s.kpi}>
                <div className={s.kpiLbl}>Active leases</div>
                <div className={s.kpiVal}>{kpiContracts}</div>
                <div className={s.kpiSub}>Currently occupied</div>
              </div>
            )}
            <div className={s.kpi}>
              <div className={s.kpiLbl}>Landlords</div>
              <div className={s.kpiVal}>{rpFilter ? 1 : (stats?.rps.length ?? 0)}</div>
              <div className={s.kpiSub}>You manage</div>
            </div>
          </div>
        )}

        {/* Range tabs */}
        <div className={s.rangetabs}>
          <div className={s.rangetabsTabs}>
            {(['all', 'residential', 'commercial', 'industrial'] as const).map(key => {
              const label = key === 'all' ? 'All' : categoryLabel(key);
              const count = key === 'all' ? scoped.length : scoped.filter(p => p.spaceCategory === key).length;
              return (
                <button key={key} type="button" onClick={() => setCategory(key)}
                  className={cn(s.rangetabBtn, category === key && s.active)}>
                  {label}<span className={s.rangetabCount}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search + view toggle */}
        {kpiProps > 0 && (
          <div className={s.filters}>
            <div className={s.search}>
              <Search size={14} className={s.searchIc} />
              <input type="text" placeholder="Search building, area, emirate…"
                value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button type="button" className={s.searchClear} onClick={() => setSearch('')}><X size={12} /></button>}
            </div>

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

        {/* List */}
        {isLoading || permsLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 0', color: 'var(--mute)' }}>
            <Loader2 size={18} className="animate-spin" /> Loading properties…
          </div>
        ) : filtered.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIc}><Building2 size={20} /></div>
            <h3 className={s.emptyTtl}>{search || category !== 'all' ? 'No matches' : 'No properties yet'}</h3>
            <p className={s.emptyDesc}>
              {search || category !== 'all' ? 'Try a different search or filter.' : 'Your landlords haven’t assigned any properties to you yet.'}
            </p>
          </div>
        ) : (
          <>
            {/* Row — accordion */}
            {view === 'row' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filtered.map(p => (
                  <PropertyCard
                    key={p.id}
                    p={p}
                    expanded={expandedId === p.id}
                    onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    canEdit={can('canEditProperties')}
                    onEdit={() => setPropertyModal({ open: true, editing: p })}
                    multiLandlord={!rpFilter}
                    onShowDetails={() => setDetailsProperty(p)}
                    onPreviewUnit={(u) => setUnitPreview({ property: p, unit: u })}
                  />
                ))}
              </div>
            )}

            {/* Grid — master–detail (tiles left, selected property's units right) */}
            {view === 'grid' && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(340px,400px)] gap-5 items-start">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {filtered.map(p => (
                    <ManagerPropertyGridCard
                      key={p.id}
                      p={p}
                      selected={expandedId === p.id}
                      multiLandlord={!rpFilter}
                      canEdit={can('canEditProperties')}
                      onSelect={() => setExpandedId(expandedId === p.id ? null : p.id)}
                      onEdit={() => setPropertyModal({ open: true, editing: p })}
                      onShowDetails={() => setDetailsProperty(p)}
                    />
                  ))}
                </div>
                <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
                  {selectedManaged ? (
                    <ManagerUnitsPanel
                      p={selectedManaged}
                      canEdit={can('canEditProperties')}
                      onEdit={() => setPropertyModal({ open: true, editing: selectedManaged })}
                      onPreviewUnit={(u) => setUnitPreview({ property: selectedManaged, unit: u })}
                    />
                  ) : (
                    <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
                      <Building2 size={22} className="mx-auto mb-2" style={{ color: '#c5c3bc' }} />
                      <p className="text-sm" style={{ color: '#9b9890' }}>Select a property to see its unit listings.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Map — inline */}
            {view === 'map' && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 12, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
                <PortfolioMapView
                  heightClass="h-[68vh]"
                  properties={filtered.map(p => ({
                    id: p.id,
                    buildingName: p.buildingName,
                    latitude: p.latitude ?? null,
                    longitude: p.longitude ?? null,
                    fullAddress: p.fullAddress ?? null,
                    unitCount: p.unitCount,
                  }))}
                />
              </div>
            )}
          </>
        )}
      </div>

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
      {/* Read-only preview popups + map (shared components, manager-scoped data) */}
      {detailsProperty && (
        <PropertyDetailsModal
          property={{
            id: detailsProperty.id,
            buildingName: detailsProperty.buildingName,
            spaceCategory: detailsProperty.spaceCategory,
            fullAddress: detailsProperty.fullAddress ?? null,
            emirateName: detailsProperty.emirate?.nameEn ?? null,
            communityName: detailsProperty.community?.nameEn ?? null,
            street: null,
            makaniNumber: detailsProperty.makaniNumber ?? null,
            plotNumber: detailsProperty.plotNumber ?? null,
            latitude: detailsProperty.latitude ?? null,
            longitude: detailsProperty.longitude ?? null,
            hasGym: detailsProperty.hasGym ?? false,
            hasPool: detailsProperty.hasPool ?? false,
            hasParking: detailsProperty.hasParking ?? false,
            isStandaloneUnit: detailsProperty.isStandaloneUnit ?? false,
            propertyDescription: detailsProperty.propertyDescription ?? null,
            numberOfFloors: detailsProperty.numberOfFloors ?? null,
            createdAt: '',
            unitCount: detailsProperty.unitCount,
          }}
          stats={detailsProperty.unitCount != null ? { units: detailsProperty.unitCount, occupied: 0, rentTotal: 0 } : null}
          onClose={() => setDetailsProperty(null)}
        />
      )}
      {unitPreview && (
        <UnitPreviewModal
          propertyId={unitPreview.property.id}
          propertyName={unitPreview.property.buildingName}
          fetchBase="/manager/properties"
          fetchQuery={`rp=${unitPreview.property.rentalProviderId}`}
          unit={{
            id: unitPreview.unit.id,
            propertyId: unitPreview.property.id,
            unitNumber: unitPreview.unit.unitNumber,
            unitName: null,
            unitType: unitPreview.unit.unitType,
            unitTier: '',
            floor: null,
            premiseNumber: null,
            bedrooms: unitPreview.unit.bedrooms,
            bathrooms: unitPreview.unit.bathrooms,
            unitSizeSqft: unitPreview.unit.unitSizeSqft != null ? Number(unitPreview.unit.unitSizeSqft) : null,
            unitSizeSqm: unitPreview.unit.unitSizeSqm != null ? Number(unitPreview.unit.unitSizeSqm) : null,
            view: unitPreview.unit.view,
            furnishing: null,
            facilities: null,
            rentalPrice: unitPreview.unit.rentalPrice != null ? Number(unitPreview.unit.rentalPrice) : null,
            marketPrice: unitPreview.unit.marketPrice != null ? Number(unitPreview.unit.marketPrice) : null,
            securityDeposit: null,
            adminFee: null,
            ejariFeeFils: null,
            commission: null,
            serviceCharges: null,
            availability: unitPreview.unit.availability,
            description: null,
            isListed: unitPreview.unit.listingStatus === 'published',
            listingStatus: unitPreview.unit.listingStatus,
          }}
          onClose={() => setUnitPreview(null)}
        />
      )}
    </div>
  );
}

/* ── Property card — mirrors the RP portfolio accordion (units on expand) ── */
function PropertyCard({
  p, expanded, onToggle, canEdit, onEdit, multiLandlord, onShowDetails, onPreviewUnit,
}: {
  p: ManagedProperty; expanded: boolean; onToggle: () => void; canEdit: boolean; onEdit: () => void; multiLandlord: boolean;
  onShowDetails: () => void; onPreviewUnit: (u: ManagedUnit) => void;
}) {
  const loc = [p.community?.nameEn, p.emirate?.nameEn].filter(Boolean).join(', ') || p.fullAddress || '—';
  const { data: units = [], isLoading: unitsLoading } = useQuery<ManagedUnit[]>({
    queryKey: ['manager-units', p.id],
    queryFn:  () => apiGet<ManagedUnit[]>(`/manager/properties/${p.id}/units`),
    enabled:  expanded,
  });

  return (
    <div className={cn(s.prop, expanded && s.expanded)}>
      <div className={s.propH} role="button" onClick={onToggle}>
        <div className={s.propInfo}>
          <div className={s.propName}>
            {p.buildingName || 'Unnamed Property'}
            <span className={s.propCat}>{categoryLabel(p.spaceCategory)}</span>
          </div>
          <div className={s.propAddr}>
            <MapPin size={12} />
            <span>{loc}</span>
            {p.makaniNumber && <code>Makani {p.makaniNumber}</code>}
          </div>
        </div>
        <div className={s.propAgg}>
          <div className={s.aggItem}>
            <div className={s.aggV}>{p.unitCount ?? 0}</div>
            <div className={s.aggL}>Units</div>
          </div>
          {(p.listedCount ?? 0) > 0 && (
            <div className={s.aggItem}>
              <div className={s.aggV}>{p.listedCount}</div>
              <div className={s.aggL}>Listed</div>
            </div>
          )}
          {multiLandlord && (
            <div className={s.aggItem}>
              <div className={s.aggV} style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.rpName ?? '—'}</div>
              <div className={s.aggL}>Landlord</div>
            </div>
          )}
          <button
            type="button"
            className={s.actsBtn}
            title="View property details"
            aria-label="View property details"
            onClick={(e) => { e.stopPropagation(); onShowDetails(); }}
          >
            <Eye size={14} />
          </button>
          {canEdit && (
            <button
              type="button"
              className={s.actsBtn}
              title="Edit property"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
            >
              <Pencil size={14} />
            </button>
          )}
          <ChevronDown size={16} className={s.chev} />
        </div>
      </div>

      {expanded && (
        <div className={s.propBody}>
          <div className={s.unitH}>
            <div className={s.unitHTtl}>Units ({units.length})</div>
          </div>
          <ManagerUnitsList units={units} loading={unitsLoading} canEdit={canEdit} onPreviewUnit={onPreviewUnit} onEdit={onEdit} />
        </div>
      )}

    </div>
  );
}

/* ── Shared unit rendering (Row accordion + Grid side panel) ── */
function pillFor(u: ManagedUnit) {
  if (u.availability === 'occupied')    return { cls: s.pillOcc,       label: 'Occupied' };
  if (u.availability === 'maintenance') return { cls: s.pillMaint,     label: 'Maintenance' };
  switch (u.listingStatus) {
    case 'published': return { cls: s.pillPublished, label: 'Published' };
    case 'pending':   return { cls: s.pillPending,   label: 'Pending' };
    case 'in_review': return { cls: s.pillReview,    label: 'In review' };
    case 'rejected':  return { cls: s.pillRejected,  label: 'Rejected' };
    default:          return { cls: s.pillDraft,     label: 'Draft' };
  }
}

function ManagerUnitsList({ units, loading, canEdit, onPreviewUnit, onEdit }: {
  units: ManagedUnit[]; loading: boolean; canEdit: boolean;
  onPreviewUnit: (u: ManagedUnit) => void; onEdit: () => void;
}) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0', color: 'var(--mute)', fontSize: 13 }}>
      <Loader2 size={14} className="animate-spin" /> Loading units…
    </div>
  );
  if (units.length === 0) return (
    <div className={s.empty}>
      <div className={s.emptyIc}><Building2 size={18} /></div>
      <h3 className={s.emptyTtl}>No units</h3>
      <p className={s.emptyDesc}>This property has no units yet.</p>
    </div>
  );
  return (
    <div className={s.units}>
      {units.map(u => {
        const info = pillFor(u);
        const sizeStr = u.unitSizeSqft
          ? `${Number(u.unitSizeSqft).toLocaleString()} sqft`
          : u.unitSizeSqm ? `${Number(u.unitSizeSqm).toLocaleString()} sqm` : null;
        return (
          <div key={u.id} className={s.unit}>
            <div className={s.unitNum}>{u.unitNumber}</div>
            <div className={s.unitMeta}>
              <div className={s.unitTop}>
                <span className={s.unitType}>{u.unitType.replace(/_/g, ' ')}</span>
                {u.bedrooms != null && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.bedrooms} BR</span></>)}
                {u.bathrooms != null && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.bathrooms} BA</span></>)}
                {sizeStr && (<><span className={s.unitDot} /><span className={s.unitSpec}>{sizeStr}</span></>)}
                {u.view && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.view}</span></>)}
              </div>
            </div>
            <div className={s.unitRight}>
              {(u.rentalPrice ?? u.marketPrice) && (
                <div className={s.unitPrice}>
                  AED {Number(u.rentalPrice ?? u.marketPrice).toLocaleString('en-AE')}<small>per year</small>
                </div>
              )}
              <span className={cn(s.pill, info.cls)}><span className={s.pdot} /> {info.label}</span>
              <div className={s.unitActs}>
                <button type="button" className={s.actsBtn} title="Preview unit" onClick={() => onPreviewUnit(u)}>
                  <Eye size={14} />
                </button>
                {canEdit && (
                  <button type="button" className={s.actsBtn} title="Edit property" onClick={onEdit}>
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Property grid card (Grid view, master–detail) ── */
function ManagerPropertyGridCard({
  p, selected, multiLandlord, canEdit, onSelect, onEdit, onShowDetails,
}: {
  p: ManagedProperty; selected: boolean; multiLandlord: boolean; canEdit: boolean;
  onSelect: () => void; onEdit: () => void; onShowDetails: () => void;
}) {
  const loc = [p.community?.nameEn, p.emirate?.nameEn].filter(Boolean).join(', ') || p.fullAddress || '—';
  const iconBtn: CSSProperties = {
    width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#fff', border: '1px solid #e8e6e0', cursor: 'pointer',
  };
  return (
    <div onClick={onSelect} role="button" aria-pressed={selected}
      className="flex flex-col overflow-hidden cursor-pointer"
      style={{
        background: '#fff', borderRadius: 16,
        boxShadow: selected
          ? '0 0 0 2px #2e9f82, 0 2px 12px -2px rgba(0,0,0,0.10)'
          : '0 2px 12px -2px rgba(0,0,0,0.06)',
      }}>
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-base truncate" style={{ color: '#1a1916' }}>{p.buildingName || 'Unnamed Property'}</div>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1.5 inline-block" style={{ background: '#f1efe9', color: '#57544d' }}>{categoryLabel(p.spaceCategory)}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={(e) => { e.stopPropagation(); onShowDetails(); }} title="View property details" style={iconBtn}><Eye size={14} color="#6b6860" /></button>
            {canEdit && <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit property" style={iconBtn}><Pencil size={14} color="#6b6860" /></button>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2.5 text-xs" style={{ color: '#6b6860' }}>
          <MapPin size={12} className="shrink-0" /><span className="truncate">{loc}</span>
        </div>
        <div className="flex items-end gap-5 mt-4">
          <div>
            <div className="text-lg font-bold" style={{ color: '#1a1916' }}>{p.unitCount ?? 0}</div>
            <div className="text-[11px]" style={{ color: '#9b9890' }}>Units</div>
          </div>
          {(p.listedCount ?? 0) > 0 && (
            <div>
              <div className="text-lg font-bold" style={{ color: '#1a1916' }}>{p.listedCount}</div>
              <div className="text-[11px]" style={{ color: '#9b9890' }}>Listed</div>
            </div>
          )}
          {multiLandlord && p.rpName && (
            <div className="ml-auto text-right min-w-0">
              <div className="text-xs font-semibold truncate" style={{ color: 'var(--color-primary, #2e9f82)', maxWidth: 120 }}>{p.rpName}</div>
              <div className="text-[11px]" style={{ color: '#9b9890' }}>Landlord</div>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold"
        style={{ borderTop: '1px solid #f0ede8', color: selected ? '#2e9f82' : '#6b6860' }}>
        {selected ? <>Showing units <Check size={13} /></> : <>View units <ArrowRight size={13} /></>}
      </div>
    </div>
  );
}

/* ── Side panel — the selected property's units (own fetch) ── */
function ManagerUnitsPanel({ p, canEdit, onEdit, onPreviewUnit }: {
  p: ManagedProperty; canEdit: boolean; onEdit: () => void; onPreviewUnit: (u: ManagedUnit) => void;
}) {
  const loc = [p.community?.nameEn, p.emirate?.nameEn].filter(Boolean).join(', ') || p.fullAddress || '—';
  const { data: units = [], isLoading } = useQuery<ManagedUnit[]>({
    queryKey: ['manager-units', p.id],
    queryFn:  () => apiGet<ManagedUnit[]>(`/manager/properties/${p.id}/units`),
  });
  return (
    <div className={cn(s.prop, s.expanded)}>
      <div style={{ padding: '16px 18px 0' }}>
        <div className="font-semibold text-base" style={{ color: '#1a1916' }}>{p.buildingName || 'Unnamed Property'}</div>
        <div className="flex items-center gap-1.5 text-xs mt-1" style={{ color: '#6b6860' }}>
          <MapPin size={12} className="shrink-0" /><span className="truncate">{loc}</span>
        </div>
      </div>
      <div className={s.propBody}>
        <div className={s.unitH}><div className={s.unitHTtl}>Units ({units.length})</div></div>
        <ManagerUnitsList units={units} loading={isLoading} canEdit={canEdit} onPreviewUnit={onPreviewUnit} onEdit={onEdit} />
      </div>
    </div>
  );
}

