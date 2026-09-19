'use client';

/**
 * The "WhatsApp" section on a lease, a customer's, a lead's or a vendor's page:
 * the conversation(s) with that one person on the landlord's linked numbers, the
 * latest messages at a glance, and a slide-over with the full conversation —
 * photos, voice notes, documents and the reply box — without leaving the page.
 *
 * A manager without the landlord's "Communicate with customers" authority gets
 * nothing here (the API answers 403 and the card does not render); neither does
 * a landlord who has not linked a number.
 */
import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Plus } from 'lucide-react';
import { useSlideOver } from '@/lib/useSlideOver';
import { prettyPhone, waListWhen, whatsappApi, type Rp, type WaChatRow, type WaLine, type WaPerson } from '@/lib/whatsappApi';
import { WaNewChat } from './WaNewChat';
import { WaThread } from './WaThread';

function ChatSlideOver({ rp, chatId, isManager, onClose, onChanged }: { rp: Rp; chatId: number; isManager: boolean; onClose: () => void; onChanged: () => void }) {
  const { closing, dismiss } = useSlideOver(onClose);
  return (
    <div className="fixed inset-0 z-50">
      <div className={`slideover-scrim${closing ? ' closing' : ''} absolute inset-0 bg-black/40`} onClick={dismiss} />
      <div className={`slideover-panel${closing ? ' closing' : ''} absolute right-0 top-0 h-full w-full max-w-[760px] bg-white shadow-2xl flex flex-col`}>
        <div className="flex-1 min-h-0"><WaThread key={chatId} rp={rp} chatId={chatId} isManager={isManager} onBack={dismiss} onChanged={onChanged} alwaysShowBack /></div>
      </div>
    </div>
  );
}

export function WhatsAppCard({ rp, tenantId, leadId, vendorId, person, isManager = false }: {
  rp: Rp;
  tenantId?: number | null;
  leadId?: number | null;
  vendorId?: number | null;
  /** Who a first message goes to, when there is no conversation yet. */
  person: { name: string; phone: string | null } | null;
  isManager?: boolean;
}) {
  const [lines, setLines] = useState<WaLine[] | null>(null);
  /** Read-only team members see the conversation, not the "New message" button. */
  const [canSend, setCanSend] = useState(false);
  const [chats, setChats] = useState<WaChatRow[]>([]);
  const [hidden, setHidden] = useState(false);
  const [openChat, setOpenChat] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([
        whatsappApi.lines(rp),
        whatsappApi.chats(rp, { tenantId: tenantId ?? undefined, leadId: leadId ?? undefined, vendorId: vendorId ?? undefined }),
      ]);
      setLines(l.lines); setCanSend(l.canSend === true); setChats(c.items);
    } catch (e) {
      // 403: a manager without the authority. 400: a manager on "All landlords".
      if ([400, 403].includes((e as { status?: number }).status ?? 0)) setHidden(true);
    }
  }, [rp, tenantId, leadId, vendorId]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000);
    return () => { window.clearTimeout(t); window.clearInterval(poll); };
  }, [load]);

  if (hidden || !lines || lines.length === 0) return null;
  const connected = lines.some((l) => l.status === 'connected');
  const preset: WaPerson | null = person
    ? { kind: tenantId ? 'customer' : leadId ? 'lead' : 'vendor', id: Number(tenantId ?? leadId ?? vendorId), name: person.name, phone: person.phone, detail: null }
    : null;
  const unread = chats.reduce((n, c) => n + c.unreadCount, 0);

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm p-5 min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-semibold text-[#1a1916] flex items-center gap-2 flex-1">
          <MessageCircle size={16} className="text-[#2e9f82]" /> WhatsApp
          {unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#2e9f82] text-white text-[10px] font-bold grid place-items-center tabular-nums">{unread}</span>}
        </h2>
        {connected && canSend && preset?.phone && (
          <button type="button" onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] cursor-pointer">
            <Plus size={14} /> New message
          </button>
        )}
      </div>

      {chats.length === 0 && (
        <p className="text-sm text-[#9b9890]">
          {preset?.phone
            ? <>No WhatsApp conversation with {prettyPhone(preset.phone)} yet. If they write from another number, open that conversation on the WhatsApp page and link it to them.</>
            : 'No phone number on file for this person, so no conversation can be matched to them.'}
        </p>
      )}

      {chats.length > 0 && (
        <div className="divide-y divide-[#f0eee9] border border-[#f0eee9] rounded-xl overflow-hidden">
          {chats.map((c) => (
            <button key={c.id} type="button" onClick={() => setOpenChat(c.id)} className="block w-full min-w-0 text-left px-4 py-3 hover:bg-[#fbfaf8] cursor-pointer">
              <div className="flex items-baseline gap-2 min-w-0">
                {c.unreadCount > 0 && <span className="w-2 h-2 rounded-full bg-[#2e9f82] shrink-0 self-center" aria-label="Unread" />}
                <span className={`text-sm truncate flex-1 min-w-0 ${c.unreadCount > 0 ? 'font-bold text-[#1a1916]' : 'font-medium text-[#2b2a27]'}`}>
                  {prettyPhone(c.phone) || c.name}
                  <span className="font-normal text-[#9b9890]"> · on {c.lineLabel}{c.linkedManually ? ` · ${c.savedName || c.profileName || 'linked by hand'}` : ''}</span>
                </span>
                <span className="text-xs text-[#9b9890] shrink-0">{waListWhen(c.lastMessageAt)}</span>
              </div>
              <div className="text-xs text-[#6b6860] truncate mt-0.5" dir="auto">
                {c.lastDirection === 'out' ? 'You: ' : ''}{c.lastSnippet ?? ''} <span className="text-[#9b9890]">· {c.messageCount} {c.messageCount === 1 ? 'message' : 'messages'}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {composing && preset && <WaNewChat rp={rp} lines={lines} preset={preset} onClose={() => setComposing(false)} onStarted={(id) => { void load(); setOpenChat(id); }} />}
      {openChat != null && <ChatSlideOver rp={rp} chatId={openChat} isManager={isManager} onClose={() => { setOpenChat(null); void load(); }} onChanged={() => { void load(); }} />}
    </div>
  );
}
