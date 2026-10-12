'use client';

/**
 * An OWN-TEAM maintenance job (0298), run from the request page by the landlord
 * or their property manager — the landlord's crew has no login, so nothing
 * happens on a vendor side:
 *
 *   Photos  — BEFORE and AFTER, side by side. An AFTER photo is the proof the
 *             work was done; "Mark work done" needs at least one.
 *   Bills   — every bill behind the job (materials, a sub-contractor…). Their
 *             sum is the job's cost, and what the unit's restoration history adds up.
 *   Tasks   — a restoration's task list (0301), one per main category of the
 *             move-out form; each is marked done, bills can be filed against it.
 *   Done    — closes the job (every task done); the cost lands on the property.
 *
 * Uploads are presign → PUT → persist, the same cycle as every other photo.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileText, Paperclip, Plus, Trash2, CheckCircle2, ClipboardList, Check, X } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { useBackClose } from '@/lib/useSlideOver';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { type VatMode } from '@/lib/vatSplit';
import { AmountWithVat } from './VatChoice';
import { PhotoLightbox, MediaThumb, type GalleryPhoto } from './PhotoGallery';
import { mediaSizeError, isVideoUrl } from '@/lib/media';

export interface InHousePhoto { id: number; kind?: string; caption: string | null; viewUrl: string; createdAt: string }
/** The unit's last condition — its latest move-out inspection's photos, per item. */
interface MoveOutPhotos {
  contractId: number; inspectionDate: string | null;
  items: { label: string; condition: string; photos: { photoId: string; viewUrl: string; imported: boolean }[] }[];
}
export type BillVatMode = VatMode;
export interface InHouseBill {
  id: number; billDate: string; category: string; supplier: string | null; description: string | null;
  vatMode: BillVatMode; netAed: number; vatAed: number; amountAed: number;
  billRef: string | null; fileUrl: string | null;
  taskIds?: number[];
}
/** 0301 — one task of a restoration job: a main category of the move-out form. */
export interface InHouseTask {
  id: number; key: string; label: string; doneAt: string | null;
  /** The task's sub-list: what the move-out found, Restoration List items, or typed lines — each ticked on its own. */
  findings: { id: string; label: string; condition: string; costAed: number; photoIds: string[]; source?: 'move_out' | 'list' | 'custom'; unit?: string | null; doneAt?: string | null }[];
  /** Bills for this task alone, and their total; `sharedBills` = bills combined with other tasks. */
  bills: number; billsAed: number; sharedBills?: number;
}

/** One Restoration List item — the sub-list a task is built from. */
interface ListItem { id: number; categoryKey: string; subCategory: string | null; label: string; unit: string; priceAed: number }
const chipOn = { background: '#e6f7f1', color: '#1a7a5a', borderColor: '#2e9f82' } as const;
const chipOff = { background: '#fff', color: '#6b6860', borderColor: '#e8e6e0' } as const;

/** Thumbnails shown per photo row before the "+N" tile. */
const PHOTO_ROW = 8;
const MAX_BYTES = 10 * 1024 * 1024;
/** The own team's labour — no bill behind it, only its cost (mirrors MAINT_OWN_LABOUR). */
const OWN_LABOUR = 'Labour';
const aed = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });

const card = 'bg-white border border-[#e6e8e6] rounded-[14px] p-[18px]';
const field = 'border border-[#e6e8e6] rounded-lg px-3 py-2 text-[12.5px] bg-white focus:outline-none focus:border-[#1a7a52] w-full';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer disabled:opacity-50';

export function InHouseJobPanel({ url, open, photos, bills, tasks = [], canAddTasks = false, billCategories, totalAed, vatAed, onChanged, onError, section = 'all' }: {
  /** Builds the API path for this request — `url('/photos')` → `/maintenance/requests/1/photos` (or the manager mirror with ?rp=). */
  url: (path: string) => string;
  open: boolean;
  photos: InHousePhoto[];
  bills: InHouseBill[];
  tasks?: InHouseTask[];
  /** A job on a unit can grow its task list while it is open — work is often found once it starts. */
  canAddTasks?: boolean;
  /** The fixed list a bill is filed under — from the API, so both sides agree. */
  billCategories: string[];
  totalAed: number | null;
  vatAed: number | null;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  /** The detail page puts the work in its main column and "Work finished?" in the side column. */
  section?: 'all' | 'work' | 'finish';
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const emptyBill = { billDate: '', category: '', supplier: '', description: '', amountAed: '', vatMode: 'none' as BillVatMode, billRef: '', taskIds: [] as number[] };
  const [bill, setBill] = useState(emptyBill);
  const newBillFileRef = useRef<HTMLInputElement>(null);
  const [billFile, setBillFile] = useState<File | null>(null);
  const beforeRef = useRef<HTMLInputElement>(null);
  const afterRef = useRef<HTMLInputElement>(null);
  // Attach a file to a bill already in the table — the one hidden input, aimed at a bill id.
  const billFileRef = useRef<HTMLInputElement>(null);
  const attachTo = useRef<number | null>(null);
  const [moveOut, setMoveOut] = useState<MoveOutPhotos | null>(null);
  const [picking, setPicking] = useState(false);
  const [gallery, setGallery] = useState<{ photos: GalleryPhoto[]; start: number } | null>(null);
  const [showAll, setShowAll] = useState<{ before: boolean; after: boolean }>({ before: false, after: false });
  // Add tasks (owner, 21 Sep 2026: "we can't add more task list?") — the rest of what Start restoration offers, or your own words.
  const [addingTask, setAddingTask] = useState(false);
  const [taskOptions, setTaskOptions] = useState<{ key: string; label: string; suggested: boolean; fromMoveOut: boolean; findings: { label: string; condition: string; costAed: number }[]; items: ListItem[] }[] | null>(null);
  const [pickedItems, setPickedItems] = useState<number[]>([]);
  // "+ item" on one task: the rest of its category's Restoration List items, or your own words.
  const [itemsFor, setItemsFor] = useState<number | null>(null);
  const [itemOptions, setItemOptions] = useState<ListItem[] | null>(null);
  const [itemPicks, setItemPicks] = useState<number[]>([]);
  const [customItem, setCustomItem] = useState('');
  const openAddItems = (taskId: number) => {
    setItemsFor(taskId); setItemPicks([]); setCustomItem(''); setItemOptions(null);
    apiGet<ListItem[]>(url(`/tasks/${taskId}/item-options`)).then(setItemOptions).catch(() => setItemOptions([]));
  };
  const [pickedTasks, setPickedTasks] = useState<string[]>([]);
  const [customTask, setCustomTask] = useState('');
  const openAddTask = () => {
    setAddingTask(true); setPickedTasks([]); setPickedItems([]); setCustomTask(''); setTaskOptions(null);
    apiGet<NonNullable<typeof taskOptions>>(url('/task-options')).then(setTaskOptions).catch(() => setTaskOptions([]));
  };
  const moveOutPath = url('/move-out-photos');
  const loadMoveOut = useCallback(() => {
    apiGet<MoveOutPhotos | null>(moveOutPath).then(d => setMoveOut(d && d.items?.length ? d : null)).catch(() => setMoveOut(null));
  }, [moveOutPath]);
  useEffect(() => { loadMoveOut(); }, [loadMoveOut]);
  const moveOutLeft = moveOut ? moveOut.items.reduce((n, it) => n + it.photos.filter(p => !p.imported).length, 0) : 0;

  const putFile = async (file: File, presignPath: string): Promise<string> => {
    // A before/after clip may run to 100 MB; a bill stays a 10 MB photo or PDF.
    const tooBig = presignPath === '/photos/upload-url' ? mediaSizeError(file) : file.size > MAX_BYTES ? `${file.name}: too large — 10 MB max.` : null;
    if (tooBig) throw new Error(tooBig);
    const { uploadUrl, fileUrl } = await apiPost<{ uploadUrl: string; fileUrl: string }>(url(presignPath), { mimeType: file.type, originalName: file.name });
    const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!put.ok) throw new Error(`${file.name}: upload failed — please try again.`);
    return fileUrl;
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); onError(null);
    try { await fn(); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : 'That did not work — try again.'); }
    finally { setBusy(null); }
  };

  const addPhotos = (kind: 'before' | 'after', files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    void run(kind, async () => {
      for (const f of list) {
        const fileUrl = await putFile(f, '/photos/upload-url');
        await apiPost(url('/photos'), { kind, url: fileUrl });
      }
    });
  };

  const importMoveOut = (photoIds: string[]) => run('before', async () => {
    await apiPost(url('/photos/from-move-out'), { photoIds });
    setPicking(false);
    loadMoveOut();
  });

  const [billErr, setBillErr] = useState<string | null>(null);
  const closeBill = () => { setAdding(false); setBillFile(null); setBill(emptyBill); setBillErr(null); };
  const saveBill = async () => {
    setBusy('bill'); setBillErr(null);
    try {
    const amount = Number(bill.amountAed);
    if (!bill.category) throw new Error('Choose what the bill is for.');
    if (!(amount > 0)) throw new Error('Enter the bill amount.');
    const ownLabour = bill.category === OWN_LABOUR;
    if (!ownLabour && !bill.billRef.trim()) throw new Error('Enter the bill number.');
    const fileUrl = billFile && !ownLabour ? await putFile(billFile, '/bills/upload-url') : undefined;
    await apiPost(url('/bills'), {
      billDate: bill.billDate || undefined, category: bill.category, supplier: ownLabour ? undefined : bill.supplier || undefined,
      description: bill.description.trim() || undefined,
      amountAed: amount, vatMode: ownLabour ? 'none' : bill.vatMode, billRef: ownLabour ? undefined : bill.billRef.trim(), taskIds: bill.taskIds, fileUrl,
    });
    closeBill();
    onChanged();
    } catch (e) {
      setBillErr(e instanceof Error ? e.message : 'Could not save the bill — try again.');
    } finally { setBusy(null); }
  };

  const attachBillFile = (file: File | null) => {
    const billId = attachTo.current;
    attachTo.current = null;
    if (!file || billId == null) return;
    void run(`attach-${billId}`, async () => {
      const fileUrl = await putFile(file, '/bills/upload-url');
      await apiPost(url(`/bills/${billId}/file`), { fileUrl });
    });
  };

  // One slim ROW per group, full width: small thumbnails, the first PHOTO_ROW of them, then a "+N" tile that
  // opens the rest. (Owner, 21 Sep 2026: 13 move-out photos two-abreast made this card taller than the whole job.)
  const column = (kind: 'before' | 'after', ref: React.RefObject<HTMLInputElement | null>) => {
    const rows = photos.filter(p => p.kind === kind);
    const expanded = showAll[kind];
    const visible = expanded || rows.length <= PHOTO_ROW + 1 ? rows : rows.slice(0, PHOTO_ROW);
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#6b6860]">{kind === 'before' ? 'Before' : 'After'} · {rows.length}</h3>
          {open && (
            <>
              <input ref={ref} type="file" accept="image/*,video/*" multiple hidden onChange={e => { addPhotos(kind, e.target.files); e.target.value = ''; }} />
              <span className="flex items-center gap-3">
                {kind === 'before' && moveOutLeft > 0 && (
                  <button type="button" disabled={!!busy} onClick={() => setPicking(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1a7a5a] cursor-pointer disabled:opacity-50">
                    <ClipboardList size={13} /> From move-out report
                  </button>
                )}
                <button type="button" disabled={!!busy} onClick={() => ref.current?.click()} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1a7a5a] cursor-pointer disabled:opacity-50">
                  <Camera size={13} /> {busy === kind ? 'Uploading…' : 'Add photos or videos'}
                </button>
              </span>
            </>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-[11.5px] text-[#9b9890] mt-2 border border-dashed border-[#e0ddd5] rounded-lg px-3 py-3 text-center">
            {kind === 'before' ? (moveOutLeft > 0 ? 'No before photos yet — bring them from the move-out report' : 'No before photos yet') : 'No after photos yet — needed to mark the work done'}
          </p>
        ) : (
          <ul className="flex gap-1.5 flex-wrap mt-2">
            {visible.map((p, k) => (
              <li key={p.id} className="relative group">
                <button type="button" title={p.caption ?? (isVideoUrl(p.viewUrl) ? 'Play video' : 'View photo')} className="block cursor-pointer"
                  onClick={() => setGallery({ photos: rows.map(r => ({ id: r.id, url: r.viewUrl, caption: r.caption ?? `${kind === 'before' ? 'Before' : 'After'} ${isVideoUrl(r.viewUrl) ? 'video' : 'photo'}` })), start: k })}>
                  <MediaThumb url={p.viewUrl} alt={p.caption ?? `${kind} photo`} className="w-[60px] h-[60px] object-cover rounded-lg border border-[#e6e8e6] hover:opacity-90" />
                </button>
                {open && (
                  <button type="button" title={isVideoUrl(p.viewUrl) ? 'Remove video' : 'Remove photo'} disabled={!!busy}
                    onClick={() => run('rm-photo', async () => { await apiDelete(url(`/photos/${p.id}`)); })}
                    className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-white border border-[#f1d5d5] text-[#b91c1c] cursor-pointer">
                    <Trash2 size={11} />
                  </button>
                )}
              </li>
            ))}
            {visible.length < rows.length && (
              <li>
                <button type="button" onClick={() => setShowAll(v => ({ ...v, [kind]: true }))} title={`Show all ${rows.length} photos`}
                  className="w-[60px] h-[60px] rounded-lg border border-[#e6e8e6] bg-[#f6f7f6] text-[12px] font-bold text-[#5b615e] hover:bg-[#eef0ee] cursor-pointer">+{rows.length - visible.length}</button>
              </li>
            )}
          </ul>
        )}
        {rows.length > 0 && (
          <p className="text-[10.5px] text-[#8a8f8c] mt-1.5">
            {kind === 'before' && rows.some(r => r.caption?.startsWith('Move-out')) ? `${rows.filter(r => r.caption?.startsWith('Move-out')).length} from the move-out report · ` : ''}tap a photo to view it
            {expanded && rows.length > PHOTO_ROW + 1 && <> · <button type="button" onClick={() => setShowAll(v => ({ ...v, [kind]: false }))} className="font-semibold text-[#1a7a52] cursor-pointer">show fewer</button></>}
          </p>
        )}
      </div>
    );
  };

  const hasAfter = photos.some(p => p.kind === 'after');
  const openTasks = tasks.filter(t => !t.doneAt).length;
  const taskLabels = (ids: number[] | undefined) => (ids ?? []).map(id => tasks.find(t => t.id === id)?.label).filter(Boolean).join(', ');
  const addBillFor = (taskId: number) => { setBill({ ...emptyBill, taskIds: [taskId] }); setAdding(true); };
  const toggleBillTask = (id: number) => setBill(b => ({ ...b, taskIds: b.taskIds.includes(id) ? b.taskIds.filter(x => x !== id) : [...b.taskIds, id] }));

  return (
    <>
      {/* ── tasks (0301) — the move-out form's main categories, marked done one by one ── */}
      {section !== 'finish' && (tasks.length > 0 || (canAddTasks && open)) && (
        <div className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-bold text-[#1c1f1d]">Tasks</h2>
            <span className="flex items-baseline gap-3">
              {tasks.length > 0 && <span className="text-[11.5px] font-semibold text-[#5b615e]">{tasks.length - openTasks} of {tasks.length} done</span>}
              {canAddTasks && open && !addingTask && (
                <button type="button" disabled={!!busy} onClick={openAddTask} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#1a7a52] cursor-pointer disabled:opacity-50"><Plus size={13} /> Add a task</button>
              )}
            </span>
          </div>
          <p className="text-[11.5px] text-[#5b615e] mt-1">{!open ? 'What was done on this job. A late bill can still be filed against a task.' : tasks.length > 0 ? 'Tick each item when it is fixed — all ticked marks the task done. File bills against the task. Found more work? Add it.' : 'No task list on this job yet — add the work to be done, then tick each one when it is fixed.'}</p>
          {tasks.length > 0 && (
          <div className="h-1.5 rounded-full bg-[#eef1ec] mt-3 overflow-hidden">
            <div className="h-full bg-[#2e9f82]" style={{ width: `${Math.round(((tasks.length - openTasks) / tasks.length) * 100)}%` }} />
          </div>
          )}
          {tasks.length > 0 && (
          <ul className="mt-3 border border-[#eef1ec] rounded-xl divide-y divide-[#eef1ec]">
            {tasks.map(t => {
              const done = !!t.doneAt;
              return (
                <li key={t.id} className="flex items-start gap-3 px-3.5 py-3">
                  <button type="button" disabled={!open || !!busy} title={done ? 'Open again' : 'Mark done'}
                    onClick={() => run(`task-${t.id}`, async () => { await apiPatch(url(`/tasks/${t.id}`), { done: !done }); })}
                    className={`mt-0.5 flex items-center justify-center w-5 h-5 rounded-md border shrink-0 cursor-pointer disabled:cursor-default ${done ? 'bg-[#2e9f82] border-[#2e9f82] text-white' : 'bg-white border-[#cfd6cf] hover:border-[#2e9f82]'}`}>
                    {done && <Check size={13} strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <span className={`text-[13px] font-semibold ${done ? 'text-[#9b9890] line-through' : 'text-[#1c1f1d]'}`}>{t.label}</span>
                      <span className="flex items-center gap-3 text-xs">
                        {t.bills > 0 && <span className="text-[#6b6860]">{t.bills} bill{t.bills === 1 ? '' : 's'} · <span className="font-semibold text-[#1a1916]">{aed(t.billsAed)}</span></span>}
                        {(t.sharedBills ?? 0) > 0 && <span className="text-[#9b9890]" title="Bills that paid for this task together with other tasks">+ {t.sharedBills} shared</span>}
                        <button type="button" disabled={!!busy} onClick={() => addBillFor(t.id)} className="inline-flex items-center gap-1 font-semibold text-[#1a7a5a] cursor-pointer disabled:opacity-50">
                          <Plus size={12} /> Bill
                        </button>
                        {open && !done && t.bills === 0 && (t.sharedBills ?? 0) === 0 && (
                          <button type="button" disabled={!!busy} title="Remove this task — nothing has been done or billed on it"
                            onClick={() => { if (window.confirm(`Remove "${t.label}" from the task list?`)) void run(`rm-task-${t.id}`, async () => { await apiDelete(url(`/tasks/${t.id}`)); }); }}
                            className="inline-flex text-[#b8b5ad] hover:text-[#b91c1c] cursor-pointer disabled:opacity-50"><Trash2 size={13} /></button>
                        )}
                      </span>
                    </div>
                    {t.findings.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {t.findings.map(f => {
                          // A task ticked done covers every line under it — also on jobs finished before lines could be ticked one by one.
                          const fd = !!f.doneAt || done;
                          return (
                            <li key={f.id} className="group flex items-start gap-2 text-[12px]">
                              <button type="button" disabled={!open || !!busy} title={fd ? 'Open again' : 'Tick when fixed'}
                                onClick={() => run(`item-${f.id}`, async () => { await apiPatch(url(`/tasks/${t.id}/items/${f.id}`), { done: !fd }); })}
                                className={`mt-px flex items-center justify-center w-4 h-4 rounded border shrink-0 cursor-pointer disabled:cursor-default ${fd ? 'bg-[#2e9f82] border-[#2e9f82] text-white' : 'bg-white border-[#cfd6cf] hover:border-[#2e9f82]'}`}>
                                {fd && <Check size={10} strokeWidth={3} />}
                              </button>
                              <span className={fd ? 'text-[#9b9890] line-through' : 'text-[#6b6860]'}>
                                {f.label}{f.condition && <span className="text-[#9a3412]"> · {f.condition}</span>}
                                {f.costAed > 0 && <span className="text-[#9b9890]"> · {f.source === 'list' ? 'list price' : 'est.'} {aed(f.costAed)}{f.source === 'list' && f.unit ? ` / ${f.unit}` : ''}</span>}
                              </span>
                              {open && !fd && f.source !== 'move_out' && (
                                <button type="button" disabled={!!busy} title="Remove this item"
                                  onClick={() => run(`rm-item-${f.id}`, async () => { await apiDelete(url(`/tasks/${t.id}/items/${f.id}`)); })}
                                  className="hidden group-hover:inline-flex text-[#b8b5ad] hover:text-[#b91c1c] cursor-pointer"><X size={12} /></button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {open && itemsFor !== t.id && (
                      <button type="button" disabled={!!busy} onClick={() => openAddItems(t.id)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1a7a5a] cursor-pointer disabled:opacity-50"><Plus size={11} /> item</button>
                    )}
                    {itemsFor === t.id && (
                      <div className="mt-2 border border-[#e8e6e0] rounded-lg p-3 bg-[#fafaf7]">
                        {itemOptions == null ? <p className="text-xs text-[#9b9890]">Loading…</p> : itemOptions.length > 0 && (
                          <>
                            <p className="text-[11px] font-semibold text-[#6b6860]">From your Restoration List</p>
                            <div className="flex gap-1.5 flex-wrap mt-1.5">
                              {itemOptions.map(o => {
                                const on = itemPicks.includes(o.id);
                                return (
                                  <button key={o.id} type="button" onClick={() => setItemPicks(p => on ? p.filter(x => x !== o.id) : [...p, o.id])}
                                    className="px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border" style={on ? chipOn : chipOff}>
                                    {o.label}<span className="ml-1.5 font-normal text-[#9b9890]">{aed(o.priceAed)}/{o.unit}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                        <input className={field + ' mt-2 !py-1.5 !text-xs'} value={customItem} maxLength={160} onChange={e => setCustomItem(e.target.value)} placeholder="Or type an item — e.g. Re-fix loose socket" />
                        <div className="flex items-center gap-2 mt-2">
                          <button type="button" disabled={!!busy || (itemPicks.length === 0 && !customItem.trim())}
                            onClick={() => run('add-items', async () => { await apiPost(url(`/tasks/${t.id}/items`), { itemIds: itemPicks, customLabel: customItem.trim() || undefined }); setItemsFor(null); })}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer disabled:opacity-50" style={{ background: '#1a7a52' }}>
                            {busy === 'add-items' ? 'Adding…' : 'Add'}
                          </button>
                          <button type="button" disabled={!!busy} onClick={() => setItemsFor(null)} className="text-xs font-semibold text-[#6b6860] cursor-pointer">Cancel</button>
                        </div>
                      </div>
                    )}
                    {done && t.doneAt && <div className="text-[11px] text-[#1a7a5a] mt-1">Done {fmtDay(t.doneAt)}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
          )}
          {addingTask && (
            <div className="mt-3 border border-[#e8e6e0] rounded-xl p-4 bg-[#fafaf7]">
              <p className="text-xs font-semibold text-[#6b6860]">Add to the task list</p>
              {taskOptions == null ? (
                <p className="text-xs text-[#9b9890] mt-2">Loading…</p>
              ) : taskOptions.length > 0 ? (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {taskOptions.map(o => {
                    const on = pickedTasks.includes(o.key);
                    return (
                      <button key={o.key} type="button" title={o.findings.length ? o.findings.map(f => `${f.label}${f.condition ? ' — ' + f.condition : ''}`).join('\n') : undefined}
                        onClick={() => { setPickedTasks(p => on ? p.filter(k => k !== o.key) : [...p, o.key]); if (on) setPickedItems(p => p.filter(id => !o.items.some(it => it.id === id))); }}
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer border"
                        style={on ? { background: '#e6f7f1', color: '#1a7a5a', borderColor: '#2e9f82' } : { background: '#fff', color: '#6b6860', borderColor: '#e8e6e0' }}>
                        {o.label}{o.suggested && <span className="ml-1.5 text-[10.5px] font-bold text-[#9a3412]">move-out: {o.findings.length} issue{o.findings.length === 1 ? '' : 's'}</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#9b9890] mt-2">Every category is already on the list — type the task below.</p>
              )}
              {(taskOptions ?? []).filter(o => pickedTasks.includes(o.key) && o.items.length > 0).map(o => (
                <div key={o.key} className="mt-3 pl-3 border-l-2 border-[#cce6d8]">
                  <p className="text-[11px] font-semibold text-[#6b6860]">{o.label} — what needs doing? <span className="font-normal text-[#9b9890]">from your Restoration List · optional</span></p>
                  <div className="flex gap-1.5 flex-wrap mt-1.5">
                    {o.items.map(it => {
                      const on = pickedItems.includes(it.id);
                      return (
                        <button key={it.id} type="button" onClick={() => setPickedItems(p => on ? p.filter(x => x !== it.id) : [...p, it.id])}
                          className="px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border" style={on ? chipOn : chipOff}>
                          {it.label}<span className="ml-1.5 font-normal text-[#9b9890]">{aed(it.priceAed)}/{it.unit}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <label className="block text-xs font-semibold text-[#6b6860] mt-3">Something else — in your own words
                <input className={field + ' mt-1'} value={customTask} maxLength={120} onChange={e => setCustomTask(e.target.value)} placeholder="e.g. Replace balcony door lock" />
              </label>
              <div className="flex items-center gap-2 mt-3">
                <button type="button" disabled={!!busy || (pickedTasks.length === 0 && !customTask.trim())}
                  onClick={() => run('add-task', async () => { await apiPost(url('/tasks'), { categoryKeys: pickedTasks, itemIds: pickedItems, customLabel: customTask.trim() || undefined }); setAddingTask(false); loadMoveOut(); })}
                  className={btn + ' text-white'} style={{ background: '#1a7a52' }}>
                  {busy === 'add-task' ? 'Adding…' : pickedTasks.length + (customTask.trim() ? 1 : 0) > 1 ? `Add ${pickedTasks.length + (customTask.trim() ? 1 : 0)} tasks` : 'Add task'}
                </button>
                <button type="button" disabled={!!busy} onClick={() => setAddingTask(false)} className={btn + ' text-[#6b6860] bg-[#eef1ec]'}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── photos ── */}
      {section !== 'finish' && (
      <div className={card}>
        <h2 className="text-[14px] font-bold text-[#1c1f1d]">Photos — before and after</h2>
        <p className="text-[11.5px] text-[#5b615e] mt-1">Before — the unit&apos;s condition. After — the proof the work was done.</p>
        <div className="mt-3.5 space-y-3.5">
          {column('before', beforeRef)}
          <div className="border-t border-[#eef0ee]" />
          {column('after', afterRef)}
        </div>
      </div>

      )}
      {gallery && <PhotoLightbox photos={gallery.photos} start={gallery.start} onClose={() => setGallery(null)} />}
      {picking && moveOut && <MoveOutPicker data={moveOut} busy={busy === 'before'} onClose={() => setPicking(false)} onAdd={importMoveOut} />}

      {/* ── bills ── */}
      {section !== 'finish' && (
      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-bold text-[#1c1f1d]">Bills &amp; expenses</h2>
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1a7a5a] cursor-pointer">
            <Plus size={13} /> Add a bill
          </button>
        </div>
        <p className="text-[11.5px] text-[#5b615e] mt-1">Everything spent on this job. The total is what this job cost the unit.</p>
        <input ref={billFileRef} type="file" accept="image/*,application/pdf" hidden onChange={e => { attachBillFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />

        {bills.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#9b9890]">
                  {/* Five columns so it fits the page's main column: who / what for sit under one another, and the
                      VAT split sits under each total — every figure is still on screen, none behind a scrollbar. */}
                  <th className="py-1.5 pr-3 font-semibold">Date · bill no.</th>
                  <th className="py-1.5 pr-3 font-semibold">For</th>
                  <th className="py-1.5 pr-3 font-semibold">Attachment</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Total</th>
                  <th className="py-1.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {bills.map(b => (
                  <tr key={b.id} className="border-t border-[#f0eee8] align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-[#6b6860]">
                      {fmtDay(b.billDate)}
                      {b.billRef && <span className="block text-[11px] text-[#9b9890]">{b.billRef}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-[#1a1916]">{b.category}</span>
                      {b.supplier && <span className="text-[#6b6860]"> · {b.supplier}</span>}
                      {taskLabels(b.taskIds) && <span className="block text-xs font-semibold text-[#1a7a5a]">{(b.taskIds ?? []).length > 1 ? 'Tasks' : 'Task'} · {taskLabels(b.taskIds)}</span>}
                      {b.description && <span className="block text-xs text-[#9b9890]">{b.description}</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {b.category === OWN_LABOUR && !b.fileUrl ? (
                        <span className="text-xs text-[#9b9890]">Own team · no bill</span>
                      ) : b.fileUrl ? (
                        <span className="inline-flex items-center gap-2">
                          <a href={b.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#1a7a5a] hover:underline"><FileText size={13} /> View bill</a>
                          <button type="button" disabled={!!busy} onClick={() => { attachTo.current = b.id; billFileRef.current?.click(); }}
                            className="text-xs text-[#9b9890] hover:text-[#1a1916] cursor-pointer disabled:opacity-50">{busy === `attach-${b.id}` ? 'Uploading…' : 'Replace'}</button>
                        </span>
                      ) : (
                        <button type="button" disabled={!!busy} onClick={() => { attachTo.current = b.id; billFileRef.current?.click(); }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#9a3412] bg-[#ffedd5] rounded-lg px-2 py-1 cursor-pointer disabled:opacity-50">
                          <Paperclip size={12} /> {busy === `attach-${b.id}` ? 'Uploading…' : 'Attach bill'}
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      <span className="font-semibold">{aed(b.amountAed)}</span>
                      <span className="block text-[11px] text-[#9b9890]">{b.vatAed ? `${aed(b.netAed)} + VAT ${aed(b.vatAed)}` : 'No VAT'}</span>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" title="Remove bill" disabled={!!busy}
                        onClick={() => run('rm-bill', async () => { await apiDelete(url(`/bills/${b.id}`)); })}
                        className="inline-flex text-[#b91c1c] cursor-pointer disabled:opacity-50"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#e8e6e0]">
                  <td colSpan={3} className="py-2.5 pr-3 font-bold text-[#1a1916]">Total cost of this job</td>
                  <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                    <span className="font-bold text-[#1a1916]">{aed(totalAed ?? 0)}</span>
                    <span className="block text-[11px] text-[#9b9890]">{vatAed ? `${aed(Math.round(((totalAed ?? 0) - vatAed) * 100) / 100)} + VAT ${aed(vatAed)}` : 'No VAT'}</span>
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {bills.length === 0 && <p className="text-xs text-[#9b9890] mt-3">No bills recorded yet.</p>}

        {adding && (
          <Popup title={bill.category === OWN_LABOUR ? 'Add own team labour' : 'Add a bill'} sub={bill.category === OWN_LABOUR ? 'Your own team has no bill — enter what the labour cost.' : 'What was spent on this job — the total becomes its cost on the unit.'} busy={busy === 'bill'} onClose={closeBill}>
              {tasks.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-[#6b6860]">Which task did it pay for? <span className="font-normal text-[#9b9890]">— one, or several if the bill covers them together</span></p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {tasks.map(t => {
                      const on = bill.taskIds.includes(t.id);
                      return (
                        <button key={t.id} type="button" onClick={() => toggleBillTask(t.id)}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer ${on ? 'bg-[#e6f7f1] border-[#2e9f82] text-[#1a7a5a]' : 'bg-white border-[#e5e9e6] text-[#6b756f] hover:border-[#cfd6cf]'}`}>
                          {on && <Check size={12} strokeWidth={3} />}{t.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-[#9b9890] mt-1">{bill.taskIds.length === 0 ? 'None ticked — a general bill for the whole job.' : bill.taskIds.length > 1 ? `One bill shared by ${bill.taskIds.length} tasks.` : ''}</p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-[#6b6860]">What is it for?
                  <select className={field + ' mt-1'} value={bill.category} onChange={e => setBill({ ...bill, category: e.target.value })}>
                    <option value="">Choose a category…</option>
                    {billCategories.map(c => <option key={c} value={c}>{c === OWN_LABOUR ? 'Labour — own team (no bill)' : c}</option>)}
                  </select>
                </label>
                {bill.category !== OWN_LABOUR && (
                  <label className="text-xs font-semibold text-[#6b6860]">Supplier
                    <input className={field + ' mt-1'} value={bill.supplier} onChange={e => setBill({ ...bill, supplier: e.target.value })} placeholder="Shop or company" />
                  </label>
                )}
                <label className="text-xs font-semibold text-[#6b6860]">{bill.category === OWN_LABOUR ? 'Date' : 'Bill date'}
                  <input type="date" className={field + ' mt-1'} value={bill.billDate} onChange={e => setBill({ ...bill, billDate: e.target.value })} />
                </label>
                {bill.category === OWN_LABOUR ? (
                  <label className="text-xs font-semibold text-[#6b6860]">Labour cost (AED)
                    <input type="number" min="0" step="0.01" inputMode="decimal" className={field + ' mt-1'} value={bill.amountAed} onChange={e => setBill({ ...bill, amountAed: e.target.value })} />
                  </label>
                ) : (
                  <div className="text-xs font-semibold text-[#6b6860]">Amount on the bill (AED)
                    <div className="mt-1 font-normal"><AmountWithVat accent="#2e9f82" amount={bill.amountAed} onAmount={v => setBill({ ...bill, amountAed: v })} mode={bill.vatMode} onMode={m => setBill({ ...bill, vatMode: m })} /></div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {bill.category !== OWN_LABOUR && (
                  <label className="text-xs font-semibold text-[#6b6860]">Bill no. <span className="text-[#b91c1c]">*</span>
                    <input required className={field + ' mt-1'} value={bill.billRef} onChange={e => setBill({ ...bill, billRef: e.target.value })} />
                  </label>
                )}
                <label className={`text-xs font-semibold text-[#6b6860] ${bill.category === OWN_LABOUR ? 'sm:col-span-2' : ''}`}>Note — optional
                  <input className={field + ' mt-1'} value={bill.description} onChange={e => setBill({ ...bill, description: e.target.value })} placeholder={bill.category === OWN_LABOUR ? 'e.g. 2 painters, 3 days' : 'e.g. 3 rooms, two coats'} />
                </label>
              </div>

              {/* The bill itself — a box you cannot miss, not a bare file input. Own team labour has none. */}
              {bill.category !== OWN_LABOUR && (<>
              <input ref={newBillFileRef} type="file" accept="image/*,application/pdf" hidden onChange={e => { setBillFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              <div className="mt-3">
                <p className="text-xs font-semibold text-[#6b6860]">Attach the bill</p>
                {billFile ? (
                  <div className="flex items-center justify-between gap-3 mt-1 border border-[#2e9f82] bg-[#e6f7f1] rounded-xl px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#1a7a5a] min-w-0">
                      <FileText size={16} className="shrink-0" /> <span className="truncate">{billFile.name}</span>
                      <span className="font-normal text-[#6b6860] shrink-0">· {(billFile.size / 1024 / 1024).toFixed(1)} MB</span>
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <button type="button" onClick={() => newBillFileRef.current?.click()} className="text-xs font-semibold text-[#1a7a5a] cursor-pointer hover:underline">Change</button>
                      <button type="button" onClick={() => setBillFile(null)} className="text-xs font-semibold text-[#b91c1c] cursor-pointer hover:underline">Remove</button>
                    </span>
                  </div>
                ) : (
                  <button type="button" onClick={() => newBillFileRef.current?.click()}
                    className="w-full mt-1 flex items-center justify-center gap-2 border-2 border-dashed border-[#cfd6cf] hover:border-[#2e9f82] bg-white rounded-xl px-4 py-5 text-sm font-semibold text-[#1a7a5a] cursor-pointer">
                    <Paperclip size={16} /> Choose the bill — photo or PDF
                    <span className="font-normal text-[#9b9890]">(up to 10 MB · can also be added later)</span>
                  </button>
                )}
              </div>
              </>)}

              {billErr && <p className="text-xs text-[#b91c1c] mt-3">{billErr}</p>}
              <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#eef1ec]">
                <button type="button" disabled={!!busy} onClick={closeBill} className={btn + ' text-[#6b6860] bg-[#eef1ec]'}>Cancel</button>
                <button type="button" disabled={!!busy} onClick={() => void saveBill()} className={btn + ' text-white'} style={{ background: '#1a7a52' }}>{busy === 'bill' ? 'Saving…' : 'Save bill'}</button>
              </div>
          </Popup>
        )}
      </div>

      )}

      {/* ── done ── */}
      {section !== 'work' && open && (
        <div className={card}>
          <h2 className="text-[14px] font-bold text-[#1c1f1d]">Work finished?</h2>
          <p className="text-[12px] text-[#5b615e] mt-1">
            {openTasks > 0
              ? `Tick every task first — ${openTasks} still open.`
              : hasAfter
                ? 'Marking it done closes the job. The bills above become its cost on the property; a late bill can still be added afterwards.'
                : 'Add at least one AFTER photo first — it is the proof the work was done.'}
          </p>
          <button type="button" disabled={!!busy || !hasAfter || openTasks > 0}
            onClick={() => run('done', async () => { await apiPost(url('/done'), {}); })}
            className={btn + ' text-white mt-3'} style={{ background: '#1a7a52' }}>
            <CheckCircle2 size={15} /> {busy === 'done' ? 'Closing…' : 'Mark work done'}
          </button>
        </div>
      )}
    </>
  );
}

/** Choose which move-out inspection photos become this job's before photos. */
function MoveOutPicker({ data, busy, onClose, onAdd }: { data: MoveOutPhotos; busy: boolean; onClose: () => void; onAdd: (photoIds: string[]) => void }) {
  useBackClose(onClose);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const open = data.items.flatMap(it => it.photos.filter(p => !p.imported).map(p => p.photoId));
  const toggle = (id: string) => setChosen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4 py-6" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[#f1efe9]">
          <div>
            <h3 className="text-sm font-bold text-[#1a1916]">Move-out report{data.inspectionDate ? ` · ${fmtDay(data.inspectionDate)}` : ''}</h3>
            <p className="text-xs text-[#6b6860] mt-0.5">The unit&apos;s last condition. Choose the photos of what needs fixing.</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] cursor-pointer" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-3 space-y-4">
          {data.items.map((it, i) => (
            <div key={i}>
              <div className="text-xs font-semibold text-[#1a1916]">{it.label}{it.condition && <span className="font-normal text-[#9b9890]"> · {it.condition}</span>}</div>
              <ul className="flex gap-2 flex-wrap mt-1.5">
                {it.photos.map(p => {
                  const on = chosen.has(p.photoId);
                  return (
                    <li key={p.photoId}>
                      <button type="button" disabled={p.imported} onClick={() => toggle(p.photoId)} title={p.imported ? 'Already on this job' : on ? 'Selected' : 'Select'}
                        className={`relative block rounded-xl overflow-hidden border-2 ${on ? 'border-[#2e9f82]' : 'border-transparent'} ${p.imported ? 'opacity-45 cursor-default' : 'cursor-pointer'}`}>
                        <img src={p.viewUrl} alt={it.label} className="w-20 h-20 object-cover" />
                        {(on || p.imported) && (
                          <span className={`absolute top-1 right-1 flex items-center justify-center w-4 h-4 rounded-full text-white ${p.imported ? 'bg-[#9b9890]' : 'bg-[#2e9f82]'}`}><Check size={10} /></span>
                        )}
                        {p.imported && <span className="absolute left-1 bottom-1 text-[9px] font-semibold px-1 rounded bg-white/90 text-[#6b6860]">Added</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-[#f1efe9]">
          <button type="button" onClick={() => setChosen(chosen.size === open.length ? new Set() : new Set(open))} className="text-xs font-semibold text-[#1a7a5a] cursor-pointer">
            {chosen.size === open.length ? 'Clear' : `Select all (${open.length})`}
          </button>
          <span className="flex items-center gap-2">
            <button type="button" onClick={onClose} className={btn + ' text-[#6b6860] bg-[#eef1ec]'}>Cancel</button>
            <button type="button" disabled={busy || chosen.size === 0} onClick={() => onAdd([...chosen])} className={btn + ' text-white'} style={{ background: '#1a7a52' }}>
              {busy ? 'Adding…' : `Add ${chosen.size || ''} as before photo${chosen.size === 1 ? '' : 's'}`}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** A centred dialog over the page — Back and the backdrop close it (not while saving). */
function Popup({ title, sub, busy, onClose, children }: { title: string; sub?: string; busy?: boolean; onClose: () => void; children: React.ReactNode }) {
  useBackClose(() => { if (!busy) onClose(); });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4 py-6" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-2xl w-full max-w-xl max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[#f1efe9]">
          <div>
            <h3 className="text-sm font-bold text-[#1a1916]">{title}</h3>
            {sub && <p className="text-xs text-[#6b6860] mt-0.5">{sub}</p>}
          </div>
          <button type="button" disabled={busy} onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] cursor-pointer" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
