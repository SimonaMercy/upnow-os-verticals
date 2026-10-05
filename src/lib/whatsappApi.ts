/**
 * WhatsApp module — every conversation on the landlord's linked numbers, read
 * and answered from inside the platform.
 *
 * Same rule as the email module: one set of endpoints for both portals. The
 * landlord is resolved from their login; a manager names the landlord, so every
 * call takes the manager's `rp` (null for the landlord) and appends `?rp=`.
 */
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

export type Rp = number | string | null | undefined;

export type WaKind = 'customer' | 'lead' | 'vendor' | 'team' | 'group' | 'other';
export type WaTab = 'all' | WaKind;

export interface WaLine {
  id: number;
  label: string;
  phone: string | null;
  displayName: string | null;
  status: 'connected' | 'qr_pending' | 'disconnected' | string;
  lastError: string | null;
  lastEventAt: string | null;
  // landlord only
  bridgeUrl?: string;
  hasBridgeKey?: boolean;
}

/** `canSend`: the person signed in may write — the landlord always, a team member with "WhatsApp — send". */
export interface WaLines { canConfigure: boolean; canSend: boolean; lines: WaLine[] }

export interface WaChatRow {
  id: number;
  lineId: number;
  lineLabel: string | null;
  kind: WaKind;
  name: string;
  savedName: string | null;
  profileName: string | null;
  phone: string | null;
  isGroup: boolean;
  isBusiness: boolean;
  linkedManually: boolean;
  tenantId: number | null;
  leadId: number | null;
  vendorId: number | null;
  teamUserId: number | null;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string | null;
  lastDirection: 'in' | 'out' | null;
  lastType: string | null;
  lastSnippet: string | null;
}

export interface WaChatList {
  items: WaChatRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<WaTab, number>;
  unreadBy: Record<WaTab, number>;
}

export interface WaContract {
  id: number; status: string; startDate: string | null; endDate: string | null;
  unitId: number; unitNumber: string; buildingName: string;
}

export type WaContext =
  | { type: 'customer'; id: number; name: string; phone: string | null; email: string | null; entity_type?: string | null; contracts: WaContract[] }
  | { type: 'lead'; id: number; name: string; stage: string; source: string | null; phone: string | null; email: string | null; unitId: number | null; unitNumber: string | null; buildingName: string | null }
  | { type: 'vendor'; id: number; name: string; phone: string | null; email: string | null }
  | { type: 'team'; id: number; name: string; role: string; phone: string | null };

export interface WaChatDetail extends WaChatRow { lineStatus: string; /** May the person signed in answer here? */ canSend: boolean; context: WaContext | null;
  /** The number is one of the customer's other contacts (a spouse, a son, a second phone) — who it is. */
  contact?: { id: number; name: string | null; relationship: string | null } | null }

export interface WaReaction { emoji: string; count: number; mine: boolean }

export interface WaMedia { state: 'stored' | 'pending' | 'expired' | null; mime: string | null; name: string | null; size: number | null; stored: boolean }

export interface WaMessage {
  id: number;
  direction: 'in' | 'out';
  type: string;
  body: string;
  authorPhone: string | null;
  authorName: string | null;
  quotedId: number | null;
  quotedSnippet: string | null;
  isForwarded: boolean;
  isRevoked: boolean;
  editedAt: string | null;
  /** -1 failed · 0 waiting · 1 sent · 2 delivered · 3 read · 4 played */
  ack: number | null;
  reactions: WaReaction[] | null;
  location: { lat: number; lng: number; name?: string | null; address?: string | null } | null;
  vcards: string[] | null;
  transcript: string | null;
  durationSeconds: number | null;
  media: WaMedia | null;
  sentByName: string | null;
  sentByRole: string | null;
  status: 'received' | 'sending' | 'sent' | 'not_sent';
  error: string | null;
  sentAt: string;
}

export interface WaPerson { kind: 'customer' | 'lead' | 'vendor'; id: number; name: string; phone: string | null; detail: string | null }

export interface WaSendResult { messageId: number; status: 'sent' | 'not_sent'; error: string | null }

/** Append the manager's landlord to a path that may already carry a query. */
function scoped(path: string, rp: Rp): string {
  if (rp == null || rp === '') return path;
  return `${path}${path.includes('?') ? '&' : '?'}rp=${rp}`;
}

async function postForm<T>(path: string, fd: FormData, fallback: string): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: fd });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && (Array.isArray(json.message) ? json.message[0] : json.message)) || fallback);
  return json as T;
}

export const whatsappApi = {
  lines: (rp: Rp, check = false) => apiGet<WaLines>(scoped(`/whatsapp/lines${check ? '?check=1' : ''}`, rp)),
  saveLine: (body: { id?: number; label: string; bridgeUrl: string; bridgeKey?: string; rotateIngestKey?: boolean }) =>
    apiPut<{ line: WaLine; ingestKey: string | null }>('/whatsapp/lines', body),
  removeLine: (id: number) => apiDelete<{ ok: true }>(`/whatsapp/lines/${id}`),

  chats: (rp: Rp, f: { kind?: WaTab; q?: string; lineId?: number | null; unread?: boolean; page?: number; tenantId?: number; leadId?: number; vendorId?: number } = {}) => {
    const qs = new URLSearchParams();
    if (f.kind && f.kind !== 'all') qs.set('kind', f.kind);
    if (f.q) qs.set('q', f.q);
    if (f.lineId) qs.set('lineId', String(f.lineId));
    if (f.unread) qs.set('unread', '1');
    if (f.page) qs.set('page', String(f.page));
    if (f.tenantId) qs.set('tenantId', String(f.tenantId));
    if (f.leadId) qs.set('leadId', String(f.leadId));
    if (f.vendorId) qs.set('vendorId', String(f.vendorId));
    const s = qs.toString();
    return apiGet<WaChatList>(scoped(`/whatsapp/chats${s ? `?${s}` : ''}`, rp));
  },
  chat: (rp: Rp, id: number) => apiGet<WaChatDetail>(scoped(`/whatsapp/chats/${id}`, rp)),
  messages: (rp: Rp, id: number, before?: number) =>
    apiGet<{ hasMore: boolean; items: WaMessage[] }>(scoped(`/whatsapp/chats/${id}/messages${before ? `?before=${before}` : ''}`, rp)),
  markRead: (rp: Rp, id: number) => apiPost<{ ok: true }>(scoped(`/whatsapp/chats/${id}/read`, rp), {}),
  unread: (rp: Rp) => apiGet<{ unread: number }>(scoped('/whatsapp/unread-count', rp)),
  people: (rp: Rp, q: string) => apiGet<WaPerson[]>(scoped(`/whatsapp/people?q=${encodeURIComponent(q)}`, rp)),
  link: (rp: Rp, chatId: number, body: { kind: 'customer' | 'lead' | 'vendor' | 'none'; id?: number }) =>
    apiPost<WaChatDetail>(scoped(`/whatsapp/chats/${chatId}/link`, rp), body),
  rematch: (rp: Rp) => apiPost<{ checked: number; changed: number }>(scoped('/whatsapp/rematch', rp), {}),

  sendText: (rp: Rp, chatId: number, body: string, quotedMessageId?: number | null) =>
    apiPost<WaSendResult>(scoped(`/whatsapp/chats/${chatId}/send`, rp), { body, ...(quotedMessageId ? { quotedMessageId } : {}) }),
  sendMedia: (rp: Rp, chatId: number, file: File | Blob, o: { fileName?: string; caption?: string; asVoice?: boolean; asDocument?: boolean; quotedMessageId?: number | null; durationSeconds?: number } = {}) => {
    const fd = new FormData();
    fd.append('file', file, o.fileName ?? (file instanceof File ? file.name : 'file'));
    if (o.caption) fd.append('caption', o.caption);
    if (o.asVoice) fd.append('asVoice', '1');
    if (o.asDocument) fd.append('asDocument', '1');
    if (o.quotedMessageId) fd.append('quotedMessageId', String(o.quotedMessageId));
    if (o.durationSeconds) fd.append('durationSeconds', String(Math.round(o.durationSeconds)));
    return postForm<WaSendResult>(scoped(`/whatsapp/chats/${chatId}/send-media`, rp), fd, 'The file could not be sent');
  },
  start: (rp: Rp, body: { lineId: number; tenantId?: number; leadId?: number; vendorId?: number; phone?: string; body: string }) =>
    apiPost<WaSendResult & { chatId: number }>(scoped('/whatsapp/chats', rp), body),

  mediaUrl: (rp: Rp, messageId: number, download = false) =>
    apiGet<{ url: string; fileName: string | null; mime: string | null }>(scoped(`/whatsapp/messages/${messageId}/media-url${download ? '?download=1' : ''}`, rp)),
};

export function errorText(err: unknown, fallback: string): string {
  const m = (err as { message?: string | string[] })?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  return m || fallback;
}

/** "10:42" today, "Yesterday", "Tue" this week, "12 Sep" this year, "12 Sep 2025" before — the way WhatsApp's own list reads. */
export function waListWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function waTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Day separator inside a conversation. */
export function waDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function clock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** +971 58 577 8500 — readable, never reformatted into something it is not. */
export function prettyPhone(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('971') && d.length === 12) return `+971 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

export const KIND_LABEL: Record<WaKind, string> = { customer: 'Customer', lead: 'Lead', vendor: 'Vendor', team: 'Team', group: 'Group', other: 'Other' };
/** Chip colours per kind — text / background, from the platform palette. */
export const KIND_CHIP: Record<WaKind, string> = {
  customer: 'text-[#1a7a5a] bg-[#eef9f4]',
  lead: 'text-[#1d4f8a] bg-[#eaf2fd]',
  vendor: 'text-[#8a6d1d] bg-[#fdf3e3]',
  team: 'text-[#5b3d8a] bg-[#f3edfb]',
  group: 'text-[#4a4842] bg-[#f4f3ef]',
  other: 'text-[#6b6860] bg-[#f4f3ef]',
};

/**
 * Is WhatsApp switched on for this environment? It needs a bridge the backend can
 * reach; where there is none the portal shows no trace of it — no menu entry, no
 * tab, no section, no team authority — rather than a page that can never fill.
 * Asked once per page load; "no" until the answer is in, so nothing flashes.
 */
let waEnabled: Promise<boolean> | null = null;
export function whatsappEnabled(): Promise<boolean> {
  if (!waEnabled) waEnabled = apiGet<{ enabled: boolean }>('/whatsapp/status').then((r) => r?.enabled === true).catch(() => false);
  return waEnabled;
}

