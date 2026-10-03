/**
 * Email module — the landlord's own mailbox, conversations with customers and leads.
 *
 * One set of endpoints for both portals. The landlord is resolved from their
 * login; a manager names the landlord, so every call takes the manager's `rp`
 * (null for the landlord) and appends `?rp=`.
 */
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

export type Rp = number | string | null | undefined;

/** One connected mailbox. A landlord can have several — properties@, accounts@… */
export interface MailboxOne {
  id: number;
  /** What the team calls it — "Properties". */
  label: string;
  emailAddress: string;
  displayName: string | null;
  status: 'connected' | 'error';
  lastError: string | null;
  lastSyncedAt: string | null;
  inboxOnly: boolean;
  /** What stands under an email the person signed in sends from this mailbox: their own name, then the mailbox's block. */
  signaturePreview: string;
  // landlord only
  username?: string;
  smtpHost?: string;
  smtpPort?: number;
  incomingProtocol?: 'pop3' | 'imap';
  incomingHost?: string;
  incomingPort?: number;
  signature?: string;
}

/** The landlord's mailboxes. The top-level fields describe the FIRST one; `mailboxes` lists them all. */
export interface MailboxInfo {
  enabled: boolean;
  canConfigure: boolean;
  /** May the person signed in write? The landlord always; a team member with "Emails — send". */
  canSend: boolean;
  /** The name emails are signed with — the person signed in. */
  signerName: string | null;
  connected: boolean;
  mailboxes: MailboxOne[];
  id: number | null;
  label: string | null;
  emailAddress: string | null;
  displayName: string | null;
  status: 'connected' | 'error' | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  /** POP3: only the inbox can be read, so the landlord's own emails are missing from the trail. */
  inboxOnly?: boolean;
  // landlord only
  username?: string;
  smtpHost?: string;
  smtpPort?: number;
  incomingProtocol?: 'pop3' | 'imap';
  incomingHost?: string;
  incomingPort?: number;
  signature?: string;
}

export interface MailboxForm {
  /** The mailbox being changed; left out to connect another one. */
  id?: number;
  label: string;
  emailAddress: string;
  displayName: string;
  username: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  incomingProtocol: 'pop3' | 'imap';
  incomingHost: string;
  incomingPort: number;
  signature: string;
}

export interface EmailThreadRow {
  id: number;
  subject: string;
  counterpartEmail: string;
  counterpartName: string | null;
  /** The customer, lead or vendor the conversation belongs to — the company for a company. Null for "other" mail. */
  recordName: string | null;
  /** The unit a customer's conversation is about — "Shed-8 · Avenue Warehouse". */
  unitLabel: string | null;
  /** Which of the landlord's mailboxes the latest email came through. */
  mailboxId: number | null;
  tenantId: number | null;
  leadId: number | null;
  vendorId: number | null;
  /** In the Finance, Legal or Promotions tab — instead of its record's. */
  category?: EmailCategory | null;
  messageCount: number;
  unreadCount: number;
  /** Files across the whole conversation. */
  fileCount: number;
  lastMessageAt: string;
  lastDirection: 'out' | 'in' | null;
  /** Who wrote the latest email — a name when they signed one. */
  lastFrom: string | null;
  lastSnippet: string | null;
}

/** The landlord's finance team, legal matters, newsletters and automatic notices — tabs of their own beside the records'. */
export type EmailCategory = 'finance' | 'legal' | 'promotions';

/** Which tab a conversation is in. "other" = nobody on record (bank, municipality, newsletter). */
export type EmailKind = 'customer' | 'lead' | 'vendor' | EmailCategory | 'other';

export function emailKindOf(t: Pick<EmailThreadRow, 'tenantId' | 'leadId' | 'vendorId' | 'category'>): EmailKind {
  return t.category ?? (t.tenantId != null ? 'customer' : t.leadId != null ? 'lead' : t.vendorId != null ? 'vendor' : 'other');
}

/** One page of conversations, newest first; `counts` feed the tabs. */
export interface EmailThreadPage {
  items: EmailThreadRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<'all' | EmailKind, number>;
  unreadBy: Record<'all' | EmailKind, number>;
}

export interface EmailAttachmentRow { id: number; fileName: string; mimeType: string; sizeBytes: number }

export interface EmailMessageRow {
  id: number;
  direction: 'out' | 'in';
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  /** The To and Cc lines as written. Empty on a few old emails — `toEmail` still says who it was with. */
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  bodyText: string;
  /** Kept as its writer laid it out (tables, pictures) — shown from `emailApi.layout`. Plain text otherwise. */
  hasLayout?: boolean;
  sentByName: string | null;
  sentByRole: string | null;
  status: 'sent' | 'not_sent' | 'received';
  sentAt: string;
  attachments: EmailAttachmentRow[];
}

/** their side of the conversation · the landlord's own people · outsiders kept in copy (a broker, the owner's office). */
export type EmailSide = 'theirs' | 'team' | 'copied';
export interface EmailPerson { email: string; name: string | null; emails: number; wrote: number; side: EmailSide }
export interface EmailTrailFile extends EmailAttachmentRow { messageId: number; sentAt: string; direction: 'out' | 'in' }
export interface EmailContract { id: number; status: string; startDate: string | null; endDate: string | null; unitNumber: string; buildingName: string }

export interface EmailThreadDetail extends Omit<EmailThreadRow, 'messageCount' | 'lastMessageAt' | 'lastDirection' | 'lastSnippet' | 'unitLabel' | 'fileCount' | 'lastFrom' | 'mailboxId'> {
  kind: EmailKind;
  /** The landlord's own mailboxes — "You" wherever one appears. */
  ownAddresses: string[];
  /** May the person signed in reply, reply all or forward here? */
  canSend: boolean;
  /** What a reply from here is signed with — the sender's own name, then the mailbox's block. */
  signaturePreview: string;
  /** The mailbox this conversation is on — a reply goes out from the one the customer wrote to. */
  mailbox: { id: number; label: string; emailAddress: string } | null;
  /** Where a reply goes — whoever wrote last. */
  replyTo: string;
  /** Everyone who wrote, was written to or was copied — whoever wrote most first. */
  people: EmailPerson[];
  /** address → the name they sign their own emails with. */
  names: Record<string, string>;
  /** Every file in the conversation, newest first. */
  files: EmailTrailFile[];
  contracts: EmailContract[];
  lead: { id: number; stage: string; unitNumber: string | null; buildingName: string | null } | null;
  /** Emails in the whole trail — `messages` holds a window of them, newest last. */
  totalMessages: number;
  /** How many are older than the first email in `messages`. */
  earlier: number;
  messages: EmailMessageRow[];
}

export interface EmailRecipient { kind: 'customer' | 'lead' | 'vendor'; tenantId: number | null; leadId: number | null; vendorId: number | null; name: string; email: string }

export interface StagedAttachment { key: string; fileName: string; mimeType: string; sizeBytes: number }

/** Append the manager's landlord to a path that may already carry a query. */
function scoped(path: string, rp: Rp): string {
  if (rp == null || rp === '') return path;
  return `${path}${path.includes('?') ? '&' : '?'}rp=${rp}`;
}

export const emailApi = {
  mailbox: (rp: Rp) => apiGet<MailboxInfo>(scoped('/email/mailbox', rp)),
  saveMailbox: (form: Partial<MailboxForm>) => apiPut<MailboxInfo>('/email/mailbox', form),
  removeMailbox: (id: number) => apiDelete<MailboxInfo>(`/email/mailbox?id=${id}`),

  threads: (rp: Rp, filter: { tenantId?: number | null; leadId?: number | null; vendorId?: number | null; q?: string; kind?: EmailKind | null; page?: number; pageSize?: number; unreadOnly?: boolean; hasFiles?: boolean; box?: 'inbox' | 'sent' | null; mailboxId?: number | null } = {}) => {
    const qs = new URLSearchParams();
    if (filter.tenantId) qs.set('tenantId', String(filter.tenantId));
    if (filter.leadId) qs.set('leadId', String(filter.leadId));
    if (filter.vendorId) qs.set('vendorId', String(filter.vendorId));
    if (filter.q) qs.set('q', filter.q);
    if (filter.kind) qs.set('kind', filter.kind);
    if (filter.page && filter.page > 1) qs.set('page', String(filter.page));
    if (filter.pageSize) qs.set('pageSize', String(filter.pageSize));
    if (filter.unreadOnly) qs.set('unread', '1');
    if (filter.hasFiles) qs.set('files', '1');
    if (filter.box) qs.set('box', filter.box);
    if (filter.mailboxId) qs.set('mailbox', String(filter.mailboxId));
    const s = qs.toString();
    return apiGet<EmailThreadPage>(scoped(`/email/threads${s ? `?${s}` : ''}`, rp));
  },
  /** The newest emails of a trail; with `before`, the ones just older than that email. */
  thread: (rp: Rp, id: number, window: { before?: number; limit?: number } = {}) =>
    apiGet<EmailThreadDetail>(scoped(`/email/threads/${id}${window.before ? `?before=${window.before}${window.limit ? `&limit=${window.limit}` : ''}` : window.limit ? `?limit=${window.limit}` : ''}`, rp)),
  markRead: (rp: Rp, id: number) => apiPost<{ ok: true }>(scoped(`/email/threads/${id}/read`, rp), {}),
  unread: (rp: Rp) => apiGet<{ unread: number }>(scoped('/email/unread-count', rp)),
  recipients: (rp: Rp, q: string) => apiGet<EmailRecipient[]>(scoped(`/email/recipients?q=${encodeURIComponent(q)}`, rp)),

  send: (rp: Rp, body: { tenantId?: number | null; leadId?: number | null; vendorId?: number | null; subject: string; body: string; cc?: string[]; mailboxId?: number | null; attachments?: StagedAttachment[] }) =>
    apiPost<{ threadId: number; messageId: number; status: 'sent' | 'not_sent' }>(scoped('/email/threads', rp), {
      ...(body.mailboxId ? { mailboxId: body.mailboxId } : {}),
      ...(body.tenantId ? { tenantId: body.tenantId } : {}),
      ...(body.leadId ? { leadId: body.leadId } : {}),
      ...(body.vendorId ? { vendorId: body.vendorId } : {}),
      subject: body.subject,
      body: body.body,
      ...(body.cc?.length ? { cc: body.cc } : {}),
      attachments: (body.attachments ?? []).map(({ key, fileName, mimeType }) => ({ key, fileName, mimeType })),
    }),
  reply: (rp: Rp, threadId: number, body: { body: string; cc?: string[]; attachments?: StagedAttachment[] }) =>
    apiPost<{ threadId: number; messageId: number; status: 'sent' | 'not_sent' }>(scoped(`/email/threads/${threadId}/reply`, rp), {
      body: body.body,
      ...(body.cc?.length ? { cc: body.cc } : {}),
      attachments: (body.attachments ?? []).map(({ key, fileName, mimeType }) => ({ key, fileName, mimeType })),
    }),

  /** Park a picked file until Send. Multipart through the proxy, like apiUpload, but landlord-scoped. */
  stage: async (rp: Rp, file: File): Promise<StagedAttachment> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api${scoped('/email/attachments', rp)}`, { method: 'POST', credentials: 'include', body: fd });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && (Array.isArray(json.message) ? json.message[0] : json.message)) || 'The file could not be attached');
    return json as StagedAttachment;
  },
  attachmentUrl: (rp: Rp, id: number) => apiGet<{ url: string; fileName: string }>(scoped(`/email/attachments/${id}/url`, rp)),
  /** One email as its writer laid it out — somebody else's HTML: clean it (emailLayout.ts) before showing it. */
  layout: (rp: Rp, messageId: number) => apiGet<{ html: string }>(scoped(`/email/messages/${messageId}/layout`, rp)),
  markUnread: (rp: Rp, id: number) => apiPost<{ ok: true }>(scoped(`/email/threads/${id}/unread`, rp), {}),
  /** Forward one email of the conversation, its files with it, to anyone. It stays on the trail. */
  forward: (rp: Rp, threadId: number, body: { messageId: number; to: string; cc?: string[]; body?: string; attachments?: StagedAttachment[] }) =>
    apiPost<{ threadId: number; messageId: number; status: 'sent' | 'not_sent' }>(scoped(`/email/threads/${threadId}/forward`, rp), {
      messageId: body.messageId,
      to: body.to,
      ...(body.cc?.length ? { cc: body.cc } : {}),
      ...(body.body?.trim() ? { body: body.body } : {}),
      attachments: (body.attachments ?? []).map(({ key, fileName, mimeType }) => ({ key, fileName, mimeType })),
    }),
  /** "File under…" — tie the conversation's address to a customer, lead or vendor (landlord only); `none` unties it. */
  link: (rp: Rp, threadId: number, to: { kind: 'customer' | 'lead' | 'vendor' | 'none'; id?: number }) =>
    apiPost<EmailThreadDetail>(scoped(`/email/threads/${threadId}/link`, rp), to),
  /** Move a conversation to Finance, Legal or Promotions, or (null) back to its record's tab. Landlord only. */
  setCategory: (rp: Rp, threadId: number, category: EmailCategory | null) =>
    apiPost<EmailThreadDetail>(scoped(`/email/threads/${threadId}/category`, rp), { category }),
  sync: (rp: Rp) => apiPost<{ ran: boolean; imported: number; checked: number; remaining: number; onServer?: number; notIn?: number; error?: string }>(scoped('/email/sync', rp), {}),
};

export function errorText(err: unknown, fallback: string): string {
  const m = (err as { message?: string | string[] })?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  return m || fallback;
}

/** "10:42" today, "Tue 10:42" this week, "12 Sep" this year, "12 Sep 2025" before. */
export function emailWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  if (now.getTime() - d.getTime() < 6 * 86400_000) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
