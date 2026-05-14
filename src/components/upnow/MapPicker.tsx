'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';

interface MapPickerProps {
  latitude?: number | null;
  longitude?: number | null;
  onChange: (lat: number, lng: number) => void;
}

// Dubai city centre as default
const DEFAULT_LNG = 55.2708;
const DEFAULT_LAT = 25.2048;

export function MapPicker({ latitude, longitude, onChange }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initLng = longitude ?? DEFAULT_LNG;
  const initLat = latitude ?? DEFAULT_LAT;

  useEffect(() => {
    if (!containerRef.current) return;

    // Mapbox token from env — NEXT_PUBLIC_ prefix exposes it to the browser
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setError('NEXT_PUBLIC_MAPBOX_TOKEN is not set');
      return;
    }

    let map: mapboxgl.Map;
    let marker: mapboxgl.Marker;

    (async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;
        await import('mapbox-gl/dist/mapbox-gl.css');

        mapboxgl.accessToken = token;

        map = new mapboxgl.Map({
          container: containerRef.current!,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [initLng, initLat],
          zoom: latitude && longitude ? 14 : 10,
        });

        map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

        // Drop a draggable marker
        const el = document.createElement('div');
        el.style.cssText =
          'width:32px;height:32px;background:#2e9f82;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:grab';

        marker = new mapboxgl.Marker({ element: el, draggable: true })
          .setLngLat([initLng, initLat])
          .addTo(map);

        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat();
          onChange(lat, lng);
        });

        // Click on map to move marker
        map.on('click', (e) => {
          const { lng, lat } = e.lngLat;
          marker.setLngLat([lng, lat]);
          onChange(lat, lng);
        });

        map.on('load', () => setMapLoaded(true));

        mapRef.current = map;
        markerRef.current = marker;
      } catch (err) {
        setError('Failed to load map. Check your Mapbox token.');
        console.error(err);
      }
    })();

    return () => {
      markerRef.current?.remove();
      mapRef.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external lat/lng changes to marker (e.g., geocoding result)
  useEffect(() => {
    if (latitude != null && longitude != null && markerRef.current) {
      markerRef.current.setLngLat([longitude, latitude]);
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 14 });
    }
  }, [latitude, longitude]);

  if (error) {
    return (
      <div className="flex items-center justify-center bg-[#f4f3ef] rounded-xl h-[220px] text-sm text-[#9b9890]">
        <MapPin size={16} className="mr-2 text-[#c9c7c1]" />
        {error}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden border border-[#e8e6e0]"
        style={{ height: 220 }}
      />
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#f4f3ef] rounded-xl text-xs text-[#9b9890]">
          Loading map…
        </div>
      )}
      {latitude != null && longitude != null && (
        <div className="absolute top-2 left-2 bg-white rounded-lg px-2 py-1 text-xs font-mono text-[#6b6860] shadow-sm">
          {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}
        </div>
      )}
      <p className="text-xs text-[#9b9890] mt-1.5">
        Click on the map or drag the pin to set the exact location.
      </p>
    </div>
  );
}
