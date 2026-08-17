/**
 * ReschedulePanel (SP-190) — propose a new time for a booking, or answer the
 * other side's proposal. Same component for the customer (My Services row) and
 * the provider (job detail); the API decides who may do what.
 *
 * Reads GET /bookings/:id/reschedule-preview (limits, open proposal, fee tier)
 * and posts /reschedule · /:reqId/accept|reject|withdraw. Booking status is
 * never changed by a proposal — the parent re-loads to pick up a moved time.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Loader2, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

export interface RescheduleView {
  id: number; status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'; proposedByRole: 'customer' | 'provider' | 'admin';
  fromScheduledAt: string; toScheduledAt: string; reason: string | null; feePct: number | null; feeAmount: number | null;
  decidedByRole: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string;
  canAccept: boolean; canReject: boolean; canWithdraw: boolean;
}
interface Preview {
  bookingId: number; role: 'customer' | 'provider' | 'admin'; currentScheduledAt: string; bookingStatus: string;
  canPropose: boolean; blockedReason: string | null; proposalsUsed: number; proposalsMax: number; minLeadHours: number; maxAheadDays: number;
  fee: { feePct: number | null; feeAmount: number | null; hoursBefore: number; currency: string; informational: boolean };
  proposedTimeProblem: string | null; pending: RescheduleView | null; cancelPreviewPath: string;
}

const GREEN = '#0B7A4E'; const INK = '#182420'; const MUTE = '#55645B'; const FAINT = '#8A968D'; const BORDER = '1px solid #E4E7E2';
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' });
const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toLocalInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const btn = (kind: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  border: kind === 'primary' ? `1px solid ${GREEN}` : kind === 'danger' ? '1px solid #F3C4C4' : BORDER,
  background: kind === 'primary' ? GREEN : kind === 'danger' ? '#FFF5F5' : '#fff',
  color: kind === 'primary' ? '#fff' : kind === 'danger' ? '#B42318' : INK,
});
const otherSide = (me: Preview['role'], who: RescheduleView['proposedByRole']) => (who === me ? 'You' : who === 'customer' ? 'The customer' : who === 'provider' ? 'The provider' : 'UpNow');

export function ReschedulePanel({ bookingId, bookingStatus, onChanged, compact }: { bookingId: number; bookingStatus: string; onChanged?: () => void | Promise<void>; compact?: boolean }) {
  const eligible = ['confirmed', 'assigned'].includes(bookingStatus);
  const [pv, setPv] = useState<Preview | null>(null);
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ problem: string | null; fee: Preview['fee'] } | null>(null);

  const load = useCallback(async () => {
    if (!eligible) return;
    try { setPv(await apiGet<Preview>(`/bookings/${bookingId}/reschedule-preview`)); } catch { setPv(null); }
  }, [bookingId, eligible]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  const check = async (v: string) => {
    setWhen(v); setChecked(null);
    if (!v) return;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return;
    try {
      const p = await apiGet<Preview>(`/bookings/${bookingId}/reschedule-preview?at=${encodeURIComponent(d.toISOString())}`);
      setChecked({ problem: p.proposedTimeProblem, fee: p.fee });
    } catch { /* ignore */ }
  };

  const act = async (fn: () => Promise<unknown>, key: string) => {
    setBusy(key); setErr(null);
    try { await fn(); setOpen(false); setWhen(''); setReason(''); setNote(''); await load(); await onChanged?.(); }
    catch (e) { setErr((e as Error)?.message || 'Something went wrong.'); }
    finally { setBusy(null); }
  };
  const propose = () => {
    const d = new Date(when);
    if (!when || Number.isNaN(d.getTime())) { setErr('Pick a date and time.'); return; }
    return act(() => apiPost(`/bookings/${bookingId}/reschedule`, { toScheduledAt: d.toISOString(), reason: reason.trim() || undefined }), 'propose');
  };
  const decide = (id: number, action: 'accept' | 'reject' | 'withdraw') =>
    act(() => apiPost(`/bookings/${bookingId}/reschedule/${id}/${action}`, { note: note.trim() || undefined }), action);

  if (!eligible || !pv) return null;
  const pending = pv.pending;

  return (
    <div style={{ border: BORDER, borderRadius: 12, padding: compact ? '10px 12px' : '12px 14px', marginTop: 12, background: pending ? '#FBFDFC' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <CalendarClock size={15} color={GREEN} />
        <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{pending ? 'New time proposed' : 'Need a different time?'}</span>
        <span style={{ fontSize: 11.5, color: FAINT }}>{pv.proposalsUsed}/{pv.proposalsMax} proposals used</span>
        <span style={{ flex: 1 }} />
        {!pending && !open && (
          <button style={btn('ghost')} disabled={!pv.canPropose} title={pv.blockedReason ?? undefined} onClick={() => { setOpen(true); setErr(null); const d = new Date(pv.currentScheduledAt); d.setDate(d.getDate() + 1); setWhen(toLocalInput(d)); void check(toLocalInput(d)); }}>
            Propose a new time
          </button>
        )}
      </div>
      {!pending && !pv.canPropose && pv.blockedReason && <p style={{ fontSize: 12, color: MUTE, marginTop: 6 }}>{pv.blockedReason}</p>}
      {err && <p style={{ fontSize: 12.5, color: '#B42318', marginTop: 8 }}>{err}</p>}

      {pending && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: INK }}>
          <p><b>{otherSide(pv.role, pending.proposedByRole)}</b> proposed <b>{fmtWhen(pending.toScheduledAt)}</b> <span style={{ color: FAINT }}>(currently {fmtWhen(pending.fromScheduledAt)})</span>{pending.reason ? <> — <i>{pending.reason}</i></> : null}</p>
          {pending.feePct != null && pending.feePct > 0 && pv.role !== 'provider' && (
            <p style={{ color: '#92400E', marginTop: 4 }}>Late-change fee under the booking policy: {pending.feePct}% ({pending.feeAmount != null ? aed(pending.feeAmount) : '—'}) — recorded, not charged yet.</p>
          )}
          {(pending.canAccept || pending.canReject) && (
            <div style={{ marginTop: 8 }}>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional note to the other side" style={{ width: '100%', border: BORDER, borderRadius: 8, padding: '6px 9px', fontSize: 12.5, marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {pending.canAccept && <button style={btn('primary')} disabled={!!busy} onClick={() => decide(pending.id, 'accept')}>{busy === 'accept' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Accept new time</button>}
                {pending.canReject && <button style={btn('danger')} disabled={!!busy} onClick={() => decide(pending.id, 'reject')}>{busy === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Keep the original time</button>}
              </div>
              <p style={{ fontSize: 11.5, color: FAINT, marginTop: 6 }}>If neither time works, you can still cancel under the booking&apos;s cancellation policy.</p>
            </div>
          )}
          {pending.canWithdraw && !pending.canAccept && (
            <button style={{ ...btn('ghost'), marginTop: 8 }} disabled={!!busy} onClick={() => decide(pending.id, 'withdraw')}>{busy === 'withdraw' && <Loader2 size={13} className="animate-spin" />} Withdraw my proposal</button>
          )}
          {!pending.canAccept && !pending.canWithdraw && <p style={{ fontSize: 12, color: MUTE, marginTop: 6 }}>Waiting for the other side to answer.</p>}
        </div>
      )}

      {open && !pending && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 11.5, color: MUTE, display: 'block', marginBottom: 3 }}>New date &amp; time</label>
              <input type="datetime-local" value={when} onChange={(e) => void check(e.target.value)} style={{ width: '100%', border: BORDER, borderRadius: 8, padding: '6px 9px', fontSize: 12.5 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: MUTE, display: 'block', marginBottom: 3 }}>Reason (optional)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. travelling that day" style={{ width: '100%', border: BORDER, borderRadius: 8, padding: '6px 9px', fontSize: 12.5 }} />
            </div>
          </div>
          {checked?.problem && <p style={{ fontSize: 12, color: '#B42318' }}>{checked.problem}</p>}
          {!checked?.problem && pv.role === 'customer' && pv.fee.feePct != null && pv.fee.feePct > 0 && (
            <p style={{ fontSize: 12, color: '#92400E' }}>Changing this close to the appointment carries a {pv.fee.feePct}% late-change fee ({pv.fee.feeAmount != null ? aed(pv.fee.feeAmount) : '—'}) under the booking policy — recorded with your proposal, not charged yet.</p>
          )}
          <p style={{ fontSize: 11.5, color: FAINT }}>Must be at least {pv.minLeadHours} h from now and within {pv.maxAheadDays} days. The other side has to accept before anything changes.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn('primary')} disabled={!!busy || !!checked?.problem} onClick={propose}>{busy === 'propose' && <Loader2 size={13} className="animate-spin" />} Send proposal</button>
            <button style={btn('ghost')} disabled={!!busy} onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
