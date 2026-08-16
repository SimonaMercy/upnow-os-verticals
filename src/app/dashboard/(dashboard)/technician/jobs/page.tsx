/**
 * Technician · My Jobs (SP-95) — every job assigned to me, and the actions I
 * take on site: On my way (GPS fix), I've arrived (GPS fix → check-in proof),
 * before/after photos (SP-258 evidence, same bucket the customer and admin
 * see), Complete with notes. Transitions are forward-only and enforced by the
 * server; the customer's tracker and the provider's board move in step.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, ChevronLeft, Loader2, MapPin, Navigation, Phone, PlayCircle } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { uploadBookingPhoto } from '@/lib/bookingEvidence';

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
interface JobDetail extends JobRow { media: MediaItem[]; allowedTransitions: string[] }

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
function getFix(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 },
    );
  });
}

export default function TechnicianJobsPage() {
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
    return <JobDetailView bookingId={openId} onBack={() => { setOpenId(null); void load(); }} />;
  }

  return (
    <DashboardPage title="My Jobs" subtitle="Your assigned jobs. Tap a job to update its status, check in on arrival and add photos of the work.">
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
function JobDetailView({ bookingId, onBack }: { bookingId: number; onBack: () => void }) {
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
  const before = job.media.filter((m) => m.kind === 'before');
  const after = job.media.filter((m) => m.kind === 'after');
  const problem = job.media.filter((m) => m.kind === 'problem');
  const ck = job.assignment.checkin;
  const mapsHref = job.addressLat && job.addressLng ? `https://maps.google.com/?q=${job.addressLat},${job.addressLng}` : job.addressText ? `https://maps.google.com/?q=${encodeURIComponent(job.addressText)}` : null;

  return (
    <DashboardPage
      title={job.serviceName ?? 'Job'}
      subtitle={`${fmtWhen(job.scheduledAt)} · ${job.code}`}
      actions={<button type="button" onClick={onBack} className="flex items-center gap-1" style={{ fontSize: 13, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 10, padding: '7px 12px', cursor: 'pointer' }}><ChevronLeft size={14} /> All jobs</button>}
    >
      <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
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
            <p style={{ fontSize: 12, color: MUTE, marginBottom: 10 }}>Your phone&apos;s location is attached when you set off and when you arrive — that is your arrival proof. If the phone can&apos;t give a fix, the step still saves.</p>
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
