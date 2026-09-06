'use client';

/**
 * Upload popup for a KYC requirement. Two-sided documents (Emirates ID) show
 * a Front and a Back slot; single documents show one slot. Each slot replaces
 * in place when it already holds a file, otherwise creates a new document.
 */
import { useEffect, useRef, useState } from 'react';
import { X, Upload, Loader2, Check, ExternalLink, FileText, CalendarClock } from 'lucide-react';
import { putKycSlot } from '@/lib/kycSlotUpload';
import { docNeedsExpiry } from '@/lib/docRequirements';
import { openDocViewer } from '@/lib/docViewer';
import { useDocumentScanner } from '@/components/upnow/DocumentScanModal';

export type UploadSlot = {
  label: string;                 // "Front side", "Back side", or the doc name
  canonicalKey: string;          // key used when creating a fresh document
  category: string;
  existing?: { id: number; documentKey: string; fileUrl: string | null; mimeType?: string | null; expiryDate?: string | null } | null;
};

// yyyy-mm-dd for a native date input, tolerant of full ISO timestamps.
const toDateInput = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

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
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();

  // This requirement carries an expiry (identity / licence doc). The date is a
  // property of the document, so a two-sided Emirates ID shares ONE expiry across
  // both sides. Prefilled from whichever side already has one on record.
  const needsExpiry = slots.some(s => docNeedsExpiry(s.canonicalKey));
  const initialExpiry = toDateInput(slots.find(s => s.existing?.expiryDate)?.existing?.expiryDate);
  const [expiry, setExpiry] = useState<string>(initialExpiry);
  const [expirySaving, setExpirySaving] = useState(false);
  const [expiryErr, setExpiryErr] = useState<string | null>(null);
  // Last value known to be on the server, so a re-render or a blur after an
  // already-saved edit doesn't PATCH the same date again.
  const savedExpiry = useRef<string>(initialExpiry);

  // Persist an edited expiry onto every document already on file for this
  // requirement (a fresh upload carries the date atomically via putKycSlot).
  const persistExpiry = async (dateStr: string, ids: number[]) => {
    if (!ids.length) return false;
    setExpirySaving(true); setExpiryErr(null);
    try {
      const results = await Promise.all(ids.map(id => fetch(`/api/documents/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryDate: dateStr || null }),
      })));
      if (results.some(r => !r.ok)) throw new Error('Could not save the expiry date.');
      setLocalSlots(prev => prev.map(s => s.existing?.id != null
        ? { ...s, existing: { ...s.existing, expiryDate: dateStr || null } }
        : s));
      onChanged();
      return true;
    } catch (err) {
      setExpiryErr(err instanceof Error ? err.message : 'Could not save the expiry date.');
      return false;
    } finally {
      setExpirySaving(false);
    }
  };

  // Commit whatever has settled in the field. Slots with nothing on file yet keep
  // the date in state — the upload carries it — so they count as "saved" too.
  const commitExpiry = async (v: string) => {
    if (v === savedExpiry.current || expirySaving) return;
    const ids = localSlots.map(s => s.existing?.id).filter((id): id is number => id != null);
    if (!ids.length) { savedExpiry.current = v; return; }
    if (await persistExpiry(v, ids)) savedExpiry.current = v;
  };

  // A native date input fires onChange on EVERY segment the RP touches, and
  // reports '' until day, month and year are all filled. Saving on each of those
  // events refreshed the customer behind the popup mid-edit and threw the
  // half-typed date away — so the value is only committed once it settles: a beat
  // after the last keystroke, or on blur.
  useEffect(() => {
    if (!needsExpiry || expiry === savedExpiry.current) return;
    const t = setTimeout(() => { void commitExpiry(expiry); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiry, needsExpiry]);

  const onExpiryChange = (v: string) => {
    setExpiry(v);
    setExpiryErr(null);
  };

  // Closing is also a commit — a date typed and immediately dismissed (X, Done,
  // backdrop) must not be lost to the debounce window.
  const handleClose = () => { void commitExpiry(expiry); onClose(); };

  const pick = (slot: UploadSlot) => { pending.current = slot; fileRef.current?.click(); };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    const slot = pending.current;
    e.target.value = '';
    if (!picked || !slot) return;
    // Images go through the scan modal first; PDFs pass straight through.
    // Null = the user closed the scanner — abort the upload.
    const file = await scan(picked);
    if (!file) return;
    setErrs(p => { const n = { ...p }; delete n[slot.canonicalKey]; return n; });
    setBusy(slot.canonicalKey);
    try {
      const saved = await putKycSlot({
        ownerType: 'customer', ownerId, canonicalKey: slot.canonicalKey, category: slot.category,
        displayName: slot.label, file, existingDocId: slot.existing?.id ?? null, existingKey: slot.existing?.documentKey ?? null,
        // Attach the entered expiry atomically on create/replace (undefined = don't touch).
        expiryDate: needsExpiry ? (expiry || null) : undefined,
      });
      setLocalSlots(prev => prev.map(s => s.canonicalKey === slot.canonicalKey
        ? { ...s, existing: { id: saved.id, documentKey: saved.documentKey, fileUrl: saved.fileUrl, mimeType: saved.mimeType, expiryDate: needsExpiry ? (expiry || null) : s.existing?.expiryDate ?? null } }
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
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={onFile} />
        {scannerModal}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#e8e6e0]">
          <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2"><Upload size={16} className="text-[#2e9f82]" /> {title}</h3>
          <button type="button" onClick={handleClose} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {needsExpiry && (
            <div className="border border-[#e8e6e0] rounded-xl p-3.5">
              <label className="text-sm font-medium text-[#1a1916] flex items-center gap-2">
                <CalendarClock size={14} className="text-[#2e9f82]" /> Expiry date
                <span className="font-normal text-[#9b9890]">· from the document</span>
              </label>
              <p className="text-[11px] text-[#9b9890] mt-0.5">
                Enter the date this document expires{localSlots.length > 1 ? ' (applies to both sides)' : ''}. Set it before uploading, or edit it here anytime.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="date"
                  value={expiry}
                  onChange={e => onExpiryChange(e.target.value)}
                  onBlur={() => { void commitExpiry(expiry); }}
                  className="flex-1 text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
                />
                {expirySaving && <Loader2 size={15} className="animate-spin text-[#9b9890]" />}
              </div>
              {expiryErr && <div className="text-xs text-[#b91c1c] mt-1">{expiryErr}</div>}
            </div>
          )}
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
          <button type="button" onClick={handleClose} className="text-sm font-semibold px-4 py-2 rounded-full bg-[#2e9f82] text-white hover:bg-[#267a65] cursor-pointer">Done</button>
        </div>
      </div>
    </div>
  );
}
