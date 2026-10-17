'use client';

/**
 * Demand › Customers — one party record per person (Genspark Stage 2 "UpNow OS").
 *
 * The list is DERIVED client-side from the flat /contracts feed (backend
 * `listForRp`, which also returns per-lease rent arrears) via the shared
 * deriveCustomers() — the same derivation the manager mirror uses. The manager
 * page (/dashboard/manager/tenants) still renders the shared CustomersDirectory
 * and is untouched; only this RP composition changed.
 *
 * Parity with previous page (tenants/page.tsx + the shared CustomersDirectory it rendered):
 *  - GET /api/contracts → deriveCustomers() (one row per customer; company shown by
 *    company name; active = holds a counting lease).                                  ✔ kept
 *  - Search by name, email or phone.                                                   ✔ kept
 *  - Filter: All customers · Individual · Companies · Ended leases (Ended shows the
 *    customers with no counting lease; the others work inside the active pool).        ✔ kept (Seg, with counts)
 *  - Row · Grid views.                                                                 ✔ kept (Table · Cards)
 *  - KPIs: Total customers (holding a live lease), Active leases.                      ✔ kept (+ Outstanding, Renewals ≤ 90d)
 *  - Row data: avatar initials, name, Company/Individual, lease count, active count,
 *    email, phone, outstanding (AED; "fully collected" / "across active units" /
 *    "on ended leases"), renewal countdown ("Renews in Nd" / "Renewal overdue Nd").    ✔ kept
 *  - Result count "N of M customers" / "ended-lease customers".                        ✔ kept
 *  - Per-row View → /rental-provider/dashboard/tenants/:id.                             ✔ kept (labelled "Open")
 *  - Empty state ("Customers appear here once you have a rental agreement."), filtered
 *    empty state with "Clear filters", "No ended-lease customers" variant.             ✔ kept
 *  - "Add customer" → CustomerForm (reused as-is) POST /api/contracts/tenants; on done,
 *    go to /rental-provider/dashboard/contracts/new?tenantId=…&tenantName=… (prefilled
 *    from tenantDisplayName).                                                          ✔ kept (in kit Modal)
 *  - New: load failure shows an error row with retry (previously swallowed as empty).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  Btn, Card, ErrorRow, Kpi, Kpis, Modal, OsPage, PageHead, Pill, ScopeStrip, SearchField, Seg, SkeletonRows,
  TableWrap, fmtAed, initials,
} from '@/components/os/kit';
import { CustomerForm } from '@/components/upnow/CustomerForm';
import { deriveCustomers, renewalDaysOf, type DirectoryContractRow, type DirectoryCustomer } from '@/lib/customersDirectory';
import { tenantDisplayName } from '@/lib/tenantName';

type Filter = 'all' | 'individual' | 'company' | 'ended';
type View = 'table' | 'cards';

const viewHref = (id: number) => `/rental-provider/dashboard/tenants/${id}`;

function renewalText(c: DirectoryCustomer): string {
  const d = renewalDaysOf(c.nextRenewalEnd);
  if (d === null) return 'No renewal date';
  if (d < 0) return `Renewal overdue ${Math.abs(d)}d`;
  return `Renews in ${d}d`;
}
const hasOutstanding = (c: DirectoryCustomer) => Math.round(c.outstanding) > 0;
const outstandingNote = (c: DirectoryCustomer) =>
  !hasOutstanding(c) ? 'fully collected' : c.active ? 'across active units' : 'on ended leases';

function StatusOf({ c }: { c: DirectoryCustomer }) {
  if (!c.active) return <Pill tone="neutral">Ended</Pill>;
  const d = renewalDaysOf(c.nextRenewalEnd);
  if (d !== null && d < 0) return <Pill tone="danger">Renewal overdue</Pill>;
  if (d !== null && d <= 90) return <Pill tone="amber">Renewal due</Pill>;
  return <Pill tone="primary">Active lease</Pill>;
}

export default function TenantsPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<DirectoryCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [showAdd, setShowAdd] = useState(false);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('table');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/contracts', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data: DirectoryContractRow[] = await r.json();
        if (!cancelled) { setCustomers(Array.isArray(data) ? deriveCustomers(data) : []); setFailed(false); }
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);
  const reload = useCallback(() => { setLoading(true); setFailed(false); setTick((t) => t + 1); }, []);

  const activePool = useMemo(() => customers.filter((c) => c.active), [customers]);
  const endedPool = useMemo(() => customers.filter((c) => !c.active), [customers]);
  const scope = filter === 'ended' ? endedPool : activePool;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scope.filter((c) => {
      if (filter === 'individual' && c.company) return false;
      if (filter === 'company' && !c.company) return false;
      return !q || `${c.name} ${c.email} ${c.phone ?? ''}`.toLowerCase().includes(q);
    });
  }, [scope, query, filter]);

  // KPIs — the active pool (platform current-lease rule), independent of filters.
  const activeLeases = activePool.reduce((s, c) => s + c.activeLeaseCount, 0);
  const outstandingTotal = activePool.reduce((s, c) => s + c.outstanding, 0);
  const owing = activePool.filter(hasOutstanding).length;
  const renewalsDue = activePool.filter((c) => { const d = renewalDaysOf(c.nextRenewalEnd); return d !== null && d <= 90; }).length;

  const filtersDirty = !!query || filter !== 'all';
  const clearFilters = () => { setQuery(''); setFilter('all'); };
  const dash = (v: string | number) => (loading ? '…' : v);

  const emptyBlock = (cols: number) => {
    if (customers.length === 0) {
      return (
        <tbody><tr><td colSpan={cols}><div className="gx-empty">
          <b>No customers yet</b>Customers appear here once you have a rental agreement.
          <div style={{ marginTop: 8 }}><Btn size="sm" variant="primary" onClick={() => setShowAdd(true)}>Add customer</Btn></div>
        </div></td></tr></tbody>
      );
    }
    const noEnded = filter === 'ended' && scope.length === 0;
    return (
      <tbody><tr><td colSpan={cols}><div className="gx-empty">
        <b>{noEnded ? 'No ended-lease customers' : 'No customers match your search'}</b>
        {noEnded ? 'Every customer still holds a counting lease.' : 'Try a different name, email, or filter.'}
        {filtersDirty && <div style={{ marginTop: 8 }}><Btn size="sm" onClick={clearFilters}>Clear filters</Btn></div>}
      </div></td></tr></tbody>
    );
  };

  const toolbar = (
    <>
      <SearchField value={query} onChange={setQuery} placeholder="Search by name, email or phone…" />
      <Seg<Filter> label="Filter customers" value={filter} onChange={setFilter} options={[
        { v: 'all', l: 'All customers', n: loading ? undefined : activePool.length },
        { v: 'individual', l: 'Individual', n: loading ? undefined : activePool.filter((c) => !c.company).length },
        { v: 'company', l: 'Companies', n: loading ? undefined : activePool.filter((c) => c.company).length },
        { v: 'ended', l: 'Ended leases', n: loading ? undefined : endedPool.length },
      ]} />
      <span className="sp" />
      <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>
        <strong>{loading ? '…' : list.length}</strong> of {scope.length} {filter === 'ended' ? 'ended-lease customers' : 'customers'}
      </span>
      <Seg<View> label="View" value={view} onChange={setView} options={[{ v: 'table', l: 'Table' }, { v: 'cards', l: 'Cards' }]} />
    </>
  );

  const COLS = 6;

  return (
    <OsPage>
      <PageHead
        eyebrow="Demand"
        title="Customers"
        lede="One record per person or company you hold a lease with — including a renewal still in flight on a unit they occupy. Switch to “Ended leases” for the rest."
        actions={<Btn variant="primary" onClick={() => setShowAdd(true)}><Plus size={13} aria-hidden /> Add customer</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Demand' },
        { label: 'Customers', value: loading ? '…' : `${activePool.length} active · ${endedPool.length} ended` },
        { label: 'Data', value: 'Live' },
      ]} />

      <Kpis>
        <Kpi k="Total customers" v={dash(activePool.length)} d="Holding a live lease" />
        <Kpi k="Active leases" v={dash(activeLeases)} d="Neither ended nor terminated" />
        <Kpi dark k="Outstanding" v={dash(fmtAed(outstandingTotal))} d={loading ? undefined : `${owing} customer${owing !== 1 ? 's' : ''} owing, across active units`} />
        <Kpi k="Renewals ≤ 90 days" v={dash(renewalsDue)} d="Including overdue renewals" />
      </Kpis>

      {view === 'table' ? (
        <TableWrap toolbar={toolbar}>
          <table className="gx-tbl">
            <thead>
              <tr>
                <th>Customer</th><th>Role here</th><th>Relation</th><th className="num">Outstanding</th><th>Status</th>
                <th className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {loading ? <SkeletonRows rows={6} cols={COLS} />
              : failed ? <ErrorRow cols={COLS} onRetry={reload} />
              : list.length === 0 ? emptyBlock(COLS)
              : (
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} className="click" onClick={() => router.push(viewHref(c.id))}>
                      <td>
                        <div className="gx-cell">
                          <span className="gx-thumb" aria-hidden>{initials(c.name)}</span>
                          <span>
                            <span className="strong">{c.name}</span>
                            <span className="sub">{c.email || '—'}{c.phone ? ` · ${c.phone}` : ''}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <Pill tone={c.company ? 'amber' : 'outline'} dot={false}>{c.company ? 'Company' : 'Individual'}</Pill>
                        <span className="sub">Customer</span>
                      </td>
                      <td>
                        <span className="strong">{c.leaseCount} lease{c.leaseCount === 1 ? '' : 's'}</span>
                        <span style={{ color: 'var(--ms-primary-dark)', fontWeight: 600 }}> · {c.activeLeaseCount} active</span>
                        <span className="sub">{renewalText(c)}</span>
                      </td>
                      <td className="num">
                        <span className="strong" style={hasOutstanding(c) ? { color: 'var(--ms-danger)' } : undefined}>
                          {hasOutstanding(c) ? fmtAed(c.outstanding) : 'AED 0'}
                        </span>
                        <span className="sub">{outstandingNote(c)}</span>
                      </td>
                      <td><StatusOf c={c} /></td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <Btn size="sm" href={viewHref(c.id)}>Open</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
          </table>
        </TableWrap>
      ) : (
        <>
          <div className="gx-tbl-wrap" style={{ marginBottom: 12 }}><div className="gx-tbar">{toolbar}</div></div>
          {loading || failed || list.length === 0 ? (
            <Card>
              <table className="gx-tbl">
                {loading ? <SkeletonRows rows={4} cols={3} /> : failed ? <ErrorRow cols={1} onRetry={reload} /> : emptyBlock(1)}
              </table>
            </Card>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
              {list.map((c) => (
                <Card key={c.id} pad>
                  <div className="gx-cell">
                    <span className="gx-thumb" aria-hidden>{initials(c.name)}</span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontWeight: 700, color: 'var(--ms-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      <Pill tone={c.company ? 'amber' : 'outline'} dot={false}>{c.company ? 'Company' : 'Individual'}</Pill>
                    </span>
                    <StatusOf c={c} />
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ms-ink-2)', marginTop: 10, lineHeight: 1.6 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || '—'}</div>
                    <div>{c.phone || '—'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, fontSize: 11.5 }}>
                    <div>
                      <div className="gx-lb" style={{ marginBottom: 2 }}>Leases</div>
                      <b>{c.leaseCount}</b> <span style={{ color: 'var(--ms-primary-dark)' }}>· {c.activeLeaseCount} active</span>
                    </div>
                    <div>
                      <div className="gx-lb" style={{ marginBottom: 2 }}>Outstanding</div>
                      <b style={hasOutstanding(c) ? { color: 'var(--ms-danger)' } : undefined}>{hasOutstanding(c) ? fmtAed(c.outstanding) : 'AED 0'}</b>
                      <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>{outstandingNote(c)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>{renewalText(c)}</span>
                    <Btn size="sm" href={viewHref(c.id)}>Open</Btn>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add a new customer" width={520}>
        <CustomerForm
          mode="create"
          submitUrl="/api/contracts/tenants"
          method="POST"
          onCancel={() => setShowAdd(false)}
          onDone={(r) => {
            setShowAdd(false);
            // New customers have no contract yet (so the contract-scoped list/detail
            // won't show them); take the RP straight to the contract wizard, prefilled.
            const label = tenantDisplayName(r);
            if (r.tenantId) router.push(`/rental-provider/dashboard/contracts/new?tenantId=${r.tenantId}${label ? `&tenantName=${encodeURIComponent(label)}` : ''}`);
          }}
        />
      </Modal>
    </OsPage>
  );
}
