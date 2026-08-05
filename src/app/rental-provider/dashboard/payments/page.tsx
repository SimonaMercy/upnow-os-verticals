'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Wallet, Loader2, RefreshCw, ExternalLink, Calendar, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import DepositDetailModal, { type DepositDetail, type DepositRow } from '@/components/upnow/DepositDetailModal';
import { taxPortionOf } from '@/lib/chargeTax';
import { BasisNote } from '@/components/upnow/reportCatalog';

/** Portfolio-wide Payments ledger (SCRUM-577 / 579). Lists every payment row across
 *  the RP's contracts, grouped into top-level CATEGORIES that mirror the Payment
 *  Grouping report one-to-one — Rental Income (rent), Security Deposit,
 *  Management Fee (admin, commission + Settings → Rules penalties), Third Party
 *  (Contract Registration, Fees VAT and pass-throughs the RP collects on behalf of
 *  others) and Other — with a per-category subtotal and a per-type breakdown inside
 *  the multi-type categories. The category breakdown doubles as the top-level filter
 *  (click a summary card).
 *
 *  TWO TABS: Payments (money that moved) and Security Deposits (money being held).
 *  Deposit rows keep their held/returned status, settlement and detail drawer;
 *  every other row is read-only. */

// ─── Categories (top level) ───────────────────────────────────────────────
// Security Deposit is deliberately NOT one of these. It is money the landlord
// HOLDS for the customer, not money the tenancy earned or the customer owes, and
// it has a life the payment categories do not model — a settlement, a proof, a
// held→returned status, a carry-forward across a renewal. It gets its own TAB,
// with its own totals, so its money can never be added to the ledger's.
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
// rather than in vat_amount ("5% VAT on sub-lease" IS tax), so read it through
// the shared rule instead of the stored column — see lib/chargeTax.
const vatOf = (r: { paymentType: string; description?: string | null; vatAmount?: number | null; amount: number }) =>
  taxPortionOf(r, r.amount);

// A `vat` payment is "Fees VAT" (the combined VAT cheque on admin/commission fees)
// when its description says so. Every other `vat` cheque is rent VAT. BOTH sit
// under Third Party — VAT is collected, not earned, and the rent-VAT cheque is
// the same charge that other contracts hold as a free-text "5% VAT on Rent" row.
// Identical to the Payment Grouping report's split, so the two reconcile one-to-one.
const isFeesVat = (p: { paymentType?: string | null; description?: string | null }) =>
  (p.paymentType ?? '') === 'vat' && /fees\s*vat/i.test(p.description ?? '');

// The sub-item a payment row belongs to. VAT splits into rental vs fees; every
// other row keeps its raw payment type. Contract Registration (Ejari) is a SINGLE
// item — NOT split into DLD + service — matching the report.
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
// Third Party — pass-through fees the RP collects on behalf of others. `other`
// belongs here (a sub-leased building's levy and the tax on it, service charges),
// matching the contract page, the receipts and the segregated payment plan;
// leaving it in the catch-all filed that money under "uncategorised".
const THIRD_PARTY_TYPES = ['vat_rental', 'ejari_fee', 'vat_fees', 'maintenance_fee', 'service_charge', 'refund', 'other'];
// Per-category display order for the type sub-groups.
const TYPE_ORDER: Partial<Record<CategoryKey, string[]>> = {
  rental_income:  RENTAL_TYPES,
  management_fee: MANAGEMENT_TYPES,
  third_party:    THIRD_PARTY_TYPES,
};

// Ownership segregation by the property's leasing model (properties.leasing_type),
// mirroring the Payment Grouping report — direct = Own Property, sub = Sub-lease,
// management = Property Management. Resolved per row via its building name.
const OWNERSHIP_LABEL: Record<string, string> = { direct: 'Own Property', sub: 'Sub-lease', management: 'Property Management' };

// Route a sub-item key (from itemKeyOf) to its top-level category. Unmapped types
// fall through to Other, so nothing is ever silently dropped.
function categoryOf(itemKey: string): CategoryKey {
  if (RENTAL_TYPES.includes(itemKey)) return 'rental_income';
  if (MANAGEMENT_TYPES.includes(itemKey)) return 'management_fee';
  if (THIRD_PARTY_TYPES.includes(itemKey)) return 'third_party';
  return 'others';
}

// Per-type labels (used for the sub-rows inside multi-type categories). Mirrors the
// Payment Grouping report's item labels.
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

// Why a listed row is not in the subtotal. Every one of these is money the
// landlord does NOT have: voided, superseded by a replacement, or returned by the
// bank and never made good. The row keeps its line — this is a ledger — and the
// reason is on the amount, so a struck-through figure is never a mystery.
const EXCLUDED_WHY: Record<string, string> = {
  cancelled:        'Cancelled — voided, never collected, so not in any subtotal',
  'bounce-replaced': 'Bounced and made good — the replacement cheque carries this money instead',
  // Cash Management reports the same cheque as "bounced, still owed" beside its
  // total rather than inside it; this page now agrees with it.
  'bounced-owed':   'Bounced and not made good — no replacement cheque has been recorded, so the money is still owed and is not counted as collected',
};

// The Contract-Registration (ejari) fee was historically recorded under several
// free-text descriptions ("Ejari fee", "Ejari Fee", "Contract Registration Fee"…).
// Show the single canonical name so the ledger reads consistently (the government
// "Ejari" name is kept only in the printed contract). Every other row keeps its own
// description, which carries real per-payment detail (instalment no., period, notes).
const rowDescription = (d: { paymentType: string; description: string | null }): string =>
  d.paymentType === 'ejari_fee' ? TYPE_LABELS.ejari_fee : (d.description ?? '—');

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
  // Server-derived (`shared/payment-basis.ts`): whether this row belongs in a
  // money total. This page is the LEDGER and keeps listing every row whatever the
  // answer — a ledger that hides rows is not one — but the category subtotals
  // honour it, so they agree with Payment Grouping and Fee & VAT.
  countsTowardTotals?: boolean;
  excludedReason?: 'cancelled' | 'bounce-replaced' | 'bounced-owed' | null;
  fromYear: number | null;
  toYear: number | null;
  notes: string | null;
  settledRefundAmount: number | null;
  settledDeductionAmount: number | null;
  settledOn: string | null;
  settledViaSettlementId: number | null;
  proofs?: DepositProof[];
  // Derived sub-item key for grouping (rental vs fees VAT, etc.); set in catRowsMap.
  itemKey?: string;
}

interface DepositProof {
  documentKey: string;
  displayName: string | null;
  mimeType: string | null;
  fileUrl: string | null;
}

function fmtAed(v: number) {
  // Whole amounts stay clean (AED 20,000); fractional amounts keep 2 dp so VAT
  // and other fractional cheques aren't rounded away.
  const fractional = Math.round(v) !== v;
  return new Intl.NumberFormat('en-AE', {
    style: 'currency', currency: 'AED',
    minimumFractionDigits: fractional ? 2 : 0,
    maximumFractionDigits: fractional ? 2 : 0,
  }).format(v);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// A deposit has no collection date to filter on — `recorded_date` is NULL across
// the register and `due_date` is the cheque's written / refund date, scattered
// 2001→2026 (see the Security Deposits report, which for the same reason carries
// no year filter at all). Deposit rows therefore stay on the lease TERM; every
// other row is filtered on the period it falls DUE.
const isDepositRow = (d: { paymentType?: string | null }) => (d.paymentType ?? '') === 'security_deposit';

// The deposits tab's top-level buckets — the same role the payment CATEGORIES
// play on the other tab, so both tabs read as one design: a row of cards that
// summarise, and clicking one filters. A deposit's bucket is its lifecycle state:
// still the landlord's to give back, or already dealt with.
const SETTLED_DEPOSIT = new Set(['returned', 'partial_return', 'forfeited']);
type DepositBucket = 'all' | 'held' | 'settled';
const depositBucketOf = (d: { status: string }): Exclude<DepositBucket, 'all'> =>
  SETTLED_DEPOSIT.has(d.status) ? 'settled' : 'held';

/** The year a payment belongs to: the period it falls DUE — its tax point, the
 *  same basis Payment Grouping and Fee & VAT bucket on, so a year selected here
 *  means the same money there.
 *
 *  This used to match any row whose lease TERM overlapped Y, which is not a
 *  period basis at all. Now that the ledger lists one live lease per unit, every
 *  lease overlaps the current year and "2026" quietly meant "all years"
 *  (AED 7,163,920 against 5,329,285 actually due); "2027" showed 3,921,700
 *  against 883,300. Before the scope fix it was worse — 2026 read 13,838,695,
 *  of which 6,413,819 was cheques dated 2025 or 2027. */
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
    // A payment with no date yet belongs to no year — it shows under All years
    // only, rather than being silently attributed to one.
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

/** Every year the dropdown can offer — built on the SAME rule yearMatch applies,
 *  or the picker offers a year that selects nothing. */
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

/** The two things this screen answers, one tab each: money that MOVED (the
 *  ledger) and money the landlord is HOLDING (deposits). They share nothing but
 *  the source call — different totals, different statuses, different meaning of
 *  a date — which is exactly why they are not one list. */
type Tab = 'payments' | 'deposits';

export default function PaymentsPage() {
  const [rows, setRows]       = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tab, setTab]         = useState<Tab>('payments');
  const [search, setSearch]   = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | CategoryKey>('all');
  // The deposits tab's equivalent of filterCategory — driven by its own cards.
  const [filterDeposit, setFilterDeposit]   = useState<DepositBucket>('all');
  const [filterStatus, setFilterStatus]     = useState('all');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterOwnership, setFilterOwnership] = useState<'all' | 'direct' | 'sub' | 'management'>('all');
  const [buildingLeasing, setBuildingLeasing] = useState<Record<string, string>>({});
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

  // Building → leasing model, so payments can be segregated by ownership
  // (same source as the Payment Grouping report).
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
  // The two tabs have DIFFERENT status vocabularies — a deposit is held/returned/
  // forfeited, a payment is cleared/pending/bounced — so the dropdown offers only
  // the states the visible tab can actually be in. Offering both made most of the
  // list select nothing.
  const statuses = useMemo(
    () => [...new Set(yearScoped.filter(d => isDepositRow(d) === (tab === 'deposits')).map(d => d.status))],
    [yearScoped, tab],
  );

  // Everything EXCEPT the category filter — the category cards summarise this, and
  // the category filter narrows it down to the chosen category.
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

  // Split every payment into its category bucket. Each row is tagged with its
  // sub-item key (rental vs fees VAT; Contract Registration stays a single item)
  // and routed by categoryOf — mirroring the Payment Grouping report exactly, so
  // the two surfaces reconcile one-to-one.
  // Deposits leave the ledger here, before anything is categorised or counted —
  // they are held money and live in their own TAB with their own total. Both sets
  // are computed whatever the active tab, so each tab can show the other's size
  // without recomputing the filter chain.
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

  /** A row belongs in a money total unless the server says otherwise (voided, or
   *  a bounce whose replacement is already in the list). An older API response
   *  carrying no flag counts, so a stale deploy under-reports nothing. */
  const counts = (r: PaymentRow) => r.countsTowardTotals !== false;

  // Per-category totals (over the full scoped set, so the cards always show every
  // category's amount regardless of which one is currently selected). Excluded
  // rows stay in the LIST below and out of these figures — that is the whole
  // difference between a ledger and a statement.
  const catTotals = useMemo(() => {
    const t: Record<CategoryKey, number> = { rental_income: 0, management_fee: 0, third_party: 0, others: 0 };
    for (const cat of CATEGORY_ORDER) t[cat] = catRowsMap[cat].filter(counts).reduce((s, r) => s + r.amount, 0);
    return t;
  }, [catRowsMap]);
  // Named beside the cards so a subtotal that no longer matches the rows under it
  // is explained rather than looking like a bug.
  const excludedTotal = useMemo(
    () => ledgerRows.filter(r => !counts(r)).reduce((s, r) => s + r.amount, 0),
    [ledgerRows],
  );
  const excludedCount = useMemo(() => ledgerRows.filter(r => !counts(r)).length, [ledgerRows]);
  // "Held" is the live obligation — a settled deposit has been returned or kept
  // and is no longer the landlord's to give back, so it is listed but not held.
  const depositsHeld = useMemo(
    () => depositRows.filter(d => d.status === 'held' && counts(d)).reduce((s, d) => s + d.amount, 0),
    [depositRows],
  );
  const depositsTotal = useMemo(
    () => depositRows.filter(counts).reduce((s, d) => s + d.amount, 0),
    [depositRows],
  );
  // The rows the deposits table actually lists. The three totals above are
  // computed over the UNFILTERED set, so every card keeps showing its own amount
  // whichever one is selected — exactly how the category cards behave.
  const depositShown = useMemo(
    () => (filterDeposit === 'all' ? depositRows : depositRows.filter(d => depositBucketOf(d) === filterDeposit)),
    [depositRows, filterDeposit],
  );
  const depositShownTotal = useMemo(
    () => depositShown.filter(counts).reduce((s, d) => s + d.amount, 0),
    [depositShown],
  );

  // Category blocks in canonical order; the category card acts as the filter.
  const groups = useMemo(() =>
    CATEGORY_ORDER
      .filter(cat => filterCategory === 'all' || cat === filterCategory)
      .map(cat => {
        const catRows = catRowsMap[cat];
        return {
          cat,
          rows: catRows,
          // Every row is listed; only the counting ones are summed.
          subtotal: catRows.filter(counts).reduce((s, r) => s + r.amount, 0),
          vat: catRows.filter(counts).reduce((s, r) => s + vatOf(r), 0),
        };
      })
      .filter(g => g.rows.length > 0),
    [catRowsMap, filterCategory],
  );
  const shownCount = useMemo(() => groups.reduce((s, g) => s + g.rows.length, 0), [groups]);

  const hasFilters = filterCategory !== 'all' || filterDeposit !== 'all' || filterStatus !== 'all' || filterBuilding !== 'all' || filterOwnership !== 'all' || search !== '';
  const clearFilters = () => { setFilterCategory('all'); setFilterDeposit('all'); setFilterStatus('all'); setFilterBuilding('all'); setFilterOwnership('all'); setSearch(''); };

  // Switching tab drops the filters whose vocabulary does not survive the move —
  // a payment status means nothing on deposits, and each tab's top-level bucket
  // means nothing on the other. Search, building, ownership and year DO carry
  // across: "this building, this year" is the same question on either tab.
  const goTab = (t: Tab) => { setTab(t); setFilterStatus('all'); setFilterCategory('all'); setFilterDeposit('all'); };

  const TABS: { key: Tab; label: string; count: number; total: number }[] = [
    { key: 'payments', label: 'Payments',          count: ledgerRows.length,  total: CATEGORY_ORDER.reduce((s, c) => s + catTotals[c], 0) },
    { key: 'deposits', label: 'Security Deposits', count: depositRows.length, total: depositsHeld },
  ];

  // The deposits tab's cards. Same shape as `cards` below — label, value, sub —
  // so both tabs render through the identical markup. "On record" is the reset
  // card: it CONTAINS the other two rather than sitting beside them, which is
  // why it leads and why the sub-line says so.
  const depositCards: { key: DepositBucket; label: string; value: number; sub: string }[] = [
    { key: 'all',     label: 'On record', value: depositsTotal,               sub: 'every deposit — contains both' },
    { key: 'held',    label: 'Held now',  value: depositsHeld,                sub: 'refundable at move-out' },
    { key: 'settled', label: 'Settled',   value: depositsTotal - depositsHeld, sub: 'returned, part-returned or kept' },
  ];

  const detail = detailId !== null ? rows.find(d => d.id === detailId) ?? null : null;

  // Top-level category cards (the first is the "all / total" reset).
  const cards: { key: CategoryKey; label: string; value: number; sub: string }[] = [
    { key: 'rental_income',    label: CATEGORY_LABELS.rental_income,       value: catTotals.rental_income, sub: CATEGORY_SUB.rental_income },
    { key: 'management_fee',   label: CATEGORY_LABELS.management_fee,      value: catTotals.management_fee, sub: CATEGORY_SUB.management_fee },
    { key: 'third_party',      label: CATEGORY_LABELS.third_party,         value: catTotals.third_party,   sub: CATEGORY_SUB.third_party },
    { key: 'others',           label: CATEGORY_LABELS.others,              value: catTotals.others,        sub: CATEGORY_SUB.others },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Payments</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">
            {tab === 'payments'
              ? 'Every payment across your rental agreements — by category. Click a card to filter.'
              : 'Every deposit you are holding on a customer’s behalf. Click a row for its proofs, move-in condition and settlement.'}
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

      {/* ── Tabs ────────────────────────────────────────────────────────────
          Money that MOVED vs money being HELD. Deposits used to sit under the
          ledger, which read as one continuous list and invited the two totals to
          be added together — they must never be. */}
      <div className="flex items-center gap-1 border-b border-[#e8e6e0] mb-6">
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => goTab(t.key)}
              aria-current={active ? 'page' : undefined}
              className={`relative -mb-px px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                active ? 'border-[#2e9f82] text-[#1a1916]' : 'border-transparent text-[#6b6860] hover:text-[#1a1916]'}`}>
              {t.label}
              <span className={`ml-2 text-xs font-medium ${active ? 'text-[#2e9f82]' : 'text-[#9b9890]'}`}>
                {t.count}
              </span>
            </button>
          );
        })}
        <span className="ml-auto pb-2 text-xs text-[#9b9890]">
          {tab === 'payments'
            ? `${fmtAed(TABS[0].total)} counted`
            : `${fmtAed(depositsHeld)} held now`}
        </span>
      </div>

      {/* Category cards = the top-level filter. Click to narrow the ledger. */}
      {tab === 'payments' && (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        {cards.map(c => {
          const active = filterCategory === c.key;
          return (
            <button key={c.key} type="button" onClick={() => setFilterCategory(active ? 'all' : c.key)}
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
          same click-to-filter behaviour. The one difference is meaning: On record
          CONTAINS Held now and Settled, so these three are a total and its two
          parts, never three figures to add. */}
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
        <select value={filterOwnership} onChange={e => setFilterOwnership(e.target.value as typeof filterOwnership)}
          aria-label="Filter payments by property ownership"
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
          <option value="all">All Properties</option>
          <option value="direct">{OWNERSHIP_LABEL.direct}</option>
          <option value="sub">{OWNERSHIP_LABEL.sub}</option>
          <option value="management">{OWNERSHIP_LABEL.management}</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters}
            className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">
          {tab === 'payments' ? shownCount : depositShown.length} line{(tab === 'payments' ? shownCount : depositShown.length) !== 1 ? 's' : ''}
          {tab === 'payments' && filterCategory !== 'all' ? ` · ${CATEGORY_LABELS[filterCategory]}` : ''}
          {tab === 'deposits' && filterDeposit !== 'all' ? ` · ${depositCards.find(c => c.key === filterDeposit)?.label}` : ''}
        </span>
        {/* Every line is listed; the subtotals count only what was collectible.
            Saying so here is what lets this page and the reports be compared. */}
        {tab === 'payments' && excludedCount > 0 && (
          <span className="text-xs text-[#6b6860]">
            {excludedCount} line{excludedCount !== 1 ? 's' : ''} ({fmtAed(excludedTotal)}) listed but not counted — cancelled, a bounce its replacement already covers, or a bounce that was never made good
          </span>
        )}
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
        ) : shownCount === 0 ? (
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
      )}

      {/* ── Security deposits — its own tab, never a payment category ──────────
          Money the landlord holds on the customer's behalf: it is not income, it
          is not receivable, and it never joins the ledger's subtotals. A tab
          rather than a section under the ledger, so the two totals can never be
          read as one running list. */}
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
              <p className="text-xs text-[#9b9890]">
                {filterYear !== 'all' ? 'Switch to “All years” to see every deposit.' : 'Deposits are recorded from the contract detail page.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[900px]">
                <thead>
                  <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                    {['Ref', 'Contract', 'Building', 'Unit', 'Customer', 'Amount', 'Status', 'Date', ''].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Subtotal header, identical to the ledger's category header —
                      the eye can add up the Amount column and land on it. */}
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

/** One category block: a subtotal header, then — when the category holds more than
 *  one sub-item — a per-item sub-header + its rows; single-item categories list
 *  their rows directly. Only security-deposit rows are clickable. */
function CategoryBlock({
  category, rows, subtotal, vat, onRowClick,
}: {
  category: CategoryKey;
  rows: PaymentRow[];
  subtotal: number;
  vat: number;
  onRowClick: (id: string) => void;
}) {
  const keyOf = (r: PaymentRow) => r.itemKey ?? r.paymentType;
  // Distinct sub-items present in this category, in a stable order (any not in the
  // configured order are appended so nothing is dropped).
  const configured = TYPE_ORDER[category] ?? [];
  const present = [...new Set(rows.map(keyOf))];
  const typeOrder = [...configured.filter(t => present.includes(t)), ...present.filter(t => !configured.includes(t))];
  const byType = typeOrder
    .map(t => ({ type: t, rows: rows.filter(r => keyOf(r) === t) }))
    .filter(g => g.rows.length > 0);
  // Show per-item sub-headers only when the category spans more than one item.
  const multiType = byType.length > 1;

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
        const grpVat   = grp.rows.reduce((s, r) => s + vatOf(r), 0);
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
                  <td className="px-4 py-3.5 text-[#6b6860] max-w-[220px] truncate" title={rowDescription(d)}>{rowDescription(d)}</td>
                  {/* Struck through when the row is listed but not counted, so
                      the eye can add up the column and land on the subtotal. */}
                  <td className={`px-4 py-3.5 font-semibold ${d.countsTowardTotals === false ? 'line-through text-[#9b9890]' : ''}`}
                    title={d.countsTowardTotals === false ? EXCLUDED_WHY[d.excludedReason ?? 'bounce-replaced'] : undefined}>
                    {fmtAed(d.amount)}
                  </td>
                  <td className="px-4 py-3.5 text-[#6b6860]">{vatOf(d) > 0 ? fmtAed(vatOf(d)) : '—'}</td>
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
