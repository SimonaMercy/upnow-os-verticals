'use client';
/**
 * Lease detail — "Breaches" section (Legal & Breach Management spec §7.1).
 *
 * Self-fetching (precedent: SignatureAuditTrail on the contract v2 page):
 * lists every breach on the lease, lets the landlord / manager report a new
 * one, and expands a breach inline into its detail — 4-step progress bar,
 * countdown / hint, timeline, and the actions the API says are available
 * (Issue warning · Issue final warning · Mark as resolved · Escalate to legal).
 *
 * Base-aware like the rest of the module: `base` = '/legal' for the landlord,
 * '/manager/legal' (+ `rp`) for a manager. Every rule is re-checked server-side;
 * a 400 message is surfaced inline next to the form that caused it.
 *
 * Only plain-language labels are shown (spec §6) — never a raw enum.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, ExternalLink, FileText, Gavel, Paperclip, Plus, Scale, X } from 'lucide-react';
import {
  legalApi, daysFromToday, breachStageTone, BREACH_CATEGORY_LABELS, BREACH_REPORTED_BY_LABELS, BREACH_EVENT_TYPE_LABELS, BREACH_STAGE_LABELS, type BreachRow, type BreachDetail, type BreachEvent, type BreachCategory, type BreachReportedBy, type BreachStage, type DisputeRow, type LegalTemplate, type TemplateKind,
} from '@/lib/legal';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { openDocViewerByIds } from '@/lib/docViewer';
import { StartNoticeModal } from '@/components/legal/StartNoticeModal';

/* ── props ─────────────────────────────────────────────────────────────────── */
export interface BreachesSectionProps {
  leaseId: number;
  /** Lease status — an expired lease escalates as "overstaying" (spec §4.3 rule 3). */
  leaseStatus: string;
  /** '/legal' (landlord) or '/manager/legal' (manager, with `rp`). */
  base: string;
  rp?: number;
  /** Where the dispute page for an escalated breach lives (RP vs manager route). */
  disputeHrefOf: (disputeId: number) => string;
}

/* ── small helpers ─────────────────────────────────────────────────────────── */
const PURPLE = { bg: '#ece9fd', fg: '#5b3fbf' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.NEXT_PUBLIC_APP_TIME_ZONE || 'Asia/Dubai' });
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}
/** "in 3 days" / "today" / "2 days overdue" — the countdown next to a deadline. */
function countdown(iso: string | null | undefined): string | null {
  const n = daysFromToday(iso);
  if (n == null) return null;
  if (n === 0) return 'today';
  if (n > 0) return `in ${n} day${n === 1 ? '' : 's'}`;
  return `${-n} day${n === -1 ? '' : 's'} overdue`;
}
function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
const OPEN_STAGES: BreachStage[] = ['reported', 'warning_sent', 'final_warning'];
const isOpen = (b: BreachRow) => OPEN_STAGES.includes(b.stage);

function StagePill({ stage, label }: { stage: BreachStage; label?: string }) {
  const t = breachStageTone(stage);
  return <span className="pill" style={{ background: t.bg, color: t.fg }}>{label ?? BREACH_STAGE_LABELS[stage]}</span>;
}

/** Amber for a "deadline near" alert, red once it has passed. */
function AlertLine({ text, overdue }: { text: string; overdue: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: overdue ? 'var(--brick)' : 'var(--saffron-deep)' }}>
      <AlertTriangle size={13} /> {text}
    </span>
  );
}

/* ── attachment picker (hidden input inside a styled label) ───────────────── */
function FilePick({ file, onFile, disabled }: { file: File | null; onFile: (f: File | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <label className="btn btn-ghost btn-sm" style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1 }}>
        <Paperclip size={13} /> {file ? 'Change file' : 'Attach file'}
        <input ref={ref} type="file" hidden disabled={disabled} accept="image/*,application/pdf"
          onChange={e => onFile(e.target.files?.[0] ?? null)} />
      </label>
      {file && (
        <span style={{ fontSize: 12, color: 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {file.name}
          <button type="button" className="mini-btn no" onClick={() => { onFile(null); if (ref.current) ref.current.value = ''; }} aria-label="Remove file"><X size={11} /></button>
        </span>
      )}
      {!file && <span className="note">Optional — photo, complaint, or a copy of the warning.</span>}
    </div>
  );
}

/* ── generic modal shell (same look as the page's TerminateModal) ─────────── */
function Modal({ title, tone, onClose, children, footer }: {
  title: string; tone: 'jade' | 'brick' | 'saffron' | 'purple'; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  const bg = tone === 'purple' ? PURPLE.fg : tone === 'saffron' ? 'var(--saffron-deep)' : `var(--${tone})`;
  return (
    <div className="mscrim" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt"><span className="mti" style={{ background: bg }}><Scale size={17} /></span>{title}</span>
          <button className="x" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <div className="mb">{children}</div>
        <div className="mf">{footer}</div>
      </div>
    </div>
  );
}

/* ── Report breach ─────────────────────────────────────────────────────────── */
function ReportBreachModal({ leaseId, base, rp, onClose, onDone }: {
  leaseId: number; base: string; rp?: number; onClose: () => void; onDone: (b: BreachDetail) => void;
}) {
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState<BreachCategory>('noise');
  const [description, setDescription] = useState('');
  const [reportedBy, setReportedBy] = useState<BreachReportedBy>('staff');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      // The breach must exist before a file can be owned by it — create, then
      // upload against its id, then pin the attachment to the timeline.
      let breach = await legalApi.reportBreach(base, rp, { leaseId, category, description: description.trim() || undefined, reportedBy, openedDate: date });
      if (file) {
        const { id } = await uploadOwnedDocument({
          ownerType: 'tenancy_breach', ownerId: breach.id, category: 'legal',
          documentKey: `breach_${breach.id}_${Date.now()}`, displayName: file.name, file,
        });
        if (id) breach = await legalApi.breachEvent(base, rp, breach.id, { type: 'note', date, description: 'Attachment', documentId: id });
      }
      onDone(breach);
    } catch (e) { setErr(errText(e, 'Could not report the breach')); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Report breach" tone="saffron" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-jade btn-sm" onClick={() => void submit()} disabled={busy || !date}>{busy ? 'Saving…' : 'Report breach'}</button>
      </>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <div className="field">
          <label>Date</label>
          <input type="date" className="input" value={date} max={today()} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Reported by</label>
          <select className="input" value={reportedBy} onChange={e => setReportedBy(e.target.value as BreachReportedBy)}>
            {(Object.keys(BREACH_REPORTED_BY_LABELS) as BreachReportedBy[]).map(k => <option key={k} value={k}>{BREACH_REPORTED_BY_LABELS[k]}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>What happened</label>
        <select className="input" value={category} onChange={e => setCategory(e.target.value as BreachCategory)}>
          {(Object.keys(BREACH_CATEGORY_LABELS) as BreachCategory[]).map(k => <option key={k} value={k}>{BREACH_CATEGORY_LABELS[k]}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Description</label>
        <textarea className="input" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="What was reported, when, by whom…" />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>Attachment</label>
        <FilePick file={file} onFile={setFile} disabled={busy} />
      </div>
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

/* ── Issue warning / final warning ─────────────────────────────────────────── */
function WarningModal({ kind, breach, base, rp, onClose, onDone }: {
  kind: 'warning' | 'final'; breach: BreachDetail; base: string; rp?: number; onClose: () => void; onDone: (b: BreachDetail) => void;
}) {
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // "Use template" (0288): the landlord's warning-letter template merged with this
  // breach — dropped into the description so it can be copied into their own letter.
  const [tplSubject, setTplSubject] = useState<string | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const [tplConfirm, setTplConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  // Which breach-group template to fill: the fixed kind for this dialog first,
  // then the landlord's own custom templates (0289).
  const fixedKind: TemplateKind = kind === 'warning' ? 'breach_warning' : 'breach_final_warning';
  const [tpls, setTpls] = useState<LegalTemplate[]>([]);
  const [tplId, setTplId] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    legalApi.templates(base, rp).then(r => {
      if (!live) return;
      const list = (r.items ?? []).filter(t => t.group === 'breach');
      list.sort((a, b) => (a.kind === fixedKind ? 0 : a.source === 'custom' ? 2 : 1) - (b.kind === fixedKind ? 0 : b.source === 'custom' ? 2 : 1) || a.sortOrder - b.sortOrder || a.id - b.id);
      setTpls(list); setTplId(list.find(t => t.kind === fixedKind)?.id ?? list[0]?.id ?? null);
    }).catch(() => { if (live) setTpls([]); });
    return () => { live = false; };
  }, [base, rp, fixedKind]);
  const n = breach.correctionDays;

  const applyTemplate = async (force = false) => {
    if (description.trim() && !force) { setTplConfirm(true); return; }
    setTplConfirm(false); setTplBusy(true); setTplErr(null);
    try {
      const r = await legalApi.renderTemplate(base, rp, tplId ?? fixedKind, { breachId: breach.id, date });
      setDescription(r.body); setTplSubject(r.subject);
    } catch (e) { setTplErr(errText(e, 'Could not render the template')); }
    finally { setTplBusy(false); }
  };
  const copyLetter = async () => {
    try { await navigator.clipboard.writeText(`${tplSubject ? `${tplSubject}\n\n` : ''}${description}`); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable */ }
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      let documentId: number | null = null;
      if (file) {
        const { id } = await uploadOwnedDocument({
          ownerType: 'tenancy_breach', ownerId: breach.id, category: 'legal',
          documentKey: `breach_${breach.id}_${Date.now()}`, displayName: file.name, file,
        });
        documentId = id;
      }
      const body = { date, description: description.trim() || null, documentId };
      const next = kind === 'warning' ? await legalApi.breachWarning(base, rp, breach.id, body) : await legalApi.breachFinalWarning(base, rp, breach.id, body);
      onDone(next);
    } catch (e) { setErr(errText(e, 'Could not issue the warning')); }
    finally { setBusy(false); }
  };
  const smallBtn = { padding: '5px 10px', fontSize: 11.5, borderRadius: 8 } as const;

  return (
    <Modal title={kind === 'warning' ? 'Issue warning' : 'Issue final warning'} tone={kind === 'warning' ? 'saffron' : 'brick'} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={`btn btn-sm ${kind === 'warning' ? 'btn-jade' : 'btn-brick'}`} onClick={() => void submit()} disabled={busy || !date || (!file && !description.trim())}>
          {busy ? 'Saving…' : kind === 'warning' ? 'Issue warning' : 'Issue final warning'}
        </button>
      </>
    }>
      <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>
        Customer will have <strong style={{ color: 'var(--ink-2)' }}>{n} days</strong> to correct — until {fmtDate(addDays(date, n))}.
        {kind === 'final' && ' If not corrected by then, you can escalate to legal.'}
      </p>
      <div className="field">
        <label>Date</label>
        <input type="date" className="input" value={date} max={today()} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="field">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
          <label style={{ marginBottom: 0 }}>Description</label>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {tpls.length > 1 && (
              <select className="input" aria-label="Template" value={tplId ?? ''} onChange={e => setTplId(Number(e.target.value) || null)} disabled={busy || tplBusy}
                style={{ padding: '4px 8px', fontSize: 11.5, borderRadius: 8, maxWidth: 200, width: 'auto' }}>
                {tpls.map(t => <option key={t.id} value={t.id}>{t.name}{t.source === 'custom' ? ' (custom)' : ''}</option>)}
              </select>
            )}
            {tplSubject && (
              <button type="button" className="btn btn-ghost btn-sm" style={smallBtn} onClick={() => void copyLetter()} disabled={busy} title="Copy the subject and letter to paste into your own letter or email">
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" style={smallBtn} onClick={() => void applyTemplate()} disabled={busy || tplBusy} title="Fill in your warning-letter template for this breach">
              <FileText size={12} /> {tplBusy ? 'Rendering…' : 'Use template'}
            </button>
          </span>
        </div>
        {tplConfirm && (
          <p className="note" style={{ marginTop: 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            Replace what you have written with the template text?
            <button type="button" className="btn btn-brick btn-sm" style={smallBtn} onClick={() => void applyTemplate(true)}>Replace</button>
            <button type="button" className="btn btn-ghost btn-sm" style={smallBtn} onClick={() => setTplConfirm(false)}>Keep mine</button>
          </p>
        )}
        {tplSubject && <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)', margin: '0 0 6px' }}>{tplSubject}</p>}
        <textarea className="input" rows={tplSubject ? 12 : 3} value={description} onChange={e => setDescription(e.target.value)} placeholder="How the warning was given, what it says…" />
        {tplSubject && <p className="note" style={{ marginTop: 6 }}>Copy this into your own letter or email — the platform does not send it.</p>}
        {tplErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 6 }}>{tplErr}</p>}
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>Copy of the warning</label>
        <FilePick file={file} onFile={setFile} disabled={busy} />
      </div>
      {!file && !description.trim() && <p className="note" style={{ marginTop: 10 }}>Attach the warning copy or describe it — one of the two is required.</p>}
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ── Mark as resolved ──────────────────────────────────────────────────────── */
function ResolveModal({ breach, base, rp, onClose, onDone }: {
  breach: BreachDetail; base: string; rp?: number; onClose: () => void; onDone: (b: BreachDetail) => void;
}) {
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { onDone(await legalApi.breachResolve(base, rp, breach.id, { date, description: description.trim() || null })); }
    catch (e) { setErr(errText(e, 'Could not mark the breach as resolved')); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Mark as resolved" tone="jade" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-jade btn-sm" onClick={() => void submit()} disabled={busy || !date}>{busy ? 'Saving…' : 'Mark as resolved'}</button>
      </>
    }>
      <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>The breach closes and stays on the lease record.</p>
      <div className="field">
        <label>Resolved on</label>
        <input type="date" className="input" value={date} max={today()} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>How it was resolved (optional)</label>
        <textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

/* ── Escalate to legal ─────────────────────────────────────────────────────── */
function EscalateModal({ breach, leaseStatus, base, rp, onClose, onDone }: {
  breach: BreachDetail; leaseStatus: string; base: string; rp?: number; onClose: () => void; onDone: (disputeId: number, b: BreachDetail) => void;
}) {
  const expired = leaseStatus === 'expired';
  const [stillOccupying, setStillOccupying] = useState(expired);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await legalApi.breachEscalate(base, rp, breach.id, { customerStillOccupying: expired ? stillOccupying : undefined, description: description.trim() || null });
      onDone(r.dispute.id, r.breach);
    } catch (e) { setErr(errText(e, 'Could not escalate')); setBusy(false); }
  };
  return (
    <Modal title="Escalate to legal" tone="purple" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-sm" style={{ background: PURPLE.fg, color: '#fff' }} onClick={() => void submit()} disabled={busy}>
          <Gavel size={14} /> {busy ? 'Opening case…' : 'Open legal case'}
        </button>
      </>
    }>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 12px' }}>
        A legal case will be opened for this lease and this breach will be <strong>frozen</strong> — its warnings and attachments are copied into the case file, and from here on only the case moves.
      </p>
      {expired && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={stillOccupying} onChange={e => setStillOccupying(e.target.checked)} />
          The lease has ended and the customer is still occupying the unit
        </label>
      )}
      <div className="field" style={{ margin: 0 }}>
        <label>Why now (optional)</label>
        <textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Deadline passed, no change" />
      </div>
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

/* ── progress bar: Reported → Warning issued → Final warning → Resolved ─────── */
const STEPS: { key: BreachStage; label: string }[] = [
  { key: 'reported', label: 'Reported' }, { key: 'warning_sent', label: 'Warning issued' },
  { key: 'final_warning', label: 'Final warning' }, { key: 'resolved', label: 'Resolved' },
];
function ProgressBar({ b, disputeHref }: { b: BreachDetail; disputeHref: string | null }) {
  const escalated = b.stage === 'escalated';
  const done: Record<BreachStage, boolean> = {
    reported: true, warning_sent: !!b.warningSentDate, final_warning: !!b.finalWarningDate,
    resolved: b.stage === 'resolved', escalated,
  };
  const dateOf: Record<BreachStage, string | null> = {
    reported: b.openedDate, warning_sent: b.warningSentDate, final_warning: b.finalWarningDate, resolved: b.resolvedDate, escalated: null,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, flexWrap: 'wrap' }}>
      {STEPS.map((s, i) => {
        const isCur = b.stage === s.key;
        const on = done[s.key];
        const skipped = escalated && !on && s.key !== 'resolved';
        const fg = isCur ? breachStageTone(s.key).fg : on ? 'var(--jade-deep)' : 'var(--mute)';
        const bg = isCur ? breachStageTone(s.key).bg : on ? 'var(--jade-tint)' : 'var(--surface)';
        return (
          <div key={s.key} style={{ flex: '1 1 120px', minWidth: 120, background: bg, border: `1px solid ${isCur ? fg : 'var(--mist-strong)'}`, borderRadius: 10, padding: '8px 10px', opacity: escalated && s.key === 'resolved' ? .45 : skipped ? .6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: fg }}>
              <span style={{ width: 16, height: 16, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 9.5, background: on || isCur ? fg : 'var(--mist-strong)', color: '#fff' }}>{i + 1}</span>
              {s.label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 3 }}>{dateOf[s.key] ? fmtDate(dateOf[s.key]) : on ? '' : '—'}</div>
          </div>
        );
      })}
      {escalated && (
        <div style={{ flex: '1 1 160px', minWidth: 160, background: PURPLE.bg, border: `1px solid ${PURPLE.fg}`, borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: PURPLE.fg }}><Gavel size={13} /> Escalated to legal</div>
          {disputeHref && (
            <a href={disputeHref} style={{ fontSize: 11.5, fontWeight: 700, color: PURPLE.fg, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
              Open legal case <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ── timeline ──────────────────────────────────────────────────────────────── */
function Timeline({ events }: { events: BreachEvent[] }) {
  const sorted = useMemo(() => [...events].sort((a, b) => (b.date.localeCompare(a.date)) || b.createdAt.localeCompare(a.createdAt)), [events]);
  if (!sorted.length) return <p className="note">Nothing recorded yet.</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {sorted.map((e, i) => {
        const tone = e.type === 'warning' ? breachStageTone('warning_sent') : e.type === 'final_warning' ? breachStageTone('final_warning')
          : e.type === 'resolved' ? breachStageTone('resolved') : e.type === 'escalated' ? PURPLE : e.type === 'reported' ? breachStageTone('reported') : { bg: 'var(--mist)', fg: 'var(--ink-2)' };
        return (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 10, position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: tone.fg, marginTop: 5, flexShrink: 0 }} />
              {i < sorted.length - 1 && <span style={{ width: 2, flex: 1, background: 'var(--mist-strong)', marginTop: 2 }} />}
            </div>
            <div style={{ paddingBottom: i < sorted.length - 1 ? 12 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="pill" style={{ background: tone.bg, color: tone.fg, padding: '3px 9px', fontSize: 10.5 }}>{BREACH_EVENT_TYPE_LABELS[e.type] ?? e.type}</span>
                <span style={{ fontSize: 12, color: 'var(--mute)' }}>{fmtDate(e.date)}</span>
                {e.document && (
                  <button type="button" onClick={() => void openDocViewerByIds([{ id: e.document!.id, caption: e.document!.name, mimeType: e.document!.mimeType }], e.document!.name)} className="mini-btn view" style={{ marginLeft: 'auto' }}>
                    <Paperclip size={11} /> {e.document.name || 'Attachment'}
                  </button>
                )}
              </div>
              {e.description && <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{e.description}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── "Add note / customer response" ────────────────────────────────────────── */
type NoteKind = 'note' | 'customer_response' | 'inspection';
function AddEventForm({ breach, base, rp, onDone }: { breach: BreachDetail; base: string; rp?: number; onDone: (b: BreachDetail) => void }) {
  const [type, setType] = useState<NoteKind>('note');
  const [date, setDate] = useState(today());
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      let documentId: number | null = null;
      if (file) {
        const { id } = await uploadOwnedDocument({
          ownerType: 'tenancy_breach', ownerId: breach.id, category: 'legal',
          documentKey: `breach_${breach.id}_${Date.now()}`, displayName: file.name, file,
        });
        documentId = id;
      }
      const next = await legalApi.breachEvent(base, rp, breach.id, { type, date, description: text.trim() || null, documentId });
      setText(''); setFile(null); setType('note'); onDone(next);
    } catch (e) { setErr(errText(e, 'Could not add the note')); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <select className="input" style={{ width: 'auto', padding: '7px 10px', fontSize: 12.5 }} value={type} onChange={e => setType(e.target.value as NoteKind)}>
          <option value="note">Note</option>
          <option value="customer_response">Customer response</option>
          <option value="inspection">Inspection</option>
        </select>
        <input type="date" className="input" style={{ width: 'auto', padding: '7px 10px', fontSize: 12.5 }} value={date} max={today()} onChange={e => setDate(e.target.value)} />
      </div>
      <textarea className="input" rows={2} style={{ minHeight: 52, fontSize: 13 }} value={text} onChange={e => setText(e.target.value)}
        placeholder={type === 'customer_response' ? 'What the customer said or did…' : type === 'inspection' ? 'What was found on inspection…' : 'Add a note…'} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <FilePick file={file} onFile={setFile} disabled={busy} />
        <button className="btn btn-jade btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void submit()} disabled={busy || (!text.trim() && !file)}>
          {busy ? 'Saving…' : 'Add'}
        </button>
      </div>
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 6 }}>{err}</p>}
    </div>
  );
}

/* ── one breach, expanded ──────────────────────────────────────────────────── */
function BreachDetailPanel({ id, base, rp, leaseStatus, disputeHrefOf, seed, onChanged, autoEscalate }: {
  id: number; base: string; rp?: number; leaseStatus: string; disputeHrefOf: (d: number) => string; seed: BreachRow;
  onChanged: (b: BreachDetail) => void;
  /** Deep link from the Operations board (?escalate=<id>): open the Escalate dialog once the breach is loaded. */
  autoEscalate?: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<BreachDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'warning' | 'final' | 'resolve' | 'escalate'>(null);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoEscalate || autoOpened.current || !detail) return;
    autoOpened.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (detail.actions.escalate) setModal('escalate');
  }, [autoEscalate, detail]);

  const load = useCallback(async () => {
    setErr(null);
    try { setDetail(await legalApi.breach(base, rp, id)); }
    catch (e) { setErr(errText(e, 'Could not load this breach')); }
  }, [base, rp, id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const apply = (b: BreachDetail) => { setDetail(b); onChanged(b); setModal(null); };
  const b = detail;
  const row = b ?? seed;
  const overdue = (daysFromToday(row.nextDate) ?? 1) < 0;
  const disputeHref = row.disputeId != null ? disputeHrefOf(row.disputeId) : null;

  return (
    <div style={{ borderTop: '1px dashed var(--mist-strong)', padding: '14px 14px 14px', background: '#fff' }}>
      {err && <p className="note" style={{ color: 'var(--brick)' }}>{err}</p>}
      {!b && !err && <p className="note">Loading…</p>}
      {b && (
        <>
          <ProgressBar b={b} disputeHref={disputeHref} />

          {/* hint / countdown + actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {b.alert ? <AlertLine text={b.alert.text} overdue={overdue} /> : <span>{b.hint}</span>}
              {b.nextDate && b.stage !== 'escalated' && b.stage !== 'resolved' && (
                <span className="note" style={{ fontSize: 12 }}>· deadline {fmtDate(b.nextDate)} ({countdown(b.nextDate)})</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
              {b.actions.issueWarning && <button className="btn btn-ghost btn-sm" onClick={() => setModal('warning')}>Issue warning</button>}
              {b.actions.issueFinalWarning && <button className="btn btn-brick btn-sm" onClick={() => setModal('final')}>Issue final warning</button>}
              {b.actions.resolve && <button className="btn btn-jade btn-sm" onClick={() => setModal('resolve')}>Mark as resolved</button>}
              {b.actions.escalate && <button className="btn btn-sm" style={{ background: PURPLE.fg, color: '#fff' }} onClick={() => setModal('escalate')}><Gavel size={14} /> Escalate to legal</button>}
            </div>
          </div>

          {/* facts */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5, color: 'var(--ink-3)' }}>
            <span>Reported by <strong style={{ color: 'var(--ink-2)' }}>{BREACH_REPORTED_BY_LABELS[b.reportedBy] ?? '—'}</strong></span>
            <span>Opened <strong style={{ color: 'var(--ink-2)' }}>{fmtDate(b.openedDate)}</strong></span>
            {b.correctionDeadline && <span>Correction deadline <strong style={{ color: 'var(--ink-2)' }}>{fmtDate(b.correctionDeadline)}</strong></span>}
            {b.finalDeadline && <span>Final deadline <strong style={{ color: 'var(--ink-2)' }}>{fmtDate(b.finalDeadline)}</strong></span>}
            {b.resolvedDate && <span>Resolved <strong style={{ color: 'var(--ink-2)' }}>{fmtDate(b.resolvedDate)}</strong></span>}
          </div>
          {b.description && <p style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{b.description}</p>}

          {/* timeline */}
          <div className="eyebrow" style={{ marginTop: 16, marginBottom: 10 }}>Timeline</div>
          <Timeline events={b.events} />

          {b.stage !== 'escalated' && (
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Add note / customer response</div>
              <AddEventForm breach={b} base={base} rp={rp} onDone={apply} />
            </div>
          )}

          {modal === 'warning' && <WarningModal kind="warning" breach={b} base={base} rp={rp} onClose={() => setModal(null)} onDone={apply} />}
          {modal === 'final' && <WarningModal kind="final" breach={b} base={base} rp={rp} onClose={() => setModal(null)} onDone={apply} />}
          {modal === 'resolve' && <ResolveModal breach={b} base={base} rp={rp} onClose={() => setModal(null)} onDone={apply} />}
          {modal === 'escalate' && (
            <EscalateModal breach={b} leaseStatus={leaseStatus} base={base} rp={rp} onClose={() => setModal(null)}
              onDone={(disputeId, nb) => { apply(nb); router.push(disputeHrefOf(disputeId)); }} />
          )}
        </>
      )}
    </div>
  );
}

/* ── one list row (top-level so the expanded panel keeps its state across list updates) ── */
function BreachListRow({ b, expanded, onToggle, base, rp, leaseStatus, disputeHrefOf, onChanged, autoEscalate }: {
  b: BreachRow; expanded: boolean; onToggle: () => void; base: string; rp?: number; leaseStatus: string;
  disputeHrefOf: (d: number) => string; onChanged: (b: BreachDetail) => void; autoEscalate?: boolean;
}) {
  const overdue = (daysFromToday(b.nextDate) ?? 1) < 0;
  const live = isOpen(b);
  return (
    <div style={{ border: '1px solid var(--mist-strong)', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: expanded ? '#fff' : 'var(--surface)' }}>
      <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        style={{ width: '100%', cursor: 'pointer', padding: '11px 14px', display: 'grid', gridTemplateColumns: '16px 1fr auto', gap: 12, alignItems: 'center' }}
        aria-expanded={expanded}>
        <span style={{ color: 'var(--mute)' }}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13.5 }}>{b.categoryLabel || BREACH_CATEGORY_LABELS[b.category]}</strong>
            <StagePill stage={b.stage} label={b.stageLabel} />
            <span style={{ fontSize: 12, color: 'var(--mute)' }}>opened {fmtDate(b.openedDate)}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4, fontSize: 12.5, color: 'var(--ink-3)' }}>
            {b.alert ? <AlertLine text={b.alert.text} overdue={overdue} /> : <span>{b.hint}</span>}
            {live && b.nextDate && <span className="note" style={{ fontSize: 12 }}>· {fmtDate(b.nextDate)} ({countdown(b.nextDate)})</span>}
          </span>
        </span>
        {b.stage === 'escalated' && b.disputeId != null ? (
          <a href={disputeHrefOf(b.disputeId)} onClick={e => e.stopPropagation()} className="mini-btn view" style={{ color: PURPLE.fg }}>
            <Gavel size={11} /> Legal case
          </a>
        ) : <span />}
      </div>
      {expanded && (
        <BreachDetailPanel id={b.id} seed={b} base={base} rp={rp} leaseStatus={leaseStatus} disputeHrefOf={disputeHrefOf} onChanged={onChanged} autoEscalate={autoEscalate} />
      )}
    </div>
  );
}

/* ── the section ───────────────────────────────────────────────────────────── */
export function BreachesSection({ leaseId, leaseStatus, base, rp, disputeHrefOf }: BreachesSectionProps) {
  const [items, setItems] = useState<BreachRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // ?escalate=<breachId> (from the Operations Breach board) lands expanded with the Escalate dialog up.
  const escalateParam = useSearchParams().get('escalate');
  const escalateId = escalateParam && /^\d+$/.test(escalateParam) ? Number(escalateParam) : null;
  const [openId, setOpenId] = useState<number | null>(escalateId);
  const [showClosed, setShowClosed] = useState(false);
  const [report, setReport] = useState(false);
  // The lease's open case, if any: the header shows "Legal · <stage>" instead of
  // "Move to legal" (owner: "how to mark that lease like it's in legal case now").
  const [openCase, setOpenCase] = useState<DisputeRow | null>(null);
  const [moveLegal, setMoveLegal] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [b, d] = await Promise.all([
        legalApi.breaches(base, rp, { leaseId }),
        legalApi.disputes(base, rp, { leaseId, open: true }).catch(() => ({ items: [] as DisputeRow[] })),
      ]);
      setItems(b.items);
      setOpenCase(d.items[0] ?? null);
    }
    catch (e) { setErr(errText(e, 'Could not load breaches')); setItems([]); }
  }, [base, rp, leaseId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // Keep the list row in step with the detail without a second round-trip.
  const patchRow = (b: BreachDetail) => setItems(prev => prev ? prev.map(r => r.id === b.id ? { ...r, ...b } : r) : prev);

  const open = (items ?? []).filter(isOpen);
  const closed = (items ?? []).filter(b => !isOpen(b));
  const rowProps = (b: BreachRow) => ({
    expanded: openId === b.id, onToggle: () => setOpenId(openId === b.id ? null : b.id), base, rp, leaseStatus, disputeHrefOf, onChanged: patchRow,
    autoEscalate: escalateId === b.id,
  });

  return (
    <>
      <div className="sech">
        <span className="si"><Scale size={16} /></span>
        <span className="st">
          Breaches
          {items && items.length > 0 && (
            <span className="pill" style={{ marginLeft: 8, padding: '3px 9px', fontSize: 10.5, background: open.length ? 'var(--saffron-soft)' : 'var(--mist)', color: open.length ? 'var(--saffron-deep)' : 'var(--ink-2)' }}>
              {open.length ? `${open.length} open` : `${items.length} on record`}
            </span>
          )}
        </span>
        {openCase ? (
          <a href={disputeHrefOf(openCase.id)} className="btn btn-sm" style={{ background: '#ece9fd', color: '#5b3fbf', textDecoration: 'none' }} title={openCase.hint}>
            <Gavel size={14} /> Legal · {openCase.stageLabel}
          </a>
        ) : (
          <button className="btn btn-sm" style={{ background: '#5b3fbf', color: '#fff' }} onClick={() => setMoveLegal(true)} title="Serve a notice, or record a case that is already in progress">
            <Gavel size={14} /> Move to legal
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setReport(true)}><Plus size={14} /> Report breach</button>
      </div>
      <div className="secb">
        <p className="note" style={{ marginTop: 0, marginBottom: 12 }}>
          Behaviour and agreement breaches — noise, extra occupants, misuse, damage and the like. Handled with warnings; escalate to legal only when warnings do not work.
        </p>
        {err && <p className="note" style={{ color: 'var(--brick)' }}>{err}</p>}
        {items === null && !err && <p className="note">Loading…</p>}
        {items !== null && items.length === 0 && !err && <p className="note">No breaches reported on this lease.</p>}

        {open.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {open.map(b => <BreachListRow key={b.id} b={b} {...rowProps(b)} />)}
          </div>
        )}

        {closed.length > 0 && (
          <div style={{ marginTop: open.length ? 14 : 0 }}>
            <button type="button" onClick={() => setShowClosed(v => !v)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              {showClosed ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="eyebrow">Resolved / escalated · {closed.length}</span>
            </button>
            {showClosed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {closed.map(b => <BreachListRow key={b.id} b={b} {...rowProps(b)} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {moveLegal && (
        <StartNoticeModal base={base} rp={rp} leaseId={leaseId} onClose={() => setMoveLegal(false)}
          onSaved={id => { setMoveLegal(false); router.push(disputeHrefOf(id)); }} />
      )}
      {report && (
        <ReportBreachModal leaseId={leaseId} base={base} rp={rp} onClose={() => setReport(false)}
          onDone={b => { setReport(false); setItems(prev => [b, ...(prev ?? []).filter(r => r.id !== b.id)]); setOpenId(b.id); }} />
      )}
    </>
  );
}

export default BreachesSection;
