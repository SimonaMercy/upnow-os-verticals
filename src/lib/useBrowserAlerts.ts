'use client';

/**
 * Browser alerts for new WhatsApp messages and new emails — while a portal tab is open.
 *
 * Owner, 12 Oct 2026: landlord and manager. Mounted once in the dashboard shell.
 *
 * How it works, without any server push: the same lists the inboxes show are
 * asked for the unread conversations — WhatsApp every 20 seconds, email once a
 * minute and the moment the portal-wide mail sync brings something in. A
 * conversation whose latest inbound message is newer than the last one this
 * browser has seen becomes a system notification: who wrote, and the first line.
 * Clicking it opens that conversation.
 *
 * What it will not do:
 *  - alert on what is already on screen — the WhatsApp page (or the Emails page)
 *    being looked at right now shows the message itself;
 *  - flood on first use — the first look only remembers where things stand;
 *  - alert twice from two tabs — the notification tag is the conversation and
 *    the time of its latest message, so the second tab replaces the first.
 *
 * A manager is told only about the landlords who let them read that channel.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { whatsappApi, whatsappEnabled, type WaChatRow } from '@/lib/whatsappApi';
import { emailApi, type EmailThreadRow } from '@/lib/emailApi';
import { EMAILS_SYNCED_EVENT } from '@/lib/useEmailSyncOnLogin';
import { BROWSER_ALERTS_CHANGED, alertsOnFor, showBrowserAlert } from '@/lib/browserAlertPrefs';

const WHATSAPP_EVERY_MS = 20_000;
const EMAIL_EVERY_MS = 60_000;
/** More new conversations than this in one look → one summary instead of a pile. */
const MAX_SEPARATE = 4;
const SEEN_KEY = 'upnow:browser-alerts-seen';

type Channel = 'whatsapp' | 'email';
type MyRp = { rentalProviderId: number; permissions?: { canReadEmails?: boolean; canReadWhatsapp?: boolean } };
/** Latest message time this browser has already seen, per channel and landlord scope. */
type Seen = Record<string, string>;

function loadSeen(): Seen {
  try { return JSON.parse(window.localStorage.getItem(SEEN_KEY) || '{}') as Seen; } catch { return {}; }
}
function saveSeen(seen: Seen): void {
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* ignore */ }
}

async function scopesOf(role: string, channel: Channel): Promise<Array<number | null>> {
  if (role === 'rental_provider') return [null];
  if (role !== 'manager') return [];
  const rps = await apiGet<MyRp[]>('/manager/my-rps').catch(() => [] as MyRp[]);
  const flag = channel === 'whatsapp' ? 'canReadWhatsapp' : 'canReadEmails';
  return (Array.isArray(rps) ? rps : []).filter((r) => r.permissions?.[flag]).map((r) => r.rentalProviderId);
}

function firstLine(s: string | null | undefined, max = 110): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The page for that channel is open and being looked at: the message is already on screen. */
function lookingAt(channel: Channel): boolean {
  if (document.visibilityState !== 'visible') return false;
  const path = window.location.pathname;
  return channel === 'whatsapp' ? path.endsWith('/whatsapp') : path.endsWith('/communications');
}

export function useBrowserAlerts(role: string | null | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (role !== 'rental_provider' && role !== 'manager') return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    let alive = true;
    const busy: Record<Channel, boolean> = { whatsapp: false, email: false };
    const base = role === 'manager' ? '/dashboard/manager' : '/rental-provider/dashboard';
    const hrefFor = (channel: Channel, rp: number | null, id: number) => {
      const page = channel === 'whatsapp' ? 'whatsapp' : 'communications';
      const key = channel === 'whatsapp' ? 'chat' : 'thread';
      return `${base}/${page}?${rp == null ? '' : `rp=${rp}&`}${key}=${id}`;
    };

    /**
     * One look at one channel across every landlord in scope. Rows newer than the
     * remembered time, and written by the other side, become notifications; then the
     * remembered time moves to the newest row seen — new or not.
     */
    const look = async (channel: Channel) => {
      if (!alive || busy[channel] || !alertsOnFor(channel)) return;
      busy[channel] = true;
      try {
        if (channel === 'whatsapp' && !(await whatsappEnabled())) return;
        const scopes = await scopesOf(role, channel);
        const seen = loadSeen();
        for (const rp of scopes) {
          const key = `${channel}:${rp ?? 'me'}`;
          let rows: Array<{ id: number; at: string; title: string; body: string }> = [];
          if (channel === 'whatsapp') {
            const list = await whatsappApi.chats(rp, { unread: true }).catch(() => null);
            if (!list) continue;
            rows = list.items
              .filter((c: WaChatRow) => c.lastDirection === 'in' && c.lastMessageAt)
              .map((c) => ({ id: c.id, at: c.lastMessageAt as string, title: c.name || c.phone || 'WhatsApp', body: firstLine(c.lastSnippet) || (c.lastType ? `Sent a ${c.lastType}` : 'New message') }));
          } else {
            const page = await emailApi.threads(rp, { unreadOnly: true, box: 'inbox', pageSize: 50 }).catch(() => null);
            if (!page) continue;
            rows = page.items
              .filter((t: EmailThreadRow) => t.lastDirection === 'in' && t.lastMessageAt)
              .map((t) => ({ id: t.id, at: t.lastMessageAt, title: t.lastFrom || t.counterpartName || t.counterpartEmail, body: firstLine(t.subject) || '(no subject)' }));
          }
          const newest = rows.reduce((m, r) => (r.at > m ? r.at : m), seen[key] || '');
          const since = seen[key];
          if (since) {
            const fresh = rows.filter((r) => r.at > since).sort((a, b) => (a.at < b.at ? -1 : 1));
            if (fresh.length && !lookingAt(channel)) {
              const label = channel === 'whatsapp' ? 'WhatsApp' : 'Email';
              if (fresh.length <= MAX_SEPARATE) {
                for (const r of fresh) showBrowserAlert(`${label} · ${r.title}`, r.body, `${key}:${r.id}:${r.at}`, () => router.push(hrefFor(channel, rp, r.id)));
              } else {
                const names = Array.from(new Set(fresh.map((r) => r.title))).slice(0, 3).join(', ');
                showBrowserAlert(`${fresh.length} new ${label === 'Email' ? 'emails' : 'WhatsApp messages'}`, names, `${key}:${newest}`, () => router.push(`${base}/${channel === 'whatsapp' ? 'whatsapp' : 'communications'}${rp == null ? '' : `?rp=${rp}`}`));
              }
            }
          }
          // First look, or nothing new: just remember where things stand.
          if (newest && newest !== seen[key]) { seen[key] = newest; saveSeen(seen); }
          else if (!seen[key]) { seen[key] = new Date().toISOString(); saveSeen(seen); }
        }
      } catch { /* the next look will try again */ } finally { busy[channel] = false; }
    };

    const start = window.setTimeout(() => { void look('whatsapp'); void look('email'); }, 3000);
    const wa = window.setInterval(() => { void look('whatsapp'); }, WHATSAPP_EVERY_MS);
    const em = window.setInterval(() => { void look('email'); }, EMAIL_EVERY_MS);
    const onSynced = () => { void look('email'); };
    const onPrefs = () => { void look('whatsapp'); void look('email'); };
    window.addEventListener(EMAILS_SYNCED_EVENT, onSynced);
    window.addEventListener(BROWSER_ALERTS_CHANGED, onPrefs);
    return () => {
      alive = false;
      window.clearTimeout(start); window.clearInterval(wa); window.clearInterval(em);
      window.removeEventListener(EMAILS_SYNCED_EVENT, onSynced);
      window.removeEventListener(BROWSER_ALERTS_CHANGED, onPrefs);
    };
  }, [role, router]);
}
