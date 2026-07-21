'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Fragment, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { X, Loader2, Search, MapPin, CheckCircle2, Database, Upload, Trash2, FileText, Check, Home, Camera } from 'lucide-react';
import { MapPicker } from './MapPicker';
import { cn } from '@/lib/utils';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { PROPERTY_DOC_SLOTS, HEAD_LEASE_KEY, MGMT_AGREEMENT_KEY, LEASE_PROOF_KEYS, docBelongsToSlot, isExtraSlotDoc } from '@/lib/propertyDocs';
import { DocPreviewModal } from './DocPreviewModal';
import { PropertyPhotos } from './PropertyPhotos';
import { useSlideOver } from '@/lib/useSlideOver';

// ─── Form section model (drives the modal's left-nav + scroll-spy) ──────────
export type PropSectionId = 'cat' | 'loc' | 'det' | 'doc' | 'pho';
export const PROPERTY_FORM_SECTIONS: { id: PropSectionId; num: number; label: string; desc: string }[] = [
  { id: 'cat', num: 1, label: 'Category & lease',   desc: 'How you hold this building and what type it is.' },
  { id: 'loc', num: 2, label: 'Location',           desc: 'Search to auto-fill, or enter the address manually.' },
  { id: 'det', num: 3, label: 'Property details',   desc: 'Optional context that helps units and listings later.' },
  { id: 'doc', num: 4, label: 'Property documents', desc: 'All optional — attach what you have now, add the rest later.' },
  { id: 'pho', num: 5, label: 'Property photos',    desc: 'First image becomes the cover. Drag thumbnails to reorder.' },
];

/** Numbered section header (badge + title + subtitle) used in the sectioned form. */
export function PropSectionHeader({ num, label, desc }: { num: number; label: string; desc: string }) {
  return (
    <div className="flex gap-3 mb-4">
      <span className="w-[30px] h-[30px] shrink-0 rounded-[9px] bg-[#d8f2e8] text-[#1a7a5a] flex items-center justify-center text-[13px] font-extrabold">{num}</span>
      <div>
        <div className="text-[16px] font-extrabold tracking-tight text-[#1a1916] leading-tight">{label}</div>
        <div className="text-[12.5px] text-[#9b9890] mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

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
  // How the RP holds this building: 'direct' (owns/leases directly), 'sub'
  // (head-leases then sub-leases), or 'management' (manages on the owner's
  // behalf). Drives the Fee & VAT report's direct/sub/management split.
  leasingType: 'direct' | 'sub' | 'management';
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
  // RP-declared total units in the building (metadata) — distinct from the live
  // count of unit rows actually created on the property.
  numberOfUnits: string;
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
  buildingName: '', spaceCategory: '', leasingType: 'direct',
  countryId: null, emirateId: null, cityId: null, communityId: null, subCommunityId: null,
  countryName: '', emirateName: '', cityName: '', communityName: '', subCommunityName: '',
  street: '', makaniNumber: '', plotNumber: '', numberOfFloors: '', numberOfUnits: '',
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
  onSave: (data: PropertyFormData, titleDeed?: File | null, drawings?: File[], extraDocs?: Record<string, File[]>, photos?: File[]) => Promise<void>;
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
  label, multiple, existing, queued, onAdd, onRemoveQueued, onRemoveExisting, onView, required = false,
}: {
  label: string;
  multiple: boolean;
  existing: PropertyDoc[];
  queued: File[];
  onAdd: (files: FileList | null) => void;
  onRemoveQueued: (idx: number) => void;
  onRemoveExisting?: (id: number) => void;
  onView: (doc: { url: string; mime?: string | null; name: string }) => void;
  /** Show a red "Required" badge instead of the default "Optional". */
  required?: boolean;
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
        {required
          ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#fde8e8] text-[#b91c1c]">Required</span>
          : <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#9b9890]">Optional</span>}
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

// Inline glyphs matching the Add Property design's document icons (a single
// document vs a stacked-docs glyph for multi-file slots, and an eye for view).
const DOC_FILE_SVG = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /></svg>
);
const DOC_STACK_SVG = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 3h7l4 4v11H8z" /><path d="M5 7v13h11" /></svg>
);
const DOC_EYE_SVG = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
);

/**
 * Property document slot — faithful to the Add Property design: a rounded icon
 * tile (single-file vs stacked-docs glyph), the name with a stacked OPTIONAL
 * chip (or a green "N files attached"), a mint pill Upload / Replace / Add
 * button, and attached files shown as green pills (eye + name + ×).
 *
 * Pass `description` for the wider lease-proof layout used beside the leasing
 * picker (icon + title + inline OPTIONAL chip + description + larger button).
 */
export function PropertyDocCard({
  label, multiple, existing, queued, onAdd, onRemoveQueued, onRemoveExisting, onView,
  description, stacked = false,
}: {
  label: string;
  multiple: boolean;
  existing: PropertyDoc[];
  queued: File[];
  onAdd: (files: FileList | null) => void;
  onRemoveQueued: (idx: number) => void;
  onRemoveExisting?: (id: number) => void;
  onView: (doc: { url: string; mime?: string | null; name: string }) => void;
  /** Present → lease-proof layout (inline chip + description + larger button). */
  description?: string;
  /** Use the stacked-docs glyph (multi-file slots). */
  stacked?: boolean;
}) {
  const count = existing.length + queued.length;
  const has = count > 0;
  const inline = description != null;
  const btnLabel = !has ? 'Upload' : multiple ? 'Add' : 'Replace';
  const pillCls = 'inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-lg px-2.5 py-1.5';
  const pillStyle = { color: '#1a6b4d', background: '#e6f7f1', border: '1px solid #bfe0cd' } as const;
  return (
    <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: has ? '#bfe0cd' : '#e8e6e0', background: has ? '#f5fbf8' : '#fff' }}>
      <div className={cn('flex items-center', inline ? 'gap-3' : 'gap-2.5')}>
        <span className={cn(inline ? 'w-[34px] h-[34px]' : 'w-8 h-8', 'shrink-0 rounded-[9px] flex items-center justify-center')}
          style={{ background: has ? '#d8f2e8' : '#f4f3ef', color: has ? '#1a7a5a' : '#9b9890' }}>
          {stacked ? DOC_STACK_SVG : DOC_FILE_SVG}
        </span>
        <div className="flex-1 min-w-0">
          {inline ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-bold text-[#2b342e] truncate">{label}</span>
                {!has && <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide text-[#9b9890] bg-[#f4f3ef] px-1.5 py-0.5 rounded">Optional</span>}
              </div>
              <div className="text-[11.5px] text-[#8a938c] mt-0.5 leading-snug">{description}</div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-bold text-[#2b342e] truncate">{label}</div>
              {has
                ? <div className="text-[11px] font-bold text-[#1a7a5a] mt-0.5">{count} file{count === 1 ? '' : 's'} attached</div>
                : <span className="inline-block text-[9.5px] font-bold uppercase tracking-wide text-[#9b9890] bg-[#f4f3ef] px-1.5 py-0.5 rounded mt-1">Optional</span>}
            </>
          )}
        </div>
        <label className={cn('shrink-0 inline-flex items-center gap-1.5 rounded-[9px] font-bold cursor-pointer',
          inline ? 'text-[13px] px-4 py-2.5' : 'text-[12px] px-3 py-2')}
          style={{ background: '#e6f7f1', border: '1px solid #bfe0cd', color: '#1f6655' }}>
          <input type="file" accept={PROPERTY_DOC_ACCEPT} multiple={multiple} className="sr-only"
            onChange={e => { onAdd(e.target.files); e.target.value = ''; }} />
          <Upload size={inline ? 14 : 13} /> {btnLabel}
        </label>
      </div>
      {has && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {existing.map(d => (
            <span key={`e${d.id}`} className={pillCls} style={pillStyle}>
              <span className="inline-flex items-center gap-1.5 cursor-pointer max-w-[220px]" title="View document"
                onClick={() => d.fileUrl && onView({ url: d.fileUrl, name: d.displayName || label })}>
                <span className="opacity-70 inline-flex shrink-0">{DOC_EYE_SVG}</span>
                <span className="truncate">{d.displayName || 'Document'}</span>
              </span>
              {onRemoveExisting && (
                <span className="cursor-pointer text-[#9aa39c] leading-none text-sm shrink-0" title="Remove" onClick={() => onRemoveExisting(d.id)}>×</span>
              )}
            </span>
          ))}
          {queued.map((f, i) => (
            <span key={`q${i}`} className={pillCls} style={pillStyle}>
              <span className="inline-flex items-center gap-1.5 cursor-pointer max-w-[220px]" title="View document"
                onClick={() => onView({ url: URL.createObjectURL(f), mime: f.type, name: f.name })}>
                <span className="opacity-70 inline-flex shrink-0">{DOC_EYE_SVG}</span>
                <span className="truncate">{f.name}</span>
              </span>
              <span className="cursor-pointer text-[#9aa39c] leading-none text-sm shrink-0" title="Remove" onClick={() => onRemoveQueued(i)}>×</span>
            </span>
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
  sectioned = false, registerSection,
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
  /** Modal layout — render numbered section headers + dividers and register each
   *  section's element for the modal's left-nav scroll-spy. Off (default) = the
   *  flat inline layout used by the units/add wizard. */
  sectioned?: boolean;
  registerSection?: (id: PropSectionId, el: HTMLElement | null) => void;
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
        // UAE: exactly one city per emirate — auto-select it so the community
        // list loads. Decide the community-load BEFORE setValue so we never call
        // a setState from inside the updater (React runs updaters during render,
        // and a nested setState there warns "update X while rendering Y").
        const autoCityId = !value.cityId && cs.length === 1 ? cs[0].id : null;
        setValue(prev => {
          if (prev.cityId && !prev.cityName) {
            const match = cs.find(c => c.id === prev.cityId);
            if (match) return { ...prev, cityName: match.nameEn };
          }
          if (!prev.cityId && cs.length === 1) {
            return { ...prev, cityId: cs[0].id, cityName: cs[0].nameEn };
          }
          return prev;
        });
        if (autoCityId != null) setLoadCommsFor(autoCityId);
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
        // Trigger the sub-community load BEFORE setValue (never call setState from
        // inside the updater — it runs during render). Backfill the name purely.
        const matchedCommId = value.communityId && comms.some(c => c.id === value.communityId)
          ? value.communityId : null;
        setValue(prev => {
          if (prev.communityId && !prev.communityName) {
            const match = comms.find(c => c.id === prev.communityId);
            if (match) return { ...prev, communityName: match.nameEn };
          }
          return prev;
        });
        if (matchedCommId != null) setLoadSubsFor(matchedCommId);
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
    // Capture the files eagerly: the picker's onChange clears the input
    // (`e.target.value = ''`) right after calling this, which empties the live
    // FileList — so a lazy `Array.from(files)` inside the setState updater would
    // read an already-cleared list and drop the upload.
    const incoming = Array.from(files);
    setDrawings(prev => [...prev, ...incoming]);
  };

  // Wrap a logical group as a numbered, ref-registered <section> (modal layout)
  // or render it flat (units/add wizard) — keeping ONE field-rendering source.
  const renderSection = (id: PropSectionId, content: ReactNode) => {
    if (!sectioned) return <Fragment key={id}>{content}</Fragment>;
    const meta = PROPERTY_FORM_SECTIONS.find(s => s.id === id)!;
    return (
      <section key={id} ref={el => registerSection?.(id, el)} data-prop-section={id} style={{ scrollMarginTop: 20 }}>
        <PropSectionHeader num={meta.num} label={meta.label} desc={meta.desc} />
        <div className="space-y-5">{content}</div>
      </section>
    );
  };
  const divider = <div className="h-px bg-[#eef1ec] my-7" />;

  return (
    <>
      {/* ══ SECTION 1 — Category & lease ══ */}
      {renderSection('cat', <>
        {/* Category — only field the user sets manually (locked once set). */}
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

        {/* Leasing model — direct / sub / management. Editable in both add & edit
            (unlike Category, which locks). Drives the Fee & VAT report's split. */}
        <div>
          <FieldLabel label="Leasing model" required />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {([
              { id: 'direct',     label: 'Direct lease',        desc: 'You own this building and lease it directly to tenants.',  attach: 'Title Deed' },
              { id: 'sub',        label: 'Sub-lease',           desc: 'You head-lease this building, then sub-lease its units.',  attach: 'Head-lease Agreement' },
              { id: 'management', label: 'Property management', desc: 'You manage this building on behalf of its owner.',         attach: 'Management Agreement' },
            ] as const).map(opt => {
              const on = value.leasingType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => upd('leasingType', opt.id)}
                  className={cn(
                    'text-left rounded-xl border px-3.5 py-3 transition-colors cursor-pointer',
                    on ? 'border-[#2e9f82] bg-[#e6f7f1]' : 'border-[#e8e6e0] bg-white hover:border-[#c5c2bc]',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('w-[18px] h-[18px] shrink-0 rounded-full border-2 flex items-center justify-center', on ? 'border-[#2e9f82]' : 'border-[#cdd5cf]')}>
                      <span className={cn('w-2 h-2 rounded-full', on ? 'bg-[#2e9f82]' : 'bg-transparent')} />
                    </span>
                    <span className={cn('text-sm font-bold', on ? 'text-[#1f6655]' : 'text-[#1a1916]')}>{opt.label}</span>
                  </span>
                  <span className="block text-[12px] text-[#7d8780] mt-1.5 leading-snug">{opt.desc}</span>
                  <span className="block text-[11px] text-[#9b9890] font-semibold mt-2">Attach · {opt.attach}</span>
                </button>
              );
            })}
          </div>

          {/* The proof-of-right document follows the leasing model: a directly-held
              building has a Title Deed; a sub-leased one has the head-lease /
              master-lease agreement; a managed one has the signed management
              agreement. All optional. */}
          <div className="mt-3">
            {value.leasingType === 'direct' ? (
              <PropertyDocCard
                label="Title Deed" multiple={false}
                description="The building's title deed — proof of ownership of this property."
                existing={existingDeed}
                queued={titleDeed ? [titleDeed] : []}
                onAdd={files => { const f = files?.[0] ?? null; if (f) setTitleDeed(f); }}
                onRemoveQueued={() => setTitleDeed(null)}
                onRemoveExisting={onRemoveExisting}
                onView={setViewerDoc}
              />
            ) : value.leasingType === 'sub' ? (
              <PropertyDocCard
                label="Head-lease / Master-lease Agreement" multiple={false}
                description="Your head-lease / master-lease agreement with the building owner — for a sub-leased property."
                existing={existingDocs.filter(d => d.documentKey === HEAD_LEASE_KEY)}
                queued={extraDocs[HEAD_LEASE_KEY] ?? []}
                onAdd={files => addSlotFiles(HEAD_LEASE_KEY, files, false)}
                onRemoveQueued={i => removeSlotFile(HEAD_LEASE_KEY, i)}
                onRemoveExisting={onRemoveExisting}
                onView={setViewerDoc}
              />
            ) : (
              <PropertyDocCard
                label="Signed Property Management Agreement" multiple={false}
                description="The signed agreement authorising you to manage this property on the owner's behalf."
                existing={existingDocs.filter(d => d.documentKey === MGMT_AGREEMENT_KEY)}
                queued={extraDocs[MGMT_AGREEMENT_KEY] ?? []}
                onAdd={files => addSlotFiles(MGMT_AGREEMENT_KEY, files, false)}
                onRemoveQueued={i => removeSlotFile(MGMT_AGREEMENT_KEY, i)}
                onRemoveExisting={onRemoveExisting}
                onView={setViewerDoc}
              />
            )}
          </div>
        </div>
      </>)}

      {sectioned && divider}

      {/* ══ SECTION 2 — Location ══ */}
      {renderSection('loc', <>
        {/* Search + Map — triggers auto-fill of all fields below */}
        <div>
          {!sectioned && <FieldLabel label="Search Building / Address" />}
          {autoFilled ? (
            <div className="flex items-center gap-2 text-xs text-[#1a7a5a] bg-[#d8f2e8] rounded-lg px-3 py-2 mb-2">
              <CheckCircle2 size={13} className="shrink-0" />
              <span>Fields auto-filled from search — review and adjust below</span>
            </div>
          ) : (!sectioned && (
            <p className="text-[10px] text-[#9b9890] mb-2">Search to auto-fill all fields below, or fill in manually</p>
          ))}
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
              <option value="">{loadingComms ? 'Loading…' : value.cityId ? 'Select Community' : 'Select Emirate first'}</option>
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
      </>)}

      {sectioned && divider}

      {/* ══ SECTION 3 — Property details ══ */}
      {renderSection('det', <>
        {/* Plot | Makani | Floors | (live unit count, edit only). Makani = Dubai's
            10-digit geo address. */}
        <div className="grid grid-cols-2 gap-3">
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
          {/* Number of units — RP-declared total for the building. The live count
              of units actually added (unitCount, edit only) shows as a hint. */}
          <div>
            <FieldLabel label="Number of units" />
            <input
              type="number" min={0} inputMode="numeric"
              className={INPUT}
              placeholder="e.g. 24"
              value={value.numberOfUnits}
              onChange={e => upd('numberOfUnits', e.target.value.replace(/[^0-9]/g, ''))}
            />
            {unitCount != null && (
              <p className="text-[11px] text-[#9b9890] mt-1">{unitCount} unit{unitCount === 1 ? '' : 's'} added so far · managed in the unit forms</p>
            )}
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
                    'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors cursor-pointer',
                    on ? 'border-[#2e9f82] bg-[#e6f7f1] text-[#1f6655]' : 'border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]',
                  )}
                >
                  {on && <Check size={12} className="shrink-0" />}
                  {feat}
                </button>
              );
            })}
          </div>
        </div>
      </>)}

      {sectioned && divider}

      {/* ══ SECTION 4 — Property documents (same slot pattern as KYC / contract docs) ══ */}
      {renderSection('doc', <>
        {!sectioned && <p className="text-[11px] font-bold uppercase tracking-wider text-[#9b9890]">Property documents</p>}

        {/* Property structure flag. The title deed / head-lease / management
            agreement itself is asked up top, driven by the leasing model. */}
        <label className="flex items-start gap-2.5 border border-[#e8e6e0] rounded-xl px-4 py-3.5 cursor-pointer hover:border-[#c5c2bc]">
          <input
            type="checkbox"
            checked={value.isStandaloneUnit}
            onChange={e => upd('isStandaloneUnit', e.target.checked)}
            className="mt-0.5 w-[18px] h-[18px] accent-[#2e9f82]"
          />
          <span>
            <span className="block text-sm font-bold text-[#1a1916]">Standalone property <span className="font-medium text-[#8a938c]">— the property is a single unit</span></span>
            <span className="block text-[11px] text-[#9b9890] mt-1 leading-relaxed">
              On — a villa or single standalone unit held as one whole (its title deed / agreement is the one above).
              Off — a multi-unit building; units are managed separately, each with its own deed in the unit form.
            </span>
          </span>
        </label>

        {/* Single-file documents — one file each (re-uploading replaces it).
            Lease-proof slots (head-lease, management agreement) live next to the
            leasing picker above, so they're excluded here. */}
        <div className="space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#a0a8a1]">Single file</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {PROPERTY_DOC_SLOTS.filter(s => !s.multiple && !LEASE_PROOF_KEYS.includes(s.key)).map(slot => (
              <PropertyDocCard
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

        {/* Multi-file documents — attach several. */}
        <div className="space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#a0a8a1]">Multiple files</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <PropertyDocCard
              label="Building Floor Plans" multiple stacked
              existing={existingDrawings}
              queued={drawings}
              onAdd={addDrawings}
              onRemoveQueued={i => setDrawings(prev => prev.filter((_, j) => j !== i))}
              onRemoveExisting={onRemoveExisting}
              onView={setViewerDoc}
            />
            {PROPERTY_DOC_SLOTS.filter(s => s.multiple).map(slot => (
              <PropertyDocCard
                key={slot.key}
                label={slot.label} multiple stacked
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
      </>)}

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

// Slide-over animation duration — keep in sync with `.slideover-panel-out` /
// `.slideover-scrim-out` in globals.css so the parent is told to unmount only
// after the swipe-out has finished playing. Shared with PropertyDetailsModal so
// both the form and the detail preview swipe out for the same length of time.
// The slide timing + close/back behaviour now live in the shared hook; re-export
// SLIDEOVER_MS so long-standing importers of it from this module keep working.
export { SLIDEOVER_MS } from '@/lib/useSlideOver';

export function PropertyFormModal({ open, initial, onClose, onSave, title, propertyId, unitCount }: Props) {
  const isEdit = !!initial?.spaceCategory;
  const [form, setForm] = useState<PropertyFormData>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof PropertyFormData, string>>>({});
  const [saving, setSaving] = useState(false);
  const [titleDeed, setTitleDeed] = useState<File | null>(null);
  const [drawings, setDrawings] = useState<File[]>([]);
  const [extraDocs, setExtraDocs] = useState<Record<string, File[]>>({});
  // Add flow only — staged building photos uploaded by the parent after the
  // property is created (Edit uses the live in-modal uploader instead).
  const [propertyPhotos, setPropertyPhotos] = useState<File[]>([]);
  const [existingDocs, setExistingDocs] = useState<PropertyDoc[]>([]);
  // Bumped each open so PropertyFields remounts and re-derives its cascade.
  const [openSeq, setOpenSeq] = useState(0);

  // Swipe-in / swipe-out: the panel slides in from the right on open. `dismiss`
  // plays the reverse slide, then tells the parent to flip `open` false. This
  // component stays mounted and toggles `open`, so the hook keys its browser-Back
  // history entry on `open` (pushed on open, cleared on close) — Back closes the
  // form instead of navigating away from the dashboard.
  const { closing, dismiss: requestClose } = useSlideOver(onClose, open);

  // Left-nav scroll-spy: the body is the scroll container; each section
  // registers its element here so clicking the nav scrolls to it and scrolling
  // highlights the section in view.
  const [activeSection, setActiveSection] = useState<PropSectionId>('cat');
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef<Partial<Record<PropSectionId, HTMLElement | null>>>({});
  const scrollingRef = useRef(false);
  const registerSection = useCallback((id: PropSectionId, el: HTMLElement | null) => {
    sectionEls.current[id] = el;
  }, []);

  const scrollToSection = (id: PropSectionId) => {
    setActiveSection(id);
    const c = bodyRef.current, el = sectionEls.current[id];
    if (!c || !el) return;
    const top = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 14;
    scrollingRef.current = true;
    c.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    window.setTimeout(() => { scrollingRef.current = false; }, 450);
  };

  const onBodyScroll = () => {
    const c = bodyRef.current;
    if (!c || scrollingRef.current) return;
    const cTop = c.getBoundingClientRect().top;
    let cur: PropSectionId = PROPERTY_FORM_SECTIONS[0].id;
    for (const s of PROPERTY_FORM_SECTIONS) {
      const el = sectionEls.current[s.id];
      if (el && el.getBoundingClientRect().top - cTop <= 80) cur = s.id;
    }
    if (c.scrollTop + c.clientHeight >= c.scrollHeight - 4) cur = 'pho';
    if (cur !== activeSection) setActiveSection(cur);
  };

  // Lightweight setup-progress signal for the sidebar bar.
  const progressPct = useMemo(() => {
    const checks = [
      !!form.spaceCategory,
      !!form.emirateId,
      !!form.buildingName.trim(),
      !!(form.latitude && form.longitude),
      !!(form.street.trim() || form.communityId),
      !!(form.sharedAmenities.length || form.propertyDescription.trim() || form.plotNumber.trim() || form.makaniNumber.trim()),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form]);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, ...initial });
    setErrors({}); setTitleDeed(null); setDrawings([]); setExtraDocs({}); setPropertyPhotos([]);
    setActiveSection('cat');
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
    if (Object.keys(errs).length > 0) {
      // Jump to the first section with a missing required field.
      scrollToSection(errs.spaceCategory ? 'cat' : 'loc');
      return;
    }
    setSaving(true);
    // Title deed travels for directly-held properties (sub-leases / managed
    // properties carry their proof doc via extraDocs instead).
    try { await onSave(form, form.leasingType === 'direct' ? titleDeed : null, drawings, extraDocs, propertyPhotos); requestClose(); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div
      className={cn('fixed inset-0 z-50 flex justify-end slideover-scrim', closing && 'closing')}
      style={{ background: 'rgba(20,30,25,0.46)' }}
      onClick={e => { if (e.target === e.currentTarget) requestClose(); }}
    >
      {/* Full-screen panel that swipes in from the right (see globals.css). */}
      <div className={cn('slideover-panel bg-white w-full h-[100dvh] flex flex-col overflow-hidden shadow-[0_24px_70px_rgba(15,30,22,0.30)]', closing && 'closing')}>

        {/* ── Header ── */}
        <header className="flex items-center gap-3.5 px-5 sm:px-6 py-4 sm:py-5 border-b border-[#eef1ec] shrink-0">
          <div className="w-[42px] h-[42px] shrink-0 rounded-xl bg-[#d8f2e8] text-[#1a7a5a] flex items-center justify-center">
            <Home size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[18px] sm:text-[20px] font-extrabold tracking-tight text-[#1a1916] leading-tight">{title ?? 'Add Property'}</h1>
            {isEdit ? (
              <p className="text-[13px] text-[#5a635c] mt-0.5 truncate">
                Editing <span className="font-bold text-[#1a1916]">{form.buildingName || 'this property'}</span>
                {form.spaceCategory && <span className="text-[#9b9890]"> · {categoryDisplayLabel(form.spaceCategory)}</span>}
              </p>
            ) : (
              <p className="text-[13px] text-[#9b9890] mt-0.5">Add once — then add units to it anytime</p>
            )}
          </div>
          <button type="button" onClick={requestClose}
            className="w-[34px] h-[34px] shrink-0 rounded-[10px] border border-[#e8e6e0] flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef] cursor-pointer transition-colors">
            <X size={18} />
          </button>
        </header>

        {/* ── Body (nav + form) + Footer, wrapped in the form ── */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div ref={bodyRef} onScroll={onBodyScroll} className="flex-1 min-h-0 overflow-y-auto flex items-start">

            {/* Left nav — scroll-spy + setup progress (hidden on small screens) */}
            <aside className="hidden md:flex flex-col gap-1 w-[210px] shrink-0 sticky top-0 self-stretch px-4 py-5 border-r border-[#eef1ec] bg-[#fbfcfb]">
              <div className="text-[10px] font-bold tracking-[0.1em] text-[#a0a8a1] px-2.5 pb-2">SECTIONS</div>
              {PROPERTY_FORM_SECTIONS.map(s => {
                const on = activeSection === s.id;
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => scrollToSection(s.id)}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13.5px] text-left cursor-pointer transition-colors',
                      on ? 'bg-[#d8f2e8] text-[#1a7a5a] font-bold' : 'text-[#5a635c] font-semibold hover:bg-[#f4f3ef]',
                    )}
                  >
                    <span className={cn('w-[26px] h-[26px] shrink-0 rounded-[8px] flex items-center justify-center text-[12px] font-bold transition-colors',
                      on ? 'bg-[#2e9f82] text-white' : 'bg-[#eef1ec] text-[#8d978f]')}>{s.num}</span>
                    <span className="flex-1">{s.label}</span>
                  </button>
                );
              })}
              <div className="mt-auto px-2.5 pt-3.5">
                <div className="text-[11px] text-[#9b9890] mb-1.5 font-semibold">Setup progress</div>
                <div className="h-1.5 rounded bg-[#edf0ec] overflow-hidden">
                  <div className="h-full bg-[#2e9f82] rounded transition-all duration-300" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="text-[10.5px] text-[#a0a8a1] mt-1.5">Required fields keep this moving.</div>
              </div>
            </aside>

            {/* Form column — content capped to a readable width and centred so a
                near-full-screen modal keeps the mock's field proportions. */}
            <div className="flex-1 min-w-0 px-5 py-5 sm:px-7 sm:py-6">
              <div className="mx-auto w-full max-w-[860px]">
                <PropertyFields
                  key={openSeq}
                  sectioned
                  registerSection={registerSection}
                  value={form} setValue={setForm}
                  errors={errors} setErrors={setErrors}
                  isEdit={isEdit}
                  titleDeed={titleDeed} setTitleDeed={setTitleDeed}
                  drawings={drawings} setDrawings={setDrawings}
                  existingDocs={existingDocs} onRemoveExisting={removeExisting}
                  unitCount={unitCount}
                  extraDocs={extraDocs} setExtraDocs={setExtraDocs}
                />

                <div className="h-px bg-[#eef1ec] my-7" />

                {/* ══ SECTION 5 — Property photos ══ Edit → live gallery (immediate
                    upload/delete/reorder). Add → staged; parent uploads after create. */}
                <section ref={el => { sectionEls.current['pho'] = el; }} data-prop-section="pho" style={{ scrollMarginTop: 20 }}>
                  <PropSectionHeader num={5} label="Property photos" desc="First image becomes the cover. Drag thumbnails to reorder." />

                  {/* Suggested shots — guides RPs to capture a complete, accurate set. */}
                  <div className="mb-4 rounded-xl border border-[#e8e6e0] bg-[#fbfcfb] px-4 py-3.5">
                    <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#1a7a5a] mb-2">
                      <Camera size={13} className="shrink-0" /> Suggested shots for an accurate listing
                    </div>
                    <ul className="flex flex-wrap gap-1.5">
                      {[
                        'Front exterior', 'Back / side exterior', 'Main entrance', 'Reception / lobby',
                        'Parking area', 'Shared amenities (pool, gym)', 'Common corridor', 'View from the building',
                      ].map(s => (
                        <li key={s} className="text-[11px] text-[#5a635c] bg-white border border-[#e8e6e0] rounded-full px-2.5 py-1">{s}</li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-[#9b9890] mt-2.5 leading-relaxed">
                      Tip: one clear photo each of the <strong>front</strong>, <strong>back/side</strong>, <strong>main entrance</strong> and <strong>reception</strong> gives tenants a complete picture. Shoot in landscape, in daylight — the first photo becomes the cover.
                    </p>
                  </div>

                  {propertyId ? (
                    <PropertyPhotos propertyId={propertyId} layout="grid" />
                  ) : (
                    <PropertyPhotos value={propertyPhotos} onChange={setPropertyPhotos} layout="grid" />
                  )}
                </section>
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <footer className="flex items-center gap-3 px-5 sm:px-6 py-4 border-t border-[#eef1ec] bg-[#fbfcfb] shrink-0">
            <span className="hidden sm:block text-[11.5px] text-[#9b9890]">You can edit everything after saving.</span>
            <div className="flex-1" />
            <button type="button" onClick={requestClose}
              className="text-sm font-bold text-[#3a443d] bg-white border border-[#e2e7e1] px-5 py-3 rounded-[11px] cursor-pointer hover:bg-[#f4f6f3] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="inline-flex items-center justify-center gap-2 text-sm font-bold text-white px-6 py-3 rounded-[11px] cursor-pointer disabled:opacity-50 transition-[filter] hover:brightness-105"
              style={{ background: '#2e9f82', boxShadow: '0 6px 16px rgba(46,159,130,0.28)' }}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Property'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
