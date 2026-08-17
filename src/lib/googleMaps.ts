/**
 * Google Maps JS SDK loader shared by the SP-86 map surfaces (customer tracker,
 * provider live map). Key is server-only — fetched from /api/maps/key at
 * runtime, never bundled. Same singleton pattern as MapPicker.tsx.
 */
let sdkPromise: Promise<void> | null = null;

export async function loadGoogleMapsSdk(): Promise<void> {
  if (typeof window === 'undefined') return;
  const win = window as unknown as Record<string, unknown> & { google?: { maps?: { Map?: unknown } } };
  if (win.google?.maps?.Map) return;
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    const r = await fetch('/api/maps/key', { credentials: 'include' });
    const { key } = (await r.json()) as { key?: string };
    if (!key) throw new Error('Map key not configured');
    await new Promise<void>((resolve, reject) => {
      const cbName = '__gm_' + Math.random().toString(36).slice(2);
      win[cbName] = () => { resolve(); delete win[cbName]; };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${cbName}`;
      s.async = true;
      s.onerror = () => reject(new Error('Google Maps failed to load'));
      document.head.appendChild(s);
    });
  })();
  sdkPromise.catch(() => { sdkPromise = null; });
  return sdkPromise;
}

/** Shared tracker payload (mirrors TechnicianPresenceService.trackerFor). */
export interface TrackerView {
  bookingId: number; code: string; status: string; live: boolean; serviceName: string | null; scheduledAt: string | null;
  destination: { lat: number; lng: number; addressText: string | null } | null;
  technician: { id: number; name: string | null; phone: string | null; photoUrl: string | null } | null;
  presence: 'offline' | 'available' | 'on_job' | 'on_break' | 'unavailable' | null;
  position: { lat: number; lng: number; accuracyM: number | null; heading: number | null; at: string; ageSec: number; stale: boolean } | null;
  distanceM: number | null; distanceSource?: 'route' | 'estimate'; etaMin: number | null; etaSource?: 'route' | 'estimate' | null; arriving: boolean;
  /** SP-86b: where to draw the technician (snapped to the planned route when on it) */
  displayPosition?: { lat: number; lng: number } | null;
  /** SP-86b: the planned route (Google Routes API, cached server-side) — null when not fetched / disabled */
  route?: {
    source: 'google'; fetchedAt: string; ageS: number; trafficAware: boolean; totalM: number; durationS: number;
    polyline: string; snapped: { lat: number; lng: number } | null; onRoute: boolean; deviationM: number | null; remainingM: number | null; etaMin: number | null;
    ahead: Array<{ lat: number; lng: number }>;
  } | null;
  trail: Array<{ lat: number; lng: number; at: string }>;
  checkin: { at: string; source: string | null; lat: number | null; lng: number | null; distanceM: number | null } | null;
  pollIntervalS: number;
}

export const fmtDistance = (m: number | null | undefined) =>
  m == null ? '—' : m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;

export const fmtAgo = (sec: number | null | undefined) =>
  sec == null ? '' : sec < 5 ? 'just now' : sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.round(sec / 60)} min ago` : `${Math.round(sec / 3600)} h ago`;

/** SVG data-URI pin used for the destination (house) marker. */
export const HOME_PIN = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path d="M17 41C17 41 3 24.5 3 15a14 14 0 1 1 28 0c0 9.5-14 26-14 26z" fill="#182420"/><path d="M10 17.5l7-6 7 6v7h-5v-5h-4v5h-5z" fill="#fff"/></svg>`,
);
/** SVG data-URI for the technician (van/dot) marker; rotate via the heading. */
export const TECH_PIN = (color = '#0B7A4E') => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="${color}" stroke="#fff" stroke-width="3"/><path d="M15 7l5 10h-10z" fill="#fff"/></svg>`,
);

/** Google encoded polyline → points (client-side twin of the backend decoder). */
export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const pts: Array<{ lat: number; lng: number }> = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, b: number;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index <= encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index <= encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}
