/**
 * DisputeThreadPanel (SP-265) — what a PARTY (customer / provider) sees of a
 * dispute case: UpNow's questions to them, their answers, system lines; and a
 * reply box. Internal notes and the other side's questions are filtered
 * server-side. The owner's name is never shown — only that it is in review.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

interface Note { id: number; kind: string; authorRole: string; body: string; createdAt: string }
interface Case { id: number; status: string; priority: string; title: string; notes: Note[]; viewer: 'customer' | 'provider' | 'admin' }
const OPEN = new Set(['open', 'under_review', 'awaiting_evidence', 'escalated']);
const INK = '#182420'; const MUTE = '#55645B'; const FAINT = '#8A968D'; const BORDER = '1px solid #E4E7E2'; const GREEN = '#0B7A4E';
const fmt = (iso: string) => new Date(iso).toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' });
const label = (n: Note, viewer: string) => n.kind === 'answer' ? (n.authorRole === viewer ? 'You' : n.authorRole === 'customer' ? 'Customer' : 'Provider') : n.kind === 'system' ? 'UpNow' : 'UpNow asked';

export function DisputeThreadPanel({ disputeId, compact }: { disputeId: number; compact?: boolean }) {
  const [c, setC] = useState<Case | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setC(await apiGet<Case>(`/disputes/${disputeId}/case`)); } catch { setC(null); } }, [disputeId]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  if (!c) return null;
  const visible = c.notes.filter((n) => n.kind !== 'system' || /Opened/.test(n.body) === false); // hide the noisy opened line for parties
  const open = OPEN.has(c.status);
  const asked = c.notes.some((n) => n.kind.startsWith('question_')) && c.status === 'awaiting_evidence';
  const send = async () => {
    setBusy(true); setErr(null);
    try { await apiPost(`/disputes/${disputeId}/reply`, { body: text }); setText(''); await load(); } catch (e) { setErr((e as Error)?.message || 'Could not send.'); } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 10, border: BORDER, borderRadius: 12, padding: compact ? '10px 12px' : '12px 14px', background: asked ? '#FBFDFC' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: INK }}>
        <MessageSquare size={13} color={GREEN} /> Case updates
        <span style={{ fontSize: 11, color: FAINT, fontWeight: 400 }}>· {open ? 'in review by UpNow' : 'closed'}</span>
      </div>
      {visible.length === 0 ? <p style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>No questions from UpNow yet. You can add context below.</p> : (
        <div style={{ display: 'grid', gap: 6, marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
          {visible.map((n) => (
            <div key={n.id} style={{ border: BORDER, borderRadius: 9, padding: '6px 9px', background: n.kind.startsWith('question_') ? '#EEF2FF' : '#fff' }}>
              <div style={{ fontSize: 11, color: FAINT, display: 'flex', gap: 6 }}><b style={{ color: n.kind.startsWith('question_') ? '#4338CA' : MUTE }}>{label(n, c.viewer)}</b><span style={{ marginLeft: 'auto' }}>{fmt(n.createdAt)}</span></div>
              <p style={{ fontSize: 12.5, color: INK, marginTop: 3, whiteSpace: 'pre-wrap' }}>{n.body}</p>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder={asked ? 'Answer UpNow’s question…' : 'Add context for the UpNow team…'} style={{ flex: 1, border: BORDER, borderRadius: 9, padding: '7px 10px', fontSize: 12.5 }} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) void send(); }} />
          <button disabled={busy || !text.trim()} onClick={send} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: GREEN, color: '#fff', border: 0, borderRadius: 9, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: busy || !text.trim() ? 0.6 : 1 }}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send</button>
        </div>
      )}
      {err && <p style={{ fontSize: 12, color: '#B42318', marginTop: 6 }}>{err}</p>}
    </div>
  );
}
