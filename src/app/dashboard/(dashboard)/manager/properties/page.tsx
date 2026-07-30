'use client';

/**
 * Manager — Properties. Mirrors the RP Portfolio page 1:1 (same
 * portfolio.module.css chrome: Briefcase hero, four-up KPI strip, search + type +
 * sort controls, and Row · Grid · Map views). Every card shows PROPERTY details
 * only and opens the shared PropertyDetailsModal — where the units + documents
 * live (no inline unit expansion). Manager-specific deltas:
 *   • ?rp= scopes the list to one landlord (or "All landlords")
 *   • cards carry a landlord tag in the multi-landlord ("All") view
 *   • actions (edit / add) are gated by the manager's granted permissions
 *   • data comes from the scoped /manager/* endpoints
 */

import { useState, useMemo, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, MapPin, Search, Loader2, Lock, Pencil, Plus,
  LayoutGrid, Rows3, Map as MapIcon, Image as ImageIcon,
  Briefcase, DoorClosed, Gauge, Coins, AlertCircle,
} from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { uploadExtraPropertyDocs } from '@/lib/propertyDocs';
import { PropertyDetailsModal } from '@/app/rental-provider/dashboard/portfolio/PropertyDetailsModal';
import { PortfolioMapView } from '@/app/rental-provider/dashboard/portfolio/PortfolioMapModal';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import {
  PropertyFormModal,
  categoryDisplayLabel,
  SPACE_CATEGORIES,
  type PropertyFormData,
} from '@/components/upnow/PropertyFormModal';
import s from '@/app/rental-provider/dashboard/portfolio/portfolio.module.css';

const cn = (...x: Array<string | false | null | undefined>) => x.filter(Boolean).join(' ');

// ─── Types ────────────────────────────────────────────────
interface ManagedProperty {
  id:              number;
  buildingName:    string;
  fullAddress:     string | null;
  spaceCategory:   string;
  numberOfFloors:  string | null;
  numberOfUnits:   number | null;
  makaniNumber:    string | null;
  rentalProviderId:number;
  rpName?:         string;
  unitCount?:      number;
  listedCount?:    number;
  occupiedCount?:  number;
  rentTotal?:      number;        // Σ units.rental_price — Market Price (asking, all units)
  annualRentTotal?: number;       // Σ latest lease annual_rent — contracted Annual Rent (leased units)
  coverPhotoUrl?:  string | null;
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
  leasingType?:    'direct' | 'sub' | 'management' | null;
}

interface OverviewStats {
  properties: number; units: number; activeContracts: number; openLeads: number;
  rps: { id: number; name: string; propertyCount: number }[];
}

// ─── Helpers (shared visual model with the RP portfolio) ──────
function categoryLabel(c: string) {
  return categoryDisplayLabel(c);
}

// Type-tag palette (matches the RP portfolio: green / brown / blue / grey).
function typeStyle(label: string): { color: string; bg: string } {
  if (label === 'Mixed-use')   return { color: '#1a7a4f', bg: '#e7f3ec' };
  if (label === 'Industrial')  return { color: '#7a5a2e', bg: '#f3ecdd' };
  if (label === 'Residential') return { color: '#3f6f8f', bg: '#e8f1f6' };
  return { color: '#6b756f', bg: '#eef1ec' };
}

const fmtAed = (n: number) => 'AED ' + Math.round(n).toLocaleString('en-US');
// Portfolio gross is large in practice → compact M form ("AED 9.48M"). Degrade
// gracefully to a full figure for small portfolios so we never show "0.25M".
const fmtRentKpi = (n: number) =>
  n >= 1_000_000 ? 'AED ' + (n / 1_000_000).toFixed(2) + 'M' : fmtAed(n);

// Filter / sort dropdowns — flat white pill with a hand-drawn chevron (matches
// the RP portfolio's <select> styling).
const SELECT_STYLE: CSSProperties = {
  fontSize: 13.5, fontWeight: 600, color: '#3a443d', background: '#fff',
  border: '1px solid #e2e7e1', borderRadius: 11, padding: '11px 36px 11px 14px',
  outline: 'none', appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%238d978f' stroke-width='2'><path d='M4 8l4 4 4-4'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 13px center',
};

// Ownership chip (from properties.leasing_type): Owned = direct lease ·
// Sub-lease = head-leased then sub-let · Managed = run on the owner's behalf.
type LeasingType = 'direct' | 'sub' | 'management';
const OWNERSHIP_LABEL: Record<LeasingType, string> = {
  direct: 'Owned', sub: 'Sub-lease', management: 'Managed',
};
function ownershipStyle(t: LeasingType): { color: string; bg: string } {
  if (t === 'sub')        return { color: '#6d4fa1', bg: '#f0eaf8' };
  if (t === 'management') return { color: '#8a6d2e', bg: '#f6f0e0' };
  return { color: '#1a6b4d', bg: '#e6f3ec' };
}

// Per-property display model shared by the Row and Grid cards. `landlord` is the
// only manager addition (surfaced in the "All landlords" view).
interface CardVM {
  name: string;
  typeLabel: string;
  address: string | null;
  hasPin: boolean;
  tagColor: string;
  tagBg: string;
  coverUrl: string | null;
  hasVacancy: boolean;
  vacancyLabel: string;
  occText: string;
  rentText: string;      // Market Price (asking) headline
  rentUnit: string;
  rentColor: string;
  annualText: string | null;  // contracted Annual Rent — null when nothing is leased
  landlord: string | null;
}

function toCardVM(p: ManagedProperty, showLandlord: boolean): CardVM {
  const units = p.unitCount ?? 0;
  const occ = p.occupiedCount ?? 0;
  const vac = Math.max(0, units - occ);
  const occPct = units ? (occ / units) * 100 : 0;
  const typeLabel = categoryLabel(p.spaceCategory);
  const ts = typeStyle(typeLabel);
  const rent = p.rentTotal ?? 0;
  const annual = p.annualRentTotal ?? 0;
  const hasPin = p.latitude != null && p.longitude != null;
  const joined = [p.community?.nameEn, p.emirate?.nameEn].filter(Boolean).join(', ');
  const loc = p.fullAddress ?? (joined || null);
  return {
    name: p.buildingName || 'Unnamed Property',
    typeLabel,
    address: loc ?? (hasPin ? 'Pinned on map' : null),
    hasPin,
    tagColor: ts.color,
    tagBg: ts.bg,
    coverUrl: p.coverPhotoUrl ?? null,
    hasVacancy: vac > 0,
    vacancyLabel: `${vac} vacant`,
    occText: units ? `${occ}/${units} · ${Math.round(occPct)}%` : 'No units',
    rentText: rent ? fmtAed(rent) : 'No rent set',
    rentUnit: rent ? ' /yr' : '',
    rentColor: rent ? '#1a6b4d' : '#aab2ab',
    annualText: annual ? fmtAed(annual) : null,
    landlord: showLandlord ? (p.rpName ?? null) : null,
  };
}

/** Map the property-form values to the update DTO (mirrors the RP portfolio). */
function formToUpdateDto(data: PropertyFormData) {
  const parts = [data.street, data.communityName, data.emirateName].filter(Boolean);
  return {
    buildingName: data.buildingName,
    spaceCategory: data.spaceCategory,
    leasingType: data.leasingType ?? undefined,
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

// Cover image (or a placeholder tile when no photo is on file).
function Cover({ url, iconSize, iconColor }: { url: string | null; iconSize: number; iconColor: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  return <ImageIcon size={iconSize} style={{ color: iconColor }} />;
}

// Landlord tag (multi-landlord "All" view only). Muted grey chip, truncated.
function LandlordTag({ name }: { name: string }) {
  return (
    <span title={`Landlord: ${name}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: '#6b756f', background: '#eef1ec', padding: '3px 8px', borderRadius: 6, flex: '0 1 auto', minWidth: 0, maxWidth: 160, overflow: 'hidden' }}>
      <Building2 size={11} style={{ flex: '0 0 auto' }} />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </span>
  );
}

// ─── Property card (Row view + Map list) ──────────────────
// Image-left row: photo · name + type tag (+ landlord tag) · address (+ vacancy) ·
// annual rent + occupancy · edit. The whole row opens the details popup (units
// live inside it). Mirrors the RP portfolio ROW VIEW; delete is RP-only.
function PropertyCard({
  vm, canEdit, onEdit, onShowDetails,
}: {
  vm: CardVM; canEdit: boolean; onEdit: () => void; onShowDetails: () => void;
}) {
  return (
    <div onClick={onShowDetails} role="button" title="View property details" className={s.dxRowCard}>
      {/* Lead — photo + name/address (shrinks first) */}
      <div className={s.dxRowLead}>
        <div style={{ width: 52, height: 52, flex: '0 0 52px', borderRadius: 10, background: '#f1f3f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Cover url={vm.coverUrl} iconSize={22} iconColor="#b9c1ba" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-.01em', color: '#1d2823', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vm.name}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: vm.tagColor, background: vm.tagBg, padding: '3px 8px', borderRadius: 6, flex: '0 0 auto' }}>{vm.typeLabel}</span>
            {vm.landlord && <LandlordTag name={vm.landlord} />}
          </div>
          {vm.address && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#9aa39c', marginTop: 4 }}>
              <MapPin size={13} style={{ flex: '0 0 auto', color: vm.hasPin ? '#1a9a64' : '#9aa39c' }} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vm.address}</span>
              {vm.hasVacancy && <span style={{ color: '#c79a2e', fontWeight: 600, flex: '0 0 auto' }}>· {vm.vacancyLabel}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Tail — market price / annual rent + occupancy + action (wraps on mobile) */}
      <div className={s.dxRowTail}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: '#a0a8a1' }}>MARKET PRICE</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: vm.rentColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>
            {vm.rentText}<span style={{ fontSize: 11.5, fontWeight: 600, color: '#9aa39c' }}>{vm.rentUnit}</span>
          </div>
          <div style={{ fontSize: 11.5, color: '#8a938c', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
            {vm.annualText ? <>Annual rent <span style={{ fontWeight: 700, color: '#3a443d' }}>{vm.annualText}</span></> : <span style={{ color: '#aab2ab' }}>No lease yet</span>}
          </div>
          <div style={{ fontSize: 11.5, color: '#9aa39c', marginTop: 2 }}>{vm.occText}</div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: '0 0 auto' }}>
            <button type="button" className={cn(s.dxIconBtn, s.dxEdit)} title="Edit property" aria-label="Edit property"
              style={{ width: 30, height: 30, borderRadius: 8, color: '#aab2ab' }}
              onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={15} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Property grid card (Grid view) ───────────────────────
// Cover tile that surfaces the SAME information as the Row view (type tag,
// address + vacancy, annual rent + occupancy text, landlord tag).
function PropertyGridCard({
  vm, canEdit, onEdit, onShowDetails,
}: {
  vm: CardVM; canEdit: boolean; onEdit: () => void; onShowDetails: () => void;
}) {
  const footBtn: CSSProperties = {
    width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', cursor: 'pointer',
  };
  return (
    <div onClick={onShowDetails} role="button" title="View property details" className={s.dxGridCard}
      style={{ background: '#fff', border: '1px solid #e7ebe6', borderRadius: 15, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 2px rgba(20,40,30,.03)' }}>
      {/* Cover + type badge */}
      <div style={{ height: 138, background: '#f1f3f0', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        <Cover url={vm.coverUrl} iconSize={22} iconColor="#b3bcb4" />
        <span style={{ position: 'absolute', top: 10, left: 10, fontSize: 10.5, fontWeight: 700, color: vm.tagColor, background: '#fff', padding: '4px 9px', borderRadius: 7 }}>{vm.typeLabel}</span>
      </div>

      {/* Body — same fields as the Row view */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vm.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a938c', marginTop: 5 }}>
          <MapPin size={13} style={{ color: vm.hasPin ? '#1a9a64' : '#a0a8a1', flex: '0 0 auto' }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vm.address ?? 'No location set'}</span>
          {vm.hasVacancy && <span style={{ color: '#c79a2e', fontWeight: 600, flex: '0 0 auto' }}>· {vm.vacancyLabel}</span>}
        </div>
        {vm.landlord && <div style={{ marginTop: 8 }}><LandlordTag name={vm.landlord} /></div>}

        {/* Footer: rent + occupancy + action */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 13, paddingTop: 12, borderTop: '1px solid #f1f3f0' }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: '#a0a8a1' }}>MARKET PRICE</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: vm.rentColor, fontVariantNumeric: 'tabular-nums' }}>
              {vm.rentText}<span style={{ fontSize: 11, fontWeight: 600, color: '#9aa39c' }}>{vm.rentUnit}</span>
            </div>
            <div style={{ fontSize: 11, color: '#8a938c', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {vm.annualText ? <>Annual rent <span style={{ fontWeight: 700, color: '#3a443d' }}>{vm.annualText}</span></> : <span style={{ color: '#aab2ab' }}>No lease yet</span>}
            </div>
            <div style={{ fontSize: 11, color: '#9aa39c', marginTop: 1 }}>{vm.occText}</div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 7 }}>
              <button type="button" title="Edit property" aria-label="Edit property"
                style={{ ...footBtn, border: '1px solid #e2e7e1', color: '#5a635c' }}
                onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={15} /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────
export default function ManagerPropertiesPage() {
  const { can, canForRp, loading: permsLoading } = useManagerPermissions();
  const params   = useSearchParams();
  const router   = useRouter();
  const rpFilter = params.get('rp') ? Number(params.get('rp')) : null;
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  // Property-type filter (spaceCategory), chosen from a dropdown.
  const [categoryFilter, setCategoryFilter] = useState('all');
  // Ownership filter (leasing_type): Owned (direct) · Sub-lease · Managed.
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | LeasingType>('all');
  // Sort order for the property list (matches the RP portfolio Sort dropdown).
  const [sort, setSort] = useState<'default' | 'rent' | 'occ' | 'vac' | 'name'>('default');
  const [propertyModal, setPropertyModal] = useState<{ open: boolean; editing?: ManagedProperty }>({ open: false });
  // Read-only preview popup (shows the property's units + documents inside).
  const [detailsProperty, setDetailsProperty] = useState<ManagedProperty | null>(null);
  // Main content view: Row (list) · Grid (tiles) · Map. All cards open the popup.
  const [view, setView] = useState<'row' | 'grid' | 'map'>('row');

  const { data: properties = [], isLoading, error } = useQuery<ManagedProperty[]>({
    queryKey: ['manager-properties'],
    queryFn:  () => apiGet<ManagedProperty[]>('/manager/properties'),
  });
  // `?property=<id>` opens that property's details popup once the list has loaded
  // — the same deep-link the landlord's portfolio honours, so a link from a lead
  // lands on the property rather than a bare list. Once per mount, so closing the
  // popup doesn't immediately re-open it.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current) return;
    const pid = params.get('property');
    if (!pid) return;
    const match = properties.find((p) => String(p.id) === pid);
    if (match) {
      deepLinkedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailsProperty(match);
    }
  }, [properties, params]);

  // Overview backs only the managed-landlord count in the hero subtitle.
  const { data: stats } = useQuery<OverviewStats>({
    queryKey: ['manager-overview'],
    queryFn:  () => apiGet<OverviewStats>('/manager/overview'),
  });

  // The modal is used only for EDITING property details (Add uses the wizard at
  // /dashboard/manager/properties/add, which requires a landlord context).
  async function handleSaveProperty(form: PropertyFormData, titleDeed?: File | null, drawings?: File[], extraDocs?: Record<string, File[]>) {
    if (!propertyModal.editing) return;
    const propertyId = propertyModal.editing.id;
    await apiPatch(`/properties/${propertyId}`, formToUpdateDto(form));
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
    await qc.invalidateQueries({ queryKey: ['manager-properties'] });
    setPropertyModal({ open: false });
  }

  // Scope: rp filter (landlord) only — KPIs + type options are portfolio-wide
  // within the selected landlord, matching the RP portfolio semantics.
  const scoped = useMemo(
    () => properties.filter(p => !rpFilter || p.rentalProviderId === rpFilter),
    [properties, rpFilter],
  );
  const multiLandlord = !rpFilter;

  // Type-filter options: the full canonical category list (so every property type
  // is always selectable), plus any legacy types present in the scoped data.
  const categoryOptions = useMemo(() => {
    const canonical = SPACE_CATEGORIES.map((c) => c.id);
    const present = new Set(scoped.map((p) => p.spaceCategory).filter(Boolean));
    const extras = Array.from(present).filter((c) => !canonical.includes(c)).sort();
    return [...canonical, ...extras];
  }, [scoped]);

  const filteredProperties = scoped.filter((p) => {
    if (categoryFilter !== 'all' && p.spaceCategory !== categoryFilter) return false;
    if (ownershipFilter !== 'all' && (p.leasingType ?? 'direct') !== ownershipFilter) return false;
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

  // Apply the chosen sort (default keeps API order — newest first).
  const visibleProperties = useMemo(() => {
    const occRate = (p: ManagedProperty) => (p.occupiedCount ?? 0) / ((p.unitCount ?? 0) || 1);
    const vacancies = (p: ManagedProperty) => Math.max(0, (p.unitCount ?? 0) - (p.occupiedCount ?? 0));
    const list = filteredProperties.slice();
    if (sort === 'rent') list.sort((a, b) => (b.rentTotal ?? 0) - (a.rentTotal ?? 0));
    else if (sort === 'occ') list.sort((a, b) => occRate(b) - occRate(a));
    else if (sort === 'vac') list.sort((a, b) => vacancies(b) - vacancies(a));
    else if (sort === 'name') list.sort((a, b) => a.buildingName.localeCompare(b.buildingName));
    return list;
  }, [filteredProperties, sort]);

  // Group the visible properties by ownership — section header + count chip,
  // largest group first (mirrors the RP portfolio / units-page grouping).
  const ownershipGroups = useMemo(() => {
    const order: LeasingType[] = ['direct', 'sub', 'management'];
    const m = new Map<LeasingType, ManagedProperty[]>();
    for (const p of visibleProperties) {
      const k = (p.leasingType ?? 'direct') as LeasingType;
      (m.get(k) ?? m.set(k, []).get(k)!).push(p);
    }
    return Array.from(m.entries())
      .map(([own, items]) => ({ own, items }))
      .sort((a, b) => (b.items.length - a.items.length) || (order.indexOf(a.own) - order.indexOf(b.own)));
  }, [visibleProperties]);

  // Shared group header (Owned / Sub-lease / Managed + property count).
  const groupHeader = (own: LeasingType, count: number) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 12px' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: ownershipStyle(own).color, flex: '0 0 auto' }} />
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.01em', color: '#1d2823' }}>{OWNERSHIP_LABEL[own]}</div>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#7d8780', background: '#eef1ec', padding: '4px 10px', borderRadius: 7 }}>
        {count} {count === 1 ? 'property' : 'properties'}
      </span>
    </div>
  );

  // ── Property-level KPIs (from the scoped properties list) ──
  const totalProperties = scoped.length;
  const totalUnits      = scoped.reduce((sum, p) => sum + (p.unitCount ?? 0), 0);
  const totalOccupied   = scoped.reduce((sum, p) => sum + (p.occupiedCount ?? 0), 0);
  const totalVacant     = Math.max(0, totalUnits - totalOccupied);
  const occRate         = totalUnits ? Math.round((totalOccupied / totalUnits) * 100) : 0;
  const totalRent       = scoped.reduce((sum, p) => sum + (p.rentTotal ?? 0), 0);
  const totalAnnualRent = scoped.reduce((sum, p) => sum + (p.annualRentTotal ?? 0), 0);
  const landlordCount   = rpFilter ? 1 : (stats?.rps.length ?? 0);

  // Four-up KPI strip (Properties · Total units · Occupancy · Market price / Annual rent).
  // The money tile pairs Market Price (Σ asking rent, all units) with the contracted
  // Annual Rent (Σ latest lease, leased units) so the asking-vs-earning gap is visible.
  const kpis: Array<{ label: string; value: string; sub: string; icon: ReactNode; iconBg: string; iconColor: string; color: string }> = [
    { label: 'PROPERTIES', value: String(totalProperties), sub: rpFilter ? 'For this landlord' : 'Across your landlords', icon: <Building2 size={16} />, iconBg: '#eef6f1', iconColor: '#1a7a4f', color: '#1d2823' },
    { label: 'TOTAL UNITS', value: String(totalUnits), sub: 'Across all properties', icon: <DoorClosed size={16} />, iconBg: '#eef6f1', iconColor: '#1a7a4f', color: '#1d2823' },
    { label: 'OCCUPANCY', value: `${occRate}%`, sub: `${totalOccupied} occupied · ${totalVacant} vacant`, icon: <Gauge size={16} />, iconBg: '#eef6f1', iconColor: '#1a7a4f', color: '#1d2823' },
    { label: 'MARKET PRICE / ANNUAL RENT', value: fmtRentKpi(totalRent), sub: `Annual rent ${totalAnnualRent ? fmtRentKpi(totalAnnualRent) : '—'} · asking vs contracted`, icon: <Coins size={16} />, iconBg: '#f6f3ea', iconColor: '#8a6d2e', color: '#1a6b4d' },
  ];

  const filtersDirty = !!search || categoryFilter !== 'all' || ownershipFilter !== 'all' || sort !== 'default';

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

        {/* Hero */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#1a7a4f' }}>
              <Briefcase size={13} /> PORTFOLIO
            </div>
            <h1 style={{ margin: '6px 0 0', fontSize: 30, fontWeight: 800, letterSpacing: '-.025em', color: '#1d2823' }}>Managed properties</h1>
            <p style={{ margin: '10px 0 0', fontSize: 14, color: '#6b756f', maxWidth: '54ch', lineHeight: 1.55 }}>
              {totalProperties === 0
                ? 'No properties assigned to you yet — your landlords will appear here once they grant access.'
                : `Managing ${totalProperties} propert${totalProperties === 1 ? 'y' : 'ies'}${rpFilter ? ' for this landlord' : landlordCount ? ` across ${landlordCount} landlord${landlordCount === 1 ? '' : 's'}` : ''}.`}
            </p>
          </div>
          {(rpFilter ? canForRp('canEditProperties', rpFilter) : can('canEditProperties')) && (
            <button
              type="button"
              className={s.dxAddBtn}
              style={rpFilter ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
              title={rpFilter ? 'Add a property on this landlord’s behalf' : 'Pick a landlord from the switcher first'}
              onClick={() => rpFilter
                ? router.push(`/dashboard/manager/properties/add?rp=${rpFilter}`)
                : alert('Select a specific landlord (top-right) to add a property on their behalf.')}
            >
              <Plus size={17} /> Add property
            </button>
          )}
        </div>

        {/* KPI strip */}
        {totalProperties > 0 && (
          <div className={s.dxKpiGrid}>
            {kpis.map((k) => (
              <div key={k.label} style={{ background: '#fff', border: '1px solid #e7ebe6', borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: 9, background: k.iconBg, color: k.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{k.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#a0a8a1' }}>{k.label}</span>
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: k.color, marginTop: 11, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
                <div style={{ fontSize: 11.5, color: '#9aa39c', marginTop: 2 }}>{k.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Controls — search · type · sort · view toggle */}
        {totalProperties > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9aa39c', display: 'inline-flex' }}><Search size={17} /></span>
              <input
                type="text"
                placeholder="Search building, area, emirate…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', fontSize: 14, color: '#1d2823', background: '#fff', border: '1px solid #e2e7e1', borderRadius: 11, padding: '11px 14px 11px 40px', outline: 'none' }}
              />
            </div>

            {/* Property-type dropdown */}
            {categoryOptions.length > 0 && (
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={SELECT_STYLE}>
                <option value="all">All property types</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
            )}

            {/* Ownership dropdown — Owned (direct) · Sub-lease · Managed */}
            <select value={ownershipFilter} onChange={(e) => setOwnershipFilter(e.target.value as typeof ownershipFilter)} style={SELECT_STYLE}>
              <option value="all">All ownership</option>
              <option value="direct">Owned (direct lease)</option>
              <option value="sub">Sub-lease</option>
              <option value="management">Managed</option>
            </select>

            {/* Sort dropdown */}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={SELECT_STYLE}>
              <option value="default">Sort: Default</option>
              <option value="rent">Rent (high → low)</option>
              <option value="occ">Occupancy</option>
              <option value="vac">Vacancies first</option>
              <option value="name">Name A–Z</option>
            </select>

            {/* View toggle — Row · Grid · Map */}
            <div style={{ display: 'flex', background: '#eef1ec', borderRadius: 11, padding: 3 }}>
              {([['row', Rows3, 'Row'], ['grid', LayoutGrid, 'Grid'], ['map', MapIcon, 'Map']] as const).map(([v, Icon, label]) => {
                const active = view === v;
                return (
                  <button key={v} type="button" onClick={() => setView(v)} title={`${label} view`} aria-pressed={active}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700,
                      padding: '7px 13px', borderRadius: 9, cursor: 'pointer', border: 0,
                      color: active ? '#1d2823' : '#7d8780', background: active ? '#fff' : 'transparent',
                      boxShadow: active ? '0 1px 3px rgba(20,40,30,.12)' : 'none',
                    }}>
                    <Icon size={14} /> {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Result count */}
        {!isLoading && !permsLoading && totalProperties > 0 && (
          <div style={{ fontSize: 12.5, color: '#8a938c', marginBottom: 12 }}>
            Showing <span style={{ color: '#1d2823', fontWeight: 700 }}>{visibleProperties.length}</span> of {totalProperties} properties
          </div>
        )}

        {/* Error — surfaced instead of the misleading "no properties" empty state */}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--danger-bg)', color: 'var(--danger-fg)', borderRadius: 10, marginBottom: 16, fontSize: 13.5 }}>
            <AlertCircle size={14} /> {(error as Error).message || 'Could not load properties. Please try again.'}
          </div>
        )}

        {/* Loading */}
        {(isLoading || permsLoading) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 0', color: 'var(--mute)' }}>
            <Loader2 size={18} className="animate-spin" /> Loading properties…
          </div>
        )}

        {/* First-run empty state (only when the fetch succeeded and returned none) */}
        {!isLoading && !permsLoading && !error && scoped.length === 0 && (
          <div className={s.empty}>
            <div className={s.emptyIc}><Building2 size={22} /></div>
            <h3 className={s.emptyTtl}>No properties yet</h3>
            <p className={s.emptyDesc}>Your landlords haven’t assigned any properties to you yet.</p>
          </div>
        )}

        {/* ── Main content (Row · Grid · Map). Every card opens the popup. ── */}
        {!isLoading && !permsLoading && visibleProperties.length > 0 && view === 'row' && (
          <>
            {ownershipGroups.map((g) => (
              <section key={g.own} style={{ marginBottom: 26 }}>
                {groupHeader(g.own, g.items.length)}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {g.items.map((p) => (
                    <PropertyCard
                      key={p.id}
                      vm={toCardVM(p, multiLandlord)}
                      canEdit={canForRp('canEditProperties', p.rentalProviderId)}
                      onEdit={() => setPropertyModal({ open: true, editing: p })}
                      onShowDetails={() => setDetailsProperty(p)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {!isLoading && !permsLoading && visibleProperties.length > 0 && view === 'grid' && (
          <>
            {ownershipGroups.map((g) => (
              <section key={g.own} style={{ marginBottom: 26 }}>
                {groupHeader(g.own, g.items.length)}
                <div className={s.dxGrid}>
                  {g.items.map((p) => (
                    <PropertyGridCard
                      key={p.id}
                      vm={toCardVM(p, multiLandlord)}
                      canEdit={canForRp('canEditProperties', p.rentalProviderId)}
                      onEdit={() => setPropertyModal({ open: true, editing: p })}
                      onShowDetails={() => setDetailsProperty(p)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {/* Map — full-width. Click a pin to surface that property's details. */}
        {!isLoading && !permsLoading && visibleProperties.length > 0 && view === 'map' && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 8, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
            <PortfolioMapView
              heightClass="h-[78vh]"
              properties={visibleProperties.map((p) => ({
                id: p.id,
                buildingName: p.buildingName,
                latitude: p.latitude ?? null,
                longitude: p.longitude ?? null,
                fullAddress: p.fullAddress ?? null,
                unitCount: p.unitCount,
                occupiedCount: p.occupiedCount,
                rentTotal: p.rentTotal,
                coverPhotoUrl: p.coverPhotoUrl,
                spaceCategory: p.spaceCategory,
              }))}
              onViewDetails={(id) => {
                const p = visibleProperties.find((x) => x.id === id);
                if (p) setDetailsProperty(p);
              }}
              onEdit={(rpFilter ? canForRp('canEditProperties', rpFilter) : can('canEditProperties')) ? (id) => {
                const p = visibleProperties.find((x) => x.id === id);
                // Per-landlord gate: never open the editor for a property whose
                // landlord hasn't granted this manager edit rights.
                if (p && canForRp('canEditProperties', p.rentalProviderId)) setPropertyModal({ open: true, editing: p });
              } : undefined}
            />
          </div>
        )}

        {/* No matches for the active search / filters (Row + Grid views). */}
        {!isLoading && !permsLoading && scoped.length > 0 && visibleProperties.length === 0 && view !== 'map' && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9aa39c' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#3a443d' }}>No properties match your search</div>
            <div style={{ fontSize: 13, marginTop: 5 }}>Try a different name, area, or type.</div>
            {filtersDirty && (
              <button type="button" onClick={() => { setSearch(''); setCategoryFilter('all'); setOwnershipFilter('all'); setSort('default'); }}
                style={{ marginTop: 14, fontSize: 12.5, fontWeight: 600, color: '#1a7a4f', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {/* Edit only — Add uses the wizard (needs a landlord context). */}
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

      {/* Read-only preview popup (shared component, manager-scoped data). Units +
          documents live inside it — fetched from the scoped /manager base. */}
      {detailsProperty && (
        <PropertyDetailsModal
          fetchBase="/manager/properties"
          editable={canForRp('canManageDocuments', detailsProperty.rentalProviderId)}
          canEditPricing={canForRp('canEditProperties', detailsProperty.rentalProviderId)}
          pricingRp={detailsProperty.rentalProviderId}
          property={{
            id: detailsProperty.id,
            buildingName: detailsProperty.buildingName,
            spaceCategory: detailsProperty.spaceCategory,
            fullAddress: detailsProperty.fullAddress ?? null,
            emirateName: detailsProperty.emirate?.nameEn ?? null,
            communityName: detailsProperty.community?.nameEn ?? null,
            street: detailsProperty.street ?? null,
            makaniNumber: detailsProperty.makaniNumber ?? null,
            plotNumber: detailsProperty.plotNumber ?? null,
            latitude: detailsProperty.latitude ?? null,
            longitude: detailsProperty.longitude ?? null,
            hasGym: detailsProperty.hasGym ?? false,
            hasPool: detailsProperty.hasPool ?? false,
            hasParking: detailsProperty.hasParking ?? false,
            isStandaloneUnit: detailsProperty.isStandaloneUnit ?? false,
            leasingType: detailsProperty.leasingType ?? null,
            sharedAmenities: detailsProperty.sharedAmenities ?? null,
            propertyDescription: detailsProperty.propertyDescription ?? null,
            numberOfFloors: detailsProperty.numberOfFloors ?? null,
            createdAt: '',
            unitCount: detailsProperty.unitCount,
          }}
          stats={{
            units: detailsProperty.unitCount ?? 0,
            occupied: detailsProperty.occupiedCount ?? 0,
            rentTotal: detailsProperty.rentTotal ?? 0,
          }}
          onEdit={canForRp('canEditProperties', detailsProperty.rentalProviderId) ? () => {
            const editing = detailsProperty;
            setDetailsProperty(null);
            setPropertyModal({ open: true, editing });
          } : undefined}
          onClose={() => setDetailsProperty(null)}
        />
      )}
    </div>
  );
}
