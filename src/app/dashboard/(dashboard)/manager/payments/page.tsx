'use client';

/**
 * Manager · Payments page
 *
 * Mirrors the landlord Payments ledger
 * (src/app/rental-provider/dashboard/payments/page.tsx) but:
 *   - Fetches the selected landlord's data via GET /manager/payments?rp=<id>.
 *     That endpoint calls the same contractsService.listPayments() the RP route
 *     uses, so the response shape is identical and the rendering is reused.
 *   - Is permission-gated per landlord on `canManageDeposits`, with a lock screen
 *     when the selected landlord hasn't delegated that permission.
 *   - Is READ-ONLY: managers can't reach /rental-provider/* routes, so the
 *     contract-ref is rendered as plain text and the deposit drawer passes
 *     links={null}.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, X, Wallet, Loader2, RefreshCw, Lock, Calendar, ExternalLink } from 'lucide-react';
import { apiGet } from '@/lib/api';
import DepositDetailModal, { type DepositDetail, type DepositRow } from '@/components/upnow/DepositDetailModal';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

type PaymentType = 'rental_income' | 'security_deposit' | 'ejari_fee' | 'admin_fee' | 'commission';

const TYPE_ORDER: PaymentType[] = ['rental_income', 'security_deposit', 'ejari_fee', 'admin_fee', 'commission'];
const TYPE_LABELS: Record<PaymentType, string> = {
  rental_income:    'Rental Income',
  security_deposit: 'Security Deposit',
  ejari_fee:        'Ejari Fee',
  admin_fee:        'Admin Fee',
  commission:       'Commission',
};

const STATUS_LABELS: Record<string, string> = {
  held:           'Held',
  returned:       'Returned',
  partial_return: 'Partial Return',
  forfeited:      'Forfeited',
  pending:        'Pending',
  cleared:        'Cleared',
  paid:           'Paid',
  bounced:        'Bounced',
  cancelled:      'Cancelled',
};

const STATUS_STYLE: Record<string, string> = {
  held:           'bg-[#d8f2e8] text-[#1a7a5a]',
  cleared:        'bg-[#d8f2e8] text-[#1a7a5a]',
  paid:           'bg-[#d8f2e8] text-[#1a7a5a]',
  returned:       'bg-[#dbeafe] text-[#1e40af]',
  partial_return: 'bg-[#fef3c7] text-[#92400e]',
  pending:        'bg-[#fef3c7] text-[#92400e]',
  forfeited:      'bg-[#fee2e2] text-[#b91c1c]',
  bounced:        'bg-[#fee2e2] text-[#b91c1c]',
  cancelled:      'bg-[#f4f3ef] text-[#6b6860]',
};

interface PaymentRow {
  id: string;
  paymentType: PaymentType;
  depositRef: string;
  contractRef: string;
  contractId: number | null;
  currentContractId: number | null;
  tenant: string;
  building: string;
  unit: string;
  amount: number;
  amountReceipt: number | null;
  vatAmount: number | null;
  description: string | null;
  recordedDate: string | null;
  transactionDate: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  fromYear: number | null;
  toYear: number | null;
  notes: string | null;
  settledRefundAmount: number | null;
  settledDeductionAmount: number | null;
  settledOn: string | null;
  settledViaSettlementId: number | null;
  proofs?: { documentKey: string; displayName: string | null; mimeType: string | null; fileUrl: string | null }[];
}

function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function yearMatch(
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

function allYears(rows: PaymentRow[]): number[] {
  const set = new Set<number>();
  for (const d of rows) {
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

export default function ManagerPaymentsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageDeposits)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageDeposits', effectiveRp);

  const [rows, setRows]       = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [filterType, setFilterType]         = useState('all');
  const [filterStatus, setFilterStatus]     = useState('all');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterYear, setFilterYear]         = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    if (effectiveRp == null || !allowed) { setRows([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const data = await apiGet<PaymentRow[]>(`/manager/payments?rp=${effectiveRp}`);
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load payments.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [effectiveRp, allowed]);

  const loadDepositDetail = useCallback(
    (id: string): Promise<DepositDetail> => apiGet<DepositDetail>(`/manager/deposits/${id}/detail?rp=${effectiveRp}`),
    [effectiveRp],
  );

  const years = useMemo(() => allYears(rows), [rows]);
  const yearScoped = useMemo(
    () => (filterYear === 'all' ? rows : rows.filter(d => yearMatch(d, Number(filterYear)))),
    [rows, filterYear],
  );

  // Per-landlord permission gate — mirrors the lock the nav enforces.
  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn’t granted you the <strong>Manage Deposits</strong> permission, so their payments aren’t available.
          </p>
        </div>
      </div>
    );
  }

  const buildings = [...new Set(rows.map(d => d.building).filter(b => b !== '—'))];
  const statuses  = [...new Set(yearScoped.map(d => d.status))];

  const filtered = yearScoped.filter(d => {
    if (filterType !== 'all' && d.paymentType !== filterType) return false;
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (filterBuilding !== 'all' && d.building !== filterBuilding) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !d.depositRef.toLowerCase().includes(q) &&
        !d.tenant.toLowerCase().includes(q) &&
        !d.unit.toLowerCase().includes(q) &&
        !d.contractRef.toLowerCase().includes(q) &&
        !(d.description ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const groups = TYPE_ORDER
    .map(type => {
      const groupRows = filtered.filter(r => r.paymentType === type);
      return {
        type,
        rows: groupRows,
        subtotal: groupRows.reduce((s, r) => s + r.amount, 0),
        vat: groupRows.reduce((s, r) => s + (r.vatAmount ?? 0), 0),
      };
    })
    .filter(g => g.rows.length > 0);

  const hasFilters = filterType !== 'all' || filterStatus !== 'all' || filterBuilding !== 'all' || search !== '';
  const clearFilters = () => { setFilterType('all'); setFilterStatus('all'); setFilterBuilding('all'); setSearch(''); };

  const sumOf = (t: PaymentType) => yearScoped.filter(d => d.paymentType === t).reduce((s, d) => s + d.amount, 0);
  const totalAmount      = yearScoped.reduce((s, d) => s + d.amount, 0);
  const rentalIncome     = sumOf('rental_income');
  const depositsHeld     = yearScoped.filter(d => d.paymentType === 'security_deposit' && d.status === 'held').reduce((s, d) => s + d.amount, 0);
  const managementIncome = sumOf('ejari_fee') + sumOf('admin_fee') + sumOf('commission');

  const detail = detailId !== null ? rows.find(d => d.id === detailId) ?? null : null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Payments</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Every payment across the landlord’s rental agreements — rent, deposits and fees in one ledger.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 pl-3 pr-1.5 h-[38px] rounded-xl border border-[#e8e6e0] bg-white text-[#6b6860]"
            title="Scope the page by lease year">
            <Calendar size={14} />
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} aria-label="Filter payments by year"
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
          { label: 'Total Payments',    value: fmtAed(totalAmount),      sub: filterYear === 'all' ? `${yearScoped.length} records` : `in ${filterYear}` },
          { label: 'Rental Income',     value: fmtAed(rentalIncome),     sub: 'rent collected' },
          { label: 'Deposits Held',     value: fmtAed(depositsHeld),     sub: 'currently held' },
          { label: 'Management Income', value: fmtAed(managementIncome), sub: 'ejari · admin · commission' },
          { label: 'Records',           value: String(yearScoped.length), sub: 'all types' },
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
          <input type="text" placeholder="Search ref, customer, unit, description…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
          <option value="all">All Types</option>
          {TYPE_ORDER.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        {statuses.length > 0 && (
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
            <option value="all">All Statuses</option>
            {statuses.map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </select>
        )}
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
        <span className="text-sm text-[#6b6860]">{filtered.length} payment{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Ledger */}
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
                ? `No payments for ${filterYear}.`
                : hasFilters ? 'No payments match your filters.' : 'No payments recorded yet.'}
            </p>
            <p className="text-xs text-[#9b9890]">
              {filterYear !== 'all' ? 'Switch to “All years” to see every payment.' : 'Payments are recorded from the contract detail page.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1000px]">
              <thead>
                <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                  {['Ref', 'Contract', 'Building', 'Unit', 'Customer', 'Description', 'Amount', 'VAT', 'Status', 'Date'].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <ManagerGroupBlock key={g.type} type={g.type} rows={g.rows} subtotal={g.subtotal} vat={g.vat} onRowClick={setDetailId} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <DepositDetailModal
          deposit={detail as DepositRow}
          loadDetail={loadDepositDetail}
          onClose={() => setDetailId(null)}
          links={null}
        />
      )}
    </div>
  );
}

/** Read-only group block for the manager view (contract ref is plain text). */
function ManagerGroupBlock({
  type, rows, subtotal, vat, onRowClick,
}: {
  type: PaymentType;
  rows: PaymentRow[];
  subtotal: number;
  vat: number;
  onRowClick: (id: string) => void;
}) {
  return (
    <>
      <tr className="bg-[#fbfaf7] border-b border-[#e8e6e0]">
        <td colSpan={6} className="px-4 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wide text-[#1a1916]">{TYPE_LABELS[type]}</span>
          <span className="ml-2 text-[11px] text-[#9b9890]">{rows.length} record{rows.length !== 1 ? 's' : ''}</span>
        </td>
        <td className="px-4 py-2.5 font-bold text-sm text-[#1a1916]">{fmtAed(subtotal)}</td>
        <td className="px-4 py-2.5 text-xs text-[#6b6860]">{vat > 0 ? fmtAed(vat) : '—'}</td>
        <td colSpan={2} />
      </tr>
      {rows.map(d => {
        const isDeposit = d.paymentType === 'security_deposit';
        return (
          <tr key={d.id}
            onClick={isDeposit ? () => onRowClick(d.id) : undefined}
            className={`border-b border-[#f0ede8] text-sm text-[#1a1916] transition-colors ${isDeposit ? 'hover:bg-[#fafaf8] cursor-pointer' : ''}`}>
            <td className="px-4 py-3.5 font-medium font-mono text-xs">{d.depositRef}</td>
            <td className="px-4 py-3.5">
              {d.contractRef ? <span className="text-[#3d3b35] font-medium">{d.contractRef}</span> : <span className="text-[#9b9890]">—</span>}
            </td>
            <td className="px-4 py-3.5 text-[#6b6860]">{d.building}</td>
            <td className="px-4 py-3.5">{d.unit}</td>
            <td className="px-4 py-3.5">{d.tenant}</td>
            <td className="px-4 py-3.5 text-[#6b6860] max-w-[220px] truncate" title={d.description ?? ''}>{d.description ?? '—'}</td>
            <td className="px-4 py-3.5 font-semibold">{fmtAed(d.amount)}</td>
            <td className="px-4 py-3.5 text-[#6b6860]">{d.vatAmount != null && d.vatAmount > 0 ? fmtAed(d.vatAmount) : '—'}</td>
            <td className="px-4 py-3.5">
              <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[d.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                {STATUS_LABELS[d.status] ?? d.status}
              </span>
            </td>
            <td className="px-4 py-3.5 text-[#6b6860] whitespace-nowrap">{fmtDate(d.transactionDate ?? d.recordedDate)}</td>
          </tr>
        );
      })}
    </>
  );
}
