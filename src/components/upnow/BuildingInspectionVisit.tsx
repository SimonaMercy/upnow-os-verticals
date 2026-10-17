'use client';

/**
 * One building visit (0383) — phone-first. The inspector walks the building and
 * marks every item OK / Issue / N/A, writes what they found, attaches photos, and
 * submits. The landlord reviews (approve / return), assigns the inspector, and
 * raises an Issue as a maintenance job in one click.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, Camera, Check, CheckCircle2, Loader2, MessageSquare, MinusCircle, Printer, Send, Wrench, X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { PhotoLightbox, type GalleryPhoto } from '@/components/upnow/PhotoGallery';
import {
  biUrl, fmtDate, fmtDateTime, Inspector, ItemResult, listHref, STATUS_CHIP, STATUS_LABEL, Visit, VisitItem, visitHref,
} from '@/lib/buildingInspections';

const MAX_BYTES = 10 * 1024 * 1024;

const RESULTS: { key: ItemResult; label: string; Icon: React.ComponentType<{ size?: number }>; on: string }[] = [
  { key: 'ok', label: 'OK', Icon: CheckCircle2, on: 'bg-[#047246] text-white border-[#047246]' },
  { key: 'issue', label: 'Issue', Icon: AlertTriangle, on: 'bg-[#b91c1c] text-white border-[#b91c1c]' },
  { key: 'na', label: 'N/A', Icon: MinusCircle, on: 'bg-[#5f6b63] text-white border-[#5f6b63]' },
];

export function BuildingInspectionVisit({ id, manager }: { id: number; manager?: { rp: number } }) {
  const rp = manager?.rp ?? null;
  const router = useRouter();
  const u = useCallback((p: string) => biUrl(p, rp), [rp]);
  const [v, setV] = useState<Visit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ photos: GalleryPhoto[]; start: number } | null>(null);
  const [note, setNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [jobFor, setJobFor] = useState<VisitItem | null>(null);
  const [inspectors, setInspectors] = useState<Inspector[] | null>(null);
  // Rows whose note box the inspector opened by hand (an Issue always shows it).
  const [noteOpen, setNoteOpen] = useState<Set<number>>(new Set());

  // Promise chain, not await: nothing sets state synchronously inside the effect.
  const load = useCallback(() => apiGet<Visit>(u(`/visits/${id}`))
    .then((d) => { setV(d); setNote(d.overallNote ?? ''); })
    .catch((e: Error) => setErr(e.message || 'Could not load the visit.')), [u, id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (v?.canAssign && !inspectors) apiGet<Inspector[]>(u('/inspectors')).then(setInspectors).catch(() => setInspectors([])); }, [v?.canAssign, inspectors, u]);

  async function run(key: string, fn: () => Promise<unknown>, reload = true) {
    setBusy(key); setErr(null);
    try { await fn(); if (reload) await load(); }
    catch (e) { setErr((e as Error).message || 'Something went wrong.'); }
    finally { setBusy(null); }
  }

  const setResult = (it: VisitItem, result: ItemResult) => run(`r${it.id}`, async () => {
    const next = it.result === result ? null : result;
    await apiPatch(u(`/visits/${id}/items/${it.id}`), { result: next });
    setV((cur) => cur && { ...cur, items: cur.items.map((x) => (x.id === it.id ? { ...x, result: next } : x)), issuesCount: cur.items.reduce((n, x) => n + ((x.id === it.id ? next : x.result) === 'issue' ? 1 : 0), 0) });
  }, false);
  /** The quick walk-through: everything still unanswered in this area is fine. */
  const allOk = (area: string) => run(`a${area}`, async () => {
    const todo = (v?.items ?? []).filter((i) => i.area === area && i.result == null);
    for (const it of todo) await apiPatch(u(`/visits/${id}/items/${it.id}`), { result: 'ok' });
    setV((cur) => cur && { ...cur, items: cur.items.map((x) => (x.area === area && x.result == null ? { ...x, result: 'ok' } : x)) });
  }, false);
  const saveComment = (it: VisitItem, comment: string) => {
    const next = comment.trim() || null;
    if (next === (it.comment ?? null)) return;
    void run(`c${it.id}`, async () => {
      await apiPatch(u(`/visits/${id}/items/${it.id}`), { comment });
      setV((cur) => cur && { ...cur, items: cur.items.map((x) => (x.id === it.id ? { ...x, comment: next } : x)) });
    }, false);
  };

  const upload = (itemId: number | null) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []); e.target.value = '';
    if (!files.length) return;
    await run(`p${itemId ?? 'v'}`, async () => {
      for (const f of files) {
        if (f.size > MAX_BYTES) throw new Error(`${f.name}: too large — 10 MB max.`);
        const { uploadUrl, fileUrl } = await apiPost<{ uploadUrl: string; fileUrl: string }>(u(`/visits/${id}/photos/upload-url`), { mimeType: f.type, originalName: f.name });
        const put = await fetch(uploadUrl, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
        if (!put.ok) throw new Error(`${f.name}: upload failed — please try again.`);
        await apiPost(u(`/visits/${id}/photos`), { url: fileUrl, itemId });
      }
    });
  };
  const removePhoto = (photoId: number) => run(`d${photoId}`, () => apiDelete(u(`/visits/${id}/photos/${photoId}`)));

  const groups = useMemo(() => {
    const m = new Map<string, VisitItem[]>();
    for (const i of v?.items ?? []) { if (!m.has(i.area)) m.set(i.area, []); m.get(i.area)!.push(i); }
    return [...m.entries()];
  }, [v?.items]);

  if (err && !v) return <div className="max-w-3xl mx-auto px-4 py-6"><p className="text-sm text-[#b91c1c]">{err}</p></div>;
  if (!v) return <div className="max-w-3xl mx-auto px-4 py-6"><p className="text-sm text-[#8a948d] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p></div>;

  const answered = v.items.filter((i) => i.result != null).length;
  const total = v.items.length;
  const issues = v.items.filter((i) => i.result === 'issue');
  const canSubmit = v.canEdit && total > 0 && answered === total && issues.every((i) => (i.comment ?? '').trim());
  const chip = v.overdue ? STATUS_CHIP.overdue : STATUS_CHIP[v.status];
  const openGallery = (photos: { id: number; viewUrl: string; caption: string | null }[], start: number) =>
    setGallery({ photos: photos.map((p) => ({ id: p.id, url: p.viewUrl, caption: p.caption })), start });

  const submit = () => run('submit', () => apiPost(u(`/visits/${id}/submit`), { note }));
  const review = (decision: 'approve' | 'return') => {
    if (decision === 'return' && !reviewNote.trim()) { setErr('Say what needs to be done again.'); return; }
    if (decision === 'approve' && !window.confirm('Approve this inspection and close it?')) return;
    void run(decision, () => apiPost(u(`/visits/${id}/review`), { decision, note: reviewNote }));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] sm:py-8">
      <div className="flex items-center justify-between gap-2 mb-3">
        <button type="button" onClick={() => router.push(listHref(rp))} className="inline-flex items-center gap-1 text-sm text-[#8a948d] hover:text-[#14201a] cursor-pointer"><ArrowLeft size={15} /> All visits</button>
        <Link href={visitHref(v.id, rp, true)} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#4a4842] border border-[#e4e9e5] bg-white rounded-lg px-3 py-1.5 hover:border-[#c8c6be]"><Printer size={13} /> Report</Link>
      </div>

      {/* header */}
      <div className="rounded-2xl border border-[#e4e9e5] bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[#14201a] leading-tight">{v.propertyName}</h1>
            <p className="text-[12.5px] text-[#5f6b63]">{v.periodLabel} · {v.frequency === 'monthly' ? 'monthly' : 'quarterly'} walk-through · due {fmtDate(v.dueDate)}</p>
            {v.address && <p className="text-[12px] text-[#8a948d] truncate">{v.address}</p>}
          </div>
          <span className="shrink-0 text-[10.5px] font-semibold px-2 py-[3px] rounded-full" style={{ background: chip.bg, color: chip.fg }}>{v.overdue ? `Overdue · ${STATUS_LABEL[v.status]}` : STATUS_LABEL[v.status]}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
          <div className="rounded-lg bg-[#f6f8f6] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Inspector</div>
            {v.canAssign && inspectors ? (
              <select value={v.inspectorUserId ?? ''} onChange={(e) => run('assign', () => apiPatch(u(`/visits/${id}/inspector`), { inspectorUserId: e.target.value === '' ? null : Number(e.target.value) }))}
                className="mt-0.5 w-full text-[12px] bg-transparent border-b border-[#e4e9e5] focus:outline-none">
                <option value="">Not assigned</option>
                {inspectors.map((i) => <option key={i.userId} value={i.userId}>{i.name}</option>)}
              </select>
            ) : <div className="font-semibold text-[#14201a] truncate">{v.inspectorName ?? 'Not assigned'}{v.isMine ? ' (you)' : ''}</div>}
          </div>
          <div className="rounded-lg bg-[#f6f8f6] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Checked</div>
            <div className="font-semibold text-[#14201a] tabular-nums">{answered} / {total}</div>
          </div>
          <div className="rounded-lg bg-[#f6f8f6] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Issues</div>
            <div className={`font-semibold tabular-nums ${issues.length ? 'text-[#b91c1c]' : 'text-[#14201a]'}`}>{issues.length}</div>
          </div>
          <div className="rounded-lg bg-[#f6f8f6] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Photos</div>
            <div className="font-semibold text-[#14201a] tabular-nums">{v.items.reduce((n, i) => n + i.photos.length, 0) + v.photos.length}</div>
          </div>
        </div>
        {v.canEdit && total > 0 && (
          <div className="mt-3 h-1.5 rounded-full bg-[#f0eee8] overflow-hidden"><div className="h-full bg-[#047246] transition-all" style={{ width: `${Math.round((answered / total) * 100)}%` }} /></div>
        )}
        {v.status === 'returned' && v.reviewNote && (
          <div className="mt-3 rounded-lg bg-[#ffedd5] text-[#9a3412] text-[12.5px] px-3 py-2"><span className="font-semibold">Returned by the landlord:</span> {v.reviewNote}</div>
        )}
        {v.status === 'submitted' && <div className="mt-3 text-[12px] text-[#92400e]">Submitted by {v.submittedByName ?? '—'} on {fmtDateTime(v.submittedAt)} — awaiting the landlord&rsquo;s review.</div>}
        {v.status === 'approved' && <div className="mt-3 text-[12px] text-[#166534]">Submitted by {v.submittedByName ?? '—'} on {fmtDateTime(v.submittedAt)} · approved {fmtDateTime(v.reviewedAt)}{v.reviewNote ? ` — ${v.reviewNote}` : ''}</div>}
      </div>

      {err && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div>}

      {total === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-[#d9d7cf] bg-[#f6f8f6] px-5 py-6 text-center text-[12.5px] text-[#5f6b63]">
          This building has no checklist. Create one under Settings → Building inspections and reopen this visit.
        </div>
      )}

      {/* items by area — one line per item; the note box only when it is needed */}
      {groups.map(([area, items]) => {
        const done = items.filter((i) => i.result != null).length;
        return (
          <div key={area} className="mt-3 rounded-2xl border border-[#e4e9e5] bg-white overflow-hidden">
            <div className="px-4 py-2 bg-[#f6f8f6] border-b border-[#eef1ef] flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold text-[#14201a]">{area} <span className="text-[11px] font-normal text-[#8a948d] tabular-nums ml-1">{done}/{items.length}</span></span>
              {v.canEdit && done < items.length && (
                <button type="button" onClick={() => allOk(area)} disabled={busy === `a${area}`} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#047246] hover:opacity-75 disabled:opacity-50">
                  {busy === `a${area}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} All OK
                </button>
              )}
            </div>
            <ul>
              {items.map((it) => {
                const isIssue = it.result === 'issue';
                const showNote = isIssue || !!it.comment || noteOpen.has(it.id);
                const jobHref = it.maintenanceRequestId ? (rp == null ? `/rental-provider/dashboard/maintenance/${it.maintenanceRequestId}` : `/dashboard/manager/maintenance/${it.maintenanceRequestId}?rp=${rp}`) : null;
                return (
                  <li key={it.id} className={`px-4 py-2 border-b border-[#eef1ef] last:border-0 ${isIssue ? 'bg-[#fff7f7]' : ''}`}>
                    {/* phone: label on its own line, buttons under it; desktop: one line */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3">
                      <div className="min-w-0 flex-1 text-[13.5px] sm:text-[13px] text-[#14201a]">
                        {it.label}
                        {it.description && <span className="block text-[11px] text-[#8a948d]">{it.description}</span>}
                      </div>
                      {v.canEdit ? (
                        <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                          {/* note + photo live on the row as small icons; thumbnails show inline */}
                          {!showNote && (
                            <button type="button" onClick={() => setNoteOpen((st) => new Set(st).add(it.id))} aria-label="Add note" title="Add note"
                              className="h-9 w-9 sm:h-7 sm:w-7 grid place-items-center rounded-md text-[#8a948d] hover:text-[#14201a] hover:bg-[#eef1ef]"><MessageSquare size={14} /></button>
                          )}
                          <label aria-label="Add photo" title="Add photo" className="h-9 w-9 sm:h-7 sm:w-7 grid place-items-center rounded-md text-[#8a948d] hover:text-[#14201a] hover:bg-[#eef1ef] cursor-pointer">
                            {busy === `p${it.id}` ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={upload(it.id)} />
                          </label>
                          <div className="flex gap-1 ml-1">
                            {RESULTS.map((r) => (
                              <button key={r.key} type="button" onClick={() => setResult(it, r.key)} aria-pressed={it.result === r.key} aria-label={r.label} title={r.label} disabled={busy === `r${it.id}`}
                                className={`h-10 w-12 sm:h-7 sm:w-auto sm:px-2.5 rounded-md border text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-colors ${it.result === r.key ? r.on : 'bg-white border-[#e4e9e5] text-[#5f6b63] hover:bg-[#eef1ef]'}`}>
                                <r.Icon size={13} /><span className="hidden sm:inline">{r.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                          {isIssue && (jobHref ? (
                            <Link href={jobHref} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1a7a5a] hover:underline"><Wrench size={11} /> Job #{it.maintenanceRequestId}</Link>
                          ) : (
                            <button type="button" onClick={() => setJobFor(it)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-[#14201a] rounded-md px-2 py-1"><Wrench size={11} /> Raise job</button>
                          ))}
                          <ResultBadge result={it.result} />
                        </div>
                      )}
                    </div>

                    {(showNote || it.photos.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap items-start gap-2">
                        {showNote && (v.canEdit ? (
                          <textarea defaultValue={it.comment ?? ''} onBlur={(e) => saveComment(it, e.target.value)} rows={1} autoFocus={!isIssue && !it.comment}
                            placeholder={isIssue ? 'What is wrong and where — required for an issue' : 'Note'}
                            className={`flex-1 min-w-[220px] text-[12.5px] rounded-md border px-2.5 py-1.5 focus:outline-none focus:border-[#047246] ${isIssue && !(it.comment ?? '').trim() ? 'border-[#fca5a5] bg-white' : 'border-[#e4e9e5] bg-[#fcfcfa]'}`} />
                        ) : it.comment ? <p className="flex-1 min-w-[220px] text-[12.5px] text-[#4a4842] whitespace-pre-wrap">{it.comment}</p> : null)}
                        {it.photos.map((p, n) => (
                          <div key={p.id} className="relative group shrink-0">
                            <button type="button" onClick={() => openGallery(it.photos, n)} className="block w-12 h-12 rounded-md overflow-hidden border border-[#e4e9e5] bg-[#eef1ef]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.viewUrl} alt={p.caption ?? it.label} className="w-full h-full object-cover" />
                            </button>
                            {v.canEdit && <button type="button" onClick={() => removePhoto(p.id)} aria-label="Remove photo" className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-[#14201a] text-white grid place-items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><X size={10} /></button>}
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* general photos */}
      {(v.photos.length > 0 || v.canEdit) && total > 0 && (
        <div className="mt-4 rounded-2xl border border-[#e4e9e5] bg-white p-4">
          <div className="text-[13px] font-bold text-[#14201a] mb-2">General photos <span className="text-[11px] font-normal text-[#8a948d]">— entrance, facade, anything not tied to one item</span></div>
          <div className="flex flex-wrap gap-2 items-center">
            {v.photos.map((p, n) => (
              <div key={p.id} className="relative group">
                <button type="button" onClick={() => openGallery(v.photos, n)} className="block w-16 h-16 rounded-lg overflow-hidden border border-[#e4e9e5] bg-[#eef1ef]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.viewUrl} alt={p.caption ?? 'Photo'} className="w-full h-full object-cover" />
                </button>
                {v.canEdit && <button type="button" onClick={() => removePhoto(p.id)} aria-label="Remove photo" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#14201a] text-white grid place-items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><X size={11} /></button>}
              </div>
            ))}
            {v.canEdit && (
              <label className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg border border-dashed border-[#c8c6be] text-[12px] font-semibold text-[#4a4842] cursor-pointer hover:border-[#047246] hover:text-[#047246]">
                {busy === 'pv' ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Add photo
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={upload(null)} />
              </label>
            )}
          </div>
        </div>
      )}

      {/* submit */}
      {v.canEdit && total > 0 && (
        <div className="mt-4 rounded-2xl border border-[#e4e9e5] bg-white p-4">
          <div className="text-[13px] font-bold text-[#14201a]">Overall note</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything the landlord should know about this visit (optional)" className="mt-2 w-full text-[13px] rounded-lg border border-[#e4e9e5] px-3 py-2 focus:outline-none focus:border-[#047246]" />
          <div className="hidden sm:flex items-center justify-between mt-3">
            <p className="text-[12px] text-[#8a948d]">{canSubmit ? 'Every item answered — ready to submit.' : answered < total ? `${total - answered} item${total - answered === 1 ? '' : 's'} still to check.` : 'Describe each issue before submitting.'}</p>
            <button type="button" onClick={submit} disabled={!canSubmit || busy === 'submit'} className="inline-flex items-center gap-1.5 rounded-xl bg-[#047246] text-white text-sm font-semibold px-4 py-2 disabled:opacity-50">
              {busy === 'submit' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Submit for review
            </button>
          </div>
        </div>
      )}

      {/* review */}
      {v.canReview && (
        <div className="mt-4 rounded-2xl border border-[#fde68a] bg-[#fffbeb] p-4">
          <div className="text-[13px] font-bold text-[#14201a]">Review</div>
          {v.overallNote && <p className="mt-1 text-[12.5px] text-[#4a4842]"><span className="font-semibold">Inspector&rsquo;s note:</span> {v.overallNote}</p>}
          <p className="mt-1 text-[12px] text-[#5f6b63]">{issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'} highlighted above — raise each as a job, then approve or return the visit.` : 'No issues reported.'}</p>
          <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} placeholder="Note to the inspector (required when returning)" className="mt-2 w-full text-[13px] rounded-lg border border-[#e4e9e5] px-3 py-2 bg-white focus:outline-none focus:border-[#047246]" />
          <div className="flex gap-2 mt-3 justify-end">
            <button type="button" onClick={() => review('return')} disabled={!!busy} className="rounded-xl border border-[#e4e9e5] bg-white text-[#9a3412] text-sm font-semibold px-4 py-2 disabled:opacity-50">Return to inspector</button>
            <button type="button" onClick={() => review('approve')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-xl bg-[#047246] text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"><Check size={15} /> Approve</button>
          </div>
        </div>
      )}
      {v.status === 'submitted' && !v.canReview && <p className="mt-4 text-[12.5px] text-[#8a948d] text-center">The landlord reviews this visit.</p>}

      {/* phone bottom bar */}
      {v.canEdit && total > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 sm:hidden bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.08)] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
          <div className="text-[11.5px] text-[#5f6b63] mb-1.5 text-center">{answered}/{total} checked{issues.length ? ` · ${issues.length} issue${issues.length === 1 ? '' : 's'}` : ''}</div>
          <button type="button" onClick={submit} disabled={!canSubmit || busy === 'submit'} className="w-full py-3.5 rounded-xl bg-[#047246] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {busy === 'submit' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Submit for review
          </button>
        </div>
      )}

      {gallery && <PhotoLightbox photos={gallery.photos} start={gallery.start} onClose={() => setGallery(null)} />}
      {jobFor && (
        <RaiseJobModal item={jobFor} u={u} visitId={id} onClose={() => setJobFor(null)} onDone={() => { setJobFor(null); void load(); }} />
      )}
    </div>
  );
}

export function ResultBadge({ result }: { result: ItemResult | null }) {
  if (result === 'ok') return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-[3px] rounded-full bg-[#dcfce7] text-[#166534]"><CheckCircle2 size={12} /> OK</span>;
  if (result === 'issue') return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-[3px] rounded-full bg-[#fee2e2] text-[#b91c1c]"><AlertTriangle size={12} /> Issue</span>;
  if (result === 'na') return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-[3px] rounded-full bg-[#eef1ef] text-[#5f6b63]"><MinusCircle size={12} /> N/A</span>;
  return <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full bg-[#f6f8f6] text-[#8a948d] border border-[#e4e9e5]">Not checked</span>;
}

function RaiseJobModal({ item, u, visitId, onClose, onDone }: { item: VisitItem; u: (p: string) => string; visitId: number; onClose: () => void; onDone: () => void }) {
  // Leaf items grouped under their parent — a request attaches to a LEAF, never a group.
  const [cats, setCats] = useState<{ group: string; items: { id: number; name: string }[] }[]>([]);
  const [cat, setCat] = useState<number | ''>('');
  const [title, setTitle] = useState(`${item.label} — ${item.area}`);
  const [desc, setDesc] = useState(item.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ id: number; name: string; parentId: number | null }[]>(u('/maintenance-categories'))
      .then((rows) => {
        const parents = rows.filter((r) => r.parentId == null);
        const hasKids = new Set(rows.filter((r) => r.parentId != null).map((r) => r.parentId));
        const groups = parents.map((p) => ({ group: p.name, items: rows.filter((r) => r.parentId === p.id).map((r) => ({ id: r.id, name: r.name })) })).filter((g) => g.items.length);
        const loneLeaves = parents.filter((p) => !hasKids.has(p.id)).map((r) => ({ id: r.id, name: r.name }));
        setCats(loneLeaves.length ? [{ group: 'General', items: loneLeaves }, ...groups] : groups);
      })
      .catch(() => setCats([]));
  }, [u]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const go = async () => {
    if (cat === '') { setErr('Pick the trade.'); return; }
    setBusy(true); setErr(null);
    try { await apiPost(u(`/visits/${visitId}/items/${item.id}/job`), { serviceCategoryId: cat, title: title.trim(), description: desc.trim() }); onDone(); }
    catch (e) { setErr((e as Error).message || 'Could not raise the job.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 bg-[#14201a] text-white">
          <span className="text-sm font-bold inline-flex items-center gap-2"><Wrench size={14} /> Raise as maintenance job</span>
          <button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[12px] text-[#5f6b63]">A common-area job on this building, linked back to this inspection item.</p>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Trade</span>
            <select value={cat} onChange={(e) => setCat(e.target.value === '' ? '' : Number(e.target.value))} className="mt-1 w-full text-[13px] border border-[#e4e9e5] rounded-md px-2 py-1.5 bg-white">
              <option value="">Choose…</option>
              {cats.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full text-[13px] border border-[#e4e9e5] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#047246]" />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Description</span>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="mt-1 w-full text-[13px] border border-[#e4e9e5] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#047246]" />
          </label>
          {err && <p className="text-[12px] text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#e4e9e5] text-sm font-semibold px-3 py-2 text-[#5f6b63]">Cancel</button>
            <button type="button" onClick={go} disabled={busy} className="rounded-xl bg-[#14201a] text-white text-sm font-semibold px-3 py-2 disabled:opacity-60">{busy ? 'Raising…' : 'Raise job'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
