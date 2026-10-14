/**
 * Lease record — the lease detail shown INSIDE a report (Leases - Monthly):
 * header with the lease's actions, a renewal nudge, a five-figure stats strip,
 * tabbed Payments / Documents / Notes & activity / Breaches, and a right rail
 * with the parties, the payment summary and the unit.
 *
 * Everything is live data from the same endpoints the contract page reads:
 *   GET  /api/contracts/:id               contract, payments, fees, deposit, documents
 *   GET  /api/contracts/:id/payment-refs  receipt numbers (fetchPaymentRefs)
 *   GET  /api/contracts/:id/notes         tenancy notes  · POST to add one
 *   Breaches — the shared BreachesSection (its own endpoints).
 *
 * Money on the contract payload is in AED (not fils), as on the contract page.
 * The totals follow the contract page's rules exactly (see `computeFigures`):
 * the deposit row is never a fee, a renewal's carried deposit is not payable,
 * bounced / cancelled cheques count nowhere, and Rules penalties are incurred
 * charges — shown, but kept out of the contracted "Total payable".
 * Work that needs the full workflow — recording / editing a payment, uploading
 * or requesting a document, renewal, termination — opens the existing flows
 * (the full record or Operations), so nothing is re-implemented here.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  AlertCircle, AlertTriangle, ArrowLeft, BedDouble, Building2, CalendarClock, Check, Clock, Download, ExternalLink, Eye, FileText,
  Loader2, Mail, MapPin, MoreHorizontal, Phone, Plus, Printer, RefreshCw, Scale, Send, ShieldCheck, Users, Wallet, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { openDocViewer } from '@/lib/docViewer';
import { tenantDisplayName } from '@/lib/tenantName';
import { fetchPaymentRefs, EMPTY_PAYMENT_REFS, type PaymentRefs } from '@/lib/paymentRefs';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { BreachesSection } from '@/components/legal/BreachesSection';

/* ── payload (the subset of GET /api/contracts/:id this view reads) ───────── */
interface Payment {
  id: number;
  description: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  amount: number;
  vatAmount?: number;
  transactionDate: string | null;
  chequeStatus?: string | null;
  effectiveStatus?: string | null;
  chequeNumber?: string | null;
  bankName?: string | null;
}
interface Doc {
  id: number;
  category: string;
  documentKey: string;
  displayName: string | null;
  fileUrl: string;
  status: string;
  expiryDate: string | null;
  createdAt?: string | null;
}
interface Contract {
  id: number;
  ref: string;
  contractType: 'new' | 'renewal';
  status: 'pending' | 'issued' | 'active' | 'expired' | 'terminated';
  startDate: string;
  endDate: string;
  annualRent: number;
  numberOfInstallments: number | null;
  parentContractId?: number | null;
  renewalAccepted: 'pending' | 'accepted' | 'rejected' | null;
  renewalStatus: string | null;
  ownRenewalAccepted?: 'pending' | 'accepted' | 'rejected' | null;
  ownRenewalStatus?: string | null;
  termination: { response: 'pending' | 'accepted' | 'rejected' | null } | null;
  securityDeposit?: {
    depositId: number | null; amount: number; chequeNumber: string | null; recordedDate: string | null;
    dueDate: string | null; paymentMethod: string | null; chequeStatus: string | null; status: string | null; isCarried: boolean;
  } | null;
  securityDepositAmount: number | null;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null; entityType?: 'individual' | 'company' | null; companyName?: string | null };
  landlord: { id: number | null; name: string | null; companyName: string | null };
  property: { id: number | null; buildingName: string | null; community: string | null; emirate: string | null; spaceCategory?: string | null };
  unit: { id: number | null; number: string | null; type: string | null; floor: string | null; bedrooms: number | null; bathrooms: number | null };
  documents: Doc[];
  payments: Payment[];
  fees?: Payment[];
}
type Note = { id: number; body: string; authorName: string | null; authorRole: string | null; createdAt: string };
type Tab = 'payments' | 'documents' | 'notes' | 'breaches';

const RENEWAL_WINDOW_DAYS = 120;
/** The shared BreachesSection is styled by the contract page's scoped stylesheet
 *  (.quest-page …), which isn't loaded here. These are exactly the rules it uses,
 *  copied under their own scope (.lr-legal) so the tab looks as it does there. */
const LEGAL_CSS = `.lr-legal { --ink:#16201b; --ink-2:#4a554f; --ink-3:#4a554f; --mute:#8a928d; --mute-2:#b4bab6; --paper:#fff; --surface:#f5f4ee; --mist:#f0eee7; --mist-strong:#e8e6dd; --jade:#0f4d3a; --jade-deep:#0f4d3a; --jade-soft:#e4f2ea; --jade-tint:#e4f2ea; --saffron:#f59e0b; --saffron-deep:#c2410c; --saffron-soft:#fff7ed; --saffron-edge:#f0d68f; --brick:#b3261e; --brick-deep:#b3261e; --brick-soft:#fdecea; --brick-edge:#f2c9c4; --r-lg:22px; --r-md:16px; --r-sm:12px; --sh-card:0 1px 2px rgba(26,23,20,.04); --sh-pop:0 30px 70px -24px rgba(26,23,20,.34); color: var(--ink); }
.lr-legal button, .lr-legal input, .lr-legal select, .lr-legal textarea { font-family: inherit; color: inherit; }
.lr-legal .sec { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); overflow: hidden; margin-bottom: 14px; }
      .lr-legal .sec .sech { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--mist); }
      .lr-legal .sec .sech .si { color: var(--jade-deep); }
      .lr-legal .sec .sech .st { font-size: 14px; font-weight: 700; flex: 1; }
      .lr-legal .sec .secb { padding: 14px 18px; }
      .lr-legal .eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; color: var(--mute); }
      .lr-legal .note { font-size: 11.5px; color: var(--mute); line-height: 1.5; }
      .lr-legal .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 20px; border-radius: 12px; font-weight: 700; font-size: 14px; border: 1px solid transparent; cursor: pointer; transition: all .15s; line-height: 1; white-space: nowrap; font-family: inherit; text-decoration: none; }
      .lr-legal .btn:disabled { opacity: .55; cursor: not-allowed; }
      .lr-legal .btn-jade { background: var(--jade); color: #fff; }
      .lr-legal .btn-jade:hover:not(:disabled) { background: #1a6b51; }
      .lr-legal .btn-brick { background: var(--brick); color: #fff; }
      .lr-legal .btn-brick:hover:not(:disabled) { background: var(--brick-deep); }
      .lr-legal .btn-ghost { background: #fff; color: var(--ink-2); border-color: var(--mist-strong); font-weight: 600; }
      .lr-legal .btn-ghost:hover:not(:disabled) { border-color: var(--mute-2); color: var(--ink); }
      .lr-legal .btn-sm { padding: 10px 15px; font-size: 13px; border-radius: 10px; }
      .lr-legal .btn-lg { padding: 15px 24px; font-size: 14.5px; }
      .lr-legal .btn-block { width: 100%; }
      .lr-legal .pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 99px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
      .lr-legal .pill.action { background: var(--brick-soft); color: var(--brick); }
      .lr-legal .pill.waiting { background: var(--saffron-soft); color: var(--saffron-deep); }
      .lr-legal .pill.celebrate { background: var(--jade-soft); color: var(--jade-deep); }
      .lr-legal .pill.declined { background: var(--mist); color: var(--ink-2); }
      .lr-legal .mini-btn { font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 8px; border: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
      .lr-legal .mini-btn.ok { background: var(--jade-soft); color: var(--jade-deep); }
      .lr-legal .mini-btn.no { background: var(--brick-soft); color: var(--brick); }
      .lr-legal .mini-btn.view { background: #fff; color: var(--jade-deep); border: 1px solid var(--mist-strong); }
      .lr-legal .mscrim { position: fixed; inset: 0; background: rgba(26,23,20,.45); backdrop-filter: blur(3px); z-index: 70; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .lr-legal .modal { background: #fff; border-radius: 20px; box-shadow: var(--sh-pop); width: 100%; display: flex; flex-direction: column; max-height: 92vh; overflow: hidden; }
      .lr-legal .modal.sm { max-width: 460px; }
      .lr-legal .modal.lg { max-width: 680px; }
      .lr-legal .modal.xl { max-width: 980px; }
      .lr-legal .modal .mh { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--mist); flex-shrink: 0; }
      .lr-legal .modal .mt { font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
      .lr-legal .modal .mt .mti { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: #fff; }
      .lr-legal .modal .x { width: 34px; height: 34px; border-radius: 9px; border: 0; background: var(--surface); color: var(--ink-2); display: grid; place-items: center; cursor: pointer; }
      .lr-legal .modal .mb { padding: 22px; overflow-y: auto; }
      .lr-legal .modal .mf { padding: 14px 22px; border-top: 1px solid var(--mist); display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0; }
      .lr-legal .field { margin-bottom: 13px; }
      .lr-legal .field label { display: block; font-size: 11.5px; font-weight: 700; color: var(--ink-3); margin-bottom: 5px; }
      .lr-legal .input { width: 100%; font-size: 13.5px; padding: 11px 13px; border: 1px solid var(--mist-strong); border-radius: 10px; background: #fff; }
      .lr-legal .input:focus { outline: none; border-color: var(--jade); }`;
const TAB_KEY = 'upnow.leaseRecord.tab';


/* ── helpers ─────────────────────────────────────────────────────────────── */
const fmtAed = (n: number | null | undefined) =>
  n == null ? '—' : 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(n));
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE }) : '—';
const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE });
const dayOf = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a payment row reads as — the server's effective status wins. */
const statusOf = (p: Payment) => String(p.effectiveStatus ?? p.chequeStatus ?? 'pending').toLowerCase();
/** Void rows count in no total — bounced and cancelled (as on the contract page) and replaced. */
const isVoid = (s: string) => s.startsWith('bounced') || s === 'cancelled' || s === 'replaced';
const isCleared = (s: string) => s === 'cleared' || s === 'paid' || s === 'received';
const isDepositRow = (p: Payment) => (p.paymentType ?? '') === 'security_deposit';

/** The contract page's segmentation (contracts/[id]/v2 — MGMT_FEE_TYPES,
 *  INCURRED_FEE_TYPES, isFeesVat), mirrored so this record and the full record
 *  never disagree about a figure. Rules penalties are INCURRED: real charges,
 *  but not part of what the lease was contracted to pay. */
const INCURRED_FEE_TYPES = new Set([
  'bounced_cheque_fee', 'cheque_replacement_fee', 'cheque_deferral_fee', 'late_renewal_fee', 'early_termination_fee',
  'late_moveout_fee', 'unauthorized_sharing_fee', 'access_card_fee', 'contract_name_change_fee', 'unit_transfer_fee',
]);
const MGMT_FEE_TYPES = new Set(['admin_fee', 'commission', ...INCURRED_FEE_TYPES]);
const isFeesVat = (p: Payment) => (p.paymentType ?? '') === 'vat' && /fees\s*vat/i.test(p.description ?? '');

const FEE_LABEL: Record<string, string> = {
  admin_fee: 'Admin fee', ejari_fee: 'Contract registration fee', commission: 'Commission',
  maintenance_fee: 'Maintenance fee', service_charge: 'Service charge', vat: 'VAT', rental_income: 'Rent',
  security_deposit: 'Security deposit', bounced_cheque_fee: 'Bounced cheque fee', cheque_replacement_fee: 'Cheque hold / replacement fee',
  cheque_deferral_fee: 'Cheque deferral fee', late_renewal_fee: 'Late renewal fee', early_termination_fee: 'Early termination fee',
  late_moveout_fee: 'Late move-out fee', unauthorized_sharing_fee: 'Sharing without notice fee', access_card_fee: 'Access card replacement',
  contract_name_change_fee: 'Contract name change fee', unit_transfer_fee: 'Unit transfer fee',
};

/** Does this lease already have a renewal of its own under way? Reads the row's
 *  OWN markers (a renewal child mirrors its parent's into the top-level ones). */
function renewalInFlight(c: Contract): boolean {
  const child = c.contractType === 'renewal' && !!c.parentContractId;
  const accepted = c.ownRenewalAccepted !== undefined ? c.ownRenewalAccepted : (child ? null : c.renewalAccepted);
  const status = c.ownRenewalStatus !== undefined ? c.ownRenewalStatus : (child ? null : c.renewalStatus);
  return accepted === 'pending' || accepted === 'accepted' || status === 'draft';
}

type Figures = ReturnType<typeof computeFigures>;

function computeFigures(c: Contract, refs: PaymentRefs, today: Date) {
  const isRenewal = c.contractType === 'renewal';
  const payments = c.payments ?? [];
  const fees = c.fees ?? [];
  const live = (p: Payment) => !isVoid(statusOf(p));
  const sum = (rows: Payment[]) => rows.filter(live).reduce((s, p) => s + Number(p.amount || 0), 0);

  const depositRow = payments.find(isDepositRow) ?? null;
  const nonDeposit = payments.filter(p => !isDepositRow(p));
  const otherRows = nonDeposit.filter(p => (p.paymentType ?? '') === 'other');
  const feesVatRows = nonDeposit.filter(isFeesVat);
  const rent = nonDeposit.filter(p => (p.paymentType ?? '') !== 'other' && !isFeesVat(p));
  const mgmtFees = fees.filter(f => MGMT_FEE_TYPES.has(f.paymentType ?? ''));
  const thirdParty = [...fees.filter(f => !MGMT_FEE_TYPES.has(f.paymentType ?? '')), ...feesVatRows, ...otherRows];

  const dep = c.securityDeposit ?? null;
  const depAmount = depositRow?.amount ?? dep?.amount ?? c.securityDepositAmount ?? 0;
  const depCleared = depositRow ? isCleared(statusOf(depositRow))
    : !!dep && (isCleared(String(dep.chequeStatus ?? '').toLowerCase()) || dep.isCarried
      || ['held', 'received'].includes(String(dep.status ?? '').toLowerCase()));
  /** A renewal carries the deposit from the original lease — held, never payable again. */
  const depPayable = isRenewal || dep?.isCarried ? 0 : depAmount;

  const rentTotal = rent.length ? sum(rent) : c.annualRent;
  const mgmtContracted = sum(mgmtFees.filter(f => !INCURRED_FEE_TYPES.has(f.paymentType ?? '')));
  const incurred = sum(mgmtFees.filter(f => INCURRED_FEE_TYPES.has(f.paymentType ?? '')));
  const thirdPartyTotal = sum(thirdParty);
  const totalPayable = rentTotal + mgmtContracted + thirdPartyTotal + depPayable;
  const grandTotal = totalPayable + incurred;

  const charged = [...nonDeposit, ...fees];
  const collectedRows = charged.filter(p => isCleared(statusOf(p)) && !refs.voidedPaymentIds.has(p.id));
  const collected = collectedRows.reduce((s, p) => s + Number(p.amount || 0), 0) + (depCleared && depPayable ? depPayable : 0);
  const outstanding = Math.max(0, grandTotal - collected);

  // Open rows (not cleared, not void, not already at the bank) — overdue once their due day passed.
  const open = [...charged, ...(depositRow && depPayable ? [depositRow] : [])]
    .filter(p => { const s = statusOf(p); return !isVoid(s) && !isCleared(s) && s !== 'deposited' && !!p.transactionDate; })
    .sort((a, b) => (a.transactionDate ?? '').localeCompare(b.transactionDate ?? ''));
  const overdue = open.filter(p => dayOf(p.transactionDate!) < today);
  const next = open.find(p => dayOf(p.transactionDate!) >= today) ?? null;
  const bounced = charged.filter(p => statusOf(p).startsWith('bounced')).length;
  const rentCheques = rent.filter(p => live(p) && ['rental_income', ''].includes(p.paymentType ?? ''));

  return {
    isRenewal, rent, mgmtFees, thirdParty, dep, depositRow, depAmount, depCleared, depPayable,
    rentTotal, mgmtContracted, incurred, thirdPartyTotal, totalPayable, grandTotal,
    collected, outstanding, overdue, overdueTotal: overdue.reduce((s, p) => s + Number(p.amount || 0), 0),
    next, bounced, rentCheques, chargedCount: charged.filter(live).length, clearedCount: collectedRows.length,
  };
}

/* ── tokens: the warm UpNow palette the surrounding report uses ──────────── */
const card = 'rounded-2xl border border-[#e8e6dd] bg-white shadow-[0_1px_2px_rgba(26,23,20,.04)]';
const btnGhost = 'h-9 px-3.5 rounded-[10px] border border-[#e8e6dd] bg-white text-[13px] font-semibold text-[#4a554f] inline-flex items-center gap-1.5 hover:border-[#d6d3c6] hover:text-[#16201b] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#0f4d3a]/40';
const btnJade = 'h-9 px-3.5 rounded-[10px] bg-[#0f4d3a] hover:bg-[#1a6b51] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#0f4d3a]/40 focus-visible:ring-offset-1';
const btnSm = 'h-8 px-3 rounded-[9px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#0f4d3a]/40';

type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info';
const TONE: Record<Tone, string> = {
  ok: 'bg-[#e4f2ea] text-[#0f4d3a]', warn: 'bg-[#fdf3dc] text-[#8a5a00]', bad: 'bg-[#fdecea] text-[#b3261e]',
  neutral: 'bg-[#f0eee7] text-[#4a554f]', info: 'bg-[#e0f2fe] text-[#0369a1]',
};

function Chip({ tone, children, dot = true }: { tone: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap', TONE[tone])}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}

function PayStatus({ s, overdue }: { s: string; overdue: boolean }) {
  if (isCleared(s)) return <Chip tone="ok">Cleared</Chip>;
  if (s.startsWith('bounced')) return <Chip tone="bad">Bounced</Chip>;
  if (s === 'replaced') return <Chip tone="neutral">Replaced</Chip>;
  if (s === 'cancelled') return <Chip tone="neutral">Cancelled</Chip>;
  if (s === 'deposited') return <Chip tone="info">Deposited</Chip>;
  if (overdue) return <Chip tone="warn">Overdue</Chip>;
  return <Chip tone="neutral">Scheduled</Chip>;
}

const Eyebrow = ({ children, className }: { children: React.ReactNode; className?: string }) =>
  <div className={cn('text-[11px] uppercase tracking-[0.08em] font-bold text-[#4a554f]', className)}>{children}</div>;

function Progress({ pct, tone = 'jade' }: { pct: number; tone?: 'jade' | 'amber' }) {
  return (
    <div className="h-1.5 rounded-full bg-[#f0eee7] overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i className={cn('block h-full rounded-full transition-[width] duration-500', tone === 'amber' ? 'bg-[#d4a017]' : 'bg-[#0f4d3a]')} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/* ── component ───────────────────────────────────────────────────────────── */
export function LeaseRecordPanel({ contractId, onBack, contractsBase }: {
  contractId: number;
  onBack: () => void;
  /** '/rental-provider/dashboard/contracts' or '/dashboard/manager/contracts'. */
  contractsBase: string;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const isManager = pathname.startsWith('/dashboard/manager');
  const { canForRp } = useManagerPermissions();

  const [contract, setContract] = useState<Contract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refs, setRefs] = useState<PaymentRefs>(EMPTY_PAYMENT_REFS);
  const [notes, setNotes] = useState<Note[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTabState] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'payments';
    try { const t = window.localStorage.getItem(TAB_KEY); return (t === 'documents' || t === 'notes' || t === 'breaches') ? t : 'payments'; }
    catch { return 'payments'; }
  });
  const setTab = (t: Tab) => { setTabState(t); try { window.localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/contracts/${contractId}`, { credentials: 'include', signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `Error ${r.status}`);
        return r.json() as Promise<Contract>;
      })
      .then(d => {
        // A company tenant's lease party is the entity — show its name.
        setContract(d?.tenant ? { ...d, tenant: { ...d.tenant, name: tenantDisplayName(d.tenant) } } : d);
        setError(null);
      })
      .catch(e => { if (e?.name !== 'AbortError') setError(String(e?.message ?? e)); });
    fetchPaymentRefs(String(contractId), ctrl.signal).then(setRefs).catch(() => { /* receipt numbers are optional */ });
    fetch(`/api/contracts/${contractId}/notes`, { credentials: 'include', signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: Note[]) => setNotes(Array.isArray(rows) ? rows : []))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [contractId, reloadKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true); };
  }, [menuOpen]);

  // Manager scope: the landlord comes from ?rp= (falls back to the lease's own landlord).
  const rpScope = sp?.get('rp') || (contract?.landlord?.id != null ? String(contract.landlord.id) : '');
  const can = useCallback((flag: Parameters<typeof canForRp>[0]) =>
    !isManager || (rpScope !== '' && canForRp(flag, Number(rpScope))), [isManager, rpScope, canForRp]);
  // A manager without lease authority gets the finance record only (payments + deposit).
  const financeOnly = isManager && !can('canManageAgreements');
  const rpQ = isManager && rpScope ? `?rp=${rpScope}` : '';
  const opsBase = `${isManager ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations'}/${contractId}`;
  const opsHref = (action: string) => `${opsBase}?${isManager && rpScope ? `rp=${rpScope}&` : ''}action=${action}`;
  const fullHref = `${contractsBase}/${contractId}/v2${rpQ}`;
  const printHref = `${contractsBase}/${contractId}/print${rpQ}`;
  const receiptHref = (pid: number) => `${contractsBase}/${contractId}/print/receipt?pid=${pid}${isManager && rpScope ? `&rp=${rpScope}` : ''}`;

  const today = useMemo(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }, []);
  const figures = useMemo(() => (contract ? computeFigures(contract, refs, today) : null), [contract, refs, today]);

  const addNote = async (body: string) => {
    const res = await fetch(`/api/contracts/${contractId}/notes`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Couldn’t save the note');
    const created = await res.json() as Note;
    setNotes(prev => [created, ...prev]);
  };

  if (error) {
    return (
      <div className="max-w-[1240px] mx-auto px-4 sm:px-7 py-10">
        <div className="rounded-2xl border border-[#f2c9c4] bg-[#fdecea] p-5 flex items-start gap-3 text-sm text-[#b3261e]">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1"><b>Couldn’t load this lease.</b><div className="mt-0.5">{error}</div></div>
          <button onClick={() => setReloadKey(k => k + 1)} className={cn(btnSm, 'border border-[#f2c9c4] bg-white')}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      </div>
    );
  }
  if (!contract || !figures || contract.id !== contractId) return <LeaseSkeleton />;

  const c = contract;
  const f = figures;
  const start = dayOf(c.startDate), end = dayOf(c.endDate);
  const totalDays = Math.max(1, daysBetween(start, end));
  const elapsed = daysBetween(start, today);
  const pct = Math.max(0, Math.min(100, (elapsed / totalDays) * 100));
  const daysLeft = daysBetween(today, end);
  const months = Math.round(totalDays / 30.4);
  const upcoming = start > today;
  const renewalDue = c.status === 'active' && daysLeft >= 0 && daysLeft <= RENEWAL_WINDOW_DAYS;
  const canRenew = c.status === 'active' && !renewalInFlight(c) && c.termination?.response !== 'accepted' && can('canManageRenewals');
  const canTerminate = (c.status === 'active' || c.status === 'expired') && c.termination?.response !== 'accepted' && can('canManageAgreements');
  const showLegal = !financeOnly && can('canManageLegal');
  const tenantName = c.tenant.name ?? 'Customer';
  const landlordName = c.landlord.companyName || c.landlord.name || 'Landlord';
  const unitType = [c.unit.bedrooms != null ? (c.unit.bedrooms === 0 ? 'Studio' : `${c.unit.bedrooms}BR`) : null, c.unit.type ? titleCase(c.unit.type) : null].filter(Boolean).join(' · ');
  const area = [c.property.community, c.property.emirate].filter(Boolean).join(', ');
  // A row without a file is a REQUEST sent to the customer, not a document on file.
  const docsOnFile = (c.documents ?? []).filter(d => !!d.fileUrl);
  const docsRequested = (c.documents ?? []).filter(d => !d.fileUrl);
  const receiptCount = Object.keys(refs.receiptByPaymentId).length + (refs.depositReceipt ? 1 : 0);
  const nCheques = f.rentCheques.length || c.numberOfInstallments || 0;
  const collectedPct = f.grandTotal > 0 ? (f.collected / f.grandTotal) * 100 : 0;

  const statusChip = c.status === 'terminated' ? <Chip tone="bad">Terminated</Chip>
    : c.status === 'expired' ? <Chip tone="neutral">Expired</Chip>
    : upcoming || c.status === 'pending' || c.status === 'issued' ? <Chip tone="neutral">{upcoming ? 'Upcoming' : titleCase(c.status)}</Chip>
    : renewalDue ? <Chip tone="warn">Renewal due</Chip>
    : <Chip tone="ok">Active</Chip>;

  const tabs: { key: Tab; label: string; count?: number; alert?: boolean }[] = [
    { key: 'payments', label: 'Payments', count: f.overdue.length || undefined, alert: f.overdue.length > 0 || f.bounced > 0 },
    ...(!financeOnly ? [{ key: 'documents' as Tab, label: 'Documents', count: docsOnFile.length + 1 + (receiptCount ? 1 : 0), alert: docsOnFile.some(d => d.status === 'rejected') }] : []),
    ...(!financeOnly ? [{ key: 'notes' as Tab, label: 'Notes & activity', count: notes.length }] : []),
    ...(showLegal ? [{ key: 'breaches' as Tab, label: 'Breaches' }] : []),
  ];
  const activeTab = tabs.some(t => t.key === tab) ? tab : 'payments';

  return (
    <div className={'max-w-[1240px] mx-auto px-4 sm:px-7 py-6 text-[14px] text-[#16201b]'}>
      {/* ── Header ── */}
      <header className="flex gap-4 items-start mb-5 flex-wrap">
        <button onClick={onBack} title="Back to report (Esc)" aria-label="Back to report"
          className="w-9 h-9 shrink-0 grid place-items-center rounded-[10px] border border-[#e8e6dd] bg-white text-[#4a554f] hover:text-[#16201b] hover:border-[#d6d3c6] outline-none focus-visible:ring-2 focus-visible:ring-[#0f4d3a]/40">
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="m-0 text-[24px] leading-[1.15] font-bold tracking-[-0.02em]">
              Unit {c.unit.number ?? '—'} <span className="text-[#8a928d] font-medium">·</span> {c.property.buildingName ?? '—'}
            </h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[#4a554f]">
            <span className="font-mono text-[12px] font-semibold text-[#4a554f] bg-[#f0eee7] rounded-md px-2 py-0.5">{c.ref || `CID-${c.id}`}</span>
            {statusChip}
            {c.contractType === 'renewal' && <Chip tone="info" dot={false}>Renewal</Chip>}
            <span className="inline-flex items-center gap-1.5"><Users size={14} className="text-[#8a928d]" />{tenantName}</span>
            {unitType && <span className="inline-flex items-center gap-1.5"><BedDouble size={14} className="text-[#8a928d]" />{unitType}</span>}
            {area && <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-[#8a928d]" />{area}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 relative" ref={menuRef}>
          <a href={printHref} target="_blank" rel="noreferrer" className={btnGhost}>
            <Printer size={15} /> Contract PDF
          </a>
          {canRenew && (
            <Link href={opsHref('renew')} className={btnJade}>
              <RefreshCw size={15} /> Propose renewal
            </Link>
          )}
          <button onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen} aria-haspopup="menu" title="More actions" aria-label="More actions"
            className={cn(btnGhost, 'w-9 px-0 justify-center', menuOpen && 'border-[#d6d3c6] bg-[#f5f4ee]')}>
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-11 z-30 min-w-[230px] rounded-xl border border-[#e8e6dd] bg-white p-1.5 shadow-[0_18px_40px_-12px_rgba(26,23,20,.25)]">
              <Link role="menuitem" href={fullHref} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-medium hover:bg-[#f5f4ee]">
                <ExternalLink size={15} className="text-[#4a554f]" /> Open full record
              </Link>
              <Link role="menuitem" href={`${opsBase}${rpQ}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-medium hover:bg-[#f5f4ee]">
                <FileText size={15} className="text-[#4a554f]" /> Open in Operations
              </Link>
              {canTerminate && (
                <>
                  <hr className="my-1 border-[#f0eee7]" />
                  <Link role="menuitem" href={opsHref('terminate')} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-medium text-[#b3261e] hover:bg-[#fdecea]">
                    <X size={15} /> Terminate lease
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Alerts: renewal window, money owed ── */}
      {renewalDue && (
        <div className="mb-3 flex items-center gap-3 flex-wrap rounded-xl border border-[#f0d68f] bg-[#fdf6e3] px-4 py-3 text-[13.5px] text-[#7a5200]">
          <span className="w-8 h-8 rounded-lg grid place-items-center bg-[#fbe9b7] shrink-0"><AlertTriangle size={16} /></span>
          <div className="flex-1 min-w-[220px]"><b className="text-[#4d3400]">Lease ends in {plural(daysLeft, 'day')}</b> — {fmtDate(c.endDate)}. Send a renewal offer at least 90 days before expiry.</div>
          {canRenew
            ? <Link href={opsHref('renew')} className={cn(btnSm, 'border border-[#e9cf86] bg-white text-[#16201b] hover:border-[#d4a017]')}>Propose renewal</Link>
            : renewalInFlight(c) && <Chip tone="ok">Renewal under way</Chip>}
        </div>
      )}
      {(f.overdue.length > 0 || f.bounced > 0) && (
        <button onClick={() => setTab('payments')}
          className="mb-3 w-full text-left flex items-center gap-3 flex-wrap rounded-xl border border-[#f2c9c4] bg-[#fdf3ef] px-4 py-3 text-[13.5px] text-[#b3261e] hover:border-[#e8a993] outline-none focus-visible:ring-2 focus-visible:ring-[#b3261e]/30">
          <span className="w-8 h-8 rounded-lg grid place-items-center bg-[#fbded3] shrink-0"><Clock size={16} /></span>
          <div className="flex-1 min-w-[220px]">
            {f.overdue.length > 0 && <><b className="text-[#7a1d17]">{plural(f.overdue.length, 'payment')} overdue</b> — {fmtAed(f.overdueTotal)}, oldest due {fmtDate(f.overdue[0].transactionDate)}.</>}
            {f.overdue.length > 0 && f.bounced > 0 && ' '}
            {f.bounced > 0 && <><b className="text-[#7a1d17]">{plural(f.bounced, 'cheque')} bounced</b> on this lease.</>}
          </div>
          <span className="text-[12.5px] font-semibold underline underline-offset-2">View payments</span>
        </button>
      )}

      {/* ── Stats strip ── */}
      <section aria-label="Lease at a glance" className={cn(card, 'mt-2 mb-6 grid gap-px bg-[#f0eee7] grid-cols-2 md:grid-cols-4 xl:grid-cols-[1.45fr_1fr_1fr_1fr_1fr] overflow-hidden')}>
        <div className="col-span-2 md:col-span-4 xl:col-span-1 px-5 py-4 bg-white">
          <Eyebrow>Lease term · {months} months</Eyebrow>
          <div className="mt-2 text-[24px] leading-none font-bold tracking-[-0.02em] tabular-nums">
            {upcoming ? <>{daysBetween(today, start)} <small className="text-[13px] font-medium text-[#4a554f]">days until start</small></>
              : daysLeft < 0 ? <>Ended <small className="text-[13px] font-medium text-[#4a554f]">{plural(-daysLeft, 'day')} ago</small></>
              : <>{daysLeft} <small className="text-[13px] font-medium text-[#4a554f]">days remaining</small></>}
          </div>
          <div className="mt-3.5"><Progress pct={pct} tone={renewalDue ? 'amber' : 'jade'} /></div>
          <div className="mt-2 flex justify-between text-[12px] text-[#4a554f] tabular-nums">
            <span>{fmtDate(c.startDate)}</span><span className="text-[#8a928d]">{Math.round(pct)}% elapsed</span><span>{fmtDate(c.endDate)}</span>
          </div>
        </div>
        <Stat label="Annual rent" value={fmtAed(c.annualRent)}
          sub={nCheques ? `${plural(nCheques, 'cheque')} of ${fmtAed(c.annualRent / nCheques)}` : undefined} />
        <Stat label="Collected" value={fmtAed(f.collected)}
          extra={<div className="mt-2.5"><Progress pct={collectedPct} /></div>}
          sub={f.outstanding <= 0 ? 'Fully collected' : `${fmtAed(f.outstanding)} still to collect`} />
        <Stat label={f.overdue.length ? 'Overdue' : 'Next payment'}
          tone={f.overdue.length ? 'bad' : undefined}
          value={f.overdue.length ? fmtAed(f.overdueTotal) : f.next ? fmtAed(f.next.amount) : '—'}
          sub={f.overdue.length ? `${plural(f.overdue.length, 'payment')} past due`
            : f.next ? `Due ${fmtDate(f.next.transactionDate)} · in ${plural(daysBetween(today, dayOf(f.next.transactionDate!)), 'day')}`
            : 'Nothing scheduled'} />
        {financeOnly
          ? <Stat label="Security deposit" value={fmtAed(f.depAmount)} sub={f.depCleared ? 'Received' : 'Not yet received'} />
          : <Stat label="Documents" value={<>{docsOnFile.length} <small className="text-[13px] font-medium text-[#4a554f]">on file</small></>}
              tone={docsOnFile.some(d => d.status === 'rejected') ? 'warn' : undefined}
              sub={docsOnFile.some(d => d.status === 'rejected') ? 'Some need re-upload'
                : docsRequested.length ? `${plural(docsRequested.length, 'request')} awaiting upload`
                : 'Agreement & receipts are generated'} />}
      </section>

      <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          {/* ── Tabs — scroll sideways on narrow screens, never vertically ── */}
          <div role="tablist" aria-label="Lease sections"
            className="flex gap-1 border-b border-[#e8e6dd] mb-5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map(t => {
              const on = activeTab === t.key;
              return (
                <button key={t.key} role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                  className={cn('relative h-11 px-3.5 text-[14px] font-semibold inline-flex items-center gap-2 whitespace-nowrap rounded-t-lg transition-colors outline-none focus-visible:bg-[#f0eee7]',
                    on ? 'text-[#16201b]' : 'text-[#4a554f] hover:text-[#16201b] hover:bg-[#f5f4ee]')}>
                  {t.label}
                  {t.count != null && (
                    <span className={cn('min-w-[20px] h-5 px-1.5 rounded-full text-[11.5px] font-bold grid place-items-center tabular-nums',
                      t.alert ? 'bg-[#fdecea] text-[#b3261e]' : on ? 'bg-[#e4f2ea] text-[#0f4d3a]' : 'bg-[#f0eee7] text-[#4a554f]')}>{t.count}</span>
                  )}
                  {t.alert && t.count == null && <span className="w-1.5 h-1.5 rounded-full bg-[#b3261e]" aria-label="Needs attention" />}
                  {on && <span aria-hidden className="absolute left-2 right-2 bottom-0 h-[2.5px] rounded-full bg-[#0f4d3a]" />}
                </button>
              );
            })}
          </div>

          {activeTab === 'payments' && (
            <PaymentsTab c={c} f={f} refs={refs} today={today} receiptHref={receiptHref} fullHref={fullHref} />
          )}
          {activeTab === 'documents' && (
            <DocumentsTab docs={docsOnFile} requested={docsRequested} tenantName={tenantName} fullHref={fullHref} printHref={printHref}
              receipts={receiptCount}
              firstReceiptHref={(() => { const id = Object.keys(refs.receiptByPaymentId)[0]; return id ? receiptHref(Number(id)) : null; })()} />
          )}
          {activeTab === 'notes' && <NotesTab notes={notes} onAdd={addNote} canWrite={can('canManageAgreements')} />}
          {activeTab === 'breaches' && showLegal && (
            <div className="lr-legal">
              <style>{LEGAL_CSS}</style>
              <div className="sec">
              <BreachesSection
                leaseId={c.id}
                leaseStatus={c.status}
                base={isManager ? '/manager/legal' : '/legal'}
                rp={isManager && rpScope !== '' ? Number(rpScope) : undefined}
                disputeHrefOf={id => isManager ? `/dashboard/manager/legal/${id}${rpScope ? `?rp=${rpScope}` : ''}` : `/rental-provider/dashboard/legal/${id}`}
              />
              </div>
            </div>
          )}
        </div>

        {/* ── Right rail ── */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <RailCard title="Parties">
            <Party avatar={<span className="w-10 h-10 rounded-full grid place-items-center text-[13px] font-bold bg-[#e4f2ea] text-[#0f4d3a] shrink-0">{initials(tenantName)}</span>}
              name={tenantName} role="Customer"
              lines={!financeOnly ? [c.tenant.email, c.tenant.phone].filter((x): x is string => !!x) : []}
              actions={!financeOnly && (
                <>
                  {c.tenant.email && (
                    <a href={`mailto:${c.tenant.email}`} title={c.tenant.email} aria-label={`Email ${tenantName}`} className={railIconBtn}><Mail size={15} /></a>
                  )}
                  {c.tenant.phone && (
                    <a href={`tel:${c.tenant.phone.replace(/\s/g, '')}`} title={c.tenant.phone} aria-label={`Call ${tenantName}`} className={railIconBtn}><Phone size={15} /></a>
                  )}
                </>
              )} />
            <div className="mx-[18px] border-t border-[#f0eee7]" />
            <Party avatar={<span className="w-10 h-10 rounded-xl grid place-items-center bg-[#f0eee7] text-[#4a554f] shrink-0"><Building2 size={17} /></span>}
              name={landlordName} role="Landlord" />
          </RailCard>

          <RailCard title="Payment summary">
            <div className="px-[18px] pt-1 pb-3">
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-[#4a554f]">Collected</span>
                <span className="tabular-nums"><b className="font-bold">{fmtAed(f.collected)}</b> <span className="text-[#8a928d]">of {fmtAed(f.grandTotal)}</span></span>
              </div>
              <div className="mt-2"><Progress pct={collectedPct} /></div>
              <div className="mt-1.5 flex justify-between text-[12px] text-[#4a554f] tabular-nums">
                <span>{Math.round(collectedPct)}% collected</span>
                <span className={f.outstanding > 0 ? 'text-[#8a5a00] font-semibold' : ''}>{f.outstanding > 0 ? `${fmtAed(f.outstanding)} outstanding` : 'Nothing outstanding'}</span>
              </div>
            </div>
            <div className="border-t border-[#f0eee7] pt-1.5">
              <KV k="Annual rent" v={fmtAed(f.rentTotal)} />
              <KV k="Management fees" v={fmtAed(f.mgmtContracted)} />
              <KV k="Third-party & other charges" v={fmtAed(f.thirdPartyTotal)} />
              <KV k="Security deposit" v={f.depPayable ? fmtAed(f.depAmount) : f.depAmount ? 'Carried forward' : '—'}
                hint={!f.depPayable && f.depAmount ? `${fmtAed(f.depAmount)} held from the previous term` : undefined} />
              <div className="flex justify-between px-[18px] pt-3 pb-3 mt-1.5 border-t border-[#f0eee7] font-bold text-[15px]">
                <span>Total payable</span><span className="tabular-nums">{fmtAed(f.totalPayable)}</span>
              </div>
              {f.incurred > 0 && (
                <div className="px-[18px] pb-4 -mt-1">
                  <div className="flex justify-between text-[13px] text-[#b3261e]"><span>+ Penalties & charges incurred</span><b className="tabular-nums">{fmtAed(f.incurred)}</b></div>
                  <div className="mt-1 text-[12px] text-[#4a554f]">Charged during the lease, outside the contracted total.</div>
                </div>
              )}
            </div>
          </RailCard>

          <RailCard title="Unit">
            <dl className="grid grid-cols-2 gap-x-2 px-2 pt-1 pb-3 m-0">
              <Fact k="Property" v={c.property.buildingName ?? '—'} />
              <Fact k="Unit" v={c.unit.number ?? '—'} />
              <Fact k="Type" v={unitType || '—'} />
              <Fact k="Floor" v={c.unit.floor ?? '—'} />
              <Fact k="Area" v={area || '—'} />
              <Fact k="Category" v={c.property.spaceCategory ? titleCase(c.property.spaceCategory) : '—'} />
            </dl>
          </RailCard>
          <p className="text-center text-[12px] text-[#8a928d] hidden md:block">
            <Kbd>J</Kbd> / <Kbd>K</Kbd> next / previous lease · <Kbd>Esc</Kbd> back
          </p>
        </aside>
      </div>
    </div>
  );
}

/* ── tabs ────────────────────────────────────────────────────────────────── */
function PaymentsTab({ c, f, refs, today, receiptHref, fullHref }: {
  c: Contract; f: Figures; refs: PaymentRefs; today: Date; receiptHref: (pid: number) => string; fullHref: string;
}) {
  const dep = f.dep;
  const depRow = f.depositRow;
  const depRef = dep?.depositId != null ? refs.receiptByDepositId[dep.depositId] ?? refs.depositReceipt?.refNo : refs.depositReceipt?.refNo;
  const depMethod = dep?.paymentMethod ?? depRow?.paymentMethod ?? null;
  const depCheque = dep?.chequeNumber ?? depRow?.chequeNumber ?? null;
  const groups: [string, Payment[]][] = ([
    ['Rental income', f.rent], ['Management fee', f.mgmtFees], ['Third party & other charges', f.thirdParty],
  ] as [string, Payment[]][]).filter(([, rows]) => rows.length > 0);
  const sortByDue = (rows: Payment[]) => [...rows].sort((a, b) => (a.transactionDate ?? '').localeCompare(b.transactionDate ?? ''));
  const carried = !f.depPayable && !!f.depAmount;

  return (
    <div className="space-y-4">
      <section className={cn(card, 'overflow-hidden')}>
        <SecHead icon={<ShieldCheck size={16} />} title="Security deposit"
          right={<span className="text-[12.5px] text-[#4a554f]">{carried ? 'Carried forward from the previous term' : 'Held against the lease, refundable at move-out'}</span>} />
        {f.depAmount ? (
          <div className="grid grid-cols-2 sm:grid-cols-[auto_1fr_1fr_1fr_auto] gap-x-8 gap-y-4 items-center px-5 py-4">
            <div className="text-[24px] leading-none font-bold tracking-[-0.02em] tabular-nums col-span-2 sm:col-span-1">{fmtAed(f.depAmount)}</div>
            <DepField k="Receipt" v={depRef ? <span className="font-mono text-[12.5px]">{depRef}</span> : '—'} />
            <DepField k="Method" v={<>{depMethod ? titleCase(depMethod) : '—'}{depCheque && <span className="font-mono text-[12px] text-[#4a554f]"> #{depCheque}</span>}</>} />
            <DepField k={f.depCleared ? 'Received' : 'Due'} v={fmtDate(dep?.recordedDate ?? dep?.dueDate ?? depRow?.transactionDate)} />
            {carried ? <Chip tone="info">Carried</Chip> : f.depCleared ? <Chip tone="ok">Cleared</Chip> : <Chip tone="neutral">Pending</Chip>}
          </div>
        ) : (
          <div className="px-5 py-5 text-[13.5px] text-[#4a554f]">No security deposit recorded on this lease.</div>
        )}
      </section>

      <section className={cn(card, 'overflow-hidden')}>
        <SecHead icon={<Wallet size={16} />} title="Payment schedule"
          sub={f.chargedCount ? `${f.clearedCount} of ${f.chargedCount} cleared${f.overdue.length ? ` · ${f.overdue.length} overdue` : ''}${f.bounced ? ` · ${f.bounced} bounced` : ''}` : undefined}
          right={<Link href={fullHref} className={cn(btnSm, 'border border-[#e8e6dd] text-[#4a554f] hover:border-[#d6d3c6]')}><Plus size={13} /> Record / edit payments</Link>} />
        {groups.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13.5px] text-[#4a554f]">No payments recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-[#4a554f] font-bold">
                  <th className="pl-5 pr-3 py-2.5 border-b border-[#f0eee7] font-bold">Item</th>
                  <th className="px-3 py-2.5 border-b border-[#f0eee7] font-bold">Due</th>
                  <th className="px-3 py-2.5 border-b border-[#f0eee7] font-bold">Method</th>
                  <th className="px-3 py-2.5 border-b border-[#f0eee7] font-bold text-right">Amount</th>
                  <th className="px-3 py-2.5 border-b border-[#f0eee7] font-bold">Status</th>
                  <th className="pr-5 pl-2 py-2.5 border-b border-[#f0eee7] w-12"><span className="sr-only">Receipt</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([label, rows]) => (
                  <PayGroup key={label} label={label} rows={sortByDue(rows)} refs={refs} today={today} receiptHref={receiptHref} numbered={label === 'Rental income'} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-4 bg-[#0f4d3a] text-white">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold">Grand total</span>
            <span className="opacity-75 text-[12.5px]">{f.depPayable ? 'incl. security deposit' : 'deposit carried forward'}{f.incurred > 0 ? ' · incl. incurred charges' : ''}</span>
            <b className="ml-auto text-[20px] tracking-[-0.02em] tabular-nums">{fmtAed(f.grandTotal)}</b>
          </div>
          <div className="mt-1 flex justify-between text-[12.5px] opacity-80 tabular-nums">
            <span>Collected {fmtAed(f.collected)}</span>
            <span>{f.outstanding > 0 ? `Outstanding ${fmtAed(f.outstanding)}` : 'Fully collected'}</span>
          </div>
        </div>
      </section>
      {c.contractType === 'renewal' && (
        <p className="text-[12.5px] text-[#4a554f]">This is a renewal term — the deposit and any earlier payments sit on the previous lease.</p>
      )}
    </div>
  );
}

function PayGroup({ label, rows, refs, today, receiptHref, numbered }: {
  label: string; rows: Payment[]; refs: PaymentRefs; today: Date; receiptHref: (pid: number) => string; numbered: boolean;
}) {
  const subtotal = rows.filter(p => !isVoid(statusOf(p))).reduce((s, p) => s + Number(p.amount || 0), 0);
  // Instalment numbers count live rows only — a void cheque takes no number.
  const numberOf = new Map<number, number>();
  if (numbered) for (const p of rows) if (!isVoid(statusOf(p))) numberOf.set(p.id, numberOf.size + 1);
  return (
    <>
      <tr className="bg-[#f5f4ee]">
        <td colSpan={3} className="pl-5 pr-3 py-2 border-b border-[#f0eee7] text-[12px] font-bold uppercase tracking-[0.06em] text-[#4a554f]">
          {label} <span className="ml-1 font-semibold text-[#8a928d] normal-case tracking-normal">· {rows.length}</span>
        </td>
        <td className="px-3 py-2 border-b border-[#f0eee7] text-right text-[13px] font-bold tabular-nums text-[#4a554f]">{fmtAed(subtotal)}</td>
        <td colSpan={2} className="border-b border-[#f0eee7]" />
      </tr>
      {rows.map(p => {
        const s = statusOf(p);
        const v = isVoid(s);
        const overdue = !v && !isCleared(s) && s !== 'deposited' && !!p.transactionDate && dayOf(p.transactionDate) < today;
        const rc = refs.receiptByPaymentId[p.id];
        const voided = refs.voidedPaymentIds.has(p.id);
        return (
          <tr key={p.id} className={cn('border-b border-[#f0eee7] last:border-b-0 transition-colors hover:bg-[#fafaf6]', v && 'text-[#8a928d]', overdue && 'bg-[#fffaf0]')}>
            <td className="pl-5 pr-3 py-3">
              <div className="flex items-center gap-2.5">
                {numbered && <span className={cn('w-6 h-6 shrink-0 rounded-md grid place-items-center text-[11.5px] font-bold tabular-nums', v ? 'bg-transparent' : 'bg-[#f0eee7] text-[#4a554f]')}>{numberOf.get(p.id) ?? ''}</span>}
                <div className="min-w-0">
                  <b className={cn('font-semibold block', v && 'line-through font-medium')}>{p.description || FEE_LABEL[p.paymentType ?? ''] || 'Payment'}</b>
                  {rc && <span className="font-mono text-[12px] text-[#4a554f]">{rc}{voided ? ' · void' : ''}</span>}
                </div>
              </div>
            </td>
            <td className={cn('px-3 py-3 tabular-nums whitespace-nowrap', overdue && 'text-[#8a5a00] font-semibold')}>{fmtDate(p.transactionDate)}</td>
            <td className="px-3 py-3 text-[#4a554f] whitespace-nowrap">
              {p.paymentMethod ? titleCase(p.paymentMethod) : '—'}
              {p.chequeNumber && <span className="block font-mono text-[12px] text-[#4a554f]">#{p.chequeNumber}{p.bankName ? ` · ${p.bankName}` : ''}</span>}
            </td>
            <td className="px-3 py-3 text-right font-bold tabular-nums whitespace-nowrap">
              {fmtAed(p.amount)}
              {!!p.vatAmount && <span className="block text-[12px] font-medium text-[#4a554f]">incl. {fmtAed(p.vatAmount)} VAT</span>}
            </td>
            <td className="px-3 py-3"><PayStatus s={s} overdue={overdue} /></td>
            <td className="pr-5 pl-2 py-3 text-right">
              {rc && (
                <a href={receiptHref(p.id)} target="_blank" rel="noreferrer" title={voided ? `Receipt ${rc} — voided` : `Download receipt ${rc}`}
                  aria-label={`Receipt ${rc}`}
                  className={cn('w-8 h-8 inline-grid place-items-center rounded-lg border border-[#e8e6dd] bg-white transition-colors hover:border-[#0f4d3a]', voided ? 'text-[#b3261e]' : 'text-[#4a554f] hover:text-[#0f4d3a]')}>
                  <Download size={14} />
                </a>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function DocumentsTab({ docs, requested, tenantName, fullHref, printHref, receipts, firstReceiptHref }: {
  docs: Doc[]; requested: Doc[]; tenantName: string; fullHref: string; printHref: string; receipts: number; firstReceiptHref: string | null;
}) {
  const sorted = [...docs].sort((a, b) => (a.displayName ?? a.documentKey).localeCompare(b.displayName ?? b.documentKey));
  const label = (d: Doc) => d.displayName || titleCase(d.documentKey);
  return (
    <section className={cn(card, 'overflow-hidden')}>
      <SecHead icon={<FileText size={16} />} title="Contract documents"
        right={<Link href={fullHref} className={btnJade.replace('h-9 px-3.5', 'h-8 px-3').replace('text-[13px]', 'text-[12.5px]')}><Plus size={13} /> Upload or request</Link>} />
      {/* Papers the system generates from the lease itself — always available. */}
      <SubHead>Generated from this lease</SubHead>
      <GeneratedDoc title="Tenancy agreement" sub="The contract, ready to print or save as PDF" href={printHref} />
      {receipts > 0 && firstReceiptHref && (
        <GeneratedDoc title="Payment receipts" sub={`${plural(receipts, 'receipt')} issued — each one also downloads from the Payments tab`} href={firstReceiptHref} />
      )}

      {requested.length > 0 && (
        <>
          <SubHead border>Requested from {tenantName} <span className="normal-case tracking-normal font-semibold text-[#8a928d]">· {requested.length}</span></SubHead>
          {requested.map(d => (
            <div key={d.id} className="flex items-center gap-3.5 px-5 py-3 border-b border-[#f0eee7] last:border-b-0">
              <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-[#fdf3dc] text-[#8a5a00]"><Send size={15} /></span>
              <div className="min-w-0 flex-1">
                <b className="font-semibold block truncate">{label(d)}</b>
                <small className="text-[12.5px] text-[#4a554f]">Awaiting upload{d.createdAt ? ` · requested ${fmtDate(d.createdAt)}` : ''}</small>
              </div>
              <Chip tone="warn">Requested</Chip>
            </div>
          ))}
        </>
      )}

      <SubHead border>Uploaded files {sorted.length > 0 && <span className="normal-case tracking-normal font-semibold text-[#8a928d]">· {sorted.length}</span>}
        {sorted.length > 1 && (
          <button onClick={() => openDocViewer(sorted.map(d => ({ fileUrl: d.fileUrl, caption: label(d) })), 'Contract documents')}
            className="ml-auto normal-case tracking-normal text-[12.5px] text-[#0f4d3a] font-semibold hover:underline">View all</button>
        )}
      </SubHead>
      {sorted.length === 0 ? (
        <div className="px-6 pt-6 pb-8 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl grid place-items-center bg-[#f5f4ee] border border-[#e8e6dd] text-[#4a554f]"><FileText size={19} /></div>
          <h4 className="m-0 mb-1 text-[14px] font-bold">No files uploaded yet</h4>
          <p className="m-0 mx-auto max-w-[420px] text-[13px] leading-relaxed text-[#4a554f]">Upload the agreement, receipts and certificates, or request them from {tenantName}, from the full record.</p>
        </div>
      ) : sorted.map((d, i) => {
        const rejected = d.status === 'rejected';
        const expired = !!d.expiryDate && dayOf(d.expiryDate) < new Date();
        return (
          <div key={d.id} className="flex items-center gap-3.5 px-5 py-3 border-b border-[#f0eee7] last:border-b-0 hover:bg-[#fafaf6] transition-colors">
            <span className={cn('w-9 h-9 rounded-lg grid place-items-center shrink-0',
              rejected || expired ? 'bg-[#fdecea] text-[#b3261e]' : 'bg-[#e4f2ea] text-[#0f4d3a]')}>
              {rejected || expired ? <AlertTriangle size={15} /> : <Check size={15} />}
            </span>
            <div className="min-w-0 flex-1">
              <b className="font-semibold block truncate">{label(d)}</b>
              <small className="text-[12.5px] text-[#4a554f]">
                {titleCase(d.category)}
                {d.createdAt && <> · added {fmtDate(d.createdAt)}</>}
                {d.expiryDate && <> · <span className={expired ? 'text-[#b3261e] font-semibold' : ''}>{expired ? 'expired' : 'expires'} {fmtDate(d.expiryDate)}</span></>}
                {rejected && <> · <span className="text-[#b3261e] font-semibold">rejected — needs re-upload</span></>}
              </small>
            </div>
            <button onClick={() => openDocViewer(sorted.map(x => ({ fileUrl: x.fileUrl, caption: label(x) })), 'Contract documents', { startIndex: i })}
              className={cn(btnSm, 'border border-[#e8e6dd] text-[#4a554f] hover:border-[#d6d3c6]')}>
              <Eye size={14} /> View
            </button>
          </div>
        );
      })}
    </section>
  );
}

function GeneratedDoc({ title, sub, href }: { title: string; sub: string; href: string }) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-3 border-b border-[#f0eee7] hover:bg-[#fafaf6] transition-colors">
      <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-[#e4f2ea] text-[#0f4d3a]"><FileText size={15} /></span>
      <div className="min-w-0 flex-1"><b className="font-semibold block truncate">{title}</b><small className="text-[12.5px] text-[#4a554f]">{sub}</small></div>
      <a href={href} target="_blank" rel="noreferrer" className={cn(btnSm, 'border border-[#e8e6dd] text-[#4a554f] hover:border-[#d6d3c6]')}>
        <Eye size={14} /> Open
      </a>
    </div>
  );
}

function NotesTab({ notes, onAdd, canWrite }: { notes: Note[]; onAdd: (body: string) => Promise<void>; canWrite: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try { await onAdd(body); setText(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t save the note'); }
    finally { setBusy(false); }
  };
  return (
    <section className={cn(card, 'overflow-hidden')}>
      {canWrite && (
        <div className="px-5 py-4 border-b border-[#f0eee7]">
          <textarea value={text} onChange={e => setText(e.target.value)} aria-label="New note"
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(); } }}
            placeholder="Add an internal note — visible to your team only, never shown to the customer."
            className="w-full min-h-[92px] rounded-xl border border-[#e8e6dd] bg-[#f5f4ee] px-3.5 py-3 text-[14px] leading-relaxed resize-y outline-none transition placeholder:text-[#8a928d] focus:bg-white focus:border-[#0f4d3a] focus:ring-4 focus:ring-[#0f4d3a]/10" />
          <div className="mt-2.5 flex items-center gap-2.5">
            <small className="text-[12px] text-[#4a554f]"><Kbd>⌘</Kbd> <Kbd>Enter</Kbd> to save</small>
            {err && <small className="text-[12px] text-[#b3261e]">{err}</small>}
            <button onClick={() => void save()} disabled={!text.trim() || busy}
              className={cn(btnSm, 'ml-auto bg-[#0f4d3a] hover:bg-[#1a6b51] text-white disabled:opacity-45 disabled:cursor-not-allowed')}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add note
            </button>
          </div>
        </div>
      )}
      {notes.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl grid place-items-center bg-[#f5f4ee] border border-[#e8e6dd] text-[#4a554f]"><CalendarClock size={19} /></div>
          <h4 className="m-0 mb-1 text-[14px] font-bold">No notes on this lease yet</h4>
          <p className="m-0 text-[13px] text-[#4a554f]">Notes and system events for this tenancy will appear here.</p>
        </div>
      ) : (
        <ol className="m-0 p-0 list-none">
          {notes.map(n => (
            <li key={n.id} className="relative flex gap-3 px-5 py-4 border-b border-[#f0eee7] last:border-b-0">
              <span className={cn('w-8 h-8 rounded-full grid place-items-center text-[11.5px] font-bold shrink-0',
                n.authorName ? 'bg-[#16201b] text-white' : 'bg-[#e4f2ea] text-[#0f4d3a]')}>
                {n.authorName ? initials(n.authorName) : <Scale size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-[#4a554f] mb-1 flex flex-wrap items-center gap-x-2">
                  <b className="text-[#16201b] font-bold text-[13.5px]">{n.authorName ?? 'System'}</b>
                  {n.authorRole && <span className="text-[11.5px] font-semibold bg-[#f0eee7] text-[#4a554f] rounded px-1.5 py-px">{titleCase(n.authorRole)}</span>}
                  <span>{fmtDateTime(n.createdAt)}</span>
                </div>
                <p className="m-0 leading-relaxed whitespace-pre-wrap text-[14px] text-[#4a554f]">{n.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ── small pieces ────────────────────────────────────────────────────────── */
function LeaseSkeleton() {
  const bar = 'rounded-md bg-[#f0eee7] animate-pulse';
  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-7 py-6" aria-busy="true" aria-label="Loading lease">
      <div className="flex gap-4 mb-6"><div className={cn(bar, 'w-9 h-9')} /><div className="flex-1 space-y-2.5"><div className={cn(bar, 'h-7 w-80 max-w-full')} /><div className={cn(bar, 'h-4 w-[28rem] max-w-full')} /></div></div>
      <div className={cn(card, 'h-[118px] mb-6 animate-pulse')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-4"><div className={cn(bar, 'h-10')} /><div className={cn(card, 'h-28 animate-pulse')} /><div className={cn(card, 'h-72 animate-pulse')} /></div>
        <div className="space-y-4"><div className={cn(card, 'h-40 animate-pulse')} /><div className={cn(card, 'h-56 animate-pulse')} /></div>
      </div>
      <Loader2 size={18} className="sr-only" />
    </div>
  );
}
function Stat({ label, value, sub, extra, tone }: { label: string; value: React.ReactNode; sub?: string; extra?: React.ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <div className="px-5 py-4 bg-white">
      <Eyebrow className={tone === 'bad' ? 'text-[#b3261e]' : tone === 'warn' ? 'text-[#8a5a00]' : undefined}>{label}</Eyebrow>
      <div className={cn('mt-2 text-[22px] leading-none font-bold tracking-[-0.02em] tabular-nums', tone === 'bad' && 'text-[#b3261e]')}>{value}</div>
      {extra}
      {sub && <div className="mt-2 text-[12.5px] leading-snug text-[#4a554f]">{sub}</div>}
    </div>
  );
}
function SecHead({ icon, title, sub, right }: { icon: React.ReactNode; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#f0eee7] flex-wrap">
      <span className="w-8 h-8 rounded-lg grid place-items-center bg-[#f0eee7] text-[#4a554f] shrink-0">{icon}</span>
      <div className="min-w-0">
        <h3 className="m-0 text-[15px] font-bold leading-tight">{title}</h3>
        {sub && <div className="text-[12.5px] text-[#4a554f] mt-0.5">{sub}</div>}
      </div>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}
function SubHead({ children, border }: { children: React.ReactNode; border?: boolean }) {
  return (
    <div className={cn('flex items-center gap-1 px-5 pt-4 pb-2 text-[11px] uppercase tracking-[0.08em] font-bold text-[#4a554f]', border && 'border-t border-[#f0eee7]')}>
      {children}
    </div>
  );
}
function DepField({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="min-w-0"><Eyebrow>{k}</Eyebrow><div className="mt-1 font-semibold text-[14px]">{v}</div></div>;
}
const railIconBtn = 'w-8 h-8 grid place-items-center rounded-lg border border-[#e8e6dd] bg-white text-[#4a554f] hover:text-[#0f4d3a] hover:border-[#0f4d3a] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#0f4d3a]/40';
function Party({ avatar, name, role, lines = [], actions }: { avatar: React.ReactNode; name: string; role: string; lines?: string[]; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-[18px] py-3">
      {avatar}
      <div className="min-w-0 flex-1">
        <b className="font-bold text-[14.5px] block truncate" title={name}>{name}</b>
        <small className="text-[12.5px] text-[#4a554f]">{role}</small>
        {lines.map(l => <div key={l} className="text-[12.5px] text-[#4a554f] truncate mt-0.5" title={l}>{l}</div>)}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}
function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className={card}><div className="px-[18px] pt-4 pb-1.5"><Eyebrow>{title}</Eyebrow></div>{children}</div>;
}
function KV({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="px-[18px] py-2 text-[13.5px]">
      <div className="flex justify-between gap-3"><span className="text-[#4a554f]">{k}</span><b className="font-bold tabular-nums whitespace-nowrap">{v}</b></div>
      {hint && <div className="text-[12px] text-[#4a554f] text-right">{hint}</div>}
    </div>
  );
}
function Fact({ k, v }: { k: string; v: string }) {
  return <div className="px-2.5 py-2 min-w-0"><dt className="text-[12px] text-[#4a554f]">{k}</dt><dd className="m-0 font-semibold text-[13.5px] truncate" title={v}>{v}</dd></div>;
}
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="font-mono text-[11px] border border-[#e8e6dd] border-b-2 rounded px-1.5 py-px bg-white text-[#4a554f]">{children}</kbd>;
}
