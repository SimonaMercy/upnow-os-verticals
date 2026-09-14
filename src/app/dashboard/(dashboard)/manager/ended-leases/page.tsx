'use client';

/**
 * Manager · Ended Leases page
 *
 * Mirrors the landlord Ended Leases page
 * (src/app/rental-provider/dashboard/ended-leases/page.tsx) but:
 *   - Fetches the selected landlord's data via GET /manager/ended-leases?rp=<id>
 *     (same contractsService.listEndedLeaseCustomers() the RP route uses, so the
 *     row shape + rendering are reused verbatim).
 *   - Is permission-gated per landlord on `canManageAgreements`.
 *   - The lifecycle popup jumps out to the MANAGER routes (contract v2 / customer),
 *     scoped with ?rp=, so the modal's "open" links work for managers too.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Loader2, RefreshCw, Lock, Calendar, CalendarX } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type EndedCustomerRow, type EndedCustomerDetail } from '@/components/upnow/EndedLeaseDetailModal';
import SettlementStatementModal from '@/components/contract/SettlementStatementModal';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';

const OUTCOME_LABELS: Record<string, string> = { expired: 'Expired', terminated: 'Terminated' };
const OUTCOME_STYLE: Record<string, string> = {
  expired: 'bg-[#fef3c7] text-[#92400e]',
  terminated: 'bg-[#fee2e2] text-[#b91c1c]',
};
const DEPOSIT_LABELS: Record<string, string> = {
  held: 'Held', returned: 'Returned', partial_return: 'Part-returned', forfeited: 'Forfeited', none: '—',
};
const DEPOSIT_STYLE: Record<string, string> = {
  held: 'bg-[#d8f2e8] text-[#1a7a5a]',
  returned: 'bg-[#dbeafe] text-[#1e40af]',
  partial_return: 'bg-[#fef3c7] text-[#92400e]',
  forfeited: 'bg-[#fee2e2] text-[#b91c1c]',
  none: 'bg-[#f4f3ef] text-[#9b9890]',
};

function yearMatch(r: EndedCustomerRow, y: number): boolean {
  const s = r.startDate ? Number(r.startDate.slice(0, 4)) : -Infinity;
  const e = (r.endDate ?? r.latestEndDate) ? Number((r.endDate ?? r.latestEndDate)!.slice(0, 4)) : Infinity;
  return y >= s && y <= e;
}
function collectYears(rows: EndedCustomerRow[]): number[] {
  const set = new Set<number>();
  for (const r of rows) {
    if (r.startDate) set.add(Number(r.startDate.slice(0, 4)));
    const end = r.endDate ?? r.latestEndDate;
    if (end) set.add(Number(end.slice(0, 4)));
  }
  set.add(new Date().getFullYear());
  return [...set].filter(n => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
}

export default function ManagerEndedLeasesPage() {
  // Scoped to the landlord chosen in the LandlordSwitcher (?rp=). Under "All
  // landlords" with several to choose from, prompt for one rather than showing
  // an arbitrary landlord's ended leases.
  const { effectiveRp, allowed, permsLoading, needsLandlord, canForRp } = useManagerLandlordScope('canManageAgreements');

  const [rows, setRows] = useState<EndedCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('all');
  const [filterProperty, setFilterProperty] = useState('all');
  const [filterYear, setFilterYear] = useState('all');
  const [previewLeaseId, setPreviewLeaseId] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    if (effectiveRp == null || !allowed) { setRows([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const data = await apiGet<EndedCustomerRow[]>(`/manager/ended-leases?rp=${effectiveRp}`);
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load ended leases.');
    } finally {
      setLoading(false);
    }
  }, [effectiveRp, allowed]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(
    (id: number): Promise<EndedCustomerDetail> => apiGet<EndedCustomerDetail>(`/manager/ended-leases/${id}/detail?rp=${effectiveRp}`),
    [effectiveRp],
  );

  // Row click → open the final settlement statement directly.
  const openStatement = useCallback(async (row: EndedCustomerRow) => {
    setResolving(true);
    try {
      const detail = await loadDetail(row.customerId);
      const all = detail.lifecycles ?? [];
      // A row is ONE tenancy: open that tenancy's own settlement, matched on its
      // unit — the customer may have others, ended or still running.
      const own = row.unitId != null ? all.filter(l => l.unit?.id === row.unitId) : [];
      const lcs = own.length ? own : all;
      const withSettle = lcs.filter(l => l.settlement);
      const pool = withSettle.length ? withSettle : lcs;
      const target = pool.slice().sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))[0];
      // Same chain-vs-lease trap as the RP page: `leaseId` is the tenancy's latest-ENDING
      // lease, not the one holding the settlement. Open the settlement's own lease so the
      // worksheet matches what the customer sees in their portal.
      if (target) setPreviewLeaseId(target.settlement?.contractId ?? target.leaseId);
    } catch {
      /* transient — the user can click again */
    } finally {
      setResolving(false);
    }
  }, [loadDetail]);

  const years = useMemo(() => collectYears(rows), [rows]);
  const yearScoped = useMemo(
    () => (filterYear === 'all' ? rows : rows.filter(r => yearMatch(r, Number(filterYear)))),
    [rows, filterYear],
  );

  if (!permsLoading && needsLandlord) {
    return <SelectLandlordNotice resource="Ended leases" />;
  }

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
            This landlord hasn’t granted you the <strong>Manage Agreements</strong> permission, so their ended leases aren’t available.
          </p>
        </div>
      </div>
    );
  }

  const properties = [...new Set(yearScoped.map(r => r.lastProperty).filter(p => p && p !== '—'))];

  const filtered = yearScoped.filter(r => {
    if (filterOutcome !== 'all' && r.outcome !== filterOutcome) return false;
    if (filterProperty !== 'all' && r.lastProperty !== filterProperty) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [r.name, r.companyName, r.email, r.lastUnit, r.lastProperty, r.lastContractRef, r.emiratesId].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const hasFilters = filterOutcome !== 'all' || filterProperty !== 'all' || search !== '';
  const clearFilters = () => { setFilterOutcome('all'); setFilterProperty('all'); setSearch(''); };

  // One row per ended tenancy. Ended customers have EVERY tenancy ended — the
  // complement of the Customers page; a customer still renting another unit is
  // listed for the lease that ended but not counted here.
  const endedCustomers = new Set(yearScoped.filter(r => !r.customerStillActive).map(r => r.customerId)).size;
  const depositsToSettle = yearScoped.filter(r => r.depositStatus === 'held').length;
  const depositsSettled = yearScoped.filter(r => ['returned', 'partial_return', 'forfeited'].includes(r.depositStatus)).length;


  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Ended Leases</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Every lease that has ended — expired, or terminated with its settlement paid. Open one for its settlement statement.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 pl-3 pr-1.5 h-[38px] rounded-xl border border-[#e8e6e0] bg-white text-[#6b6860]" title="Scope by lease year">
            <Calendar size={14} />
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} aria-label="Filter by year"
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Ended Leases', value: String(yearScoped.length), sub: filterYear === 'all' ? 'all time' : `in ${filterYear}` },
          { label: 'Ended Customers', value: String(endedCustomers), sub: 'every lease ended' },
          { label: 'Deposits to Settle', value: String(depositsToSettle), sub: 'still held' },
          { label: 'Deposits Settled', value: String(depositsSettled), sub: 'returned / deducted' },
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
          <input type="text" placeholder="Search customer, unit, property, ref…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
        </div>
        <select value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
          <option value="all">All outcomes</option>
          <option value="expired">Expired</option>
          <option value="terminated">Terminated</option>
        </select>
        {properties.length > 0 && (
          <select value={filterProperty} onChange={e => setFilterProperty(e.target.value)}
            className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
            <option value="all">All properties</option>
            {properties.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">{filtered.length} ended lease{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#f0ede8]">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-[#2e9f82]" /></div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={load} className="text-xs text-[#2e9f82] font-medium hover:underline cursor-pointer">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#f4f3ef] flex items-center justify-center mb-4">
              <CalendarX size={24} className="text-[#6b6860]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">
              {filterYear !== 'all' ? `No ended leases for ${filterYear}.` : hasFilters ? 'No ended leases match your filters.' : 'No ended leases yet.'}
            </p>
            <p className="text-xs text-[#9b9890]">
              {filterYear !== 'all' ? 'Switch to “All years” to see every ended lease.' : 'A lease appears here once it expires, or once its termination settlement is paid.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[900px]">
              <thead>
                <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                  {['Customer', 'Property / Unit', 'Lease', 'Period', 'Ended On', 'Outcome', 'Deposit'].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={`${r.customerId}-${r.leaseId ?? r.lastContractRef}`} onClick={() => openStatement(r)}
                    className="border-b border-[#f0ede8] hover:bg-[#fafaf8] text-sm text-[#1a1916] cursor-pointer transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-medium">{(r.entityType === 'company' && r.companyName?.trim()) || r.name || '—'}</div>
                      <div className="text-xs text-[#9b9890]">{r.email || r.emiratesId || ''}</div>
                      {r.customerStillActive && (
                        <span className="inline-flex mt-1 rounded-full text-[10px] font-semibold px-2 py-0.5 bg-[#d8f2e8] text-[#1a7a5a]" title="This customer still rents another unit">
                          Still a customer
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-[#6b6860]">
                      <div>{r.lastProperty}</div>
                      <div className="text-xs text-[#9b9890]">Unit {r.lastUnit}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-[#6b6860]">
                      {r.lastContractRef}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[#6b6860]">{r.startDate?.slice(0, 10) ?? '—'} → {r.endDate?.slice(0, 10) ?? '—'}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{r.latestEndDate?.slice(0, 10) ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${OUTCOME_STYLE[r.outcome] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                        {OUTCOME_LABELS[r.outcome] ?? r.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${DEPOSIT_STYLE[r.depositStatus] ?? DEPOSIT_STYLE.none}`}>
                        {DEPOSIT_LABELS[r.depositStatus] ?? r.depositStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resolving && (
        <div className="fixed inset-0 z-[55] bg-black/30 backdrop-blur-sm grid place-items-center">
          <div className="flex items-center gap-2 text-white text-sm font-medium"><Loader2 className="animate-spin" size={22} /> Opening settlement…</div>
        </div>
      )}

      {previewLeaseId != null && (
        <SettlementStatementModal
          contractId={previewLeaseId}
          onClose={() => setPreviewLeaseId(null)}
          links={{
            contract: `/dashboard/manager/contracts/${previewLeaseId}/v2?rp=${effectiveRp}`,
            payments: `/dashboard/manager/payments?rp=${effectiveRp}`,
            deposits: `/dashboard/manager/deposits?rp=${effectiveRp}`,
            // The worksheet starts the deposit-settlement mutate flow — only
            // expose it to a manager who can settle (or terminate) on this
            // landlord. Undefined ⇒ the modal/statement omit the link.
            worksheet: (effectiveRp != null && (canForRp('canSettleDeposits', effectiveRp) || canForRp('canManageTermination', effectiveRp)))
              ? `/dashboard/manager/contracts/${previewLeaseId}/settlement?rp=${effectiveRp}`
              : undefined,
          }}
        />
      )}
    </div>
  );
}
