'use client';

/**
 * Manager · Payments page — mirrors the landlord Payments ledger
 * (src/app/rental-provider/dashboard/payments/page.tsx): the same five top-level
 * categories (Rental Income, Security Deposit, Management Fee, Third Party,
 * Other) with the category breakdown as the clickable top-level filter, so a
 * manager and their landlord read identical figures. Read-only and gated per
 * landlord on `canManageDeposits`; data via GET /manager/payments?rp=<id>.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Wallet, Loader2, RefreshCw, Lock, Calendar, ExternalLink, ShieldCheck } from 'lucide-react';
import { apiGet } from '@/lib/api';
import DepositDetailModal, { type DepositDetail, type DepositRow } from '@/components/upnow/DepositDetailModal';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';
import { taxPortionOf } from '@/lib/chargeTax';
import { BasisNote } from '@/components/upnow/reportCatalog';

// ─── Categories (top level) ───────────────────────────────────────────────
// Identical set, order and membership to the landlord ledger — see that file for
// the rationale behind each bucket, including why Security Deposit is NOT one of
// them: it is money held for the customer, so it gets its own section below.
type CategoryKey = 'rental_income' | 'management_fee' | 'third_party' | 'others';

const CATEGORY_ORDER: CategoryKey[] = ['rental_income', 'management_fee', 'third_party', 'others'];
const CATEGORY_LABELS: Record<CategoryKey, string> = {
  rental_income:    'Rental Income',
  management_fee:   'Management Fee',
  third_party:      'Third Party',
  others:           'Other',
};
const CATEGORY_SUB: Record<CategoryKey, string> = {
  rental_income:    'rent',
  management_fee:   'admin · commission · penalties',
  third_party:      'VAT · Contract Registration · pass-throughs',
  others:           'uncategorised',
};

// The VAT column / subtotals. A custom "Other" charge holds its tax in the LABEL
// rather than in vat_amount ("5% VAT on sub-lease" IS tax), so read it through the
// shared rule instead of the stored column — see lib/chargeTax. Mirrors the RP
// ledger, so the two reconcile one-to-one.
const vatOf = (r: { paymentType: string; description?: string | null; vatAmount?: number | null; amount: number }) =>
  taxPortionOf(r, r.amount);

// A `vat` payment is "Fees VAT" (the combined VAT cheque on admin/commission fees)
// when its description says so. Every other `vat` cheque is rent VAT. BOTH sit
// under Third Party — VAT is collected, not earned, and the rent-VAT cheque is
// the same charge that other contracts hold as a free-text "5% VAT on Rent" row.
const isFeesVat = (p: { paymentType?: string | null; description?: string | null }) =>
  (p.paymentType ?? '') === 'vat' && /fees\s*vat/i.test(p.description ?? '');

// The sub-item a payment row belongs to. VAT splits into rental vs fees; every
// other row keeps its raw payment type.
function itemKeyOf(r: { paymentType: string; description?: string | null }): string {
  if (r.paymentType === 'vat') return isFeesVat(r) ? 'vat_fees' : 'vat_rental';
  return r.paymentType;
}

// Rental Income — rent only. The rent-VAT cheque is a pass-through and sits
// under Third Party, alongside the free-text "5% VAT on Rent" rows that record
// the identical charge on contracts that never used a VAT cheque.
const RENTAL_TYPES = ['rental_income'];
// Management Fee — RP-charged fees + every Settings → Rules penalty / charge.
const MANAGEMENT_TYPES = [
  'admin_fee', 'commission',
  'bounced_cheque_fee', 'cheque_replacement_fee', 'cheque_deferral_fee',
  'late_renewal_fee', 'early_termination_fee', 'late_moveout_fee',
  'unauthorized_sharing_fee', 'access_card_fee', 'contract_name_change_fee', 'unit_transfer_fee',
];
// Third Party — pass-throughs the RP collects on behalf of others. `other` belongs
// here (a sub-leased building's levy and the tax on it, service charges), matching
// the contract page, the receipts and the segregated payment plan; leaving it in the
// catch-all filed the landlord's Al Wasl money under "uncategorised".
const THIRD_PARTY_TYPES = ['vat_rental', 'ejari_fee', 'vat_fees', 'maintenance_fee', 'service_charge', 'refund', 'other'];
// Per-category display order for the type sub-groups.
const TYPE_ORDER: Partial<Record<CategoryKey, string[]>> = {
  rental_income:  RENTAL_TYPES,
  management_fee: MANAGEMENT_TYPES,
  third_party:    THIRD_PARTY_TYPES,
};

// Route a sub-item key to its top-level category. Unmapped types fall through to
// Other, so nothing is ever silently dropped.
function categoryOf(itemKey: string): CategoryKey {
  if (RENTAL_TYPES.includes(itemKey)) return 'rental_income';
  if (MANAGEMENT_TYPES.includes(itemKey)) return 'management_fee';
  if (THIRD_PARTY_TYPES.includes(itemKey)) return 'third_party';
  return 'others';
}

const TYPE_LABELS: Record<string, string> = {
  rental_income:            'Rental Income',
  vat_rental:               '5% VAT on Rent',
  vat_fees:                 'Fees VAT',
  security_deposit:         'Security Deposit',
  admin_fee:                'Admin',
  commission:               'Commission',
  bounced_cheque_fee:       'Bounced cheque',
  cheque_replacement_fee:   'Cheque hold / replacement',
  cheque_deferral_fee:      'Cheque deferral',
  late_renewal_fee:         'Late renewal',
  early_termination_fee:    'Early termination',
  late_moveout_fee:         'Late move-out',
  unauthorized_sharing_fee: 'Sharing without notice / NOC',
  access_card_fee:          'Access card / remote replacement',
  contract_name_change_fee: 'Contract name change',
  unit_transfer_fee:        'Unit transfer',
  ejari_fee:                'Contract Registration',
  maintenance_fee:          'Maintenance',
  service_charge:           'Service Charge',
  refund:                   'Refund',
  other:                    'Other',
};
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const STATUS_LABELS: Record<string, string> = {
  held:           'Held',
  returned:       'Returned',
  partial_return: 'Partial Return',
  forfeited:      'Forfeited',
  pending:        'Pending',
  cleared:        'Cleared',
  paid:           'Paid',
  bounced:        'Bounced',
  // A bounce the customer made good with a cheque that has not cleared yet. It
  // is settled — nobody should chase it — but the money is not in, so it must
  // not read as Cleared. (Once that cheque clears the row simply says Cleared.)
  replaced:       'Replaced',
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
  replaced:       'bg-[#f4f3ef] text-[#6b6860]',
  cancelled:      'bg-[#f4f3ef] text-[#6b6860]',
};

interface PaymentRow {
  id: string;
  paymentType: string;
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
  // Server-derived (`shared/payment-basis.ts`), sent by the SAME listPayments()
  // that feeds the landlord ledger. This page lists every row whatever the answer
  // — a ledger that hides rows is not one — but the subtotals honour it, so a
  // manager and their landlord read the identical figures.
  countsTowardTotals?: boolean;
  excludedReason?: 'cancelled' | 'bounce-replaced' | 'bounced-owed' | null;
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

// Mirrors the RP Payments page exactly (see the note there): a payment is filtered
// on the period it falls DUE — its tax point — and only a deposit, which carries no
// collection date anywhere in the register, stays on its lease TERM.
const isDepositRow = (d: { paymentType?: string | null }) => (d.paymentType ?? '') === 'security_deposit';

// The deposits tab's top-level buckets — the same role the payment CATEGORIES
// play on the other tab, so both tabs read as one design. Mirrors the landlord
// ledger; see that file for the reasoning.
const SETTLED_DEPOSIT = new Set(['returned', 'partial_return', 'forfeited']);
type DepositBucket = 'all' | 'held' | 'settled';
const depositBucketOf = (d: { status: string }): Exclude<DepositBucket, 'all'> =>
  SETTLED_DEPOSIT.has(d.status) ? 'settled' : 'held';

function yearMatch(
  d: {
    paymentType?: string | null;
    startDate: string | null; endDate: string | null;
    fromYear: number | null; toYear: number | null;
    transactionDate?: string | null; recordedDate: string | null;
  },
  y: number,
): boolean {
  if (!isDepositRow(d)) {
    const due = d.transactionDate ?? d.recordedDate;
    return due ? Number(due.slice(0, 4)) === y : false;
  }
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
    if (!isDepositRow(d)) {
      const due = d.transactionDate ?? d.recordedDate;
      if (due) set.add(Number(due.slice(0, 4)));
      continue;
    }
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
  // Scoped to the landlord chosen in the LandlordSwitcher (?rp=). Under "All
  // landlords" with several to choose from, prompt for one rather than showing
  // an arbitrary landlord's payments.
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageDeposits');

  const [rows, setRows]       = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  // Money that MOVED vs money being HELD — one tab each, mirroring the landlord
  // ledger. Deposits under the ledger read as one continuous list and invited the
  // two totals to be added together; they must never be.
  const [tab, setTab]         = useState<'payments' | 'deposits'>('payments');
  const [search, setSearch]   = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | CategoryKey>('all');
  const [filterDeposit, setFilterDeposit]   = useState<DepositBucket>('all');
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

  if (!permsLoading && needsLandlord) {
    return <SelectLandlordNotice resource="Payments" />;
  }

  // Per-landlord permission gate.
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
  // Each tab has its own status vocabulary — held/returned for a deposit,
  // cleared/pending/bounced for a payment — so the dropdown offers only the
  // states the visible tab can be in.
  const statuses = [...new Set(yearScoped.filter(d => isDepositRow(d) === (tab === 'deposits')).map(d => d.status))];

  const scoped = yearScoped.filter(d => {
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

  const filtered = filterCategory === 'all' ? scoped : scoped.filter(d => categoryOf(itemKeyOf(d)) === filterCategory);

  /** A row belongs in a money total unless the server says otherwise (voided, or
   *  a bounce whose replacement is already in the list). An older API response
   *  carrying no flag counts, so a stale deploy under-reports nothing. Mirrors
   *  the landlord ledger exactly — see that file for the reasoning. */
  const counts = (r: PaymentRow) => r.countsTowardTotals !== false;

  // Excluded rows stay in the LIST below and out of these figures — that is the
  // whole difference between a ledger and a statement.
  // Deposits leave the ledger before anything is categorised or counted — held
  // money, its own TAB, exactly as on the landlord page.
  const depositRows  = scoped.filter(isDepositRow);
  const ledgerScoped = scoped.filter(r => !isDepositRow(r));
  const catTotals: Record<CategoryKey, number> = { rental_income: 0, management_fee: 0, third_party: 0, others: 0 };
  for (const d of ledgerScoped) if (counts(d)) catTotals[categoryOf(itemKeyOf(d))] += d.amount;
  const grandTotal   = ledgerScoped.filter(counts).reduce((s, d) => s + d.amount, 0);
  const depositsHeld = depositRows.filter(d => d.status === 'held' && counts(d)).reduce((s, d) => s + d.amount, 0);
  const depositsTotal = depositRows.filter(counts).reduce((s, d) => s + d.amount, 0);
  // The rows the deposits table lists. The three card totals are computed over the
  // UNFILTERED set, so each card keeps showing its own amount whichever is picked.
  const depositShown = filterDeposit === 'all'
    ? depositRows
    : depositRows.filter(d => depositBucketOf(d) === filterDeposit);
  const depositShownTotal = depositShown.filter(counts).reduce((s, d) => s + d.amount, 0);
  // Named beside the cards so a subtotal that no longer matches the rows under it
  // is explained rather than looking like a bug.
  const excludedRows   = ledgerScoped.filter(d => !counts(d));
  const excludedTotal  = excludedRows.reduce((s, d) => s + d.amount, 0);
  const excludedCount  = excludedRows.length;

  const groups = CATEGORY_ORDER
    .map(cat => {
      const catRows = filtered.filter(r => !isDepositRow(r) && categoryOf(itemKeyOf(r)) === cat);
      return {
        cat,
        rows: catRows,
        // Every row is listed; only the counting ones are summed.
        subtotal: catRows.filter(counts).reduce((s, r) => s + r.amount, 0),
        vat: catRows.filter(counts).reduce((s, r) => s + vatOf(r), 0),
      };
    })
    .filter(g => g.rows.length > 0);

  const hasFilters = filterCategory !== 'all' || filterDeposit !== 'all' || filterStatus !== 'all' || filterBuilding !== 'all' || search !== '';
  const clearFilters = () => { setFilterCategory('all'); setFilterDeposit('all'); setFilterStatus('all'); setFilterBuilding('all'); setSearch(''); };

  // Switching tab drops the filters whose vocabulary does not survive the move;
  // search, building and year carry across.
  const goTab = (t: 'payments' | 'deposits') => { setTab(t); setFilterStatus('all'); setFilterCategory('all'); setFilterDeposit('all'); };

  // The deposits tab's cards — same shape as `cards` below, so both tabs render
  // through identical markup. "On record" is the reset card: it CONTAINS the
  // other two rather than sitting beside them.
  const depositCards: { key: DepositBucket; label: string; value: number; sub: string }[] = [
    { key: 'all',     label: 'On record', value: depositsTotal,                sub: 'every deposit — contains both' },
    { key: 'held',    label: 'Held now',  value: depositsHeld,                 sub: 'refundable at move-out' },
    { key: 'settled', label: 'Settled',   value: depositsTotal - depositsHeld, sub: 'returned, part-returned or kept' },
  ];

  const detail = detailId !== null ? rows.find(d => d.id === detailId) ?? null : null;

  const cards: { key: 'all' | CategoryKey; label: string; value: number; sub: string }[] = [
    { key: 'all',              label: 'Total Payments',                 value: grandTotal,                 sub: `${scoped.length} records` },
    { key: 'rental_income',    label: CATEGORY_LABELS.rental_income,    value: catTotals.rental_income,    sub: CATEGORY_SUB.rental_income },
    { key: 'management_fee',   label: CATEGORY_LABELS.management_fee,   value: catTotals.management_fee,   sub: CATEGORY_SUB.management_fee },
    { key: 'third_party',      label: CATEGORY_LABELS.third_party,      value: catTotals.third_party,      sub: CATEGORY_SUB.third_party },
    { key: 'others',           label: CATEGORY_LABELS.others,           value: catTotals.others,           sub: CATEGORY_SUB.others },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Payments</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">
            {tab === 'payments'
              ? 'Every payment across the landlord’s rental agreements — by category. Click a card to filter.'
              : 'Every deposit the landlord is holding on a customer’s behalf. Click a row for its proofs, move-in condition and settlement.'}
          </p>
          <BasisNote slug={tab === 'payments' ? 'payments' : 'security-deposits'} className="mt-1 max-w-3xl" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 pl-3 pr-1.5 h-[38px] rounded-xl border border-[#e8e6e0] bg-white text-[#6b6860]"
            title="Scope the page by the year a payment falls due (deposits, which carry no collection date, by their lease term)">
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

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-[#e8e6e0] mb-6">
        {([
          { key: 'payments' as const, label: 'Payments',          count: ledgerScoped.length },
          { key: 'deposits' as const, label: 'Security Deposits', count: depositRows.length },
        ]).map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => goTab(t.key)}
              aria-current={active ? 'page' : undefined}
              className={`relative -mb-px px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                active ? 'border-[#2e9f82] text-[#1a1916]' : 'border-transparent text-[#6b6860] hover:text-[#1a1916]'}`}>
              {t.label}
              <span className={`ml-2 text-xs font-medium ${active ? 'text-[#2e9f82]' : 'text-[#9b9890]'}`}>{t.count}</span>
            </button>
          );
        })}
        <span className="ml-auto pb-2 text-xs text-[#9b9890]">
          {tab === 'payments' ? `${fmtAed(grandTotal)} counted` : `${fmtAed(depositsHeld)} held now`}
        </span>
      </div>

      {/* Category cards = the top-level filter. */}
      {tab === 'payments' && (
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
      )}

      {/* Deposit cards — the deposits tab's category cards, same markup and the
          same click-to-filter behaviour. On record CONTAINS the other two, so
          these are a total and its parts, never three figures to add. */}
      {tab === 'deposits' && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
          {depositCards.map(c => {
            const active = filterDeposit === c.key;
            return (
              <button key={c.key} type="button" onClick={() => setFilterDeposit(active ? 'all' : c.key)}
                className={`text-left bg-white rounded-2xl p-5 shadow-sm border transition-all cursor-pointer hover:border-[#2e9f82] ${active ? 'border-[#2e9f82] ring-1 ring-[#2e9f82]' : 'border-[#f0ede8]'}`}>
                <div className="text-xs text-[#6b6860] font-medium">{c.label}</div>
                <div className="font-bold text-xl text-[#1a1916] mt-1 truncate">{fmtAed(c.value)}</div>
                <div className="text-xs text-[#9b9890] mt-0.5 truncate">{c.sub}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Every line is listed; the subtotals count only what was collectible.
          Saying so here is what lets this page, the landlord ledger and the
          reports be compared without anyone chasing a phantom discrepancy. */}
      {tab === 'payments' && excludedCount > 0 && (
        <p className="text-xs text-[#6b6860] -mt-3 mb-6">
          {excludedCount} line{excludedCount !== 1 ? 's' : ''} ({fmtAed(excludedTotal)}) listed but not counted — cancelled, a bounce its replacement already covers, or a bounce that was never made good
        </p>
      )}

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
          {tab === 'payments'
            ? `${filtered.length} payment${filtered.length !== 1 ? 's' : ''}${filterCategory !== 'all' ? ` · ${CATEGORY_LABELS[filterCategory]}` : ''}`
            : `${depositShown.length} deposit${depositShown.length !== 1 ? 's' : ''}${filterDeposit !== 'all' ? ` · ${depositCards.find(c => c.key === filterDeposit)?.label}` : ''}`}
        </span>
      </div>

      {/* Ledger */}
      {tab === 'payments' && (
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
                  <ManagerCategoryBlock key={g.cat} category={g.cat} rows={g.rows} subtotal={g.subtotal} vat={g.vat} onRowClick={setDetailId} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── Security deposits — its own tab, never a payment category. Same split
          as the landlord ledger: money HELD for the customer never joins the
          totals for money the tenancy earned. */}
      {tab === 'deposits' && (
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
          ) : depositShown.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
                <ShieldCheck size={24} className="text-[#2e9f82]" />
              </div>
              <p className="text-sm text-[#6b6860] mb-1">
                {filterYear !== 'all'
                  ? `No deposits for ${filterYear}.`
                  : hasFilters ? 'No deposits match your filters.' : 'No deposits recorded yet.'}
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[860px]">
              <thead>
                <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                  {['Ref', 'Contract', 'Building', 'Unit', 'Customer', 'Amount', 'Status', 'Date', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Subtotal header, identical to the ledger's category header. */}
                <tr className="bg-[#f1efe9] border-b border-[#e8e6e0]">
                  <td colSpan={5} className="px-4 py-2.5">
                    <span className="text-[13px] font-bold uppercase tracking-wide text-[#1a1916]">
                      {depositCards.find(c => c.key === filterDeposit)?.label ?? 'On record'}
                    </span>
                    <span className="ml-2 text-[11px] text-[#9b9890]">
                      {depositShown.length} record{depositShown.length !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-bold text-sm text-[#1a1916]">{fmtAed(depositShownTotal)}</td>
                  <td colSpan={3} />
                </tr>
                {depositShown.map(d => (
                  <tr key={d.id} onClick={() => setDetailId(d.id)}
                    className="border-b border-[#f0ede8] text-sm text-[#1a1916] hover:bg-[#fafaf8] cursor-pointer transition-colors">
                    <td className="px-4 py-3.5 font-medium font-mono text-xs">{d.depositRef}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{d.contractRef}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{d.building}</td>
                    <td className="px-4 py-3.5">{d.unit}</td>
                    <td className="px-4 py-3.5">{d.tenant}</td>
                    <td className="px-4 py-3.5 font-semibold">{fmtAed(d.amount)}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[d.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                        {STATUS_LABELS[d.status] ?? d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-[#6b6860] whitespace-nowrap">{fmtDate(d.transactionDate ?? d.recordedDate)}</td>
                    <td className="px-4 py-3.5"><ExternalLink size={13} className="text-[#9b9890]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

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

/** Read-only category block for the manager view (contract ref is plain text). */
function ManagerCategoryBlock({
  category, rows, subtotal, vat, onRowClick,
}: {
  category: CategoryKey;
  rows: PaymentRow[];
  subtotal: number;
  vat: number;
  onRowClick: (id: string) => void;
}) {
  // Every remaining category can hold more than one type, so the sub-headers are
  // always on (Security Deposit, the single-type one, has left this table).
  const multiType = true;
  // Known types first in their canonical order, then anything unexpected — mirrors
  // the landlord ledger so the two pages group identically.
  const present = [...new Set(rows.map(itemKeyOf))];
  const ordered = TYPE_ORDER[category] ?? [];
  const typeOrder = [...ordered.filter(t => present.includes(t)), ...present.filter(t => !ordered.includes(t))];
  const byType = typeOrder
    .map(t => ({ type: t, rows: rows.filter(r => itemKeyOf(r) === t) }))
    .filter(g => g.rows.length > 0);

  return (
    <>
      <tr className="bg-[#f1efe9] border-b border-[#e8e6e0]">
        <td colSpan={6} className="px-4 py-2.5">
          <span className="text-[13px] font-bold uppercase tracking-wide text-[#1a1916]">{CATEGORY_LABELS[category]}</span>
          <span className="ml-2 text-[11px] text-[#9b9890]">{rows.length} record{rows.length !== 1 ? 's' : ''}</span>
        </td>
        <td className="px-4 py-2.5 font-bold text-sm text-[#1a1916]">{fmtAed(subtotal)}</td>
        <td className="px-4 py-2.5 text-xs text-[#6b6860]">{vat > 0 ? fmtAed(vat) : '—'}</td>
        <td colSpan={2} />
      </tr>

      {byType.map(grp => {
        const grpTotal = grp.rows.reduce((s, r) => s + r.amount, 0);
        const grpVat   = grp.rows.reduce((s, r) => s + vatOf(r), 0);
        return (
          <Fragment key={grp.type}>
            {multiType && (
              <tr className="bg-[#fbfaf7] border-b border-[#f0ede8]">
                <td colSpan={6} className="px-4 py-2 pl-8">
                  <span className="text-xs font-semibold text-[#3d3b35]">{typeLabel(grp.type)}</span>
                  <span className="ml-2 text-[11px] text-[#9b9890]">{grp.rows.length}</span>
                </td>
                <td className="px-4 py-2 font-semibold text-[13px] text-[#3d3b35]">{fmtAed(grpTotal)}</td>
                <td className="px-4 py-2 text-xs text-[#6b6860]">{grpVat > 0 ? fmtAed(grpVat) : '—'}</td>
                <td colSpan={2} />
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
                    {d.contractRef ? <span className="text-[#3d3b35] font-medium">{d.contractRef}</span> : <span className="text-[#9b9890]">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-[#6b6860]">{d.building}</td>
                  <td className="px-4 py-3.5">{d.unit}</td>
                  <td className="px-4 py-3.5">{d.tenant}</td>
                  <td className="px-4 py-3.5 text-[#6b6860] max-w-[220px] truncate" title={d.description ?? ''}>{d.description ?? '—'}</td>
                  <td className="px-4 py-3.5 font-semibold">{fmtAed(d.amount)}</td>
                  <td className="px-4 py-3.5 text-[#6b6860]">{vatOf(d) > 0 ? fmtAed(vatOf(d)) : '—'}</td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[d.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                      {STATUS_LABELS[d.status] ?? d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-[#6b6860] whitespace-nowrap">{fmtDate(d.transactionDate ?? d.recordedDate)}</td>
                </tr>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}
