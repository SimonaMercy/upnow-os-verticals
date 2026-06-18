'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Trash2, Save, Printer, ArrowLeft, CheckCircle, Loader2,
  AlertCircle, RotateCcw, UploadCloud, X, Camera, Paperclip, Images,
  FileSignature, Send,
} from 'lucide-react';
import { openDocViewer } from '@/lib/docViewer';

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
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
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
    <div className="flex gap-1">
      {opts.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(value === o.v ? '' : o.v)}
          className={[
            'w-7 h-7 rounded-md text-xs font-bold border transition-all',
            value === o.v ? o.active : 'border-[#e8e6e0] text-[#9b9890] hover:border-[#c8c6be] bg-white',
          ].join(' ')}
        >
          {o.v}
        </button>
      ))}
    </div>
  );
}

// ─── Per-item attachment upload ───────────────────────────────────────────────

function ItemAttachmentButton({
  contractId, itemId, attachments, onChange, disabled, portalToken,
}: {
  contractId: number;
  itemId: string;
  attachments: ItemAttachment[];
  onChange: (updated: ItemAttachment[]) => void;
  disabled?: boolean;
  portalToken?: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true); setErr(null);
    try {
      const docBody = {
        documentKey: `insp_item_${itemId}_${Date.now()}`,
        mimeType: file.type, originalName: file.name,
      };
      const urlRes = await fetch(portalToken
        ? `/api/portal/${portalToken}/contracts/${contractId}/inspection/upload-url`
        : '/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portalToken
          ? docBody
          : { ownerType: 'tenancy_contract', ownerId: contractId, ...docBody }),
      });
      if (!urlRes.ok) { setErr('Upload URL failed'); return; }
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const put = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) { setErr('Upload failed'); return; }
      onChange([...attachments, { id: uid(), url: fileUrl }]);
    } catch { setErr('Unexpected error'); }
    finally { setUploading(false); }
  }

  if (disabled) {
    return attachments.length > 0 ? (
      <div className="flex gap-1 flex-wrap">
        {attachments.map(a => (
          <button key={a.id} type="button" onClick={() => openDocViewer({ fileUrl: a.url, caption: 'Attachment' })}
            className="block w-8 h-8 rounded-md border border-[#e8e6e0] overflow-hidden shrink-0 hover:border-[#2e9f82] cursor-pointer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt="attachment" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    ) : null;
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {attachments.map(a => (
        <div key={a.id} className="relative group w-8 h-8 rounded-md border border-[#e8e6e0] overflow-hidden shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.url} alt="attachment" className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(attachments.filter(x => x.id !== a.id))}
            className="absolute inset-0 bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
        onChange={async e => {
          const files = Array.from(e.target.files ?? []);
          for (const f of files) await upload(f);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Attach photos to this item (RP only)"
        className="w-8 h-8 rounded-md border border-dashed border-[#c8c6be] text-[#9b9890] hover:border-[#2e9f82] hover:text-[#2e9f82] flex items-center justify-center disabled:opacity-50 transition-colors shrink-0"
      >
        {uploading ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />}
      </button>
      {err && <p className="text-[9px] text-red-500">{err}</p>}
    </div>
  );
}

// ─── Area block ───────────────────────────────────────────────────────────────

function AreaBlock({
  area, areaIndex, inspType, contractId, onChange, onRemove, canRemove, isLocked, portalToken,
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
      <div className="flex items-center gap-3 px-5 py-3 bg-[#fafaf8] border-b border-[#f4f3ef]">
        <div className="flex-1 flex items-center gap-3">
          <span className="text-xs font-bold text-[#9b9890] uppercase tracking-wide w-14 shrink-0">
            Area {areaIndex + 1}
          </span>
          <input
            type="text"
            value={area.name}
            onChange={e => onChange({ ...area, name: e.target.value })}
            placeholder="e.g. Bedroom 1, Kitchen, Bathroom…"
            className="flex-1 text-sm font-semibold text-[#1a1916] bg-transparent border-b border-transparent focus:border-[#2e9f82] focus:outline-none pb-0.5 transition-colors"
          />
        </div>
        {canRemove && !isLocked && (
          <button type="button" onClick={onRemove} className="text-[#9b9890] hover:text-[#ef4444] transition-colors shrink-0">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Items table */}
      <div className="px-5 pt-3 pb-2">
        <div className="grid gap-2 mb-2 pb-1.5 border-b border-[#f4f3ef] grid-cols-[1fr_auto_auto_auto]">
          <span className="text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide">Item</span>
          <span className="text-[10px] font-semibold text-[#2e9f82] uppercase tracking-wide w-24 text-center">{isMoveOut ? 'Move-Out' : 'Condition'}</span>
          <span className="text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide">Attach</span>
          <span className="w-6" />
        </div>

        {area.items.map(item => (
          <div
            key={item.id}
            className="grid gap-2 items-center py-1.5 border-b border-[#f9f8f6] last:border-0 grid-cols-[1fr_auto_auto_auto]"
          >
            {item.isCustom && !isLocked ? (
              <input
                type="text"
                value={item.name}
                onChange={e => updateItem(item.id, { name: e.target.value })}
                placeholder="Item name…"
                className="text-sm text-[#1a1916] border-b border-dashed border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none bg-transparent pb-0.5"
              />
            ) : (
              <span className="text-sm text-[#1a1916]">{item.name}</span>
            )}

            {/* Single condition column — move-out edits `outCondition` (pre-filled from
                the move-in baseline on load); move-in edits `inCondition`. */}
            <div className="flex justify-center w-24">
              <ConditionPicker
                value={isMoveOut ? item.outCondition : item.inCondition}
                onChange={v => !isLocked && updateItem(item.id, isMoveOut ? { outCondition: v } : { inCondition: v })}
              />
            </div>

            {/* Per-item attachment — RP only, not shown to tenant */}
            <div className="flex items-center">
              <ItemAttachmentButton
                contractId={contractId}
                itemId={item.id}
                attachments={item.itemAttachments ?? []}
                onChange={updated => updateItem(item.id, { itemAttachments: updated })}
                disabled={isLocked}
                portalToken={portalToken}
              />
            </div>

            <div className="w-6 flex justify-center">
              {item.isCustom && !isLocked && (
                <button type="button" onClick={() => removeItem(item.id)} className="text-[#c8c6be] hover:text-[#ef4444] transition-colors">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}

        {!isLocked && (
          <button type="button" onClick={addItem} className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:opacity-75 mt-2 mb-1 transition-opacity">
            <Plus size={12} /> Add item
          </button>
        )}
      </div>

      {/* Remarks */}
      <div className="px-5 pb-4">
        <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1">Remarks</label>
        <textarea
          value={area.remarks}
          onChange={e => onChange({ ...area, remarks: e.target.value })}
          placeholder="Notes, damages, or specific observations for this area…"
          rows={2}
          className="w-full text-sm text-[#1a1916] border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors resize-none bg-[#fafaf8]"
        />
      </div>
    </div>
  );
}

// ─── Signature pad ────────────────────────────────────────────────────────────

function SignaturePad({
  label, value, onChange,
}: {
  label: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(!!value);

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath(); ctx.moveTo(x, y);
    setIsDrawing(true);
  }, [getPos]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
  }, [isDrawing, getPos]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false); setHasDrawn(true);
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
  }, [isDrawing, onChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(false);
      onChange(null);
    }
  }, [onChange]);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[#6b6860] uppercase tracking-wide">{label}</p>
      <div className="relative border-2 border-dashed border-[#e8e6e0] rounded-xl bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={560} height={140}
          className="w-full cursor-crosshair touch-none"
          style={{ height: 140 }}
          onMouseDown={startDrawing} onMouseMove={draw}
          onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
          onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[#c0bdb8] text-sm">Draw signature here</span>
          </div>
        )}
      </div>
      {hasDrawn && (
        <button type="button" onClick={clear} className="flex items-center gap-1.5 text-xs text-[#9b9890] hover:text-[#ef4444] transition-colors">
          <RotateCcw size={12} /> Clear
        </button>
      )}
    </div>
  );
}

// ─── Photos section ───────────────────────────────────────────────────────────

function PhotosSection({
  contractId, inspType, photos, onChange, disabled, portalToken,
}: {
  contractId: number;
  inspType: InspType;
  photos: InspectionPhoto[];
  onChange: (photos: InspectionPhoto[]) => void;
  disabled?: boolean;
  portalToken?: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMoveIn = inspType === 'move_in';
  const heading = isMoveIn ? 'Move-In Photos' : 'Move-Out Photos';

  async function uploadFile(file: File) {
    if (disabled) return;
    if (!file.type.startsWith('image/')) { setUploadError('Please upload an image file.'); return; }
    setUploading(true); setUploadError(null);
    try {
      const docBody = {
        documentKey: `inspection_${inspType}_${Date.now()}`,
        mimeType: file.type, originalName: file.name,
      };
      const urlRes = await fetch(portalToken
        ? `/api/portal/${portalToken}/contracts/${contractId}/inspection/upload-url`
        : '/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portalToken
          ? docBody
          : { ownerType: 'tenancy_contract', ownerId: contractId, ...docBody }),
      });
      if (!urlRes.ok) { setUploadError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUploadError('File upload failed'); return; }
      onChange([...photos, { id: uid(), url: fileUrl, caption: '' }]);
    } catch { setUploadError('Unexpected upload error'); }
    finally { setUploading(false); }
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
              <img src={p.url} alt={p.caption || 'Inspection photo'} className="w-full h-32 object-cover" />
              {!disabled && (
                <button type="button" onClick={() => onChange(photos.filter(x => x.id !== p.id))}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 print:hidden">
                  <X size={12} />
                </button>
              )}
              <input type="text" value={p.caption} readOnly={disabled} disabled={disabled}
                onChange={e => onChange(photos.map(x => x.id === p.id ? { ...x, caption: e.target.value } : x))}
                placeholder={disabled ? '' : 'Caption (e.g. living room)'}
                className="w-full text-[10px] px-2 py-1 border-t border-[#e8e6e0] focus:outline-none focus:bg-[#f0faf6] bg-white disabled:bg-[#f4f3ef] disabled:text-[#6b6860]"
              />
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
            onChange={async e => {
              const files = Array.from(e.target.files ?? []);
              for (const f of files) await uploadFile(f);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 w-full justify-center py-3 rounded-xl border-2 border-dashed border-[#d8d6d0] text-sm font-semibold text-[#9b9890] hover:border-[#2e9f82] hover:text-[#2e9f82] disabled:opacity-50 transition-colors print:hidden">
            {uploading ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : <><UploadCloud size={14} /> Upload {photos.length === 0 ? heading.toLowerCase() : 'more photos'}</>}
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
            <button key={p.id} type="button" onClick={() => openDocViewer({ fileUrl: p.url, caption: p.caption })}
              className="block w-full text-left rounded-xl overflow-hidden border border-[#e8e6e0] hover:border-[#2e9f82] transition-colors cursor-pointer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption || 'photo'} className="w-full h-32 object-cover" />
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

export default function InspectionPage() {
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
  const backHref = portalToken
    ? `/portal/${portalToken}/contract/${params?.id}`
    : ((pathname ?? '').replace(/\/inspection\/?$/, '/v2') || `/rental-provider/dashboard/contracts/${params?.id}/v2`);

  const [meta, setMeta]   = useState<ContractMeta | null>(null);
  const [data, setData]   = useState<InspectionData>(makeBlankData);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [counterSig, setCounterSig]   = useState<string | null>(null);
  const [countering, setCountering]   = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);
  const [counterDone, setCounterDone] = useState(false);

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
        defaultDate = (inspType === 'move_out' ? moveOutDate : startDate) ?? '';
        setMeta({
          property:    c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
          unit:        c.unit?.number ?? c.unit?.unitNumber ?? '',
          tenantName:  c.tenant?.name ?? '',
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
            moveInDate: seedMoveOut ? defaultDate : (loaded.moveInDate || defaultDate),
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

  async function handleSave() {
    if (!contractId) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(portalToken
        ? `/api/portal/${portalToken}/contracts/${contractId}/inspection`
        : `/api/contracts/${contractId}/inspection`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: inspType, data }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { message?: string }).message ?? 'Failed to save');
        return;
      }
      setSaved(true);
      setData(d => ({ ...d, rpSubmittedAt: new Date().toISOString() }));
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Unexpected error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCounterSign() {
    if (!counterSig) { setCounterError('Please draw your signature first.'); return; }
    if (!contractId) return;
    setCountering(true); setCounterError(null);
    try {
      const res = await fetch(portalToken
        ? `/api/portal/${portalToken}/contracts/${contractId}/inspection/counter-sign`
        : `/api/contracts/${contractId}/inspection/sign?type=${inspType}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portalToken
          // Inspector links record who physically counter-signed.
          ? { type: inspType, signatureImage: counterSig, signatoryName: data.inspectorName?.trim() || 'Inspection Manager' }
          : { signatureImage: counterSig }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setCounterError((b as { message?: string }).message ?? 'Failed to submit signature');
        return;
      }
      setCounterDone(true);
      setData(d => ({ ...d, rpCounterSig: counterSig, rpCounterSignedAt: new Date().toISOString() }));
    } catch {
      setCounterError('Unexpected error submitting signature');
    } finally {
      setCountering(false);
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
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6 print:px-0 print:py-0">

      {/* Topbar */}
      <div className="flex items-center justify-between print:hidden">
        <Link href={backHref} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] transition-colors">
          <ArrowLeft size={15} /> Back to contract
        </Link>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] transition-colors">
            <Printer size={14} /> Print
          </button>
          {!formLocked && (
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors">
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
            <p className="font-semibold text-[#1a7a5a]">Inspection submitted — awaiting tenant counter-signature</p>
            <p className="text-xs text-[#1a7a5a] mt-0.5">Send the tenant a secure link to sign this {isMoveIn ? 'move-in' : 'move-out'} inspection from their portal. You can counter-sign once they do.</p>
            {meta?.tenantId && contractId && (
              <PortalLinkButton
                tenantId={meta.tenantId}
                contractId={Number(contractId)}
                purpose={inspType}
                label={`Send ${isMoveIn ? 'move-in' : 'move-out'} signing link`}
              />
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
      <fieldset disabled={formLocked} className={`space-y-6 ${formLocked ? 'opacity-95' : ''}`}>

        {/* Legend */}
        <div className="flex items-center gap-4 bg-[#f9f8f6] rounded-xl px-4 py-3 print:bg-white print:border print:border-gray-200">
          <span className="text-xs font-semibold text-[#6b6860] uppercase tracking-wide">Condition:</span>
          <LegendChip letter="G" label="Good"    color="bg-[#2e9f82]" />
          <LegendChip letter="F" label="Fair"    color="bg-[#f59e0b]" />
          <LegendChip letter="D" label="Damaged" color="bg-[#ef4444]" />
        </div>

        {/* Header info — editable inspection fields (tenant/property shown in the report header above) */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 print:hidden">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">{isMoveIn ? 'Move-In Date' : 'Move-Out Date'}</label>
              <input type="date" value={data.moveInDate}
                onChange={e => setData(d => ({ ...d, moveInDate: e.target.value }))}
                className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Inspector Name</label>
              <input type="text" value={data.inspectorName}
                onChange={e => setData(d => ({ ...d, inspectorName: e.target.value }))}
                placeholder="Inspector full name"
                className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">
                Report Generated Date
              </label>
              <input type="date" value={data.reportGeneratedDate}
                onChange={e => setData(d => ({ ...d, reportGeneratedDate: e.target.value }))}
                className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
              />
            </div>
            {/* Inspection date is auto-set when RP counter-signs — shown read-only if set */}
            {data.inspectionDate && (
              <div>
                <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Inspection Date</label>
                <input type="text" value={new Date(data.inspectionDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })} disabled
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
              onChange={updated => setData(d => ({ ...d, areas: d.areas.map(a => a.id === area.id ? updated : a) }))}
              onRemove={() => setData(d => ({ ...d, areas: d.areas.filter(a => a.id !== area.id) }))}
              canRemove={data.areas.length > 1}
              isLocked={formLocked}
              portalToken={portalToken}
            />
          ))}

          {!formLocked && (
            <button type="button"
              onClick={() => setData(d => ({ ...d, areas: [...d.areas, makeDefaultArea(d.areas.length + 1)] }))}
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
            onChange={e => setData(d => ({ ...d, generalNotes: e.target.value }))}
            placeholder="Overall observations, utility meter readings, keys handed over…"
            rows={3}
            className="w-full text-sm border border-[#e8e6e0] rounded-xl px-4 py-3 focus:outline-none focus:border-[#2e9f82] transition-colors resize-none"
          />
        </div>

        {/* Bottom submit bar */}
        {!formLocked && (
          <div className="flex justify-end pt-2 pb-8 print:hidden">
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
           Inspector column: sig pad when awaiting counter-sign, image once done. */}
      <div className="grid grid-cols-2 gap-4">

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
            <div className="space-y-3">
              <SignaturePad label="" value={counterSig} onChange={setCounterSig} />
              {counterError && <p className="text-xs text-red-600">{counterError}</p>}
              <button type="button" onClick={handleCounterSign} disabled={!counterSig || countering}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-50 transition-colors print:hidden">
                {countering ? <><Loader2 size={14} className="animate-spin" /> Signing…</> : <><FileSignature size={14} /> Sign & Activate Tenancy</>}
              </button>
            </div>
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
              <button key={p.id} type="button" onClick={() => openDocViewer({ fileUrl: p.url, caption: p.caption })}
                className="block w-full text-left rounded-xl overflow-hidden border border-[#e8e6e0] hover:border-[#2e9f82] transition-colors cursor-pointer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption || 'Move-in photo'} className="w-full h-32 object-cover" />
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
          onChange={photos => setData(d => ({ ...d, photos }))}
          disabled={formLocked}
          portalToken={portalToken}
        />
      </div>

    </div>
  );
}
