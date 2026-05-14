'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Plus, X, FileText, RefreshCw, ChevronRight } from 'lucide-react';

type ContractStatus = 'active' | 'expired' | 'terminated' | 'pending' | 'issued';

const STATUS_LABELS: Record<ContractStatus, string> = {
  active:     'Active',
  expired:    'Expired',
  terminated: 'Terminated',
  pending:    'Pending',
  issued:     'Issued',
};

const STATUS_STYLE: Record<ContractStatus, string> = {
  active:     'bg-[#dbeafe] text-[#1e40af]',
  expired:    'bg-[#e5e7eb] text-[#374151]',
  terminated: 'bg-[#fee2e2] text-[#b91c1c]',
  pending:    'bg-[#fef3c7] text-[#92400e]',
  issued:     'bg-[#d8f2e8] text-[#1a7a5a]',
};

interface Contract {
  id: number;
  ref: string;
  contractType: string | null;
  startDate: string;
  endDate: string;
  annualRent: number;
  status: ContractStatus;
  ejariStatus: string;
  contractActive: boolean;
  renewalStatus: string | null;
  createdAt: string;
  tenant: { id: number | null; name: string | null; email: string | null };
  unit: { id: number | null; number: string | null; name: string | null };
  property: { id: number | null; buildingName: string | null };
}

function fmt(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function OrdersPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAsset, setFilterAsset] = useState('all');

  useEffect(() => {
    fetch('/api/contracts', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setContracts(data); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const assets = [...new Set(contracts.map(c => c.property.buildingName).filter(Boolean))];

  const filtered = contracts.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    if (filterAsset !== 'all' && c.property.buildingName !== filterAsset) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !c.ref.toLowerCase().includes(q) &&
        !(c.tenant.name ?? '').toLowerCase().includes(q) &&
        !(c.unit.name ?? '').toLowerCase().includes(q) &&
        !(c.tenant.email ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const hasFilters = filterStatus !== 'all' || filterAsset !== 'all' || search !== '';
  const clearFilters = () => { setFilterStatus('all'); setFilterAsset('all'); setSearch(''); };

  const now = new Date();
  const in60 = new Date(); in60.setDate(in60.getDate() + 60);

  const activeCount   = contracts.filter(c => c.status === 'active').length;
  const expiringCount = contracts.filter(c => {
    if (c.status !== 'active') return false;
    const end = new Date(c.endDate);
    return end >= now && end <= in60;
  }).length;
  const totalRent = contracts
    .filter(c => c.status === 'active')
    .reduce((s, c) => s + c.annualRent, 0);

  const STATS = [
    { label: 'Total Contracts',  value: contracts.length },
    { label: 'Active',           value: activeCount },
    { label: 'Expiring (60d)',   value: expiringCount },
    { label: 'Active Rent / yr', value: `AED ${totalRent.toLocaleString('en-AE')}` },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Contracts</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">All tenancy agreements and their lifecycle status.</p>
        </div>
        <Link href="/rental-provider/dashboard/contracts/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer" style={{ background: '#2e9f82' }}>
          <Plus size={15} /> New Contract
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {STATS.map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className="font-bold text-2xl text-[#1a1916] mt-1">
              {loading ? <span className="animate-pulse text-[#9b9890]">—</span> : s.value}
            </div>
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
          {(Object.keys(STATUS_LABELS) as ContractStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select value={filterAsset} onChange={e => setFilterAsset(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          <option value="all">All Properties</option>
          {assets.map(a => <option key={a!} value={a!}>{a}</option>)}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">
          {loading ? 'Loading…' : `${filtered.length} contract${filtered.length !== 1 ? 's' : ''} found`}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <RefreshCw size={24} className="text-[#2e9f82] animate-spin mb-3" />
            <p className="text-sm text-[#6b6860]">Loading contracts…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <FileText size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">No contracts found</p>
            <p className="text-xs text-[#9b9890]">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1100px]">
              <thead>
                <tr className="bg-[#f4f3ef]">
                  {['Ref', 'Unit', 'Property', 'Tenant', 'Email', 'Start', 'End', 'Annual Rent', 'Type', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const endDate = new Date(c.endDate);
                  const isExpiringSoon = c.status === 'active' && endDate >= now && endDate <= in60;
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916] cursor-pointer"
                      onClick={() => window.location.href = `/rental-provider/dashboard/contracts/${c.id}`}
                    >
                      <td className="px-4 py-3.5 font-medium text-[#2e9f82] whitespace-nowrap">{c.ref}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap">{c.unit.number ?? '—'}</td>
                      <td className="px-4 py-3.5 text-[#6b6860] whitespace-nowrap">{c.property.buildingName ?? '—'}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap">{c.tenant.name ?? '—'}</td>
                      <td className="px-4 py-3.5 text-[#6b6860] text-xs">{c.tenant.email ?? '—'}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap">{fmt(c.startDate)}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className={isExpiringSoon ? 'text-amber-600 font-medium' : ''}>{fmt(c.endDate)}</span>
                        {isExpiringSoon && <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 rounded px-1">Soon</span>}
                      </td>
                      <td className="px-4 py-3.5 font-medium whitespace-nowrap">
                        AED {c.annualRent.toLocaleString('en-AE')}
                      </td>
                      <td className="px-4 py-3.5 capitalize text-[#6b6860]">{c.contractType ?? '—'}</td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[c.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                          {STATUS_LABELS[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <ChevronRight size={14} className="text-[#9b9890]" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
