'use client';

/**
 * Manager · Payments — the finance-only manager's working screen.
 *
 * ONE flat list, the way accounting software shows a ledger (owner, 22 Sep
 * 2026: the grouped ledger with subtotals and notes "looks messy" next to Xero):
 * title + one line · the action top-right · four tiles · one filter row with
 * status pills · a single grid table, newest first. Nothing is grouped, nothing
 * is explained on the page; a row is a payment, its status is a chip.
 *
 * The four tiles are the CUSTODY trail of the paper (owner, 22 Sep 2026: "how
 * many cheques with us, how many with head office, how many bounced or
 * replaced cheques are returned"): With us → With head office → banked, and
 * for a bounced / swapped cheque: To return → Returned to customer. The server
 * computes `custody` per row (shared/head-office-handover.ts is the rule).
 *
 * Doing things happens through SELECTION — tick rows, an action bar appears:
 * mark cleared / bounced / awaiting (`canClearCheques` or collections), submit
 * to head office / take back (0323), return to customer / undo (0324). Cancel and
 * replacement stay on the lease record (they need a reason and a linked cheque)
 * — every row links there. A payment is RECORDED on the lease record, never
 * from here (owner, 23 Sep 2026: "remove the option of new payment").
 *
 * Layout is the list-page pattern (components/amc/AmcView.tsx is the
 * reference) so this page reads like its neighbours. Data: GET
 * /manager/payments?rp=<id> — the landlord ledger's own rows, so both sides
 * read the same figures.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Loader2, Lock, Wallet, X, Landmark } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import { ReturnChequeDialog, RETURN_REASON_WORD } from '@/components/upnow/ReturnChequeDialog';
import { uploadLeaseDocument } from '@/lib/leaseDocumentUpload';
import { openDocViewer } from '@/lib/docViewer';
import DepositDetailModal, { type DepositDetail, type DepositRow } from '@/components/upnow/DepositDetailModal';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { taxPortionOf } from '@/lib/chargeTax';

// ─── Row (the server's ledger row, unchanged) ─────────────────────────────
interface PaymentRow {
  id: string;
  paymentType: string;
  depositRef: string;
  contractRef: string;
  contractId: number | null;
  currentContractId: number | null;
  tenant: string;
  building: string;
  /** The building's leasing model: direct (a lease) · sub (a sub-lease) · management. */
  leasingType?: string | null;
  unit: string;
  amount: number;
  vatAmount: number | null;
  description: string | null;
  recordedDate: string | null;
  transactionDate: string | null;
  dueDate?: string | null;
  /** The lease term the row belongs to (for the per-unit header). */
  startDate?: string | null;
  endDate?: string | null;
  /** Which landlord's book — set on the client; under "All landlords" the page
   *  reads every landlord the manager serves and routes each action by it. */
  rpId?: number;
  rpName?: string;
  status: string;
  countsTowardTotals?: boolean;
  excludedReason?: string | null;
  // 0323 — custody + what a row needs to be ACTED on from here.
  paymentId?: number | null;
  depositId?: number | null;
  /** The bounced / swapped cheque this payment makes good (a replacement). */
  replacesPaymentId?: number | null;
  paymentMethod?: string | null;
  chequeStatus?: string | null;
  handedOverAt?: string | null;
  handedOverBy?: string | null;
  awaitsHeadOffice?: boolean;
  // 0324 — the return leg, and where the paper is now.
  returnedToCustomerAt?: string | null;
  returnedToCustomerBy?: string | null;
  returnedToCustomerReason?: string | null;
  /** The reference image filed when it went back (0328). */
  returnedProof?: { fileUrl: string | null; displayName: string | null } | null;
  custody?: Custody | null;
  /** A bounced / cancelled cheque still to go back to the customer, wherever it is. */
  toReturn?: boolean;
}
type Custody = 'with_us' | 'with_head_office' | 'not_recorded' | 'banked' | 'returned';

// ─── The rent book (Cash Management, slug rent-receivable) — the same picture
//     the reports give, used here as the backbone so the accountant works the
//     same 104 units (owner, 23 Sep 2026: "the payment page should give the same
//     picture so the accounting person can do the next actions accordingly").
interface CashRow {
  rpId?: number; rpName?: string;
  contractId: number; contractRef: string; unitId: number; unitLabel: string; buildingName: string; customer: string | null;
  contractStartDate: string | null; contractEndDate: string | null; annualRentFils: number; awaitingActivation: boolean;
  totalFils: number; clearedFils: number; pendingFils: number; bouncedOwedFils: number; bouncedReplacedFils: number;
  legal?: LegalMark | null;
}
/** An open legal matter on a lease — a case or a breach. */
type LegalMark = { kind: 'case' | 'breach'; stage: string | null; what: string | null };
const words = (v: string | null | undefined) => (v ?? '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
interface CashNotEarning {
  rpId?: number; rpName?: string;
  unitId: number; unitLabel: string; buildingName: string; lapsedOn: string | null;
  draftContractId: number | null; draftStatus: string | null; draftRentFils: number | null; draftStart: string | null; signatures: number;
  legal?: LegalMark | null;
}
interface CashReport {
  rows: CashRow[]; occupiedNotEarning: CashNotEarning[];
  totals: { units: number; occupiedUnits: number; occupiedNotEarningUnits: number; annualRentFils: number; receivedToDateFils: number; lateFils: number; notYetDueFils: number; bouncedOwedFils: number; awaitingActivation: number };
}
/** Cheques Management (slug cheques-management) — the cheques in hand figure the
 *  owner reads, so this page says the same number. */
interface ChequesReport {
  totals: { leases: number; units: number; totalCheques: number; valueFils: number; clearedFils: number; pendingFils: number; bouncedFils: number; otherMeansCount: number; bankTransferFils: number; cashOnlineFils: number };
}
const fils = (v: number | null | undefined) => fmtAed(Math.round((v ?? 0) / 100));

// Money status (pills) and paper custody (tiles) are two axes of one list; the
// active view is whichever was picked last.
type View = 'all' | 'awaiting' | 'overdue' | 'bounced' | 'replacement' | 'cleared' | 'deposits' | 'with_us' | 'with_head_office' | 'not_recorded' | 'to_return' | 'returned';
type CustodyView = 'with_us' | 'with_head_office' | 'not_recorded' | 'to_return' | 'returned';
const VIEWS: { key: View; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'awaiting', label: 'Awaiting' },
  { key: 'overdue',  label: 'Overdue' },
  { key: 'bounced',  label: 'Bounced' },
  { key: 'replacement', label: 'Replacement' },
  { key: 'cleared',  label: 'Cleared' },
  { key: 'deposits', label: 'Deposits' },
];
// With head office (0326): the four custody counts. Without: the money
// counts, and the cheque series still shows To return / Returned.
const CUSTODY_TILES: { key: CustodyView; label: string; color: string }[] = [
  { key: 'with_us',          label: 'Cheques with us',        color: '#c47a00' },
  { key: 'with_head_office', label: 'With head office',       color: '#1a7a52' },
  { key: 'to_return',        label: 'To return to customer',  color: '#b42318' },
  { key: 'returned',         label: 'Returned to customer',   color: '#1c1f1d' },
];
const isCustodyView = (v: View): v is CustodyView => ['with_us', 'with_head_office', 'not_recorded', 'to_return', 'returned'].includes(v);
/** The word under the status chip. */
function custodyWord(r: PaymentRow, headOffice: boolean): string {
  if (r.custody === 'returned') return 'Returned';
  if (!headOffice && !r.toReturn) return '';
  return r.custody === 'with_us' ? 'With us' : r.custody === 'with_head_office' ? 'Head office' : r.custody === 'not_recorded' ? 'Not recorded' : '';
}

const TYPE_LABELS: Record<string, string> = {
  rental_income: 'Rent', vat: 'VAT', security_deposit: 'Security deposit', admin_fee: 'Admin fee',
  commission: 'Commission', bounced_cheque_fee: 'Bounced cheque fee', cheque_replacement_fee: 'Cheque replacement fee',
  cheque_deferral_fee: 'Cheque deferral fee', late_renewal_fee: 'Late renewal fee', early_termination_fee: 'Early termination fee',
  late_moveout_fee: 'Late move-out fee', unauthorized_sharing_fee: 'Sharing fee', access_card_fee: 'Access card fee',
  contract_name_change_fee: 'Name change fee', unit_transfer_fee: 'Unit transfer fee', ejari_fee: 'Contract registration',
  maintenance_fee: 'Maintenance', service_charge: 'Service charge', refund: 'Refund', other: 'Other',
};
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const METHOD_LABELS: Record<string, string> = { cheque: 'Cheque', cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', online: 'Online' };
const methodLabel = (m: string | null | undefined) => (m ? METHOD_LABELS[m] ?? m.replace(/_/g, ' ') : '—');

const LEASING_LABELS: Record<string, string> = { direct: 'Lease', sub: 'Sub-lease', management: 'Management' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isDeposit = (r: PaymentRow) => r.paymentType === 'security_deposit';
/** The summary strip's groups — what the accountant asks "how many of what". */
const rowDate = (r: PaymentRow) => r.transactionDate ?? r.dueDate ?? r.recordedDate;
const today = () => new Date(new Date().toDateString());
const isOverdue = (r: PaymentRow) => r.status === 'pending' && !!rowDate(r) && new Date(rowDate(r) as string) < today();
const counts = (r: PaymentRow) => r.countsTowardTotals !== false;

function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ─── Status chip — one vocabulary for cheques and deposits ────────────────
const CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  pending:        { label: 'Awaiting',   bg: '#fff4e0', fg: '#c47a00' },
  overdue:        { label: 'Overdue',    bg: '#fdecea', fg: '#b42318' },
  cleared:        { label: 'Cleared',    bg: '#e7f4ee', fg: '#1a7a52' },
  paid:           { label: 'Paid',       bg: '#e7f4ee', fg: '#1a7a52' },
  bounced:        { label: 'Bounced',    bg: '#fdecea', fg: '#b42318' },
  replaced:       { label: 'Replaced',   bg: '#f1f3f1', fg: '#5b615e' },
  cancelled:      { label: 'Cancelled',  bg: '#f1f3f1', fg: '#5b615e' },
  held:           { label: 'Held',       bg: '#e7f4ee', fg: '#1a7a52' },
  returned:       { label: 'Returned',   bg: '#e9effc', fg: '#2a5bd7' },
  partial_return: { label: 'Part returned', bg: '#fff4e0', fg: '#c47a00' },
  forfeited:      { label: 'Forfeited',  bg: '#fdecea', fg: '#b42318' },
};
/** `stored`: show the cheque's own status rather than what the money reads as —
 *  in the custody views a bounce whose replacement cleared is still a bounced
 *  piece of paper to hand back, not a "Cleared" row. */
function StatusChip({ r, stored = false }: { r: PaymentRow; stored?: boolean }) {
  const key = stored && r.chequeStatus ? r.chequeStatus : isOverdue(r) ? 'overdue' : r.status;
  const c = CHIP[key] ?? { label: key, bg: '#f1f3f1', fg: '#5b615e' };
  return <span className="text-[10px] font-bold px-[7px] py-[2px] rounded-full whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>{c.label}</span>;
}

const GRID = 'grid grid-cols-[28px_92px_minmax(0,1.6fr)_minmax(0,1.2fr)_110px_120px_88px_70px] gap-3 items-center px-[18px]';
const GRID_NOSEL = 'grid grid-cols-[92px_minmax(0,1.6fr)_minmax(0,1.2fr)_110px_120px_88px_70px] gap-3 items-center px-[18px]';
const HEAD = 'py-2.5 text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] border-b border-[#eef0ee]';
const ROW = 'py-3.5 text-[12.5px] border-b border-[#f1f3f1] last:border-0 cursor-pointer hover:bg-[#fafbfa]';
const field = 'py-2 pl-3 pr-8 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52]';

export default function ManagerPaymentsPage() {
  const router = useRouter();
  const { effectiveRp, allowed, permsLoading, needsLandlord, canForRp } = useManagerLandlordScope('canManageDeposits');
  const { rps } = useManagerPermissions();
  // One landlord from the switcher, or — under "All landlords" — every landlord
  // whose payments this manager may see (owner, 23 Sep 2026: the page must work
  // for all landlords). Each row remembers its landlord; actions go per landlord.
  const scopeRps: { id: number; name: string }[] = effectiveRp != null
    ? [{ id: effectiveRp, name: rps.find(r => r.rentalProviderId === effectiveRp)?.rpName ?? '' }]
    : needsLandlord ? rps.filter(r => r.permissions.canManageDeposits).map(r => ({ id: r.rentalProviderId, name: r.rpName })) : [];
  const scopeKey = scopeRps.map(r => r.id).join(',');
  const inScope = scopeRps.length > 0 && (effectiveRp == null || allowed);
  const multi = scopeRps.length > 1;
  const canRecord   = scopeRps.some(r => canForRp('canRecordPayments', r.id));
  const canClear    = scopeRps.some(r => canForRp('canClearCheques', r.id) || canForRp('canManageCollections', r.id));
  const canSelect   = canRecord || canClear;
  /** Head office is the landlord's choice (0326) — any landlord in scope. */
  const headOffice  = scopeRps.some(r => canForRp('canHandOverCheques', r.id));
  const rpOf = (r: PaymentRow) => r.rpId ?? effectiveRp ?? scopeRps[0]?.id ?? null;

  const initial = useSearchParams().get('tab');
  const [view, setView]       = useState<View>(VIEWS.some(v => v.key === initial) ? (initial as View) : 'all');
  // Custody is its own filter beside the money status (owner, 23 Sep 2026:
  // "clean filters so the accounting person knows what's going on"): With us ·
  // Head office · To return · Returned. Deep link ?tab=headoffice → With us.
  const [custody, setCustody] = useState<CustodyView | ''>(
    initial === 'headoffice' ? 'with_us' : isCustodyView(initial as View) ? (initial as CustodyView) : '');
  const custodyOn = custody !== '';
  const [rows, setRows]       = useState<PaymentRow[]>([]);
  const [cash, setCash]       = useState<CashReport | null>(null);
  const [chq, setChq]         = useState<ChequesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [q, setQ]             = useState('');
  const [building, setBuilding] = useState('');
  const [year, setYear]       = useState('');
  // Month of the date the payment falls due — the cheque date (owner, 23 Sep
  // 2026: "filter payments monthwise"). Combines with the year; on its own it
  // reads that month across every year.
  const [month, setMonth]     = useState('');
  // Leasing model of the building (owner, 23 Sep 2026: "filter of lease and sub lease").
  const [leasing, setLeasing] = useState('');
  const [sel, setSel]         = useState<Set<string>>(new Set());
  const [busy, setBusy]       = useState(false);
  const [notice, setNotice]   = useState<{ ok: boolean; text: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  /** By unit (default) or one flat list. */
  const [layout, setLayout] = useState<'units' | 'list'>('units');
  // Lazy rendering (owner, 23 Sep 2026): the data comes in one call, but only
  // the first slice is drawn; a sentinel at the end draws the next slice as it
  // scrolls into view. Resets whenever the list changes shape.
  const PAGE = layout === 'units' ? 20 : 80;
  const [limit, setLimit] = useState(20);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** Rows being handed back to the customer — the reason dialog is open (0325). */
  const [returnDlg, setReturnDlg] = useState<PaymentRow[] | null>(null);

  const load = useCallback(async () => {
    if (!inScope) { setRows([]); setCash(null); setChq(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const per = await Promise.all(scopeRps.map(async rp => {
        const [data, report, chqReport] = await Promise.all([
          apiGet<PaymentRow[]>(`/manager/payments?rp=${rp.id}`),
          apiGet<CashReport>(`/manager/reports/rent-receivable?rp=${rp.id}`).catch(() => null),
          apiGet<ChequesReport>(`/manager/reports/cheques-management?rp=${rp.id}`).catch(() => null),
        ]);
        return { rp, data: Array.isArray(data) ? data : [], report, chqReport };
      }));
      setRows(per.flatMap(x => x.data.map(r => ({ ...r, id: multi ? `${x.rp.id}:${r.id}` : r.id, rpId: x.rp.id, rpName: x.rp.name }))));
      const reports = per.map(x => x.report).filter((r): r is CashReport => !!r && Array.isArray(r.rows));
      setCash(reports.length ? {
        rows: per.flatMap(x => (x.report?.rows ?? []).map(r => ({ ...r, rpId: x.rp.id, rpName: x.rp.name }))),
        occupiedNotEarning: per.flatMap(x => (x.report?.occupiedNotEarning ?? []).map(r => ({ ...r, rpId: x.rp.id, rpName: x.rp.name }))),
        totals: reports.map(r => r.totals).reduce((a, t) => ({
          units: a.units + t.units, occupiedUnits: a.occupiedUnits + t.occupiedUnits, occupiedNotEarningUnits: a.occupiedNotEarningUnits + t.occupiedNotEarningUnits,
          annualRentFils: a.annualRentFils + t.annualRentFils, receivedToDateFils: a.receivedToDateFils + t.receivedToDateFils, lateFils: a.lateFils + t.lateFils,
          notYetDueFils: a.notYetDueFils + t.notYetDueFils, bouncedOwedFils: a.bouncedOwedFils + t.bouncedOwedFils, awaitingActivation: a.awaitingActivation + t.awaitingActivation,
        })),
      } : null);
      const chqs = per.map(x => x.chqReport).filter((r): r is ChequesReport => !!r && !!r.totals);
      setChq(chqs.length ? { totals: chqs.map(r => r.totals).reduce((a, t) => ({
        leases: a.leases + t.leases, units: a.units + t.units, totalCheques: a.totalCheques + t.totalCheques, valueFils: a.valueFils + t.valueFils,
        clearedFils: a.clearedFils + t.clearedFils, pendingFils: a.pendingFils + t.pendingFils, bouncedFils: a.bouncedFils + t.bouncedFils,
        otherMeansCount: a.otherMeansCount + t.otherMeansCount, bankTransferFils: a.bankTransferFils + t.bankTransferFils, cashOnlineFils: a.cashOnlineFils + t.cashOnlineFils,
      })) } : null);
    } catch { setError('Failed to load payments.'); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, inScope]);
  useEffect(() => { void load(); }, [load]);

  const loadDepositDetail = useCallback(
    (id: string): Promise<DepositDetail> => {
      const row = rows.find(r => r.id === id);
      const rawId = multi ? id.slice(id.indexOf(':') + 1) : id;
      return apiGet<DepositDetail>(`/manager/deposits/${rawId}/detail?rp=${row ? rpOf(row) : effectiveRp}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveRp, rows, multi],
  );
  const leaseHref = (r: PaymentRow) => {
    const id = r.currentContractId ?? r.contractId;
    const rp = rpOf(r);
    return id != null ? `/dashboard/manager/contracts/${id}/v2${rp != null ? `?rp=${rp}` : ''}` : null;
  };

  // ── Figures (whole book, not the filtered list) ─────────────────────────
  // Custody: outbound (with us / head office) counts cheques AND cash, and a
  // deposit cheque too — it travels the same way. The return leg is cheques
  // only; a deposit's "return" is its settlement, not a cheque handed back.
  const payments = rows.filter(r => !isDeposit(r));
  // Four sets that never overlap (owner, 23 Sep 2026: "we have 148 cheques?
  // figures are not correct" — a failed cheque at head office was counted
  // there AND under To return, with deposits and cash mixed in unsaid):
  //   with us / head office = LIVE paper (pending) at that place,
  //   to return             = failed cheques wherever they are,
  //   returned              = failed cheques handed back.
  const kpi: Record<CustodyView | 'awaiting' | 'overdue', PaymentRow[]> = {
    with_us:          rows.filter(r => r.custody === 'with_us' && !r.toReturn),
    with_head_office: rows.filter(r => r.custody === 'with_head_office' && !r.toReturn),
    // Collected before custody existed; nobody said where it went. Not a
    // count of anything — a list to reconcile once (owner, 23 Sep 2026).
    not_recorded:     rows.filter(r => r.custody === 'not_recorded'),
    to_return:        payments.filter(r => r.toReturn === true),
    returned:         payments.filter(r => r.custody === 'returned'),
    awaiting:         payments.filter(r => r.status === 'pending' && counts(r)),
    overdue:          payments.filter(isOverdue),
  };
  /** What a tile's number is made of — cheques, cash, deposit cheques; or where
   *  the failed cheques are. */
  const mixOf = (k: CustodyView | 'awaiting' | 'overdue'): string => {
    const rs = kpi[k];
    if (k === 'to_return') {
      const ho = rs.filter(r => r.custody === 'with_head_office').length;
      const nr = rs.filter(r => r.custody === 'not_recorded').length;
      return rs.length ? [ho ? `${ho} at head office` : null, `${rs.length - ho - nr} with us`, nr ? `${nr} not recorded` : null].filter(Boolean).join(' · ') : '—';
    }
    if (k === 'with_us' || k === 'with_head_office') {
      const chq = rs.filter(r => !isDeposit(r) && r.paymentMethod === 'cheque').length;
      const cash = rs.filter(r => !isDeposit(r) && r.paymentMethod === 'cash').length;
      const depChq = rs.filter(r => isDeposit(r) && r.paymentMethod === 'cheque').length;
      const depCash = rs.filter(r => isDeposit(r) && r.paymentMethod !== 'cheque').length;
      return [
        `${chq} cheque${chq === 1 ? '' : 's'}`,
        cash ? `${cash} cash` : null,
        depChq ? `${depChq} deposit cheque${depChq === 1 ? '' : 's'}` : null,
        depCash ? `${depCash} deposit cash` : null,
      ].filter(Boolean).join(' · ');
    }
    return fmtAed(sum(rs));
  };
  const rentByMethod = (m: string) => payments.filter(r => r.paymentType === 'rental_income' && r.paymentMethod === m && r.status !== 'cancelled').length;
  // Fee cheques awaiting — admin, registration, charges, bounce fees — which
  // Cheques Management (rent only) never counts (owner, 23 Sep 2026: "why are
  // you not showing the cheques with pending fees"). One physical cheque often
  // covers several fee lines, so count the cheques and say the lines.
  const feeLines = payments.filter(r => r.paymentMethod === 'cheque' && r.chequeStatus === 'pending' && r.paymentType !== 'rental_income');
  const feeCheques = new Set(feeLines.map(r => `${r.currentContractId ?? r.contractId}|${r.depositRef}`)).size;
  const sum = (rs: PaymentRow[]) => rs.reduce((s, r) => s + r.amount, 0);
  const recentlySubmitted = rows
    .filter(r => r.handedOverAt && r.handedOverBy)
    .sort((a, b) => String(b.handedOverAt).localeCompare(String(a.handedOverAt)))
    .slice(0, 10);

  // ── The list ─────────────────────────────────────────────────────────────
  const buildings = useMemo(() => [...new Set(rows.map(r => r.building).filter(b => b && b !== '—'))].sort(), [rows]);
  // Years ACCORDING TO THE LEASES (owner, 23 Sep 2026): a year is offered when a
  // lease term touches it, and picking one keeps every payment of the leases
  // running in that year — a tenancy is never cut in half at 31 December.
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) {
      const a = r.startDate ? new Date(r.startDate).getFullYear() : null;
      const b = r.endDate ? new Date(r.endDate).getFullYear() : a;
      if (a == null) { const d = rowDate(r); if (d) set.add(new Date(d).getFullYear()); continue; }
      for (let y = a; y <= (b ?? a); y++) set.add(y);
    }
    return [...set].filter(Number.isFinite).sort((a, b) => b - a);
  }, [rows]);
  const leaseInYear = (r: PaymentRow, y: number) => {
    if (r.startDate) {
      const a = new Date(r.startDate).getFullYear();
      const b = r.endDate ? new Date(r.endDate).getFullYear() : a;
      return a <= y && y <= b;
    }
    const d = rowDate(r);
    return !!d && new Date(d).getFullYear() === y;
  };

  const shownAll = rows
    .filter(r => {
      switch (view) {
        case 'deposits':   return isDeposit(r);
        case 'awaiting':   return !isDeposit(r) && r.status === 'pending';
        case 'overdue':    return !isDeposit(r) && isOverdue(r);
        case 'bounced':    return !isDeposit(r) && r.status === 'bounced';
        case 'replacement': return !isDeposit(r) && r.replacesPaymentId != null;
        case 'cleared':    return !isDeposit(r) && (r.status === 'cleared' || r.status === 'paid');
        default:           return !isDeposit(r);
      }
    })
    .filter(r => !custody || kpi[custody].includes(r))
    .filter(r => !building || r.building === building)
    .filter(r => !leasing || (r.leasingType ?? 'direct') === leasing)
    .filter(r => !year || leaseInYear(r, Number(year)))
    .filter(r => !month || (rowDate(r) ? new Date(rowDate(r) as string).getMonth() + 1 === Number(month) : false))
    .sort((a, b) => String(rowDate(b) ?? '').localeCompare(String(rowDate(a) ?? '')));
  // The search. A row matches on its own words; a UNIT matches on its header —
  // unit, building, customer, contract — so an occupied unit with no payment
  // lines yet is still found (owner, 23 Sep 2026: "Room-10, not getting
  // results"). Exact unit names win over substrings ("Room-1" is not Room-10).
  const term = q.trim().toLowerCase();
  // Unit names compare with spaces, hyphens and "unit" stripped: "room 10",
  // "Room-10" and "unit room-10" are the same unit.
  const normUnit = (v: string) => v.toLowerCase().replace(/^unit\s*/, '').replace(/[\s\-_]/g, '');
  const termUnit = normUnit(term);
  const rowMatches = (r: PaymentRow) => !term || normUnit(r.unit).includes(termUnit) || [r.depositRef, r.tenant, r.building, r.contractRef, r.description ?? '', typeLabel(r.paymentType)]
    .some(v => v.toLowerCase().includes(term));
  const unitExact = (g: { unit: string }) => !!term && normUnit(g.unit) === termUnit;
  const unitMatches = (g: { unit: string; building: string; tenant: string; contractRef: string }) => !term
    || normUnit(g.unit).includes(termUnit)
    || [g.building, g.tenant, g.contractRef].some(v => v.toLowerCase().includes(term));
  const shown = shownAll.filter(rowMatches);
  // Money views total what counts; custody views total the paper in hand.
  const shownTotal = custodyOn ? sum(shown) : sum(shown.filter(counts));

  // ── Selection + actions ──────────────────────────────────────────────────
  const picked = shown.filter(r => sel.has(r.id));
  const toggle = (id: string) => setSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = shown.length > 0 && picked.length === shown.length;
  const clearSel = () => setSel(new Set());
  const pickedCheques = picked.filter(r => !isDeposit(r) && r.paymentId != null && r.chequeStatus === r.status
    && ['pending', 'cleared', 'bounced'].includes(r.chequeStatus ?? ''));
  const hoFor = (r: PaymentRow) => { const rp = rpOf(r); return rp != null && canForRp('canHandOverCheques', rp); };
  const pickedToSubmit  = picked.filter(r => hoFor(r) && r.custody === 'with_us');
  const pickedSubmitted = picked.filter(r => hoFor(r) && r.custody === 'with_head_office');
  /** Custody never recorded — the accountant says where each one is. */
  const pickedUnknown   = picked.filter(r => hoFor(r) && r.custody === 'not_recorded');
  // The series: only a failed cheque that is WITH US goes back to the customer.
  const pickedToReturn  = picked.filter(r => !isDeposit(r) && r.toReturn && r.custody === 'with_us');
  const pickedReturned  = picked.filter(r => !isDeposit(r) && r.custody === 'returned' && r.returnedToCustomerAt);

  async function act(fn: () => Promise<string>) {
    setBusy(true); setNotice(null);
    try { const text = await fn(); setNotice({ ok: true, text }); clearSel(); await load(); }
    catch (e) { setNotice({ ok: false, text: (e as Error)?.message || 'That did not go through.' }); }
    finally { setBusy(false); }
  }
  const setStatus = (chequeStatus: 'pending' | 'cleared' | 'bounced') => act(async () => {
    for (const r of pickedCheques) await apiPatch(`/contracts/${r.contractId}/payments/${r.paymentId}`, { chequeStatus });
    return `${pickedCheques.length} payment${pickedCheques.length !== 1 ? 's' : ''} marked ${CHIP[chequeStatus].label.toLowerCase()}.`;
  });
  const handOver = (list: PaymentRow[], handedOver: boolean) => act(async () => {
    for (const rp of new Set(list.map(rpOf))) {
      const mine = list.filter(r => rpOf(r) === rp);
      await apiPatch(`/manager/payments/hand-over?rp=${rp}`, {
        paymentIds: mine.filter(r => !isDeposit(r)).map(r => r.paymentId),
        depositIds: mine.filter(isDeposit).map(r => r.depositId),
        handedOver,
      });
    }
    return handedOver
      ? `${list.length} item${list.length !== 1 ? 's' : ''} submitted to head office — ${fmtAed(sum(list))}.`
      : `${list.length} item${list.length !== 1 ? 's' : ''} back on the to-submit list.`;
  });

  const returnToCustomer = (list: PaymentRow[], returned: boolean, reason?: string, note?: string, file?: File | null) => act(async () => {
    // The reference image is filed on the lease — offered only when every ticked
    // row is on one lease (see allowFile on the dialog).
    const cid = list[0]?.currentContractId ?? list[0]?.contractId ?? null;
    const documentId = returned && file && cid != null
      ? await uploadLeaseDocument(cid, file, { key: 'cheque_return', label: `Cheque returned${list.length === 1 ? ` · ${list[0].depositRef}` : ''}` })
      : undefined;
    for (const rp of new Set(list.map(rpOf))) {
      const mine = list.filter(r => rpOf(r) === rp);
      await apiPatch(`/manager/payments/return-to-customer?rp=${rp}`, { paymentIds: mine.map(r => r.paymentId), returned, reason, note, documentId });
    }
    return returned
      ? `${list.length} cheque${list.length !== 1 ? 's' : ''} returned to the customer.`
      : `${list.length} cheque${list.length !== 1 ? 's' : ''} back on the to-return list.`;
  });

  const goView = (v: View) => { setView(v); clearSel(); setNotice(null); };
  const openRow = (r: PaymentRow) => {
    if (isDeposit(r)) { setDetailId(r.id); return; }
    const href = leaseHref(r); if (href) router.push(href);
  };


  const grid = canSelect ? GRID : GRID_NOSEL;
  const renderRow = (r: PaymentRow) => {
                const vat = taxPortionOf({ paymentType: r.paymentType, description: r.description, vatAmount: r.vatAmount }, r.amount);
                const href = leaseHref(r);
                return (
                  <div key={r.id} onClick={() => openRow(r)} className={`${grid} ${ROW}`} style={sel.has(r.id) ? { background: '#f3faf6' } : undefined}>
                    {canSelect && (
                      <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()}
                        aria-label={`Select ${r.depositRef}`} className="accent-[#1a7a52] cursor-pointer" />
                    )}
                    <div className="whitespace-nowrap">{fmtDate(rowDate(r))}</div>
                    <div className="min-w-0">
                      <div className="font-bold truncate">{r.tenant}</div>
                      <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">Unit {r.unit} · {r.building} · {r.contractRef}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate">{typeLabel(r.paymentType)}</div>
                      <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">
                        {methodLabel(r.paymentMethod)}{r.description ? ` · ${r.description}` : ''}{r.excludedReason === 'upcoming' ? ` · lease starts ${fmtDate(r.startDate)}` : ''}
                        {custodyOn && r.custody === 'with_head_office' && r.handedOverBy ? ` · handed in ${fmtDateTime(r.handedOverAt)} by ${r.handedOverBy}` : ''}
                        {custodyOn && r.custody === 'returned' && r.returnedToCustomerBy ? ` · returned ${fmtDateTime(r.returnedToCustomerAt)} by ${r.returnedToCustomerBy}${r.returnedToCustomerReason ? ` · ${RETURN_REASON_WORD[r.returnedToCustomerReason] ?? r.returnedToCustomerReason}` : ''}` : ''}
                        {r.custody === 'returned' && r.returnedProof?.fileUrl && (
                          <button type="button" onClick={e => { e.stopPropagation(); openDocViewer({ fileUrl: r.returnedProof!.fileUrl!, caption: r.returnedProof!.displayName ?? 'Cheque returned' }); }}
                            className="ml-1.5 text-[#1a7a52] font-semibold hover:underline cursor-pointer">proof</button>
                        )}
                      </div>
                    </div>
                    <div className="font-mono text-[11px] truncate" title={r.depositRef}>{r.depositRef}</div>
                    <div className="text-right whitespace-nowrap">
                      <div className="font-semibold">{fmtAed(r.amount)}</div>
                      {vat > 0 && <div className="text-[10.5px] text-[#8a8f8c]">incl. VAT {fmtAed(vat)}</div>}
                    </div>
                    {/* ONE grid cell: the chip with where the paper is under it. */}
                    <div>
                      <StatusChip r={r} stored={custodyOn} />
                      {custodyWord(r, headOffice) && <div className="text-[10.5px] text-[#8a8f8c] mt-0.5">{custodyWord(r, headOffice)}</div>}
                    </div>
                    <div className="text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {isDeposit(r)
                        ? <button type="button" onClick={() => setDetailId(r.id)} className="text-[12px] font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer">View →</button>
                        : href && <Link href={href} className="text-[12px] font-semibold text-[#1a7a52] hover:text-[#125a3c] no-underline">Lease →</Link>}
                    </div>
                  </div>
                );
  };
  // ── By unit (owner, 23 Sep 2026: "payments should work as per units available
  //    to avoid any confusion"): the filtered rows grouped under their unit, with
  //    the customer, the term, the cheque count and the deposit held.
  const filtersActive = !!(q.trim() || building || leasing || custody || year || month || view !== 'all');
  const unitGroups = (() => {
    type Group = { key: string; unit: string; building: string; tenant: string; contractRef: string; contractId: number | null;
      rows: PaymentRow[]; term: string; annualRent: number | null; note: string; summary: string; deposit: string; late: number; legal?: LegalMark | null };
    const byContract = new Map<number, PaymentRow[]>();
    for (const r of shownAll) {
      const cid = r.currentContractId ?? r.contractId;
      if (cid == null) continue;
      byContract.set(cid, [...(byContract.get(cid) ?? []), r]);
    }
    const used = new Set<number>();
    const finish = (g: Omit<Group, 'summary' | 'deposit' | 'late'>): Group => {
      const chq = g.rows.filter(r => !isDeposit(r) && r.paymentMethod === 'cheque');
      const n = (st: string) => chq.filter(r => (r.chequeStatus ?? '') === st).length;
      const summary = chq.length
        ? `${chq.length} cheque${chq.length === 1 ? '' : 's'} · ${n('cleared')} banked · ${n('pending')} awaiting${n('bounced') ? ` · ${n('bounced')} bounced` : ''}${n('cancelled') ? ` · ${n('cancelled')} cancelled` : ''}`
        : g.rows.length ? `${g.rows.length} payment${g.rows.length === 1 ? '' : 's'}` : '';
      const dep = rows.find(r => isDeposit(r) && (r.currentContractId ?? r.contractId) === g.contractId && r.status === 'held' && r.amount > 0);
      const late = rows.filter(r => !isDeposit(r) && (r.currentContractId ?? r.contractId) === g.contractId && isOverdue(r)).reduce((a, r) => a + r.amount, 0);
      return { ...g, summary, deposit: dep ? `Deposit ${fmtAed(dep.amount)} held` : '', late };
    };
    const out: Group[] = [];
    // A unit the rent book lists with a placeholder AND names on its not-earning
    // list appears once — from the not-earning list, which carries the draft.
    const notEarningUnits = new Set((cash?.occupiedNotEarning ?? []).map(u => `${u.rpId ?? ''}:${u.unitId}`));
    // The rent book's 104 occupied units, in the report's own order.
    for (const c of cash?.rows ?? []) {
      // The rent book lists a not-earning unit under its lapsed or draft lease AND
      // on its not-earning list — once is enough, and the list carries the draft.
      if (notEarningUnits.has(`${c.rpId ?? ''}:${c.unitId}`)) continue;
      // The rent book gives an occupied unit with no counting lease a NEGATIVE
      // placeholder id — there is no lease page behind it (CID -104 → "Contract
      // not found", owner 23 Sep 2026). Treat it as no lease.
      const cid = c.contractId > 0 ? c.contractId : null;
      if (cid != null) used.add(cid);
      out.push(finish({
        key: `c${c.rpId ?? ''}-${c.contractId}`, unit: c.unitLabel.replace(/^Unit /, ''), building: `${multi && c.rpName ? `${c.rpName} · ` : ''}${c.buildingName.trim()}`, tenant: c.customer ?? '—',
        contractRef: cid != null ? c.contractRef : '', contractId: cid, rows: cid != null ? byContract.get(cid) ?? [] : [],
        term: c.contractStartDate && c.contractEndDate ? `${fmtDate(c.contractStartDate)} → ${fmtDate(c.contractEndDate)}` : '',
        annualRent: Math.round(c.annualRentFils / 100), note: c.awaitingActivation ? 'Awaiting activation' : cid == null ? 'Occupied — no confirmed lease on record yet' : '',
        legal: c.legal ?? null,
      }));
    }
    // Occupied but not earning yet — the next action is on the lease.
    for (const u of cash?.occupiedNotEarning ?? []) {
      if (u.draftContractId != null && u.draftContractId > 0) used.add(u.draftContractId);
      out.push(finish({
        key: `n${u.rpId ?? ''}-${u.unitId}`, unit: u.unitLabel.replace(/^Unit /, ''), building: `${multi && u.rpName ? `${u.rpName} · ` : ''}${u.buildingName.trim()}`, tenant: '—',
        contractRef: u.draftContractId != null && u.draftContractId > 0 ? `CID-${u.draftContractId}` : '', contractId: u.draftContractId != null && u.draftContractId > 0 ? u.draftContractId : null,
        rows: u.draftContractId != null && u.draftContractId > 0 ? byContract.get(u.draftContractId) ?? [] : [],
        term: u.draftStart ? `from ${fmtDate(u.draftStart)}` : '', annualRent: u.draftRentFils != null ? Math.round(u.draftRentFils / 100) : null,
        note: `Occupied, not earning yet${u.draftStatus ? ` · lease ${u.draftStatus}` : ''}${u.lapsedOn ? ` · previous term ended ${fmtDate(u.lapsedOn)}` : ''} — confirm the cheques on the lease`,
        legal: u.legal ?? null,
      }));
    }
    // Anything the ledger holds that the rent book does not list (an upcoming
    // lease on a vacant unit, an older term) — never dropped.
    const num = (u: string) => { const m = u.match(/\d+/); return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER; };
    const extra = [...byContract.entries()].filter(([cid]) => !used.has(cid)).map(([cid, rs]) => {
      const lease = rs.find(r => r.startDate) ?? rs[0];
      return finish({
        key: `x${rs[0].rpId ?? ''}-${cid}`, unit: rs[0].unit, building: `${multi && rs[0].rpName ? `${rs[0].rpName} · ` : ''}${rs[0].building}`, tenant: rs[0].tenant, contractRef: rs[0].contractRef, contractId: cid, rows: rs,
        term: lease?.startDate && lease?.endDate ? `${fmtDate(lease.startDate)} → ${fmtDate(lease.endDate)}` : '', annualRent: null,
        note: rs.some(r => r.excludedReason === 'upcoming') ? 'Upcoming lease — not on the rent book yet' : 'Not on the rent book',
      });
    }).sort((a, b) => a.building.localeCompare(b.building) || num(a.unit) - num(b.unit));
    // One order for everything — landlord, building, unit — so a building's
    // units sit together whether they came from the rent book, the
    // not-earning list or the ledger's leftovers.
    const all = [...out, ...extra].sort((a, b) => a.building.localeCompare(b.building) || num(a.unit) - num(b.unit) || a.unit.localeCompare(b.unit));
    // The search: a unit whose header matches keeps every row; otherwise only the
    // rows that match, and the unit only if any do.
    // An exact unit name wins: "Room-1" is Room-1, not Room-10 to Room-19.
    const exact = term ? all.filter(unitExact) : [];
    const searched = exact.length ? exact : term
      ? all.flatMap(g => unitMatches(g) ? [g] : (g.rows.some(rowMatches) ? [{ ...g, rows: g.rows.filter(rowMatches) }] : []))
      : all;
    // With another filter on, only the units that answer it; with none, every unit.
    const otherFilters = !!(building || leasing || custody || year || month || view !== 'all');
    return otherFilters ? searched.filter(g => g.rows.length > 0) : searched;
  })();
  const totalToDraw = layout === 'units' ? unitGroups.length : shown.length;
  const listShape = `${layout}|${view}|${custody}|${building}|${leasing}|${year}|${month}|${q}|${scopeKey}`;
  useEffect(() => { setLimit(PAGE); }, [listShape, PAGE]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || limit >= totalToDraw) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setLimit(l => Math.min(l + PAGE, totalToDraw));
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, totalToDraw, PAGE]);
  const detail = detailId !== null ? rows.find(d => d.id === detailId) ?? null : null;
  const emptyMsg = view === 'replacement' ? 'No replacement payment is recorded.'
    : custody === 'not_recorded' ? 'Every cheque has its custody recorded.'
    : custody === 'with_us' ? 'Nothing with us — every cheque and cash collected has reached head office.'
    : view === 'awaiting' ? 'No payment is awaiting.'
    : view === 'overdue' ? 'Nothing is overdue.'
    : custody === 'with_head_office' ? 'Nothing at head office waiting to be banked.'
    : custody === 'to_return' ? 'No bounced or swapped cheque is waiting to go back to a customer.'
    : custody === 'returned' ? 'No cheque has been returned to a customer yet.'
    : view === 'deposits' ? 'No deposits on record.'
    : q || building || year || month || leasing || custody ? 'No payments match.' : 'No payments recorded yet.';

  // Guards come AFTER every hook — an early return above a useMemo changed the
  // hook count between renders ("Rendered fewer hooks than expected").
  if (!permsLoading && !inScope) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]"><Lock size={20} /></div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">This landlord hasn’t granted you the <strong>Manage Deposits</strong> permission, so their payments aren’t available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 text-[#1c1f1d]">
      {/* Header */}
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-[-.01em]">Payments</h1>
          <p className="text-[12.5px] text-[#5b615e] mt-1">
            {multi ? `Every payment on the leases of your ${scopeRps.length} landlords` : 'Every payment on the landlord’s leases'}, newest first. Tick rows to act on them; open the lease to record, replace or cancel a payment.
          </p>
        </div>
      </div>

      {/* Row 1 — Cheques Management's own figures: cheques in hand, and how much
          came by bank transfer and by cash (owner, 23 Sep 2026). Counts are
          the rent lines on the ledger by method; amounts are the report's. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-[22px]">
        {[
          { label: 'Rent cheques in hand', value: chq ? String(chq.totals.totalCheques) : '—', sub: chq ? fils(chq.totals.valueFils) : '', color: '#1a7a52' },
          { label: 'Fee cheques awaiting', value: String(feeCheques), sub: `${feeLines.length} fee line${feeLines.length === 1 ? '' : 's'} · ${fmtAed(sum(feeLines))}`, color: '#c47a00' },
          { label: 'Bank transfers',   value: String(rentByMethod('bank_transfer')), sub: chq ? fils(chq.totals.bankTransferFils) : '', color: '#1c1f1d' },
          { label: 'Cash',             value: String(rentByMethod('cash') + rentByMethod('online') + rentByMethod('card')), sub: chq ? fils(chq.totals.cashOnlineFils) : '', color: '#1c1f1d' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-[#e6e8e6] rounded-xl px-4 py-3.5">
            <p className="text-[11px] text-[#5b615e]">{k.label}</p>
            <p className="text-[22px] font-extrabold mt-1 leading-none" style={{ color: k.color }}>{loading ? '…' : k.value}</p>
            <p className="text-[10.5px] text-[#8a8f8c] mt-1">{loading ? '' : k.sub}</p>
          </div>
        ))}
      </div>
      {/* Row 2 — where the paper is. Figures only (owner, 23 Sep 2026: "don't
          make this clickable"); the cheque filter below does the filtering. */}
      <div className={`grid grid-cols-2 ${headOffice ? 'sm:grid-cols-4' : 'sm:grid-cols-2'} gap-3 mt-3`}>
        {(headOffice ? CUSTODY_TILES : CUSTODY_TILES.filter(t => t.key === 'to_return' || t.key === 'returned'))
          .concat(headOffice && kpi.not_recorded.length > 0 ? [{ key: 'not_recorded' as CustodyView, label: 'Custody not recorded — set where they are', color: '#c47a00' }] : [])
          .map(t => (
          <div key={t.key} className="bg-white border border-[#e6e8e6] rounded-xl px-4 py-3.5">
            <p className="text-[11px] text-[#5b615e]">{t.label}</p>
            <p className="text-[22px] font-extrabold mt-1 leading-none" style={{ color: t.color }}>{loading ? '…' : kpi[t.key].length}</p>
            <p className="text-[10.5px] text-[#8a8f8c] mt-1 truncate">{loading ? '' : mixOf(t.key)}</p>
          </div>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2.5 mt-5 flex-wrap">
        <label className="relative w-full sm:w-[260px]">
          <Search size={13} className="absolute left-3 top-[10px] text-[#8a8f8c]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, unit, cheque no…"
            className="pl-8 pr-3 py-2 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full" />
        </label>
        <select value={building} onChange={e => setBuilding(e.target.value)} title="Filter by building" className={`${field} w-full sm:w-auto max-w-[220px]`}
          style={building ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="">All buildings</option>
          {buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={leasing} onChange={e => setLeasing(e.target.value)} title="Filter by the building's leasing model" className={field}
          style={leasing ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="">All lease types</option>
          {Object.entries(LEASING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={custody} onChange={e => { setCustody(e.target.value as CustodyView | ''); clearSel(); }} title="Where the cheque is" className={field}
          style={custody ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="">All cheques</option>
          {headOffice && <option value="with_us">With us</option>}
          {headOffice && <option value="with_head_office">At head office</option>}
          {headOffice && kpi.not_recorded.length > 0 && <option value="not_recorded">Custody not recorded</option>}
          <option value="to_return">To return to customer</option>
          <option value="returned">Returned to customer</option>
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} title="Leases running in this year — every payment of those leases" className={field}
          style={year ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="">All lease years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(e.target.value)} title="Filter by the month the payment falls due" className={field}
          style={month ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="">All months</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        {/* Status as a select like the other filters (owner, 23 Sep 2026). */}
        <select value={view} onChange={e => goView(e.target.value as View)} title="Payment status" className={field}
          style={view !== 'all' ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          {VIEWS.map(v => <option key={v.key} value={v.key}>{v.key === 'all' ? 'All statuses' : v.label}</option>)}
        </select>
        <div className="flex border border-[#e6e8e6] rounded-lg overflow-hidden bg-white ml-auto">
          {([['units', 'By unit'], ['list', 'List']] as const).map(([v, l], i) => (
            <button key={v} type="button" onClick={() => setLayout(v)} className={`text-[11px] font-semibold px-[11px] py-[7px] cursor-pointer${i ? ' border-l border-[#e6e8e6]' : ''}`}
              style={layout === v ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e' }}>{l}</button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-lg px-3.5 py-2 mt-3.5 text-[12px] border"
          style={notice.ok ? { background: '#e7f4ee', color: '#1a7a52', borderColor: '#cfe8db' } : { background: '#fdecea', color: '#b42318', borderColor: '#f5c6c2' }}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer opacity-70 hover:opacity-100"><X size={13} /></button>
        </div>
      )}

      {/* Selection bar — the actions live here, not inside every row. */}
      {picked.length > 0 && (
        <div className="flex items-center gap-2.5 flex-wrap rounded-lg px-3.5 py-2 mt-3.5 text-[12px]" style={{ background: '#1c1f1d', color: '#fff' }}>
          <span className="font-semibold">{picked.length} selected · {fmtAed(sum(picked))}</span>
          <span className="flex items-center gap-1.5 ml-auto flex-wrap">
            {canClear && pickedCheques.length > 0 && (['cleared', 'bounced', 'pending'] as const).map(s => (
              <button key={s} type="button" disabled={busy} onClick={() => setStatus(s)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-white/40 text-white hover:bg-white/10 cursor-pointer disabled:opacity-50">
                Mark {CHIP[s].label.toLowerCase()}{pickedCheques.length !== picked.length ? ` (${pickedCheques.length})` : ''}
              </button>
            ))}
            {pickedToSubmit.length > 0 && (
              <button type="button" disabled={busy} onClick={() => handOver(pickedToSubmit, true)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50">
                Submit to head office{pickedToSubmit.length !== picked.length ? ` (${pickedToSubmit.length})` : ''}
              </button>
            )}
            {pickedUnknown.length > 0 && (
              <>
                <button type="button" disabled={busy} onClick={() => handOver(pickedUnknown, false)}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-white/40 text-white hover:bg-white/10 cursor-pointer disabled:opacity-50">
                  Mark with us{pickedUnknown.length !== picked.length ? ` (${pickedUnknown.length})` : ''}
                </button>
                <button type="button" disabled={busy} onClick={() => handOver(pickedUnknown, true)}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50">
                  Mark at head office{pickedUnknown.length !== picked.length ? ` (${pickedUnknown.length})` : ''}
                </button>
              </>
            )}
            {pickedSubmitted.length > 0 && pickedToSubmit.length === 0 && (
              <button type="button" disabled={busy} onClick={() => handOver(pickedSubmitted, false)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-white/40 text-white hover:bg-white/10 cursor-pointer disabled:opacity-50">
                Take back from head office
              </button>
            )}
            {pickedToReturn.length > 0 && (
              <button type="button" disabled={busy} onClick={() => setReturnDlg(pickedToReturn)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50">
                Returned to customer{pickedToReturn.length !== picked.length ? ` (${pickedToReturn.length})` : ''}
              </button>
            )}
            {pickedReturned.length > 0 && pickedToReturn.length === 0 && (
              <button type="button" disabled={busy} onClick={() => returnToCustomer(pickedReturned, false)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-white/40 text-white hover:bg-white/10 cursor-pointer disabled:opacity-50">
                Undo return
              </button>
            )}
            <button type="button" onClick={clearSel} className="text-[11px] px-2 py-1 text-white/70 hover:text-white cursor-pointer">Clear</button>
          </span>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8a8f8c]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="mt-3.5 bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
          <p className="text-sm text-[#b42318]">{error}</p>
          <button type="button" onClick={load} className="text-[12px] font-semibold text-[#1a7a52] mt-2 cursor-pointer">Retry</button>
        </div>
      ) : !shown.length && (layout === 'list' || !unitGroups.length) ? (
        <div className="mt-3.5 bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
          {custodyOn ? <Landmark size={28} className="mx-auto mb-2 text-[#c5c3bc]" /> : <Wallet size={28} className="mx-auto mb-2 text-[#c5c3bc]" />}
          <p className="text-sm text-[#9b9890]">{emptyMsg}</p>
        </div>
      ) : (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] mt-3.5 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className={`${grid} ${HEAD}`}>
                {canSelect && (
                  <input type="checkbox" checked={allPicked} onChange={() => setSel(allPicked ? new Set() : new Set(shown.map(r => r.id)))}
                    aria-label="Select all" className="accent-[#1a7a52] cursor-pointer" />
                )}
                <span>DATE</span><span>CUSTOMER</span><span>PAYMENT</span><span>REF</span><span className="text-right">AMOUNT</span><span>STATUS</span><span />
              </div>
              {layout === 'list' ? shown.slice(0, limit).map(renderRow) : unitGroups.slice(0, limit).map((g, i) => (
                <Fragment key={g.key}>
                  {(i === 0 || unitGroups[i - 1].building !== g.building) && (
                    <div className="px-[18px] py-2 bg-[#eef1ee] border-b border-[#e3e7e3] text-[10.5px] font-bold tracking-[.06em] text-[#3d4540] uppercase">
                      {g.building} <span className="font-medium normal-case tracking-normal text-[#8a8f8c]">· {unitGroups.filter(x => x.building === g.building).length} units</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 flex-wrap px-[18px] py-2.5 bg-[#f7f8f7] border-b border-[#eef0ee]">
                    <div className="min-w-0">
                      <span className="font-bold text-[12.5px]">Unit {g.unit}</span>
                      <span className="text-[12px] text-[#5b615e]"> · {g.building}</span>
                      {/* Legal cases only — a breach is the property manager's work, not the accountant's (owner, 23 Sep 2026). */}
                      {g.legal && g.legal.kind === 'case' && (
                        <span className="ml-2 text-[10px] font-bold px-[7px] py-[2px] rounded-full align-middle" style={{ background: '#fdecea', color: '#b42318' }}
                          title="A legal case is open on this tenancy">
                          Legal{g.legal.stage ? ` · ${words(g.legal.stage)}` : ''}{g.legal.what ? ` · ${words(g.legal.what)}` : ''}
                        </span>
                      )}
                      {g.annualRent != null && g.annualRent > 0 && <span className="text-[11px] text-[#5b615e]"> · rent {fmtAed(g.annualRent)}/yr</span>}
                      {[g.tenant, g.contractRef, g.term].filter(v => v && v !== '—').length > 0 && (
                        <div className="text-[11px] text-[#8a8f8c] truncate">{[g.tenant, g.contractRef, g.term].filter(v => v && v !== '—').join(' · ')}</div>
                      )}
                      {g.note && <div className="text-[11px] text-[#c47a00]">{g.note}</div>}
                    </div>
                    <div className="ml-auto text-[11px] text-[#5b615e] whitespace-nowrap text-right">
                      <div>{g.summary || 'No payment lines yet'}{g.late > 0 ? <span className="text-[#b42318] font-semibold"> · late {fmtAed(g.late)}</span> : null}</div>
                      <div className="text-[#8a8f8c]">
                        {g.deposit}{g.deposit && g.contractId != null ? ' · ' : ''}
                        {g.contractId != null && <Link href={leaseHref({ currentContractId: g.contractId, contractId: g.contractId } as PaymentRow) ?? '#'} className="text-[#1a7a52] font-semibold hover:underline" onClick={e => e.stopPropagation()}>Lease →</Link>}
                      </div>
                    </div>
                  </div>
                  {g.rows.map(renderRow)}
                </Fragment>
              ))}
              {limit < totalToDraw && (
                <div ref={sentinelRef} className="flex items-center justify-center gap-3 py-4 text-[11.5px] text-[#8a8f8c] border-b border-[#f1f3f1]">
                  <Loader2 size={13} className="animate-spin" /> Showing {layout === 'units' ? `${Math.min(limit, totalToDraw)} of ${totalToDraw} units` : `${Math.min(limit, totalToDraw)} of ${totalToDraw} rows`} — more as you scroll
                  <button type="button" onClick={() => setLimit(totalToDraw)} className="text-[#1a7a52] font-semibold hover:underline cursor-pointer">Show all</button>
                </div>
              )}
              <div className={`${grid} py-2.5 text-[11px] text-[#8a8f8c] bg-[#fafbfa]`}>
                {canSelect && <span />}
                <span className="col-span-4">{shown.length} row{shown.length !== 1 ? 's' : ''}</span>
                <span className="text-right font-semibold text-[#1c1f1d]">{fmtAed(shownTotal)}</span>
                <span className="col-span-2" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Head office: the trail of what was handed in, with undo. */}
      {(view === 'with_us' || view === 'with_head_office') && !loading && recentlySubmitted.length > 0 && (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] mt-3.5 overflow-hidden">
          <div className="px-[18px] py-2.5 text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] border-b border-[#eef0ee]">RECENTLY SUBMITTED</div>
          {recentlySubmitted.map(r => (
            <div key={r.id} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_120px_150px_90px] gap-3 items-center px-[18px] py-3 text-[12px] border-b border-[#f1f3f1] last:border-0">
              <div className="min-w-0"><span className="font-bold">{r.tenant}</span><span className="text-[#8a8f8c]"> · Unit {r.unit}</span></div>
              <div className="min-w-0 truncate">{methodLabel(r.paymentMethod)} {r.depositRef} · {typeLabel(r.paymentType)}</div>
              <div className="text-right font-semibold whitespace-nowrap">{fmtAed(r.amount)}</div>
              <div className="text-[#8a8f8c] whitespace-nowrap">{fmtDateTime(r.handedOverAt)} · {r.handedOverBy}</div>
              <div className="text-right">
                {canSelect && r.custody === 'with_head_office' && (
                  <button type="button" disabled={busy} onClick={() => handOver([r], false)} className="text-[11px] font-semibold text-[#5b615e] hover:text-[#1c1f1d] cursor-pointer disabled:opacity-50">Undo</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {returnDlg && (
        <ReturnChequeDialog
          what={returnDlg.length === 1 ? `${returnDlg[0].depositRef} · ${fmtAed(returnDlg[0].amount)}` : `${returnDlg.length} cheques · ${fmtAed(sum(returnDlg))}`}
          onClose={() => setReturnDlg(null)}
          allowFile={new Set(returnDlg.map(r => r.currentContractId ?? r.contractId)).size === 1}
          onConfirm={async (reason, note, file) => { await returnToCustomer(returnDlg, true, reason, note, file); }}
        />
      )}
      {detail && (
        <DepositDetailModal deposit={detail as unknown as DepositRow} loadDetail={loadDepositDetail} onClose={() => setDetailId(null)} links={null} />
      )}
    </div>
  );
}
