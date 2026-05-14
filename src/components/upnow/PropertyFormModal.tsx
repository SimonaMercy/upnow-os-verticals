'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Search, MapPin, CheckCircle2 } from 'lucide-react';
import { MapPicker } from './MapPicker';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api';

// ─── Types from backend location endpoints ────────────────
interface Emirate   { id: number; nameEn: string; }
interface Community { id: number; nameEn: string; }

// ─── Mapbox Geocoding types ───────────────────────────────
interface MapboxContext { id: string; text: string; }
interface MapboxFeature {
  id: string;
  text: string;
  place_name: string;
  geometry: { coordinates: [number, number] };
  properties: { address?: string };
  context?: MapboxContext[];
}
interface SearchResult {
  id: string;
  name: string;         // building / POI name
  label: string;        // full place_name
  lat: number;
  lng: number;
  street: string;
  emirateName: string;
  communityName: string;
  featureType: 'poi' | 'address' | 'area'; // 'area' = neighborhood/locality/district
}

// ─── Building Search component ────────────────────────────
function BuildingSearch({
  onSelect,
  onManualEntry,
}: {
  onSelect: (r: SearchResult) => void;
  onManualEntry?: () => void;
}) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<SearchResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [open,     setOpen]     = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef              = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const runSearch = async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); setSearched(false); return; }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    setLoading(true);
    try {
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
        `?country=ae&types=poi,address,neighborhood,locality,district&language=en&limit=8&proximity=55.2708,25.2048&access_token=${token}`;
      const res  = await fetch(url);
      const data = await res.json() as { features: MapboxFeature[] };
      const parsed: SearchResult[] = (data.features ?? []).map(f => {
        const isArea = f.id.startsWith('neighborhood') || f.id.startsWith('locality') || f.id.startsWith('district');
        const isPoi  = f.id.startsWith('poi');
        return {
          id:            f.id,
          name:          f.text,
          label:         f.place_name,
          lat:           f.geometry.coordinates[1],
          lng:           f.geometry.coordinates[0],
          street:        f.properties.address ?? '',
          emirateName:   f.context?.find(c => c.id.startsWith('region'))?.text ?? '',
          // For neighborhood/locality/district results, area name IS f.text
          // For poi/address, look it up in context
          communityName: isArea
            ? f.text
            : (f.context?.find(c =>
                c.id.startsWith('neighborhood') ||
                c.id.startsWith('locality') ||
                c.id.startsWith('district')
              )?.text ?? ''),
          featureType: isArea ? 'area' : isPoi ? 'poi' : 'address',
        } satisfies SearchResult;
      });
      setResults(parsed);
      setSearched(true);
      setOpen(true);
    } catch {
      setSearched(true);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 350);
  };

  const handlePick = (r: SearchResult) => {
    setQuery(r.name);
    setOpen(false);
    onSelect(r);
  };

  const handleManual = () => {
    setQuery('');
    setOpen(false);
    setSearched(false);
    setResults([]);
    onManualEntry?.();
  };

  const showDropdown = open && !loading && (results.length > 0 || searched);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890] pointer-events-none" />
        <input
          type="text"
          className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-10 py-2.5 text-sm bg-white focus:outline-none focus:border-[#2e9f82] transition-colors"
          placeholder="Type a building name, tower or street…"
          value={query}
          onChange={handleChange}
          onFocus={() => (results.length > 0 || searched) && setOpen(true)}
          autoComplete="off"
        />
        {loading && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#9b9890]" />
        )}
      </div>
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-[#e8e6e0] rounded-xl shadow-xl overflow-hidden">
          {results.length > 0 ? (
            <ul className="max-h-52 overflow-y-auto">
              {results.map(r => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-[#f4f3ef] border-b border-[#f0eeea] last:border-0 transition-colors"
                    onClick={() => handlePick(r)}
                  >
                    <MapPin size={14} className="mt-0.5 text-[#2e9f82] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1a1916] truncate">{r.name}</p>
                      <p className="text-xs text-[#9b9890] leading-tight truncate">{r.label}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-center">
              <p className="text-sm text-[#6b6860]">No results for &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-[#9b9890] mt-0.5">Try a different name or fill in below</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleManual}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium text-[#2e9f82] hover:bg-[#f4f3ef] border-t border-[#e8e6e0] transition-colors cursor-pointer"
          >
            Enter address manually ↓
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Space categories ─────────────────────────────────────
export const SPACE_CATEGORIES = [
  { id: 'residential', label: 'Residential', icon: '🏠', desc: 'Apartments, Villas, Townhouses' },
  { id: 'commercial',  label: 'Commercial',  icon: '🏢', desc: 'Offices, Retail, Warehouses' },
  { id: 'industrial',  label: 'Industrial',  icon: '🏗️', desc: 'Warehouses, Factories' },

];

export interface PropertyFormData {
  buildingName: string;
  spaceCategory: string;
  // Structured location (FK IDs)
  emirateId: number | null;
  communityId: number | null;
  // Display labels (kept for fullAddress composition)
  emirateName: string;
  communityName: string;
  // Free-text
  street: string;
  makaniNumber: string;
  plotNumber: string;
  numberOfFloors: string;
  propertyDescription: string;
  latitude: number | null;
  longitude: number | null;
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  isStandaloneUnit: boolean;
}

const EMPTY: PropertyFormData = {
  buildingName: '', spaceCategory: '',
  emirateId: null, communityId: null,
  emirateName: '', communityName: '',
  street: '', makaniNumber: '', plotNumber: '', numberOfFloors: '',
  propertyDescription: '',
  latitude: null, longitude: null,
  hasGym: false, hasPool: false, hasParking: false, isStandaloneUnit: false,
};

interface Props {
  open: boolean;
  initial?: Partial<PropertyFormData>;
  onClose: () => void;
  onSave: (data: PropertyFormData) => Promise<void>;
  title?: string;
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-xs font-medium text-[#6b6860] mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
  );
}

const INPUT   = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';
const SELECT  = cn(INPUT, 'appearance-none');
const DISABLED_CLS = 'opacity-50 cursor-not-allowed';

export function PropertyFormModal({ open, initial, onClose, onSave, title }: Props) {
  const [form, setForm] = useState<PropertyFormData>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof PropertyFormData, string>>>({});
  const [saving, setSaving] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  // Location data
  const [emirates,     setEmirates]     = useState<Emirate[]>([]);
  const [communities,  setCommunities]  = useState<Community[]>([]);
  const [loadingComms, setLoadingComms] = useState(false);

  // Stores community name from Mapbox to auto-match after emirate cascade loads
  const pendingCommunityRef = useRef<string>('');

  // Load emirates once on mount
  useEffect(() => {
    apiGet<Emirate[]>('/locations/emirates').then(setEmirates).catch(() => {});
  }, []);

  // Reset form when modal opens
  useEffect(() => {
    if (open) { setForm({ ...EMPTY, ...initial }); setAutoFilled(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cascade: emirate → communities (direct, no city step)
  // Also auto-matches community name from a pending Mapbox search result
  useEffect(() => {
    if (!form.emirateId) { setCommunities([]); return; }
    setLoadingComms(true);
    apiGet<Community[]>(`/locations/emirates/${form.emirateId}/communities`)
      .then(comms => {
        setCommunities(comms);
        if (pendingCommunityRef.current) {
          const pending = pendingCommunityRef.current.toLowerCase().trim();
          // Tokenized fuzzy match: score by how many words overlap
          const tokenize = (s: string) => s.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
          const pendingTokens = tokenize(pending);
          let bestScore = 0;
          let bestMatch: Community | null = null;
          for (const c of comms) {
            const dbTokens = tokenize(c.nameEn.toLowerCase());
            const overlap = pendingTokens.filter(t => dbTokens.includes(t)).length;
            const score   = overlap / Math.max(pendingTokens.length, dbTokens.length);
            if (score > bestScore) { bestScore = score; bestMatch = c; }
          }
          // Accept if ≥50% token overlap
          if (bestMatch && bestScore >= 0.5)
            setForm(prev => ({ ...prev, communityId: bestMatch!.id, communityName: bestMatch!.nameEn }));
          pendingCommunityRef.current = '';
        }
      })
      .finally(() => setLoadingComms(false));
  }, [form.emirateId]);

  const upd = <K extends keyof PropertyFormData>(k: K, v: PropertyFormData[K]) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setErrors(prev => ({ ...prev, [k]: undefined }));
  };

  const handleEmirateChange = (val: string) => {
    const em = emirates.find(e => e.id === Number(val));
    setForm(prev => ({
      ...prev,
      emirateId: val ? Number(val) : null, emirateName: em?.nameEn ?? '',
      communityId: null, communityName: '',
    }));
    setErrors(prev => ({ ...prev, emirateId: undefined }));
  };

  const handleCommunityChange = (val: string) => {
    const comm = communities.find(c => c.id === Number(val));
    setForm(prev => ({
      ...prev,
      communityId: val ? Number(val) : null, communityName: comm?.nameEn ?? '',
    }));
  };

  // Handle Mapbox search result — auto-fill as many fields as possible
  const handleSearchSelect = (r: SearchResult) => {
    const matchedEmirate = emirates.find(e => {
      const db = e.nameEn.toLowerCase();
      const mb = r.emirateName.toLowerCase();
      return db === mb || mb.includes(db) || db.includes(mb);
    });
    // Store community name so the cascade effect can match it after loading
    pendingCommunityRef.current = r.communityName;
    setForm(prev => ({
      ...prev,
      // Only set buildingName for POI/address results — not for area/neighborhood picks
      ...(r.featureType !== 'area' && { buildingName: r.name, street: r.street }),
      latitude:      r.lat,
      longitude:     r.lng,
      emirateId:     matchedEmirate?.id ?? null,
      emirateName:   matchedEmirate?.nameEn ?? r.emirateName,
      communityId:   null,
      communityName: '',
    }));
    setAutoFilled(true);
    setErrors(prev => ({ ...prev, buildingName: undefined, emirateId: undefined }));
  };

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!form.buildingName.trim()) errs.buildingName = 'Required';
    if (!form.spaceCategory)       errs.spaceCategory = 'Required';
    if (!form.emirateId)           errs.emirateId = 'Required';
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-10 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white rounded-t-2xl flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0] z-10">
          <div>
            <h3 className="font-semibold text-lg text-[#1a1916]">{title ?? 'Add Property'}</h3>
            <p className="text-xs text-[#9b9890] mt-0.5">Add once — then add units to it anytime</p>
          </div>
          <button onClick={onClose} className="cursor-pointer text-[#6b6860] hover:text-[#1a1916]"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* Step 1 — Property Type */}
          <div>
            <FieldLabel label="Property Type" required />
            <div className="flex flex-wrap gap-2">
              {SPACE_CATEGORIES.map(cat => (
                <button key={cat.id} type="button" onClick={() => upd('spaceCategory', cat.id)}
                  className={cn(
                    'flex flex-col items-start gap-0.5 px-4 py-3 rounded-xl border text-left cursor-pointer transition-colors flex-1 min-w-[120px]',
                    form.spaceCategory === cat.id
                      ? 'border-[#2e9f82] bg-[#d8f2e8] text-[#1a7a5a]'
                      : 'border-[#e8e6e0] bg-white text-[#3d3b35] hover:border-[#c8c6c0]'
                  )}
                >
                  <span className="text-xl">{cat.icon}</span>
                  <span className="text-xs font-semibold">{cat.label}</span>
                  <span className="text-[10px] opacity-70">{cat.desc}</span>
                </button>
              ))}
            </div>
            {errors.spaceCategory && <p className="text-xs text-red-500 mt-1">{errors.spaceCategory}</p>}
          </div>

          {/* Step 2 — Mapbox search + map pin (shown after type selected) */}
          {form.spaceCategory && (
            <div>
              <FieldLabel label="Search building / address" />
              {autoFilled && (
                <div className="flex items-center gap-2 text-xs text-[#1a7a5a] bg-[#d8f2e8] rounded-lg px-3 py-2 mb-2">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>
                    Location set
                    {form.communityName ? ` · ${form.communityName}` : ''}
                    {form.emirateName   ? `, ${form.emirateName}` : ''}
                    {' '}— review and adjust below
                  </span>
                </div>
              )}
              <BuildingSearch onSelect={handleSearchSelect} onManualEntry={() => setAutoFilled(false)} />
              <p className="text-[10px] text-[#9b9890] mt-1">Powered by Mapbox · UAE buildings &amp; addresses</p>
            </div>
          )}

          {/* Map pin — always visible so user can see/drag location */}
          <div>
            <FieldLabel label="Pin Location on Map" />
            <MapPicker
              latitude={form.latitude} longitude={form.longitude}
              onChange={(lat, lng) => { upd('latitude', lat); upd('longitude', lng); }}
            />
          </div>

          {/* Divider between search and manual fields */}
          {form.spaceCategory && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#e8e6e0]" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-[10px] font-medium text-[#9b9890] uppercase tracking-wider">
                  Property details
                </span>
              </div>
            </div>
          )}

          {/* Property Name */}
          <div>
            <FieldLabel label="Property / Building Name" required />
            <input
              className={cn(INPUT, errors.buildingName && 'border-red-400')}
              placeholder="e.g. Al Safa Tower, Palm Residences"
              value={form.buildingName}
              onChange={e => upd('buildingName', e.target.value)}
            />
            {errors.buildingName && <p className="text-xs text-red-500 mt-1">{errors.buildingName}</p>}
          </div>

          {/* Emirate + Community */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="Emirate" required />
              <select
                className={cn(SELECT, errors.emirateId && 'border-red-400')}
                value={form.emirateId ?? ''}
                onChange={e => handleEmirateChange(e.target.value)}
              >
                <option value="">Select Emirate</option>
                {emirates.map(em => <option key={em.id} value={em.id}>{em.nameEn}</option>)}
              </select>
              {errors.emirateId && <p className="text-xs text-red-500 mt-1">{errors.emirateId}</p>}
            </div>
            <div>
              <FieldLabel label="Community / Area" />
              <select
                className={cn(SELECT, (!form.emirateId || loadingComms) && DISABLED_CLS)}
                value={form.communityId ?? ''}
                onChange={e => handleCommunityChange(e.target.value)}
                disabled={!form.emirateId || loadingComms}
              >
                <option value="">{loadingComms ? 'Loading…' : form.emirateId ? 'Select Community' : 'Select Emirate first'}</option>
                {communities.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
              </select>
            </div>
          </div>

          {/* Street + Floors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="Street" />
              <input className={INPUT} placeholder="e.g. Sheikh Zayed Road" value={form.street}
                onChange={e => upd('street', e.target.value)} />
            </div>
            <div>
              <FieldLabel label="Number of Floors" />
              <input className={INPUT} placeholder="e.g. 12" value={form.numberOfFloors}
                onChange={e => upd('numberOfFloors', e.target.value)} />
            </div>
          </div>

          {/* Makani + Plot */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="Makani Number" />
              <input className={INPUT} placeholder="10-digit code" maxLength={10} value={form.makaniNumber}
                onChange={e => upd('makaniNumber', e.target.value.replace(/\D/g, ''))} />
              <p className="text-[10px] text-[#9b9890] mt-1">Dubai's 10-digit address code</p>
            </div>
            <div>
              <FieldLabel label="Plot Number" />
              <input className={INPUT} placeholder="e.g. PLOT-12345" value={form.plotNumber}
                onChange={e => upd('plotNumber', e.target.value)} />
            </div>
          </div>

          {/* Amenities */}
          <div>
            <FieldLabel label="Property Amenities" />
            <div className="flex gap-4 flex-wrap">
              {([
                { key: 'hasGym'     as const, label: '🏋️ Gym'     },
                { key: 'hasPool'    as const, label: '🏊 Pool'    },
                { key: 'hasParking' as const, label: '🅿️ Parking' },
              ] as const).map(a => (
                <label key={a.key} className="flex items-center gap-2 cursor-pointer text-sm text-[#3d3b35]">
                  <input type="checkbox" checked={form[a.key]}
                    onChange={e => upd(a.key, e.target.checked)}
                    className="w-4 h-4 rounded accent-[#2e9f82]" />
                  {a.label}
                </label>
              ))}
            </div>
          </div>

          {/* Standalone unit toggle */}
          <label className="flex items-start gap-3 p-3 rounded-xl border border-[#e8e6e0] cursor-pointer hover:bg-[#f4f3ef]">
            <input
              type="checkbox"
              checked={form.isStandaloneUnit}
              onChange={e => upd('isStandaloneUnit', e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-[#2e9f82] shrink-0"
            />
            <div>
              <div className="text-sm font-medium text-[#1a1916]">This property is a standalone unit</div>
              <div className="text-xs text-[#9b9890] mt-0.5">For villas, townhouses, or any property where the property itself is the rentable unit. No sub-units needed.</div>
            </div>
          </label>

          {/* Description */}
          <div>
            <FieldLabel label="Description" />
            <textarea className={cn(INPUT, 'min-h-[70px] resize-vertical')}
              placeholder="Brief description for tenants…" value={form.propertyDescription}
              onChange={e => upd('propertyDescription', e.target.value)} />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-[#e8e6e0] text-[#3d3b35] rounded-lg py-2.5 text-sm font-medium cursor-pointer hover:bg-[#f4f3ef]">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 text-sm text-white rounded-lg py-2.5 font-medium cursor-pointer disabled:opacity-50"
              style={{ background: '#2e9f82' }}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : title?.startsWith('Edit') ? 'Save Changes' : 'Add Property'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
