'use client';

/**
 * Who this WhatsApp conversation is with, as the platform knows them: the
 * customer's units and contracts, the lead's stage, the vendor, the team member.
 * A number nobody owns yet (an assistant, a spouse, a second phone) can be tied
 * to the right person by hand — and untied again.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, ExternalLink, Link2, Loader2, Search, Unlink, X } from 'lucide-react';
import { KIND_CHIP, KIND_LABEL, errorText, prettyPhone, whatsappApi, type Rp, type WaChatDetail, type WaPerson } from '@/lib/whatsappApi';
import { relationshipLabel } from '@/lib/customerContactsApi';

const STATUS_TONE: Record<string, string> = {
  active: 'text-[#1a7a5a] bg-[#eef9f4]', expired: 'text-[#5f6b63] bg-[#eef1ef]', terminated: 'text-[#b42318] bg-red-50', draft: 'text-[#8a6d1d] bg-[#fdf3e3]',
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const words = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function WaContextPanel({ rp, isManager, chat, onClose, onLinked }: {
  rp: Rp; isManager: boolean; chat: WaChatDetail; onClose: () => void; onLinked: (next: WaChatDetail) => void;
}) {
  const base = isManager ? '/dashboard/manager' : '/rental-provider/dashboard';
  const contractHref = (id: number) => (isManager ? `${base}/contracts/${id}` : `${base}/contracts/${id}/v2`);
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<WaPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linking) return;
    const t = window.setTimeout(() => { whatsappApi.people(rp, q).then(setPeople).catch(() => setPeople([])); }, 200);
    return () => window.clearTimeout(t);
  }, [linking, q, rp]);

  const link = async (body: { kind: 'customer' | 'lead' | 'vendor' | 'none'; id?: number }) => {
    setBusy(true); setError(null);
    try { onLinked(await whatsappApi.link(rp, chat.id, body)); setLinking(false); setQ(''); }
    catch (e) { setError(errorText(e, 'Could not link this conversation')); } finally { setBusy(false); }
  };

  const c = chat.context;
  return (
    <aside className="h-full flex flex-col bg-white border-l border-[#e4e9e5] w-full" aria-label="About this conversation">
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-[#e4e9e5] shrink-0">
        <span className="text-sm font-semibold text-[#14201a] flex-1">About this conversation</span>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-full text-[#5f6b63] hover:bg-[#eef1ef] cursor-pointer"><X size={15} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5 text-sm">
        <section>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-[#14201a] break-words">{chat.name}</span>
            <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${KIND_CHIP[chat.kind]}`}>{KIND_LABEL[chat.kind]}</span>
          </div>
          {chat.phone && !chat.isGroup && <div className="text-[#4a4842] mt-1 tabular-nums">{prettyPhone(chat.phone)}</div>}
          {chat.contact && (
            <div className="mt-2 rounded-lg bg-[#eef9f4] px-3 py-2 text-xs text-[#1a5c45] leading-relaxed">
              <span className="font-semibold">{relationshipLabel(chat.contact.relationship)}</span>{chat.contact.name ? ` · ${chat.contact.name}` : ''} — not the customer’s primary number. Kept under the customer’s other contacts.
            </div>
          )}
          <dl className="mt-2 space-y-1 text-xs text-[#5f6b63]">
            {chat.savedName && <div className="flex gap-2"><dt className="w-[92px] shrink-0">Saved on phone</dt><dd className="text-[#2b2a27] break-words">{chat.savedName}</dd></div>}
            {chat.profileName && <div className="flex gap-2"><dt className="w-[92px] shrink-0">WhatsApp name</dt><dd className="text-[#2b2a27] break-words">{chat.profileName}</dd></div>}
            <div className="flex gap-2"><dt className="w-[92px] shrink-0">On number</dt><dd className="text-[#2b2a27]">{chat.lineLabel}</dd></div>
            {chat.isBusiness && <div className="flex gap-2"><dt className="w-[92px] shrink-0">Account</dt><dd className="text-[#2b2a27]">WhatsApp Business</dd></div>}
          </dl>
        </section>

        {c?.type === 'customer' && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#8a948d] mb-2">Units and contracts</h3>
            {c.contracts.length === 0 && <p className="text-xs text-[#8a948d]">No contract on record.</p>}
            <div className="space-y-2">
              {c.contracts.map((k) => (
                <Link key={k.id} href={contractHref(k.id)} className="block rounded-xl border border-[#e4e9e5] hover:border-[#047246] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Building2 size={14} className="text-[#5f6b63] shrink-0" />
                    <span className="font-semibold text-[#14201a] truncate">Unit {k.unitNumber}</span>
                    <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${STATUS_TONE[k.status] ?? 'text-[#5f6b63] bg-[#eef1ef]'}`}>{words(k.status)}</span>
                  </div>
                  <div className="text-xs text-[#5f6b63] mt-0.5 truncate">{k.buildingName}</div>
                  <div className="text-xs text-[#5f6b63] tabular-nums">{day(k.startDate)} → {day(k.endDate)}</div>
                </Link>
              ))}
            </div>
            <Link href={`${base}/tenants/${c.id}`} className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium text-[#1a7a5a] hover:underline">Open the customer <ExternalLink size={13} /></Link>
          </section>
        )}
        {c?.type === 'lead' && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#8a948d] mb-2">Lead</h3>
            <div className="rounded-xl border border-[#e4e9e5] px-3 py-2.5 space-y-0.5">
              <div className="flex items-center gap-2"><span className="font-semibold text-[#14201a]">{words(c.stage)}</span>{c.source && <span className="text-xs text-[#5f6b63]">via {words(c.source)}</span>}</div>
              <div className="text-xs text-[#5f6b63]">{c.unitNumber ? `Unit ${c.unitNumber} · ${c.buildingName ?? ''}` : 'Unit not chosen yet'}</div>
            </div>
            <Link href={`${base}/leads/${c.id}`} className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium text-[#1a7a5a] hover:underline">Open the lead <ExternalLink size={13} /></Link>
          </section>
        )}
        {c?.type === 'vendor' && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#8a948d] mb-2">Vendor</h3>
            <div className="rounded-xl border border-[#e4e9e5] px-3 py-2.5"><div className="font-semibold text-[#14201a]">{c.name}</div>{c.email && <div className="text-xs text-[#5f6b63] break-all">{c.email}</div>}</div>
          </section>
        )}
        {c?.type === 'team' && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#8a948d] mb-2">Your team</h3>
            <div className="rounded-xl border border-[#e4e9e5] px-3 py-2.5"><div className="font-semibold text-[#14201a]">{c.name}</div><div className="text-xs text-[#5f6b63]">{words(c.role)}</div></div>
          </section>
        )}

        {/* Saying whose number this is re-files the conversation — a write, so read-only team members do not get it. */}
        {!chat.isGroup && chat.canSend && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#8a948d] mb-2">{chat.kind === 'other' ? 'Not on record' : 'Link'}</h3>
            {chat.kind === 'other' && !linking && <p className="text-xs text-[#5f6b63] mb-2.5 leading-relaxed">This number does not belong to any customer, lead or vendor. If it is somebody’s assistant, family or second phone, link it to them and it moves to their tab.</p>}
            {!linking ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setLinking(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#e4e9e5] text-[#2b2a27] hover:border-[#047246] cursor-pointer"><Link2 size={14} /> {chat.kind === 'other' ? 'Link to a person' : 'Link to someone else'}</button>
                {chat.linkedManually && <button type="button" disabled={busy} onClick={() => void link({ kind: 'none' })} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#e4e9e5] text-[#5f6b63] hover:border-[#b42318] hover:text-[#b42318] cursor-pointer disabled:opacity-60"><Unlink size={14} /> Remove the link</button>}
              </div>
            ) : (
              <div className="rounded-xl border border-[#e4e9e5] overflow-hidden">
                <div className="relative border-b border-[#e4e9e5]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a948d]" />
                  <input id="wa-link-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, unit or number" className="w-full pl-9 pr-9 py-2.5 text-sm focus:outline-none" />
                  <button type="button" onClick={() => { setLinking(false); setQ(''); }} aria-label="Cancel" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-[#5f6b63] hover:bg-[#eef1ef] cursor-pointer"><X size={13} /></button>
                </div>
                <div className="max-h-[260px] overflow-y-auto divide-y divide-[#f0eee9]">
                  {people.length === 0 && <div className="px-3 py-4 text-xs text-[#8a948d] text-center">Nobody matches.</div>}
                  {people.map((p) => (
                    <button key={`${p.kind}-${p.id}`} type="button" disabled={busy} onClick={() => void link({ kind: p.kind, id: p.id })} className="w-full text-left px-3 py-2 hover:bg-[#fbfaf8] cursor-pointer disabled:opacity-60">
                      <div className="flex items-center gap-2"><span className="text-sm text-[#14201a] truncate flex-1">{p.name}</span><span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${KIND_CHIP[p.kind]}`}>{KIND_LABEL[p.kind]}</span></div>
                      <div className="text-xs text-[#5f6b63] truncate">{[p.detail, p.phone].filter(Boolean).join(' · ')}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {busy && <div className="mt-2 text-xs text-[#5f6b63] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Saving…</div>}
            {error && <div className="mt-2 text-xs text-[#b42318]">{error}</div>}
          </section>
        )}
      </div>
    </aside>
  );
}
