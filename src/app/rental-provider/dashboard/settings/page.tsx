'use client';

import { useState } from 'react';
import { Settings, Save, Send, X, Loader2, Plus } from 'lucide-react';

type NotifKey = 'newInquiry' | 'chequeReminder' | 'renewalAlert' | 'maintenanceUpdate' | 'promotional';

const NOTIF_LABELS: Record<NotifKey, { title: string; description: string }> = {
  newInquiry: { title: 'New Inquiries', description: 'Notify when a new lead or inquiry is received' },
  chequeReminder: { title: 'Cheque Reminders', description: 'Remind 3 days before a cheque payment is due' },
  renewalAlert: { title: 'Renewal Alerts', description: 'Alert when a lease is within 90 days of expiry' },
  maintenanceUpdate: { title: 'Maintenance Updates', description: 'Notify on maintenance request status changes' },
  promotional: { title: 'Platform News', description: 'Product updates and feature announcements from UpNow' },
};

const NOTIF_KEYS: NotifKey[] = ['newInquiry', 'chequeReminder', 'renewalAlert', 'maintenanceUpdate', 'promotional'];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex w-10 h-5.5 rounded-full transition-colors cursor-pointer ${value ? 'bg-[#2e9f82]' : 'bg-[#c9c7c1]'}`}
      style={{ height: 22, width: 40 }}
    >
      <span
        className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-[3px] ${value ? 'translate-x-[19px]' : 'translate-x-[3px]'}`}
      />
    </button>
  );
}

function SaveButton({ saving }: { saving: boolean }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer disabled:opacity-50 ml-auto"
      style={{ background: '#2e9f82' }}
    >
      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  );
}

export default function SettingsPage() {
  // Business details
  const [bizName, setBizName] = useState('');
  const [tradeLicense, setTradeLicense] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const [bizAddress, setBizAddress] = useState('');
  const [savingBiz, setSavingBiz] = useState(false);

  // Payout details
  const [bankName, setBankName] = useState('');
  const [iban, setIban] = useState('');
  const [accountName, setAccountName] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);

  // Notifications
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({
    newInquiry: true,
    chequeReminder: true,
    renewalAlert: true,
    maintenanceUpdate: false,
    promotional: false,
  });

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [invName, setInvName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState('asset_manager');
  const [invNote, setInvNote] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  const handleSaveBiz = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBiz(true);
    await new Promise(r => setTimeout(r, 600));
    setSavingBiz(false);
  };

  const handleSavePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPayout(true);
    await new Promise(r => setTimeout(r, 600));
    setSavingPayout(false);
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invName.trim() || !invEmail.trim()) return;
    setSendingInvite(true);
    await new Promise(r => setTimeout(r, 600));
    setSendingInvite(false);
    setShowInvite(false);
    setInvName(''); setInvEmail(''); setInvNote('');
  };

  return (
    <div className="p-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Settings</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Manage your business details, payout info, and preferences.</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Business Details */}
        <form onSubmit={handleSaveBiz} className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-base text-[#1a1916] mb-4 flex items-center gap-2">
            <Settings size={16} className="text-[#2e9f82]" /> Business Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[#6b6860] block mb-1">Business Name</label>
              <input value={bizName} onChange={e => setBizName(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Your company name" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#6b6860] block mb-1">Trade License No.</label>
              <input value={tradeLicense} onChange={e => setTradeLicense(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="DED-XXXXXXXX" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#6b6860] block mb-1">Phone</label>
              <input value={bizPhone} onChange={e => setBizPhone(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="+971 50 000 0000" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#6b6860] block mb-1">Address</label>
              <input value={bizAddress} onChange={e => setBizAddress(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="City, Emirate, UAE" />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <SaveButton saving={savingBiz} />
          </div>
        </form>

        {/* Payout Details */}
        <form onSubmit={handleSavePayout} className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-base text-[#1a1916] mb-4">Payout Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[#6b6860] block mb-1">Bank Name</label>
              <input value={bankName} onChange={e => setBankName(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Emirates NBD" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#6b6860] block mb-1">Account Name</label>
              <input value={accountName} onChange={e => setAccountName(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Exact name on account" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-[#6b6860] block mb-1">IBAN</label>
              <input value={iban} onChange={e => setIban(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#2e9f82]" placeholder="AE00 0000 0000 0000 0000 000" />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <SaveButton saving={savingPayout} />
          </div>
        </form>

        {/* Notification Preferences */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-base text-[#1a1916] mb-4">Notification Preferences</h2>
          <div className="space-y-4">
            {NOTIF_KEYS.map(key => (
              <div key={key} className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-[#1a1916]">{NOTIF_LABELS[key].title}</p>
                  <p className="text-xs text-[#9b9890]">{NOTIF_LABELS[key].description}</p>
                </div>
                <Toggle value={notifs[key]} onChange={v => setNotifs(prev => ({ ...prev, [key]: v }))} />
              </div>
            ))}
          </div>
        </div>

        {/* Team Management */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base text-[#1a1916]">Team Management</h2>
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer"
              style={{ background: '#2e9f82' }}
            >
              <Plus size={13} /> Invite User
            </button>
          </div>
          <p className="text-sm text-[#6b6860]">
            Manage your managers and team members from the{' '}
            <a href="/dashboard/rental-provider/team" className="text-[#2e9f82] underline">Team page</a>.
          </p>
        </div>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvite(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-lg text-[#1a1916]">Invite Team Member</h3>
              <button onClick={() => setShowInvite(false)} className="cursor-pointer text-[#6b6860]"><X size={20} /></button>
            </div>
            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Full Name</label>
                <input value={invName} onChange={e => setInvName(e.target.value)} required className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm" placeholder="Jane Smith" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Email</label>
                <input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} required className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm" placeholder="jane@company.ae" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Role</label>
                <select value={invRole} onChange={e => setInvRole(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="asset_manager">Asset Manager</option>
                  <option value="viewing_agent">Viewing Agent</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Note (optional)</label>
                <textarea value={invNote} onChange={e => setInvNote(e.target.value)} rows={2} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm resize-none" placeholder="Responsible for Marina cluster" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowInvite(false)} className="flex-1 border border-[#e8e6e0] text-[#3d3b35] rounded-lg py-2.5 text-sm font-medium cursor-pointer hover:bg-[#f4f3ef]">Cancel</button>
                <button type="submit" disabled={sendingInvite} className="flex-1 flex items-center justify-center gap-2 text-sm text-white rounded-lg py-2.5 font-medium cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
                  {sendingInvite ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {sendingInvite ? 'Sending…' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
