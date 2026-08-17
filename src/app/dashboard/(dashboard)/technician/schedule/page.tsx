/**
 * Technician · My shifts (SP-103) — the shifts my provider rostered me on,
 * grouped by day, with the zones I cover in each window and any overlap
 * conflict the provider still has to resolve. I confirm a shift here; I can't
 * move or cancel one (that is the provider's call — ask them).
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, CheckCircle2, Coffee, Loader2, MapPin, Siren } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { SHIFT_STATUS, Shift, TechnicianShiftsResponse, dayKey, fmtShiftRange, fmtShiftTime, groupByDay, shiftHours } from '@/lib/shifts';

const GREEN = '#0B7A4E'; const INK = '#182420'; const MUTE = '#55645B'; const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2'; const CANVAS = '#F5F7F4';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });
const errMsg = (e: unknown) => (e as Error)?.message || 'Something went wrong.';

const dayHeading = (key: string) => {
  const d = new Date(`${key}T00:00:00`);
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 864e5));
  const base = d.toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'short' });
  return key === today ? `Today · ${base}` : key === tomorrow ? `Tomorrow · ${base}` : base;
};

function ShiftCard({ s, onConfirm, busy }: { s: Shift; onConfirm: (id: number) => void; busy: boolean }) {
  const st = SHIFT_STATUS[s.status];
  const conflict = s.status === 'conflict_reported';
  return (
    <div style={card({ padding: '12px 14px', border: conflict ? '1px solid #F3C4C4' : s.phase === 'live' ? `1px solid ${GREEN}` : BORDER })}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>{fmtShiftRange(s)}</span>
            <span style={{ fontSize: 12, color: MUTE }}>{shiftHours(s)} h</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.fg }}>{s.phase === 'live' && s.status !== 'cancelled' ? 'Now' : st.label}</span>
            {s.isEmergencyRoster && <span title="Emergency roster — on call for urgent jobs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FEF6E7', color: '#92400E' }}><Siren size={11} /> On call</span>}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12.5, color: MUTE }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={13} color={FAINT} /> {s.zones.length ? s.zones.map((z) => z.label).join(', ') : 'Anywhere the company covers'}
            </span>
            {s.breakStartAt && s.breakEndAt && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Coffee size={13} color={FAINT} /> Break {fmtShiftTime(s.breakStartAt)} – {fmtShiftTime(s.breakEndAt)}</span>
            )}
          </div>
          {s.notes && s.status !== 'cancelled' && <p style={{ fontSize: 12.5, color: MUTE, marginTop: 6, whiteSpace: 'pre-wrap' }}>{s.notes}</p>}
          {conflict && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8, fontSize: 12.5, color: '#7F1D1D' }}>
              <AlertTriangle size={14} color="#B42318" style={{ marginTop: 1 }} />
              <span><b>Overlaps another of your shifts</b> — {s.conflictReason}. Your provider needs to move or cancel one before you can confirm.</span>
            </div>
          )}
        </div>
        {s.status === 'assigned' && s.phase !== 'past' && (
          <button onClick={() => onConfirm(s.id)} disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: GREEN, color: '#fff', border: `1px solid ${GREEN}`, cursor: 'pointer' }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirm
          </button>
        )}
        {s.status === 'confirmed' && s.phase !== 'past' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: GREEN, fontWeight: 600 }}><CheckCircle2 size={14} /> Confirmed</span>
        )}
      </div>
    </div>
  );
}

export default function TechnicianSchedulePage() {
  const [data, setData] = useState<TechnicianShiftsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const from = new Date(Date.now() - 7 * 864e5).toISOString();
      const to = new Date(Date.now() + 42 * 864e5).toISOString();
      setData(await apiGet<TechnicianShiftsResponse>(`/technician/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  const confirm = async (id: number) => {
    setBusy(id); setError(null);
    try { await apiPost(`/technician/shifts/${id}/confirm`, {}); await load(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  const shifts = useMemo(() => data?.shifts ?? [], [data]);
  const upcoming = useMemo(() => shifts.filter((s) => s.phase !== 'past'), [shifts]);
  const past = useMemo(() => shifts.filter((s) => s.phase === 'past').reverse(), [shifts]);
  const toConfirm = upcoming.filter((s) => s.status === 'assigned').length;
  const conflicts = upcoming.filter((s) => s.status === 'conflict_reported').length;
  const hoursAhead = upcoming.filter((s) => s.status !== 'cancelled').reduce((a, s) => a + shiftHours(s), 0);
  const groups = groupByDay(upcoming);

  return (
    <DashboardPage title="My shifts" subtitle="When you are rostered to work and the areas you cover in each shift.">
      {error && <div style={{ ...card({ background: '#FDECEC', border: '1px solid #F3C4C4', padding: '10px 14px', marginBottom: 14, color: '#B42318', fontSize: 13 }) }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={card({ padding: '10px 14px' })}><p style={{ fontSize: 11.5, color: FAINT }}>Upcoming shifts</p><p style={{ fontSize: 20, fontWeight: 800, color: INK }}>{upcoming.length}</p></div>
        <div style={card({ padding: '10px 14px' })}><p style={{ fontSize: 11.5, color: FAINT }}>Hours ahead</p><p style={{ fontSize: 20, fontWeight: 800, color: INK }}>{Math.round(hoursAhead * 10) / 10} h</p></div>
        <div style={card({ padding: '10px 14px' })}><p style={{ fontSize: 11.5, color: FAINT }}>To confirm</p><p style={{ fontSize: 20, fontWeight: 800, color: toConfirm ? '#4338CA' : INK }}>{toConfirm}</p></div>
        <div style={card({ padding: '10px 14px', border: conflicts ? '1px solid #F3C4C4' : BORDER })}><p style={{ fontSize: 11.5, color: FAINT }}>Conflicts</p><p style={{ fontSize: 20, fontWeight: 800, color: conflicts ? '#B42318' : INK }}>{conflicts}</p></div>
      </div>

      {loading && !data ? (
        <div style={{ ...card({ padding: 32, textAlign: 'center', color: MUTE, fontSize: 13 }) }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline', marginRight: 6 }} /> Loading your shifts…</div>
      ) : !upcoming.length ? (
        <div style={{ ...card({ padding: 32, textAlign: 'center' }) }}>
          <CalendarCheck size={28} color={FAINT} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: 14, fontWeight: 700, color: INK }}>No upcoming shifts</p>
          <p style={{ fontSize: 12.5, color: MUTE, marginTop: 4 }}>Your provider has not rostered you for the coming weeks yet. Jobs can still be assigned to you within the company&apos;s working hours.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 18 }}>
          {groups.map((g) => (
            <section key={g.day}>
              <h3 style={{ fontSize: 12.5, fontWeight: 700, color: g.day === dayKey(new Date()) ? GREEN : MUTE, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>{dayHeading(g.day)}</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                {g.shifts.map((s) => <ShiftCard key={s.id} s={s} onConfirm={confirm} busy={busy === s.id} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <button onClick={() => setShowPast((v) => !v)} style={{ background: 'none', border: 0, padding: 0, fontSize: 12.5, color: MUTE, textDecoration: 'underline', cursor: 'pointer' }}>
            {showPast ? 'Hide' : 'Show'} {past.length} past shift{past.length === 1 ? '' : 's'} (last 7 days)
          </button>
          {showPast && (
            <div style={{ display: 'grid', gap: 8, marginTop: 10, background: CANVAS, padding: 10, borderRadius: 14 }}>
              {past.map((s) => <ShiftCard key={s.id} s={s} onConfirm={confirm} busy={false} />)}
            </div>
          )}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: FAINT, marginTop: 16 }}>Times are shown in your device&apos;s time zone. To change or drop a shift, ask your provider — only they can move or cancel one.</p>
    </DashboardPage>
  );
}
