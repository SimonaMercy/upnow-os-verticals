'use client';

/**
 * WhatsApp inside the platform — every conversation on the landlord's linked
 * numbers, sorted into Customers, Leads, Vendors, Team, Groups and Other the same
 * way the Emails page sorts the mailbox. List on the left, the open conversation
 * on the right. Serves both portals: the landlord (`rp` null) and a manager
 * acting for a landlord (`rp` set).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, MessageCircle, Plus, Search, Settings2, User, Users } from 'lucide-react';
import {
  KIND_CHIP, KIND_LABEL, errorText, prettyPhone, waListWhen, whatsappApi,
  type Rp, type WaChatList, type WaChatRow, type WaLines, type WaTab,
} from '@/lib/whatsappApi';
import { WaLinesDialog } from './WaLinesDialog';
import { WaNewChat } from './WaNewChat';
import { WaThread } from './WaThread';

const TABS: Array<{ key: WaTab; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'customer', label: 'Customers' }, { key: 'lead', label: 'Leads' }, { key: 'vendor', label: 'Vendors' },
  { key: 'team', label: 'Team' }, { key: 'group', label: 'Groups' }, { key: 'other', label: 'Other' },
];
const LIST_POLL_MS = 6000;

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  // A bare number has no initials — the caller shows a person icon instead.
  if (!parts.length || !/\p{L}/u.test(name)) return '';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function WhatsAppInbox({ rp, isManager = false }: { rp: Rp; isManager?: boolean }) {
  const [lines, setLines] = useState<WaLines | null>(null);
  const [list, setList] = useState<WaChatList | null>(null);
  const [extra, setExtra] = useState<WaChatRow[]>([]);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<WaTab>('all');
  const [q, setQ] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [lineId, setLineId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const filter = useRef({ tab, q, unreadOnly, lineId });
  useEffect(() => { filter.current = { tab, q, unreadOnly, lineId }; }, [tab, q, unreadOnly, lineId]);

  const load = useCallback(async () => {
    const f = filter.current;
    try {
      const first = await whatsappApi.chats(rp, { kind: f.tab, q: f.q, unread: f.unreadOnly, lineId: f.lineId });
      // Only what still matches the filter that was asked for.
      if (f !== filter.current && (f.tab !== filter.current.tab || f.q !== filter.current.q || f.unreadOnly !== filter.current.unreadOnly || f.lineId !== filter.current.lineId)) return;
      setList(first); setError(null);
    } catch (e) { setError(errorText(e, 'Could not load the conversations')); }
  }, [rp]);

  const loadLines = useCallback(async (check = false) => {
    try { setLines(await whatsappApi.lines(rp, check)); } catch (e) { setError(errorText(e, 'Could not load WhatsApp')); }
  }, [rp]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadLines(true); void load();
      const c = Number(new URLSearchParams(window.location.search).get('chat'));
      if (c) setOpenId(c);
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadLines, load]);

  // A changed filter starts the list again from the top.
  useEffect(() => {
    const t = window.setTimeout(() => { setExtra([]); setPages(1); void load(); }, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [tab, q, unreadOnly, lineId, load]);

  // New conversations and unread counts arrive on their own while the tab is visible.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, LIST_POLL_MS);
    const s = window.setInterval(() => { if (document.visibilityState === 'visible') void loadLines(); }, 30_000);
    return () => { window.clearInterval(t); window.clearInterval(s); };
  }, [load, loadLines]);

  const more = async () => {
    if (!list || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await whatsappApi.chats(rp, { kind: tab, q, unread: unreadOnly, lineId, page: pages + 1 });
      setExtra((cur) => [...cur, ...next.items]); setPages(pages + 1);
    } catch { /* the button stays, to try again */ } finally { setLoadingMore(false); }
  };

  if (error && !lines) return <div className="p-6 text-sm text-[#b42318]">{error}</div>;
  if (!lines) return <div className="p-6 text-sm text-[#9b9890]">Loading…</div>;

  const seen = new Set((list?.items ?? []).map((c) => c.id));
  const chats = [...(list?.items ?? []), ...extra.filter((c) => !seen.has(c.id))];
  const down = lines.lines.filter((l) => l.status !== 'connected');
  const connected = lines.lines.filter((l) => l.status === 'connected');
  const hasLines = lines.lines.length > 0;

  return (
    <div className="p-4 sm:p-6 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-2xl font-bold text-[#1a1916]">WhatsApp</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">
            {hasLines
              ? <>Conversations on {lines.lines.map((l, i) => <span key={l.id}>{i > 0 ? ' and ' : ''}<strong>{l.label}</strong>{l.phone ? ` (${prettyPhone(l.phone)})` : ''}</span>)}</>
              : 'Conversations with your customers, leads and vendors.'}
          </p>
        </div>
        {lines.canConfigure && (
          <button type="button" onClick={() => setManaging(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#e8e6e0] text-[#4a4842] hover:border-[#2e9f82] cursor-pointer"><Settings2 size={14} /> Numbers</button>
        )}
        {connected.length > 0 && lines.canSend && (
          <button type="button" onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] cursor-pointer"><Plus size={14} /> New message</button>
        )}
      </div>

      {!hasLines && (
        <div className="mb-4 bg-white border border-[#e8e6e0] rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-[#eef9f4] text-[#1a7a5a]"><MessageCircle size={18} /></div>
          <div className="flex-1 min-w-[220px] text-sm text-[#4a4842]">
            {isManager ? 'The landlord has not linked a WhatsApp number yet. Once they do, their conversations appear here.' : 'Link the WhatsApp number your team already uses with customers. Every conversation appears here, and you can answer from the platform.'}
          </div>
          {lines.canConfigure && <button type="button" onClick={() => setManaging(true)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] cursor-pointer">Link a number</button>}
        </div>
      )}
      {down.map((l) => (
        <div key={l.id} className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span><strong>{l.label}</strong> is not connected to WhatsApp{l.status === 'qr_pending' ? ' — it is waiting for its QR code to be scanned with the phone' : ''}. New messages on it are not arriving and nothing can be sent from it until it reconnects.</span>
        </div>
      ))}

      <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden lg:grid lg:grid-cols-[380px_minmax(0,1fr)] h-[calc(100vh-190px)] min-h-[520px]">
        {/* Conversation list — on a phone it gives way to the open conversation. */}
        <div className={`flex-col min-h-0 h-full border-r border-[#e8e6e0] ${openId != null ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-3 border-b border-[#e8e6e0] space-y-2.5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
              <input id="wa-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, a number or what was said"
                className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
            </div>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Who the conversation is with">
              {TABS.map((t) => {
                const n = list?.counts?.[t.key] ?? 0;
                const unread = list?.unreadBy?.[t.key] ?? 0;
                if (t.key !== 'all' && n === 0 && tab !== t.key) return null;
                return (
                  <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer ${tab === t.key ? 'bg-[#1a1916] text-white border-[#1a1916]' : 'bg-white text-[#4a4842] border-[#e8e6e0] hover:border-[#9b9890]'}`}>
                    {t.label} <span className={`tabular-nums ${tab === t.key ? 'text-white/70' : 'text-[#9b9890]'}`}>{n}</span>
                    {unread > 0 && <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#2e9f82] text-white text-[10px] font-bold grid place-items-center tabular-nums">{unread}</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 text-xs text-[#4a4842]">
              <label htmlFor="wa-unread-only" className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input id="wa-unread-only" type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="accent-[#2e9f82]" /> Unread only
              </label>
              {lines.lines.length > 1 && (
                <select id="wa-line-filter" aria-label="Number" value={lineId ?? ''} onChange={(e) => setLineId(Number(e.target.value) || null)} className="ml-auto border border-[#e8e6e0] rounded-md px-2 py-1 bg-white text-xs focus:outline-none focus:border-[#2e9f82] max-w-[170px]">
                  <option value="">All numbers</option>
                  {lines.lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f0eee9]">
            {error && <div className="px-4 py-3 text-xs text-[#b42318]">{error}</div>}
            {list && chats.length === 0 && <div className="px-4 py-10 text-center text-sm text-[#9b9890]">{q || unreadOnly ? 'Nothing matches.' : hasLines ? 'No conversations here yet.' : 'No number is linked yet.'}</div>}
            {chats.map((c) => (
              <button key={c.id} type="button" onClick={() => setOpenId(c.id)}
                className={`w-full text-left px-3.5 py-3 flex items-center gap-3 cursor-pointer ${openId === c.id ? 'bg-[#eef9f4]' : 'hover:bg-[#fbfaf8]'}`}>
                <span className={`w-11 h-11 shrink-0 rounded-full grid place-items-center text-sm font-semibold ${c.kind === 'other' ? 'bg-[#f4f3ef] text-[#6b6860]' : 'bg-[#e8f3ef] text-[#1a7a5a]'}`}>{c.isGroup ? <Users size={17} /> : initials(c.name) || <User size={17} />}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className={`text-sm truncate flex-1 ${c.unreadCount > 0 ? 'font-bold text-[#1a1916]' : 'font-medium text-[#2b2a27]'}`}>{c.name}</span>
                    <span className={`text-[11px] shrink-0 tabular-nums ${c.unreadCount > 0 ? 'text-[#1a7a5a] font-semibold' : 'text-[#9b9890]'}`}>{waListWhen(c.lastMessageAt)}</span>
                  </span>
                  <span className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs truncate flex-1 ${c.unreadCount > 0 ? 'text-[#1a1916] font-medium' : 'text-[#6b6860]'}`} dir="auto">{c.lastDirection === 'out' ? 'You: ' : ''}{c.lastSnippet || '—'}</span>
                    {c.unreadCount > 0 && <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2e9f82] text-white text-[10px] font-bold grid place-items-center tabular-nums" aria-label={`${c.unreadCount} unread`}>{c.unreadCount}</span>}
                  </span>
                  {(tab === 'all' || lines.lines.length > 1) && (
                    <span className="flex items-center gap-1.5 mt-1">
                      {tab === 'all' && c.kind !== 'other' && <span className={`text-[9.5px] font-semibold uppercase tracking-wide rounded px-1.5 py-px ${KIND_CHIP[c.kind]}`}>{KIND_LABEL[c.kind]}</span>}
                      {lines.lines.length > 1 && lineId == null && <span className="text-[10.5px] text-[#9b9890] truncate">{c.lineLabel}</span>}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {list && chats.length < list.total && (
              <div className="p-3 text-center">
                <button type="button" onClick={() => void more()} disabled={loadingMore} className="text-xs font-medium text-[#1a7a5a] border border-[#e8e6e0] rounded-full px-4 py-1.5 hover:border-[#2e9f82] cursor-pointer disabled:opacity-60">{loadingMore ? 'Loading…' : `Show more (${(list.total - chats.length).toLocaleString('en-GB')} left)`}</button>
              </div>
            )}
          </div>
        </div>

        <div className={`min-h-0 h-full flex-col ${openId != null ? 'flex' : 'hidden lg:flex'}`}>
          {openId != null ? (
            <div className="flex-1 min-h-0"><WaThread key={openId} rp={rp} chatId={openId} isManager={isManager} onBack={() => setOpenId(null)} onChanged={() => { void load(); }} /></div>
          ) : (
            <div className="flex-1 grid place-items-center bg-[#fbfaf8]">
              <div className="text-center px-6">
                <div className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-3 bg-[#eef9f4] text-[#1a7a5a]"><MessageCircle size={24} /></div>
                <p className="text-sm font-semibold text-[#1a1916]">Choose a conversation</p>
                <p className="text-sm text-[#6b6860] mt-1 max-w-[340px]">Read it, listen to the voice notes or read their transcript, and answer with text, photos, documents or your own voice note.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {composing && <WaNewChat rp={rp} lines={lines.lines} onClose={() => setComposing(false)} onStarted={(id) => { void load(); setOpenId(id); }} />}
      {managing && <WaLinesDialog lines={lines.lines} onClose={() => setManaging(false)} onChanged={() => { void loadLines(true); void load(); }} />}
    </div>
  );
}
