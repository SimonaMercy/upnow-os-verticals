'use client';

/**
 * Searchable Google-Maps pin picker for the public booking flow.
 * Search (Places Autocomplete, UAE-restricted) OR click/drag the pin —
 * either way the formatted address + coordinates flow out via onChange.
 * Reverse-geocodes pin moves so the address line always matches the pin.
 *
 * Loads the Maps JS SDK with the `places` library via /api/maps/key
 * (public endpoint — the key must be HTTP-referrer-restricted in GCP).
 */

import { useEffect, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';

const DEFAULT_LNG = 55.2708; // Dubai
const DEFAULT_LAT = 25.2048;

let placesLoadPromise: Promise<void> | null = null;

function loadGoogleMapsPlaces(key: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const win = window as unknown as Record<string, unknown> & {
    google?: { maps?: { places?: unknown } };
  };
  if (win.google?.maps?.places) return Promise.resolve();
  if (placesLoadPromise) return placesLoadPromise;
  placesLoadPromise = new Promise<void>((resolve, reject) => {
    const cbName = '__gmp_' + Math.random().toString(36).slice(2);
    win[cbName] = () => { resolve(); delete win[cbName]; };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=${cbName}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return placesLoadPromise;
}

export interface PickedAddress {
  lat: number;
  lng: number;
  address: string;
  /** Detected emirate code (dubai, abu_dhabi, …) — null when not resolvable. */
  emirate: string | null;
}

/** administrative_area_level_1 → our emirate codes. */
const EMIRATE_CODES: [RegExp, string][] = [
  [/dubai/i, 'dubai'],
  [/abu\s*dhabi/i, 'abu_dhabi'],
  [/sharjah/i, 'sharjah'],
  [/ajman/i, 'ajman'],
  [/ras\s*al[\s-]*khaimah/i, 'rak'],
  [/fujairah/i, 'fujairah'],
  [/umm\s*al[\s-]*quwain/i, 'uaq'],
];
function emirateFromComponents(components: google.maps.GeocoderAddressComponent[] | undefined): string | null {
  const admin = components?.find((c) => c.types.includes('administrative_area_level_1'))?.long_name
    ?? components?.find((c) => c.types.includes('locality'))?.long_name;
  if (!admin) return null;
  for (const [re, code] of EMIRATE_CODES) if (re.test(admin)) return code;
  return null;
}

export function AddressMapPicker({ value, onChange, placeholder }: {
  value: PickedAddress | null;
  onChange: (picked: PickedAddress) => void;
  placeholder?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let key = '';
      try {
        const r = await fetch('/api/maps/key');
        key = ((await r.json()) as { key?: string }).key ?? '';
      } catch { /* handled below */ }
      if (!key) { if (!cancelled) setError('Map is unavailable right now — type your address below.'); return; }

      try {
        await loadGoogleMapsPlaces(key);
      } catch {
        if (!cancelled) setError('Map failed to load — type your address below.');
        return;
      }
      if (cancelled || !containerRef.current || !searchRef.current) return;

      const center = value ? { lat: value.lat, lng: value.lng } : { lat: DEFAULT_LAT, lng: DEFAULT_LNG };

      const map = new google.maps.Map(containerRef.current, {
        center,
        zoom: value ? 15 : 11,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
      });
      const marker = new google.maps.Marker({
        position: center,
        map,
        draggable: true,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#047246',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
          scale: 10,
        },
      });
      const geocoder = new google.maps.Geocoder();

      const emit = (lat: number, lng: number, address: string, emirate: string | null) =>
        onChangeRef.current({ lat, lng, address, emirate });

      const reverseGeocode = (pos: google.maps.LatLng) => {
        geocoder.geocode({ location: pos }, (results, status) => {
          const first = status === 'OK' ? results?.[0] : undefined;
          const address = first?.formatted_address ?? `${pos.lat().toFixed(5)}, ${pos.lng().toFixed(5)}`;
          if (searchRef.current) searchRef.current.value = address;
          emit(pos.lat(), pos.lng(), address, emirateFromComponents(first?.address_components));
        });
      };

      marker.addListener('dragend', () => {
        const pos = marker.getPosition();
        if (pos) reverseGeocode(pos);
      });
      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) { marker.setPosition(e.latLng); reverseGeocode(e.latLng); }
      });
      map.addListener('idle', () => { if (!cancelled) setMapLoaded(true); });

      // Search — Places Autocomplete, UAE only
      const auto = new google.maps.places.Autocomplete(searchRef.current, {
        componentRestrictions: { country: 'ae' },
        fields: ['geometry', 'formatted_address', 'name', 'address_components'],
      });
      auto.bindTo('bounds', map);
      auto.addListener('place_changed', () => {
        const place = auto.getPlace();
        const loc = place.geometry?.location;
        if (!loc) return;
        marker.setPosition(loc);
        map.panTo(loc);
        map.setZoom(16);
        const address = place.formatted_address ?? place.name ?? '';
        if (searchRef.current && address) searchRef.current.value = address;
        emit(loc.lat(), loc.lng(), address, emirateFromComponents(place.address_components));
      });

      mapRef.current = map;
      markerRef.current = marker;
      geocoderRef.current = geocoder;
    })();

    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {/* Search box (always shown; doubles as the manual field if maps fail) */}
      <div className="relative mb-2.5">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute)' }} />
        <input
          ref={searchRef}
          defaultValue={value?.address ?? ''}
          placeholder={placeholder ?? 'Search your building, street or area…'}
          className="w-full rounded-xl border-2 pl-9 pr-4 py-3 text-sm outline-none transition-colors focus:border-[#047246]"
          style={{ borderColor: 'var(--line)', background: '#fff' }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); /* let Autocomplete handle it */ }}
        />
      </div>

      {error ? (
        <div className="flex items-center justify-center rounded-[14px] border text-[12.5px] px-4 py-6 text-center"
          style={{ borderColor: 'var(--line)', color: 'var(--mute)', background: 'var(--green-tint-2)' }}>
          <MapPin size={14} className="mr-1.5 flex-shrink-0" /> {error}
        </div>
      ) : (
        <div className="relative">
          <div ref={containerRef} className="w-full rounded-[14px] overflow-hidden border" style={{ height: 260, borderColor: 'var(--line)' }} />
          {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center rounded-[14px] text-xs" style={{ background: 'var(--green-tint-2)', color: 'var(--mute)' }}>
              Loading map…
            </div>
          )}
          {value && (
            <div className="absolute top-2 left-2 bg-white rounded-lg px-2 py-1 text-[10px] font-mono shadow-sm" style={{ color: 'var(--mute)' }}>
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </div>
          )}
        </div>
      )}
      {!error && (
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--mute)' }}>
          Search, or click / drag the pin to your exact entrance.
        </p>
      )}
    </div>
  );
}
