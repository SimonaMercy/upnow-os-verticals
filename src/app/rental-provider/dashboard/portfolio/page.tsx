/**
 * Rental Provider — Property Portfolio (rental-provider/dashboard/portfolio)
 *
 * Lists all of the RP's properties with their units and availability status.
 * Each property card shows: building name, unit count, occupancy rate,
 * listing status, and quick links to add units / create contract.
 *
 * Data: GET /properties/my (returns properties with nested units).
 * Unit availability: available | occupied | maintenance | unlisted.
 *
 * The "Add property" flow (SCRUM-2xx — property listing wizard) is not yet
 * built; the button links to rental-provider/dashboard/portfolio/new.
 */
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Building2, LayoutGrid, List, MapPin, Plus, Pencil, Trash2,
  ChevronDown, ChevronUp, Loader2, AlertCircle, Camera, X, ImagePlus, Trash, Eye, FileText, Radio
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import Link from 'next/link';
import {
  PropertyFormModal,
  type PropertyFormData,
  SPACE_CATEGORIES,
} from '@/components/upnow/PropertyFormModal';
import {
  UnitFormModal,
  type UnitFormData,
} from '@/components/upnow/UnitFormModal';
import { EmptyState } from '@/components/ui/EmptyState';

// ─── Types ────────────────────────────────────────────────
interface Property {
  id: number;
  buildingName: string;
  spaceCategory: string;
  fullAddress: string | null;
  makaniNumber: string | null;
  latitude: number | null;
  longitude: number | null;
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  isStandaloneUnit: boolean;
  propertyDescription: string | null;
  numberOfFloors: string | null;
  createdAt: string;
}

interface Unit {
  id: number;
  propertyId: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  unitTier: string;
  floor: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  view: string | null;
  facilities: string | null;
  rentalPrice: number | null;
  marketPrice: number | null;
  serviceCharges: number | null;
  availability: string;
  description: string | null;
  isListed: boolean;
}

type ViewMode = 'card' | 'table';

interface ContractSummary {
  id: number;
  status: string;
  contractActive: boolean;
  endDate: string | null;
  tenant: { id: number | null; name: string | null } | null;
  unit: { id: number | null } | null;
}

interface UnitMediaItem {
  id: number;
  url: string;
  caption: string | null;
  sortOrder: number;
}

// ─── Helpers ──────────────────────────────────────────────
function amenitiesFromUnit(unit: Unit): string[] {
  if (!unit.facilities) return [];
  try { return JSON.parse(unit.facilities) as string[]; } catch { return []; }
}

function categoryIcon(cat: string): string {
  return SPACE_CATEGORIES.find(c => c.id === cat)?.icon ?? '🏢';
}

function categoryLabel(cat: string): string {
  return SPACE_CATEGORIES.find(c => c.id === cat)?.label ?? cat;
}

// ─── API mappers ──────────────────────────────────────────
function formToCreateDto(data: PropertyFormData) {
  const parts = [data.street, data.communityName, data.emirateName].filter(Boolean);
  return {
    buildingName: data.buildingName,
    spaceCategory: data.spaceCategory,
    fullAddress: parts.join(', ') || undefined,
    emirateId: data.emirateId ?? undefined,
    communityId: data.communityId ?? undefined,
    numberOfFloors: data.numberOfFloors || undefined,
    makaniNumber: data.makaniNumber || undefined,
    plotNumber: data.plotNumber || undefined,
    latitude: data.latitude ?? undefined,
    longitude: data.longitude ?? undefined,
    hasGym: data.hasGym,
    hasPool: data.hasPool,
    hasParking: data.hasParking,
    isStandaloneUnit: data.isStandaloneUnit,
    propertyDescription: data.propertyDescription || undefined,
  };
}

function unitFormToDto(data: UnitFormData) {
  return {
    unitNumber: data.unitNumber,
    unitName: data.unitName || undefined,
    unitType: data.unitType,
    unitTier: data.unitTier || 'standard',
    floor: data.floor || undefined,
    unitSizeSqft: data.unitSizeSqft ? Number(data.unitSizeSqft) : undefined,
    bedrooms: data.bedrooms && data.bedrooms !== 'Studio' ? Number(data.bedrooms) : undefined,
    bathrooms: data.bathrooms ? Number(data.bathrooms) : undefined,
    amenities: data.amenities.length > 0 ? data.amenities : undefined,
    view: data.view || undefined,
    rentalPrice: data.rentalPrice ? Number(data.rentalPrice) : undefined,
    serviceCharges: data.serviceCharges ? Number(data.serviceCharges) : undefined,
    description: data.description || undefined,
  };
}

// ─── Unit Photo Manager ───────────────────────────────────
function UnitPhotoManager({ unit, propertyId, onClose }: { unit: Unit; propertyId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const qKey = ['unit-media', unit.id];

  const { data: photos = [], isLoading } = useQuery<UnitMediaItem[]>({
    queryKey: qKey,
    queryFn: () => apiGet(`/properties/${propertyId}/units/${unit.id}/media`),
  });

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await fetch(`/api/properties/${propertyId}/units/${unit.id}/media`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        }).then(async r => {
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error((err as { message?: string }).message ?? 'Upload failed');
          }
        });
      }
      await qc.invalidateQueries({ queryKey: qKey });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }, [propertyId, unit.id, qc, qKey]);

  const deletePhoto = useMutation({
    mutationFn: (mediaId: number) =>
      apiDelete(`/properties/${propertyId}/units/${unit.id}/media/${mediaId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qKey }),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0]">
          <div>
            <h2 className="font-semibold text-[#1a1916]">Photos — #{unit.unitNumber}</h2>
            <p className="text-xs text-[#9b9890] mt-0.5">{photos.length}/20 photos</p>
          </div>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] cursor-pointer"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-[#2e9f82]" /></div>
          ) : photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-[#9b9890]">
              <Camera size={36} className="mb-3 opacity-30" />
              <p className="text-sm">No photos yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {photos.map(p => (
                <div key={p.id} className="relative group rounded-xl overflow-hidden bg-[#f4f3ef] aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`http://localhost:3000${p.url}`}
                    alt={p.caption ?? 'Unit photo'}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => { if (confirm('Delete this photo?')) deletePhoto.mutate(p.id); }}
                    className="absolute top-1.5 right-1.5 bg-white/90 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700 cursor-pointer"
                  >
                    <Trash size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploadError && (
            <p className="mt-4 text-xs text-red-500 flex items-center gap-1">
              <AlertCircle size={12} /> {uploadError}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#e8e6e0]">
          <label className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-opacity ${photos.length >= 20 || uploading ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'}`} style={{ background: '#2e9f82', color: '#fff' }}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {uploading ? 'Uploading…' : 'Add Photos'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={photos.length >= 20 || uploading}
              onChange={handleFileChange}
              className="sr-only"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

// ─── Property Card ────────────────────────────────────────
function PropertyCard({
  property, units, contracts, expanded, onToggle, onEdit, onDelete,
  onAddUnit, onEditUnit, onDeleteUnit, onManagePhotos, onToggleListing,
}: {
  property: Property; units: Unit[]; contracts: ContractSummary[]; expanded: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
  onAddUnit: () => void; onEditUnit: (u: Unit) => void; onDeleteUnit: (uid: number) => void;
  onManagePhotos: (u: Unit) => void; onToggleListing: (u: Unit) => void;
}) {
  const totalRent = units.reduce((s, u) => s + (Number(u.rentalPrice ?? u.marketPrice) || 0), 0);
  const occupied = units.filter(u => u.availability === 'occupied').length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#e8e6e0] overflow-hidden">
      <div className="flex items-center justify-between p-5 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-[#d8f2e8] flex items-center justify-center text-2xl shrink-0">
            {categoryIcon(property.spaceCategory)}
          </div>
          <div>
            <div className="font-semibold text-[#1a1916]">{property.buildingName}</div>
            <div className="text-xs text-[#9b9890] mt-0.5 flex items-center gap-1">
              <MapPin size={11} />
              {property.fullAddress ?? '—'}
              {property.makaniNumber && (
                <span className="ml-2 font-mono text-[10px] text-[#b0ae9a]">Makani {property.makaniNumber}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-bold text-[#2e9f82]">AED {totalRent.toLocaleString('en-AE')}</div>
            <div className="text-[10px] text-[#9b9890]">/year · {units.length} unit{units.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={e => { e.stopPropagation(); onEdit(); }} className="p-1.5 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] cursor-pointer"><Pencil size={13} /></button>
            <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg border border-[#e8e6e0] text-red-400 hover:bg-red-50 cursor-pointer"><Trash2 size={13} /></button>
            {expanded ? <ChevronUp size={16} className="text-[#9b9890]" /> : <ChevronDown size={16} className="text-[#9b9890]" />}
          </div>
        </div>
      </div>

      {(property.hasGym || property.hasPool || property.hasParking) && (
        <div className="px-5 pb-3 flex gap-2">
          {property.hasParking && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">🅿️ Parking</span>}
          {property.hasPool && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">🏊 Pool</span>}
          {property.hasGym && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">🏋️ Gym</span>}
        </div>
      )}

      {expanded && (
        <div className="border-t border-[#e8e6e0] px-5 pt-4 pb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase text-[#9b9890] tracking-wide">Units ({units.length})</span>
            {!property.isStandaloneUnit && (
              <button onClick={onAddUnit} className="text-xs text-white px-3 py-1.5 rounded-lg font-medium cursor-pointer flex items-center gap-1" style={{ background: '#2e9f82' }}>
                <Plus size={12} /> Add Unit
              </button>
            )}
          </div>
          {units.length === 0 ? (
            <div className="text-center py-6 text-sm text-[#9b9890]">
              {property.isStandaloneUnit
                ? 'This is a standalone property — the property itself is the unit.'
                : <>No units yet. <button onClick={onAddUnit} className="text-[#2e9f82] underline cursor-pointer">Add the first unit</button></>}
            </div>
          ) : (
            <div className="space-y-2">
              {units.map(u => {
                const contract = contracts.find(c => c.unit?.id === u.id && c.contractActive);
                const tenant = contract?.tenant?.name ?? null;
                const contractEnd = contract?.endDate ? new Date(contract.endDate).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
                return (
                <div key={u.id} className="rounded-xl border border-[#e8e6e0] px-4 py-3 hover:bg-[#f4f3ef]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap">
                      <span className="font-semibold text-[#1a1916] text-sm">#{u.unitNumber}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860] capitalize">{u.unitType.replace(/_/g, ' ')}</span>
                      {u.bedrooms != null && <span className="text-xs text-[#9b9890]">{u.bedrooms} BR</span>}
                      {u.unitSizeSqm && <span className="text-xs text-[#9b9890]">{Number(u.unitSizeSqm).toLocaleString()} sqm</span>}
                      {!u.unitSizeSqm && u.unitSizeSqft && <span className="text-xs text-[#9b9890]">{Number(u.unitSizeSqft).toLocaleString()} sqft</span>}
                      {tenant && (
                        <span className="text-xs text-[#2e9f82] font-medium truncate max-w-[160px]" title={tenant}>👤 {tenant}</span>
                      )}
                      {contractEnd && (
                        <span className="text-xs text-[#9b9890]">until {contractEnd}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {(u.rentalPrice ?? u.marketPrice) && (
                        <span className="text-sm font-bold text-[#2e9f82]">
                          AED {Number(u.rentalPrice ?? u.marketPrice).toLocaleString('en-AE')}<span className="text-[10px] font-normal text-[#9b9890]">/yr</span>
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${u.availability === 'available' ? 'bg-[#d8f2e8] text-[#1a7a5a]' : u.availability === 'occupied' ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
                        {u.availability}
                      </span>
                      {u.isListed && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#2e9f82] text-white">Listed</span>
                      )}
                      <Link href={`/listings/units/${u.id}`} target="_blank" className="p-1 text-[#6b6860] hover:text-[#1a1916]" title="Preview listing"><Eye size={12} /></Link>
                      {contract && (
                        <Link href={`/rental-provider/dashboard/contracts/${contract.id}`} className="p-1 text-[#2e9f82] hover:text-[#1a5a4a]" title="View contract"><FileText size={12} /></Link>
                      )}
                      <button onClick={() => onEditUnit(u)} className="p-1 text-[#6b6860] hover:text-[#1a1916] cursor-pointer" title="Edit unit"><Pencil size={12} /></button>
                      <button onClick={() => onDeleteUnit(u.id)} className="p-1 text-red-400 hover:text-red-600 cursor-pointer" title="Delete unit"><Trash2 size={12} /></button>
                      <button
                        onClick={() => onToggleListing(u)}
                        title={u.isListed ? 'Remove from listings' : 'List this unit'}
                        className={`p-1 cursor-pointer rounded ${u.isListed ? 'text-[#2e9f82]' : 'text-[#c9c7c1] hover:text-[#2e9f82]'}`}
                      >
                        <Radio size={12} />
                      </button>
                      <button onClick={() => onManagePhotos(u)} className="p-1 text-[#2e9f82] hover:text-[#1a5a4a] cursor-pointer" title="Manage photos"><Camera size={12} /></button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[{ label: 'Total', value: String(units.length) }, { label: 'Occupied', value: String(occupied) }, { label: 'Annual Revenue', value: `AED ${totalRent.toLocaleString('en-AE')}` }].map(s => (
              <div key={s.label} className="bg-[#f4f3ef] rounded-xl px-3 py-2 text-center">
                <div className="text-[10px] uppercase text-[#9b9890] font-medium">{s.label}</div>
                <div className="text-sm font-bold text-[#1a1916] mt-0.5">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────
export default function PortfolioPage() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [propertyModal, setPropertyModal] = useState<{ open: boolean; editing?: Property }>({
    open: searchParams.get('action') === 'add',
  });
  const [unitModal, setUnitModal] = useState<{ open: boolean; propertyId?: number; propertyCategory?: string; editingUnit?: Unit }>({ open: false });
  const [photoModal, setPhotoModal] = useState<{ open: boolean; unit?: Unit; propertyId?: number }>({ open: false });

  const { data: properties = [], isLoading, error } = useQuery<Property[]>({
    queryKey: ['properties'],
    queryFn: () => apiGet<Property[]>('/properties'),
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
  const createUnit = useMutation({
    mutationFn: ({ propertyId, dto }: { propertyId: number; dto: object }) => apiPost<Unit>(`/properties/${propertyId}/units`, dto),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['units', vars.propertyId] }),
  });
  const updateUnit = useMutation({
    mutationFn: ({ propertyId, unitId, dto }: { propertyId: number; unitId: number; dto: object }) => apiPatch<Unit>(`/properties/${propertyId}/units/${unitId}`, dto),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['units', vars.propertyId] }),
  });
  const deleteUnit = useMutation({
    mutationFn: ({ propertyId, unitId }: { propertyId: number; unitId: number }) => apiDelete<void>(`/properties/${propertyId}/units/${unitId}`),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['units', vars.propertyId] }),
  });
  const toggleListing = useMutation({
    mutationFn: ({ propertyId, unitId }: { propertyId: number; unitId: number }) =>
      apiPatch<{ isListed: boolean }>(`/properties/${propertyId}/units/${unitId}/toggle-listing`, {}),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['units', vars.propertyId] }),
  });

  const handleSaveProperty = useCallback(async (data: PropertyFormData) => {
    const dto = formToCreateDto(data);
    if (propertyModal.editing) {
      await updateProperty.mutateAsync({ id: propertyModal.editing.id, dto });
    } else {
      await createProperty.mutateAsync(dto);
    }
  }, [propertyModal.editing, createProperty, updateProperty]);

  const handleSaveUnit = useCallback(async (data: UnitFormData) => {
    if (!unitModal.propertyId) return;
    const dto = unitFormToDto(data);
    if (unitModal.editingUnit) {
      await updateUnit.mutateAsync({ propertyId: unitModal.propertyId, unitId: unitModal.editingUnit.id, dto });
    } else {
      await createUnit.mutateAsync({ propertyId: unitModal.propertyId, dto });
    }
  }, [unitModal, createUnit, updateUnit]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Portfolio</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">
            {properties.length} propert{properties.length !== 1 ? 'ies' : 'y'} — click a card to manage units
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-[#e8e6e0] overflow-hidden">
            {(['card', 'table'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setViewMode(v)} className={`px-3 py-2 cursor-pointer transition-colors ${viewMode === v ? 'bg-[#1a1916] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'}`}>
                {v === 'card' ? <LayoutGrid size={16} /> : <List size={16} />}
              </button>
            ))}
          </div>
          <button onClick={() => setPropertyModal({ open: true })} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer" style={{ background: '#2e9f82' }}>
            <Plus size={15} /> Add Property
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">
          <AlertCircle size={16} /> {(error as Error).message}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-[#9b9890]">
          <Loader2 size={20} className="animate-spin" /> Loading properties…
        </div>
      )}

      {!isLoading && properties.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm">
          <EmptyState
            icon={<Building2 />}
            heading="No properties yet"
            subtext="Add your first property — then add as many units as you need without re-entering location details."
            action={{ label: '+ Add First Property', onClick: () => setPropertyModal({ open: true }) }}
          />
        </div>
      )}

      {!isLoading && properties.length > 0 && viewMode === 'card' && (
        <div className="space-y-4">
          {properties.map(p => (
            <PropertyCard
              key={p.id} property={p}
              units={expandedId === p.id ? expandedUnits : []}
              contracts={allContracts}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              onEdit={() => setPropertyModal({ open: true, editing: p })}
              onDelete={() => { if (confirm('Delete this property and all its units?')) deleteProperty.mutate(p.id); }}
              onAddUnit={() => setUnitModal({ open: true, propertyId: p.id, propertyCategory: p.spaceCategory })}
              onEditUnit={u => setUnitModal({ open: true, propertyId: p.id, propertyCategory: p.spaceCategory, editingUnit: u })}
              onDeleteUnit={uid => { if (confirm('Delete this unit?')) deleteUnit.mutate({ propertyId: p.id, unitId: uid }); }}
              onManagePhotos={u => setPhotoModal({ open: true, unit: u, propertyId: p.id })}
              onToggleListing={u => toggleListing.mutate({ propertyId: p.id, unitId: u.id })}
            />
          ))}
        </div>
      )}

      {!isLoading && properties.length > 0 && viewMode === 'table' && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[700px]">
              <thead>
                <tr className="bg-[#f4f3ef]">
                  {['Name', 'Category', 'Location', 'Amenities', 'Floors', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {properties.map(p => (
                  <tr key={p.id} className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916]">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{categoryIcon(p.spaceCategory)}</span>
                        <div>
                          <div className="font-medium">{p.buildingName}</div>
                          {p.makaniNumber && <div className="text-xs text-[#9b9890] font-mono">Makani {p.makaniNumber}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 capitalize">{categoryLabel(p.spaceCategory)}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{p.fullAddress ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex gap-1">
                        {p.hasParking && <span title="Parking">🅿️</span>}
                        {p.hasPool && <span title="Pool">🏊</span>}
                        {p.hasGym && <span title="Gym">🏋️</span>}
                        {!p.hasParking && !p.hasPool && !p.hasGym && <span className="text-[#c9c7c1]">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">{p.numberOfFloors ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setExpandedId(p.id); setViewMode('card'); }} className="text-xs text-[#2e9f82] font-medium cursor-pointer hover:underline">Units</button>
                        <button onClick={() => setPropertyModal({ open: true, editing: p })} className="text-xs text-[#6b6860] cursor-pointer hover:underline">Edit</button>
                        <button onClick={() => { if (confirm('Delete this property?')) deleteProperty.mutate(p.id); }} className="text-xs text-red-400 cursor-pointer hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PropertyFormModal
        open={propertyModal.open}
        title={propertyModal.editing ? 'Edit Property' : 'Add Property'}
        initial={propertyModal.editing ? {
          buildingName: propertyModal.editing.buildingName,
          spaceCategory: propertyModal.editing.spaceCategory,
          makaniNumber: propertyModal.editing.makaniNumber ?? '',
          propertyDescription: propertyModal.editing.propertyDescription ?? '',
          latitude: propertyModal.editing.latitude,
          longitude: propertyModal.editing.longitude,
          hasGym: propertyModal.editing.hasGym,
          hasPool: propertyModal.editing.hasPool,
          hasParking: propertyModal.editing.hasParking,
          numberOfFloors: propertyModal.editing.numberOfFloors ?? '',
        } : undefined}
        onClose={() => setPropertyModal({ open: false })}
        onSave={handleSaveProperty}
      />

      <UnitFormModal
        open={unitModal.open}
        propertyCategory={unitModal.propertyCategory ?? ''}
        title={unitModal.editingUnit ? 'Edit Unit' : 'Add Unit'}
        initial={unitModal.editingUnit ? {
          unitNumber: unitModal.editingUnit.unitNumber,
          unitName: unitModal.editingUnit.unitName ?? '',
          unitType: unitModal.editingUnit.unitType,
          unitTier: unitModal.editingUnit.unitTier,
          floor: unitModal.editingUnit.floor ?? '',
          bedrooms: unitModal.editingUnit.bedrooms != null ? String(unitModal.editingUnit.bedrooms) : '1',
          bathrooms: unitModal.editingUnit.bathrooms != null ? String(unitModal.editingUnit.bathrooms) : '1',
          unitSizeSqft: unitModal.editingUnit.unitSizeSqft != null ? String(unitModal.editingUnit.unitSizeSqft) : '',
          view: unitModal.editingUnit.view ?? '',
          amenities: amenitiesFromUnit(unitModal.editingUnit),
          rentalPrice: unitModal.editingUnit.rentalPrice != null ? String(unitModal.editingUnit.rentalPrice) : '',
          serviceCharges: unitModal.editingUnit.serviceCharges != null ? String(unitModal.editingUnit.serviceCharges) : '',
          description: unitModal.editingUnit.description ?? '',
        } : undefined}
        onClose={() => setUnitModal({ open: false })}
        onSave={handleSaveUnit}
      />

      {/* \u2500\u2500 Unit Photo Manager \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      {photoModal.open && photoModal.unit && photoModal.propertyId && (
        <UnitPhotoManager
          unit={photoModal.unit}
          propertyId={photoModal.propertyId}
          onClose={() => setPhotoModal({ open: false })}
        />
      )}
    </div>
  );
}
