'use client';

/**
 * Communications › Inbox — ONE inbox for every conversation, across every subcategory.
 *
 * Sources (all read with GET only; nothing is marked read from here):
 *   • Email — the landlord's mailbox threads (emailApi.threads / emailApi.thread, the same calls the
 *     Emails page makes). Reply = emailApi.reply, the exact call the Emails page uses, when the
 *     thread says the person may send.
 *   • WhatsApp — only where the bridge is switched on (useWhatsappEnabled). Chats + messages via
 *     whatsappApi; reply = whatsappApi.sendText (the WhatsApp page's call) when allowed.
 *   • Booking messages — PREVIEW booking engine (useBookings), own listings, events of type
 *     'message' (and the customer's opening message). Reply = providerAct({ type: 'reply' }).
 *   • Lead notes — long-term leads (GET /api/leads) and, when a lead is opened, its notes log
 *     (GET /api/leads/:id/notes). Read-only here; "Open lead" works it.
 *
 * Tabs (?type=): All · Long-term leases · Holiday homes · Venues · Courts · Yachts (+ Services
 * when the Services pack is active). Channel chips, search, unread first. The old Emails and
 * WhatsApp pages stay available ("Open in email inbox" / "Open in WhatsApp").
 */
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Mail, MessageCircle, MessagesSquare, NotebookPen } from 'lucide-react';
import { Btn, Callout, Card, OsPage, PageHead, Pill, SearchField } from '@/components/os/kit';
import { BookingDrawer } from '@/components/os/bookings/BookingDrawer';
import { useIsNarrow, useOwn } from '@/components/os/bookings/shared';
import { canMessage, ms } from '@/lib/os/bookings/engine';
import type { Booking } from '@/lib/os/bookings/types';
import { emailApi, errorText, type EmailThreadDetail, type EmailThreadRow } from '@/lib/emailApi';
import { whatsappApi, type WaChatDetail, type WaChatRow, type WaMessage } from '@/lib/whatsappApi';
import { useWhatsappEnabled } from '@/lib/useWhatsappEnabled';
import { leadDisplayName, type ApiLead } from '@/lib/leadJourney';
import { useOsScope } from '@/lib/os/scope';
import { PreviewTag, SubcatPill, SubcatTabs, useSubcatParam, type Subcat } from '@/components/os/SubcatTabs';

const RP = '/rental-provider/dashboard';

type Channel = 'email' | 'whatsapp' | 'booking' | 'lead';
const CHANNELS: { v: Channel | 'all'; l: string }[] = [
  { v: 'all', l: 'All channels' }, { v: 'email', l: 'Email' }, { v: 'whatsapp', l: 'WhatsApp' },
  { v: 'booking', l: 'Booking messages' }, { v: 'lead', l: 'Lead notes' },
];
const CHANNEL_ICON = { email: Mail, whatsapp: MessageCircle, booking: MessagesSquare, lead: NotebookPen } as const;
const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', whatsapp: 'WhatsApp', booking: 'Booking', lead: 'Lead notes' };

interface Thread {
  key: string;
  channel: Channel;
  subcat: Exclude<Subcat, 'all'> | null;
  title: string;
  sub: string;
  snippet: string;
  at: number;
  unread: number;
  preview?: boolean;
  link?: { href: string; label: string };
  email?: EmailThreadRow;
  wa?: WaChatRow;
  lead?: ApiLead;
  booking?: Booking;
}

const MODEL_SUBCAT: Record<Booking['model'], Exclude<Subcat, 'all'>> = { shortstay: 'shortstay', venue: 'venue', court: 'court', charter: 'charter' };

function when(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '';
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }), timeZone: 'Asia/Dubai' });
}
const whenFull = (t: number) => (Number.isFinite(t) ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '');

/** Messages of a booking conversation: the customer's opening message, then every 'message' event. */
function bookingMessages(b: Booking): { at: number; actor: 'customer' | 'provider' | 'system'; text: string }[] {
  const out: { at: number; actor: 'customer' | 'provider' | 'system'; text: string }[] = [];
  if (b.details.message?.trim()) out.push({ at: ms(b.createdAt), actor: 'customer', text: b.details.message.trim() });
  for (const e of b.events) {
    if (e.type !== 'message') continue;
    // The opening message is often also logged as the first event — show it once.
    if (out.some((m) => m.actor === e.actor && m.text === e.text.trim())) continue;
    out.push({ at: ms(e.at), actor: e.actor, text: e.text.trim() });
  }
  return out.sort((a, c) => a.at - c.at);
}

export default function InboxPage() {
  return (
    <Suspense fallback={<OsPage><PageHead eyebrow="Communications" title="Inbox" /></OsPage>}>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const waOn = useWhatsappEnabled('rental_provider');
  const { vertical } = useOsScope();
  const servicesOn = vertical === 'services';
  const tabs: Subcat[] = ['all', 'leases', 'shortstay', 'venue', 'court', 'charter', ...(servicesOn ? ['services' as const] : [])];
  const [sub, setSub] = useSubcatParam(tabs);
  const [channel, setChannel] = useState<Channel | 'all'>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const narrow = useIsNarrow();
  const { bookings, byId } = useOwn();

  // ---- email (GET only)
  const [emails, setEmails] = useState<EmailThreadRow[]>([]);
  const [emailState, setEmailState] = useState<'loading' | 'ok' | 'off' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    emailApi.mailbox(null)
      .then((mb) => {
        if (!alive) return null;
        if (!mb.enabled || !mb.connected) { setEmailState('off'); return null; }
        return emailApi.threads(null, { pageSize: 50 }).then((r) => { if (alive) { setEmails(r.items); setEmailState('ok'); } });
      })
      .catch(() => { if (alive) setEmailState('error'); });
    return () => { alive = false; };
  }, []);

  // ---- WhatsApp (only with a bridge)
  const [chats, setChats] = useState<WaChatRow[]>([]);
  useEffect(() => {
    if (!waOn) return;
    let alive = true;
    whatsappApi.chats(null, {}).then((r) => { if (alive) setChats(r.items); }).catch(() => { /* WhatsApp section stays empty */ });
    return () => { alive = false; };
  }, [waOn]);

  // ---- long-term leads (GET /api/leads, read-only)
  const [leads, setLeads] = useState<ApiLead[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/leads', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setLeads(Array.isArray(d) ? d : []); })
      .catch(() => { /* lead notes stay empty */ });
    return () => { alive = false; };
  }, []);

  const threads: Thread[] = useMemo(() => {
    const out: Thread[] = [];
    for (const t of emails) {
      const subcat = t.tenantId != null || t.leadId != null ? 'leases' : t.vendorId != null ? 'services' : null;
      out.push({
        key: `E-${t.id}`, channel: 'email', subcat, email: t,
        title: t.recordName || t.counterpartName || t.counterpartEmail,
        sub: t.subject || '(no subject)',
        snippet: t.lastSnippet ?? '',
        at: ms(t.lastMessageAt), unread: t.unreadCount,
        link: t.leadId != null ? { href: `${RP}/leads/${t.leadId}`, label: 'Open lead' } : t.tenantId != null ? { href: `${RP}/tenants/${t.tenantId}`, label: 'Open customer' } : undefined,
      });
    }
    if (waOn) for (const c of chats) {
      const subcat = c.kind === 'customer' || c.kind === 'lead' ? 'leases' : c.kind === 'vendor' ? 'services' : null;
      out.push({
        key: `W-${c.id}`, channel: 'whatsapp', subcat, wa: c,
        title: c.name, sub: c.lineLabel ? `WhatsApp · ${c.lineLabel}` : 'WhatsApp',
        snippet: c.lastSnippet ?? '', at: c.lastMessageAt ? ms(c.lastMessageAt) : 0, unread: c.unreadCount,
        link: c.leadId != null ? { href: `${RP}/leads/${c.leadId}`, label: 'Open lead' } : c.tenantId != null ? { href: `${RP}/tenants/${c.tenantId}`, label: 'Open customer' } : undefined,
      });
    }
    for (const x of leads) {
      if (x.stage === 'converted' || x.stage === 'rejected') continue;
      const unit = x.unit ? `${x.unit.unitName || x.unit.unitNumber}${x.unit.property?.buildingName ? ` · ${x.unit.property.buildingName}` : ''}` : 'No unit assigned';
      out.push({
        key: `L-${x.id}`, channel: 'lead', subcat: 'leases', lead: x,
        title: leadDisplayName(x), sub: unit,
        snippet: x.notes?.trim() || 'Open to read the notes log',
        at: ms(x.updatedAt), unread: x.stage === 'new' ? 1 : 0,
        link: { href: `${RP}/leads/${x.id}`, label: 'Open lead' },
      });
    }
    for (const b of bookings) {
      const msgs = bookingMessages(b);
      if (!msgs.length) continue;
      const last = msgs[msgs.length - 1];
      out.push({
        key: `B-${b.id}`, channel: 'booking', subcat: MODEL_SUBCAT[b.model], booking: b, preview: true,
        title: b.customer.name, sub: `${b.id} · ${byId.get(b.listingId)?.title ?? b.listingId}`,
        snippet: `${last.actor === 'provider' ? 'You: ' : ''}${last.text}`, at: last.at,
        unread: last.actor === 'customer' ? 1 : 0,
      });
    }
    return out;
  }, [emails, chats, waOn, leads, bookings, byId]);

  const matchesSearch = useCallback((t: Thread) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [t.title, t.sub, t.snippet].some((x) => x.toLowerCase().includes(s));
  }, [q]);
  const inTab = (t: Thread, tab: Subcat) => tab === 'all' || t.subcat === tab;
  const inChannel = (t: Thread, ch: Channel | 'all') => ch === 'all' || t.channel === ch;

  const shown = useMemo(() => threads
    .filter((t) => inTab(t, sub) && inChannel(t, channel) && matchesSearch(t))
    .sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.at - a.at),
  [threads, sub, channel, matchesSearch]);

  const tabCounts = useMemo(() => Object.fromEntries(tabs.map((v) => [v, threads.filter((t) => inTab(t, v) && inChannel(t, channel) && matchesSearch(t)).length])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabs is derived from servicesOn
    [threads, channel, matchesSearch, servicesOn]);
  const chanCount = (ch: Channel | 'all') => threads.filter((t) => inTab(t, sub) && inChannel(t, ch) && matchesSearch(t)).length;

  const selKey = picked ?? (narrow ? null : shown[0]?.key ?? null);
  const sel = threads.find((t) => t.key === selKey) ?? null;
  const unreadTotal = threads.filter((t) => t.unread > 0).length;

  const list = (
    <div className="gx-split-l" role="listbox" aria-label="Conversations">
      {shown.length === 0 ? (
        <div className="gx-empty"><b>No conversations</b>Nothing matches this tab{channel === 'all' ? '' : ` and channel`}{q ? ' and search' : ''}.</div>
      ) : shown.map((t) => {
        const Ic = CHANNEL_ICON[t.channel];
        return (
          <button key={t.key} type="button" role="option" className="gx-qitem" aria-selected={t.key === selKey} onClick={() => setPicked(t.key)}>
            <span className="t" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Ic size={13} aria-hidden style={{ color: 'var(--ms-ink-3)', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: t.unread ? 800 : 600 }}>{t.title}</span>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ms-ink-3)', flex: 'none' }}>{when(t.at)}</span>
            </span>
            <span className="s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.sub}</span>
            <span className="s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: t.unread ? 'var(--ms-ink)' : undefined }}>{t.snippet}</span>
            <span className="f">
              {t.subcat && <SubcatPill v={t.subcat} />}
              <Pill tone="outline" dot={false}>{CHANNEL_LABEL[t.channel]}</Pill>
              {t.unread > 0 && <Pill tone="primary">{t.channel === 'lead' ? 'New lead' : t.unread > 1 ? `${t.unread} unread` : 'Unread'}</Pill>}
              {t.preview && <PreviewTag />}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <OsPage>
      <PageHead
        eyebrow="Communications"
        title="Inbox"
        lede="Every conversation in one place — emails, WhatsApp, booking messages and lead notes — across long-term leases, holiday homes, venues, courts and yachts. Unread first."
        actions={<>
          <Btn href={`${RP}/communications`}>Email inbox</Btn>
          {waOn && <Btn href={`${RP}/whatsapp`}>WhatsApp</Btn>}
        </>}
      />
      <SubcatTabs value={sub} onChange={(v) => { setSub(v); setPicked(null); }} counts={tabCounts} options={tabs} label="Filter by subcategory" />
      <div className="gx-btn-row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="gx-chips" role="group" aria-label="Filter by channel">
          {CHANNELS.filter((c) => c.v !== 'whatsapp' || waOn).map((c) => (
            <button key={c.v} type="button" className="gx-chip" aria-pressed={channel === c.v} onClick={() => { setChannel(c.v); setPicked(null); }}>{c.l} · {chanCount(c.v)}</button>
          ))}
        </div>
        <div style={{ minWidth: 220, flex: '0 1 280px' }}><SearchField value={q} onChange={setQ} placeholder="Search conversations" /></div>
      </div>
      {emailState === 'error' && (
        <div style={{ marginBottom: 10 }}><Callout tone="warn" title="Emails could not be loaded.">The other channels below still work. <Btn size="xs" href={`${RP}/communications`}>Open email inbox</Btn></Callout></div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginBottom: 8 }}>
        {shown.length} conversation{shown.length === 1 ? '' : 's'} · {unreadTotal} unread overall{emailState === 'off' ? ' · no mailbox connected (Settings → Email)' : ''}{emailState === 'loading' ? ' · loading emails…' : ''}
      </div>

      {narrow ? (
        sel ? (
          <div>
            <div style={{ marginBottom: 8 }}><Btn size="sm" variant="ghost" onClick={() => setPicked('__none__')}><ArrowLeft size={13} aria-hidden /> All conversations</Btn></div>
            <ThreadPane key={sel.key} t={sel} />
          </div>
        ) : <div className="gx-split">{list}</div>
      ) : (
        <div className="gx-split">
          {list}
          <div className="gx-split-r">
            {sel ? <ThreadPane key={sel.key} t={sel} /> : (
              <Card pad><div className="gx-empty"><b>Select a conversation</b>Pick a thread to read the history and reply.</div></Card>
            )}
          </div>
        </div>
      )}
    </OsPage>
  );
}

// ---------------------------------------------------------------------------- thread pane

function Bubble({ out, who, at, text }: { out: boolean; who: string; at: number; text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '82%', padding: '8px 11px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: out ? 'var(--ms-tint-light)' : 'var(--ms-surface-2)', border: `1px solid ${out ? 'var(--ms-tint)' : 'var(--ms-border)'}`,
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ms-ink-3)', marginBottom: 3 }}>{who} · {whenFull(at)}</div>
        {text}
      </div>
    </div>
  );
}

function ReplyBox({ onSend, placeholder }: { onSend: (text: string) => Promise<string | null> | string | null; placeholder: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const e = await onSend(text.trim());
    setBusy(false);
    if (e) setErr(e); else { setErr(null); setText(''); }
  };
  return (
    <div style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--ms-border)', paddingTop: 10 }}>
      <textarea className="gx-ta" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Reply" />
      {err && <div style={{ color: 'var(--ms-danger)', fontSize: 11.5 }}>{err}</div>}
      <div className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
        <Btn variant="primary" size="sm" onClick={send} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send reply'}</Btn>
      </div>
    </div>
  );
}

function PaneHead({ t, extra }: { t: Thread; extra?: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0, flex: 1, minWidth: 0 }}>{t.title}</h2>
        {t.subcat && <SubcatPill v={t.subcat} />}
        <Pill tone="outline" dot={false}>{CHANNEL_LABEL[t.channel]}</Pill>
        {t.preview && <PreviewTag />}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ms-ink-3)' }}>{t.sub}</div>
      <div className="gx-btn-row">
        {t.link && <Btn size="xs" href={t.link.href}>{t.link.label}</Btn>}
        {extra}
      </div>
    </div>
  );
}

function ThreadPane({ t }: { t: Thread }) {
  if (t.channel === 'email' && t.email) return <EmailPane t={t} id={t.email.id} />;
  if (t.channel === 'whatsapp' && t.wa) return <WaPane t={t} id={t.wa.id} />;
  if (t.channel === 'lead' && t.lead) return <LeadPane t={t} lead={t.lead} />;
  if (t.channel === 'booking' && t.booking) return <BookingPane t={t} b={t.booking} />;
  return null;
}

function EmailPane({ t, id }: { t: Thread; id: number }) {
  const [d, setD] = useState<EmailThreadDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => emailApi.thread(null, id, { limit: 30 }).then(setD).catch((e) => setErr(errorText(e, 'Could not load this conversation'))), [id]);
  useEffect(() => { void load(); }, [load]);
  const oldPage = `${RP}/communications?thread=${id}`;
  return (
    <div>
      <PaneHead t={t} extra={<Btn size="xs" href={oldPage}>Open in email inbox</Btn>} />
      {err && <Callout tone="warn">{err}</Callout>}
      {!d && !err && <div className="gx-empty">Loading…</div>}
      {d && (
        <div style={{ display: 'grid', gap: 8 }}>
          {d.earlier > 0 && <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>{d.earlier} earlier email{d.earlier === 1 ? '' : 's'} — <a href={oldPage}>open in email inbox</a> to read them.</div>}
          {d.messages.map((m) => (
            <Bubble key={m.id} out={m.direction === 'out'} who={m.direction === 'out' ? (m.sentByName || 'You') : (m.fromName || m.fromEmail)} at={ms(m.sentAt)}
              text={m.bodyText.length > 2000 ? `${m.bodyText.slice(0, 2000)}…` : m.bodyText || '(no text — open in email inbox)'} />
          ))}
          {d.canSend
            ? <ReplyBox placeholder={`Reply to ${d.replyTo}`} onSend={async (text) => {
                try { await emailApi.reply(null, id, { body: text }); await load(); return null; } catch (e) { return errorText(e, 'The reply could not be sent'); }
              }} />
            : <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>You can read this conversation but not reply from your account.</div>}
        </div>
      )}
    </div>
  );
}

function WaPane({ t, id }: { t: Thread; id: number }) {
  const [d, setD] = useState<WaChatDetail | null>(null);
  const [msgs, setMsgs] = useState<WaMessage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => Promise.all([whatsappApi.chat(null, id), whatsappApi.messages(null, id)])
    .then(([c, m]) => { setD(c); setMsgs([...m.items].sort((a, b) => ms(a.sentAt) - ms(b.sentAt))); })
    .catch((e) => setErr(errorText(e, 'Could not load this chat'))), [id]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div>
      <PaneHead t={t} extra={<Btn size="xs" href={`${RP}/whatsapp?chat=${id}`}>Open in WhatsApp</Btn>} />
      {err && <Callout tone="warn">{err}</Callout>}
      {!msgs && !err && <div className="gx-empty">Loading…</div>}
      {msgs && (
        <div style={{ display: 'grid', gap: 8 }}>
          {msgs.map((m) => (
            <Bubble key={m.id} out={m.direction === 'out'} who={m.direction === 'out' ? (m.sentByName || 'You') : (m.authorName || t.title)} at={ms(m.sentAt)}
              text={m.isRevoked ? 'This message was deleted' : m.body || m.transcript || `[${m.type}]`} />
          ))}
          {d?.canSend
            ? <ReplyBox placeholder="Write a WhatsApp message" onSend={async (text) => {
                try { const r = await whatsappApi.sendText(null, id, text); await load(); return r.status === 'not_sent' ? (r.error || 'Not sent') : null; } catch (e) { return errorText(e, 'The message could not be sent'); }
              }} />
            : <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Replying is not available on this chat from here.</div>}
        </div>
      )}
    </div>
  );
}

type LeadNote = { id: number; body: string; authorName: string | null; authorRole: string | null; createdAt: string };

function LeadPane({ t, lead }: { t: Thread; lead: ApiLead }) {
  const [notes, setNotes] = useState<LeadNote[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/leads/${lead.id}/notes`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => { if (alive) setNotes(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setNotes([]); });
    return () => { alive = false; };
  }, [lead.id]);
  const items = useMemo(() => {
    const out: { key: string; at: number; who: string; text: string; out: boolean }[] = [];
    if (lead.notes?.trim()) out.push({ key: 'enquiry', at: ms(lead.createdAt), who: `${leadDisplayName(lead)} (enquiry)`, text: lead.notes.trim(), out: false });
    for (const n of notes ?? []) out.push({ key: `n-${n.id}`, at: ms(n.createdAt), who: n.authorName || (n.authorRole === 'system' ? 'System' : 'Team'), text: n.body, out: true });
    return out.sort((a, b) => a.at - b.at);
  }, [notes, lead]);
  return (
    <div>
      <PaneHead t={t} />
      {notes == null && <div className="gx-empty">Loading notes…</div>}
      {notes != null && (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.length === 0 && <div className="gx-empty"><b>No notes yet</b>Open the lead to log a call or add a note.</div>}
          {items.map((x) => <Bubble key={x.key} out={x.out} who={x.who} at={x.at} text={x.text} />)}
          <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', borderTop: '1px solid var(--ms-border)', paddingTop: 10 }}>
            Lead notes are read-only here — open the lead to add a note, log a call or move the stage.
          </div>
        </div>
      )}
    </div>
  );
}

function BookingPane({ t, b }: { t: Thread; b: Booking }) {
  const { store } = useOwn();
  const [drawer, setDrawer] = useState(false);
  const live = store.bookings.find((x) => x.id === b.id) ?? b;
  const msgs = bookingMessages(live);
  return (
    <div>
      <PaneHead t={t} extra={<Btn size="xs" onClick={() => setDrawer(true)}>Open booking</Btn>} />
      <div style={{ display: 'grid', gap: 8 }}>
        {msgs.map((m, i) => (
          <Bubble key={i} out={m.actor === 'provider'} who={m.actor === 'provider' ? 'You' : m.actor === 'system' ? 'UpNow' : live.customer.name} at={m.at} text={m.text} />
        ))}
        {canMessage(live)
          ? <ReplyBox placeholder={`Reply to ${live.customer.name}`} onSend={(text) => store.providerAct(live.id, { type: 'reply', text }).error ?? null} />
          : <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Messaging is closed for this booking.</div>}
      </div>
      <BookingDrawer bookingId={drawer ? live.id : null} onClose={() => setDrawer(false)} />
    </div>
  );
}
