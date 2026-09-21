'use client';

/**
 * One breach, on a page of its own under Breaches — the same shape as a legal case
 * (DisputeDetailView): header with the stage bar and the actions, timeline, notes,
 * documents. A breach used to open only as a card inside
 * its lease; the lease still shows it, but the work is done here.
 *
 * Actions are the breach pipeline's own: Issue warning → Issue final warning →
 * Mark as resolved, or Escalate to legal (which opens a case and leaves this page
 * read-only). The server decides which are offered (`actions`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, FileText, Copy, Check, Scale } from 'lucide-react';
import { DocumentReaderModal, type ReaderSlot } from '@/components/upnow/DocumentReaderModal';
import { openDocViewerByIds } from '@/lib/docViewer';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import {
  legalApi, daysFromToday, breachStageTone, BREACH_STAGE_LABELS, BREACH_EVENT_TYPE_LABELS, BREACH_REPORTED_BY_LABELS,
  type BreachDetail, type BreachEvent, type BreachStage, type LegalDoc, type LegalTemplate, type TemplateKind,
} from '@/lib/legal';
import { card, btn, btnPrimary, btnGreenSm, lbl, field, fieldLbl, pillCls, fmtD, todayIso, errText } from '@/components/legal/StartNoticeModal';
import { Modal, FilePick, DocLink, OpenDocCtx, lockedList } from '@/components/legal/DisputeDetailView';

const plusDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function uploadBreachFile(breachId: number, file: File, displayName: string): Promise<number | null> {
  const { id } = await uploadOwnedDocument({ ownerType: 'tenancy_breach', ownerId: breachId, category: 'legal', documentKey: `breach_${breachId}_${Date.now()}`, displayName, file });
  return id;
}

/**
 * Plain text, read as it was meant: blank lines separate blocks; a short line on its
 * own is a heading; lines that start with "-", "•" or "1." are a list. No markup is
 * stored — the description stays plain text that anyone can type.
 */
function ReadableText({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map(x => x.split('\n').map(l => l.trim()).filter(Boolean)).filter(x => x.length > 0);
  const bullet = /^(?:[-•*]|\d+[.)])\s+/;
  return (
    <div className="mt-2 space-y-3 text-[13.5px] leading-relaxed text-[#1c1f1d]">
      {blocks.map((lines, i) => {
        const items = lines.filter(l => bullet.test(l)); const rest = lines.filter(l => !bullet.test(l));
        const numbered = items.length > 0 && items.every(l => /^\d/.test(l));
        const isHeading = (l: string) => l.length <= 70 && !/[.!?]$/.test(l);
        return (
          <div key={i}>
            {rest.map((l, k) => isHeading(l)
              ? <div key={k} className="text-[11px] font-bold tracking-[0.06em] uppercase text-[#5b615e] mb-1">{l.replace(/:$/, '')}</div>
              : <p key={k} className={k > 0 ? 'mt-1.5' : ''}>{l}</p>)}
            {items.length > 0 && (numbered
              ? <ol className="list-decimal pl-5 space-y-1.5 marker:font-semibold marker:text-[#5b615e]">{items.map((l, k) => <li key={k} className="pl-1">{l.replace(bullet, '')}</li>)}</ol>
              : <ul className="list-disc pl-5 space-y-1.5 marker:text-[#1a7a52]">{items.map((l, k) => <li key={k} className="pl-1">{l.replace(bullet, '')}</li>)}</ul>)}
          </div>
        );
      })}
    </div>
  );
}

/* ── Issue warning / Issue final warning ─────────────────────────────────── */
function WarningModal({ kind, b, base, rp, onClose, onDone }: { kind: 'warning' | 'final'; b: BreachDetail; base: string; rp?: number | null; onClose: () => void; onDone: (text: string) => void }) {
  const [date, setDate] = useState(todayIso());
  // The deadline the letter gives. Until it is typed, it follows the warning date + the configured days.
  const [deadline, setDeadline] = useState(plusDays(todayIso(), b.correctionDays));
  const [deadlineTyped, setDeadlineTyped] = useState(false);
  const onDate = (v: string) => { setDate(v); if (!deadlineTyped && v) setDeadline(plusDays(v, b.correctionDays)); };
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The landlord's warning-letter templates (Templates → Breach). The portal writes the
  // letter; the landlord sends it — so the text lands in the description, with a Copy button.
  const fixedKind: TemplateKind = kind === 'warning' ? 'breach_warning' : 'breach_final_warning';
  const [tpls, setTpls] = useState<LegalTemplate[]>([]);
  const [tplId, setTplId] = useState<number | null>(null);
  const [tplSubject, setTplSubject] = useState<string | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplConfirm, setTplConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    legalApi.templates(base, rp ?? undefined).then(r => {
      if (!live) return;
      const list = (r.items ?? []).filter(t => t.group === 'breach')
        .sort((x, y) => (x.kind === fixedKind ? 0 : x.source === 'custom' ? 2 : 1) - (y.kind === fixedKind ? 0 : y.source === 'custom' ? 2 : 1) || x.sortOrder - y.sortOrder || x.id - y.id);
      setTpls(list); setTplId(list.find(t => t.kind === fixedKind)?.id ?? list[0]?.id ?? null);
    }).catch(() => { if (live) setTpls([]); });
    return () => { live = false; };
  }, [base, rp, fixedKind]);
  const applyTemplate = async (force = false) => {
    if (description.trim() && !force) { setTplConfirm(true); return; }
    setTplConfirm(false); setTplBusy(true); setErr(null);
    try { const r = await legalApi.renderTemplate(base, rp ?? undefined, tplId ?? fixedKind, { breachId: b.id, date }); setDescription(r.body); setTplSubject(r.subject); }
    catch (e) { setErr(errText(e, 'Could not fill in the template.')); }
    finally { setTplBusy(false); }
  };
  const copyLetter = async () => { try { await navigator.clipboard.writeText(`${tplSubject ? `${tplSubject}\n\n` : ''}${description}`); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } };
  const submit = async () => {
    if (!file && !description.trim()) { setErr('Attach the copy of the warning, or describe how it was given.'); return; }
    if (deadline && deadline < date) { setErr('The deadline cannot be before the warning date.'); return; }
    setBusy(true); setErr(null);
    try {
      const documentId = file ? await uploadBreachFile(b.id, file, file.name) : null;
      const body = { date, deadline: deadline || null, description: description.trim() || null, documentId };
      await (kind === 'warning' ? legalApi.breachWarning(base, rp ?? undefined, b.id, body) : legalApi.breachFinalWarning(base, rp ?? undefined, b.id, body));
      onDone(kind === 'warning' ? 'Warning issued.' : 'Final warning issued.');
    } catch (e) { setErr(errText(e, 'Could not save the warning.')); setBusy(false); }
  };
  const small = 'text-[11px] font-semibold px-2 py-1 rounded-md border border-[#d9ddda] bg-white hover:bg-[#f6f7f6] cursor-pointer inline-flex items-center gap-1 disabled:opacity-50';
  return (
    <Modal wide title={kind === 'warning' ? 'Issue warning' : 'Issue final warning'}
      onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn}>Cancel</button><button type="button" disabled={busy} onClick={() => void submit()} className={btnPrimary}>{busy ? 'Saving…' : kind === 'warning' ? 'Issue warning' : 'Issue final warning'}</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div><span className={fieldLbl}>Warning date</span><input type="date" className={field} value={date} max={todayIso()} onChange={e => onDate(e.target.value)} /></div>
        <div><span className={fieldLbl}>Deadline</span><input type="date" className={field} value={deadline} min={date} onChange={e => { setDeadline(e.target.value); setDeadlineTyped(true); }} /></div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <span className={fieldLbl + ' mb-0'}>Description</span>
          <span className="inline-flex items-center gap-1.5">
            {tpls.length > 1 && (
              <select aria-label="Template" value={tplId ?? ''} onChange={e => setTplId(Number(e.target.value) || null)} disabled={busy || tplBusy} className="text-[11px] px-2 py-1 border border-[#e6e8e6] rounded-md bg-white max-w-[190px]">
                {tpls.map(t => <option key={t.id} value={t.id}>{t.name}{t.source === 'custom' ? ' (custom)' : ''}</option>)}
              </select>
            )}
            {tplSubject && <button type="button" className={small} onClick={() => void copyLetter()}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}</button>}
            <button type="button" className={small} disabled={busy || tplBusy} onClick={() => void applyTemplate()} title="Fill in your warning-letter template for this breach"><FileText size={12} /> {tplBusy ? 'Filling in…' : 'Use template'}</button>
          </span>
        </div>
        {tplConfirm && (
          <p className="text-[11.5px] text-[#5b615e] mb-1.5 flex items-center gap-2 flex-wrap">Replace what you have written with the template text?
            <button type="button" className={small} onClick={() => void applyTemplate(true)}>Replace</button><button type="button" className={small} onClick={() => setTplConfirm(false)}>Keep mine</button></p>
        )}
        {tplSubject && <p className="text-[11.5px] text-[#5b615e] mb-1.5">Subject: <b>{tplSubject}</b></p>}
        <textarea rows={tplSubject ? 12 : 4} className={field} value={description} onChange={e => setDescription(e.target.value)} placeholder="How the warning was given, what it says…" />
      </div>
      <div><span className={fieldLbl}>Copy of the warning</span><FilePick file={file} onPick={setFile} label="Attach the letter or email (PDF or image)" /></div>
      {err && <p className="text-[12px] text-[#b42318]">{err}</p>}
    </Modal>
  );
}

function ResolveModal({ b, base, rp, onClose, onDone }: { b: BreachDetail; base: string; rp?: number | null; onClose: () => void; onDone: (text: string) => void }) {
  const [date, setDate] = useState(todayIso()); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => { setBusy(true); setErr(null); try { await legalApi.breachResolve(base, rp ?? undefined, b.id, { date, description: description.trim() || null }); onDone('Breach marked as resolved.'); } catch (e) { setErr(errText(e, 'Could not resolve the breach.')); setBusy(false); } };
  return (
    <Modal title="Mark as resolved" sub="The customer put it right. The breach closes; it stays on record." onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn}>Cancel</button><button type="button" disabled={busy} onClick={() => void submit()} className={btnPrimary}>{busy ? 'Saving…' : 'Mark as resolved'}</button></>}>
      <div><span className={fieldLbl}>Date it was put right</span><input type="date" className={field} value={date} max={todayIso()} onChange={e => setDate(e.target.value)} /></div>
      <div><span className={fieldLbl}>How it was resolved <span className="font-normal text-[#8a8f8c]">— optional</span></span><textarea rows={3} className={field} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Re-inspected — the freezer has been removed." /></div>
      {err && <p className="text-[12px] text-[#b42318]">{err}</p>}
    </Modal>
  );
}

function EscalateModal({ b, base, rp, onClose, onEscalated }: { b: BreachDetail; base: string; rp?: number | null; onClose: () => void; onEscalated: (caseId: number) => void }) {
  const leaseEnded = b.lease != null && (b.lease.status !== 'active' || b.lease.endDate < todayIso());
  const [stillOccupying, setStillOccupying] = useState(leaseEnded); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => { setBusy(true); setErr(null); try { const r = await legalApi.breachEscalate(base, rp ?? undefined, b.id, { customerStillOccupying: leaseEnded ? stillOccupying : undefined, description: description.trim() || null }); onEscalated(r.dispute.id); } catch (e) { setErr(errText(e, 'Could not escalate the breach.')); setBusy(false); } };
  return (
    <Modal title="Escalate to legal" sub={`Breach #${b.id} · ${b.categoryLabel}`} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn}>Cancel</button><button type="button" disabled={busy} onClick={() => void submit()} className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg bg-[#5b3fbf] text-white hover:bg-[#4a32a0] cursor-pointer disabled:opacity-50">{busy ? 'Opening the case…' : 'Escalate — open a legal case'}</button></>}>
      <p className="text-[12.5px] text-[#2b342e] leading-relaxed">A legal case opens on this lease and carries this breach with it — its warnings, its papers and its timeline. This breach then becomes read-only, and the lease shows on the Legal tab only.</p>
      {leaseEnded && (
        <label className="flex items-start gap-2 text-[12.5px] cursor-pointer select-none"><input type="checkbox" className="mt-0.5" checked={stillOccupying} onChange={e => setStillOccupying(e.target.checked)} /><span>The customer is still in the unit <span className="text-[#8a8f8c]">— the lease term has ended</span></span></label>
      )}
      <div><span className={fieldLbl}>Why now <span className="font-normal text-[#8a8f8c]">— optional</span></span><textarea rows={3} className={field} value={description} onChange={e => setDescription(e.target.value)} /></div>
      {err && <p className="text-[12px] text-[#b42318]">{err}</p>}
    </Modal>
  );
}

function EventModal({ b, base, rp, onClose, onDone }: { b: BreachDetail; base: string; rp?: number | null; onClose: () => void; onDone: (text: string) => void }) {
  const [type, setType] = useState<'customer_response' | 'inspection' | 'note'>('note');
  const [date, setDate] = useState(todayIso()); const [description, setDescription] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!description.trim() && !file) { setErr('Write what happened, or attach the paper.'); return; }
    setBusy(true); setErr(null);
    try { const documentId = file ? await uploadBreachFile(b.id, file, file.name) : null; await legalApi.breachEvent(base, rp ?? undefined, b.id, { type, date, description: description.trim() || null, documentId }); onDone('Added to the timeline.'); }
    catch (e) { setErr(errText(e, 'Could not add it to the timeline.')); setBusy(false); }
  };
  return (
    <Modal title="Add to the timeline" onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn}>Cancel</button><button type="button" disabled={busy} onClick={() => void submit()} className={btnPrimary}>{busy ? 'Saving…' : 'Add'}</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div><span className={fieldLbl}>What it is</span>
          <select className={field} value={type} onChange={e => setType(e.target.value as typeof type)}>
            <option value="note">Note</option><option value="inspection">Inspection</option><option value="customer_response">Customer response</option>
          </select></div>
        <div><span className={fieldLbl}>Date</span><input type="date" className={field} value={date} max={todayIso()} onChange={e => setDate(e.target.value)} /></div>
      </div>
      <div><span className={fieldLbl}>What happened</span><textarea rows={4} className={field} value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div><span className={fieldLbl}>Paper <span className="font-normal text-[#8a8f8c]">— optional</span></span><FilePick file={file} onPick={setFile} label="Attach a photo, letter or email (PDF or image)" /></div>
      {err && <p className="text-[12px] text-[#b42318]">{err}</p>}
    </Modal>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */
export function BreachDetailView({ breachId, base, rp, listHref, leaseHrefOf, caseHrefOf }: {
  breachId: number; base: string; rp?: number | null; listHref: string;
  leaseHrefOf?: (leaseId: number) => string; caseHrefOf: (caseId: number) => string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [b, setB] = useState<BreachDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [modal, setModal] = useState<'warning' | 'final' | 'resolve' | 'escalate' | 'event' | null>(null);
  const [notes, setNotes] = useState(''); const [notesDirty, setNotesDirty] = useState(false);
  const [desc, setDesc] = useState(''); const [editingDesc, setEditingDesc] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ initialKey?: string } | null>(null);
  const fetchDocBlob = useMemo(() => async (f: { id: string | number }) => { const r = await fetch(`/api/documents/${f.id}/file`, { credentials: 'include', cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); return URL.createObjectURL(await r.blob()); }, []);

  const say = (text: string, tone: 'ok' | 'warn' = 'ok') => { setNotice({ text, tone }); window.setTimeout(() => setNotice(n => (n?.text === text ? null : n)), 7000); };
  const load = useCallback(() => {
    legalApi.breach(base, rp ?? undefined, breachId).then(x => { setB(x); setNotes(x.notes ?? ''); setNotesDirty(false); setDesc(x.description ?? ''); setLoadErr(null); })
      .catch(e => setLoadErr(errText(e, 'Could not open this breach.')));
  }, [base, rp, breachId]);
  useEffect(() => { load(); }, [load]);
  // The list's quick "Escalate" lands here with ?escalate=1 — open the dialog once the breach is in.
  const wantsEscalate = !!search.get('escalate');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (wantsEscalate && b?.actions.escalate) setModal('escalate');
  }, [wantsEscalate, b?.id, b?.actions.escalate]);
  const done = (text: string) => { setModal(null); load(); say(text); };

  if (loadErr) return <div className="max-w-6xl mx-auto px-4 py-10"><p className="text-sm text-[#b42318]">{loadErr}</p><Link href={listHref} className="text-[12px] text-[#1a7a52] underline">Back to Breaches</Link></div>;
  if (!b) return <div className="max-w-6xl mx-auto px-4 py-16 flex items-center justify-center gap-2 text-sm text-[#8a8f8c]"><Loader2 size={16} className="animate-spin" /> Opening the breach…</div>;

  const lease = b.lease; const st = breachStageTone(b.stage);
  const closed = b.stage === 'resolved' || b.stage === 'escalated';
  // Four steps; the last one reads as the way THIS breach ended (or may end).
  const steps: BreachStage[] = ['reported', 'warning_sent', 'final_warning', b.stage === 'escalated' ? 'escalated' : 'resolved'];
  const stageIx = steps.indexOf(b.stage);
  const saveNotes = async () => { setBusy('notes'); try { await legalApi.updateBreach(base, rp ?? undefined, b.id, { notes: notes.trim() || null }); setNotesDirty(false); load(); say('Notes saved.'); } catch (e) { say(errText(e, 'Could not save the notes.'), 'warn'); } finally { setBusy(null); } };
  const saveDesc = async () => { setBusy('desc'); try { await legalApi.updateBreach(base, rp ?? undefined, b.id, { description: desc.trim() || null }); setEditingDesc(false); load(); say('Saved.'); } catch (e) { say(errText(e, 'Could not save.'), 'warn'); } finally { setBusy(null); } };

  // Documents: the warnings that were given stay on top; photos, inspections and replies under them.
  const eventOf = new Map(b.events.filter(e => e.documentId != null).map(e => [e.documentId as number, e] as const));
  const byDate = (x: LegalDoc, y: LegalDoc) => (eventOf.get(x.id)?.date ?? '').localeCompare(eventOf.get(y.id)?.date ?? '') || x.id - y.id;
  const isWarning = (x: LegalDoc) => { const t = eventOf.get(x.id)?.type; return t === 'warning' || t === 'final_warning'; };
  const dateOf = (x: LegalDoc) => (eventOf.get(x.id) ? `${fmtD(eventOf.get(x.id)!.date)} · ${BREACH_EVENT_TYPE_LABELS[eventOf.get(x.id)!.type] ?? ''}` : `added ${fmtD(x.createdAt)}`);
  const docGroups = [
    { title: 'Warnings given', docs: b.documents.filter(isWarning).sort(byDate) },
    { title: 'Photos, inspections & replies', docs: b.documents.filter(x => !isWarning(x)).sort(byDate) },
  ].filter(g => g.docs.length > 0);
  const gallerySlots: ReaderSlot[] = [
    ...docGroups.flatMap(g => g.docs.map(x => ({ key: `doc-${x.id}`, label: x.name, group: g.title, note: dateOf(x), files: [{ id: x.id, name: x.name, url: '', mimeType: x.mimeType }] }))),
  ];
  const openGalleryAt = (docId: number) => (gallerySlots.some(sl => sl.key === `doc-${docId}`) ? setGallery({ initialKey: `doc-${docId}` }) : void openDocViewerByIds([{ id: docId }]));
  const eventTone = (t: BreachEvent['type']) => t === 'resolved' ? { bg: '#e6f4ef', fg: '#1a7a5a' } : t === 'escalated' ? { bg: '#ece9fd', fg: '#5b3fbf' } : t === 'final_warning' ? { bg: '#fde2e1', fg: '#a32d2d' } : t === 'warning' ? { bg: '#fdecd2', fg: '#8a4b00' } : t === 'reported' ? { bg: '#fff4e0', fg: '#9a5b00' } : undefined;
  const timeline = [...b.events].sort((x, y) => y.date.localeCompare(x.date) || y.id - x.id);

  return (
    <OpenDocCtx.Provider value={openGalleryAt}>
    <div className="max-w-6xl mx-auto px-4 py-6 text-[#1c1f1d]">
      {(modal === 'warning' || modal === 'final') && <WarningModal kind={modal} b={b} base={base} rp={rp} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'resolve' && <ResolveModal b={b} base={base} rp={rp} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'escalate' && <EscalateModal b={b} base={base} rp={rp} onClose={() => setModal(null)} onEscalated={id => router.push(caseHrefOf(id))} />}
      {modal === 'event' && <EventModal b={b} base={base} rp={rp} onClose={() => setModal(null)} onDone={done} />}
      {notice && <div className={`fixed top-4 right-4 z-[60] px-4 py-2.5 rounded-lg text-[12.5px] font-semibold shadow-lg ${notice.tone === 'ok' ? 'bg-[#1a7a52] text-white' : 'bg-[#b42318] text-white'}`}>{notice.text}</div>}

      {/* ── header ── */}
      <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-[#8a8f8c]"><Link href={listHref} className="hover:underline">Breaches</Link> › Breach #{b.id}</p>
            <div className="flex items-center gap-2.5 flex-wrap mt-0.5">
              <h1 className="text-[19px] font-bold tracking-[-.01em] leading-tight">{b.categoryLabel} · Unit {lease?.unitNumber ?? '—'}</h1>
              <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-full" style={{ background: st.bg, color: st.fg }}>{b.stageLabel}</span>
              <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#f1f3f1] text-[#5b615e]">Reported by {BREACH_REPORTED_BY_LABELS[b.reportedBy]?.toLowerCase() ?? b.reportedBy}</span>
              {b.disputeId != null && <Link href={caseHrefOf(b.disputeId)} className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#ece9fd] text-[#5b3fbf] no-underline inline-flex items-center gap-1"><Scale size={11} /> Legal case #{b.disputeId}</Link>}
            </div>
            <p className="text-[12px] text-[#5b615e] mt-1">
              {lease?.customerName ?? '—'} · {lease?.buildingName?.trim() ?? ''}
              {lease && <> · {leaseHrefOf ? <Link href={leaseHrefOf(lease.id)} className="text-[#1a7a52] hover:text-[#125a3c] underline">Lease CID-{lease.id}</Link> : `Lease CID-${lease.id}`} ({fmtD(lease.startDate)} → {fmtD(lease.endDate)})</>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {b.actions.resolve && <button type="button" onClick={() => setModal('resolve')} className={btn}>Mark as resolved</button>}
            {b.actions.escalate && <button type="button" onClick={() => setModal('escalate')} className={btn + ' text-[#5b3fbf] border-[#d9d2f7] hover:bg-[#f6f4fe]'}>Escalate to legal</button>}
            {b.actions.issueWarning && <button type="button" onClick={() => setModal('warning')} className={btnPrimary}>Issue warning</button>}
            {b.actions.issueFinalWarning && <button type="button" onClick={() => setModal('final')} className={btnPrimary}>Issue final warning</button>}
          </div>
        </div>

        {/* four-step progress bar */}
        <div className="relative grid gap-1 mt-5" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <div className="absolute top-[9px] h-[2px] bg-[#eef0ee]" style={{ left: '12.5%', right: '12.5%' }} />
          {stageIx > 0 && <div className="absolute top-[9px] h-[2px]" style={{ background: st.fg, left: '12.5%', width: `${(stageIx / 4) * 100}%` }} />}
          {steps.map((s, i) => {
            const isDone = i < stageIx || (closed && i === stageIx); const cur = i === stageIx && !closed; const t = breachStageTone(s);
            const label = i === 3 && !closed ? 'Resolved · or escalated' : BREACH_STAGE_LABELS[s];
            return (
              <div key={s} className="text-center relative min-w-0" title={label}>
                <div className="w-5 h-5 rounded-full mx-auto grid place-items-center text-[10px] font-extrabold"
                  style={cur ? { background: '#fff', border: `2px solid ${t.fg}`, color: t.fg } : isDone ? { background: st.fg, border: `2px solid ${st.fg}`, color: '#fff' } : { background: '#fff', border: '2px solid #d9ddda' }}>
                  {isDone ? '✓' : cur ? '●' : ''}
                </div>
                <div className={`text-[10.5px] mt-1.5 truncate ${cur ? 'font-bold' : isDone ? 'font-semibold text-[#5b615e]' : 'text-[#8a8f8c]'}`} style={cur ? { color: t.fg } : undefined}>{label}</div>
              </div>
            );
          })}
        </div>

        {/* the hint */}
        <div className={`mt-4 px-3 py-2 rounded-lg text-[12.5px] font-semibold ${b.alert ? 'bg-[#fdf3e3] text-[#c47a00]' : closed ? 'bg-[#f1f3f1] text-[#5b615e]' : 'bg-[#e7f4ee] text-[#1a7a52]'}`}>
          {b.alert?.text ?? b.hint}
        </div>

        {/* fact strip — four plain dates */}
        {(() => {
          const deadline = b.stage === 'final_warning' ? b.finalDeadline : b.stage === 'warning_sent' ? b.correctionDeadline : null;
          const passed = (daysFromToday(deadline) ?? 0) < 0;
          const tile = 'sm:px-[18px] sm:border-r border-[#eef0ee] first:sm:pl-0 last:sm:border-r-0 last:sm:pr-0';
          const val = 'text-[13px] font-semibold mt-[3px]';
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 mt-[18px] border-t border-[#eef0ee] pt-3.5 gap-y-3">
              <div className={tile}><div className={lbl}>FOUND</div><div className={val}>{fmtD(b.openedDate)}</div></div>
              <div className={tile}><div className={lbl}>WARNING</div><div className={val}>{b.warningSentDate ? fmtD(b.warningSentDate) : '—'}</div></div>
              <div className={tile}><div className={lbl}>FINAL WARNING</div><div className={val}>{b.finalWarningDate ? fmtD(b.finalWarningDate) : '—'}</div></div>
              <div className={tile}><div className={lbl}>{b.stage === 'resolved' ? 'RESOLVED' : 'DEADLINE'}</div>
                <div className={val} style={passed && !closed ? { color: '#b42318' } : undefined}>{b.stage === 'resolved' ? fmtD(b.resolvedDate) : deadline ? fmtD(deadline) : '—'}</div></div>
            </div>
          );
        })()}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 mt-5 items-start">
        {/* ── main column ── */}
        <div className="space-y-5 min-w-0">
          <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[14px] font-bold">What was found</h2>
              {!closed && !editingDesc && <button type="button" onClick={() => setEditingDesc(true)} className="text-[11.5px] font-semibold text-[#1a7a52] hover:underline cursor-pointer">Edit</button>}
            </div>
            {editingDesc ? (
              <><textarea rows={9} className={field + ' mt-2 text-[13px] leading-relaxed'} value={desc} onChange={e => setDesc(e.target.value)} />
                <p className="text-[10.5px] text-[#8a8f8c] mt-1">Leave an empty line between parts. A short line on its own reads as a heading; start a line with “-” or “1.” for a list.</p>
                <div className="flex justify-end gap-2 mt-2"><button type="button" className={btn} onClick={() => { setDesc(b.description ?? ''); setEditingDesc(false); }}>Cancel</button><button type="button" disabled={busy === 'desc'} className={btnPrimary} onClick={() => void saveDesc()}>{busy === 'desc' ? 'Saving…' : 'Save'}</button></div></>
            ) : b.description ? <ReadableText text={b.description} /> : <p className="text-[13px] text-[#8a8f8c] mt-2">Nothing written.</p>}
          </div>

          <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-[14px] font-bold">Timeline · {timeline.length}</h2>
              {!closed && <button type="button" onClick={() => setModal('event')} className={btnGreenSm}>+ Add note / event</button>}
            </div>
            <div className={'mt-2 max-h-[520px] ' + lockedList}>
              {timeline.map(e => { const tone = eventTone(e.type); return (
                <div key={e.id} className="flex gap-3 py-2.5 border-b border-[#f1f3f1] last:border-0">
                  <div className="w-[76px] shrink-0 text-[11px] text-[#8a8f8c] pt-[3px]">{fmtD(e.date)}</div>
                  <div className="min-w-0 flex-1">
                    <span className={pillCls} style={tone ? { background: tone.bg, color: tone.fg } : { background: '#f1f3f1', color: '#5b615e' }}>{BREACH_EVENT_TYPE_LABELS[e.type] ?? e.type}</span>
                    {/* The "Reported" entry carries the same words as "What was found" above — say it once. */}
                    {e.type === 'reported'
                      ? <p className="text-[12px] mt-1 text-[#5b615e]">Breach reported — what was found is above.</p>
                      : e.description && <p className="text-[12px] mt-1 whitespace-pre-wrap">{e.description}</p>}
                    {e.document && <div className="mt-1"><DocLink d={e.document} /></div>}
                  </div>
                </div>
              ); })}
            </div>
          </div>

          <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-[14px] font-bold">Notes</h2>
              <button type="button" disabled={!notesDirty || busy === 'notes'} onClick={() => void saveNotes()} className={btnGreenSm}>{busy === 'notes' ? 'Saving…' : 'Save notes'}</button>
            </div>
            <textarea rows={8} value={notes} onChange={e => { setNotes(e.target.value); setNotesDirty(true); }} className={field + ' mt-3 text-[13px] leading-relaxed min-h-[200px] resize-y'} placeholder="Internal notes on the breach…" />
          </div>
        </div>

        {/* ── right rail ── */}
        <div className="space-y-5 min-w-0">
          <div className={card + ' px-4 pt-4 pb-4'}>
            <h2 className="text-[13px] font-bold">Documents · {b.documents.length}</h2>
            {b.documents.length === 0 ? <p className="text-[11.5px] text-[#8a8f8c] mt-2">No documents yet. A warning’s copy, photos and replies attach from the buttons above and from “Add note / event”.</p> : (
              <div className="mt-2">
                {docGroups.map((g, gi) => (
                  <div key={g.title} className={gi > 0 ? 'mt-3 pt-3 border-t border-[#eef0ee]' : ''}>
                    <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-[#8a8f8c] pb-0.5">{g.title} · {g.docs.length}</div>
                    <div className={'divide-y divide-[#f1f3f1] max-h-[300px] ' + lockedList}>
                      {g.docs.map(x => <div key={x.id} className="py-2"><DocLink d={x} /><div className="text-[10.5px] text-[#8a8f8c] pl-[19px] mt-0.5">{dateOf(x)}</div></div>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {b.documents.length > 1 && <div className="mt-2.5"><button type="button" onClick={() => setGallery({})} className="text-[11.5px] font-semibold text-[#1a7a52] hover:text-[#125a3c] hover:underline cursor-pointer">View all {b.documents.length} documents →</button></div>}
          </div>

        </div>
      </div>
    </div>
    {gallery && (
      <DocumentReaderModal wide title={`Breach #${b.id} · ${lease?.unitNumber ? `Unit ${lease.unitNumber} · ` : ''}documents`} summary={`${lease?.customerName ?? ''} · ${gallerySlots.length} ${gallerySlots.length === 1 ? 'file' : 'files'}`}
        slots={gallerySlots} initialKey={gallery.initialKey} onClose={() => setGallery(null)} fileActions={{ download: true, print: true }} resolveUrl={fetchDocBlob} />
    )}
    </OpenDocCtx.Provider>
  );
}
