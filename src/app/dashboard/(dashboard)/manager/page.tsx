'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Building2, FileText, Eye, DoorOpen, AlertTriangle, ChevronRight,
  RefreshCw, LogIn, LogOut, XCircle, Clock,
  PenLine, Stamp, Banknote, Scale, MailQuestion, UserPlus,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { useAuth } from '@/contexts/AuthContext';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { DashboardPage, StatCard, SectionHeader } from '@/components/dashboard/DashboardWidgets';

interface OverviewStats {
  properties:      number;
  units:           number;
  activeContracts: number;
  openLeads:       number;
  rps: { id: number; name: string; propertyCount: number }[];
}

interface ActionItem {
  id: number; rpId?: number; parentId?: number | null; tenantId?: number;
  tenant?: string; unit?: string | null; building?: string | null;
  startDate?: string | null; endDate?: string | null;
  vendor?: string; category?: string | null; doc?: string; docName?: string | null;
  reason?: string | null; date?: string | null;
  awaitingTenant?: boolean; awaitingLandlord?: boolean; need?: string | null;
  // Rent and fee cheques are counted separately by the API — they are both money
  // owed but not the same job, and the landlord's Overdue/Bounced KPI counts the
  // rent halves only.
  bounced?: number; overdue?: number; bouncedFee?: number; overdueFee?: number;
  deposit?: string | number | null;
}
interface Bucket { count: number; items: ActionItem[]; truncated?: boolean }
interface ActionCenter {
  days: number;
  openLeads: Bucket;
  awaitingSignature: Bucket; registrationPending: Bucket;
  renewals: Bucket; renewalOffersOut: Bucket;
  terminationRequests: Bucket; moveIns: Bucket; moveOuts: Bucket;
  chequesAttention: Bucket; settlementPending: Bucket;
  amcExpired: Bucket; delayedFollowups: Bucket;
}

/** Every Action Center row is the same two things: the unit, and the one state
 *  that says what is owed on it. The building is the group heading, so it never
 *  repeats on the row. A row with no unit falls back to whoever it concerns. */
const unitOf = (i: ActionItem) => (i.unit ? `Unit ${i.unit}` : i.tenant ?? `#${i.id}`);
const buildingOf = (i: ActionItem) => i.building ?? 'Unassigned building';
/** The date a row turns on has already passed — the lease it names has ended and
 *  the action is late, not upcoming. Compared against local midnight, so a row
 *  dated today reads as due rather than overdue. */
const overdueBy = (d?: string | null) => !!d && new Date(d) < new Date(new Date().toDateString());
/** Unit labels are numbers, and mixed ones like "Room-16" / "SHOP-3" — a plain
 *  sort puts Unit 10 before Unit 9, so collate numerically. */
const byUnit = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
/** Lease dates arrive as the UTC INSTANT of Dubai midnight — a 1 Aug lease date
 *  serializes as `2026-07-31T20:00:00.000Z`. Both slicing the ISO string and
 *  formatting in the browser's own zone therefore render the day BEFORE, so
 *  every date on this page is formatted in APP_TIME_ZONE. */
/*  `en-AE` is the app's date locale everywhere else, and it is also the one that
 *  abbreviates September to "Sep" — en-GB renders "Sept", the only 4-letter
 *  month, which visibly breaks the column. */
const fmtDay = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: '2-digit' }) : '';
const fmtMonth = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, month: 'short', year: 'numeric' }) : '';
/** The renewal offer's own term, plus the month the lease it replaces runs out —
 *  the month is the deadline the queue is sorted by, the term is what the
 *  customer has been asked to accept. Either half can be missing on a legacy
 *  row, so each is dropped independently rather than blanking the whole line. */
const offerTerm = (i: ActionItem) =>
  [
    fmtMonth(i.date) && `Ends ${fmtMonth(i.date)}`,
    fmtDay(i.startDate) && fmtDay(i.endDate) && `${fmtDay(i.startDate)} – ${fmtDay(i.endDate)}`,
  ].filter(Boolean).join(' · ') || undefined;
/** Names the side the manager has to chase, short enough to sit in the status
 *  column — they chase the signer, they never sign themselves. */
const signerShort = (i: ActionItem) =>
  i.awaitingTenant && i.awaitingLandlord ? 'Needs both'
    : i.awaitingLandlord ? 'Needs landlord'
      : i.awaitingTenant ? 'Needs customer' : 'Needs signature';
/** Stage names arrive lower-case from the API (`viewing scheduled`). */
const sentence = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
/** What is actually wrong with this lease's cheques. RENT first: it is the half
 *  the landlord's own Overdue/Bounced KPI counts, and a bounced rent cheque
 *  needs a replacement while an overdue one needs chasing. A lease with no rent
 *  problem at all is here purely on fee cheques (admin / Ejari / other) — a
 *  different job, so it says so rather than borrowing the rent wording. */
const chequeState = (i: ActionItem) => {
  const rent = [i.bounced ? `${i.bounced} bounced` : null, i.overdue ? `${i.overdue} overdue` : null]
    .filter(Boolean).join(' · ');
  if (rent) return rent;
  const fees = (i.bouncedFee ?? 0) + (i.overdueFee ?? 0);
  return fees ? `${fees} fee cheque${fees > 1 ? 's' : ''}` : 'Needs attention';
};

/**
 * Manager home — always the manager's own dashboard layout (headline stats +
 * Action Center); it never swaps into the RP/landlord dashboard component.
 * Selecting a landlord in the switcher (?rp=) scopes the headline stats and
 * Action Center to that landlord, matching every other manager page; "All
 * landlords" (no ?rp=) shows the cross-landlord aggregate.
 */
export default function ManagerOverview() {
  return <ManagerMultiOverview />;
}

function ManagerMultiOverview() {
  const { user }                            = useAuth();
  const { rps, loading: permsLoading } = useManagerPermissions();
  const searchParams                        = useSearchParams();
  const [stats, setStats]                   = useState<OverviewStats | null>(null);
  const [statsLoading, setStatsLoading]     = useState(true);
  const [action, setAction]                 = useState<ActionCenter | null>(null);
  const [actionLoading, setActionLoading]   = useState(true);
  const [days, setDays]                     = useState(90);
  const name = user?.name ?? user?.firstName ?? 'Manager';

  // LandlordSwitcher scope: ?rp=<id> narrows the headline stats + Action Center
  // to that landlord; absent = All landlords (cross-landlord aggregate).
  const rpParam    = searchParams.get('rp');
  const scopedRp   = rpParam ? Number(rpParam) : null;
  const scopedName = scopedRp ? rps.find(r => r.rentalProviderId === scopedRp)?.rpName ?? null : null;
  const rpQuery    = scopedRp ? `?rp=${scopedRp}` : '';

  useEffect(() => {
    setStatsLoading(true);
    apiGet<OverviewStats>(`/manager/overview${rpQuery}`)
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [rpQuery]);

  const loadAction = useCallback(() => {
    setActionLoading(true);
    apiGet<ActionCenter>(`/manager/action-center?days=${days}${scopedRp ? `&rp=${scopedRp}` : ''}`)
      .then(setAction)
      .catch(() => {})
      .finally(() => setActionLoading(false));
  }, [days, scopedRp]);
  useEffect(() => { loadAction(); }, [loadAction]);

  const loading = statsLoading || permsLoading;

  // Every Action Center row links straight to the page that clears it. Two rules
  // hold throughout:
  //  - The landlord scope is ALWAYS explicit. Under "All landlords" the rows come
  //    from several landlords at once, so the link takes the row's own `rpId`
  //    rather than the page scope — a manager page opened without a landlord has
  //    nothing to resolve against.
  //  - A row goes to OPERATIONS when what it is waiting on is a step in the
  //    lease's setup/wind-down pipeline (sign, Ejari, utility, move-in, renew,
  //    terminate, move-out) — Operations is the working view where those steps
  //    are actually performed. Everything else goes to the LEASE itself, which
  //    is the record you read to answer it: money owed on a lease, or the
  //    settlement that closes one. Leads and customer documents are neither, so
  //    they keep their own pages.
  const scopeQ = (rpId?: number, extra?: string) => {
    const rp = rpId ?? scopedRp ?? null;
    const parts = [rp != null ? `rp=${rp}` : null, extra ?? null].filter(Boolean);
    return parts.length ? `?${parts.join('&')}` : '';
  };
  const opsHref = (i: ActionItem, extra?: string) =>
    `/dashboard/manager/operations/${i.id}${scopeQ(i.rpId, extra)}`;
  /** The lease record itself — the Leases nav's detail page. */
  const leaseHref = (i: ActionItem) =>
    `/dashboard/manager/contracts/${i.id}${scopeQ(i.rpId)}`;

  return (
    <DashboardPage
      title={`Welcome back, ${name}`}
      subtitle={
        loading
          ? 'Loading your dashboard…'
          : scopedRp
            ? `Acting for ${scopedName ?? 'this landlord'}`
            : `Managing properties for ${rps.length} landlord${rps.length !== 1 ? 's' : ''}`
      }
    >
      {/* Bucket lists scroll but show no bar: the track eats into a card this
          narrow, and a row cut off at the fold already signals there is more. */}
      <style>{`
        .mgr-bucket-list { scrollbar-width: none; -ms-overflow-style: none; }
        .mgr-bucket-list::-webkit-scrollbar { width: 0; height: 0; display: none; }
      `}</style>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Properties"       value={loading ? '—' : stats?.properties      ?? 0} icon={Building2} color="primary" />
        <StatCard label="Units"            value={loading ? '—' : stats?.units           ?? 0} icon={DoorOpen}  color="neutral" />
        <StatCard label="Active Contracts" value={loading ? '—' : stats?.activeContracts ?? 0} icon={FileText}  color="gold" />
        {/* This is the open-LEADS count (every lead not yet converted/issued/
            rejected), not a viewings-only figure — "Viewings" is a legacy alias
            that now just redirects to Leads, so the old label named a page that
            no longer exists. */}
        <StatCard label="Open Leads"       value={loading ? '—' : stats?.openLeads       ?? 0} icon={Eye}       color="neutral" />
      </div>

      {/* Action Center */}
      <div className="flex items-center justify-between mb-3">
        <SectionHeader title="Action Center" />
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
          <span>Renewals window</span>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border rounded-lg px-2 py-1 text-xs bg-white" style={{ borderColor: 'var(--color-base-200)' }}>
            {[30, 60, 90, 180].map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
      </div>
      {/* Every card reads the same way: units grouped under their building, each
          against the one state that says what is owed on it. The buckets differ
          in WHAT that state is, never in how a row is shaped, so the whole
          Action Center can be scanned without re-learning each card. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {/* Leads open the pipeline, so they lead the Action Center. The state is
            the lead's own stage; a lead is not a lease, so the row opens the
            lead. Oldest-untouched first from the API. */}
        <ActionBucket icon={UserPlus} color="#0d9488" label="Leads to progress" href={`/dashboard/manager/leads${scopeQ()}`}
          loading={actionLoading} bucket={action?.openLeads}
          groupBy={buildingOf}
          compact={i => ({
            unit: unitOf(i),
            status: sentence(i.need) || 'In progress',
            href: `/dashboard/manager/leads/${i.id}${scopeQ(i.rpId)}`,
          })} />
        {/* Signature, Ejari/utility, move-in, renewal, termination and move-out
            are all pipeline steps → Operations, the view where they are done. */}
        <ActionBucket icon={PenLine} color="#7c3aed" label="Awaiting Signature" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.awaitingSignature}
          groupBy={buildingOf}
          compact={i => ({ unit: unitOf(i), status: signerShort(i), href: opsHref(i) })} />
        <ActionBucket icon={Stamp} color="#0891b2" label="Registration Pending" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.registrationPending}
          groupBy={buildingOf}
          compact={i => ({ unit: unitOf(i), status: i.need ?? 'Registration pending', href: opsHref(i) })} />
        {/* A move-in whose start date has passed with no inspection submitted is
            late, not upcoming — the same distinction the renewal cards draw. */}
        <ActionBucket icon={LogIn} color="#2563eb" label="Move-ins (inspection due)" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.moveIns}
          groupBy={buildingOf}
          compact={i => ({
            unit: unitOf(i),
            status: overdueBy(i.date) ? 'Overdue' : 'Inspection due',
            overdue: overdueBy(i.date),
            href: opsHref(i),
          })} />
        {/* Renewals to raise: nothing proposed yet, so the row deep-links into the
            renewal flow itself (?action=renew) rather than the lease's front page.
            An active lease already past its end date with no renewal sent is the
            most overdue item here, so it says so instead of reading like any
            other upcoming expiry. */}
        <ActionBucket icon={RefreshCw} color="#2e9f82" label={`Renewals to raise (≤${days}d)`} href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.renewals}
          groupBy={buildingOf}
          compact={i => ({
            unit: unitOf(i),
            status: overdueBy(i.date) ? 'Overdue' : i.need ?? 'To raise',
            overdue: overdueBy(i.date),
            href: opsHref(i, 'action=renew'),
          })} />
        {/* Offer already out — the renewal workflow lives on the PARENT lease, so
            link there, not at the pending renewal draft.
            Carries the window in its label like "Renewals to raise": both are the
            same renewal queue on the same date, split by whether the offer went
            out, so a reader can see the count answers the control above. */}
        <ActionBucket icon={MailQuestion} color="#0369a1" label={`Renewal Offers — Awaiting Reply (≤${days}d)`} href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.renewalOffersOut}
          groupBy={buildingOf}
          compact={i => ({
            // The lease being replaced has already ended and still no answer:
            // that is a different job from an offer out on a lease with months
            // left, and it is the only distinction this list needs to carry.
            unit: unitOf(i),
            status: overdueBy(i.date) ? 'Overdue' : 'Awaiting reply',
            overdue: overdueBy(i.date),
            // The only card that carries dates: an unanswered offer is read
            // against a deadline (the month the current lease runs out) and the
            // term on the table. Every other bucket stays unit + state.
            note: offerTerm(i),
            href: `/dashboard/manager/operations/${i.parentId ?? i.id}${scopeQ(i.rpId)}`,
          })} />
        <ActionBucket icon={XCircle} color="#b91c1c" label="Termination Requests" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.terminationRequests}
          groupBy={buildingOf}
          compact={i => ({ unit: unitOf(i), status: 'Awaiting response', href: opsHref(i) })} />
        <ActionBucket icon={LogOut} color="#b45309" label="Move-outs (inspection due)" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.moveOuts}
          groupBy={buildingOf}
          compact={i => ({
            unit: unitOf(i),
            status: overdueBy(i.date) ? 'Overdue' : 'Inspection due',
            overdue: overdueBy(i.date),
            href: opsHref(i),
          })} />
        {/* Cheques are money owed ON a lease, not a step in the pipeline, so the
            row opens the LEASE. How many bounced vs merely fell overdue is the
            state — a bounce needs a replacement cheque, an overdue one needs
            chasing, and the counts say which job this is. */}
        <ActionBucket icon={Banknote} color="#dc2626" label="Bounced / Overdue Cheques" href={`/dashboard/manager/receivables${scopeQ()}`}
          loading={actionLoading} bucket={action?.chequesAttention}
          groupBy={buildingOf}
          compact={i => ({
            unit: unitOf(i),
            status: chequeState(i),
            overdue: !!i.bounced,
            href: leaseHref(i),
          })} />
        {/* Terminated leases with no settlement recorded. Where a deposit is
            held the amount IS the state — it is what gets refunded to close it.
            Settlement is a lease record with its own screen, not a pipeline
            step, so the row opens that screen directly. */}
        <ActionBucket icon={Scale} color="#0d9488" label="Settlement Pending" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.settlementPending}
          groupBy={buildingOf}
          compact={i => ({
            unit: unitOf(i),
            status: Number(i.deposit) > 0
              ? `AED ${Number(i.deposit).toLocaleString('en-AE')} held`
              : 'No deposit held',
            href: `/dashboard/manager/contracts/${i.id}/settlement${scopeQ(i.rpId)}`,
          })} />
        {/* AMC Expired is deliberately NOT on this dashboard — vendor contracts
            are not lease work and every historically-expired AMC qualified, so the
            card was permanently full of items nobody was chasing. It lives on
            /dashboard/manager/amc, where it can be worked properly. The
            `amcExpired` bucket is still returned by the API for that page. */}
        {/* Follow-ups are the one bucket with no unit — a requested document
            belongs to a CUSTOMER, not a lease — so the customer is the heading
            and the document takes the row. Same two-column shape, and the row
            opens the customer, which is where the document is chased. */}
        <ActionBucket icon={Clock} color="#92400e" label="Delayed Follow-ups" href={`/dashboard/manager/tenants${scopeQ()}`}
          loading={actionLoading} bucket={action?.delayedFollowups}
          groupBy={i => i.tenant ?? 'Customer'}
          compact={i => ({
            unit: (i.docName ?? i.doc ?? 'Document').replace(/_/g, ' '),
            status: 'Not uploaded',
            overdue: true,
            href: i.tenantId ? `/dashboard/manager/tenants/${i.tenantId}${scopeQ(i.rpId)}` : undefined,
          })} />
      </div>

      {/* The "Your Landlords" list is gone: the LandlordSwitcher in the header
          already names every landlord and is where scope actually gets changed,
          so the list repeated it below a full screen of work.
          The nothing-assigned state stays — without it a manager with no landlord
          would get a dashboard of empty cards and no reason why. */}
      {!loading && rps.length === 0 && (
        <div
          className="rounded-2xl p-10 flex flex-col items-center justify-center text-center bg-white mb-8"
          style={{ boxShadow: 'var(--shadow-sm)', minHeight: 160 }}
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
            style={{ backgroundColor: '#fef9eb' }}
          >
            <AlertTriangle size={22} style={{ color: 'var(--color-gold)' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>No landlords assigned yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-400)' }}>
            Ask your landlord to invite you via their Team settings.
          </p>
        </div>
      )}

    </DashboardPage>
  );
}

/**
 * One Action Center card.
 *
 * Every row is a clickable unit and the one state that says what is owed on it,
 * gathered under its building. A manager works a building at a time and
 * identifies a lease by its unit, so that pair is the whole row — the customer
 * name, lease term and dates the card used to carry made ten cards that each had
 * to be read differently, and none of them was the thing being decided. `status`
 * is where a bucket says what it is about; `overdue` colours the ones that are
 * late rather than merely due. Clicking goes to whichever screen CLEARS the row
 * (see the link rules above), not to a generic list.
 */
function ActionBucket({
  icon: Icon, color, label, href, loading, bucket, groupBy, compact,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  color: string; label: string; href: string; loading: boolean;
  bucket?: Bucket;
  /** The row's group heading — the building, or the customer where a bucket has
   *  no unit (delayed follow-ups are customer documents, not leases). */
  groupBy: (i: ActionItem) => string;
  /** `note` is an OPTIONAL second line under the unit. Only the renewal-offers
   *  card supplies it (the offered term and the deadline month); every other
   *  bucket stays the single unit + state line the CEO asked for. */
  compact: (i: ActionItem) => { unit: string; status: string; overdue?: boolean; href?: string; note?: string };
}) {
  const count = bucket?.count ?? 0;
  const items = bucket?.items ?? [];
  // Group in render order, then sort the headings and the rows inside them, so
  // the same queue always reads the same way down the card.
  const groups = (() => {
    const m = new Map<string, ActionItem[]>();
    for (const i of items) {
      const k = groupBy(i);
      const rows = m.get(k);
      if (rows) rows.push(i); else m.set(k, [i]);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, rows]) => [
        name,
        [...rows].sort((a, b) => byUnit(compact(a).unit, compact(b).unit)),
      ] as const);
  })();
  return (
    <div className="bg-white rounded-2xl p-4 flex flex-col" style={{ boxShadow: 'var(--shadow-sm)', minHeight: 150 }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}1a` }}>
          <Icon size={15} style={{ color }} />
        </span>
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--color-neutral-700)' }}>{label}</span>
        <span className="text-xl font-bold" style={{ color: count ? color : 'var(--color-neutral-300)' }}>{loading ? '—' : count}</span>
      </div>
      {/* The card holds its ENTIRE queue and scrolls it, rather than showing the
          first few and hiding the rest behind "View all" — a bucket's whole point
          is that the manager can see everything outstanding without leaving the
          dashboard. The cap keeps every card the same height in the grid, so a
          26-row bucket doesn't stretch the row it sits in. */}
      <div className="mgr-bucket-list flex-1 overflow-y-auto" style={{ maxHeight: 260 }}>
        {loading ? (
          <p className="text-xs py-3 text-center" style={{ color: 'var(--color-neutral-300)' }}>Loading…</p>
        ) : count === 0 ? (
          <p className="text-xs py-3 text-center" style={{ color: 'var(--color-neutral-300)' }}>Nothing pending</p>
        ) : (
          // A building heading, then one line per unit — the label on the left,
          // its state on the right. The heading sticks to the top of the scroll
          // area, so a manager part-way down a long list can always see which
          // building they are reading.
          <div className="space-y-2">
            {groups.map(([building, rows]) => (
              <div key={building}>
                <div className="sticky top-0 bg-white flex items-baseline justify-between gap-2 pb-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--color-neutral-400)' }}>
                    {building}
                  </span>
                  <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--color-neutral-300)' }}>{rows.length}</span>
                </div>
                {rows.map(i => {
                  const c = compact(i);
                  const line = (
                    <div className="flex items-center justify-between gap-3 py-1 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate leading-tight" style={{ color: 'var(--color-neutral-900)' }}>{c.unit}</div>
                        {c.note && (
                          <div className="text-[10px] tabular-nums truncate leading-tight" style={{ color: 'var(--color-neutral-400)' }}>{c.note}</div>
                        )}
                      </div>
                      <span className="text-[11px] font-medium shrink-0 leading-tight" style={{ color: c.overdue ? '#b91c1c' : color }}>{c.status}</span>
                    </div>
                  );
                  // Each row opens the screen that clears it. A row without an
                  // `href` (a payload missing the ids the link needs) stays
                  // inert rather than becoming a link to nowhere.
                  return c.href ? (
                    <Link key={i.id} href={c.href} className="block rounded-lg -mx-1 px-1 hover:bg-[var(--color-base-50,#faf9f7)] transition-colors">
                      {line}
                    </Link>
                  ) : (
                    <div key={i.id}>{line}</div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      {count > 0 && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--color-base-100)' }}>
          {bucket?.truncated && (
            <p className="text-[10px] mb-1" style={{ color: 'var(--color-gold)' }}>
              Showing the first {items.length} of {count}
            </p>
          )}
          <Link href={href} className="flex items-center gap-1 text-[11px] font-medium" style={{ color }}>
            Open in {href.split('?')[0].split('/').pop()?.replace(/-/g, ' ')} <ChevronRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}
