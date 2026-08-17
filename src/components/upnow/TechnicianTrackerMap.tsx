/**
 * SP-86 · "Where is my technician?" — the customer's tracker for a live job
 * (also used by the provider's job detail). Polls GET /bookings/:id/technician-location
 * every ~10 s and draws the technician, the address and the trail on a map,
 * with distance + straight-line ETA in the strip above it.
 *
 *   ETA = max(1, round(distance × 1.3 ÷ 25 km/h)) · 0 within 75 m ("arriving")
 *   stale = last fix older than 2 min (heartbeat missed 4×)
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, MapPin, Navigation, Phone } from 'lucide-react';
import { HOME_PIN, TECH_PIN, TrackerView, decodePolyline, fmtAgo, fmtDistance, loadGoogleMapsSdk } from '@/lib/googleMaps';
import { TRACKER_IDLE_MS, useIdle, usePageVisible } from '@/lib/liveHooks';

interface Props {
  bookingId: number;
  /** Fired when the polled booking status changes (e.g. en_route → in_progress → completed). */
  onStatusChange?: (status: string) => void;
  height?: number;
}

export function TechnicianTrackerMap({ bookingId, onStatusChange, height = 260 }: Props) {
  const [view, setView] = useState<TrackerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapErr, setMapErr] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [now, setNow] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const techMarker = useRef<google.maps.Marker | null>(null);
  const homeMarker = useRef<google.maps.Marker | null>(null);
  const trailLine = useRef<google.maps.Polyline | null>(null);
  const routeLine = useRef<google.maps.Polyline | null>(null);   // SP-86b planned route (whole)
  const aheadLine = useRef<google.maps.Polyline | null>(null);   // SP-86b what's still ahead
  const fitted = useRef(false);
  const lastStatus = useRef<string | null>(null);
  // Stoppers: no polling while hidden; after 30 idle minutes pause with a Resume button.
  const visible = usePageVisible();
  const [idle, wake] = useIdle(TRACKER_IDLE_MS);
  const polling = visible && !idle;

  const poll = useCallback(
    () =>
      fetch(`/api/bookings/${bookingId}/technician-location`, { credentials: 'include', cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(r.status === 403 ? 'You cannot track this booking.' : 'Tracking is unavailable right now.'); return r.json() as Promise<TrackerView>; })
        .then((v) => {
          setView(v);
          setError(null);
          setNow(Date.now());
          if (lastStatus.current && lastStatus.current !== v.status) onStatusChange?.(v.status);
          lastStatus.current = v.status;
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Tracking is unavailable right now.')),
    [bookingId, onStatusChange],
  );

  // First poll on mount / resume, then at the server-suggested cadence (10 s live, 60 s otherwise); "x s ago" re-renders every 5 s.
  useEffect(() => { if (!polling) return; const t = setTimeout(() => { void poll(); }, 0); return () => clearTimeout(t); }, [poll, polling]);
  useEffect(() => {
    if (!polling) return;
    const ms = (view?.pollIntervalS ?? 10) * 1000;
    const id = setInterval(() => { void poll(); }, ms);
    return () => clearInterval(id);
  }, [poll, view?.pollIntervalS, polling]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);

  // Map: create once the SDK is here and we know the destination or a position.
  useEffect(() => {
    if (!view || !containerRef.current || mapRef.current) return;
    const centre = view.position ?? view.destination;
    if (!centre) return;
    let cancelled = false;
    loadGoogleMapsSdk()
      .then(() => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: centre.lat, lng: centre.lng },
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }],
        });
        setMapReady(true);
      })
      .catch((e: unknown) => setMapErr(e instanceof Error ? e.message : 'Map failed to load'));
    return () => { cancelled = true; };
  }, [view]);

  // Markers + trail follow the latest view.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !view) return;
    if (view.destination) {
      const pos = { lat: view.destination.lat, lng: view.destination.lng };
      if (!homeMarker.current) homeMarker.current = new google.maps.Marker({ map, position: pos, icon: { url: HOME_PIN, scaledSize: new google.maps.Size(34, 42), anchor: new google.maps.Point(17, 41) }, title: view.destination.addressText ?? 'Your address', zIndex: 2 });
      else homeMarker.current.setPosition(pos);
    }
    if (view.position) {
      // SP-86b: draw the technician ON the planned route when we have one and they are on it
      const pos = view.displayPosition ?? { lat: view.position.lat, lng: view.position.lng };
      const icon: google.maps.Icon = { url: TECH_PIN(view.position.stale ? '#9CA3AF' : view.status === 'in_progress' ? '#1D4ED8' : '#0B7A4E'), scaledSize: new google.maps.Size(30, 30), anchor: new google.maps.Point(15, 15) };
      if (!techMarker.current) techMarker.current = new google.maps.Marker({ map, position: pos, icon, title: view.technician?.name ?? 'Technician', zIndex: 3 });
      else { techMarker.current.setPosition(pos); techMarker.current.setIcon(icon); }
      if (view.route?.polyline) {
        const whole = decodePolyline(view.route.polyline);
        if (!routeLine.current) routeLine.current = new google.maps.Polyline({ map, path: whole, strokeColor: '#9CA3AF', strokeOpacity: 0.6, strokeWeight: 4, zIndex: 1 });
        else routeLine.current.setPath(whole);
        const ahead = view.route.ahead ?? [];
        if (!aheadLine.current) aheadLine.current = new google.maps.Polyline({ map, path: ahead, strokeColor: '#0B7A4E', strokeOpacity: 0.9, strokeWeight: 5, zIndex: 2 });
        else aheadLine.current.setPath(ahead);
        // with a route the raw trail is noise — hide it
        trailLine.current?.setMap(null); trailLine.current = null;
      } else {
        routeLine.current?.setMap(null); routeLine.current = null;
        aheadLine.current?.setMap(null); aheadLine.current = null;
        const path = view.trail.map((p) => ({ lat: p.lat, lng: p.lng }));
        if (!trailLine.current) trailLine.current = new google.maps.Polyline({ map, path, strokeColor: '#0B7A4E', strokeOpacity: 0.55, strokeWeight: 3 });
        else trailLine.current.setPath(path);
      }
      if (!fitted.current) {
        const b = new google.maps.LatLngBounds(pos);
        if (view.destination) b.extend({ lat: view.destination.lat, lng: view.destination.lng });
        map.fitBounds(b, 48);
        fitted.current = true;
      } else if (view.status === 'en_route') {
        // keep both in view without yanking the user around: only pan when the technician leaves the viewport
        const vp = map.getBounds();
        if (vp && !vp.contains(pos)) map.panTo(pos);
      }
    } else if (techMarker.current) {
      techMarker.current.setMap(null); techMarker.current = null;
      trailLine.current?.setMap(null); trailLine.current = null;
      routeLine.current?.setMap(null); routeLine.current = null;
      aheadLine.current?.setMap(null); aheadLine.current = null;
    }
  }, [view, mapReady]);

  if (error && !view) return <p className="text-xs" style={{ color: '#b42318' }}>{error}</p>;
  if (!view) return <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-neutral-400)' }}><Loader2 size={13} className="animate-spin" /> Locating your technician…</div>;

  const name = view.technician?.name ?? 'Your technician';
  const ageSec = view.position ? Math.max(view.position.ageSec, now ? Math.round((now - new Date(view.position.at).getTime()) / 1000) : 0) : null;
  const stale = !!view.position && (view.position.stale || (ageSec ?? 0) > 120);
  let headline: string;
  let sub: string | null = null;
  if (!view.live) headline = view.status === 'completed' ? `${name} finished this job.` : `Live tracking starts when ${name} sets off.`;
  else if (!view.position) { headline = `${name} is ${view.status === 'en_route' ? 'on the way' : 'at your address'}.`; sub = 'Waiting for the first location update…'; }
  else if (view.status === 'in_progress') { headline = `${name} has arrived and is working.`; sub = view.distanceM != null ? `${fmtDistance(view.distanceM)} from your address · updated ${fmtAgo(ageSec)}` : `updated ${fmtAgo(ageSec)}`; }
  else if (view.arriving) { headline = `${name} is arriving now.`; sub = `${fmtDistance(view.distanceM)} away · updated ${fmtAgo(ageSec)}`; }
  else {
    headline = `${name} is on the way${view.etaMin != null ? ` · about ${view.etaMin} min` : ''}.`;
    const routed = view.etaSource === 'route';
    sub = `${fmtDistance(view.distanceM)} ${routed ? 'by road' : 'away'} · ${routed ? (view.route?.trafficAware ? 'live traffic route' : 'planned route') : 'estimate'} · updated ${fmtAgo(ageSec)}`;
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-base-200)', background: '#fff' }}>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold inline-flex items-center gap-1.5" style={{ color: 'var(--color-neutral-900)' }}>
            <Navigation size={14} style={{ color: view.status === 'in_progress' ? '#1D4ED8' : '#0B7A4E' }} /> {headline}
          </div>
          {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>{sub}</div>}
          {stale && <div className="text-xs mt-1 inline-flex items-center gap-1" style={{ color: '#92400E' }}><AlertTriangle size={12} /> No signal from the technician&apos;s phone for a couple of minutes — last known position shown.</div>}
          {view.checkin && !view.live && (
            <div className="text-xs mt-1 inline-flex items-center gap-1" style={{ color: 'var(--color-neutral-500)' }}>
              <MapPin size={12} /> Checked in {new Date(view.checkin.at).toLocaleTimeString('en-AE', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })}{view.checkin.distanceM != null ? ` · ${fmtDistance(view.checkin.distanceM)} from your address` : ''}
            </div>
          )}
        </div>
        {view.technician?.phone && view.live && (
          <a href={`tel:${view.technician.phone}`} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary)' }}>
            <Phone size={12} /> Call
          </a>
        )}
      </div>
      {(view.position || view.destination) && view.live && (
        <div style={{ position: 'relative' }}>
          <div ref={containerRef} style={{ height, width: '100%', background: '#EEF1EE' }} />
          {mapErr && <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: 'var(--color-neutral-500)' }}>{mapErr}</div>}
        </div>
      )}
      {idle && view.live && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs" style={{ background: '#FEF6E7', color: '#7A4E06', borderTop: '1px solid #F5D9A6' }}>
          <span>Live updates paused after 30 minutes without activity.</span>
          <button type="button" onClick={wake} className="font-semibold px-2.5 py-1 rounded-lg" style={{ background: '#0B7A4E', color: '#fff' }}>Resume</button>
        </div>
      )}
      {error && <p className="px-4 pb-3 text-xs" style={{ color: '#92400E' }}>{error}</p>}
    </div>
  );
}
