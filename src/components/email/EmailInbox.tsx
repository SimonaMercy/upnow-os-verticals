'use client';

/**
 * The email inbox — every conversation in the landlord's own mailbox: with
 * customers, leads and vendors, and (the landlord only) everything else in it.
 * List on the left, a page at a time, the open conversation on the right. Serves
 * both portals: the landlord (`rp` null) and a manager acting for a landlord
 * (`rp` set).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Archive, ArrowLeft, Inbox, Landmark, Mail, MailWarning, Megaphone, Paperclip, Plus, RefreshCw, Scale, Search, SendHorizontal, TrendingUp, Users, Wrench } from 'lucide-react';
import { emailApi, errorText, type EmailKind, type EmailThreadPage, type MailboxInfo, type Rp } from '@/lib/emailApi';
import { EmailComposer } from './EmailComposer';
import { EmailThreadView } from './EmailThreadView';
import { EmailPager } from './EmailPager';
import { EmailRow } from './EmailBits';
import { EMAILS_SYNCED_EVENT } from '@/lib/useEmailSyncOnLogin';

const PAGE_SIZE = 50;
type Box = 'all' | 'inbox' | 'sent' | 'unread' | 'files';
const BOXES: Array<{ key: Box; label: string; Icon: typeof Mail }> = [
  { key: 'all', label: 'All mail', Icon: Mail }, { key: 'inbox', label: 'Inbox', Icon: Inbox }, { key: 'sent', label: 'Sent', Icon: SendHorizontal },
  { key: 'unread', label: 'Unread', Icon: MailWarning }, { key: 'files', label: 'Files', Icon: Paperclip },
];
/**
 * The page's own tabs — who the conversation is with. They sit at the top, above
 * everything else, so each person works in their own: whoever deals with vendors
 * opens Vendors and sees only that. The tab is in the link (`?tab=vendors`), so
 * it can be bookmarked and survives a refresh.
 */
const TABS: Array<{ key: 'all' | EmailKind; slug: string; label: string; Icon: typeof Mail }> = [
  { key: 'all', slug: 'all', label: 'All', Icon: Mail }, { key: 'customer', slug: 'customers', label: 'Customers', Icon: Users },
  { key: 'lead', slug: 'leads', label: 'Leads', Icon: TrendingUp }, { key: 'vendor', slug: 'vendors', label: 'Vendors', Icon: Wrench },
  { key: 'finance', slug: 'finance', label: 'Finance', Icon: Landmark }, { key: 'legal', slug: 'legal', label: 'Legal', Icon: Scale },
  { key: 'promotions', slug: 'promotions', label: 'Promotions', Icon: Megaphone }, { key: 'other', slug: 'other', label: 'Other', Icon: Archive },
];

export function EmailInbox({ rp, isManager = false }: { rp: Rp; isManager?: boolean }) {
  const [mailbox, setMailbox] = useState<MailboxInfo | null>(null);
  const [list, setList] = useState<EmailThreadPage | null>(null);
  const [kind, setKind] = useState<'all' | EmailKind>('all');
  const [page, setPage] = useState(1);
  /** A mail app's folders. Conversations, so: Inbox = something was received in it, Sent = something was sent. */
  const [box, setBox] = useState<Box>('all');
  /** One of the landlord's mailboxes, or all of them. */
  const [mailboxId, setMailboxId] = useState<number | null>(null);
  /** Arrived from a card elsewhere (the mail icon on Operations): one customer's or one lead's emails only. */
  const [only, setOnly] = useState<{ tenantId?: number; leadId?: number } | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  /** What the last "Check for new" found — said out loud, so a check that brings nothing in is not silence. */
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [checking, setChecking] = useState(false);
  /** Older emails the mailbox still holds that have not been looked at yet. */
  const [backlog, setBacklog] = useState(0);
  // The list asks for what is on screen NOW — a check running in the background
  // reloads it without resetting the tab, the page or the search.
  const view = useRef({ q, kind, page, box, mailboxId, only });
  useEffect(() => { view.current = { q, kind, page, box, mailboxId, only }; }, [q, kind, page, box, mailboxId, only]);

  const loadThreads = useCallback(async () => {
    const v = view.current;
    setLoadingList(true);
    try {
      const res = await emailApi.threads(rp, { q: v.q, kind: v.kind === 'all' ? null : v.kind, page: v.page, pageSize: PAGE_SIZE, unreadOnly: v.box === 'unread', hasFiles: v.box === 'files', box: v.box === 'inbox' || v.box === 'sent' ? v.box : null, mailboxId: v.mailboxId, tenantId: v.only?.tenantId, leadId: v.only?.leadId });
      setList(res);
      if (res.page !== v.page) setPage(res.page); // asked past the last page
    } catch (e) { setError(errorText(e, 'Could not load the emails')); } finally { setLoadingList(false); }
  }, [rp]);

  const check = useCallback(async () => {
    setChecking(true);
    let broughtIn = 0;
    let ran = false;
    let proof: { onServer: number; notIn: number } | null = null;
    try {
      // A mailbox holding years of email is read in rounds, newest first: keep
      // going until nothing is left, showing what each round brought in.
      for (let round = 0; round < 200; round++) {
        const r = await emailApi.sync(rp);
        ran = ran || r.ran;
        broughtIn += r.imported;
        if (r.ran && !r.error && r.onServer != null) proof = { onServer: r.onServer, notIn: r.notIn ?? 0 };
        if (r.imported > 0) await loadThreads();
        setBacklog(r.ran && !r.error ? r.remaining : 0);
        if (!r.ran || r.error || !r.remaining) { if (r.ran) setMailbox(await emailApi.mailbox(rp)); break; }
      }
      const at = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      // Not only "nothing new" — the count on the mail server against what is here.
      const p = proof as { onServer: number; notIn: number } | null;
      const tally = !p ? '' : p.notIn === 0
        ? ` All ${p.onServer.toLocaleString('en-GB')} emails in the mailbox are here.`
        : ` ${p.notIn.toLocaleString('en-GB')} of the ${p.onServer.toLocaleString('en-GB')} in the mailbox could not be brought in yet — they are tried again on every check.`;
      setCheckNote((broughtIn > 0
        ? `Checked at ${at} — ${broughtIn.toLocaleString('en-GB')} new ${broughtIn === 1 ? 'email' : 'emails'} brought in.`
        : ran ? `Checked at ${at} — nothing new.` : 'Checked a moment ago — nothing new.') + tally);
    } catch { /* the list still shows what is already here */ } finally { setChecking(false); }
  }, [rp, loadThreads]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      emailApi.mailbox(rp).then(setMailbox).catch((e) => setError(errorText(e, 'Could not load the emails')));
      void loadThreads();
      void check();
      const params = new URLSearchParams(window.location.search);
      // The tab someone bookmarked — the vendor person's link opens on Vendors.
      const tab = TABS.find((x) => x.slug === params.get('tab'));
      if (tab) setKind(tab.key);
      // The mail icon on an Operations card: that customer's (or lead's) unread emails.
      const customer = Number(params.get('customer'));
      const lead = Number(params.get('lead'));
      if (customer) setOnly({ tenantId: customer }); else if (lead) setOnly({ leadId: lead });
      if (params.get('unread') === '1') setBox('unread');
      // A notification links straight to one conversation.
      const t = Number(params.get('thread'));
      if (t) setOpenId(t);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rp, loadThreads, check]);

  // The portal-wide sync (on arrival, then every few minutes) brought mail in: show it.
  useEffect(() => {
    const onSynced = () => { void loadThreads(); };
    window.addEventListener(EMAILS_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(EMAILS_SYNCED_EVENT, onSynced);
  }, [loadThreads]);

  useEffect(() => {
    const t = window.setTimeout(() => { void loadThreads(); }, 250);
    return () => window.clearTimeout(t);
  }, [q, kind, page, box, mailboxId, only, loadThreads]);

  if (error && !mailbox) return <div className="p-6 text-sm text-[#b42318]">{error}</div>;
  if (!mailbox) return <div className="p-6 text-sm text-[#8a948d]">Loading…</div>;

  // A team member with "Emails — read" only sees every trail and writes nothing.
  const canSend = mailbox.connected && mailbox.enabled && mailbox.canSend;
  const boxes = mailbox.mailboxes ?? [];
  const several = boxes.length > 1;
  const labelOf = (id: number | null) => (several ? boxes.find((b) => b.id === id)?.label ?? null : null);
  const threads = list?.items ?? [];
  const chooseTab = (next: 'all' | EmailKind) => {
    setKind(next); setPage(1); setOpenId(null);
    const url = new URL(window.location.href);
    if (next === 'all') url.searchParams.delete('tab'); else url.searchParams.set('tab', TABS.find((t) => t.key === next)!.slug);
    url.searchParams.delete('thread');
    window.history.replaceState(null, '', url);
  };
  const showEveryone = () => {
    setOnly(null); setPage(1);
    const url = new URL(window.location.href);
    for (const k of ['customer', 'lead', 'unread']) url.searchParams.delete(k);
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-2xl font-bold text-[#14201a]">Emails</h1>
          <p className="text-sm text-[#5f6b63] mt-0.5">
            {mailbox.connected
              ? <>Sent and received with {boxes.map((b, i) => <span key={b.id}>{i > 0 && (i === boxes.length - 1 ? ' and ' : ', ')}<strong>{b.emailAddress}</strong></span>)}</>
              : 'Conversations with your customers, leads and vendors.'}
            {mailbox.connected && checkNote && !checking && <span className="text-[#8a948d]"> · {checkNote}</span>}
          </p>
        </div>
        {mailbox.connected && (
          <button type="button" onClick={() => void check()} disabled={checking} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#e4e9e5] text-[#4a4842] hover:border-[#047246] cursor-pointer disabled:opacity-60">
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking…' : 'Check for new'}
          </button>
        )}
        {canSend && (
          <button type="button" onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#047246] text-white hover:bg-[#26856d] cursor-pointer">
            <Plus size={14} /> New email
          </button>
        )}
      </div>

      {!mailbox.connected && (
        <div className="mb-4 bg-white border border-[#e4e9e5] rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-[#eef9f4] text-[#1a7a5a]"><Mail size={18} /></div>
          <div className="flex-1 min-w-[220px] text-sm text-[#4a4842]">
            {isManager
              ? 'The landlord has not connected an email yet. Once they do, you can write to their customers and leads from here.'
              : 'Connect the email you already use with customers. You write from here with your own address, and replies come back here.'}
          </div>
          {!isManager && <Link href="/rental-provider/dashboard/settings?tab=email" className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#047246] text-white hover:bg-[#26856d]">Connect your email</Link>}
        </div>
      )}
      {backlog > 0 && (
        <div className="mb-4 rounded-xl bg-[#eef9f4] border border-[#d7ede5] px-4 py-3 text-sm text-[#1a7a5a]">
          Bringing in older emails — {backlog.toLocaleString('en-GB')} still to look at. You can keep working; conversations appear as they are found.
        </div>
      )}
      {boxes.filter((b) => b.inboxOnly).map((b) => (
        <div key={`pop-${b.id}`} className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Only the replies are shown for <strong>{b.emailAddress}</strong>. It is connected with POP, which cannot read the emails sent from your own mail app.{' '}
          {!isManager && <Link href="/rental-provider/dashboard/settings?tab=email" className="font-semibold underline">Switch to IMAP in Settings → Email</Link>}
        </div>
      ))}
      {boxes.filter((b) => b.status === 'error').map((b) => (
        <div key={`err-${b.id}`} className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-[#b42318] flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>New emails on <strong>{b.emailAddress}</strong> can’t be read right now. {b.lastError} {!isManager && <Link href="/rental-provider/dashboard/settings?tab=email" className="font-semibold underline">Check the email settings</Link>}</span>
        </div>
      ))}

      <div className="mb-3 border-b border-[#e4e9e5] flex gap-1 overflow-x-auto" role="tablist" aria-label="Who the conversation is with">
        {TABS.map((t) => {
          const on = kind === t.key;
          const unread = list?.unreadBy?.[t.key] ?? 0;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => chooseTab(t.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 -mb-px border-b-2 text-sm cursor-pointer whitespace-nowrap ${on ? 'border-[#047246] text-[#14201a] font-semibold' : 'border-transparent text-[#5f6b63] hover:text-[#14201a] hover:border-[#d8d5cd]'}`}>
              {/* Eight tabs: the icons give way on a laptop screen so every tab stays in view. */}
              <t.Icon size={15} className={`hidden 2xl:block ${on ? 'text-[#047246]' : 'text-[#8a948d]'}`} />
              {t.label}
              <span className={`tabular-nums text-xs font-normal ${on ? 'text-[#5f6b63]' : 'text-[#8a948d]'}`}>{(list?.counts[t.key] ?? 0).toLocaleString('en-GB')}</span>
              {unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#047246] text-white text-[10px] font-bold grid place-items-center tabular-nums" aria-label={`${unread} unread`}>{unread}</span>}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-[#e4e9e5] shadow-sm overflow-hidden lg:grid lg:grid-cols-[380px_minmax(0,1fr)] h-[calc(100vh-240px)] min-h-[520px]">
        {/* Conversation list — on a phone it gives way to the open conversation. */}
        <div className={`flex-col min-h-0 h-full border-r border-[#e4e9e5] ${openId != null ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-3 border-b border-[#e4e9e5]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a948d]" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search a name, a subject, a file or what was written"
                className="w-full border border-[#e4e9e5] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#047246]" />
            </div>
            {only && (
              <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-[#eef9f4] border border-[#d7ede5] px-2.5 py-1.5 text-xs text-[#1a7a5a]">
                <span className="flex-1 min-w-0 truncate">Only <strong>{threads[0]?.recordName ?? (only.tenantId ? 'this customer' : 'this lead')}</strong></span>
                <button type="button" onClick={showEveryone} className="shrink-0 font-semibold underline cursor-pointer">Show everyone</button>
              </div>
            )}
            {several && (
              <select aria-label="Mailbox" value={mailboxId ?? ''} onChange={(e) => { setMailboxId(Number(e.target.value) || null); setPage(1); }}
                className="mt-2.5 w-full border border-[#e4e9e5] rounded-lg px-2.5 py-1.5 bg-white text-xs text-[#2b2a27] focus:outline-none focus:border-[#047246]">
                <option value="">All mailboxes ({boxes.length})</option>
                {boxes.map((b) => <option key={b.id} value={b.id}>{b.label} — {b.emailAddress}</option>)}
              </select>
            )}
            <div className="flex items-center gap-0.5 mt-2.5 p-0.5 rounded-lg bg-[#eef1ef] text-xs" role="tablist" aria-label="Mail folder">
              {BOXES.map((b) => (
                <button key={b.key} type="button" role="tab" aria-selected={box === b.key} onClick={() => { setBox(b.key); setPage(1); }}
                  className={`flex-1 inline-flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-md cursor-pointer whitespace-nowrap ${box === b.key ? 'bg-white text-[#14201a] font-semibold shadow-sm' : 'text-[#5f6b63] hover:text-[#14201a]'}`}>
                  <b.Icon size={12} /> {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`flex-1 min-h-0 overflow-y-auto divide-y divide-[#f0eee9] ${loadingList ? 'opacity-60' : ''}`}>
            {list && threads.length === 0 && <div className="px-4 py-10 text-center text-sm text-[#8a948d]">{q || box !== 'all' ? 'Nothing here.' : kind === 'all' ? 'No emails yet.' : kind === 'finance' || kind === 'legal' || kind === 'promotions' ? `Nothing in ${TABS.find((t) => t.key === kind)?.label} yet.` : `No emails with ${kind === 'other' ? 'anyone else' : `${TABS.find((t) => t.key === kind)?.label.toLowerCase()}`} yet.`}</div>}
            {threads.map((t) => <EmailRow key={t.id} t={t} active={openId === t.id} showKind={kind === 'all'} mailboxLabel={mailboxId == null ? labelOf(t.mailboxId) : null} onOpen={() => setOpenId(t.id)} />)}
          </div>
          {list && <EmailPager page={list.page} pageSize={list.pageSize} total={list.total} onPage={setPage} disabled={loadingList} />}
        </div>

        <div className={`min-h-0 h-full flex-col ${openId != null ? 'flex' : 'hidden lg:flex'}`}>
          {openId != null ? (
            <>
              <button type="button" onClick={() => setOpenId(null)} className="lg:hidden flex items-center gap-1.5 px-4 pt-3 text-sm text-[#5f6b63] cursor-pointer"><ArrowLeft size={14} /> All emails</button>
              <div className="flex-1 min-h-0"><EmailThreadView key={openId} rp={rp} threadId={openId} canSend={canSend} isManager={isManager} onChanged={() => { void loadThreads(); }} onMoved={(id) => { setOpenId(id); void loadThreads(); }} /></div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center bg-[#fbfaf8]">
              <div className="text-center px-6">
                <div className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-3 bg-[#eef9f4] text-[#1a7a5a]"><Mail size={24} /></div>
                <p className="text-sm font-semibold text-[#14201a]">{kind === 'all' ? 'Choose a conversation' : `Choose a conversation — ${TABS.find((t) => t.key === kind)?.label}`}</p>
                <p className="text-sm text-[#5f6b63] mt-1 max-w-[360px]">Read the whole trail in order — who wrote, who was copied, every file — and answer everyone from here.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {composing && (
        <EmailComposer rp={rp} fromAddress={mailbox.emailAddress} mailboxes={boxes} defaultMailboxId={mailboxId} onClose={() => setComposing(false)}
          onSent={(threadId) => { void loadThreads(); setOpenId(threadId); }} />
      )}
    </div>
  );
}
