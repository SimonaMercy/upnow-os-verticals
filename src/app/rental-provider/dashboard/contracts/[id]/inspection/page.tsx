'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import {
  Plus, Trash2, Save, Printer, ArrowLeft, CheckCircle, Loader2,
  AlertCircle, RotateCcw, UploadCloud, X, Camera,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Condition = 'G' | 'F' | 'D' | '';
type InspType = 'move_in' | 'move_out';

interface InspectionItem {
  id: string;
  name: string;
  isCustom: boolean;
  inCondition: Condition;
  outCondition: Condition;
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
  inspectorName: string;
  inspectionDate: string;
  moveInDate: string;
  areas: InspectionArea[];
  generalNotes: string;
  photos: InspectionPhoto[];
  tenantSig: string | null;
  // Legacy field name; surfaced as "Inspection Officer / Property Manager" in the UI
  landlordSig: string | null;
  // Set by the backend when the RP first submits — locks the form thereafter.
  rpSubmittedAt?: string | null;
  tenantSignedAt?: string | null;
}

interface ContractMeta {
  property: string;
  unit: string;
  tenantName: string;
  moveInDate: string | null;
  moveOutDate: string | null;
}


// ─── Default items per area ───────────────────────────────────────────────────

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
    items: DEFAULT_ITEMS.map(i => ({ ...i, id: uid() })),
    remarks: '',
  };
}

function makeBlankData(): InspectionData {
  return {
    inspectorName: '',
    inspectionDate: new Date().toISOString().split('T')[0],
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

// ─── Area block ───────────────────────────────────────────────────────────────

function AreaBlock({
  area, areaIndex, inspType, onChange, onRemove, canRemove,
}: {
  area: InspectionArea;
  areaIndex: number;
  inspType: InspType;
  onChange: (updated: InspectionArea) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  function updateItem(itemId: string, patch: Partial<InspectionItem>) {
    onChange({ ...area, items: area.items.map(i => i.id === itemId ? { ...i, ...patch } : i) });
  }
  function addItem() {
    onChange({ ...area, items: [...area.items, { id: uid(), name: '', isCustom: true, inCondition: '', outCondition: '' }] });
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
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-[#9b9890] hover:text-[#ef4444] transition-colors shrink-0"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Items table */}
      <div className="px-5 pt-3 pb-2">
        {/* Column headers */}
        <div className={`grid gap-2 mb-2 pb-1.5 border-b border-[#f4f3ef] ${isMoveOut ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]'}`}>
          <span className="text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide">Item</span>
          {isMoveOut ? (
            <>
              <span className="text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide w-24 text-center">Move-In</span>
              <span className="text-[10px] font-semibold text-[#2e9f82] uppercase tracking-wide w-24 text-center">Move-Out</span>
            </>
          ) : (
            <span className="text-[10px] font-semibold text-[#2e9f82] uppercase tracking-wide w-24 text-center">Condition</span>
          )}
          <span className="w-6" />
        </div>

        {area.items.map(item => (
          <div
            key={item.id}
            className={`grid gap-2 items-center py-1.5 border-b border-[#f9f8f6] last:border-0 ${isMoveOut ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]'}`}
          >
            {item.isCustom ? (
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

            {isMoveOut ? (
              <>
                {/* Move-In column is read-only at move-out time */}
                <div className="flex justify-center w-24">
                  <ConditionPicker value={item.inCondition} onChange={() => {}} />
                </div>
                <div className="flex justify-center w-24">
                  <ConditionPicker
                    value={item.outCondition}
                    onChange={v => updateItem(item.id, { outCondition: v })}
                  />
                </div>
              </>
            ) : (
              <div className="flex justify-center w-24">
                <ConditionPicker
                  value={item.inCondition}
                  onChange={v => updateItem(item.id, { inCondition: v })}
                />
              </div>
            )}

            <div className="w-6 flex justify-center">
              {item.isCustom && (
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="text-[#c8c6be] hover:text-[#ef4444] transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:opacity-75 mt-2 mb-1 transition-opacity"
        >
          <Plus size={12} /> Add item
        </button>
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
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 text-xs text-[#9b9890] hover:text-[#ef4444] transition-colors"
        >
          <RotateCcw size={12} /> Clear
        </button>
      )}
    </div>
  );
}

// ─── Condition legend chip ────────────────────────────────────────────────────

// ─── Photos section ───────────────────────────────────────────────────────────
// Uploads via the existing presigned-URL document flow, scoped to the tenancy_contract
// owner so move-in vs move-out can be told apart by inspection type below.
function PhotosSection({
  contractId, inspType, photos, onChange, disabled,
}: {
  contractId: number;
  inspType: InspType;
  photos: InspectionPhoto[];
  onChange: (photos: InspectionPhoto[]) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMoveIn = inspType === 'move_in';
  const heading = isMoveIn ? 'Move-In Photos' : 'Move-Out Photos';
  const hint = isMoveIn
    ? 'Capture each room’s condition before handover so it can be compared at move-out.'
    : 'Capture the unit’s condition at handover back so any change vs. move-in is documented.';

  async function uploadFile(file: File) {
    if (disabled) return; // hard-stop any uploads when the inspection is locked
    if (!file.type.startsWith('image/')) { setUploadError('Please upload an image file.'); return; }
    setUploading(true); setUploadError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'tenancy_contract',
          ownerId: contractId,
          documentKey: `inspection_${inspType}_${Date.now()}`,
          mimeType: file.type,
          originalName: file.name,
        }),
      });
      if (!urlRes.ok) { setUploadError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
        catch { return uploadUrl; }
      })();
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
        <p className="text-xs text-[#9b9890] mt-0.5">{hint}</p>
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map(p => (
            <div key={p.id} className="relative group rounded-xl overflow-hidden border border-[#e8e6e0] bg-[#f4f3ef]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption || 'Inspection photo'} className="w-full h-32 object-cover" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(photos.filter(x => x.id !== p.id))}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 print:hidden"
                  title="Remove photo"
                >
                  <X size={12} />
                </button>
              )}
              <input
                type="text"
                value={p.caption}
                readOnly={disabled}
                disabled={disabled}
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={async e => {
              const files = Array.from(e.target.files ?? []);
              for (const f of files) await uploadFile(f);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 w-full justify-center py-3 rounded-xl border-2 border-dashed border-[#d8d6d0] text-sm font-semibold text-[#9b9890] hover:border-[#2e9f82] hover:text-[#2e9f82] disabled:opacity-50 transition-colors print:hidden"
          >
            {uploading
              ? <><Loader2 size={14} className="animate-spin" /> Uploading…</>
              : <><UploadCloud size={14} /> Upload {photos.length === 0 ? heading.toLowerCase() : 'more photos'}</>}
          </button>
          {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        </>
      )}
    </div>
  );
}

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
  const router       = useRouter();
  const inspType     = (searchParams.get('type') ?? 'move_in') as InspType;

  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [data, setData] = useState<InspectionData>(makeBlankData);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const contractId = params?.id;
  const isMoveIn   = inspType === 'move_in';
  const title      = isMoveIn ? 'Move-In Inspection' : 'Move-Out Inspection';
  // Lock the form once the RP has saved it (rpSubmittedAt) OR the tenant has signed.
  // After save, the RP cannot edit further — the inspection becomes a printable, immutable
  // record awaiting the tenant's counter-signature.
  const isLocked   = !!data.rpSubmittedAt || !!data.tenantSig || !!data.tenantSignedAt;

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const [contractRes, inspRes] = await Promise.all([
        fetch(`/api/contracts/${contractId}`, { credentials: 'include' }),
        fetch(`/api/contracts/${contractId}/inspection?type=${inspType}`, { credentials: 'include' }),
      ]);
      if (contractRes.ok) {
        const c = await contractRes.json();
        const startDate = c.startDate ?? c.contractStartDate ?? null;
        setMeta({
          property:    c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
          unit:        c.unit?.number ?? c.unit?.unitNumber ?? '',
          tenantName:  c.tenant?.name ?? '',
          moveInDate:  startDate,
          moveOutDate: c.endDate ?? c.contractEndDate ?? null,
        });
        // Seed moveInDate from contract start if not already saved in inspection
        setData(d => d.moveInDate ? d : { ...d, moveInDate: startDate ?? '' });
      }
      if (inspRes.ok) {
        const savedInsp = await inspRes.json();
        if (savedInsp && typeof savedInsp === 'object' && (savedInsp as InspectionData).areas) {
          // Backfill `photos` for legacy inspections that pre-date the photos feature
          const loaded = savedInsp as InspectionData;
          setData({ ...loaded, photos: Array.isArray(loaded.photos) ? loaded.photos : [] });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [contractId, inspType]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave() {
    if (!contractId) return;
    // Signatures are no longer collected on the RP inspection page — the tenant signs from
    // their own portal after the RP submits the inspection.
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection`, {
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
      // Immediately flip the form to its locked state without waiting for a reload.
      setData(d => ({ ...d, rpSubmittedAt: new Date().toISOString() }));
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Unexpected error. Please try again.');
    } finally {
      setSaving(false);
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
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] transition-colors"
        >
          <ArrowLeft size={15} /> Back to contract
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] transition-colors"
          >
            <Printer size={14} /> Print
          </button>
          {!isLocked && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save'}
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

      {isLocked && (
        <div className="flex items-start gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3 print:hidden">
          <CheckCircle size={14} className="text-[#2e9f82] shrink-0 mt-0.5" />
          <div>
            {data.tenantSig ? (
              <>
                <p className="font-semibold text-[#1a7a5a]">Signed by tenant — inspection is final</p>
                <p className="text-xs text-[#1a7a5a] mt-0.5">This record is read-only. Use the Print button above to save a copy.</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-[#1a7a5a]">Inspection submitted — awaiting tenant counter-signature</p>
                <p className="text-xs text-[#1a7a5a] mt-0.5">The record is locked from your side. The tenant will counter-sign from their portal.</p>
              </>
            )}
          </div>
        </div>
      )}
      {saved && !isLocked && (
        <div className="flex items-start gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3 print:hidden">
          <CheckCircle size={14} className="text-[#2e9f82] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#1a7a5a]">Inspection saved.</p>
            <p className="text-xs text-[#1a7a5a] mt-0.5">The tenant has been asked to counter-sign it from their portal.</p>
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-[#dc2626] bg-[#fef2f2] rounded-xl px-4 py-3 print:hidden">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Lock the whole form when the tenant has signed — inputs, selects, textareas, file pickers,
          add/remove buttons, save action — all disabled by HTML <fieldset disabled>. */}
      <fieldset disabled={isLocked} className={`space-y-6 ${isLocked ? 'opacity-95' : ''}`}>

      {/* Legend */}
      <div className="flex items-center gap-4 bg-[#f9f8f6] rounded-xl px-4 py-3 print:bg-white print:border print:border-gray-200">
        <span className="text-xs font-semibold text-[#6b6860] uppercase tracking-wide">Condition:</span>
        <LegendChip letter="G" label="Good"    color="bg-[#2e9f82]" />
        <LegendChip letter="F" label="Fair"    color="bg-[#f59e0b]" />
        <LegendChip letter="D" label="Damaged" color="bg-[#ef4444]" />
      </div>

      {/* Header info */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Property</label>
            <input type="text" value={meta?.property ?? ''} disabled
              className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 bg-[#f9f8f6] text-[#6b6860]" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Unit</label>
            <input type="text" value={meta?.unit ?? ''} disabled
              className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 bg-[#f9f8f6] text-[#6b6860]" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Tenant</label>
            <input type="text" value={meta?.tenantName ?? ''} disabled
              className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 bg-[#f9f8f6] text-[#6b6860]" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">
              Move-In Date
            </label>
            <input
              type="date"
              value={data.moveInDate}
              onChange={e => setData(d => ({ ...d, moveInDate: e.target.value }))}
              className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Inspector Name</label>
            <input
              type="text"
              value={data.inspectorName}
              onChange={e => setData(d => ({ ...d, inspectorName: e.target.value }))}
              placeholder="Inspector full name"
              className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[#9b9890] uppercase tracking-wide mb-1.5">Inspection Date</label>
            <input
              type="date"
              value={data.inspectionDate}
              onChange={e => setData(d => ({ ...d, inspectionDate: e.target.value }))}
              className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors"
            />
          </div>
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
            onChange={updated => setData(d => ({ ...d, areas: d.areas.map(a => a.id === area.id ? updated : a) }))}
            onRemove={() => setData(d => ({ ...d, areas: d.areas.filter(a => a.id !== area.id) }))}
            canRemove={data.areas.length > 1}
          />
        ))}

        <button
          type="button"
          onClick={() => setData(d => ({ ...d, areas: [...d.areas, makeDefaultArea(d.areas.length + 1)] }))}
          className="flex items-center gap-2 w-full justify-center py-3 rounded-2xl border-2 border-dashed border-[#d8d6d0] text-sm font-semibold text-[#9b9890] hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors print:hidden"
        >
          <Plus size={15} /> Add area
        </button>
      </div>

      {/* General notes */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
        <label className="block text-sm font-semibold text-[#1a1916] mb-3">
          General Notes
          <span className="text-[#9b9890] font-normal text-xs ml-2">meter readings, key handover, damages, etc.</span>
        </label>
        <textarea
          value={data.generalNotes}
          onChange={e => setData(d => ({ ...d, generalNotes: e.target.value }))}
          placeholder="Overall observations, utility meter readings, keys handed over…"
          rows={3}
          className="w-full text-sm border border-[#e8e6e0] rounded-xl px-4 py-3 focus:outline-none focus:border-[#2e9f82] transition-colors resize-none"
        />
      </div>

      {/* Photos — required visual record of unit condition at this inspection.
          Locked once the tenant has signed (no add/remove/caption edits). */}
      <PhotosSection
        contractId={Number(contractId)}
        inspType={inspType}
        photos={data.photos}
        onChange={photos => setData(d => ({ ...d, photos }))}
        disabled={isLocked}
      />

      {/* Signature display — read-only. The tenant signs from their own portal, and once they
          do, their signature image and timestamp appear here as proof of acceptance. */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-[#1a1916]">Tenant Signature</h2>
          <p className="text-xs text-[#9b9890] mt-0.5">
            The tenant counter-signs this inspection from their own portal.
          </p>
        </div>
        {data.tenantSig ? (
          <div className="rounded-xl border border-[#c5e8df] bg-[#f0faf6] p-3 space-y-1">
            <div className="bg-white rounded-lg border border-[#e8e6e0] p-2 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.tenantSig} alt="Tenant signature" className="max-h-32 object-contain" />
            </div>
            {data.tenantSignedAt && (
              <p className="text-[10px] text-[#1a7a5a] flex items-center gap-1">
                <CheckCircle size={10} /> Signed {new Date(data.tenantSignedAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#d8d6d0] bg-[#fafaf8] px-3 py-4 text-center">
            <p className="text-[11px] text-[#9b9890]">Awaiting tenant counter-signature.</p>
            <p className="text-[10px] text-[#9b9890] mt-0.5">Tenant signs from their portal at <code className="text-[#0369a1]">/dashboard/customer/contracts/{contractId}/inspection?type={inspType}</code></p>
          </div>
        )}
      </div>

      {/* Bottom save bar — hidden when the inspection is locked (signed) */}
      {!isLocked && (
        <div className="flex justify-end pt-2 pb-8 print:hidden">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save inspection'}
          </button>
        </div>
      )}

      </fieldset>

    </div>
  );
}
