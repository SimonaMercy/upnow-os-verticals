/**
 * Manager Receivables page
 *
 * Mirrors the landlord Receivables page
 * (src/app/rental-provider/dashboard/receivables/page.tsx) exactly in design,
 * but for the manager portal:
 *   - Data is fetched for the selected landlord via GET /manager/receivables?rp=<id>.
 *     That endpoint calls the same backend service as the RP
 *     /api/contracts/receivables route, so the response shape is identical and
 *     the RP page's types / rendering are reused as-is.
 *   - Gated on the per-landlord `canManageCollections` permission (resolved with
 *     useManagerPermissions + the ?rp=<landlordId> set by the LandlordSwitcher).
 *   - Read-only: the RP-only contract links (which point at /rental-provider/…
 *     and managers cannot open) are removed. All display / filter / search UI is
 *     kept. A "Permission required" lock screen renders when this landlord hasn't
 *     delegated collections access — mirroring the manager contracts page.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useMemo } from 'react';
import { Search, X, Loader2, RefreshCw, Lock } from 'lucide-react';
import { DirhamSign } from '@/components/ui/DirhamSign';
import { apiGet } from '@/lib/api';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';

// 'replaced' = a bounced cheque the customer has since made good with another
// cheque (payments.replaces_payment_id). The row stays visible as history, but it
// is neither owed nor collected — the replacement row carries the money — so it
// counts toward none of the totals below.
type RecvStatus = 'scheduled' | 'due' | 'overdue' | 'received' | 'replaced';

const STATUS_LABELS: Record<RecvStatus, string> = {
  scheduled: 'Scheduled',
  due:       'Due Today',
  overdue:   'Overdue',
  received:  'Received',
  replaced:  'Replaced',
};

const STATUS_STYLE: Record<RecvStatus, string> = {
  scheduled: 'bg-[#dbeafe] text-[#1e40af]',
  due:       'bg-[#fef3c7] text-[#92400e]',
  overdue:   'bg-[#fee2e2] text-[#b91c1c]',
  received:  'bg-[#d8f2e8] text-[#1a7a5a]',
  replaced:  'bg-[#f4f3ef] text-[#6b6860]',
};

const TYPE_LABELS: Record<string, string> = {
  rental_income:    'Rent',
  admin_fee:        'Admin Fee',
  security_deposit: 'Deposit',
  ejari_fee:        'Contract Registration Fee',
  maintenance:      'Maintenance',
  other:            'Other',
};

interface Receivable {
  id: number;
  contractRef: string;
  contractId: number | null;
  building: string;
  unit: string;
  tenant: string;
  type: string;
  description: string | null;
  amount: number;
  dueDate: string | null;
  paymentMethod: string | null;
  chequeNumber: string | null;
  status: RecvStatus;
  overdueDays: number;
}

function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE });
}

export default function ManagerReceivablesPage() {
  // Scoped to the landlord chosen in the LandlordSwitcher (?rp=). Under "All
  // landlords" with several to choose from, we prompt for one rather than
  // showing an arbitrary landlord's receivables.
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageCollections');

  const [items, setItems]       = useState<Receivable[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType]     = useState('all');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [detailId, setDetailId] = useState<number | null>(null);

  async function load() {
    if (effectiveRp == null || !allowed) { setItems([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      setItems(await apiGet<Receivable[]>(`/manager/receivables?rp=${effectiveRp}`));
    } catch {
      setError('Failed to load receivables.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [effectiveRp, allowed]);

  const buildings = useMemo(() => [...new Set(items.map(r => r.building).filter(b => b !== '—'))], [items]);
  const years     = useMemo(() => {
    const ys = new Set(items.map(r => r.dueDate?.slice(0, 4)).filter(Boolean) as string[]);
    ys.add(String(new Date().getFullYear()));
    return [...ys].sort().reverse();
  }, [items]);

  if (!permsLoading && needsLandlord) {
    return <SelectLandlordNotice resource="Receivables" />;
  }

  // Per-landlord permission gate — mirrors the lock the nav enforces.
  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-[13.5px] text-[#9b9890] mt-1.5 leading-relaxed">
            This landlord hasn’t granted you the <strong>Manage Collections</strong> permission, so their receivables aren’t available.
          </p>
        </div>
      </div>
    );
  }

  const filtered = items.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterType !== 'all' && r.type !== filterType) return false;
    if (filterBuilding !== 'all' && r.building !== filterBuilding) return false;
    if (filterYear !== 'all' && r.dueDate && !r.dueDate.startsWith(filterYear)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !r.contractRef.toLowerCase().includes(q) &&
        !r.tenant.toLowerCase().includes(q) &&
        !r.unit.toLowerCase().includes(q) &&
        !(r.description ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // Summary stats across all items (not filtered)
  // A replaced bounce is carried by the cheque that replaced it — counting it as
  // billed would show the same rent twice and depress the collection rate.
  const billable       = items.filter(r => r.status !== 'replaced');
  const totalAmount    = billable.reduce((s, r) => s + r.amount, 0);
  const totalReceived  = items.filter(r => r.status === 'received').reduce((s, r) => s + r.amount, 0);
  const totalOutstanding = billable.filter(r => r.status !== 'received').reduce((s, r) => s + r.amount, 0);
  const totalOverdue   = items.filter(r => r.status === 'overdue').reduce((s, r) => s + r.amount, 0);
  const collectionRate = totalAmount > 0 ? Math.round((totalReceived / totalAmount) * 100) : 0;

  const hasFilters = filterStatus !== 'all' || filterType !== 'all' || filterBuilding !== 'all' ||
    filterYear !== String(new Date().getFullYear()) || search !== '';
  const clearFilters = () => {
    setFilterStatus('all'); setFilterType('all'); setFilterBuilding('all');
    setFilterYear(String(new Date().getFullYear())); setSearch('');
  };

  const detail = detailId !== null ? items.find(r => r.id === detailId) ?? null : null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Receivables</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Track all rental payments and collection status.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] transition-colors disabled:opacity-50 cursor-pointer">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total Billed',     value: fmtAed(totalAmount),      sub: `${billable.length} records` },
          { label: 'Collected',        value: fmtAed(totalReceived),    sub: 'amount received' },
          { label: 'Outstanding',      value: fmtAed(totalOutstanding), sub: 'pending payment' },
          { label: 'Overdue',          value: fmtAed(totalOverdue),     sub: `${items.filter(r => r.status === 'overdue').length} records`, highlight: totalOverdue > 0 },
          { label: 'Collection Rate',  value: `${collectionRate}%`,     sub: 'of total billed' },
        ].map((s, i) => (
          <div key={i} className={`bg-white rounded-2xl p-5 shadow-sm border ${(s as any).highlight ? 'border-red-200' : 'border-[#f0ede8]'}`}>
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className={`font-bold text-xl mt-1 truncate ${(s as any).highlight ? 'text-red-600' : 'text-[#1a1916]'}`}>{s.value}</div>
            <div className="text-xs text-[#9b9890] mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 items-center mb-4 shadow-sm border border-[#f0ede8]">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input type="text" placeholder="Search contract, customer, unit…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
        </div>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
          <option value="all">All Years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
          <option value="all">All Statuses</option>
          {(Object.keys(STATUS_LABELS) as RecvStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
          <option value="all">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
        <span className="text-sm text-[#6b6860]">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        {filtered.length > 0 && (
          <span className="text-sm font-semibold text-[#1a1916]">
            {fmtAed(filtered.reduce((s, r) => s + r.amount, 0))}
          </span>
        )}
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
              <DirhamSign size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">
              {hasFilters ? 'No records match your filters.' : 'No receivables yet.'}
            </p>
            <p className="text-xs text-[#9b9890]">Payment instalments appear here once contracts are created.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[960px]">
              <thead>
                <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                  {['Contract', 'Building', 'Unit', 'Customer', 'Type', 'Amount', 'Due Date', 'Method', 'Overdue', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} onClick={() => setDetailId(r.id)}
                    className="border-b border-[#f0ede8] hover:bg-[#fafaf8] text-sm text-[#1a1916] cursor-pointer transition-colors">
                    <td className="px-4 py-3.5">
                      {r.contractRef
                        ? <span className="text-[#1a1916] font-medium">{r.contractRef}</span>
                        : <span className="text-[#9b9890]">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{r.building}</td>
                    <td className="px-4 py-3.5">{r.unit}</td>
                    <td className="px-4 py-3.5">{r.tenant}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className="px-4 py-3.5 font-semibold">{fmtAed(r.amount)}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{fmtDate(r.dueDate)}</td>
                    <td className="px-4 py-3.5 text-[#6b6860] capitalize">{r.paymentMethod?.replace('_', ' ') ?? '—'}</td>
                    <td className="px-4 py-3.5 text-red-600 font-medium text-xs">
                      {r.overdueDays > 0 ? `${r.overdueDays}d` : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[r.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetailId(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0]">
              <div>
                <p className="font-bold text-[#1a1916]">{TYPE_LABELS[detail.type] ?? detail.type}</p>
                <p className="text-xs text-[#9b9890] mt-0.5">{detail.contractRef} · {detail.unit}</p>
              </div>
              <button onClick={() => setDetailId(null)} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer p-1">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 flex-1 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full text-xs font-semibold px-3 py-1 ${STATUS_STYLE[detail.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                  {STATUS_LABELS[detail.status] ?? detail.status}
                </span>
                {detail.overdueDays > 0 && (
                  <span className="text-xs text-red-600 font-medium">{detail.overdueDays} days overdue</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Contract',    value: detail.contractRef },
                  { label: 'Building',    value: detail.building },
                  { label: 'Unit',        value: detail.unit },
                  { label: 'Customer',    value: detail.tenant },
                  { label: 'Amount',      value: fmtAed(detail.amount) },
                  { label: 'Due Date',    value: fmtDate(detail.dueDate) },
                  { label: 'Method',      value: detail.paymentMethod?.replace('_', ' ') ?? '—' },
                  { label: 'Cheque No.',  value: detail.chequeNumber ?? '—' },
                ].map(item => (
                  <div key={item.label} className="bg-[#f4f3ef] rounded-xl p-3">
                    <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1">{item.label}</p>
                    <p className="text-sm font-semibold text-[#1a1916] capitalize">{item.value}</p>
                  </div>
                ))}
              </div>
              {detail.description && (
                <div className="bg-[#f4f3ef] rounded-xl p-3">
                  <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-[#3d3b35]">{detail.description}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
