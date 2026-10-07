'use client';

/**
 * One email conversation, read the way a trail is read: who it is with and which
 * unit, then the emails oldest-first under the day they were sent — each folded
 * to one line (who, what they said, files) except the newest, so a trail of
 * twenty is a page, not a wall. Opening one shows who it went to and who was
 * copied, the text without the mail app's debris, the signature and the quoted
 * history one click away, and the files as cards. Then Reply / Reply all.
 * Used by the inbox page and by the slide-over on the customer, lead, vendor and
 * lease pages.
 *
 * An email kept as its writer laid it out (tables, pictures) is shown that way,
 * in a sealed frame (EmailLayoutFrame) — never as markup inside the dashboard.
 * Anything else is its plain text.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Forward, Info, Loader2, MailOpen, Paperclip, Plus, Reply, ReplyAll, Send, X } from 'lucide-react';
import {
  emailApi, emailWhen, errorText, fileSize,
  type EmailMessageRow, type EmailThreadDetail, type Rp, type StagedAttachment,
} from '@/lib/emailApi';
import { bareSubject, dayLabel, firstWords, splitEmailBody } from '@/lib/emailText';
import { Avatar, FileCard, KindChip } from './EmailBits';
import { EmailContextPanel } from './EmailContextPanel';
import { EmailLayoutFrame } from './EmailLayoutFrame';

/** Files picked in a composer, parked on the server until Send. */
export function useStagedAttachments(rp: Rp) {
  const [files, setFiles] = useState<StagedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null); setUploading(true);
    try {
      let count = files.length;
      for (const f of Array.from(list)) {
        if (count >= 5) { setError('Up to 5 files per email'); break; }
        if (f.size > 10 * 1024 * 1024) { setError(`${f.name} is larger than 10 MB`); continue; }
        const staged = await emailApi.stage(rp, f);
        setFiles((prev) => [...prev, staged]);
        count++;
      }
    } catch (e) { setError(errorText(e, 'The file could not be attached')); } finally { setUploading(false); }
  };
  const remove = (key: string) => setFiles((prev) => prev.filter((f) => f.key !== key));
  const clear = () => setFiles([]);
  return { files, uploading, error, add, remove, clear };
}

/** What will stand under the email — so nobody types their name twice, or wonders whose name goes out. */
export function SignedAs({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <div className="mt-1.5 text-[11px] text-[#9b9890]">
      Signed automatically with your name:
      <div className="mt-1 pl-2.5 border-l-2 border-[#e8e6e0] text-[#6b6860] whitespace-pre-wrap leading-snug">{text}</div>
    </div>
  );
}

export function AttachmentChips({ files, onRemove }: { files: StagedAttachment[]; onRemove: (key: string) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f) => (
        <span key={f.key} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[#f4f3ef] text-[#4a4842] text-xs">
          <Paperclip size={11} /> {f.fileName} <span className="text-[#9b9890]">{fileSize(f.sizeBytes)}</span>
          <button type="button" aria-label={`Remove ${f.fileName}`} onClick={() => onRemove(f.key)} className="rounded-full p-0.5 hover:bg-[#e8e6e0] cursor-pointer"><X size={11} /></button>
        </span>
      ))}
    </div>
  );
}

type Who = (email: string) => string;

const TOOL = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#2b2a27] hover:bg-[#f4f3ef] cursor-pointer';
const TOOL_ON = 'bg-[#eef9f4] text-[#1a7a5a]';

/** One line of an email's header — "Cc  Asrar <asrar@…>, broker@…". */
function HeaderLine({ label, list, who }: { label: string; list: string[]; who: Who }) {
  return (
    <div className="flex gap-3">
      <dt className="w-9 shrink-0 text-[#9b9890]">{label}</dt>
      <dd className="flex-1 min-w-0 break-words text-[#2b2a27]">
        {list.map((e, i) => {
          const name = who(e);
          return <span key={`${e}-${i}`}>{i > 0 && ', '}{name}{name !== e && name !== 'You' && <span className="text-[#9b9890]"> &lt;{e}&gt;</span>}</span>;
        })}
      </dd>
    </div>
  );
}

function Message({ m, rp, who, open, onToggle, onForward }: { m: EmailMessageRow; rp: Rp; who: Who; open: boolean; onToggle: () => void; onForward?: () => void }) {
  const [showSignature, setShowSignature] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const parts = useMemo(() => splitEmailBody(m.bodyText), [m.bodyText]);
  const out = m.direction === 'out';
  // An email written in the portal names the person; one sent from the office mail app is just "You".
  // Sent from the portal → the person; sent from Outlook on the shared mailbox → nobody named.
  const sender = out ? (m.sentByName ? `You · ${m.sentByName}` : m.sentFrom === 'mailbox' ? 'You · from Outlook, nobody named' : 'You') : who(m.fromEmail);
  const when = new Date(m.sentAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const to = m.toEmails.length ? m.toEmails : [m.toEmail];
  // The text — the whole email when it has no layout of its own, the stand-in when the layout cannot be had.
  const textBody = (
    <>
      <div className="text-sm text-[#2b2a27] whitespace-pre-wrap break-words leading-relaxed" dir="auto">{parts.main || (parts.quoted || parts.signature ? '' : <span className="text-[#9b9890] italic">No text in this email{m.attachments?.length ? ' — see the attachment below' : ''}.</span>)}</div>
      {(parts.signature || parts.quoted) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {parts.signature && <button type="button" onClick={() => setShowSignature((v) => !v)} aria-expanded={showSignature} className="text-[11px] text-[#6b6860] border border-[#e8e6e0] rounded-full px-2.5 py-0.5 hover:border-[#9b9890] cursor-pointer">{showSignature ? 'Hide signature' : 'Signature'}</button>}
          {parts.quoted && <button type="button" onClick={() => setShowQuoted((v) => !v)} aria-expanded={showQuoted} className="text-[11px] text-[#6b6860] border border-[#e8e6e0] rounded-full px-2.5 py-0.5 hover:border-[#9b9890] cursor-pointer">{showQuoted ? 'Hide earlier emails' : 'Earlier emails quoted below'}</button>}
        </div>
      )}
      {showSignature && <div className="mt-2 text-xs text-[#6b6860] whitespace-pre-wrap break-words" dir="auto">{parts.signature}</div>}
      {showQuoted && <div className="mt-2 pl-3 border-l-2 border-[#e8e6e0] text-xs text-[#6b6860] whitespace-pre-wrap break-words" dir="auto">{parts.quoted}</div>}
    </>
  );

  if (!open) {
    return (
      <button type="button" onClick={onToggle} aria-expanded={false}
        className={`w-full text-left rounded-xl border pl-3 pr-3.5 py-2.5 flex items-center gap-3 cursor-pointer hover:border-[#2e9f82] ${out ? 'bg-[#f6fbf9] border-[#d7ede5] border-l-[3px] border-l-[#2e9f82]' : 'bg-white border-[#e8e6e0]'}`}>
        <Avatar name={out ? null : who(m.fromEmail)} tone={out ? 'you' : 'record'} size={30} />
        <span className="text-[13px] font-semibold text-[#1a1916] shrink-0 max-w-[32%] truncate">{sender}</span>
        <span className="text-[13px] text-[#6b6860] truncate flex-1 min-w-0" dir="auto">{firstWords(m.bodyText) || '(no text)'}</span>
        {m.attachments.length > 0 && <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-[#9b9890] tabular-nums"><Paperclip size={11} />{m.attachments.length}</span>}
        <span className="text-[11px] text-[#9b9890] shrink-0 tabular-nums">{emailWhen(m.sentAt)}</span>
      </button>
    );
  }
  return (
    <article className={`rounded-xl border ${out ? 'bg-[#f6fbf9] border-[#d7ede5] border-l-[3px] border-l-[#2e9f82]' : 'bg-white border-[#e8e6e0]'}`}>
      <div className="flex items-start gap-3 pl-3 pr-3.5 pt-3">
        <Avatar name={out ? null : who(m.fromEmail)} tone={out ? 'you' : 'record'} size={36} />
        <div className="min-w-0 flex-1">
          <div role="button" tabIndex={0} aria-expanded onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
            className="flex items-baseline gap-2 cursor-pointer" title="Fold this email">
            <span className="text-sm font-semibold text-[#1a1916] truncate">{sender}</span>
            <span className="text-[11px] text-[#9b9890] ml-auto shrink-0 tabular-nums">{emailWhen(m.sentAt)}</span>
          </div>
          {/* The email's own header, as a mail app shows it — nobody on it is hidden. */}
          <dl className="mt-1.5 mb-1 rounded-lg bg-white/70 border border-[#f0eee9] px-3 py-2 text-xs space-y-1">
            <HeaderLine label="From" list={[m.fromEmail]} who={out ? (e) => (m.fromName ? m.fromName : e) : who} />
            <HeaderLine label="To" list={to} who={who} />
            {m.ccEmails.length > 0 && <HeaderLine label="Cc" list={m.ccEmails} who={who} />}
            <div className="flex gap-3"><dt className="w-9 shrink-0 text-[#9b9890]">Date</dt><dd className="flex-1 text-[#2b2a27] tabular-nums">{when}</dd></div>
            {bareSubject(m.subject) && <div className="flex gap-3"><dt className="w-9 shrink-0 text-[#9b9890]">Subj.</dt><dd className="flex-1 min-w-0 break-words text-[#2b2a27]">{m.subject}</dd></div>}
          </dl>
        </div>
      </div>
      <div className="pl-[60px] pr-4 pb-3.5">
        {m.status === 'not_sent' && <div className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">Not sent — email is switched off on this environment.</div>}
        {m.hasLayout ? <EmailLayoutFrame rp={rp} messageId={m.id} fallback={textBody} /> : textBody}
        {m.attachments.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{m.attachments.map((a) => <FileCard key={a.id} rp={rp} file={a} />)}</div>}
        {onForward && (
          <div className="mt-3 pt-2.5 border-t border-[#f0eee9]">
            <button type="button" onClick={onForward} className="inline-flex items-center gap-1.5 text-xs text-[#4a4842] hover:text-[#1a7a5a] cursor-pointer"><Forward size={13} /> Forward this email{m.attachments.length > 0 ? ` with its ${m.attachments.length === 1 ? 'file' : `${m.attachments.length} files`}` : ''}</button>
          </div>
        )}
      </div>
    </article>
  );
}

/** Addresses being copied on a reply: chips, with room to add one more. */
function CcEditor({ list, who, onChange }: { list: string[]; who: Who; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const e = draft.trim().toLowerCase().replace(/[,;]$/, '');
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !list.includes(e)) onChange([...list, e]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[#9b9890] w-7">Cc</span>
      {list.map((e) => (
        <span key={e} title={e} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-[#f4f3ef] text-xs text-[#2b2a27]">
          {who(e)}
          <button type="button" aria-label={`Don't copy ${e}`} onClick={() => onChange(list.filter((x) => x !== e))} className="rounded-full p-0.5 hover:bg-[#e8e6e0] cursor-pointer"><X size={11} /></button>
        </span>
      ))}
      <span className="inline-flex items-center gap-1 text-xs text-[#6b6860]">
        <Plus size={11} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); add(); } }}
          placeholder="copy someone else" aria-label="Copy someone else" className="w-[150px] bg-transparent text-xs focus:outline-none placeholder:text-[#9b9890]" />
      </span>
    </div>
  );
}

export function EmailThreadView({ rp, threadId, canSend: mailboxReady = true, isManager = false, onChanged, onMoved }: {
  rp: Rp;
  threadId: number;
  /** false when no mailbox is connected — the conversation is still readable. */
  canSend?: boolean;
  isManager?: boolean;
  /** A reply went out, it was marked read or filed under someone — the list should refresh. */
  onChanged?: () => void;
  /** Filing it under someone joined it to another conversation: it lives at this id now. */
  onMoved?: (threadId: number) => void;
}) {
  const [thread, setThread] = useState<EmailThreadDetail | null>(null);
  // Writing needs a working mailbox AND the authority to send — the server says which.
  const canSend = mailboxReady && thread?.canSend !== false;
  const [error, setError] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [about, setAbout] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [mode, setMode] = useState<'closed' | 'reply' | 'all' | 'forward'>('closed');
  /** The email being forwarded, and who to. */
  const [forwardId, setForwardId] = useState<number | null>(null);
  const [forwardTo, setForwardTo] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const staged = useStagedAttachments(rp);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  const show = useCallback((t: EmailThreadDetail, keepOpen = false) => {
    setThread(t); setError(null);
    // The newest is open, and so is everything not read yet.
    const fresh = new Set(t.messages.slice(-Math.max(1, Math.min(t.unreadCount, t.messages.length))).map((m) => m.id));
    setOpenIds((prev) => (keepOpen ? new Set([...prev, ...fresh]) : fresh));
  }, []);

  const load = useCallback(async (keepOpen = false) => {
    try {
      const t = await emailApi.thread(rp, threadId);
      show(t, keepOpen);
      if (t.unreadCount > 0) { await emailApi.markRead(rp, threadId); onChangedRef.current?.(); }
    } catch (e) { setError(errorText(e, 'Could not open the conversation')); }
  }, [rp, threadId, show]);

  // Callers key this component by thread id, so it mounts fresh per conversation.
  useEffect(() => {
    const t = window.setTimeout(() => { void load(); setAbout(window.innerWidth >= 1500); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);
  // To the newest email when it opens or a new one arrives — not when older ones are brought in above.
  const newestId = thread?.messages[thread.messages.length - 1]?.id;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.id, newestId]);

  /** A long trail arrives newest-first, 20 at a time: bring in the 20 before the oldest one showing. */
  const showEarlier = async () => {
    if (!thread?.messages.length || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const older = await emailApi.thread(rp, threadId, { before: thread.messages[0].id });
      setThread((t) => (t ? { ...t, earlier: older.earlier, messages: [...older.messages, ...t.messages] } : t));
    } catch (e) { setError(errorText(e, 'Could not load the earlier emails')); } finally { setLoadingEarlier(false); }
  };

  const who: Who = useCallback((email) => {
    const e = email.toLowerCase();
    if (thread?.ownAddresses.includes(e)) return 'You';
    return thread?.names[e] ?? email;
  }, [thread]);

  /** Everyone else who was on the latest email — who "Reply all" keeps in the loop. */
  const everyoneElse = useMemo(() => {
    if (!thread?.messages.length) return [];
    const last = thread.messages[thread.messages.length - 1];
    const all = [last.fromEmail, ...(last.toEmails.length ? last.toEmails : [last.toEmail]), ...last.ccEmails].map((e) => e.toLowerCase());
    // Another of the landlord's own mailboxes stays in copy if it was — only the one answering drops out.
    return [...new Set(all)].filter((e) => e && e !== thread.mailbox?.emailAddress.toLowerCase() && !(thread.mailbox == null && thread.ownAddresses.includes(e)) && e !== thread.replyTo.toLowerCase());
  }, [thread]);

  const start = (next: 'reply' | 'all') => { setMode(next); setCc(next === 'all' ? everyoneElse : []); setSendError(null); };
  const startForward = (messageId: number) => { setMode('forward'); setForwardId(messageId); setForwardTo(''); setCc([]); setSendError(null); };
  const discard = () => { setMode('closed'); setCc([]); setForwardId(null); setForwardTo(''); setSendError(null); };
  const markUnread = async () => {
    try { await emailApi.markUnread(rp, threadId); onChangedRef.current?.(); } catch { /* it simply stays read */ }
  };

  const send = async () => {
    if (sending) return;
    if (mode === 'forward') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwardTo.trim())) { setSendError('Write the email address to forward it to'); return; }
    } else if (!body.trim()) return;
    setSending(true); setSendError(null);
    try {
      if (mode === 'forward' && forwardId != null) await emailApi.forward(rp, threadId, { messageId: forwardId, to: forwardTo.trim().toLowerCase(), cc, body, attachments: staged.files });
      else await emailApi.reply(rp, threadId, { body, cc, attachments: staged.files });
      setBody(''); setCc([]); setMode('closed'); setForwardId(null); setForwardTo(''); staged.clear();
      await load(true); onChangedRef.current?.();
    } catch (e) { setSendError(errorText(e, 'The email could not be sent')); } finally { setSending(false); }
  };

  if (error) return <div className="p-6 text-sm text-[#b42318]">{error}</div>;
  if (!thread) return <div className="p-6 text-sm text-[#9b9890]">Loading…</div>;

  const title = thread.recordName ?? thread.counterpartName ?? who(thread.counterpartEmail);
  const current = thread.contracts.find((c) => c.status === 'active') ?? thread.contracts[0];
  const where = current ? `${current.unitNumber} · ${current.buildingName}` : thread.lead?.unitNumber ? `${thread.lead.unitNumber}${thread.lead.buildingName ? ` · ${thread.lead.buildingName}` : ''}` : thread.counterpartEmail;
  const allOpen = openIds.size >= thread.messages.length;
  const forwarding = forwardId != null ? thread.messages.find((m) => m.id === forwardId) ?? null : null;
  const theirs = thread.people.filter((p) => p.side === 'theirs').length;
  const copied = thread.people.filter((p) => p.side !== 'theirs').length;

  return (
    <div className="flex h-full min-h-0 relative">
      <div className="flex flex-col h-full min-h-0 flex-1 min-w-0">
        <div className="px-4 sm:px-5 py-3 border-b border-[#e8e6e0] shrink-0 flex items-start gap-3">
          <Avatar name={title} tone={thread.kind === 'other' ? 'other' : 'record'} size={42} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-[#1a1916] truncate" title={title}>{title}</span>
              <KindChip kind={thread.kind} />
            </div>
            <h2 className="text-[15px] font-semibold text-[#1a1916] break-words leading-snug mt-0.5">{bareSubject(thread.subject)}</h2>
            <div className="text-xs text-[#9b9890] mt-0.5">
              <span className="text-[#6b6860]">{where}</span>{thread.mailbox && thread.ownAddresses.length > 1 && <> · on <span className="text-[#6b6860]">{thread.mailbox.emailAddress}</span></>} · {thread.totalMessages.toLocaleString('en-GB')} {thread.totalMessages === 1 ? 'email' : 'emails'}
              {theirs > 0 && <> · {theirs} on their side</>}{copied > 0 && <> · {copied} in copy</>}
              {thread.files.length > 0 && <> · {thread.files.length} {thread.files.length === 1 ? 'file' : 'files'}</>}
            </div>
          </div>
          {thread.messages.length > 1 && (
            <button type="button" onClick={() => setOpenIds(allOpen ? new Set([thread.messages[thread.messages.length - 1].id]) : new Set(thread.messages.map((m) => m.id)))}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-[#4a4842] border border-[#e8e6e0] hover:border-[#9b9890] cursor-pointer">
              {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}<span className="hidden md:inline">{allOpen ? 'Fold all' : 'Open all'}</span>
            </button>
          )}
          <button type="button" onClick={() => setAbout((v) => !v)} aria-pressed={about} aria-label="About this conversation"
            className={`shrink-0 p-2 rounded-full cursor-pointer ${about ? 'bg-[#eef9f4] text-[#1a7a5a]' : 'text-[#6b6860] hover:bg-[#f4f3ef]'}`}><Info size={17} /></button>
        </div>

        {/* A mail app's toolbar: what can be done with the newest email of the trail. */}
        <div className="px-4 sm:px-5 py-2 border-b border-[#e8e6e0] shrink-0 flex flex-wrap items-center gap-1.5 bg-white" role="toolbar" aria-label="Email actions">
          {canSend && (
            <>
              <button type="button" onClick={() => start('reply')} aria-pressed={mode === 'reply'} className={`${TOOL} ${mode === 'reply' ? TOOL_ON : ''}`}><Reply size={14} /> Reply</button>
              {everyoneElse.length > 0 && <button type="button" onClick={() => start('all')} aria-pressed={mode === 'all'} className={`${TOOL} ${mode === 'all' ? TOOL_ON : ''}`}><ReplyAll size={14} /> Reply all</button>}
              <button type="button" onClick={() => startForward(thread.messages[thread.messages.length - 1].id)} aria-pressed={mode === 'forward'} className={`${TOOL} ${mode === 'forward' ? TOOL_ON : ''}`}><Forward size={14} /> Forward</button>
              <span className="w-px h-5 bg-[#e8e6e0] mx-1" />
            </>
          )}
          <button type="button" onClick={() => void markUnread()} className={TOOL}><MailOpen size={14} /> Mark as unread</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-4 space-y-2 bg-[#fbfaf8]">
          {thread.earlier > 0 && (
            <div className="text-center pb-1">
              <button type="button" onClick={() => void showEarlier()} disabled={loadingEarlier}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1a7a5a] bg-white border border-[#e8e6e0] rounded-full px-4 py-1.5 hover:border-[#2e9f82] cursor-pointer disabled:opacity-60">
                {loadingEarlier ? <Loader2 size={12} className="animate-spin" /> : null}
                {loadingEarlier ? 'Loading…' : `Show earlier emails · ${thread.earlier.toLocaleString('en-GB')} more`}
              </button>
            </div>
          )}
          {thread.messages.map((m, i) => {
            const d = dayLabel(m.sentAt);
            const sep = i === 0 || d !== dayLabel(thread.messages[i - 1].sentAt);
            return (
              <div key={m.id} className="space-y-2">
                {sep && <div className="flex items-center gap-3 pt-2 pb-0.5"><span className="h-px flex-1 bg-[#e8e6e0]" /><span className="text-[11px] font-medium text-[#9b9890]">{d}</span><span className="h-px flex-1 bg-[#e8e6e0]" /></div>}
                <Message m={m} rp={rp} who={who} open={openIds.has(m.id)}
                  onToggle={() => setOpenIds((prev) => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; })}
                  onForward={canSend ? () => startForward(m.id) : undefined} />
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {!canSend && (
          <div className="border-t border-[#e8e6e0] px-5 py-3 shrink-0 bg-white text-xs text-[#6b6860]">
            {thread.canSend
              ? 'No email is connected, so a reply can’t be sent from here.'
              : 'You can read this conversation but not reply — sending emails is not among the authorities this landlord gave you.'}
          </div>
        )}
        {canSend && mode !== 'closed' && (
          <div className="border-t border-[#e8e6e0] px-4 sm:px-5 py-3 shrink-0 bg-white">
            <div className="flex items-center gap-1.5 text-xs mb-1.5">
              <span className="text-[#9b9890] w-7">To</span>
              {mode === 'forward' ? (
                <input autoFocus type="email" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="who to forward it to — any email address" aria-label="Forward to"
                  className="flex-1 border-b border-[#e8e6e0] py-1 text-xs focus:outline-none focus:border-[#2e9f82] placeholder:text-[#9b9890]" />
              ) : (
                <><span className="text-[#2b2a27]">{who(thread.replyTo)}</span><span className="text-[#9b9890] truncate">{who(thread.replyTo) !== thread.replyTo ? `<${thread.replyTo}>` : ''}</span></>
              )}
              <button type="button" onClick={discard} aria-label="Discard" className="ml-auto p-1 rounded text-[#6b6860] hover:bg-[#f4f3ef] cursor-pointer"><X size={14} /></button>
            </div>
            <div className="mb-2"><CcEditor list={cc} who={who} onChange={setCc} /></div>
            {mode === 'forward' && forwarding && (
              <div className="mb-2 text-xs text-[#6b6860] rounded-lg bg-[#fbfaf8] border border-[#f0eee9] px-2.5 py-1.5">
                Forwarding <span className="text-[#2b2a27]">{forwarding.direction === 'out' ? 'your email' : `${who(forwarding.fromEmail)}’s email`}</span> of {new Date(forwarding.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                {forwarding.attachments.length > 0 ? ` with ${forwarding.attachments.length === 1 ? 'its file' : `its ${forwarding.attachments.length} files`}` : ''}. It stays on this trail.
              </div>
            )}
            <textarea autoFocus={mode !== 'forward'} value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={mode === 'forward' ? 'Add a note above the forwarded email (optional)…' : 'Write your reply…'}
              className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82] resize-y" />
            <SignedAs text={thread.signaturePreview} />
            <div className="mt-2"><AttachmentChips files={staged.files} onRemove={staged.remove} /></div>
            <div className="mt-2 flex items-center gap-2">
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void staged.add(e.target.files); e.target.value = ''; }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={staged.uploading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#e8e6e0] text-[#4a4842] hover:border-[#2e9f82] cursor-pointer disabled:opacity-60">
                {staged.uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Attach
              </button>
              <span className="text-xs text-[#b42318] flex-1">{sendError ?? staged.error ?? ''}</span>
              <button type="button" onClick={send} disabled={(mode === 'forward' ? !forwardTo.trim() : !body.trim()) || sending || staged.uploading} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] cursor-pointer disabled:opacity-60">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {sending ? 'Sending…' : mode === 'forward' ? 'Forward' : cc.length ? `Send to ${cc.length + 1}` : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>

      {about && (
        <div className="absolute inset-0 z-10 xl:static xl:inset-auto xl:z-auto xl:w-[320px] xl:shrink-0 xl:border-l xl:border-[#e8e6e0]">
          <EmailContextPanel rp={rp} isManager={isManager} thread={thread} onClose={() => setAbout(false)}
            onLinked={(next) => { if (next.id !== thread.id) onMoved?.(next.id); else show(next, true); onChangedRef.current?.(); }} />
        </div>
      )}
    </div>
  );
}
