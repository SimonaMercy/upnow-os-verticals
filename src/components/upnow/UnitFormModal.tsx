'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Unit type arrays (match backend UnitType enum) ───────
export const RESIDENTIAL_UNIT_TYPES = ['apartment', 'villa', 'townhouse', 'penthouse', 'studio', 'duplex_loft'];
export const COMMERCIAL_UNIT_TYPES  = ['office_fitted', 'office_shell_core', 'retail_shop', 'showroom', 'restaurant_fnb', 'clinic_medical'];
export const INDUSTRIAL_UNIT_TYPES  = ['warehouse', 'open_yard', 'storage_unit', 'cold_storage', 'logistics_facility'];
export const WORKSPACES_UNIT_TYPES  = ['coworking_desk', 'private_office', 'meeting_room', 'day_office'];
export const VENUES_UNIT_TYPES      = ['event_hall', 'wedding_venue', 'conference_hall', 'private_dining', 'outdoor_venue'];

// All non-residential types combined (useful for downstream checks)
export const ALL_COMMERCIAL_TYPES = [
  ...COMMERCIAL_UNIT_TYPES,
  ...INDUSTRIAL_UNIT_TYPES,
  ...WORKSPACES_UNIT_TYPES,
  ...VENUES_UNIT_TYPES,
];

export const UNIT_TYPE_LABELS: Record<string, string> = {
  // Residential
  apartment: 'Apartment', villa: 'Villa', townhouse: 'Townhouse',
  penthouse: 'Penthouse', studio: 'Studio', duplex_loft: 'Duplex / Loft',
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
};

function unitTypesForCategory(category: string): string[] {
  switch (category) {
    case 'residential':  return RESIDENTIAL_UNIT_TYPES;
    case 'commercial':   return COMMERCIAL_UNIT_TYPES;
    case 'industrial':   return INDUSTRIAL_UNIT_TYPES;
    case 'workspaces':   return WORKSPACES_UNIT_TYPES;
    case 'venues':       return VENUES_UNIT_TYPES;
    default:             return [...RESIDENTIAL_UNIT_TYPES, ...COMMERCIAL_UNIT_TYPES];
  }
}

// ─── Category-specific amenities ─────────────────────────
const AMENITIES_MAP: Record<string, string[]> = {
  residential: [
    'Central A/C', 'Parking', 'Swimming Pool', 'Gym', 'Security', 'CCTV',
    'Balcony', 'Elevator', 'Concierge', 'Playground', "Maid's Room", 'Storage',
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
  return AMENITIES_MAP[category] ?? AMENITIES_MAP.residential;
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
  unitSizeSqft: string;
  unitSizeSqm: string;
  view: string;
  furnishing: string;
  amenities: string[];
  rentalPrice: string;
  marketPrice: string;
  securityDeposit: string;
  adminFee: string;
  ejariFeeFils: string;
  commission: string;
  serviceCharges: string;
  minLeaseMonths: string;
  noticePeriodDays: string;
  rentEscalationPct: string;
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
  floor: '', premiseNumber: '', bedrooms: '1', bathrooms: '1', unitSizeSqft: '', unitSizeSqm: '', view: '',
  furnishing: 'Unfurnished', amenities: [], rentalPrice: '', marketPrice: '',
  securityDeposit: '', adminFee: '', ejariFeeFils: '', commission: '',
  serviceCharges: '', minLeaseMonths: '12', noticePeriodDays: '60',
  rentEscalationPct: '', description: '',
};

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
  onClose: () => void;
  onSave: (data: UnitFormData, floorPlan?: File | null, titleDeed?: File | null) => Promise<void>;
  title?: string;
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

const INPUT = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';
const INPUT_ERR = 'w-full border border-red-400 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400';

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890]">{children}</span>
      <div className="h-px flex-1 bg-[#eeece6]" />
    </div>
  );
}

export function UnitFormModal({ open, propertyCategory, initial, existingFloorPlanUrl, propertyStandalone, propertyId, editingUnitId, onClose, onSave, title }: Props) {
  const [form, setForm] = useState<UnitFormData>({ ...EMPTY_UNIT, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof UnitFormData, string>>>({});
  const [saving, setSaving] = useState(false);
  const [floorPlan, setFloorPlan] = useState<File | null>(null);
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  // Per-unit title deed — only for units of NON-standalone (multi-unit) properties.
  const [titleDeed, setTitleDeed] = useState<File | null>(null);
  const titleDeedInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const defaults = {
        ...EMPTY_UNIT,
        minLeaseMonths:  DEFAULT_MIN_LEASE[propertyCategory] ?? '12',
        noticePeriodDays: DEFAULT_NOTICE[propertyCategory] ?? '60',
        ejariFeeFils: propertyCategory === 'residential' ? '220' : '',
      };
      setForm({ ...defaults, ...initial });
      setErrors({});
      setFloorPlan(null);
      setTitleDeed(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const upd = <K extends keyof UnitFormData>(k: K, v: UnitFormData[K]) => {
    setForm(prev => {
      const next = { ...prev, [k]: v };
      if (k === 'rentalPrice') {
        const rent = Number(v);
        if (!isNaN(rent) && rent > 0) {
          // Only auto-fill fees that are still blank — never clobber values the
          // user set (or that a stored unit already carries in edit mode).
          if (!prev.securityDeposit) next.securityDeposit = String(Math.round(rent * 0.05));
          if (!prev.adminFee)        next.adminFee        = String(Math.round(rent * 0.05));
          if (!prev.commission)      next.commission      = String(Math.round(rent * 0.05));
          // Ejari fee: AED 220 for residential only; 0 for all others
          if (!prev.ejariFeeFils && propertyCategory === 'residential') next.ejariFeeFils = '220';
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

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!form.unitNumber.trim()) errs.unitNumber  = 'Required';
    if (!form.unitType)          errs.unitType    = 'Required';
    if (!form.unitSizeSqft && !form.unitSizeSqm) errs.unitSizeSqft = 'Required';
    if (!form.rentalPrice)       errs.rentalPrice  = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    // One price: the annual rent is also the market/list price, so keep them in
    // lock-step rather than exposing a second field.
    const payload = { ...form, marketPrice: form.rentalPrice };
    try { await onSave(payload, floorPlan, propertyStandalone === false ? titleDeed : null); onClose(); }
    finally { setSaving(false); }
  };

  const unitTypes    = unitTypesForCategory(propertyCategory);
  const showBedBath  = ['residential', ''].includes(propertyCategory) || RESIDENTIAL_UNIT_TYPES.includes(form.unitType);
  const isResidential = propertyCategory === 'residential' || RESIDENTIAL_UNIT_TYPES.includes(form.unitType);
  const amenityList  = getAmenitiesForCategory(propertyCategory);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-10 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 bg-white rounded-t-2xl flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0] z-10">
          <h3 className="font-semibold text-lg text-[#1a1916]">{title ?? 'Add Unit'}</h3>
          <button onClick={onClose} className="cursor-pointer text-[#6b6860] hover:text-[#1a1916]"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">

          <SectionHeading>Basics</SectionHeading>

          {/* Listing Unit Title */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-1">Listing Unit Title</label>
            <input
              className={INPUT}
              placeholder="e.g. Spacious 2BR Apartment with Balcony in Al Raffa"
              value={form.unitName}
              onChange={e => upd('unitName', e.target.value)}
            />
          </div>

          {/* Unit Type + Unit Tier */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Unit Type <span className="text-red-500">*</span></label>
              <select
                className={cn(errors.unitType ? INPUT_ERR : INPUT, 'appearance-none')}
                value={form.unitType}
                onChange={e => upd('unitType', e.target.value)}
              >
                <option value="">Select type</option>
                {unitTypes.map(t => <option key={t} value={t}>{UNIT_TYPE_LABELS[t] ?? t}</option>)}
              </select>
              {errors.unitType && <p className="text-[10px] text-red-500 mt-0.5">{errors.unitType}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Unit Tier</label>
              <select
                className={cn(INPUT, 'appearance-none')}
                value={form.unitTier}
                onChange={e => upd('unitTier', e.target.value)}
              >
                {UNIT_TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* Unit Number + Floor + Utility Premises */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Unit Number <span className="text-red-500">*</span></label>
              <input
                className={errors.unitNumber ? INPUT_ERR : INPUT}
                placeholder="e.g. 101, G-02"
                value={form.unitNumber}
                onChange={e => upd('unitNumber', e.target.value)}
              />
              {errors.unitNumber && <p className="text-[10px] text-red-500 mt-0.5">{errors.unitNumber}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Floor</label>
              <input
                className={INPUT}
                placeholder="e.g. G, 1, 2…"
                value={form.floor}
                onChange={e => upd('floor', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Utility Premises No.</label>
              <input
                className={INPUT}
                placeholder="e.g. 1234567"
                value={form.premiseNumber}
                onChange={e => upd('premiseNumber', e.target.value)}
              />
            </div>
          </div>

          <SectionHeading>Specifications</SectionHeading>

          {/* Beds + Baths + Furnishing — residential only */}
          {showBedBath && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1">Bedrooms</label>
                <select className={cn(INPUT, 'appearance-none')} value={form.bedrooms} onChange={e => upd('bedrooms', e.target.value)}>
                  {['Studio', '1', '2', '3', '4', '5', '6+'].map(b => (
                    <option key={b} value={b}>{b === 'Studio' ? 'Studio' : `${b} BR`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1">Bathrooms</label>
                <select className={cn(INPUT, 'appearance-none')} value={form.bathrooms} onChange={e => upd('bathrooms', e.target.value)}>
                  {['1', '2', '3', '4', '5+'].map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1">Furnishing</label>
                <select className={cn(INPUT, 'appearance-none')} value={form.furnishing} onChange={e => upd('furnishing', e.target.value)}>
                  {FURNISHING_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* View */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-1">View</label>
            <ViewInput value={form.view} onChange={v => upd('view', v)} />
          </div>

          {/* Size — capture sq.ft OR sq.m; the other auto-computes. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Size (sq.ft) <span className="text-red-500">*</span></label>
              <input
                type="number" min="0" step="any"
                className={errors.unitSizeSqft ? INPUT_ERR : INPUT}
                placeholder="e.g. 1200"
                value={form.unitSizeSqft}
                onChange={e => setForm(f => ({ ...f, unitSizeSqft: e.target.value, unitSizeSqm: sqmFromSqft(e.target.value) }))}
              />
              {errors.unitSizeSqft && <p className="text-[10px] text-red-500 mt-0.5">{errors.unitSizeSqft}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Size (sq.m)</label>
              <input
                type="number" min="0" step="any"
                className={INPUT}
                placeholder="e.g. 111"
                value={form.unitSizeSqm}
                onChange={e => setForm(f => ({ ...f, unitSizeSqm: e.target.value, unitSizeSqft: sqftFromSqm(e.target.value) }))}
              />
              <p className="text-[10px] text-[#9b9890] mt-0.5">Auto-converts with sq.ft.</p>
            </div>
          </div>

          <SectionHeading>Pricing</SectionHeading>

          {/* Annual rent — the single price (used for the listing and to pre-fill
              the contract; a discount becomes the contract's annual rent). */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-1">Annual Rent (AED) <span className="text-red-500">*</span></label>
            <input
              type="number" min="0" step="any"
              className={errors.rentalPrice ? INPUT_ERR : INPUT}
              placeholder="e.g. 85000"
              value={form.rentalPrice}
              onChange={e => upd('rentalPrice', e.target.value)}
            />
            {errors.rentalPrice && <p className="text-[10px] text-red-500 mt-0.5">{errors.rentalPrice}</p>}
          </div>

          {/* Financial Details */}
          <div className="rounded-xl border border-[#a7f3d0] bg-[#f0fdf8] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1a7a5a]">Financial Details</p>
              {form.rentalPrice && (
                <span className="text-[10px] text-[#4aaa8a]">Calculated from annual rent · edit to adjust</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Security Deposit</label>
                <input type="number" min="0" step="any" className={INPUT} placeholder="e.g. 10000"
                  value={form.securityDeposit} onChange={e => upd('securityDeposit', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Admin Fee</label>
                <input type="number" min="0" step="any" className={INPUT} placeholder="e.g. 5000"
                  value={form.adminFee} onChange={e => upd('adminFee', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">
                  Ejari Fee {!isResidential && <span className="text-[#9b9890] font-normal">(residential only)</span>}
                </label>
                <input type="number" min="0" step="any" className={INPUT}
                  placeholder={isResidential ? '220' : 'N/A'}
                  disabled={!isResidential}
                  value={form.ejariFeeFils}
                  onChange={e => upd('ejariFeeFils', e.target.value)}
                  style={!isResidential ? { background: '#f4f3ef', color: '#9b9890' } : undefined}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Commission</label>
                <input type="number" min="0" step="any" className={INPUT} placeholder="e.g. 4000"
                  value={form.commission} onChange={e => upd('commission', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3d3b35] mb-1">Service Charges (AED/yr)</label>
              <input type="number" min="0" step="any" className={INPUT} placeholder="e.g. 8000"
                value={form.serviceCharges} onChange={e => upd('serviceCharges', e.target.value)} />
            </div>
          </div>

          {/* Lease Terms — non-residential gets full section; residential gets notice only */}
          <div className="rounded-xl border border-[#dbeafe] bg-[#eff6ff] p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1e40af]">Lease Terms</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Min. Lease (months)</label>
                <input type="number" min="0" step="any" className={INPUT} placeholder="12"
                  value={form.minLeaseMonths} onChange={e => upd('minLeaseMonths', e.target.value)} />
                <p className="text-[10px] text-[#6b82b8] mt-0.5">
                  {propertyCategory === 'venues' ? '0 = per-event' : propertyCategory === 'workspaces' ? '1 = monthly' : '12 = 1 year'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Notice Period (days)</label>
                <input type="number" min="0" step="any" className={INPUT} placeholder="60"
                  value={form.noticePeriodDays} onChange={e => upd('noticePeriodDays', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Rent Escalation (%/yr)</label>
                <input type="number" min="0" max="100" step="0.5" className={INPUT} placeholder="e.g. 5"
                  value={form.rentEscalationPct} onChange={e => upd('rentEscalationPct', e.target.value)} />
                <p className="text-[10px] text-[#6b82b8] mt-0.5">Leave blank = RERA index</p>
              </div>
            </div>
          </div>

          <SectionHeading>Amenities &amp; facilities</SectionHeading>

          {/* Amenities — category-filtered */}
          <div>
            <div className="flex flex-wrap gap-2">
              {amenityList.map(a => (
                <button
                  key={a} type="button"
                  onClick={() => toggleAmenity(a)}
                  className={cn(
                    'px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer transition-colors',
                    form.amenities.includes(a)
                      ? 'border-[#2e9f82] bg-[#d8f2e8] text-[#1a7a5a]'
                      : 'border-[#e8e6e0] text-[#6b6860] hover:border-[#c8c6c0]'
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-[#6b6860]">Unit Description</label>
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                </svg>
                {form.description ? 'Re-generate' : 'Auto-generate'}
              </button>
            </div>
            <textarea
              className={cn(INPUT, 'min-h-[70px] resize-vertical')}
              placeholder="Describe this unit for the listing — features, highlights, unique selling points… or click Auto-generate above."
              value={form.description}
              onChange={e => upd('description', e.target.value)}
            />
          </div>

          <SectionHeading>Media</SectionHeading>

          {/* Floor plan */}
          <div>
            <input
              ref={floorPlanInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={e => { const f = e.target.files?.[0] ?? null; if (f) setFloorPlan(f); e.target.value = ''; }}
            />
            <label className="block text-xs font-medium text-[#6b6860] mb-1.5">
              Floor plan <span className="text-[#9b9890] font-normal">(optional)</span>
            </label>
            {floorPlan ? (
              <div className="flex items-center gap-2 border border-[#e8e6e0] rounded-lg px-3 py-2">
                <Upload size={14} className="text-[#2e9f82] shrink-0" />
                <span className="text-sm text-[#1a1916] truncate flex-1">{floorPlan.name}</span>
                <button type="button" onClick={() => floorPlanInputRef.current?.click()} className="text-xs text-[#2e9f82] font-medium hover:text-[#1f6655] cursor-pointer">Replace</button>
                <button type="button" onClick={() => setFloorPlan(null)} className="w-5 h-5 rounded-full bg-[#f4f3ef] flex items-center justify-center text-[#9b9890] hover:text-[#b91c1c] cursor-pointer"><X size={11} /></button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => floorPlanInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#e8e6e0] rounded-lg py-3 text-xs text-[#9b9890] hover:border-[#2e9f82] hover:bg-[#f0fdf8] transition-colors cursor-pointer"
              >
                <Upload size={15} className="text-[#c8c6c0]" />
                {existingFloorPlanUrl ? 'Replace floor plan (PDF or image)' : 'Attach a floor plan (PDF or image)'}
              </button>
            )}
            {existingFloorPlanUrl && !floorPlan && (
              <a href={existingFloorPlanUrl} target="_blank" rel="noreferrer" className="inline-block mt-1 text-[11px] text-[#2e9f82] hover:underline">
                A floor plan is already attached — view current
              </a>
            )}
          </div>

          {/* Title deed — only for units of multi-unit (non-standalone) properties;
              standalone properties carry one deed on the property form instead. */}
          {propertyStandalone === false && (
            <div>
              <input
                ref={titleDeedInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={e => { const f = e.target.files?.[0] ?? null; if (f) setTitleDeed(f); e.target.value = ''; }}
              />
              <label className="block text-xs font-medium text-[#6b6860] mb-1.5">
                Title deed <span className="text-[#9b9890] font-normal">(this unit)</span>
              </label>
              {titleDeed ? (
                <div className="flex items-center gap-2 border border-[#e8e6e0] rounded-lg px-3 py-2">
                  <Upload size={14} className="text-[#2e9f82] shrink-0" />
                  <span className="text-sm text-[#1a1916] truncate flex-1">{titleDeed.name}</span>
                  <button type="button" onClick={() => titleDeedInputRef.current?.click()} className="text-xs text-[#2e9f82] font-medium hover:text-[#1f6655] cursor-pointer">Replace</button>
                  <button type="button" onClick={() => setTitleDeed(null)} className="w-5 h-5 rounded-full bg-[#f4f3ef] flex items-center justify-center text-[#9b9890] hover:text-[#b91c1c] cursor-pointer"><X size={11} /></button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => titleDeedInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#e8e6e0] rounded-lg py-3 text-xs text-[#9b9890] hover:border-[#2e9f82] hover:bg-[#f0fdf8] transition-colors cursor-pointer"
                >
                  <Upload size={15} className="text-[#c8c6c0]" />
                  Attach this unit&apos;s title deed (PDF or image)
                </button>
              )}
            </div>
          )}

          {/* Photos — manage inside Edit (existing units only) */}
          {propertyId != null && editingUnitId != null && (
            <PhotosSection propertyId={propertyId} unitId={editingUnitId} />
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-[#e8e6e0] text-[#3d3b35] rounded-lg py-2.5 text-sm font-medium cursor-pointer hover:bg-[#f4f3ef]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 text-sm text-white rounded-lg py-2.5 font-medium cursor-pointer disabled:opacity-50"
              style={{ background: '#2e9f82' }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : (title?.startsWith('Edit') ? 'Save Changes' : 'Add Unit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
