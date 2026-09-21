'use client';

/**
 * Legal pipeline — one case (spec §7.3). Shared by the RP page and the manager
 * mirror.
 *
 * Header (lease/unit/customer, six-stage progress bar, the current countdown
 * hint, Mark as resolved) · Advance stage per `actions.nextStages`, each modal
 * asking ONLY that stage's fields · Notice card · Timeline newest first with
 * Add note / Add event · read-only Breach section when the case came from a
 * breach · right rail: Payments (linked cheques, held-by, collected-by, add a
 * settlement cheque, link a lease cheque), Documents (+ Export case file), Notes.
 *
 * The server judges every stage rule (§5.3) and answers 400 with a
 * plain-language reason — shown inline where the action was taken.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, X, UploadCloud, FileText, Printer, ChevronDown } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import { openDocViewerByIds } from '@/lib/docViewer';
import { DocumentReaderModal, type ReaderSlot } from '@/components/upnow/DocumentReaderModal';
import { DirhamSign } from '@/components/ui/DirhamSign';
import {
  legalApi, legalUrl, daysFromToday, disputeStageTone, DISPUTE_STAGES, DISPUTE_STAGE_LABELS, DISPUTE_OUTCOME_LABELS, CASE_EVENT_TYPE_LABELS, BREACH_EVENT_TYPE_LABELS, BREACH_REPORTED_BY_LABELS, PAYMENT_HELD_BY_LABELS, type DisputeDetail, type DisputeStage, type DisputeOutcome, type CaseEventType, type CaseEvent, type DisputePayment, type LegalDoc, type PaymentHeldBy, NOTICE_TYPE_LABELS, NOTICE_TEMPLATE_KIND, type NoticeType,
} from '@/lib/legal';
import { card, btn, btnPrimary, btnSm, btnGreenSm, lbl, field, fieldLbl, pillCls, fmtD, money, todayIso, errText, claimLabel, uploadDisputeFile } from '@/components/legal/StartNoticeModal';

/**
 * "Record the notice": a case opened by escalating a breach (or recorded in
 * progress) has no served date yet — the served / deadline slots read "—" and
 * the hint says so. This is where the landlord writes the date (the deadline
 * follows from their settings), picks the notice type, and can pull the letter
 * text from their template to serve it.
 */
function NoticeServedEditor({ d, base, rp, onSaved, say }: {
  d: DisputeDetail; base: string; rp?: number; onSaved: () => void; say: (t: string, tone?: 'ok' | 'warn') => void;
}) {
  const [open, setOpen] = useState(!d.noticeServedDate);
  const [type, setType] = useState<NoticeType>(d.noticeType === 'none' ? 'breach_remedy' : d.noticeType);
  const [served, setServed] = useState(d.noticeServedDate ?? todayIso());
  const [busy, setBusy] = useState(false);
  const [letter, setLetter] = useState<{ subject: string; body: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const kinds = (Object.keys(NOTICE_TYPE_LABELS) as NoticeType[]).filter(k => k !== 'none');

  const save = async () => {
    setBusy(true);
    try { await legalApi.updateDispute(base, rp, d.id, { noticeType: type, noticeServedDate: served }); setOpen(false); onSaved(); say('Notice recorded — the deadline follows your settings.'); }
    catch (e) { say(errText(e, 'Could not record the notice.'), 'warn'); }
    finally { setBusy(false); }
  };
  const render = async () => {
    setBusy(true);
    try {
      const r = await legalApi.renderTemplate(base, rp, NOTICE_TEMPLATE_KIND[type as Exclude<NoticeType, 'none'>], { disputeId: d.id, date: served });
      setLetter({ subject: r.subject, body: r.body });
    } catch (e) { say(errText(e, 'Could not render the notice text.'), 'warn'); }
    finally { setBusy(false); }
  };
  const copy = async () => { if (!letter) return; try { await navigator.clipboard.writeText(`${letter.subject}\n\n${letter.body}`); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } };

  if (!open) return <button type="button" onClick={() => setOpen(true)} className={btnSm}>Change served date / type</button>;
  return (
    <div className="mt-3 rounded-lg border border-[#f3d9a4] bg-[#fff8ec] px-3.5 py-3">
      <p className="text-[12px] font-semibold text-[#8a4b00]">{d.noticeServedDate ? 'Change the notice' : 'Record the notice — when was it served, and which one?'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_170px_auto] gap-2 mt-2 items-end">
        <div><span className={fieldLbl}>Notice type</span>
          <select className={field} value={type} onChange={e => { setType(e.target.value as NoticeType); setLetter(null); }}>
            {kinds.map(k => <option key={k} value={k}>{NOTICE_TYPE_LABELS[k]}</option>)}
          </select>
        </div>
        <div><span className={fieldLbl}>Served on</span><input type="date" className={field} value={served} onChange={e => { setServed(e.target.value); setLetter(null); }} /></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void render()} disabled={busy} className={btnSm}>{letter ? 'Re-render text' : 'Notice text'}</button>
          <button type="button" onClick={() => void save()} disabled={busy || !served} className={btnGreenSm}>{busy ? 'Saving…' : 'Save'}</button>
          {d.noticeServedDate && <button type="button" onClick={() => setOpen(false)} className={btnSm}>Cancel</button>}
        </div>
      </div>
      {letter && (
        <div className="mt-3">
          <p className="text-[12px] font-bold">{letter.subject}</p>
          <pre className="whitespace-pre-wrap text-[11.5px] leading-relaxed font-sans bg-white border border-[#eef0ee] rounded-lg px-3 py-2.5 max-h-56 overflow-y-auto mt-1">{letter.body}</pre>
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={() => void copy()} className={btnSm}>{copied ? 'Copied' : 'Copy text'}</button>
            <span className="text-[11px] text-[#8a8f8c]">Serve it through a provable channel, then upload the proof below.</span>
          </div>
        </div>
      )}
    </div>
  );
}
import { CaseCostsCard } from '@/components/legal/CaseCostsCard';

/** A lease cheque as GET /contracts/:id lists it (the v2 page's ContractPayment). */
interface LeasePayment { id: number; description: string | null; paymentType: string | null; amount: number; chequeNumber: string | null; chequeStatus: string; transactionDate: string | null }

/** The DTO's cheque states (UpdateDisputePaymentDto): the lease ledger's own vocabulary. */
type ChequeState = 'pending' | 'cleared' | 'bounced' | 'cancelled';
const CHEQUE_STATES: ChequeState[] = ['pending', 'cleared', 'bounced', 'cancelled'];
const CHEQUE_LABEL: Record<string, string> = { pending: 'Pending', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced', cancelled: 'Cancelled' };
const CHEQUE_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#fdf3e3', fg: '#c47a00' }, deposited: { bg: '#e0f2fe', fg: '#0369a1' }, cleared: { bg: '#e7f4ee', fg: '#1a7a52' },
  bounced: { bg: '#fdecea', fg: '#b42318' }, cancelled: { bg: '#f1f3f1', fg: '#5b615e' },
};

/** Which stage asks for what (spec §7.3 "each advance asks only for that stage's fields"). */
const STAGE_HINT: Record<DisputeStage, string> = {
  notice_sent: '', case_filed: 'The case is registered with the rental authority.',
  settlement: 'Both sides are talking — record what was agreed and when it is due.',
  decision: 'The authority has decided — the other side gets the appeal window from your jurisdiction settings.',
  enforcement: 'The decision is being enforced — record each action taken.', closed: '',
};

export const Modal = ({ title, sub, onClose, children, footer, wide }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
    <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f3f1]">
        <div><h2 className="text-sm font-bold text-[#1c1f1d]">{title}</h2>{sub && <p className="text-[11px] text-[#8a8f8c] mt-0.5">{sub}</p>}</div>
        <button onClick={onClose} className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer" aria-label="Close"><X size={18} /></button>
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#f1f3f1]">{footer}</div>
    </div>
  </div>
);

export const FilePick = ({ file, onPick, label }: { file: File | null; onPick: (f: File | null) => void; label: string }) => (
  <label className="flex items-center gap-2 text-xs text-[#5b615e] border border-dashed border-[#d8d6d0] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-[#f9f8f6]">
    <UploadCloud size={14} className="text-[#1a7a52]" />{file ? file.name : label}
    <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf" onChange={e => { onPick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
  </label>
);

/** A long list keeps its card a fixed height and scrolls INSIDE it — the page itself stays short.
 *  The title row (count + buttons) sits above and never scrolls away. */
export const lockedList = 'overflow-y-auto overscroll-contain pr-1 -mr-1 [scrollbar-width:thin]';

/** The page's document gallery, when there is one: every document link opens it AT that document. */
export const OpenDocCtx = createContext<((docId: number) => void) | null>(null);

export const DocLink = ({ d, caption }: { d: LegalDoc; caption?: string }) => {
  const openInGallery = useContext(OpenDocCtx);
  return (
    <button type="button" onClick={() => (openInGallery ? openInGallery(d.id) : void openDocViewerByIds([{ id: d.id, caption: caption ?? d.name, mimeType: d.mimeType }], caption ?? d.name))}
      className="text-[12px] font-semibold text-[#1c1f1d] hover:text-[#1a7a52] hover:underline cursor-pointer flex items-start gap-1.5 text-left leading-snug"><FileText size={13} className="shrink-0 mt-[2px] text-[#1a7a52]" /> <span className="min-w-0 break-words">{d.name}</span></button>
  );
};

/* ── Advance stage: only that stage's fields ─────────────────────────────── */
function AdvanceModal({ base, rp, d, to, onClose, onDone }: { base: string; rp?: number | null; d: DisputeDetail; to: DisputeStage; onClose: () => void; onDone: (text: string) => void }) {
  // Filing before the notice deadline is allowed with a written reason (kept on the timeline); proof of service stays mandatory.
  const deadlineAhead = to === 'case_filed' && !!d.noticeDeadline && (daysFromToday(d.noticeDeadline) ?? 0) > 0;
  const [earlyReason, setEarlyReason] = useState('');
  const [date, setDate] = useState(todayIso());
  const [caseNo, setCaseNo] = useState(d.authorityCaseNumber ?? '');
  const [filingDate, setFilingDate] = useState(d.filingDate ?? todayIso());
  const [hearing, setHearing] = useState(d.nextHearingDate ?? '');
  const [amount, setAmount] = useState(d.claimAmount != null ? String(d.claimAmount) : '');
  const [due, setDue] = useState('');
  const [decisionDate, setDecisionDate] = useState(todayIso());
  const [outcome, setOutcome] = useState<DisputeOutcome | ''>('');
  const [desc, setDesc] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsProof = to === 'case_filed' && !d.noticeProofDocumentId && d.noticeType !== 'none';

  async function submit() {
    setError(null); setSaving(true);
    try {
      let documentId: number | null = null;
      if (file) {
        documentId = await uploadDisputeFile(d.id, file, to === 'case_filed' ? 'Notice proof' : to === 'decision' ? 'Decision document' : to === 'enforcement' ? 'Enforcement document' : 'Settlement document');
        // The notice proof is recorded on the case BEFORE the move, so rule 5.3.1 sees it.
        if (needsProof && documentId) await legalApi.updateDispute(base, rp ?? undefined, d.id, { noticeProofDocumentId: documentId });
      }
      await legalApi.advanceDispute(base, rp ?? undefined, d.id, {
        to, date, description: desc.trim() || null, documentId: needsProof ? null : documentId,
        ...(to === 'case_filed' ? { authorityCaseNumber: caseNo.trim() || null, filingDate: filingDate || null, nextHearingDate: hearing || null, fileEarlyReason: deadlineAhead && earlyReason.trim() ? earlyReason.trim() : null } : {}),
        ...(to === 'settlement' ? { amount: amount.trim() !== '' ? Number(amount) : null, settlementDueDate: due || null } : {}),
        ...(to === 'decision' ? { decisionDate: decisionDate || null, outcome: outcome || null } : {}),
      });
      onDone(`Case moved to “${DISPUTE_STAGE_LABELS[to]}”.`);
    } catch (e) { setError(errText(e, 'Could not move the case.')); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`Move to “${DISPUTE_STAGE_LABELS[to]}”`} sub={STAGE_HINT[to]} onClose={onClose}
      footer={<><button onClick={onClose} className={btn}>Cancel</button><button onClick={() => void submit()} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : `Move to ${DISPUTE_STAGE_LABELS[to]}`}</button></>}>
      {to === 'case_filed' && deadlineAhead && (
        <div className="rounded-lg border px-3 py-2.5 mb-3" style={{ background: '#fff4e0', borderColor: '#f3d9a4' }}>
          <p className="text-[12px] font-semibold" style={{ color: '#8a4b00' }}>The notice deadline is {fmtD(d.noticeDeadline)} — {daysFromToday(d.noticeDeadline)} days away.</p>
          <p className="text-[11.5px] text-[#5b615e] mt-0.5">Filing normally waits for it. To file now, say why (for example the customer refused in writing). The reason is recorded on the case; proof of service is still required.</p>
          <textarea rows={2} className={field + ' mt-2'} value={earlyReason} onChange={e => setEarlyReason(e.target.value)} placeholder="Reason for filing before the deadline" />
        </div>
      )}
      {to === 'case_filed' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div><span className={fieldLbl}>Authority case number</span><input className={field} value={caseNo} onChange={e => setCaseNo(e.target.value)} placeholder="as issued" /></div>
            <div><span className={fieldLbl}>Filing date</span><input type="date" className={field} value={filingDate} onChange={e => setFilingDate(e.target.value)} /></div>
            <div><span className={fieldLbl}>Next hearing date</span><input type="date" className={field} value={hearing} onChange={e => setHearing(e.target.value)} /></div>
          </div>
          {needsProof && (
            <div>
              <span className={fieldLbl}>Proof the notice was served <span className="text-[#b42318]">— required to file</span></span>
              <FilePick file={file} onPick={setFile} label="Attach the proof (PDF or photo)" />
            </div>
          )}
          {d.config.registrationRequiredToFile && !d.lease?.registrationNumber && (
            <p className="text-[11px] text-[#c47a00] bg-[#fffbf3] border border-[#f5d9a8] rounded-lg px-3 py-2">This lease has no registration number on record — your jurisdiction requires one to file. The server will refuse the move until it is added on the lease.</p>
          )}
        </>
      )}
      {to === 'settlement' && (
        <div className="grid grid-cols-2 gap-2">
          <div><span className={fieldLbl}>Agreed amount (AED)</span><input type="number" min="0" step="0.01" className={field} value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div><span className={fieldLbl}>Settlement due date</span><input type="date" className={field} value={due} onChange={e => setDue(e.target.value)} /></div>
        </div>
      )}
      {to === 'decision' && (
        <div className="grid grid-cols-2 gap-2">
          <div><span className={fieldLbl}>Decision date</span><input type="date" className={field} value={decisionDate} onChange={e => setDecisionDate(e.target.value)} /></div>
          <div><span className={fieldLbl}>Outcome</span>
            <select className={field} value={outcome} onChange={e => setOutcome(e.target.value as DisputeOutcome | '')}>
              <option value="">— not yet known —</option>
              {(Object.keys(DISPUTE_OUTCOME_LABELS) as DisputeOutcome[]).map(o => <option key={o} value={o}>{DISPUTE_OUTCOME_LABELS[o]}</option>)}
            </select>
          </div>
          <div className="col-span-2"><span className={fieldLbl}>Decision document</span><FilePick file={file} onPick={setFile} label="Attach the decision (PDF or photo)" /></div>
        </div>
      )}
      {to === 'enforcement' && (
        <div><span className={fieldLbl}>Document</span><FilePick file={file} onPick={setFile} label="Attach the enforcement order (optional)" /></div>
      )}
      <div><span className={fieldLbl}>{to === 'enforcement' ? 'Action taken' : to === 'settlement' ? 'Note' : 'Note (optional)'}</span><textarea rows={2} className={field} value={desc} onChange={e => setDesc(e.target.value)} placeholder={to === 'enforcement' ? 'e.g. eviction order served by bailiff' : ''} /></div>
      <div><span className={fieldLbl}>Event date</span><input type="date" className={field} value={date} onChange={e => setDate(e.target.value)} /></div>
      {error && <p className="text-xs text-[#b42318] bg-[#fdecea] rounded-lg px-3 py-2">{error}</p>}
    </Modal>
  );
}

/* ── Add note / event ────────────────────────────────────────────────────── */
const EVENT_TYPES: CaseEventType[] = ['note', 'notice', 'filed', 'hearing', 'settlement_agreed', 'decision', 'appeal', 'enforcement_action'];
function EventModal({ base, rp, d, onClose, onDone }: { base: string; rp?: number | null; d: DisputeDetail; onClose: () => void; onDone: (text: string) => void }) {
  const [type, setType] = useState<CaseEventType>('note');
  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!desc.trim() && !file) { setError('Write what happened, or attach a file.'); return; }
    setError(null); setSaving(true);
    try {
      const documentId = file ? await uploadDisputeFile(d.id, file, desc.trim() || `${CASE_EVENT_TYPE_LABELS[type]} attachment`) : null;
      await legalApi.caseEvent(base, rp ?? undefined, d.id, { type, date, description: desc.trim() || null, amount: amount.trim() !== '' ? Number(amount) : null, documentId });
      onDone(type === 'note' ? 'Note added to the timeline.' : `${CASE_EVENT_TYPE_LABELS[type]} recorded.`);
    } catch (e) { setError(errText(e, 'Could not add the event.')); }
    finally { setSaving(false); }
  }
  return (
    <Modal title="Add note / event" onClose={onClose}
      footer={<><button onClick={onClose} className={btn}>Cancel</button><button onClick={() => void submit()} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Add to timeline'}</button></>}>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={fieldLbl}>Type</span>
          <select className={field} value={type} onChange={e => setType(e.target.value as CaseEventType)}>
            {EVENT_TYPES.map(t => <option key={t} value={t}>{CASE_EVENT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div><span className={fieldLbl}>Date</span><input type="date" className={field} value={date} onChange={e => setDate(e.target.value)} /></div>
      </div>
      <div><span className={fieldLbl}>What happened</span><textarea rows={3} className={field} value={desc} onChange={e => setDesc(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={fieldLbl}>Amount (AED, optional)</span><input type="number" min="0" step="0.01" className={field} value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div><span className={fieldLbl}>Attachment (optional)</span><FilePick file={file} onPick={setFile} label="Attach a file" /></div>
      </div>
      {error && <p className="text-xs text-[#b42318] bg-[#fdecea] rounded-lg px-3 py-2">{error}</p>}
    </Modal>
  );
}

/* ── Settlement cheque: add new, or link one of the lease's cheques ──────── */
function ChequeModal({ base, rp, d, onClose, onDone }: { base: string; rp?: number | null; d: DisputeDetail; onClose: () => void; onDone: (text: string) => void }) {
  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [amount, setAmount] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState('Settlement cheque');
  const [heldBy, setHeldBy] = useState<PaymentHeldBy | ''>('');
  const [collectedBy, setCollectedBy] = useState('');
  const [leasePays, setLeasePays] = useState<LeasePayment[] | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'link' || leasePays != null) return;
    // GET /contracts/:id carries the lease's cheques (RP + manager roles); the case's own rows are excluded.
    const linked = new Set(d.payments.map(p => p.id));
    apiGet<{ payments?: LeasePayment[] }>(`/contracts/${d.leaseId}`).then(c => setLeasePays((c.payments ?? []).filter(p => !linked.has(p.id)))).catch(() => setLeasePays([]));
  }, [mode, leasePays, d.leaseId, d.payments]);
  async function submit() {
    setError(null); setSaving(true);
    try {
      if (mode === 'link') {
        if (pick == null) { setError('Pick the cheque to link.'); setSaving(false); return; }
        await legalApi.linkPayment(base, rp ?? undefined, d.id, { paymentId: pick, heldBy: heldBy || null, collectedByName: collectedBy.trim() || null });
        onDone('Lease cheque linked to the case.');
      } else {
        if (amount.trim() === '' || !Number.isFinite(Number(amount))) { setError('Enter the cheque amount.'); setSaving(false); return; }
        await legalApi.linkPayment(base, rp ?? undefined, d.id, { amount: Number(amount), chequeNumber: chequeNo.trim() || null, transactionDate: date || null, description: desc.trim() || null, heldBy: heldBy || null, collectedByName: collectedBy.trim() || null });
        onDone('Settlement cheque added — it is a payment row on the lease, linked to this case.');
      }
    } catch (e) { setError(errText(e, 'Could not save the cheque.')); }
    finally { setSaving(false); }
  }
  const tab = (k: 'new' | 'link', label: string) => (
    <button type="button" onClick={() => setMode(k)} className="text-[11px] font-semibold px-3 py-1.5 rounded-full cursor-pointer" style={mode === k ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e', border: '1px solid #e6e8e6' }}>{label}</button>
  );
  return (
    <Modal title="Cheque on this case" sub="A settlement cheque is an ordinary payment row on the lease, linked here." onClose={onClose} wide
      footer={<><button onClick={onClose} className={btn}>Cancel</button><button onClick={() => void submit()} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : mode === 'link' ? 'Link cheque' : 'Add settlement cheque'}</button></>}>
      <div className="flex gap-1.5">{tab('new', 'Add settlement cheque')}{tab('link', 'Link an existing lease cheque')}</div>
      {mode === 'new' ? (
        <div className="grid grid-cols-2 gap-2">
          <div><span className={fieldLbl}>Amount (AED)</span><input type="number" min="0" step="0.01" className={field} value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div><span className={fieldLbl}>Cheque number</span><input className={field} value={chequeNo} onChange={e => setChequeNo(e.target.value)} /></div>
          <div><span className={fieldLbl}>Cheque date</span><input type="date" className={field} value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><span className={fieldLbl}>Description</span><input className={field} value={desc} onChange={e => setDesc(e.target.value)} /></div>
        </div>
      ) : (
        <div className="border border-[#e6e8e6] rounded-lg divide-y divide-[#f1f3f1] max-h-60 overflow-y-auto">
          {leasePays == null ? <div className="flex items-center gap-2 text-[12px] text-[#8a8f8c] px-3 py-3"><Loader2 size={13} className="animate-spin" /> Loading the lease’s cheques…</div>
            : leasePays.length === 0 ? <p className="text-[12px] text-[#8a8f8c] px-3 py-3">No unlinked cheques on this lease.</p>
            : leasePays.map(p => {
              const t = CHEQUE_TONE[p.chequeStatus] ?? CHEQUE_TONE.pending;
              return (
                <label key={p.id} className={`flex items-center gap-3 px-3 py-2 text-[12px] cursor-pointer ${pick === p.id ? 'bg-[#e7f4ee]' : 'hover:bg-[#fafbfa]'}`}>
                  <input type="radio" name="lease-cheque" className="accent-[#1a7a52]" checked={pick === p.id} onChange={() => setPick(p.id)} />
                  <span className="flex-1 min-w-0 truncate font-semibold">{p.description ?? p.paymentType ?? `Payment #${p.id}`}{p.chequeNumber ? <span className="font-normal text-[#8a8f8c]"> · #{p.chequeNumber}</span> : null}</span>
                  <span className="whitespace-nowrap">{money(p.amount)}</span>
                  <span className="whitespace-nowrap text-[#8a8f8c]">{fmtD(p.transactionDate)}</span>
                  <span className={pillCls} style={{ background: t.bg, color: t.fg }}>{CHEQUE_LABEL[p.chequeStatus] ?? p.chequeStatus}</span>
                </label>
              );
            })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div><span className={fieldLbl}>Held by</span>
          <select className={field} value={heldBy} onChange={e => setHeldBy(e.target.value as PaymentHeldBy | '')}>
            <option value="">—</option>
            {(Object.keys(PAYMENT_HELD_BY_LABELS) as PaymentHeldBy[]).map(h => <option key={h} value={h}>{PAYMENT_HELD_BY_LABELS[h]}</option>)}
          </select>
        </div>
        <div><span className={fieldLbl}>Collected by (name)</span><input className={field} value={collectedBy} onChange={e => setCollectedBy(e.target.value)} /></div>
      </div>
      {error && <p className="text-xs text-[#b42318] bg-[#fdecea] rounded-lg px-3 py-2">{error}</p>}
    </Modal>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */
export function DisputeDetailView({ disputeId, base, rp, listHref, caseFileHref, leaseHrefOf, breachHrefOf }: {
  disputeId: number;
  /** '/legal' for the landlord, '/manager/legal' (+ rp) for a manager. */
  base: string; rp?: number | null;
  listHref: string; caseFileHref: string;
  leaseHrefOf?: (leaseId: number) => string;
  breachHrefOf?: (leaseId: number, breachId: number) => string;
}) {
  const [gallery, setGallery] = useState<{ initialKey?: string } | null>(null);
  const [openDocGroup, setOpenDocGroup] = useState<string | null>(null); // one folded group open at a time
  const fetchDocBlob = useMemo(() => async (f: { id: string | number }) => { const r = await fetch(`/api/documents/${f.id}/file`, { credentials: 'include', cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); return URL.createObjectURL(await r.blob()); }, []);
  const [d, setD] = useState<DisputeDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [advanceTo, setAdvanceTo] = useState<DisputeStage | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [chequeOpen, setChequeOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState<DisputeOutcome>('settled');
  const [resolveNote, setResolveNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [collected, setCollected] = useState<Record<number, string>>({});

  const say = (text: string, tone: 'ok' | 'warn' = 'ok') => { setNotice({ text, tone }); window.setTimeout(() => setNotice(n => (n?.text === text ? null : n)), 7000); };

  const load = useCallback(() => {
    legalApi.dispute(base, rp ?? undefined, disputeId)
      .then(x => { setD(x); setErr(null); setNotes(n => n && notesDirty ? n : (x.notes ?? '')); })
      .catch(e => setErr(errText(e, 'Could not load this case.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, rp, disputeId]);
  useEffect(() => { load(); }, [load]);

  const refresh = (text?: string) => { load(); if (text) say(text); };

  /* actions */
  const resolve = async () => {
    if (!d) return; setBusy('resolve');
    try { await legalApi.resolveDispute(base, rp ?? undefined, d.id, { outcome, description: resolveNote.trim() || null }); setResolving(false); refresh(`Case closed — ${DISPUTE_OUTCOME_LABELS[outcome]}.`); }
    catch (e) { say(errText(e, 'Could not close the case.'), 'warn'); }
    finally { setBusy(null); }
  };
  const moveToEnforcement = async () => {
    if (!d) return; setBusy('enforce');
    try { await legalApi.advanceDispute(base, rp ?? undefined, d.id, { to: 'enforcement', description: 'Settlement cheque bounced — moved to enforcement' }); refresh('Case moved to “Enforcing decision”.'); }
    catch (e) { say(errText(e, 'Could not move the case.'), 'warn'); }
    finally { setBusy(null); }
  };
  const uploadProof = async (f: File) => {
    if (!d) return; setBusy('proof');
    try {
      const id = await uploadDisputeFile(d.id, f, `Notice proof · ${d.noticeTypeLabel}`);
      if (!id) throw new Error('upload');
      await legalApi.updateDispute(base, rp ?? undefined, d.id, { noticeProofDocumentId: id });
      refresh('Notice proof filed on the case.');
    } catch (e) { say(errText(e, 'Could not upload the proof.'), 'warn'); }
    finally { setBusy(null); }
  };
  const uploadDoc = async (f: File) => {
    if (!d) return; setBusy('doc');
    try {
      const id = await uploadDisputeFile(d.id, f, f.name.replace(/\.[a-z0-9]+$/i, ''));
      if (!id) throw new Error('upload');
      // Every upload lands on the timeline as a note carrying the document.
      await legalApi.caseEvent(base, rp ?? undefined, d.id, { type: 'note', description: `Document added: ${f.name}`, documentId: id });
      refresh('Document added to the case file.');
    } catch (e) { say(errText(e, 'Could not upload the document.'), 'warn'); }
    finally { setBusy(null); }
  };
  /** PATCH …/payments/:id with the cheque_status vocabulary (pending · cleared · bounced · cancelled). */
  const patchPayment = async (p: DisputePayment, body: { chequeStatus?: ChequeState; heldBy?: PaymentHeldBy | null; collectedByName?: string | null }, text: string) => {
    if (!d) return; setBusy(`pay-${p.id}`);
    try { await apiPatch(legalUrl(base, rp ?? undefined, `/disputes/${d.id}/payments/${p.id}`), body); refresh(text); }
    catch (e) { say(errText(e, 'Could not update the cheque.'), 'warn'); }
    finally { setBusy(null); }
  };
  const unlink = async (p: DisputePayment) => {
    if (!d) return; setBusy(`pay-${p.id}`);
    try { await legalApi.unlinkPayment(base, rp ?? undefined, d.id, p.id); refresh('Cheque unlinked from the case (it stays on the lease).'); }
    catch (e) { say(errText(e, 'Could not unlink the cheque.'), 'warn'); }
    finally { setBusy(null); }
  };
  const saveNotes = async () => {
    if (!d) return; setBusy('notes');
    try { await legalApi.updateDispute(base, rp ?? undefined, d.id, { notes: notes.trim() || null }); setNotesDirty(false); refresh('Notes saved.'); }
    catch (e) { say(errText(e, 'Could not save the notes.'), 'warn'); }
    finally { setBusy(null); }
  };

  if (err) return <div className="max-w-5xl mx-auto px-4 py-8"><div className={card + ' px-5 py-6 text-sm text-[#b42318]'}>{err} <Link href={listHref} className="underline ml-2">Back to Legal</Link></div></div>;
  if (!d) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-[#8a8f8c]"><Loader2 size={16} className="animate-spin" /> Loading case…</div>;

  const st = disputeStageTone(d.stage);
  const stageIx = DISPUTE_STAGES.indexOf(d.stage);
  const closed = d.stage === 'closed';
  const nextN = daysFromToday(d.nextDate);
  const lease = d.lease;
  const proofDoc = d.noticeProofDocument;
  const eventDateOf = new Map(d.events.filter(e => e.documentId != null).map(e => [e.documentId as number, e.date] as const));
  const eventTypeOf = new Map(d.events.filter(e => e.documentId != null).map(e => [e.documentId as number, e.type] as const));
  // PRIMARY = the case's own formal papers: the notice proof and whatever sits on a formal step of
  // the timeline (notice, filed, hearing, settlement, decision, appeal, enforcement). They stay in view.
  // SUPPORTING papers (registration certificate, licence, bank transfers…) stay in view under them —
  // they are evidence too. Only the long run of emails and notes on the timeline folds away, so the
  // papers the case turns on are never lost among thirty.
  const byEventDate = (x: LegalDoc, y: LegalDoc) => (eventDateOf.get(x.id) ?? '').localeCompare(eventDateOf.get(y.id) ?? '') || x.id - y.id;
  const isProof = (x: LegalDoc) => x.id === d.noticeProofDocumentId;
  const isFormal = (x: LegalDoc) => eventTypeOf.has(x.id) && eventTypeOf.get(x.id) !== 'note';
  const onDate = (x: LegalDoc) => (eventDateOf.get(x.id) ? fmtD(eventDateOf.get(x.id)!) : `added ${fmtD(x.createdAt)}`);
  const docGroups = [
    { title: 'Primary documents', primary: true, docs: [...d.documents.filter(isProof), ...d.documents.filter(x => !isProof(x) && isFormal(x)).sort(byEventDate)],
      meta: (x: LegalDoc) => `${onDate(x)}${isProof(x) ? ' · notice proof' : ''}` },
    { title: 'Emails & messages on the timeline', primary: false, docs: d.documents.filter(x => !isProof(x) && eventDateOf.has(x.id) && !isFormal(x)).sort(byEventDate), meta: onDate },
    // By name, numbers in order (…AED 51,715 before …51,716). No date line: the day a paper was ADDED says nothing
    // about the paper — where its own date matters it is in the label.
    { title: 'Supporting papers', primary: true, docs: d.documents.filter(x => !isProof(x) && !eventDateOf.has(x.id)).sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' })), meta: () => '' },
  ].filter(g => g.docs.length > 0);

  // ONE gallery for the case — the portal's shared reader (list on the left, big preview, next / previous),
  // opened wide, with Download and Print: a case file is the landlord's own working file.
  const kycName = (x: { key: string; name: string }) => (x.key.startsWith('emirates_id') && !/emirates/i.test(x.name) ? `Emirates ID — ${x.name}` : x.name);
  const gallerySlots: ReaderSlot[] = [
    ...(d.breach?.documents ?? []).map(x => ({ key: `doc-${x.id}`, label: x.name, group: `From breach #${d.breach!.id}`, note: fmtD(x.createdAt), files: [{ id: x.id, name: x.name, url: '', mimeType: x.mimeType }] })),
    ...docGroups.flatMap(g => g.docs.map(x => ({ key: `doc-${x.id}`, label: x.name, group: g.title, note: g.meta(x) || null, files: [{ id: x.id, name: x.name, url: '', mimeType: x.mimeType }] }))),
    ...(d.customerDocuments ?? []).map(x => ({ key: `doc-${x.id}`, label: kycName(x), group: 'Customer KYC', note: x.expired ? `expired ${fmtD(x.expiryDate!)}` : x.expiryDate ? `valid to ${fmtD(x.expiryDate)}` : 'no expiry date on file', files: [{ id: x.id, name: kycName(x), url: '', mimeType: x.mimeType }] })),
  ];
  const openGalleryAt = (docId: number) => (gallerySlots.some(sl => sl.key === `doc-${docId}`) ? setGallery({ initialKey: `doc-${docId}` }) : void openDocViewerByIds([{ id: docId }]));
  const isLandlord = d.filedBy === 'landlord';
  const appealN = daysFromToday(d.appealDeadline);

  const EventRow = ({ e, tone }: { e: CaseEvent; tone?: { bg: string; fg: string } }) => (
    <div className="flex gap-3 py-2.5 border-b border-[#f1f3f1] last:border-0">
      <div className="w-[76px] shrink-0 text-[11px] text-[#8a8f8c] pt-[3px]">{fmtD(e.date)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={pillCls} style={tone ? { background: tone.bg, color: tone.fg } : { background: '#f1f3f1', color: '#5b615e' }}>{CASE_EVENT_TYPE_LABELS[e.type] ?? e.type}</span>
          {e.amount != null && <span className="text-[11.5px] font-semibold">{money(e.amount)}</span>}
        </div>
        {e.description && <p className="text-[12px] mt-1 whitespace-pre-wrap">{e.description}</p>}
        {e.document && <div className="mt-1"><DocLink d={e.document} /></div>}
      </div>
    </div>
  );
  const eventTone = (t: CaseEventType) => t === 'resolved' ? { bg: '#e7f4ee', fg: '#1a7a52' } : t === 'decision' || t === 'filed' ? { bg: '#e0f2fe', fg: '#0369a1' } : t === 'appeal' || t === 'enforcement_action' ? { bg: '#fdecea', fg: '#b42318' } : t === 'settlement_agreed' ? { bg: '#ece9fd', fg: '#5b3fbf' } : t === 'notice' || t === 'hearing' ? { bg: '#fdf3e3', fg: '#c47a00' } : undefined;

  return (
    <OpenDocCtx.Provider value={openGalleryAt}>
    <div className="max-w-6xl mx-auto px-4 py-6 text-[#1c1f1d]">
      {advanceTo && <AdvanceModal base={base} rp={rp} d={d} to={advanceTo} onClose={() => setAdvanceTo(null)} onDone={t => { setAdvanceTo(null); refresh(t); }} />}
      {eventOpen && <EventModal base={base} rp={rp} d={d} onClose={() => setEventOpen(false)} onDone={t => { setEventOpen(false); refresh(t); }} />}
      {chequeOpen && <ChequeModal base={base} rp={rp} d={d} onClose={() => setChequeOpen(false)} onDone={t => { setChequeOpen(false); refresh(t); }} />}

      {/* ── header ── */}
      <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-[#8a8f8c]"><Link href={listHref} className="hover:underline">Legal</Link> › Case #{d.id}</p>
            <div className="flex items-center gap-2.5 flex-wrap mt-0.5">
              <h1 className="text-[19px] font-bold tracking-[-.01em] leading-tight">{d.typeLabel} · Unit {lease?.unitNumber ?? '—'}</h1>
              <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-full" style={{ background: st.bg, color: st.fg }}>{d.stageLabel}</span>
              <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#f1f3f1] text-[#5b615e]">{d.filedByLabel}</span>
              {d.automationFrozen && <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#ece9fd] text-[#5b3fbf]" title="Renewal reminders and new scheduled payments are paused while the case is at the authority">Lease automation paused</span>}
              {closed && d.outcomeLabel && <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#e7f4ee] text-[#1a7a52]">{d.outcomeLabel}</span>}
            </div>
            <p className="text-[12px] text-[#5b615e] mt-1">
              {lease?.customerName ?? '—'} · {lease?.buildingName ?? ''}
              {lease && <> · {leaseHrefOf ? <Link href={leaseHrefOf(lease.id)} className="text-[#1a7a52] hover:text-[#125a3c] underline">Lease CID-{lease.id}</Link> : `Lease CID-${lease.id}`} ({fmtD(lease.startDate)} → {fmtD(lease.endDate)})</>}
              {d.breachReasonLabels.length > 0 && <> · {d.breachReasonLabels.join(', ')}</>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {d.bouncedSettlementOffer === 'enforcement' && (
              <button type="button" disabled={busy === 'enforce'} onClick={() => void moveToEnforcement()} className={btn + ' text-[#b42318] border-[#f1c8c4] hover:bg-[#fff8f7]'}>{busy === 'enforce' ? 'Moving…' : 'Move to enforcement'}</button>
            )}
            {d.actions.resolve && <button type="button" onClick={() => setResolving(o => !o)} className={btn}>Mark as resolved</button>}
            {d.actions.nextStages.map(s => (
              <button key={s} type="button" onClick={() => setAdvanceTo(s)} className={btnPrimary} title={`Move the case to “${DISPUTE_STAGE_LABELS[s]}”`}>{DISPUTE_STAGE_LABELS[s]}</button>
            ))}
          </div>
        </div>

        {resolving && !closed && (
          <div className="mt-3 p-3 rounded-lg border border-[#cfe7db] bg-[#f4faf7]">
            <div className="text-[12px] font-bold text-[#1a7a52]">Close case #{d.id}?</div>
            <p className="text-[11.5px] text-[#5b615e] mt-0.5">The case moves to “Closed” with the outcome you pick and a “Resolved” entry on the timeline. The lease’s reminders and payment schedule resume.</p>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <select value={outcome} onChange={e => setOutcome(e.target.value as DisputeOutcome)} className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52]">
                {(Object.keys(DISPUTE_OUTCOME_LABELS) as DisputeOutcome[]).map(o => <option key={o} value={o}>{DISPUTE_OUTCOME_LABELS[o]}</option>)}
              </select>
              <input value={resolveNote} onChange={e => setResolveNote(e.target.value)} placeholder="How it was resolved (optional)" className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52] flex-1 min-w-[220px]" />
              <button type="button" disabled={busy === 'resolve'} onClick={() => void resolve()} className={btnFill}>{busy === 'resolve' ? 'Closing…' : 'Yes, close the case'}</button>
              <button type="button" onClick={() => setResolving(false)} className="text-[11px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Keep it open</button>
            </div>
          </div>
        )}

        {/* six-stage progress bar */}
        <div className="relative grid gap-1 mt-5" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          <div className="absolute top-[9px] h-[2px] bg-[#eef0ee]" style={{ left: `${(0.5 / 6) * 100}%`, right: `${(0.5 / 6) * 100}%` }} />
          {stageIx > 0 && <div className="absolute top-[9px] h-[2px]" style={{ background: st.fg, left: `${(0.5 / 6) * 100}%`, width: `${(stageIx / 6) * 100}%` }} />}
          {DISPUTE_STAGES.map((s, i) => {
            const done = i < stageIx || closed; const cur = i === stageIx; const t = disputeStageTone(s);
            return (
              <div key={s} className="text-center relative min-w-0" title={DISPUTE_STAGE_LABELS[s]}>
                <div className="w-5 h-5 rounded-full mx-auto grid place-items-center text-[10px] font-extrabold"
                  style={cur ? { background: '#fff', border: `2px solid ${t.fg}`, color: t.fg } : done ? { background: st.fg, border: `2px solid ${st.fg}`, color: '#fff' } : { background: '#fff', border: '2px solid #d9ddda' }}>
                  {done && !cur ? '✓' : cur ? '●' : ''}
                </div>
                <div className={`text-[10.5px] mt-1.5 truncate ${cur ? 'font-bold' : done ? 'font-semibold text-[#5b615e]' : 'text-[#8a8f8c]'}`} style={cur ? { color: t.fg } : undefined}>{DISPUTE_STAGE_LABELS[s]}</div>
              </div>
            );
          })}
        </div>

        {/* the hint */}
        <div className={`mt-4 px-3 py-2 rounded-lg text-[12.5px] font-semibold ${d.alert ? 'bg-[#fdf3e3] text-[#c47a00]' : closed ? 'bg-[#f1f3f1] text-[#5b615e]' : 'bg-[#e7f4ee] text-[#1a7a52]'}`}>
          {d.hint}{d.nextDate && !closed && nextN != null && <span className="font-medium"> · {fmtD(d.nextDate)} ({nextN === 0 ? 'today' : nextN > 0 ? `in ${nextN} days` : `${-nextN} days ago`})</span>}
        </div>

        {/* fact strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 mt-[18px] border-t border-[#eef0ee] pt-3.5 gap-y-3">
          <div className="sm:pr-[18px] sm:border-r border-[#eef0ee]"><div className={lbl}>{claimLabel(d.filedBy).toUpperCase()}</div><div className="text-[13px] font-semibold mt-[3px] inline-flex items-center gap-1"><DirhamSign size={13} className="text-[#8a8f8c]" />{money(d.claimAmount)}</div></div>
          <div className="sm:px-[18px] sm:border-r border-[#eef0ee]"><div className={lbl}>LEGAL COSTS PAID</div><div className="text-[13px] font-semibold mt-[3px]">{money(d.costTotals?.paid ?? 0)}<span className="text-[11px] font-normal text-[#8a8f8c]"> · {money(d.costTotals?.expected ?? 0)} expected</span></div></div>
          <div className="sm:px-[18px] sm:border-r border-[#eef0ee]"><div className={lbl}>AUTHORITY CASE NO.</div><div className="text-[13px] font-semibold mt-[3px]">{d.authorityCaseNumber ?? '—'}{d.filingDate ? <span className="font-normal text-[#8a8f8c]"> · filed {fmtD(d.filingDate)}</span> : null}</div></div>
          <div className="sm:pl-[18px]"><div className={lbl}>CONTACT</div>{/* a representative's name and firm is often long — it wraps, it is never cut */}<div className="text-[13px] font-semibold mt-[3px] leading-snug break-words">{d.contactName ?? '—'}</div>{d.contactPhone ? <div className="text-[12px] text-[#8a8f8c] mt-0.5">{d.contactPhone}</div> : null}</div>
        </div>
        {(d.nextHearingDate || d.decisionDate) && (
          <div className="mt-2 text-[11.5px] text-[#5b615e] flex gap-4 flex-wrap">
            {d.nextHearingDate && <span>Next hearing <b>{fmtD(d.nextHearingDate)}</b></span>}
            {d.decisionDate && <span>Decision <b>{fmtD(d.decisionDate)}</b>{d.appealDeadline && <> · appeal window until <b>{fmtD(d.appealDeadline)}</b>{appealN != null && appealN >= 0 ? ` (${appealN} days left)` : ''}</>}</span>}
          </div>
        )}
        {notice && <div className={`mt-3 text-[12px] font-semibold px-3 py-2 rounded-lg ${notice.tone === 'ok' ? 'bg-[#e7f4ee] text-[#1a7a52]' : 'bg-[#fdecea] text-[#b42318]'}`}>{notice.text}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 mt-5 items-start">
        {/* ── left ── */}
        <div className="space-y-5 min-w-0">
          {/* notice */}
          <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-[14px] font-bold">Notice</h2>
              <span className="text-[11px] text-[#8a8f8c]">{isLandlord ? 'Served by you' : 'Served on you'} · {d.config.authorityDisplayName}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <div><div className={lbl}>TYPE</div><div className="text-[12.5px] font-semibold mt-[3px]">{d.noticeTypeLabel}</div></div>
              <div><div className={lbl}>SERVED</div><div className="text-[12.5px] font-semibold mt-[3px]">{fmtD(d.noticeServedDate)}</div></div>
              <div><div className={lbl}>DEADLINE</div><div className="text-[12.5px] font-semibold mt-[3px]">{fmtD(d.noticeDeadline)}</div></div>
              <div><div className={lbl}>PROOF OF SERVICE</div>
                <div className="text-[12.5px] mt-[3px]">
                  {proofDoc ? <DocLink d={proofDoc} caption="Notice proof" /> : <span className={`font-semibold ${d.noticeType === 'none' ? 'text-[#8a8f8c]' : 'text-[#c47a00]'}`}>{d.noticeType === 'none' ? 'n/a' : 'Not filed'}</span>}
                </div>
              </div>
            </div>
            {!closed && isLandlord && <NoticeServedEditor key={`${d.noticeServedDate ?? ''}|${d.noticeType}`} d={d} base={base} rp={rp ?? undefined} onSaved={() => refresh()} say={say} />}
            {d.noticeType !== 'none' && !closed && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <label className={btnSm + ' inline-block' + (busy === 'proof' ? ' opacity-50' : '')}>{busy === 'proof' ? 'Uploading…' : proofDoc ? 'Replace proof' : 'Upload proof'}
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy === 'proof'} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadProof(f); e.target.value = ''; }} />
                </label>
                {!proofDoc && isLandlord && <span className="text-[11px] text-[#8a8f8c]">Required before the case can be filed.</span>}
              </div>
            )}
          </div>

          {/* escalated from a breach: the hand-over card sits above the timeline; the breach trail is merged into it */}
          {d.breach && (
            <div className={card + ' px-4 sm:px-[22px] py-4'} style={{ borderColor: '#d9d3f7', background: '#f8f6fe' }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={pillCls} style={{ background: '#ece9fd', color: '#5b3fbf' }}>Escalated from breach #{d.breach.id}</span>
                    <span className="text-[13px] font-bold">{d.breach.categoryLabel}</span>
                    <span className="text-[11px] text-[#5b615e]">reported by {BREACH_REPORTED_BY_LABELS[d.breach.reportedBy] ?? d.breach.reportedBy} · opened {fmtD(d.breach.openedDate)}</span>
                  </div>
                  {d.breach.description && <p className="text-[12px] text-[#5b615e] mt-1 italic">{d.breach.description}</p>}
                  <div className="text-[11.5px] text-[#5b615e] mt-1.5 flex gap-4 flex-wrap">
                    {d.breach.warningSentDate && <span>Warning <b>{fmtD(d.breach.warningSentDate)}</b> → correct by <b>{fmtD(d.breach.correctionDeadline)}</b></span>}
                    {d.breach.finalWarningDate && <span>Final warning <b>{fmtD(d.breach.finalWarningDate)}</b> → by <b>{fmtD(d.breach.finalDeadline)}</b></span>}
                    <span>{d.breach.events.length} breach event{d.breach.events.length === 1 ? '' : 's'} and {d.breach.documents.length} attachment{d.breach.documents.length === 1 ? '' : 's'} carried into this case (purple rows below)</span>
                  </div>
                </div>
                {breachHrefOf && <Link href={breachHrefOf(d.breach.leaseId, d.breach.id)} className="text-[11px] font-semibold text-[#5b3fbf] underline shrink-0">Open the breach</Link>}
              </div>
            </div>
          )}

          {/* timeline — case events, plus the breach trail when the case came from one */}
          <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-[14px] font-bold">Timeline · {d.events.length + (d.breach?.events.length ?? 0)}</h2>
              {!closed && <button type="button" onClick={() => setEventOpen(true)} className={btnGreenSm}>+ Add note / event</button>}
            </div>
            <div className={'mt-2 max-h-[520px] ' + lockedList}>
              {(() => {
                const merged: Array<{ key: string; date: string; created: string; node: React.ReactNode }> = [
                  ...d.events.map(e => ({ key: `c-${e.id}`, date: e.date, created: e.createdAt, node: <EventRow key={`c-${e.id}`} e={e} tone={eventTone(e.type)} /> })),
                  ...(d.breach?.events ?? []).map(e => ({
                    key: `b-${e.id}`, date: e.date, created: e.createdAt,
                    node: (
                      <div key={`b-${e.id}`} className="flex gap-3 py-2.5 border-b border-[#f1f3f1] last:border-0" style={{ background: '#faf9fe' }}>
                        <div className="w-[76px] shrink-0 text-[11px] text-[#8a8f8c] pt-[3px]">{fmtD(e.date)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={pillCls} style={{ background: '#ece9fd', color: '#5b3fbf' }}>Breach · {BREACH_EVENT_TYPE_LABELS[e.type] ?? e.type}</span>
                          </div>
                          {e.description && <p className="text-[12px] mt-1 whitespace-pre-wrap">{e.description}</p>}
                          {e.document && <div className="mt-1"><DocLink d={e.document} /></div>}
                        </div>
                      </div>
                    ),
                  })),
                ].sort((a, b) => (b.date.localeCompare(a.date)) || (b.created ?? '').localeCompare(a.created ?? ''));
                return merged.length === 0 ? <p className="text-[12px] text-[#8a8f8c] py-3">Nothing on the timeline yet.</p> : merged.map(m => m.node);
              })()}
            </div>
          </div>

          {/* notes — under the timeline, in the wide column: the case's standing facts are read here, not squeezed into the rail */}
          <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-[14px] font-bold">Notes</h2>
              <button type="button" disabled={!notesDirty || busy === 'notes'} onClick={() => void saveNotes()} className={btnGreenSm}>{busy === 'notes' ? 'Saving…' : 'Save notes'}</button>
            </div>
            <textarea rows={14} value={notes} onChange={e => { setNotes(e.target.value); setNotesDirty(true); }} className={field + ' mt-3 text-[13px] leading-relaxed min-h-[340px] resize-y'} placeholder="Internal notes on the case…" />
          </div>

        </div>

        {/* ── right rail ── */}
        <div className="space-y-5 min-w-0">
          {/* costs (0287) — fee-book lines on the case, paid + charged to the customer */}
          <CaseCostsCard dispute={d} base={base} rp={rp ?? undefined} onChanged={setD} say={say} />

          {/* payments */}
          <div className={card + ' px-4 pt-4 pb-4'}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-bold">Payments · {d.payments.length}</h2>
              {!closed && <button type="button" onClick={() => setChequeOpen(true)} className={btnSm}>+ Cheque</button>}
            </div>
            {d.bouncedSettlementOffer === 'enforcement' && (
              <div className="mt-2 px-2.5 py-2 rounded-lg bg-[#fdecea] text-[11.5px] text-[#b42318]">
                <b>Settlement cheque bounced.</b> You can move directly to enforcement — never back to the notice.
                <div className="mt-1.5"><button type="button" disabled={busy === 'enforce'} onClick={() => void moveToEnforcement()} className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#b42318] text-white hover:bg-[#961c12] cursor-pointer disabled:opacity-50">{busy === 'enforce' ? 'Moving…' : 'Move to enforcement'}</button></div>
              </div>
            )}
            {d.payments.length === 0 ? (
              <p className="text-[11.5px] text-[#8a8f8c] mt-2">No cheques linked. Add a settlement cheque, or link one of the lease’s cheques the case is about.</p>
            ) : d.payments.map(p => {
              const t = CHEQUE_TONE[p.chequeStatus] ?? CHEQUE_TONE.pending; const b = busy === `pay-${p.id}`;
              const known = CHEQUE_STATES.includes(p.chequeStatus as ChequeState);
              return (
                <div key={p.id} className="mt-2.5 border border-[#e6e8e6] rounded-[10px] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-bold truncate">{p.description ?? p.paymentType ?? `Payment #${p.id}`}</div>
                      <div className="text-[11px] text-[#8a8f8c]">{p.chequeNumber ? `#${p.chequeNumber} · ` : ''}{fmtD(p.transactionDate)}</div>
                    </div>
                    <div className="text-[12.5px] font-bold whitespace-nowrap">{money(p.amount)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    <select value={known ? p.chequeStatus : ''} disabled={b || closed} onChange={e => void patchPayment(p, { chequeStatus: e.target.value as ChequeState }, `Cheque marked ${CHEQUE_LABEL[e.target.value].toLowerCase()}.`)}
                      className="text-[11px] font-semibold px-2 py-1.5 border rounded-md bg-white focus:outline-none" style={{ background: t.bg, color: t.fg, borderColor: t.bg }} title="Cheque status">
                      {!known && <option value="">{CHEQUE_LABEL[p.chequeStatus] ?? p.chequeStatus}</option>}
                      {CHEQUE_STATES.map(s => <option key={s} value={s}>{CHEQUE_LABEL[s]}</option>)}
                    </select>
                    <select value={p.heldBy ?? ''} disabled={b || closed} onChange={e => void patchPayment(p, { heldBy: (e.target.value || null) as PaymentHeldBy | null }, 'Cheque holder updated.')}
                      className="text-[11px] px-2 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52]" title="Held by">
                      <option value="">Held by —</option>
                      {(Object.keys(PAYMENT_HELD_BY_LABELS) as PaymentHeldBy[]).map(h => <option key={h} value={h}>{PAYMENT_HELD_BY_LABELS[h]}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <input value={collected[p.id] ?? p.collectedByName ?? ''} disabled={b || closed} placeholder="Collected by (name)"
                      onChange={e => setCollected(c => ({ ...c, [p.id]: e.target.value }))}
                      onBlur={e => { const v = e.target.value.trim(); if (v !== (p.collectedByName ?? '')) void patchPayment(p, { collectedByName: v || null }, 'Collected-by saved.'); }}
                      className="flex-1 min-w-0 text-[11px] px-2 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52]" />
                    {!closed && <button type="button" disabled={b} onClick={() => void unlink(p)} className="text-[11px] text-[#8a8f8c] hover:text-[#b42318] cursor-pointer whitespace-nowrap" title="Unlink from this case (the payment stays on the lease)">Unlink</button>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* documents */}
          <div className={card + ' px-4 pt-4 pb-4'}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-bold">Documents · {d.documents.length + (d.breach?.documents.length ?? 0)}</h2>
              {!closed && (
                <label className={btnSm + ' inline-block' + (busy === 'doc' ? ' opacity-50' : '')}>{busy === 'doc' ? 'Uploading…' : '+ Upload'}
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy === 'doc'} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadDoc(f); e.target.value = ''; }} />
                </label>
              )}
            </div>
            {d.documents.length === 0 && !(d.breach?.documents.length) ? <p className="text-[11.5px] text-[#8a8f8c] mt-2">No documents on the case yet.</p> : (
              <div className="mt-2">
                {(() => {
                  const row = (x: LegalDoc, meta: string, tint?: string) => (
                    <div key={x.id} className="py-2" style={tint ? { background: tint } : undefined}>
                      <DocLink d={x} />
                      {meta && <div className="text-[10.5px] text-[#8a8f8c] pl-[19px] mt-0.5">{meta}</div>}
                    </div>
                  );
                  const folded = [
                    ...((d.breach?.documents.length ?? 0) > 0 ? [{ title: `From breach #${d.breach!.id}`, rows: d.breach!.documents.map(x => row(x, fmtD(x.createdAt), '#faf9fe')) }] : []),
                    ...docGroups.filter(g => !g.primary).map(g => ({ title: g.title, rows: g.docs.map(x => row(x, g.meta(x))) })),
                  ];
                  return (
                    <>
                      {docGroups.filter(g => g.primary).map((g, gi) => (
                        <div key={g.title} className={gi > 0 ? 'mt-3 pt-3 border-t border-[#eef0ee]' : ''}>
                          <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-[#8a8f8c] pb-0.5">{g.title} · {g.docs.length}</div>
                          <div className={'divide-y divide-[#f1f3f1] max-h-[300px] ' + lockedList}>{g.docs.map(x => row(x, g.meta(x)))}</div>
                        </div>
                      ))}
                      {folded.map(f => {
                        const open = openDocGroup === f.title;
                        return (
                          <div key={f.title} className="mt-2 border border-[#e9ece9] rounded-lg overflow-hidden">
                            <button type="button" aria-expanded={open} onClick={() => setOpenDocGroup(open ? null : f.title)}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left cursor-pointer bg-[#fafbfa] hover:bg-[#f3f6f4]">
                              <span className="text-[11.5px] font-bold text-[#2b342e]">{f.title} <span className="font-semibold text-[#8a8f8c]">· {f.rows.length}</span></span>
                              <ChevronDown size={14} className={'shrink-0 text-[#8a8f8c] transition-transform ' + (open ? 'rotate-180' : '')} />
                            </button>
                            {open && <div className={'px-3 divide-y divide-[#f1f3f1] max-h-[300px] ' + lockedList}>{f.rows}</div>}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            )}
            <div className="mt-2.5">
              {d.documents.length + (d.breach?.documents.length ?? 0) > 1 && (
                <button type="button" onClick={() => setGallery({})} className="text-[11.5px] font-semibold text-[#1a7a52] hover:text-[#125a3c] hover:underline cursor-pointer">View all {d.documents.length + (d.breach?.documents.length ?? 0)} documents →</button>
              )}
            </div>
            <Link href={caseFileHref} className={btnGreenSm + ' mt-3 inline-flex items-center gap-1.5 no-underline'}><Printer size={12} /> Export case file</Link>
            <p className="text-[10.5px] text-[#8a8f8c] mt-1.5">Lease, registration, notice + proof, statement of account, payments, breach history and every document — as one print-ready file.</p>
          </div>

          {/* the customer's own KYC papers — read from the customer record, not copied onto the case */}
          <div className={card + ' px-4 pt-4 pb-4'}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-bold">Customer KYC documents · {(d.customerDocuments ?? []).length}</h2>
              <span className="text-[10.5px] text-[#8a8f8c]">{d.lease?.customerType === 'company' ? 'Company' : 'Individual'}</span>
            </div>
            <p className="text-[11px] text-[#5b615e] mt-0.5 truncate">{d.lease?.customerName ?? '—'}</p>
            {(d.customerDocuments ?? []).length === 0 ? <p className="text-[11.5px] text-[#8a8f8c] mt-2">No KYC documents on the customer record.</p> : (
              <div className={'mt-2 divide-y divide-[#f1f3f1] max-h-[240px] ' + lockedList}>
                {(d.customerDocuments ?? []).map(x => (
                  <div key={x.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      {/* "Front side" alone says nothing — name the paper it is a side of. */}
                      <DocLink d={x.key.startsWith('emirates_id') && !/emirates/i.test(x.name) ? { ...x, name: `Emirates ID — ${x.name}` } : x} />
                      <div className="text-[10.5px] text-[#8a8f8c]">{x.documentNumber ? `No. ${x.documentNumber} · ` : ''}{x.expiryDate ? `valid to ${fmtD(x.expiryDate)}` : 'no expiry date on file'}</div>
                    </div>
                    {x.expired && <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#fdecec', color: '#b42318' }}>expired</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2.5">
              {(d.customerDocuments ?? []).length > 1 && (
                <button type="button" onClick={() => setGallery({ initialKey: `doc-${d.customerDocuments![0].id}` })} className="text-[11.5px] font-semibold text-[#1a7a52] hover:text-[#125a3c] hover:underline cursor-pointer">View all {(d.customerDocuments ?? []).length} KYC documents →</button>
              )}
            </div>
            <p className="text-[10.5px] text-[#8a8f8c] mt-2">From the customer record — a renewed paper filed there shows here at once.</p>
          </div>

        </div>
      </div>
    </div>
    {gallery && (
      <DocumentReaderModal wide title={`Case #${d.id} · ${d.lease?.unitNumber ? `Unit ${d.lease.unitNumber} · ` : ''}documents`}
        summary={`${d.lease?.customerName ?? ''}${d.authorityCaseNumber ? ` · ${d.authorityCaseNumber}` : ''} · ${gallerySlots.length} files`}
        slots={gallerySlots} initialKey={gallery.initialKey} onClose={() => setGallery(null)}
        fileActions={{ download: true, print: true }} resolveUrl={fetchDocBlob} />
    )}
    </OpenDocCtx.Provider>
  );
}

const btnFill = 'text-[11px] font-bold px-3 py-1.5 rounded-md bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50';
