'use client';

import { useState } from 'react';
import { Search, X, DollarSign } from 'lucide-react';

type RecvStatus = 'scheduled' | 'due' | 'overdue' | 'received' | 'partial';

const STATUS_LABELS: Record<RecvStatus, string> = {
  scheduled: 'Scheduled',
  due: 'Due',
  overdue: 'Overdue',
  received: 'Received',
  partial: 'Partial',
};

const STATUS_STYLE: Record<RecvStatus, string> = {
  scheduled: 'bg-[#dbeafe] text-[#1e40af]',
  due: 'bg-[#fef3c7] text-[#92400e]',
  overdue: 'bg-[#fee2e2] text-[#b91c1c]',
  received: 'bg-[#d8f2e8] text-[#1a7a5a]',
  partial: 'bg-[#ede9fe] text-[#6d28d9]',
};

type Receivable = {
  id: string;
  leaseRef: string;
  unit: string;
  tenant: string;
  amount: number;
  amountReceived: number;
  dueDate: string;
  status: RecvStatus;
  paymentMethod: string;
  overdueDays: string;
  type: string;
};

/* Placeholder — will be replaced by /api/receivables (Sprint 4/5) */
const DEMO_RECV: Receivable[] = [];

const SUMMARY_CARDS = [
  { label: 'Total Receivable',  value: 'AED 0',  sub: 'all records' },
  { label: 'Collected',         value: 'AED 0',  sub: 'amount received' },
  { label: 'Outstanding',       value: 'AED 0',  sub: 'pending payment' },
  { label: 'Overdue',           value: 'AED 0',  sub: 'past due date' },
  { label: 'Collection Rate',   value: '0%',      sub: 'of total billed' },
];

export default function ReceivablesPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));

  const filtered = DEMO_RECV.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterType !== 'all' && r.type !== filterType) return false;
    if (filterYear !== 'all' && !r.dueDate.startsWith(filterYear)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.leaseRef.toLowerCase().includes(q) && !r.tenant.toLowerCase().includes(q) && !r.unit.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilters = filterStatus !== 'all' || filterType !== 'all' || filterYear !== String(new Date().getFullYear()) || search !== '';
  const clearFilters = () => { setFilterStatus('all'); setFilterType('all'); setFilterYear(String(new Date().getFullYear())); setSearch(''); };

  const years = ['2024', '2025', '2026', '2027'];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Receivables</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Track all rental payments and collection status.</p>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Sprint 4/5</span> — Payments API coming soon
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {SUMMARY_CARDS.map((s, i) => (
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
            placeholder="Search by lease ref, tenant or unit…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
          />
        </div>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
          <option value="all">All Years</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          <option value="all">All Statuses</option>
          {(Object.keys(STATUS_LABELS) as RecvStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          <option value="all">All Types</option>
          <option value="rent">Rent</option>
          <option value="service_charge">Service Charge</option>
          <option value="deposit">Deposit</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">{filtered.length} item{filtered.length !== 1 ? 's' : ''} found</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        {DEMO_RECV.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <DollarSign size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">No receivables yet</p>
            <p className="text-xs text-[#9b9890]">Payment records will appear here once rental agreements are active (Sprint 4/5)</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1000px]">
              <thead>
                <tr className="bg-[#f4f3ef]">
                  {['Lease Ref', 'Unit', 'Tenant', 'Type', 'Amount', 'Received', 'Due Date', 'Method', 'Overdue', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916]">
                    <td className="px-4 py-3.5 font-medium text-[#2e9f82]">{r.leaseRef}</td>
                    <td className="px-4 py-3.5">{r.unit}</td>
                    <td className="px-4 py-3.5">{r.tenant}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{r.type}</td>
                    <td className="px-4 py-3.5 font-medium">AED {r.amount.toLocaleString('en-AE')}</td>
                    <td className="px-4 py-3.5 text-[#2e9f82]">AED {r.amountReceived.toLocaleString('en-AE')}</td>
                    <td className="px-4 py-3.5">{r.dueDate}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{r.paymentMethod}</td>
                    <td className="px-4 py-3.5 text-red-600 font-medium">{r.overdueDays}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <button className="text-sm text-[#2e9f82] font-medium cursor-pointer hover:underline">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
