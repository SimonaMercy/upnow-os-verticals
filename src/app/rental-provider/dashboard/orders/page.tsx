/**
 * RP Contracts ("Orders") list page — LEASE-CENTRIC, today-anchored.
 *
 * The headline is the CURRENT PORTFOLIO, not a raw row count. The backend
 * (GET /contracts → listForRp) returns every contract row for the landlord —
 * including the old + new rows of each renewal and every expired prior cycle —
 * so a raw count double/triple-counts a unit. We collapse to ONE in-force lease
 * per unit (`currentLeases`) for the headline, exactly mirroring the tenant-360
 * collapse (contracts.service.ts getTenantDetail).
 *
 * Four buckets only:
 *   - All       — current leases (one in-force lease per unit) = the "Total".
 *   - Starts later — signed ahead, term not begun.
 *   - Expired      — ended/terminated history.
 *
 * Renewal workload is NOT a bucket here — it belongs to the Renewals report.
 *
 * "In force" folds three DB realities into live occupancy: status=active,
 * winding-down (accepted termination, `terminating`), and running-but-not-yet-
 * activated imported leases (status=pending with the term already running,
 * `needs_activation`) — the latter are live in practice, so they count as Active.
 *
 * The year picker scopes the WHOLE page (a lease counts for a year if its term
 * overlaps it). The Total no longer inflates with the year because it's deduped
 * per unit — the old 169 was a raw row count. Rows link to the v2 detail page.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search, X, FileText, ChevronLeft, ChevronRight,
  Bell, Download, Shield, Coins, Pencil, Info, ClipboardList, Archive, CalendarClock,
} from 'lucide-react';
import { tenantDisplayName } from '@/lib/tenantName';
import { liveLeaseTips, todayKey } from '@/lib/liveLease';
import { contractHref, surfaceOfLockedAt } from '@/lib/contractHref';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { legalApi, breachStageTone, disputeStageTone, type LeaseFlag, type LeaseFlags } from '@/lib/legal';

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

function fmtAedAmt(n: number): string {
  return n.toLocaleString('en-AE');
}

function initials(name: string | null): string {
  if (!name) return '—';
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
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

/**
 * The info icon on "Fully set up". Opens the LIST of live tenancies this
 * register is holding back, one row per unit with the reason and a link into
 * the lease, followed by the annual-rent reconciliation. A count on its own
 * ("14 elsewhere") is not checkable; a list of units is.
 */
function RentBreakdownTip({ breakdown, pending, manager, opsHref }: {
  breakdown: RentBreakdown;
  pending: { c: Contract; reason: string }[];
  manager?: { rp: number };
  opsHref: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="rent-tip">
      <button
        type="button"
        aria-label="Show the leases still being set up, and the annual rent breakdown"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="rent-tip-btn"
      >
        <Info size={12} />
      </button>
      {open && (
        <span className="rent-tip-pop" role="dialog" aria-label="Leases still being set up">
          {pending.length > 0 && (
            <>
              <span className="rent-tip-row strong">
                <span>Still being set up</span>
                <span>{leaseWord(pending.length)}</span>
              </span>
              <span className="tip-list">
                {pending.map(({ c, reason }) => (
                  // These rows ARE the still-being-set-up leases, so most of
                  // them live in Operations — linking them to the register was
                  // sending the reader to a lease page for a lease the register
                  // does not contain.
                  <Link key={c.id} href={contractHref(c.id, surfaceOfLockedAt(c.lockedAt), manager)} className="tip-item">
                    <span className="tip-unit">
                      {c.unit.number ? `Unit ${c.unit.number}` : c.unit.name ?? c.ref}
                      <em>{c.property.buildingName ?? '—'}</em>
                    </span>
                    <span className="tip-why">{reason}</span>
                  </Link>
                ))}
              </span>
              <Link href={opsHref} className="tip-all">Open Operations →</Link>
              <span className="rent-tip-sep" />
            </>
          )}
          <span className="rent-tip-row strong">
            <span>Annual Rent</span>
            <span>{leaseWord(breakdown.gross.count)} · AED {fmtAedAmt(breakdown.gross.amount)}</span>
          </span>
          <span className="rent-tip-row dim">
            <span>− still in setup / unlocked / lapsed / unactivated pending</span>
            <span>{leaseWord(breakdown.setup.count)} · AED {fmtAedAmt(breakdown.setup.amount)}</span>
          </span>
          <span className="rent-tip-row dim">
            <span>− in Operations worklist / winding down / move-out</span>
            <span>{leaseWord(breakdown.operations.count)} · AED {fmtAedAmt(breakdown.operations.amount)}</span>
          </span>
          <span className="rent-tip-sep" />
          <span className="rent-tip-row strong final">
            <span>= Orders &quot;Running rent / yr&quot;</span>
            <span>{leaseWord(breakdown.running.count)} · AED {fmtAedAmt(breakdown.running.amount)}</span>
          </span>
        </span>
      )}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Row component
// ────────────────────────────────────────────────────────────────────────────

function Row({
  contract, now, soonBy, onEdit, basePath, flag, disputeHref,
}: {
  contract: Contract; now: Date; soonBy: Date; onEdit?: (id: number) => void; basePath: string;
  /** Legal & breach flags for this lease (spec §2.5 / §7.5) — absent until loaded, null when clean. */
  flag?: LeaseFlag | null;
  /** Builds the Legal case page href for a dispute id (landlord vs manager route). */
  disputeHref: (disputeId: number) => string;
}) {
  const router = useRouter();
  const c = contract;
  const ds = displayStatusOf(c);
  const soon = isInForce(c) && endsSoon(c, soonBy);
  const d = soon ? daysTo(c.endDate, now) : null;
  const isRenewal = c.contractType === 'renewal';
  // Inner page = the v2 Quest layout. Each row navigates straight there
  // instead of expanding an inline body — the v2 page already provides
  // the full contract context (timeline, parties, payments, addendums,
  // etc.) we'd otherwise duplicate inside the row.
  const href = `${basePath}/${c.id}/v2`;

  const tenantLabel = tenantDisplayName(c.tenant);

  return (
    <Link href={href} className="row">
      <div className="col-ref">
        <div className="av">{initials(tenantLabel)}</div>
        <div className="info">
          <div className="ref">
            {c.ref}
            <span className={'type-chip ' + (isRenewal ? 'renewal' : '')}>{isRenewal ? 'Renewal' : 'New'}</span>
          </div>
          <div className="tenant">{tenantLabel ?? '—'}</div>
          {/* Two INDEPENDENT pills — a breach and a legal case can coexist. The
              row is itself a Link, so each pill swallows the click and routes
              on its own: breach → the lease's Breaches section, legal → the case. */}
          {(flag?.breach || flag?.dispute) && (
            <div className="legal-flags">
              {flag?.breach && (
                <span
                  className="status breach" role="link" tabIndex={0}
                  style={{ background: breachStageTone(flag.breach.stage).bg, color: breachStageTone(flag.breach.stage).fg }}
                  title="Open the breach on the lease page"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`${href}#sec-breaches`); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); router.push(`${href}#sec-breaches`); } }}
                >
                  <span className="sd" />Breach · {flag.breach.label}
                </span>
              )}
              {flag?.dispute && (
                <span
                  className="status legal" role="link" tabIndex={0}
                  style={{ background: disputeStageTone(flag.dispute.stage).bg, color: disputeStageTone(flag.dispute.stage).fg }}
                  title="Open the legal case"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(disputeHref(flag.dispute!.id)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); router.push(disputeHref(flag.dispute!.id)); } }}
                >
                  <span className="sd" />Legal · {flag.dispute.label}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="col-prop">
        <div className="unit">{c.unit.number ? `Unit ${c.unit.number}` : '—'}</div>
        <div className="bldg">{c.property.buildingName ?? '—'}</div>
      </div>

      <div className="col-term">
        <div className="span">{fmtShort(c.startDate)} – {fmtShort(c.endDate)}</div>
        <div className={'end-note ' + (soon ? 'soon' : '')}>
          {soon ? <span className="soon-pill">{d !== null && d < 0 ? 'Overdue' : `Expires ${d}d`}</span> : <>Ends {fmtDate(c.endDate)}</>}
        </div>
      </div>

      <div className="col-rent">
        <div className="amt">AED {fmtAedAmt(c.annualRent)}</div>
        <div className="per">per year</div>
      </div>

      <div className="col-status">
        <span className={'status ' + ds}><span className="sd" />{statusLabel(c)}</span>
      </div>

      <div className="col-chev">
        {/* Edit terms — hidden once the contract is signed by any party (the
            executed agreement is locked; the backend rejects the edit too). */}
        {!c.signed && onEdit && (
          <button type="button" className="edit-btn" title="Edit contract" aria-label="Edit contract"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(c.id); }}>
            <Pencil size={14} />
          </button>
        )}
        <span className="cv">
          <ChevronRight size={14} />
        </span>
      </div>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────

export function OrdersWorkspace({ manager }: { manager?: { rp: number } }) {
  // The Leases register is a read/edit surface for everyone — landlord and
  // manager alike. Leases are STARTED in Operations (and from a lead), not
  // here, so there is no create affordance on this page at all. The row Edit
  // needs canManageAgreements on the acting landlord in manager mode; the RP
  // (no `manager` prop) owns their own contracts, so it is always allowed.
  const { canForRp } = useManagerPermissions();
  const canEditTerms = !manager || canForRp('canManageAgreements', manager.rp);
  // Base route for detail/edit/new links + the API source. In manager mode the
  // page reuses the landlord-scoped /manager/contracts endpoints and links into
  // the manager portal, mirroring UnitsWorkspace.
  const contractBase = manager ? '/dashboard/manager/contracts' : '/rental-provider/dashboard/contracts';
  const opsHref = manager ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations';
  const [contracts, setContracts] = useState<Contract[]>([]);
  // Ids of contracts still in the Operations worklist (drafts + active-but-
  // incomplete). The Leases register is the EXACT COMPLEMENT: a lease shows here
  // only once its full pipeline is complete and it has left Operations.
  const [opsIds, setOpsIds] = useState<Set<number>>(new Set());
  // Legal & breach flags per lease id (spec §2.5) — one batched call after the
  // register loads, chunked so a big portfolio never builds a giant query string.
  const [leaseFlags, setLeaseFlags] = useState<LeaseFlags>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAsset, setFilterAsset] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const router = useRouter();

  useEffect(() => {
    const q = manager ? `?rp=${manager.rp}` : '';
    Promise.all([
      fetch(`/api/${manager ? 'manager/contracts' : 'contracts'}${q}`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch(`/api/${manager ? 'manager/contracts/operations' : 'contracts/operations'}${q}`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ])
      .then(([list, ops]) => {
        if (Array.isArray(list)) setContracts(list);
        if (Array.isArray(ops)) setOpsIds(new Set(ops.map((c: { id: number }) => c.id)));
      })
      .finally(() => setLoading(false));
  }, [manager]);

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

  useEffect(() => { setPage(1); }, [activeTab, search, filterAsset, filterType]);

  const now = useMemo(() => new Date(), []);
  const soonBy = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + EXPIRING_DAYS); return d; }, []);

  const assets = useMemo(
    () => [...new Set(contracts.map(c => c.property.buildingName).filter((s): s is string => Boolean(s)))],
    [contracts],
  );

  // The year picker is GONE — the register shows every year. It defaulted to the
  // current year, which silently hid leases whose term did not touch it and made
  // the headline disagree with the dashboard for a reason nothing on the page
  // stated. Scope by year on the Expired list if you need it; the live buckets
  // are today-anchored anyway, so a year filter never applied to them.
  const yearScoped = contracts;

  // ── CURRENT LEASES = one in-force lease per unit within scope. This is the
  // headline "Total". A renewed unit keeps the old + new rows and prior cycles
  // stay as expired rows, so a raw count double/triple-counts; collapsing per
  // unit gives the real tenancy count (the fix for the inflated 169). ──
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

  // ── Reconciliation with the dashboard ──────────────────────────────────────
  // The dashboard's "Active Leases" tile counts LIVE TENANCIES (lib/liveLease,
  // the mirror of LIVE_LEASE_TIPS_SQL). This register is narrower on purpose —
  // leases still being set up belong to Operations, and the two pages must not
  // both claim them. So the figures differ, and the strip below says by how many
  // and where the rest are, rather than leaving the reader to guess.
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
  // Units with a current lease — the dashboard's Active Leases set, by unit.
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


  // UPCOMING RENEWALS — signed ahead, term not begun, and ALREADY SET UP.
  //
  // The Operations test is the point. Without it this listed every signed-ahead
  // draft, and a draft that has not been blessed is by definition still in the
  // Operations pre-active pipeline — so the register was showing Operations' own
  // work back to the user under a different name. On RP 2 that was all 30 of them
  // (`pending`, locked_at NULL), i.e. the bucket duplicated Operations exactly and
  // reconciled with nothing.
  //
  // Same rule as `currentLeases`, only the term has not started yet.
  //
  // `lockedAt` is NOT part of the test, and that is deliberate. A signed-ahead
  // lease CANNOT be locked before its start date — activation is deliberately
  // deferred to the start-date cron so two ACTIVE leases never overlap on one
  // unit — so requiring it here meant this bucket could only ever be empty, and
  // a renewal that was fully set up (cheques in, both signatures, Ejari
  // registered) sat on the Operations board with nothing anyone could do to it.
  // Operations now drops those itself (contracts.service.ts buildOperationsList),
  // so `!opsIds.has(c.id)` alone still keeps unfinished drafts out of the
  // register — the two surfaces remain exact complements.
  // One row per lease (no per-unit collapse: two units signed ahead to the same
  // customer are two renewals).
  const startsLaterLeases = useMemo(
    () => yearScoped.filter(c =>
      displayStatusOf(c) === 'starts_later' &&
      !opsIds.has(c.id)),
    [yearScoped, opsIds],
  );

  // The live tenancies this register does NOT list, each with the reason it is
  // held back. The info icon on "Fully set up" opens this, so the gap is a list
  // of real units you can click into — not a number you have to take on trust.
  const currentIds = useMemo(() => new Set(currentLeases.map(c => c.id)), [currentLeases]);
  // Partitioned by UNIT, not by lease id. The register and the live set can pick
  // different leases for one unit — its running term here, a renewal signed ahead
  // there — and comparing ids counted that unit in BOTH tiles (Unit 306, 13 Sep
  // 2026: 96 + 8 against the dashboard's 103).
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
  // Expired/ended leases — e.g. the prior term of a renewed lease (an expired
  // original whose renewal is still active). Each ended term is its own history
  // row (no per-unit collapse); superseded duplicates map to a 'superseded'
  // display status, so filtering on 'expired' keeps them out.
  const expiredLeases  = useMemo(() => yearScoped.filter(c => displayStatusOf(c) === 'expired'), [yearScoped]);

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

  const filtered = useMemo(() => {
    const list = baseList.filter(c => {
      if (filterAsset !== 'all' && c.property.buildingName !== filterAsset) return false;
      // Lease type — a renewal child carries contractType 'renewal'; everything
      // else (including imported originals with a null type) reads as New, the
      // same rule the row chip uses, so filter and chip never disagree.
      if (filterType !== 'all') {
        const isRenewal = c.contractType === 'renewal';
        if (filterType === 'renewal' ? !isRenewal : isRenewal) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = [c.ref, c.tenant.name, c.tenant.companyName, c.tenant.email, c.unit.number, c.property.buildingName]
          .filter((s): s is string => Boolean(s)).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // Soonest-ending first (renewal urgency).
    return [...list].sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''));
  }, [baseList, filterAsset, filterType, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Running rent = annual rent across the current leases (already one per unit).
  const runningRent = useMemo(() => currentLeases.reduce((s, c) => s + (c.annualRent || 0), 0), [currentLeases]);
  const rentBreakdown = useMemo<RentBreakdown>(() => ({
    gross: { count: grossLeaseCandidates.length, amount: sumAnnualRent(grossLeaseCandidates) },
    setup: { count: setupExcludedLeases.length, amount: sumAnnualRent(setupExcludedLeases) },
    operations: { count: operationsExcludedLeases.length, amount: sumAnnualRent(operationsExcludedLeases) },
    running: { count: currentLeases.length, amount: runningRent },
  }), [grossLeaseCandidates, setupExcludedLeases, operationsExcludedLeases, currentLeases, runningRent]);

  const hasFilters = filterAsset !== 'all' || filterType !== 'all' || search !== '';

  // The cards describe WHAT IS ON SCREEN, so they follow the bucket. Showing
  // Active Leases / In Operations above a list of expired terms put two figures
  // next to rows that had nothing to do with either — the reader has to work out
  // which number the list underneath belongs to, and that is the whole confusion
  // this page has been carrying.
  //
  // Active Leases is the only bucket with two cards, and they ADD UP to the
  // dashboard's Active Leases, partitioned by unit (RP 2, 14 Sep 2026: 96 + 7 = 103). The breakdown tooltip rides on that first
  // card — it walks gross → setup → operations → running, i.e. precisely the
  // "why is this not the dashboard's number" question.
  const kpis: { lbl: string; val: string; aed?: boolean; accent?: boolean; ic: React.ReactNode; info?: React.ReactNode; href?: string }[] =
    activeTab === 'expired'
      ? [{ lbl: 'Expired Leases', val: String(expiredLeases.length), ic: <Archive size={12} /> }]
      : activeTab === 'starts_later'
        ? [{ lbl: 'Starts later', val: String(startsLaterLeases.length), ic: <CalendarClock size={12} /> }]
        : [
            { lbl: 'Active Leases', val: String(currentLeases.length), ic: <Shield size={12} />, info: <RentBreakdownTip breakdown={rentBreakdown} pending={pendingSetupLeases} manager={manager} opsHref={opsHref} /> },
            { lbl: 'In Operations', val: String(elsewhereCount),       ic: <ClipboardList size={12} />, href: opsHref },
          ];

  return (
    <div className="orders-page">
      {/* RP only. The manager portal already stacks DashboardShell's real header
          (working notification bell + avatar menu) above the layout's "Acting for"
          scope bar, so rendering this made a THIRD strip whose bell and avatar are
          decoration — a permanent unread dot that opens nothing, and a hardcoded
          "A" beside the signed-in manager's own menu. The crumb goes with it: the
          shell's sidebar already marks where you are. */}
      {!manager && (
        <header className="topbar">
          {/* Matches the sidebar, which is flat — there is no "Workspace" and no
              "Leasing" group to sit under, so the old crumb named a hierarchy the
              app does not have. */}
          <div className="crumbs">Dashboard / <b>Leases</b></div>
          <div className="right">
            <button className="icon-btn" aria-label="Notifications"><Bell size={18} /><span className="dot" /></button>
            <button className="av-btn" aria-label="Profile">A</button>
          </div>
        </header>
      )}

      <main className="main">
        {/* Hero */}
        <div className="hero">
          <div className="left">
            <div className="eyebrow"><FileText size={12} /> Leasing</div>
            {/* No standfirst under the title. The two KPI tiles and the strip
                below already say what is counted and what is not — a paragraph
                repeating it was the third telling of the same thing. */}
            <h1><span className="accent">Leases</span></h1>
          </div>
          <div className="right">
            <button type="button" className="btn btn-ghost"><Download size={14} /> Export</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="kpis">
          {kpis.map((k, i) => {
            const body = (
              <>
                <div className="lbl"><span className="ic">{k.ic}</span>{k.lbl}{k.info}</div>
                <div className={'val ' + (k.aed ? 'aed' : '')}>
                  {k.aed && <span className="cur">AED</span>}{k.val}
                </div>
              </>
            );
            const cls = 'kpi ' + (k.accent ? 'accent ' : '') + (k.href ? 'kpi-link' : '');
            return k.href
              ? <Link key={i} href={k.href} className={cls}>{body}</Link>
              : <div key={i} className={cls}>{body}</div>;
          })}
        </div>

        {/* The reconciliation sentence that used to sit here is gone. The two
            KPI tiles carry it now — Active Leases + In Operations add up to the
            dashboard's figure — and the info icon on the first tile lists the
            leases behind the gap unit by unit. */}

        {/* Filters — the bucket picker sits with Properties and Lease type
            rather than on its own row above them. All three narrow the same
            list, so they belong in one place. */}
        <div className="filters">
          <div className="search">
            <span className="ic"><Search size={15} /></span>
            <input
              placeholder="Search ref, customer, unit or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="clear" onClick={() => setSearch('')}><X size={14} /></button>
            )}
          </div>
          {/* Lease state leads: it picks WHICH leases the row is filtering,
              so Properties and Lease type read as narrowing that choice. */}
          <div className="sel-wrap">
            <select
              className="sel"
              value={activeTab}
              onChange={e => setActiveTab(e.target.value as TabKey)}
              aria-label="Filter leases by state"
            >
              {TABS.map(t => (
                <option key={t.key} value={t.key}>{t.label} ({tabCounts[t.key] ?? 0})</option>
              ))}
            </select>
          </div>
          <div className="sel-wrap">
            <select className="sel" value={filterAsset} onChange={e => setFilterAsset(e.target.value)}>
              <option value="all">All properties</option>
              {assets.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="sel-wrap">
            <select
              className="sel"
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              aria-label="Filter by lease type"
            >
              {TYPE_FILTERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button type="button" className="reset" onClick={() => { setFilterAsset('all'); setFilterType('all'); setSearch(''); }}>
              <X size={12} /> Reset
            </button>
          )}
          <span className="results">{filtered.length} of {baseList.length}</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="table-card">
            <div className="empty">
              <p>Loading contracts…</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="table-card">
            <div className="empty">
              <div className="ic"><FileText size={20} /></div>
              <h3>No contracts match</h3>
              <p>Try clearing your search or selecting a different status above.</p>
            </div>
          </div>
        ) : (
          <div className="table-card">
            <div className="table-head">
              <div>Contract</div>
              <div className="col-prop">Property</div>
              <div className="col-term">Term</div>
              <div className="col-rent ar">Annual rent</div>
              <div className="col-status">Status</div>
              <div />
            </div>
            <div className="rows">
              {rows.map(c => (
                <Row key={c.id} contract={c} now={now} soonBy={soonBy} basePath={contractBase}
                  flag={leaseFlags[String(c.id)]} disputeHref={disputeHref}
                  onEdit={canEditTerms ? (cid) => router.push(`${contractBase}/${cid}/edit`) : undefined} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="pager">
                <span className="info">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="nums">
                  <button
                    type="button"
                    className="pg"
                    disabled={safePage === 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  {pageWindow(safePage, totalPages).map((p, i) =>
                    p === '…' ? (
                      <span key={`gap${i}`} className="pg-gap" aria-hidden="true">…</span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        className={'pg ' + (p === safePage ? 'active' : '')}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    className="pg"
                    disabled={safePage === totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <GlobalStyle />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Scoped design tokens + component styles
// ────────────────────────────────────────────────────────────────────────────

function GlobalStyle() {
  return (
    <style jsx global>{`
      .orders-page {
        --green: #2e9f82;
        --green-d: #1a7a5a;
        --green-t: #d8f2e8;
        --green-t2: #ebf8f2;

        --ink: #1a1916; --ink-2: #3d3b35; --ink-3: #6b6860;
        --mute: #9b9890; --mute-2: #b0ae9a;

        --line: #e8e6e0; --line-2: #f0eeea;
        --paper: #f4f3ef; --paper-2: #ebe9e3;
        --card: #ffffff;

        --warn-bg: #fef3c7; --warn-fg: #92400e; --warn-edge: #f4dd9b;
        --info-bg: #dbeafe; --info-fg: #1e40af;
        --purple-bg: #ede9fe; --purple-fg: #6d28d9;
        --orange-bg: #ffedd5; --orange-fg: #9a3412;
        --sky-bg: #e0f2fe; --sky-fg: #0369a1;
        --danger-bg: #fee2e2; --danger-fg: #991b1b;

        --r-card: 18px; --r-row: 14px; --r-input: 10px;
        --sh-sm: 0 1px 2px rgba(26,25,22,.04);

        background: var(--paper);
        color: var(--ink);
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        min-width: 0;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.5;
        font-weight: 450;
      }
      .orders-page * { box-sizing: border-box; }
      .orders-page button, .orders-page input, .orders-page select {
        font-family: inherit; color: inherit;
      }

      .orders-page .topbar {
        background: #fff; border-bottom: 1px solid var(--line);
        position: sticky; top: 0; z-index: 20;
        padding: 14px 36px;
        display: flex; justify-content: space-between; align-items: center; gap: 14px;
      }
      @media (max-width: 720px) { .orders-page .topbar { padding: 14px 16px; } }
      .orders-page .topbar .crumbs { font-size: 13px; color: var(--mute); font-weight: 500; }
      .orders-page .topbar .crumbs b { color: var(--ink); font-weight: 700; }
      .orders-page .topbar .right { display: flex; align-items: center; gap: 12px; }
      .orders-page .icon-btn {
        appearance: none; background: transparent; border: 0;
        width: 34px; height: 34px; border-radius: 8px;
        color: var(--ink-2); cursor: pointer;
        display: grid; place-items: center; transition: background .15s; position: relative;
      }
      .orders-page .icon-btn:hover { background: var(--paper); }
      .orders-page .icon-btn .dot {
        position: absolute; top: 7px; right: 8px;
        width: 7px; height: 7px; border-radius: 99px;
        background: var(--green); border: 1.5px solid #fff;
      }
      .orders-page .av-btn {
        width: 34px; height: 34px; border-radius: 99px;
        background: linear-gradient(135deg, var(--green), #34c79f);
        color: #fff; display: grid; place-items: center;
        font-weight: 700; font-size: 13px; border: 0; cursor: pointer;
      }

      .orders-page .main {
        padding: 32px 36px 64px; max-width: 1320px;
        margin: 0 auto; width: 100%;
      }
      @media (max-width: 720px) { .orders-page .main { padding: 24px 16px 60px; } }

      .orders-page .hero {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 18px; margin-bottom: 22px; flex-wrap: wrap;
      }
      .orders-page .hero .left { flex: 1; min-width: 280px; }
      .orders-page .hero .eyebrow {
        font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
        color: var(--green-d); font-weight: 700; margin-bottom: 8px;
        display: flex; align-items: center; gap: 8px;
      }
      .orders-page .hero h1 {
        margin: 0; font-size: 34px; font-weight: 700; letter-spacing: -.022em;
        line-height: 1.1; color: var(--ink);
      }
      .orders-page .hero h1 .accent { color: var(--green-d); }
      .orders-page .hero p {
        margin: 10px 0 0; font-size: 15px; color: var(--ink-3);
        max-width: 56ch; line-height: 1.55;
      }
      .orders-page .hero .right {
        display: flex; align-items: center; gap: 10px;
        flex-wrap: wrap; flex-shrink: 0;
      }
      /* Global year filter — sits at page top, scopes KPIs + tabs + list */
      .orders-page .year-global {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 0 4px 0 12px; height: 38px; border-radius: 10px;
        background: var(--paper); border: 1px solid var(--line);
        color: var(--ink-2);
      }
      .orders-page .year-global .sel {
        border: 0; background: transparent; height: 36px; padding: 0 8px 0 4px;
        font-weight: 600; color: var(--ink); cursor: pointer;
      }
      .orders-page .year-global .sel:hover { border: 0; }

      .orders-page .kpis {
        display: grid; grid-template-columns: repeat(5, 1fr);
        gap: 12px; margin-bottom: 8px;
      }
      @media (max-width: 1100px) { .orders-page .kpis { grid-template-columns: repeat(3, 1fr); } }
      @media (max-width: 640px) { .orders-page .kpis { grid-template-columns: repeat(2, 1fr); } }
      .orders-page .kpi {
        background: #fff; border: 1px solid var(--line);
        border-radius: 14px; padding: 16px 18px; box-shadow: var(--sh-sm);
        display: flex; flex-direction: column; gap: 7px; min-width: 0;
      }
      .orders-page .kpi .lbl {
        font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
        color: var(--mute); font-weight: 700;
        display: flex; align-items: center; gap: 6px; line-height: 1.2;
      }
      .orders-page .kpi .lbl .ic { color: var(--green-d); opacity: .85; flex-shrink: 0; }
      .orders-page .rent-tip { position: relative; display: inline-flex; align-items: center; }
      .orders-page .rent-tip-btn {
        appearance: none; border: 0; background: transparent; padding: 0;
        width: 14px; height: 14px; border-radius: 999px; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        color: currentColor; opacity: .8;
      }
      .orders-page .rent-tip-btn:hover { opacity: 1; }
      /* Opens to the RIGHT of the icon. It used to anchor on right:0, which
         threw the panel leftwards across the KPI it belongs to. */
      .orders-page .rent-tip-pop {
        position: absolute; top: calc(100% + 8px); left: 0; z-index: 10;
        width: min(360px, 82vw); border-radius: 14px; background: #fff;
        border: 1px solid var(--line); box-shadow: 0 16px 40px rgba(26,25,22,.14);
        padding: 12px 14px; color: var(--ink); text-transform: none; letter-spacing: normal;
      }
      .orders-page .rent-tip-row {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        font-size: 12px; line-height: 1.45; padding: 3px 0;
      }
      .orders-page .rent-tip-row > span:last-child {
        text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;
      }
      .orders-page .rent-tip-row.dim { color: var(--ink-3); }
      .orders-page .rent-tip-row.strong { font-weight: 700; color: var(--ink); }
      .orders-page .rent-tip-row.final { color: var(--green-d); }
      .orders-page .rent-tip-sep {
        display: block; border-top: 1px solid var(--line); margin: 8px 0 6px;
      }
      /* The "still being set up" list — scrolls inside the popover so a long
         backlog never pushes the rent reconciliation off the bottom. */
      .orders-page .tip-list {
        display: block; max-height: 208px; overflow-y: auto;
        margin: 4px -4px 2px; padding: 0 4px;
      }
      .orders-page .tip-item {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 6px 6px; border-radius: 8px; text-decoration: none; color: inherit;
      }
      .orders-page .tip-item:hover { background: var(--bg-2, #f7f7f4); }
      .orders-page .tip-unit {
        display: flex; flex-direction: column; min-width: 0;
        font-size: 12px; font-weight: 600; color: var(--ink);
      }
      .orders-page .tip-unit em {
        font-style: normal; font-weight: 400; font-size: 11px; color: var(--ink-3);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .orders-page .tip-why {
        flex: 0 0 auto; font-size: 10.5px; font-weight: 600; color: var(--ink-3);
        background: var(--bg-2, #f4f3ef); border-radius: 999px; padding: 2px 8px; white-space: nowrap;
      }
      .orders-page .tip-all {
        display: block; font-size: 11.5px; font-weight: 700; color: var(--green-d);
        text-decoration: none; padding: 4px 6px 0;
      }
      .orders-page .tip-all:hover { text-decoration: underline; }
      /* A KPI that navigates. Same box as the static tiles, plus the hover
         affordance so it reads as clickable rather than decorative. */
      .orders-page .kpi-link { text-decoration: none; color: inherit; transition: border-color .15s, box-shadow .15s; }
      .orders-page .kpi-link:hover { border-color: var(--ink-3); box-shadow: 0 6px 18px rgba(26,25,22,.07); }
      .orders-page .kpi .val {
        font-size: 25px; font-weight: 700; letter-spacing: -.025em;
        color: var(--ink); line-height: 1; font-variant-numeric: tabular-nums;
      }
      .orders-page .kpi .val.aed { font-size: 18px; letter-spacing: -.01em; }
      .orders-page .kpi .val .cur {
        font-size: 12px; color: var(--mute); font-weight: 700;
        margin-right: 3px; letter-spacing: .02em;
      }
      .orders-page .kpi.accent {
        background: linear-gradient(160deg, var(--ink) 0%, #23332d 100%);
        border-color: transparent;
      }
      .orders-page .kpi.accent .lbl { color: rgba(255,255,255,.6); }
      .orders-page .kpi.accent .lbl .ic { color: #7be1c2; }
      .orders-page .kpi.accent .val { color: #fff; }
      .orders-page .kpi.accent .val .cur { color: rgba(255,255,255,.55); }

      .orders-page .today-strip {
        margin: 10px 2px 18px; font-size: 12.5px; color: var(--ink-2);
        background: var(--paper-2); border: 1px solid var(--line);
        border-radius: 10px; padding: 8px 12px;
      }
      .orders-page .today-strip b { color: var(--ink-1); font-weight: 700; }
      .orders-page .today-strip .ops-link { color: var(--green-d); font-weight: 600; text-decoration: none; }
      .orders-page .today-strip .ops-link:hover { text-decoration: underline; }
      .orders-page .rangetabs {
        display: flex; align-items: center; justify-content: space-between;
        gap: 18px; margin: 22px 0 16px;
        border-bottom: 1px solid var(--line); flex-wrap: wrap;
      }
      .orders-page .rangetabs .tabs {
        display: flex; align-items: stretch; gap: 0;
        overflow-x: auto; flex: 1; min-width: 0;
      }
      .orders-page .rangetabs .tabs::-webkit-scrollbar { display: none; }
      .orders-page .rangetabs button {
        appearance: none; background: transparent; border: 0; cursor: pointer;
        padding: 14px 15px 13px;
        font-size: 13.5px; font-weight: 600; color: var(--mute);
        border-bottom: 2px solid transparent; margin-bottom: -1px;
        display: inline-flex; align-items: center; gap: 8px;
        line-height: 1; white-space: nowrap;
        transition: color .15s, border-color .15s; font-family: inherit;
      }
      .orders-page .rangetabs button:hover { color: var(--ink-2); }
      .orders-page .rangetabs button.active {
        color: var(--green-d); border-bottom-color: var(--green);
      }
      .orders-page .rangetabs button .count {
        font-size: 10.5px; font-weight: 700;
        padding: 2px 7px; border-radius: 99px;
        background: var(--paper-2); color: var(--mute);
      }
      .orders-page .rangetabs button.active .count {
        background: var(--green-t); color: var(--green-d);
      }

      .orders-page .filters {
        display: flex; flex-wrap: wrap; align-items: center;
        gap: 8px; margin-bottom: 16px;
      }
      .orders-page .search { position: relative; flex: 1; max-width: 380px; min-width: 200px; }
      .orders-page .search input {
        width: 100%; padding: 10px 12px 10px 36px;
        font-size: 13.5px; border: 1px solid var(--line);
        border-radius: 10px; background: #fff; outline: none;
        transition: all .15s; font-family: inherit; color: var(--ink);
      }
      .orders-page .search input:focus {
        border-color: var(--green);
        box-shadow: 0 0 0 3px rgba(46,159,130,.08);
      }
      .orders-page .search input::placeholder { color: var(--mute-2); }
      .orders-page .search .ic {
        position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
        color: var(--mute); pointer-events: none;
      }
      .orders-page .search .clear {
        position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
        background: transparent; border: 0; color: var(--mute); cursor: pointer;
        width: 24px; height: 24px; border-radius: 6px;
        display: grid; place-items: center;
      }
      .orders-page .search .clear:hover { background: var(--paper); }
      .orders-page .sel {
        appearance: none; padding: 10px 32px 10px 14px;
        font-size: 13.5px; border: 1px solid var(--line);
        border-radius: 10px; background: #fff; color: var(--ink-2);
        cursor: pointer; font-family: inherit; outline: none;
        transition: all .15s; font-weight: 500;
      }
      .orders-page .sel:hover { border-color: var(--ink-3); }
      .orders-page .sel-wrap { position: relative; }
      .orders-page .sel-wrap::after {
        content: ''; position: absolute; right: 14px; top: 50%;
        width: 6px; height: 6px;
        border-right: 1.5px solid var(--mute);
        border-bottom: 1.5px solid var(--mute);
        transform: translateY(-65%) rotate(45deg); pointer-events: none;
      }
      .orders-page .filters .reset {
        background: transparent; border: 0; color: var(--green-d);
        font-weight: 600; font-size: 12.5px; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px;
        padding: 6px 8px; border-radius: 7px;
      }
      .orders-page .filters .reset:hover { background: var(--green-t2); }
      .orders-page .filters .results {
        margin-left: auto; font-size: 12.5px; color: var(--mute); font-weight: 500;
      }

      .orders-page .btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 7px; padding: 11px 16px; border-radius: 10px;
        font-weight: 600; font-size: 13.5px;
        border: 1px solid transparent; cursor: pointer;
        transition: all .15s; line-height: 1; white-space: nowrap;
        font-family: inherit; text-decoration: none;
      }
      .orders-page .btn-primary {
        background: var(--green); color: #fff; border-color: var(--green);
      }
      .orders-page .btn-primary:hover {
        background: var(--green-d); border-color: var(--green-d);
      }
      .orders-page .btn-ghost {
        background: #fff; color: var(--ink-2); border-color: var(--line);
      }
      .orders-page .btn-ghost:hover { border-color: var(--ink-3); color: var(--ink); }

      .orders-page .table-card {
        background: #fff; border: 1px solid var(--line);
        border-radius: 16px; overflow: hidden; box-shadow: var(--sh-sm);
      }
      .orders-page .table-head, .orders-page .row {
        display: grid;
        grid-template-columns: minmax(230px, 2fr) minmax(170px, 1.4fr) 168px minmax(120px, 1fr) 132px 34px;
        gap: 14px; align-items: center;
      }
      .orders-page .table-head {
        padding: 14px 22px; background: var(--paper);
        border-bottom: 1px solid var(--line);
        font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
        color: var(--mute); font-weight: 700;
      }
      .orders-page .table-head .ar { text-align: right; }
      @media (max-width: 1040px) {
        .orders-page .table-head, .orders-page .row { grid-template-columns: 1fr auto 34px; gap: 10px; }
        .orders-page .table-head .col-prop, .orders-page .table-head .col-term, .orders-page .table-head .col-rent,
        .orders-page .row .col-prop, .orders-page .row .col-term, .orders-page .row .col-rent { display: none; }
      }

      .orders-page .rows { display: flex; flex-direction: column; }
      .orders-page .row {
        padding: 15px 22px; border-bottom: 1px solid var(--line-2);
        transition: background .15s; cursor: pointer; min-height: 72px;
      }
      .orders-page .row:last-child { border-bottom: 0; }
      .orders-page .row:hover { background: var(--paper); }
      .orders-page .row.expanded { background: var(--green-t2); }

      .orders-page .col-ref { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .orders-page .av {
        width: 38px; height: 38px; border-radius: 11px;
        background: var(--green-t); color: var(--green-d);
        display: grid; place-items: center;
        font-weight: 700; font-size: 13px; letter-spacing: -.005em;
        flex-shrink: 0; border: 1px solid #cfe7dc;
      }
      .orders-page .col-ref .info {
        min-width: 0; flex: 1;
        display: flex; flex-direction: column; justify-content: center; gap: 3px;
      }
      .orders-page .col-ref .ref {
        font-family: 'DM Mono', ui-monospace, monospace;
        font-size: 13px; font-weight: 500; color: var(--ink);
        letter-spacing: -.01em; line-height: 1.2;
        display: flex; align-items: center; gap: 7px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .orders-page .col-ref .tenant {
        font-size: 12px; color: var(--mute); line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .orders-page .type-chip {
        display: inline-flex; align-items: center; flex-shrink: 0;
        font-size: 9px; letter-spacing: .06em; text-transform: uppercase;
        color: var(--ink-3); font-weight: 700;
        padding: 2px 6px; border-radius: 99px; background: var(--paper-2);
      }
      .orders-page .type-chip.renewal { background: var(--sky-bg); color: var(--sky-fg); }

      .orders-page .col-prop {
        min-width: 0; display: flex; flex-direction: column;
        justify-content: center; gap: 3px;
      }
      .orders-page .col-prop .unit {
        font-size: 13.5px; font-weight: 600; color: var(--ink-2);
        letter-spacing: -.005em; line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .orders-page .col-prop .bldg {
        font-size: 12px; color: var(--mute); line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .orders-page .col-term {
        min-width: 0; display: flex; flex-direction: column;
        justify-content: center; gap: 3px; font-variant-numeric: tabular-nums;
      }
      .orders-page .col-term .span {
        font-size: 12.5px; font-weight: 600; color: var(--ink-2);
        line-height: 1.2; white-space: nowrap;
      }
      .orders-page .col-term .end-note {
        font-size: 11px; color: var(--mute); line-height: 1.2;
        display: flex; align-items: center; gap: 5px;
      }
      .orders-page .col-term .end-note.soon { color: var(--warn-fg); font-weight: 600; }
      .orders-page .soon-pill {
        display: inline-flex; align-items: center;
        font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
        padding: 1px 6px; border-radius: 99px;
        background: var(--warn-bg); color: var(--warn-fg); border: 1px solid var(--warn-edge);
      }

      .orders-page .col-rent {
        min-width: 0; text-align: right; font-variant-numeric: tabular-nums;
      }
      .orders-page .col-rent .amt {
        font-size: 14px; font-weight: 700; color: var(--ink);
        letter-spacing: -.01em; line-height: 1.2; white-space: nowrap;
      }
      .orders-page .col-rent .per { font-size: 11px; color: var(--mute); line-height: 1.2; margin-top: 2px; }

      .orders-page .col-status { display: flex; align-items: center; }
      .orders-page .status {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600;
        padding: 4px 10px; border-radius: 99px;
        letter-spacing: .01em; white-space: nowrap; border: 1px solid transparent;
      }
      .orders-page .status .sd {
        width: 6px; height: 6px; border-radius: 99px;
        background: currentColor; flex-shrink: 0; opacity: .85;
      }
      .orders-page .status.active      { background: var(--green-t); color: var(--green-d); border-color: #cfe7dc; }
      .orders-page .status.terminating { background: var(--orange-bg); color: var(--orange-fg); border-color: #fbd0aa; }
      .orders-page .status.pending     { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-edge); }
      .orders-page .status.issued      { background: var(--info-bg); color: var(--info-fg); border-color: #c7d8f5; }
      .orders-page .status.expired     { background: var(--paper-2); color: var(--ink-3); border-color: var(--line); }
      .orders-page .status.needs_activation { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-edge); }
      .orders-page .status.starts_later     { background: var(--sky-bg); color: var(--sky-fg); border-color: #bae0fa; }
      .orders-page .status.declined    { background: var(--danger-bg); color: var(--danger-fg); border-color: #f1c5c2; }
      .orders-page .status.superseded  { background: var(--purple-bg); color: var(--purple-fg); border-color: #d6cef9; }
      .orders-page .status.terminated  { background: #ececec; color: #57534e; border-color: #ddd9d2; }
      /* Legal & breach flags — same pill, stage colours from lib/legal.ts (inline),
         a touch smaller so two can sit under the customer name without crowding. */
      .orders-page .legal-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
      .orders-page .status.breach, .orders-page .status.legal {
        font-size: 10px; padding: 2px 8px; gap: 5px; border-color: rgba(0,0,0,.06); cursor: pointer;
      }
      .orders-page .status.breach:hover, .orders-page .status.legal:hover { filter: brightness(.96); text-decoration: underline; }

      .orders-page .col-chev {
        display: flex; align-items: center; justify-content: center; color: var(--mute);
      }
      .orders-page .col-chev .cv { transition: transform .2s; display: grid; place-items: center; }
      .orders-page .row.expanded .col-chev .cv { transform: rotate(90deg); color: var(--green-d); }

      /* Edit-contract action — quiet by default, brand-green on hover. */
      .orders-page .col-chev .edit-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; border-radius: 8px;
        border: 1px solid var(--line); background: #fff; color: var(--ink-3);
        margin-right: 8px; cursor: pointer; flex: none;
        transition: background .15s, border-color .15s, color .15s, box-shadow .15s, transform .08s;
      }
      .orders-page .row:hover .col-chev .edit-btn { border-color: var(--paper-2); }
      .orders-page .col-chev .edit-btn:hover {
        background: var(--green-t2); border-color: var(--green); color: var(--green-d);
        box-shadow: 0 2px 8px -2px rgba(46, 159, 130, .35);
      }
      .orders-page .col-chev .edit-btn:active { transform: scale(.92); }
      .orders-page .col-chev .edit-btn:focus-visible {
        outline: 2px solid var(--green); outline-offset: 2px;
      }

      .orders-page .row-body {
        grid-column: 1 / -1;
        border-top: 1px solid var(--line-2);
        margin-top: 15px; padding-top: 18px;
        display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px;
      }
      @media (max-width: 980px) { .orders-page .row-body { grid-template-columns: 1fr; } }
      .orders-page .blk {
        background: #fff; border: 1px solid var(--line);
        border-radius: 12px; padding: 15px 16px;
      }
      .orders-page .blk .h {
        font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
        color: var(--mute); font-weight: 700; margin-bottom: 12px;
        display: flex; align-items: center; gap: 6px;
      }
      .orders-page .blk .h .icw { color: var(--green-d); }
      .orders-page .det-grid {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 12px 18px;
      }
      .orders-page .det {
        display: flex; flex-direction: column; gap: 3px; min-width: 0;
      }
      .orders-page .det .k { font-size: 11px; color: var(--mute); font-weight: 500; }
      .orders-page .det .v {
        font-size: 13px; color: var(--ink); font-weight: 600; letter-spacing: -.005em;
      }
      .orders-page .det .v.mono {
        font-family: 'DM Mono', ui-monospace, monospace;
        font-size: 12.5px; font-weight: 500;
      }
      .orders-page .ejari {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11px; font-weight: 600;
        padding: 2px 8px; border-radius: 99px; width: max-content;
      }
      .orders-page .ejari.registered { background: var(--green-t); color: var(--green-d); }
      .orders-page .ejari.pending    { background: var(--warn-bg); color: var(--warn-fg); }
      .orders-page .ejari.none       { background: var(--paper-2); color: var(--ink-3); }

      .orders-page .body-actions {
        display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px;
      }
      .orders-page .ba {
        appearance: none; display: inline-flex; align-items: center; gap: 6px;
        font-size: 12.5px; font-weight: 600;
        padding: 8px 13px; border-radius: 9px; cursor: pointer;
        border: 1px solid var(--green); background: var(--green); color: #fff;
        transition: all .15s; font-family: inherit; text-decoration: none;
      }
      .orders-page .ba:hover { background: var(--green-d); border-color: var(--green-d); }
      .orders-page .ba.ghost { background: #fff; color: var(--ink-2); border-color: var(--line); }
      .orders-page .ba.ghost:hover { border-color: var(--ink-3); color: var(--ink); }
      .orders-page .ba.danger { background: #fff; color: var(--danger-fg); border-color: #f1c5c2; }
      .orders-page .ba.danger:hover { background: var(--danger-bg); }

      .orders-page .timeline {
        display: flex; flex-direction: column; gap: 0;
        position: relative; padding-left: 16px; margin-top: 2px;
      }
      .orders-page .timeline::before {
        content: ''; position: absolute;
        left: 4px; top: 8px; bottom: 8px;
        width: 1.5px; background: var(--line);
      }
      .orders-page .tl-item { position: relative; padding: 6px 0 6px 18px; }
      .orders-page .tl-item::before {
        content: ''; position: absolute; left: -15px; top: 11px;
        width: 9px; height: 9px; border-radius: 99px;
        background: #fff; border: 1.5px solid var(--line);
      }
      .orders-page .tl-item.past::before { background: var(--green); border-color: var(--green); }
      .orders-page .tl-item.current::before {
        background: #fff; border-color: var(--green);
        box-shadow: 0 0 0 3px var(--green-t2);
      }
      .orders-page .tl-item.alert::before { background: #e8a44a; border-color: #e0973a; }
      .orders-page .tl-item .nm { font-size: 12px; font-weight: 600; color: var(--ink); line-height: 1.3; }
      .orders-page .tl-item:not(.past):not(.current):not(.alert) .nm { color: var(--mute); }
      .orders-page .tl-item .t { font-size: 11px; color: var(--mute); margin-top: 2px; }

      .orders-page .pager {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 22px; border-top: 1px solid var(--line);
        gap: 12px; flex-wrap: wrap;
      }
      .orders-page .pager .info { font-size: 12px; color: var(--mute); font-weight: 500; }
      .orders-page .pager .nums { display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; }
      .orders-page .pg-gap {
        min-width: 20px; height: 32px; display: grid; place-items: center;
        color: var(--mute); font-size: 12.5px; font-weight: 600; user-select: none;
      }
      .orders-page .pg {
        min-width: 32px; height: 32px; padding: 0 6px;
        display: grid; place-items: center;
        border-radius: 8px; border: 1px solid var(--line);
        background: #fff; color: var(--ink-2);
        font-size: 12.5px; font-weight: 600; cursor: pointer;
        transition: all .15s; font-family: inherit;
      }
      .orders-page .pg:hover:not(:disabled):not(.active) {
        background: var(--paper); border-color: var(--ink-3);
      }
      .orders-page .pg.active {
        background: var(--green); color: #fff; border-color: var(--green);
      }
      .orders-page .pg:disabled { opacity: .4; cursor: not-allowed; }

      .orders-page .empty {
        padding: 56px 24px; text-align: center; color: var(--mute);
      }
      .orders-page .empty .ic {
        width: 48px; height: 48px; border-radius: 14px;
        background: var(--green-t); color: var(--green-d);
        display: grid; place-items: center; margin: 0 auto 12px;
      }
      .orders-page .empty h3 {
        margin: 0 0 6px; font-size: 18px; font-weight: 700;
        color: var(--ink); letter-spacing: -.01em;
      }
      .orders-page .empty p {
        margin: 0; font-size: 13.5px; color: var(--ink-3);
        line-height: 1.5; max-width: 42ch;
        margin-left: auto; margin-right: auto;
      }
    `}</style>
  );
}

/** RP route entry point — the landlord's own Leases register. */
export default function OrdersPage() {
  return <OrdersWorkspace />;
}
