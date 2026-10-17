'use client';

/**
 * Ended Leases (RP) — Operations › Long-term leases › Ended (Genspark OS layout).
 *
 * Every tenancy that has ended: expired, or terminated with its settlement paid (a
 * wind-down stays on Operations until then). One row per tenancy, including one whose
 * customer still rents another unit. Row click opens that tenancy's settlement statement.
 *
 * Parity with previous page:
 *  - [x] GET /api/contracts/ended-leases — the rows; Refresh button re-fetches.
 *  - [x] GET /api/contracts/ended-leases/:customerId/detail — resolves the lease that holds the
 *        settlement (same unit-match → settlement → latest-ending rule, settlement.contractId first).
 *  - [x] Year filter (term overlaps year; "All years" default) scoping KPIs, filters and table.
 *  - [x] KPIs: Ended leases, Ended customers, Top move-out reason (N of M recorded),
 *        Deposits to settle, Deposits settled.
 *  - [x] Filters: search (name, company, email, unit, property, ref, Emirates ID), outcome,
 *        property (only when there are properties), Reset; "N ended leases" count.
 *  - [x] Table: Customer (+ "Still a customer"), Property / Unit, Lease ref, Period, Ended on,
 *        Outcome, Move-out reason (side dot), Deposit. Row click → settlement statement; now also a
 *        labelled "Statement" button per row.
 *  - [x] "Opening settlement…" overlay while resolving; SettlementStatementModal with the same links
 *        (contract v2, payments, deposits, settlement worksheet).
 *  - [x] Loading / error (retry) / empty states with the same copy.
 *  - Manager variant (/dashboard/manager/ended-leases) is a separate page and is unaffected.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { type EndedCustomerRow, type EndedCustomerDetail } from '@/components/upnow/EndedLeaseDetailModal';
import SettlementStatementModal from '@/components/contract/SettlementStatementModal';
import { moveOutReasonLabel, moveOutReasonSide } from '@/lib/moveOutReasons';
import {
  OsPage, PageHead, ScopeStrip, Kpis, Kpi, Pill, Btn, TableWrap, SearchField, SkeletonRows, EmptyRow, ErrorRow,
  type Tone,
} from '@/components/os/kit';

const OUTCOME_LABELS: Record<string, string> = { expired: 'Expired', terminated: 'Terminated' };
const OUTCOME_TONE: Record<string, Tone> = { expired: 'amber', terminated: 'danger' };
/** Fill for the reason dot — the side that drove the exit. Matches the
 *  Move-out Reasons report so the two surfaces read as one thing. */
const SIDE_DOT: Record<string, string> = {
  customer: '#047246', landlord: '#6b6ad8', breach: '#c9553f',
};
const DEPOSIT_LABELS: Record<string, string> = {
  held: 'Held', returned: 'Returned', partial_return: 'Part-returned', forfeited: 'Forfeited', none: '—',
};
const DEPOSIT_TONE: Record<string, Tone> = {
  held: 'primary', returned: 'info', partial_return: 'amber', forfeited: 'danger', none: 'neutral',
};

/** A tenancy belongs to year Y if its term overlaps Y. */
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

  // Async-only state updates so it can run from the mount effect.
  const fetchRows = useCallback(() => {
    fetch('/api/contracts/ended-leases', { credentials: 'include' })
      .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json(); })
      .then((data: EndedCustomerRow[]) => { setRows(data); setError(null); })
      .catch(() => setError('Failed to load ended leases.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { fetchRows(); }, [fetchRows]);
  const load = () => { setLoading(true); setError(null); fetchRows(); };

  const loadDetail = useCallback(async (id: number): Promise<EndedCustomerDetail> => {
    const res = await fetch(`/api/contracts/ended-leases/${id}/detail`, { credentials: 'include' });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }, []);

  // Row click → open the final settlement statement directly. Resolve the lease
  // that holds the settlement (or the most recent tenancy) from the lifecycle.
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
      // A tenancy is a renewal CHAIN but the settlement lives on ONE lease of it, and
      // `leaseId` is the chain's latest-ENDING lease — which for a cancelled renewal is a
      // term nobody ever occupied. Always prefer the lease the settlement is actually on.
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
      const hay = [r.name, r.companyName, r.email, r.lastUnit, r.lastProperty, r.lastContractRef, r.emiratesId].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const hasFilters = filterOutcome !== 'all' || filterProperty !== 'all' || search !== '';
  const clearFilters = () => { setFilterOutcome('all'); setFilterProperty('all'); setSearch(''); };

  // One row per ended tenancy. Ended customers have EVERY tenancy ended — the
  // complement of the Customers page.
  const endedCustomers = new Set(yearScoped.filter(r => !r.customerStillActive).map(r => r.customerId)).size;
  const depositsToSettle = yearScoped.filter(r => r.depositStatus === 'held').length;
  const depositsSettled = yearScoped.filter(r => ['returned', 'partial_return', 'forfeited'].includes(r.depositStatus)).length;
  // Most common recorded move-out reason; rows with no code are excluded from the ranking,
  // and the KPI names how many are recorded so it isn't mistaken for full coverage.
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

  const COLS = 9;

  return (
    <OsPage>
      <PageHead
        eyebrow="Operations › Long-term leases"
        title="Ended leases"
        lede="Every lease that has ended — expired, or terminated with its settlement paid. Open one for its settlement statement."
        actions={<>
          <select className="gx-sel" value={filterYear} onChange={e => setFilterYear(e.target.value)} aria-label="Filter by year" title="Scope by lease year">
            <option value="all">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Btn onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Btn>
        </>}
      />

      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Spaces · Long-term leases' },
        { label: 'Scope', value: filterYear === 'all' ? 'All years' : filterYear },
      ]} />

      <Kpis>
        <Kpi k="Ended leases" v={loading ? '…' : yearScoped.length} d={filterYear === 'all' ? 'all time' : `in ${filterYear}`} />
        <Kpi k="Ended customers" v={loading ? '…' : endedCustomers} d="every lease ended" />
        <Kpi k="Top move-out reason" v={<span style={{ fontSize: 14 }} title={topReason?.label}>{loading ? '…' : topReason?.label ?? '—'}</span>}
          d={topReason ? `${topReason.count} of ${withReason} recorded` : 'none recorded yet'} />
        <Kpi k="Deposits to settle" v={loading ? '…' : depositsToSettle} d="still held" dark />
        <Kpi k="Deposits settled" v={loading ? '…' : depositsSettled} d="returned / deducted" />
      </Kpis>

      <TableWrap toolbar={<>
        <SearchField value={search} onChange={setSearch} placeholder="Search customer, unit, property, ref…" />
        <select className="gx-sel" value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)} aria-label="Filter by outcome">
          <option value="all">All outcomes</option>
          <option value="expired">Expired</option>
          <option value="terminated">Terminated</option>
        </select>
        {properties.length > 0 && (
          <select className="gx-sel" value={filterProperty} onChange={e => setFilterProperty(e.target.value)} aria-label="Filter by property">
            <option value="all">All properties</option>
            {properties.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {hasFilters && <Btn size="sm" variant="ghost" onClick={clearFilters}>Reset</Btn>}
        <span className="sp" />
        <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>{filtered.length} ended lease{filtered.length !== 1 ? 's' : ''}</span>
      </>}>
        <table className="gx-tbl">
          <thead>
            <tr>
              <th>Customer</th><th>Property / Unit</th><th>Lease</th><th>Period</th><th>Ended on</th>
              <th>Outcome</th><th>Move-out reason</th><th>Deposit</th><th className="act">Actions</th>
            </tr>
          </thead>
          {loading ? <SkeletonRows rows={6} cols={COLS} /> : error ? <ErrorRow cols={COLS} onRetry={load} /> : filtered.length === 0 ? (
            <EmptyRow
              cols={COLS}
              title={filterYear !== 'all' ? `No ended leases for ${filterYear}.` : hasFilters ? 'No ended leases match your filters.' : 'No ended leases yet.'}
              text={filterYear !== 'all' ? ' Switch to “All years” to see every ended lease.' : ' A lease appears here once it expires, or once its termination settlement is paid.'}
            />
          ) : (
            <tbody>
              {filtered.map(r => (
                <tr key={`${r.customerId}-${r.leaseId ?? r.lastContractRef}`} className="click" onClick={() => openStatement(r)}>
                  <td>
                    <span className="strong">{(r.entityType === 'company' && r.companyName?.trim()) || r.name || '—'}</span>
                    <span className="sub">{r.email || r.emiratesId || ''}</span>
                    {r.customerStillActive && (
                      <span className="sub"><Pill tone="primary" title="This customer still rents another unit">Still a customer</Pill></span>
                    )}
                  </td>
                  <td>{r.lastProperty}<span className="sub">Unit {r.lastUnit}</span></td>
                  <td className="mono">{r.lastContractRef}</td>
                  <td className="nowrap">{r.startDate?.slice(0, 10) ?? '—'} → {r.endDate?.slice(0, 10) ?? '—'}</td>
                  <td className="nowrap">{r.latestEndDate?.slice(0, 10) ?? '—'}</td>
                  <td><Pill tone={OUTCOME_TONE[r.outcome] ?? 'neutral'}>{OUTCOME_LABELS[r.outcome] ?? r.outcome}</Pill></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: SIDE_DOT[moveOutReasonSide(r.moveOutReasonCode) ?? ''] ?? '#d6d3cc' }} />
                      <span style={r.moveOutReasonCode ? undefined : { fontStyle: 'italic', color: 'var(--ms-ink-3)' }}>
                        {moveOutReasonLabel(r.moveOutReasonCode)}
                      </span>
                    </span>
                  </td>
                  <td><Pill tone={DEPOSIT_TONE[r.depositStatus] ?? 'neutral'}>{DEPOSIT_LABELS[r.depositStatus] ?? r.depositStatus}</Pill></td>
                  <td className="act" onClick={e => e.stopPropagation()}>
                    <Btn size="xs" variant="primary" onClick={() => openStatement(r)} disabled={resolving}>Statement</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </TableWrap>

      {resolving && (
        <div className="fixed inset-0 z-[55] bg-black/30 backdrop-blur-sm grid place-items-center" role="status">
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
    </OsPage>
  );
}
