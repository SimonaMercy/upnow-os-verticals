'use client';

import { useState } from 'react';
import { Search, Plus, X, Wrench, Send, Loader2 } from 'lucide-react';

type VendorStatus = 'active' | 'inactive' | 'expiring' | 'expired';
type ContractType = 'amc' | 'one_time' | 'retainer' | 'ad_hoc';
type ServiceType = 'ac' | 'elevator' | 'plumbing' | 'electrical' | 'cleaning' | 'security' | 'landscaping' | 'pest_control' | 'other';

const SERVICE_LABELS: Record<ServiceType, string> = {
  ac: 'AC / HVAC',
  elevator: 'Elevator',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  cleaning: 'Cleaning',
  security: 'Security',
  landscaping: 'Landscaping',
  pest_control: 'Pest Control',
  other: 'Other',
};

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  amc: 'AMC',
  one_time: 'One-Time',
  retainer: 'Retainer',
  ad_hoc: 'Ad-Hoc',
};

const STATUS_STYLE: Record<VendorStatus, string> = {
  active: 'bg-[#d8f2e8] text-[#1a7a5a]',
  inactive: 'bg-[#f4f3ef] text-[#6b6860]',
  expiring: 'bg-[#fef3c7] text-[#92400e]',
  expired: 'bg-[#fee2e2] text-[#b91c1c]',
};

type Vendor = {
  id: string;
  name: string;
  email: string;
  phone: string;
  serviceType: ServiceType;
  contractType: ContractType;
  assets: string[];
  contractStart: string;
  contractEnd: string;
  contractValue: number;
  status: VendorStatus;
  notes: string;
};

/* Placeholder — will be replaced by /api/vendors (Sprint 4) */
const DEMO_VENDORS: Vendor[] = [];

const SERVICE_TYPES = Object.keys(SERVICE_LABELS) as ServiceType[];

export default function AmcPage() {
  const [search, setSearch] = useState('');
  const [filterService, setFilterService] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  // Invite form
  const [invName, setInvName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invService, setInvService] = useState<ServiceType>('ac');
  const [invContractType, setInvContractType] = useState<ContractType>('amc');
  const [invNotes, setInvNotes] = useState('');
  const [sending, setSending] = useState(false);

  const filtered = DEMO_VENDORS.filter(v => {
    if (filterService !== 'all' && v.serviceType !== filterService) return false;
    if (filterStatus !== 'all' && v.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!v.name.toLowerCase().includes(q) && !v.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilters = filterService !== 'all' || filterStatus !== 'all' || search !== '';
  const clearFilters = () => { setFilterService('all'); setFilterStatus('all'); setSearch(''); };

  const selectedVendor = selectedId ? DEMO_VENDORS.find(v => v.id === selectedId) : null;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invName.trim() || !invEmail.trim()) return;
    setSending(true);
    await new Promise(r => setTimeout(r, 600));
    setSending(false);
    setShowInvite(false);
    setInvName(''); setInvEmail(''); setInvNotes('');
  };

  const expiringCount = DEMO_VENDORS.filter(v => v.status === 'expiring').length;
  const activeCount = DEMO_VENDORS.filter(v => v.status === 'active').length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">AMC & Vendors</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Manage maintenance contracts and service vendors.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
            <span className="font-semibold">Sprint 4</span> — Vendors API coming soon
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer"
            style={{ background: '#2e9f82' }}
          >
            <Plus size={15} /> Invite Vendor
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Vendors',    value: String(DEMO_VENDORS.length) },
          { label: 'Active Contracts', value: String(activeCount) },
          { label: 'Expiring Soon',    value: String(expiringCount) },
          { label: 'Total Value',      value: `AED ${DEMO_VENDORS.reduce((s, v) => s + v.contractValue, 0).toLocaleString('en-AE')}` },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className="font-bold text-2xl text-[#1a1916] mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 items-center mb-4 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input
            type="text"
            placeholder="Search vendors…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
          />
        </div>
        <select value={filterService} onChange={e => setFilterService(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          <option value="all">All Services</option>
          {SERVICE_TYPES.map(s => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="expiring">Expiring Soon</option>
          <option value="expired">Expired</option>
          <option value="inactive">Inactive</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        {DEMO_VENDORS.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <Wrench size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">No vendors yet</p>
            <p className="text-sm text-[#9b9890] mb-4">Invite a vendor to start managing maintenance contracts</p>
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer"
              style={{ background: '#2e9f82' }}
            >
              <Plus size={14} /> Invite Vendor
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[900px]">
              <thead>
                <tr className="bg-[#f4f3ef]">
                  {['Vendor', 'Service', 'Contract Type', 'Assets', 'Start', 'End', 'Value', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916]">
                    <td className="px-4 py-3.5">
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-[#9b9890]">{v.email}</div>
                    </td>
                    <td className="px-4 py-3.5">{SERVICE_LABELS[v.serviceType]}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center rounded-full text-xs font-medium px-2 py-0.5 bg-[#f4f3ef] text-[#6b6860]">
                        {CONTRACT_TYPE_LABELS[v.contractType]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{v.assets.join(', ')}</td>
                    <td className="px-4 py-3.5">{v.contractStart}</td>
                    <td className="px-4 py-3.5">{v.contractEnd}</td>
                    <td className="px-4 py-3.5 font-medium">AED {v.contractValue.toLocaleString('en-AE')}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[v.status]}`}>
                        {v.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <button onClick={() => setSelectedId(v.id)} className="text-sm text-[#2e9f82] font-medium cursor-pointer hover:underline">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite Vendor Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvite(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-lg text-[#1a1916]">Invite Vendor</h3>
              <button onClick={() => setShowInvite(false)} className="cursor-pointer text-[#6b6860]"><X size={20} /></button>
            </div>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Company / Contact Name</label>
                <input value={invName} onChange={e => setInvName(e.target.value)} required className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm" placeholder="Al Noor HVAC Services" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Email</label>
                <input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} required className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm" placeholder="vendor@company.ae" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#6b6860] block mb-1">Service Type</label>
                  <select value={invService} onChange={e => setInvService(e.target.value as ServiceType)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white">
                    {SERVICE_TYPES.map(s => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#6b6860] block mb-1">Contract Type</label>
                  <select value={invContractType} onChange={e => setInvContractType(e.target.value as ContractType)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white">
                    {(Object.keys(CONTRACT_TYPE_LABELS) as ContractType[]).map(t => <option key={t} value={t}>{CONTRACT_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Notes (optional)</label>
                <textarea value={invNotes} onChange={e => setInvNotes(e.target.value)} rows={3} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm resize-none" placeholder="Scope of work, assets covered…" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowInvite(false)} className="flex-1 border border-[#e8e6e0] text-[#3d3b35] rounded-lg py-2.5 text-sm font-medium cursor-pointer hover:bg-[#f4f3ef]">Cancel</button>
                <button type="submit" disabled={sending} className="flex-1 flex items-center justify-center gap-2 text-sm text-white rounded-lg py-2.5 font-medium cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {sending ? 'Sending…' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vendor Detail Drawer */}
      {selectedVendor && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedId(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0]">
              <h2 className="font-semibold text-lg text-[#1a1916]">{selectedVendor.name}</h2>
              <button onClick={() => setSelectedId(null)} className="cursor-pointer text-[#6b6860]"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Service',       value: SERVICE_LABELS[selectedVendor.serviceType] },
                  { label: 'Contract',      value: CONTRACT_TYPE_LABELS[selectedVendor.contractType] },
                  { label: 'Email',         value: selectedVendor.email },
                  { label: 'Phone',         value: selectedVendor.phone || '—' },
                  { label: 'Start Date',    value: selectedVendor.contractStart },
                  { label: 'End Date',      value: selectedVendor.contractEnd },
                  { label: 'Value',         value: `AED ${selectedVendor.contractValue.toLocaleString('en-AE')}` },
                  { label: 'Assets',        value: selectedVendor.assets.join(', ') || '—' },
                ].map(item => (
                  <div key={item.label} className="bg-[#f4f3ef] rounded-xl p-3">
                    <p className="text-xs text-[#9b9890] mb-1">{item.label}</p>
                    <p className="text-sm font-medium text-[#1a1916]">{item.value}</p>
                  </div>
                ))}
              </div>
              {selectedVendor.notes && (
                <div className="bg-[#f4f3ef] rounded-xl p-4">
                  <p className="text-xs text-[#9b9890] mb-2">Notes</p>
                  <p className="text-sm text-[#3d3b35]">{selectedVendor.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
