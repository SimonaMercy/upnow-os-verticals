'use client';

/**
 * "Other contacts" inside the customer's identity card, under the primary Email / Phone: the extra addresses and numbers this
 * customer is reached through — their own second email, a spouse, a son, the
 * company's PRO. The primary email and phone stay on the customer's record and
 * are the only ones a contract shows; everything listed here only files emails
 * and WhatsApp chats under this customer, so the whole trail is in one place.
 *
 * A manager who cannot read the landlord's emails or WhatsApp gets nothing here
 * (the API answers 403 and the card does not render); one who can read but not
 * send sees the list without the controls.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  RELATIONSHIPS, contactErrorText, customerContactsApi, relationshipLabel,
  type ContactRelationship, type CustomerContact, type Rp,
} from '@/lib/customerContactsApi';

const INPUT = 'w-full border border-[#e4e9e5] rounded-lg px-3 py-1.5 text-sm text-[#14201a] focus:outline-none focus:border-[#047246]';
const LABEL = 'block text-xs font-medium text-[#5f6b63] mb-1';
type Draft = { id: number | null; name: string; relationship: ContactRelationship | ''; email: string; phone: string };
const EMPTY: Draft = { id: null, name: '', relationship: '', email: '', phone: '' };

export function CustomerContactsCard({ rp, tenantId }: {
  rp: Rp;
  tenantId: number;
}) {
  const [items, setItems] = useState<CustomerContact[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await customerContactsApi.list(rp, tenantId); setItems(r.items); setCanEdit(r.canEdit); }
    catch (e) { if ([400, 403, 404].includes((e as { status?: number }).status ?? 0)) setHidden(true); }
  }, [rp, tenantId]);
  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (hidden || items == null) return null;

  const save = async () => {
    if (!draft) return;
    if (!draft.email.trim() && !draft.phone.trim()) { setError('Add an email or a phone number'); return; }
    setBusy(true); setError(null);
    const body = { name: draft.name.trim() || null, relationship: draft.relationship || null, email: draft.email.trim() || null, phone: draft.phone.trim() || null };
    try {
      const r = draft.id == null ? await customerContactsApi.add(rp, tenantId, body) : await customerContactsApi.save(rp, draft.id, body);
      setItems(r.items); setDraft(null);
    } catch (e) { setError(contactErrorText(e, 'Could not save this contact')); } finally { setBusy(false); }
  };
  const remove = async (c: CustomerContact) => {
    const n = c.emailConversations + c.whatsappChats;
    if (!window.confirm(`Remove ${c.name || c.email || c.phone} from this customer?${n > 0 ? ` ${n} conversation${n === 1 ? '' : 's'} will no longer show under this customer.` : ''}`)) return;
    setBusy(true); setError(null);
    try { setItems((await customerContactsApi.remove(rp, c.id)).items); }
    catch (e) { setError(contactErrorText(e, 'Could not remove this contact')); } finally { setBusy(false); }
  };
  const trail = (c: CustomerContact) => [
    c.emailConversations > 0 ? `${c.emailConversations} email conversation${c.emailConversations === 1 ? '' : 's'}` : null,
    c.whatsappChats > 0 ? `${c.whatsappChats} WhatsApp chat${c.whatsappChats === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ') || 'No conversation yet';

  // Sits inside the customer's identity card, under the primary Email / Phone —
  // same label style as that strip, each contact one small chip.
  return (
    <div className="mt-4 pt-4 border-t border-[#eeece6]">
      <div className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold" title="Emails and WhatsApp messages from these are filed under this customer. The contract shows the primary email and phone only.">
        Other contacts <span className="normal-case tracking-normal font-normal">· link conversations only, not on the contract</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {items.map((c) => {
          const text = [c.name, c.email, c.phone].filter(Boolean).join(' · ');
          return (
            <span key={c.id} title={trail(c)} className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-[#e4e9e5] bg-[#fbfaf8] pl-1 pr-1 py-0.5 text-xs text-[#14201a]">
              <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-[#1a7a5a] bg-[#eef9f4] shrink-0">{relationshipLabel(c.relationship)}</span>
              {canEdit ? (
                <button type="button" disabled={busy} onClick={() => { setDraft({ id: c.id, name: c.name ?? '', relationship: (c.relationship as ContactRelationship | null) ?? '', email: c.email ?? '', phone: c.phone ?? '' }); setError(null); }} className="truncate hover:underline cursor-pointer" aria-label={`Edit ${text}`}>{text}</button>
              ) : <span className="truncate">{text}</span>}
              {canEdit && <button type="button" disabled={busy} aria-label="Remove contact" onClick={() => void remove(c)} className="p-1 rounded-full text-[#8a948d] hover:bg-red-50 hover:text-[#b42318] cursor-pointer disabled:opacity-50 shrink-0"><Trash2 size={11} /></button>}
              {!canEdit && <span className="w-1" />}
            </span>
          );
        })}
        {items.length === 0 && !canEdit && <span className="text-sm text-[#8a948d]">None</span>}
        {canEdit && !draft && (
          <button type="button" onClick={() => { setDraft(EMPTY); setError(null); }} className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#cfe9df] px-2.5 py-1 text-xs font-medium text-[#1a7a5a] hover:bg-[#eef9f4] cursor-pointer">
            <Plus size={12} /> Add email or phone
          </button>
        )}
      </div>

      {draft && (
        <div className="mt-3 rounded-xl bg-[#fbfaf8] border border-[#eeece6] p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div><label className={LABEL} htmlFor="cc-name">Name</label><input id="cc-name" className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Who is this?" /></div>
            <div>
              <label className={LABEL} htmlFor="cc-rel">Relationship to the customer</label>
              <select id="cc-rel" className={`${INPUT} bg-white`} value={draft.relationship} onChange={(e) => setDraft({ ...draft, relationship: e.target.value as ContactRelationship | '' })}>
                <option value="">Choose…</option>
                {RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div><label className={LABEL} htmlFor="cc-email">Email</label><input id="cc-email" type="email" className={INPUT} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@example.com" /></div>
            <div><label className={LABEL} htmlFor="cc-phone">Phone / WhatsApp</label><input id="cc-phone" type="tel" className={`${INPUT} tabular-nums`} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+971 5x xxx xxxx" /></div>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#047246] text-white hover:bg-[#26856d] cursor-pointer disabled:opacity-60">{busy && <Loader2 size={13} className="animate-spin" />} Save</button>
            <button type="button" disabled={busy} onClick={() => { setDraft(null); setError(null); }} className="px-4 py-2 rounded-lg text-sm border border-[#e4e9e5] text-[#2b2a27] hover:bg-[#eef1ef] cursor-pointer">Cancel</button>
            <span className="text-[11px] text-[#8a948d]">Email, phone, or both — existing conversations on them move to this customer.</span>
          </div>
        </div>
      )}
      {error && <div className="mt-2 text-xs text-[#b42318]">{error}</div>}
    </div>
  );
}
