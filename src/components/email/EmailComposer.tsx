'use client';

/**
 * Write a new email — a slide-over. Opened from a customer, a lead or a vendor
 * (the recipient is fixed) or from the inbox (the recipient is picked from the
 * landlord's customers, leads and vendors; nobody else can be written to from here).
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Paperclip, Search, Send, X } from 'lucide-react';
import { useSlideOver } from '@/lib/useSlideOver';
import { emailApi, errorText, type EmailRecipient, type MailboxOne, type Rp } from '@/lib/emailApi';
import { AttachmentChips, SignedAs, useStagedAttachments } from './EmailThreadView';

export interface ComposeTo { tenantId?: number | null; leadId?: number | null; vendorId?: number | null; name: string; email: string }

export function EmailComposer({ rp, to, fromAddress, mailboxes = [], defaultMailboxId = null, defaultSubject = '', defaultBody = '', onClose, onSent }: {
  rp: Rp;
  /** The landlord's mailboxes — with more than one, the writer chooses which it goes out from. */
  mailboxes?: MailboxOne[];
  defaultMailboxId?: number | null;
  /** Fixed recipient; omit to show the picker. */
  to?: ComposeTo | null;
  fromAddress?: string | null;
  defaultSubject?: string;
  defaultBody?: string;
  onClose: () => void;
  onSent: (threadId: number) => void;
}) {
  const { closing, dismiss } = useSlideOver(onClose);
  const [picked, setPicked] = useState<ComposeTo | null>(to ?? null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<EmailRecipient[]>([]);
  const [fromId, setFromId] = useState<number | null>(defaultMailboxId ?? mailboxes[0]?.id ?? null);
  const [ccText, setCcText] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staged = useStagedAttachments(rp);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  useEffect(() => {
    if (picked) return;
    const t = window.setTimeout(() => { emailApi.recipients(rp, query).then(setHits).catch(() => setHits([])); }, 200);
    return () => window.clearTimeout(t);
  }, [rp, query, picked]);

  const send = async () => {
    if (!picked || !subject.trim() || !body.trim() || sending) return;
    const cc = ccText.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const bad = cc.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad) { setError(`"${bad}" is not an email address`); return; }
    setSending(true); setError(null);
    try {
      const res = await emailApi.send(rp, { tenantId: picked.tenantId, leadId: picked.leadId, vendorId: picked.vendorId, subject: subject.trim(), body, cc, mailboxId: mailboxes.length > 1 ? fromId : null, attachments: staged.files });
      onSent(res.threadId);
      dismiss();
    } catch (e) { setError(errorText(e, 'The email could not be sent')); setSending(false); }
  };

  const INPUT = 'w-full border border-[#e4e9e5] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#047246]';

  return (
    <div className="fixed inset-0 z-50">
      <div className={`slideover-scrim${closing ? ' closing' : ''} absolute inset-0 bg-black/40`} onClick={dismiss} />
      <div className={`slideover-panel${closing ? ' closing' : ''} absolute right-0 top-0 h-full w-full max-w-[640px] bg-white shadow-2xl flex flex-col`}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#e4e9e5]">
          <button type="button" onClick={dismiss} aria-label="Back" className="p-1.5 rounded-lg hover:bg-[#eef1ef] cursor-pointer text-[#5f6b63]"><ArrowLeft size={18} /></button>
          <div className="flex-1">
            <div className="text-base font-semibold text-[#14201a]">New email</div>
            {mailboxes.length <= 1 && fromAddress && <div className="text-xs text-[#8a948d]">From {fromAddress}</div>}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {mailboxes.length > 1 && (
            <div>
              <label htmlFor="em-from" className="block text-xs font-medium text-[#5f6b63] mb-1.5">From</label>
              <select id="em-from" className={INPUT} value={fromId ?? ''} onChange={(e) => setFromId(Number(e.target.value) || null)}>
                {mailboxes.map((b) => <option key={b.id} value={b.id}>{b.label} — {b.emailAddress}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-[#5f6b63] mb-1.5">To</label>
            {picked ? (
              <div className="flex items-center gap-2 border border-[#e4e9e5] rounded-lg px-3 py-2 bg-[#fbfaf8]">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#14201a] truncate">{picked.name}</div>
                  <div className="text-xs text-[#5f6b63] truncate">{picked.email}</div>
                </div>
                {!to && <button type="button" aria-label="Choose someone else" onClick={() => setPicked(null)} className="p-1 rounded hover:bg-[#e4e9e5] cursor-pointer text-[#5f6b63]"><X size={14} /></button>}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a948d]" />
                  <input autoFocus className={`${INPUT} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your customers, leads and vendors" />
                </div>
                <div className="mt-1.5 border border-[#e4e9e5] rounded-lg divide-y divide-[#f0eee9] max-h-64 overflow-y-auto">
                  {hits.length === 0 && <div className="px-3 py-3 text-xs text-[#8a948d]">No customer, lead or vendor with an email address matches.</div>}
                  {hits.map((h) => (
                    <button key={`${h.kind}-${h.tenantId ?? h.leadId ?? h.vendorId}`} type="button" onClick={() => setPicked({ tenantId: h.tenantId, leadId: h.leadId, vendorId: h.vendorId, name: h.name, email: h.email })}
                      className="w-full text-left px-3 py-2 hover:bg-[#eef1ef] cursor-pointer flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[#14201a] truncate">{h.name}</div>
                        <div className="text-xs text-[#5f6b63] truncate">{h.email}</div>
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a948d]">{h.kind === 'customer' ? 'Customer' : h.kind === 'vendor' ? 'Vendor' : 'Lead'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div>
            <label htmlFor="em-cc" className="block text-xs font-medium text-[#5f6b63] mb-1.5">Cc <span className="font-normal text-[#8a948d]">— optional; anyone you want kept in copy, separated by commas</span></label>
            <input id="em-cc" className={INPUT} value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="broker@example.com, owner@example.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5f6b63] mb-1.5">Subject</label>
            <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5f6b63] mb-1.5">Message</label>
            <textarea className={`${INPUT} min-h-[240px] resize-y`} value={body} onChange={(e) => setBody(e.target.value)} />
            <SignedAs text={(mailboxes.find((b) => b.id === fromId) ?? mailboxes[0])?.signaturePreview} />
          </div>
          <AttachmentChips files={staged.files} onRemove={staged.remove} />
        </div>

        <div className="px-5 py-3 border-t border-[#e4e9e5] flex items-center gap-2">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void staged.add(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={staged.uploading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#e4e9e5] text-[#4a4842] hover:border-[#047246] cursor-pointer disabled:opacity-60">
            {staged.uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Attach
          </button>
          <span className="text-xs text-[#b42318] flex-1">{error ?? staged.error ?? ''}</span>
          <button type="button" onClick={send} disabled={!picked || !subject.trim() || !body.trim() || sending || staged.uploading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#047246] text-white hover:bg-[#26856d] cursor-pointer disabled:opacity-60">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
