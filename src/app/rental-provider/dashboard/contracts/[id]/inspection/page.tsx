'use client';

/**
 * Operations › Long-term leases › Inspection (legacy route) — Genspark OS rebuild.
 *
 * Re-exported unchanged by /dashboard/manager/contracts/[id]/inspection and the
 * /prototype/os/rp bridge. For a logged-in RP / manager this route only forwards
 * to the v2 category report (/inspection/v2), carrying every query param.
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - Redirect: non-portal paths router.replace → {base}/inspection/v2?{all params, type
 *    normalised to move_in|move_out}; base = manager or RP contract route. Kit loading
 *    state while it hops.
 *  - Portal path (/portal/<token>/…): the token-scoped legacy checklist workspace:
 *    GET /api/portal/:token/contracts/:id (or /api/contracts/:id) + GET …/inspection/full?type=
 *    (or /api/contracts/:id/inspection?type=); move-out seeds outCondition from move-in
 *    (Good default) and the contract move-out date; draft autosave (PATCH …/inspection
 *    {type, data, finalize:false}, 1.5 s debounce, retry on error); Submit Inspection
 *    (finalize:true; top, bottom and mobile sticky buttons); Undo submission & edit
 *    (POST /api/contracts/:id/inspection/reopen?type=, RP only); customer signing link
 *    (POST /api/portal/generate {tenantId, contractId, purpose}); counter-sign
 *    (POST …/inspection/counter-sign or /api/contracts/:id/inspection/sign?type=) via
 *    SignatureBlock (REUSED), then stored PDF snapshot (storeContractPdf, authed only);
 *    Download PDF (InspectionReportPdf) and Print (window.print, print-only header);
 *    areas (rename, add, remove), items (G/F/D condition, custom items, remove),
 *    per-item photos (presigned upload, image-only, multi), general photos with
 *    captions, photo gallery tabs (per-area), read-only move-in photos on move-out,
 *    acknowledgement text, customer + inspector signature panels, status banners.
 *  - Legal / signing wording keeps "Tenant" (counter-sign banner, acknowledgement,
 *    report header) per AGENTS.md.
 *  - New: kit page head / scope strip / sign-off Flow; row removals are labelled
 *    buttons ("Remove area", "Remove", "Remove photo") instead of bare icons.
 */
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useState, useEffect, useCallback, useRef, createElement } from 'react';
import { useParams, useSearchParams, usePathname, useRouter } from 'next/navigation';
import {
  Plus, Save, Printer, Download, ArrowLeft, Loader2,
  AlertCircle, RotateCcw, Camera, Paperclip, Images, Send,
} from 'lucide-react';
import { openDocViewer } from '@/lib/docViewer';
import { triggerBrowserDownload } from '@/lib/downloadDoc';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import { OsPage, PageHead, ScopeStrip, Card, Pill, Btn, Callout, Evid, Flow, KV, Field, type Tone } from '@/components/os/kit';

// ─── Types ────────────────────────────────────────────────────────────────────

type Condition = 'G' | 'F' | 'D' | '';
type InspType = 'move_in' | 'move_out';

interface ItemAttachment {
  id: string;
  url: string;
}

interface InspectionItem {
  id: string;
  name: string;
  isCustom: boolean;
  inCondition: Condition;
  outCondition: Condition;
  itemAttachments?: ItemAttachment[];
  /** Read-only move-in photos for this item, carried over so the move-out
   *  inspection shows the "before" evidence next to the move-out column. */
  moveInAttachments?: ItemAttachment[];
}

interface InspectionArea {
  id: string;
  name: string;
  items: InspectionItem[];
  remarks: string;
}

interface InspectionPhoto {
  id: string;
  url: string;
  caption: string;
}

/** Move-out only — a single utility/DEWA account clearance row. */
interface UtilityClearance {
  id: string;
  provider: string;
  cleared: boolean;
  /** Outstanding final-bill amount (AED) when not yet cleared. */
  outstanding: string;
  /** Account number / clearance reference. */
  reference: string;
}
interface BillClearanceData {
  items: UtilityClearance[];
  /** Uploaded final clearance certificate (DEWA/cooling closing statement). */
  certificateUrl?: string | null;
  notes?: string;
}

interface InspectionData {
  reportGeneratedDate: string;
  inspectorName: string;
  // inspectionDate is auto-set to rpCounterSignedAt on counter-sign — not manually entered
  inspectionDate?: string;
  moveInDate: string;
  areas: InspectionArea[];
  generalNotes: string;
  photos: InspectionPhoto[];
  /** Read-only move-in general photos, shown as reference during move-out. */
  moveInPhotos?: InspectionPhoto[];
  tenantSig: string | null;
  landlordSig: string | null;
  rpSubmittedAt?: string | null;
  tenantSignedAt?: string | null;
  rpCounterSig?: string | null;
  rpCounterSignedAt?: string | null;
  /** Move-out only — utility/DEWA bill clearance captured at handover. */
  billClearance?: BillClearanceData;
}

interface ContractMeta {
  property: string;
  unit: string;
  tenantName: string;
  tenantPhone: string;
  tenantId?: number | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  contractEndDate: string | null;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
}

// `<input type="date">` only renders a value in strict YYYY-MM-DD form; a full
// ISO timestamp (e.g. the API's "2026-06-29T20:00:00.000Z") makes it show blank.
// Normalise to the Dubai-local calendar day so the control shows the right date
// (and doesn't drift a day back for a UTC-midnight-Dubai value). en-CA yields
// YYYY-MM-DD.
function toDateInput(d: string | null | undefined): string {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;           // already date-only
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
}

// Freshly-uploaded inspection photos are stored with their RAW private-bucket URL
// (so the backend's read-time re-signing keeps working), but that raw URL 403s
// until the next reload. The upload response also returns a short-lived SIGNED
// `viewUrl`; we stash it here keyed by the raw URL so the just-uploaded photo
// previews immediately in the same session. Never persisted — after a reload the
// API returns already-signed URLs and this map is empty (falls through to `url`).
const freshViewUrls = new Map<string, string>();
function rememberViewUrl(rawUrl: string, viewUrl?: string | null) {
  if (rawUrl && viewUrl) freshViewUrls.set(rawUrl, viewUrl);
}
function displayUrl(u: string | null | undefined): string {
  return (u && freshViewUrls.get(u)) || u || '';
}

/** Generate + copy a purpose-scoped tenant portal link (move-in / move-out
 *  inspection signing) right from the inspection workspace. */
function PortalLinkButton({ tenantId, contractId, purpose, label }: {
  tenantId: number; contractId: number; purpose: 'move_in' | 'move_out'; label: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const send = async () => {
    setState('sending');
    try {
      const res = await fetch('/api/portal/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, contractId, purpose }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setLink(d.link ?? ''); setState('done');
      if (d.link) { try { await navigator.clipboard.writeText(d.link); setCopied(true); } catch { /* ignore */ } }
    } catch { setState('error'); }
  };
  if (state === 'done' && link) {
    return (
      <span className="gx-btn-row print:hidden" style={{ flex: 1, minWidth: 240 }}>
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="Customer signing link"
          className="gx-inp" style={{ flex: 1, minWidth: 0, height: 28, fontSize: 11 }} />
        <Btn size="sm" variant="primary"
          onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }}>{copied ? 'Copied ✓' : 'Copy'}</Btn>
      </span>
    );
  }
  return (
    <Btn size="sm" onClick={() => void send()} disabled={state === 'sending'}>
      <Send size={12} aria-hidden /> {state === 'sending' ? 'Generating…' : state === 'error' ? 'Retry' : label}
    </Btn>
  );
}

// ─── Default items ────────────────────────────────────────────────────────────

const DEFAULT_ITEMS: Omit<InspectionItem, 'id'>[] = [
  { name: 'Door & locks',     isCustom: false, inCondition: '', outCondition: '' },
  { name: 'Walls',            isCustom: false, inCondition: '', outCondition: '' },
  { name: 'Ceiling',          isCustom: false, inCondition: '', outCondition: '' },
  { name: 'Floor',            isCustom: false, inCondition: '', outCondition: '' },
  { name: 'Windows',          isCustom: false, inCondition: '', outCondition: '' },
  { name: 'Lighting',         isCustom: false, inCondition: '', outCondition: '' },
  { name: 'Power outlets',    isCustom: false, inCondition: '', outCondition: '' },
  { name: 'Air conditioning', isCustom: false, inCondition: '', outCondition: '' },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function makeDefaultArea(num: number): InspectionArea {
  return {
    id: uid(),
    name: `Area ${num}`,
    items: DEFAULT_ITEMS.map(i => ({ ...i, id: uid(), itemAttachments: [] })),
    remarks: '',
  };
}

function makeBlankData(): InspectionData {
  return {
    reportGeneratedDate: new Date().toISOString().split('T')[0],
    inspectorName: '',
    moveInDate: '',
    areas: [makeDefaultArea(1)],
    generalNotes: '',
    photos: [],
    tenantSig: null,
    landlordSig: null,
  };
}

// ─── Condition picker ─────────────────────────────────────────────────────────

function ConditionPicker({ value, onChange }: { value: Condition; onChange: (v: Condition) => void }) {
  const opts = [
    { v: 'G' as Condition, active: 'bg-[#047246] text-white border-transparent' },
    { v: 'F' as Condition, active: 'bg-[#f59e0b] text-white border-transparent' },
    { v: 'D' as Condition, active: 'bg-[#ef4444] text-white border-transparent' },
  ];
  return (
    <div className="flex gap-1.5 sm:gap-1">
      {opts.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(value === o.v ? '' : o.v)}
          className={[
            'w-11 h-11 sm:w-7 sm:h-7 rounded-lg sm:rounded-md text-base sm:text-xs font-bold border transition-all',
            value === o.v ? o.active : 'border-[#e4e9e5] text-[#8a948d] hover:border-[#c8c6be] bg-white',
          ].join(' ')}
        >
          {o.v}
        </button>
      ))}
    </div>
  );
}

// ─── Per-item photo preview strip ──────────────────────────────────────────────
// Uniform, neatly-wrapped thumbnails shown full-width below an item so the row
// stays tidily aligned no matter how many photos are attached. Tap to enlarge;
// the ✕ stays visible on touch and fades-in on hover for desktop.
function ItemThumbStrip({ attachments, onRemove }: {
  attachments: ItemAttachment[];
  onRemove?: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map(a => (
        <div key={a.id} className="group relative w-16 h-16 sm:w-14 sm:h-14 rounded-lg border border-[#e4e9e5] overflow-hidden shrink-0 bg-[#eef1ef]">
          <button type="button" onClick={() => openDocViewer({ fileUrl: displayUrl(a.url), caption: 'Attachment' })} className="block w-full h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={displayUrl(a.url)} alt="attachment" className="w-full h-full object-cover" />
          </button>
          {onRemove && (
            <button type="button" onClick={() => onRemove(a.id)}
              className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-semibold py-0.5">
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Per-item attachment upload (add button only — previews live in the strip) ──
function ItemAttachmentButton({
  contractId, itemId, count, onAdd, portalToken, inspType,
}: {
  contractId: number;
  itemId: string;
  count: number;
  inspType: InspType;
  // Hands back ONLY the newly-uploaded attachments; the parent appends them to
  // LIVE state via a functional update. This avoids two losses: (1) appending
  // per-file onto a stale array (only the last survives) and (2) a slow upload
  // resolving with a stale snapshot and clobbering edits made to other items
  // while it was in flight.
  onAdd: (added: ItemAttachment[]) => void;
  portalToken?: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Uploads ONE file and returns the new attachment (or null). uid() in the key
  // guards against same-ms documentKey collisions when several files are picked.
  async function uploadOne(file: File): Promise<ItemAttachment | null> {
    try {
      const docBody = {
        documentKey: `insp_item_${itemId}_${Date.now()}_${uid()}`,
        mimeType: file.type, originalName: file.name,
      };
      const urlRes = await fetch(portalToken
        ? `/api/portal/${portalToken}/contracts/${contractId}/inspection/upload-url`
        : '/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Only the portal (inspector-link) endpoint takes `type` — it matches the
        // request to the link's purpose (a move-out link 403s on a move_in default).
        // The logged-in /api/documents endpoint whitelists its DTO and 400s on any
        // extra field, so `type` must NOT leak into that branch.
        body: JSON.stringify(portalToken
          ? { type: inspType, ...docBody }
          : { ownerType: 'tenancy_contract', ownerId: contractId, ...docBody }),
      });
      if (!urlRes.ok) { setErr('Upload failed — please retry'); return null; }
      const { uploadUrl, fileUrl, viewUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string; viewUrl?: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const put = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) { setErr('Upload failed — please retry'); return null; }
      rememberViewUrl(fileUrl, viewUrl);   // preview immediately (raw fileUrl 403s until reload)
      return { id: uid(), url: fileUrl };
    } catch { setErr('Unexpected error — please retry'); return null; }
  }

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true); setErr(null);
    const uploaded: ItemAttachment[] = [];
    for (const f of files) { const r = await uploadOne(f); if (r) uploaded.push(r); }
    if (uploaded.length) onAdd(uploaded);
    setUploading(false);
  }

  return (
    <div className="flex flex-col gap-1">
      {/* image-only: per-item attachments are condition photos; the OS sheet still
          offers Camera + Library, and it keeps thumbnails from breaking on PDFs */}
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={async e => { await handleFiles(Array.from(e.target.files ?? [])); if (inputRef.current) inputRef.current.value = ''; }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Attach photos to this item"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#c8c6be] text-[#5f6b63] hover:border-[#047246] hover:text-[#047246] disabled:opacity-50 transition-colors h-11 px-4 text-xs font-semibold sm:h-8 sm:px-3"
      >
        {uploading
          ? <Loader2 size={15} className="animate-spin" />
          : <><Camera size={16} className="sm:hidden" /><Paperclip size={13} className="hidden sm:block" /></>}
        <span>{uploading ? 'Uploading…' : (count ? 'Add more' : 'Add photo')}</span>
      </button>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
    </div>
  );
}

// ─── Area block ───────────────────────────────────────────────────────────────

function AreaBlock({
  area, areaIndex, inspType, contractId, onChange, onRemove, canRemove, isLocked, portalToken,
  onItemPhotosAdd, onItemPhotosRemove,
}: {
  area: InspectionArea;
  areaIndex: number;
  inspType: InspType;
  contractId: number;
  onChange: (updated: InspectionArea) => void;
  onRemove: () => void;
  canRemove: boolean;
  isLocked: boolean;
  portalToken?: string | null;
  // Photo add/remove are routed through the parent so they apply as functional
  // updates against LIVE state (resilient to slow uploads racing other edits).
  onItemPhotosAdd: (itemId: string, added: ItemAttachment[]) => void;
  onItemPhotosRemove: (itemId: string, photoId: string) => void;
}) {
  function updateItem(itemId: string, patch: Partial<InspectionItem>) {
    onChange({ ...area, items: area.items.map(i => i.id === itemId ? { ...i, ...patch } : i) });
  }
  function addItem() {
    onChange({ ...area, items: [...area.items, { id: uid(), name: '', isCustom: true, inCondition: '', outCondition: '', itemAttachments: [] }] });
  }
  function removeItem(itemId: string) {
    onChange({ ...area, items: area.items.filter(i => i.id !== itemId) });
  }

  const isMoveOut = inspType === 'move_out';

  return (
    <div className="gx-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 bg-[#f6f8f6] border-b border-[#eef1ef]">
        <div className="flex-1 flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-[11px] sm:text-xs font-bold text-[#8a948d] uppercase tracking-wide w-12 sm:w-14 shrink-0">
            Area {areaIndex + 1}
          </span>
          <input
            type="text"
            value={area.name}
            onChange={e => onChange({ ...area, name: e.target.value })}
            placeholder="e.g. Bedroom 1, Kitchen…"
            className="flex-1 min-w-0 text-base sm:text-sm font-semibold text-[#14201a] bg-transparent border-b border-transparent focus:border-[#047246] focus:outline-none pb-0.5 transition-colors"
          />
        </div>
        {canRemove && !isLocked && (
          <Btn size="xs" variant="danger" onClick={onRemove}>Remove area</Btn>
        )}
      </div>

      {/* Items table */}
      <div className="px-4 sm:px-5 pt-3 pb-2">
        {/* Column header — desktop only; on mobile each row is self-describing */}
        <div className="hidden sm:grid gap-2 mb-2 pb-1.5 border-b border-[#eef1ef] grid-cols-[1fr_6rem_7rem_4.5rem]">
          <span className="text-[10px] font-semibold text-[#8a948d] uppercase tracking-wide">Item</span>
          <span className="text-[10px] font-semibold text-[#047246] uppercase tracking-wide text-center">{isMoveOut ? 'Move-Out' : 'Condition'}</span>
          <span className="text-[10px] font-semibold text-[#8a948d] uppercase tracking-wide text-center">Attach</span>
          <span className="text-[10px] font-semibold text-[#8a948d] uppercase tracking-wide text-center">Action</span>
        </div>

        {area.items.map(item => {
          const itemPhotos = item.itemAttachments ?? [];
          return (
          <div
            key={item.id}
            // Mobile: a self-describing stacked card. Desktop: a 4-col grid
            // (Item | Condition | Attach | delete) with a full-width photo strip
            // wrapping onto its own row beneath. Every direct child is an explicit
            // grid cell (no display:contents) so locked/empty states can't drop a
            // cell and shift the columns.
            className="flex flex-col gap-3 py-3 border-b border-[#f9f8f6] last:border-0 sm:gap-2 sm:py-1.5 sm:items-center sm:grid sm:grid-cols-[1fr_6rem_7rem_4.5rem]"
          >
            {/* Item name */}
            <div className="min-w-0">
              {item.isCustom && !isLocked ? (
                <input
                  type="text"
                  value={item.name}
                  onChange={e => updateItem(item.id, { name: e.target.value })}
                  placeholder="Item name…"
                  className="w-full text-base sm:text-sm text-[#14201a] border-b border-dashed border-[#e4e9e5] focus:border-[#047246] focus:outline-none bg-transparent pb-0.5"
                />
              ) : (
                <span className="text-[15px] sm:text-sm font-medium text-[#14201a]">{item.name}</span>
              )}
            </div>

            {/* Condition (custom-item delete rides this row on mobile).
                Move-out edits `outCondition` (pre-filled from the move-in
                baseline on load); move-in edits `inCondition`. */}
            <div className="flex items-center gap-3 sm:justify-center">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8a948d] w-16 shrink-0 sm:hidden">Condition</span>
              <ConditionPicker
                value={isMoveOut ? item.outCondition : item.inCondition}
                onChange={v => !isLocked && updateItem(item.id, isMoveOut ? { outCondition: v } : { inCondition: v })}
              />
              {item.isCustom && !isLocked && (
                <span className="ml-auto sm:hidden"><Btn size="xs" variant="danger" onClick={() => removeItem(item.id)}>Remove</Btn></span>
              )}
            </div>

            {/* Attach control */}
            <div className="flex items-center gap-3 sm:justify-center">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8a948d] w-16 shrink-0 sm:hidden">Photos</span>
              {!isLocked ? (
                <ItemAttachmentButton
                  contractId={contractId}
                  itemId={item.id}
                  count={itemPhotos.length}
                  onAdd={added => onItemPhotosAdd(item.id, added)}
                  portalToken={portalToken}
                  inspType={inspType}
                />
              ) : (
                <span className="text-xs text-[#8a948d] sm:hidden">
                  {itemPhotos.length ? `${itemPhotos.length} photo${itemPhotos.length > 1 ? 's' : ''}` : 'No photos'}
                </span>
              )}
            </div>

            {/* Custom-item delete — desktop grid cell only */}
            <div className="hidden sm:flex sm:justify-center">
              {item.isCustom && !isLocked && (
                <Btn size="xs" variant="danger" onClick={() => removeItem(item.id)}>Remove</Btn>
              )}
            </div>

            {/* Photo previews — full-width strip beneath the item (own grid row on desktop) */}
            {itemPhotos.length > 0 && (
              <div className="sm:col-span-full">
                <ItemThumbStrip
                  attachments={itemPhotos}
                  onRemove={isLocked ? undefined : id => onItemPhotosRemove(item.id, id)}
                />
              </div>
            )}
          </div>
          );
        })}

        {!isLocked && (
          <button type="button" onClick={addItem} className="flex items-center gap-1.5 text-xs font-semibold text-[#047246] hover:opacity-75 mt-3 mb-1 transition-opacity">
            <Plus size={12} /> Add item
          </button>
        )}
      </div>

      {/* Remarks */}
      <div className="px-4 sm:px-5 pb-4">
        <label className="block text-[10px] font-semibold text-[#8a948d] uppercase tracking-wide mb-1">Remarks</label>
        <textarea
          value={area.remarks}
          onChange={e => onChange({ ...area, remarks: e.target.value })}
          placeholder="Notes, damages, or specific observations for this area…"
          rows={2}
          className="w-full text-base sm:text-sm text-[#14201a] border border-[#e4e9e5] rounded-xl px-3 py-2 focus:outline-none focus:border-[#047246] transition-colors resize-none bg-[#f6f8f6]"
        />
      </div>
    </div>
  );
}

// ─── Signature pad ────────────────────────────────────────────────────────────

// ─── Photos section ───────────────────────────────────────────────────────────

function PhotosSection({
  contractId, inspType, photos, onChange, onAdd, disabled, portalToken,
}: {
  contractId: number;
  inspType: InspType;
  photos: InspectionPhoto[];
  // onChange = caption edit / remove (synchronous). onAdd = upload result, applied
  // functionally by the parent so a slow upload can't clobber concurrent edits.
  onChange: (photos: InspectionPhoto[]) => void;
  onAdd: (added: InspectionPhoto[]) => void;
  disabled?: boolean;
  portalToken?: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMoveIn = inspType === 'move_in';
  const heading = isMoveIn ? 'Move-In Photos' : 'Move-Out Photos';

  // Uploads ONE file and returns the new photo (or null) without touching parent
  // state, so a multi-file selection is appended in a single onChange() — calling
  // onChange per-file appends onto the same stale `photos` and only the last
  // file would survive. uid() in the documentKey avoids same-ms collisions.
  async function uploadOne(file: File): Promise<InspectionPhoto | null> {
    if (!file.type.startsWith('image/')) { setUploadError('Please upload image files only.'); return null; }
    try {
      const docBody = {
        documentKey: `inspection_${inspType}_${Date.now()}_${uid()}`,
        mimeType: file.type, originalName: file.name,
      };
      const urlRes = await fetch(portalToken
        ? `/api/portal/${portalToken}/contracts/${contractId}/inspection/upload-url`
        : '/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // `type` only on the portal branch (see ItemAttachmentButton) — the
        // /api/documents DTO 400s on any non-whitelisted field.
        body: JSON.stringify(portalToken
          ? { type: inspType, ...docBody }
          : { ownerType: 'tenancy_contract', ownerId: contractId, ...docBody }),
      });
      if (!urlRes.ok) { setUploadError('Failed to get upload URL'); return null; }
      const { uploadUrl, fileUrl, viewUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string; viewUrl?: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUploadError('File upload failed'); return null; }
      rememberViewUrl(fileUrl, viewUrl);   // preview immediately (raw fileUrl 403s until reload)
      return { id: uid(), url: fileUrl, caption: '' };
    } catch { setUploadError('Unexpected upload error'); return null; }
  }

  async function handleFiles(files: File[]) {
    if (disabled || !files.length) return;
    setUploading(true); setUploadError(null);
    const added: InspectionPhoto[] = [];
    for (const f of files) { const r = await uploadOne(f); if (r) added.push(r); }
    if (added.length) onAdd(added);
    setUploading(false);
  }

  return (
    <div className="gx-card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-[#14201a] flex items-center gap-1.5">
          <Camera size={14} className="text-[#047246]" /> {heading}
          {isMoveIn && <span className="ml-1.5 text-[#ef4444] text-xs font-normal">* recommended</span>}
        </h2>
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map(p => (
            <div key={p.id} className="relative group rounded-xl overflow-hidden border border-[#e4e9e5] bg-[#eef1ef]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl(p.url)} alt={p.caption || 'Inspection photo'} className="w-full h-32 object-cover" />
              {!disabled && (
                <button type="button" onClick={() => onChange(photos.filter(x => x.id !== p.id))}
                  className="absolute top-1.5 right-1.5 rounded-md bg-black/60 text-white text-[10.5px] font-semibold px-2 py-1 hover:bg-red-600 print:hidden">
                  Remove photo
                </button>
              )}
              <input type="text" value={p.caption} readOnly={disabled} disabled={disabled}
                onChange={e => onChange(photos.map(x => x.id === p.id ? { ...x, caption: e.target.value } : x))}
                placeholder={disabled ? '' : 'Caption (e.g. living room)'}
                className="w-full text-xs sm:text-[10px] px-2 py-1.5 sm:py-1 border-t border-[#e4e9e5] focus:outline-none focus:bg-[#eef7f2] bg-white disabled:bg-[#eef1ef] disabled:text-[#5f6b63]"
              />
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <>
          {/* No `capture` attr — lets the OS sheet offer both Camera and Photo Library */}
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={async e => {
              await handleFiles(Array.from(e.target.files ?? []));
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 w-full justify-center py-4 sm:py-3 rounded-xl border-2 border-dashed border-[#d8d6d0] text-sm font-semibold text-[#8a948d] hover:border-[#047246] hover:text-[#047246] active:border-[#047246] active:text-[#047246] disabled:opacity-50 transition-colors print:hidden">
            {uploading ? <><Loader2 size={16} className="animate-spin" /> Uploading…</> : <><Camera size={16} /> {photos.length === 0 ? `Add ${heading.toLowerCase()}` : 'Add more photos'}</>}
          </button>
          {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        </>
      )}
    </div>
  );
}

// ─── Photo Gallery (tabbed by area) ──────────────────────────────────────────

function PhotoGallery({ areas, globalPhotos }: { areas: InspectionArea[]; globalPhotos: InspectionPhoto[] }) {
  const [activeTab, setActiveTab] = useState<'all' | string>('all');

  // Collect per-item attachments grouped by area
  const areaTabs = areas.map(area => ({
    id: area.id,
    name: area.name,
    attachments: area.items.flatMap(it => (it.itemAttachments ?? []).map(a => ({ ...a, itemName: it.name }))),
  })).filter(a => a.attachments.length > 0);

  const allAttachments = areas.flatMap(area =>
    area.items.flatMap(it => (it.itemAttachments ?? []).map(a => ({ ...a, areaName: area.name, itemName: it.name })))
  );
  const allPhotos = [...globalPhotos, ...allAttachments.map(a => ({ id: a.id, url: a.url, caption: `${a.areaName} · ${a.itemName}` }))];

  // Only render when there are per-item attachments to show alongside general photos.
  // Without per-item attachments the gallery is a duplicate of PhotosSection above.
  if (areaTabs.length === 0) return null;

  const tabs = [
    { id: 'all' as const, label: `All (${allPhotos.length})` },
    ...areaTabs.map(a => ({ id: a.id, label: `${a.name} (${a.attachments.length})` })),
  ];

  const displayed = activeTab === 'all'
    ? allPhotos
    : (areaTabs.find(a => a.id === activeTab)?.attachments ?? []).map(a => ({ id: a.id, url: a.url, caption: a.itemName }));

  return (
    <div className="gx-card p-5 space-y-4">
      <h2 className="text-sm font-bold text-[#14201a] flex items-center gap-1.5">
        <Images size={14} className="text-[#047246]" /> Photo Gallery
        <span className="text-xs font-normal text-[#8a948d] ml-1">(RP view — per-item attachments not shown to tenant)</span>
      </h2>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap border-b border-[#eef1ef] pb-2">
        {tabs.map(tab => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
            className={[
              'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
              activeTab === tab.id
                ? 'bg-[#047246] text-white'
                : 'bg-[#eef1ef] text-[#5f6b63] hover:bg-[#e8f9f4] hover:text-[#047246]',
            ].join(' ')}>
            {tab.label}
          </button>
        ))}
      </div>

      {displayed.length === 0 ? (
        <p className="text-xs text-[#8a948d]">No photos in this tab.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {displayed.map(p => (
            <button key={p.id} type="button" onClick={() => openDocViewer({ fileUrl: displayUrl(p.url), caption: p.caption })}
              className="block w-full text-left rounded-xl overflow-hidden border border-[#e4e9e5] hover:border-[#047246] transition-colors cursor-pointer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl(p.url)} alt={p.caption || 'photo'} className="w-full h-32 object-cover" />
              {p.caption && <p className="text-[10px] text-[#5f6b63] px-2 py-1 truncate">{p.caption}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Legend chip ──────────────────────────────────────────────────────────────

function LegendChip({ letter, label, color }: { letter: string; label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center text-white ${color}`}>{letter}</span>
      <span className="text-[#5f6b63]">{label}</span>
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

/**
 * Route wrapper: the RP dashboard route is unified on the v2 category report, so
 * a logged-in RP/manager is redirected to /inspection/v2. The inspector magic-link
 * (/portal/<token>/…) still renders the token-scoped legacy workspace below.
 */
export default function InspectionPage() {
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isPortal = pathname?.startsWith('/portal/') ?? false;
  useEffect(() => {
    if (isPortal || !params?.id) return;
    const type = searchParams.get('type') === 'move_out' ? 'move_out' : 'move_in';
    const isManager = pathname?.startsWith('/dashboard/manager/') ?? false;
    const base = isManager
      ? `/dashboard/manager/contracts/${params.id}`
      : `/rental-provider/dashboard/contracts/${params.id}`;
    // Carry EVERY param through the hop — rebuilding the query from scratch used
    // to drop `from=…` (where the opener came from), which silently sent the v2
    // page's Back link to the lease record even when it was opened from
    // Operations. `rp` (manager sticky-landlord scope) rides along the same way.
    const q = new URLSearchParams(searchParams.toString());
    q.set('type', type); // normalised above (anything not move_out ⇒ move_in)
    router.replace(`${base}/inspection/v2?${q.toString()}`);
  }, [isPortal, params, searchParams, pathname, router]);
  if (!isPortal) {
    return (
      <OsPage>
        <PageHead eyebrow="Operations › Long-term leases" title={<>Inspection · CID-{params?.id}</>} lede="Opening the inspection report…" />
        <Card pad><div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
          {[60, 40, 50].map((w, i) => <div key={i} className="gx-skel" style={{ height: 14, width: `${w}%` }} />)}
        </div></Card>
      </OsPage>
    );
  }
  return <InspectionWorkspace />;
}

function InspectionWorkspace() {
  const params       = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const pathname     = usePathname();
  const inspType     = (searchParams.get('type') ?? 'move_in') as InspType;
  // Inspector magic-link mode — this same workspace is served at
  // /portal/<token>/contract/<id>/inspection so the on-site inspection manager
  // can FILL the form without an account. Every API call swaps to the
  // token-scoped portal endpoints and RP-only chrome (tenant link) hides.
  const portalToken = pathname?.startsWith('/portal/') ? (pathname.split('/')[2] ?? null) : null;
  // Back to the contract page — works even when opened directly (router.back()
  // is a no-op with no history). Keeps the manager vs RP route context.
  // Back returns to wherever we came from (Operations pipeline when opened from
  // there, via ?from=…), falling back to the lease record.
  const backFrom = searchParams.get('from') || '';
  const backHref = portalToken
    ? `/portal/${portalToken}/contract/${params?.id}`
    : (backFrom || ((pathname ?? '').replace(/\/inspection\/?$/, '/v2') || `/rental-provider/dashboard/contracts/${params?.id}/v2`));
  const backLabel = backFrom.includes('/operations') ? 'Back to operations' : 'Back to contract';

  const [meta, setMeta]   = useState<ContractMeta | null>(null);
  const [data, setData]   = useState<InspectionData>(makeBlankData);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [counterDone, setCounterDone] = useState(false);
  const [reopening, setReopening]     = useState(false);
  // Draft autosave — persists progress (photos/conditions/notes) as the inspector
  // works so a reload never loses work. The first explicit Submit finalizes+locks.
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-current snapshot so a debounced autosave sends the LATEST data, not a
  // value captured when the timer was scheduled. Kept in sync via an effect (a
  // debounced save reads it ≥1.5s later, well after commit).
  const dataRef = useRef(data);

  const contractId = params?.id;
  const isMoveIn   = inspType === 'move_in';
  const title      = isMoveIn ? 'Move-In Inspection' : 'Move-Out Inspection';

  // Locking states:
  // formLocked  — RP has submitted; form is read-only; awaiting tenant sig
  // tenantSigned — tenant has signed; RP counter-sign section appears
  // fullySigned  — RP has counter-signed; tenancy activated
  const formLocked   = !!data.rpSubmittedAt;
  const tenantSigned = !!data.tenantSig || !!data.tenantSignedAt;
  const fullySigned  = !!data.rpCounterSig || counterDone;

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const [contractRes, inspRes] = await Promise.all([
        fetch(portalToken ? `/api/portal/${portalToken}/contracts/${contractId}` : `/api/contracts/${contractId}`, { credentials: 'include' }),
        fetch(portalToken
          ? `/api/portal/${portalToken}/contracts/${contractId}/inspection/full?type=${inspType}`
          : `/api/contracts/${contractId}/inspection?type=${inspType}`, { credentials: 'include' }),
      ]);
      // The date field shows the move-in date for a move-in inspection and the
      // contract's move-out (end) date for a move-out inspection.
      let defaultDate = '';
      if (contractRes.ok) {
        const raw = await contractRes.json();
        // Portal detail nests the contract; RP endpoint returns it flat.
        const c = portalToken ? (raw.contract ?? raw) : raw;
        const startDate = c.startDate ?? c.contractStartDate ?? null;
        const endDate   = c.endDate ?? c.contractEndDate ?? null;
        // On an early termination the actual move-out is the termination
        // effective date (when the tenancy winds down), not the original lease end.
        const termEffective = c.termination?.effectiveDate ?? null;
        const moveOutDate = termEffective ?? endDate;
        // The API returns these as full ISO timestamps; the date <input> needs
        // a bare YYYY-MM-DD (in Dubai time) or it renders blank.
        defaultDate = toDateInput((inspType === 'move_out' ? moveOutDate : startDate) ?? '');
        setMeta({
          property:    c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
          unit:        c.unit?.number ?? c.unit?.unitNumber ?? '',
          tenantName:  c.tenant?.companyName || c.tenant?.name || '',
          tenantPhone: c.tenant?.phone ?? '',
          tenantId:    c.tenant?.id ?? null,
          moveInDate:  startDate,
          moveOutDate: moveOutDate,
          contractEndDate: moveOutDate,
        });
        setData(d => d.moveInDate ? d : { ...d, moveInDate: defaultDate });
      }
      if (inspRes.ok) {
        const savedInsp = await inspRes.json();
        if (savedInsp && typeof savedInsp === 'object' && (savedInsp as InspectionData).areas) {
          const loaded = savedInsp as InspectionData;
          // A move-out that hasn't been submitted yet starts pre-filled: each item's
          // move-out condition defaults to the recorded move-in condition (the
          // "before" baseline; Good when there was no move-in record), and the date
          // field defaults to the contract's move-out date rather than the seeded
          // move-in date. Once submitted, the saved record is shown as-is.
          const seedMoveOut = inspType === 'move_out' && !loaded.rpSubmittedAt;
          const areas = seedMoveOut
            ? loaded.areas.map(a => ({
                ...a,
                items: a.items.map(it => ({ ...it, outCondition: it.outCondition || it.inCondition || 'G' })),
              }))
            : loaded.areas;
          setData({
            ...loaded,
            areas,
            // Move-out always shows the bill-clearance section; seed the default
            // UAE utility rows when the saved record doesn't carry them yet.
            billClearance: loaded.billClearance ?? undefined,
            // Prefer the contract's date, but fall back to any saved draft date so a
            // transient contract-fetch failure (defaultDate = '') never blanks it.
            moveInDate: seedMoveOut ? (defaultDate || toDateInput(loaded.moveInDate)) : (toDateInput(loaded.moveInDate) || defaultDate),
            photos: Array.isArray(loaded.photos) ? loaded.photos : [],
            reportGeneratedDate: loaded.reportGeneratedDate ?? new Date().toISOString().split('T')[0],
          });
          if (loaded.rpCounterSig) setCounterDone(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [contractId, inspType]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { void load(); }, [load]);
  // Keep the autosave snapshot current without touching the ref during render.
  useEffect(() => { dataRef.current = data; }, [data]);
  // Clear any pending autosave timer when leaving the page.
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); }, []);

  const saveUrl = portalToken
    ? `/api/portal/${portalToken}/contracts/${contractId}/inspection`
    : `/api/contracts/${contractId}/inspection`;

  // Debounced draft save (finalize:false) — never locks the form, just persists.
  const saveDraft = useCallback(async () => {
    if (!contractId || dataRef.current.rpSubmittedAt) return;
    setAutosaveState('saving');
    try {
      const res = await fetch(portalToken
        ? `/api/portal/${portalToken}/contracts/${contractId}/inspection`
        : `/api/contracts/${contractId}/inspection`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: inspType, data: dataRef.current, finalize: false }),
      });
      setAutosaveState(res.ok ? 'saved' : 'error');
    } catch { setAutosaveState('error'); }
  }, [contractId, portalToken, inspType]);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { void saveDraft(); }, 1500);
  }, [saveDraft]);

  // Wrapper used by every USER edit (not by load() / submit / counter-sign, which
  // write state-machine flags) so each change schedules a draft autosave.
  const updateData = useCallback((update: Parameters<typeof setData>[0]) => {
    setData(update);
    if (!dataRef.current.rpSubmittedAt) scheduleAutosave();
  }, [scheduleAutosave]);

  // Photo add/remove apply as functional updates against LIVE state, so a slow
  // upload that resolves after the inspector has edited another item/area appends
  // to the current data rather than overwriting it with a stale snapshot.
  const addItemPhotos = useCallback((areaId: string, itemId: string, added: ItemAttachment[]) => {
    updateData(d => ({ ...d, areas: d.areas.map(a => a.id !== areaId ? a : {
      ...a, items: a.items.map(it => it.id !== itemId ? it : { ...it, itemAttachments: [...(it.itemAttachments ?? []), ...added] }),
    }) }));
  }, [updateData]);
  const removeItemPhoto = useCallback((areaId: string, itemId: string, photoId: string) => {
    updateData(d => ({ ...d, areas: d.areas.map(a => a.id !== areaId ? a : {
      ...a, items: a.items.map(it => it.id !== itemId ? it : { ...it, itemAttachments: (it.itemAttachments ?? []).filter(x => x.id !== photoId) }),
    }) }));
  }, [updateData]);

  async function handleSave() {
    if (!contractId) return;
    // Cancel any queued draft save — this finalize supersedes it (and a late draft
    // would be rejected by the server once submitted anyway).
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    setSaving(true); setError(null);
    try {
      const res = await fetch(saveUrl, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: inspType, data, finalize: true }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { message?: string }).message ?? 'Failed to save');
        return;
      }
      setSaved(true);
      setAutosaveState('idle');
      setData(d => ({ ...d, rpSubmittedAt: new Date().toISOString() }));
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Unexpected error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Undo a submission so the form is editable again — allowed only while the
  // customer hasn't signed (the server enforces the same guard). RP-only.
  async function handleReopen() {
    if (!contractId || portalToken) return;
    setReopening(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection/reopen?type=${inspType}`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { message?: string }).message ?? 'Could not reopen the inspection.');
        return;
      }
      await load();   // re-fetch: rpSubmittedAt gone → formLocked=false → editable
    } catch {
      setError('Unexpected error. Please try again.');
    } finally {
      setReopening(false);
    }
  }

  // Single source of truth for the InspectionReportPdf payload — used both for the
  // stored snapshot (on counter-sign) and the on-demand "Download PDF" (live copy).
  const buildInspectionPdfData = (overrides?: Record<string, unknown>) => ({
    type: inspType, ref: `CID-${contractId}`,
    property: meta?.property ?? '', unit: meta?.unit ?? '', tenantName: meta?.tenantName ?? '',
    inspectorName: data.inspectorName,
    inspectionDate: data.inspectionDate ?? null,
    moveInDate: data.moveInDate || meta?.moveInDate || null,
    areas: data.areas.map(a => ({ name: a.name, items: a.items.map(it => ({ name: it.name, inCondition: it.inCondition, outCondition: it.outCondition, photoCount: it.itemAttachments?.length ?? 0 })), remarks: a.remarks })),
    generalNotes: data.generalNotes,
    photoCaptions: data.photos.map(p => p.caption?.trim() || 'Photo'),
    utilities: (data.billClearance?.items ?? []).map(u => ({ provider: u.provider, cleared: u.cleared, outstanding: u.outstanding, reference: u.reference })),
    billNotes: data.billClearance?.notes,
    tenantSig: data.tenantSig, tenantSignedAt: data.tenantSignedAt ?? null,
    rpCounterSig: data.rpCounterSig ?? null, rpCounterSignedAt: data.rpCounterSignedAt ?? null,
    ...overrides,
  });

  // On-demand clean download of the inspection report (no watermark). The live
  // fallback for the documents binder when no stored snapshot exists yet, and the
  // customer/RP's own downloadable copy from the inspection page.
  async function downloadInspectionPdf() {
    if (!meta) return;
    try {
      const [{ pdf }, mod] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/contract/InspectionReportPdf'),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(createElement(mod.default, { data: buildInspectionPdfData() as any }) as any).toBlob();
      const url = URL.createObjectURL(blob);
      triggerBrowserDownload(url, `${inspType === 'move_out' ? 'Move-out' : 'Move-in'}-report-CID-${contractId}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch { /* best-effort download */ }
  }

  async function handleCounterSign(p: SignaturePayload) {
    if (!contractId) throw new Error('Missing contract');
    const res = await fetch(portalToken
      ? `/api/portal/${portalToken}/contracts/${contractId}/inspection/counter-sign`
      : `/api/contracts/${contractId}/inspection/sign?type=${inspType}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(portalToken
        // Inspector links record who physically counter-signed.
        ? { type: inspType, signatureImage: p.signatureImage, signatoryName: p.signatoryName || data.inspectorName?.trim() || 'Inspection Manager', consent: p.consent, clientMeta: p.clientMeta, geo: p.geo }
        : { signatureImage: p.signatureImage, signatoryName: p.signatoryName, consent: p.consent, clientMeta: p.clientMeta, geo: p.geo }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? 'Failed to submit signature');
    }
    setCounterDone(true);
    setData(d => ({ ...d, rpCounterSig: p.signatureImage, rpCounterSignedAt: new Date().toISOString() }));
    // Snapshot the completed inspection as a stored PDF so the contract documents
    // binder shows a real document (RP/manager authed path only — the upload flow
    // needs a session; best-effort, never block signing).
    if (!portalToken && meta) {
      try {
        const nowIso = new Date().toISOString();
        const [{ storeContractPdf }, mod] = await Promise.all([
          import('@/lib/storeContractPdf'),
          import('@/components/contract/InspectionReportPdf'),
        ]);
        await storeContractPdf({
          contractId: Number(contractId),
          documentKey: inspType === 'move_out' ? 'move_out_report' : 'move_in_report',
          category: 'inspection',
          displayName: inspType === 'move_out' ? 'Move-out Inspection Checklist' : 'Move-in Inspection Checklist',
          element: createElement(mod.default, { data: buildInspectionPdfData({
            inspectionDate: data.inspectionDate ?? nowIso,
            rpCounterSig: p.signatureImage, rpCounterSignedAt: nowIso,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any }),
        });
      } catch { /* PDF snapshot is best-effort */ }
    }
  }

  const refLabel = `CID-${contractId}`;
  const eyebrow = portalToken ? 'Inspection report' : 'Operations › Long-term leases';
  const titleNode = <>{title} · {refLabel}</>;

  if (loading) {
    return (
      <OsPage>
        <PageHead eyebrow={eyebrow} title={titleNode} lede="Loading the inspection checklist…" />
        <Card pad><div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
          {[70, 45, 60, 35].map((w, i) => <div key={i} className="gx-skel" style={{ height: 14, width: `${w}%` }} />)}
        </div></Card>
      </OsPage>
    );
  }

  const status: { label: string; tone: Tone } = fullySigned
    ? { label: 'Fully signed', tone: 'primary' }
    : tenantSigned ? { label: 'Customer signed — counter-sign', tone: 'amber' }
    : formLocked ? { label: 'Submitted — awaiting customer', tone: 'info' }
    : { label: 'Draft', tone: 'neutral' };
  const flowCurrent = fullySigned ? 4 : tenantSigned ? 3 : formLocked ? 2 : 0;
  const fmtStamp = (d: string) => new Date(d).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const submitBtn = (
    <Btn variant="primary" onClick={() => void handleSave()} disabled={saving}>
      {saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Save size={13} aria-hidden />}
      {saving ? 'Saving…' : 'Submit Inspection'}
    </Btn>
  );

  return (
    <OsPage className="pb-[calc(7rem+env(safe-area-inset-bottom,0px))] sm:pb-[60px] print:p-0">
      <div className="print:hidden">
        <PageHead
          eyebrow={eyebrow}
          title={titleNode}
          lede={meta ? <>{meta.property}{meta.unit ? ` — Unit ${meta.unit}` : ''}{meta.tenantName ? ` · ${meta.tenantName}` : ''}. Room-by-room condition (Good / Fair / Damaged), photos and notes, signed by both parties.</> : undefined}
          actions={<>
            {/* Inspector links have nowhere to go "back" to — no link, so it doesn't loop. */}
            {!portalToken && <Btn href={backHref}><ArrowLeft size={13} aria-hidden /> {backLabel}</Btn>}
            {/* Draft autosave status — reassures the inspector their work is saved
                as they go, so leaving before Submit won't lose photos/conditions. */}
            {!formLocked && autosaveState === 'error' && (
              <Btn variant="danger" onClick={() => void saveDraft()}><AlertCircle size={13} aria-hidden /> Couldn’t save — retry</Btn>
            )}
            {!formLocked && autosaveState === 'saving' && <Pill tone="neutral">Saving…</Pill>}
            {!formLocked && autosaveState === 'saved' && <Pill tone="primary">Draft saved</Pill>}
            <Btn onClick={() => window.print()}><Printer size={13} aria-hidden /> Print</Btn>
            {meta && <Btn onClick={() => void downloadInspectionPdf()}><Download size={13} aria-hidden /> Download PDF</Btn>}
            {!formLocked && <span className="hidden sm:inline-flex">{submitBtn}</span>}
          </>}
        />

        <ScopeStrip items={[
          ...(portalToken ? [{ label: 'Access', value: 'Inspector link' }] : [
            { label: 'Workspace', value: 'Operations' },
            { label: 'Vertical', value: 'Long-term leases' },
          ]),
          { label: 'Contract', value: refLabel },
          { label: 'Inspection', value: isMoveIn ? 'Move-in' : 'Move-out' },
          { label: 'Status', value: <Pill tone={status.tone}>{status.label}</Pill> },
        ]} />
      </div>

      {/* Status banners */}
      <div className="print:hidden" style={{ display: 'grid', gap: 10 }}>
        {fullySigned && (
          <Callout title="Inspection fully signed — tenancy activated ✓">Both parties have signed. The tenancy contract is now active.</Callout>
        )}
        {!fullySigned && tenantSigned && (
          <Callout tone="warn" title="Tenant has signed — your counter-signature required.">Sign below to counter-sign and automatically activate the tenancy.</Callout>
        )}
        {!tenantSigned && formLocked && (
          <Callout title="Inspection submitted — awaiting customer counter-signature.">
            {portalToken
              ? `The customer signs this ${isMoveIn ? 'move-in' : 'move-out'} inspection from their portal — you can counter-sign here once they do.`
              : `Send the tenant a secure link to sign this ${isMoveIn ? 'move-in' : 'move-out'} inspection from their portal. You can counter-sign once they do.`}
            {!portalToken && (
              <div className="gx-btn-row" style={{ marginTop: 8 }}>
                {meta?.tenantId && contractId && (
                  <PortalLinkButton
                    tenantId={meta.tenantId}
                    contractId={Number(contractId)}
                    purpose={inspType}
                    label={`Send ${isMoveIn ? 'move-in' : 'move-out'} signing link`}
                  />
                )}
                {/* Reopen for editing — only while the customer hasn't signed. */}
                <Btn size="sm" variant="amber" onClick={() => void handleReopen()} disabled={reopening}>
                  {reopening ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RotateCcw size={12} aria-hidden />} Undo submission &amp; edit
                </Btn>
              </div>
            )}
          </Callout>
        )}
        {saved && !formLocked && <Callout title="Inspection saved successfully." >Your checklist is stored.</Callout>}
        {error && <Callout tone="bad">{error}</Callout>}
      </div>

      <div className="print:hidden" style={{ marginTop: 14 }}>
        <Card title="Sign-off" sub={isMoveIn ? 'The counter-signature activates the tenancy.' : 'The signed move-out checklist supports the final settlement.'}>
          <div className="gx-pad">
            <Flow current={flowCurrent} steps={[
              { t: 'Fill the checklist', s: 'conditions, photos, notes' },
              { t: 'Submit', s: data.rpSubmittedAt ? fmtDate(data.rpSubmittedAt) : 'locks the form' },
              { t: 'Customer signs', s: data.tenantSignedAt ? fmtDate(data.tenantSignedAt) : 'from their portal' },
              { t: 'Counter-sign', s: data.rpCounterSignedAt ? fmtDate(data.rpCounterSignedAt) : 'inspector' },
            ]} />
          </div>
        </Card>
      </div>

      {/* Printable report header — customer, property + key dates */}
      {meta && (
        <div style={{ marginTop: 14 }}>
          <Card title={`${title} Report`} right={<span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Contract #{contractId}</span>}>
            <div className="gx-pad">
              <KV items={[
                { k: 'Tenant name', v: meta.tenantName || '—' },
                { k: 'Tenant mobile', v: meta.tenantPhone || '—' },
                { k: `${title} date`, v: fmtDate(data.inspectionDate ?? data.reportGeneratedDate) },
                { k: 'Building', v: meta.property || '—' },
                { k: 'Unit no.', v: meta.unit || '—' },
                { k: 'Inspector', v: data.inspectorName || '—' },
                { k: 'Handover date', v: fmtDate(meta.moveInDate) },
                { k: 'Contract end date', v: fmtDate(meta.contractEndDate) },
              ]} />
            </div>
          </Card>
        </div>
      )}

      {/* Form (locked when RP has submitted). Disabled while submitting too, so no
          edit can slip in (and re-arm an autosave) during the finalize request. */}
      <fieldset disabled={formLocked || saving} className={`space-y-4 ${formLocked ? 'opacity-95' : ''}`} style={{ marginTop: 14, border: 0, padding: 0, minWidth: 0 }}>

        {/* Legend */}
        <div className="gx-scope" style={{ marginBottom: 0 }}>
          <span className="sl">Condition</span>
          <LegendChip letter="G" label="Good"    color="bg-[#047246]" />
          <LegendChip letter="F" label="Fair"    color="bg-[#f59e0b]" />
          <LegendChip letter="D" label="Damaged" color="bg-[#ef4444]" />
        </div>

        {/* Editable inspection fields (customer/property shown in the report header above) */}
        <div className="print:hidden">
          <Card title="Inspection details">
            <div className="gx-pad gx-two">
              <Field label={isMoveIn ? 'Move-In Date' : 'Move-Out Date'} htmlFor="li-date">
                <input id="li-date" className="gx-inp" type="date" value={data.moveInDate} style={{ width: '100%' }}
                  onChange={e => updateData(d => ({ ...d, moveInDate: e.target.value }))} />
              </Field>
              <Field label="Inspector Name" htmlFor="li-inspector">
                <input id="li-inspector" className="gx-inp" type="text" value={data.inspectorName} placeholder="Inspector full name" style={{ width: '100%' }}
                  onChange={e => updateData(d => ({ ...d, inspectorName: e.target.value }))} />
              </Field>
              <Field label="Report Generated Date" htmlFor="li-generated">
                <input id="li-generated" className="gx-inp" type="date" value={data.reportGeneratedDate} style={{ width: '100%' }}
                  onChange={e => updateData(d => ({ ...d, reportGeneratedDate: e.target.value }))} />
              </Field>
              {/* Inspection date is auto-set when the RP counter-signs — read-only if set */}
              {data.inspectionDate && (
                <Field label="Inspection Date" htmlFor="li-inspected">
                  <input id="li-inspected" className="gx-inp" type="text" disabled style={{ width: '100%' }}
                    value={new Date(data.inspectionDate).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' })} />
                </Field>
              )}
            </div>
          </Card>
        </div>

        {/* Areas */}
        <div className="space-y-4">
          {data.areas.map((area, idx) => (
            <AreaBlock
              key={area.id}
              area={area}
              areaIndex={idx}
              inspType={inspType}
              contractId={Number(contractId)}
              onChange={updated => updateData(d => ({ ...d, areas: d.areas.map(a => a.id === area.id ? updated : a) }))}
              onRemove={() => updateData(d => ({ ...d, areas: d.areas.filter(a => a.id !== area.id) }))}
              onItemPhotosAdd={(itemId, added) => addItemPhotos(area.id, itemId, added)}
              onItemPhotosRemove={(itemId, photoId) => removeItemPhoto(area.id, itemId, photoId)}
              canRemove={data.areas.length > 1}
              isLocked={formLocked}
              portalToken={portalToken}
            />
          ))}

          {!formLocked && (
            <div className="print:hidden">
              <Btn onClick={() => updateData(d => ({ ...d, areas: [...d.areas, makeDefaultArea(d.areas.length + 1)] }))}>
                <Plus size={13} aria-hidden /> Add area
              </Btn>
            </div>
          )}
        </div>

        {/* General notes */}
        <Card title="General Notes" sub="meter readings, key handover, damages, etc.">
          <div className="gx-pad">
            <textarea className="gx-ta" value={data.generalNotes} rows={3} style={{ width: '100%' }} aria-label="General notes"
              onChange={e => updateData(d => ({ ...d, generalNotes: e.target.value }))}
              placeholder="Overall observations, utility meter readings, keys handed over…" />
          </div>
        </Card>

        {/* Bottom submit — hidden on mobile (the sticky bar carries it there) */}
        {!formLocked && (
          <div className="hidden sm:flex justify-end print:hidden">{submitBtn}</div>
        )}
      </fieldset>

      {/* ── Photo Gallery (after form) ───────────────────────────────────── */}
      <div style={{ marginTop: 14 }}><PhotoGallery areas={data.areas} globalPhotos={data.photos} /></div>

      {/* Acknowledgement — both parties confirm the recorded condition before signing */}
      <div style={{ marginTop: 14 }}>
        <Evid>
          {isMoveIn
            ? `The tenant and rental provider confirm that ${meta?.unit ? `Unit ${meta.unit}` : 'the unit'}${meta?.property ? ` at ${meta.property}` : ''} was inspected together and that the condition recorded above accurately reflects its state at handover / move-in.`
            : `The tenant and rental provider confirm that ${meta?.unit ? `Unit ${meta.unit}` : 'the unit'}${meta?.property ? ` at ${meta.property}` : ''} was inspected together at move-out and that the condition recorded above accurately reflects its state. Any damages or outstanding dues noted may be deducted from the security deposit as part of the final settlement.`}
        </Evid>
      </div>

      {/* ── Signature row: Customer Signature | Inspector Signature ─────────
           Customer column: placeholder until the customer signs. Inspector column:
           sig pad when awaiting counter-sign, image once done. */}
      <div className="gx-cols gx-cols-2e" style={{ marginTop: 14 }}>
        <Card title="Customer Signature" sub="Signed from the customer portal.">
          <div className="gx-pad">
            {data.tenantSig ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ border: '1px solid var(--ms-border)', borderRadius: 8, padding: 8, display: 'flex', justifyContent: 'center', background: '#fff' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.tenantSig} alt="Customer signature" style={{ maxHeight: 112, objectFit: 'contain' }} />
                </div>
                {data.tenantSignedAt && <Pill tone="primary">Signed {fmtStamp(data.tenantSignedAt)}</Pill>}
              </div>
            ) : (
              <div className="gx-empty"><b>Awaiting customer signature.</b></div>
            )}
          </div>
        </Card>

        <Card title="Inspector Signature" sub={fullySigned ? 'Inspection counter-signed — tenancy activated.' : tenantSigned ? 'Sign to counter-sign and activate the tenancy.' : 'Available once the customer has signed.'}>
          <div className="gx-pad">
            {fullySigned && data.rpCounterSig ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ border: '1px solid var(--ms-border)', borderRadius: 8, padding: 8, display: 'flex', justifyContent: 'center', background: '#fff' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.rpCounterSig} alt="Inspector signature" style={{ maxHeight: 112, objectFit: 'contain' }} />
                </div>
                {data.rpCounterSignedAt && <Pill tone="primary">Counter-signed {fmtStamp(data.rpCounterSignedAt)}</Pill>}
              </div>
            ) : tenantSigned && !fullySigned ? (
              <SignatureBlock
                signerRole="Inspector"
                signerName={data.inspectorName?.trim() || 'Inspection Manager'}
                onBehalfOf="the rental provider"
                defaultName={data.inspectorName?.trim() || ''}
                termsText={`I confirm the condition recorded in this ${inspType === 'move_out' ? 'move-out' : 'move-in'} inspection is accurate.`}
                submitLabel="Sign & Activate Tenancy"
                alreadySigned={false}
                onSign={handleCounterSign}
              />
            ) : (
              <div className="gx-empty"><b>Awaiting customer signature first.</b></div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Move-in photos (reference) — move-out only, read-only ────────── */}
      {!isMoveIn && (data.moveInPhotos?.length ?? 0) > 0 && (
        <div className="print:hidden" style={{ marginTop: 14 }}>
          <Card title="Move-In Photos" sub="reference · read-only">
            <div className="gx-pad grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {data.moveInPhotos!.map(p => (
                <button key={p.id} type="button" onClick={() => openDocViewer({ fileUrl: displayUrl(p.url), caption: p.caption })}
                  className="block w-full text-left rounded-xl overflow-hidden border border-[#e4e9e5] hover:border-[#047246] transition-colors cursor-pointer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={displayUrl(p.url)} alt={p.caption || 'Move-in photo'} className="w-full h-32 object-cover" />
                  {p.caption && <p className="text-[10px] text-[#5f6b63] px-2 py-1 truncate">{p.caption}</p>}
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Inspection photos — screen only, hidden in print ─────────────── */}
      <div className="print:hidden" style={{ marginTop: 14 }}>
        <PhotosSection
          contractId={Number(contractId)}
          inspType={inspType}
          photos={data.photos}
          onChange={photos => updateData(d => ({ ...d, photos }))}
          onAdd={added => updateData(d => ({ ...d, photos: [...d.photos, ...added] }))}
          disabled={formLocked}
          portalToken={portalToken}
        />
      </div>

      {/* ── Sticky submit (mobile only) — keeps the primary action reachable on a
           long, scrolling form without hunting for the button. ───────────── */}
      {!formLocked && (
        <div className="fixed inset-x-0 bottom-0 z-30 sm:hidden print:hidden bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.08)] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
          <button type="button" onClick={handleSave} disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white bg-[#047246] active:bg-[#267a65] disabled:opacity-60 transition-colors">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving…' : 'Submit Inspection'}
          </button>
        </div>
      )}
    </OsPage>
  );
}
