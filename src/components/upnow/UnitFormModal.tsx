'use client';

import { useState, useEffect, useRef } from 'react';
import { X, ArrowLeft, Loader2, Upload, Download, Sparkles, Layers, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSlideOver } from '@/lib/useSlideOver';
import { validateAddendumFile, ADDENDUM_ACCEPT, ADDENDUM_SAMPLE_URL } from '@/lib/validateAddendum';
import { openDocViewer } from '@/lib/docViewer';
import { type AddendumTerms } from '@/lib/addendumTerms';
import AddendumLayoutSection from './AddendumLayoutSection';
import { RESIDENTIAL_UNIT_TYPES, isLandUnitType, isResidentialUnitType, effectiveSpaceCategory } from '@/lib/unitTaxonomy';
import { feeFromRules, type FeeRuleLite } from '@/lib/feeRules';
import ds from './unitForm.module.css';

// ─── Unit type arrays (match backend UnitType enum) ───────
// RESIDENTIAL_UNIT_TYPES lives in @/lib/unitTaxonomy (single source of truth,
// also consumed by the public listing pages) and is re-exported here so the
// many existing `import { RESIDENTIAL_UNIT_TYPES } from '.../UnitFormModal'`
// call-sites keep working.
export { RESIDENTIAL_UNIT_TYPES };
export const COMMERCIAL_UNIT_TYPES  = ['office_fitted', 'office_shell_core', 'retail_shop', 'showroom', 'restaurant_fnb', 'clinic_medical', 'labour_accommodation', 'staff_accommodation'];
export const INDUSTRIAL_UNIT_TYPES  = ['warehouse', 'open_yard', 'storage_unit', 'cold_storage', 'logistics_facility'];
export const WORKSPACES_UNIT_TYPES  = ['coworking_desk', 'private_office', 'meeting_room', 'day_office'];
export const VENUES_UNIT_TYPES      = ['event_hall', 'wedding_venue', 'conference_hall', 'private_dining', 'outdoor_venue'];
export const LAND_UNIT_TYPES        = ['residential_land', 'commercial_land', 'industrial_land', 'mixed_use_land', 'agricultural_land', 'labour_accommodation_land'];

// All non-residential types combined (useful for downstream checks)
export const ALL_COMMERCIAL_TYPES = [
  ...COMMERCIAL_UNIT_TYPES,
  ...INDUSTRIAL_UNIT_TYPES,
  ...WORKSPACES_UNIT_TYPES,
  ...VENUES_UNIT_TYPES,
];

export const UNIT_TYPE_LABELS: Record<string, string> = {
  // Residential
  apartment: 'Apartment', villa: 'Villa', villa_compound: 'Villa Compound', townhouse: 'Townhouse',
  penthouse: 'Penthouse', studio: 'Studio', duplex_loft: 'Duplex / Loft',
  room: 'Room', bed_space: 'Bed Space', holiday_home: 'Holiday Home',
  // Commercial
  office_fitted: 'Office (Fitted)', office_shell_core: 'Office (Shell & Core)',
  retail_shop: 'Retail Shop', showroom: 'Showroom',
  restaurant_fnb: 'Restaurant / F&B', clinic_medical: 'Clinic / Medical',
  // Industrial
  warehouse: 'Warehouse', open_yard: 'Open Yard', storage_unit: 'Storage Unit',
  cold_storage: 'Cold Storage', logistics_facility: 'Logistics Facility',
  // Workspaces
  coworking_desk: 'Coworking Desk', private_office: 'Private Office',
  meeting_room: 'Meeting Room', day_office: 'Day Office',
  // Venues
  event_hall: 'Event Hall', wedding_venue: 'Wedding Venue',
  conference_hall: 'Conference Hall', private_dining: 'Private Dining Room',
  outdoor_venue: 'Outdoor Venue',
  // Land
  residential_land: 'Residential Land', commercial_land: 'Commercial Land',
  industrial_land: 'Industrial Land', mixed_use_land: 'Mixed-Use Land',
  agricultural_land: 'Agricultural Land', labour_accommodation_land: 'Labour Accommodation Land',
  // Accommodation (offered under residential + commercial)
  labour_accommodation: 'Labour Accommodation', staff_accommodation: 'Staff Accommodation',
};

export function unitTypesForCategory(category: string): string[] {
  switch (category) {
    case 'residential':  return RESIDENTIAL_UNIT_TYPES;
    case 'commercial':   return COMMERCIAL_UNIT_TYPES;
    case 'industrial':   return INDUSTRIAL_UNIT_TYPES;
    case 'workspaces':   return WORKSPACES_UNIT_TYPES;
    case 'venues':       return VENUES_UNIT_TYPES;
    case 'land':         return LAND_UNIT_TYPES;
    // Dedupe — the accommodation types live under BOTH residential and commercial.
    case 'mixed_use':    return Array.from(new Set([...RESIDENTIAL_UNIT_TYPES, ...COMMERCIAL_UNIT_TYPES]));
    default:             return Array.from(new Set([...RESIDENTIAL_UNIT_TYPES, ...COMMERCIAL_UNIT_TYPES]));
  }
}

// Categories without their own amenities / default-lease maps fall back to one of
// the base buckets (unit TYPES are handled explicitly above).
function resolveBaseCategory(category: string): string {
  switch (category) {
    case 'mixed_use':   return 'residential';
    case 'land':        return 'commercial';
    default:            return category;
  }
}

// ─── Category-specific amenities ─────────────────────────
const AMENITIES_MAP: Record<string, string[]> = {
  residential: [
    'Central A/C', 'Parking', 'Swimming Pool', 'Gym', 'Security', 'CCTV',
    'Balcony', 'Terrace', 'Elevator', 'Concierge', 'Playground', "Maid's Room", 'Storage',
    'Built-in Wardrobes', 'Shared Pool', 'Covered Parking', 'Pet Friendly',
    'High-Speed Internet', 'Smart Home', '24/7 Security', 'Kids Play Area',
  ],
  commercial: [
    'High-Speed Internet', 'Dedicated Parking', 'Central A/C', 'Backup Generator',
    'Reception Services', 'CCTV', '24/7 Security', 'Elevator', 'Meeting Rooms',
    'Pantry / Kitchen', 'Server Room', 'Prayer Room', 'Common Areas',
    'Retail Frontage', 'Fire Suppression', 'Cable Management', 'Loading Bay',
    'Disabled Access', 'Male & Female Washrooms', 'Covered Parking',
  ],
  industrial: [
    'Loading Dock', 'Forklift Access', 'High-Bay Lighting', 'Three-Phase Power',
    'Floor Drains', 'CCTV', '24/7 Security', 'Ample Truck Parking', 'Backup Power',
    'Fire Suppression', 'Mezzanine Floor', 'Weighbridge', 'Yard Space', 'Office Annex',
    'Temperature Control', 'Sprinkler System', 'Rail Access', 'Hazmat Storage',
    'Water Supply', 'Sewage / Drainage',
  ],
  workspaces: [
    'High-Speed Internet', 'Meeting Rooms', 'Printing & Scanning', 'Coffee & Tea Station',
    'Phone Booths', 'Lounge Area', 'Receptionist', 'Mail Handling', '24/7 Access',
    'Parking', 'Elevator', 'CCTV', 'Air Conditioning', 'Shower Facilities',
    'Bike Storage', 'Outdoor Terrace', 'Event Space', 'Storage Lockers',
    'Dedicated Desk', 'Breakout Rooms',
  ],
  venues: [
    'Stage / Platform', 'Professional AV Equipment', 'Catering Kitchen',
    'Bridal Suite / Green Room', 'Valet Parking', 'CCTV', 'Air Conditioning',
    'Male & Female Restrooms', 'Wheelchair Access', 'Wi-Fi', 'LED Lighting Rig',
    'Professional Sound System', 'Dance Floor', 'Outdoor Space', 'Bar Area',
    'Prayer Room', 'Natural Lighting', 'Dedicated Storage', 'In-house Catering', 'Photo / Film Friendly',
  ],
};

// Combined list for backward compatibility with add page
export const AMENITIES = [
  ...new Set([
    ...AMENITIES_MAP.residential,
    ...AMENITIES_MAP.commercial,
    ...AMENITIES_MAP.industrial,
    ...AMENITIES_MAP.workspaces,
    ...AMENITIES_MAP.venues,
  ]),
];

export function getAmenitiesForCategory(category: string): string[] {
  return AMENITIES_MAP[resolveBaseCategory(category)] ?? AMENITIES_MAP.residential;
}

const VIEW_OPTIONS = [
  'Sea View', 'Partial Sea View', 'Full Sea View', 'Beach View', 'Marina View',
  'Canal View', 'Lake View', 'Lagoon View', 'Pool View', 'Garden View',
  'Park View', 'Community View', 'Courtyard View', 'City View', 'Skyline View',
  'Downtown View', 'Landmark View', 'Burj View', 'Golf Course View', 'Mountain View',
  'Desert View', 'Road View', 'Street View', 'Highway View', 'Creek View',
  'Harbour View', 'Waterfront View', 'Palm View', 'Panoramic View', 'Open View',
  'Burj Khalifa View', 'Palm Jumeirah View', 'Dubai Marina View', 'Fountain View',
];

export const FURNISHING_OPTIONS = ['Unfurnished', 'Semi-Furnished', 'Fully Furnished'];
export const RENTAL_TYPE_OPTIONS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'custom', label: 'Custom' },
];
export const UNIT_TIERS = [
  { id: 'standard', label: 'Standard' },
  { id: 'premium',  label: 'Premium' },
  { id: 'elite',    label: 'Elite' },
];

/** Unit area conversion — capture one, compute the other. 1 sqm = 10.7639 sqft. */
export const SQFT_PER_SQM = 10.7639;
export const sqftFromSqm = (sqm: string): string => {
  const n = parseFloat(sqm);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * SQFT_PER_SQM)) : '';
};
export const sqmFromSqft = (sqft: string): string => {
  const n = parseFloat(sqft);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n / SQFT_PER_SQM)) : '';
};

// Default minimum lease months by category
const DEFAULT_MIN_LEASE: Record<string, string> = {
  residential: '12',
  commercial:  '12',
  industrial:  '24',
  workspaces:  '1',
  venues:      '0',
};

// Default notice period by category (days)
const DEFAULT_NOTICE: Record<string, string> = {
  residential: '60',
  commercial:  '90',
  industrial:  '90',
  workspaces:  '30',
  venues:      '14',
};

export interface UnitFormData {
  unitNumber: string;
  unitName: string;
  unitType: string;
  unitTier: string;
  floor: string;
  premiseNumber: string;
  bedrooms: string;
  bathrooms: string;
  parkingSpaces: string;
  unitSizeSqft: string;
  unitSizeSqm: string;
  view: string;
  furnishing: string;
  amenities: string[];
  rentalPrice: string;
  securityDeposit: string;
  adminFee: string;
  ejariFeeFils: string;
  commission: string;
  serviceCharges: string;
  minLeaseMonths: string;
  noticePeriodDays: string;
  rentEscalationPct: string;
  // Leasing configuration
  rentalType: string;
  numberOfPayments: string;
  advancePayment: string;
  gracePeriodDays: string;
  latePaymentFee: string;
  specialConditions: string;
  /** RP-defined extra one-off charges (label + net AED + optional VAT AED). On
   *  booking each is shown to the customer + added to the contract as an `other`
   *  payment row. */
  additionalPayments: Array<{ label: string; amount: string; vat: string }>;
  description: string;
}

function composeUnitDescription(d: UnitFormData, propertyCategory: string): string {
  const typeLabel = d.unitType ? d.unitType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null;
  const isResidential = RESIDENTIAL_UNIT_TYPES.includes(d.unitType);
  const isCommercial  = COMMERCIAL_UNIT_TYPES.includes(d.unitType);
  const isIndustrial  = INDUSTRIAL_UNIT_TYPES.includes(d.unitType);
  const isWorkspace   = WORKSPACES_UNIT_TYPES.includes(d.unitType);
  const isVenue       = VENUES_UNIT_TYPES.includes(d.unitType);

  const tierLabel = UNIT_TIERS.find(t => t.id === d.unitTier)?.label;
  const tierPrefix = tierLabel && tierLabel !== 'Standard' ? `${tierLabel}-tier ` : '';

  let headline: string;
  if (isResidential) {
    const beds = d.bedrooms === 'Studio' ? 'studio' : d.bedrooms ? `${d.bedrooms}-bedroom` : '';
    headline = [tierPrefix, beds, typeLabel ? typeLabel.toLowerCase() : 'home'].filter(Boolean).join(' ').trim();
  } else if (isCommercial) {
    headline = `${tierPrefix}${typeLabel?.toLowerCase() ?? 'commercial unit'}`;
  } else if (isIndustrial) {
    headline = `${tierPrefix}${typeLabel?.toLowerCase() ?? 'industrial unit'}`;
  } else if (isWorkspace) {
    headline = `${tierPrefix}${typeLabel?.toLowerCase() ?? 'workspace'}`;
  } else if (isVenue) {
    headline = `${tierPrefix}${typeLabel?.toLowerCase() ?? 'venue'}`;
  } else {
    headline = `${tierPrefix}${typeLabel?.toLowerCase() ?? propertyCategory.toLowerCase() + ' unit'}`;
  }
  headline = headline.charAt(0).toUpperCase() + headline.slice(1);

  const sentenceBits: string[] = [];
  if (d.floor) sentenceBits.push(`located on the ${ordinal(d.floor)} floor`);
  if (d.unitSizeSqft) sentenceBits.push(`spanning ${Number(d.unitSizeSqft).toLocaleString('en-AE')} sqft`);
  if (isResidential && d.bathrooms) {
    const bathLabel = Number(d.bathrooms) === 1 ? '1 bathroom' : `${d.bathrooms} bathrooms`;
    sentenceBits.push(`with ${bathLabel}`);
  }
  const sentence1 = `${headline}${sentenceBits.length ? ', ' + sentenceBits.join(', ') : ''}.`;

  const sentence2Bits: string[] = [];
  if (d.view) sentence2Bits.push(`Enjoys a ${d.view.toLowerCase()}`);
  if (isResidential && d.furnishing && d.furnishing !== 'Unfurnished') {
    const furnLabel = d.furnishing.toLowerCase();
    sentence2Bits.push(sentence2Bits.length ? `comes ${furnLabel}` : `Comes ${furnLabel}`);
  }
  const sentence2 = sentence2Bits.length ? sentence2Bits.join(' and ') + '.' : '';

  const topAmenities = d.amenities.slice(0, 6);
  const sentence3 = topAmenities.length
    ? `Amenities include ${topAmenities.join(', ').toLowerCase()}.`
    : '';

  // Lease terms sentence for non-residential
  let sentence4 = '';
  if (!isResidential && d.minLeaseMonths && Number(d.minLeaseMonths) > 0) {
    const months = Number(d.minLeaseMonths);
    const period = months >= 12 ? `${months / 12} year${months > 12 ? 's' : ''}` : `${months} month${months > 1 ? 's' : ''}`;
    sentence4 = `Minimum lease period: ${period}.`;
  }

  return [sentence1, sentence2, sentence3, sentence4].filter(Boolean).join(' ').trim();
}

function ordinal(n: string): string {
  const v = Number(n);
  if (Number.isNaN(v)) return n;
  if (v % 100 >= 11 && v % 100 <= 13) return `${v}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][v % 10] ?? 'th';
  return `${v}${v % 10 <= 3 ? suffix : 'th'}`;
}

const EMPTY_UNIT: UnitFormData = {
  unitNumber: '', unitName: '', unitType: '', unitTier: 'standard',
  floor: '', premiseNumber: '', bedrooms: '1', bathrooms: '1', parkingSpaces: '',
  unitSizeSqft: '', unitSizeSqm: '', view: '',
  furnishing: 'Unfurnished', amenities: [], rentalPrice: '',
  securityDeposit: '', adminFee: '', ejariFeeFils: '', commission: '',
  serviceCharges: '', minLeaseMonths: '12', noticePeriodDays: '60',
  rentEscalationPct: '',
  rentalType: 'yearly', numberOfPayments: '', advancePayment: '',
  gracePeriodDays: '', latePaymentFee: '', specialConditions: '',
  additionalPayments: [],
  description: '',
};

// The rule-driven fee fields that auto-fill from the RP's Fee Rules (resolved by
// the unit's effective category) and recompute when the rent / unit type changes.
const FEE_FIELDS = ['securityDeposit', 'adminFee', 'ejariFeeFils', 'commission'] as const;

interface Props {
  open: boolean;
  propertyCategory: string;
  initial?: Partial<UnitFormData>;
  /** URL of a floor plan already attached (edit mode) — shows "current" state. */
  existingFloorPlanUrl?: string | null;
  /** When the parent property is NOT standalone, each unit carries its own
   *  title deed — pass false to surface the deed upload here. (Standalone
   *  properties keep the deed on the property form instead.) */
  propertyStandalone?: boolean;
  /** Set both when editing an EXISTING unit — enables the inline photo
   *  manager (photos upload/remove lives inside Edit, not a separate button). */
  propertyId?: number;
  editingUnitId?: number;
  /** The RP's configured Fee Rules (Settings → Fee Rules), keyed by space
   *  category. When provided, the deposit / admin / ejari / commission amounts
   *  auto-fill from the rule for this unit's EFFECTIVE category (a mixed-use
   *  building resolves per unit type) and recompute when the rent or unit type
   *  changes. Omitted/null → falls back to the legacy 5%-of-rent heuristic. */
  feeRules?: Record<string, FeeRuleLite[]> | null;
  /** Addendum / amendment files already attached to this unit (edit mode). */
  existingAddendums?: { id: number; name: string; url: string }[];
  /** Layout key — when provided (editing a unit in /units), the form shows the
   *  NEW in-app addendum integration (template picker + preselected default +
   *  bilingual editor) for this floor-plan at the END, replacing the legacy file
   *  upload. The addendum is layout-level and saves itself, independent of the
   *  unit save. Omit it (e.g. the create wizard) to keep the legacy upload. */
  planLabel?: string | null;
  manager?: { rp: number } | null;
  rpQ?: string;
  /** The layout's current addendum terms — seeds the in-app editor. */
  seedAddendumTerms?: AddendumTerms | null;
  /** True when the layout already has a file-based addendum (suppresses the default suggestion). */
  hasAddendumFile?: boolean;
  /** Called after the addendum is applied/saved so the caller can refresh. */
  onAddendumApplied?: () => void;
  onClose: () => void;
  onSave: (data: UnitFormData, floorPlan?: File | null, titleDeed?: File | null, addendums?: File[]) => Promise<void>;
  title?: string;
  /** Layout bulk mode — edit ALL units on a plan at once. Hides the per-unit
   *  identifiers (unit number, premises no., floor) and the pricing / leasing /
   *  addendum sections (those live on the plan "Price" editor), keeping the
   *  physical details + amenities + a single layout floor-plan. The parent's
   *  onSave applies the physical fields to every unit on the layout. */
  layoutBulk?: boolean;
  /** Units on the layout — for the "applies to N units" copy. */
  layoutUnitCount?: number;
}

interface UnitMediaRow { id: number; url: string; caption?: string | null }

/** Inline photo manager — list / add / remove this unit's photos from inside
 *  the edit form (CEO: no separate camera button on the row). */
function PhotosSection({ propertyId, unitId }: { propertyId: number; unitId: number }) {
  const [photos, setPhotos] = useState<UnitMediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    try {
      const r = await fetch(`/api/properties/${propertyId}/units/${unitId}/media`, { credentials: 'include' });
      if (r.ok) setPhotos(await r.json());
    } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [propertyId, unitId]);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setErr(null);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch(`/api/properties/${propertyId}/units/${unitId}/media`, { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? 'Upload failed'); }
      }
      await reload();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Upload failed'); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    setBusy(true); setErr(null);
    try {
      await fetch(`/api/properties/${propertyId}/units/${unitId}/media/${id}`, { method: 'DELETE', credentials: 'include' });
      await reload();
    } finally { setBusy(false); }
  };

  return (
    <div>
      <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Photos</label>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only" onChange={onFiles} />
      {loading ? (
        <div className="text-xs text-[#9b9890] py-2">Loading photos…</div>
      ) : photos.length === 0 ? (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
          className="w-full border-2 border-dashed border-[#e8e6e0] rounded-xl py-8 flex flex-col items-center justify-center gap-1.5 text-[#9b9890] hover:border-[#2e9f82] hover:bg-[#f0fdf8] cursor-pointer disabled:opacity-50">
          <Upload size={20} />
          <span className="text-xs font-medium">Add photos</span>
          <span className="text-[10px] text-[#b0ae9a]">PNG, JPG or WebP · multiple allowed</span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {photos.map((p, i) => (
            <div key={p.id} className="relative group aspect-[4/3]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption ?? 'Unit photo'} className="w-full h-full object-cover rounded-lg border border-[#e8e6e0]" />
              {i === 0 && (
                <span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">Cover</span>
              )}
              <button type="button" onClick={() => void remove(p.id)} disabled={busy}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 border border-[#e8e6e0] text-[#9b9890] hover:text-[#b91c1c] flex items-center justify-center cursor-pointer shadow disabled:opacity-50">
                <X size={12} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            className="aspect-[4/3] border-2 border-dashed border-[#e8e6e0] rounded-lg flex flex-col items-center justify-center gap-1 text-[#9b9890] hover:border-[#2e9f82] hover:bg-[#f0fdf8] cursor-pointer disabled:opacity-50">
            <Upload size={18} />
            <span className="text-[11px] font-medium">Add</span>
          </button>
        </div>
      )}
      {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
    </div>
  );
}

/** Stage addendum / amendment files for upload; lists any already attached.
 *  Each upload must be a .docx that still carries both signature fields — we
 *  validate on select and reject otherwise. A sample is offered to download. */
function AddendumsSection({ files, onAdd, onRemove, existing }: {
  files: File[];
  onAdd: (fs: File[]) => void;
  onRemove: (i: number) => void;
  existing?: { id: number; name: string; url: string }[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const onFiles = async (selected: File[]) => {
    setError(null);
    setChecking(true);
    try {
      const accepted: File[] = [];
      for (const f of selected) {
        const res = await validateAddendumFile(f);
        if (res.ok) accepted.push(f);
        else { setError(res.error ?? 'Invalid addendum file.'); break; }
      }
      if (accepted.length) onAdd(accepted);
    } finally { setChecking(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-medium text-[#3d3b35]">Addendums / Amendments <span className="text-[#9b9890] font-normal">(optional)</span></label>
        <a href={ADDENDUM_SAMPLE_URL} download className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b45309] hover:underline">
          <Download size={11} /> Download sample
        </a>
      </div>
      <input ref={inputRef} type="file" multiple accept={ADDENDUM_ACCEPT} className="sr-only"
        onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) void onFiles(fs); }} />
      {(existing ?? []).map(d => (
        <button key={d.id} type="button" onClick={() => openDocViewer({ fileUrl: d.url, caption: d.name })}
          className="w-full flex items-center gap-2 border border-[#e8e6e0] rounded-lg px-3 py-2 mb-1.5 text-[#1a1916] hover:bg-[#f4f3ef] cursor-pointer">
          <Upload size={14} className="text-[#b45309] shrink-0" />
          <span className="text-sm truncate flex-1">{d.name}</span>
          <span className="text-[11px] text-[#9b9890]">attached</span>
        </button>
      ))}
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-2 border border-[#e8e6e0] rounded-lg px-3 py-2 mb-1.5">
          <Upload size={14} className="text-[#2e9f82] shrink-0" />
          <span className="text-sm text-[#1a1916] truncate flex-1">{f.name}</span>
          <button type="button" onClick={() => onRemove(i)} className="w-5 h-5 rounded-full bg-[#f4f3ef] flex items-center justify-center text-[#9b9890] hover:text-[#b91c1c] cursor-pointer"><X size={11} /></button>
        </div>
      ))}
      <button type="button" onClick={() => inputRef.current?.click()} disabled={checking}
        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#e8e6e0] rounded-lg py-2.5 text-xs text-[#9b9890] hover:border-[#b45309] hover:bg-[#fffbeb] transition-colors cursor-pointer disabled:opacity-50">
        {checking ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} className="text-[#c8c6c0]" />}
        {checking ? 'Checking signature fields…' : 'Attach addendum / amendment (Word .docx)'}
      </button>
      {error && <p className="text-[11px] text-red-600 mt-1.5">{error}</p>}
    </div>
  );
}

// ─── View typeahead ───────────────────────────────────────
function ViewInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = value.length >= 2
    ? VIEW_OPTIONS.filter(v => v.toLowerCase().includes(value.toLowerCase()))
    : [];
  const showDropdown = open && filtered.length > 0;

  return (
    <div ref={ref} className="relative">
      <input
        className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]"
        placeholder="e.g. Sea View, Marina View…"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (value.length >= 2) setOpen(true); }}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
      />
      {showDropdown && (
        <ul className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-[#e8e6e0] rounded-xl shadow-xl max-h-48 overflow-y-auto">
          {filtered.map(v => (
            <li key={v}>
              <button
                type="button"
                onMouseDown={() => { onChange(v); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#f4f3ef] text-[#1a1916] cursor-pointer"
              >
                {v}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UnitFormModal({ open, propertyCategory, initial, existingFloorPlanUrl, propertyStandalone, propertyId, editingUnitId, feeRules, existingAddendums, planLabel, manager, rpQ, seedAddendumTerms, hasAddendumFile, onAddendumApplied, onClose, onSave, title, layoutBulk = false, layoutUnitCount }: Props) {
  const [form, setForm] = useState<UnitFormData>({ ...EMPTY_UNIT, ...initial });
  // Fee fields the user has typed in this session — they stop auto-recomputing
  // off the rent / unit type (mirrors the plan-pricing editor's `overridden`).
  const [overriddenFees, setOverriddenFees] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<keyof UnitFormData, string>>>({});
  const [saving, setSaving] = useState(false);
  const [floorPlan, setFloorPlan] = useState<File | null>(null);
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  // Per-unit title deed — only for units of NON-standalone (multi-unit) properties.
  const [titleDeed, setTitleDeed] = useState<File | null>(null);
  const titleDeedInputRef = useRef<HTMLInputElement>(null);
  // Addendum / amendment files staged for upload on save.
  const [addendums, setAddendums] = useState<File[]>([]);

  // Swipe-in / swipe-out — the full-page takeover slides in from the right and
  // back out, matching PropertyFormModal (globals.css .slideover-*). `dismiss`
  // plays the reverse slide before calling onClose; the hook also wires the
  // browser Back button to close the form instead of navigating away, keying its
  // history entry on `open`.
  const { closing, dismiss: requestClose } = useSlideOver(onClose, open);

  // Full-page shell — scroll-spy STEPS nav (mirrors the Add page).
  const [sec, setSec] = useState('details');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const secRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollingRef = useRef(false);

  // Suggested amount (string) for a fee field, resolved from the RP's Fee Rules by
  // the unit's EFFECTIVE category — for a mixed-use building this derives
  // residential vs commercial from the unit TYPE, so each unit is priced against
  // the right rate. Falls back to the legacy heuristic (5% of rent; AED 220 ejari
  // for residential) when no rule is configured or no feeRules were passed.
  // Returns null when nothing can be suggested (caller keeps the current value).
  const suggestFee = (field: (typeof FEE_FIELDS)[number], unitType: string, rent: number): string | null => {
    const cat = effectiveSpaceCategory(unitType, propertyCategory);
    const rules = feeRules?.[cat] ?? feeRules?.residential;
    const ruleKey = field === 'ejariFeeFils' ? 'ejariFee' : field;
    const ruled = feeFromRules(rules, ruleKey, rent);
    if (ruled != null) return String(ruled);
    // No active rule for this fee/category → legacy fallback.
    if (field === 'ejariFeeFils') return cat === 'residential' ? '220' : null;
    return rent > 0 ? String(Math.round(rent * 0.05)) : null;
  };

  useEffect(() => {
    if (open) {
      const defaults = {
        ...EMPTY_UNIT,
        minLeaseMonths:  DEFAULT_MIN_LEASE[resolveBaseCategory(propertyCategory)] ?? '12',
        noticePeriodDays: DEFAULT_NOTICE[resolveBaseCategory(propertyCategory)] ?? '60',
      };
      const seeded: UnitFormData = { ...defaults, ...initial };
      // Auto-fill any BLANK fee from the RP's rules (resolved per unit type) so a
      // new unit starts pre-priced; stored / user-entered values are preserved.
      const rent = Number(seeded.rentalPrice) || 0;
      for (const f of FEE_FIELDS) {
        if (!seeded[f]) {
          const s = suggestFee(f, seeded.unitType, rent);
          if (s != null) seeded[f] = s;
        }
      }
      setForm(seeded);
      setOverriddenFees(new Set());
      setErrors({});
      setFloorPlan(null);
      setTitleDeed(null);
      setAddendums([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const upd = <K extends keyof UnitFormData>(k: K, v: UnitFormData[K]) => {
    // A fee the user types is theirs — stop auto-recomputing it off the rent/type.
    if ((FEE_FIELDS as readonly string[]).includes(k as string)) {
      setOverriddenFees(prev => new Set(prev).add(k as string));
    }
    setForm(prev => {
      const next = { ...prev, [k]: v };
      // Re-suggest the rule-driven fees the user hasn't overridden whenever the
      // rent OR the unit type changes — so editing either keeps the amounts in
      // sync (the old code only filled blanks, so edits never refreshed them).
      if (k === 'rentalPrice' || k === 'unitType') {
        const rent = Number(k === 'rentalPrice' ? v : prev.rentalPrice);
        const unitType = (k === 'unitType' ? v : prev.unitType) as string;
        if (!isNaN(rent)) {
          for (const f of FEE_FIELDS) {
            if (overriddenFees.has(f)) continue;
            const s = suggestFee(f, unitType, rent);
            if (s != null) next[f] = s;
          }
        }
      }
      return next;
    });
    setErrors(prev => ({ ...prev, [k]: undefined }));
  };

  const toggleAmenity = (a: string) => {
    setForm(prev => ({
      ...prev,
      amenities: prev.amenities.includes(a)
        ? prev.amenities.filter(x => x !== a)
        : [...prev.amenities, a],
    }));
  };

  const validate = (): typeof errors => {
    const errs: typeof errors = {};
    if (!layoutBulk && !form.unitNumber.trim()) errs.unitNumber  = 'Required';
    if (!form.unitType)          errs.unitType    = 'Required';
    if (!form.unitSizeSqft && !form.unitSizeSqm) errs.unitSizeSqft = 'Required';
    if (!layoutBulk && !form.rentalPrice)       errs.rentalPrice  = 'Required';
    setErrors(errs);
    return errs;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      // jump to the first section with an error so it's visible on the full page
      goToSection(errs.rentalPrice && !errs.unitType && !errs.unitNumber && !errs.unitSizeSqft ? 'pricing' : 'details');
      return;
    }
    setSaving(true);
    const payload = { ...form };
    try { await onSave(payload, floorPlan, propertyStandalone === false ? titleDeed : null, addendums); requestClose(); }
    finally { setSaving(false); }
  };

  const unitTypes    = unitTypesForCategory(propertyCategory);
  // Beds / baths / furnishing are residential-only, gated by the EFFECTIVE
  // category (unit type wins; before a type is picked, fall back to the property
  // category — so an industrial / commercial building never shows them).
  const effResidential = (() => {
    const t = form.unitType;
    const fromType = t ? (isLandUnitType(t) ? 'land' : (isResidentialUnitType(t) ? 'residential' : 'commercial')) : null;
    const base = propertyCategory === 'residential' || propertyCategory === 'mixed_use' ? 'residential'
      : propertyCategory === 'land' ? 'land' : 'commercial';
    return (fromType ?? base) === 'residential';
  })();
  const showBedBath   = effResidential;
  const isResidential = effResidential;
  const amenityList   = getAmenitiesForCategory(propertyCategory);
  const seg = (on: boolean) => cn(ds.seg, on && ds.segOn);

  // STEPS nav — same sections as the Add page (no "Property" step: the unit's
  // building is already known here).
  const SECTIONS = [
    { id: 'details',   label: 'Unit details' },
    { id: 'pricing',   label: 'Pricing & fees' },
    { id: 'leasing',   label: 'Leasing terms' },
    { id: 'amenities', label: 'Amenities' },
    { id: 'media',     label: layoutBulk ? 'Floor plan' : 'Photos & documents' },
    { id: 'addendum',  label: 'Addendum' },
  ];
  const secNum = (id: string) => SECTIONS.findIndex((s) => s.id === id) + 1;
  const SECTION_ORDER = SECTIONS.map(x => x.id);
  const setRef = (id: string) => (el: HTMLElement | null) => { secRefs.current[id] = el; };
  const goToSection = (id: string) => {
    setSec(id);
    const c = bodyRef.current, el = secRefs.current[id];
    if (!c || !el) return;
    const top = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 14;
    scrollingRef.current = true;
    c.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    window.setTimeout(() => { scrollingRef.current = false; }, 340);
  };
  const onBodyScroll = () => {
    const c = bodyRef.current;
    if (!c || scrollingRef.current) return;
    const cTop = c.getBoundingClientRect().top;
    let cur = SECTION_ORDER[0];
    for (const id of SECTION_ORDER) {
      const el = secRefs.current[id];
      if (el && (el.getBoundingClientRect().top - cTop) <= 80) cur = id;
    }
    if (c.scrollTop + c.clientHeight >= c.scrollHeight - 4) cur = SECTION_ORDER[SECTION_ORDER.length - 1];
    if (cur !== sec) setSec(cur);
  };

  if (!open) return null;

  return (
    <div className={cn(ds.fullscreen, 'slideover-panel', closing && 'closing')}>
      <div className={ds.app}>
        <header className={ds.header}>
          {/* Back-arrow on the LEFT — matches the detail views' back button. */}
          <button type="button" className={ds.backBtn} onClick={requestClose} aria-label="Back"><ArrowLeft size={18} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={ds.headTitle}>{title ?? (layoutBulk ? 'Edit layout' : 'Add Unit')}</div>
            <div className={ds.headSub}>{layoutBulk
              ? `Applies to all ${layoutUnitCount ?? ''} unit${layoutUnitCount === 1 ? '' : 's'} on this layout — unit number, premises no. and floor stay per-unit.`
              : (editingUnitId ? 'Update identity, pricing, terms and documents.' : 'Add a unit to this layout.')}</div>
          </div>
        </header>

        <div ref={bodyRef} onScroll={onBodyScroll} className={ds.body}>
          <aside className={ds.nav}>
            <div className={ds.navLabel}>STEPS</div>
            {SECTIONS.map((sx, i) => (
              <button key={sx.id} type="button" onClick={() => goToSection(sx.id)} className={cn(ds.navItem, sec === sx.id && ds.navItemActive)}>
                <span className={cn(ds.navBadge, sec === sx.id && ds.navBadgeActive)}>{i + 1}</span>
                <span style={{ flex: 1 }}>{sx.label}</span>
              </button>
            ))}
          </aside>

          <div className={ds.form}>
            <div className={ds.formInner}>

          {/* 1 · UNIT DETAILS */}
          <div ref={setRef('details')} className={ds.secHead}><span className={ds.secNum}>1</span><div><div className={ds.secTitle}>Unit details</div><div className={ds.secSub}>Identity, layout and size of this unit.</div></div></div>

          <div className={ds.field}>
            <label className={ds.lbl}>Listing Unit Title</label>
            <input className={ds.input} placeholder="e.g. Spacious 2BR Apartment with Balcony in Al Raffa"
              value={form.unitName} onChange={e => upd('unitName', e.target.value)} />
          </div>

          <div className={cn(ds.grid3, ds.field)}>
            <div>
              <label className={ds.lbl}>Unit Type <span className={ds.req}>*</span></label>
              <select className={cn(ds.select, errors.unitType && ds.inputErr)} value={form.unitType} onChange={e => upd('unitType', e.target.value)}>
                <option value="">Select type</option>
                {unitTypes.map(t => <option key={t} value={t}>{UNIT_TYPE_LABELS[t] ?? t}</option>)}
              </select>
              {errors.unitType && <p className={ds.errText}>{errors.unitType}</p>}
            </div>
            {!layoutBulk && (
              <div>
                <label className={ds.lbl}>Unit Number <span className={ds.req}>*</span></label>
                <input className={cn(ds.input, errors.unitNumber && ds.inputErr)} placeholder="e.g. 101, G-02"
                  value={form.unitNumber} onChange={e => upd('unitNumber', e.target.value)} />
                {errors.unitNumber && <p className={ds.errText}>{errors.unitNumber}</p>}
              </div>
            )}
            {!layoutBulk && (
              <div>
                <label className={ds.lbl}>Utility Premises No.</label>
                <input className={ds.input} placeholder="e.g. 1234567" value={form.premiseNumber} onChange={e => upd('premiseNumber', e.target.value)} />
              </div>
            )}
          </div>

          {showBedBath && (
            <>
              <div className={cn(ds.grid2, ds.gap22, ds.field)}>
                <div>
                  <label className={ds.lbl}>Bedrooms</label>
                  <div className={ds.segGroup}>
                    {['Studio', '1', '2', '3', '4', '5', '6+'].map(b => (
                      <button key={b} type="button" className={seg(form.bedrooms === b)} onClick={() => upd('bedrooms', b)}>{b === 'Studio' ? 'Studio' : `${b} BR`}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={ds.lbl}>Bathrooms</label>
                  <div className={ds.segGroup}>
                    {['1', '2', '3', '4', '5+'].map(b => (
                      <button key={b} type="button" className={seg(form.bathrooms === b)} onClick={() => upd('bathrooms', b)}>{b}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className={ds.field}>
                <label className={ds.lbl}>Furnishing</label>
                <div className={ds.segGroup}>
                  {FURNISHING_OPTIONS.map(f => <button key={f} type="button" className={seg(form.furnishing === f)} onClick={() => upd('furnishing', f)}>{f}</button>)}
                </div>
              </div>
            </>
          )}

          <div className={cn(ds.grid3, ds.field)}>
            {!layoutBulk && (
              <div><label className={ds.lbl}>Floor</label><input className={ds.input} placeholder="e.g. G, 1, 2…" value={form.floor} onChange={e => upd('floor', e.target.value)} /></div>
            )}
            <div><label className={ds.lbl}>View</label><ViewInput value={form.view} onChange={v => upd('view', v)} /></div>
            <div><label className={ds.lbl}>Parking</label><input type="number" min="0" step="1" className={ds.input} placeholder="e.g. 1" value={form.parkingSpaces} onChange={e => upd('parkingSpaces', e.target.value)} /></div>
          </div>

          <div style={{ maxWidth: 320 }}>
            <label className={ds.lbl}>Size (sq.ft) <span className={ds.req}>*</span></label>
            <input type="number" min="0" step="any" className={cn(ds.input, errors.unitSizeSqft && ds.inputErr)} placeholder="e.g. 1200"
              value={form.unitSizeSqft}
              onChange={e => setForm(f => ({ ...f, unitSizeSqft: e.target.value, unitSizeSqm: sqmFromSqft(e.target.value) }))} />
            {errors.unitSizeSqft && <p className={ds.errText}>{errors.unitSizeSqft}</p>}
            <div className={ds.hintGreen}>≈ {form.unitSizeSqm ? `${form.unitSizeSqm} sq.m` : '— sq.m'} <span>· stored in both units</span></div>
          </div>

          <div className={ds.divider} />

          {/* 2 · PRICING & FEES */}
          <div ref={setRef('pricing')} className={ds.secHead}><span className={ds.secNum}>2</span><div><div className={ds.secTitle}>Pricing &amp; fees</div><div className={ds.secSub}>Rent and one-off charges for this unit.</div></div></div>

          <div className={ds.grid2}>
            <div className={ds.field}>
              <label className={ds.lbl}>Market Price (AED) <span className={ds.req}>*</span></label>
              <input type="number" min="0" step="any" className={cn(ds.input, errors.rentalPrice && ds.inputErr)} placeholder="e.g. 85000"
                value={form.rentalPrice} onChange={e => upd('rentalPrice', e.target.value)} />
              {errors.rentalPrice && <p className={ds.errText}>{errors.rentalPrice}</p>}
            </div>
          </div>

          <div className={ds.feesBox}>
            <div className={ds.feesTitle}>FEES</div>
            <div className={ds.grid2}>
              <div><label className={ds.lbl}>Security Deposit</label><input type="number" min="0" step="any" className={ds.input} placeholder="e.g. 10000" value={form.securityDeposit} onChange={e => upd('securityDeposit', e.target.value)} /></div>
              <div><label className={ds.lbl}>Admin Fee</label><input type="number" min="0" step="any" className={ds.input} placeholder="e.g. 5000" value={form.adminFee} onChange={e => upd('adminFee', e.target.value)} /></div>
              <div><label className={ds.lbl}>Contract Registration Fee</label><input type="number" min="0" step="any" className={ds.input} placeholder={isResidential ? '220' : 'e.g. 250'} value={form.ejariFeeFils} onChange={e => upd('ejariFeeFils', e.target.value)} /></div>
              <div><label className={ds.lbl}>Commission</label><input type="number" min="0" step="any" className={ds.input} placeholder="e.g. 4000" value={form.commission} onChange={e => upd('commission', e.target.value)} /></div>
              <div><label className={ds.lbl}>Service Charges (AED/yr)</label><input type="number" min="0" step="any" className={ds.input} placeholder="e.g. 8000" value={form.serviceCharges} onChange={e => upd('serviceCharges', e.target.value)} /></div>
            </div>

            <div className={ds.addRow}>
              <div style={{ flex: 1 }}>
                <div className={ds.addRowTitle}>Additional Payments</div>
                <div className={ds.addRowSub}>Extra one-off charges (e.g. chiller deposit, move-in fee) — the customer sees each as its own line at booking.</div>
              </div>
              <button type="button" className={ds.linkBtn} onClick={() => setForm(f => ({ ...f, additionalPayments: [...f.additionalPayments, { label: '', amount: '', vat: '' }] }))}>+ Add payment</button>
            </div>
            {form.additionalPayments.length === 0 ? (
              <p style={{ fontSize: 11, color: '#9b9890', fontStyle: 'italic', marginTop: 8 }}>None — only rent, deposit and the fees above apply.</p>
            ) : (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className={ds.payGrid}><span className={ds.payHead}>Label</span><span className={ds.payHead}>Net AED</span><span className={ds.payHead}>VAT AED</span><span /></div>
                {form.additionalPayments.map((p, i) => (
                  <div key={i} className={ds.payGrid}>
                    <input type="text" className={ds.input} placeholder="e.g. Chiller deposit" value={p.label}
                      onChange={e => setForm(f => ({ ...f, additionalPayments: f.additionalPayments.map((r, j) => j === i ? { ...r, label: e.target.value } : r) }))} />
                    <input type="number" min="0" step="any" className={ds.input} placeholder="0" value={p.amount}
                      onChange={e => setForm(f => ({ ...f, additionalPayments: f.additionalPayments.map((r, j) => j === i ? { ...r, amount: e.target.value } : r) }))} />
                    <input type="number" min="0" step="any" className={ds.input} placeholder="0" value={p.vat}
                      onChange={e => setForm(f => ({ ...f, additionalPayments: f.additionalPayments.map((r, j) => j === i ? { ...r, vat: e.target.value } : r) }))} />
                    <button type="button" className={ds.payDel} title="Remove"
                      onClick={() => setForm(f => ({ ...f, additionalPayments: f.additionalPayments.filter((_, j) => j !== i) }))}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={ds.divider} />

          {/* 3 · LEASING TERMS */}
          <div ref={setRef('leasing')} className={ds.secHead}><span className={ds.secNum}>3</span><div><div className={ds.secTitle}>Leasing terms</div><div className={ds.secSub}>Default terms new contracts on this unit will use.</div></div></div>
          <div className={ds.leaseBox}>
            <div className={ds.grid2} style={{ gap: '13px 22px', alignItems: 'start' }}>
              <div>
                <label className={ds.lbl}>Rental Type</label>
                <div className={ds.segGroup}>
                  {RENTAL_TYPE_OPTIONS.map(o => <button key={o.id} type="button" className={seg(form.rentalType === o.id)} onClick={() => upd('rentalType', o.id)}>{o.label}</button>)}
                </div>
              </div>
              <div>
                <label className={ds.lbl}>Notice (days)</label>
                <input type="number" min="0" step="any" className={ds.input} placeholder="60" value={form.noticePeriodDays} onChange={e => upd('noticePeriodDays', e.target.value)} />
              </div>
            </div>
            <div className={ds.grid3} style={{ marginTop: 13 }}>
              <div><label className={ds.lbl}>Min. Lease (months)</label><input type="number" min="0" step="1" className={ds.input} placeholder="12" value={form.minLeaseMonths} onChange={e => upd('minLeaseMonths', e.target.value)} /></div>
              <div><label className={ds.lbl}>Rent Escalation (%/yr)</label><input type="number" min="0" max="100" step="0.5" className={ds.input} placeholder="e.g. 5" value={form.rentEscalationPct} onChange={e => upd('rentEscalationPct', e.target.value)} /></div>
              <div><label className={ds.lbl}>Number of Payments</label><input type="number" min="0" step="1" className={ds.input} placeholder="e.g. 4" value={form.numberOfPayments} onChange={e => upd('numberOfPayments', e.target.value)} /></div>
              <div><label className={ds.lbl}>Advance Payment (AED)</label><input type="number" min="0" step="any" className={ds.input} placeholder="e.g. 5000" value={form.advancePayment} onChange={e => upd('advancePayment', e.target.value)} /></div>
              <div><label className={ds.lbl}>Grace Period (days)</label><input type="number" min="0" step="1" className={ds.input} placeholder="e.g. 7" value={form.gracePeriodDays} onChange={e => upd('gracePeriodDays', e.target.value)} /></div>
              <div><label className={ds.lbl}>Late Payment Fee (AED)</label><input type="number" min="0" step="any" className={ds.input} placeholder="e.g. 500" value={form.latePaymentFee} onChange={e => upd('latePaymentFee', e.target.value)} /></div>
            </div>
          </div>

          <div className={ds.divider} />

          {/* 4 · AMENITIES & DESCRIPTION */}
          <div ref={setRef('amenities')} className={ds.secHead}><span className={ds.secNum}>{secNum('amenities')}</span><div><div className={ds.secTitle}>Amenities &amp; description</div><div className={ds.secSub}>What this unit offers, in its own words.</div></div></div>

          <label className={ds.lbl}>Amenities{form.amenities.length > 0 && <span style={{ color: '#1a7a5a', fontWeight: 700 }}> · {form.amenities.length} selected</span>}</label>
          <div className={ds.amenWrap} style={{ marginBottom: 16 }}>
            {amenityList.map(a => (
              <button key={a} type="button" onClick={() => toggleAmenity(a)} className={cn(ds.amenChip, form.amenities.includes(a) && ds.amenChipOn)}>{a}</button>
            ))}
          </div>

          {/* Description */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <label className={ds.lbl} style={{ marginBottom: 0 }}>Unit Description</label>
              <button
                type="button"
                onClick={() => upd('description', composeUnitDescription(form, propertyCategory))}
                disabled={!form.unitType}
                title={form.unitType ? 'Compose a description from the selected fields' : 'Select a unit type first'}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                  form.unitType
                    ? 'bg-[#d8f2e8] text-[#1a7a5a] hover:bg-[#c0e8d6] cursor-pointer'
                    : 'bg-[#f4f3ef] text-[#9b9890] cursor-not-allowed',
                )}
              >
                <Sparkles size={12} />
                {form.description ? 'Re-generate' : 'Auto-generate'}
              </button>
            </div>
            <textarea className={ds.textarea} rows={3}
              placeholder="Describe this unit for the listing — features, highlights, unique selling points… or click Auto-generate above."
              value={form.description} onChange={e => upd('description', e.target.value)} />
          </div>

          <div className={ds.divider} />

          {/* PHOTOS & DOCUMENTS (bulk: layout floor plan only) */}
          <div ref={setRef('media')} className={ds.secHead}><span className={ds.secNum}>{secNum('media')}</span><div><div className={ds.secTitle}>{layoutBulk ? 'Floor plan' : 'Photos & documents'}</div><div className={ds.secSub}>{layoutBulk ? 'One floor plan applied to every unit on this layout.' : 'Imagery and the paperwork for this unit.'}</div></div></div>

          {/* Photos — live manager (existing units only) */}
          {propertyId != null && editingUnitId != null && (
            <div style={{ marginBottom: 16 }}>
              <PhotosSection propertyId={propertyId} unitId={editingUnitId} />
            </div>
          )}

          <input ref={floorPlanInputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only"
            onChange={e => { const f = e.target.files?.[0] ?? null; if (f) setFloorPlan(f); e.target.value = ''; }} />
          <input ref={titleDeedInputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only"
            onChange={e => { const f = e.target.files?.[0] ?? null; if (f) setTitleDeed(f); e.target.value = ''; }} />

          <div className={ds.docGrid} style={(propertyStandalone === false && !layoutBulk) ? undefined : { gridTemplateColumns: '1fr' }}>
            {/* Floor plan */}
            <div>
              <label className={ds.lbl}>Floor plan <span style={{ color: '#9b9890', fontWeight: 600 }}>(optional)</span></label>
              {floorPlan ? (
                <div className={ds.docFile}>
                  <span className={ds.docFileIcon}><Layers size={20} /></span>
                  <span className={ds.docFileName}>{floorPlan.name}</span>
                  <button type="button" className={ds.docFileAct} onClick={() => floorPlanInputRef.current?.click()}>Replace</button>
                  <button type="button" className={ds.docFileDel} onClick={() => setFloorPlan(null)}><X size={12} /></button>
                </div>
              ) : (
                <button type="button" className={ds.docZone} onClick={() => floorPlanInputRef.current?.click()}>
                  <span className={ds.docZoneIcon}><Layers size={20} /></span>
                  <span className={ds.docZoneTitle}>{existingFloorPlanUrl ? 'Replace floor plan' : 'Attach floor plan'}</span>
                  <span className={ds.docZoneSub}>PDF, PNG or JPG</span>
                </button>
              )}
              {existingFloorPlanUrl && !floorPlan && (
                <button type="button" className={ds.docFileAct} style={{ marginTop: 6, display: 'inline-block' }}
                  onClick={() => openDocViewer({ fileUrl: existingFloorPlanUrl, caption: 'Floor plan' })}>
                  A floor plan is already attached — view current
                </button>
              )}
            </div>

            {/* Title deed — per-unit (multi-unit / non-standalone properties); never in layout bulk */}
            {propertyStandalone === false && !layoutBulk && (
              <div>
                <label className={ds.lbl}>Title Deed <span style={{ color: '#9b9890', fontWeight: 600 }}>(this unit)</span></label>
                {titleDeed ? (
                  <div className={ds.docFile}>
                    <span className={ds.docFileIcon}><FileText size={20} /></span>
                    <span className={ds.docFileName}>{titleDeed.name}</span>
                    <button type="button" className={ds.docFileAct} onClick={() => titleDeedInputRef.current?.click()}>Replace</button>
                    <button type="button" className={ds.docFileDel} onClick={() => setTitleDeed(null)}><X size={12} /></button>
                  </div>
                ) : (
                  <button type="button" className={ds.docZone} onClick={() => titleDeedInputRef.current?.click()}>
                    <span className={ds.docZoneIcon}><FileText size={20} /></span>
                    <span className={ds.docZoneTitle}>Attach title deed</span>
                    <span className={ds.docZoneSub}>For separately-titled units</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 6 · AGREEMENT ADDENDUM */}
          <div className={ds.divider} />
          <div ref={setRef('addendum')} className={ds.secHead}><span className={ds.secNum}>6</span><div><div className={ds.secTitle}>Agreement addendum <span className={ds.secOpt}>· optional</span></div><div className={ds.secSub}>Extra wording every contract on this unit will carry.</div></div></div>
          {/* In-app layout addendum (editing a unit in /units) … */}
          {planLabel && propertyId != null && (
            <AddendumLayoutSection
              propertyId={propertyId}
              planLabel={planLabel}
              seedTerms={seedAddendumTerms}
              hasExistingFile={hasAddendumFile}
              manager={manager}
              rpQ={rpQ}
              onApplied={onAddendumApplied}
            />
          )}
          {/* … or legacy per-unit addendum file upload (create wizard, no layout key). */}
          {!planLabel && (
            <div style={{ background: '#fdf8ec', border: '1px solid #efe1bf', borderRadius: 13, padding: 15 }}>
              <AddendumsSection
                files={addendums}
                onAdd={fs => setAddendums(prev => [...prev, ...fs])}
                onRemove={i => setAddendums(prev => prev.filter((_, x) => x !== i))}
                existing={existingAddendums}
              />
            </div>
          )}

              <div style={{ height: 8 }} />
            </div>
          </div>
        </div>

        <footer className={ds.footer}>
          <button type="button" className={ds.cancelBtn} onClick={requestClose}>Cancel</button>
          <div className={ds.footSpacer} />
          <button type="button" className={ds.saveBtn} disabled={saving} onClick={() => handleSubmit()}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving…' : (layoutBulk ? `Save to all ${layoutUnitCount ?? ''} units` : (title?.startsWith('Edit') ? 'Save Changes' : 'Add Unit'))}
          </button>
        </footer>
      </div>
    </div>
  );
}
