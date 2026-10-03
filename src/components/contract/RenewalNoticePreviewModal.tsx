/**
 * Consent gate for "Send to Customer" on a renewal.
 *
 * Sending a renewal offer is not undoable from the manager's side: the lease
 * flips to `proposed`, the customer is notified, and the terms are on the
 * table. So the manager sees the EXACT email first — rendered by the same
 * builder the send uses (GET /contracts/:id/renewal/preview, which renders and
 * sends nothing) — and confirms.
 *
 * It also shows the resolved SENDER. A landlord whose mailbox is missing or
 * unreadable silently falls back to the platform's no-reply address, and the
 * only moment that is cheap to notice is before the customer has been mailed by
 * the wrong one.
 */
'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Send, Mail } from 'lucide-react';
import { useBackClose } from '@/lib/useSlideOver';
import { noticeReasonText } from './RenewalNoticeDelivery';

export interface RenewalNoticePreview {
  subject: string;
  html: string;
  to: string | null;
  from: { name: string | null; address: string };
  senderIsLandlordMailbox: boolean;
  alreadySent?: boolean;
  /** Why this server would NOT email it (production runs OTP-only), or null. */
  deliveryBlocked?: string | null;
}

export default function RenewalNoticePreviewModal({
  parentContractId, open, onClose, onSent,
}: {
  /** The lease BEING RENEWED — the renewal lives on it, not on the draft child. */
  parentContractId: number;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [preview, setPreview] = useState<RenewalNoticePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackClose(onClose, open && !sending);

  useEffect(() => {
    if (!open) { setPreview(null); setError(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/contracts/${parentContractId}/renewal/preview`, { credentials: 'include' })
      .then(async r => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.message ?? `Could not build the preview (${r.status}).`);
        return body as RenewalNoticePreview;
      })
      .then(p => { if (!cancelled) setPreview(p); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not build the preview.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, parentContractId]);

  if (!open) return null;

  const send = async () => {
    setSending(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${parentContractId}/renewal/send`, {
        method: 'PATCH', credentials: 'include',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.message ?? `Could not send the renewal (${res.status}).`);
      }
      onSent();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the renewal.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm overflow-y-auto"
         onClick={() => { if (!sending) onClose(); }}>
      <div className="max-w-4xl mx-auto my-6 px-4" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[#2e9f82] text-white rounded-t-2xl px-5 py-3 shadow-lg">
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">Review the renewal notice</div>
            <div className="text-[11px] text-white/70">This is exactly what the customer will receive</div>
          </div>
          <button onClick={onClose} disabled={sending}
                  className="p-1.5 rounded-lg hover:bg-white/20 transition-colors disabled:opacity-50"
                  aria-label="Close"><X size={18} /></button>
        </div>

        <div className="bg-white rounded-b-2xl shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 justify-center py-16 text-gray-500 text-sm">
              <Loader2 size={16} className="animate-spin" /> Building the preview…
            </div>
          )}

          {error && (
            <div className="m-5 flex items-start gap-2 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {preview && (
            <>
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 px-5 py-4 text-sm border-b border-gray-100">
                <dt className="text-gray-500">From</dt>
                <dd className="font-medium break-all">
                  {preview.from.name ? `${preview.from.name} ` : ''}&lt;{preview.from.address}&gt;
                </dd>
                <dt className="text-gray-500">To</dt>
                <dd className="font-medium break-all">{preview.to ?? <span className="text-red-600">no customer email on file</span>}</dd>
                <dt className="text-gray-500">Subject</dt>
                <dd className="font-medium">{preview.subject}</dd>
              </dl>

              {/* The sender is the thing most likely to be quietly wrong, so it
                  gets a warning rather than a line in the table above. */}
              {!preview.senderIsLandlordMailbox && (
                <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-amber-50 text-amber-800 px-4 py-3 text-sm">
                  <Mail size={16} className="mt-0.5 shrink-0" />
                  <span>
                    This will be sent from the platform address, not the landlord&apos;s own.
                    Connect a mailbox under <strong>Settings → Email</strong> for replies to reach them directly.
                  </span>
                </div>
              )}

              {/* The send moves the lease to an offer whether or not the email
                  leaves, so a server that will not email it says so first. */}
              {preview.deliveryBlocked && (
                <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>This email will NOT be sent</strong> — {noticeReasonText(preview.deliveryBlocked)}.
                    If you continue, the lease is marked as offered but the customer receives nothing
                    from the system; send the notice by hand.
                  </span>
                </div>
              )}

              {preview.alreadySent && (
                <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-amber-50 text-amber-800 px-4 py-3 text-sm">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>This renewal has already been sent to the customer.</span>
                </div>
              )}

              {/* Sandboxed: the email is rendered HTML and must not run scripts
                  or navigate the dashboard. srcDoc keeps it same-document-free. */}
              <div className="px-5 py-4">
                <iframe
                  title="Renewal notice preview"
                  srcDoc={preview.html}
                  sandbox=""
                  className="w-full h-[55vh] rounded-lg border border-gray-200 bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
                <button onClick={onClose} disabled={sending}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={send} disabled={sending || !preview.to}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#268a71] disabled:opacity-60">
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {sending ? 'Sending…' : preview.deliveryBlocked ? 'Mark as sent (no email)' : 'Confirm and send to customer'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
