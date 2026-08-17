'use client';

/**
 * Admin · Disputes (SP-265 case management) — a queue, not a list: open first,
 * priority → age; "mine" / "unassigned" filters; each row carries owner,
 * priority, SLA clocks (breach = a fact stamped by the 5-min cron); expanding
 * a row opens the case: threaded notes (internal · questions · answers),
 * evidence photos (SP-258), booking trail, and the resolve actions.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Loader2, MessageSquare, ShieldAlert, UserCircle } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

const PRIMARY = '#2e9f82'; const INK = '#1a1916'; const MUTE = '#6b6860'; const FAINT = '#9b9890'; const BORDER = '1px solid #ececea';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 16, ...extra });
const aed = (n: number | string | null) => (n == null ? '—' : `AED ${Number(n).toLocaleString('en-AE')}`);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const ago = (iso: string | null) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };
const inH = (iso: string | null) => { if (!iso) return ''; const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000); const a = Math.abs(m); const s = a < 60 ? `${a}m` : a < 1440 ? `${Math.floor(a / 60)}h` : `${Math.floor(a / 1440)}d`; return m >= 0 ? `in ${s}` : `${s} ago`; };

type Priority = 'critical' | 'high' | 'medium' | 'low';
interface Sla { firstResponseDueAt: string | null; resolutionDueAt: string | null; firstRespondedAt: string | null; firstResponseBreachedAt: string | null; resolutionBreachedAt: string | null; firstResponseLate: boolean; resolutionLate: boolean }
interface Row {
  id: number; status: string; priority: Priority; title: string; description: string | null; resolutionSummary: string | null;
  openedAt: string; resolvedAt: string | null; bookingId: number | null; serviceName: string | null; amount: number | string | null;
  customerName: string; providerName: string | null; providerResponse: string | null; providerRespondedAt: string | null;
  assignedToUserId: number | null; assignedToName: string | null; sla: Sla; notes: number; unassigned: boolean;
}
interface Note { id: number; kind: string; authorRole: string; authorName: string | null; body: string; createdAt: string }
interface Media { id: number; kind: 'problem' | 'before' | 'after'; caption: string | null; viewUrl: string; createdAt: string }
interface Case extends Omit<Row, 'notes'> { viewer: string; notes: Note[]; evidence: { problem: Media[]; before: Media[]; after: Media[] } | Media[] | null; trail: Array<{ id: number; toStatus: string; fromStatus: string | null; reason: string | null; createdAt: string }>; admins: Array<{ id: number; name: string }> }
interface Queue { admins: Array<{ id: number; name: string }>; disputes: Row[] }

const OPEN = new Set(['open', 'under_review', 'awaiting_evidence', 'escalated']);
const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: '#fee2e2', fg: '#991b1b' }, under_review: { label: 'Under review', bg: '#fef3c7', fg: '#92400e' },
  awaiting_evidence: { label: 'Awaiting answer', bg: '#e0e7ff', fg: '#4338ca' }, escalated: { label: 'Escalated', bg: '#fee2e2', fg: '#991b1b' },
  resolved: { label: 'Refunded', bg: '#d8f2e8', fg: '#1a7a5a' }, rejected: { label: 'For provider', bg: '#eef1ee', fg: '#4b5563' }, closed: { label: 'Closed', bg: '#eef1ee', fg: '#4b5563' },
};
const PRIO: Record<Priority, { label: string; bg: string; fg: string }> = {
  critical: { label: 'Critical', bg: '#fee2e2', fg: '#991b1b' }, high: { label: 'High', bg: '#fef3c7', fg: '#92400e' }, medium: { label: 'Medium', bg: '#eef1ee', fg: '#4b5563' }, low: { label: 'Low', bg: '#f5f5f4', fg: '#9b9890' },
};
const NOTE_UI: Record<string, { label: string; bg: string; fg: string }> = {
  internal: { label: 'Internal', bg: '#f5f5f4', fg: '#6b6860' }, question_to_customer: { label: 'Question → customer', bg: '#e0e7ff', fg: '#4338ca' },
  question_to_provider: { label: 'Question → provider', bg: '#e0e7ff', fg: '#4338ca' }, answer: { label: 'Answer', bg: '#d8f2e8', fg: '#1a7a5a' }, system: { label: 'System', bg: '#fff', fg: '#9b9890' },
};
const chip = (t: { label: string; bg: string; fg: string }) => <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>{t.label}</span>;
const mediaOf = (m: Case['evidence'], kind: Media['kind']): Media[] => (Array.isArray(m) ? m.filter((x) => x.kind === kind) : m?.[kind] ?? []);

export default function AdminDisputesPage() {
  const [q, setQ] = useState<Queue | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [c, setC] = useState<Case | null>(null);
  const [noteKind, setNoteKind] = useState<'internal' | 'question_to_customer' | 'question_to_provider'>('internal');
  const [noteBody, setNoteBody] = useState('');

  const load = useCallback(async () => {
    try { setQ(await apiGet<Queue>(`/disputes/queue${filter === 'mine' ? '?mine=1' : filter === 'unassigned' ? '?unassigned=1' : ''}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load disputes'); }
  }, [filter]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  const loadCase = useCallback(async (id: number) => { try { setC(await apiGet<Case>(`/disputes/${id}/case`)); } catch (e) { setError((e as Error)?.message || 'Could not load case'); } }, []);
  useEffect(() => { const t = setTimeout(() => { if (openId) void loadCase(openId); else setC(null); }, 0); return () => clearTimeout(t); }, [openId, loadCase]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); if (openId) await loadCase(openId); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(null); }
  };
  const resolve = (id: number, outcome: 'refund_customer' | 'favor_provider') => act(`resolve-${id}`, () => apiPatch(`/disputes/${id}/resolve`, { outcome }));
  const assign = (id: number, userId: number | null) => act(`assign-${id}`, () => apiPatch(`/disputes/${id}/assign`, { userId }));
  const setPriority = (id: number, priority: Priority) => act(`prio-${id}`, () => apiPatch(`/disputes/${id}/priority`, { priority }));
  const addNote = (id: number) => act(`note-${id}`, async () => { await apiPost(`/disputes/${id}/notes`, { kind: noteKind, body: noteBody }); setNoteBody(''); });

  if (!q) return <div style={{ padding: 24, color: FAINT }}>{error ?? 'Loading disputes…'}</div>;
  const rows = q.disputes;
  const openCount = rows.filter((d) => OPEN.has(d.status)).length;
  const unassignedCount = rows.filter((d) => d.unassigned).length;
  const lateCount = rows.filter((d) => d.sla.firstResponseLate || d.sla.resolutionLate).length;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '8px 4px 48px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: PRIMARY }}>Support</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Disputes</h1>
      <p style={{ color: MUTE, fontSize: 14, marginTop: 4 }}>{openCount} open · {unassignedCount} unassigned · {lateCount} past an SLA clock. Priority → age; assign an owner, ask a question, then resolve.</p>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {(['all', 'mine', 'unassigned'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: filter === f ? `1px solid ${PRIMARY}` : BORDER, background: filter === f ? '#e6f4ef' : '#fff', color: filter === f ? PRIMARY : MUTE }}>
            {f === 'all' ? 'All' : f === 'mine' ? 'My disputes' : `Unassigned${unassignedCount ? ` (${unassignedCount})` : ''}`}
          </button>
        ))}
      </div>

      {error && <div style={{ marginTop: 12, background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      {rows.length === 0 ? (
        <div style={card({ marginTop: 18, padding: '34px 18px', textAlign: 'center', color: FAINT, fontSize: 14 })}>No disputes here. 🎉</div>
      ) : (
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((d) => {
            const st = STATUS[d.status] ?? STATUS.open;
            const isOpen = OPEN.has(d.status);
            const expanded = openId === d.id;
            const late = d.sla.firstResponseLate || d.sla.resolutionLate;
            return (
              <div key={d.id} style={card({ padding: '14px 18px', borderColor: late ? '#f3c6c6' : d.unassigned ? '#f5d9a8' : isOpen ? '#e4e7e2' : '#ececea' })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>#{d.id} · {d.title}</span>
                  {chip(PRIO[d.priority] ?? PRIO.medium)}
                  {chip(st)}
                  {d.unassigned && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: '#fef6e7', color: '#92400e' }}><UserCircle size={11} /> Unassigned</span>}
                  {late && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: '#fee2e2', color: '#991b1b' }}><AlertTriangle size={11} /> {d.sla.firstResponseLate ? 'First response late' : 'Resolution late'}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: FAINT }}>opened {ago(d.openedAt)} ago</span>
                  <button onClick={() => setOpenId(expanded ? null : d.id)} aria-label={expanded ? 'Collapse' : 'Open case'} style={{ border: 0, background: 'none', cursor: 'pointer', color: FAINT }}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                </div>
                <div style={{ fontSize: 13, color: MUTE, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>{d.customerName} vs {d.providerName ?? 'provider'} · {d.serviceName ?? 'service'} <span style={{ fontFamily: 'ui-monospace, monospace' }}>BK-{d.bookingId}</span> · {aed(d.amount)}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><UserCircle size={12} /> {d.assignedToName ?? 'nobody'}</span>
                  {isOpen && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: d.sla.firstResponseLate ? '#b42318' : MUTE }}><Clock size={12} /> first response {d.sla.firstRespondedAt ? `done ${ago(d.sla.firstRespondedAt)} ago` : inH(d.sla.firstResponseDueAt)}</span>}
                  {isOpen && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: d.sla.resolutionLate ? '#b42318' : MUTE }}><Clock size={12} /> resolve {inH(d.sla.resolutionDueAt)}</span>}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MessageSquare size={12} /> {d.notes}</span>
                </div>

                {expanded && (
                  <div style={{ marginTop: 14, borderTop: BORDER, paddingTop: 14 }}>
                    {!c || c.id !== d.id ? <p style={{ fontSize: 12.5, color: FAINT }}><Loader2 size={12} className="animate-spin" style={{ display: 'inline' }} /> Loading case…</p> : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                        <div>
                          {/* Ownership + priority */}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <label style={{ fontSize: 12, color: MUTE }}>Owner</label>
                            <select value={d.assignedToUserId ?? ''} disabled={!!busy || !isOpen} onChange={(e) => assign(d.id, e.target.value ? Number(e.target.value) : null)} style={{ border: BORDER, borderRadius: 8, padding: '5px 8px', fontSize: 12.5 }}>
                              <option value="">Unassigned</option>
                              {q.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                            <label style={{ fontSize: 12, color: MUTE, marginLeft: 8 }}>Priority</label>
                            <select value={d.priority} disabled={!!busy || !isOpen} onChange={(e) => setPriority(d.id, e.target.value as Priority)} style={{ border: BORDER, borderRadius: 8, padding: '5px 8px', fontSize: 12.5 }}>
                              {(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => <option key={p} value={p}>{PRIO[p].label}</option>)}
                            </select>
                          </div>
                          {d.description && <p style={{ fontSize: 13.5, color: '#4A544D', marginTop: 10, lineHeight: 1.5 }}>{d.description}</p>}
                          {d.providerResponse && (
                            <div style={{ marginTop: 10, padding: '9px 12px', background: '#F5F7F4', borderRadius: 9, borderLeft: '3px solid #0B7A4E' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#0B7A4E' }}>Provider&apos;s response</div>
                              <p style={{ fontSize: 13, color: '#182420', marginTop: 4, lineHeight: 1.5 }}>{d.providerResponse}</p>
                            </div>
                          )}
                          {/* Thread */}
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: FAINT }}>Case thread</div>
                            <div style={{ display: 'grid', gap: 6, marginTop: 6, maxHeight: 320, overflowY: 'auto' }}>
                              {c.notes.map((n) => (
                                <div key={n.id} style={{ border: BORDER, borderRadius: 10, padding: '7px 10px', background: n.kind === 'internal' ? '#fafaf8' : '#fff' }}>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: FAINT }}>{chip(NOTE_UI[n.kind] ?? NOTE_UI.system)}<span>{n.authorName ?? n.authorRole}</span><span style={{ marginLeft: 'auto' }}>{fmt(n.createdAt)}</span></div>
                                  <p style={{ fontSize: 13, color: INK, marginTop: 4, whiteSpace: 'pre-wrap' }}>{n.body}</p>
                                </div>
                              ))}
                            </div>
                            {isOpen && (
                              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  {(['internal', 'question_to_customer', 'question_to_provider'] as const).map((k) => (
                                    <button key={k} onClick={() => setNoteKind(k)} style={{ padding: '4px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: noteKind === k ? `1px solid ${PRIMARY}` : BORDER, background: noteKind === k ? '#e6f4ef' : '#fff', color: noteKind === k ? PRIMARY : MUTE }}>{NOTE_UI[k].label}</button>
                                  ))}
                                </div>
                                <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} maxLength={4000} placeholder={noteKind === 'internal' ? 'Internal note — never shown to the parties' : 'Your question — the party is notified and can answer here'} style={{ border: BORDER, borderRadius: 9, padding: '7px 10px', fontSize: 13, minHeight: 56 }} />
                                <div><button disabled={!!busy || !noteBody.trim()} onClick={() => addNote(d.id)} style={{ background: '#fff', border: BORDER, borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, color: INK, cursor: 'pointer' }}>{busy === `note-${d.id}` ? '…' : noteKind === 'internal' ? 'Add note' : 'Send question'}</button></div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div>
                          {/* Evidence + trail + outcome */}
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: FAINT }}>Evidence (SP-258)</div>
                          {(['problem', 'before', 'after'] as const).map((k) => {
                            const list = mediaOf(c.evidence, k);
                            return (
                              <div key={k} style={{ marginTop: 6 }}>
                                <div style={{ fontSize: 11.5, color: MUTE }}>{k === 'problem' ? 'Problem — from the customer' : k === 'before' ? 'Before work' : 'Finished work'} · {list.length}</div>
                                {list.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{list.map((m) => <a key={m.id} href={m.viewUrl} target="_blank" rel="noreferrer"><img src={m.viewUrl} alt={m.caption ?? k} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: BORDER }} /></a>)}</div>}
                              </div>
                            );
                          })}
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: FAINT, marginTop: 12 }}>Booking trail</div>
                          <div style={{ display: 'grid', gap: 3, marginTop: 4, maxHeight: 180, overflowY: 'auto', fontSize: 12, color: MUTE }}>
                            {c.trail.length === 0 ? <span>—</span> : c.trail.map((t) => <div key={t.id}><span style={{ color: FAINT }}>{fmt(t.createdAt)}</span> · {t.fromStatus ? `${t.fromStatus} → ` : ''}{t.toStatus}{t.reason ? ` — ${t.reason}` : ''}</div>)}
                          </div>
                          {d.bookingId && <Link href={`/dashboard/admin/bookings/${d.bookingId}`} style={{ fontSize: 12.5, color: PRIMARY, fontWeight: 600, display: 'inline-block', marginTop: 8 }}>Open booking BK-{d.bookingId} →</Link>}

                          {isOpen ? (
                            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                              <button disabled={!!busy} onClick={() => resolve(d.id, 'refund_customer')} style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{busy === `resolve-${d.id}` ? '…' : 'Refund customer (full)'}</button>
                              <button disabled={!!busy} onClick={() => resolve(d.id, 'favor_provider')} style={{ background: '#fff', border: BORDER, borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: MUTE, cursor: 'pointer' }}>Find for provider</button>
                            </div>
                          ) : (
                            <p style={{ fontSize: 12.5, color: FAINT, marginTop: 12, fontStyle: 'italic', display: 'inline-flex', gap: 6, alignItems: 'center' }}><ShieldAlert size={12} /> {d.resolutionSummary ?? 'Closed'} · {fmt(d.resolvedAt)}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
