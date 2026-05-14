'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Lookup data ──────────────────────────────────────────
export const RESIDENTIAL_UNIT_TYPES = ['apartment', 'villa', 'townhouse', 'penthouse', 'studio', 'duplex_loft'];
export const COMMERCIAL_UNIT_TYPES = ['office_fitted', 'office_shell_core', 'retail_shop', 'showroom', 'restaurant_fnb', 'clinic_medical'];
export const INDUSTRIAL_UNIT_TYPES = ['warehouse', 'open_yard', 'storage_unit', 'cold_storage', 'logistics_facility'];


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
  'Balcony', 'Elevator', 'Concierge', 'Playground', "Maid's Room", 'Storage",',
  'Built-in Wardrobes', 'Shared Pool', 'Covered Parking', 'Pet Friendly',
  'High-Speed Internet', 'Smart Home', '24/7 Security', 'Kids Play Area',
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
  serviceCharges: string;
  description: string;
}

const EMPTY_UNIT: UnitFormData = {
  unitNumber: '', unitName: '', unitType: '', unitTier: 'standard',
  floor: '', bedrooms: '1', bathrooms: '1', unitSizeSqft: '', view: '',
  furnishing: 'Unfurnished', amenities: [], rentalPrice: '', serviceCharges: '', description: '',
};

interface Props {
  open: boolean;
  propertyCategory: string;
  initial?: Partial<UnitFormData>;
  onClose: () => void;
  onSave: (data: UnitFormData) => Promise<void>;
  title?: string;
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-xs font-medium text-[#6b6860] mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
  );
}

const INPUT = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';

export function UnitFormModal({ open, propertyCategory, initial, onClose, onSave, title }: Props) {
  const [form, setForm] = useState<UnitFormData>({ ...EMPTY_UNIT, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof UnitFormData, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ ...EMPTY_UNIT, ...initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const upd = <K extends keyof UnitFormData>(k: K, v: UnitFormData[K]) => {
    setForm(prev => ({ ...prev, [k]: v }));
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
    if (!form.unitNumber.trim()) errs.unitNumber = 'Required';
    if (!form.unitType) errs.unitType = 'Required';
    if (!form.unitSizeSqft) errs.unitSizeSqft = 'Required';
    if (!form.rentalPrice) errs.rentalPrice = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const unitTypes = unitTypesForCategory(propertyCategory);
  const showBedBath = ['residential', ''].includes(propertyCategory) ||
    ['apartment', 'villa', 'townhouse', 'penthouse', 'studio', 'duplex_loft'].includes(form.unitType);

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

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Unit Number + Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="Unit Number" required />
              <input
                className={cn(INPUT, errors.unitNumber && 'border-red-400')}
                placeholder="e.g. 101, G-02"
                value={form.unitNumber}
                onChange={e => upd('unitNumber', e.target.value)}
              />
              {errors.unitNumber && <p className="text-xs text-red-500 mt-1">{errors.unitNumber}</p>}
            </div>
            <div>
              <FieldLabel label="Title" />
              <input
                className={INPUT}
                placeholder="Optional display name"
                value={form.unitName}
                onChange={e => upd('unitName', e.target.value)}
              />
            </div>
          </div>

          {/* Unit Type + Tier */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="Unit Type" required />
              <select
                className={cn(INPUT, 'appearance-none', errors.unitType && 'border-red-400')}
                value={form.unitType}
                onChange={e => upd('unitType', e.target.value)}
              >
                <option value="">Select type</option>
                {unitTypes.map(t => (
                  <option key={t} value={t}>{UNIT_TYPE_LABELS[t] ?? t}</option>
                ))}
              </select>
              {errors.unitType && <p className="text-xs text-red-500 mt-1">{errors.unitType}</p>}
            </div>
            <div>
              <FieldLabel label="Tier" />
              <div className="flex gap-2">
                {UNIT_TIERS.map(t => (
                  <button
                    key={t.id} type="button"
                    onClick={() => upd('unitTier', t.id)}
                    className={cn(
                      'flex-1 py-2 rounded-lg border text-xs font-medium cursor-pointer transition-colors',
                      form.unitTier === t.id
                        ? 'border-[#2e9f82] bg-[#d8f2e8] text-[#1a7a5a]'
                        : 'border-[#e8e6e0] text-[#6b6860] hover:border-[#c8c6c0]'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Floor + Size */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="Floor" />
              <input
                className={INPUT}
                placeholder="e.g. G, 1, 2…"
                value={form.floor}
                onChange={e => upd('floor', e.target.value)}
              />
            </div>
            <div>
              <FieldLabel label="Size (sq.ft)" required />
              <input
                type="number"
                min="0"
                className={cn(INPUT, errors.unitSizeSqft && 'border-red-400')}
                placeholder="e.g. 1200"
                value={form.unitSizeSqft}
                onChange={e => upd('unitSizeSqft', e.target.value)}
              />
              {errors.unitSizeSqft && <p className="text-xs text-red-500 mt-1">{errors.unitSizeSqft}</p>}
            </div>
          </div>

          {/* Bed / Bath — only for residential */}
          {showBedBath && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <FieldLabel label="Bedrooms" />
                <select className={cn(INPUT, 'appearance-none')} value={form.bedrooms} onChange={e => upd('bedrooms', e.target.value)}>
                  {['Studio', '1', '2', '3', '4', '5', '6+'].map(b => (
                    <option key={b} value={b}>{b === 'Studio' ? 'Studio' : `${b} BR`}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel label="Bathrooms" />
                <select className={cn(INPUT, 'appearance-none')} value={form.bathrooms} onChange={e => upd('bathrooms', e.target.value)}>
                  {['1', '2', '3', '4', '5+'].map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel label="Furnishing" />
                <select className={cn(INPUT, 'appearance-none')} value={form.furnishing} onChange={e => upd('furnishing', e.target.value)}>
                  {FURNISHING_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* View */}
          <div>
            <FieldLabel label="View" />
            <input
              className={INPUT}
              placeholder="e.g. Sea View, Burj Khalifa View, Garden View"
              value={form.view}
              onChange={e => upd('view', e.target.value)}
            />
          </div>

          {/* Annual Rent + Service Charges */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="Annual Rent (AED)" required />
              <input
                type="number"
                min="0"
                className={cn(INPUT, errors.rentalPrice && 'border-red-400')}
                placeholder="e.g. 85000"
                value={form.rentalPrice}
                onChange={e => upd('rentalPrice', e.target.value)}
              />
              {errors.rentalPrice && <p className="text-xs text-red-500 mt-1">{errors.rentalPrice}</p>}
            </div>
            <div>
              <FieldLabel label="Service Charges (AED/yr)" />
              <input
                type="number"
                min="0"
                className={INPUT}
                placeholder="e.g. 8000"
                value={form.serviceCharges}
                onChange={e => upd('serviceCharges', e.target.value)}
              />
            </div>
          </div>

          {/* Amenities */}
          <div>
            <FieldLabel label="Amenities" />
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

          {/* Description */}
          <div>
            <FieldLabel label="Unit Description" />
            <textarea
              className={cn(INPUT, 'min-h-[60px] resize-vertical')}
              placeholder="Additional details for this unit…"
              value={form.description}
              onChange={e => upd('description', e.target.value)}
            />
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
