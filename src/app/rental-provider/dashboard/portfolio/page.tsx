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

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, MapPin, Plus, Pencil, Trash2, Search,
  ChevronDown, Loader2, AlertCircle, Camera, X, ImagePlus, Trash, Eye, FileText,
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
  RESIDENTIAL_UNIT_TYPES,
  COMMERCIAL_UNIT_TYPES,
  INDUSTRIAL_UNIT_TYPES,
} from '@/components/upnow/UnitFormModal';
import s from './portfolio.module.css';

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
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  isStandaloneUnit: boolean;
  propertyDescription: string | null;
  numberOfFloors: string | null;
  createdAt: string;
  unitCount?: number;
  listedCount?: number;
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
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  view: string | null;
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
}

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
function amenitiesFromUnit(unit: Unit): string[] {
  if (!unit.facilities) return [];
  try {
    const parsed = JSON.parse(unit.facilities);
    if (Array.isArray(parsed)) return parsed as string[];
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.amenities)) return parsed.amenities as string[];
    return [];
  } catch { return []; }
}

function categoryLabel(cat: string): string {
  return SPACE_CATEGORIES.find((c) => c.id === cat)?.label ?? cat;
}

// ─── API mappers ──────────────────────────────────────────
function formToCreateDto(data: PropertyFormData) {
  const parts = [data.street, data.communityName, data.emirateName].filter(Boolean);
  return {
    buildingName: data.buildingName,
    spaceCategory: data.spaceCategory,
    fullAddress: parts.join(', ') || undefined,
    emirateId: data.emirateId ?? undefined,
    cityId: data.cityId ?? undefined,
    communityId: data.communityId ?? undefined,
    subCommunityId: data.subCommunityId ?? undefined,
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
    premiseNumber: data.premiseNumber || undefined,
    unitSizeSqft: data.unitSizeSqft ? Number(data.unitSizeSqft) : undefined,
    bedrooms: data.bedrooms && data.bedrooms !== 'Studio' ? Number(data.bedrooms) : undefined,
    bathrooms: data.bathrooms ? Number(data.bathrooms) : undefined,
    amenities: data.amenities.length > 0 ? data.amenities : undefined,
    view: data.view || undefined,
    rentalPrice: data.rentalPrice ? Number(data.rentalPrice) : undefined,
    securityDeposit: data.securityDeposit ? Number(data.securityDeposit) : undefined,
    adminFee: data.adminFee ? Number(data.adminFee) : undefined,
    ejariFeeFils: data.ejariFeeFils ? Number(data.ejariFeeFils) : undefined,
    commission: data.commission ? Number(data.commission) : undefined,
    serviceCharges: data.serviceCharges ? Number(data.serviceCharges) : undefined,
    minLeaseMonths: data.minLeaseMonths ? Number(data.minLeaseMonths) : undefined,
    noticePeriodDays: data.noticePeriodDays ? Number(data.noticePeriodDays) : undefined,
    rentEscalationPct: data.rentEscalationPct ? Number(data.rentEscalationPct) : undefined,
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
        }).then(async (r) => {
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
    mutationFn: (mediaId: number) => apiDelete(`/properties/${propertyId}/units/${unit.id}/media/${mediaId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qKey }),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
              {photos.map((p) => (
                <div key={p.id} className="relative group rounded-xl overflow-hidden bg-[#f4f3ef] aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url.startsWith('http') ? p.url : `${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001'}${p.url}`}
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

// ─── Property card (new design) ──────────────────────────
function PropertyCard({
  property, units, contracts, expanded, onToggle, onEdit, onDelete,
  onAddUnit, onEditUnit, onDeleteUnit, onSubmitListing, onWithdrawListing, onManagePhotos,
}: {
  property: Property; units: Unit[]; contracts: ContractSummary[]; expanded: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
  onAddUnit: () => void; onEditUnit: (u: Unit) => void; onDeleteUnit: (uid: number) => void;
  onSubmitListing: (u: Unit) => void; onWithdrawListing: (u: Unit) => void;
  onManagePhotos: (u: Unit) => void;
}) {
  const totalRent = units.reduce((sum, u) => sum + (Number(u.rentalPrice ?? u.marketPrice) || 0), 0);
  const occupied = units.filter((u) => u.availability === 'occupied').length;
  const available = units.filter((u) => u.availability === 'available').length;
  const maintenance = units.filter((u) => u.availability === 'maintenance').length;
  const totalUnits = property.unitCount ?? units.length;
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  return (
    <div className={cn(s.prop, expanded && s.expanded)}>
      {/* Header row */}
      <div className={s.propH} onClick={onToggle} role="button">
        <div className={s.propInfo}>
          <div className={s.propName}>
            {property.buildingName}
            <span className={s.propCat}>{categoryLabel(property.spaceCategory)}</span>
          </div>
          <div className={s.propAddr}>
            <MapPin size={12} />
            <span>{property.fullAddress ?? '—'}</span>
            {property.makaniNumber && <code>Makani {property.makaniNumber}</code>}
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

      {/* Expanded body */}
      {expanded && (
        <div className={s.propBody}>
          <div className={s.unitH}>
            <div className={s.unitHTtl}>Units ({units.length})</div>
            {!property.isStandaloneUnit && (
              <button type="button" className={cn(s.btn, s.btnPrimary, s.btnSm)} onClick={onAddUnit}>
                <Plus size={13} /> Add unit
              </button>
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
                  : 'Add the first unit to start listing this property.'}
              </p>
              {!property.isStandaloneUnit && (
                <button type="button" className={cn(s.btn, s.btnPrimary)} onClick={onAddUnit}>
                  <Plus size={14} /> Add first unit
                </button>
              )}
            </div>
          ) : (
            <div className={s.units}>
              {units.map((u) => {
                const contract = contracts.find((c) => c.unit?.id === u.id && c.contractActive);
                const tenant = contract?.tenant?.name ?? null;
                const contractEnd = contract?.endDate
                  ? new Date(contract.endDate).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' })
                  : null;
                const isConfirmingDelete = confirmDeleteId === u.id;

                // Pick the visible pill — availability dominates over listing status
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
                  <div key={u.id} className={cn(s.unit, isConfirmingDelete && s.unitConfirmDel)}>
                    <div className={s.unitNum}>{u.unitNumber}</div>

                    <div className={s.unitMeta}>
                      <div className={s.unitTop}>
                        <span className={s.unitType}>{u.unitType.replace(/_/g, ' ')}</span>
                        {u.bedrooms != null && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.bedrooms} BR</span></>)}
                        {u.bathrooms != null && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.bathrooms} BA</span></>)}
                        {sizeStr && (<><span className={s.unitDot} /><span className={s.unitSpec}>{sizeStr}</span></>)}
                        {u.view && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.view}</span></>)}
                      </div>
                      {tenant && (
                        <div className={s.unitBottom}>
                          <span className={s.unitTenant}>{tenant}</span>
                          {contractEnd && <span>· until {contractEnd}</span>}
                        </div>
                      )}
                    </div>

                    <div className={s.unitRight}>
                      {(u.rentalPrice ?? u.marketPrice) && (
                        <div className={s.unitPrice}>
                          AED {Number(u.rentalPrice ?? u.marketPrice).toLocaleString('en-AE')}
                          <small>per year</small>
                        </div>
                      )}

                      <span className={cn(s.pill, pillInfo.cls)}>
                        <span className={s.pdot} /> {pillInfo.label}
                      </span>

                      {u.availability === 'available' && (
                        <>
                          {(u.listingStatus === 'draft' || u.listingStatus === 'expired' || u.listingStatus === 'rejected') && (
                            <button type="button" className={s.submitBtn} onClick={() => onSubmitListing(u)}>
                              {u.listingStatus === 'expired' ? 'Relist' : u.listingStatus === 'rejected' ? 'Resubmit' : 'Submit'}
                            </button>
                          )}
                          {(u.listingStatus === 'pending' || u.listingStatus === 'in_review') && (
                            <button type="button" className={s.withdrawBtn} onClick={() => onWithdrawListing(u)}>
                              Withdraw
                            </button>
                          )}
                        </>
                      )}

                      <div className={s.unitActs}>
                        <Link href={`/listings/units/${u.id}`} target="_blank" className={s.actsBtn} title="Preview listing">
                          <Eye size={14} />
                        </Link>
                        {contract && (
                          <Link href={`/rental-provider/dashboard/contracts/${contract.id}`} className={s.actsBtn} title="View contract">
                            <FileText size={14} />
                          </Link>
                        )}
                        <button type="button" className={s.actsBtn} onClick={() => onManagePhotos(u)} title="Manage photos">
                          <Camera size={14} />
                        </button>
                        <button type="button" className={s.actsBtn} onClick={() => onEditUnit(u)} title="Edit unit">
                          <Pencil size={14} />
                        </button>

                        {isConfirmingDelete ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className={s.unitConfirmText}>Delete?</span>
                            <button type="button" className={s.unitConfirmYes} onClick={() => { onDeleteUnit(u.id); setConfirmDeleteId(null); }}>Yes</button>
                            <button type="button" className={s.unitConfirmNo} onClick={() => setConfirmDeleteId(null)}>No</button>
                          </div>
                        ) : (
                          <button type="button" className={cn(s.actsBtn, s.danger)} onClick={() => setConfirmDeleteId(u.id)} title="Delete unit">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
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
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────
export default function PortfolioPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'residential' | 'commercial' | 'industrial'>('all');
  const [search, setSearch] = useState('');
  const [unitTypeFilter, setUnitTypeFilter] = useState('');
  const [selectedViews, setSelectedViews] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [propertyModal, setPropertyModal] = useState<{ open: boolean; editing?: Property }>({ open: false });
  const [unitModal, setUnitModal] = useState<{ open: boolean; propertyId?: number; propertyCategory?: string; editingUnit?: Unit }>({ open: false });
  const [photoModal, setPhotoModal] = useState<{ open: boolean; unit?: Unit; propertyId?: number }>({ open: false });

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
  const submitListing = useMutation({
    mutationFn: ({ propertyId, unitId }: { propertyId: number; unitId: number }) =>
      apiPatch<Unit>(`/properties/${propertyId}/units/${unitId}/submit-listing`, {}),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['units', vars.propertyId] }),
  });
  const withdrawListing = useMutation({
    mutationFn: ({ propertyId, unitId }: { propertyId: number; unitId: number }) =>
      apiPatch<Unit>(`/properties/${propertyId}/units/${unitId}/withdraw-listing`, {}),
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

  // ── Aggregated KPIs (from the loaded properties list) ──
  const totalProperties = properties.length;
  const totalUnits     = properties.reduce((sum, p) => sum + (p.unitCount ?? 0), 0);
  const totalListed    = properties.reduce((sum, p) => sum + (p.listedCount ?? 0), 0);
  const activeLeases   = allContracts.filter((c) => c.contractActive).length;
  const occupancyPct   = totalUnits > 0 ? Math.round((activeLeases / totalUnits) * 100) : 0;

  const filtersDirty = !!search || !!unitTypeFilter || selectedViews.length > 0;

  return (
    <div className={s.app}>
      <div className={s.main}>

        {/* Hero */}
        <div className={s.hero}>
          <div className={s.heroLeft}>
            <div className={s.heroEyebrow}><Building2 size={12} /> Portfolio</div>
            <h1 className={s.heroTitle}>Your properties</h1>
            <p className={s.heroDesc}>
              {totalProperties === 0
                ? "You haven't added a property yet — once you do, manage all buildings, units, and listings from this dashboard."
                : `Manage your ${totalProperties} propert${totalProperties === 1 ? 'y' : 'ies'}, ${totalUnits} unit${totalUnits === 1 ? '' : 's'}, and listings in one place.`}
            </p>
          </div>
          <div className={s.heroRight}>
            <button type="button" className={cn(s.btn, s.btnPrimary)} onClick={() => router.push('/rental-provider/dashboard/portfolio/add')}>
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
              <div className={s.kpiSub}>{occupancyPct}% occupancy</div>
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
                  onClick={() => setCategoryFilter(key)}
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
                <option value="">All unit types</option>
                <optgroup label="Residential">
                  {RESIDENTIAL_UNIT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </optgroup>
                <optgroup label="Commercial">
                  {COMMERCIAL_UNIT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </optgroup>
                <optgroup label="Industrial">
                  {INDUSTRIAL_UNIT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </optgroup>
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
            <button type="button" className={cn(s.btn, s.btnPrimary)} onClick={() => router.push('/rental-provider/dashboard/portfolio/add')}>
              <Plus size={14} /> Add first property
            </button>
          </div>
        )}

        {!isLoading && filteredProperties.length > 0 && (
          <div className={s.props}>
            {filteredProperties.map((p) => {
              const visibleUnits = expandedId === p.id
                ? expandedUnits.filter((u) => {
                    if (unitTypeFilter && u.unitType !== unitTypeFilter) return false;
                    if (selectedViews.length > 0 && !selectedViews.some((v) => (u.view ?? '').toLowerCase().includes(v.toLowerCase()))) return false;
                    return true;
                  })
                : [];
              return (
                <PropertyCard
                  key={p.id}
                  property={p}
                  units={visibleUnits}
                  contracts={allContracts}
                  expanded={expandedId === p.id}
                  onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  onEdit={() => setPropertyModal({ open: true, editing: p })}
                  onDelete={() => deleteProperty.mutate(p.id)}
                  onAddUnit={() => setUnitModal({ open: true, propertyId: p.id, propertyCategory: p.spaceCategory })}
                  onEditUnit={(u) => setUnitModal({ open: true, propertyId: p.id, propertyCategory: p.spaceCategory, editingUnit: u })}
                  onDeleteUnit={(uid) => deleteUnit.mutate({ propertyId: p.id, unitId: uid })}
                  onSubmitListing={(u) => submitListing.mutate({ propertyId: p.id, unitId: u.id })}
                  onWithdrawListing={(u) => withdrawListing.mutate({ propertyId: p.id, unitId: u.id })}
                  onManagePhotos={(u) => setPhotoModal({ open: true, unit: u, propertyId: p.id })}
                />
              );
            })}
          </div>
        )}

        {/* ── Modals (unchanged) ── */}
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
            propertyDescription: propertyModal.editing.propertyDescription ?? '',
            latitude:            propertyModal.editing.latitude,
            longitude:           propertyModal.editing.longitude,
            hasGym:              propertyModal.editing.hasGym,
            hasPool:             propertyModal.editing.hasPool,
            hasParking:          propertyModal.editing.hasParking,
            isStandaloneUnit:    propertyModal.editing.isStandaloneUnit,
            numberOfFloors:      propertyModal.editing.numberOfFloors ?? '',
          } : undefined}
          onClose={() => setPropertyModal({ open: false })}
          onSave={handleSaveProperty}
        />

        <UnitFormModal
          open={unitModal.open}
          propertyCategory={unitModal.propertyCategory ?? ''}
          title={unitModal.editingUnit ? 'Edit Unit' : 'Add Unit'}
          initial={unitModal.editingUnit ? {
            unitNumber:       unitModal.editingUnit.unitNumber,
            unitName:         unitModal.editingUnit.unitName ?? '',
            unitType:         unitModal.editingUnit.unitType,
            unitTier:         unitModal.editingUnit.unitTier,
            floor:            unitModal.editingUnit.floor ?? '',
            premiseNumber:    unitModal.editingUnit.premiseNumber ?? '',
            bedrooms:         unitModal.editingUnit.bedrooms != null ? String(unitModal.editingUnit.bedrooms) : '1',
            bathrooms:        unitModal.editingUnit.bathrooms != null ? String(unitModal.editingUnit.bathrooms) : '1',
            unitSizeSqft:     unitModal.editingUnit.unitSizeSqft != null ? String(unitModal.editingUnit.unitSizeSqft) : '',
            view:             unitModal.editingUnit.view ?? '',
            amenities:        amenitiesFromUnit(unitModal.editingUnit),
            rentalPrice:      unitModal.editingUnit.rentalPrice != null ? String(unitModal.editingUnit.rentalPrice) : '',
            securityDeposit:  unitModal.editingUnit.securityDeposit != null ? String(unitModal.editingUnit.securityDeposit) : '',
            adminFee:         unitModal.editingUnit.adminFee != null ? String(unitModal.editingUnit.adminFee) : '',
            ejariFeeFils:     unitModal.editingUnit.ejariFeeFils != null ? String(unitModal.editingUnit.ejariFeeFils) : '',
            commission:       unitModal.editingUnit.commission != null ? String(unitModal.editingUnit.commission) : '',
            serviceCharges:   unitModal.editingUnit.serviceCharges != null ? String(unitModal.editingUnit.serviceCharges) : '',
            minLeaseMonths:   '',
            noticePeriodDays: '',
            rentEscalationPct: '',
            description:      unitModal.editingUnit.description ?? '',
          } : undefined}
          onClose={() => setUnitModal({ open: false })}
          onSave={handleSaveUnit}
        />

        {photoModal.open && photoModal.unit && photoModal.propertyId && (
          <UnitPhotoManager
            unit={photoModal.unit}
            propertyId={photoModal.propertyId}
            onClose={() => setPhotoModal({ open: false })}
          />
        )}
      </div>
    </div>
  );
}
