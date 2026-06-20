'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, X, Image as ImageIcon, Pencil, ArrowRight } from 'lucide-react';
import { categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';

const DEFAULT_LAT = 25.2048;
const DEFAULT_LNG = 55.2708;

// Singleton loader — only injects the script tag once per page
let mapsLoadPromise: Promise<void> | null = null;

function loadGoogleMaps(key: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const win = window as unknown as Record<string, unknown> & { google?: { maps?: { Map?: unknown } } };
  if (win.google?.maps?.Map) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;
  mapsLoadPromise = new Promise<void>((resolve, reject) => {
    const cbName = '__gm_' + Math.random().toString(36).slice(2);
    win[cbName] = () => {
      resolve();
      delete win[cbName];
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=${cbName}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return mapsLoadPromise;
}

interface PortfolioMapProperty {
  id: number;
  buildingName: string;
  latitude: number | null;
  longitude: number | null;
  fullAddress?: string | null;
  unitCount?: number;
  occupiedCount?: number;
  // Optional richer fields used by the on-click detail card.
  coverPhotoUrl?: string | null;
  spaceCategory?: string;
  rentTotal?: number;
}

// Occupancy-coloured pin. Colours are picked to stand off the Google Maps
// default base layers (pale-green parks / pale-orange highways / beige land)
// rather than blend into them, and to stay distinct for colour-blind users:
//   cobalt blue  = fully occupied   (vs pale-blue water — far darker)
//   magenta      = has vacancies    (no analog anywhere on a road map = "alert")
//   charcoal     = no unit data     (neutral / unknown)
const PIN_OCCUPIED = '#1B4DB1';
const PIN_VACANCY  = '#C026A3';
const PIN_NODATA   = '#3F3F46';
function pinColour(p: PortfolioMapProperty): string {
  const occ = p.occupiedCount ?? null;
  const tot = p.unitCount ?? null;
  if (tot == null || tot === 0) return PIN_NODATA;
  return occ != null && occ >= tot ? PIN_OCCUPIED : PIN_VACANCY;
}

// Teardrop pin rendered as an inline SVG (data URI) so it can carry a real
// drop shadow — that halo is what lifts the pin off any underlying map colour.
// Tip anchors on the coordinate; the unit-count label sits in the round head.
// Selected pins are larger + outlined heavier so the chosen property pops.
function makeIcon(colour: string, selected: boolean): google.maps.Icon {
  const w = selected ? 46 : 36;
  const h = w * 1.3; // viewBox is 40×52 → keep the 1.3 aspect ratio
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 40 52">` +
    `<defs><filter id="ds" x="-40%" y="-20%" width="180%" height="150%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.45"/>` +
    `</filter></defs>` +
    `<path filter="url(#ds)" d="M20 4 C12 4 6 10 6 18 C6 28 20 46 20 46 C20 46 34 28 34 18 C34 10 28 4 20 4 Z" ` +
    `fill="${colour}" stroke="#ffffff" stroke-width="${selected ? 3 : 2.5}"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(w / 2, w * 1.15),       // tip (vb 20,46)
    labelOrigin: new google.maps.Point(w / 2, w * 0.425), // head centre (vb 20,17)
  };
}

/**
 * Inline portfolio map. Renders full-width; clicking a pin surfaces a floating
 * detail card (cover · occupancy · rent) with View-details / Edit actions
 * wired through the optional callbacks.
 */
export function PortfolioMapView({
  properties,
  heightClass = 'h-[70vh]',
  onViewDetails,
  onEdit,
}: {
  properties: PortfolioMapProperty[];
  heightClass?: string;
  onViewDetails?: (id: number) => void;
  onEdit?: (id: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Array<{ id: number; marker: google.maps.Marker; colour: string }>>([]);
  const [ready, setReady] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const missing = properties.filter(
    (p) => !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude)) || p.latitude == null || p.longitude == null,
  );
  const selected = selectedId != null ? properties.find((p) => p.id === selectedId) ?? null : null;

  // Create the map once. A click on empty map dismisses the detail card.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let key: string;
      try {
        const r = await fetch('/api/maps/key', { credentials: 'include' });
        const data = (await r.json()) as { key?: string };
        key = data.key ?? '';
      } catch {
        if (!cancelled) setError('Map unavailable');
        return;
      }
      if (!key) {
        if (!cancelled) setError('Map unavailable');
        return;
      }

      try {
        await loadGoogleMaps(key);
      } catch (err) {
        if (!cancelled) {
          setError('Map unavailable');
          console.error(err);
        }
        return;
      }

      if (cancelled || !containerRef.current) return;

      const map = new google.maps.Map(containerRef.current, {
        center: { lat: DEFAULT_LAT, lng: DEFAULT_LNG },
        zoom: 10,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      map.addListener('idle', () => { if (!cancelled) setMapLoaded(true); });
      map.addListener('click', () => { if (!cancelled) setSelectedId(null); });

      mapRef.current = map;
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.marker.setMap(null));
      markersRef.current = [];
      mapRef.current = null;
    };
  }, []);

  // (Re)build markers whenever the property set changes — so the map stays in
  // sync with the search / category filters. Keyed on a stable signature so it
  // doesn't churn on every parent re-render.
  const sig = properties
    .map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.unitCount ?? ''}:${p.occupiedCount ?? ''}`)
    .join('|');
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    // A rebuild (filter change) can drop the selected property — clear it.
    setSelectedId(null);

    markersRef.current.forEach((m) => m.marker.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    const built: Array<{ id: number; marker: google.maps.Marker; colour: string }> = [];

    for (const property of properties) {
      const lat = Number(property.latitude);
      const lng = Number(property.longitude);
      if (property.latitude == null || property.longitude == null) continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const position = { lat, lng };
      const colour = pinColour(property);
      const tot = property.unitCount ?? null;
      const marker = new google.maps.Marker({
        position,
        map,
        title: property.buildingName,
        label: tot ? { text: String(tot), color: '#ffffff', fontSize: '11px', fontWeight: '700' } : undefined,
        icon: makeIcon(colour, false),
        optimized: false,
      });

      marker.addListener('click', () => {
        setSelectedId(property.id);
        map.panTo(position);
      });

      bounds.extend(position);
      built.push({ id: property.id, marker, colour });
    }

    if (built.length > 1) {
      map.fitBounds(bounds);
    } else if (built.length === 1) {
      const pos = built[0].marker.getPosition();
      if (pos) map.setCenter(pos);
      map.setZoom(15);
    }
    // none: keep Dubai default center/zoom

    markersRef.current = built;
    // `sig` is the stable trigger; `properties` is read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sig]);

  // Highlight the selected pin (larger + raised) without rebuilding markers.
  useEffect(() => {
    for (const m of markersRef.current) {
      const sel = m.id === selectedId;
      m.marker.setIcon(makeIcon(m.colour, sel));
      m.marker.setZIndex(sel ? 999 : undefined);
    }
  }, [selectedId]);

  return (
    <div>
      <div className={`relative ${heightClass}`}>
        {error ? (
          <div className="h-full w-full rounded-xl bg-[#f4f3ef] border border-[#e8e6e0] flex items-center justify-center text-sm text-[#9b9890]">
            <MapPin size={16} className="mr-2 text-[#c9c7c1]" />
            {error}
          </div>
        ) : (
          <>
            <div ref={containerRef} className="h-full w-full rounded-xl overflow-hidden border border-[#e8e6e0]" />
            {!mapLoaded && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#f4f3ef] text-xs text-[#9b9890]">
                <Loader2 size={16} className="mr-2 animate-spin text-[#2e9f82]" />
                Loading map…
              </div>
            )}

            {/* Floating detail card — shown when a pin is clicked. */}
            {selected && (
              <MapDetailCard
                key={selected.id}
                property={selected}
                onClose={() => setSelectedId(null)}
                onViewDetails={onViewDetails}
                onEdit={onEdit}
              />
            )}
          </>
        )}
      </div>

      {missing.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#e8e6e0] bg-[#fef3c7] px-3 py-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#fef3c7] text-[#854d0e] border border-[#854d0e]/20 shrink-0 mt-0.5">
            {missing.length} unpinned
          </span>
          <p className="text-xs text-[#854d0e]">
            {missing.length} {missing.length === 1 ? 'property has' : 'properties have'} no map pin yet — set
            their location in the edit form: {missing.map((p) => p.buildingName).join(', ')}.
          </p>
        </div>
      )}
      {/* Pin legend */}
      <div className="flex items-center gap-4 mt-2 text-[11px] text-[#6b6860] flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#1B4DB1] border-2 border-white shadow" /> Fully occupied</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#C026A3] border-2 border-white shadow" /> Has vacancies</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#3F3F46] border-2 border-white shadow" /> No unit data</span>
        <span className="text-[#9b9890]">· number on the pin = units · tap a pin for details</span>
      </div>
    </div>
  );
}

// ─── Floating detail card (rendered over the map on pin click) ────────────
function MapDetailCard({
  property,
  onClose,
  onViewDetails,
  onEdit,
}: {
  property: PortfolioMapProperty;
  onClose: () => void;
  onViewDetails?: (id: number) => void;
  onEdit?: (id: number) => void;
}) {
  const total = property.unitCount ?? null;
  const occupied = property.occupiedCount ?? null;
  const vacant = total != null && occupied != null ? Math.max(0, total - occupied) : null;
  const hasPin = property.latitude != null && property.longitude != null;

  return (
    <div
      className="absolute left-3 bottom-3 right-3 sm:right-auto sm:w-[330px] z-10 overflow-hidden rounded-2xl bg-white"
      style={{ boxShadow: '0 10px 34px -8px rgba(0,0,0,0.28)' }}
    >
      {/* Cover */}
      <div className="relative h-32 w-full bg-[#f1efe9]">
        {property.coverPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={property.coverPhotoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-[#c5c3bc]">
            <ImageIcon size={26} />
            <span className="mt-1 text-[10px]">No photo</span>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-[#57544d] shadow hover:bg-white"
        >
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1.5 p-3.5">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#1a1916]">{property.buildingName}</h3>
          {property.spaceCategory && (
            <span className="shrink-0 rounded-full bg-[#f1efe9] px-2 py-0.5 text-[11px] font-semibold text-[#57544d]">
              {categoryDisplayLabel(property.spaceCategory)}
            </span>
          )}
        </div>

        {(property.fullAddress || hasPin) && (
          <p className="flex items-center gap-1 truncate text-xs text-[#6b6860]">
            <MapPin size={12} className="shrink-0" style={{ color: hasPin ? '#2e9f82' : '#c5c3bc' }} />
            {property.fullAddress ?? 'Pinned on map'}
          </p>
        )}

        {(occupied != null || vacant != null) && (
          <div className="flex items-center gap-3 text-xs text-[#57544d]">
            {occupied != null && (
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#2e9f82]" />{occupied} occupied</span>
            )}
            {vacant != null && (
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#d97706]" />{vacant} vacant</span>
            )}
          </div>
        )}

        {property.rentTotal != null && property.rentTotal > 0 && (
          <div className="whitespace-nowrap">
            <span className="text-lg font-bold text-[#2e9f82]">AED {Math.round(property.rentTotal).toLocaleString('en-AE')}</span>
            <span className="ml-0.5 text-xs text-[#6b6860]">/yr</span>
          </div>
        )}

        {(onViewDetails || onEdit) && (
          <div className="mt-1.5 flex items-center gap-2">
            {onViewDetails && (
              <button
                type="button"
                onClick={() => onViewDetails(property.id)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#2e9f82] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#268a70]"
              >
                View details <ArrowRight size={14} />
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(property.id)}
                aria-label="Edit property"
                title="Edit property"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]"
              >
                <Pencil size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
