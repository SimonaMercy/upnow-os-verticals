'use client';

/**
 * Finance › Payments & deposits — Genspark OS rebuild of the portfolio-wide
 * Payments ledger (SCRUM-577 / 579). /deposits redirects here.
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET /api/contracts/payments (credentials: include) — every ledger + deposit row.
 *    Amounts are AED numbers (may be fractional, e.g. VAT) — NOT fils; shown with
 *    fmtAed (2 dp only when fractional). Sums are done in integer fils, never floats.
 *  - GET /api/properties — building → leasing model, for the ownership filter
 *    (Own Property / Sub-lease / Property Management). Failure leaves the filter inert.
 *  - GET /api/contracts/deposits/:id/detail — lazy deposit bundle for DepositDetailModal.
 *  - Two tabs: Payments (money that moved) and Security Deposits (money held), with
 *    per-tab counts; switching tab resets status + category/bucket filters, keeps
 *    search / building / ownership / year. (New: ?tab=deposits deep-link + a
 *    Receivables tab that navigates to the sibling /receivables page.)
 *  - Year filter: payments by the period they fall due (transactionDate ?? recordedDate),
 *    deposits by lease term (startDate/endDate → fromYear/toYear → recordedDate);
 *    "All years" default; options built by the same rule.
 *  - Refresh button (reloads the ledger).
 *  - Category summary (Rental Income / Management Fee / Third Party / Other) doubles as
 *    the category filter (toggle) — now kit chips with amounts.
 *  - Deposit buckets (On record / Held now / Settled) as the deposits-tab filter.
 *  - Search (ref, customer, unit, contract ref, description); status filter (only the
 *    statuses the visible tab can be in); building filter; ownership filter; Reset.
 *  - Ledger grouped by category with subtotal + VAT subtotal header rows, per-type
 *    sub-headers inside multi-type categories; excluded rows (countsTowardTotals=false)
 *    listed but struck through with the EXCLUDED_WHY reason; "N lines (AED X) listed
 *    but not counted" note. VAT via taxPortionOf (lib/chargeTax). Ejari rows show the
 *    canonical "Contract Registration" description.
 *  - Deposits table with its bucket subtotal header.
 *  - Contract ref links → /rental-provider/dashboard/contracts/:id/v2.
 *  - Deposit rows open DepositDetailModal (REUSED unchanged) with links: contract,
 *    settlement (/contracts/:id/settlement), receipt (/contracts/:id/print/receipt?kind=deposit).
 *  - BasisNote ("How this is measured") per tab.
 *  - Loading / error-with-retry / empty states (year-specific empty copy).
 *  - Ledger (non-deposit) rows were read-only: they now open a read-only Drawer (KV +
 *    counted/excluded evidence) whose only actions are "Open contract" / "Open current
 *    lease". There is no record-payment, reminder or payment-receipt action on this
 *    page (payments are recorded on the lease record), so none is invented here.
 *  - No manager route re-exports this page (/dashboard/manager/payments is its own page);
 *    /prototype/os/rp/payments re-exports it, and tab navigation is pathname-relative
 *    so it keeps working there.
 */

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import DepositDetailModal, { type DepositDetail, type DepositRow } from '@/components/upnow/DepositDetailModal';
import { taxPortionOf } from '@/lib/chargeTax';
import { BasisNote } from '@/components/upnow/reportCatalog';
import {
  OsPage, PageHead, Kpis, Kpi, Pill, Btn, TableWrap, SearchField, Seg, SkeletonRows, EmptyRow, ErrorRow,
  Callout, Evid, KV, Drawer, fmtAed as kitAed, fmtDate, type Tone,
} from '@/components/os/kit';

// ─── Money (AED numbers; maths in integer fils) ───────────────────────────
const toFils = (aed: number) => Math.round((Number(aed) || 0) * 100);
const sumAed = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + toFils(f(r)), 0) / 100;
const fmtAed = (v: number) => kitAed(v, Math.round(v) !== v);

// ─── Categories (top level) ───────────────────────────────────────────────
// Security Deposit is deliberately NOT one of these: it is money HELD for the
// customer, not money earned or owed, and lives in its own tab with its own totals.
type CategoryKey = 'rental_income' | 'management_fee' | 'third_party' | 'others';

const CATEGORY_ORDER: CategoryKey[] = ['rental_income', 'management_fee', 'third_party', 'others'];
const CATEGORY_LABELS: Record<CategoryKey, string> = {
  rental_income: 'Rental Income', management_fee: 'Management Fee', third_party: 'Third Party', others: 'Other',
};
const CATEGORY_SUB: Record<CategoryKey, string> = {
  rental_income: 'rent', management_fee: 'admin · commission · penalties',
  third_party: 'VAT · Contract Registration · pass-throughs', others: 'uncategorised',
};

// A custom "Other" charge can hold its tax in the LABEL — read via the shared rule.
const vatOf = (r: { paymentType: string; description?: string | null; vatAmount?: number | null; amount: number }) =>
  taxPortionOf(r, r.amount);

// `vat` + "Fees VAT" description = VAT on admin/commission fees; every other `vat` is rent VAT.
const isFeesVat = (p: { paymentType?: string | null; description?: string | null }) =>
  (p.paymentType ?? '') === 'vat' && /fees\s*vat/i.test(p.description ?? '');

function itemKeyOf(r: { paymentType: string; description?: string | null }): string {
  if (r.paymentType === 'vat') return isFeesVat(r) ? 'vat_fees' : 'vat_rental';
  return r.paymentType;
}

const RENTAL_TYPES = ['rental_income'];
const MANAGEMENT_TYPES = [
  'admin_fee', 'commission',
  'bounced_cheque_fee', 'cheque_replacement_fee', 'cheque_deferral_fee',
  'late_renewal_fee', 'early_termination_fee', 'late_moveout_fee',
  'unauthorized_sharing_fee', 'access_card_fee', 'contract_name_change_fee', 'unit_transfer_fee', 'legal_fee',
];
const THIRD_PARTY_TYPES = ['vat_rental', 'ejari_fee', 'vat_fees', 'maintenance_fee', 'service_charge', 'refund', 'other'];
const TYPE_ORDER: Partial<Record<CategoryKey, string[]>> = {
  rental_income: RENTAL_TYPES, management_fee: MANAGEMENT_TYPES, third_party: THIRD_PARTY_TYPES,
};

const OWNERSHIP_LABEL: Record<string, string> = { direct: 'Own Property', sub: 'Sub-lease', management: 'Property Management' };

function categoryOf(itemKey: string): CategoryKey {
  if (RENTAL_TYPES.includes(itemKey)) return 'rental_income';
  if (MANAGEMENT_TYPES.includes(itemKey)) return 'management_fee';
  if (THIRD_PARTY_TYPES.includes(itemKey)) return 'third_party';
  return 'others';
}

const TYPE_LABELS: Record<string, string> = {
  rental_income: 'Rental Income', vat_rental: '5% VAT on Rent', vat_fees: 'Fees VAT', security_deposit: 'Security Deposit',
  admin_fee: 'Admin', commission: 'Commission', bounced_cheque_fee: 'Bounced cheque',
  cheque_replacement_fee: 'Cheque hold / replacement', cheque_deferral_fee: 'Cheque deferral',
  late_renewal_fee: 'Late renewal', early_termination_fee: 'Early termination', late_moveout_fee: 'Late move-out',
  unauthorized_sharing_fee: 'Sharing without notice / NOC', access_card_fee: 'Access card / remote replacement',
  contract_name_change_fee: 'Contract name change', unit_transfer_fee: 'Unit transfer', legal_fee: 'Legal cost',
  ejari_fee: 'Contract Registration', maintenance_fee: 'Maintenance', service_charge: 'Service Charge',
  refund: 'Refund', other: 'Other',
};
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Why a listed row is not in the subtotal.
const EXCLUDED_WHY: Record<string, string> = {
  cancelled:         'Cancelled — voided, never collected, so not in any subtotal',
  swapped:           'Replaced — the customer swapped this cheque; the money came in on the replacement row, which IS counted',
  'bounce-replaced': 'Bounced and made good — the replacement cheque carries this money instead',
  'bounced-owed':    'Bounced and not made good — no replacement cheque has been recorded, so the money is still owed and is not counted as collected',
  upcoming:          'Lease not started yet — the cheques are collected and listed; the money counts from the start date',
};

const rowDescription = (d: { paymentType: string; description: string | null }): string =>
  d.paymentType === 'ejari_fee' ? TYPE_LABELS.ejari_fee : (d.description ?? '—');

const STATUS_LABELS: Record<string, string> = {
  held: 'Held', returned: 'Returned', partial_return: 'Partial Return', forfeited: 'Forfeited',
  pending: 'Pending', cleared: 'Cleared', paid: 'Paid', bounced: 'Bounced',
  // A bounce made good with a cheque that has not cleared yet — settled, not collected.
  replaced: 'Replaced', cancelled: 'Cancelled',
};
const STATUS_TONE: Record<string, Tone> = {
  held: 'info', cleared: 'primary', paid: 'primary', returned: 'neutral', partial_return: 'amber',
  pending: 'amber', forfeited: 'danger', bounced: 'danger', replaced: 'neutral', cancelled: 'neutral',
};
const StatusPill = ({ s }: { s: string }) => <Pill tone={STATUS_TONE[s] ?? 'neutral'}>{STATUS_LABELS[s] ?? s}</Pill>;

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
  countsTowardTotals?: boolean;
  excludedReason?: 'cancelled' | 'swapped' | 'bounce-replaced' | 'bounced-owed' | 'upcoming' | null;
  fromYear: number | null;
  toYear: number | null;
  notes: string | null;
  settledRefundAmount: number | null;
  settledDeductionAmount: number | null;
  settledOn: string | null;
  settledViaSettlementId: number | null;
  proofs?: { documentKey: string; displayName: string | null; mimeType: string | null; fileUrl: string | null }[];
  itemKey?: string;
}

const isDepositRow = (d: { paymentType?: string | null }) => (d.paymentType ?? '') === 'security_deposit';
const dueOf = (d: PaymentRow) => d.transactionDate ?? d.recordedDate;

const SETTLED_DEPOSIT = new Set(['returned', 'partial_return', 'forfeited']);
type DepositBucket = 'all' | 'held' | 'settled';
const depositBucketOf = (d: { status: string }): Exclude<DepositBucket, 'all'> =>
  SETTLED_DEPOSIT.has(d.status) ? 'settled' : 'held';

/** Payments by the period they fall DUE; deposits (no collection date) by lease term. */
function yearMatch(d: PaymentRow, y: number): boolean {
  if (!isDepositRow(d)) {
    const due = dueOf(d);
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
      const due = dueOf(d);
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

/** Today in Asia/Dubai as YYYY-MM-DD. */
const dubaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());

const counts = (r: PaymentRow) => r.countsTowardTotals !== false;
const contractHref = (id: number) => `/rental-provider/dashboard/contracts/${id}/v2`;

type Tab = 'payments' | 'deposits';
const COLS = 10;
const DEP_COLS = 9;

export default function PaymentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [rows, setRows]       = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tab, setTab]         = useState<Tab>('payments');
  const [search, setSearch]   = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | CategoryKey>('all');
  const [filterDeposit, setFilterDeposit]   = useState<DepositBucket>('all');
  const [filterStatus, setFilterStatus]     = useState('all');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterOwnership, setFilterOwnership] = useState<'all' | 'direct' | 'sub' | 'management'>('all');
  const [buildingLeasing, setBuildingLeasing] = useState<Record<string, string>>({});
  const [filterYear, setFilterYear]         = useState('all');
  const [depositId, setDepositId] = useState<string | null>(null);
  const [ledgerId, setLedgerId]   = useState<string | null>(null);

  const load = useCallback(async () => {
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
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { void load(); }, [load]);

  // Deep link: ?tab=deposits opens the deposits tab (used by the Receivables page's tabs).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot ?tab= restore after hydration
    if (new URLSearchParams(window.location.search).get('tab') === 'deposits') setTab('deposits');
  }, []);

  useEffect(() => {
    fetch('/api/properties', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((ps: Array<{ buildingName?: string | null; leasingType?: string | null }>) => {
        const m: Record<string, string> = {};
        for (const p of ps ?? []) if (p.buildingName) m[p.buildingName] = p.leasingType ?? 'direct';
        setBuildingLeasing(m);
      })
      .catch(() => { /* ownership filter simply stays inert */ });
  }, []);

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
  const statuses = useMemo(
    () => [...new Set(yearScoped.filter(d => isDepositRow(d) === (tab === 'deposits')).map(d => d.status))],
    [yearScoped, tab],
  );

  const scoped = useMemo(() => yearScoped.filter(d => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (filterBuilding !== 'all' && d.building !== filterBuilding) return false;
    if (filterOwnership !== 'all' && (buildingLeasing[d.building ?? ''] ?? 'direct') !== filterOwnership) return false;
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
  }), [yearScoped, filterStatus, filterBuilding, filterOwnership, buildingLeasing, search]);

  const depositRows = useMemo(() => scoped.filter(isDepositRow), [scoped]);
  const ledgerRows  = useMemo(() => scoped.filter(r => !isDepositRow(r)), [scoped]);

  const catRowsMap = useMemo(() => {
    const m: Record<CategoryKey, PaymentRow[]> = { rental_income: [], management_fee: [], third_party: [], others: [] };
    for (const r of ledgerRows) {
      const itemKey = itemKeyOf(r);
      m[categoryOf(itemKey)].push({ ...r, itemKey });
    }
    return m;
  }, [ledgerRows]);

  const catTotals = useMemo(() => {
    const t: Record<CategoryKey, number> = { rental_income: 0, management_fee: 0, third_party: 0, others: 0 };
    for (const cat of CATEGORY_ORDER) t[cat] = sumAed(catRowsMap[cat].filter(counts), r => r.amount);
    return t;
  }, [catRowsMap]);
  const ledgerTotal = useMemo(() => sumAed(CATEGORY_ORDER, c => catTotals[c]), [catTotals]);
  const excluded = useMemo(() => ledgerRows.filter(r => !counts(r)), [ledgerRows]);
  const excludedTotal = useMemo(() => sumAed(excluded, r => r.amount), [excluded]);

  const depositsHeld = useMemo(
    () => sumAed(depositRows.filter(d => d.status === 'held' && counts(d)), d => d.amount), [depositRows]);
  const depositsTotal = useMemo(() => sumAed(depositRows.filter(counts), d => d.amount), [depositRows]);
  const depositShown = useMemo(
    () => (filterDeposit === 'all' ? depositRows : depositRows.filter(d => depositBucketOf(d) === filterDeposit)),
    [depositRows, filterDeposit],
  );
  const depositShownTotal = useMemo(() => sumAed(depositShown.filter(counts), d => d.amount), [depositShown]);

  const groups = useMemo(() =>
    CATEGORY_ORDER
      .filter(cat => filterCategory === 'all' || cat === filterCategory)
      .map(cat => {
        const catRows = catRowsMap[cat];
        return {
          cat, rows: catRows,
          subtotal: sumAed(catRows.filter(counts), r => r.amount),
          vat: sumAed(catRows.filter(counts), vatOf),
        };
      })
      .filter(g => g.rows.length > 0),
    [catRowsMap, filterCategory],
  );
  const shownCount = useMemo(() => groups.reduce((s, g) => s + g.rows.length, 0), [groups]);

  // ── KPIs — portfolio-wide (every row, not the filters) ──
  const kpi = useMemo(() => {
    const today = dubaiToday();
    const month = today.slice(0, 7);
    const ledger = rows.filter(r => !isDepositRow(r));
    const collected = ledger.filter(r => counts(r) && (r.status === 'cleared' || r.status === 'paid') && (dueOf(r) ?? '').startsWith(month));
    const outstanding = ledger.filter(r => counts(r) && r.status === 'pending');
    const overdue = outstanding.filter(r => { const d = dueOf(r); return !!d && d.slice(0, 10) < today; });
    const bouncedOwed = ledger.filter(r => r.excludedReason === 'bounced-owed');
    const held = rows.filter(r => isDepositRow(r) && r.status === 'held' && counts(r));
    return {
      collected: sumAed(collected, r => r.amount), collectedN: collected.length,
      outstanding: sumAed(outstanding, r => r.amount), outstandingN: outstanding.length,
      overdue: sumAed(overdue, r => r.amount), overdueN: overdue.length,
      bouncedOwed: sumAed(bouncedOwed, r => r.amount), bouncedOwedN: bouncedOwed.length,
      held: sumAed(held, r => r.amount), heldN: held.length,
    };
  }, [rows]);

  const hasFilters = filterCategory !== 'all' || filterDeposit !== 'all' || filterStatus !== 'all' || filterBuilding !== 'all' || filterOwnership !== 'all' || search !== '';
  const clearFilters = () => { setFilterCategory('all'); setFilterDeposit('all'); setFilterStatus('all'); setFilterBuilding('all'); setFilterOwnership('all'); setSearch(''); };

  const goTab = (t: Tab | 'receivables') => {
    if (t === 'receivables') {
      router.push(`${pathname.replace(/\/payments\/?$/, '')}/receivables`);
      return;
    }
    setTab(t); setFilterStatus('all'); setFilterCategory('all'); setFilterDeposit('all');
    try { window.history.replaceState(null, '', t === 'deposits' ? `${pathname}?tab=deposits` : pathname); } catch { /* ignore */ }
  };

  const depositCards: { key: DepositBucket; label: string; value: number; sub: string }[] = [
    { key: 'all',     label: 'On record', value: depositsTotal,                                  sub: 'every deposit — contains both' },
    { key: 'held',    label: 'Held now',  value: depositsHeld,                                   sub: 'refundable at move-out' },
    { key: 'settled', label: 'Settled',   value: (toFils(depositsTotal) - toFils(depositsHeld)) / 100, sub: 'returned, part-returned or kept' },
  ];

  const deposit = depositId !== null ? rows.find(d => d.id === depositId) ?? null : null;
  const ledger  = ledgerId !== null ? rows.find(d => d.id === ledgerId) ?? null : null;

  const contractCell = (d: PaymentRow) => d.contractId
    ? <Link href={contractHref(d.contractId)} onClick={e => e.stopPropagation()} style={{ color: 'var(--ms-primary, #047246)', fontWeight: 600 }}>{d.contractRef}</Link>
    : <span>—</span>;

  const emptyTitle = (what: string) =>
    filterYear !== 'all' ? `No ${what} for ${filterYear}.` : hasFilters ? `No ${what} match your filters.` : `No ${what} recorded yet.`;
  const emptyText = (what: string) =>
    filterYear !== 'all' ? ` Switch to “All years” to see every ${what.replace(/s$/, '')}.` : hasFilters ? ' Reset the filters to see everything.' : ` ${what[0].toUpperCase()}${what.slice(1)} are recorded from the contract detail page.`;

  return (
    <OsPage>
      <PageHead
        eyebrow="Finance › Payments & deposits"
        title="Payments & deposits"
        lede={tab === 'payments'
          ? 'Every payment across your rental agreements, grouped by category. Pick a category to narrow the ledger.'
          : 'Every deposit you are holding on a customer’s behalf. Open one for its proofs, move-in condition and settlement.'}
        actions={<>
          <select className="gx-sel" value={filterYear} onChange={e => setFilterYear(e.target.value)}
            aria-label="Filter payments by year"
            title="Scope the page by the year a payment falls due (deposits, which carry no collection date, by their lease term)">
            <option value="all">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Btn onClick={load} disabled={loading}><RefreshCw size={13} aria-hidden /> Refresh</Btn>
        </>}
      />
      <BasisNote slug={tab === 'payments' ? 'payments' : 'security-deposits'} className="mb-3 max-w-3xl" />

      <Kpis>
        <Kpi k="Collected this month" v={loading ? '…' : fmtAed(kpi.collected)} d={`${kpi.collectedN} cleared line${kpi.collectedN !== 1 ? 's' : ''} due this month`} />
        <Kpi dark k="Outstanding" v={loading ? '…' : fmtAed(kpi.outstanding)} d={`${kpi.outstandingN} pending line${kpi.outstandingN !== 1 ? 's' : ''}`} />
        <Kpi k="Overdue" v={loading ? '…' : fmtAed(kpi.overdue)}
          d={`${kpi.overdueN} pending past due${kpi.bouncedOwedN ? ` · plus ${fmtAed(kpi.bouncedOwed)} bounced, not made good` : ''}`} />
        <Kpi k="Deposits held" v={loading ? '…' : fmtAed(kpi.held)} d={`${kpi.heldN} deposit${kpi.heldN !== 1 ? 's' : ''} — a liability, not income`} />
      </Kpis>

      <div style={{ margin: '14px 0 10px' }}>
        <Seg<Tab | 'receivables'>
          label="Finance views"
          value={tab}
          onChange={goTab}
          options={[
            { v: 'payments', l: 'Payments', n: ledgerRows.length },
            { v: 'deposits', l: 'Security Deposits', n: depositRows.length },
            { v: 'receivables', l: 'Receivables' },
          ]}
        />
      </div>

      {tab === 'deposits' && (
        <Callout tone="info" title="Money held, not money moved —">
          a deposit is a liability until released. It never joins the payment ledger&apos;s totals.
        </Callout>
      )}

      {/* Category / bucket chips = the top-level filter (toggle). */}
      <div className="gx-chips" style={{ margin: '10px 0' }} role="group" aria-label={tab === 'payments' ? 'Filter by category' : 'Filter deposits'}>
        {tab === 'payments'
          ? CATEGORY_ORDER.map(c => (
              <button key={c} type="button" className="gx-chip" aria-pressed={filterCategory === c}
                title={CATEGORY_SUB[c]} onClick={() => setFilterCategory(filterCategory === c ? 'all' : c)}>
                {CATEGORY_LABELS[c]} · {fmtAed(catTotals[c])}
              </button>
            ))
          : depositCards.map(c => (
              <button key={c.key} type="button" className="gx-chip" aria-pressed={filterDeposit === c.key}
                title={c.sub} onClick={() => setFilterDeposit(filterDeposit === c.key ? 'all' : c.key)}>
                {c.label} · {fmtAed(c.value)}
              </button>
            ))}
      </div>

      <TableWrap toolbar={<>
        <SearchField value={search} onChange={setSearch} placeholder="Search ref, customer, unit, description…" />
        {statuses.length > 0 && (
          <select className="gx-sel" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {statuses.map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </select>
        )}
        {buildings.length > 0 && (
          <select className="gx-sel" value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)} aria-label="Filter by building">
            <option value="all">All buildings</option>
            {buildings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <select className="gx-sel" value={filterOwnership} onChange={e => setFilterOwnership(e.target.value as typeof filterOwnership)}
          aria-label="Filter payments by property ownership">
          <option value="all">All properties</option>
          <option value="direct">{OWNERSHIP_LABEL.direct}</option>
          <option value="sub">{OWNERSHIP_LABEL.sub}</option>
          <option value="management">{OWNERSHIP_LABEL.management}</option>
        </select>
        {hasFilters && <Btn size="sm" variant="ghost" onClick={clearFilters}>Reset filters</Btn>}
        <span className="sp" />
        <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>
          {tab === 'payments'
            ? `${shownCount} line${shownCount !== 1 ? 's' : ''}${filterCategory !== 'all' ? ` · ${CATEGORY_LABELS[filterCategory]}` : ''} · ${fmtAed(ledgerTotal)} counted`
            : `${depositShown.length} line${depositShown.length !== 1 ? 's' : ''} · ${fmtAed(depositsHeld)} held now`}
        </span>
      </>}>
        {tab === 'payments' ? (
          <table className="gx-tbl" style={{ minWidth: 1040 }}>
            <thead>
              <tr>
                <th>Ref</th><th>Contract</th><th>Building · Unit</th><th>Customer</th><th>Description</th>
                <th className="num">Amount</th><th className="num">VAT</th><th>Status</th><th>Due</th><th className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {loading ? <SkeletonRows cols={COLS} />
              : error ? <ErrorRow cols={COLS} onRetry={load} />
              : shownCount === 0 ? <EmptyRow cols={COLS} title={emptyTitle('payments')} text={emptyText('payments')} />
              : (
                <tbody>
                  {groups.map(g => (
                    <CategoryBlock key={g.cat} category={g.cat} rows={g.rows} subtotal={g.subtotal} vat={g.vat}
                      onOpen={setLedgerId} contractCell={contractCell} />
                  ))}
                </tbody>
              )}
          </table>
        ) : (
          <table className="gx-tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Ref</th><th>Contract</th><th>Building · Unit</th><th>Customer</th>
                <th className="num">Amount</th><th>Status</th><th>Date</th><th>Settlement</th><th className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {loading ? <SkeletonRows cols={DEP_COLS} />
              : error ? <ErrorRow cols={DEP_COLS} onRetry={load} />
              : depositShown.length === 0 ? <EmptyRow cols={DEP_COLS} title={emptyTitle('deposits')} text={emptyText('deposits')} />
              : (
                <tbody>
                  <tr style={{ background: 'var(--ms-surface-3)' }}>
                    <td colSpan={4} className="strong" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      {depositCards.find(c => c.key === filterDeposit)?.label ?? 'On record'}
                      <span className="sub" style={{ display: 'inline', marginLeft: 8, textTransform: 'none' }}>
                        {depositShown.length} record{depositShown.length !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="num strong">{fmtAed(depositShownTotal)}</td>
                    <td colSpan={4} />
                  </tr>
                  {depositShown.map(d => (
                    <tr key={d.id} className="click" onClick={() => setDepositId(d.id)}>
                      <td className="mono strong">{d.depositRef}</td>
                      <td>{contractCell(d)}</td>
                      <td>{d.building}<span className="sub">{d.unit}</span></td>
                      <td>{d.tenant}</td>
                      <td className="num strong">{fmtAed(d.amount)}</td>
                      <td><StatusPill s={d.status} /></td>
                      <td className="nowrap">{fmtDate(dueOf(d))}</td>
                      <td className="nowrap">
                        {d.settledOn
                          ? <>Refunded {fmtAed(d.settledRefundAmount ?? 0)}<span className="sub">Deducted {fmtAed(d.settledDeductionAmount ?? 0)} · {d.settledOn}</span></>
                          : '—'}
                      </td>
                      <td className="act">
                        <Btn size="xs" onClick={() => setDepositId(d.id)}>Open</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
          </table>
        )}
      </TableWrap>

      {tab === 'payments' && !loading && !error && excluded.length > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 8 }}>
          {excluded.length} line{excluded.length !== 1 ? 's' : ''} ({fmtAed(excludedTotal)}) listed but not counted — cancelled, a bounce its replacement already covers, or a bounce that was never made good. Their amounts are struck through.
        </p>
      )}

      {/* Ledger row — read-only record (payments are recorded on the lease record). */}
      <Drawer
        open={!!ledger}
        onClose={() => setLedgerId(null)}
        title={ledger ? rowDescription(ledger) : ''}
        sub={ledger ? `${ledger.depositRef} · ${ledger.unit}` : undefined}
        footer={ledger && <>
          {ledger.contractId && <Btn variant="primary" href={contractHref(ledger.contractId)}>Open contract</Btn>}
          {ledger.currentContractId && ledger.currentContractId !== ledger.contractId && (
            <Btn href={contractHref(ledger.currentContractId)}>Open current lease</Btn>
          )}
          <Btn variant="ghost" onClick={() => setLedgerId(null)}>Close</Btn>
        </>}
      >
        {ledger && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <StatusPill s={ledger.status} />
              <Pill tone="outline" dot={false}>{CATEGORY_LABELS[categoryOf(itemKeyOf(ledger))]}</Pill>
            </div>
            <KV items={[
              { k: 'Amount', v: fmtAed(ledger.amount) },
              { k: 'VAT', v: vatOf(ledger) > 0 ? fmtAed(vatOf(ledger)) : '—' },
              { k: 'Item', v: typeLabel(itemKeyOf(ledger)) },
              { k: 'Due', v: fmtDate(dueOf(ledger)) },
              { k: 'Contract', v: ledger.contractRef || '—' },
              { k: 'Customer', v: ledger.tenant },
              { k: 'Building', v: ledger.building },
              { k: 'Unit', v: ledger.unit },
              { k: 'Ownership', v: OWNERSHIP_LABEL[buildingLeasing[ledger.building ?? ''] ?? 'direct'] },
              { k: 'Lease term', v: ledger.startDate || ledger.endDate ? `${fmtDate(ledger.startDate)} – ${fmtDate(ledger.endDate)}` : '—' },
            ]} />
            <div style={{ marginTop: 12 }}>
              {counts(ledger)
                ? <Evid tone="ok"><strong>Counted.</strong> This line is included in the {CATEGORY_LABELS[categoryOf(itemKeyOf(ledger))]} subtotal.</Evid>
                : <Evid tone="warn"><strong>Listed, not counted.</strong> {EXCLUDED_WHY[ledger.excludedReason ?? 'bounce-replaced']}</Evid>}
            </div>
            {ledger.notes && (
              <div style={{ marginTop: 12 }}><KV items={[{ k: 'Notes', v: ledger.notes }]} /></div>
            )}
            <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 12 }}>
              Payments are recorded, cleared, bounced and replaced on the lease record — open the contract to act on this line.
            </p>
          </>
        )}
      </Drawer>

      {deposit && (
        <DepositDetailModal
          deposit={deposit as unknown as DepositRow}
          loadDetail={loadDepositDetail}
          onClose={() => setDepositId(null)}
          links={{
            contract: (id) => `/rental-provider/dashboard/contracts/${id}/v2`,
            settlement: (id) => `/rental-provider/dashboard/contracts/${id}/settlement`,
            receipt: (id) => `/rental-provider/dashboard/contracts/${id}/print/receipt?kind=deposit`,
          }}
        />
      )}
    </OsPage>
  );
}

/** One category block: subtotal header, then per-item sub-headers when the category
 *  spans more than one item. Every row has a labelled "Open" button. */
function CategoryBlock({
  category, rows, subtotal, vat, onOpen, contractCell,
}: {
  category: CategoryKey;
  rows: PaymentRow[];
  subtotal: number;
  vat: number;
  onOpen: (id: string) => void;
  contractCell: (d: PaymentRow) => ReactNode;
}) {
  const keyOf = (r: PaymentRow) => r.itemKey ?? r.paymentType;
  const configured = TYPE_ORDER[category] ?? [];
  const present = [...new Set(rows.map(keyOf))];
  const typeOrder = [...configured.filter(t => present.includes(t)), ...present.filter(t => !configured.includes(t))];
  const byType = typeOrder.map(t => ({ type: t, rows: rows.filter(r => keyOf(r) === t) })).filter(g => g.rows.length > 0);
  const multiType = byType.length > 1;

  return (
    <>
      <tr style={{ background: 'var(--ms-surface-3)' }}>
        <td colSpan={5} className="strong" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {CATEGORY_LABELS[category]}
          <span className="sub" style={{ display: 'inline', marginLeft: 8, textTransform: 'none' }}>
            {rows.length} record{rows.length !== 1 ? 's' : ''}
          </span>
        </td>
        <td className="num strong">{fmtAed(subtotal)}</td>
        <td className="num">{vat > 0 ? fmtAed(vat) : '—'}</td>
        <td colSpan={3} />
      </tr>
      {byType.map(grp => {
        const grpTotal = sumAed(grp.rows, r => r.amount);
        const grpVat   = sumAed(grp.rows, vatOf);
        return (
          <Fragment key={grp.type}>
            {multiType && (
              <tr>
                <td colSpan={5} className="strong" style={{ paddingLeft: 24 }}>
                  {typeLabel(grp.type)}<span className="sub" style={{ display: 'inline', marginLeft: 8 }}>{grp.rows.length}</span>
                </td>
                <td className="num strong">{fmtAed(grpTotal)}</td>
                <td className="num">{grpVat > 0 ? fmtAed(grpVat) : '—'}</td>
                <td colSpan={3} />
              </tr>
            )}
            {grp.rows.map(d => {
              const excluded = d.countsTowardTotals === false;
              return (
                <tr key={d.id} className="click" onClick={() => onOpen(d.id)}>
                  <td className="mono strong" style={multiType ? { paddingLeft: 24 } : undefined}>{d.depositRef}</td>
                  <td>{contractCell(d)}</td>
                  <td>{d.building}<span className="sub">{d.unit}</span></td>
                  <td>{d.tenant}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rowDescription(d)}>{rowDescription(d)}</td>
                  <td className="num strong"
                    style={excluded ? { textDecoration: 'line-through', color: 'var(--ms-ink-3)' } : undefined}
                    title={excluded ? EXCLUDED_WHY[d.excludedReason ?? 'bounce-replaced'] : undefined}>
                    {fmtAed(d.amount)}
                  </td>
                  <td className="num">{vatOf(d) > 0 ? fmtAed(vatOf(d)) : '—'}</td>
                  <td><StatusPill s={d.status} /></td>
                  <td className="nowrap">{fmtDate(d.transactionDate ?? d.recordedDate)}</td>
                  <td className="act">
                    <Btn size="xs" onClick={() => onOpen(d.id)}>Open</Btn>
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
