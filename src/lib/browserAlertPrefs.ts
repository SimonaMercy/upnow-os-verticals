'use client';

/**
 * Browser alerts — the switches and the browser's permission.
 *
 * Owner, 12 Oct 2026: a landlord or team member working in another tab should
 * be told, by the browser, the moment a WhatsApp message or an email arrives.
 *
 * The switches live in THIS browser (localStorage), not on the server: the
 * permission to show notifications is granted per browser, so the choice
 * belongs there too — switching alerts on at the office desk must not make the
 * phone's browser start asking. Nothing here reaches the backend.
 */

export type BrowserAlertPrefs = { whatsapp: boolean; email: boolean };
export type AlertPermission = NotificationPermission | 'unsupported';

const PREFS_KEY = 'upnow:browser-alerts';
/** Fired on `window` whenever the switches change, so the poller picks the change up without a reload. */
export const BROWSER_ALERTS_CHANGED = 'upnow:browser-alerts-changed';

const OFF: BrowserAlertPrefs = { whatsapp: false, email: false };

export function browserAlertsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && typeof window.Notification === 'function';
}

export function readBrowserAlertPrefs(): BrowserAlertPrefs {
  if (typeof window === 'undefined') return OFF;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return OFF;
    const p = JSON.parse(raw) as Partial<BrowserAlertPrefs>;
    return { whatsapp: p.whatsapp === true, email: p.email === true };
  } catch { return OFF; }
}

export function writeBrowserAlertPrefs(next: BrowserAlertPrefs): void {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private window — the switch simply does not stick */ }
  window.dispatchEvent(new CustomEvent(BROWSER_ALERTS_CHANGED));
}

export function alertPermission(): AlertPermission {
  return browserAlertsSupported() ? Notification.permission : 'unsupported';
}

/** Ask the browser once; resolves to the answer. Safari still uses the callback form, hence the wrapper. */
export function askAlertPermission(): Promise<AlertPermission> {
  if (!browserAlertsSupported()) return Promise.resolve('unsupported');
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return new Promise((resolve) => {
    try {
      const r = Notification.requestPermission((p) => resolve(p));
      if (r && typeof (r as Promise<NotificationPermission>).then === 'function') (r as Promise<NotificationPermission>).then(resolve, () => resolve('denied'));
    } catch { resolve('denied'); }
  });
}

/** True when alerts for this channel are switched on here AND the browser lets us show them. */
export function alertsOnFor(channel: keyof BrowserAlertPrefs): boolean {
  return alertPermission() === 'granted' && readBrowserAlertPrefs()[channel];
}

/** Shows one system notification; `tag` makes a second tab showing the same thing replace it instead of doubling it. */
export function showBrowserAlert(title: string, body: string, tag: string, onClick?: () => void): void {
  if (alertPermission() !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/apple-icon.png' });
    n.onclick = () => { try { window.focus(); } catch { /* ignore */ } onClick?.(); n.close(); };
  } catch { /* some browsers only allow notifications from a service worker — nothing to show then */ }
}
