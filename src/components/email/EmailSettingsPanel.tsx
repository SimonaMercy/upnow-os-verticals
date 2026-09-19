'use client';

/**
 * Settings → Email. The landlord connects the mailboxes they already use —
 * properties@, accounts@, their own — and sees all of them in one inbox; the team
 * writes from inside UpNow with those addresses and the replies come back into
 * the same conversation.
 *
 * One card. Each connected mailbox: its name, address and health, Change /
 * Disconnect; then "Add another mailbox". Adding or changing: the form. "Test & save" tries both servers with what
 * was typed before anything is stored — a saved mailbox is one that worked.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, Mail, Plus } from 'lucide-react';
import { emailApi, errorText, type MailboxInfo, type MailboxOne } from '@/lib/emailApi';

const INPUT = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]';
const LABEL = 'block text-xs font-medium text-[#6b6860] mb-1.5';

/** Most mail hosts follow one of two shapes; pre-fill it so the landlord only checks. */
function guessServers(email: string): { smtp: string; pop: string } | null {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain || !domain.includes('.')) return null;
  if (domain === 'gmail.com' || domain === 'googlemail.com') return { smtp: 'smtp.gmail.com', pop: 'imap.gmail.com' };
  if (domain.startsWith('zoho')) return { smtp: 'smtp.zoho.com', pop: 'imap.zoho.com' };
  return { smtp: `mail.${domain}`, pop: `mail.${domain}` };
}

export function EmailSettingsPanel() {
  const [info, setInfo] = useState<MailboxInfo | null>(null);
  /** The mailbox being changed, 'new' for one being added, null when only the list shows. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [label, setLabel] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [incomingProtocol, setIncomingProtocol] = useState<'imap' | 'pop3'>('imap');
  const [incomingHost, setIncomingHost] = useState('');
  const [incomingPort, setIncomingPort] = useState('993');
  const [signature, setSignature] = useState('');

  const fill = (m: Partial<MailboxOne> | null) => {
    setLabel(m?.label ?? '');
    setEmailAddress(m?.emailAddress ?? '');
    setDisplayName(m?.displayName ?? '');
    setSmtpHost(m?.smtpHost ?? '');
    setSmtpPort(String(m?.smtpPort ?? 465));
    setIncomingProtocol(m?.incomingProtocol ?? 'imap');
    setIncomingHost(m?.incomingHost ?? '');
    setIncomingPort(String(m?.incomingPort ?? 993));
    setSignature(m?.signature ?? '');
    setPassword('');
  };
  const startAdd = (from: MailboxInfo) => {
    // Another mailbox of the same company nearly always sits on the same servers.
    const like = from.mailboxes[0];
    fill(like ? { smtpHost: like.smtpHost, smtpPort: like.smtpPort, incomingProtocol: like.incomingProtocol, incomingHost: like.incomingHost, incomingPort: like.incomingPort } : null);
    setEditing('new'); setSaved(false); setError(null);
  };
  const startChange = (m: MailboxOne) => { fill(m); setEditing(m.id); setSaved(false); setError(null); };

  useEffect(() => {
    emailApi.mailbox(null).then((m) => { setInfo(m); if (!m.connected) setEditing('new'); }).catch((e) => setError(errorText(e, 'Could not load the email settings')));
  }, []);

  const onEmailBlur = () => {
    const g = guessServers(emailAddress);
    if (!g) return;
    if (!smtpHost) setSmtpHost(g.smtp);
    if (!incomingHost) setIncomingHost(g.pop);
  };

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const m = await emailApi.saveMailbox({
        ...(typeof editing === 'number' ? { id: editing } : {}),
        label: label.trim(),
        emailAddress: emailAddress.trim(),
        displayName: displayName.trim(),
        ...(password ? { password } : {}),
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort),
        incomingProtocol,
        incomingHost: incomingHost.trim(),
        incomingPort: Number(incomingPort),
        signature,
      });
      setInfo(m); fill(null); setEditing(null); setSaved(true);
    } catch (e) {
      setError(errorText(e, 'The mailbox could not be connected'));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (m: MailboxOne) => {
    if (!window.confirm(`Disconnect ${m.emailAddress}? Its conversations stay in UpNow; nothing new is sent or received on it until it is connected again.`)) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const next = await emailApi.removeMailbox(m.id);
      setInfo(next); setEditing(next.connected ? null : 'new'); if (!next.connected) fill(null);
    } catch (e) { setError(errorText(e, 'Could not disconnect')); } finally { setBusy(false); }
  };

  if (!info) {
    return <div className="bg-white rounded-2xl p-6 shadow-sm text-sm text-[#9b9890]">{error ?? 'Loading…'}</div>;
  }

  const showForm = editing !== null;
  const changing = typeof editing === 'number';
  const canSave = !!emailAddress.trim() && !!smtpHost.trim() && !!incomingHost.trim() && (changing || !!password);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <h2 className="font-semibold text-base text-[#1a1916] mb-1">Your email</h2>
      <p className="text-xs text-[#9b9890] mb-5">
        Connect the mailboxes you already use — properties@, accounts@, your own. You see all of them in one inbox,
        and you and your team write from inside UpNow with those addresses; replies appear in the same
        conversation and go out from the mailbox the customer wrote to. Your mailboxes keep working as they do
        today — nothing is ever deleted from them. Every email in them is brought into UpNow: the
        ones with a customer, lead or vendor appear on their page, and the rest are kept under “Other”, which
        only you can see.
      </p>

      {!info.enabled && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Email is not switched on for this environment yet.
        </div>
      )}

      {info.mailboxes.length > 0 && (
        <div className="divide-y divide-[#f0eee9] border border-[#e8e6e0] rounded-xl mb-4">
          {info.mailboxes.map((m) => (
            <div key={m.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${editing === m.id ? 'bg-[#fbfaf8]' : ''}`}>
              <div className="w-10 h-10 rounded-xl grid place-items-center bg-[#eef9f4] text-[#1a7a5a]"><Mail size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#1a1916] truncate">{m.label} <span className="font-normal text-[#6b6860]">· {m.emailAddress}</span></div>
                {m.status === 'error' ? (
                  <div className="text-xs text-[#b42318] flex items-center gap-1 mt-0.5"><AlertTriangle size={12} /> {m.lastError ?? 'The mailbox could not be reached.'}</div>
                ) : (
                  <div className="text-xs text-[#1a7a5a] flex items-center gap-1 mt-0.5">
                    <CheckCircle2 size={12} /> Connected ({m.inboxOnly ? 'POP — replies only' : 'IMAP — full trail'}){m.lastSyncedAt ? ` · checked ${new Date(m.lastSyncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </div>
                )}
                {m.signaturePreview && <div className="text-[11px] text-[#9b9890] mt-0.5 truncate" title={m.signaturePreview}>Your emails are signed: {m.signaturePreview.replace(/\n+/g, ' · ')}</div>}
                {m.inboxOnly && <div className="text-[11px] text-amber-800 mt-0.5">POP reads only the inbox — emails sent from your own mail app are missing. Change it to IMAP to bring them in.</div>}
              </div>
              <button type="button" onClick={() => startChange(m)} disabled={busy} className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#e8e6e0] text-[#4a4842] hover:border-[#2e9f82] hover:text-[#2e9f82] cursor-pointer disabled:opacity-60">Change</button>
              <button type="button" onClick={() => void disconnect(m)} disabled={busy} className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#e8e6e0] text-[#b42318] hover:border-[#b42318] cursor-pointer disabled:opacity-60">Disconnect</button>
            </div>
          ))}
        </div>
      )}
      {info.connected && !showForm && (
        <button type="button" onClick={() => startAdd(info)} disabled={!info.enabled} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border border-[#e8e6e0] text-[#1a1916] hover:border-[#2e9f82] hover:text-[#1a7a5a] cursor-pointer disabled:opacity-60">
          <Plus size={14} /> Add another mailbox
        </button>
      )}

      {showForm && (
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          <div className="sm:col-span-2 text-sm font-semibold text-[#1a1916]">{changing ? `Change ${emailAddress}` : info.connected ? 'Add another mailbox' : 'Connect your first mailbox'}</div>
          <div className="sm:col-span-2">
            <label className={LABEL}>What you call this mailbox <span className="text-[#9b9890] font-normal">(shown in the inbox — “Properties”, “Accounts”)</span></label>
            <input className={`${INPUT} max-w-md`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Properties" />
          </div>
          <div>
            <label className={LABEL}>Email address</label>
            <input type="email" className={INPUT} value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} onBlur={onEmailBlur} placeholder="leasing@yourcompany.ae" autoComplete="off" />
          </div>
          <div>
            <label className={LABEL}>Name customers see</label>
            <input className={INPUT} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your Company Leasing" />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Password {changing && <span className="text-[#9b9890] font-normal">(leave empty to keep the current one)</span>}</label>
            <input type="password" className={INPUT} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={changing ? '••••••••' : 'The password of this mailbox'} />
            <p className="text-[11px] text-[#9b9890] mt-1">Stored encrypted. It is never shown again — not to you, your team or UpNow staff. Gmail needs an “app password”.</p>
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <div>
              <label className={LABEL}>Outgoing server (SMTP)</label>
              <input className={INPUT} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="mail.yourcompany.ae" />
            </div>
            <div>
              <label className={LABEL}>Port</label>
              <select className={INPUT} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)}>
                <option value="465">465</option><option value="587">587</option><option value="2525">2525</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <div>
              <label className={LABEL}>Incoming server</label>
              <input className={INPUT} value={incomingHost} onChange={(e) => setIncomingHost(e.target.value)} placeholder="mail.yourcompany.ae" />
            </div>
            <div>
              <label className={LABEL}>Port</label>
              <select className={INPUT} value={incomingPort} onChange={(e) => setIncomingPort(e.target.value)}>
                {(incomingProtocol === 'imap' ? ['993', '143'] : ['995', '110']).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Incoming type</label>
            <select className={`${INPUT} max-w-md`} value={incomingProtocol}
              onChange={(e) => { const v = e.target.value as 'imap' | 'pop3'; setIncomingProtocol(v); setIncomingPort(v === 'imap' ? '993' : '995'); }}>
              <option value="imap">IMAP — the full trail: your sent emails and the replies</option>
              <option value="pop3">POP — replies only (your own sent emails can’t be read)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Signature <span className="text-[#9b9890] font-normal">(the company part — added under every email)</span></label>
            <textarea className={`${INPUT} min-h-[84px]`} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={'Regards,\nYour Company Properties\n+971 …'} />
            <p className="text-[11px] text-[#9b9890] mt-1">
              Don’t type a person’s name here. Every email is signed with the name of whoever sends it — you, or the team member signed in —
              placed under the first line (“Regards,”) and above the rest. To put the name somewhere else, write <code className="text-[#6b6860]">{'{name}'}</code> where it should go.
            </p>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={busy || !canSave || !info.enabled}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] cursor-pointer disabled:opacity-60 inline-flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}{busy ? 'Testing both servers…' : 'Test & save'}
            </button>
            {info.connected && <button type="button" onClick={() => { fill(null); setEditing(null); setError(null); }} className="px-3 py-2 rounded-lg text-sm font-semibold text-[#6b6860] hover:text-[#1a1916] cursor-pointer">Cancel</button>}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-[#b42318]">{error}</p>}
      {saved && !error && <p className="mt-3 text-sm text-[#1a7a5a]">Connected. Both servers accepted the details.</p>}
    </div>
  );
}
