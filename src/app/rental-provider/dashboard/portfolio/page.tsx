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
  ChevronDown, Loader2, AlertCircle, X, Eye,
  LayoutGrid, Map as MapIcon,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { PropertyDetailsModal } from './PropertyDetailsModal';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { UnitPreviewModal } from './UnitPreviewModal';
import { PortfolioMapModal } from './PortfolioMapModal';

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
function amenitiesFromUnit(unit: Unit): string[] {
  if (!unit.facilities) return [];
  try {
    const parsed = JSON.parse(unit.facilities);
    if (Array.isArray(parsed)) return parsed as string[];
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.amenities)) return parsed.amenities as string[];
    return [];
  } catch { return []; }
}

function leaseTermsFromUnit(unit: Unit): {
  minLeaseMonths: string; noticePeriodDays: string; rentEscalationPct: string;
} {
  const empty = { minLeaseMonths: '', noticePeriodDays: '', rentEscalationPct: '' };
  if (!unit.facilities) return empty;
  try {
    const parsed = JSON.parse(unit.facilities);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return empty;
    const lt = (parsed as { leaseTerms?: Record<string, number> }).leaseTerms ?? {};
    return {
      minLeaseMonths:    lt.minLeaseMonths    != null ? String(lt.minLeaseMonths)    : '',
      noticePeriodDays:  lt.noticePeriodDays  != null ? String(lt.noticePeriodDays)  : '',
      rentEscalationPct: lt.rentEscalationPct != null ? String(lt.rentEscalationPct) : '',
    };
  } catch { return empty; }
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
    hasGym: data.hasGym,
    hasPool: data.hasPool,
    hasParking: data.hasParking,
    isStandaloneUnit: data.isStandaloneUnit,
    propertyDescription: data.propertyDescription || undefined,
  };
}

function unitFormToDto(data: UnitFormData) {
  // Empty string means "cleared" — PATCH an explicit null so the backend
  // actually clears the column (undefined would silently keep the old value).
  const clearable = (v: string) => (v ? v : null);
  const num = (v: string) => {
    if (!v) return null;
    const n = Number(v.replace('+', '')); // '6+' bedrooms / '5+' bathrooms
    return Number.isNaN(n) ? null : n;
  };
  return {
    unitNumber: data.unitNumber,
    unitName: clearable(data.unitName),
    unitType: data.unitType,
    unitTier: data.unitTier || 'standard',
    floor: clearable(data.floor),
    premiseNumber: clearable(data.premiseNumber),
    unitSizeSqft: num(data.unitSizeSqft) ?? undefined,
    bedrooms: data.bedrooms === 'Studio' ? null : num(data.bedrooms) ?? undefined,
    bathrooms: num(data.bathrooms) ?? undefined,
    amenities: data.amenities, // empty array clears amenities (kept lease terms are merged server-side)
    view: clearable(data.view),
    furnishing: clearable(data.furnishing),
    rentalPrice: data.rentalPrice ? Number(data.rentalPrice) : undefined,
    marketPrice: num(data.marketPrice),
    securityDeposit: data.securityDeposit ? Number(data.securityDeposit) : undefined,
    adminFee: data.adminFee ? Number(data.adminFee) : undefined,
    ejariFeeFils: data.ejariFeeFils ? Number(data.ejariFeeFils) : undefined,
    commission: data.commission ? Number(data.commission) : undefined,
    serviceCharges: num(data.serviceCharges),
    minLeaseMonths: data.minLeaseMonths ? Number(data.minLeaseMonths) : undefined,
    noticePeriodDays: data.noticePeriodDays ? Number(data.noticePeriodDays) : undefined,
    rentEscalationPct: data.rentEscalationPct ? Number(data.rentEscalationPct) : undefined,
    description: clearable(data.description),
  };
}

// ─── Property card (new design) ──────────────────────────
function PropertyCard({
  property, units, contracts, expanded, onToggle, onEdit, onDelete,
  onAddUnit, onEditUnit, onDeleteUnit, onSubmitListing, onWithdrawListing,
  onShowDetails, onPreviewUnit,
}: {
  property: Property; units: Unit[]; contracts: ContractSummary[]; expanded: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
  onAddUnit: () => void; onEditUnit: (u: Unit) => void; onDeleteUnit: (uid: number) => void;
  onSubmitListing: (u: Unit) => void; onWithdrawListing: (u: Unit) => void;
  onShowDetails: () => void; onPreviewUnit: (u: Unit, contract: ContractSummary | null) => void;
}) {
  // Units load lazily on expand. Until then, fall back to the property-level
  // aggregates returned by GET /properties so the collapsed card shows real
  // numbers (count, occupancy, rent) by default — not 0.
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [planFilter, setPlanFilter] = useState<string>('all');

  // Distinct plans in this property (for the plan-wise filter), ordered by plan number.
  const planOptions = [...new Map(
    units.filter(u => u.planLabel)
      .map(u => [u.planLabel as string, u] as const)
  ).keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const visibleUnits = planFilter === 'all' ? units : units.filter(u => u.planLabel === planFilter);

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

      {/* Expanded body */}
      {expanded && (
        <div className={s.propBody}>
          <div className={s.unitH}>
            <div className={s.unitHTtl}>
              Units ({planFilter === 'all' ? units.length : `${visibleUnits.length} of ${units.length}`})
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {planOptions.length > 0 && (
                <div style={{ position: 'relative' }}>
                  <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
                    style={{ appearance: 'none', border: '1px solid #d8d6d0', borderRadius: 8, padding: '6px 28px 6px 10px', fontSize: 12.5, color: '#1a1916', background: '#fff', cursor: 'pointer' }}
                    title="Filter units by floor plan">
                    <option value="all">All plans</option>
                    {planOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <ChevronDown size={14} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#9b9890', pointerEvents: 'none' }} />
                </div>
              )}
              {!property.isStandaloneUnit && (
                <button type="button" className={cn(s.btn, s.btnPrimary, s.btnSm)} onClick={onAddUnit}>
                  <Plus size={13} /> Add unit
                </button>
              )}
            </div>
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
          ) : visibleUnits.length === 0 ? (
            <div className={s.empty}>
              <div className={s.emptyIc}><LayoutGrid size={20} /></div>
              <h3 className={s.emptyTtl}>No units in {planFilter}</h3>
              <p className={s.emptyDesc}>No units match this plan filter.</p>
              <button type="button" className={cn(s.btn)} onClick={() => setPlanFilter('all')}>Show all plans</button>
            </div>
          ) : (
            <div className={s.units}>
              {visibleUnits.map((u) => {
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
                    <button
                      type="button"
                      className={s.unitNum}
                      title="Preview unit details"
                      onClick={() => onPreviewUnit(u, contract ?? null)}
                      style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit', textAlign: 'inherit' }}>
                      {u.unitNumber}
                    </button>

                    <div className={s.unitMeta}>
                      <div className={s.unitTop}>
                        <span className={s.unitType}>{u.unitType.replace(/_/g, ' ')}</span>
                        {u.bedrooms != null && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.bedrooms} BR</span></>)}
                        {u.bathrooms != null && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.bathrooms} BA</span></>)}
                        {sizeStr && (<><span className={s.unitDot} /><span className={s.unitSpec}>{sizeStr}</span></>)}
                        {u.view && (<><span className={s.unitDot} /><span className={s.unitSpec}>{u.view}</span></>)}
                        {u.planLabel && (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#2e9f82', background: '#f0faf6', borderRadius: 6, padding: '1px 7px' }}>{u.planLabel}</span>
                        )}
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

                      {/* CEO doctrine: three actions only — Preview (admin
                          popup, NOT the public page) · Edit · Delete. Floor
                          plan, photos and the contract live INSIDE preview/edit. */}
                      <div className={s.unitActs}>
                        <button type="button" className={s.actsBtn} onClick={() => onPreviewUnit(u, contract ?? null)} title="Preview unit">
                          <Eye size={14} />
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
  // Read-only preview popups + portfolio map
  const [detailsProperty, setDetailsProperty] = useState<Property | null>(null);
  const [unitPreview, setUnitPreview] = useState<{ property: Property; unit: Unit; contract: ContractSummary | null } | null>(null);
  const [showMap, setShowMap] = useState(false);

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
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to submit listing'),
  });
  const withdrawListing = useMutation({
    mutationFn: ({ propertyId, unitId }: { propertyId: number; unitId: number }) =>
      apiPatch<Unit>(`/properties/${propertyId}/units/${unitId}/withdraw-listing`, {}),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['units', vars.propertyId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to withdraw listing'),
  });

  const handleSaveProperty = useCallback(async (data: PropertyFormData, titleDeed?: File | null) => {
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
  }, [propertyModal.editing, createProperty, updateProperty]);

  const handleSaveUnit = useCallback(async (data: UnitFormData, floorPlan?: File | null, titleDeed?: File | null) => {
    if (!unitModal.propertyId) return;
    const dto = unitFormToDto(data);
    const saved = unitModal.editingUnit
      ? await updateUnit.mutateAsync({ propertyId: unitModal.propertyId, unitId: unitModal.editingUnit.id, dto })
      : await createUnit.mutateAsync({ propertyId: unitModal.propertyId, dto });
    if (floorPlan && saved?.id) {
      try {
        const fd = new FormData();
        fd.append('file', floorPlan);
        const res = await fetch(`/api/properties/${unitModal.propertyId}/units/${saved.id}/floor-plan`, {
          method: 'POST', credentials: 'include', body: fd,
        });
        if (!res.ok) throw new Error();
      } catch {
        // non-fatal: the unit saved; only the floor-plan upload failed
      }
      qc.invalidateQueries({ queryKey: ['units', unitModal.propertyId] });
    }
    // Per-unit title deed (multi-unit buildings only).
    if (titleDeed && saved?.id) {
      try {
        await uploadOwnedDocument({
          ownerType: 'unit', ownerId: saved.id,
          documentKey: 'title_deed', category: 'legal',
          displayName: `Title deed — Unit ${data.unitNumber || saved.id}`, file: titleDeed,
        });
      } catch (e) {
        alert(`The unit was saved, but the title deed upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
  }, [unitModal, createUnit, updateUnit, qc]);

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
            <button type="button" className={cn(s.btn, s.btnAccent)} onClick={() => setShowMap(true)} title="See all properties on a map">
              <MapIcon size={14} /> Map
            </button>
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
                  onShowDetails={() => setDetailsProperty(p)}
                  onPreviewUnit={(u, c) => setUnitPreview({ property: p, unit: u, contract: c })}
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
            street:              propertyModal.editing.street ?? '',
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
            bedrooms:         unitModal.editingUnit.bedrooms != null ? String(unitModal.editingUnit.bedrooms) : 'Studio',
            bathrooms:        unitModal.editingUnit.bathrooms != null ? String(unitModal.editingUnit.bathrooms) : '1',
            unitSizeSqft:     unitModal.editingUnit.unitSizeSqft != null ? String(unitModal.editingUnit.unitSizeSqft) : '',
            view:             unitModal.editingUnit.view ?? '',
            furnishing:       unitModal.editingUnit.furnishing ?? 'Unfurnished',
            amenities:        amenitiesFromUnit(unitModal.editingUnit),
            rentalPrice:      unitModal.editingUnit.rentalPrice != null ? String(unitModal.editingUnit.rentalPrice) : '',
            marketPrice:      unitModal.editingUnit.marketPrice != null ? String(unitModal.editingUnit.marketPrice) : '',
            securityDeposit:  unitModal.editingUnit.securityDeposit != null ? String(unitModal.editingUnit.securityDeposit) : '',
            adminFee:         unitModal.editingUnit.adminFee != null ? String(unitModal.editingUnit.adminFee) : '',
            ejariFeeFils:     unitModal.editingUnit.ejariFeeFils != null ? String(unitModal.editingUnit.ejariFeeFils) : '',
            commission:       unitModal.editingUnit.commission != null ? String(unitModal.editingUnit.commission) : '',
            serviceCharges:   unitModal.editingUnit.serviceCharges != null ? String(unitModal.editingUnit.serviceCharges) : '',
            ...leaseTermsFromUnit(unitModal.editingUnit),
            description:      unitModal.editingUnit.description ?? '',
          } : undefined}
          existingFloorPlanUrl={unitModal.editingUnit?.floorPlanUrl ?? null}
          propertyStandalone={properties.find(p => p.id === unitModal.propertyId)?.isStandaloneUnit ?? undefined}
          propertyId={unitModal.propertyId}
          editingUnitId={unitModal.editingUnit?.id}
          onClose={() => setUnitModal({ open: false })}
          onSave={handleSaveUnit}
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
        {unitPreview && (
          <UnitPreviewModal
            propertyId={unitPreview.property.id}
            propertyName={unitPreview.property.buildingName}
            unit={unitPreview.unit}
            contract={unitPreview.contract ? {
              id: unitPreview.contract.id,
              tenantName: unitPreview.contract.tenant?.name ?? null,
              endDate: unitPreview.contract.endDate,
              status: unitPreview.contract.status,
            } : null}
            onClose={() => setUnitPreview(null)}
          />
        )}
        {showMap && (
          <PortfolioMapModal
            properties={properties}
            onClose={() => setShowMap(false)}
          />
        )}
      </div>
    </div>
  );
}
