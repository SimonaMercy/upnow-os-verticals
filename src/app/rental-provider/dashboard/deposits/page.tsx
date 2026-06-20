'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Wallet, Loader2, RefreshCw, ExternalLink, Calendar } from 'lucide-react';
import Link from 'next/link';
import DepositDetailModal, { type DepositDetail } from '@/components/upnow/DepositDetailModal';

type DepositStatus = 'held' | 'returned' | 'partial_return' | 'forfeited';

const STATUS_LABELS: Record<DepositStatus, string> = {
  held:               'Held',
  returned:           'Returned',
  partial_return:  'Partial Return',
  forfeited:          'Forfeited',
};

const STATUS_STYLE: Record<DepositStatus, string> = {
  held:               'bg-[#d8f2e8] text-[#1a7a5a]',
  returned:           'bg-[#dbeafe] text-[#1e40af]',
  partial_return:  'bg-[#fef3c7] text-[#92400e]',
  forfeited:          'bg-[#fee2e2] text-[#b91c1c]',
};

interface Deposit {
  id: string;
  depositRef: string;
  contractRef: string;
  contractId: number | null;
  // The in-force lease for this deposit's tenant+unit (the deposit row is pinned to
  // the renewal chain's oldest lease) — where a move-out settlement should be opened.
  currentContractId: number | null;
  tenant: string;
  building: string;
  unit: string;
  amount: number;
  amountReceipt: number | null;
  recordedDate: string | null;
  startDate: string | null;
  endDate: string | null;
  status: DepositStatus;
  fromYear: number | null;
  toYear: number | null;
  notes: string | null;
  settledRefundAmount: number | null;
  settledDeductionAmount: number | null;
  settledOn: string | null;
  settledViaSettlementId: number | null;
  proofs?: DepositProof[];
}

interface DepositProof {
  documentKey: string;
  displayName: string | null;
  mimeType: string | null;
  fileUrl: string | null;
}

function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}

/** A deposit belongs to year Y if its lease TERM overlaps Y — the same scope as
 *  the Tenancy Contracts page. Falls back to the deposit's from/to year range,
 *  then its recorded year, for rows without a resolvable term. */
function depositYearMatch(
  d: { startDate: string | null; endDate: string | null; fromYear: number | null; toYear: number | null; recordedDate: string | null },
  y: number,
): boolean {
  if (d.startDate || d.endDate) {
    const s = d.startDate ? Number(d.startDate.slice(0, 4)) : -Infinity;
    const e = d.endDate ? Number(d.endDate.slice(0, 4)) : Infinity;
    return y >= s && y <= e;
  }
  if (d.fromYear != null || d.toYear != null) {
    const lo = d.fromYear ?? d.toYear!;
    const hi = d.toYear ?? d.fromYear!;
    return y >= Math.min(lo, hi) && y <= Math.max(lo, hi);
  }
  if (d.recordedDate) return Number(d.recordedDate.slice(0, 4)) === y;
  return false;
}

/** Collect every lease year present in the data for the year dropdown. */
function depositYears(deposits: { startDate: string | null; endDate: string | null; fromYear: number | null; toYear: number | null; recordedDate: string | null }[]): number[] {
  const set = new Set<number>();
  for (const d of deposits) {
    if (d.startDate || d.endDate) {
      if (d.startDate) set.add(Number(d.startDate.slice(0, 4)));
      if (d.endDate) set.add(Number(d.endDate.slice(0, 4)));
    } else if (d.fromYear != null || d.toYear != null) {
      if (d.fromYear != null) set.add(d.fromYear);
      if (d.toYear != null) set.add(d.toYear);
    } else if (d.recordedDate) {
      set.add(Number(d.recordedDate.slice(0, 4)));
    }
  }
  set.add(new Date().getFullYear());
  return [...set].filter(n => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
}

export default function DepositsPage() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterYear, setFilterYear] = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/contracts/deposits', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      setDeposits(await res.json());
    } catch {
      setError('Failed to load deposits.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Lazy-load the full detail bundle (docs, move-in/out, settlement) for the popup.
  const loadDepositDetail = useCallback(async (id: string): Promise<DepositDetail> => {
    const res = await fetch(`/api/contracts/deposits/${id}/detail`, { credentials: 'include' });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }, []);

  // Year scope — same behaviour as the Tenancy Contracts page: options derived
  // from the data, default to the current year, with an "All years" escape.
  const years = useMemo(() => depositYears(deposits), [deposits]);

  const yearScoped = useMemo(
    () => (filterYear === 'all' ? deposits : deposits.filter(d => depositYearMatch(d, Number(filterYear)))),
    [deposits, filterYear],
  );

  const buildings = [...new Set(deposits.map(d => d.building).filter(b => b !== '—'))];

  const filtered = yearScoped.filter(d => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (filterBuilding !== 'all' && d.building !== filterBuilding) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !d.depositRef.toLowerCase().includes(q) &&
        !d.tenant.toLowerCase().includes(q) &&
        !d.unit.toLowerCase().includes(q) &&
        !d.contractRef.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const hasFilters = filterStatus !== 'all' || filterBuilding !== 'all' || search !== '';
  const clearFilters = () => { setFilterStatus('all'); setFilterBuilding('all'); setSearch(''); };

  // Summary stats — scoped to the selected year so the cards segregate per year.
  const totalHeld      = yearScoped.filter(d => d.status === 'held').reduce((s, d) => s + d.amount, 0);
  const heldCount      = yearScoped.filter(d => d.status === 'held').length;
  const returnedCount  = yearScoped.filter(d => d.status === 'returned').length;
  const dedCount       = yearScoped.filter(d => d.status === 'partial_return').length;
  const totalAmount    = yearScoped.reduce((s, d) => s + d.amount, 0);

  const detail = detailId !== null ? deposits.find(d => d.id === detailId) ?? null : null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Security Deposits</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Track all security deposits across your rental agreements.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 pl-3 pr-1.5 h-[38px] rounded-xl border border-[#e8e6e0] bg-white text-[#6b6860]"
            title="Scope the page by lease year">
            <Calendar size={14} />
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} aria-label="Filter deposits by year"
              className="bg-transparent text-sm font-semibold text-[#1a1916] focus:outline-none cursor-pointer pr-1 py-1">
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] transition-colors disabled:opacity-50 cursor-pointer">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total Records',       value: String(yearScoped.length),   sub: filterYear === 'all' ? 'all deposits' : `in ${filterYear}` },
          { label: 'Total Amount',        value: fmtAed(totalAmount),         sub: 'recorded' },
          { label: 'Currently Held',      value: fmtAed(totalHeld),           sub: `${heldCount} active` },
          { label: 'Returned',            value: String(returnedCount),       sub: 'completed' },
          { label: 'With Deductions',     value: String(dedCount),            sub: 'partial returns' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm border border-[#f0ede8]">
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className="font-bold text-xl text-[#1a1916] mt-1 truncate">{s.value}</div>
            <div className="text-xs text-[#9b9890] mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 items-center mb-4 shadow-sm border border-[#f0ede8]">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input type="text" placeholder="Search ref, customer, unit…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
          <option value="all">All Statuses</option>
          {(Object.keys(STATUS_LABELS) as DepositStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        {buildings.length > 0 && (
          <select value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)}
            className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
            <option value="all">All Buildings</option>
            {buildings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        {hasFilters && (
          <button onClick={clearFilters}
            className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">{filtered.length} deposit{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#f0ede8]">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-[#2e9f82]" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={load} className="text-xs text-[#2e9f82] font-medium hover:underline cursor-pointer">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <Wallet size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">
              {filterYear !== 'all'
                ? `No deposits for ${filterYear}.`
                : hasFilters ? 'No deposits match your filters.' : 'No security deposits recorded yet.'}
            </p>
            <p className="text-xs text-[#9b9890]">
              {filterYear !== 'all' ? 'Switch to “All years” to see every deposit.' : 'Deposits are recorded from the contract detail page.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[900px]">
              <thead>
                <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                  {['Deposit Ref', 'Contract', 'Building', 'Unit', 'Customer', 'Amount', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id} onClick={() => setDetailId(d.id)}
                    className="border-b border-[#f0ede8] hover:bg-[#fafaf8] text-sm text-[#1a1916] cursor-pointer transition-colors">
                    <td className="px-4 py-3.5 font-medium font-mono text-xs">{d.depositRef}</td>
                    <td className="px-4 py-3.5">
                      {d.contractId ? (
                        <Link href={`/rental-provider/dashboard/contracts/${d.contractId}/v2`}
                          onClick={e => e.stopPropagation()}
                          className="text-[#2e9f82] font-medium hover:underline">{d.contractRef}</Link>
                      ) : <span className="text-[#9b9890]">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{d.building}</td>
                    <td className="px-4 py-3.5">{d.unit}</td>
                    <td className="px-4 py-3.5">{d.tenant}</td>
                    <td className="px-4 py-3.5 font-semibold">{fmtAed(d.amount)}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[d.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                        {STATUS_LABELS[d.status] ?? d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <ExternalLink size={13} className="text-[#9b9890]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <DepositDetailModal
          deposit={detail}
          loadDetail={loadDepositDetail}
          onClose={() => setDetailId(null)}
          links={{
            contract: (id) => `/rental-provider/dashboard/contracts/${id}/v2`,
            settlement: (id) => `/rental-provider/dashboard/contracts/${id}/settlement`,
            receipt: (id) => `/rental-provider/dashboard/contracts/${id}/print/receipt?kind=deposit`,
          }}
        />
      )}
    </div>
  );
}
