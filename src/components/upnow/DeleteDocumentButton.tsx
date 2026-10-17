'use client';

/**
 * Remove a document — the one control, used by every surface that lists them.
 * Same small trash icon everywhere — no page gets a bigger "Remove" button
 * than another, so the affordance reads as one feature, not several.
 *
 * WHAT IT DOES. Soft delete (`DELETE /documents/:id`): the row and the stored
 * file are both retained and `deletion_requested_by` records who asked. The
 * document stops being listed and nothing on the page says it ever existed, so
 * the audit row — "Removed a document", with the document key, owner, file
 * location and expiry of the copy that went — is the only trace. That is why
 * the backend records the whole before-state rather than just the tombstone
 * timestamp.
 *
 * WHY A CONFIRM AND NOT AN UNDO. There is no restore in the product: recovery is
 * a database operation. A single click that quietly unlists a customer's passport
 * with no way back is not a click anyone should be able to make by accident.
 *
 * The caller owns what happens next (`onDeleted`) — usually refetching, so the
 * row disappears from the same list the delete came from rather than being
 * removed from local state and drifting from the server.
 */

import { useState } from 'react';
import { Trash2, Loader2, AlertTriangle, X } from 'lucide-react';
import { apiDelete } from '@/lib/api';

export function DeleteDocumentButton({
  docId,
  label,
  onDeleted,
  disabled,
}: {
  docId: number;
  /** What the document is called, so the confirm names the thing being removed. */
  label: string;
  onDeleted: () => void;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiDelete(`/documents/${docId}`);
      setConfirming(false);
      onDeleted();
    } catch (e) {
      // A manager without the permission gets a 403 here even though the button
      // was rendered — the roster can be revoked between load and click. Show the
      // reason rather than failing silently.
      setErr(e instanceof Error ? e.message : 'Could not remove the document.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setErr(null); setConfirming(true); }}
        disabled={disabled || busy}
        title={`Remove ${label}`}
        aria-label={`Remove ${label}`}
        className="shrink-0 p-1.5 rounded-lg text-[#b91c1c] hover:bg-[#fee2e2] disabled:opacity-50 cursor-pointer"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </button>

      {confirming && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !busy && setConfirming(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-[380px] p-4">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-[#fee2e2] text-[#b91c1c] flex items-center justify-center shrink-0">
                <AlertTriangle size={15} />
              </span>
              <p className="text-sm font-bold text-[#14201a] flex-1 min-w-0">Remove this document?</p>
              <button type="button" onClick={() => !busy && setConfirming(false)}
                className="text-[#8a948d] hover:text-[#14201a] cursor-pointer shrink-0" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="text-[12.5px] text-[#5f6b63] mt-2.5 leading-relaxed">
              <strong className="text-[#14201a]">{label}</strong> will stop appearing anywhere on this record.
            </p>
            {err && (
              <p className="text-xs text-[#b91c1c] mt-2 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 mt-3.5">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-[#e4e9e5] text-[#14201a] hover:bg-[#eef1ef] disabled:opacity-50 cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={run} disabled={busy}
                className="px-3.5 py-2 rounded-xl text-sm font-semibold text-white bg-[#b91c1c] hover:bg-[#991b1b] disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5">
                {busy && <Loader2 size={13} className="animate-spin" />} Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
