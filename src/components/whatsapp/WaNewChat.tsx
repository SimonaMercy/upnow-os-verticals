'use client';

/**
 * Start a WhatsApp conversation from the platform: pick a customer, a lead or a
 * vendor on record — or type a number nobody owns yet — choose which of the
 * landlord's numbers writes, and send the first message.
 */
import { useEffect, useState } from 'react';
import { Loader2, Search, Send, X } from 'lucide-react';
import { KIND_CHIP, KIND_LABEL, errorText, prettyPhone, whatsappApi, type Rp, type WaLine, type WaPerson } from '@/lib/whatsappApi';

export function WaNewChat({ rp, lines, preset = null, onClose, onStarted }: {
  rp: Rp; lines: WaLine[];
  /** Opened from a person's own page: the recipient is already known. */
  preset?: WaPerson | null;
  onClose: () => void; onStarted: (chatId: number) => void;
}) {
  const usable = lines.filter((l) => l.status === 'connected');
  const [lineId, setLineId] = useState<number | null>(usable[0]?.id ?? null);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<WaPerson[]>([]);
  const [person, setPerson] = useState<WaPerson | null>(preset);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => { whatsappApi.people(rp, q).then(setPeople).catch(() => setPeople([])); }, 200);
    return () => window.clearTimeout(t);
  }, [q, rp]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const digits = q.replace(/\D/g, '');
  const typedNumber = !person && digits.length >= 9 && /^[+\d\s()-]+$/.test(q.trim()) ? digits : null;
  const target = person ? { name: person.name, phone: person.phone } : typedNumber ? { name: prettyPhone(typedNumber), phone: typedNumber } : null;

  const send = async () => {
    if (!lineId || !target || !body.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await whatsappApi.start(rp, {
        lineId, body: body.trim(),
        ...(person?.kind === 'customer' ? { tenantId: person.id } : person?.kind === 'lead' ? { leadId: person.id } : person?.kind === 'vendor' ? { vendorId: person.id } : { phone: typedNumber ?? undefined }),
      });
      if (r.status === 'not_sent') { setError(r.error || 'WhatsApp did not accept the message'); return; }
      onStarted(r.chatId); onClose();
    } catch (e) { setError(errorText(e, 'The conversation could not be started')); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="New WhatsApp message" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[520px] max-h-[88vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#e4e9e5] shrink-0">
          <h2 className="text-base font-semibold text-[#14201a] flex-1">New WhatsApp message</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-full text-[#5f6b63] hover:bg-[#eef1ef] cursor-pointer"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {usable.length === 0 && <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">None of your numbers is connected to WhatsApp right now, so a new message cannot be sent.</div>}
          {usable.length > 1 && (
            <div>
              <label htmlFor="wa-new-line" className="block text-xs font-medium text-[#5f6b63] mb-1.5">Send from</label>
              <select id="wa-new-line" value={lineId ?? ''} onChange={(e) => setLineId(Number(e.target.value))} className="w-full border border-[#e4e9e5] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#047246]">
                {usable.map((l) => <option key={l.id} value={l.id}>{l.label}{l.phone ? ` · ${prettyPhone(l.phone)}` : ''}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="wa-new-to" className="block text-xs font-medium text-[#5f6b63] mb-1.5">To</label>
            {person ? (
              <div className="flex items-center gap-2 border border-[#e4e9e5] rounded-lg px-3 py-2">
                <span className="text-sm text-[#14201a] truncate flex-1">{person.name} <span className="text-[#5f6b63]">· {person.phone ? prettyPhone(person.phone) : 'no number on record'}</span></span>
                <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${KIND_CHIP[person.kind]}`}>{KIND_LABEL[person.kind]}</span>
                {!preset && <button type="button" onClick={() => setPerson(null)} aria-label="Choose someone else" className="p-1 rounded-full text-[#5f6b63] hover:bg-[#eef1ef] cursor-pointer"><X size={13} /></button>}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a948d]" />
                  <input id="wa-new-to" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, unit — or a number like +971 50 123 4567" className="w-full border border-[#e4e9e5] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#047246]" />
                </div>
                <div className="mt-2 border border-[#e4e9e5] rounded-lg max-h-[220px] overflow-y-auto divide-y divide-[#f0eee9]">
                  {typedNumber && <div className="px-3 py-2 text-sm text-[#1a7a5a] bg-[#eef9f4]">Write to {prettyPhone(typedNumber)} — a number that is not on record</div>}
                  {people.length === 0 && !typedNumber && <div className="px-3 py-4 text-xs text-[#8a948d] text-center">Nobody matches.</div>}
                  {people.map((p) => (
                    <button key={`${p.kind}-${p.id}`} type="button" disabled={!p.phone} onClick={() => setPerson(p)} className="w-full text-left px-3 py-2 hover:bg-[#fbfaf8] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                      <div className="flex items-center gap-2"><span className="text-sm text-[#14201a] truncate flex-1">{p.name}</span><span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${KIND_CHIP[p.kind]}`}>{KIND_LABEL[p.kind]}</span></div>
                      <div className="text-xs text-[#5f6b63] truncate">{[p.detail, p.phone ? prettyPhone(p.phone) : 'No number on record'].filter(Boolean).join(' · ')}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div>
            <label htmlFor="wa-new-body" className="block text-xs font-medium text-[#5f6b63] mb-1.5">Message</label>
            <textarea id="wa-new-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} dir="auto" placeholder="Type a message" className="w-full border border-[#e4e9e5] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#047246] resize-y" />
            <p className="text-[11px] text-[#8a948d] mt-1">Photos, documents and voice notes can be sent once the conversation is open.</p>
          </div>
          {error && <div className="text-sm text-[#b42318]">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[#e4e9e5] shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-[#e4e9e5] text-[#4a4842] hover:border-[#8a948d] cursor-pointer">Cancel</button>
          <button type="button" onClick={() => void send()} disabled={!lineId || !target?.phone || !body.trim() || busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#047246] text-white hover:bg-[#26856d] cursor-pointer disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
