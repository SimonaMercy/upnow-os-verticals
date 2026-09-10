'use client';

/**
 * Ended Leases (RP) — every customer whose tenancies have ALL ended (no active
 * or pending lease). Row click opens the full lifecycle popup: lease history,
 * move-in/out, deposit + settlement, documents. Mirrors the Security Deposits
 * page (year filter + summary cards + filterable table + big popup).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Archive, Loader2, RefreshCw, Calendar, CalendarX } from 'lucide-react';
import { type EndedCustomerRow, type EndedCustomerDetail } from '@/components/upnow/EndedLeaseDetailModal';
import SettlementStatementModal from '@/components/contract/SettlementStatementModal';
import { moveOutReasonLabel, moveOutReasonSide } from '@/lib/moveOutReasons';

const OUTCOME_LABELS: Record<string, string> = { expired: 'Expired', terminated: 'Terminated' };
/** Fill for the reason dot — the side that drove the exit. Matches the
 *  Move-out Reasons report so the two surfaces read as one thing. */
const SIDE_DOT: Record<string, string> = {
  customer: '#2e9f82', landlord: '#6b6ad8', breach: '#c9553f',
};
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

/** A customer belongs to year Y if their most-recent ended tenancy's term overlaps Y. */
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

export default function EndedLeasesPage() {
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
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/contracts/ended-leases', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      setRows(await res.json());
    } catch {
      setError('Failed to load ended leases.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id: number): Promise<EndedCustomerDetail> => {
    const res = await fetch(`/api/contracts/ended-leases/${id}/detail`, { credentials: 'include' });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }, []);

  // Row click → open the final settlement statement directly. Resolve the lease
  // that holds the settlement (or the most recent tenancy) from the lifecycle.
  const openStatement = useCallback(async (customerId: number) => {
    setResolving(true);
    try {
      const detail = await loadDetail(customerId);
      const lcs = detail.lifecycles ?? [];
      const withSettle = lcs.filter(l => l.settlement);
      const pool = withSettle.length ? withSettle : lcs;
      const target = pool.slice().sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))[0];
      // A tenancy is a renewal CHAIN but the settlement lives on ONE lease of it, and
      // `leaseId` is the chain's latest-ENDING lease — which for a cancelled renewal is a
      // term nobody ever occupied. Opening that lease finds no settlement row and the API
      // seeds a phantom draft off the wrong chain tip (different deposit, different
      // penalties), so the worksheet contradicted the customer's portal. Always prefer the
      // lease the settlement is actually on.
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
  const properties = useMemo(
    () => [...new Set(yearScoped.map(r => r.lastProperty).filter(p => p && p !== '—'))],
    [yearScoped],
  );

  const filtered = yearScoped.filter(r => {
    if (filterOutcome !== 'all' && r.outcome !== filterOutcome) return false;
    if (filterProperty !== 'all' && r.lastProperty !== filterProperty) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [r.name, r.email, r.lastUnit, r.lastProperty, r.lastContractRef, r.emiratesId].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const hasFilters = filterOutcome !== 'all' || filterProperty !== 'all' || search !== '';
  const clearFilters = () => { setFilterOutcome('all'); setFilterProperty('all'); setSearch(''); };

  // Summary — scoped to the selected year.
  const endedLeaseTotal = yearScoped.reduce((s, r) => s + r.endedLeaseCount, 0);
  const depositsToSettle = yearScoped.filter(r => r.depositStatus === 'held').length;
  const depositsSettled = yearScoped.filter(r => ['returned', 'partial_return', 'forfeited'].includes(r.depositStatus)).length;
  // The single most common recorded move-out reason for the scoped year. Rows
  // with no code are excluded from the RANKING (they'd always win on volume for
  // historic years) but the card names how many they are, so the headline is
  // never mistaken for full coverage.
  const topReason = useMemo(() => {
    const tally = new Map<string, number>();
    for (const r of yearScoped) {
      if (!r.moveOutReasonCode) continue;
      tally.set(r.moveOutReasonCode, (tally.get(r.moveOutReasonCode) ?? 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? { label: moveOutReasonLabel(best[0]), count: best[1] } : null;
  }, [yearScoped]);
  const withReason = yearScoped.filter(r => !!r.moveOutReasonCode).length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Ended Leases</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Customers whose tenancies have all ended — open one for the full lifecycle.</p>
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Ended Customers', value: String(yearScoped.length), sub: filterYear === 'all' ? 'all time' : `in ${filterYear}` },
          { label: 'Ended Leases', value: String(endedLeaseTotal), sub: 'tenancies' },
          { label: 'Top Move-out Reason', value: topReason?.label ?? '—', sub: topReason ? `${topReason.count} of ${withReason} recorded` : 'none recorded yet', small: true },
          { label: 'Deposits to Settle', value: String(depositsToSettle), sub: 'still held' },
          { label: 'Deposits Settled', value: String(depositsSettled), sub: 'returned / deducted' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm border border-[#f0ede8]">
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            {/* A reason is a phrase, not a figure — it gets a readable size
                instead of the tile's headline number treatment. */}
            <div className={`font-bold text-[#1a1916] mt-1 truncate ${'small' in s && s.small ? 'text-sm leading-6' : 'text-xl'}`} title={s.value}>{s.value}</div>
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
        <span className="text-sm text-[#6b6860]">{filtered.length} customer{filtered.length !== 1 ? 's' : ''}</span>
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
              {filterYear !== 'all' ? `No ended leases for ${filterYear}.` : hasFilters ? 'No customers match your filters.' : 'No ended leases yet.'}
            </p>
            <p className="text-xs text-[#9b9890]">
              {filterYear !== 'all' ? 'Switch to “All years” to see every ended customer.' : 'Customers appear here once all their leases have ended.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[900px]">
              <thead>
                <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                  {['Customer', 'Last Property / Unit', 'Last Lease', 'Period', 'Ended On', 'Outcome', 'Move-out reason', 'Deposit'].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.customerId} onClick={() => openStatement(r.customerId)}
                    className="border-b border-[#f0ede8] hover:bg-[#fafaf8] text-sm text-[#1a1916] cursor-pointer transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-medium">{r.name || '—'}</div>
                      <div className="text-xs text-[#9b9890]">{r.email || r.emiratesId || ''}</div>
                    </td>
                    <td className="px-4 py-3.5 text-[#6b6860]">
                      <div>{r.lastProperty}</div>
                      <div className="text-xs text-[#9b9890]">Unit {r.lastUnit}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-[#6b6860]">
                      {r.lastContractRef}
                      {r.endedLeaseCount > 1 && <span className="ml-1 text-[#9b9890]">+{r.endedLeaseCount - 1}</span>}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[#6b6860]">{r.startDate?.slice(0, 10) ?? '—'} → {r.endDate?.slice(0, 10) ?? '—'}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{r.latestEndDate?.slice(0, 10) ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${OUTCOME_STYLE[r.outcome] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                        {OUTCOME_LABELS[r.outcome] ?? r.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-[2px] shrink-0"
                          style={{ background: SIDE_DOT[moveOutReasonSide(r.moveOutReasonCode) ?? ''] ?? '#d6d3cc' }} />
                        <span className={r.moveOutReasonCode ? 'text-[#3d3b35]' : 'text-[#9b9890] italic'}>
                          {moveOutReasonLabel(r.moveOutReasonCode)}
                        </span>
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
            contract: `/rental-provider/dashboard/contracts/${previewLeaseId}/v2`,
            payments: `/rental-provider/dashboard/payments`,
            deposits: `/rental-provider/dashboard/deposits`,
            worksheet: `/rental-provider/dashboard/contracts/${previewLeaseId}/settlement`,
          }}
        />
      )}
    </div>
  );
}
