'use client';

import { useState } from 'react';
import { Search, Plus, X, Wallet } from 'lucide-react';

type DepositStatus = 'held' | 'returned' | 'partial_deduction' | 'forfeited';

const DEPOSIT_STATUS_LABELS: Record<DepositStatus, string> = {
  held: 'Held',
  returned: 'Returned',
  partial_deduction: 'Partial Deduction',
  forfeited: 'Forfeited',
};

const DEPOSIT_STATUS_STYLE: Record<DepositStatus, string> = {
  held: 'bg-[#d8f2e8] text-[#1a7a5a]',
  returned: 'bg-[#dbeafe] text-[#1e40af]',
  partial_deduction: 'bg-[#fef3c7] text-[#92400e]',
  forfeited: 'bg-[#fee2e2] text-[#b91c1c]',
};

type Deposit = {
  id: string;
  depositRef: string;
  leaseRef: string;
  asset: string;
  unit: string;
  tenant: string;
  amount: number;
  recordedDate: string;
  status: DepositStatus;
  deductions: number;
  refundDate: string;
};

/* Placeholder — will be replaced by /api/deposits (Sprint 4/5) */
const DEMO_DEPOSITS: Deposit[] = [];

export default function DepositsPage() {
  const [search, setSearch] = useState('');
  const [filterAsset, setFilterAsset] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = DEMO_DEPOSITS.filter(d => {
    if (filterAsset !== 'all' && d.asset !== filterAsset) return false;
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (filterDateFrom && d.recordedDate < filterDateFrom) return false;
    if (filterDateTo && d.recordedDate > filterDateTo) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!d.depositRef.toLowerCase().includes(q) && !d.tenant.toLowerCase().includes(q) && !d.unit.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilters = filterAsset !== 'all' || filterStatus !== 'all' || filterDateFrom !== '' || filterDateTo !== '' || search !== '';
  const clearFilters = () => { setFilterAsset('all'); setFilterStatus('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearch(''); };

  const totalAmount = DEMO_DEPOSITS.reduce((s, d) => s + d.amount, 0);
  const heldCount = DEMO_DEPOSITS.filter(d => d.status === 'held').length;
  const uniqueTenants = new Set(DEMO_DEPOSITS.map(d => d.tenant)).size;

  const detailDeposit = detailId ? DEMO_DEPOSITS.find(d => d.id === detailId) : null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Security Deposits</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Track all security deposits across your rental agreements.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
            <span className="font-semibold">Sprint 4/5</span> — Deposits API coming soon
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer" style={{ background: '#2e9f82' }}>
            <Plus size={15} /> Add Deposit
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Deposits',  value: String(DEMO_DEPOSITS.length), sub: 'records' },
          { label: 'Total Amount',    value: `AED ${totalAmount.toLocaleString('en-AE')}`, sub: 'all deposits' },
          { label: 'Unique Tenants',  value: String(uniqueTenants), sub: 'customers' },
          { label: 'Currently Held',  value: String(heldCount), sub: 'active holds' },
          { label: 'Returned',        value: String(DEMO_DEPOSITS.filter(d => d.status === 'returned').length), sub: 'completed' },
          { label: 'With Deductions', value: String(DEMO_DEPOSITS.filter(d => d.status === 'partial_deduction').length), sub: 'partial returns' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className="font-bold text-xl text-[#1a1916] mt-1">{s.value}</div>
            <div className="text-xs text-[#9b9890] mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 items-center mb-4 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input
            type="text"
            placeholder="Search by ref, tenant or unit…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          <option value="all">All Statuses</option>
          {(Object.keys(DEPOSIT_STATUS_LABELS) as DepositStatus[]).map(s => (
            <option key={s} value={s}>{DEPOSIT_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#9b9890]">From</label>
          <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#9b9890]">To</label>
          <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm" />
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">{filtered.length} deposit{filtered.length !== 1 ? 's' : ''} found</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        {DEMO_DEPOSITS.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <Wallet size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">No deposits yet</p>
            <p className="text-xs text-[#9b9890]">Security deposits will appear here once rental agreements are active (Sprint 4/5)</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1000px]">
              <thead>
                <tr className="bg-[#f4f3ef]">
                  {['Deposit ID', 'Agreement', 'Asset', 'Unit', 'Customer', 'Amount', 'Recorded', 'Deductions', 'Refund Date', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id} className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916]">
                    <td className="px-4 py-3.5 font-medium">{d.depositRef}</td>
                    <td className="px-4 py-3.5 text-[#2e9f82] font-medium">{d.leaseRef}</td>
                    <td className="px-4 py-3.5">{d.asset}</td>
                    <td className="px-4 py-3.5">{d.unit}</td>
                    <td className="px-4 py-3.5">{d.tenant}</td>
                    <td className="px-4 py-3.5 font-medium">AED {d.amount.toLocaleString('en-AE')}</td>
                    <td className="px-4 py-3.5">{d.recordedDate}</td>
                    <td className="px-4 py-3.5">{d.deductions > 0 ? `AED ${d.deductions.toLocaleString('en-AE')}` : '—'}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{d.refundDate || '—'}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${DEPOSIT_STATUS_STYLE[d.status]}`}>
                        {DEPOSIT_STATUS_LABELS[d.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <button onClick={() => setDetailId(d.id)} className="text-sm text-[#2e9f82] font-medium cursor-pointer hover:underline">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detailDeposit && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetailId(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-lg bg-white h-full shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0]">
              <h2 className="font-semibold text-lg text-[#1a1916]">Deposit Detail</h2>
              <button onClick={() => setDetailId(null)} className="cursor-pointer text-[#6b6860]"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-[#9b9890] font-mono">{detailDeposit.depositRef}</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Asset',        value: detailDeposit.asset },
                  { label: 'Unit',         value: detailDeposit.unit },
                  { label: 'Customer',     value: detailDeposit.tenant },
                  { label: 'Amount',       value: `AED ${detailDeposit.amount.toLocaleString('en-AE')}` },
                  { label: 'Recorded',     value: detailDeposit.recordedDate },
                  { label: 'Deductions',   value: detailDeposit.deductions > 0 ? `AED ${detailDeposit.deductions.toLocaleString('en-AE')}` : '—' },
                  { label: 'Refund Date',  value: detailDeposit.refundDate || '—' },
                  { label: 'Agreement',    value: detailDeposit.leaseRef },
                ].map(item => (
                  <div key={item.label} className="bg-[#f4f3ef] rounded-xl p-3">
                    <p className="text-xs text-[#9b9890] mb-1">{item.label}</p>
                    <p className="text-sm font-medium text-[#1a1916]">{item.value}</p>
                  </div>
                ))}
                <div className="bg-[#f4f3ef] rounded-xl p-3">
                  <p className="text-xs text-[#9b9890] mb-1">Status</p>
                  <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${DEPOSIT_STATUS_STYLE[detailDeposit.status]}`}>
                    {DEPOSIT_STATUS_LABELS[detailDeposit.status]}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
