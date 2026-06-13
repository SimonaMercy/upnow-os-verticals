'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, X } from 'lucide-react';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface PortfolioMapProperty {
  id: number;
  buildingName: string;
  latitude: number | null;
  longitude: number | null;
  fullAddress?: string | null;
  unitCount?: number;
  occupiedCount?: number;
}

interface PortfolioMapModalProps {
  properties: PortfolioMapProperty[];
  onClose: () => void;
}

export function PortfolioMapModal({ properties, onClose }: PortfolioMapModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = properties.filter(
    (p) => !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude)) || p.latitude == null || p.longitude == null,
  );

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
      });

      const infoWindow = new google.maps.InfoWindow();
      const bounds = new google.maps.LatLngBounds();
      const markers: google.maps.Marker[] = [];

      for (const property of properties) {
        const lat = Number(property.latitude);
        const lng = Number(property.longitude);
        if (property.latitude == null || property.longitude == null) continue;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const position = { lat, lng };
        // Occupancy-coloured pin: jade = fully occupied, amber = has
        // vacancies, grey = no unit data. Label = unit count.
        const occ = property.occupiedCount ?? null;
        const tot = property.unitCount ?? null;
        const colour = tot == null || tot === 0 ? '#9b9890'
          : occ != null && occ >= tot ? '#2e9f82'
          : '#d97706';
        const marker = new google.maps.Marker({
          position,
          map,
          title: property.buildingName,
          label: tot ? { text: String(tot), color: '#ffffff', fontSize: '11px', fontWeight: '700' } : undefined,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: colour,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2.5,
          },
        });

        const parts: string[] = [
          `<div style="font-weight:700;font-size:13px;color:#1a1916;margin-bottom:2px;">${escapeHtml(property.buildingName)}</div>`,
        ];
        if (property.fullAddress) {
          parts.push(
            `<div style="font-size:11px;color:#6b6860;margin-bottom:4px;">${escapeHtml(property.fullAddress)}</div>`,
          );
        }
        if (property.unitCount != null || property.occupiedCount != null) {
          const counts: string[] = [];
          if (property.unitCount != null) counts.push(`${property.unitCount} unit${property.unitCount === 1 ? '' : 's'}`);
          if (property.occupiedCount != null) counts.push(`${property.occupiedCount} occupied`);
          parts.push(`<div style="font-size:11px;color:#6b6860;margin-bottom:4px;">${counts.join(' · ')}</div>`);
        }
        parts.push(
          `<a href="/rental-provider/dashboard/portfolio/${property.id}" style="font-size:12px;font-weight:600;color:#2e9f82;text-decoration:none;">Open details</a>`,
        );

        marker.addListener('click', () => {
          infoWindow.setContent(`<div style="font-family:inherit;max-width:240px;padding:2px;">${parts.join('')}</div>`);
          infoWindow.open({ map, anchor: marker });
        });

        bounds.extend(position);
        markers.push(marker);
      }

      if (markers.length > 1) {
        map.fitBounds(bounds);
      } else if (markers.length === 1) {
        const pos = markers[0].getPosition();
        if (pos) map.setCenter(pos);
        map.setZoom(15);
      }
      // none: keep Dubai default center/zoom

      map.addListener('idle', () => {
        if (!cancelled) setMapLoaded(true);
      });

      mapRef.current = map;
      markersRef.current = markers;
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-bold text-[#1a1916] flex items-center gap-2">
            <MapPin size={18} className="text-[#2e9f82]" />
            Portfolio map
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#f4f3ef] flex items-center justify-center text-[#6b6860]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-auto px-6 pb-6">
          <div className="relative h-[70vh]">
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
          <div className="flex items-center gap-4 mt-2 text-[11px] text-[#6b6860]">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#2e9f82] border-2 border-white shadow" /> Fully occupied</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#d97706] border-2 border-white shadow" /> Has vacancies</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#9b9890] border-2 border-white shadow" /> No unit data</span>
            <span className="text-[#9b9890]">· number on the pin = units</span>
          </div>
        </div>
      </div>
    </div>
  );
}
