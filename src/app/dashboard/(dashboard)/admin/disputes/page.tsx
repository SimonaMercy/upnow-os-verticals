'use client';

/**
 * Admin › Trust & safety › Disputes (SP-265 case management) — Genspark OS rebuild.
 * A queue, not a list: the server orders it (open first, priority → age).
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET /disputes/queue (+ ?mine=1 | ?unassigned=1) — queue + admins list; the
 *    All / My disputes / Unassigned (count) filter is still server-side.
 *  - GET /disputes/:id/case — lazy case load when a case is opened (now in a Drawer
 *    instead of an inline expander); reloaded after every action.
 *  - PATCH /disputes/:id/assign { userId: number | null } — Owner select (Unassigned + admins).
 *  - PATCH /disputes/:id/priority { priority } — Priority select (critical/high/medium/low).
 *  - POST /disputes/:id/notes { kind, body } — note composer, kind = internal |
 *    question_to_customer | question_to_provider, maxLength 4000, "Add note" / "Send question".
 *  - PATCH /disputes/:id/resolve { outcome: 'refund_customer' | 'favor_provider' } —
 *    "Refund customer (full)" / "Find for provider" (now behind a confirm step; same payload).
 *  - Owner / priority / notes / resolve only while the case is open (open, under_review,
 *    awaiting_evidence, escalated); closed cases show resolution summary + resolved date.
 *  - Row facts: #id · title, priority, status (Open / Under review / Awaiting answer /
 *    Escalated / Refunded / For provider / Closed), Unassigned flag, SLA-late flag
 *    (first response / resolution), opened-ago, customer vs provider, service, BK-id,
 *    amount (AED number — NOT fils → fmtAed), owner, SLA clocks, note count.
 *  - Case: description, provider's response, threaded notes (kind chip, author, time),
 *    evidence photos by kind (problem / before / after, opens full image in a new tab),
 *    booking trail, link to /dashboard/admin/bookings/:bookingId.
 *  - Header summary (N open · N unassigned · N past an SLA clock), error banner,
 *    loading and empty states.
 *  New: KPIs from the same queue, client-side search + Open/Closed state Seg.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import {
  Btn, Callout, Drawer, EmptyRow, ErrorRow, Field, KV, Kpi, Kpis, Modal, OsPage, PageHead, Pill, ScopeStrip,
  SearchField, Seg, SkeletonRows, TableWrap, Timeline, fmtAed, type Tone,
} from '@/components/os/kit';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const ago = (iso: string | null) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };
const inH = (iso: string | null) => { if (!iso) return '—'; const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000); const a = Math.abs(m); const s = a < 60 ? `${a}m` : a < 1440 ? `${Math.floor(a / 60)}h` : `${Math.floor(a / 1440)}d`; return m >= 0 ? `in ${s}` : `${s} ago`; };
const toFils = (n: number | string | null) => Math.round((Number(n) || 0) * 100);

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
const STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'danger' }, under_review: { label: 'Under review', tone: 'amber' },
  awaiting_evidence: { label: 'Awaiting answer', tone: 'info' }, escalated: { label: 'Escalated', tone: 'danger' },
  resolved: { label: 'Refunded', tone: 'primary' }, rejected: { label: 'For provider', tone: 'neutral' }, closed: { label: 'Closed', tone: 'neutral' },
};
const PRIO: Record<Priority, { label: string; tone: Tone }> = {
  critical: { label: 'Critical', tone: 'danger' }, high: { label: 'High', tone: 'amber' }, medium: { label: 'Medium', tone: 'neutral' }, low: { label: 'Low', tone: 'outline' },
};
const NOTE_UI: Record<string, { label: string; tone: Tone }> = {
  internal: { label: 'Internal', tone: 'neutral' }, question_to_customer: { label: 'Question → customer', tone: 'info' },
  question_to_provider: { label: 'Question → provider', tone: 'info' }, answer: { label: 'Answer', tone: 'primary' }, system: { label: 'System', tone: 'outline' },
};
const NOTE_KINDS = ['internal', 'question_to_customer', 'question_to_provider'] as const;
type NoteKind = typeof NOTE_KINDS[number];
const mediaOf = (m: Case['evidence'], kind: Media['kind']): Media[] => (Array.isArray(m) ? m.filter((x) => x.kind === kind) : m?.[kind] ?? []);
const StatusPill = ({ s }: { s: string }) => { const t = STATUS[s] ?? STATUS.open; return <Pill tone={t.tone}>{t.label}</Pill>; };
const PrioPill = ({ p }: { p: Priority }) => { const t = PRIO[p] ?? PRIO.medium; return <Pill tone={t.tone} dot={false}>{t.label}</Pill>; };

type Outcome = 'refund_customer' | 'favor_provider';

export default function AdminDisputesPage() {
  const [q, setQ] = useState<Queue | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [state, setState] = useState<'all' | 'open' | 'closed'>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [c, setC] = useState<Case | null>(null);
  const [noteKind, setNoteKind] = useState<NoteKind>('internal');
  const [noteBody, setNoteBody] = useState('');
  const [confirm, setConfirm] = useState<Outcome | null>(null);

  const load = useCallback(async () => {
    try {
      setQ(await apiGet<Queue>(`/disputes/queue${filter === 'mine' ? '?mine=1' : filter === 'unassigned' ? '?unassigned=1' : ''}`));
      setError(null); setLoadFailed(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load disputes'); setLoadFailed(true); }
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
  const resolve = (id: number, outcome: Outcome) => act(`resolve-${id}`, async () => { await apiPatch(`/disputes/${id}/resolve`, { outcome }); setConfirm(null); });
  const assign = (id: number, userId: number | null) => act(`assign-${id}`, () => apiPatch(`/disputes/${id}/assign`, { userId }));
  const setPriority = (id: number, priority: Priority) => act(`prio-${id}`, () => apiPatch(`/disputes/${id}/priority`, { priority }));
  const addNote = (id: number) => act(`note-${id}`, async () => { await apiPost(`/disputes/${id}/notes`, { kind: noteKind, body: noteBody }); setNoteBody(''); });

  const rows = useMemo(() => q?.disputes ?? [], [q]);
  const openRows = rows.filter((d) => OPEN.has(d.status));
  const openCount = openRows.length;
  const unassignedCount = rows.filter((d) => d.unassigned).length;
  const lateCount = rows.filter((d) => d.sla.firstResponseLate || d.sla.resolutionLate).length;
  const openValue = openRows.reduce((s, d) => s + toFils(d.amount), 0) / 100;
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((d) => (state === 'all' || (state === 'open') === OPEN.has(d.status))
      && (!s || [d.title, d.customerName, d.providerName, d.serviceName, `#${d.id}`, d.bookingId ? `bk-${d.bookingId}` : null]
        .some((x) => x?.toLowerCase().includes(s))));
  }, [rows, state, search]);
  const d = rows.find((x) => x.id === openId) ?? null;
  const isOpen = d ? OPEN.has(d.status) : false;
  const loading = !q && !loadFailed;

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Trust & safety"
        title="Disputes"
        lede={q
          ? `${openCount} open · ${unassignedCount} unassigned · ${lateCount} past an SLA clock. Priority → age; assign an owner, ask a question, then resolve.`
          : 'Priority → age; assign an owner, ask a question, then resolve.'}
        actions={<Btn size="sm" onClick={() => void load()}>Refresh</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Trust & safety' },
        { label: 'Queue', value: filter === 'all' ? 'All disputes' : filter === 'mine' ? 'My disputes' : 'Unassigned' },
        { label: 'Cases', value: q ? rows.length : '…' },
      ]} />

      {error && !loadFailed && <div style={{ marginBottom: 14 }}><Callout tone="bad" title="Something went wrong.">{error}</Callout></div>}

      <Kpis>
        <Kpi k="Open cases" v={q ? openCount : '—'} d="open, under review, awaiting answer or escalated" />
        <Kpi k="Unassigned" v={q ? unassignedCount : '—'} d="need an owner" />
        <Kpi k="Past an SLA clock" v={q ? lateCount : '—'} d="first response or resolution late" />
        <Kpi dark k="Value in open disputes" v={q ? fmtAed(openValue, Math.round(openValue) !== openValue) : '—'} d="booking amounts under dispute" />
      </Kpis>

      <div style={{ marginBottom: 14 }}>
        <Callout tone="warn" title="Money stays put until you decide.">
          While a case is open the provider&apos;s share is on hold and excluded from payouts. &ldquo;Refund customer (full)&rdquo; refunds the whole booking amount; &ldquo;Find for provider&rdquo; closes the case without a refund.
        </Callout>
      </div>

      <TableWrap toolbar={<>
        <SearchField value={search} onChange={setSearch} placeholder="Search case, customer, provider, service or BK-id" />
        <Seg label="Queue" value={filter} onChange={setFilter} options={[
          { v: 'all', l: 'All' }, { v: 'mine', l: 'My disputes' },
          { v: 'unassigned', l: 'Unassigned', n: filter === 'all' && q ? unassignedCount : undefined },
        ]} />
        <Seg label="Case state" value={state} onChange={setState} options={[
          { v: 'all', l: 'Any state' }, { v: 'open', l: 'Open', n: q ? openCount : undefined }, { v: 'closed', l: 'Closed' },
        ]} />
      </>}>
        <table className="gx-tbl">
          <thead><tr>
            <th>Case</th><th>Parties</th><th>Service</th><th className="num">Amount</th><th>Priority</th><th>Status</th>
            <th>Owner</th><th>SLA</th><th className="act">Actions</th>
          </tr></thead>
          {loading ? <SkeletonRows cols={9} /> : loadFailed ? <ErrorRow cols={9} onRetry={() => void load()} /> : visible.length === 0 ? (
            <EmptyRow cols={9} title="No disputes here." text={rows.length ? 'Clear the search or pick another state.' : 'Nothing in this queue right now.'} />
          ) : (
            <tbody>
              {visible.map((r) => {
                const open = OPEN.has(r.status);
                const late = r.sla.firstResponseLate || r.sla.resolutionLate;
                return (
                  <tr key={r.id} className="click" onClick={() => setOpenId(r.id)}>
                    <td className="strong" style={{ maxWidth: 260 }}>
                      #{r.id} · {r.title}
                      <span className="sub">opened {ago(r.openedAt)} ago · {r.notes} note{r.notes === 1 ? '' : 's'}</span>
                    </td>
                    <td>{r.customerName}<span className="sub">vs {r.providerName ?? 'provider'}</span></td>
                    <td>{r.serviceName ?? 'service'}{r.bookingId && <span className="sub mono">BK-{r.bookingId}</span>}</td>
                    <td className="num">{fmtAed(r.amount)}</td>
                    <td><PrioPill p={r.priority} /></td>
                    <td><StatusPill s={r.status} /></td>
                    <td>{r.unassigned ? <Pill tone="amber">Unassigned</Pill> : r.assignedToName ?? 'nobody'}</td>
                    <td className="nowrap">
                      {late ? <Pill tone="danger">{r.sla.firstResponseLate ? 'First response late' : 'Resolution late'}</Pill>
                        : open ? <span>resolve {inH(r.sla.resolutionDueAt)}</span> : <span className="sub">—</span>}
                    </td>
                    <td className="act" onClick={(e) => e.stopPropagation()}>
                      <Btn size="xs" variant={open ? 'primary' : undefined} onClick={() => setOpenId(r.id)}>{open ? 'Review' : 'Open'}</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </TableWrap>

      {/* Case drawer */}
      <Drawer
        open={!!d && !confirm}
        onClose={() => setOpenId(null)}
        title={d ? `#${d.id} · ${d.title}` : ''}
        sub={d ? <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}><PrioPill p={d.priority} /><StatusPill s={d.status} />{d.unassigned && <Pill tone="amber">Unassigned</Pill>}</span> : null}
        footer={d && (
          <>
            <Btn onClick={() => setOpenId(null)}>Close</Btn>
            {d.bookingId && <Btn href={`/dashboard/admin/bookings/${d.bookingId}`}>Open booking BK-{d.bookingId}</Btn>}
            {isOpen && <Btn disabled={!!busy} onClick={() => setConfirm('favor_provider')}>Find for provider</Btn>}
            {isOpen && <Btn variant="primary" disabled={!!busy} onClick={() => setConfirm('refund_customer')}>Refund customer (full)</Btn>}
          </>
        )}
      >
        {d && (!c || c.id !== d.id ? (
          <div className="gx-empty"><b>Loading case…</b></div>
        ) : (
          <div style={{ display: 'grid', gap: 18 }}>
            {error && <Callout tone="bad">{error}</Callout>}
            <KV items={[
              { k: 'Customer', v: d.customerName },
              { k: 'Provider', v: d.providerName ?? 'provider' },
              { k: 'Service', v: <>{d.serviceName ?? 'service'} {d.bookingId && <span className="mono">BK-{d.bookingId}</span>}</> },
              { k: 'Amount', v: fmtAed(d.amount) },
              { k: 'Opened', v: `${fmt(d.openedAt)} (${ago(d.openedAt)} ago)` },
              { k: 'First response', v: <span style={d.sla.firstResponseLate ? { color: 'var(--ms-danger)' } : undefined}>{d.sla.firstRespondedAt ? `done ${ago(d.sla.firstRespondedAt)} ago` : inH(d.sla.firstResponseDueAt)}</span> },
              { k: 'Resolve by', v: <span style={d.sla.resolutionLate ? { color: 'var(--ms-danger)' } : undefined}>{isOpen ? inH(d.sla.resolutionDueAt) : '—'}</span> },
              ...(!isOpen ? [{ k: 'Resolution', v: `${d.resolutionSummary ?? 'Closed'} · ${fmt(d.resolvedAt)}` }] : []),
            ]} />

            <div className="gx-two">
              <Field label="Owner" htmlFor="dsp-owner">
                <select id="dsp-owner" className="gx-sel" value={d.assignedToUserId ?? ''} disabled={!!busy || !isOpen}
                  onChange={(e) => assign(d.id, e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Unassigned</option>
                  {(q?.admins ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Priority" htmlFor="dsp-prio">
                <select id="dsp-prio" className="gx-sel" value={d.priority} disabled={!!busy || !isOpen}
                  onChange={(e) => setPriority(d.id, e.target.value as Priority)}>
                  {(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => <option key={p} value={p}>{PRIO[p].label}</option>)}
                </select>
              </Field>
            </div>

            {d.description && <div><div className="gx-lb">Customer&apos;s complaint</div><p style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 4 }}>{d.description}</p></div>}
            {d.providerResponse && (
              <Callout tone="info" title="Provider's response.">{d.providerResponse}</Callout>
            )}

            {/* Thread */}
            <div>
              <div className="gx-lb" style={{ marginBottom: 6 }}>Case thread</div>
              {c.notes.length === 0 ? <p style={{ fontSize: 12, color: 'var(--ms-ink-3)' }}>No notes yet.</p> : (
                <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                  {c.notes.map((n) => (
                    <div key={n.id} className="gx-cell" style={{ border: '1px solid var(--ms-border)', borderRadius: 10, padding: '7px 10px', background: n.kind === 'internal' ? 'var(--ms-surface-2)' : 'var(--ms-surface)' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--ms-ink-3)' }}>
                        <Pill tone={(NOTE_UI[n.kind] ?? NOTE_UI.system).tone} dot={false}>{(NOTE_UI[n.kind] ?? NOTE_UI.system).label}</Pill>
                        <span>{n.authorName ?? n.authorRole}</span><span style={{ marginLeft: 'auto' }}>{fmt(n.createdAt)}</span>
                      </div>
                      <p style={{ fontSize: 12.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{n.body}</p>
                    </div>
                  ))}
                </div>
              )}
              {isOpen && (
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  <Seg label="Note type" value={noteKind} onChange={setNoteKind}
                    options={NOTE_KINDS.map((k) => ({ v: k, l: NOTE_UI[k].label }))} />
                  <Field label={noteKind === 'internal' ? 'Internal note' : 'Question'} htmlFor="dsp-note"
                    hint={noteKind === 'internal' ? 'Never shown to the parties.' : 'The party is notified and can answer here.'}>
                    <textarea id="dsp-note" className="gx-ta" rows={3} maxLength={4000} value={noteBody} onChange={(e) => setNoteBody(e.target.value)}
                      placeholder={noteKind === 'internal' ? 'Internal note — never shown to the parties' : 'Your question — the party is notified and can answer here'} />
                  </Field>
                  <div>
                    <Btn size="sm" disabled={!!busy || !noteBody.trim()} onClick={() => addNote(d.id)}>
                      {busy === `note-${d.id}` ? 'Saving…' : noteKind === 'internal' ? 'Add note' : 'Send question'}
                    </Btn>
                  </div>
                </div>
              )}
            </div>

            {/* Evidence */}
            <div>
              <div className="gx-lb" style={{ marginBottom: 6 }}>Evidence (SP-258)</div>
              {(['problem', 'before', 'after'] as const).map((k) => {
                const list = mediaOf(c.evidence, k);
                return (
                  <div key={k} style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--ms-ink-2)' }}>{k === 'problem' ? 'Problem — from the customer' : k === 'before' ? 'Before work' : 'Finished work'} · {list.length}</div>
                    {list.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {list.map((m) => (
                          <a key={m.id} href={m.viewUrl} target="_blank" rel="noreferrer" title={m.caption ?? `Open ${k} photo`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={m.viewUrl} alt={m.caption ?? k} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--ms-border)' }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Booking trail */}
            <div>
              <div className="gx-lb" style={{ marginBottom: 6 }}>Booking trail</div>
              {c.trail.length === 0 ? <p style={{ fontSize: 12, color: 'var(--ms-ink-3)' }}>—</p> : (
                <Timeline items={c.trail.map((t) => ({
                  t: <>{t.fromStatus ? `${t.fromStatus} → ` : ''}{t.toStatus}</>,
                  s: <>{fmt(t.createdAt)}{t.reason ? ` — ${t.reason}` : ''}</>,
                  state: 'done' as const,
                }))} />
              )}
            </div>
          </div>
        ))}
      </Drawer>

      {/* Resolve confirm */}
      <Modal
        open={!!d && !!confirm}
        onClose={() => { if (!busy) setConfirm(null); }}
        title={confirm === 'refund_customer' ? 'Refund customer in full?' : 'Find for provider?'}
        width={460}
        footer={d && confirm && (
          <>
            <Btn disabled={!!busy} onClick={() => setConfirm(null)}>Cancel</Btn>
            <Btn variant={confirm === 'refund_customer' ? 'primary' : undefined} disabled={!!busy} onClick={() => resolve(d.id, confirm)}>
              {busy === `resolve-${d.id}` ? 'Resolving…' : confirm === 'refund_customer' ? 'Refund customer (full)' : 'Find for provider'}
            </Btn>
          </>
        )}
      >
        {d && (
          <div style={{ display: 'grid', gap: 10, fontSize: 12.5 }}>
            <p>
              Case <b>#{d.id}</b> · {d.customerName} vs {d.providerName ?? 'provider'} · <b>{fmtAed(d.amount)}</b>.
              {confirm === 'refund_customer'
                ? ' The customer is refunded the full booking amount and the case closes.'
                : ' The case closes in the provider’s favour with no refund.'}
            </p>
            {error && <Callout tone="bad">{error}</Callout>}
          </div>
        )}
      </Modal>
    </OsPage>
  );
}
