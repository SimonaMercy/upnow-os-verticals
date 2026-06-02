'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search, Plus, X, FileText, RefreshCw, ChevronRight,
  ChevronLeft, ChevronRight as ChevronRightIcon,
} from 'lucide-react';

type ContractStatus = 'active' | 'expired' | 'terminated' | 'pending' | 'issued';
/** Synthetic statuses surfaced ONLY on the orders page so the RP can tell a
 *  renewal proposal apart from a brand-new lease draft. The DB column stays
 *  'pending' / 'active' in these cases — we just re-label the row for the
 *  list view. See docs/CONTRACT_LIFECYCLE.md §7 for the full list. */
type DisplayStatus = ContractStatus | 'declined' | 'renewal_pending' | 'superseded' | 'terminating';
type TabKey = DisplayStatus | 'all' | 'upcoming_renewal';

const STATUS_LABELS: Record<DisplayStatus, string> = {
  active:          'Active',
  expired:         'Expired',
  terminated:      'Terminated',
  pending:         'Pending',
  issued:          'In Progress',
  declined:        'Declined',
  renewal_pending: 'Renewal Pending',
  superseded:      'Superseded',
  terminating:     'Terminating',
};

const STATUS_STYLE: Record<DisplayStatus, string> = {
  active:          'bg-[#dbeafe] text-[#1e40af]',
  expired:         'bg-[#e5e7eb] text-[#374151]',
  terminated:      'bg-[#fee2e2] text-[#b91c1c]',
  pending:         'bg-[#fef3c7] text-[#92400e]',
  issued:          'bg-[#d8f2e8] text-[#1a7a5a]',
  declined:        'bg-[#fee2e2] text-[#b91c1c]',
  renewal_pending: 'bg-[#fef3c7] text-[#92400e]',
  superseded:      'bg-[#f3e8ff] text-[#6b21a8]',
  terminating:     'bg-[#ffedd5] text-[#9a3412]',
};

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',              label: 'All' },
  { key: 'active',           label: 'Active' },
  { key: 'terminating',      label: 'Terminating' },
  { key: 'pending',          label: 'Pending' },
  { key: 'issued',           label: 'In Progress' },
  { key: 'expired',          label: 'Expired' },
  { key: 'upcoming_renewal', label: 'Upcoming Renewal' },
  { key: 'renewal_pending',  label: 'Renewal Pending' },
  { key: 'declined',         label: 'Declined' },
  { key: 'superseded',       label: 'Superseded' },
  { key: 'terminated',       label: 'Terminated' },
];

/** Map the raw DB status to a display status. Surfaces four synthetic labels
 *  on top of the DB enum (docs/CONTRACT_LIFECYCLE.md §3 + §4.3):
 *   - `declined`        — renewal child where `contractActive=false`
 *   - `renewal_pending` — renewal child still awaiting customer decision
 *   - `superseded`      — new-lease draft archived because the unit was
 *                         leased to a different customer first
 *   - `terminating`     — ACTIVE contract with accepted termination, still
 *                         winding down to its effective date */
function displayStatusOf(c: Pick<Contract, 'status' | 'contractType' | 'contractActive' | 'termination'>): DisplayStatus {
  if (c.contractType === 'renewal' && c.contractActive === false) return 'declined';
  if (c.contractType === 'renewal' && c.status === 'pending') return 'renewal_pending';
  if (
    c.contractType !== 'renewal' &&
    c.contractActive === false &&
    (c.status === 'pending' || c.status === 'issued')
  ) {
    return 'superseded';
  }
  if (c.status === 'active' && c.termination?.response === 'accepted') return 'terminating';
  return c.status;
}

const PAGE_SIZE = 15;

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
  /** Termination snapshot — only present when a request has been raised. */
  termination?: {
    response: 'pending' | 'accepted' | 'rejected' | null;
    effectiveDate: string | null;
  } | null;
}

function fmt(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function OrdersPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAsset, setFilterAsset] = useState('all');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch('/api/contracts', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setContracts(data); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  // Reset page when tab / filters change
  useEffect(() => { setPage(1); }, [activeTab, search, filterAsset]);

  const now = useMemo(() => new Date(), []);
  const in60 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 60); return d; }, []);

  const assets = useMemo(
    () => [...new Set(contracts.map(c => c.property.buildingName).filter(Boolean))],
    [contracts],
  );

  // Counts per tab for badges
  const tabCounts = useMemo(() => {
    const counts: Partial<Record<TabKey, number>> = {};
    counts.all = contracts.length;
    for (const s of Object.keys(STATUS_LABELS) as DisplayStatus[]) {
      counts[s] = contracts.filter(c => displayStatusOf(c) === s).length;
    }
    counts.upcoming_renewal = contracts.filter(c => {
      if (displayStatusOf(c) !== 'active') return false;
      const end = new Date(c.endDate);
      return end >= now && end <= in60;
    }).length;
    return counts;
  }, [contracts, now, in60]);

  // Stats
  const activeCount   = tabCounts.active ?? 0;
  const expiringCount = tabCounts.upcoming_renewal ?? 0;
  const totalRent     = contracts
    .filter(c => displayStatusOf(c) === 'active')
    .reduce((s, c) => s + c.annualRent, 0);

  const declinedCount = tabCounts.declined ?? 0;
  const STATS = [
    { label: 'Total Contracts',  value: contracts.length },
    { label: 'Active',           value: activeCount },
    { label: 'Expiring (60d)',   value: expiringCount },
    { label: 'Declined Renewals', value: declinedCount },
    { label: 'Active Rent / yr', value: `AED ${totalRent.toLocaleString('en-AE')}` },
  ];

  // Filter logic
  const tabFiltered = useMemo(() => {
    return contracts.filter(c => {
      const ds = displayStatusOf(c);
      if (activeTab === 'upcoming_renewal') {
        if (ds !== 'active') return false;
        const end = new Date(c.endDate);
        if (!(end >= now && end <= in60)) return false;
      } else if (activeTab !== 'all') {
        if (ds !== activeTab) return false;
      }
      if (filterAsset !== 'all' && c.property.buildingName !== filterAsset) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.ref.toLowerCase().includes(q) &&
          !(c.tenant.name ?? '').toLowerCase().includes(q) &&
          !(c.unit.name ?? '').toLowerCase().includes(q) &&
          !(c.unit.number ?? '').toLowerCase().includes(q) &&
          !(c.tenant.email ?? '').toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [contracts, activeTab, filterAsset, search, now, in60]);

  const totalPages = Math.max(1, Math.ceil(tabFiltered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = tabFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const hasFilters = filterAsset !== 'all' || search !== '';
  const clearFilters = () => { setFilterAsset('all'); setSearch(''); };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Contracts</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">All tenancy agreements and their lifecycle status.</p>
        </div>
        <Link
          href="/rental-provider/dashboard/contracts/new"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer"
          style={{ background: '#2e9f82' }}
        >
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

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-4 scrollbar-none">
        {TABS.map(tab => {
          const count = tabCounts[tab.key] ?? 0;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#2e9f82] text-white'
                  : 'bg-white text-[#6b6860] hover:bg-[#f4f3ef] border border-[#e8e6e0]'
              }`}
            >
              {tab.label}
              {!loading && (
                <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${
                  isActive ? 'bg-white/20 text-white' : 'bg-[#f4f3ef] text-[#6b6860]'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 items-center mb-4 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input
            type="text"
            placeholder="Search by ref, customer or unit…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
          />
        </div>
        <select
          value={filterAsset}
          onChange={e => setFilterAsset(e.target.value)}
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]"
        >
          <option value="all">All Properties</option>
          {assets.map(a => <option key={a!} value={a!}>{a}</option>)}
        </select>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto"
          >
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">
          {loading ? 'Loading…' : `${tabFiltered.length} contract${tabFiltered.length !== 1 ? 's' : ''}`}
        </span>
        {!loading && totalPages > 1 && (
          <span className="text-sm text-[#9b9890]">
            Page {safePage} of {totalPages}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <RefreshCw size={24} className="text-[#2e9f82] animate-spin mb-3" />
            <p className="text-sm text-[#6b6860]">Loading contracts…</p>
          </div>
        ) : tabFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <FileText size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">No contracts found</p>
            <p className="text-xs text-[#9b9890]">
              {hasFilters ? 'Try adjusting your filters' : 'No contracts in this category yet'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1100px]">
                <thead>
                  <tr className="bg-[#f4f3ef]">
                    {['Ref', 'Unit', 'Property', 'Customer', 'Email', 'Start', 'End', 'Annual Rent', 'Type', 'Status', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(c => {
                    const endDate = new Date(c.endDate);
                    const ds = displayStatusOf(c);
                    const isExpiringSoon = ds === 'active' && endDate >= now && endDate <= in60;
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916] cursor-pointer"
                        onClick={() => router.push(`/rental-provider/dashboard/contracts/${c.id}`)}
                      >
                        <td className="px-4 py-3.5 font-medium text-[#2e9f82] whitespace-nowrap">{c.ref}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">{c.unit.number ?? '—'}</td>
                        <td className="px-4 py-3.5 text-[#6b6860] whitespace-nowrap">{c.property.buildingName ?? '—'}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">{c.tenant.name ?? '—'}</td>
                        <td className="px-4 py-3.5 text-[#6b6860] text-xs">{c.tenant.email ?? '—'}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">{fmt(c.startDate)}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className={isExpiringSoon ? 'text-amber-600 font-medium' : ''}>{fmt(c.endDate)}</span>
                          {isExpiringSoon && (
                            <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 rounded px-1">Soon</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-medium whitespace-nowrap">
                          AED {c.annualRent.toLocaleString('en-AE')}
                        </td>
                        <td className="px-4 py-3.5 capitalize text-[#6b6860]">{c.contractType ?? '—'}</td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[ds] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                            {STATUS_LABELS[ds] ?? ds}
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#e8e6e0]">
                <span className="text-xs text-[#9b9890]">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, tabFiltered.length)} of {tabFiltered.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let p: number;
                    if (totalPages <= 7) {
                      p = i + 1;
                    } else if (safePage <= 4) {
                      p = i < 6 ? i + 1 : totalPages;
                    } else if (safePage >= totalPages - 3) {
                      p = i === 0 ? 1 : totalPages - 6 + i;
                    } else {
                      const mid = [1, safePage - 1, safePage, safePage + 1, totalPages];
                      p = mid[Math.min(i, mid.length - 1)];
                    }
                    return (
                      <button
                        key={`pg-${p}-${i}`}
                        onClick={() => setPage(p)}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                          p === safePage
                            ? 'bg-[#2e9f82] text-white'
                            : 'border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronRightIcon size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
