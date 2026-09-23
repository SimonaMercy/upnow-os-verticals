'use client';

/**
 * "Returned to customer" asks WHY (0325) — the trail on a bounced or swapped
 * cheque must say what went back, when, by whom and for what reason (owner,
 * 23 Sep 2026). One dialog for the lease record and the Payments page.
 */
import { useState } from 'react';
import { X } from 'lucide-react';

export const RETURN_REASONS: { value: string; label: string }[] = [
  { value: 'replaced',        label: 'Replaced by a new cheque' },
  { value: 'customer_request', label: 'Returned on the customer’s request' },
  { value: 'lease_cancelled', label: 'Lease cancelled' },
  { value: 'other',           label: 'Other (say what)' },
];
export const RETURN_REASON_WORD: Record<string, string> = Object.fromEntries(RETURN_REASONS.map(r => [r.value, r.label.replace(' (say what)', '')]));

export function ReturnChequeDialog({ what, onConfirm, onClose, allowFile = true }: {
  /** What is going back — "cheque 503733 · AED 17,325" or "3 cheques". */
  what: string;
  onConfirm: (reason: string, note: string, file: File | null) => Promise<void>;
  onClose: () => void;
  /** The reference image (the customer's acknowledgement / handover slip) is
   *  filed on ONE lease — offered only when the return is on one lease. */
  allowFile?: boolean;
}) {
  const [reason, setReason] = useState('replaced');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canSave = !busy && (reason !== 'other' || note.trim().length > 0);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(reason, note.trim(), file); onClose(); }
    catch (e) { setErr((e as Error)?.message || 'Could not record the return.'); }
    finally { setBusy(false); }
  };
  const input = 'w-full py-2 px-3 border border-[#e6e8e6] rounded-lg text-[12.5px] bg-white focus:outline-none focus:border-[#1a7a52]';
  const lbl = 'block text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] mb-1';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Returned to customer" className="bg-white rounded-2xl w-full max-w-[440px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#eef0ee]">
          <div>
            <h2 className="text-[15px] font-bold text-[#1c1f1d]">Returned to customer</h2>
            <p className="text-[11.5px] text-[#8a8f8c] mt-0.5">{what}. The date, your name and the reason stay on the record.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer"><X size={17} /></button>
        </div>
        <div className="px-5 py-4 space-y-3.5">
          <div>
            <label className={lbl}>REASON</label>
            <select value={reason} onChange={e => setReason(e.target.value)} className={input}>
              {RETURN_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>{reason === 'other' ? 'WHAT HAPPENED' : 'NOTE (OPTIONAL)'}</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={input} placeholder={reason === 'replaced' ? 'e.g. new cheque 503740 received' : ''} />
          </div>
          {allowFile && (
            <div>
              <label className={lbl}>REFERENCE IMAGE (OPTIONAL)</label>
              <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className={input} />
              <p className="text-[11px] text-[#8a8f8c] mt-1">The customer’s acknowledgement or the handover slip — filed on the lease beside the return.</p>
            </div>
          )}
          {err && <p className="text-[12px] text-[#b42318]">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[#eef0ee]">
          <button type="button" onClick={onClose} className="text-[11px] font-bold px-2.5 py-1.5 rounded-md border border-[#1a7a52] bg-white text-[#1a7a52] hover:bg-[#e7f4ee] cursor-pointer">Cancel</button>
          <button type="button" disabled={!canSave} onClick={save} className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50">
            {busy ? 'Saving…' : 'Confirm return'}
          </button>
        </div>
      </div>
    </div>
  );
}
