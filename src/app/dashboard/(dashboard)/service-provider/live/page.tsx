/**
 * SP · Live map (SP-86) — every technician on my roster, right now: presence
 * (Available · On a job · On break · Offline), last known position, the live
 * job they are driving (with distance + ETA), and the owner's overrides
 * (force offline / put on break / clear). Polls GET /service-provider/technicians/live
 * every 10 s; markers move on the map, the list on the right stays in sync.
 *
 * Presence rule (server-side, mirrored in the legend): offline if the app
 * hasn't heartbeated for 2 min or the technician / owner set offline; on break
 * until the break ends; on a job while an assignment is en_route / in_progress;
 * otherwise available.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Coffee, Loader2, MapPin, Navigation, Phone, Power, Radio, RefreshCw } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { HOME_PIN, TECH_PIN, fmtAgo, fmtDistance, loadGoogleMapsSdk } from '@/lib/googleMaps';
import { LIVE_MAP_IDLE_MS, useIdle, usePageVisible } from '@/lib/liveHooks';

type Presence = 'offline' | 'available' | 'on_job' | 'on_break' | 'unavailable';
interface LiveTech {
  technicianId: number; name: string | null; phone: string | null; photoUrl: string | null; specialization: string | null; rosterStatus: string | null;
  presence: Presence; storedPresence: Presence; presenceSetBy: 'technician' | 'provider' | 'system' | null; breakUntil: string | null;
  lastPingAt: string | null; ageSec: number | null; lastStatusChangeAt: string | null;
  position: { lat: number; lng: number; accuracyM: number | null; heading: number | null; at: string | null } | null;
  displayPosition?: { lat: number; lng: number } | null;
  liveJob: { bookingId: number; code: string; status: string; serviceName: string | null; addressText: string | null; addressLat: number | null; addressLng: number | null; scheduledAt: string | null; distanceM: number | null; etaMin: number | null; etaSource?: 'route' | 'estimate' | null } | null;
}
interface LiveMap { serviceProviderId: number; asOf: string; heartbeatTimeoutS: number; pollIntervalS: number; counts: Record<Presence, number>; technicians: LiveTech[] }

const GREEN = '#0B7A4E'; const INK = '#182420'; const MUTE = '#55645B'; const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2'; const CANVAS = '#F5F7F4';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });
const UI: Record<Presence, { label: string; color: string; bg: string }> = {
  available:   { label: 'Available',   color: GREEN,     bg: '#E9F4EE' },
  on_job:      { label: 'On a job',    color: '#1D4ED8', bg: '#E6F0FB' },
  on_break:    { label: 'On break',    color: '#D97706', bg: '#FEF6E7' },
  offline:     { label: 'Offline',     color: '#9CA3AF', bg: '#F3F4F6' },
  unavailable: { label: 'Unavailable', color: '#9CA3AF', bg: '#F3F4F6' },
};
const ORDER: Presence[] = ['on_job', 'available', 'on_break', 'offline', 'unavailable'];
const DUBAI = { lat: 25.2048, lng: 55.2708 };

export default function SpLiveMapPage() {
  const [data, setData] = useState<LiveMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [filter, setFilter] = useState<Presence | 'all'>('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [mapErr, setMapErr] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [now, setNow] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markers = useRef<Map<number, google.maps.Marker>>(new Map());
  const homes = useRef<Map<number, google.maps.Marker>>(new Map());
  const fitted = useRef(false);
  // Stoppers: no polling while the tab is hidden, and none after 30 min without interaction (Resume button).
  const visible = usePageVisible();
  const [idle, wake] = useIdle(LIVE_MAP_IDLE_MS);
  const polling = visible && !idle;

  const load = useCallback(
    () => apiGet<LiveMap>('/service-provider/technicians/live')
      .then((d) => { setData(d); setError(null); setNow(Date.now()); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the live map')),
    [],
  );
  // First load, and a fresh load whenever polling resumes (tab shown / Resume clicked)
  useEffect(() => { if (!polling) return; const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load, polling]);
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => { void load(); }, (data?.pollIntervalS ?? 10) * 1000);
    return () => clearInterval(id);
  }, [load, data?.pollIntervalS, polling]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);

  // Map init
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    let cancelled = false;
    loadGoogleMapsSdk().then(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      mapRef.current = new google.maps.Map(containerRef.current, { center: DUBAI, zoom: 10, disableDefaultUI: true, zoomControl: true, clickableIcons: false, styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }] });
      setMapReady(true);
    }).catch((e: unknown) => setMapErr(e instanceof Error ? e.message : 'Map failed to load'));
    return () => { cancelled = true; };
  }, []);

  // Markers follow the data (and draw as soon as the map is ready)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !data) return;
    const seen = new Set<number>();
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    for (const t of data.technicians) {
      if (filter !== 'all' && t.presence !== filter) continue;
      if (t.position) {
        seen.add(t.technicianId);
        const pos = t.displayPosition ?? { lat: t.position.lat, lng: t.position.lng };
        const icon: google.maps.Icon = { url: TECH_PIN(UI[t.presence].color), scaledSize: new google.maps.Size(selected === t.technicianId ? 38 : 30, selected === t.technicianId ? 38 : 30), anchor: new google.maps.Point(selected === t.technicianId ? 19 : 15, selected === t.technicianId ? 19 : 15) };
        let m = markers.current.get(t.technicianId);
        if (!m) { m = new google.maps.Marker({ map, position: pos, icon, title: t.name ?? `Technician #${t.technicianId}`, zIndex: 3 }); m.addListener('click', () => setSelected(t.technicianId)); markers.current.set(t.technicianId, m); }
        else { m.setPosition(pos); m.setIcon(icon); m.setMap(map); }
        bounds.extend(pos); any = true;
      }
      if (t.liveJob?.addressLat != null && t.liveJob.addressLng != null) {
        const pos = { lat: t.liveJob.addressLat, lng: t.liveJob.addressLng };
        let h = homes.current.get(t.technicianId);
        if (!h) { h = new google.maps.Marker({ map, position: pos, icon: { url: HOME_PIN, scaledSize: new google.maps.Size(28, 35), anchor: new google.maps.Point(14, 34) }, title: t.liveJob.addressText ?? t.liveJob.code, zIndex: 2, opacity: 0.85 }); homes.current.set(t.technicianId, h); }
        else { h.setPosition(pos); h.setMap(map); }
        bounds.extend(pos); any = true;
      } else { homes.current.get(t.technicianId)?.setMap(null); }
    }
    for (const [id, m] of markers.current) if (!seen.has(id)) m.setMap(null);
    if (any && !fitted.current) { map.fitBounds(bounds, 60); fitted.current = true; }
  }, [data, filter, selected, mapReady]);

  const focus = (t: LiveTech) => {
    setSelected(t.technicianId);
    const map = mapRef.current;
    if (map && t.position) { map.panTo(t.displayPosition ?? { lat: t.position.lat, lng: t.position.lng }); if ((map.getZoom() ?? 0) < 13) map.setZoom(14); }
  };

  const override = async (t: LiveTech, presence: 'offline' | 'available' | 'on_break', breakMinutes?: number) => {
    setBusy(t.technicianId);
    try {
      await apiPatch(`/service-provider/technicians/${t.technicianId}/presence`, { presence, ...(breakMinutes ? { breakMinutes } : {}) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the technician'); }
    finally { setBusy(null); }
  };

  const list = useMemo(() => {
    const rows = (data?.technicians ?? []).filter((t) => filter === 'all' || t.presence === filter);
    return rows.sort((a, b) => ORDER.indexOf(a.presence) - ORDER.indexOf(b.presence) || (a.name ?? '').localeCompare(b.name ?? ''));
  }, [data, filter]);

  const counts = data?.counts;
  const total = data?.technicians.length ?? 0;
  const online = (counts?.available ?? 0) + (counts?.on_job ?? 0);

  return (
    <DashboardPage
      title="Live map"
      subtitle="Where your technicians are right now — refreshed every 10 seconds while their app is open."
      actions={<button type="button" onClick={() => { wake(); void load(); }} className="flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 10, padding: '7px 12px', cursor: 'pointer' }}><RefreshCw size={13} /> Refresh</button>}
    >
      {/* Presence tiles (also the filter) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
        {([['all', 'All technicians', total, INK], ...ORDER.filter((p) => p !== 'unavailable').map((p) => [p, UI[p].label, counts?.[p] ?? 0, UI[p].color] as const)] as Array<readonly [Presence | 'all', string, number, string]>).map(([k, label, n, color]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} style={{ ...card({ padding: '10px 12px' }), textAlign: 'left', cursor: 'pointer', borderColor: filter === k ? color : '#E4E7E2', boxShadow: filter === k ? `inset 0 0 0 1px ${color}` : 'none' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: FAINT, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
            <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
              {k !== 'all' && <span style={{ width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block' }} />}
              <span style={{ fontSize: 20, fontWeight: 800, color: INK }}>{n}</span>
            </div>
          </button>
        ))}
      </div>
      {error && <div style={{ background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {idle && (
        <div className="flex items-center justify-between gap-3 flex-wrap" style={{ background: '#FEF6E7', border: '1px solid #F5D9A6', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#7A4E06', marginBottom: 12 }}>
          <span>Live updates paused — no activity for 30 minutes. The map shows the last refresh{data?.asOf ? ` (${new Date(data.asOf).toLocaleTimeString('en-AE', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })})` : ''}.</span>
          <button type="button" onClick={wake} className="flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: GREEN, border: 'none', borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}><RefreshCw size={12} /> Resume live updates</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(300px, 1fr)', gap: 12, alignItems: 'start' }} className="sp-live-grid">
        {/* Map */}
        <div style={{ ...card({ overflow: 'hidden' }), position: 'relative' }}>
          <div ref={containerRef} style={{ height: 520, width: '100%', background: '#EEF1EE' }} />
          {mapErr && <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: 13, color: MUTE }}>{mapErr}</div>}
          {!data && !mapErr && <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: 13, color: MUTE, pointerEvents: 'none' }}><Loader2 size={16} className="animate-spin" /></div>}
          {data && total > 0 && online === 0 && !data.technicians.some((t) => t.position) && (
            <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, ...card({ padding: '8px 12px' }), fontSize: 12.5, color: MUTE, boxShadow: '0 6px 20px rgba(0,0,0,.08)' }}>
              Nobody is sharing location right now. Technicians appear here while their app is open and set to Available or on a job.
            </div>
          )}
        </div>

        {/* Roster */}
        <div style={{ display: 'grid', gap: 8, maxHeight: 520, overflowY: 'auto', paddingRight: 2 }}>
          {!data ? (
            <div style={{ ...card({ padding: 24 }), textAlign: 'center', color: FAINT, fontSize: 13 }}>Loading…</div>
          ) : total === 0 ? (
            <div style={{ ...card({ padding: 24 }), textAlign: 'center', color: FAINT, fontSize: 13 }}>No technicians on your roster yet. <Link href="/dashboard/service-provider/settings?tab=team" style={{ color: GREEN, fontWeight: 600 }}>Add your team →</Link></div>
          ) : list.length === 0 ? (
            <div style={{ ...card({ padding: 24 }), textAlign: 'center', color: FAINT, fontSize: 13 }}>Nobody is {UI[filter as Presence]?.label.toLowerCase()} right now.</div>
          ) : list.map((t) => {
            const ui = UI[t.presence];
            const isSel = selected === t.technicianId;
            const breakLeft = t.breakUntil && now ? Math.max(0, Math.round((new Date(t.breakUntil).getTime() - now) / 60000)) : null;
            const ago = t.lastPingAt && now ? Math.round((now - new Date(t.lastPingAt).getTime()) / 1000) : null;
            return (
              <div key={t.technicianId} style={{ ...card({ padding: '12px 14px' }), borderColor: isSel ? ui.color : '#E4E7E2', cursor: 'pointer' }} onClick={() => focus(t)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span style={{ width: 9, height: 9, borderRadius: 999, background: ui.color, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: INK }} className="truncate">{t.name ?? `Technician #${t.technicianId}`}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: ui.bg, color: ui.color, whiteSpace: 'nowrap' }}>{ui.label}{t.presence === 'on_break' && breakLeft != null ? ` · ${breakLeft} min` : ''}</span>
                    </div>
                    <div style={{ fontSize: 12, color: MUTE, marginTop: 4 }}>
                      {t.presence === 'offline'
                        ? (t.presenceSetBy === 'provider' ? 'Set offline by you' : t.presenceSetBy === 'system' ? `No signal${ago != null ? ` · last seen ${fmtAgo(ago)}` : ''}` : ago != null ? `Went offline · last seen ${fmtAgo(ago)}` : 'Never connected')
                        : ago != null ? `Location ${fmtAgo(ago)}` : 'No location yet'}
                      {t.position?.accuracyM != null && t.presence !== 'offline' ? ` · ±${Math.round(t.position.accuracyM)} m` : ''}
                    </div>
                    {t.liveJob && (
                      <Link href={`/dashboard/service-provider/jobs/${t.liveJob.bookingId}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: '#1D4ED8', fontWeight: 600, marginTop: 6 }}>
                        <Navigation size={12} /> {t.liveJob.serviceName ?? 'Job'} · {t.liveJob.code}
                        <span style={{ color: MUTE, fontWeight: 500 }}>
                          {' '}· {t.liveJob.status === 'en_route' ? `on the way${t.liveJob.etaMin != null ? ` · ~${t.liveJob.etaMin} min` : ''}${t.liveJob.distanceM != null ? ` · ${fmtDistance(t.liveJob.distanceM)}${t.liveJob.etaSource === 'route' ? ' by road' : ''}` : ''}` : 'on site'}
                        </span>
                      </Link>
                    )}
                    {t.liveJob?.addressText && <div className="flex items-center gap-1" style={{ fontSize: 12, color: FAINT, marginTop: 2 }}><MapPin size={11} /> <span className="truncate">{t.liveJob.addressText}</span></div>}
                  </div>
                  {t.phone && <a href={`tel:${t.phone}`} onClick={(e) => e.stopPropagation()} title="Call" style={{ color: MUTE, background: CANVAS, border: BORDER, borderRadius: 8, padding: 6, display: 'inline-flex' }}><Phone size={13} /></a>}
                </div>
                {/* Owner overrides */}
                <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                  {t.presence !== 'offline' && (
                    <button type="button" disabled={busy === t.technicianId} onClick={() => void override(t, 'offline')} className="flex items-center gap-1" style={{ fontSize: 12, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 999, padding: '5px 10px', cursor: 'pointer' }}>
                      {busy === t.technicianId ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />} Force offline
                    </button>
                  )}
                  {(t.presence === 'available' || t.presence === 'on_job') && (
                    <button type="button" disabled={busy === t.technicianId} onClick={() => void override(t, 'on_break', 30)} className="flex items-center gap-1" style={{ fontSize: 12, fontWeight: 600, color: '#92400E', background: '#FEF6E7', border: '1px solid #F5D9A6', borderRadius: 999, padding: '5px 10px', cursor: 'pointer' }}>
                      <Coffee size={12} /> Break 30 min
                    </button>
                  )}
                  {(t.presence === 'offline' || t.presence === 'on_break') && t.storedPresence !== 'available' && (
                    <button type="button" disabled={busy === t.technicianId} onClick={() => void override(t, 'available')} className="flex items-center gap-1" style={{ fontSize: 12, fontWeight: 600, color: GREEN, background: '#E9F4EE', border: '1px solid #BFE0CD', borderRadius: 999, padding: '5px 10px', cursor: 'pointer' }}>
                      <Radio size={12} /> {t.presence === 'on_break' ? 'End break' : 'Clear offline'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p style={{ fontSize: 12, color: FAINT, marginTop: 10 }}>
        Technicians share their location from My Jobs while Available or on a job (every 30 s). No signal for {Math.round((data?.heartbeatTimeoutS ?? 120) / 60)} minutes shows as Offline. ETA is straight-line distance × 1.3 at 25 km/h — indicative, not routed. This page refreshes every 10 s only while it is visible and in use; it pauses after 30 idle minutes.
      </p>
      <style jsx global>{`@media (max-width: 900px) { .sp-live-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </DashboardPage>
  );
}
