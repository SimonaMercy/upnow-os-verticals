/**
 * Customer → Maintenance, in two shapes (owner, 31 Aug 2026):
 *   variant="raise" — My Spaces: ONLY the way in. A compact card with the
 *                     Request button + the modal; after sending, a one-line
 *                     confirmation pointing at the tracker. No list.
 *   variant="track" — My Services (all leases) and the lease record (one
 *                     lease): the list with stage, pay-to-confirm and sign-off.
 * The outcome is decided by the landlord's coverage policy the moment the
 * request is created: covered (they pay), chargeable (you pick the provider
 * and pay / approve), or not covered (book the marketplace at your own cost).
 * Stage wording is the customer's, not the board's.
 * Spec: MAINTENANCE_ROUTING_SPEC_2026-08-30 §5.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Wrench, Plus, X, CheckCircle2, Camera, ImageIcon, ShoppingBag } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { uploadMaintenancePhoto, MAX_REQUEST_PHOTOS, MAX_PHOTO_MB, MAX_VIDEO_MB } from '@/lib/maintenanceEvidence';
import { isVideoFile } from '@/lib/media';
import { APP_TIME_ZONE } from '@/lib/datetime';

interface Cat { id: number; name: string; parentId?: number | null; coverage?: string | null; note?: string | null; oneTime?: boolean }
/** One row of "who should do it" — the landlord's linked providers first
 *  (default flagged), then the open marketplace; a fixed price where the
 *  provider's catalog has one (Phase B). */
interface ProviderOpt {
  serviceProviderId: number; name: string; source: 'linked' | 'marketplace'; relationship: string | null;
  isDefault: boolean; fixedPriceAed: number | null; catalogName: string | null; rating: number | null; reviews: number;
}
interface ProviderOpts { coverage: string | null; defaultServiceProviderId: number | null; options: ProviderOpt[] }
interface MyReq {
  id: number; ref: string; title: string; stage: string; stageNote: string | null;
  coverage: string | null; contractId: number | null;
  unit: { unitNumber: string | null; unitName: string | null } | null;
  property: { buildingName: string | null } | null;
  category: Cat | null; provider: { name: string } | null;
  quote: { status: string; totalAed: number } | null;
  booking: { id: number; status: string; payer?: string; totalAed?: number | null; pricingMode?: string | null } | null;
  photoCount?: number;
  preferredAt?: string | null;
  declinedReason: string | null; createdAt: string;
}

const STAGE_WORDS: Record<string, { label: string; bg: string; fg: string }> = {
  requested:         { label: 'Requested',              bg: '#f4f3ef', fg: '#6b6860' },
  awaiting_approval: { label: 'Quote pending',          bg: '#fef3c7', fg: '#92400e' },
  in_progress:       { label: 'In progress',            bg: '#e0f2fe', fg: '#0369a1' },
  sign_off:          { label: 'Done — please confirm',  bg: '#ede9fe', fg: '#6d28d9' },
  close_out:         { label: 'Completed',              bg: '#dcfce7', fg: '#15803d' },
  closed:            { label: 'Completed',              bg: '#dcfce7', fg: '#15803d' },
  declined:          { label: 'Not covered',            bg: '#fee2e2', fg: '#b91c1c' },
  cancelled:         { label: 'Cancelled',              bg: '#f4f3ef', fg: '#9b9890' },
};
const fmt = (d: string) => new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short' });

const TRACK_HREF = '/dashboard/customer/services?tab=maintenance';

export function MaintenanceSection({ contractId, variant = 'track' }: {
  /** The lease to raise on / filter by. Absent (track only) = every lease. */
  contractId?: number;
  variant?: 'raise' | 'track';
}) {
  const [reqs, setReqs] = useState<MyReq[]>([]);
  const [sent, setSent] = useState<{ ref: string; coverage: string | null } | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [open, setOpen] = useState(false);
  const [catId, setCatId] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // Preferred visit — "as soon as possible" unless the customer names a time;
  // it becomes the provider's scheduled slot.
  const [whenMode, setWhenMode] = useState<'asap' | 'pick'>('asap');
  const [whenAt, setWhenAt] = useState('');
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderOpts | null>(null);
  const [providerId, setProviderId] = useState('');
  const [paying, setPaying] = useState<number | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (variant !== 'track') return;
    // Live work first, then completed, then cancelled / declined — newest
    // within each; a pile of old cancellations must never bury the open one.
    const rank = (r: MyReq) => (r.stage === 'closed' ? 1 : r.stage === 'cancelled' || r.stage === 'declined' ? 2 : 0);
    apiGet<MyReq[]>('/maintenance/my')
      .then(rows => setReqs((Array.isArray(rows) ? rows : [])
        .filter(r => contractId == null || r.contractId === contractId)
        .sort((a, b) => rank(a) - rank(b) || b.id - a.id)))
      .catch(() => {});
  }, [contractId, variant]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (open && contractId != null && !cats.length) apiGet<Cat[]>(`/maintenance/categories?contractId=${contractId}`).then(c => setCats(Array.isArray(c) ? c : [])).catch(() => {});
  }, [open, cats.length, contractId]);

  // Chargeable work is the customer's to place (owner, 31 Aug): load who can do
  // it the moment a chargeable item is picked, defaulting to the landlord's pick.
  const selectedCat = cats.find(c => String(c.id) === catId) ?? null;
  const chargeable = selectedCat?.coverage === 'chargeable';
  useEffect(() => {
    setProviders(null); setProviderId('');
    if (!chargeable || !catId || contractId == null) return;
    let alive = true;
    apiGet<ProviderOpts>(`/maintenance/my/providers?contractId=${contractId}&categoryId=${catId}`)
      .then(p => { if (!alive) return; setProviders(p); setProviderId(p.defaultServiceProviderId != null ? String(p.defaultServiceProviderId) : ''); })
      .catch(() => { if (alive) setProviders({ coverage: null, defaultServiceProviderId: null, options: [] }); });
    return () => { alive = false; };
  }, [chargeable, catId, contractId]);
  const chosenProvider = providers?.options.find(o => String(o.serviceProviderId) === providerId) ?? null;

  const submit = async () => {
    if (!catId || !title.trim()) { setErr('Pick a category and describe the issue.'); return; }
    if (contractId == null) { setErr('Open your space to raise a request.'); return; }
    if (whenMode === 'pick' && (!whenAt || new Date(whenAt).getTime() < Date.now())) { setErr('Pick a visit time that is still ahead of us — or choose "as soon as possible".'); return; }
    setBusy(true); setErr(null);
    try {
      const made = await apiPost<{ id: number; ref: string; coverage: string | null }>('/maintenance/my', {
        contractId, serviceCategoryId: Number(catId), title: title.trim(),
        ...(desc.trim() ? { description: desc.trim() } : {}),
        ...(whenMode === 'pick' && whenAt ? { preferredAt: new Date(whenAt).toISOString() } : {}),
        ...(chargeable && providerId ? { serviceProviderId: Number(providerId) } : {}),
      });
      // Photos ride AFTER the request exists (they need its id); a failed photo
      // never un-sends the request — it is reported and can be re-attached.
      const failed: string[] = [];
      for (const f of files) {
        try { await uploadMaintenancePhoto(made.id, f); } catch (e) { failed.push(e instanceof Error ? e.message : f.name); }
      }
      setUploadNote(failed.length ? `Request sent, but ${failed.length} file${failed.length > 1 ? 's' : ''} did not upload: ${failed.join('; ')}` : null);
      setSent({ ref: made?.ref ?? 'your request', coverage: made?.coverage ?? null });
      setOpen(false); setCatId(''); setTitle(''); setDesc(''); setProviderId(''); setFiles([]); setWhenMode('asap'); setWhenAt(''); load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send the request.'); }
    finally { setBusy(false); }
  };

  // Phase B: a chargeable job priced from the provider's catalog — the
  // customer pays to confirm (the marketplace's own pay step), which engages
  // the provider. Quote-mode jobs are paid on My Services when the quote lands.
  const prePriced = (r: MyReq) =>
    !!r.booking && r.booking.pricingMode === 'fixed' && r.booking.totalAed != null && !r.quote && r.booking.status === 'booked';
  const payNow = async (r: MyReq) => {
    if (!r.booking) return;
    setPaying(r.id); setPayErr(null);
    try { await apiPost(`/bookings/${r.booking.id}/pay`); load(); }
    catch (e) { setPayErr(e instanceof Error ? e.message : 'Payment did not go through — try again.'); }
    finally { setPaying(null); }
  };

  const confirmDone = async (id: number) => {
    setConfirming(id);
    try { await apiPost(`/maintenance/my/${id}/sign-off`); load(); } catch { /* reload shows state */ }
    finally { setConfirming(null); }
  };

  const unitLabel = (r: MyReq) =>
    [r.unit?.unitNumber ? `Unit ${r.unit.unitNumber}` : r.unit?.unitName ?? null, r.property?.buildingName ?? null].filter(Boolean).join(' · ');

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2"><Wrench size={14} /> {variant === 'track' && contractId == null ? 'Maintenance requests' : 'Maintenance'}</h2>
        {contractId != null ? (
          <button type="button" onClick={() => { setSent(null); setOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer" style={{ background: '#2e9f82' }}>
            <Plus size={13} /> Request maintenance
          </button>
        ) : (
          <Link href="/dashboard/customer/spaces" className="text-xs font-semibold text-[#1a7a5a] underline">Raise one from your space</Link>
        )}
      </div>

      {variant === 'raise' ? (
        sent ? (
          <p className="text-xs font-medium text-[#1a7a5a] bg-[#f0faf6] rounded-lg px-3 py-2 mt-3 flex items-center gap-2 flex-wrap">
            <CheckCircle2 size={13} /> Sent — {sent.ref}.{' '}
            {sent.coverage === 'covered' ? 'Covered by your landlord; their team takes it from here.'
              : sent.coverage === 'chargeable' ? 'Yours to confirm — the price or quote comes to you under My Services → Maintenance.'
              : 'Your landlord will review it.'}{' '}
            <Link href={TRACK_HREF} className="underline font-semibold">Track it under My Services → Maintenance</Link>
            {uploadNote && <span className="basis-full text-[#b45309]">{uploadNote}</span>}
          </p>
        ) : (
          <p className="text-xs text-[#9b9890] mt-3">
            Something broken or not working? Send a request — we tell you straight away whether it&apos;s your landlord&apos;s scope.
            Progress, prices and sign-off live under <Link href={TRACK_HREF} className="underline font-medium text-[#1a7a5a]">My Services → Maintenance</Link>.
          </p>
        )
      ) : reqs.length === 0 ? (
        <p className="text-xs text-[#9b9890] mt-3">{contractId != null
          ? "Something broken or not working? Send a request and your landlord's team takes it from there."
          : 'No maintenance requests yet — raise one from your space and it shows up here.'}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {reqs.map(r => {
            const fixed = prePriced(r);
            const w = fixed
              ? (r.coverage === 'chargeable'
                ? { label: 'Pay to confirm', bg: '#fef3c7', fg: '#92400e' }
                : { label: 'Awaiting landlord approval', bg: '#fef3c7', fg: '#92400e' })
              : (STAGE_WORDS[r.stage] ?? STAGE_WORDS.requested);
            return (
              <li key={r.id} className="border border-[#f0eeea] rounded-xl px-3.5 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] text-[#9b9890]">{r.ref}</span>
                  <span className="text-sm font-semibold text-[#1a1916] flex-1 min-w-0 truncate">{r.title}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: w.bg, color: w.fg }}>{w.label}</span>
                </div>
                <p className="text-[11px] text-[#6b6860] mt-1">
                  {contractId == null && unitLabel(r) ? <>{unitLabel(r)} · </> : null}
                  {r.category?.name ?? 'Maintenance'} · {fmt(r.createdAt)}
                  {r.provider ? <> · {r.provider.name}</> : null}
                  {r.coverage === 'covered' && <> · covered by your landlord</>}
                  {r.coverage === 'chargeable' && r.quote?.status === 'submitted' && <> · quote AED {r.quote.totalAed.toLocaleString('en-AE')}</>}
                  {r.booking?.totalAed != null && !r.quote && <> · fixed price AED {Number(r.booking.totalAed).toLocaleString('en-AE')}</>}
                  {(r.photoCount ?? 0) > 0 && <> · <ImageIcon size={10} className="inline -mt-0.5" /> {r.photoCount} photo{r.photoCount === 1 ? '' : 's'}</>}
                  {r.preferredAt && <> · visit {new Date(r.preferredAt).toLocaleString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
                </p>
                {fixed && r.coverage === 'chargeable' && r.booking && (
                  <div className="mt-1.5">
                    <p className="text-[11px] text-[#6b6860]">Priced from the provider's catalog — no quote needed. Nothing is charged until you pay, and the provider starts once you do.</p>
                    <button type="button" disabled={paying === r.id} onClick={() => payNow(r)}
                      className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white cursor-pointer disabled:opacity-50" style={{ background: '#0369a1' }}>
                      {paying === r.id ? 'Paying…' : `Pay AED ${Number(r.booking.totalAed).toLocaleString('en-AE')} to confirm`}
                    </button>
                    {payErr && paying === null && <p className="text-[11px] text-red-600 mt-1">{payErr}</p>}
                  </div>
                )}
                {r.stage === 'declined' && r.declinedReason && (
                  <p className="text-[11px] text-[#b91c1c] mt-1">
                    {r.declinedReason} <Link href="/services" className="underline font-medium">Browse providers</Link>
                  </p>
                )}
                {r.coverage === 'chargeable' && r.stage === 'awaiting_approval' && r.quote?.status === 'submitted' && (
                  <p className="text-[11px] text-[#92400e] mt-1">
                    A quote is waiting for you on <Link href="/dashboard/customer/services" className="underline font-medium">My Services</Link> — nothing happens until you approve it.
                  </p>
                )}
                {r.stage === 'sign_off' && (
                  <button type="button" disabled={confirming === r.id} onClick={() => confirmDone(r.id)}
                    className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
                    <CheckCircle2 size={12} /> {confirming === r.id ? 'Confirming…' : 'Confirm the work is done'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1a1916]">Request maintenance</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-[#9b9890] hover:text-[#1a1916] cursor-pointer"><X size={16} /></button>
            </div>
            <div className="space-y-3 mt-4">
              <select value={catId} onChange={e => setCatId(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]">
                <option value="">What kind of work?</option>
                {/* Grouped the way the marketplace offers services — pick the specific item. */}
                {cats.filter(g => g.parentId == null).map(g => {
                  const kids = cats.filter(c => c.parentId === g.id);
                  if (!kids.length) return null;
                  return (
                    <optgroup key={g.id} label={g.name}>
                      {kids.map(c => <option key={c.id} value={c.id}>{c.name}{c.oneTime ? ' · once per tenancy' : ''}</option>)}
                    </optgroup>
                  );
                })}
              </select>
              {/* Not in the list: the vocabulary always carries a catch-all (the
                  landlord can't hide it) — a prominent way in, not a footnote
                  (owner, 31 Aug). Anything outside the tenancy goes to the marketplace. */}
              {(() => {
                const other = cats.find(c => c.parentId != null && /^other\b/i.test(c.name));
                const picked = !!other && String(other.id) === catId;
                // Only while nothing is chosen yet (or the catch-all itself is): a
                // customer who picked "A/C system maintenance" has found what they need.
                if (catId && !picked) return null;
                return (
                  <div className="rounded-xl border border-[#e8e6e0] bg-[#fafaf8] px-3.5 py-3">
                    <p className="text-xs font-bold text-[#1a1916]">Can&apos;t find what you need?</p>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {other && (
                        <button type="button" onClick={() => setCatId(String(other.id))} disabled={busy || picked}
                          className={`text-left rounded-xl border px-3 py-2.5 cursor-pointer disabled:cursor-default transition-colors ${picked ? 'border-[#2e9f82] bg-[#d8f2e8]' : 'border-[#e8e6e0] bg-white hover:border-[#2e9f82] hover:bg-[#f0faf6]'}`}>
                          <span className="flex items-center gap-1.5 text-xs font-bold text-[#1a7a5a]">
                            {picked ? <CheckCircle2 size={13} /> : <Wrench size={13} />} Something else
                          </span>
                          <span className="block text-[11px] text-[#6b6860] mt-0.5 leading-snug">
                            {picked ? 'Selected — describe it below.' : 'Describe it — your landlord decides who does it and who pays.'}
                          </span>
                        </button>
                      )}
                      <Link href="/services"
                        className="text-left rounded-xl border border-[#e8e6e0] bg-white px-3 py-2.5 hover:border-[#0369a1] hover:bg-[#f0f7fc] transition-colors">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-[#0369a1]">
                          <ShoppingBag size={13} /> Book it yourself
                        </span>
                        <span className="block text-[11px] text-[#6b6860] mt-0.5 leading-snug">
                          Outside your tenancy — any marketplace provider, at your cost.
                        </span>
                      </Link>
                    </div>
                  </div>
                );
              })()}
              <input placeholder="Describe the issue in a few words" value={title} maxLength={255} onChange={e => setTitle(e.target.value)}
                className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
              <textarea placeholder="Any detail that helps — where, since when…" value={desc} rows={3} onChange={e => setDesc(e.target.value)}
                className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
              {/* When suits you — becomes the provider's scheduled visit. */}
              <div className="border border-[#e8e6e0] rounded-lg px-3 py-2">
                <p className="text-[11px] font-semibold text-[#6b6860]">Preferred visit</p>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-[#1a1916]">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="maint-when" checked={whenMode === 'asap'} onChange={() => setWhenMode('asap')} className="accent-[#2e9f82]" /> As soon as possible
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="maint-when" checked={whenMode === 'pick'} onChange={() => setWhenMode('pick')} className="accent-[#2e9f82]" /> Choose a time
                  </label>
                  {whenMode === 'pick' && (
                    <input type="datetime-local" value={whenAt} min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)}
                      onChange={e => setWhenAt(e.target.value)}
                      className="border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#2e9f82]" />
                  )}
                </div>
                <p className="text-[10px] text-[#9b9890] mt-1">The provider schedules the visit around this and confirms the exact slot with you.</p>
              </div>
              {/* Photos or short videos — the provider's crew is briefed with these on the job page. */}
              <div className="border border-dashed border-[#e8e6e0] rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1a7a5a] cursor-pointer">
                    <Camera size={13} /> {files.length ? 'Add more photos or videos' : 'Add photos or videos'}
                    <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={busy}
                      onChange={e => {
                        const picked = Array.from(e.target.files ?? []);
                        setFiles(prev => [...prev, ...picked].slice(0, MAX_REQUEST_PHOTOS));
                        e.target.value = '';
                      }} />
                  </label>
                  <span className="text-[11px] text-[#9b9890]">{files.length}/{MAX_REQUEST_PHOTOS} · JPG, PNG, HEIC up to {MAX_PHOTO_MB} MB · MP4, MOV up to {MAX_VIDEO_MB} MB</span>
                </div>
                {files.length > 0 && (
                  <ul className="flex gap-2 flex-wrap mt-2">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="relative">
                        {isVideoFile(f)
                          ? <video src={URL.createObjectURL(f)} muted playsInline preload="metadata" title={f.name} className="w-14 h-14 object-cover rounded-lg border border-[#e8e6e0] bg-black" />
                          : <img src={URL.createObjectURL(f)} alt={f.name} className="w-14 h-14 object-cover rounded-lg border border-[#e8e6e0]" />}
                        <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} disabled={busy}
                          className="absolute -top-1.5 -right-1.5 bg-white border border-[#e8e6e0] rounded-full p-0.5 text-[#6b6860] hover:text-[#b91c1c] cursor-pointer" aria-label={`Remove ${f.name}`}>
                          <X size={10} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {(() => {
                const sel = cats.find(c => String(c.id) === catId);
                if (!sel) return null;
                if (sel.coverage === 'covered') return (
                  <p className="text-[11px] font-medium text-[#1a7a5a] bg-[#f0faf6] rounded-lg px-3 py-2">
                    Covered by your landlord — their team will handle it.{sel.note ? ` ${sel.note}` : ''}
                  </p>
                );
                if (sel.coverage === 'chargeable') return (
                  <div className="text-[11px] font-medium text-[#0369a1] bg-[#e0f2fe] rounded-lg px-3 py-2 space-y-2">
                    <p>This one's on you — so it's yours to place. Keep your landlord's provider or pick any from the marketplace.{sel.note ? ` ${sel.note}` : ''}</p>
                    {providers == null ? (
                      <p className="text-[#6b6860]">Finding providers…</p>
                    ) : providers.options.length === 0 ? (
                      <p className="text-[#6b6860]">No provider is listed for this yet — send the request and your landlord will place it.</p>
                    ) : (
                      <select value={providerId} onChange={e => setProviderId(e.target.value)}
                        className="w-full border border-[#bae6fd] rounded-lg px-2.5 py-1.5 text-xs bg-white text-[#1a1916] focus:outline-none focus:border-[#0369a1]">
                        {providers.options.some(o => o.source === 'linked') && (
                          <optgroup label="Your landlord's providers">
                            {providers.options.filter(o => o.source === 'linked').map(o => (
                              <option key={o.serviceProviderId} value={o.serviceProviderId}>
                                {o.name}{o.isDefault ? ' · default' : ''}{o.fixedPriceAed != null ? ` · AED ${o.fixedPriceAed.toLocaleString('en-AE')} fixed` : ' · quote after a visit'}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {providers.options.some(o => o.source === 'marketplace') && (
                          <optgroup label="Marketplace">
                            {providers.options.filter(o => o.source === 'marketplace').map(o => (
                              <option key={o.serviceProviderId} value={o.serviceProviderId}>
                                {o.name}{o.rating != null ? ` · ${o.rating.toFixed(1)}★` : ''}{o.fixedPriceAed != null ? ` · AED ${o.fixedPriceAed.toLocaleString('en-AE')} fixed` : ' · quote after a visit'}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                    {chosenProvider && (
                      <p className="text-[#6b6860]">
                        {chosenProvider.fixedPriceAed != null
                          ? `Fixed price AED ${chosenProvider.fixedPriceAed.toLocaleString('en-AE')} (${chosenProvider.catalogName}) — you pay to confirm after sending; nothing is charged before that.`
                          : 'They visit and assess first — you approve their quote before any work or payment.'}
                      </p>
                    )}
                  </div>
                );
                if (sel.coverage === 'not_offered') return (
                  <div className="text-[11px] font-medium text-[#92400e] bg-[#fef3c7] rounded-lg px-3 py-2">
                    Not covered during your tenancy.{sel.note ? ` ${sel.note}` : ''}{' '}
                    <Link href="/services" className="underline font-semibold">Book it on the marketplace</Link> instead.
                  </div>
                );
                return (
                  <p className="text-[11px] font-medium text-[#6b6860] bg-[#f4f3ef] rounded-lg px-3 py-2">
                    Your landlord will review this request and decide.
                  </p>
                );
              })()}
              {err && <p className="text-xs text-red-600">{err}</p>}
              {cats.find(c => String(c.id) === catId)?.coverage === 'not_offered' ? (
                <Link href="/services"
                  className="block w-full py-2.5 rounded-xl text-sm font-semibold text-center text-white"
                  style={{ background: '#2e9f82' }}>
                  Browse the services marketplace
                </Link>
              ) : (
              <button type="button" disabled={busy} onClick={submit}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
                {busy ? (files.length ? 'Sending + uploading files…' : 'Sending…') : 'Send request'}
              </button>
              )}
              <p className="text-[11px] text-[#9b9890]">Pick the item and we'll tell you straight away whether it's your landlord's scope or a marketplace booking.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
