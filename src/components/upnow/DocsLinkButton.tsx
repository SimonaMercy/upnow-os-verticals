'use client';

import { useState } from 'react';
import { Send, ExternalLink, Mail, Copy, Check } from 'lucide-react';

/**
 * One shared control for the customer document-upload link — used everywhere a
 * landlord/manager needs to collect documents (customer profile, lease, KYC
 * steps, document binder). Three explicit actions:
 *   • Generate link   — mints a secure link (does NOT email)
 *   • Open / Copy      — share it manually (WhatsApp, in person)
 *   • Send by email    — email it to the customer on demand (resendable)
 *
 * `contractId` is optional: omit it for a standalone (no-lease) link from a
 * customer's profile; pass it to attach the link to a specific tenancy. The
 * backend (POST /api/portal/generate) resolves the caller (RP owner or assigned
 * manager) and enforces portfolio + can_manage_documents — no extra scoping here.
 */
export function DocsLinkButton({
  tenantId,
  contractId = null,
  label = 'Send documents link',
}: {
  tenantId: number;
  contractId?: number | null;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'generating' | 'ready' | 'emailing' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const call = async (sendEmail: boolean) => {
    const res = await fetch('/api/portal/generate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, contractId, purpose: 'documents', sendEmail }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message ?? `Error ${res.status}`);
    }
    return res.json() as Promise<{ link: string; email: string | null }>;
  };

  const generate = async () => {
    setState('generating');
    try {
      const d = await call(false);
      setLink(d.link ?? '');
      setEmail(d.email ?? null);
      setEmailedTo(null);
      setState('ready');
      if (d.link) {
        try { await navigator.clipboard.writeText(d.link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
      }
    } catch { setState('error'); }
  };

  const sendByEmail = async () => {
    setState('emailing');
    try {
      const d = await call(true);
      if (d.link) setLink(d.link);
      setEmailedTo(d.email ?? email);
      setState('ready');
    } catch { setState('error'); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  if ((state === 'ready' || state === 'emailing') && link) {
    return (
      <div className="flex flex-col gap-2 w-full max-w-md">
        <div className="flex items-center gap-2">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 text-[11px] px-2.5 py-1.5 rounded-lg border border-[#e8e6e0] bg-[#fafaf8] text-[#1a1916]" />
          <button type="button" onClick={copy}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-[#e8e6e0] text-[#1a7a5a] hover:bg-[#f0faf6] whitespace-nowrap cursor-pointer">
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
          <a href={link} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-[#e8e6e0] text-[#1a7a5a] hover:bg-[#f0faf6] whitespace-nowrap">
            <ExternalLink size={12} /> Open
          </a>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={sendByEmail} disabled={state === 'emailing'}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#26866d] disabled:opacity-60 cursor-pointer">
            <Mail size={12} /> {state === 'emailing' ? 'Sending…' : emailedTo ? 'Resend email' : 'Send by email'}
          </button>
          {emailedTo
            ? <span className="text-[11px] text-[#16a34a] font-medium inline-flex items-center gap-1"><Check size={12} /> Emailed to {emailedTo}</span>
            : email ? <span className="text-[11px] text-[#9b9890]">Will email {email}</span> : null}
          <button type="button" onClick={generate} className="text-[11px] text-[#9b9890] underline hover:text-[#6b6860] cursor-pointer">New link</button>
        </div>
        <p className="text-[10.5px] text-[#9b9890]">Secure upload link · valid 14 days · share by copy/open or email.</p>
      </div>
    );
  }

  return (
    <button type="button" onClick={generate} disabled={state === 'generating'}
      className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-full border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] disabled:opacity-60 shrink-0 cursor-pointer">
      <Send size={14} /> {state === 'generating' ? 'Generating…' : state === 'error' ? 'Retry' : label}
    </button>
  );
}
