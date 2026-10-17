'use client';

/**
 * Finance › Receivables — Genspark OS rebuild.
 *
 * Parity with previous page (every item kept, same endpoint and payload):
 *  - GET /api/contracts/receivables (credentials: include). Amounts are AED numbers
 *    (NOT fils) — shown with fmtAed; totals summed in integer fils.
 *  - Refresh button.
 *  - Summary: Total Billed (records count), Collected, Outstanding, Overdue (records
 *    count, highlighted when > 0), Collection Rate. 'replaced' rows (a bounced cheque made
 *    good by another) count toward none of the totals.
 *  - Filters: search (contract ref, customer, unit, description), year (defaults to the
 *    current year; "All years"; years from due dates + current year), status (all /
 *    scheduled / due today / overdue / received / replaced — now a Seg with counts),
 *    type (Rent / Admin Fee / Deposit / Contract Registration Fee / Maintenance / Other),
 *    building (only when any); Reset (back to current year).
 *  - "N records" + filtered total.
 *  - Table: Contract (link → /rental-provider/dashboard/contracts/:id/v2), Building, Unit,
 *    Customer, Type, Amount, Due Date, Method, Overdue days, Status; row click opens detail.
 *  - Detail drawer: status + "N days overdue", Contract, Building, Unit, Customer, Amount,
 *    Due Date, Method, Cheque No., Description, "Open Contract" link.
 *  - Loading / error-with-retry / empty (filter-aware copy) states.
 *  - There is no record-payment / reminder / PDF action on this page today, so none is
 *    added; the drawer's action is "Open contract", where payments are recorded.
 *  - No manager route re-exports this page; /prototype/os/rp/receivables does, and the
 *    Finance tabs navigate pathname-relative so it keeps working there.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import {
  OsPage, PageHead, Kpis, Kpi, Pill, Btn, TableWrap, SearchField, Seg, SkeletonRows, EmptyRow, ErrorRow,
  KV, Drawer, fmtAed as kitAed, fmtDate, type Tone,
} from '@/components/os/kit';

// 'replaced' = a bounced cheque the customer has since made good with another cheque
// (payments.replaces_payment_id). Visible as history, neither owed nor collected.
type RecvStatus = 'scheduled' | 'due' | 'overdue' | 'received' | 'replaced';

const STATUS_ORDER: RecvStatus[] = ['scheduled', 'due', 'overdue', 'received', 'replaced'];
const STATUS_LABELS: Record<RecvStatus, string> = {
  scheduled: 'Scheduled', due: 'Due Today', overdue: 'Overdue', received: 'Received', replaced: 'Replaced',
};
const STATUS_TONE: Record<RecvStatus, Tone> = {
  scheduled: 'info', due: 'amber', overdue: 'danger', received: 'primary', replaced: 'neutral',
};

const TYPE_LABELS: Record<string, string> = {
  rental_income: 'Rent', admin_fee: 'Admin Fee', security_deposit: 'Deposit',
  ejari_fee: 'Contract Registration Fee', maintenance: 'Maintenance', other: 'Other',
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

const toFils = (aed: number) => Math.round((Number(aed) || 0) * 100);
const sumAed = (rows: Receivable[]) => rows.reduce((s, r) => s + toFils(r.amount), 0) / 100;
const fmtAed = (v: number) => kitAed(v);
const methodLabel = (m: string | null) => (m ? m.replace('_', ' ').replace(/^\w/, c => c.toUpperCase()) : '—');
const contractHref = (id: number) => `/rental-provider/dashboard/contracts/${id}/v2`;
const StatusPill = ({ s }: { s: RecvStatus }) => <Pill tone={STATUS_TONE[s] ?? 'neutral'}>{STATUS_LABELS[s] ?? s}</Pill>;
const COLS = 11;

export default function ReceivablesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems]       = useState<Receivable[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | RecvStatus>('all');
  const [filterType, setFilterType]     = useState('all');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/contracts/receivables', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      setItems(await res.json());
    } catch {
      setError('Failed to load receivables.');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { void load(); }, [load]);

  const buildings = useMemo(() => [...new Set(items.map(r => r.building).filter(b => b !== '—'))], [items]);
  const years = useMemo(() => {
    const ys = new Set(items.map(r => r.dueDate?.slice(0, 4)).filter(Boolean) as string[]);
    ys.add(String(new Date().getFullYear()));
    return [...ys].sort().reverse();
  }, [items]);

  // Everything except the status filter — the status Seg counts come from this.
  const baseFiltered = useMemo(() => items.filter(r => {
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
  }), [items, filterType, filterBuilding, filterYear, search]);
  const filtered = useMemo(
    () => (filterStatus === 'all' ? baseFiltered : baseFiltered.filter(r => r.status === filterStatus)),
    [baseFiltered, filterStatus],
  );

  // Summary across all items (not filtered). A replaced bounce is carried by its replacement.
  const billable         = items.filter(r => r.status !== 'replaced');
  const totalAmount      = sumAed(billable);
  const totalReceived    = sumAed(items.filter(r => r.status === 'received'));
  const totalOutstanding = sumAed(billable.filter(r => r.status !== 'received'));
  const overdueItems     = items.filter(r => r.status === 'overdue');
  const totalOverdue     = sumAed(overdueItems);
  const collectionRate   = totalAmount > 0 ? Math.round((toFils(totalReceived) / toFils(totalAmount)) * 100) : 0;

  const currentYear = String(new Date().getFullYear());
  const hasFilters = filterStatus !== 'all' || filterType !== 'all' || filterBuilding !== 'all' || filterYear !== currentYear || search !== '';
  const clearFilters = () => {
    setFilterStatus('all'); setFilterType('all'); setFilterBuilding('all'); setFilterYear(currentYear); setSearch('');
  };

  const detail = detailId !== null ? items.find(r => r.id === detailId) ?? null : null;

  const base = pathname.replace(/\/receivables\/?$/, '');
  const goTab = (t: 'payments' | 'deposits' | 'receivables') => {
    if (t === 'payments') router.push(`${base}/payments`);
    else if (t === 'deposits') router.push(`${base}/payments?tab=deposits`);
  };

  return (
    <OsPage>
      <PageHead
        eyebrow="Finance › Receivables"
        title="Receivables"
        lede="Every scheduled instalment across your leases and where it stands — scheduled, due, overdue or received."
        actions={<Btn onClick={load} disabled={loading}><RefreshCw size={13} aria-hidden /> Refresh</Btn>}
      />

      <Kpis>
        <Kpi k="Total billed" v={loading ? '…' : fmtAed(totalAmount)} d={`${billable.length} records`} />
        <Kpi k="Collected" v={loading ? '…' : fmtAed(totalReceived)} d="amount received" />
        <Kpi dark k="Outstanding" v={loading ? '…' : fmtAed(totalOutstanding)} d="pending payment" />
        <Kpi k="Overdue" v={loading ? '…' : fmtAed(totalOverdue)} d={`${overdueItems.length} records`} />
        <Kpi k="Collection rate" v={loading ? '…' : `${collectionRate}%`} d="of total billed" />
      </Kpis>

      <div style={{ margin: '14px 0 10px' }}>
        <Seg<'payments' | 'deposits' | 'receivables'>
          label="Finance views"
          value="receivables"
          onChange={goTab}
          options={[
            { v: 'payments', l: 'Payments' },
            { v: 'deposits', l: 'Security Deposits' },
            { v: 'receivables', l: 'Receivables', n: items.length },
          ]}
        />
      </div>

      <div style={{ margin: '0 0 10px' }}>
        <Seg<'all' | RecvStatus>
          label="Filter by status"
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { v: 'all', l: 'All', n: baseFiltered.length },
            ...STATUS_ORDER.map(s => ({ v: s, l: STATUS_LABELS[s], n: baseFiltered.filter(r => r.status === s).length })),
          ]}
        />
      </div>

      <TableWrap toolbar={<>
        <SearchField value={search} onChange={setSearch} placeholder="Search contract, customer, unit…" />
        <select className="gx-sel" value={filterYear} onChange={e => setFilterYear(e.target.value)} aria-label="Filter by year">
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="gx-sel" value={filterType} onChange={e => setFilterType(e.target.value)} aria-label="Filter by type">
          <option value="all">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {buildings.length > 0 && (
          <select className="gx-sel" value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)} aria-label="Filter by building">
            <option value="all">All buildings</option>
            {buildings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        {hasFilters && <Btn size="sm" variant="ghost" onClick={clearFilters}>Reset filters</Btn>}
        <span className="sp" />
        <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}{filtered.length > 0 ? ` · ${fmtAed(sumAed(filtered))}` : ''}
        </span>
      </>}>
        <table className="gx-tbl" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th>Contract</th><th>Building</th><th>Unit</th><th>Customer</th><th>Type</th>
              <th className="num">Amount</th><th>Due date</th><th>Method</th><th className="num">Overdue</th><th>Status</th>
              <th className="act"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          {loading ? <SkeletonRows cols={COLS} />
            : error ? <ErrorRow cols={COLS} onRetry={load} />
            : filtered.length === 0 ? (
              <EmptyRow cols={COLS}
                title={hasFilters ? 'No records match your filters.' : 'No receivables yet.'}
                text={hasFilters ? ' Reset the filters to see every instalment.' : ' Payment instalments appear here once contracts are created.'} />
            ) : (
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="click" onClick={() => setDetailId(r.id)}>
                    <td>
                      {r.contractId
                        ? <Link href={contractHref(r.contractId)} onClick={e => e.stopPropagation()} style={{ color: 'var(--ms-primary, #047246)', fontWeight: 600 }}>{r.contractRef}</Link>
                        : '—'}
                    </td>
                    <td>{r.building}</td>
                    <td className="strong">{r.unit}</td>
                    <td>{r.tenant}</td>
                    <td>{TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className="num strong">{fmtAed(r.amount)}</td>
                    <td className="nowrap">{fmtDate(r.dueDate)}</td>
                    <td>{methodLabel(r.paymentMethod)}</td>
                    <td className="num" style={r.overdueDays > 0 ? { color: 'var(--ms-danger, #b91c1c)', fontWeight: 600 } : undefined}>
                      {r.overdueDays > 0 ? `${r.overdueDays}d` : '—'}
                    </td>
                    <td><StatusPill s={r.status} /></td>
                    <td className="act"><Btn size="xs" onClick={() => setDetailId(r.id)}>Open</Btn></td>
                  </tr>
                ))}
              </tbody>
            )}
        </table>
      </TableWrap>

      <Drawer
        open={!!detail}
        onClose={() => setDetailId(null)}
        title={detail ? (TYPE_LABELS[detail.type] ?? detail.type) : ''}
        sub={detail ? `${detail.contractRef} · ${detail.unit}` : undefined}
        footer={detail && <>
          {detail.contractId && <Btn variant="primary" href={contractHref(detail.contractId)}>Open contract</Btn>}
          <Btn variant="ghost" onClick={() => setDetailId(null)}>Close</Btn>
        </>}
      >
        {detail && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <StatusPill s={detail.status} />
              {detail.overdueDays > 0 && <Pill tone="danger" dot={false}>{detail.overdueDays} days overdue</Pill>}
            </div>
            <KV items={[
              { k: 'Contract', v: detail.contractRef },
              { k: 'Building', v: detail.building },
              { k: 'Unit', v: detail.unit },
              { k: 'Customer', v: detail.tenant },
              { k: 'Amount', v: fmtAed(detail.amount) },
              { k: 'Due date', v: fmtDate(detail.dueDate) },
              { k: 'Method', v: methodLabel(detail.paymentMethod) },
              { k: 'Cheque no.', v: detail.chequeNumber ?? '—' },
            ]} />
            {detail.description && (
              <div style={{ marginTop: 12 }}><KV items={[{ k: 'Description', v: detail.description }]} /></div>
            )}
            <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 12 }}>
              Payments are recorded and cheques cleared on the lease record — open the contract to act on this instalment.
            </p>
          </>
        )}
      </Drawer>
    </OsPage>
  );
}
