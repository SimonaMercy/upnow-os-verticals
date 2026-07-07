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

import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import {
  Building2, MapPin, Plus, Pencil, Trash2, Search,
  Loader2, AlertCircle,
  Map as MapIcon, LayoutGrid, Rows3, Image as ImageIcon,
  Briefcase, DoorClosed, Gauge, Coins,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import {
  PropertyFormModal,
  type PropertyFormData,
  categoryDisplayLabel,
  SPACE_CATEGORIES,
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
  rentTotal?: number;
  coverPhotoUrl?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────
function categoryLabel(cat: string): string {
  return categoryDisplayLabel(cat);
}

// Type-tag palette (matches the design's typeStyle: green / brown / blue / grey).
function typeStyle(label: string): { color: string; bg: string } {
  if (label === 'Mixed-use')   return { color: '#1a7a4f', bg: '#e7f3ec' };
  if (label === 'Industrial')  return { color: '#7a5a2e', bg: '#f3ecdd' };
  if (label === 'Residential') return { color: '#3f6f8f', bg: '#e8f1f6' };
  return { color: '#6b756f', bg: '#eef1ec' };
}

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

const fmtAed = (n: number) => 'AED ' + Math.round(n).toLocaleString('en-US');
// Portfolio gross is large in practice → compact M form (design shows "AED 9.48M").
// Degrade gracefully to a full figure for small portfolios so we never show "0.25M".
const fmtRentKpi = (n: number) =>
  n >= 1_000_000 ? 'AED ' + (n / 1_000_000).toFixed(2) + 'M' : fmtAed(n);

// Filter / sort dropdowns — flat white pill with a hand-drawn chevron (matches
// the design's <select> styling).
const SELECT_STYLE: CSSProperties = {
  fontSize: 13.5, fontWeight: 600, color: '#3a443d', background: '#fff',
  border: '1px solid #e2e7e1', borderRadius: 11, padding: '11px 36px 11px 14px',
  outline: 'none', appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%238d978f' stroke-width='2'><path d='M4 8l4 4 4-4'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 13px center',
};

// Per-property display model shared by the Row and Grid cards.
interface CardVM {
  name: string;
  typeLabel: string;
  address: string | null;
  hasPin: boolean;
  tagColor: string;
  tagBg: string;
  ownLabel: string;
  ownColor: string;
  ownBg: string;
  coverUrl: string | null;
  hasVacancy: boolean;
  vacancyLabel: string;
  occText: string;
  rentText: string;
  rentUnit: string;
  rentColor: string;
}

function toCardVM(p: Property): CardVM {
  const units = p.unitCount ?? 0;
  const occ = p.occupiedCount ?? 0;
  const vac = Math.max(0, units - occ);
  const occPct = units ? (occ / units) * 100 : 0;
  const typeLabel = categoryLabel(p.spaceCategory);
  const ts = typeStyle(typeLabel);
  const own = (p.leasingType ?? 'direct') as LeasingType;
  const os = ownershipStyle(own);
  const rent = p.rentTotal ?? 0;
  const hasPin = p.latitude != null && p.longitude != null;
  return {
    name: p.buildingName,
    typeLabel,
    address: p.fullAddress ?? (hasPin ? 'Pinned on map' : null),
    hasPin,
    tagColor: ts.color,
    tagBg: ts.bg,
    ownLabel: OWNERSHIP_LABEL[own] ?? OWNERSHIP_LABEL.direct,
    ownColor: os.color,
    ownBg: os.bg,
    coverUrl: p.coverPhotoUrl ?? null,
    hasVacancy: vac > 0,
    vacancyLabel: `${vac} vacant`,
    occText: units ? `${occ}/${units} · ${Math.round(occPct)}%` : 'No units',
    rentText: rent ? fmtAed(rent) : 'No rent set',
    rentUnit: rent ? ' /yr' : '',
    rentColor: rent ? '#1a6b4d' : '#aab2ab',
  };
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

// ─── Property card (Row view + Map list) ──────────────────
// Image-left row: photo · name + type tag · address (+ vacancy) · annual rent +
// occupancy · edit/delete. The whole row opens the details popup (units live
// inside it). Mirrors Properties.dc.html ROW VIEW.
function PropertyCard({
  vm, onEdit, onDelete, onShowDetails,
}: {
  vm: CardVM; onEdit: () => void; onDelete: () => void; onShowDetails: () => void;
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
            <span style={{ fontSize: 10, fontWeight: 700, color: vm.ownColor, background: vm.ownBg, padding: '3px 8px', borderRadius: 6, flex: '0 0 auto' }}>{vm.ownLabel}</span>
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

      {/* Tail — rent + occupancy + actions (wraps below on mobile) */}
      <div className={s.dxRowTail}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: vm.rentColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>
            {vm.rentText}<span style={{ fontSize: 11.5, fontWeight: 600, color: '#9aa39c' }}>{vm.rentUnit}</span>
          </div>
          <div style={{ fontSize: 11.5, color: '#9aa39c', marginTop: 2 }}>{vm.occText}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: '0 0 auto' }}>
          <button type="button" className={cn(s.dxIconBtn, s.dxEdit)} title="Edit property" aria-label="Edit property"
            style={{ width: 30, height: 30, borderRadius: 8, color: '#aab2ab' }}
            onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={15} /></button>
          <button type="button" className={cn(s.dxIconBtn, s.dxTrash)} title="Delete property" aria-label="Delete property"
            style={{ width: 30, height: 30, borderRadius: 8, color: '#cbb0aa' }}
            onClick={(e) => { e.stopPropagation(); if (confirm('Delete this property and all its units?')) onDelete(); }}><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  );
}

// ─── Property grid card (Grid view) ───────────────────────
// Cover tile that surfaces the SAME information as the Row view (type tag,
// address + vacancy, annual rent + occupancy text) — no occupancy bar.
function PropertyGridCard({
  vm, onEdit, onDelete, onShowDetails,
}: {
  vm: CardVM; onEdit: () => void; onDelete: () => void; onShowDetails: () => void;
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
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: vm.tagColor, background: '#fff', padding: '4px 9px', borderRadius: 7 }}>{vm.typeLabel}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: vm.ownColor, background: '#fff', padding: '4px 9px', borderRadius: 7 }}>{vm.ownLabel}</span>
        </div>
      </div>

      {/* Body — same fields as the Row view */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vm.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a938c', marginTop: 5 }}>
          <MapPin size={13} style={{ color: vm.hasPin ? '#1a9a64' : '#a0a8a1', flex: '0 0 auto' }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vm.address ?? 'No location set'}</span>
          {vm.hasVacancy && <span style={{ color: '#c79a2e', fontWeight: 600, flex: '0 0 auto' }}>· {vm.vacancyLabel}</span>}
        </div>

        {/* Footer: rent + occupancy + actions */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 13, paddingTop: 12, borderTop: '1px solid #f1f3f0' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: vm.rentColor, fontVariantNumeric: 'tabular-nums' }}>
              {vm.rentText}<span style={{ fontSize: 11, fontWeight: 600, color: '#9aa39c' }}>{vm.rentUnit}</span>
            </div>
            <div style={{ fontSize: 11, color: '#9aa39c' }}>{vm.occText}</div>
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <button type="button" title="Edit property" aria-label="Edit property"
              style={{ ...footBtn, border: '1px solid #e2e7e1', color: '#5a635c' }}
              onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={15} /></button>
            <button type="button" title="Delete property" aria-label="Delete property"
              style={{ ...footBtn, border: '1px solid #f0d8d3', color: '#c44536' }}
              onClick={(e) => { e.stopPropagation(); if (confirm('Delete this property and all its units?')) onDelete(); }}><Trash2 size={14} /></button>
          </div>
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
  // Ownership filter (leasing_type): Owned (direct) · Sub-lease · Managed.
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | LeasingType>('all');
  // Sort order for the property list (matches the design's Sort dropdown).
  const [sort, setSort] = useState<'default' | 'rent' | 'occ' | 'vac' | 'name'>('default');
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

  // Deep-link ?property=<id> (e.g. from a contract's breadcrumb) opens that
  // property's details popup once the list has loaded. Fires once per mount via
  // a ref guard, so closing the popup doesn't immediately re-open it.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current) return;
    const pid = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('property') : null;
    if (!pid) return;
    const match = properties.find((p) => String(p.id) === pid);
    if (match) {
      deepLinkedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailsProperty(match);
    }
  }, [properties]);

  // Type-filter options: the full canonical category list (so every property
  // type is always selectable, not just the ones currently in the portfolio),
  // plus any legacy types still present in the data so they stay filterable.
  const categoryOptions = (() => {
    const canonical = SPACE_CATEGORIES.map((c) => c.id);
    const present = new Set(properties.map((p) => p.spaceCategory).filter(Boolean));
    const extras = Array.from(present).filter((c) => !canonical.includes(c)).sort();
    return [...canonical, ...extras];
  })();

  const filteredProperties = properties.filter((p) => {
    if (categoryFilter !== 'all' && p.spaceCategory !== categoryFilter) return false;
    if (ownershipFilter !== 'all' && (p.leasingType ?? 'direct') !== ownershipFilter) return false;
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

  // Apply the chosen sort (default keeps API order). Memoised so the cards don't
  // re-sort on unrelated re-renders.
  const visibleProperties = useMemo(() => {
    const occRate = (p: Property) => (p.occupiedCount ?? 0) / ((p.unitCount ?? 0) || 1);
    const vacancies = (p: Property) => Math.max(0, (p.unitCount ?? 0) - (p.occupiedCount ?? 0));
    const list = filteredProperties.slice();
    if (sort === 'rent') list.sort((a, b) => (b.rentTotal ?? 0) - (a.rentTotal ?? 0));
    else if (sort === 'occ') list.sort((a, b) => occRate(b) - occRate(a));
    else if (sort === 'vac') list.sort((a, b) => vacancies(b) - vacancies(a));
    else if (sort === 'name') list.sort((a, b) => a.buildingName.localeCompare(b.buildingName));
    return list;
  }, [filteredProperties, sort]);

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
    // Building photos → property media (public bucket). Only the Add flow stages
    // photos here — Edit uploads live in the modal, so `photos` is empty there.
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

  // ── Property-level KPIs (from the loaded properties list) ──
  const totalProperties = properties.length;
  const totalUnits      = properties.reduce((sum, p) => sum + (p.unitCount ?? 0), 0);
  const totalOccupied   = properties.reduce((sum, p) => sum + (p.occupiedCount ?? 0), 0);
  const totalVacant     = Math.max(0, totalUnits - totalOccupied);
  const occRate         = totalUnits ? Math.round((totalOccupied / totalUnits) * 100) : 0;
  const totalRent       = properties.reduce((sum, p) => sum + (p.rentTotal ?? 0), 0);

  // Four-up KPI strip (Properties · Total units · Occupancy · Annual rent).
  const kpis: Array<{ label: string; value: string; sub: string; icon: ReactNode; iconBg: string; iconColor: string; color: string }> = [
    { label: 'PROPERTIES', value: String(totalProperties), sub: 'Buildings under management', icon: <Building2 size={16} />, iconBg: '#eef6f1', iconColor: '#1a7a4f', color: '#1d2823' },
    { label: 'TOTAL UNITS', value: String(totalUnits), sub: 'Across all properties', icon: <DoorClosed size={16} />, iconBg: '#eef6f1', iconColor: '#1a7a4f', color: '#1d2823' },
    { label: 'OCCUPANCY', value: `${occRate}%`, sub: `${totalOccupied} occupied · ${totalVacant} vacant`, icon: <Gauge size={16} />, iconBg: '#eef6f1', iconColor: '#1a7a4f', color: '#1d2823' },
    { label: 'ANNUAL RENT', value: fmtRentKpi(totalRent), sub: 'Gross across portfolio', icon: <Coins size={16} />, iconBg: '#f6f3ea', iconColor: '#8a6d2e', color: '#1a6b4d' },
  ];

  const filtersDirty = !!search || categoryFilter !== 'all' || ownershipFilter !== 'all' || sort !== 'default';

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
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#1a7a4f' }}>
              <Briefcase size={13} /> PORTFOLIO
            </div>
            <h1 style={{ margin: '6px 0 0', fontSize: 30, fontWeight: 800, letterSpacing: '-.025em', color: '#1d2823' }}>Your properties</h1>
            {totalProperties === 0 && (
              <p style={{ margin: '10px 0 0', fontSize: 14, color: '#6b756f', maxWidth: '54ch', lineHeight: 1.55 }}>
                You haven&apos;t added a property yet — once you do, manage all buildings, units, and listings from this dashboard.
              </p>
            )}
          </div>
          <button type="button" className={s.dxAddBtn} onClick={() => setPropertyModal({ open: true })}>
            <Plus size={17} /> Add property
          </button>
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

            {/* Property-type dropdown (built from the types actually present) */}
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

        {/* Error / loading */}
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

        {/* Result count */}
        {!isLoading && !error && totalProperties > 0 && (
          <div style={{ fontSize: 12.5, color: '#8a938c', marginBottom: 12 }}>
            Showing <span style={{ color: '#1d2823', fontWeight: 700 }}>{visibleProperties.length}</span> of {totalProperties} properties
          </div>
        )}

        {/* First-run empty state */}
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
        {!isLoading && visibleProperties.length > 0 && view === 'row' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {visibleProperties.map((p) => (
              <PropertyCard
                key={p.id}
                vm={toCardVM(p)}
                onEdit={() => setPropertyModal({ open: true, editing: p })}
                onDelete={() => deleteProperty.mutate(p.id)}
                onShowDetails={() => setDetailsProperty(p)}
              />
            ))}
          </div>
        )}

        {!isLoading && visibleProperties.length > 0 && view === 'grid' && (
          <div className={s.dxGrid}>
            {visibleProperties.map((p) => (
              <PropertyGridCard
                key={p.id}
                vm={toCardVM(p)}
                onEdit={() => setPropertyModal({ open: true, editing: p })}
                onDelete={() => deleteProperty.mutate(p.id)}
                onShowDetails={() => setDetailsProperty(p)}
              />
            ))}
          </div>
        )}

        {/* Map — full-width. Click a pin to surface that property's details.
            Kept exactly as before per request (only the surrounding page redesigned). */}
        {!isLoading && visibleProperties.length > 0 && view === 'map' && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 8, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
            <PortfolioMapView
              properties={visibleProperties}
              heightClass="h-[78vh]"
              onViewDetails={(id) => {
                const p = visibleProperties.find((x) => x.id === id);
                if (p) setDetailsProperty(p);
              }}
              onEdit={(id) => {
                const p = visibleProperties.find((x) => x.id === id);
                if (p) setPropertyModal({ open: true, editing: p });
              }}
            />
          </div>
        )}

        {/* No matches for the active search / filters (Row + Grid views). */}
        {!isLoading && properties.length > 0 && visibleProperties.length === 0 && view !== 'map' && (
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
            numberOfUnits:       propertyModal.editing.numberOfUnits != null ? String(propertyModal.editing.numberOfUnits) : '',
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
      </div>
    </div>
  );
}
