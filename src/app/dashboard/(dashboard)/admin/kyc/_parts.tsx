'use client';
/* eslint-disable react-hooks/set-state-in-effect -- fetch-on-select and reset-on-change effects, the same pattern as the page this replaces */

/**
 * Gate 1 (Verification) building blocks for the admin KYC queue — kit-styled ports of the
 * per-document verdict control, the account toggle and the compliance decision bar that the
 * previous page defined inline. Same endpoints, same payloads.
 *
 * Decision model (Marketplace provider OS blueprint): document Reject, Request action and Mark expired now
 * open a modal where the admin picks Gate 1 reason codes (+ optional note) from `@/lib/os/reasonCodes`
 * and sees a statement-of-reasons preview. The composed text "[CODE] Explanation To fix: … — note" goes
 * in the SAME field as before ({ reason } / complianceNotes) — no payload shape changed. Mark compliant
 * and Approve document are unchanged. Verified pills now carry the verification date when the document
 * row has `verifiedAt` (never a bare "Verified").
 */
import { useEffect, useState, type ReactNode } from 'react';
import { apiPatch, apiPost } from '@/lib/api';
import { openDocViewer } from '@/lib/docViewer';
import { Btn, Callout, Field, Modal, Pill, fmtDate, type Tone } from '@/components/os/kit';
import { ReasonPicker, StatementPreview, useReasonCodes } from '@/components/upnow/GateDecision';
import { composeReasonText } from '@/lib/os/reasonCodes';

export type ComplianceStatus = 'compliant' | 'pending_review' | 'action_required' | 'expired' | 'paused';

export interface UploadedDoc {
  id: number;
  documentKey: string;
  fileUrl: string;
  mimeType: string | null;
  status: string;
  notes: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  documentNumber?: string | null;
  /** When an admin verified it (document rows carry it; older types omitted it). */
  verifiedAt?: string | null;
  createdAt: string;
}

export const COMPLIANCE: Record<ComplianceStatus, { label: string; tone: Tone }> = {
  compliant:       { label: 'Compliant',       tone: 'primary' },
  pending_review:  { label: 'Pending review',  tone: 'amber' },
  action_required: { label: 'Action required', tone: 'danger' },
  expired:         { label: 'Expired',         tone: 'neutral' },
  paused:          { label: 'Paused',          tone: 'danger' },
};
export function CompliancePill({ s }: { s: ComplianceStatus }) {
  const c = COMPLIANCE[s] ?? COMPLIANCE.pending_review;
  return <Pill tone={c.tone}>{c.label}</Pill>;
}

/**
 * Compliance pill that names the check and its date when the record has one
 * ("Compliant · reviewed 12 Oct 2026", "Compliant · 2 docs verified, last 9 Sep 2026").
 * Non-compliant statuses render exactly like CompliancePill.
 */
export function ComplianceBadge({ s, reviewedAt, docs }: { s: ComplianceStatus; reviewedAt?: string | null; docs?: UploadedDoc[] | null }) {
  if (s !== 'compliant') return <CompliancePill s={s} />;
  if (reviewedAt) return <Pill tone="primary" title="Gate 1 compliance decision date">Compliant · reviewed {fmtDate(reviewedAt)}</Pill>;
  const verified = (docs ?? []).filter((d) => isVerifiedStatus(d.status) && d.verifiedAt);
  if (verified.length > 0) {
    const last = verified.map((d) => d.verifiedAt as string).sort().at(-1);
    return (
      <Pill tone="primary" title="The compliance decision itself has no date on the record — this is the latest document verification">
        Compliant · {verified.length} doc{verified.length === 1 ? '' : 's'} verified, last {fmtDate(last)}
      </Pill>
    );
  }
  return <Pill tone="primary" title="The API does not return when this compliance decision was made">Compliant · decision date not recorded</Pill>;
}

export const docLabel = (k: string) => (k || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const isVerifiedStatus = (s: string | null | undefined) => ['processed', 'complete', 'approved'].includes(String(s ?? '').toLowerCase());
export const isRejectedStatus = (s: string | null | undefined) => String(s ?? '').toLowerCase() === 'rejected';

/** Days until a date (negative = past); null when no date. */
export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : Math.floor((t - Date.now()) / 86_400_000);
}
/** "12d" / "3mo" — how long a record has sat since `d`. */
export function ageLabel(d: string | null | undefined): string {
  if (!d) return '—';
  const days = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
  if (days < 1) return 'today';
  if (days < 60) return `${days}d`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Document types that always carry an expiry date, matched on part of the key (occupant docs are
 * prefixed, repeats suffixed). Mirrors `expiring-doc-types.ts` on the backend so the reviewer is
 * told before submitting rather than bounced by a 400.
 */
const EXPIRING_KEY_PARTS = ['emirates_id', 'passport', 'visa', 'trade_licen', 'poa_id'];
export function requiresExpiry(documentKey: string): boolean {
  const key = (documentKey || '').toLowerCase();
  return EXPIRING_KEY_PARTS.some((part) => key.includes(part));
}

// ---------------------------------------------------------------------------- account toggle

/** Admin control: flip a user's account active ↔ suspended. PATCH /admin/users/:id/status. */
export function UserStatusToggle({ userId, status, onChange }: { userId?: number; status?: string; onChange?: (s: string) => void }) {
  const [val, setVal] = useState(status ?? 'active');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setVal(status ?? 'active'); }, [status]);
  if (!userId) return null;
  const isActive = val === 'active';
  async function toggle() {
    const next = isActive ? 'suspended' : 'active';
    setBusy(true); setErr(null);
    try {
      await apiPatch(`/admin/users/${userId}/status`, { status: next });
      setVal(next);
      onChange?.(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Pill tone={isActive ? 'primary' : 'neutral'}>{isActive ? 'Account active' : 'Account suspended'}</Pill>
      <Btn size="xs" variant={isActive ? 'danger' : undefined} disabled={busy} onClick={() => void toggle()}
        title={isActive ? 'Suspend this account' : 'Re-activate this account'}>
        {busy ? 'Saving…' : isActive ? 'Suspend account' : 'Activate account'}
      </Btn>
      {err && <span role="alert" style={{ color: 'var(--ms-danger)', fontSize: 10.5 }}>{err}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------- per-document verdict

/**
 * Approve (with an expiry read off the document) / Reject (with a reason shown to the owner).
 * POST /admin/kyc/documents/:id/verify { expiryDate? } · POST /admin/kyc/documents/:id/reject { reason }.
 * The reviewer is the only person holding the physical document, so this is where a missing or
 * wrong expiry gets fixed (SCRUM-662).
 */
export function DocReviewActions({ doc, onUpdate }: { doc: UploadedDoc; onUpdate: (docId: number, patch: Partial<UploadedDoc>) => void }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [expiry, setExpiry] = useState('');
  const reasons = useReasonCodes();
  const [err, setErr] = useState<string | null>(null);

  const verified = isVerifiedStatus(doc.status);
  const rejected = isRejectedStatus(doc.status);
  const expiryRequired = requiresExpiry(doc.documentKey);
  const blocked = expiryRequired && !expiry.trim();

  const open = (m: 'approve' | 'reject') => {
    setErr(null);
    setExpiry(doc.expiryDate ? String(doc.expiryDate).slice(0, 10) : '');
    reasons.reset();
    setMode(m);
  };
  const close = () => { if (!busy) setMode(null); };

  async function approve() {
    setBusy(true); setErr(null);
    try {
      const updated = await apiPost<{ status?: string; expiryDate?: string | null }>(
        `/admin/kyc/documents/${doc.id}/verify`, expiry ? { expiryDate: expiry } : {},
      );
      onUpdate(doc.id, { status: updated?.status ?? 'processed', expiryDate: updated?.expiryDate ?? (expiry || doc.expiryDate), notes: null });
      setMode(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function reject() {
    reasons.setTouched(true);
    if (reasons.error) return;
    const reason = composeReasonText(reasons.selected, reasons.text);
    setBusy(true); setErr(null);
    try {
      const updated = await apiPost<{ status?: string }>(`/admin/kyc/documents/${doc.id}/reject`, { reason });
      onUpdate(doc.id, { status: updated?.status ?? 'rejected', notes: reason });
      setMode(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      {!verified && <Btn size="xs" disabled={busy} onClick={() => open('approve')}>Approve</Btn>}
      {!rejected && <Btn size="xs" variant="danger" disabled={busy} onClick={() => open('reject')}>Reject</Btn>}

      <Modal open={mode === 'approve'} onClose={close} width={420} title={`Approve — ${docLabel(doc.documentKey)}`}
        footer={<>
          <span className="sp" />
          <Btn onClick={close} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={() => void approve()} disabled={busy || blocked}
            title={blocked ? 'Enter the expiry date shown on the document' : undefined}>{busy ? 'Approving…' : 'Approve document'}</Btn>
        </>}>
        <Field label={expiryRequired ? 'Expiry date (required)' : 'Expiry date'} htmlFor={`exp-${doc.id}`}
          error={err ?? undefined}
          hint={expiryRequired
            ? "Read it off the document — this type always has one, and the reminders that warn before it lapses can't run without it."
            : "Read it off the document. Leave blank if this document doesn't expire."}>
          <input id={`exp-${doc.id}`} type="date" className="gx-inp" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={mode === 'reject'} onClose={close} width={560} title={`Reject — ${docLabel(doc.documentKey)}`}
        footer={<>
          <span className="sp" />
          <Btn onClick={close} disabled={busy}>Cancel</Btn>
          <Btn variant="danger" onClick={() => void reject()} disabled={busy}>{busy ? 'Rejecting…' : 'Reject document'}</Btn>
        </>}>
        <ReasonPicker gate={1} decision="reject" state={reasons} idPrefix={`rej-${doc.id}`}
          textHint="Shown to the owner after the reason codes. Say exactly what is wrong so the re-upload is right first time." />
        <StatementPreview decisionLabel={`Reject document — ${docLabel(doc.documentKey)}`} state={reasons} sentAs="the rejection reason" />
        {err && <div className="gx-err" role="alert">{err}</div>}
      </Modal>
    </>
  );
}

/** One document row: name, dates, verdict pill, View (in-portal viewer) and the verdict control. */
export function DocRow({ name, required, doc, missing, fileUrl, onUpdate, extra }: {
  name: string; required?: boolean; doc?: UploadedDoc | null; missing?: boolean; fileUrl?: string | null;
  onUpdate?: (docId: number, patch: Partial<UploadedDoc>) => void; extra?: ReactNode;
}) {
  const days = daysUntil(doc?.expiryDate);
  const expired = days != null && days < 0;
  const soon = days != null && days >= 0 && days <= 30;
  const st = String(doc?.status ?? '').toLowerCase();
  const pill: { l: string; tone: Tone } = missing ? { l: 'Missing', tone: 'danger' }
    : isRejectedStatus(st) ? { l: 'Rejected', tone: 'danger' }
    : expired ? { l: 'Expired', tone: 'danger' }
    : isVerifiedStatus(st) ? { l: doc?.verifiedAt ? `Verified ${fmtDate(doc.verifiedAt)}` : 'Verified · date not recorded', tone: 'primary' }
    : { l: 'Pending review', tone: 'amber' };
  const url = fileUrl ?? doc?.fileUrl ?? null;
  return (
    <div style={{ padding: '9px 0', borderBottom: '1px solid var(--ms-surface-3)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            {name}{required && <span style={{ color: 'var(--ms-danger)', fontSize: 10.5, fontWeight: 700 }}> · required</span>}
          </div>
          <div style={{ fontSize: 10.5, color: expired ? 'var(--ms-danger)' : soon ? 'var(--ms-amber-text)' : 'var(--ms-ink-3)' }}>
            {[
              doc?.documentNumber ? `No. ${doc.documentNumber}` : null,
              doc?.issueDate ? `Issued ${fmtDate(doc.issueDate)}` : null,
              doc?.expiryDate ? (expired ? `Expired ${fmtDate(doc.expiryDate)}` : soon ? `Expires in ${days}d — ${fmtDate(doc.expiryDate)}` : `Expires ${fmtDate(doc.expiryDate)}`) : null,
              doc?.createdAt ? `Uploaded ${fmtDate(doc.createdAt)}` : null,
            ].filter(Boolean).join(' · ') || (missing ? 'Not uploaded yet' : '—')}
          </div>
        </div>
        <Pill tone={pill.tone}>{pill.l}</Pill>
        {extra}
        {url && <Btn size="xs" onClick={() => openDocViewer({ fileUrl: url, caption: name })}>View</Btn>}
        {doc && onUpdate && <DocReviewActions doc={doc} onUpdate={onUpdate} />}
      </div>
      {doc?.notes && (
        <div style={{ marginTop: 6, fontSize: 11, color: isRejectedStatus(st) ? '#8d2f2a' : 'var(--ms-ink-3)' }}>
          <strong>{isRejectedStatus(st) ? 'Rejection reason: ' : 'Note: '}</strong>{doc.notes}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- compliance decision

/**
 * Notes + Mark compliant / Request action / Mark expired. `blockers` are shown in a confirm before
 * approving over them (allowed, but deliberate). `onDecide` calls the role's compliance endpoint.
 */
export function VerdictBar({ who, blockers, disabled, onDecide, notesHint, initialNotes = '' }: {
  who: string; blockers: string[]; disabled?: boolean; notesHint?: string; initialNotes?: string;
  onDecide: (status: ComplianceStatus, notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [asking, setAsking] = useState<'action_required' | 'expired' | null>(null);
  const reasons = useReasonCodes();
  useEffect(() => { setNotes(initialNotes); setErr(null); setAsking(null); }, [who, initialNotes]);

  async function go(status: ComplianceStatus, text = notes.trim()) {
    setBusy(true); setErr(null);
    try { await onDecide(status, text); setConfirming(false); setAsking(null); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  function openAsk(status: 'action_required' | 'expired') {
    reasons.reset();
    // Whatever was typed in the notes box carries into the modal as the free-text part.
    if (notes.trim()) reasons.setText(notes.trim());
    setErr(null);
    setAsking(status);
  }
  function sendAsk() {
    if (!asking) return;
    reasons.setTouched(true);
    if (reasons.error) return;
    void go(asking, composeReasonText(reasons.selected, reasons.text));
  }

  return (
    <div style={{ position: 'sticky', bottom: -16, margin: '16px -18px -16px', padding: '12px 18px', background: 'var(--ms-surface)', borderTop: '1px solid var(--ms-border)', zIndex: 2 }}>
      <label className="gx-lb" htmlFor={`notes-${who}`}>Decision notes</label>
      <input id={`notes-${who}`} className="gx-inp" value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder={notesHint ?? 'Optional — saved with Mark compliant; carried into the reasons dialog for Request action / Mark expired'} />
      {err && <div className="gx-err" role="alert">{err}</div>}
      <div className="gx-btn-row" style={{ marginTop: 9 }}>
        <Btn variant="primary" disabled={busy || disabled} onClick={() => (blockers.length ? setConfirming(true) : void go('compliant'))}>Mark compliant</Btn>
        <Btn variant="amber" disabled={busy || disabled} onClick={() => openAsk('action_required')}>Request action</Btn>
        <Btn variant="danger" disabled={busy || disabled} onClick={() => openAsk('expired')}>Mark expired</Btn>
        {busy && <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>Saving…</span>}
      </div>

      <Modal open={confirming} onClose={() => !busy && setConfirming(false)} width={520} title="Mark compliant with open items?"
        footer={<>
          <span className="sp" />
          <Btn onClick={() => setConfirming(false)} disabled={busy}>Go back</Btn>
          <Btn variant="primary" onClick={() => void go('compliant')} disabled={busy}>{busy ? 'Saving…' : 'Mark compliant anyway'}</Btn>
        </>}>
        <Callout tone="warn" title={`${blockers.length} open item${blockers.length === 1 ? '' : 's'}.`}>
          Approving over them is allowed, but it must be deliberate.
        </Callout>
        <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
          {blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
        {err && <div className="gx-err" role="alert">{err}</div>}
      </Modal>

      <Modal open={!!asking} onClose={() => !busy && setAsking(null)} width={580}
        title={asking === 'expired' ? 'Mark expired — reasons' : 'Request action — reasons'}
        footer={<>
          <span className="sp" />
          <Btn onClick={() => setAsking(null)} disabled={busy}>Cancel</Btn>
          <Btn variant={asking === 'expired' ? 'danger' : 'amber'} onClick={sendAsk} disabled={busy}>
            {busy ? 'Saving…' : asking === 'expired' ? 'Mark expired' : 'Send request'}
          </Btn>
        </>}>
        <div style={{ fontSize: 12, marginBottom: 10, color: 'var(--ms-ink-2)' }}>
          {asking === 'expired'
            ? 'Use when verification has lapsed (for example an expired licence or ID). New business pauses until the provider fixes it.'
            : 'The provider is asked to fix the items below; their record shows this message.'}
        </div>
        <ReasonPicker gate={1} decision={asking === 'expired' ? 'expire' : 'changes'} state={reasons} idPrefix={`ask-${who}`} />
        <StatementPreview decisionLabel={asking === 'expired' ? 'Mark expired (Gate 1)' : 'Request action (Gate 1)'} state={reasons} sentAs="the compliance notes" />
        {err && <div className="gx-err" role="alert">{err}</div>}
      </Modal>
    </div>
  );
}

/** Section title used inside the detail panel. */
export function DetailHead({ title, pills, right, sub }: { title: ReactNode; pills?: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--ms-surface-3)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>{title}</h2>
        {pills}
        {right && <div className="flex items-center gap-2 flex-wrap" style={{ marginLeft: 'auto' }}>{right}</div>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export const gap = { marginTop: 12 } as const;
