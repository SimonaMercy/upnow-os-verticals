'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Building2, FileText, Eye, DoorOpen, AlertTriangle, ChevronRight,
  RefreshCw, LogIn, LogOut, XCircle, Clock,
  PenLine, Stamp, Banknote, Scale, MailQuestion, UserPlus,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
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
  bounced?: number; overdue?: number; deposit?: string | number | null;
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

const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '');
/** Compact form for the lease term, where the row shows both ends at once. */
const fmtDShort = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: '2-digit' }) : '');
const term = (i: ActionItem) =>
  i.startDate || i.endDate ? `${fmtDShort(i.startDate)} → ${fmtDShort(i.endDate)}` : undefined;
/** Names the side the manager has to chase, so "Awaiting Signature" says whose. */
const signer = (i: ActionItem) => {
  const who = [i.awaitingTenant ? 'customer' : null, i.awaitingLandlord ? 'landlord' : null].filter(Boolean);
  return who.length ? `Waiting on ${who.join(' & ')}` : 'Waiting on signature';
};
const place = (i: ActionItem) => [i.unit ? `Unit ${i.unit}` : null, i.building].filter(Boolean).join(' · ');

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
  //  - Anything that is a step in the lease's setup/wind-down pipeline (sign,
  //    Ejari, utility, move-in, renew, terminate, move-out) goes to Operations,
  //    which is the full working view where those steps are actually performed.
  //    Only the buckets with a dedicated screen — settlement, AMC, customer
  //    documents — go elsewhere.
  const scopeQ = (rpId?: number, extra?: string) => {
    const rp = rpId ?? scopedRp ?? null;
    const parts = [rp != null ? `rp=${rp}` : null, extra ?? null].filter(Boolean);
    return parts.length ? `?${parts.join('&')}` : '';
  };
  const opsHref = (i: ActionItem, extra?: string) =>
    `/dashboard/manager/operations/${i.id}${scopeQ(i.rpId, extra)}`;

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {/* Leads open the pipeline, so they lead the Action Center. The row's
            note is the lead's own stage and the date is when it last moved —
            oldest first from the API, so whatever has gone quiet is on top. */}
        <ActionBucket icon={UserPlus} color="#0d9488" label="Leads to progress" href={`/dashboard/manager/leads${scopeQ()}`}
          loading={actionLoading} bucket={action?.openLeads} dateLabel="last moved"
          render={i => ({
            title: place(i) || i.tenant || `Lead #${i.id}`,
            name: place(i) ? i.tenant : undefined,
            note: i.need, date: i.date,
            href: `/dashboard/manager/leads/${i.id}${scopeQ(i.rpId)}`,
          })} />
        <ActionBucket icon={PenLine} color="#7c3aed" label="Awaiting Signature" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.awaitingSignature} dateLabel="issued"
          render={i => ({ title: place(i), name: i.tenant, note: signer(i), term: term(i), date: i.date, href: opsHref(i) })} />
        <ActionBucket icon={Stamp} color="#0891b2" label="Registration Pending" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.registrationPending} dateLabel="from"
          render={i => ({ title: place(i), name: i.tenant, note: i.need, term: term(i), date: i.date, href: opsHref(i) })} />
        <ActionBucket icon={LogIn} color="#2563eb" label="Move-ins (inspection due)" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.moveIns} dateLabel="starts"
          render={i => ({ title: place(i), name: i.tenant, note: 'Move-in inspection not submitted', term: term(i), date: i.date, href: opsHref(i) })} />
        {/* Renewals to raise: nothing proposed yet, so the row deep-links into the
            renewal flow itself (?action=renew) rather than the lease's front page. */}
        {/* An active lease already past its end date with no renewal sent is the
            most overdue item in this bucket, so it is called out as such rather
            than reading like any other upcoming expiry. */}
        <ActionBucket icon={RefreshCw} color="#2e9f82" label={`Renewals to raise (≤${days}d)`} href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.renewals} dateLabel="expires"
          render={i => {
            const overdue = !!i.date && new Date(i.date) < new Date(new Date().toDateString());
            return {
              title: place(i), name: i.tenant,
              note: overdue ? `OVERDUE — ${i.need ?? 'lease already ended'}` : i.need,
              term: term(i), date: i.date, href: opsHref(i, 'action=renew'),
            };
          }} />
        {/* Offer already out — the renewal workflow lives on the PARENT lease, so
            link there, not at the pending renewal draft. The term shown is the
            OFFERED one; the date is when the lease it replaces runs out. */}
        <ActionBucket icon={MailQuestion} color="#0369a1" label="Renewal Offers — Awaiting Reply" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.renewalOffersOut} dateLabel="current ends"
          render={i => ({
            title: place(i), name: i.tenant, note: 'Waiting on customer to accept',
            term: term(i), date: i.date,
            href: `/dashboard/manager/operations/${i.parentId ?? i.id}${scopeQ(i.rpId)}`,
          })} />
        <ActionBucket icon={XCircle} color="#b91c1c" label="Termination Requests" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.terminationRequests} dateLabel="requested"
          render={i => ({ title: place(i), name: i.tenant, note: i.reason ?? 'Awaiting your response', term: term(i), date: i.date, href: opsHref(i) })} />
        <ActionBucket icon={LogOut} color="#b45309" label="Move-outs (inspection due)" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.moveOuts} dateLabel="moves out"
          render={i => ({ title: place(i), name: i.tenant, note: 'Move-out inspection not submitted', term: term(i), date: i.date, href: opsHref(i) })} />
        <ActionBucket icon={Banknote} color="#dc2626" label="Bounced / Overdue Cheques" href={`/dashboard/manager/receivables${scopeQ()}`}
          loading={actionLoading} bucket={action?.chequesAttention} dateLabel="oldest due"
          render={i => ({
            title: place(i), name: i.tenant,
            note: [i.bounced ? `${i.bounced} bounced` : null, i.overdue ? `${i.overdue} overdue` : null].filter(Boolean).join(', '),
            term: term(i), date: i.date, href: opsHref(i),
          })} />
        {/* Terminated leases with no settlement recorded. Where a deposit is
            held the amount IS the row — it is what gets refunded to close it —
            so it is stated rather than left as a generic "not settled". */}
        <ActionBucket icon={Scale} color="#0d9488" label="Settlement Pending" href={`/dashboard/manager/contracts${scopeQ()}`}
          loading={actionLoading} bucket={action?.settlementPending} dateLabel="ended"
          render={i => ({
            title: place(i), name: i.tenant,
            note: Number(i.deposit) > 0
              ? `AED ${Number(i.deposit).toLocaleString('en-AE')} held — refund to close`
              : 'No settlement recorded — no deposit held',
            term: term(i), date: i.date,
            href: `/dashboard/manager/contracts/${i.id}/settlement${scopeQ(i.rpId)}`,
          })} />
        {/* AMC Expired is deliberately NOT on this dashboard — vendor contracts
            are not lease work and every historically-expired AMC qualified, so the
            card was permanently full of items nobody was chasing. It lives on
            /dashboard/manager/amc, where it can be worked properly. The
            `amcExpired` bucket is still returned by the API for that page. */}
        {/* Follow-ups are not leases — no unit, so the requested document takes
            the prominent line the unit number holds everywhere else. */}
        <ActionBucket icon={Clock} color="#92400e" label="Delayed Follow-ups" href={`/dashboard/manager/tenants${scopeQ()}`}
          loading={actionLoading} bucket={action?.delayedFollowups} dateLabel="requested"
          render={i => ({
            title: (i.docName ?? i.doc ?? 'Document').replace(/_/g, ' '),
            name: i.tenant, note: 'Requested but not uploaded', date: i.date,
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
 * Rows read location-first: the unit number is the prominent line, because a
 * manager works a building and identifies a lease by its unit — the customer's
 * name is context, not the heading. Under it sit the name, the reason this row
 * is here (including WHO is being waited on), and on the right the lease term
 * plus the one date this bucket turns on, labelled so it can't be misread.
 */
function ActionBucket({
  icon: Icon, color, label, href, loading, bucket, render, dateLabel,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  color: string; label: string; href: string; loading: boolean;
  bucket?: Bucket; dateLabel?: string;
  render: (i: ActionItem) => {
    title: string; name?: string; note?: string | null;
    term?: string; date?: string | null; href?: string;
  };
}) {
  const count = bucket?.count ?? 0;
  const items = bucket?.items ?? [];
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
          <div className="space-y-1">
            {items.map(i => {
              const r = render(i);
              const row = (
                <div className="flex items-start justify-between gap-3 py-1.5 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold truncate leading-tight" style={{ color: 'var(--color-neutral-900)' }}>{r.title || '—'}</p>
                    {r.name && <p className="text-[10px] truncate leading-tight" style={{ color: 'var(--color-neutral-400)' }}>{r.name}</p>}
                    {r.note && <p className="text-[11px] truncate leading-tight mt-0.5 font-medium" style={{ color }}>{r.note}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {r.term && <p className="text-[10px] tabular-nums leading-tight" style={{ color: 'var(--color-neutral-500)' }}>{r.term}</p>}
                    {r.date && (
                      <p className="text-[10px] tabular-nums leading-tight" style={{ color: 'var(--color-neutral-400)' }}>
                        {dateLabel ? `${dateLabel} ` : ''}{fmtD(r.date)}
                      </p>
                    )}
                  </div>
                </div>
              );
              // Each row opens the item it names. A row without an `href` (an
              // older payload missing the ids the link needs) stays inert rather
              // than becoming a link to nowhere.
              return r.href ? (
                <Link key={i.id} href={r.href} className="block rounded-lg -mx-1 px-1 hover:bg-[var(--color-base-50,#faf9f7)] transition-colors">
                  {row}
                </Link>
              ) : (
                <div key={i.id}>{row}</div>
              );
            })}
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
