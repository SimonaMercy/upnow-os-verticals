/**
 * Technician · My Jobs (SP-95) — every job assigned to me, and the actions I
 * take on site: On my way (GPS fix), I've arrived (GPS fix → check-in proof),
 * before/after photos (SP-258 evidence, same bucket the customer and admin
 * see), Complete with notes. Transitions are forward-only and enforced by the
 * server; the customer's tracker and the provider's board move in step.
 *
 * SP-86 · presence + live tracking: a bar at the top lets me go Available /
 * Break / Offline; while Available or on a job the page sends my position
 * every 30 s (heartbeat) so the customer sees me move and the provider's live
 * map shows where I am. Tapping "On my way" flips me live automatically.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, ChevronLeft, Coffee, Loader2, MapPin, Navigation, Phone, PlayCircle, Power, Radio } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { uploadBookingPhoto } from '@/lib/bookingEvidence';
import { TECH_IDLE_OFFLINE_MS, useIdle, usePageVisible } from '@/lib/liveHooks';

/* ── Types (mirror BookingsService.jobsForTechnician / jobDetailForTechnician) ── */
interface Checkin { at: string; source: 'gps' | 'unavailable' | null; lat: number | null; lng: number | null; accuracyM: number | null; distanceM: number | null }
interface Assignment {
  id: number; jobStatus: string; assignedAt: string; acceptedAt: string | null; startedAt: string | null; completedAt: string | null;
  technicianNotes: string | null; customerSignOff: boolean; checkin: Checkin | null;
}
interface JobRow {
  bookingId: number; code: string; status: string; serviceName: string | null; packageName: string | null;
  scheduledAt: string; addressText: string | null; addressLat: string | null; addressLng: string | null;
  specialInstructions: string | null; customerName: string | null; customerPhone: string | null; assignment: Assignment;
}
interface MediaItem { id: number; kind: 'problem' | 'before' | 'after'; caption: string | null; viewUrl: string; createdAt: string }
/** `media` comes bucketed from BookingsService.listMedia (SP-258); tolerate a flat array too. */
interface JobDetail extends JobRow { media: { problem: MediaItem[]; before: MediaItem[]; after: MediaItem[] } | MediaItem[]; allowedTransitions: string[] }
const mediaOf = (m: JobDetail['media'] | undefined, kind: MediaItem['kind']): MediaItem[] =>
  Array.isArray(m) ? m.filter((x) => x.kind === kind) : m?.[kind] ?? [];

/* ── Tokens (SP portal, design 2a) ─────────────────────────────────────── */
const GREEN = '#0B7A4E'; const INK = '#182420'; const MUTE = '#55645B'; const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2'; const HAIRLINE = '1px solid #EEF1EE'; const CANVAS = '#F5F7F4';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  assigned:    { label: 'Assigned',    bg: '#EEF2FF', fg: '#4338CA' },
  en_route:    { label: 'On the way',  bg: '#FEF6E7', fg: '#92400E' },
  in_progress: { label: 'In progress', bg: '#E6F0FB', fg: '#1D4ED8' },
  completed:   { label: 'Completed',   bg: '#E9F4EE', fg: GREEN },
  cancelled:   { label: 'Cancelled',   bg: '#F3F4F6', fg: '#6B7280' },
  dispute:     { label: 'Dispute',     bg: '#FDECEC', fg: '#B42318' },
};
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' });
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AE', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** Ask the device for one fix; resolve null when denied / unavailable (never throw). */
function getFix(): Promise<{ lat: number; lng: number; accuracyM: number; heading?: number | null } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, heading: Number.isFinite(p.coords.heading as number) ? p.coords.heading : null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 },
    );
  });
}

/* ── SP-86 · presence + heartbeat ──────────────────────────────────────── */
type Presence = 'offline' | 'available' | 'on_job' | 'on_break' | 'unavailable';
interface PresenceState {
  presence: Presence; storedPresence: Presence; presenceSetBy: 'technician' | 'provider' | 'system' | null;
  breakUntil: string | null; lastPingAt: string | null; shouldSendLocation: boolean; heartbeatIntervalS: number;
  liveJob: { bookingId: number; code: string; status: string; serviceName: string | null } | null;
}
const PRESENCE_UI: Record<Presence, { label: string; bg: string; fg: string; dot: string }> = {
  available:   { label: 'Available',  bg: '#E9F4EE', fg: GREEN,     dot: GREEN },
  on_job:      { label: 'On a job',   bg: '#E6F0FB', fg: '#1D4ED8', dot: '#1D4ED8' },
  on_break:    { label: 'On break',   bg: '#FEF6E7', fg: '#92400E', dot: '#D97706' },
  offline:     { label: 'Offline',    bg: '#F3F4F6', fg: '#6B7280', dot: '#9CA3AF' },
  unavailable: { label: 'Unavailable',bg: '#F3F4F6', fg: '#6B7280', dot: '#9CA3AF' },
};

/**
 * Owns the heartbeat loop. Every `heartbeatIntervalS` (30 s): if the server
 * says we should send location (Available / on a job) → get a fix and POST it;
 * otherwise just re-read our state (a break may have ended, the owner may
 * have changed us). Also exposes setPresence() for the bar and goLive() for
 * the job buttons.
 */
function useTechnicianPresence() {
  const [state, setState] = useState<PresenceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoOff, setAutoOff] = useState(false);
  const stateRef = useRef<PresenceState | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  // Stoppers: while the tab is hidden and there is NO live job, don't send fixes (the server flips us
  // offline after 2 min of silence — that is the honest state). Available with no job for 2 h without
  // touching the app → go offline automatically so a forgotten phone doesn't ping all night.
  const visible = usePageVisible();
  const [idle, wake] = useIdle(TECH_IDLE_OFFLINE_MS);

  const refresh = useCallback(
    () => apiGet<PresenceState>('/technician/presence').then((s) => { setState(s); setError(null); }).catch(() => { /* keep the last known state */ }),
    [],
  );

  const send = useCallback(
    (body: Record<string, unknown>) => apiPost<PresenceState>('/technician/presence', body).then((s) => { setState(s); setError(null); return s; }),
    [],
  );

  /** One heartbeat: with a fix when we are live, plain otherwise. */
  const tick = useCallback(async () => {
    const cur = stateRef.current;
    if (!cur) return refresh();
    if (!cur.shouldSendLocation) return refresh();
    // Hidden tab + no live job → skip (a live job keeps pinging as long as the browser lets it).
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible' && !cur.liveJob) return;
    const fix = await getFix();
    try { await send(fix ? { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, ...(fix.heading != null ? { heading: fix.heading } : {}) } : {}); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send your location'); }
  }, [refresh, send]);

  useEffect(() => { const t = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(t); }, [refresh]);
  useEffect(() => {
    const ms = (state?.heartbeatIntervalS ?? 30) * 1000;
    const id = setInterval(() => { void tick(); }, ms);
    return () => clearInterval(id);
  }, [state?.heartbeatIntervalS, tick]);

  // Auto-offline after 2 h idle while Available with no live job.
  useEffect(() => {
    if (!idle) return;
    const cur = stateRef.current;
    if (!cur || cur.presence !== 'available' || cur.liveJob) { wake(); return; }
    setAutoOff(true);
    void send({ presence: 'offline' }).catch(() => {});
  }, [idle, wake, send]);

  const setPresence = useCallback(async (presence: 'available' | 'on_break' | 'offline', breakMinutes?: number) => {
    setBusy(true);
    setAutoOff(false);
    wake();
    try {
      const fix = presence === 'available' ? await getFix() : null;
      await send({ presence, ...(breakMinutes ? { breakMinutes } : {}), ...(fix ? { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM } : {}) });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change your status'); }
    finally { setBusy(false); }
  }, [send, wake]);

  /** Called after "On my way" / "I've arrived": make sure we are live and send the fix now. */
  const goLive = useCallback(async (fix: { lat: number; lng: number; accuracyM: number } | null) => {
    const cur = stateRef.current;
    const needsFlip = !cur || cur.presence === 'offline' || cur.presence === 'on_break';
    try { await send({ ...(needsFlip ? { presence: 'available' } : {}), ...(fix ? { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM } : {}) }); } catch { /* the job step already saved */ }
  }, [send]);

  return { state, busy, error, setPresence, goLive, refresh, autoOff, visible };
}

function PresenceBar({ p }: { p: ReturnType<typeof useTechnicianPresence> }) {
  const [pickBreak, setPickBreak] = useState(false);
  // "x s ago" / "n min left" tick every 5 s without touching Date.now() in render
  const [now, setNow] = useState(0);
  useEffect(() => { const bump = () => setNow(Date.now()); const id = setInterval(bump, 5000); const t = setTimeout(bump, 0); return () => { clearInterval(id); clearTimeout(t); }; }, []);
  const s = p.state;
  const ui = PRESENCE_UI[s?.presence ?? 'offline'];
  const lastPing = s?.lastPingAt && now ? Math.round((now - new Date(s.lastPingAt).getTime()) / 1000) : null;
  const breakLeft = s?.breakUntil && now ? Math.max(0, Math.round((new Date(s.breakUntil).getTime() - now) / 60000)) : null;
  return (
    <div style={{ ...card({ padding: '12px 14px' }), marginBottom: 12 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ width: 10, height: 10, borderRadius: 999, background: ui.dot, display: 'inline-block', boxShadow: s?.shouldSendLocation ? `0 0 0 4px ${ui.bg}` : 'none' }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: ui.fg }}>{ui.label}</span>
          <span style={{ fontSize: 12, color: FAINT }}>
            {s?.presence === 'on_job' && s.liveJob ? `· ${s.liveJob.serviceName ?? 'job'} ${s.liveJob.code} · sharing location` :
             s?.presence === 'available' ? '· sharing location every 30 s' :
             s?.presence === 'on_break' && breakLeft != null ? `· ${breakLeft} min left` :
             s?.presence === 'offline' && p.autoOff ? '· set offline after 2 h without activity — tap Go available when you are back' :
             s?.presence === 'offline' && s.presenceSetBy === 'provider' ? '· set offline by your company' :
             s?.presence === 'offline' && s.presenceSetBy === 'system' ? '· no signal for 2 min — tap Available to resume' : ''}
            {lastPing != null && s?.shouldSendLocation ? ` · last ping ${lastPing < 5 ? 'now' : `${lastPing}s ago`}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {s?.presence !== 'available' && s?.presence !== 'on_job' && (
            <button type="button" disabled={p.busy} onClick={() => void p.setPresence('available')} className="flex items-center gap-1.5"
              style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: GREEN, border: 'none', borderRadius: 999, padding: '7px 13px', cursor: 'pointer', opacity: p.busy ? .6 : 1 }}>
              {p.busy ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />} Go available
            </button>
          )}
          {(s?.presence === 'available' || s?.presence === 'on_job') && (
            <div style={{ position: 'relative' }}>
              <button type="button" disabled={p.busy} onClick={() => setPickBreak((v) => !v)} className="flex items-center gap-1.5"
                style={{ fontSize: 12.5, fontWeight: 600, color: '#92400E', background: '#FEF6E7', border: '1px solid #F5D9A6', borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}>
                <Coffee size={13} /> Break
              </button>
              {pickBreak && (
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 5, ...card({ padding: 6 }), display: 'flex', gap: 4, boxShadow: '0 8px 24px rgba(0,0,0,.08)' }}>
                  {[15, 30, 60].map((m) => (
                    <button key={m} type="button" onClick={() => { setPickBreak(false); void p.setPresence('on_break', m); }}
                      style={{ fontSize: 12.5, fontWeight: 600, color: INK, background: CANVAS, border: BORDER, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{m} min</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {s?.presence !== 'offline' && (
            <button type="button" disabled={p.busy} onClick={() => void p.setPresence('offline')} className="flex items-center gap-1.5"
              style={{ fontSize: 12.5, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}>
              <Power size={13} /> Go offline
            </button>
          )}
        </div>
      </div>
      {p.error && <p style={{ fontSize: 12, color: '#b42318', marginTop: 8 }}>{p.error}</p>}
    </div>
  );
}

export default function TechnicianJobsPage() {
  const presence = useTechnicianPresence();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [tab, setTab] = useState<'active' | 'upcoming' | 'done'>('active');

  const load = useCallback(
    () =>
      apiGet<JobRow[]>('/bookings/technician/jobs')
        .then((rows) => { setJobs(rows); setError(null); })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load your jobs'))
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => { void load(); }, [load]);

  const buckets = useMemo(() => {
    const active = jobs.filter((j) => ['assigned', 'en_route', 'in_progress'].includes(j.status) && (isToday(j.scheduledAt) || new Date(j.scheduledAt) < new Date()));
    const upcoming = jobs.filter((j) => ['assigned', 'en_route', 'in_progress'].includes(j.status) && !active.includes(j));
    const done = jobs.filter((j) => !['assigned', 'en_route', 'in_progress'].includes(j.status));
    return { active, upcoming, done };
  }, [jobs]);
  const list = buckets[tab];

  if (openId != null) {
    return <JobDetailView bookingId={openId} presence={presence} onBack={() => { setOpenId(null); void load(); void presence.refresh(); }} />;
  }

  return (
    <DashboardPage title="My Jobs" subtitle="Your assigned jobs. Tap a job to update its status, check in on arrival and add photos of the work.">
      <PresenceBar p={presence} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {([['active', `Today & active (${buckets.active.length})`], ['upcoming', `Upcoming (${buckets.upcoming.length})`], ['done', `Done (${buckets.done.length})`]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            style={{ padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, border: BORDER, background: tab === k ? INK : '#fff', color: tab === k ? '#fff' : MUTE, cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>
      {error && <div style={{ background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {loading ? (
        <div style={{ ...card({ padding: 32 }), textAlign: 'center', color: FAINT, fontSize: 13 }}>Loading your jobs…</div>
      ) : list.length === 0 ? (
        <div style={{ ...card({ padding: 32 }), textAlign: 'center', color: FAINT, fontSize: 13 }}>
          {tab === 'active' ? 'No jobs today. New assignments show up here the moment dispatch sends them.' : tab === 'upcoming' ? 'Nothing scheduled ahead yet.' : 'No completed jobs yet.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((j) => {
            const st = STATUS[j.status] ?? { label: j.status, bg: '#F3F4F6', fg: MUTE };
            return (
              <button key={j.bookingId} type="button" onClick={() => setOpenId(j.bookingId)} style={{ ...card({ padding: '14px 16px' }), textAlign: 'left', cursor: 'pointer', width: '100%' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{j.serviceName ?? 'Service'}{j.packageName ? <span style={{ color: MUTE, fontWeight: 500 }}> · {j.packageName}</span> : null}</div>
                    <div style={{ fontSize: 12.5, color: MUTE, marginTop: 3 }}>{fmtWhen(j.scheduledAt)} · {j.code}</div>
                    {j.addressText && <div className="flex items-center gap-1" style={{ fontSize: 12.5, color: MUTE, marginTop: 4 }}><MapPin size={12} /> <span className="truncate">{j.addressText}</span></div>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </DashboardPage>
  );
}

/* ── Detail + actions ────────────────────────────────────────────────────── */
function JobDetailView({ bookingId, presence, onBack }: { bookingId: number; presence: ReturnType<typeof useTechnicianPresence>; onBack: () => void }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState<'before' | 'after' | null>(null);

  const load = useCallback(
    () => apiGet<JobDetail>(`/bookings/technician/jobs/${bookingId}`).then((d) => { setJob(d); setNotes(d.assignment.technicianNotes ?? ''); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the job')),
    [bookingId],
  );
  useEffect(() => { void load(); }, [load]);

  const transition = async (status: 'en_route' | 'in_progress' | 'completed') => {
    setBusy(status);
    setError(null);
    try {
      // On the way / arrived: attach the device fix when the phone gives one.
      const fix = status === 'completed' ? null : await getFix();
      await apiPatch(`/bookings/${bookingId}/status`, {
        status,
        ...(fix ? { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM } : {}),
        ...(status === 'completed' ? { notes: notes.trim() || null } : {}),
      });
      // SP-86: setting off / arriving = live. Flip Available if needed and share the fix now.
      if (status !== 'completed') await presence.goLive(fix);
      else await presence.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the job');
    } finally {
      setBusy(null);
    }
  };

  const addPhoto = async (kind: 'before' | 'after', file: File | undefined) => {
    if (!file) return;
    setUploading(kind);
    setError(null);
    try {
      await uploadBookingPhoto(bookingId, kind, file);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the photo');
    } finally {
      setUploading(null);
    }
  };

  if (!job && !error) return <DashboardPage title="Job" subtitle=""><div style={{ ...card({ padding: 32 }), textAlign: 'center', color: FAINT, fontSize: 13 }}>Loading…</div></DashboardPage>;
  if (!job) return <DashboardPage title="Job" subtitle=""><div style={{ background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div></DashboardPage>;

  const st = STATUS[job.status] ?? { label: job.status, bg: '#F3F4F6', fg: MUTE };
  const can = (s: string) => job.allowedTransitions.includes(s);
  const before = mediaOf(job.media, 'before');
  const after = mediaOf(job.media, 'after');
  const problem = mediaOf(job.media, 'problem');
  const ck = job.assignment.checkin;
  const mapsHref = job.addressLat && job.addressLng ? `https://maps.google.com/?q=${job.addressLat},${job.addressLng}` : job.addressText ? `https://maps.google.com/?q=${encodeURIComponent(job.addressText)}` : null;

  return (
    <DashboardPage
      title={job.serviceName ?? 'Job'}
      subtitle={`${fmtWhen(job.scheduledAt)} · ${job.code}`}
      actions={<button type="button" onClick={onBack} className="flex items-center gap-1" style={{ fontSize: 13, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 10, padding: '7px 12px', cursor: 'pointer' }}><ChevronLeft size={14} /> All jobs</button>}
    >
      <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
        <PresenceBar p={presence} />
        {/* Status + timeline */}
        <div style={card({ padding: 16 })}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
            <span style={{ fontSize: 12, color: FAINT }}>Assigned {fmtTime(job.assignment.assignedAt)}{job.assignment.startedAt ? ` · started ${fmtTime(job.assignment.startedAt)}` : ''}{job.assignment.completedAt ? ` · done ${fmtTime(job.assignment.completedAt)}` : ''}</span>
          </div>
          <ol className="flex items-center gap-2 flex-wrap" style={{ marginTop: 12, fontSize: 12, color: MUTE }}>
            {(['assigned', 'en_route', 'in_progress', 'completed'] as const).map((s, i) => {
              const order = ['assigned', 'en_route', 'in_progress', 'completed'];
              const reached = order.indexOf(job.status) >= i || job.status === 'completed';
              return (
                <li key={s} className="flex items-center gap-2">
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: reached ? GREEN : '#E4E7E2', display: 'inline-block' }} />
                  <span style={{ color: reached ? INK : FAINT, fontWeight: reached ? 600 : 500 }}>{STATUS[s].label}</span>
                  {i < 3 && <span style={{ color: '#D7DDD8' }}>›</span>}
                </li>
              );
            })}
          </ol>
          {ck && (
            <p style={{ fontSize: 12, color: MUTE, marginTop: 10 }}>
              <MapPin size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> Checked in {fmtTime(ck.at)}
              {ck.source === 'gps' ? ` · GPS ±${Math.round(ck.accuracyM ?? 0)} m${ck.distanceM != null ? ` · ${Math.round(ck.distanceM)} m from the address` : ''}` : ' · location unavailable on the device'}
            </p>
          )}
        </div>

        {/* Where + who */}
        <div style={card({ padding: 16 })}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{job.addressText ?? 'Address on booking'}</div>
          {job.specialInstructions && <p style={{ fontSize: 12.5, color: MUTE, marginTop: 4 }}>“{job.specialInstructions}”</p>}
          <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 10 }}>
            {mapsHref && <a href={mapsHref} target="_blank" rel="noreferrer" className="flex items-center gap-1" style={{ fontSize: 12.5, fontWeight: 600, color: '#4338CA' }}><Navigation size={13} /> Open in Maps</a>}
            {job.customerPhone && <a href={`tel:${job.customerPhone}`} className="flex items-center gap-1" style={{ fontSize: 12.5, fontWeight: 600, color: '#4338CA' }}><Phone size={13} /> {job.customerName ?? 'Customer'}</a>}
          </div>
        </div>

        {/* Actions */}
        {job.status !== 'completed' && job.status !== 'cancelled' && (
          <div style={card({ padding: 16 })}>
            <p style={{ fontSize: 12, color: MUTE, marginBottom: 10 }}>Your phone&apos;s location is attached when you set off and when you arrive — that is your arrival proof — and shared every 30 s while you are on the way so the customer can follow you. If the phone can&apos;t give a fix, the step still saves.</p>
            <div className="flex gap-2 flex-wrap">
              {can('en_route') && (
                <button type="button" disabled={!!busy} onClick={() => void transition('en_route')} className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', background: '#92400E', border: 'none', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', opacity: busy ? .6 : 1 }}>
                  {busy === 'en_route' ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />} On my way
                </button>
              )}
              {can('in_progress') && (
                <button type="button" disabled={!!busy} onClick={() => void transition('in_progress')} className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', background: '#1D4ED8', border: 'none', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', opacity: busy ? .6 : 1 }}>
                  {busy === 'in_progress' ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} I&apos;ve arrived — start job
                </button>
              )}
            </div>
          </div>
        )}

        {/* Photos */}
        <div style={card({ padding: 16 })}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Photos of the work</div>
          {problem.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: FAINT, marginBottom: 6 }}>From the customer</p>
              <PhotoRow items={problem} />
            </div>
          )}
          {(['before', 'after'] as const).map((kind) => (
            <div key={kind} style={{ paddingTop: 10, borderTop: HAIRLINE, marginTop: 10 }}>
              <div className="flex items-center justify-between gap-2">
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: FAINT }}>{kind === 'before' ? 'Before' : 'After'} · {kind === 'before' ? before.length : after.length}/6</p>
                {job.status !== 'completed' && job.status !== 'cancelled' && (
                  <label className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600, color: '#92400E', background: '#FEF6E7', border: '1px dashed #F5D9A6', borderRadius: 8, padding: '5px 9px', cursor: 'pointer' }}>
                    {uploading === kind ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Add {kind} photo
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void addPhoto(kind, e.target.files?.[0])} />
                  </label>
                )}
              </div>
              <PhotoRow items={kind === 'before' ? before : after} />
            </div>
          ))}
        </div>

        {/* Complete */}
        {job.status === 'in_progress' && (
          <div style={card({ padding: 16 })}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 6 }}>Finish the job</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Notes for the customer and UpNow — what you did, anything to follow up (optional)"
              style={{ width: '100%', fontSize: 13, padding: '8px 10px', border: BORDER, borderRadius: 8, color: INK, background: '#fff', resize: 'vertical' }} />
            {after.length === 0 && <p style={{ fontSize: 12, color: '#92400E', marginTop: 6 }}>Add at least one “after” photo — customers and UpNow see it as proof of the finished work.</p>}
            <button type="button" disabled={!!busy} onClick={() => void transition('completed')} className="flex items-center gap-2" style={{ marginTop: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', background: GREEN, border: 'none', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', opacity: busy ? .6 : 1 }}>
              {busy === 'completed' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Mark job complete
            </button>
          </div>
        )}
        {job.status === 'completed' && (
          <div style={card({ padding: 16, background: '#F4FAF6' })}>
            <div className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700, color: GREEN }}><CheckCircle2 size={16} /> Job completed {fmtTime(job.assignment.completedAt)}</div>
            {job.assignment.technicianNotes && <p style={{ fontSize: 12.5, color: MUTE, marginTop: 6 }}>“{job.assignment.technicianNotes}”</p>}
            <p style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>{job.assignment.customerSignOff ? 'Customer signed off.' : 'Waiting for the customer to sign off.'}</p>
          </div>
        )}
        {error && <div style={{ background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}
      </div>
    </DashboardPage>
  );
}

function PhotoRow({ items }: { items: MediaItem[] }) {
  if (!items.length) return <p style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>No photos yet.</p>;
  return (
    <div className="flex gap-2 flex-wrap" style={{ marginTop: 6 }}>
      {items.map((m) => (
        <a key={m.id} href={m.viewUrl} target="_blank" rel="noreferrer" title={m.caption ?? ''}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.viewUrl} alt={m.caption ?? m.kind} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: BORDER, display: 'block', background: CANVAS }} />
        </a>
      ))}
    </div>
  );
}
