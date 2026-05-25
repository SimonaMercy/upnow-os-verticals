'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Lookup data ──────────────────────────────────────────
export const RESIDENTIAL_UNIT_TYPES = ['apartment', 'villa', 'townhouse', 'penthouse', 'studio', 'duplex_loft'];
export const COMMERCIAL_UNIT_TYPES  = ['office_fitted', 'office_shell_core', 'retail_shop', 'showroom', 'restaurant_fnb', 'clinic_medical'];
export const INDUSTRIAL_UNIT_TYPES  = ['warehouse', 'open_yard', 'storage_unit', 'cold_storage', 'logistics_facility'];

const UNIT_TYPE_LABELS: Record<string, string> = {
  apartment: 'Apartment', villa: 'Villa', townhouse: 'Townhouse', penthouse: 'Penthouse',
  studio: 'Studio', duplex_loft: 'Duplex / Loft',
  office_fitted: 'Office (Fitted)', office_shell_core: 'Office (Shell & Core)',
  retail_shop: 'Retail Shop', showroom: 'Showroom',
  restaurant_fnb: 'Restaurant / F&B', clinic_medical: 'Clinic / Medical',
  warehouse: 'Warehouse', open_yard: 'Open Yard', storage_unit: 'Storage Unit',
  cold_storage: 'Cold Storage', logistics_facility: 'Logistics Facility',
};

function unitTypesForCategory(category: string): string[] {
  switch (category) {
    case 'residential': return RESIDENTIAL_UNIT_TYPES;
    case 'commercial':  return COMMERCIAL_UNIT_TYPES;
    case 'industrial':  return INDUSTRIAL_UNIT_TYPES;
    default:            return [...RESIDENTIAL_UNIT_TYPES, ...COMMERCIAL_UNIT_TYPES];
  }
}

export const AMENITIES = [
  'Central A/C', 'Parking', 'Swimming Pool', 'Gym', 'Security', 'CCTV',
  'Balcony', 'Elevator', 'Concierge', 'Playground', "Maid's Room", 'Storage',
  'Built-in Wardrobes', 'Shared Pool', 'Covered Parking', 'Pet Friendly',
  'High-Speed Internet', 'Smart Home', '24/7 Security', 'Kids Play Area',
];

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

export interface UnitFormData {
  unitNumber: string;
  unitName: string;
  unitType: string;
  unitTier: string;
  floor: string;
  bedrooms: string;
  bathrooms: string;
  unitSizeSqft: string;
  view: string;
  furnishing: string;
  amenities: string[];
  rentalPrice: string;
  securityDeposit: string;
  adminFee: string;
  ejariFeeFils: string;
  commission: string;
  serviceCharges: string;
  description: string;
}

/**
 * Compose a sensible listing description from the unit's structured fields.
 * Used by the "Generate" button on the Description input — RPs can edit
 * freely afterwards, but this gives them a non-blank starting point that
 * matches the data they already filled in.
 */
function composeUnitDescription(d: UnitFormData, propertyCategory: string): string {
  const typeLabel = d.unitType ? d.unitType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null;
  const isResidential = RESIDENTIAL_UNIT_TYPES.includes(d.unitType);
  const isCommercial  = COMMERCIAL_UNIT_TYPES.includes(d.unitType);
  const isIndustrial  = INDUSTRIAL_UNIT_TYPES.includes(d.unitType);

  // Headline: tier + bedroom count (residential) OR just the type
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
  } else {
    headline = `${tierPrefix}${typeLabel?.toLowerCase() ?? propertyCategory.toLowerCase() + ' unit'}`;
  }
  headline = headline.charAt(0).toUpperCase() + headline.slice(1);

  // First sentence: location/size details
  const sentenceBits: string[] = [];
  if (d.floor) sentenceBits.push(`located on the ${ordinal(d.floor)} floor`);
  if (d.unitSizeSqft) sentenceBits.push(`spanning ${Number(d.unitSizeSqft).toLocaleString('en-AE')} sqft`);
  if (isResidential && d.bathrooms) {
    const bathLabel = Number(d.bathrooms) === 1 ? '1 bathroom' : `${d.bathrooms} bathrooms`;
    sentenceBits.push(`with ${bathLabel}`);
  }
  const sentence1 = sentenceBits.length
    ? `${headline}${sentenceBits.length ? ', ' + sentenceBits.join(', ') : ''}.`
    : `${headline}.`;

  // Second sentence: view + furnishing
  const sentence2Bits: string[] = [];
  if (d.view) sentence2Bits.push(`Enjoys a ${d.view.toLowerCase()}`);
  if (isResidential && d.furnishing && d.furnishing !== 'Unfurnished') {
    const furnLabel = d.furnishing.toLowerCase();
    sentence2Bits.push(sentence2Bits.length ? `comes ${furnLabel}` : `Comes ${furnLabel}`);
  }
  const sentence2 = sentence2Bits.length ? sentence2Bits.join(' and ') + '.' : '';

  // Third sentence: amenities (top 6)
  const topAmenities = d.amenities.slice(0, 6);
  const sentence3 = topAmenities.length
    ? `Amenities include ${topAmenities.join(', ').toLowerCase()}.`
    : '';

  return [sentence1, sentence2, sentence3].filter(Boolean).join(' ').trim();
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
  floor: '', bedrooms: '1', bathrooms: '1', unitSizeSqft: '', view: '',
  furnishing: 'Unfurnished', amenities: [], rentalPrice: '',
  securityDeposit: '', adminFee: '', ejariFeeFils: '', commission: '',
  serviceCharges: '', description: '',
};

interface Props {
  open: boolean;
  propertyCategory: string;
  initial?: Partial<UnitFormData>;
  onClose: () => void;
  onSave: (data: UnitFormData) => Promise<void>;
  title?: string;
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

export function UnitFormModal({ open, propertyCategory, initial, onClose, onSave, title }: Props) {
  const [form, setForm] = useState<UnitFormData>({ ...EMPTY_UNIT, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof UnitFormData, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setForm({ ...EMPTY_UNIT, ...initial }); setErrors({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const upd = <K extends keyof UnitFormData>(k: K, v: UnitFormData[K]) => {
    setForm(prev => {
      const next = { ...prev, [k]: v };
      if (k === 'rentalPrice') {
        const rent = Number(v);
        if (!isNaN(rent) && rent > 0) {
          next.securityDeposit = String(Math.round(rent * 0.05));
          next.adminFee        = String(Math.round(rent * 0.05));
          next.ejariFeeFils    = '220';
          next.commission      = String(Math.round(rent * 0.05));
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
    if (!form.unitSizeSqft)      errs.unitSizeSqft = 'Required';
    if (!form.rentalPrice)       errs.rentalPrice  = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try { await onSave(form); onClose(); }
    finally { setSaving(false); }
  };

  const unitTypes   = unitTypesForCategory(propertyCategory);
  const showBedBath = ['residential', ''].includes(propertyCategory) ||
    RESIDENTIAL_UNIT_TYPES.includes(form.unitType);

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

          {/* Unit Type + Unit Number + Floor */}
          <div className="grid grid-cols-3 gap-3">
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
          </div>

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

          {/* Size + Annual Rent */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Size (sq.ft) <span className="text-red-500">*</span></label>
              <input
                type="number" min="0"
                className={errors.unitSizeSqft ? INPUT_ERR : INPUT}
                placeholder="e.g. 1200"
                value={form.unitSizeSqft}
                onChange={e => upd('unitSizeSqft', e.target.value)}
              />
              {errors.unitSizeSqft && <p className="text-[10px] text-red-500 mt-0.5">{errors.unitSizeSqft}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Annual Rent (AED) <span className="text-red-500">*</span></label>
              <input
                type="number" min="0"
                className={errors.rentalPrice ? INPUT_ERR : INPUT}
                placeholder="e.g. 85000"
                value={form.rentalPrice}
                onChange={e => upd('rentalPrice', e.target.value)}
              />
              {errors.rentalPrice && <p className="text-[10px] text-red-500 mt-0.5">{errors.rentalPrice}</p>}
            </div>
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
                <input type="number" min="0" className={INPUT} placeholder="e.g. 10000"
                  value={form.securityDeposit} onChange={e => upd('securityDeposit', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Admin Fee</label>
                <input type="number" min="0" className={INPUT} placeholder="e.g. 5000"
                  value={form.adminFee} onChange={e => upd('adminFee', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Ejari Fee</label>
                <input type="number" min="0" className={INPUT} placeholder="220"
                  value={form.ejariFeeFils} onChange={e => upd('ejariFeeFils', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Commission</label>
                <input type="number" min="0" className={INPUT} placeholder="e.g. 4000"
                  value={form.commission} onChange={e => upd('commission', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3d3b35] mb-1">Service Charges (AED/yr)</label>
              <input type="number" min="0" className={INPUT} placeholder="e.g. 8000"
                value={form.serviceCharges} onChange={e => upd('serviceCharges', e.target.value)} />
            </div>
          </div>

          {/* Amenities */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-2">Amenities</label>
            <div className="flex flex-wrap gap-2">
              {AMENITIES.map(a => (
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

          {/* Description — with auto-generate from selected fields */}
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
              placeholder="Describe this unit for the listing — features, highlights, unique selling points… or click Auto-generate above to compose from the selected fields."
              value={form.description}
              onChange={e => upd('description', e.target.value)}
            />
            <p className="text-[10px] text-[#9b9890] mt-1">
              Tip: fill in unit type, beds/baths, view, furnishing, and amenities first, then auto-generate for a sharper draft.
            </p>
          </div>

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
