'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useState, useEffect, useCallback, useRef, createElement } from 'react';
import { useParams, useSearchParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Trash2, Save, Printer, Download, ArrowLeft, CheckCircle, Loader2,
  AlertCircle, RotateCcw, UploadCloud, X, Camera, Paperclip, Images,
  FileSignature, Send, Receipt, Check,
} from 'lucide-react';
import { openDocViewer } from '@/lib/docViewer';
import { triggerBrowserDownload } from '@/lib/downloadDoc';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';

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

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-[#1a1916]">{value || '—'}</p>
    </div>
  );
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
      <div className="mt-2 flex items-center gap-2 print:hidden">
        <input readOnly value={link} onFocus={e => e.currentTarget.select()}
          className="flex-1 text-[11px] px-2 py-1.5 rounded-lg border border-[#e8e6e0] bg-[#fafaf8] text-[#1a1916]" />
        <button type="button"
          onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-[#2e9f82] text-white">{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
    );
  }
  return (
    <button type="button" onClick={send} disabled={state === 'sending'}
      className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-[#2e9f82] text-[#2e9f82] disabled:opacity-60 print:hidden">
      <Send size={12} /> {state === 'sending' ? 'Generating…' : state === 'error' ? 'Retry' : label}
    </button>
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
    { v: 'G' as Condition, active: 'bg-[#2e9f82] text-white border-transparent' },
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
            value === o.v ? o.active : 'border-[#e8e6e0] text-[#9b9890] hover:border-[#c8c6be] bg-white',
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
        <div key={a.id} className="group relative w-16 h-16 sm:w-14 sm:h-14 rounded-lg border border-[#e8e6e0] overflow-hidden shrink-0 bg-[#f4f3ef]">
          <button type="button" onClick={() => openDocViewer({ fileUrl: displayUrl(a.url), caption: 'Attachment' })} className="block w-full h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={displayUrl(a.url)} alt="attachment" className="w-full h-full object-cover" />
          </button>
          {onRemove && (
            <button type="button" onClick={() => onRemove(a.id)} aria-label="Remove photo"
              className="absolute top-0.5 right-0.5 w-6 h-6 sm:w-5 sm:h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <X size={12} />
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
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#c8c6be] text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82] disabled:opacity-50 transition-colors h-11 px-4 text-xs font-semibold sm:h-8 sm:px-3"
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
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 bg-[#fafaf8] border-b border-[#f4f3ef]">
        <div className="flex-1 flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-[11px] sm:text-xs font-bold text-[#9b9890] uppercase tracking-wide w-12 sm:w-14 shrink-0">
            Area {areaIndex + 1}
          </span>
          <input
            type="text"
            value={area.name}
            onChange={e => onChange({ ...area, name: e.target.value })}
            placeholder="e.g. Bedroom 1, Kitchen…"
            className="flex-1 min-w-0 text-base sm:text-sm font-semibold text-[#1a1916] bg-transparent border-b border-transparent focus:border-[#2e9f82] focus:outline-none pb-0.5 transition-colors"
          />
        </div>
        {canRemove && !isLocked && (
          <button type="button" onClick={onRemove} aria-label="Remove area" className="text-[#9b9890] hover:text-[#ef4444] transition-colors shrink-0 p-1.5 -m-1.5">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Items table */}
      <div className="px-4 sm:px-5 pt-3 pb-2">
        {/* Column header — desktop only; on mobile each row is self-describing */}
        <div className="hidden sm:grid gap-2 mb-2 pb-1.5 border-b border-[#f4f3ef] grid-cols-[1fr_6rem_7rem_1.5rem]">
          <span className="text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide">Item</span>
          <span className="text-[10px] font-semibold text-[#2e9f82] uppercase tracking-wide text-center">{isMoveOut ? 'Move-Out' : 'Condition'}</span>
          <span className="text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide text-center">Attach</span>
          <span />
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
            className="flex flex-col gap-3 py-3 border-b border-[#f9f8f6] last:border-0 sm:gap-2 sm:py-1.5 sm:items-center sm:grid sm:grid-cols-[1fr_6rem_7rem_1.5rem]"
          >
            {/* Item name */}
            <div className="min-w-0">
              {item.isCustom && !isLocked ? (
                <input
                  type="text"
                  value={item.name}
                  onChange={e => updateItem(item.id, { name: e.target.value })}
                  placeholder="Item name…"
                  className="w-full text-base sm:text-sm text-[#1a1916] border-b border-dashed border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none bg-transparent pb-0.5"
                />
              ) : (
                <span className="text-[15px] sm:text-sm font-medium text-[#1a1916]">{item.name}</span>
              )}
            </div>

            {/* Condition (custom-item delete rides this row on mobile).
                Move-out edits `outCondition` (pre-filled from the move-in
                baseline on load); move-in edits `inCondition`. */}
            <div className="flex items-center gap-3 sm:justify-center">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9b9890] w-16 shrink-0 sm:hidden">Condition</span>
              <ConditionPicker
                value={isMoveOut ? item.outCondition : item.inCondition}
                onChange={v => !isLocked && updateItem(item.id, isMoveOut ? { outCondition: v } : { inCondition: v })}
              />
              {item.isCustom && !isLocked && (
                <button type="button" onClick={() => removeItem(item.id)} aria-label="Remove item"
                  className="ml-auto sm:hidden text-[#c8c6be] hover:text-[#ef4444] transition-colors p-2 -m-2">
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {/* Attach control */}
            <div className="flex items-center gap-3 sm:justify-center">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9b9890] w-16 shrink-0 sm:hidden">Photos</span>
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
                <span className="text-xs text-[#9b9890] sm:hidden">
                  {itemPhotos.length ? `${itemPhotos.length} photo${itemPhotos.length > 1 ? 's' : ''}` : 'No photos'}
                </span>
              )}
            </div>

            {/* Custom-item delete — desktop grid cell only */}
            <div className="hidden sm:flex sm:justify-center sm:w-6">
              {item.isCustom && !isLocked && (
                <button type="button" onClick={() => removeItem(item.id)} aria-label="Remove item" className="text-[#c8c6be] hover:text-[#ef4444] transition-colors p-1 -m-1">
                  <Trash2 size={14} />
                </button>
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
          <button type="button" onClick={addItem} className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:opacity-75 mt-3 mb-1 transition-opacity">
            <Plus size={12} /> Add item
          </button>
        )}
      </div>

      {/* Remarks */}
      <div className="px-4 sm:px-5 pb-4">
        <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1">Remarks</label>
        <textarea
          value={area.remarks}
          onChange={e => onChange({ ...area, remarks: e.target.value })}
          placeholder="Notes, damages, or specific observations for this area…"
          rows={2}
          className="w-full text-base sm:text-sm text-[#1a1916] border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors resize-none bg-[#fafaf8]"
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
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5">
          <Camera size={14} className="text-[#2e9f82]" /> {heading}
          {isMoveIn && <span className="ml-1.5 text-[#ef4444] text-xs font-normal">* recommended</span>}
        </h2>
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map(p => (
            <div key={p.id} className="relative group rounded-xl overflow-hidden border border-[#e8e6e0] bg-[#f4f3ef]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl(p.url)} alt={p.caption || 'Inspection photo'} className="w-full h-32 object-cover" />
              {!disabled && (
                <button type="button" onClick={() => onChange(photos.filter(x => x.id !== p.id))} aria-label="Remove photo"
                  className="absolute top-1.5 right-1.5 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-red-600 print:hidden">
                  <X size={13} />
                </button>
              )}
              <input type="text" value={p.caption} readOnly={disabled} disabled={disabled}
                onChange={e => onChange(photos.map(x => x.id === p.id ? { ...x, caption: e.target.value } : x))}
                placeholder={disabled ? '' : 'Caption (e.g. living room)'}
                className="w-full text-xs sm:text-[10px] px-2 py-1.5 sm:py-1 border-t border-[#e8e6e0] focus:outline-none focus:bg-[#f0faf6] bg-white disabled:bg-[#f4f3ef] disabled:text-[#6b6860]"
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
            className="flex items-center gap-2 w-full justify-center py-4 sm:py-3 rounded-xl border-2 border-dashed border-[#d8d6d0] text-sm font-semibold text-[#9b9890] hover:border-[#2e9f82] hover:text-[#2e9f82] active:border-[#2e9f82] active:text-[#2e9f82] disabled:opacity-50 transition-colors print:hidden">
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
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-4">
      <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5">
        <Images size={14} className="text-[#2e9f82]" /> Photo Gallery
        <span className="text-xs font-normal text-[#9b9890] ml-1">(RP view — per-item attachments not shown to tenant)</span>
      </h2>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap border-b border-[#f4f3ef] pb-2">
        {tabs.map(tab => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
            className={[
              'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
              activeTab === tab.id
                ? 'bg-[#2e9f82] text-white'
                : 'bg-[#f4f3ef] text-[#6b6860] hover:bg-[#e8f9f4] hover:text-[#2e9f82]',
            ].join(' ')}>
            {tab.label}
          </button>
        ))}
      </div>

      {displayed.length === 0 ? (
        <p className="text-xs text-[#9b9890]">No photos in this tab.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {displayed.map(p => (
            <button key={p.id} type="button" onClick={() => openDocViewer({ fileUrl: displayUrl(p.url), caption: p.caption })}
              className="block w-full text-left rounded-xl overflow-hidden border border-[#e8e6e0] hover:border-[#2e9f82] transition-colors cursor-pointer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl(p.url)} alt={p.caption || 'photo'} className="w-full h-32 object-cover" />
              {p.caption && <p className="text-[10px] text-[#6b6860] px-2 py-1 truncate">{p.caption}</p>}
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
      <span className="text-[#6b6860]">{label}</span>
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
    return <div className="flex items-center justify-center h-[60vh] text-[#9b9890]"><Loader2 className="animate-spin mr-2" /> Opening inspection…</div>;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-[#2e9f82]" size={28} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pt-6 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] sm:py-8 space-y-6 print:px-0 print:py-0 print:pb-0">

      {/* Topbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          {/* Inspector links have nowhere to go "back" to (the contract page just
              redirects here) — drop the link so it doesn't loop. */}
          {portalToken ? null : (
            <Link href={backHref} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] transition-colors">
              <ArrowLeft size={15} /> {backLabel}
            </Link>
          )}
          {/* Draft autosave status — reassures the inspector their work is saved as
              they go, so leaving before tapping Submit won't lose photos/conditions. */}
          {!formLocked && autosaveState !== 'idle' && (
            autosaveState === 'error' ? (
              <button type="button" onClick={() => void saveDraft()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#dc2626]">
                <AlertCircle size={12} /> Couldn’t save — retry
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9b9890]">
                {autosaveState === 'saving'
                  ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                  : <><CheckCircle size={12} className="text-[#2e9f82]" /> Draft saved</>}
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] transition-colors">
            <Printer size={14} /> Print
          </button>
          {meta && (
            <button onClick={downloadInspectionPdf} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] transition-colors">
              <Download size={14} /> Download PDF
            </button>
          )}
          {!formLocked && (
            <button onClick={handleSave} disabled={saving}
              className="hidden sm:flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Submit Inspection'}
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-[#1a1916]">{title} Checklist</h1>
        {meta && (
          <p className="text-sm text-[#9b9890] mt-0.5">
            {meta.property}{meta.unit ? ` — Unit ${meta.unit}` : ''} · Contract #{contractId}
          </p>
        )}
      </div>

      {/* Printable report header — tenant, property + key dates */}
      {meta && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#f4f3ef]">
            <h2 className="text-base font-bold text-[#1a1916]">{title} Report</h2>
            <span className="text-xs text-[#9b9890]">Contract #{contractId}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            <InfoCell label="Tenant name" value={meta.tenantName} />
            <InfoCell label="Tenant mobile" value={meta.tenantPhone} />
            <InfoCell label={`${title} date`} value={fmtDate(data.inspectionDate ?? data.reportGeneratedDate)} />
            <InfoCell label="Building" value={meta.property} />
            <InfoCell label="Unit no." value={meta.unit} />
            <InfoCell label="Inspector" value={data.inspectorName} />
            <InfoCell label="Handover date" value={fmtDate(meta.moveInDate)} />
            <InfoCell label="Contract end date" value={fmtDate(meta.contractEndDate)} />
          </div>
        </div>
      )}

      {/* Status banners */}
      {fullySigned && (
        <div className="flex items-start gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3 print:hidden">
          <CheckCircle size={14} className="text-[#2e9f82] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#1a7a5a]">Inspection fully signed — tenancy activated ✓</p>
            <p className="text-xs text-[#1a7a5a] mt-0.5">Both parties have signed. The tenancy contract is now active.</p>
          </div>
        </div>
      )}
      {!fullySigned && tenantSigned && (
        <div className="flex items-start gap-2 text-sm bg-[#fff7ed] border border-[#fed7aa] rounded-xl px-4 py-3 print:hidden">
          <AlertCircle size={14} className="text-[#c2410c] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#9a3412]">Tenant has signed — your counter-signature required</p>
            <p className="text-xs text-[#c2410c] mt-0.5">Sign below to counter-sign and automatically activate the tenancy.</p>
          </div>
        </div>
      )}
      {!tenantSigned && formLocked && (
        <div className="flex items-start gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3 print:hidden">
          <CheckCircle size={14} className="text-[#2e9f82] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-[#1a7a5a]">Inspection submitted — awaiting customer counter-signature</p>
            <p className="text-xs text-[#1a7a5a] mt-0.5">
              {portalToken
                ? `The customer signs this ${isMoveIn ? 'move-in' : 'move-out'} inspection from their portal — you can counter-sign here once they do.`
                : `Send the tenant a secure link to sign this ${isMoveIn ? 'move-in' : 'move-out'} inspection from their portal. You can counter-sign once they do.`}
            </p>
            {!portalToken && meta?.tenantId && contractId && (
              <PortalLinkButton
                tenantId={meta.tenantId}
                contractId={Number(contractId)}
                purpose={inspType}
                label={`Send ${isMoveIn ? 'move-in' : 'move-out'} signing link`}
              />
            )}
            {/* Reopen for editing — only while the customer hasn't signed. */}
            {!portalToken && (
              <button type="button" onClick={handleReopen} disabled={reopening}
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-[#c2410c] text-[#c2410c] disabled:opacity-60 print:hidden">
                {reopening ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                Undo submission &amp; edit
              </button>
            )}
          </div>
        </div>
      )}
      {saved && !formLocked && (
        <div className="flex items-start gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3 print:hidden">
          <CheckCircle size={14} className="text-[#2e9f82] shrink-0 mt-0.5" />
          <p className="font-semibold text-[#1a7a5a]">Inspection saved successfully.</p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-[#dc2626] bg-[#fef2f2] rounded-xl px-4 py-3 print:hidden">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Form (locked when RP has submitted) */}
      {/* Disabled while submitting too, so no edit can slip in (and re-arm an
          autosave) during the finalize request before the form locks. */}
      <fieldset disabled={formLocked || saving} className={`space-y-6 ${formLocked ? 'opacity-95' : ''}`}>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#f9f8f6] rounded-xl px-4 py-3 print:bg-white print:border print:border-gray-200">
          <span className="text-xs font-semibold text-[#6b6860] uppercase tracking-wide">Condition:</span>
          <LegendChip letter="G" label="Good"    color="bg-[#2e9f82]" />
          <LegendChip letter="F" label="Fair"    color="bg-[#f59e0b]" />
          <LegendChip letter="D" label="Damaged" color="bg-[#ef4444]" />
        </div>

        {/* Header info — editable inspection fields (tenant/property shown in the report header above) */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 print:hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">{isMoveIn ? 'Move-In Date' : 'Move-Out Date'}</label>
              <input type="date" value={data.moveInDate}
                onChange={e => updateData(d => ({ ...d, moveInDate: e.target.value }))}
                className="w-full text-base sm:text-sm border border-[#e8e6e0] rounded-xl px-3 py-2.5 sm:py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Inspector Name</label>
              <input type="text" value={data.inspectorName}
                onChange={e => updateData(d => ({ ...d, inspectorName: e.target.value }))}
                placeholder="Inspector full name"
                className="w-full text-base sm:text-sm border border-[#e8e6e0] rounded-xl px-3 py-2.5 sm:py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">
                Report Generated Date
              </label>
              <input type="date" value={data.reportGeneratedDate}
                onChange={e => updateData(d => ({ ...d, reportGeneratedDate: e.target.value }))}
                className="w-full text-base sm:text-sm border border-[#e8e6e0] rounded-xl px-3 py-2.5 sm:py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
              />
            </div>
            {/* Inspection date is auto-set when RP counter-signs — shown read-only if set */}
            {data.inspectionDate && (
              <div>
                <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Inspection Date</label>
                <input type="text" value={new Date(data.inspectionDate).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' })} disabled
                  className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 bg-[#f9f8f6] text-[#6b6860]" />
              </div>
            )}
          </div>
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
            <button type="button"
              onClick={() => updateData(d => ({ ...d, areas: [...d.areas, makeDefaultArea(d.areas.length + 1)] }))}
              className="flex items-center gap-2 w-full justify-center py-3 rounded-2xl border-2 border-dashed border-[#d8d6d0] text-sm font-semibold text-[#9b9890] hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors print:hidden">
              <Plus size={15} /> Add area
            </button>
          )}
        </div>

        {/* General notes */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
          <label className="block text-sm font-semibold text-[#1a1916] mb-3">
            General Notes
            <span className="text-[#9b9890] font-normal text-xs ml-2">meter readings, key handover, damages, etc.</span>
          </label>
          <textarea value={data.generalNotes}
            onChange={e => updateData(d => ({ ...d, generalNotes: e.target.value }))}
            placeholder="Overall observations, utility meter readings, keys handed over…"
            rows={3}
            className="w-full text-base sm:text-sm border border-[#e8e6e0] rounded-xl px-4 py-3 focus:outline-none focus:border-[#2e9f82] transition-colors resize-none"
          />
        </div>

        {/* Bottom submit bar — hidden on mobile (the sticky bar carries it there) */}
        {!formLocked && (
          <div className="hidden sm:flex justify-end pt-2 pb-8 print:hidden">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Submit Inspection'}
            </button>
          </div>
        )}

      </fieldset>

      {/* ── Photo Gallery (after form) ───────────────────────────────────── */}
      <PhotoGallery areas={data.areas} globalPhotos={data.photos} />

      {/* Acknowledgement — both parties confirm the recorded condition before signing */}
      <div className="bg-[#fafaf8] border border-[#f0efe9] rounded-2xl p-4 text-xs text-[#4b4b46] leading-relaxed">
        {isMoveIn
          ? `The tenant and rental provider confirm that ${meta?.unit ? `Unit ${meta.unit}` : 'the unit'}${meta?.property ? ` at ${meta.property}` : ''} was inspected together and that the condition recorded above accurately reflects its state at handover / move-in.`
          : `The tenant and rental provider confirm that ${meta?.unit ? `Unit ${meta.unit}` : 'the unit'}${meta?.property ? ` at ${meta.property}` : ''} was inspected together at move-out and that the condition recorded above accurately reflects its state. Any damages or outstanding dues noted may be deducted from the security deposit as part of the final settlement.`}
      </div>

      {/* ── Signature row: Customer Signature | Inspector Signature ─────────
           Customer column: always shown (placeholder until tenant signs).
           Inspector column: sig pad when awaiting counter-sign, image once done.
           Stacks on mobile so each pad is wide enough to actually sign. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Customer Signature */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-[#1a1916]">Customer Signature</h2>
            <p className="text-xs text-[#9b9890] mt-0.5">Signed from the tenant portal.</p>
          </div>
          {data.tenantSig ? (
            <div className="rounded-xl border border-[#c5e8df] bg-[#f0faf6] p-3 space-y-1">
              <div className="bg-white rounded-lg border border-[#e8e6e0] p-2 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.tenantSig} alt="Customer signature" className="max-h-28 object-contain" />
              </div>
              {data.tenantSignedAt && (
                <p className="text-[10px] text-[#1a7a5a] flex items-center gap-1">
                  <CheckCircle size={10} /> Signed {new Date(data.tenantSignedAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#d8d6d0] bg-[#fafaf8] px-3 py-8 text-center">
              <p className="text-[11px] text-[#9b9890]">Awaiting customer signature.</p>
            </div>
          )}
        </div>

        {/* Inspector Signature */}
        <div className={`bg-white rounded-2xl border p-5 space-y-3 ${fullySigned ? 'border-[#c5e8df]' : tenantSigned ? 'border-[#fed7aa]' : 'border-[#e8e6e0]'}`}>
          <div>
            <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5">
              <FileSignature size={14} className="text-[#2e9f82]" /> Inspector Signature
            </h2>
            <p className="text-xs text-[#9b9890] mt-0.5">
              {fullySigned ? 'Inspection counter-signed — tenancy activated.' : tenantSigned ? 'Sign to counter-sign and activate the tenancy.' : 'Available once the customer has signed.'}
            </p>
          </div>

          {fullySigned && data.rpCounterSig ? (
            <div className="rounded-xl border border-[#c5e8df] bg-[#f0faf6] p-3 space-y-1">
              <div className="bg-white rounded-lg border border-[#e8e6e0] p-2 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.rpCounterSig} alt="Inspector signature" className="max-h-28 object-contain" />
              </div>
              {data.rpCounterSignedAt && (
                <p className="text-[10px] text-[#1a7a5a] flex items-center gap-1">
                  <CheckCircle size={10} /> Counter-signed {new Date(data.rpCounterSignedAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
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
            <div className="rounded-xl border border-dashed border-[#d8d6d0] bg-[#fafaf8] px-3 py-8 text-center">
              <p className="text-[11px] text-[#9b9890]">Awaiting customer signature first.</p>
            </div>
          )}
        </div>

      </div>

      {/* ── Move-in photos (reference) — move-out only, read-only ────────── */}
      {!isMoveIn && (data.moveInPhotos?.length ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-4 print:hidden">
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5">
            <Images size={14} className="text-[#9b9890]" /> Move-In Photos
            <span className="ml-1.5 text-[#9b9890] text-xs font-normal">reference · read-only</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {data.moveInPhotos!.map(p => (
              <button key={p.id} type="button" onClick={() => openDocViewer({ fileUrl: displayUrl(p.url), caption: p.caption })}
                className="block w-full text-left rounded-xl overflow-hidden border border-[#e8e6e0] hover:border-[#2e9f82] transition-colors cursor-pointer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={displayUrl(p.url)} alt={p.caption || 'Move-in photo'} className="w-full h-32 object-cover" />
                {p.caption && <p className="text-[10px] text-[#6b6860] px-2 py-1 truncate">{p.caption}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Move-In Photos — screen only, hidden in print ────────────────── */}
      <div className="print:hidden">
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

      {/* ── Sticky submit (mobile only) — keeps the primary action reachable
           on a long, scrolling form without hunting for the button. ───────── */}
      {!formLocked && (
        <div className="fixed inset-x-0 bottom-0 z-30 sm:hidden print:hidden bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.08)] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
          <button onClick={handleSave} disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white bg-[#2e9f82] active:bg-[#267a65] disabled:opacity-60 transition-colors">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving…' : 'Submit Inspection'}
          </button>
        </div>
      )}

    </div>
  );
}
