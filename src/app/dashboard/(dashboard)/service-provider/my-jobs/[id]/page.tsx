'use client';

/**
 * One job as the crew sees it: what to do, tick it off, and photograph it
 * before and after. No prices, no bills, no invoice — the landlord keeps the
 * money side on their own page (owner, 29 Sep 2026).
 */
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, MapPin, Square, CheckSquare, Receipt, Paperclip, MessageSquare, ClipboardList } from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { PhotoLightbox, MediaThumb, type GalleryPhoto } from '@/components/upnow/PhotoGallery';
import { mediaSizeError, isVideoUrl } from '@/lib/media';

interface Finding { id?: string; label: string; doneAt?: string | null }
interface Task { id: number; label: string; doneAt: string | null; findings: Finding[] }
/** `viewUrl` is the signed link the backend hands out (photosFor) — there is no `url`.
 *  `mine` = this crew put it up, so it may remove it. */
interface Photo { id: number; viewUrl: string; kind: string; caption: string | null; mine: boolean }
interface Comment { id: number; text: string; by: string | null; at: string; mine: boolean }
interface Bill {
  id: number; billDate: string | null; category: string; supplier: string | null;
  description: string | null; vatMode: string; netAed: number; vatAed: number;
  amountAed: number; billRef: string | null; fileUrl: string | null; mine: boolean;
}
interface Job {
  id: number; ref: string; title: string; description: string | null;
  stage: string; closedAt: string | null;
  category: { id: number; name: string } | null;
  where: string | null; address: string | null;
  tasks: Task[]; photos: Photo[];
  bills: Bill[]; billCategories: string[];
  comments: Comment[];
}

const MAX_BYTES = 10 * 1024 * 1024;

const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function CrewJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const base = `/maintenance/crew/jobs/${id}`;
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [bCat, setBCat] = useState('Paint & materials');
  const [bRef, setBRef] = useState('');
  const [bSupplier, setBSupplier] = useState('');
  const [bAmount, setBAmount] = useState('');
  const [bVat, setBVat] = useState<'none' | 'inclusive' | 'exclusive'>('none');
  const [bFile, setBFile] = useState<File | null>(null);
  const [gallery, setGallery] = useState<{ photos: GalleryPhoto[]; start: number } | null>(null);
  const [comment, setComment] = useState('');

  const load = useCallback(() => {
    apiGet<Job>(base).then(setJob).catch(e => setErr(e instanceof Error ? e.message : 'Could not load this job.'));
  }, [base]);
  useEffect(load, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setErr(null);
    try { const next = await fn(); if (next) setJob(next as Job); else load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'That did not work — try again.'); }
    finally { setBusy(null); }
  };

  const toggleTask = (t: Task) =>
    run(`t${t.id}`, () => apiPatch<Job>(`${base}/tasks/${t.id}`, { done: !t.doneAt }));

  const toggleLine = (t: Task, f: Finding) =>
    run(`l${t.id}-${f.id}`, () => apiPatch<Job>(`${base}/tasks/${t.id}/items/${f.id}`, { done: !f.doneAt }));

  const upload = (kind: 'before' | 'after') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []); e.target.value = '';
    if (!files.length) return;
    await run(kind, async () => {
      for (const f of files) {
        const tooBig = mediaSizeError(f);
        if (tooBig) throw new Error(tooBig);
        const { uploadUrl, fileUrl } = await apiPost<{ uploadUrl: string; fileUrl: string }>(
          `${base}/photos/upload-url`, { mimeType: f.type, originalName: f.name });
        const put = await fetch(uploadUrl, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
        if (!put.ok) throw new Error(`${f.name}: upload failed — please try again.`);
        await apiPost(`${base}/photos`, { kind, url: fileUrl });
      }
      return null;
    });
  };

  if (err && !job) return <div className="max-w-3xl mx-auto px-4 py-6"><p className="text-sm text-[#b91c1c]">{err}</p></div>;
  if (!job) return <div className="max-w-3xl mx-auto px-4 py-6"><p className="text-sm text-[#9b9890]">Loading…</p></div>;

  const card = 'rounded-xl border border-[#e8e6e0] bg-white p-4 mt-4';
  const field = 'border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white';
  const shot = (k: string) => job.photos.filter(p => p.kind === k);
  const closed = !!job.closedAt;
  // A restoration's description opens with an auto-written "Tasks: …" line —
  // the task list says it better (same rule as the landlord's job page).
  const reported = (job.tasks.length ? (job.description ?? '').replace(/^Tasks:[^\n]*\n*/, '') : (job.description ?? '')).trim();

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link href="/dashboard/service-provider/my-jobs" className="text-[12px] text-[#6b6860] inline-flex items-center gap-1 hover:text-[#1a1916]">
        <ArrowLeft size={13} /> My jobs
      </Link>

      <div className="mt-2">
        <p className="text-[11px] text-[#8a8f8c]">{job.ref}</p>
        <h1 className="text-[19px] font-bold tracking-[-.01em] text-[#1a1916]">{job.title}</h1>
        <p className="text-[12px] text-[#5b615e] mt-1 flex items-center gap-1 flex-wrap">
          {job.category && <span>{job.category.name}</span>}
          {job.where && <><span>·</span><MapPin size={11} /> {job.where}</>}
        </p>
        {job.address && <p className="text-[11px] text-[#9b9890] mt-0.5">{job.address}</p>}
      </div>

      {/* What was reported — on most jobs the ONLY instruction the crew gets
          (owner, 5 Oct 2026: "descriptions should be prominent"), so it sits
          straight under the title, highlighted, in reading size. */}
      {reported && (
        <div className="mt-4 rounded-xl border border-[#f0d9a8] bg-[#fdf3dc] px-4 py-3.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-[#8a5a00] flex items-center gap-1.5">
            <ClipboardList size={12} /> What was reported
          </h2>
          <p className="text-[15px] leading-relaxed font-medium text-[#1a1916] mt-1.5 whitespace-pre-wrap">{reported}</p>
        </div>
      )}

      {err && <p className="mt-3 text-sm text-[#b91c1c]">{err}</p>}
      {closed && <p className="mt-3 text-[12px] text-[#15803d] font-semibold">This job is closed — nothing more to do.</p>}

      {job.tasks.length > 0 && (
        <div className={card}>
          <h2 className="text-[14px] font-bold text-[#1c1f1d]">What to do</h2>
          <ul className="mt-3 space-y-3">
            {job.tasks.map(t => (
              <li key={t.id}>
                <button
                  type="button" disabled={closed || !!busy} onClick={() => toggleTask(t)}
                  className="flex items-start gap-2 text-left w-full disabled:opacity-60"
                >
                  {t.doneAt ? <CheckSquare size={16} className="text-[#15803d] mt-[1px] shrink-0" />
                            : <Square size={16} className="text-[#9b9890] mt-[1px] shrink-0" />}
                  <span className={`text-sm font-semibold ${t.doneAt ? 'text-[#9b9890] line-through' : 'text-[#1c1f1d]'}`}>{t.label}</span>
                </button>
                {t.findings.length > 0 && (
                  <ul className="mt-1.5 ml-6 space-y-1.5">
                    {t.findings.map(f => (
                      <li key={f.id}>
                        <button
                          type="button" disabled={closed || !!busy} onClick={() => toggleLine(t, f)}
                          className="flex items-start gap-2 text-left w-full disabled:opacity-60"
                        >
                          {f.doneAt ? <CheckSquare size={13} className="text-[#15803d] mt-[2px] shrink-0" />
                                    : <Square size={13} className="text-[#9b9890] mt-[2px] shrink-0" />}
                          <span className={`text-[12.5px] ${f.doneAt ? 'text-[#9b9890] line-through' : 'text-[#3d423f]'}`}>{f.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(['before', 'after'] as const).map(kind => (
        <div key={kind} className={card}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-bold text-[#1c1f1d] capitalize">{kind} photos &amp; videos</h2>
            {!closed && (
              <label className="text-[12px] font-semibold text-[#1a7a5a] inline-flex items-center gap-1 cursor-pointer">
                <Camera size={13} /> {busy === kind ? 'Uploading…' : 'Add'}
                <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={!!busy} onChange={upload(kind)} />
              </label>
            )}
          </div>
          {shot(kind).length === 0
            ? <p className="text-[11.5px] text-[#9b9890] mt-2">None yet.</p>
            : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                {shot(kind).map((p, k) => (
                  <div key={p.id} className="relative group">
                    {/* Tap to open — the same viewer the landlord's job page uses, with the caption. */}
                    <button type="button" title={p.caption ?? (isVideoUrl(p.viewUrl) ? 'Play video' : 'View photo')} className="block w-full cursor-pointer"
                      onClick={() => setGallery({ photos: shot(kind).map(r => ({ id: r.id, url: r.viewUrl, caption: r.caption ?? `${kind === 'before' ? 'Before' : 'After'} ${isVideoUrl(r.viewUrl) ? 'video' : 'photo'}` })), start: k })}>
                      <MediaThumb url={p.viewUrl} alt={p.caption ?? `${kind} photo`} className="w-full h-20 object-cover rounded-lg border border-[#e8e6e0] hover:opacity-90" />
                    </button>
                    {!closed && p.mine && (
                      <button
                        type="button" disabled={!!busy}
                        onClick={() => run(`rm${p.id}`, () => apiDelete<Job>(`${base}/photos/${p.id}`))}
                        className="absolute top-1 right-1 text-[10px] bg-white/90 rounded px-1 py-[1px] text-[#b91c1c] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          {shot(kind).length > 0 && (
            <p className="text-[10.5px] text-[#8a8f8c] mt-1.5">
              {kind === 'before' && shot(kind).some(r => r.caption?.startsWith('Move-out')) ? `${shot(kind).filter(r => r.caption?.startsWith('Move-out')).length} from the move-out report · ` : ''}tap a photo to view it
            </p>
          )}
        </div>
      ))}

      {/* What the job cost — the crew keys its own in and attaches the paper.
          What becomes of that cost is the landlord's call, on their page. */}
      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-bold text-[#1c1f1d] flex items-center gap-1.5"><Receipt size={14} /> What it cost</h2>
          {!closed && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="text-[12px] font-semibold text-[#1a7a5a] cursor-pointer">Add a bill</button>
          )}
        </div>

        {job.bills.length === 0 && !adding && (
          <p className="text-[11.5px] text-[#9b9890] mt-2">Nothing recorded yet. Add what you spent — materials, a sub-contractor, a delivery.</p>
        )}

        {job.bills.length > 0 && (
          <ul className="mt-3 divide-y divide-[#f0efec]">
            {job.bills.map(b => (
              <li key={b.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[#1c1f1d]">{b.category}</p>
                  <p className="text-[11px] text-[#6b6860]">
                    {[b.supplier, b.billRef, b.billDate].filter(Boolean).join(' · ') || '—'}
                    {!b.mine && <span className="text-[#9b9890]"> · entered by your landlord</span>}
                  </p>
                  {b.fileUrl && (
                    <a href={b.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#1a7a5a] font-semibold inline-flex items-center gap-1 mt-0.5">
                      <Paperclip size={10} /> View bill
                    </a>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-bold text-[#1a1916]">AED {b.amountAed.toLocaleString('en-AE')}</p>
                  {b.mine && !closed && (
                    <div className="flex items-center gap-2 justify-end mt-0.5">
                      <label className="text-[10.5px] text-[#1a7a5a] font-semibold cursor-pointer">
                        {b.fileUrl ? 'Replace' : 'Attach'}
                        <input type="file" accept="image/*,application/pdf" className="hidden" disabled={!!busy}
                          onChange={async e => {
                            const f = e.target.files?.[0]; e.target.value = '';
                            if (!f) return;
                            await run(`bf${b.id}`, async () => {
                              if (f.size > MAX_BYTES) throw new Error(`${f.name}: too large — 10 MB max.`);
                              const { uploadUrl, fileUrl } = await apiPost<{ uploadUrl: string; fileUrl: string }>(
                                `${base}/bills/upload-url`, { mimeType: f.type, originalName: f.name });
                              const put = await fetch(uploadUrl, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
                              if (!put.ok) throw new Error(`${f.name}: upload failed — please try again.`);
                              return apiPost<Job>(`${base}/bills/${b.id}/file`, { fileUrl });
                            });
                          }} />
                      </label>
                      <button type="button" disabled={!!busy} onClick={() => run(`br${b.id}`, () => apiDelete<Job>(`${base}/bills/${b.id}`))}
                        className="text-[10.5px] text-[#b91c1c] font-semibold cursor-pointer">Remove</button>
                    </div>
                  )}
                </div>
              </li>
            ))}
            <li className="pt-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9b9890]">Total</span>
              <span className="text-[14px] font-bold text-[#1a1916]">
                AED {job.bills.reduce((n, b) => n + b.amountAed, 0).toLocaleString('en-AE')}
              </span>
            </li>
          </ul>
        )}

        {adding && (
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            <select value={bCat} onChange={e => setBCat(e.target.value)} className={field}>
              {job.billCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input placeholder="Bill number" value={bRef} onChange={e => setBRef(e.target.value)} className={field} />
            <input placeholder="Who you paid" value={bSupplier} onChange={e => setBSupplier(e.target.value)} className={field} />
            <input type="number" min={0} placeholder="Amount (AED)" value={bAmount} onChange={e => setBAmount(e.target.value)} className={field} />
            <select value={bVat} onChange={e => setBVat(e.target.value as typeof bVat)} className={field}>
              <option value="none">No VAT</option>
              <option value="inclusive">Amount includes VAT</option>
              <option value="exclusive">Add 5% VAT</option>
            </select>
            <input type="file" accept="image/*,application/pdf" className="text-[11px]" onChange={e => setBFile(e.target.files?.[0] ?? null)} />
            <div className="sm:col-span-2 flex items-center gap-2">
              <button
                type="button" disabled={!!busy || !bAmount}
                onClick={() => run('bill', async () => {
                  let fileUrl: string | undefined;
                  if (bFile) {
                    if (bFile.size > MAX_BYTES) throw new Error(`${bFile.name}: too large — 10 MB max.`);
                    const pre = await apiPost<{ uploadUrl: string; fileUrl: string }>(
                      `${base}/bills/upload-url`, { mimeType: bFile.type, originalName: bFile.name });
                    const put = await fetch(pre.uploadUrl, { method: 'PUT', body: bFile, headers: { 'Content-Type': bFile.type } });
                    if (!put.ok) throw new Error(`${bFile.name}: upload failed — please try again.`);
                    fileUrl = pre.fileUrl;
                  }
                  const next = await apiPost<Job>(`${base}/bills`, {
                    category: bCat, amountAed: Number(bAmount), vatMode: bVat,
                    ...(bRef.trim() ? { billRef: bRef.trim() } : {}),
                    ...(bSupplier.trim() ? { supplier: bSupplier.trim() } : {}),
                    ...(fileUrl ? { fileUrl } : {}),
                  });
                  setAdding(false); setBRef(''); setBSupplier(''); setBAmount(''); setBFile(null);
                  return next;
                })}
                className="text-[12px] font-semibold text-white rounded-lg px-3 py-1.5"
                style={{ background: '#1a7a52' }}
              >
                {busy === 'bill' ? 'Saving…' : 'Save bill'}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-[12px] text-[#9b9890] cursor-pointer">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* A word on the job for the landlord — it shows on their job timeline. */}
      <div className={card}>
        <h2 className="text-[14px] font-bold text-[#1c1f1d] flex items-center gap-1.5"><MessageSquare size={14} /> Comments</h2>
        {job.comments.length === 0
          ? <p className="text-[11.5px] text-[#9b9890] mt-2">No comments yet.</p>
          : (
            <ul className="mt-3 space-y-2.5">
              {job.comments.map(c => (
                <li key={c.id}>
                  <p className="text-[10.5px] text-[#8a8f8c]">{c.mine ? 'You' : c.by ?? 'Your landlord'} · {fmtDt(c.at)}</p>
                  <p className="text-[13px] text-[#3d423f] whitespace-pre-wrap">{c.text}</p>
                </li>
              ))}
            </ul>
          )}
        {!closed && (
          <div className="mt-3 flex items-end gap-2">
            <textarea
              value={comment} onChange={e => setComment(e.target.value)} rows={2} maxLength={2000}
              placeholder="Write a comment for your landlord"
              className={`${field} flex-1 resize-y`}
            />
            <button
              type="button" disabled={!!busy || !comment.trim()}
              onClick={() => run('comment', async () => {
                const next = await apiPost<Job>(`${base}/comments`, { text: comment.trim() });
                setComment('');
                return next;
              })}
              className="text-[12px] font-semibold text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
              style={{ background: '#1a7a52' }}
            >
              {busy === 'comment' ? 'Posting…' : 'Post'}
            </button>
          </div>
        )}
      </div>

      {gallery && <PhotoLightbox photos={gallery.photos} start={gallery.start} onClose={() => setGallery(null)} />}
    </div>
  );
}
