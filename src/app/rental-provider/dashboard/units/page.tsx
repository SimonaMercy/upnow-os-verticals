'use client';

import { useState, useMemo } from 'react';
import { Search, X, Loader2, AlertCircle, LayoutList, Link as LinkIcon, Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import Link from 'next/link';

type UnitStatus = 'available' | 'occupied' | 'under_renewal' | 'renewal_pending' | 'maintenance';

const STATUS_LABELS: Record<UnitStatus, string> = {
  available: 'Available',
  occupied: 'Occupied',
  under_renewal: 'Under Renewal',
  renewal_pending: 'Renewal Pending',
  maintenance: 'Maintenance',
};

const STATUS_STYLE: Record<UnitStatus, string> = {
  available: 'bg-[#d8f2e8] text-[#1a7a5a]',
  occupied: 'bg-[#dbeafe] text-[#1e40af]',
  under_renewal: 'bg-[#ede9fe] text-[#6d28d9]',
  renewal_pending: 'bg-[#fef3c7] text-[#92400e]',
  maintenance: 'bg-[#fee2e2] text-[#b91c1c]',
};

type ApiUnit = {
  id: number;
  propertyId: number;
  propertyName?: string;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  unitTier: string;
  floor: string | null;
  bedrooms: number | null;
  unitSizeSqft: number | null;
  rentalPrice: number | null;
  availability: string;
};

const METRICS = [
  { label: 'Total Units',     key: 'total',   color: '#6b6860' },
  { label: 'Occupied',        key: 'occupied', color: '#1e40af' },
  { label: 'Available',       key: 'available',color: '#2e9f82' },
  { label: 'Under Renewal',   key: 'renewal',  color: '#6d28d9' },
  { label: 'Maintenance',     key: 'maint',    color: '#b91c1c' },
] as const;

export default function UnitsPage() {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const { data: units = [], isLoading, error } = useQuery<ApiUnit[]>({
    queryKey: ['units-all'],
    queryFn: () => apiGet<ApiUnit[]>('/properties/units/all'),
  });

  const unitTypes = useMemo(() => [...new Set(units.map(u => u.unitType))].sort(), [units]);

  const filtered = useMemo(() => units.filter(u => {
    if (filterType !== 'all' && u.unitType !== filterType) return false;
    if (filterStatus !== 'all' && u.availability !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !u.unitNumber.toLowerCase().includes(q) &&
        !(u.unitName ?? '').toLowerCase().includes(q) &&
        !(u.propertyName ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  }), [units, filterType, filterStatus, search]);

  const hasFilters = filterType !== 'all' || filterStatus !== 'all' || search !== '';
  const clearFilters = () => { setFilterType('all'); setFilterStatus('all'); setSearch(''); };

  const counts = useMemo(() => ({
    total: units.length,
    occupied: units.filter(u => u.availability === 'occupied').length,
    available: units.filter(u => u.availability === 'available').length,
    renewal: units.filter(u => u.availability === 'under_renewal' || u.availability === 'renewal_pending').length,
    maint: units.filter(u => u.availability === 'maintenance').length,
  }), [units]);

  const selectCls = (active: boolean) =>
    `border rounded-lg px-3 py-2 text-sm transition-colors bg-white ${active ? 'border-[#2e9f82] text-[#1a1916] font-medium' : 'border-[#e8e6e0] text-[#3d3b35]'}`;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Units</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">All rental units across your portfolio.</p>
        </div>
        <Link href="/dashboard/rental-provider/portfolio" className="flex items-center gap-2 text-sm text-[#2e9f82] font-medium hover:underline">
          <LinkIcon size={14} /> Manage in Portfolio
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">
          <AlertCircle size={16} /> {(error as Error).message}
        </div>
      )}

      {/* Inventory metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        {METRICS.map(m => (
          <div key={m.key} className="bg-white rounded-xl p-4 shadow-sm">
            <div className="text-xs text-[#9b9890] font-medium">{m.label}</div>
            <div className="text-2xl font-bold mt-1" style={{ color: m.color }}>
              {isLoading ? <Loader2 size={18} className="animate-spin inline" /> : counts[m.key]}
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
            placeholder="Search by unit #, name, property…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82] bg-white text-[#1a1916]"
          />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className={selectCls(filterType !== 'all')}>
          <option value="all">All Types</option>
          {unitTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={selectCls(filterStatus !== 'all')}>
          <option value="all">All Statuses</option>
          {(Object.keys(STATUS_LABELS) as UnitStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-[#2e9f82] font-medium hover:underline cursor-pointer flex items-center gap-1">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">{filtered.length} unit{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-[#9b9890]">
            <Loader2 size={20} className="animate-spin" /> Loading units…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <LayoutList size={32} className="text-[#c9c7c1] mb-3" />
            <p className="text-sm text-[#6b6860] mb-1">
              {hasFilters ? 'No units match your filters' : 'No units yet'}
            </p>
            <p className="text-xs text-[#9b9890] mb-3">
              {hasFilters ? 'Try adjusting your filter criteria' : 'Add properties and units from the Portfolio page'}
            </p>
            {hasFilters ? (
              <button onClick={clearFilters} className="text-sm text-[#2e9f82] font-medium hover:underline cursor-pointer">Clear filters</button>
            ) : (
              <Link href="/dashboard/rental-provider/portfolio" className="text-sm text-[#2e9f82] font-medium hover:underline">Go to Portfolio →</Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="bg-[#f4f3ef]">
                  {['Unit #', 'Property', 'Type', 'Floor', 'Size (sqft)', 'Bedrooms', 'Rent / yr', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916]">
                    <td className="px-4 py-3 font-medium">
                      #{u.unitNumber}
                      {u.unitName && <div className="text-xs text-[#9b9890]">{u.unitName}</div>}
                    </td>
                    <td className="px-4 py-3 text-[#6b6860]">{u.propertyName ?? `Property ${u.propertyId}`}</td>
                    <td className="px-4 py-3 capitalize">{u.unitType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">{u.floor ?? '—'}</td>
                    <td className="px-4 py-3">{u.unitSizeSqft != null ? Number(u.unitSizeSqft).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3">{u.bedrooms != null ? u.bedrooms : '—'}</td>
                    <td className="px-4 py-3 font-semibold text-[#2e9f82]">
                      {u.rentalPrice != null ? `AED ${Number(u.rentalPrice).toLocaleString('en-AE')}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[u.availability as UnitStatus] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                        {STATUS_LABELS[u.availability as UnitStatus] ?? u.availability}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/listings/units/${u.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2e9f82] hover:underline"
                        title="Public preview"
                      >
                        <Eye size={13} /> Preview
                      </Link>
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
