'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Wallet, Loader2, RefreshCw, ExternalLink, Calendar } from 'lucide-react';
import Link from 'next/link';
import DepositDetailModal, { type DepositDetail, type DepositRow } from '@/components/upnow/DepositDetailModal';

/** Portfolio-wide Payments ledger (SCRUM-577 / 579). Lists every payment row across
 *  the RP's contracts, grouped into four top-level CATEGORIES — Rental Income,
 *  Security Deposit, Management Fee (Ejari / Admin / Commission) and Others — with a
 *  per-category subtotal and a per-fee breakdown inside Management Fee. The category
 *  breakdown doubles as the top-level filter (click a summary card). Security-deposit
 *  rows keep their held/returned status, settlement and detail drawer; others are
 *  read-only. */

// ─── Categories (top level) ───────────────────────────────────────────────
type CategoryKey = 'rental_income' | 'security_deposit' | 'management_fee' | 'others';

const CATEGORY_ORDER: CategoryKey[] = ['rental_income', 'security_deposit', 'management_fee', 'others'];
const CATEGORY_LABELS: Record<CategoryKey, string> = {
  rental_income:    'Rental Income',
  security_deposit: 'Security Deposit',
  management_fee:   'Management Fee',
  others:           'Others',
};
const CATEGORY_SUB: Record<CategoryKey, string> = {
  rental_income:    'rent collected',
  security_deposit: 'deposits',
  management_fee:   'ejari · admin · commission',
  others:           'maintenance · service · other',
};
// Payment types that roll up into the Management Fee category, in display order.
const MANAGEMENT_TYPES = ['ejari_fee', 'admin_fee', 'commission'];

function categoryOf(t: string): CategoryKey {
  if (t === 'rental_income') return 'rental_income';
  if (t === 'security_deposit') return 'security_deposit';
  if (MANAGEMENT_TYPES.includes(t)) return 'management_fee';
  return 'others';
}

// Per-type labels (used for the sub-rows inside Management Fee / Others).
const TYPE_LABELS: Record<string, string> = {
  rental_income:    'Rental Income',
  security_deposit: 'Security Deposit',
  ejari_fee:        'Ejari',
  admin_fee:        'Admin',
  commission:       'Commission',
  maintenance_fee:  'Maintenance',
  service_charge:   'Service Charge',
  refund:           'Refund',
  other:            'Other',
};
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Status vocabulary spans both the deposit (held/returned/…) and payment
// (pending/cleared/…) sets — the ledger renders rows from both.
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
  paymentType: string;
  depositRef: string;
  contractRef: string;
  contractId: number | null;
  // The in-force lease for this row's tenant+unit (deposit rows are pinned to the
  // renewal chain's oldest lease) — where a move-out settlement should be opened.
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

function fmtDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A row belongs to year Y if its lease TERM overlaps Y — the same scope as the
 *  Tenancy Contracts page. Falls back to from/to year, then the transaction year. */
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

/** Collect every lease/transaction year present for the year dropdown. */
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

export default function PaymentsPage() {
  const [rows, setRows]       = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | CategoryKey>('all');
  const [filterStatus, setFilterStatus]     = useState('all');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterYear, setFilterYear]         = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/contracts/payments', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      setRows(await res.json());
    } catch {
      setError('Failed to load payments.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Lazy-load the full deposit detail bundle (docs, move-in/out, settlement) for
  // the popup — only security-deposit rows open it.
  const loadDepositDetail = useCallback(async (id: string): Promise<DepositDetail> => {
    const res = await fetch(`/api/contracts/deposits/${id}/detail`, { credentials: 'include' });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }, []);

  const years = useMemo(() => allYears(rows), [rows]);

  const yearScoped = useMemo(
    () => (filterYear === 'all' ? rows : rows.filter(d => yearMatch(d, Number(filterYear)))),
    [rows, filterYear],
  );

  const buildings = useMemo(() => [...new Set(rows.map(d => d.building).filter(b => b !== '—'))], [rows]);
  const statuses  = useMemo(() => [...new Set(yearScoped.map(d => d.status))], [yearScoped]);

  // Everything EXCEPT the category filter — the category cards summarise this, and
  // the category filter narrows it down to the chosen category.
  const scoped = useMemo(() => yearScoped.filter(d => {
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
  }), [yearScoped, filterStatus, filterBuilding, search]);

  const filtered = useMemo(
    () => (filterCategory === 'all' ? scoped : scoped.filter(d => categoryOf(d.paymentType) === filterCategory)),
    [scoped, filterCategory],
  );

  // Per-category totals (over `scoped`, so the cards always show every category's
  // amount regardless of which one is currently selected).
  const catTotals = useMemo(() => {
    const t: Record<CategoryKey, number> = { rental_income: 0, security_deposit: 0, management_fee: 0, others: 0 };
    for (const d of scoped) t[categoryOf(d.paymentType)] += d.amount;
    return t;
  }, [scoped]);
  const grandTotal   = useMemo(() => scoped.reduce((s, d) => s + d.amount, 0), [scoped]);
  const depositsHeld = useMemo(
    () => scoped.filter(d => d.paymentType === 'security_deposit' && d.status === 'held').reduce((s, d) => s + d.amount, 0),
    [scoped],
  );

  // Group the filtered rows by category in canonical order; hide empty categories.
  const groups = useMemo(() =>
    CATEGORY_ORDER
      .map(cat => {
        const catRows = filtered.filter(r => categoryOf(r.paymentType) === cat);
        return {
          cat,
          rows: catRows,
          subtotal: catRows.reduce((s, r) => s + r.amount, 0),
          vat: catRows.reduce((s, r) => s + (r.vatAmount ?? 0), 0),
        };
      })
      .filter(g => g.rows.length > 0),
    [filtered],
  );

  const hasFilters = filterCategory !== 'all' || filterStatus !== 'all' || filterBuilding !== 'all' || search !== '';
  const clearFilters = () => { setFilterCategory('all'); setFilterStatus('all'); setFilterBuilding('all'); setSearch(''); };

  const detail = detailId !== null ? rows.find(d => d.id === detailId) ?? null : null;

  // Top-level category cards (the first is the "all / total" reset).
  const cards: { key: 'all' | CategoryKey; label: string; value: number; sub: string }[] = [
    { key: 'all',              label: 'Total Payments',                    value: grandTotal,             sub: `${scoped.length} records` },
    { key: 'rental_income',    label: CATEGORY_LABELS.rental_income,       value: catTotals.rental_income, sub: CATEGORY_SUB.rental_income },
    { key: 'security_deposit', label: CATEGORY_LABELS.security_deposit,    value: catTotals.security_deposit, sub: `held ${fmtAed(depositsHeld)}` },
    { key: 'management_fee',   label: CATEGORY_LABELS.management_fee,      value: catTotals.management_fee, sub: CATEGORY_SUB.management_fee },
    { key: 'others',           label: CATEGORY_LABELS.others,              value: catTotals.others,        sub: CATEGORY_SUB.others },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Payments</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Every payment across your rental agreements — by category. Click a card to filter.</p>
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

      {/* Category cards = the top-level filter. Click to narrow the ledger. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        {cards.map(c => {
          const active = filterCategory === c.key || (c.key === 'all' && filterCategory === 'all');
          return (
            <button key={c.key} type="button" onClick={() => setFilterCategory(c.key === 'all' ? 'all' : c.key)}
              className={`text-left bg-white rounded-2xl p-5 shadow-sm border transition-all cursor-pointer hover:border-[#2e9f82] ${active ? 'border-[#2e9f82] ring-1 ring-[#2e9f82]' : 'border-[#f0ede8]'}`}>
              <div className="text-xs text-[#6b6860] font-medium">{c.label}</div>
              <div className="font-bold text-xl text-[#1a1916] mt-1 truncate">{fmtAed(c.value)}</div>
              <div className="text-xs text-[#9b9890] mt-0.5 truncate">{c.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Secondary filters */}
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 items-center mb-4 shadow-sm border border-[#f0ede8]">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input type="text" placeholder="Search ref, customer, unit, description…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
        </div>
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
        <span className="text-sm text-[#6b6860]">
          {filtered.length} payment{filtered.length !== 1 ? 's' : ''}
          {filterCategory !== 'all' ? ` · ${CATEGORY_LABELS[filterCategory]}` : ''}
        </span>
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
            <table className="w-full text-left min-w-[1040px]">
              <thead>
                <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                  {['Ref', 'Contract', 'Building', 'Unit', 'Customer', 'Description', 'Amount', 'VAT', 'Status', 'Date', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <CategoryBlock key={g.cat} category={g.cat} rows={g.rows} subtotal={g.subtotal} vat={g.vat} onRowClick={setDetailId} />
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

/** One category block: a subtotal header, then — for multi-type categories
 *  (Management Fee, Others) — a per-type sub-header + its rows; single-type
 *  categories list their rows directly. Only security-deposit rows are clickable. */
function CategoryBlock({
  category, rows, subtotal, vat, onRowClick,
}: {
  category: CategoryKey;
  rows: PaymentRow[];
  subtotal: number;
  vat: number;
  onRowClick: (id: string) => void;
}) {
  const multiType = category === 'management_fee' || category === 'others';
  // Distinct types present in this category, in a stable order.
  const typeOrder = category === 'management_fee' ? MANAGEMENT_TYPES : [...new Set(rows.map(r => r.paymentType))];
  const byType = typeOrder
    .map(t => ({ type: t, rows: rows.filter(r => r.paymentType === t) }))
    .filter(g => g.rows.length > 0);

  return (
    <>
      {/* Category header */}
      <tr className="bg-[#f1efe9] border-b border-[#e8e6e0]">
        <td colSpan={6} className="px-4 py-2.5">
          <span className="text-[13px] font-bold uppercase tracking-wide text-[#1a1916]">{CATEGORY_LABELS[category]}</span>
          <span className="ml-2 text-[11px] text-[#9b9890]">{rows.length} record{rows.length !== 1 ? 's' : ''}</span>
        </td>
        <td className="px-4 py-2.5 font-bold text-sm text-[#1a1916]">{fmtAed(subtotal)}</td>
        <td className="px-4 py-2.5 text-xs text-[#6b6860]">{vat > 0 ? fmtAed(vat) : '—'}</td>
        <td colSpan={3} />
      </tr>

      {byType.map(grp => {
        const grpTotal = grp.rows.reduce((s, r) => s + r.amount, 0);
        const grpVat   = grp.rows.reduce((s, r) => s + (r.vatAmount ?? 0), 0);
        return (
          <Fragment key={grp.type}>
            {multiType && (
              /* Per-fee sub-header (Ejari / Admin / Commission, or each Other type) */
              <tr className="bg-[#fbfaf7] border-b border-[#f0ede8]">
                <td colSpan={6} className="px-4 py-2 pl-8">
                  <span className="text-xs font-semibold text-[#3d3b35]">{typeLabel(grp.type)}</span>
                  <span className="ml-2 text-[11px] text-[#9b9890]">{grp.rows.length}</span>
                </td>
                <td className="px-4 py-2 font-semibold text-[13px] text-[#3d3b35]">{fmtAed(grpTotal)}</td>
                <td className="px-4 py-2 text-xs text-[#6b6860]">{grpVat > 0 ? fmtAed(grpVat) : '—'}</td>
                <td colSpan={3} />
              </tr>
            )}
            {grp.rows.map(d => {
              const isDeposit = d.paymentType === 'security_deposit';
              return (
                <tr key={d.id}
                  onClick={isDeposit ? () => onRowClick(d.id) : undefined}
                  className={`border-b border-[#f0ede8] text-sm text-[#1a1916] transition-colors ${isDeposit ? 'hover:bg-[#fafaf8] cursor-pointer' : ''}`}>
                  <td className={`px-4 py-3.5 font-medium font-mono text-xs ${multiType ? 'pl-8' : ''}`}>{d.depositRef}</td>
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
                  <td className="px-4 py-3.5 text-[#6b6860] max-w-[220px] truncate" title={d.description ?? ''}>{d.description ?? '—'}</td>
                  <td className="px-4 py-3.5 font-semibold">{fmtAed(d.amount)}</td>
                  <td className="px-4 py-3.5 text-[#6b6860]">{d.vatAmount != null && d.vatAmount > 0 ? fmtAed(d.vatAmount) : '—'}</td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[d.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                      {STATUS_LABELS[d.status] ?? d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-[#6b6860] whitespace-nowrap">{fmtDate(d.transactionDate ?? d.recordedDate)}</td>
                  <td className="px-4 py-3.5">
                    {isDeposit ? <ExternalLink size={13} className="text-[#9b9890]" /> : null}
                  </td>
                </tr>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}
