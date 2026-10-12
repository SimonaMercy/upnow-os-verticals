'use client';

/**
 * Settings → Notifications → "Browser alerts": the two switches (WhatsApp, Emails)
 * and the browser's answer. Shared by the landlord's Settings and the manager's.
 *
 * Switching one on asks the browser for permission the first time — never on
 * login. The switches are kept in this browser only (see browserAlertPrefs.ts).
 */
import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import {
  type AlertPermission, type BrowserAlertPrefs,
  alertPermission, askAlertPermission, readBrowserAlertPrefs, showBrowserAlert, writeBrowserAlertPrefs,
} from '@/lib/browserAlertPrefs';

function Switch({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative inline-flex rounded-full transition-colors flex-shrink-0 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${value ? 'bg-[#2e9f82]' : 'bg-[#c9c7c1]'}`}
      style={{ height: 22, width: 40 }}
      aria-pressed={value}
    >
      <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-[3px] ${value ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

export function BrowserAlertsCard({ showWhatsapp = true, forManager = false }: { showWhatsapp?: boolean; forManager?: boolean }) {
  const [prefs, setPrefs] = useState<BrowserAlertPrefs>({ whatsapp: false, email: false });
  const [perm, setPerm] = useState<AlertPermission>('unsupported');
  const [note, setNote] = useState<string | null>(null);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    // After mount (the server knows neither this browser's switches nor its permission).
    const t = window.setTimeout(() => { setPrefs(readBrowserAlertPrefs()); setPerm(alertPermission()); }, 0);
    // Coming back to the tab after changing the site setting in the browser: show the new answer.
    const refresh = () => setPerm(alertPermission());
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(t); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  const flip = async (channel: keyof BrowserAlertPrefs, v: boolean) => {
    setNote(null);
    if (v) {
      const answer = await askAlertPermission();
      setPerm(answer);
      if (answer !== 'granted') {
        setNote(answer === 'denied'
          ? 'Your browser is blocking notifications for this site. Allow them in the browser’s site settings (the icon left of the address), then switch this on again.'
          : 'The browser did not allow notifications.');
        return;
      }
    }
    const next = { ...prefs, [channel]: v };
    setPrefs(next);
    writeBrowserAlertPrefs(next);
  };

  const test = () => {
    showBrowserAlert('UpNow · Browser alerts are on', 'You will be told here when a WhatsApp message or an email arrives.', 'upnow:test');
    setTested(true);
    window.setTimeout(() => setTested(false), 3000);
  };

  const anyOn = (showWhatsapp && prefs.whatsapp) || prefs.email;
  const blocked = perm === 'denied';
  const unsupported = perm === 'unsupported';

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="font-semibold text-base text-[#1a1916] flex items-center gap-2"><BellRing size={16} className="text-[#2e9f82]" /> Browser alerts</h2>
        {perm === 'granted' && anyOn && (
          <button type="button" onClick={test} className="text-xs font-semibold text-[#1a7a5a] hover:underline cursor-pointer">{tested ? 'Sent' : 'Send a test alert'}</button>
        )}
      </div>
      <p className="text-xs text-[#9b9890] mb-4">
        A notification from your browser the moment a message arrives — even while you are in another tab or another app, for as long as a portal tab is open.
        {forManager ? ' Only for the landlords who let you read that channel.' : ''} Alerts are per browser: switch them on where you work.
      </p>
      {unsupported && <p className="text-xs text-[#9a3412] bg-[#fff4ec] rounded-lg px-3 py-2 mb-3">This browser cannot show notifications. On iPhone, add the portal to the Home Screen first.</p>}
      {blocked && <p className="text-xs text-[#9a3412] bg-[#fff4ec] rounded-lg px-3 py-2 mb-3">Notifications are blocked for this site in your browser. Allow them in the browser&apos;s site settings (the icon left of the address), then switch on below.</p>}
      {note && !blocked && <p className="text-xs text-red-600 mb-3">{note}</p>}
      <div className="space-y-4">
        {showWhatsapp && (
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium text-[#1a1916]">WhatsApp messages</p>
              <p className="text-xs text-[#9b9890]">Who wrote and the first line. Clicking the alert opens the chat.</p>
            </div>
            <Switch value={prefs.whatsapp} onChange={(v) => void flip('whatsapp', v)} disabled={unsupported} />
          </div>
        )}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-[#1a1916]">Emails</p>
            <p className="text-xs text-[#9b9890]">Sender and subject, as the mailbox is read (every few minutes). Clicking the alert opens the conversation.</p>
          </div>
          <Switch value={prefs.email} onChange={(v) => void flip('email', v)} disabled={unsupported} />
        </div>
      </div>
    </div>
  );
}
