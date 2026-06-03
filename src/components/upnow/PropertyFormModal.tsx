'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Search, MapPin, CheckCircle2, Database } from 'lucide-react';
import { MapPicker } from './MapPicker';
import { cn } from '@/lib/utils';
import { apiGet, apiPost } from '@/lib/api';

// ─── Types from backend location endpoints ────────────────
interface Country   { id: number; nameEn: string; code: string; }
interface Emirate   { id: number; nameEn: string; }
interface Community { id: number; nameEn: string; }

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
      .filter(k => k.startsWith('gp:ac:') || k.startsWith('street:'))
      .forEach(k => sessionStorage.removeItem(k));
  } catch { /* ignore */ }

  // 3. localStorage entries (same prefixes, defensive sweep)
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('gp:ac:') || k.startsWith('street:'))
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
export function BuildingSearch({
  onSelect,
  onManualEntry,
  onQueryChange,
  localSuggestions = [],
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
    setQuery(val);
    onQueryChange?.(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val, localSuggestions), 350);
  };

  // Re-open when parent updates localSuggestions (e.g. existingProps loaded async)
  useEffect(() => {
    if (query.length >= 2) setOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSuggestions]);

  // Clear cache results when query is cleared
  useEffect(() => {
    if (query.length < 2) setCacheResults([]);
  }, [query]);

  const handlePickCache = (hit: BuildingCacheResult) => {
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

// ─── Street / Address search component ───────────────────
export function StreetSearch({
  value,
  onChange,
  onCoords,
}: {
  value: string;
  onChange: (v: string) => void;
  onCoords?: (lat: number, lng: number) => void;
}) {
  const [query,       setQuery]       = useState(value);
  const [suggestions, setSuggestions] = useState<{ placeId: string; main: string; secondary: string }[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [open,        setOpen]        = useState(false);
  const debounceRef                   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef                    = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const runSearch = async (q: string) => {
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }

    // Check cache first — free
    const cacheKey = 'street:' + q;
    const cached = getAcCache(cacheKey);
    if (cached) {
      setSuggestions(cached.map(c => ({ placeId: c.placeId, main: c.main, secondary: c.secondary })));
      setOpen(true);
      return;
    }

    setLoading(true);
    try {
      type StreetItem = { placePrediction: { placeId: string; structuredFormat: { mainText: { text: string }; secondaryText?: { text: string } } } };
      const data = await apiPost<{ suggestions?: StreetItem[] }>('/places/autocomplete/street', { input: q });
      const parsed = (data.suggestions ?? []).map((s) => ({
        placeId:   s.placePrediction.placeId,
        main:      s.placePrediction.structuredFormat.mainText.text,
        secondary: s.placePrediction.structuredFormat.secondaryText?.text ?? '',
      }));
      setSuggestions(parsed);
      setAcCache(cacheKey, parsed.map((p: { placeId: string; main: string; secondary: string }) => ({ ...p, types: [] })));
      setOpen(true);
    } catch { /* silent — user can still type freely */ }
    finally { setLoading(false); }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 350);
  };

  const handlePick = async (s: { placeId: string; main: string; secondary: string }) => {
    setQuery(s.main);
    onChange(s.main);
    setOpen(false);
    if (onCoords) {
      const detail = await fetchGooglePlaceDetails(s.placeId);
      if (detail) onCoords(detail.lat, detail.lng);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890] pointer-events-none" />
        <input
          type="text"
          className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-9 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82] transition-colors"
          placeholder="e.g. Sheikh Zayed Road, Al Wasl Road…"
          value={query}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          autoComplete="off"
        />
        {loading && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#9b9890]" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-[#e8e6e0] rounded-xl shadow-xl overflow-hidden">
          <ul className="max-h-48 overflow-y-auto">
            {suggestions.map(s => (
              <li key={s.placeId}>
                <button
                  type="button"
                  className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-[#f4f3ef] border-b border-[#f0eeea] last:border-0 transition-colors"
                  onClick={() => handlePick(s)}
                >
                  <MapPin size={14} className="mt-0.5 text-[#2e9f82] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1a1916] truncate">{s.main}</p>
                    <p className="text-xs text-[#9b9890] leading-tight truncate">{s.secondary}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Space categories ─────────────────────────────────────
export const SPACE_CATEGORIES = [
  { id: 'residential', label: 'Residential', icon: '🏠', desc: 'Apartments, Villas, Townhouses' },
  { id: 'commercial',  label: 'Commercial',  icon: '🏢', desc: 'Offices, Retail, Clinics, Restaurants' },
  { id: 'industrial',  label: 'Industrial',  icon: '🏗️', desc: 'Warehouses, Cold Storage, Logistics' },
  { id: 'workspaces',  label: 'Workspaces',  icon: '💼', desc: 'Coworking, Private Offices, Meeting Rooms' },
  { id: 'venues',      label: 'Venues',      icon: '🎪', desc: 'Event Halls, Wedding Venues, Conference' },
];

export interface PropertyFormData {
  buildingName: string;
  spaceCategory: string;
  // Structured location (FK IDs) — Country → Emirate → Community
  countryId: number | null;
  emirateId: number | null;
  communityId: number | null;
  // Display labels (kept for fullAddress composition)
  countryName: string;
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
  // Google placeId — stored so backend can deduplicate building_cache entries
  googlePlaceId: string | null;
}

const EMPTY: PropertyFormData = {
  buildingName: '', spaceCategory: '',
  countryId: null, emirateId: null, communityId: null,
  countryName: '', emirateName: '', communityName: '',
  street: '', makaniNumber: '', plotNumber: '', numberOfFloors: '',
  propertyDescription: '',
  latitude: null, longitude: null,
  hasGym: false, hasPool: false, hasParking: false, isStandaloneUnit: false,
  googlePlaceId: null,
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
  const isEdit = !!initial?.spaceCategory;
  const [form, setForm] = useState<PropertyFormData>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof PropertyFormData, string>>>({});
  const [saving, setSaving] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  // Only load Google Maps SDK after a search result is selected (or in edit mode with coords)
  const [showMap, setShowMap] = useState(!!(initial?.latitude && initial?.longitude));

  // Location data
  const [countries,         setCountries]         = useState<Country[]>([]);
  const [emirates,          setEmirates]          = useState<Emirate[]>([]);
  const [communities,       setCommunities]       = useState<Community[]>([]);
  const [loadingComms,      setLoadingComms]      = useState(false);
  // Drive cascade loads independently of form state to avoid stale-closure issues
  const [loadEmiratesFor,   setLoadEmiratesFor]   = useState<number | null>(null);
  const [loadCommsFor,      setLoadCommsFor]      = useState<number | null>(null);
  const defaultCountryIdRef = useRef<number | null>(null);

  const pendingCommunityRef = useRef<string>('');

  // Load countries once on mount; auto-select UAE
  useEffect(() => {
    apiGet<Country[]>('/locations/countries').then(cs => {
      setCountries(cs);
      const ae = cs.find(c => c.code === 'AE');
      if (ae) {
        defaultCountryIdRef.current = ae.id;
        setLoadEmiratesFor(ae.id);
        setForm(prev => prev.countryId ? prev : { ...prev, countryId: ae.id, countryName: ae.nameEn });
      }
    }).catch(() => {});
  }, []);

  // Load emirates when country changes
  useEffect(() => {
    if (!loadEmiratesFor) { setEmirates([]); return; }
    apiGet<Emirate[]>(`/locations/countries/${loadEmiratesFor}/emirates`)
      .then(setEmirates).catch(() => {});
  }, [loadEmiratesFor]);

  // Reset form when modal opens — resolve names immediately from already-loaded lists
  useEffect(() => {
    if (!open) return;
    const countryId   = initial?.countryId   ?? defaultCountryIdRef.current;
    const emirateId   = initial?.emirateId   ?? null;
    const countryName = countryId ? (countries.find(c => c.id === countryId)?.nameEn ?? '') : '';
    const emirateName = emirateId ? (emirates.find(e => e.id === emirateId)?.nameEn  ?? '') : '';
    setForm({ ...EMPTY, ...initial, countryId, countryName, emirateName, communityName: '' });
    setAutoFilled(false);
    setCommunities([]);
    setLoadEmiratesFor(countryId);
    setLoadCommsFor(emirateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Community cascade — triggered by loadCommsFor (set on open and on emirate change)
  useEffect(() => {
    if (!loadCommsFor) { setCommunities([]); return; }
    setLoadingComms(true);
    apiGet<Community[]>(`/locations/emirates/${loadCommsFor}/communities`)
      .then(comms => {
        setCommunities(comms);
        // Backfill communityName for edit flow
        setForm(prev => {
          if (prev.communityId && !prev.communityName) {
            const match = comms.find(c => c.id === prev.communityId);
            if (match) return { ...prev, communityName: match.nameEn };
          }
          return prev;
        });
        // Mapbox pending community fuzzy-match
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
          console.log('[Community] pending:', pending, '| bestMatch:', bestMatch?.nameEn, '| score:', bestScore);
          console.log('[Community] all options:', comms.map(c => c.nameEn));
          if (bestMatch && bestScore >= 0.5)
            setForm(prev => ({ ...prev, communityId: bestMatch!.id, communityName: bestMatch!.nameEn }));
          pendingCommunityRef.current = '';
        }
      })
      .finally(() => setLoadingComms(false));
  }, [loadCommsFor]);

  const upd = <K extends keyof PropertyFormData>(k: K, v: PropertyFormData[K]) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setErrors(prev => ({ ...prev, [k]: undefined }));
  };

  const handleCountryChange = (val: string) => {
    const country = countries.find(c => c.id === Number(val));
    setForm(prev => ({
      ...prev,
      countryId: val ? Number(val) : null, countryName: country?.nameEn ?? '',
      emirateId: null, emirateName: '',
      communityId: null, communityName: '',
    }));
    setLoadEmiratesFor(val ? Number(val) : null);
    setLoadCommsFor(null);
    setCommunities([]);
  };

  const handleEmirateChange = (val: string) => {
    const em = emirates.find(e => e.id === Number(val));
    setForm(prev => ({
      ...prev,
      emirateId: val ? Number(val) : null, emirateName: em?.nameEn ?? '',
      communityId: null, communityName: '',
    }));
    setLoadCommsFor(val ? Number(val) : null);
    setErrors(prev => ({ ...prev, emirateId: undefined }));
  };

  const handleCommunityChange = (val: string) => {
    const comm = communities.find(c => c.id === Number(val));
    setForm(prev => ({
      ...prev,
      communityId: val ? Number(val) : null, communityName: comm?.nameEn ?? '',
    }));
  };

  const handleSearchSelect = (r: SearchResult) => {
    // When result carries direct IDs (from building_cache), use them as-is.
    // Otherwise fall back to name-matching against loaded emirates list.
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
      // Direct community ID from cache — no fuzzy match needed
      pendingCommunityRef.current = '';
      setForm(prev => ({
        ...prev,
        ...(r.featureType === 'poi'  && r.name   && { buildingName: r.name }),
        ...(r.featureType !== 'area' && r.street && { street: r.street }),
        latitude:      r.lat || prev.latitude,
        longitude:     r.lng || prev.longitude,
        emirateId:     newEmirateId,
        emirateName,
        communityId:   r.communityId ?? null,
        communityName: '',  // backfilled by cascade after communities load
        googlePlaceId: r.googlePlaceId ?? prev.googlePlaceId,
      }));
    } else {
      pendingCommunityRef.current = r.communityName;
      setForm(prev => ({
        ...prev,
        ...(r.featureType === 'poi'  && r.name   && { buildingName: r.name }),
        ...(r.featureType !== 'area' && r.street && { street: r.street }),
        latitude:      r.lat || prev.latitude,
        longitude:     r.lng || prev.longitude,
        emirateId:     newEmirateId,
        emirateName,
        communityId:   null,
        communityName: '',
        // For Google results, r.id === placeId; for local/cache results it has a prefix
        googlePlaceId: r.googlePlaceId != null
          ? r.googlePlaceId
          : (!r.id.startsWith('cache_') && !r.id.startsWith('local_') ? r.id : prev.googlePlaceId),
      }));
    }

    setLoadCommsFor(newEmirateId);
    setAutoFilled(true);
    setShowMap(true);
    setErrors(prev => ({ ...prev, buildingName: undefined, emirateId: undefined }));
  };

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!form.spaceCategory) errs.spaceCategory = 'Required';
    if (!form.emirateId)     errs.emirateId = 'Required';
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

          {/* Category — only field the user sets manually */}
          <div>
            <FieldLabel label="Category" required />
            {isEdit ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e8e6e0] bg-[#f4f3ef] text-sm text-[#3d3b35]">
                <span className="flex-1 capitalize">{SPACE_CATEGORIES.find(c => c.id === form.spaceCategory)?.label ?? form.spaceCategory}</span>
                <span className="text-[10px] text-[#9b9890] font-medium">Locked</span>
              </div>
            ) : (
              <>
                <select className={cn(SELECT, errors.spaceCategory && 'border-red-400')}
                  value={form.spaceCategory} onChange={e => upd('spaceCategory', e.target.value)}>
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
                latitude={form.latitude} longitude={form.longitude}
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

          {/* Country | Emirate | Community — auto-filled from search */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel label="Country" required />
              <select
                className={SELECT}
                value={form.countryId ?? ''}
                onChange={e => handleCountryChange(e.target.value)}
              >
                <option value="">Select Country</option>
                {countries.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel label="Emirate / Region" required />
              <select
                className={cn(SELECT, errors.emirateId && 'border-red-400', !form.countryId && DISABLED_CLS)}
                value={form.emirateId ?? ''}
                onChange={e => handleEmirateChange(e.target.value)}
                disabled={!form.countryId}
              >
                <option value="">{form.countryId ? 'Select Emirate' : 'Select Country first'}</option>
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

          {/* Building Name | Street — auto-filled from search */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="Building / Property Name" />
              <input
                className={cn(INPUT, errors.buildingName && 'border-red-400')}
                placeholder="e.g. Al Safa Tower, Palm Residences"
                value={form.buildingName}
                onChange={e => upd('buildingName', e.target.value)}
              />
              {errors.buildingName && <p className="text-xs text-red-500 mt-1">{errors.buildingName}</p>}
            </div>
            <div>
              <FieldLabel label="Street / Address" />
              <StreetSearch
                value={form.street}
                onChange={v => upd('street', v)}
                onCoords={(lat, lng) => { upd('latitude', lat); upd('longitude', lng); }}
              />
            </div>
          </div>

          {/* Plot Number — manual only */}
          <div>
            <FieldLabel label="Plot Number" />
            <input className={INPUT} placeholder="e.g. PLOT-12345" value={form.plotNumber}
              onChange={e => upd('plotNumber', e.target.value)} />
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
