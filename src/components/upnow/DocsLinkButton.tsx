'use client';

import { useState, useRef } from 'react';
import { Send, ExternalLink, Mail, Copy, Check, X, FileText, Paperclip } from 'lucide-react';
import { REQUESTABLE_DOCS } from '@/lib/requestableDocs';

/**
 * Shared "request documents from the customer" control — used wherever a
 * landlord/manager collects documents from a customer (customer profile, lead).
 *
 * The flow is request-scoped by design: the RP first PICKS the exact documents
 * they need (one or many), which creates request rows (POST /documents/request);
 * the external upload link then shows the customer ONLY those documents — nothing
 * else from the catalog. After picking, the link can be copied, opened, or
 * emailed to the customer on demand.
 *
 * `contractId` is optional: omit it for a standalone (no-lease) request from a
 * customer's profile; pass it to attach the link to a specific tenancy. The
 * backend (POST /api/portal/generate, POST /api/documents/request) resolves the
 * caller (RP owner or assigned manager) and enforces portfolio + can_manage_documents.
 */
export function DocsLinkButton({
  tenantId,
  contractId = null,
  label = 'Request documents',
}: {
  tenantId: number;
  contractId?: number | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<'pick' | 'ready' | 'emailing' | 'error'>('pick');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setSelected([]); setQuery(''); setMenuOpen(false); setNotes('');
    setPhase('pick'); setBusy(false); setLink(''); setEmail(null);
    setEmailedTo(null); setCopied(false); setErr(null);
  };
  const close = () => { setOpen(false); reset(); };

  const addDoc = (name: string) => {
    const n = name.trim();
    if (!n) return;
    setSelected(prev => prev.some(x => x.toLowerCase() === n.toLowerCase()) ? prev : [...prev, n]);
    setQuery(''); setMenuOpen(false);
  };
  const removeDoc = (name: string) => setSelected(prev => prev.filter(x => x !== name));

  /** Create one request row per picked document. */
  const requestAll = async (labels: string[]) => {
    for (let i = 0; i < labels.length; i++) {
      const name = labels[i];
      const documentKey = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '_' + Date.now() + '_' + i;
      const res = await fetch('/api/documents/request', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantId, documentKey,
          displayName: name, category: 'contract', notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { message?: string | string[] };
        throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${res.status}`));
      }
    }
  };

  const generate = async (sendEmail: boolean) => {
    const res = await fetch('/api/portal/generate', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, contractId, purpose: 'documents', sendEmail }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b?.message ?? `Error ${res.status}`);
    }
    return res.json() as Promise<{ link: string; email: string | null }>;
  };

  /** Anything still typed in the search box counts as a selection too. */
  const effectiveLabels = () => {
    const typed = query.trim();
    const labels = [...selected];
    if (typed && !labels.some(l => l.toLowerCase() === typed.toLowerCase())) labels.push(typed);
    return labels;
  };

  const submit = async () => {
    const labels = effectiveLabels();
    if (!labels.length) return;
    setBusy(true); setErr(null);
    try {
      await requestAll(labels);
      setSelected(labels); setQuery('');
      const d = await generate(false);
      setLink(d.link ?? ''); setEmail(d.email ?? null); setEmailedTo(null);
      setPhase('ready');
      if (d.link) { try { await navigator.clipboard.writeText(d.link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to request documents'); setPhase('error');
    } finally { setBusy(false); }
  };

  const sendByEmail = async () => {
    setPhase('emailing');
    try {
      const d = await generate(true);
      if (d.link) setLink(d.link);
      setEmailedTo(d.email ?? email);
      setPhase('ready');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to email'); setPhase('error'); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const canSubmit = selected.length > 0 || query.trim().length > 0;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-full border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] shrink-0 cursor-pointer">
        <Send size={14} /> {label}
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} role="dialog" aria-modal="true">
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }} onClick={close} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -24px rgba(26,23,20,.5)', width: '100%', maxWidth: 480, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1a1916' }}>Request documents</p>
              <button type="button" onClick={close} style={{ display: 'grid', placeItems: 'center', border: '1px solid #e8e6e0', background: '#fff', borderRadius: 8, width: 26, height: 26, cursor: 'pointer', color: '#6b6860' }}><X size={13} /></button>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#9b9890' }}>The customer&apos;s upload link will show only the documents you pick here.</p>

            {phase === 'ready' || phase === 'emailing' ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-xl bg-[#f0faf6] border border-[#bbf7d0] px-3 py-2.5">
                  <p className="text-[12px] font-semibold text-[#166534] flex items-center gap-1.5"><Check size={13} /> Requested {selected.length} document{selected.length === 1 ? '' : 's'}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {selected.map(n => <span key={n} className="text-[11px] text-[#1a7a5a] bg-white border border-[#cfe9df] rounded-full px-2 py-0.5">{n}</span>)}
                  </div>
                </div>
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
                  <button type="button" onClick={sendByEmail} disabled={phase === 'emailing'}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#26866d] disabled:opacity-60 cursor-pointer">
                    <Mail size={12} /> {phase === 'emailing' ? 'Sending…' : emailedTo ? 'Resend email' : 'Send by email'}
                  </button>
                  {emailedTo
                    ? <span className="text-[11px] text-[#16a34a] font-medium inline-flex items-center gap-1"><Check size={12} /> Emailed to {emailedTo}</span>
                    : email ? <span className="text-[11px] text-[#9b9890]">Will email {email}</span> : null}
                  <button type="button" onClick={close} className="text-[11px] text-[#9b9890] underline hover:text-[#6b6860] cursor-pointer ml-auto">Done</button>
                </div>
                <p className="text-[10.5px] text-[#9b9890]">Secure upload link · valid 14 days · share by copy/open or email.</p>
              </div>
            ) : (
              <>
                {selected.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {selected.map(name => (
                      <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#1a7a5a', background: '#eef9f4', border: '1px solid #cfe9df', borderRadius: 999, padding: '3px 6px 3px 10px' }}>
                        {name}
                        <button type="button" onClick={() => removeDoc(name)} style={{ display: 'grid', placeItems: 'center', border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 2 }} title="Remove"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  <input
                    ref={inputRef} autoFocus value={query}
                    placeholder="Search or type a document name, Enter to add…"
                    onChange={e => { setQuery(e.target.value); setMenuOpen(true); }}
                    onFocus={() => setMenuOpen(true)}
                    onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                    onKeyDown={e => { if (e.key === 'Escape') setMenuOpen(false); if (e.key === 'Enter') { e.preventDefault(); addDoc(query); } }}
                    className="w-full text-[13px] px-3 py-2 rounded-lg border border-[#e8e6e0] bg-white text-[#1a1916]"
                  />
                  {menuOpen && (() => {
                    const q = query.trim().toLowerCase();
                    const matches = REQUESTABLE_DOCS.filter(d => d.toLowerCase().includes(q) && !selected.some(s => s.toLowerCase() === d.toLowerCase()));
                    if (matches.length === 0) return null;
                    return (
                      <div style={{ position: 'absolute', zIndex: 30, marginTop: 4, width: '100%', maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #e8e6e0', borderRadius: 10, boxShadow: '0 8px 22px rgba(0,0,0,0.10)' }}>
                        {matches.map(d => (
                          <button key={d} type="button" onMouseDown={e => e.preventDefault()} onClick={() => addDoc(d)}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f0faf6')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#1a1916', cursor: 'pointer', background: 'transparent', border: 'none' }}>
                            <FileText size={12} style={{ color: '#9b9890', flexShrink: 0 }} /> {d}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <input value={notes} placeholder="Instructions for the customer (optional)" onChange={e => setNotes(e.target.value)}
                  className="w-full text-[13px] px-3 py-2 rounded-lg border border-[#e8e6e0] bg-white text-[#1a1916] mt-2" />
                {err && <p className="text-[12px] text-[#b91c1c] mt-2">{err}</p>}
                <div className="flex items-center gap-2 mt-3">
                  <button type="button" onClick={() => void submit()} disabled={busy || !canSubmit}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white hover:bg-[#26866d] disabled:opacity-50 cursor-pointer">
                    <Paperclip size={14} /> {busy ? 'Requesting…' : 'Request & get link'}
                  </button>
                  <button type="button" onClick={close} className="text-[13px] font-semibold px-3 py-2 rounded-lg text-[#6b6860] hover:bg-[#f4f3ef] cursor-pointer">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
