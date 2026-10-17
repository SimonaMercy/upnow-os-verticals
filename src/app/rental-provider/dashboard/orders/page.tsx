/**
 * RP Leases register ("Orders") — Operations › Long-term leases (Genspark OS layout).
 *
 * Parity with previous page (orders/page.tsx before the Genspark rebuild):
 *  - [x] Export `OrdersWorkspace({ manager?: { rp } })` — reused by /dashboard/manager/contracts
 *        (same props; manager mode reads /manager/* endpoints and links into the manager portal).
 *  - [x] GET /api/contracts (or /api/manager/contracts?rp=) — the full contract list.
 *  - [x] GET /api/contracts/operations (or /api/manager/contracts/operations?rp=) — the Operations
 *        worklist; its ids are excluded from the register (the two surfaces stay exact complements).
 *        Its checklist is now ALSO read to place each in-setup lease on the pipeline board.
 *  - [x] legalApi.leaseFlags('/legal' | '/manager/legal', rp, ids) in chunks of 200 → Breach / Legal
 *        pills per row; breach pill → `${href}#sec-breaches`, legal pill → legal case route.
 *  - [x] Status model unchanged: displayStatusOf / isInForce / collapse-per-unit / liveLeaseTips
 *        reconciliation / setupReasonOf (copied verbatim from the previous page).
 *  - [x] Buckets: Active Leases · Starts later · Expired Leases, with counts (was a dropdown, now a Seg).
 *  - [x] Filters: search (ref, customer, company, email, unit, building), Properties, Lease type
 *        (New / Renewal), Reset, "N of M" result count. Page resets to 1 on any filter change.
 *  - [x] Sort: soonest-ending first (previous fixed order) is the default; other orders added.
 *  - [x] Pagination: 10 per page, compact page window, prev / next.
 *  - [x] Row → `${contractBase}/${id}/v2` (exact previous href). Expires-in-N-days / Overdue pill
 *        within 90 days for in-force leases.
 *  - [x] Edit → `${contractBase}/${id}/edit`, hidden once signed, and only with canManageAgreements
 *        in manager mode (now a labelled "Edit" button, not an icon).
 *  - [x] KPI "Active Leases" with the breakdown: the live tenancies still being set up (each linked
 *        via contractHref + surfaceOfLockedAt) and the annual-rent reconciliation gross → setup →
 *        operations → running (was a tooltip, now a Drawer). KPI "In Operations" → Operations.
 *  - [x] Export — previously a button with no handler; now a real CSV of the filtered rows.
 *  - [x] Loading / empty states (now skeleton rows / EmptyRow; failed loads show ErrorRow + retry).
 *  - Removed: the RP-only decorative topbar (crumb + bell + avatar that opened nothing) — the OS shell
 *    now provides the breadcrumb and header.
 *  Added (Genspark): PageHead, ScopeStrip, attention cards, Board / Table Seg, a 6-step new-lease board
 *  and a SEPARATE 4-step renewal board (never merged), "Lease pipeline" + "Renewal branch" cards,
 *  "Renewals & notice" timeline from real end dates / renewal status.
 *
 *  "+ New contract" (the old page had no create button — leases start from a lead or Operations;
 *  the owner asked to keep the button and make it guided). It now opens the "Start a lease"
 *  chooser (_StartLeaseChooser.tsx, kit Modal) instead of jumping straight to contracts/new:
 *    1. From a lead (recommended) — leads at getPrimary() 'convert' (Payment confirmation
 *       collected + unit + customer), GET /api/leads (manager /api/manager/leads?rp=); "Start lease"
 *       → contracts/new?unitId=&tenantId=&leadId=&tenantName=[&startDate=][&chequeCount=] (the leads
 *       page's handleConvert format). Other open leads listed with "Open lead".
 *    2. Existing customer — deriveCustomers() over the contracts this page already loaded
 *       → contracts/new?tenantId=&tenantName= (the Customers page's format).
 *    3. Vacant unit — Units page sources (floor-plans / manager units → per-property units),
 *       occBucket vacant → contracts/new?unitId= (the wizard resolves the property itself).
 *    4. Blank contract → contracts/new.
 *    Manager mode: /dashboard/manager/contracts/new?rp=<rp>&… for every path.
 *  Gate: canManageAgreements (as before) + canCreateContracts in manager mode (the manager
 *  contracts/new route's own gate). `?start=1` opens the chooser on load (removed from the URL on
 *  close). The empty states (no leases at all / empty bucket) offer the same chooser.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useCallback, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { tenantDisplayName } from '@/lib/tenantName';
import { liveLeaseTips, todayKey } from '@/lib/liveLease';
import { contractHref, surfaceOfLockedAt } from '@/lib/contractHref';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { legalApi, breachStageTone, disputeStageTone, type LeaseFlag, type LeaseFlags } from '@/lib/legal';
import { StartLeaseChooser } from './_StartLeaseChooser';
import {
  OsPage, PageHead, ScopeStrip, Card, Cols, Kpis, Kpi, Attn, AttnCard, Pill, Btn, TableWrap, SearchField,
  Seg, Thumb, SkeletonRows, EmptyRow, ErrorRow, Callout, Flow, Timeline, Board, BoardCol, BoardCard, Drawer,
  fmtAed, humanize, type Tone,
} from '@/components/os/kit';

// ────────────────────────────────────────────────────────────────────────────
// Status model (preserved from previous version)
// ────────────────────────────────────────────────────────────────────────────

type ContractStatus = 'active' | 'expired' | 'terminated' | 'pending' | 'issued';
type DisplayStatus = ContractStatus | 'declined' | 'needs_activation' | 'starts_later' | 'superseded' | 'terminating';
type TabKey = 'all' | 'starts_later' | 'expired';

/** Expiring window for the renewal-attention bucket. */
const EXPIRING_DAYS = 90;

const STATUS_LABELS: Record<DisplayStatus, string> = {
  active:           'Active',
  expired:          'Expired',
  terminated:       'Terminated',
  pending:          'Draft',
  issued:           'In Progress',
  declined:         'Declined',
  needs_activation: 'Active',          // running lease not yet flipped in the DB — it IS live
  starts_later:     'Signed ahead',
  superseded:       'Superseded',
  terminating:      'Terminating',
};

// Leases register, as ONE dropdown rather than a tab row — the buckets are a
// single choice and the list grew past what tabs read well at.
//
// Every bucket here obeys the same gate: locked, and NOT in the Operations
// worklist. This page and Operations must never claim the same lease.
//
// Active Leases = one such lease per unit, in force today. Upcoming Renewals =
// same, but signed ahead with the term not yet begun. Expired Leases = ended
// leases (e.g. the prior term of a renewed lease). The fully-ended CUSTOMER
// view lives under Ended Leases.
//
// ⚠️ "Active Leases" here is the SET-UP-COMPLETE subset (93 on RP 2). The
// dashboard tile of the same name counts every live tenancy (107) — it also
// includes the ones still being set up. Same words, two scopes, so the strip
// under the KPIs states both numbers and where the difference sits. Do not
// remove that sentence without renaming one of the two.
//
// There is NO "Expiring < 90d" bucket. It was a slice of the same leases under
// another number, and renewal workload is the Renewals report's job — one place
// to track it, not a count competing with the register's own. Individual rows
// still show their own countdown when a term is close; that is context on a
// lease, not a rival headline.
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',          label: 'Active Leases' },
  { key: 'starts_later', label: 'Starts later' },
  { key: 'expired',      label: 'Expired Leases' },
];

/** Lease type — the New / Renewal split the rows already chip. */
const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: 'all',     label: 'All lease types' },
  { key: 'new',     label: 'New' },
  { key: 'renewal', label: 'Renewal' },
];

/** Today in Dubai (YYYY-MM-DD) — the same "today" the dashboard's lease counts use,
 *  never the browser's local date. */
const TODAY = todayKey();

/** Map the raw DB status to a display status. Synthetic labels on top of the
 *  DB enum (docs/CONTRACT_LIFECYCLE.md §3 + §4.3):
 *    - `declined`         — renewal child where `contractActive=false`
 *    - `superseded`       — new-lease draft archived because the unit was
 *                           leased to a different customer first
 *    - `terminating`      — ACTIVE contract with accepted termination, still
 *                           winding down to its effective date
 *    - `needs_activation` — a `pending` contract whose term is ALREADY RUNNING
 *                           (tenant in place, e.g. imported renewals) — it is
 *                           the live lease in practice, awaiting activation
 *    - `starts_later`     — a `pending` contract whose term has not begun yet
 *                           (a forward renewal / signed-ahead lease)
 *  The old blanket "Renewal Pending" bucket hid this time split and made the
 *  counts unreadable — a running renewal and a future draft are different
 *  things. */
function displayStatusOf(c: Pick<Contract, 'status' | 'contractType' | 'contractActive' | 'termination' | 'startDate' | 'endDate'>): DisplayStatus {
  if (c.contractType === 'renewal' && c.contractActive === false) return 'declined';
  if (
    c.contractType !== 'renewal' &&
    c.contractActive === false &&
    (c.status === 'pending' || c.status === 'issued')
  ) {
    return 'superseded';
  }
  if (c.status === 'active' && c.termination?.response === 'accepted') return 'terminating';
  // A lease can be ACTIVE and still start later: "Mark active" is a deliberate
  // decision the RP has always been able to take ahead of the term, and an
  // imported lease can be locked on arrival. The platform's current-tenancy rule
  // (lib/liveLease, mirroring LIVE_LEASE_TIPS_SQL) says a lease that starts later
  // is NOT current, so such a lease is absent from `liveTenancies` and therefore
  // from Active Leases — and while it still read as plain 'active' here it matched
  // no bucket at all and disappeared from the register entirely. CID-409 (Unit
  // 217, activated 22 Sep 2026 for a 1 Oct term) was on neither Leases nor
  // Operations. It is signed ahead, so it says so.
  if (c.status === 'active' && (c.startDate ?? '').slice(0, 10) > TODAY) return 'starts_later';
  // Time-split forward drafts. Renewal children are promoted pending → issued
  // for signing, so an 'issued' renewal whose term hasn't started is still a
  // forward draft (without this it fell through to the raw 'issued' label and
  // showed in NO tab — the "renewal not visible in contracts" bug).
  if (c.status === 'pending' || (c.status === 'issued' && c.contractType === 'renewal')) {
    const s = (c.startDate ?? '').slice(0, 10);
    const e = (c.endDate ?? '').slice(0, 10);
    if (s && s > TODAY) return 'starts_later';
    if (s && s <= TODAY && e && e >= TODAY) return 'needs_activation';
    // pending with a term already over falls through to the raw 'Draft' label
  }
  return c.status;
}

const PAGE_SIZE = 10;

/** Compact page list: 1 … current-1 current current+1 … last (max 7 chips),
 *  so tabs with many pages (e.g. 200+ expired) don't stretch a full-width row. */
function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

interface Contract {
  id: number;
  ref: string;
  contractType: string | null;
  startDate: string;
  endDate: string;
  annualRent: number;
  status: ContractStatus;
  ejariStatus: string;
  contractActive: boolean;
  /** Cheques confirmed in hand — half of the live-tenancy rule (lib/liveLease). */
  pdcConfirmed?: boolean | null;
  renewalStatus: string | null;
  createdAt: string;
  /** Operations vs Leases split: NULL = still in the Operations worklist;
   *  set = blessed → shows here in the Leases register. */
  lockedAt: string | null;
  /** True once any party has really signed (digital / paper) → terms are locked,
   *  so the Edit pencil is hidden. On-file-only (imported) leases stay editable. */
  signed?: boolean;
  tenant: { id: number | null; name: string | null; email: string | null; entityType: string | null; companyName: string | null };
  unit: { id: number | null; number: string | null; name: string | null; availability?: string | null };
  property: { id: number | null; buildingName: string | null };
  /** Termination snapshot — only present when a request has been raised. */
  termination?: {
    response: 'pending' | 'accepted' | 'rejected' | null;
    effectiveDate: string | null;
  } | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtShort(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: '2-digit' });
}

/** A lease counted as a CURRENT lease: the tenant is in place and the term is
 *  running today — signed-active, winding-down (terminating), or running-but-
 *  not-yet-activated-in-the-DB (needs_activation). All three are live occupancy. */
function isInForce(c: Pick<Contract, 'status' | 'contractType' | 'contractActive' | 'termination' | 'startDate' | 'endDate'>): boolean {
  const ds = displayStatusOf(c);
  return ds === 'active' || ds === 'terminating' || ds === 'needs_activation';
}

/** Does this lease's term end within the expiring window (or has it already
 *  slipped past while still in force)? Used to split current leases into
 *  Active vs Expiring. */
function endsSoon(c: Contract, soonBy: Date): boolean {
  if (!c.endDate) return false;
  return new Date(c.endDate) <= soonBy;
}

function daysTo(iso: string, now: Date): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

function statusLabel(c: Contract): string {
  return STATUS_LABELS[displayStatusOf(c)];
}

function unitLeaseKey(c: Contract): number | string {
  return c.unit.id ?? `c${c.id}`;
}

/**
 * Which of a unit's two candidate leases represents the unit TODAY.
 *
 * IN FORCE WINS FIRST, and that clause is the whole point. Without it this
 * picked the latest-ending lease, so on a unit with a running lease AND a
 * renewal signed ahead the future renewal won the collapse — and because a
 * not-yet-started lease is then dropped from `currentLeases`, the unit vanished
 * from the register entirely, running lease and all. That was 30 units on RP 2:
 * the sidebar badge said 93 leases and the page said 63, and the missing 30 were
 * exactly the units with a signed-ahead renewal. Signed-ahead leases are not
 * lost by this — they have their own "Starts later" bucket, built off the raw
 * list rather than the collapse.
 */
function preferCurrentLease(prev: Contract, next: Contract): Contract {
  const prevInForce = isInForce(prev);
  const nextInForce = isInForce(next);
  if (nextInForce !== prevInForce) return nextInForce ? next : prev;
  const prevLive = displayStatusOf(prev) !== 'needs_activation';
  const nextLive = displayStatusOf(next) !== 'needs_activation';
  if (nextLive && !prevLive) return next;
  if (nextLive === prevLive && (next.endDate ?? '') > (prev.endDate ?? '')) return next;
  return prev;
}

function collapseCurrentLeaseCandidates(list: Contract[]): Contract[] {
  const byUnit = new Map<number | string, Contract>();
  for (const c of list) {
    const key = unitLeaseKey(c);
    const prev = byUnit.get(key);
    if (!prev) { byUnit.set(key, c); continue; }
    byUnit.set(key, preferCurrentLease(prev, c));
  }
  return [...byUnit.values()];
}

function isOrdersAnnualRentCandidate(c: Contract): boolean {
  const ds = displayStatusOf(c);
  return ds !== 'expired' && ds !== 'terminated' && ds !== 'declined' && ds !== 'superseded';
}

function sumAnnualRent(list: Contract[]): number {
  return list.reduce((sum, c) => sum + (c.annualRent || 0), 0);
}

function leaseWord(n: number): string {
  return `${n} lease${n === 1 ? '' : 's'}`;
}

/** Why a live tenancy is not in the register — the label shown against each row
 *  in the "still being set up" list. Most specific reason first. */
function setupReasonOf(c: Contract, opsIds: Set<number>): string {
  const ds = displayStatusOf(c);
  if (ds === 'terminating')      return 'Winding down';
  if (ds === 'needs_activation') return 'Needs activation';
  if (ds === 'starts_later')     return 'Signed ahead';
  if (c.lockedAt == null)        return 'Not locked yet';
  if (opsIds.has(c.id))          return 'In Operations';
  return STATUS_LABELS[ds] ?? 'In setup';
}

/** Annual-rent reconciliation shown in the tooltip: the gross candidate set, what
 *  each exclusion removes, and the running total that survives. The type was
 *  referenced but never declared — a long-standing compile error in this file. */
type RentBreakdownLine = { count: number; amount: number };
type RentBreakdown = {
  gross: RentBreakdownLine;
  setup: RentBreakdownLine;
  operations: RentBreakdownLine;
  running: RentBreakdownLine;
};

// ────────────────────────────────────────────────────────────────────────────
// Pipeline model (board). Two branches, NEVER merged (AGENTS.md):
//   New lease (6):  Contract issued → Payment collection → Signatures → Ejari registration
//                   → Move-in & DEWA → Active tenancy
//   Renewal (4):    Terms agreed → Signatures → Ejari renewal → Active renewal
// A lease sits in its first incomplete step, read from the Operations checklist
// (the same checklist keys OperationsPipelines uses). Leases in the register have
// finished setup, so they sit in the last column of their branch.
// ────────────────────────────────────────────────────────────────────────────

/** The Operations worklist row — only the fields this page reads. */
interface OpsRow {
  id: number;
  contractType: string | null;
  lockedAt: string | null;
  contractSent?: boolean;
  windDown?: boolean;
  terminationRequested?: boolean;
  checklist?: { key: string; done: boolean }[];
}

type Branch = 'new' | 'renewal';

const NEW_STEPS: { t: string; keys: string[] }[] = [
  { t: 'Contract issued',    keys: [] },
  { t: 'Payment collection', keys: ['kyc', 'payment_plan', 'pdc'] },
  { t: 'Signatures',         keys: ['sign_tenant', 'sign_landlord'] },
  { t: 'Ejari registration', keys: ['ejari'] },
  { t: 'Move-in & DEWA',     keys: ['utility', 'move_in'] },
  { t: 'Active tenancy',     keys: [] },
];
const RENEWAL_STEPS: { t: string; keys: string[] }[] = [
  { t: 'Terms agreed',   keys: ['renewal_draft', 'renewal_notice', 'kyc', 'payment_plan', 'pdc'] },
  { t: 'Signatures',     keys: ['sign_tenant', 'sign_landlord'] },
  { t: 'Ejari renewal',  keys: ['ejari'] },
  { t: 'Active renewal', keys: [] },
];

const NEW_STEP_HINT = [
  'Lease drafted and sent to the customer',
  'Cheques / payment plan collected',
  'Customer and landlord sign',
  'Contract registered with Ejari',
  'Utility account opened and keys handed over',
  'Lease is live and in this register',
];
const RENEWAL_STEP_HINT = [
  'Renewal offered and accepted, cheques agreed',
  'Both parties sign the renewal',
  'Ejari renewed for the new term',
  'Renewal term is live',
];

/** Step index for a lease still in the Operations worklist. */
function opsStepOf(o: OpsRow, branch: Branch): number {
  const list = o.checklist ?? [];
  const blocked = (keys: string[]) => keys.length > 0 && list.some(i => keys.includes(i.key) && !i.done);
  const steps = branch === 'renewal' ? RENEWAL_STEPS : NEW_STEPS;
  if (branch === 'new' && o.contractSent === false) return 0;
  for (let i = 0; i < steps.length; i++) if (blocked(steps[i].keys)) return i;
  return steps.length - 1;
}

const branchOf = (c: { contractType: string | null }): Branch => (c.contractType === 'renewal' ? 'renewal' : 'new');

const DS_TONE: Record<DisplayStatus, Tone> = {
  active: 'primary', needs_activation: 'primary', terminating: 'amber', starts_later: 'info', issued: 'info',
  pending: 'neutral', expired: 'neutral', terminated: 'neutral', declined: 'danger', superseded: 'neutral',
};

type SortKey = 'end_asc' | 'end_desc' | 'rent_desc' | 'rent_asc' | 'ref';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'end_asc',   label: 'Ending soonest' },
  { key: 'end_desc',  label: 'Ending latest' },
  { key: 'rent_desc', label: 'Rent: high to low' },
  { key: 'rent_asc',  label: 'Rent: low to high' },
  { key: 'ref',       label: 'Reference' },
];

/** Max cards drawn per board column; the rest are one click away in the table. */
const BOARD_CAP = 25;

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadLeasesCsv(list: Contract[], bucket: string) {
  const head = ['Reference', 'Lease type', 'Customer', 'Email', 'Unit', 'Building', 'Start', 'End', 'Annual rent (AED)', 'Status'];
  const lines = list.map(c => [
    c.ref, c.contractType === 'renewal' ? 'Renewal' : 'New', tenantDisplayName(c.tenant), c.tenant.email,
    c.unit.number ?? c.unit.name, c.property.buildingName, (c.startDate ?? '').slice(0, 10), (c.endDate ?? '').slice(0, 10),
    c.annualRent ?? 0, statusLabel(c),
  ].map(csvCell).join(','));
  const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leases-${bucket}-${TODAY}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────────────────────
// Legal & breach pills (spec §2.5 / §7.5) — two INDEPENDENT pills; each routes on its own.
// ────────────────────────────────────────────────────────────────────────────

function LegalPills({ flag, href, disputeHref }: { flag?: LeaseFlag | null; href: string; disputeHref: (id: number) => string }) {
  const router = useRouter();
  if (!flag?.breach && !flag?.dispute) return null;
  const pill = (bg: string, fg: string, label: string, title: string, to: string) => (
    <button
      type="button" className="gx-pill dot" title={title}
      style={{ background: bg, color: fg, border: 0, cursor: 'pointer', marginRight: 4, marginTop: 4 }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(to); }}
    >
      {label}
    </button>
  );
  return (
    <span style={{ display: 'block' }}>
      {flag.breach && pill(breachStageTone(flag.breach.stage).bg, breachStageTone(flag.breach.stage).fg,
        `Breach · ${flag.breach.label}`, 'Open the breach on the lease page', `${href}#sec-breaches`)}
      {flag.dispute && pill(disputeStageTone(flag.dispute.stage).bg, disputeStageTone(flag.dispute.stage).fg,
        `Legal · ${flag.dispute.label}`, 'Open the legal case', disputeHref(flag.dispute.id))}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────

export function OrdersWorkspace({ manager }: { manager?: { rp: number } }) {
  // The row Edit needs canManageAgreements on the acting landlord in manager mode;
  // the RP (no `manager` prop) owns their own contracts, so it is always allowed.
  const { canForRp } = useManagerPermissions();
  const canEditTerms = !manager || canForRp('canManageAgreements', manager.rp);
  // Starting a lease: same gate as before (canManageAgreements), plus the manager
  // contracts/new route's own gate (canCreateContracts) so the button never leads
  // to a "permission required" screen.
  const canStartLease = !manager || (canEditTerms && canForRp('canCreateContracts', manager.rp));
  // Base route for detail/edit/new links + the API source. In manager mode the
  // page reuses the landlord-scoped /manager/contracts endpoints and links into
  // the manager portal, mirroring UnitsWorkspace.
  const contractBase = manager ? '/dashboard/manager/contracts' : '/rental-provider/dashboard/contracts';
  const opsHref = manager ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations';
  const legalListHref = manager ? `/dashboard/manager/legal?rp=${manager.rp}` : '/rental-provider/dashboard/legal';
  // "Start a lease" chooser — "+ New contract", the empty states, and ?start=1 open it.
  const [startOpen, setStartOpen] = useState(false);
  useEffect(() => {
    // Deep link (?start=1) — read once from the URL (no Suspense boundary needed).
    if (!canStartLease || typeof window === 'undefined') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get('start') === '1') setStartOpen(true);
  }, [canStartLease]);
  const closeStart = useCallback(() => {
    setStartOpen(false);
    // Drop ?start=1 so a refresh or Back does not reopen the chooser.
    const url = new URL(window.location.href);
    if (url.searchParams.has('start')) {
      url.searchParams.delete('start');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  }, []);
  const [contracts, setContracts] = useState<Contract[]>([]);
  // The Operations worklist (drafts + active-but-incomplete). The register is the
  // EXACT COMPLEMENT: a lease shows here only once it has left Operations.
  const [opsRows, setOpsRows] = useState<OpsRow[]>([]);
  const opsIds = useMemo(() => new Set(opsRows.map(o => o.id)), [opsRows]);
  const [leaseFlags, setLeaseFlags] = useState<LeaseFlags>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [filterAsset, setFilterAsset] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('end_asc');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  // Page resets to 1 whenever the bucket, filters or sort change (keyed, no effect).
  const pageKey = [activeTab, search, filterAsset, filterType, sortKey].join('|');
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: pageKey, page: 1 });
  const page = pageState.key === pageKey ? pageState.page : 1;
  const setPage = (next: number | ((p: number) => number)) =>
    setPageState({ key: pageKey, page: typeof next === 'function' ? next(page) : next });
  const [view, setView] = useState<'board' | 'table'>('board');
  const [boardBranch, setBoardBranch] = useState<Branch>('new');
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const router = useRouter();

  const load = useCallback(() => {
    const q = manager ? `?rp=${manager.rp}` : '';
    Promise.all([
      fetch(`/api/${manager ? 'manager/contracts' : 'contracts'}${q}`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch(`/api/${manager ? 'manager/contracts/operations' : 'contracts/operations'}${q}`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ])
      .then(([list, ops]) => {
        if (Array.isArray(list)) setContracts(list); else setLoadError(true);
        if (Array.isArray(ops)) setOpsRows(ops);
      })
      .finally(() => setLoading(false));
  }, [manager]);
  useEffect(() => { load(); }, [load]);
  const retry = () => { setLoading(true); setLoadError(false); load(); };

  useEffect(() => {
    if (!contracts.length) return;
    let cancelled = false;
    const ids = contracts.map(c => c.id);
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
    Promise.all(chunks.map(chunk => legalApi.leaseFlags(manager ? '/manager/legal' : '/legal', manager?.rp, chunk).catch(() => ({} as LeaseFlags))))
      .then(parts => { if (!cancelled) setLeaseFlags(Object.assign({}, ...parts)); });
    return () => { cancelled = true; };
  }, [contracts, manager]);
  const disputeHref = (disputeId: number) =>
    manager ? `/dashboard/manager/legal/${disputeId}?rp=${manager.rp}` : `/rental-provider/dashboard/legal/${disputeId}`;

  const now = useMemo(() => new Date(), []);
  const soonBy = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + EXPIRING_DAYS); return d; }, []);

  const assets = useMemo(
    () => [...new Set(contracts.map(c => c.property.buildingName).filter((s): s is string => Boolean(s)))],
    [contracts],
  );

  // The register shows every year (the old year picker was removed on purpose).
  const yearScoped = contracts;

  // ── CURRENT LEASES = one in-force lease per unit (collapse per unit). ──
  const grossLeaseCandidates = useMemo(
    () => collapseCurrentLeaseCandidates(yearScoped.filter(c => isOrdersAnnualRentCandidate(c))),
    [yearScoped],
  );
  const setupExcludedLeases = useMemo(
    () => grossLeaseCandidates.filter(c => {
      const ds = displayStatusOf(c);
      return c.lockedAt == null || ds === 'needs_activation' || ds === 'pending';
    }),
    [grossLeaseCandidates],
  );
  const operationsExcludedLeases = useMemo(
    () => grossLeaseCandidates.filter(c =>
      c.lockedAt != null &&
      displayStatusOf(c) !== 'needs_activation' &&
      (displayStatusOf(c) === 'terminating' || opsIds.has(c.id))),
    [grossLeaseCandidates, opsIds],
  );

  // Reconciliation with the dashboard's "Active Leases" (live tenancies, lib/liveLease).
  const liveTenancies = useMemo(
    () => liveLeaseTips(contracts, c => ({
      id: c.id,
      unitId: c.unit.id,
      contractType: c.contractType,
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
      contractActive: c.contractActive,
      pdcConfirmed: c.pdcConfirmed,
      terminationResponse: c.termination?.response ?? null,
      terminationEffectiveDate: c.termination?.effectiveDate ?? null,
    })),
    [contracts],
  );
  const liveUnitKeys = useMemo(() => new Set(liveTenancies.map(unitLeaseKey)), [liveTenancies]);

  const currentLeases = useMemo(
    () => grossLeaseCandidates.filter(c =>
      liveUnitKeys.has(unitLeaseKey(c)) &&
      c.lockedAt != null &&
      displayStatusOf(c) !== 'needs_activation' &&
      displayStatusOf(c) !== 'terminating' &&
      !opsIds.has(c.id)),
    [grossLeaseCandidates, opsIds, liveUnitKeys],
  );

  // Signed ahead, term not begun, and already set up (not in Operations).
  const startsLaterLeases = useMemo(
    () => yearScoped.filter(c => displayStatusOf(c) === 'starts_later' && !opsIds.has(c.id)),
    [yearScoped, opsIds],
  );

  // Live tenancies this register does NOT list, partitioned by UNIT, with the reason.
  const currentUnitKeys = useMemo(() => new Set(currentLeases.map(unitLeaseKey)), [currentLeases]);
  const pendingSetupLeases = useMemo(
    () => liveTenancies
      .filter(c => !currentUnitKeys.has(unitLeaseKey(c)))
      .map(c => ({ c, reason: setupReasonOf(c, opsIds) }))
      .sort((a, b) => (a.c.property.buildingName ?? '').localeCompare(b.c.property.buildingName ?? '')
        || (a.c.unit.number ?? '').localeCompare(b.c.unit.number ?? '')),
    [liveTenancies, currentUnitKeys, opsIds],
  );
  const elsewhereCount = pendingSetupLeases.length;
  const expiredLeases = useMemo(() => yearScoped.filter(c => displayStatusOf(c) === 'expired'), [yearScoped]);

  const tabCounts = useMemo<Record<TabKey, number>>(() => ({
    all: currentLeases.length,
    starts_later: startsLaterLeases.length,
    expired: expiredLeases.length,
  }), [currentLeases, startsLaterLeases, expiredLeases]);

  const baseList = useMemo(() => {
    switch (activeTab) {
      case 'starts_later': return startsLaterLeases;
      case 'expired':      return expiredLeases;
      default:             return currentLeases;
    }
  }, [activeTab, currentLeases, startsLaterLeases, expiredLeases]);

  /** Search + property filter — shared by the table and the board. */
  const matchesSearchAndAsset = useCallback((c: Contract) => {
    if (filterAsset !== 'all' && c.property.buildingName !== filterAsset) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = [c.ref, c.tenant.name, c.tenant.companyName, c.tenant.email, c.unit.number, c.property.buildingName]
        .filter((s): s is string => Boolean(s)).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }, [filterAsset, search]);

  const filtered = useMemo(() => {
    const list = baseList.filter(c => {
      if (!matchesSearchAndAsset(c)) return false;
      // A renewal child carries contractType 'renewal'; everything else (incl. imported
      // originals with a null type) reads as New — same rule as the row chip.
      if (filterType !== 'all') {
        const isRenewal = c.contractType === 'renewal';
        if (filterType === 'renewal' ? !isRenewal : isRenewal) return false;
      }
      return true;
    });
    const sorted = [...list];
    switch (sortKey) {
      case 'end_desc':  sorted.sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? '')); break;
      case 'rent_desc': sorted.sort((a, b) => (b.annualRent || 0) - (a.annualRent || 0)); break;
      case 'rent_asc':  sorted.sort((a, b) => (a.annualRent || 0) - (b.annualRent || 0)); break;
      case 'ref':       sorted.sort((a, b) => (a.ref ?? '').localeCompare(b.ref ?? '', undefined, { numeric: true })); break;
      default:          sorted.sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? '')); // renewal urgency
    }
    return sorted;
  }, [baseList, matchesSearchAndAsset, filterType, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const runningRent = useMemo(() => currentLeases.reduce((s, c) => s + (c.annualRent || 0), 0), [currentLeases]);
  const rentBreakdown = useMemo<RentBreakdown>(() => ({
    gross: { count: grossLeaseCandidates.length, amount: sumAnnualRent(grossLeaseCandidates) },
    setup: { count: setupExcludedLeases.length, amount: sumAnnualRent(setupExcludedLeases) },
    operations: { count: operationsExcludedLeases.length, amount: sumAnnualRent(operationsExcludedLeases) },
    running: { count: currentLeases.length, amount: runningRent },
  }), [grossLeaseCandidates, setupExcludedLeases, operationsExcludedLeases, currentLeases, runningRent]);

  const hasFilters = filterAsset !== 'all' || filterType !== 'all' || search !== '';
  const resetFilters = () => { setFilterAsset('all'); setFilterType('all'); setSearch(''); };

  // ── Board: every lease that is in setup (Operations) or in the register today. ──
  const byId = useMemo(() => new Map(contracts.map(c => [c.id, c])), [contracts]);
  const board = useMemo(() => {
    const cols: Record<Branch, { c: Contract; href: string; tag: ReactNode }[][]> = {
      new: NEW_STEPS.map(() => []),
      renewal: RENEWAL_STEPS.map(() => []),
    };
    for (const o of opsRows) {
      const c = byId.get(o.id);
      if (!c || !matchesSearchAndAsset(c)) continue;
      const br = branchOf(o);
      const href = contractHref(c.id, surfaceOfLockedAt(o.lockedAt ?? c.lockedAt), manager);
      // Termination wind-downs are live tenancies on their way out — they sit at the end.
      if (o.windDown || o.terminationRequested) {
        cols[br][cols[br].length - 1].push({ c, href, tag: <Pill tone="amber">{o.windDown ? 'Winding down' : 'Termination requested'}</Pill> });
        continue;
      }
      cols[br][opsStepOf(o, br)].push({ c, href, tag: <Pill tone="info">In Operations</Pill> });
    }
    for (const c of currentLeases) {
      if (!matchesSearchAndAsset(c)) continue;
      const br = branchOf(c);
      cols[br][cols[br].length - 1].push({ c, href: `${contractBase}/${c.id}/v2`, tag: <Pill tone="primary">{statusLabel(c)}</Pill> });
    }
    for (const c of startsLaterLeases) {
      if (!matchesSearchAndAsset(c)) continue;
      const br = branchOf(c);
      cols[br][cols[br].length - 1].push({ c, href: `${contractBase}/${c.id}/v2`, tag: <Pill tone="info">Starts {fmtShort(c.startDate)}</Pill> });
    }
    return cols;
  }, [opsRows, byId, currentLeases, startsLaterLeases, matchesSearchAndAsset, manager, contractBase]);
  const newCounts = board.new.map(col => col.length);
  const renewalCounts = board.renewal.map(col => col.length);

  // ── Renewals & notice: current leases ending within the expiring window. ──
  const renewalUnits = useMemo(() => {
    const s = new Set<number | string>();
    for (const c of startsLaterLeases) if (c.contractType === 'renewal') s.add(unitLeaseKey(c));
    for (const o of opsRows) {
      const c = byId.get(o.id);
      if (c && c.contractType === 'renewal') s.add(unitLeaseKey(c));
    }
    return s;
  }, [startsLaterLeases, opsRows, byId]);
  const endingSoon = useMemo(
    () => currentLeases.filter(c => endsSoon(c, soonBy)).sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? '')),
    [currentLeases, soonBy],
  );

  const flaggedCount = useMemo(
    () => Object.values(leaseFlags).filter(f => f && (f.breach || f.dispute)).length,
    [leaseFlags],
  );

  const BUCKET_LABEL: Record<TabKey, string> = { all: 'active', starts_later: 'starts-later', expired: 'expired' };

  return (
    <OsPage>
      <PageHead
        eyebrow="Operations › Long-term leases"
        title="Leases"
        lede="Every long-term lease, from contract issue to an active tenancy. The board follows each lease through its pipeline; the table is the register of leases that are fully set up."
        actions={<>
          <Btn onClick={() => downloadLeasesCsv(filtered, BUCKET_LABEL[activeTab])} disabled={loading || filtered.length === 0}
            title="Download the leases in the table (current bucket and filters) as CSV">
            Export CSV
          </Btn>
          {canStartLease && <Btn variant="primary" onClick={() => setStartOpen(true)} title="Start a lease from a lead, a customer, a vacant unit or a blank contract">+ New contract</Btn>}
        </>}
      />

      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Spaces · Long-term leases' },
        { label: 'Data', value: <Pill tone="primary">Live</Pill> },
      ]} />

      {!loading && (elsewhereCount > 0 || flaggedCount > 0) && (
        <Attn>
          {elsewhereCount > 0 && (
            <AttnCard tone="warn" n={elsewhereCount} t="Live tenancies still being set up" s="Finish them in Operations" href={opsHref} />
          )}
          {flaggedCount > 0 && (
            <AttnCard tone="bad" n={flaggedCount} t="Leases with a breach or legal case" s="Open Legal" href={legalListHref} />
          )}
        </Attn>
      )}

      <Kpis>
        <Kpi
          k="Active leases"
          v={loading ? '…' : currentLeases.length}
          d={<button type="button" className="gx-btn xs ghost" onClick={() => setBreakdownOpen(true)} disabled={loading}>See breakdown</button>}
        />
        <Kpi k="In Operations" v={loading ? '…' : elsewhereCount} d="Live tenancies still in setup" href={opsHref} />
        <Kpi k="Running rent / yr" v={loading ? '…' : fmtAed(runningRent)} d="Across active leases" dark />
        <Kpi k="Starts later" v={loading ? '…' : startsLaterLeases.length} d="Signed ahead, term not begun" />
        <Kpi k="Expired leases" v={loading ? '…' : expiredLeases.length} d="Ended terms (history)" />
      </Kpis>

      {loadError && (
        <Callout tone="bad" title="Couldn't load your leases.">
          <Btn size="sm" onClick={retry}>Try again</Btn>
        </Callout>
      )}

      {!loading && !loadError && contracts.length === 0 && (
        <Callout tone="info" title="No leases yet.">
          Leases usually start from a lead once its payment is approved; you can also start one for a customer, a vacant unit or from a blank contract.
          {canStartLease && <div style={{ marginTop: 8 }}><Btn size="sm" variant="primary" onClick={() => setStartOpen(true)}>Start a lease</Btn></div>}
        </Callout>
      )}

      {/* Toolbar shared by both views */}
      <div className="gx-tbar" style={{ padding: '0 0 12px', borderBottom: 0 }}>
        <Seg label="View" value={view} onChange={setView} options={[{ v: 'board', l: 'Board' }, { v: 'table', l: 'Table' }]} />
        <SearchField value={search} onChange={setSearch} placeholder="Search ref, customer, unit or email…" />
        <select className="gx-sel" value={filterAsset} onChange={e => setFilterAsset(e.target.value)} aria-label="Filter by property">
          <option value="all">All properties</option>
          {assets.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {view === 'table' && (
          <select className="gx-sel" value={filterType} onChange={e => setFilterType(e.target.value)} aria-label="Filter by lease type">
            {TYPE_FILTERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        )}
        {hasFilters && <Btn size="sm" variant="ghost" onClick={resetFilters}>Reset filters</Btn>}
      </div>

      {view === 'board' ? (
        <Card
          title={boardBranch === 'new' ? 'New-lease pipeline' : 'Renewal pipeline'}
          sub={boardBranch === 'new'
            ? 'Six steps. Cards in steps 1–5 are worked in Operations; Active tenancy holds the register.'
            : 'Four steps, kept separate from new leases. Same customer, no re-handover.'}
          right={<Seg label="Pipeline" value={boardBranch} onChange={setBoardBranch} options={[
            { v: 'new', l: 'New leases', n: newCounts.reduce((a, b) => a + b, 0) },
            { v: 'renewal', l: 'Renewals', n: renewalCounts.reduce((a, b) => a + b, 0) },
          ]} />}
          pad
        >
          {loading ? (
            <div className="gx-skel" style={{ height: 160 }} aria-busy="true" />
          ) : (
            <Board>
              {(boardBranch === 'new' ? NEW_STEPS : RENEWAL_STEPS).map((step, i) => {
                const col = board[boardBranch][i];
                return (
                  <BoardCol key={step.t} title={`${i + 1}. ${step.t}`} count={col.length}>
                    {col.slice(0, BOARD_CAP).map(({ c, href, tag }) => (
                      <BoardCard
                        key={c.id}
                        href={href}
                        t={<>{c.unit.number ? `Unit ${c.unit.number}` : (c.unit.name ?? c.ref)} · {c.property.buildingName ?? '—'}</>}
                        m={<>{tenantDisplayName(c.tenant) ?? '—'} · {c.ref}</>}
                        amt={fmtAed(c.annualRent)}
                        tag={tag}
                      />
                    ))}
                    {col.length > BOARD_CAP && (
                      <Btn size="xs" variant="ghost" onClick={() => setView('table')}>
                        {col.length - BOARD_CAP} more — open the table
                      </Btn>
                    )}
                  </BoardCol>
                );
              })}
            </Board>
          )}
        </Card>
      ) : (
        <TableWrap toolbar={<>
          <Seg label="Lease bucket" value={activeTab} onChange={setActiveTab}
            options={TABS.map(t => ({ v: t.key, l: t.label, n: tabCounts[t.key] ?? 0 }))} />
          <span className="sp" />
          <label className="gx-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
            Sort
            <select className="gx-sel" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} aria-label="Sort leases">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>{filtered.length} of {baseList.length}</span>
        </>}>
          <table className="gx-tbl">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Property</th>
                <th>Term</th>
                <th className="num">Annual rent</th>
                <th>Status</th>
                <th className="act">Actions</th>
              </tr>
            </thead>
            {loading ? <SkeletonRows rows={6} cols={6} /> : loadError ? <ErrorRow cols={6} onRetry={retry} /> : filtered.length === 0 ? (
              hasFilters ? (
                <EmptyRow cols={6} title="No leases match" text=" Clear your search or filters, or pick another bucket." />
              ) : (
                <tbody><tr><td colSpan={6}><div className="gx-empty">
                  <b>No leases in this bucket</b>
                  Leases appear here once their setup is complete in Operations.
                  {canStartLease && <div style={{ marginTop: 8 }}><Btn size="sm" variant="primary" onClick={() => setStartOpen(true)}>Start a lease</Btn></div>}
                </div></td></tr></tbody>
              )
            ) : (
              <tbody>
                {rows.map(c => {
                  const ds = displayStatusOf(c);
                  const soon = isInForce(c) && endsSoon(c, soonBy);
                  const d = soon ? daysTo(c.endDate, now) : null;
                  const isRenewal = c.contractType === 'renewal';
                  const href = `${contractBase}/${c.id}/v2`;
                  const name = tenantDisplayName(c.tenant);
                  return (
                    <tr key={c.id} className="click" onClick={() => router.push(href)}>
                      <td>
                        <div className="gx-cell">
                          <Thumb text={name ?? c.ref} />
                          <span>
                            <span className="strong">{c.ref}</span>{' '}
                            <Pill tone={isRenewal ? 'amber' : 'outline'} dot={false}>{isRenewal ? 'Renewal' : 'New'}</Pill>
                            <span className="sub">{name ?? '—'}</span>
                            <LegalPills flag={leaseFlags[String(c.id)]} href={href} disputeHref={disputeHref} />
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="strong">{c.unit.number ? `Unit ${c.unit.number}` : '—'}</span>
                        <span className="sub">{c.property.buildingName ?? '—'}</span>
                      </td>
                      <td className="nowrap">
                        {fmtShort(c.startDate)} – {fmtShort(c.endDate)}
                        <span className="sub">
                          {soon
                            ? <Pill tone={d !== null && d < 0 ? 'danger' : 'amber'}>{d !== null && d < 0 ? 'Overdue' : `Expires ${d}d`}</Pill>
                            : <>Ends {fmtDate(c.endDate)}</>}
                        </span>
                      </td>
                      <td className="num strong">{fmtAed(c.annualRent)}<span className="sub">per year</span></td>
                      <td><Pill tone={DS_TONE[ds]}>{statusLabel(c)}</Pill></td>
                      <td className="act" onClick={e => e.stopPropagation()}>
                        <span className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
                          {/* Edit terms — hidden once signed by any party (the backend rejects it too). */}
                          {!c.signed && canEditTerms && <Btn size="xs" href={`${contractBase}/${c.id}/edit`}>Edit</Btn>}
                          <Btn size="xs" variant="primary" href={href}>Open</Btn>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
          {!loading && totalPages > 1 && (
            <div className="gx-tbar" style={{ borderTop: '1px solid var(--ms-surface-3)', borderBottom: 0 }}>
              <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <span className="sp" />
              <Btn size="xs" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>Previous</Btn>
              {pageWindow(safePage, totalPages).map((p, i) =>
                p === '…'
                  ? <span key={`gap${i}`} aria-hidden="true">…</span>
                  : <Btn key={p} size="xs" variant={p === safePage ? 'primary' : undefined} onClick={() => setPage(p)}>{p}</Btn>,
              )}
              <Btn size="xs" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next</Btn>
            </div>
          )}
        </TableWrap>
      )}

      <div style={{ height: 14 }} />

      <Cols kind="2">
        <Card title="Lease pipeline" sub="New leases · 6 steps · counts from the board above" pad>
          <Flow steps={NEW_STEPS.map((s, i) => ({ t: s.t, s: loading ? NEW_STEP_HINT[i] : `${newCounts[i]} · ${NEW_STEP_HINT[i]}` }))} />
        </Card>
        <Card title="Renewal branch" sub="Renewals · 4 steps · a separate pipeline, never merged with new leases" pad>
          <Flow steps={RENEWAL_STEPS.map((s, i) => ({ t: s.t, s: loading ? RENEWAL_STEP_HINT[i] : `${renewalCounts[i]} · ${RENEWAL_STEP_HINT[i]}` }))} />
        </Card>
      </Cols>

      <Card title="Renewals & notice" sub={`Active leases ending within ${EXPIRING_DAYS} days, soonest first`} pad>
        {loading ? (
          <div className="gx-skel" style={{ height: 80 }} aria-busy="true" />
        ) : endingSoon.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ms-ink-3)' }}>No active lease ends in the next {EXPIRING_DAYS} days.</p>
        ) : (
          <>
            <Timeline items={endingSoon.slice(0, 8).map(c => {
              const d = daysTo(c.endDate, now);
              const hasRenewal = renewalUnits.has(unitLeaseKey(c));
              return {
                state: d < 0 || d <= 30 ? 'bad' as const : 'now' as const,
                mark: d < 0 ? '!' : `${d}d`,
                t: <Link href={`${contractBase}/${c.id}/v2`}>
                  {c.unit.number ? `Unit ${c.unit.number}` : (c.unit.name ?? c.ref)} · {c.property.buildingName ?? '—'} — {tenantDisplayName(c.tenant) ?? '—'}
                </Link>,
                s: <>
                  {d < 0 ? `Term ended ${fmtDate(c.endDate)}` : `Ends ${fmtDate(c.endDate)} · ${d} days`}
                  {' · '}
                  {hasRenewal
                    ? <Pill tone="primary">Renewal under way</Pill>
                    : c.renewalStatus
                      ? <Pill tone="amber">Renewal {humanize(c.renewalStatus).toLowerCase()}</Pill>
                      : <Pill tone="neutral">No renewal yet</Pill>}
                </>,
              };
            })} />
            {endingSoon.length > 8 && (
              <div style={{ marginTop: 8 }}>
                <Btn size="sm" variant="ghost" onClick={() => { setView('table'); setActiveTab('all'); setSortKey('end_asc'); }}>
                  {endingSoon.length - 8} more — open the table
                </Btn>
              </div>
            )}
          </>
        )}
      </Card>

      {canStartLease && (
        <StartLeaseChooser
          open={startOpen}
          onClose={closeStart}
          manager={manager}
          contracts={contracts}
          contractsLoading={loading}
          contractsError={loadError}
          onRetryContracts={retry}
        />
      )}

      <Drawer
        open={breakdownOpen}
        onClose={() => setBreakdownOpen(false)}
        title="Active leases — breakdown"
        sub="Why this register can differ from the dashboard's Active Leases figure"
        footer={<>
          <Btn href={opsHref}>Open Operations</Btn>
          <Btn variant="primary" onClick={() => setBreakdownOpen(false)}>Done</Btn>
        </>}
      >
        {pendingSetupLeases.length > 0 && (
          <Card title="Still being set up" sub={leaseWord(pendingSetupLeases.length)}>
            <table className="gx-tbl">
              <thead><tr><th>Unit</th><th>Reason</th><th className="act">Open</th></tr></thead>
              <tbody>
                {pendingSetupLeases.map(({ c, reason }) => {
                  // These ARE the still-being-set-up leases, so most live in Operations.
                  const to = contractHref(c.id, surfaceOfLockedAt(c.lockedAt), manager);
                  return (
                    <tr key={c.id}>
                      <td><span className="strong">{c.unit.number ? `Unit ${c.unit.number}` : c.unit.name ?? c.ref}</span><span className="sub">{c.property.buildingName ?? '—'}</span></td>
                      <td><Pill tone="amber">{reason}</Pill></td>
                      <td className="act"><Btn size="xs" href={to}>Open</Btn></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <div style={{ height: 12 }} />
        <Card title="Annual rent reconciliation">
          <table className="gx-tbl">
            <tbody>
              <tr><td className="strong">Annual rent (all candidate leases)</td><td className="num">{leaseWord(rentBreakdown.gross.count)}</td><td className="num strong">{fmtAed(rentBreakdown.gross.amount)}</td></tr>
              <tr><td>− still in setup / unlocked / lapsed / unactivated pending</td><td className="num">{leaseWord(rentBreakdown.setup.count)}</td><td className="num">{fmtAed(rentBreakdown.setup.amount)}</td></tr>
              <tr><td>− in Operations worklist / winding down / move-out</td><td className="num">{leaseWord(rentBreakdown.operations.count)}</td><td className="num">{fmtAed(rentBreakdown.operations.amount)}</td></tr>
              <tr><td className="strong">= Running rent / yr</td><td className="num">{leaseWord(rentBreakdown.running.count)}</td><td className="num strong">{fmtAed(rentBreakdown.running.amount)}</td></tr>
            </tbody>
          </table>
        </Card>
      </Drawer>
    </OsPage>
  );
}

/** RP route entry point — the landlord's own Leases register. */
export default function OrdersPage() {
  return <OrdersWorkspace />;
}
