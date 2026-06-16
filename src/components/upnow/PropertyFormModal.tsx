'use client';

import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { X, Loader2, Search, MapPin, CheckCircle2, Database, Upload, Trash2, FileText, Check } from 'lucide-react';
import { MapPicker } from './MapPicker';
import { cn } from '@/lib/utils';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { PROPERTY_DOC_SLOTS, docBelongsToSlot, isExtraSlotDoc } from '@/lib/propertyDocs';
import { DocPreviewModal } from './DocPreviewModal';
import { PropertyPhotos } from './PropertyPhotos';

// ─── Types from backend location endpoints ────────────────
interface Country      { id: number; nameEn: string; code: string; }
interface Emirate      { id: number; nameEn: string; }
interface City         { id: number; nameEn: string; }
interface Community    { id: number; nameEn: string; }
interface SubCommunity { id: number; nameEn: string; }

// ─── Google Places types ──────────────────────────────────
interface GPlacePrediction {
  placeId: string;
  main: string;
  secondary: string;
  types: string[];
}

// ─── Local (system) suggestion shape ─────────────────────
export interface LocalSuggestion {
  id: string;
  name: string;
  label: string;
  lat: number | null;
  lng: number | null;
  emirateId?: number | null;
  communityId?: number | null;
  emirateName?: string;
  communityName?: string;
}

// ─── Module-level caches (survive re-renders, cheap) ─────
const _acCache  = new Map<string, GPlacePrediction[]>();
const _detCache = new Map<string, Omit<SearchResult, 'featureType' | 'id'>>();

export function clearBuildingSearchCache() {
  // 1. In-memory module caches
  _acCache.clear();
  _detCache.clear();

  // 2. sessionStorage entries written by this module
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('gp:ac:'))
      .forEach(k => sessionStorage.removeItem(k));
  } catch { /* ignore */ }

  // 3. localStorage entries (same prefixes, defensive sweep)
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('gp:ac:'))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }

  // 4. Service Worker / Cache API entries (if any registered)
  if (typeof caches !== 'undefined') {
    caches.keys().then(names => names.forEach(n => caches.delete(n))).catch(() => {});
  }

  console.log('[BuildingSearch] all caches cleared');
}

// Expose in dev so it's callable from browser console: window.__clearBuildingCache()
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>)['__clearBuildingCache'] = clearBuildingSearchCache;
}

function getAcCache(key: string): GPlacePrediction[] | null {
  if (_acCache.has(key)) return _acCache.get(key)!;
  try {
    const v = sessionStorage.getItem('gp:ac:' + key);
    if (v) { const p = JSON.parse(v) as GPlacePrediction[]; _acCache.set(key, p); return p; }
  } catch { /* ignore */ }
  return null;
}

function setAcCache(key: string, val: GPlacePrediction[]) {
  _acCache.set(key, val);
  try { sessionStorage.setItem('gp:ac:' + key, JSON.stringify(val)); } catch { /* ignore */ }
}

interface SearchResult {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  street: string;
  emirateName: string;
  communityName: string;
  featureType: 'poi' | 'address' | 'area';
  // Present when result comes from building_cache — use directly, skip name-matching
  emirateId?: number | null;
  communityId?: number | null;
  googlePlaceId?: string | null;
}

// Shape returned by GET /building-cache/lookup
interface BuildingCacheResult {
  id: number;
  name: string;
  fullAddress: string | null;
  emirateId: number | null;
  communityId: number | null;
  latitude: string | null;
  longitude: string | null;
  googlePlaceId: string | null;
}

// ─── Shared: fetch place details via backend proxy ───
async function fetchGooglePlaceDetails(placeId: string): Promise<Omit<SearchResult, 'featureType' | 'id'> | null> {
  if (_detCache.has(placeId)) return _detCache.get(placeId)!;
  try {
    const p = await apiGet<Record<string, unknown>>(`/places/details/${encodeURIComponent(placeId)}`);
    type AC = { types: string[]; longText: string };
    const comps: AC[] = (p.addressComponents as AC[]) ?? [];
    const comp = (type: string) => comps.find(c => c.types.includes(type))?.longText ?? '';

    // Street = route name, optionally prefixed with street_number if not already included
    const streetNum  = comp('street_number');
    const routeName  = comp('route');
    const street     = routeName
      ? (streetNum && !routeName.toLowerCase().includes(streetNum.toLowerCase())
          ? `${streetNum} ${routeName}`
          : routeName)
      : streetNum;

    // Emirate = administrative_area_level_1 (always present for UAE in Places API)
    const emirateName = comp('administrative_area_level_1');

    // Community = most specific neighborhood/sub-locality available
    const communityName =
      comp('neighborhood') ||
      comp('sublocality_level_2') ||
      comp('sublocality_level_1') ||
      comp('sublocality') ||
      comp('administrative_area_level_3') ||
      comp('administrative_area_level_4');

    const loc = p.location as { latitude?: number; longitude?: number } | undefined;
    const detail = {
      name:    (p.displayName as { text?: string } | undefined)?.text ?? '',
      label:   (p.formattedAddress as string | undefined) ?? '',
      lat:     loc?.latitude  ?? 0,
      lng:     loc?.longitude ?? 0,
      street,
      emirateName,
      communityName,
    };
    _detCache.set(placeId, detail);
    return detail;
  } catch { return null; }
}

// ─── Building Search component ────────────────────────────
export type { SearchResult };
// Stable default so the re-open effect below doesn't fire on every render
// (a fresh [] default changes identity each render).
const NO_LOCAL_SUGGESTIONS: LocalSuggestion[] = [];

export function BuildingSearch({
  onSelect,
  onManualEntry,
  onQueryChange,
  localSuggestions = NO_LOCAL_SUGGESTIONS,
}: {
  onSelect: (r: SearchResult) => void;
  onManualEntry?: () => void;
  onQueryChange?: (q: string) => void;
  localSuggestions?: LocalSuggestion[];
}) {
  const [query,        setQuery]        = useState('');
  const [suggestions,  setSuggestions]  = useState<GPlacePrediction[]>([]);
  const [cacheResults, setCacheResults] = useState<BuildingCacheResult[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [picking,      setPicking]      = useState(false);
  const [open,         setOpen]         = useState(false);
  const [searched,     setSearched]     = useState(false);
  const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef                      = useRef<HTMLDivElement>(null);
  // True only while the user is actively typing — a selection turns it off so
  // parent re-renders (form auto-fill) can't re-open the dropdown after a pick.
  const typingRef                       = useRef(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const runSearch = async (q: string, local: LocalSuggestion[]) => {
    if (q.length < 2) { setSuggestions([]); setCacheResults([]); setOpen(false); setSearched(false); return; }

    // 1. Backend building_cache — DB always wins over any client-side memory
    try {
      const hits = await apiGet<BuildingCacheResult[]>(`/building-cache/lookup?q=${encodeURIComponent(q)}`);
      if (hits.length > 0) {
        setCacheResults(hits);
        setSuggestions([]);  // clear any stale Google results
        setSearched(true);
        setOpen(true);
        return; // skip Google entirely — we have our own data
      }
    } catch { /* non-critical — fall through */ }

    // 2. Client-side memory cache for Google results — zero cost
    const cached = getAcCache(q);
    if (cached) { setSuggestions(cached); setSearched(true); setOpen(true); return; }

    // 3. Enough local (RP's own) results — skip Google entirely
    if (local.length >= 3) { setSearched(true); setOpen(true); return; }

    setLoading(true);
    try {
      type AcItem = { placePrediction: { placeId: string; structuredFormat: { mainText: { text: string }; secondaryText?: { text: string } }; types?: string[] } };
      const data = await apiPost<{ suggestions?: AcItem[] }>('/places/autocomplete', { input: q });
      const parsed = (data.suggestions ?? []).map((s) => ({
        placeId:   s.placePrediction.placeId,
        main:      s.placePrediction.structuredFormat.mainText.text,
        secondary: s.placePrediction.structuredFormat.secondaryText?.text ?? '',
        types:     s.placePrediction.types ?? [],
      }));
      setSuggestions(parsed);
      setAcCache(q, parsed);   // store so next time is free
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
    typingRef.current = true;
    setQuery(val);
    onQueryChange?.(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val, localSuggestions), 350);
  };

  // Re-open when parent updates localSuggestions (e.g. existingProps loaded
  // async) — but only mid-typing, never after the user picked a result.
  useEffect(() => {
    if (typingRef.current && query.length >= 2) setOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSuggestions]);

  // Clear cache results when query is cleared
  useEffect(() => {
    if (query.length < 2) setCacheResults([]);
  }, [query]);

  const handlePickCache = (hit: BuildingCacheResult) => {
    typingRef.current = false;
    setOpen(false);
    setQuery(hit.name);
    onQueryChange?.(hit.name);
    onSelect({
      id:            `cache_${hit.id}`,
      name:          hit.name,
      label:         hit.fullAddress ?? '',
      lat:           hit.latitude  != null ? Number(hit.latitude)  : 0,
      lng:           hit.longitude != null ? Number(hit.longitude) : 0,
      street:        '',
      emirateName:   '',
      communityName: '',
      featureType:   'poi',
      emirateId:     hit.emirateId,
      communityId:   hit.communityId,
      googlePlaceId: hit.googlePlaceId,
    });
  };

  const handlePickLocal = (s: LocalSuggestion) => {
    typingRef.current = false;
    setOpen(false);
    setQuery(s.name);
    onQueryChange?.(s.name);
    onSelect({
      id:            `local_${s.id}`,
      name:          s.name,
      label:         s.label,
      lat:           s.lat ?? 0,
      lng:           s.lng ?? 0,
      street:        '',
      emirateName:   s.emirateName ?? '',
      communityName: s.communityName ?? '',
      featureType:   'poi',
      emirateId:     s.emirateId  ?? null,
      communityId:   s.communityId ?? null,
    });
  };

  const handlePickGoogle = async (s: GPlacePrediction) => {
    typingRef.current = false;
    setOpen(false);
    setQuery(s.main);
    setPicking(true);
    const detail = await fetchGooglePlaceDetails(s.placeId);
    setPicking(false);
    if (!detail) return;
    const isArea = s.types.some(t =>
      ['neighborhood', 'sublocality', 'locality', 'political'].includes(t)
    ) && !s.types.includes('establishment');
    onSelect({
      id: s.placeId,
      ...detail,
      featureType: isArea ? 'area' : s.types.includes('establishment') ? 'poi' : 'address',
    });
  };

  const handleManual = () => {
    typingRef.current = false;
    setQuery(''); setOpen(false); setSearched(false); setSuggestions([]); setCacheResults([]);
    onQueryChange?.('');
    onManualEntry?.();
  };

  const hasLocal  = localSuggestions.length > 0;
  const hasCache  = cacheResults.length > 0;
  const hasGoogle = suggestions.length > 0;
  const showDropdown = open && !loading && (hasLocal || hasCache || hasGoogle || searched);

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
          onFocus={() => (hasLocal || hasGoogle || searched) && setOpen(true)}
          autoComplete="off"
        />
        {(loading || picking) && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#9b9890]" />
        )}
      </div>
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-[#e8e6e0] rounded-xl shadow-xl overflow-hidden">
          <ul className="max-h-60 overflow-y-auto">

            {/* ── Local (system) results ── */}
            {hasLocal && (
              <>
                <li className="px-3 py-1.5 bg-[#f4f3ef]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890]">From your system</span>
                </li>
                {localSuggestions.map(s => (
                  <li key={`local_${s.id}`}>
                    <button
                      type="button"
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-[#f0fdf8] border-b border-[#f0eeea] last:border-0 transition-colors"
                      onClick={() => handlePickLocal(s)}
                    >
                      <MapPin size={14} className="mt-0.5 text-[#2e9f82] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1a1916] truncate">{s.name}</p>
                        <p className="text-xs text-[#9b9890] leading-tight truncate">{s.label || 'No address stored'}</p>
                      </div>
                      <span className="ml-auto text-[9px] font-semibold text-[#2e9f82] bg-[#d8f2e8] px-1.5 py-0.5 rounded-full shrink-0 self-center">Saved</span>
                    </button>
                  </li>
                ))}
              </>
            )}

            {/* ── UpNow Database results ── */}
            {hasCache && (
              <>
                <li className="px-3 py-1.5 bg-[#f4f3ef] flex items-center gap-1.5">
                  <Database size={10} className="text-[#2e9f82]" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890]">UpNow Database</span>
                </li>
                {cacheResults.map(hit => (
                  <li key={`cache_${hit.id}`}>
                    <button
                      type="button"
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-[#f0fdf8] border-b border-[#f0eeea] last:border-0 transition-colors"
                      onClick={() => handlePickCache(hit)}
                    >
                      <MapPin size={14} className="mt-0.5 text-[#2e9f82] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1a1916] truncate">{hit.name}</p>
                        <p className="text-xs text-[#9b9890] leading-tight truncate">{hit.fullAddress || 'No address stored'}</p>
                      </div>
                      <span className="ml-auto text-[9px] font-semibold text-[#2e9f82] bg-[#d8f2e8] px-1.5 py-0.5 rounded-full shrink-0 self-center">Cached</span>
                    </button>
                  </li>
                ))}
              </>
            )}

            {/* ── Google Places results ── */}
            {hasGoogle && (
              <>
                {hasLocal && (
                  <li className="px-3 py-1.5 bg-[#f4f3ef]">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890]">Google Places</span>
                  </li>
                )}
                {suggestions.map(s => (
                  <li key={s.placeId}>
                    <button
                      type="button"
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-[#f4f3ef] border-b border-[#f0eeea] last:border-0 transition-colors"
                      onClick={() => handlePickGoogle(s)}
                    >
                      <MapPin size={14} className="mt-0.5 text-[#9b9890] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1a1916] truncate">{s.main}</p>
                        <p className="text-xs text-[#9b9890] leading-tight truncate">{s.secondary}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </>
            )}

            {/* ── No results ── */}
            {!hasLocal && !hasGoogle && searched && (
              <li className="px-4 py-3 text-center">
                <p className="text-sm text-[#6b6860]">No results for &ldquo;{query}&rdquo;</p>
                <p className="text-xs text-[#9b9890] mt-0.5">Try a different name or fill in below</p>
              </li>
            )}
          </ul>
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

// ─── Property categories ──────────────────────────────────
// The structural property types offered on the property form's Category dropdown.
// Keep ids in sync with the backend SpaceCategory enum (src/shared/enums.ts).
export const SPACE_CATEGORIES = [
  { id: 'residential', label: 'Residential', icon: '🏠', desc: 'Apartments, villas, townhouses' },
  { id: 'commercial',  label: 'Commercial',  icon: '🏢', desc: 'Offices, retail, business premises' },
  { id: 'industrial',  label: 'Industrial',  icon: '🏭', desc: 'Warehouses, storage, logistics' },
  { id: 'land',        label: 'Land',        icon: '🌍', desc: 'Plot of land' },
  { id: 'mixed_use',   label: 'Mixed-use',   icon: '🏬', desc: 'Combined residential + commercial' },
];

// Category ids that are valid in the DB enum but no longer offered on the form
// (villa/townhouse folded into Residential; retail/warehouse into Commercial/
// Industrial; the original workspaces/venues buckets). Kept so any property
// still holding one of these displays a clean label.
export const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  villa:          'Villa',
  villa_compound: 'Villa Compound',
  townhouse:      'Townhouse',
  retail:         'Retail',
  warehouse:      'Warehouse',
  workspaces:     'Workspaces',
  venues:         'Venues',
};

/** Display label for any property category id (new structural type or legacy bucket). */
export function categoryDisplayLabel(id: string | null | undefined): string {
  if (!id) return '';
  return SPACE_CATEGORIES.find((c) => c.id === id)?.label ?? LEGACY_CATEGORY_LABELS[id] ?? id;
}

export interface PropertyFormData {
  buildingName: string;
  spaceCategory: string;
  // Structured location (FK IDs) — Country → Emirate → City → Community → Sub-Community
  countryId: number | null;
  emirateId: number | null;
  cityId: number | null;
  communityId: number | null;
  subCommunityId: number | null;
  // Display labels (kept for fullAddress composition)
  countryName: string;
  emirateName: string;
  cityName: string;
  communityName: string;
  subCommunityName: string;
  // Free-text
  street: string;
  makaniNumber: string;
  plotNumber: string;
  numberOfFloors: string;
  propertyDescription: string;
  latitude: number | null;
  longitude: number | null;
  // Property Features — single multi-select list (source of truth). The legacy
  // has_gym/has_pool/has_parking booleans are derived from this on the backend.
  sharedAmenities: string[];
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  isStandaloneUnit: boolean;
  // Google placeId — stored so backend can deduplicate building_cache entries
  googlePlaceId: string | null;
}

const EMPTY: PropertyFormData = {
  buildingName: '', spaceCategory: '',
  countryId: null, emirateId: null, cityId: null, communityId: null, subCommunityId: null,
  countryName: '', emirateName: '', cityName: '', communityName: '', subCommunityName: '',
  street: '', makaniNumber: '', plotNumber: '', numberOfFloors: '',
  propertyDescription: '',
  latitude: null, longitude: null,
  sharedAmenities: [],
  hasGym: false, hasPool: false, hasParking: false, isStandaloneUnit: false,
  googlePlaceId: null,
};

interface Props {
  open: boolean;
  initial?: Partial<PropertyFormData>;
  onClose: () => void;
  /** titleDeed only travels for STANDALONE properties (one deed for the whole
   *  property); multi-unit buildings attach deeds per unit instead. */
  onSave: (data: PropertyFormData, titleDeed?: File | null, drawings?: File[], extraDocs?: Record<string, File[]>) => Promise<void>;
  title?: string;
  /** Edit only — the property whose existing documents (title deed + building
   *  drawings) we load so the form can show and remove them. */
  propertyId?: number;
  /** Edit only — live unit count, shown read-only as "Number of units". */
  unitCount?: number;
}

/** A property's already-uploaded document (title deed / building drawing). */
export interface PropertyDoc { id: number; documentKey: string; displayName: string | null; fileUrl: string }
/** Uploads accept PDFs + common image types only. */
export const PROPERTY_DOC_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

/** Preset shared-amenity options for the Property Features multi-select.
 *  "Other Shared Amenities" is handled by the free-text add below. */
export const PROPERTY_FEATURES = [
  'Parking Availability', 'Gym', 'Pool', 'Security', 'Concierge',
];

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

/**
 * A single property-document slot — same look & interaction as the KYC / contract
 * document slots: green card when a file is present, label + Optional badge,
 * View (in-app preview), and Upload / Replace / Add. Existing (already-uploaded)
 * docs and locally-queued files (create flow) render as rows beneath.
 */
export function DocSlotCard({
  label, multiple, existing, queued, onAdd, onRemoveQueued, onRemoveExisting, onView,
}: {
  label: string;
  multiple: boolean;
  existing: PropertyDoc[];
  queued: File[];
  onAdd: (files: FileList | null) => void;
  onRemoveQueued: (idx: number) => void;
  onRemoveExisting?: (id: number) => void;
  onView: (doc: { url: string; mime?: string | null; name: string }) => void;
}) {
  const count = existing.length + queued.length;
  const hasAny = count > 0;
  // Only ever "Upload" / "Replace" / "View" — Replace swaps a single file;
  // multi-file slots keep "Upload" to attach another.
  const btnLabel = hasAny && !multiple ? 'Replace' : 'Upload';
  return (
    <div
      className="rounded-lg border px-3 py-2.5"
      style={{ borderColor: hasAny ? '#22c55e' : '#e8e6e0', background: hasAny ? 'color-mix(in srgb, #22c55e 5%, white)' : 'white' }}
    >
      <div className="flex items-center gap-2.5">
        {hasAny
          ? <Check size={16} className="shrink-0" style={{ color: '#16a34a' }} />
          : <FileText size={16} className="shrink-0 text-[#c8c6c0]" />}
        <span className="text-sm font-medium text-[#1a1916]">{label}</span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#9b9890]">Optional</span>
        {hasAny && <span className="text-[11px] text-[#16a34a] font-medium">{count} file{count === 1 ? '' : 's'}</span>}
        <label className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer"
          style={{ background: hasAny && !multiple ? '#f4f3ef' : '#2e9f82', color: hasAny && !multiple ? '#6b6860' : '#fff' }}>
          <input type="file" accept={PROPERTY_DOC_ACCEPT} multiple={multiple} className="sr-only"
            onChange={e => { onAdd(e.target.files); e.target.value = ''; }} />
          <Upload size={13} /> {btnLabel}
        </label>
      </div>
      {hasAny && (
        <div className="mt-2 space-y-1.5">
          {existing.map(d => (
            <div key={`e${d.id}`} className="flex items-center gap-2 text-xs">
              <FileText size={13} className="text-[#2e9f82] shrink-0" />
              <span className="truncate flex-1 text-[#44423c]">{d.displayName || 'Document'}</span>
              <span className="text-[10px] text-[#9b9890] shrink-0">on file</span>
              {d.fileUrl && (
                <button type="button" onClick={() => onView({ url: d.fileUrl!, name: d.displayName || label })}
                  className="text-[#2e9f82] font-medium hover:underline shrink-0">View</button>
              )}
              {onRemoveExisting && (
                <button type="button" onClick={() => onRemoveExisting(d.id)} title="Remove"
                  className="w-5 h-5 rounded-full bg-[#f4f3ef] grid place-items-center text-[#9b9890] hover:text-[#b91c1c] shrink-0"><Trash2 size={11} /></button>
              )}
            </div>
          ))}
          {queued.map((f, i) => (
            <div key={`q${i}`} className="flex items-center gap-2 text-xs">
              <Upload size={13} className="text-[#2e9f82] shrink-0" />
              <span className="truncate flex-1 text-[#44423c]">{f.name}</span>
              <span className="text-[10px] text-[#9b9890] shrink-0">ready to upload</span>
              <button type="button" onClick={() => onView({ url: URL.createObjectURL(f), mime: f.type, name: f.name })}
                className="text-[#2e9f82] font-medium hover:underline shrink-0">View</button>
              <button type="button" onClick={() => onRemoveQueued(i)} title="Remove"
                className="w-5 h-5 rounded-full bg-[#f4f3ef] grid place-items-center text-[#9b9890] hover:text-[#b91c1c] shrink-0"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared, controlled property form body ──────────────────────────────────
// Single source of truth for BOTH the Edit modal and the Add wizard (RP +
// manager), so the two can never drift. Owns the location cascade + building
// search auto-fill + the document pickers; the PARENT owns value / errors /
// file state and submission.
export function PropertyFields({
  value, setValue, errors, setErrors, isEdit = false,
  titleDeed, setTitleDeed,
  drawings, setDrawings,
  existingDocs = [], onRemoveExisting,
  unitCount,
  extraDocs = {}, setExtraDocs,
}: {
  value: PropertyFormData;
  setValue: Dispatch<SetStateAction<PropertyFormData>>;
  errors: Partial<Record<keyof PropertyFormData, string>>;
  setErrors: Dispatch<SetStateAction<Partial<Record<keyof PropertyFormData, string>>>>;
  isEdit?: boolean;
  titleDeed: File | null;
  setTitleDeed: (f: File | null) => void;
  drawings: File[];
  setDrawings: Dispatch<SetStateAction<File[]>>;
  existingDocs?: PropertyDoc[];
  onRemoveExisting?: (id: number) => void;
  /** Edit only — live count of units on this property (read-only display). */
  unitCount?: number;
  /** Queued files for the extra document slots (affection plan, NOC, …). */
  extraDocs?: Record<string, File[]>;
  setExtraDocs?: Dispatch<SetStateAction<Record<string, File[]>>>;
}) {
  const [autoFilled, setAutoFilled] = useState(false);
  const [showMap, setShowMap] = useState(!!(value.latitude && value.longitude));
  // In-app document preview (matches the KYC / contract "View" pattern).
  const [viewerDoc, setViewerDoc] = useState<{ url: string; mime?: string | null; name: string } | null>(null);

  // Location data — full chain Country → Emirate → City → Community → Sub-Community
  const [countries,         setCountries]         = useState<Country[]>([]);
  const [emirates,          setEmirates]          = useState<Emirate[]>([]);
  const [cities,            setCities]            = useState<City[]>([]);
  const [communities,       setCommunities]       = useState<Community[]>([]);
  const [subCommunities,    setSubCommunities]    = useState<SubCommunity[]>([]);
  const [loadingCities,     setLoadingCities]     = useState(false);
  const [loadingComms,      setLoadingComms]      = useState(false);
  const [loadingSubs,       setLoadingSubs]       = useState(false);
  // Drive cascade loads independently of form state to avoid stale-closure issues
  const [loadEmiratesFor,   setLoadEmiratesFor]   = useState<number | null>(null);
  const [loadCitiesFor,     setLoadCitiesFor]     = useState<number | null>(null);
  const [loadCommsFor,      setLoadCommsFor]      = useState<number | null>(null);
  const [loadSubsFor,       setLoadSubsFor]       = useState<number | null>(null);
  const defaultCountryIdRef = useRef<number | null>(null);
  const pendingCommunityRef = useRef<string>('');

  // Load countries once on mount; auto-select UAE when nothing chosen yet
  useEffect(() => {
    apiGet<Country[]>('/locations/countries').then(cs => {
      setCountries(cs);
      const ae = cs.find(c => c.code === 'AE');
      if (ae) {
        defaultCountryIdRef.current = ae.id;
        setValue(prev => prev.countryId ? prev : { ...prev, countryId: ae.id, countryName: ae.nameEn });
        setLoadEmiratesFor(prev => prev ?? ae.id);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialise the cascade from the incoming value once. The Edit modal remounts
  // this component (via a key) each time it opens, so this re-derives per open;
  // the wizard mounts it once. Names backfill as each list loads.
  useEffect(() => {
    if (value.countryId) setLoadEmiratesFor(value.countryId);
    setLoadCitiesFor(value.emirateId ?? null);
    setLoadCommsFor(value.cityId ?? null);
    setLoadSubsFor(value.communityId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load emirates when country changes
  useEffect(() => {
    if (!loadEmiratesFor) { setEmirates([]); return; }
    apiGet<Emirate[]>(`/locations/countries/${loadEmiratesFor}/emirates`)
      .then(setEmirates).catch(() => {});
  }, [loadEmiratesFor]);

  // City cascade — for the UAE every emirate has one city, auto-selected so the
  // flow feels like Emirate → Community.
  useEffect(() => {
    if (!loadCitiesFor) { setCities([]); return; }
    setLoadingCities(true);
    apiGet<City[]>(`/locations/emirates/${loadCitiesFor}/cities`)
      .then(cs => {
        setCities(cs);
        setValue(prev => {
          if (prev.cityId && !prev.cityName) {
            const match = cs.find(c => c.id === prev.cityId);
            if (match) return { ...prev, cityName: match.nameEn };
          }
          if (!prev.cityId && cs.length === 1) {
            setLoadCommsFor(cs[0].id);
            return { ...prev, cityId: cs[0].id, cityName: cs[0].nameEn };
          }
          return prev;
        });
      })
      .finally(() => setLoadingCities(false));
  }, [loadCitiesFor]);

  // Community cascade
  useEffect(() => {
    if (!loadCommsFor) { setCommunities([]); return; }
    setLoadingComms(true);
    apiGet<Community[]>(`/locations/cities/${loadCommsFor}/communities`)
      .then(comms => {
        setCommunities(comms);
        setValue(prev => {
          if (prev.communityId) {
            const match = comms.find(c => c.id === prev.communityId);
            if (match) {
              setLoadSubsFor(prev.communityId);
              if (!prev.communityName) return { ...prev, communityName: match.nameEn };
            }
          }
          return prev;
        });
        // Fuzzy-match a community name carried over from a Mapbox/Google result
        if (pendingCommunityRef.current) {
          const pending = pendingCommunityRef.current.toLowerCase().trim();
          const tokenize = (s: string) => s.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
          const pendingTokens = tokenize(pending);
          let bestScore = 0;
          let bestMatch: Community | null = null;
          for (const c of comms) {
            const dbTokens = tokenize(c.nameEn.toLowerCase());
            const overlap  = pendingTokens.filter(t => dbTokens.includes(t)).length;
            const score    = overlap / Math.max(pendingTokens.length, dbTokens.length);
            if (score > bestScore) { bestScore = score; bestMatch = c; }
          }
          if (bestMatch && bestScore >= 0.5) {
            setValue(prev => ({ ...prev, communityId: bestMatch!.id, communityName: bestMatch!.nameEn }));
            setLoadSubsFor(bestMatch!.id);
          }
          pendingCommunityRef.current = '';
        }
      })
      .finally(() => setLoadingComms(false));
  }, [loadCommsFor]);

  // Sub-Community cascade
  useEffect(() => {
    if (!loadSubsFor) { setSubCommunities([]); return; }
    setLoadingSubs(true);
    apiGet<SubCommunity[]>(`/locations/communities/${loadSubsFor}/sub-communities`)
      .then(subs => {
        setSubCommunities(subs);
        setValue(prev => {
          if (prev.subCommunityId && !prev.subCommunityName) {
            const match = subs.find(s => s.id === prev.subCommunityId);
            if (match) return { ...prev, subCommunityName: match.nameEn };
          }
          return prev;
        });
      })
      .finally(() => setLoadingSubs(false));
  }, [loadSubsFor]);

  const upd = <K extends keyof PropertyFormData>(k: K, v: PropertyFormData[K]) => {
    setValue(prev => ({ ...prev, [k]: v }));
    setErrors(prev => ({ ...prev, [k]: undefined }));
  };

  // Property Features multi-select helper (preset list only).
  const toggleFeature = (f: string) =>
    upd('sharedAmenities', value.sharedAmenities.includes(f)
      ? value.sharedAmenities.filter(a => a !== f)
      : [...value.sharedAmenities, f]);

  // Extra document slots (affection plan, completion cert, architectural
  // drawings, site plan, NOC) — queue files; uploaded by the parent on save.
  const addSlotFiles = (key: string, list: FileList | null, multiple: boolean) => {
    if (!list?.length || !setExtraDocs) return;
    const incoming = Array.from(list);
    setExtraDocs(prev => ({ ...prev, [key]: multiple ? [...(prev[key] ?? []), ...incoming] : [incoming[0]] }));
  };
  const removeSlotFile = (key: string, idx: number) =>
    setExtraDocs?.(prev => ({ ...prev, [key]: (prev[key] ?? []).filter((_, j) => j !== idx) }));

  const handleCountryChange = (val: string) => {
    const country = countries.find(c => c.id === Number(val));
    setValue(prev => ({
      ...prev,
      countryId: val ? Number(val) : null, countryName: country?.nameEn ?? '',
      emirateId: null, emirateName: '',
      cityId: null, cityName: '',
      communityId: null, communityName: '',
      subCommunityId: null, subCommunityName: '',
    }));
    setLoadEmiratesFor(val ? Number(val) : null);
    setLoadCitiesFor(null); setLoadCommsFor(null); setLoadSubsFor(null);
    setCities([]); setCommunities([]); setSubCommunities([]);
  };

  const handleEmirateChange = (val: string) => {
    const em = emirates.find(e => e.id === Number(val));
    setValue(prev => ({
      ...prev,
      emirateId: val ? Number(val) : null, emirateName: em?.nameEn ?? '',
      cityId: null, cityName: '',
      communityId: null, communityName: '',
      subCommunityId: null, subCommunityName: '',
    }));
    setLoadCitiesFor(val ? Number(val) : null);
    setLoadCommsFor(null); setLoadSubsFor(null);
    setCommunities([]); setSubCommunities([]);
    setErrors(prev => ({ ...prev, emirateId: undefined }));
  };

  const handleCityChange = (val: string) => {
    const city = cities.find(c => c.id === Number(val));
    setValue(prev => ({
      ...prev,
      cityId: val ? Number(val) : null, cityName: city?.nameEn ?? '',
      communityId: null, communityName: '',
      subCommunityId: null, subCommunityName: '',
    }));
    setLoadCommsFor(val ? Number(val) : null);
    setLoadSubsFor(null);
    setSubCommunities([]);
  };

  const handleCommunityChange = (val: string) => {
    const comm = communities.find(c => c.id === Number(val));
    setValue(prev => ({
      ...prev,
      communityId: val ? Number(val) : null, communityName: comm?.nameEn ?? '',
      subCommunityId: null, subCommunityName: '',
    }));
    setLoadSubsFor(val ? Number(val) : null);
    setSubCommunities([]);
  };

  const handleSubCommunityChange = (val: string) => {
    const sub = subCommunities.find(s => s.id === Number(val));
    setValue(prev => ({
      ...prev,
      subCommunityId: val ? Number(val) : null, subCommunityName: sub?.nameEn ?? '',
    }));
  };

  const handleSearchSelect = (r: SearchResult) => {
    const newEmirateId: number | null = r.emirateId !== undefined
      ? (r.emirateId ?? null)
      : (() => {
          const mb = r.emirateName.trim().toLowerCase();
          if (!mb) {
            const label = r.label.toLowerCase();
            return emirates.find(e => label.includes(e.nameEn.toLowerCase()))?.id ?? null;
          }
          return emirates.find(e => {
            const db = e.nameEn.toLowerCase();
            return db === mb || mb.includes(db) || db.includes(mb);
          })?.id ?? null;
        })();

    const emirateName = emirates.find(e => e.id === newEmirateId)?.nameEn ?? r.emirateName;

    if (r.communityId != null) {
      pendingCommunityRef.current = '';
      setValue(prev => ({
        ...prev,
        ...(r.featureType === 'poi'  && r.name   && { buildingName: r.name }),
        ...(r.featureType !== 'area' && r.street && { street: r.street }),
        latitude:      r.lat || prev.latitude,
        longitude:     r.lng || prev.longitude,
        emirateId:     newEmirateId,
        emirateName,
        communityId:   r.communityId ?? null,
        communityName: '',
        googlePlaceId: r.googlePlaceId ?? prev.googlePlaceId,
      }));
    } else {
      pendingCommunityRef.current = r.communityName;
      setValue(prev => ({
        ...prev,
        ...(r.featureType === 'poi'  && r.name   && { buildingName: r.name }),
        ...(r.featureType !== 'area' && r.street && { street: r.street }),
        latitude:      r.lat || prev.latitude,
        longitude:     r.lng || prev.longitude,
        emirateId:     newEmirateId,
        emirateName,
        communityId:   null,
        communityName: '',
        googlePlaceId: r.googlePlaceId != null
          ? r.googlePlaceId
          : (!r.id.startsWith('cache_') && !r.id.startsWith('local_') ? r.id : prev.googlePlaceId),
      }));
    }

    setLoadCitiesFor(newEmirateId);
    setLoadCommsFor(null);
    setLoadSubsFor(null);
    setSubCommunities([]);
    setAutoFilled(true);
    setShowMap(true);
    setErrors(prev => ({ ...prev, buildingName: undefined, emirateId: undefined }));
  };

  const existingDeed = existingDocs.filter(d => d.documentKey === 'title_deed');
  const existingDrawings = existingDocs.filter(d => d.documentKey.startsWith('building_drawing'));

  const addDrawings = (files: FileList | null) => {
    if (!files?.length) return;
    setDrawings(prev => [...prev, ...Array.from(files)]);
  };

  return (
    <>
      {/* Category — only field the user sets manually */}
      <div>
        <FieldLabel label="Category" required />
        {isEdit ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e8e6e0] bg-[#f4f3ef] text-sm text-[#3d3b35]">
            <span className="flex-1">{categoryDisplayLabel(value.spaceCategory)}</span>
            <span className="text-[10px] text-[#9b9890] font-medium">Locked</span>
          </div>
        ) : (
          <>
            <select className={cn(SELECT, errors.spaceCategory && 'border-red-400')}
              value={value.spaceCategory} onChange={e => upd('spaceCategory', e.target.value)}>
              <option value="">Select category</option>
              {SPACE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {errors.spaceCategory && <p className="text-xs text-red-500 mt-1">{errors.spaceCategory}</p>}
          </>
        )}
      </div>

      {/* Search + Map — triggers auto-fill of all fields below */}
      <div>
        <FieldLabel label="Search Building / Address" />
        {autoFilled ? (
          <div className="flex items-center gap-2 text-xs text-[#1a7a5a] bg-[#d8f2e8] rounded-lg px-3 py-2 mb-2">
            <CheckCircle2 size={13} className="shrink-0" />
            <span>Fields auto-filled from search — review and adjust below</span>
          </div>
        ) : (
          <p className="text-[10px] text-[#9b9890] mb-2">Search to auto-fill all fields below, or fill in manually</p>
        )}
        <BuildingSearch onSelect={handleSearchSelect} onManualEntry={() => setAutoFilled(false)} />
        <p className="text-[10px] text-[#9b9890] mt-1 mb-3">Powered by Google Places · UAE buildings &amp; addresses</p>
        {showMap ? (
          <MapPicker
            latitude={value.latitude} longitude={value.longitude}
            onChange={(lat, lng) => { upd('latitude', lat); upd('longitude', lng); }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowMap(true)}
            className="w-full h-[220px] rounded-xl border border-dashed border-[#e8e6e0] bg-[#f9f8f5] flex flex-col items-center justify-center gap-2 text-[#9b9890] hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors cursor-pointer"
          >
            <MapPin size={20} className="opacity-40" />
            <span className="text-xs">Search above to pin location, or click to open map</span>
          </button>
        )}
      </div>

      {/* Location chain: Country → Emirate. The City tier is hidden for now —
          it still auto-selects internally (one city per UAE emirate) so the
          community list loads and cityId is saved; we just don't show it. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel label="Country" required />
          <select className={SELECT} value={value.countryId ?? ''} onChange={e => handleCountryChange(e.target.value)}>
            <option value="">Select Country</option>
            {countries.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel label="Emirate / Region" required />
          <select
            className={cn(SELECT, errors.emirateId && 'border-red-400', !value.countryId && DISABLED_CLS)}
            value={value.emirateId ?? ''}
            onChange={e => handleEmirateChange(e.target.value)}
            disabled={!value.countryId}
          >
            <option value="">{value.countryId ? 'Select Emirate' : 'Select Country first'}</option>
            {emirates.map(em => <option key={em.id} value={em.id}>{em.nameEn}</option>)}
          </select>
          {errors.emirateId && <p className="text-xs text-red-500 mt-1">{errors.emirateId}</p>}
        </div>
      </div>

      {/* Community + (Sub-Community only when the community has any) */}
      <div className={cn('grid gap-3', subCommunities.length > 0 ? 'grid-cols-2' : 'grid-cols-1')}>
        <div>
          <FieldLabel label="Community / Area" />
          <select
            className={cn(SELECT, (!value.cityId || loadingComms) && DISABLED_CLS)}
            value={value.communityId ?? ''}
            onChange={e => handleCommunityChange(e.target.value)}
            disabled={!value.cityId || loadingComms}
          >
            <option value="">{loadingComms ? 'Loading…' : value.cityId ? 'Select Community' : 'Select City first'}</option>
            {communities.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
          </select>
        </div>
        {subCommunities.length > 0 && (
          <div>
            <FieldLabel label="Sub-Community" />
            <select
              className={cn(SELECT, loadingSubs && DISABLED_CLS)}
              value={value.subCommunityId ?? ''}
              onChange={e => handleSubCommunityChange(e.target.value)}
              disabled={loadingSubs}
            >
              <option value="">Select Sub-Community (optional)</option>
              {subCommunities.map(s => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Building Name | Street — auto-filled from search */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel label="Building / Property Name" />
          <input
            className={cn(INPUT, errors.buildingName && 'border-red-400')}
            placeholder="e.g. Al Safa Tower, Palm Residences"
            value={value.buildingName}
            onChange={e => upd('buildingName', e.target.value)}
          />
          {errors.buildingName && <p className="text-xs text-red-500 mt-1">{errors.buildingName}</p>}
        </div>
        <div>
          <FieldLabel label="Street / Address" />
          {/* Plain input — no autocomplete here; the "Search Building / Address"
              field above already auto-fills the street and coordinates. */}
          <input
            className={INPUT}
            placeholder="e.g. Sheikh Zayed Road, Al Wasl Road…"
            value={value.street}
            onChange={e => upd('street', e.target.value)}
          />
        </div>
      </div>

      {/* Plot Number | Makani Number | Number of floors — manual (Makani = Dubai's 10-digit geo address) */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel label="Plot Number" />
          <input className={INPUT} placeholder="e.g. PLOT-12345" value={value.plotNumber}
            onChange={e => upd('plotNumber', e.target.value)} />
        </div>
        <div>
          <FieldLabel label="Makani Number" />
          <input className={INPUT} placeholder="e.g. 1234567890" value={value.makaniNumber}
            onChange={e => upd('makaniNumber', e.target.value)} />
        </div>
        <div>
          <FieldLabel label="Number of floors" />
          <input className={INPUT} placeholder="e.g. 20 or G+12" value={value.numberOfFloors}
            onChange={e => upd('numberOfFloors', e.target.value)} />
        </div>
      </div>

      {/* Property description — free text, shown on the listing + property profile. */}
      <div>
        <FieldLabel label="Property description" />
        <textarea
          className={cn(INPUT, 'min-h-[88px] resize-y leading-relaxed')}
          placeholder="Optional — location highlights, shared facilities, building notes…"
          value={value.propertyDescription}
          onChange={e => upd('propertyDescription', e.target.value)}
        />
      </div>

      {/* Number of units — auto-derived (read-only). Units are added/managed in
          the unit forms; this just reflects the live count. */}
      {unitCount != null && (
        <div>
          <FieldLabel label="Number of units" />
          <div className="flex items-center gap-2 border border-[#e8e6e0] rounded-lg px-3 py-2 bg-[#faf9f6]">
            <span className="text-sm font-semibold text-[#1a1916]">{unitCount}</span>
            <span className="text-xs text-[#9b9890]">unit{unitCount === 1 ? '' : 's'} on this property · managed in the unit forms</span>
          </div>
        </div>
      )}

      {/* Property Features — multi-select from the preset list only. */}
      <div>
        <FieldLabel label="Property features" />
        <div className="flex flex-wrap gap-1.5">
          {[...PROPERTY_FEATURES, ...value.sharedAmenities.filter(a => !PROPERTY_FEATURES.includes(a))].map(feat => {
            const on = value.sharedAmenities.includes(feat);
            return (
              <button
                key={feat}
                type="button"
                onClick={() => toggleFeature(feat)}
                className={cn(
                  'text-xs font-medium px-3 py-1.5 rounded-full border transition-colors cursor-pointer',
                  on ? 'border-[#2e9f82] bg-[#e6f7f1] text-[#1f6655]' : 'border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]',
                )}
              >
                {feat}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Property documents — same slot pattern as KYC / contract docs ── */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#9b9890] mb-2">Property documents</p>

        {/* Title-deed structure — one deed for the whole property (single owner)
            vs a deed per unit (units owned/titled separately). */}
        <label className="flex items-start gap-2.5 border border-[#e8e6e0] rounded-lg px-3 py-2.5 cursor-pointer hover:border-[#c5c2bc] mb-2.5">
          <input
            type="checkbox"
            checked={value.isStandaloneUnit}
            onChange={e => upd('isStandaloneUnit', e.target.checked)}
            className="mt-0.5 accent-[#2e9f82]"
          />
          <span>
            <span className="block text-sm font-medium text-[#1a1916]">One title deed for the whole property (single owner)</span>
            <span className="block text-[11px] text-[#9b9890] mt-0.5">
              On — a single owner holds the entire property under one title deed: a villa,
              a standalone office, or a whole building owned by one party (deed attached below).
              Off — units are owned separately, each with its own title deed added in the unit form.
            </span>
          </span>
        </label>

        <div className="space-y-4">
          {/* Single-file documents — one file each (re-uploading replaces it). */}
          <div className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#b6b3ab]">Single file</p>
            {value.isStandaloneUnit && (
              <DocSlotCard
                label="Title Deed" multiple={false}
                existing={existingDeed}
                queued={titleDeed ? [titleDeed] : []}
                onAdd={files => { const f = files?.[0] ?? null; if (f) setTitleDeed(f); }}
                onRemoveQueued={() => setTitleDeed(null)}
                onRemoveExisting={onRemoveExisting}
                onView={setViewerDoc}
              />
            )}
            {PROPERTY_DOC_SLOTS.filter(s => !s.multiple).map(slot => (
              <DocSlotCard
                key={slot.key}
                label={slot.label} multiple={slot.multiple}
                existing={existingDocs.filter(d => docBelongsToSlot(d.documentKey, slot))}
                queued={extraDocs[slot.key] ?? []}
                onAdd={files => addSlotFiles(slot.key, files, slot.multiple)}
                onRemoveQueued={i => removeSlotFile(slot.key, i)}
                onRemoveExisting={onRemoveExisting}
                onView={setViewerDoc}
              />
            ))}
          </div>

          {/* Multi-file documents — attach several. */}
          <div className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#b6b3ab]">Multiple files</p>
            <DocSlotCard
              label="Building Floor Plans" multiple
              existing={existingDrawings}
              queued={drawings}
              onAdd={addDrawings}
              onRemoveQueued={i => setDrawings(prev => prev.filter((_, j) => j !== i))}
              onRemoveExisting={onRemoveExisting}
              onView={setViewerDoc}
            />
            {PROPERTY_DOC_SLOTS.filter(s => s.multiple).map(slot => (
              <DocSlotCard
                key={slot.key}
                label={slot.label} multiple={slot.multiple}
                existing={existingDocs.filter(d => docBelongsToSlot(d.documentKey, slot))}
                queued={extraDocs[slot.key] ?? []}
                onAdd={files => addSlotFiles(slot.key, files, slot.multiple)}
                onRemoveQueued={i => removeSlotFile(slot.key, i)}
                onRemoveExisting={onRemoveExisting}
                onView={setViewerDoc}
              />
            ))}
          </div>
        </div>
      </div>

      {/* In-app document preview ("View") */}
      {viewerDoc && (
        <DocPreviewModal
          title={viewerDoc.name}
          docs={[{ id: 1, fileUrl: viewerDoc.url, mimeType: viewerDoc.mime ?? null, caption: viewerDoc.name }]}
          onClose={() => setViewerDoc(null)}
        />
      )}
    </>
  );
}

export function PropertyFormModal({ open, initial, onClose, onSave, title, propertyId, unitCount }: Props) {
  const isEdit = !!initial?.spaceCategory;
  const [form, setForm] = useState<PropertyFormData>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof PropertyFormData, string>>>({});
  const [saving, setSaving] = useState(false);
  const [titleDeed, setTitleDeed] = useState<File | null>(null);
  const [drawings, setDrawings] = useState<File[]>([]);
  const [extraDocs, setExtraDocs] = useState<Record<string, File[]>>({});
  const [existingDocs, setExistingDocs] = useState<PropertyDoc[]>([]);
  // Bumped each open so PropertyFields remounts and re-derives its cascade.
  const [openSeq, setOpenSeq] = useState(0);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, ...initial });
    setErrors({}); setTitleDeed(null); setDrawings([]); setExtraDocs({});
    setOpenSeq(s => s + 1);
    if (propertyId) {
      apiGet<PropertyDoc[]>(`/documents?ownerType=property&ownerId=${propertyId}`)
        .then(ds => setExistingDocs(ds.filter(d => d.documentKey === 'title_deed' || d.documentKey.startsWith('building_drawing') || isExtraSlotDoc(d.documentKey))))
        .catch(() => setExistingDocs([]));
    } else {
      setExistingDocs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const removeExisting = async (id: number) => {
    try {
      await apiDelete(`/documents/${id}`);
      setExistingDocs(prev => prev.filter(d => d.id !== id));
    } catch (e) {
      alert(`Could not remove the document: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<keyof PropertyFormData, string>> = {};
    if (!form.spaceCategory) errs.spaceCategory = 'Required';
    if (!form.emirateId)     errs.emirateId = 'Required';
    setErrors(errs);
    // Title deed is OPTIONAL — even for a standalone property.
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try { await onSave(form, form.isStandaloneUnit ? titleDeed : null, drawings, extraDocs); onClose(); }
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
          <PropertyFields
            key={openSeq}
            value={form} setValue={setForm}
            errors={errors} setErrors={setErrors}
            isEdit={isEdit}
            titleDeed={titleDeed} setTitleDeed={setTitleDeed}
            drawings={drawings} setDrawings={setDrawings}
            existingDocs={existingDocs} onRemoveExisting={removeExisting}
            unitCount={unitCount}
            extraDocs={extraDocs} setExtraDocs={setExtraDocs}
          />

          {/* Building photos — live gallery (edit only; the Add flow stages
              photos on the dedicated add page before the property exists). */}
          {propertyId && (
            <div className="pt-1 border-t border-[#f0ede8]">
              <div className="pt-4">
                <PropertyPhotos propertyId={propertyId} />
              </div>
            </div>
          )}

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
