/**
 * Service Provider · Roster (SP-103) — the week's shifts per technician, with
 * service zones and overlap conflicts. The owner adds / moves / cancels shifts;
 * an overlap for the same technician is never silent: the shift is saved as
 * "Conflict" with the blocker named, and cannot be confirmed until it is moved
 * or one of the two is cancelled. Technicians confirm their own shifts from
 * /dashboard/technician/schedule.
 *
 * Dispatch does NOT read shifts yet (SCOPE TO CONFIRM on SP-103) — this is the
 * roster the provider keeps; the matcher still uses working hours + time off.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Loader2, MapPin, Siren, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import {
  ProviderShiftsResponse,
  RosterTechnician,
  SHIFT_STATUS,
  Shift,
  ZONE_SUGGESTIONS,
  addDays,
  dayKey,
  fmtShiftRange,
  fmtShiftTime,
  fromLocalInput,
  shiftHours,
  startOfWeek,
  toLocalInput,
} from '@/lib/shifts';

/* ── Tokens (SP portal, design 2a) ─────────────────────────────────────── */
const GREEN = '#0B7A4E'; const INK = '#182420'; const MUTE = '#55645B'; const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2'; const HAIRLINE = '1px solid #EEF1EE'; const CANVAS = '#F5F7F4';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });
const btn = (kind: 'primary' | 'ghost' | 'danger' = 'ghost'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: kind === 'primary' ? `1px solid ${GREEN}` : kind === 'danger' ? '1px solid #F3C4C4' : BORDER,
  background: kind === 'primary' ? GREEN : kind === 'danger' ? '#FFF5F5' : '#fff',
  color: kind === 'primary' ? '#fff' : kind === 'danger' ? '#B42318' : INK,
});
const input: React.CSSProperties = { width: '100%', border: BORDER, borderRadius: 10, padding: '8px 10px', fontSize: 13, color: INK, background: '#fff' };
const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: MUTE, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' };

const errMsg = (e: unknown) => (e as Error)?.message || 'Something went wrong.';

/* ── Drawer form ─────────────────────────────────────────────────────────── */
interface FormState {
  technicianId: number | '';
  start: string; // datetime-local
  end: string;
  hasBreak: boolean;
  breakStart: string;
  breakEnd: string;
  zones: string[];
  isEmergencyRoster: boolean;
  notes: string;
  repeatWeeks: number; // create only: 1 = just this one
}

function emptyForm(technicianId: number | '' = '', day?: Date): FormState {
  const base = day ? new Date(day) : new Date();
  base.setHours(9, 0, 0, 0);
  const end = new Date(base); end.setHours(18, 0, 0, 0);
  return { technicianId, start: toLocalInput(base), end: toLocalInput(end), hasBreak: false, breakStart: '', breakEnd: '', zones: [], isEmergencyRoster: false, notes: '', repeatWeeks: 1 };
}

function formFromShift(s: Shift): FormState {
  return {
    technicianId: s.technicianId,
    start: toLocalInput(s.shiftStartAt),
    end: toLocalInput(s.shiftEndAt),
    hasBreak: !!(s.breakStartAt && s.breakEndAt),
    breakStart: toLocalInput(s.breakStartAt),
    breakEnd: toLocalInput(s.breakEndAt),
    zones: s.zones.map((z) => z.label),
    isEmergencyRoster: s.isEmergencyRoster,
    notes: s.notes ?? '',
    repeatWeeks: 1,
  };
}

function ZonePicker({ value, onChange, disabled }: { value: string[]; onChange: (z: string[]) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState('');
  const has = (z: string) => value.some((v) => v.toLowerCase() === z.toLowerCase());
  const toggle = (z: string) => onChange(has(z) ? value.filter((v) => v.toLowerCase() !== z.toLowerCase()) : [...value, z]);
  const addCustom = () => {
    const z = custom.trim().replace(/\s+/g, ' ');
    if (z && !has(z)) onChange([...value, z]);
    setCustom('');
  };
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {ZONE_SUGGESTIONS.map((z) => (
          <button key={z} type="button" disabled={disabled} onClick={() => toggle(z)}
            style={{ padding: '5px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
              border: has(z) ? `1px solid ${GREEN}` : BORDER, background: has(z) ? '#E9F4EE' : '#fff', color: has(z) ? GREEN : MUTE }}>
            {z}
          </button>
        ))}
        {value.filter((v) => !ZONE_SUGGESTIONS.some((s) => s.toLowerCase() === v.toLowerCase())).map((z) => (
          <button key={z} type="button" disabled={disabled} onClick={() => toggle(z)}
            style={{ padding: '5px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, border: `1px solid ${GREEN}`, background: '#E9F4EE', color: GREEN, cursor: 'pointer' }}>
            {z} <span aria-hidden>×</span>
          </button>
        ))}
      </div>
      {!disabled && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Add an area (e.g. Dubai Marina, Al Nahda)" value={custom} maxLength={120}
            onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
          <button type="button" style={btn('ghost')} onClick={addCustom} disabled={!custom.trim()}>Add</button>
        </div>
      )}
      <p style={{ fontSize: 11.5, color: FAINT, marginTop: 6 }}>Zones say where this technician serves during the shift. Leave empty for anywhere the company covers.</p>
    </div>
  );
}

function ShiftDrawer({
  mode, shift, technicians, initial, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  shift: Shift | null;
  technicians: RosterTechnician[];
  initial: FormState;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [f, setF] = useState<FormState>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [askCancel, setAskCancel] = useState(false);
  const terminal = shift ? shift.status === 'cancelled' || shift.status === 'completed' : false;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const payload = () => {
    const shiftStartAt = fromLocalInput(f.start); const shiftEndAt = fromLocalInput(f.end);
    if (!shiftStartAt || !shiftEndAt) throw new Error('Pick a start and an end.');
    const breakStartAt = f.hasBreak ? fromLocalInput(f.breakStart) : null;
    const breakEndAt = f.hasBreak ? fromLocalInput(f.breakEnd) : null;
    if (f.hasBreak && (!breakStartAt || !breakEndAt)) throw new Error('Pick both break times, or untick the break.');
    return { shiftStartAt, shiftEndAt, breakStartAt, breakEndAt, isEmergencyRoster: f.isEmergencyRoster, zones: f.zones, notes: f.notes.trim() || null };
  };

  const save = async () => {
    setErr(null); setBusy('save');
    try {
      const p = payload();
      if (mode === 'create') {
        if (!f.technicianId) throw new Error('Pick a technician.');
        const weeks = Math.min(8, Math.max(1, f.repeatWeeks | 0));
        for (let w = 0; w < weeks; w++) {
          const shiftDate = (iso: string) => new Date(new Date(iso).getTime() + w * 7 * 864e5).toISOString();
          await apiPost('/service-provider/shifts', {
            technicianId: f.technicianId,
            ...p,
            shiftStartAt: shiftDate(p.shiftStartAt), shiftEndAt: shiftDate(p.shiftEndAt),
            breakStartAt: p.breakStartAt ? shiftDate(p.breakStartAt) : null, breakEndAt: p.breakEndAt ? shiftDate(p.breakEndAt) : null,
          });
        }
      } else if (shift) {
        await apiPatch(`/service-provider/shifts/${shift.id}`, p);
      }
      await onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  const act = async (action: 'confirm' | 'cancel' | 'complete') => {
    if (!shift) return;
    setErr(null); setBusy(action);
    try {
      await apiPost(`/service-provider/shifts/${shift.id}/${action}`, action === 'cancel' ? { reason: cancelReason.trim() || undefined } : {});
      await onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  const st = shift ? SHIFT_STATUS[shift.status] : null;
  const canComplete = shift && (shift.status === 'assigned' || shift.status === 'confirmed') && shift.phase === 'past';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg overflow-y-auto p-6" style={{ background: '#fff' }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: INK }}>{mode === 'create' ? 'Add shift' : `Shift #${shift?.id}`}</h2>
            {shift && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: st!.bg, color: st!.fg }}>{st!.label}</span>
                <span style={{ fontSize: 12.5, color: MUTE }}>{shift.technicianName} · {fmtShiftRange(shift)} · {shiftHours(shift)} h</span>
              </div>
            )}
          </div>
          <button aria-label="Close" onClick={onClose} style={{ ...btn('ghost'), padding: 6 }}><X size={16} /></button>
        </div>

        {shift?.status === 'conflict_reported' && (
          <div style={{ ...card({ background: '#FFF5F5', border: '1px solid #F3C4C4', padding: '10px 12px', marginBottom: 12 }) }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={16} color="#B42318" style={{ marginTop: 2 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#B42318' }}>Overlaps another shift</p>
                <p style={{ fontSize: 12.5, color: '#7F1D1D', marginTop: 2 }}>{shift.conflictReason}</p>
                <p style={{ fontSize: 12, color: '#7F1D1D', marginTop: 4 }}>Move this shift clear, or cancel one of the two. It cannot be confirmed until then.</p>
              </div>
            </div>
          </div>
        )}
        {err && <div style={{ ...card({ background: '#FDECEC', border: '1px solid #F3C4C4', padding: '8px 12px', marginBottom: 12, color: '#B42318', fontSize: 13 }) }}>{err}</div>}

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <span style={label}>Technician</span>
            <select style={input} value={f.technicianId} disabled={mode === 'edit'} onChange={(e) => set('technicianId', e.target.value ? Number(e.target.value) : '')}>
              <option value="">Pick a technician…</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isLeadCapable ? ' · lead' : ''}{t.status !== 'active' ? ` · ${t.status}` : ''}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><span style={label}>Starts</span><input type="datetime-local" style={input} value={f.start} disabled={terminal} onChange={(e) => set('start', e.target.value)} /></div>
            <div><span style={label}>Ends</span><input type="datetime-local" style={input} value={f.end} disabled={terminal} onChange={(e) => set('end', e.target.value)} /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: INK }}>
            <input type="checkbox" checked={f.hasBreak} disabled={terminal} onChange={(e) => set('hasBreak', e.target.checked)} /> Break inside the shift
          </label>
          {f.hasBreak && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><span style={label}>Break from</span><input type="datetime-local" style={input} value={f.breakStart} disabled={terminal} onChange={(e) => set('breakStart', e.target.value)} /></div>
              <div><span style={label}>Break to</span><input type="datetime-local" style={input} value={f.breakEnd} disabled={terminal} onChange={(e) => set('breakEnd', e.target.value)} /></div>
            </div>
          )}
          <div>
            <span style={label}>Service zones</span>
            <ZonePicker value={f.zones} disabled={terminal} onChange={(z) => set('zones', z)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: INK }}>
            <input type="checkbox" checked={f.isEmergencyRoster} disabled={terminal} onChange={(e) => set('isEmergencyRoster', e.target.checked)} />
            <Siren size={14} color="#D97706" /> Emergency roster (on call for urgent jobs)
          </label>
          <div>
            <span style={label}>Notes</span>
            <textarea style={{ ...input, minHeight: 64 }} value={f.notes} disabled={terminal} maxLength={2000} onChange={(e) => set('notes', e.target.value)} placeholder="Optional — visible to the technician" />
          </div>
          {mode === 'create' && (
            <div>
              <span style={label}>Repeat weekly</span>
              <select style={{ ...input, width: 'auto' }} value={f.repeatWeeks} onChange={(e) => set('repeatWeeks', Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n === 1 ? 'Just this shift' : `This + next ${n - 1} week${n - 1 > 1 ? 's' : ''}`}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          {!terminal && (
            <button style={btn('primary')} disabled={!!busy} onClick={save}>
              {busy === 'save' && <Loader2 size={14} className="animate-spin" />} {mode === 'create' ? 'Add shift' : 'Save changes'}
            </button>
          )}
          {shift && shift.status === 'assigned' && (
            <button style={btn('ghost')} disabled={!!busy} onClick={() => act('confirm')}>{busy === 'confirm' && <Loader2 size={14} className="animate-spin" />} Confirm for them</button>
          )}
          {canComplete && (
            <button style={btn('ghost')} disabled={!!busy} onClick={() => act('complete')}>{busy === 'complete' && <Loader2 size={14} className="animate-spin" />} Mark completed</button>
          )}
          {shift && !terminal && !askCancel && (
            <button style={btn('danger')} disabled={!!busy} onClick={() => setAskCancel(true)}>Cancel shift</button>
          )}
        </div>
        {askCancel && shift && (
          <div style={{ ...card({ background: CANVAS, padding: 12, marginTop: 12 }) }}>
            <span style={label}>Why is this shift cancelled? (optional)</span>
            <input style={input} value={cancelReason} maxLength={500} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. sick day, vehicle unavailable" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button style={btn('danger')} disabled={!!busy} onClick={() => act('cancel')}>{busy === 'cancel' && <Loader2 size={14} className="animate-spin" />} Cancel shift</button>
              <button style={btn('ghost')} disabled={!!busy} onClick={() => setAskCancel(false)}>Keep it</button>
            </div>
          </div>
        )}
        {shift?.status === 'cancelled' && shift.notes && <p style={{ fontSize: 12.5, color: MUTE, marginTop: 12, whiteSpace: 'pre-wrap' }}>{shift.notes}</p>}
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function SpRosterPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [data, setData] = useState<ProviderShiftsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [techFilter, setTechFilter] = useState<number | 'all'>('all');
  const [showCancelled, setShowCancelled] = useState(false);
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'edit'; shift: Shift | null; initial: FormState } | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const load = useCallback(async () => {
    setError(null); setLoading(true);
    try {
      const r = await apiGet<ProviderShiftsResponse>(`/service-provider/shifts?from=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(weekEnd.toISOString())}`);
      setData(r);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [weekStart, weekEnd]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  const technicians = data?.technicians ?? [];
  const rows = techFilter === 'all' ? technicians : technicians.filter((t) => t.id === techFilter);
  const shifts = (data?.shifts ?? []).filter((s) => showCancelled || s.status !== 'cancelled');
  const byCell = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of shifts) {
      const k = `${s.technicianId}|${dayKey(s.shiftStartAt)}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [shifts]);
  const conflicts = shifts.filter((s) => s.status === 'conflict_reported' && s.phase !== 'past');
  const awaiting = shifts.filter((s) => s.status === 'assigned' && s.phase === 'upcoming');
  const totalHours = shifts.filter((s) => s.status !== 'cancelled').reduce((a, s) => a + shiftHours(s), 0);
  const todayKey = dayKey(new Date());
  const weekLabel = `${weekStart.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const openCreate = (technicianId: number | '' = '', day?: Date) => setDrawer({ mode: 'create', shift: null, initial: emptyForm(technicianId, day) });
  const openEdit = (s: Shift) => setDrawer({ mode: 'edit', shift: s, initial: formFromShift(s) });
  return (
    <DashboardPage
      title="Roster"
      subtitle="Who works when, and where — shifts per technician with service zones. Overlaps are flagged, never silent."
      actions={<button style={btn('primary')} onClick={() => openCreate()} disabled={!technicians.length}><CalendarPlus size={15} /> Add shift</button>}
    >
      {error && <div style={{ ...card({ background: '#FDECEC', border: '1px solid #F3C4C4', padding: '10px 14px', marginBottom: 14, color: '#B42318', fontSize: 13 }) }}>{error}</div>}

      {/* Week toolbar */}
      <div style={{ ...card({ padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }) }}>
        <button aria-label="Previous week" style={{ ...btn('ghost'), padding: 6 }} onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={16} /></button>
        <button style={btn('ghost')} onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
        <button aria-label="Next week" style={{ ...btn('ghost'), padding: 6 }} onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={16} /></button>
        <span style={{ fontSize: 14, fontWeight: 700, color: INK, marginLeft: 4 }}>{weekLabel}</span>
        <span style={{ flex: 1 }} />
        <select style={{ ...input, width: 'auto' }} value={techFilter} onChange={(e) => setTechFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All technicians</option>
          {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: MUTE }}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled
        </label>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div style={card({ padding: '10px 14px' })}><p style={{ fontSize: 11.5, color: FAINT }}>Shifts this week</p><p style={{ fontSize: 20, fontWeight: 800, color: INK }}>{shifts.filter((s) => s.status !== 'cancelled').length}</p></div>
        <div style={card({ padding: '10px 14px' })}><p style={{ fontSize: 11.5, color: FAINT }}>Rostered hours</p><p style={{ fontSize: 20, fontWeight: 800, color: INK }}>{Math.round(totalHours * 10) / 10} h</p></div>
        <div style={card({ padding: '10px 14px' })}><p style={{ fontSize: 11.5, color: FAINT }}>Awaiting confirmation</p><p style={{ fontSize: 20, fontWeight: 800, color: awaiting.length ? '#4338CA' : INK }}>{awaiting.length}</p></div>
        <div style={card({ padding: '10px 14px', border: conflicts.length ? '1px solid #F3C4C4' : BORDER })}><p style={{ fontSize: 11.5, color: FAINT }}>Conflicts</p><p style={{ fontSize: 20, fontWeight: 800, color: conflicts.length ? '#B42318' : INK }}>{conflicts.length}</p></div>
      </div>

      {conflicts.length > 0 && (
        <div style={{ ...card({ background: '#FFF5F5', border: '1px solid #F3C4C4', padding: '10px 14px', marginBottom: 14 }) }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={16} color="#B42318" style={{ marginTop: 2 }} />
            <div style={{ fontSize: 13, color: '#7F1D1D' }}>
              <b>{conflicts.length} shift{conflicts.length === 1 ? '' : 's'} overlap{conflicts.length === 1 ? 's' : ''} another shift for the same technician.</b>{' '}
              {conflicts.slice(0, 3).map((s) => (
                <button key={s.id} onClick={() => openEdit(s)} style={{ background: 'none', border: 0, padding: 0, textDecoration: 'underline', color: '#B42318', cursor: 'pointer', fontSize: 13, marginRight: 8 }}>
                  {s.technicianName} · {new Date(s.shiftStartAt).toLocaleDateString('en-AE', { weekday: 'short' })} {fmtShiftRange(s)}
                </button>
              ))}
              {conflicts.length > 3 && <span>+{conflicts.length - 3} more</span>}
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      <div style={card({ overflow: 'hidden' })}>
        {loading && !data ? (
          <div style={{ padding: 32, textAlign: 'center', color: MUTE, fontSize: 13 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline', marginRight: 6 }} /> Loading roster…</div>
        ) : !technicians.length ? (
          <div style={{ padding: 32, textAlign: 'center', color: MUTE, fontSize: 13 }}>
            No technicians on the team yet. <Link href="/dashboard/service-provider/settings?tab=team" style={{ color: GREEN, textDecoration: 'underline' }}>Add your team</Link> first, then roster their shifts here.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 900, borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: BORDER, color: FAINT, fontWeight: 600, position: 'sticky', left: 0, background: '#fff', minWidth: 160 }}>Technician</th>
                  {days.map((d) => {
                    const k = dayKey(d); const today = k === todayKey;
                    return (
                      <th key={k} style={{ textAlign: 'left', padding: '10px 10px', borderBottom: BORDER, borderLeft: HAIRLINE, color: today ? GREEN : MUTE, fontWeight: 700, background: today ? '#F2FAF6' : '#fff' }}>
                        {d.toLocaleDateString('en-AE', { weekday: 'short' })} <span style={{ fontWeight: 500, color: today ? GREEN : FAINT }}>{d.getDate()}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td style={{ padding: '10px 12px', borderBottom: HAIRLINE, position: 'sticky', left: 0, background: '#fff', verticalAlign: 'top' }}>
                      <p style={{ fontWeight: 700, color: INK }}>{t.name}</p>
                      <p style={{ fontSize: 11, color: FAINT }}>{t.isLeadCapable ? 'Lead · ' : ''}{t.status}{t.complianceStatus !== 'compliant' ? ` · ${t.complianceStatus.replace(/_/g, ' ')}` : ''}</p>
                    </td>
                    {days.map((d) => {
                      const k = dayKey(d);
                      const cell = byCell.get(`${t.id}|${k}`) ?? [];
                      const today = k === todayKey;
                      return (
                        <td key={k} style={{ padding: 6, borderBottom: HAIRLINE, borderLeft: HAIRLINE, verticalAlign: 'top', background: today ? '#FBFDFC' : undefined, minWidth: 110 }}>
                          <div style={{ display: 'grid', gap: 6 }}>
                            {cell.map((s) => {
                              const st = SHIFT_STATUS[s.status];
                              const conflict = s.status === 'conflict_reported';
                              return (
                                <button key={s.id} onClick={() => openEdit(s)} title={s.conflictReason ?? `${st.label} · ${shiftHours(s)} h`}
                                  style={{ textAlign: 'left', borderRadius: 10, padding: '6px 8px', cursor: 'pointer', background: st.bg, color: st.fg,
                                    border: conflict ? '1px solid #F3C4C4' : `1px solid ${st.bg}`, opacity: s.status === 'cancelled' ? 0.7 : 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
                                    {conflict && <AlertTriangle size={12} />}{s.isEmergencyRoster && <Siren size={12} />}
                                    <span>{fmtShiftTime(s.shiftStartAt)}–{fmtShiftTime(s.shiftEndAt)}</span>
                                  </div>
                                  {s.zones.length > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, opacity: 0.9, marginTop: 2 }}>
                                      <MapPin size={10} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.zones.map((z) => z.label).join(', ')}</span>
                                    </div>
                                  )}
                                  <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 1 }}>{st.label}{s.breakStartAt ? ' · break' : ''}</div>
                                </button>
                              );
                            })}
                            <button onClick={() => openCreate(t.id, d)} aria-label={`Add shift for ${t.name} on ${k}`}
                              style={{ border: '1px dashed #E4E7E2', borderRadius: 8, padding: '4px 0', color: FAINT, fontSize: 11, background: 'transparent', cursor: 'pointer' }}>
                              +
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ fontSize: 11.5, color: FAINT, marginTop: 10 }}>
        Times are shown in your device&apos;s time zone. Technicians confirm their shifts from their own app; a shift that overlaps another for the same person is saved as a <b>Conflict</b> and must be moved or cancelled before it can be confirmed.
        Company opening hours and days off stay in <Link href="/dashboard/service-provider/settings" style={{ textDecoration: 'underline' }}>Settings → Job-ready → When you work</Link>.
      </p>

      {drawer && (
        <ShiftDrawer key={`${drawer.mode}-${drawer.shift?.id ?? 'new'}`} mode={drawer.mode} shift={drawer.shift} technicians={technicians} initial={drawer.initial} onClose={() => setDrawer(null)} onSaved={load} />
      )}
    </DashboardPage>
  );
}
