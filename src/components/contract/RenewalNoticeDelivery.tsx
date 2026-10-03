/**
 * Renewal notice delivery — did the customer actually get the email?
 *
 * "Send to customer" moves the lease to an offer whatever happens to the email,
 * and on production most email is switched off. So the lease page says what
 * really happened to the notice, from the delivery record the backend keeps on
 * every send (GET /contracts/:id/renewal/notice-log): emailed — to whom, from
 * which address, when, by whom — or NOT emailed, and why. The email itself can
 * be opened exactly as it was sent. Owner, 3 Oct 2026: "keep tracking to verify
 * the email is sent correctly from production".
 */
'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Mail, X, AlertTriangle } from 'lucide-react';

export interface RenewalNoticeRecord {
  id: number;
  at: string;
  status: 'sent' | 'blocked' | 'failed';
  reason?: string;
  to: string | null;
  cc?: string[];
  from: string | null;
  viaLandlordMailbox?: boolean;
  fellBack?: string;
  messageId?: string;
  subject?: string;
  html?: string;
  sentBy?: string | null;
}

/** Why a notice was not emailed, in words a manager can act on. */
const REASONS: Record<string, string> = {
  otp_only_mode: 'emails are switched off on this server (only login codes are sent)',
  tenant_email_suppressed: 'emails to customers are switched off on this server',
  email_disabled: 'emails are switched off on this server',
  missing_api_key: 'the email service is not set up on this server',
  no_customer_email: 'the customer has no email address on file',
};

export function noticeReasonText(reason?: string | null): string {
  if (!reason) return 'unknown reason';
  return REASONS[reason] ?? reason;
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function RenewalNoticeDelivery({ parentContractId }: { parentContractId: number }) {
  const [rows, setRows] = useState<RenewalNoticeRecord[] | null>(null);
  const [viewing, setViewing] = useState<RenewalNoticeRecord | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetch(`/api/contracts/${parentContractId}/renewal/notice-log`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .then((list: RenewalNoticeRecord[]) => {
          if (cancelled) return;
          setRows(Array.isArray(list) ? list : []);
          // Just sent: the email goes out in the background, so its record can
          // trail the Send by a few seconds. Look again briefly before saying
          // there is none.
          if ((!Array.isArray(list) || !list.length) && ++tries < 6) timer = setTimeout(load, 3000);
        })
        .catch(() => { if (!cancelled) setRows([]); });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [parentContractId]);

  if (rows === null) {
    return <div className="text-xs text-gray-500 py-1">Checking the renewal notice email…</div>;
  }

  if (!rows.length) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 px-3 py-2 text-xs">
        <Mail size={14} className="mt-0.5 shrink-0" />
        <span>
          No email record for this renewal notice. It was sent before email tracking began
          (3 Oct 2026), or it is still being sent.
        </span>
      </div>
    );
  }

  const [latest, ...earlier] = rows;
  const by = latest.sentBy ? <> · by {latest.sentBy}</> : null;

  return (
    <div className="grid gap-1.5" style={{ justifySelf: 'stretch' }}>
      {latest.status === 'sent' ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <strong>Renewal notice emailed</strong> to <span className="break-all">{latest.to}</span>
            {latest.cc?.length ? <> (cc <span className="break-all">{latest.cc.join(', ')}</span>)</> : null}
            {' '}from <span className="break-all">{latest.from}</span> · {fmtWhen(latest.at)}{by}
            {' · '}
            <button type="button" className="underline font-semibold" onClick={() => setViewing(latest)}>View email</button>
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-xs">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <strong>Renewal notice NOT emailed</strong>
            {latest.status === 'failed' ? ' — sending failed: ' : ' — '}
            {noticeReasonText(latest.reason)}. The customer has not received it from the system;
            send it by hand. · {fmtWhen(latest.at)}{by}
            {latest.html ? <>{' · '}<button type="button" className="underline font-semibold" onClick={() => setViewing(latest)}>View email</button></> : null}
          </span>
        </div>
      )}

      {latest.status === 'sent' && latest.fellBack && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-xs">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Sent from the platform address because the landlord&apos;s mailbox refused it
            ({latest.fellBack}). Replies will not reach the landlord&apos;s inbox.
          </span>
        </div>
      )}

      {earlier.length > 0 && (
        <div className="text-xs text-gray-500">
          <button type="button" className="underline" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Hide' : 'Show'} earlier attempts ({earlier.length})
          </button>
          {showAll && (
            <ul className="mt-1 grid gap-0.5">
              {earlier.map(r => (
                <li key={r.id}>
                  {fmtWhen(r.at)} · {r.status === 'sent' ? `emailed to ${r.to}` : `not emailed — ${noticeReasonText(r.reason)}`}
                  {r.sentBy ? ` · by ${r.sentBy}` : ''}
                  {r.html ? <>{' · '}<button type="button" className="underline" onClick={() => setViewing(r)}>view</button></> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm overflow-y-auto" onClick={() => setViewing(null)}>
          <div className="max-w-4xl mx-auto my-6 px-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 bg-[#2e9f82] text-white rounded-t-2xl px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">{viewing.subject ?? 'Renewal notice'}</div>
                <div className="text-[11px] text-white/80 break-all">
                  {viewing.status === 'sent' ? 'As emailed' : 'Not emailed'} · {fmtWhen(viewing.at)}
                  {viewing.from ? ` · from ${viewing.from}` : ''}{viewing.to ? ` · to ${viewing.to}` : ''}
                  {viewing.messageId ? ` · Message-ID ${viewing.messageId}` : ''}
                </div>
              </div>
              <button onClick={() => setViewing(null)} className="p-1.5 rounded-lg hover:bg-white/20" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="bg-white rounded-b-2xl p-4">
              {/* Sandboxed: stored email HTML must not run scripts or navigate. */}
              <iframe title="Renewal notice as sent" srcDoc={viewing.html ?? ''} sandbox=""
                      className="w-full h-[70vh] rounded-lg border border-gray-200 bg-white" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
