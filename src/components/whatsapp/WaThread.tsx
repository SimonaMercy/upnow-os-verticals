'use client';

/**
 * One WhatsApp conversation: the messages oldest-first with day separators,
 * earlier ones loaded on demand, new ones arriving on their own, and the reply
 * box underneath. Files can be dropped anywhere on the conversation.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Info, Loader2, User, Users } from 'lucide-react';
import {
  KIND_CHIP, KIND_LABEL, errorText, prettyPhone, waDayLabel, whatsappApi,
  type Rp, type WaChatDetail, type WaMessage,
} from '@/lib/whatsappApi';
import { WaComposer, toPending, type PendingFile } from './WaComposer';
import { WaContextPanel } from './WaContextPanel';
import { WaLightbox, WaMessageBubble, type LightboxItem } from './WaMessageBubble';

const POLL_MS = 4000;

/** Fold a fresh "latest page" into what is on screen: new and changed messages in, vanished ones (a settled "sending" row) out. */
function mergeLatest(current: WaMessage[], latest: WaMessage[]): WaMessage[] {
  if (!latest.length) return current.filter((m) => m.status !== 'sending');
  const from = new Date(latest[0].sentAt).getTime();
  const ids = new Set(latest.map((m) => m.id));
  const kept = current.filter((m) => new Date(m.sentAt).getTime() < from && !ids.has(m.id));
  return [...kept, ...latest];
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  // A bare number has no initials — the caller shows a person icon instead.
  if (!parts.length || !/\p{L}/u.test(name)) return '';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function WaThread({ rp, chatId, isManager, onBack, onChanged, alwaysShowBack = false }: {
  rp: Rp; chatId: number; isManager: boolean; onBack: () => void;
  /** Inside a slide-over the back arrow is the way out at every width. */
  alwaysShowBack?: boolean;
  /** Something the list shows has changed: read, sent, linked. */
  onChanged: () => void;
}) {
  const [chat, setChat] = useState<WaChatDetail | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<WaMessage | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [panel, setPanel] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const keepFrom = useRef<number | null>(null);
  const lastId = useRef<number | null>(null);
  const firstPage = useRef(true);
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  const refresh = useCallback(async () => {
    const page = await whatsappApi.messages(rp, chatId);
    if (firstPage.current) { firstPage.current = false; setHasMore(page.hasMore); }
    setMessages((cur) => mergeLatest(cur, page.items));
  }, [rp, chatId]);

  // Open: who it is, the newest messages, and mark it read — here and on the phone.
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const [c] = await Promise.all([whatsappApi.chat(rp, chatId), refresh()]);
        if (!alive) return;
        setChat(c);
        if (c.unreadCount > 0) { await whatsappApi.markRead(rp, chatId); onChangedRef.current(); }
      } catch (e) { if (alive) setError(errorText(e, 'Could not open the conversation')); }
    }, 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [rp, chatId, refresh]);

  // New messages, ticks, reactions and transcripts arrive on their own while the tab is visible.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refresh().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  // A message that arrives while this conversation is open is read by definition.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    const isNew = lastId.current != null && last.id !== lastId.current;
    lastId.current = last.id;
    if (!isNew) return;
    if (last.direction === 'in') {
      if (stick.current && document.visibilityState === 'visible') { whatsappApi.markRead(rp, chatId).then(() => onChangedRef.current()).catch(() => undefined); }
      else setNewBelow((n) => n + 1);
    }
  }, [messages, rp, chatId]);

  // Stay at the bottom when already there; hold position when earlier messages are added on top.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepFrom.current != null) { el.scrollTop = el.scrollHeight - keepFrom.current; keepFrom.current = null; return; }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = bottom; setAtBottom(bottom);
    if (bottom) setNewBelow(0);
  };
  const toBottom = () => { const el = scroller.current; if (el) { stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setNewBelow(0); } };

  const loadOlder = async () => {
    if (loadingOlder || !messages.length) return;
    setLoadingOlder(true);
    try {
      const page = await whatsappApi.messages(rp, chatId, messages[0].id);
      const el = scroller.current;
      keepFrom.current = el ? el.scrollHeight - el.scrollTop : null;
      setHasMore(page.hasMore);
      setMessages((cur) => { const have = new Set(cur.map((m) => m.id)); return [...page.items.filter((m) => !have.has(m.id)), ...cur]; });
    } catch { /* the button stays, to try again */ } finally { setLoadingOlder(false); }
  };

  const jumpTo = (id: number) => {
    const el = document.getElementById(`wa-msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('wa-flash');
    window.setTimeout(() => el.classList.remove('wa-flash'), 1600);
  };

  /** Shown the instant Send is pressed; the next refresh replaces it with the real row. */
  const optimistic = (fields: Partial<WaMessage>): WaMessage => ({
    id: -Date.now(), direction: 'out', type: 'chat', body: '', authorPhone: null, authorName: null, quotedId: replyTo?.id ?? null,
    quotedSnippet: replyTo ? (replyTo.body || replyTo.transcript || replyTo.media?.name || '') : null, isForwarded: false, isRevoked: false, editedAt: null, ack: 0,
    reactions: null, location: null, vcards: null, transcript: null, durationSeconds: null, media: null, sentByName: null, sentByRole: null,
    status: 'sending', error: null, sentAt: new Date().toISOString(), ...fields,
  });

  const afterSend = async () => { await refresh().catch(() => undefined); onChangedRef.current(); };

  const sendText = async (text: string) => {
    const quoted = replyTo?.id ?? null;
    stick.current = true; setSendError(null); setBusy(true);
    setMessages((cur) => [...cur, optimistic({ body: text })]);
    setReplyTo(null);
    try {
      const r = await whatsappApi.sendText(rp, chatId, text, quoted);
      if (r.status === 'not_sent') setSendError(r.error || 'WhatsApp did not accept the message');
    } catch (e) { setSendError(errorText(e, 'The message could not be sent')); }
    finally { setBusy(false); await afterSend(); }
  };

  const sendFiles = async (files: PendingFile[], caption: string) => {
    const quoted = replyTo?.id ?? null;
    stick.current = true; setSendError(null); setBusy(true); setReplyTo(null); setPending([]);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const r = await whatsappApi.sendMedia(rp, chatId, f.file, { caption: i === 0 ? caption : '', asDocument: f.asDocument, quotedMessageId: i === 0 ? quoted : null });
        if (r.status === 'not_sent') setSendError(r.error || `${f.file.name} was not sent`);
        if (f.preview) URL.revokeObjectURL(f.preview);
        await refresh().catch(() => undefined);
      }
    } catch (e) { setSendError(errorText(e, 'The file could not be sent')); }
    finally { setBusy(false); await afterSend(); }
  };

  const sendVoice = async (blob: Blob, seconds: number, fileName: string) => {
    const quoted = replyTo?.id ?? null;
    stick.current = true; setSendError(null); setBusy(true); setReplyTo(null);
    try {
      const r = await whatsappApi.sendMedia(rp, chatId, blob, { fileName, asVoice: true, durationSeconds: seconds, quotedMessageId: quoted });
      if (r.status === 'not_sent') setSendError(r.error || 'The voice note was not sent');
    } catch (e) { setSendError(errorText(e, 'The voice note could not be sent')); }
    finally { setBusy(false); await afterSend(); }
  };

  if (error) return <div className="p-6 text-sm text-[#b42318]">{error}</div>;
  if (!chat) return <div className="p-6 text-sm text-[#8a948d]">Loading…</div>;

  const offline = chat.lineStatus !== 'connected';
  const rows = messages.map((m, i) => ({ m, day: i === 0 || waDayLabel(messages[i - 1].sentAt) !== waDayLabel(m.sentAt) ? waDayLabel(m.sentAt) : null }));
  return (
    <div className="h-full min-h-0 flex">
      <div className="flex-1 min-w-0 min-h-0 flex flex-col relative"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const files = Array.from(e.dataTransfer.files); if (files.length && !offline) setPending((cur) => [...cur, ...toPending(files)].slice(0, 10)); }}>
        <style>{`.wa-flash > div:not(:empty) { animation: waFlash 1.6s ease-out; } @keyframes waFlash { 0%, 40% { box-shadow: 0 0 0 3px rgba(4,114,70,.45); } 100% { box-shadow: 0 0 0 3px rgba(4,114,70,0); } } @media (prefers-reduced-motion: reduce) { .wa-flash > div { animation: none; } }`}</style>

        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e4e9e5] bg-white shrink-0">
          <button type="button" onClick={onBack} aria-label={alwaysShowBack ? 'Back' : 'All conversations'} className={`${alwaysShowBack ? '' : 'lg:hidden '}p-1.5 -ml-1 rounded-full text-[#5f6b63] hover:bg-[#eef1ef] cursor-pointer`}><ArrowLeft size={17} /></button>
          <button type="button" onClick={() => setPanel(true)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
            <span className="w-10 h-10 shrink-0 rounded-full bg-[#e8f3ef] text-[#1a7a5a] grid place-items-center text-sm font-semibold">{chat.isGroup ? <Users size={17} /> : initials(chat.name) || <User size={17} />}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-[#14201a] truncate">{chat.name}</span>
                <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${KIND_CHIP[chat.kind]}`}>{KIND_LABEL[chat.kind]}</span>
              </span>
              <span className="block text-xs text-[#5f6b63] truncate">
                {[chat.isGroup ? 'Group' : prettyPhone(chat.phone), chat.context?.type === 'customer' && chat.context.contracts[0] ? `Unit ${chat.context.contracts[0].unitNumber} · ${chat.context.contracts[0].buildingName}` : null, `on ${chat.lineLabel}`].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
          <button type="button" onClick={() => setPanel((v) => !v)} aria-label="About this conversation" aria-pressed={panel} className={`p-2 rounded-full cursor-pointer ${panel ? 'bg-[#eef9f4] text-[#1a7a5a]' : 'text-[#5f6b63] hover:bg-[#eef1ef]'}`}><Info size={17} /></button>
        </div>

        <div ref={scroller} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 space-y-1.5 bg-[#f1efe9]">
          {hasMore && (
            <div className="flex justify-center pb-2">
              <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1a7a5a] bg-white border border-[#e4e9e5] rounded-full px-3.5 py-1.5 hover:border-[#047246] cursor-pointer disabled:opacity-60">
                {loadingOlder && <Loader2 size={12} className="animate-spin" />} Earlier messages
              </button>
            </div>
          )}
          {!hasMore && messages.length > 0 && <div className="text-center text-[11px] text-[#8a948d] pb-2">This is everything WhatsApp has shared with the platform for this conversation.</div>}
          {messages.length === 0 && <div className="text-center text-sm text-[#8a948d] py-10">No messages yet. Write the first one below.</div>}
          {rows.map(({ m, day }) => (
            <div key={m.id} className="space-y-1.5">
              {day && <div className="flex justify-center py-1.5"><span className="text-[11px] font-medium text-[#4a4842] bg-white/90 border border-[#e4e9e5] rounded-full px-3 py-1">{day}</span></div>}
              <WaMessageBubble m={m} rp={rp} isGroup={chat.isGroup} onReply={setReplyTo} onOpenMedia={setLightbox} onJumpTo={jumpTo} onRetry={(x) => void sendText(x.body)} />
            </div>
          ))}
        </div>

        {!atBottom && (
          <button type="button" onClick={toBottom} aria-label="Go to the latest message" className="absolute right-5 bottom-[84px] w-10 h-10 rounded-full bg-white border border-[#e4e9e5] shadow-md grid place-items-center text-[#4a4842] hover:text-[#1a7a5a] cursor-pointer z-10">
            <ArrowDown size={17} />
            {newBelow > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#047246] text-white text-[10px] font-bold grid place-items-center">{newBelow}</span>}
          </button>
        )}

        {sendError && <div className="px-5 py-2 text-xs text-[#b42318] bg-red-50 border-t border-red-200 shrink-0">{sendError}</div>}
        <WaComposer
          disabledReason={!chat.canSend
            ? 'You can read this conversation but not answer it — sending on WhatsApp is not among the authorities this landlord gave you.'
            : offline ? `“${chat.lineLabel}” is not connected to WhatsApp right now, so nothing can be sent. Messages will appear again once it reconnects.` : null}
          replyTo={replyTo} onCancelReply={() => setReplyTo(null)} pending={pending} onPendingChange={setPending} busy={busy}
          onSendText={sendText} onSendFiles={sendFiles} onSendVoice={sendVoice} />

        {dragging && !offline && chat.canSend && (
          <div className="absolute inset-0 z-30 bg-[#eef9f4]/90 border-2 border-dashed border-[#047246] grid place-items-center pointer-events-none">
            <span className="text-base font-semibold text-[#1a7a5a]">Drop to send to {chat.name}</span>
          </div>
        )}
      </div>

      {panel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 xl:hidden" onClick={() => setPanel(false)} aria-hidden="true" />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-[340px] max-w-[92vw] xl:static xl:z-auto xl:w-[320px] xl:shrink-0 shadow-xl xl:shadow-none">
            <WaContextPanel rp={rp} isManager={isManager} chat={chat} onClose={() => setPanel(false)} onLinked={(next) => { setChat(next); onChangedRef.current(); }} />
          </div>
        </>
      )}

      {lightbox && <WaLightbox item={lightbox} rp={rp} onClose={() => setLightbox(null)} />}
    </div>
  );
}
