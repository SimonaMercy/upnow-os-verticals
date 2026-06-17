/**
 * Customer — Contract List (dashboard/customer/contracts)
 *
 * Lists all tenancy contracts for the logged-in tenant: active, issued, pending,
 * expired. Each card links to the contract detail page for e-sign and status view.
 *
 * Data: GET /contracts/tenant — returns contracts with landlord + unit summary.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Building2, Calendar, ChevronRight, Search, X } from 'lucide-react';

type ContractSummary = {
  id: number;
  ref: string;
  contractType: string;
  startDate: string;
  endDate: string;
  annualRent: number;
  listedRent: number | null;
  discountType: 'percent' | 'fixed' | null;
  discountAmount: number | null;
  status: string;
  ejariStatus: string | null;
  contractSent: boolean;
  landlord: { name: string | null; email: string | null };
  unit: { id: number | null; number: string | null; name: string | null };
  property: { buildingName: string | null; fullAddress: string | null };
};

const STATUS_STYLE: Record<string, string> = {
  pending:    'bg-[#fef9c3] text-[#854d0e]',
  issued:     'bg-[#dbeafe] text-[#1e40af]',
  active:     'bg-[#d8f2e8] text-[#1a7a5a]',
  expired:    'bg-[#f4f3ef] text-[#6b6860]',
  terminated: 'bg-[#fee2e2] text-[#b91c1c]',
};

const STATUS_LABEL: Record<string, string> = {
  pending:    'Pending',
  issued:     'Awaiting Signature',
  active:     'Active',
  expired:    'Expired',
  terminated: 'Terminated',
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtAed(fils: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(fils);
}

export default function TenantContractsPage() {
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    fetch('/api/contracts/tenant', { credentials: 'include' })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : (data.message ?? `Error ${r.status}`));
        if (Array.isArray(data)) setContracts(data);
      })
      .catch(e => setFetchError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = contracts.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !c.ref.toLowerCase().includes(q) &&
        !c.property?.buildingName?.toLowerCase().includes(q) &&
        !c.unit?.number?.toLowerCase().includes(q) &&
        !c.unit?.name?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const activeCount = contracts.filter(c => c.status === 'active').length;
  const awaitingSign = contracts.filter(c => c.status === 'issued').length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">My Contracts</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Your tenancy agreements with landlords.</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Contracts', value: loading ? '…' : String(contracts.length) },
          { label: 'Active',          value: loading ? '…' : String(activeCount),    accent: activeCount > 0 },
          { label: 'Awaiting Signature', value: loading ? '…' : String(awaitingSign), accent: awaitingSign > 0 },
        ].map(card => (
          <div key={card.label} className="bg-white border border-[#e8e6e0] rounded-2xl px-4 py-3.5">
            <p className="text-xs text-[#6b6860]">{card.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${card.accent ? 'text-[#2e9f82]' : 'text-[#1a1916]'}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#b0ada8]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by property or unit…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-[#e8e6e0] rounded-xl bg-[#f7f6f2] focus:outline-none focus:border-[#2e9f82] placeholder:text-[#c0bdb8]"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-sm border border-[#e8e6e0] rounded-xl bg-[#f7f6f2] focus:outline-none focus:border-[#2e9f82] text-[#1a1916]"
        >
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {(search || filterStatus !== 'all') && (
          <button
            onClick={() => { setSearch(''); setFilterStatus('all'); }}
            className="flex items-center gap-1 px-3 py-2 text-sm text-[#6b6860] border border-[#e8e6e0] rounded-xl hover:border-[#c5c2bc] bg-white"
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-[#b0ada8] text-sm">Loading contracts…</div>
      ) : fetchError ? (
        <div className="text-center py-16 space-y-2">
          <p className="text-red-500 font-medium">Failed to load contracts</p>
          <p className="text-sm text-[#b0ada8]">{fetchError}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <FileText size={32} className="mx-auto text-[#d4d1cb]" />
          <p className="text-[#6b6860] font-medium">No contracts found</p>
          <p className="text-sm text-[#b0ada8]">
            {contracts.length === 0 ? 'Your landlord will issue your tenancy contract here.' : 'Try adjusting your filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const label = STATUS_LABEL[c.status] ?? c.status;
            const style = STATUS_STYLE[c.status] ?? 'bg-[#f4f3ef] text-[#6b6860]';
            const propertyName = c.property?.buildingName ?? '—';
            const unitLabel = c.unit?.number ? `Unit ${c.unit.number}` : (c.unit?.name ?? '—');
            return (
              <Link
                key={c.id}
                href={`/dashboard/customer/contracts/${c.id}`}
                className="flex items-center gap-4 bg-white border border-[#e8e6e0] rounded-2xl px-5 py-4 hover:border-[#c5c2bc] hover:shadow-sm transition-all group"
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0">
                  <FileText size={18} className="text-[#2e9f82]" />
                </div>
                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#1a1916]">{c.ref}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${style}`}>{label}</span>
                    {c.status === 'issued' && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#fff7ed] text-[#c2410c] border border-[#fed7aa]">Action Required</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#6b6860] flex-wrap">
                    <span className="flex items-center gap-1"><Building2 size={11} /> {propertyName} · {unitLabel}</span>
                    <span className="flex items-center gap-1"><Calendar size={11} /> {fmtDate(c.startDate)} – {fmtDate(c.endDate)}</span>
                  </div>
                  <p className="text-xs text-[#b0ada8] mt-0.5">
                    {(c.discountAmount ?? 0) > 0 && c.listedRent != null && (
                      <span className="line-through mr-1.5">{fmtAed(c.listedRent)}</span>
                    )}
                    {fmtAed(c.annualRent)} / year
                    {(c.discountAmount ?? 0) > 0 ? ` · saved ${fmtAed(c.discountAmount!)}` : ''}
                    {c.landlord?.name ? ` · Landlord: ${c.landlord.name}` : ''}
                  </p>
                </div>
                <ChevronRight size={16} className="text-[#c0bdb8] group-hover:text-[#2e9f82] shrink-0 transition-colors" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
