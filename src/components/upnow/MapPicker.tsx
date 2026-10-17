'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

const DEFAULT_LNG = 55.2708;
const DEFAULT_LAT = 25.2048;

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

interface MapPickerProps {
  latitude?: number | null;
  longitude?: number | null;
  onChange: (lat: number, lng: number) => void;
}

export function MapPicker({ latitude, longitude, onChange }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<google.maps.Map | null>(null);
  const markerRef    = useRef<google.maps.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const initLat = latitude  ?? DEFAULT_LAT;
  const initLng = longitude ?? DEFAULT_LNG;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let key: string;
      try {
        const r = await fetch('/api/maps/key', { credentials: 'include' });
        const data = await r.json() as { key?: string };
        key = data.key ?? '';
      } catch {
        if (!cancelled) setError('Failed to fetch map key');
        return;
      }
      if (!key) { if (!cancelled) setError('Map key not configured'); return; }

      try {
        await loadGoogleMaps(key);
      } catch (err) {
        if (!cancelled) { setError('Failed to load map. Check your Google Maps key.'); console.error(err); }
        return;
      }

      if (cancelled || !containerRef.current) return;

      const center = { lat: initLat, lng: initLng };

      const map = new google.maps.Map(containerRef.current, {
        center,
        zoom: latitude && longitude ? 14 : 10,
        mapTypeControl:    false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl:       true,
        styles: [
          { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        ],
      });

      const marker = new google.maps.Marker({
        position: center,
        map,
        draggable: true,
        icon: {
          path:        google.maps.SymbolPath.CIRCLE,
          fillColor:   '#047246',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
          scale:       10,
        },
      });

      marker.addListener('dragend', () => {
        const pos = marker.getPosition();
        if (pos) onChange(pos.lat(), pos.lng());
      });

      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          marker.setPosition(e.latLng);
          onChange(e.latLng.lat(), e.latLng.lng());
        }
      });

      map.addListener('idle', () => { if (!cancelled) setMapLoaded(true); });

      mapRef.current    = map;
      markerRef.current = marker;
    })();

    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current    = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external lat/lng (e.g. from autocomplete selection)
  useEffect(() => {
    if (latitude != null && longitude != null && markerRef.current && mapRef.current) {
      const pos = { lat: latitude, lng: longitude };
      markerRef.current.setPosition(pos);
      mapRef.current.panTo(pos);
      mapRef.current.setZoom(15);
    }
  }, [latitude, longitude]);

  if (error) {
    return (
      <div className="flex items-center justify-center bg-[#eef1ef] rounded-xl h-[220px] text-sm text-[#8a948d]">
        <MapPin size={16} className="mr-2 text-[#c9c7c1]" />
        {error}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden border border-[#e4e9e5]"
        style={{ height: 220 }}
      />
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#eef1ef] rounded-xl text-xs text-[#8a948d]">
          Loading map…
        </div>
      )}
      {latitude != null && longitude != null && (
        <div className="absolute top-2 left-2 bg-white rounded-lg px-2 py-1 text-xs font-mono text-[#5f6b63] shadow-sm">
          {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}
        </div>
      )}
      <p className="text-xs text-[#8a948d] mt-1.5">
        Click on the map or drag the pin to set the exact location.
      </p>
    </div>
  );
}
