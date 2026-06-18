'use client';

/**
 * Upload popup for a KYC requirement. Two-sided documents (Emirates ID) show
 * a Front and a Back slot; single documents show one slot. Each slot replaces
 * in place when it already holds a file, otherwise creates a new document.
 */
import { useRef, useState } from 'react';
import { X, Upload, Loader2, Check, ExternalLink, FileText } from 'lucide-react';
import { putKycSlot } from '@/lib/kycSlotUpload';
import { openDocViewer } from '@/lib/docViewer';

export type UploadSlot = {
  label: string;                 // "Front side", "Back side", or the doc name
  canonicalKey: string;          // key used when creating a fresh document
  category: string;
  existing?: { id: number; documentKey: string; fileUrl: string | null; mimeType?: string | null } | null;
};

const isImage = (mime?: string | null, url?: string | null) =>
  (mime ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url ?? '');

export function KycUploadModal({ title, ownerId, slots, onClose, onChanged }: {
  title: string;
  ownerId: number;
  slots: UploadSlot[];
  onClose: () => void;
  onChanged: () => void;
}) {
  // Track slots locally so a second upload to the same slot replaces (not dupes)
  // and the preview/label flip to "Replace" immediately after a successful upload.
  const [localSlots, setLocalSlots] = useState<UploadSlot[]>(slots);
  const [busy, setBusy] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<UploadSlot | null>(null);

  const pick = (slot: UploadSlot) => { pending.current = slot; fileRef.current?.click(); };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slot = pending.current;
    e.target.value = '';
    if (!file || !slot) return;
    setErrs(p => { const n = { ...p }; delete n[slot.canonicalKey]; return n; });
    setBusy(slot.canonicalKey);
    try {
      const saved = await putKycSlot({
        ownerType: 'customer', ownerId, canonicalKey: slot.canonicalKey, category: slot.category,
        displayName: slot.label, file, existingDocId: slot.existing?.id ?? null, existingKey: slot.existing?.documentKey ?? null,
      });
      setLocalSlots(prev => prev.map(s => s.canonicalKey === slot.canonicalKey
        ? { ...s, existing: { id: saved.id, documentKey: saved.documentKey, fileUrl: saved.fileUrl, mimeType: saved.mimeType } }
        : s));
      onChanged();
    } catch (err) {
      setErrs(p => ({ ...p, [slot.canonicalKey]: err instanceof Error ? err.message : 'Upload failed. Try again.' }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={onFile} />
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#e8e6e0]">
          <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2"><Upload size={16} className="text-[#2e9f82]" /> {title}</h3>
          <button type="button" onClick={onClose} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {localSlots.map(slot => {
            const has = !!slot.existing?.fileUrl;
            const uploading = busy === slot.canonicalKey;
            const img = isImage(slot.existing?.mimeType, slot.existing?.fileUrl);
            return (
              <div key={slot.canonicalKey} className="border border-[#e8e6e0] rounded-xl p-3.5 flex items-center gap-3">
                <div className="w-16 h-12 rounded-lg border border-[#e8e6e0] bg-[#f4f3ef] overflow-hidden flex items-center justify-center shrink-0 text-[#9b9890]">
                  {has && img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={slot.existing!.fileUrl!} alt={slot.label} className="w-full h-full object-cover" />
                  ) : has ? <FileText size={18} /> : <FileText size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#1a1916]">{slot.label}</div>
                  {has ? (
                    <button type="button" onClick={() => openDocViewer({ fileUrl: slot.existing!.fileUrl, caption: slot.label, mimeType: slot.existing!.mimeType })} className="text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1 mt-0.5 cursor-pointer">
                      <Check size={11} className="text-[#1a7a5a]" /> Uploaded · View <ExternalLink size={10} />
                    </button>
                  ) : (
                    <div className="text-xs text-[#9b9890] mt-0.5">Not uploaded</div>
                  )}
                  {errs[slot.canonicalKey] && <div className="text-xs text-[#b91c1c] mt-1">{errs[slot.canonicalKey]}</div>}
                </div>
                <button type="button" onClick={() => pick(slot)} disabled={uploading}
                  className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full disabled:opacity-50 cursor-pointer ${has ? 'border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef]' : 'bg-[#2e9f82] text-white hover:bg-[#267a65]'}`}>
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {has ? 'Replace' : 'Upload'}
                </button>
              </div>
            );
          })}
          <p className="text-[11px] text-[#9b9890]">JPG, PNG, WebP or PDF · up to 15 MB each.</p>
        </div>
        <div className="px-5 py-3 border-t border-[#e8e6e0] flex justify-end">
          <button type="button" onClick={onClose} className="text-sm font-semibold px-4 py-2 rounded-full bg-[#2e9f82] text-white hover:bg-[#267a65] cursor-pointer">Done</button>
        </div>
      </div>
    </div>
  );
}
