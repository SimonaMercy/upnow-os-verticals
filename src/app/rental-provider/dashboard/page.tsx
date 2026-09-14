/**
 * Rental Provider — Overview Dashboard (rental-provider/dashboard)
 *
 * Top-level RP dashboard. Hero with range tabs, KPI strip (hero receivables +
 * occupancy + active orders + renewals due), occupancy gauge, receivables vs
 * collected bars, quick actions, and dynamic activity / upcoming-renewals lists.
 *
 * Data sources (all re-fetch on range change where range-scoped):
 *   /properties/dashboard-stats        (range-scoped portfolio counts)
 *   /contracts/financial-summary       (range-scoped money + chart)
 *   /contracts/dashboard-extras        (renewals list + activity feed)
 *   /fee-rules/configured              (setup nudge)
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Building2, DoorOpen, Percent, X, TrendingUp, TrendingDown, ArrowUpRight, AlertTriangle, Eye, RefreshCw, ShieldCheck, Users, UserCog, Clock, FileText } from 'lucide-react';
import { DirhamSign } from '@/components/ui/DirhamSign';
import { contractHref, type ContractSurface } from '@/lib/contractHref';
import { unitHref } from '@/lib/unitHref';
import Link from 'next/link';

interface DashboardStats {
  totalProperties: number;
  totalUnits: number;
  occupied: number;
  available: number;
  maintenance: number;
  reserved: number;
  occupancyRate: number;
  /** Σ every unit's ASKING price — what the book would ask if it re-let today.
   *  `pricedUnits` must be shown with it: an unpriced unit contributes 0, so on
   *  a portfolio with any of those the total is a floor, not the answer. */
  marketRent?: number;
  pricedUnits?: number;
  rentPositioning?: RentPositioning;
  activeContracts: number;
  renewalsDue90Days: number;
  /** Distinct customers across this landlord's contracts — the same population
   *  the Customers page lists. */
  totalCustomers?: number;
  /** Live leases, one per unit — the tenancies those customers are on. Higher
   *  than `totalCustomers` by however many customers hold more than one unit. */
  activeLeases?: number;
  /** Managers with LIVE access (manager_permissions.is_active), not every
   *  permission row ever granted. */
  totalManagers?: number;
  units?: UnitRow[];
  vacancy?: VacancyTotals;
}

/** Portfolio-level vacancy roll-up. `priced` is how many of the empty units
 *  carry a rent to value the loss at — `lostIncome` sums only those, so the two
 *  have to be shown together or the total silently reads as the whole story. */
interface VacancyTotals {
  units: number;
  priced: number;
  neverLeased: number;
  avgDaysVacant: number;
  longestDaysVacant: number;
  lostIncome: number;
}

/** How far the LET stock sits below its own asking rents, per unit type. Only
 *  units that are both let and priced are in it, each compared against its own
 *  asking price — see rent-positioning.ts for why the portfolio page's
 *  all-units-asking vs let-only-contracted figure is not the same number. */
interface RentPositioning {
  units: number;
  below: number;
  contracted: number;
  asking: number;
  gapPct: number | null;
  byType: Array<{ type: string; units: number; below: number; contracted: number; asking: number; gapPct: number | null }>;
  worst: { type: string; units: number; below: number; gapPct: number | null } | null;
}

// The unit-type label map that lived here is gone with the Rent vs Market
// sub-line it existed for. `byType` and `worst` are still on the payload — Rent
// vs Asking uses them, where a per-type breakdown sits next to the per-building
// detail that makes it actionable.

interface UnitRow {
  id: number;
  number: string | null;
  name: string | null;
  building: string | null;
  availability: string;
  listingStatus: string;
  /** Who is in it and until when — populated for OCCUPIED units only (see the
   *  API's UnitTenancy). `daysToEnd` is signed: negative means the term has
   *  lapsed while the unit is still occupied, i.e. an overdue renewal.
   *  `daysToStart` is positive only on an incoming signed tenancy — the lease
   *  that has the unit marked occupied before the tenant has moved in. */
  contractId?: number | null;
  tenant?: string | null;
  startsOn?: string | null;
  daysToStart?: number | null;
  endsOn?: string | null;
  daysToEnd?: number | null;
  /** Vacancy duration + cost — populated for vacant units only (see the API's
   *  UnitVacancy). `basis` distinguishes "empty since a tenancy ended" from
   *  "never let since it was added", which are different problems. */
  vacantSince?: string | null;
  daysVacant?: number | null;
  basis?: 'lease-end' | 'never-leased' | null;
  lostIncome?: number;
  rentBasis?: 'asking' | 'last-lease' | null;
  annualRent?: number | null;
}

type BadgeTone = 'green' | 'amber' | 'red' | 'indigo' | 'gray';

/** A renewal row's state badge, from its bucket — the same four states the
 *  Upcoming Renewals card counts, so a row can never contradict the tile that
 *  was clicked to reach it.
 *
 *  This replaced a badge derived from `renewal_status` alone, which mapped
 *  anything other than 'proposed'/'draft' to "Pending". A lease whose successor
 *  was already issued and only waiting to commence therefore read "Pending"
 *  inside the Renewed list. The bucket knows about the successor and the
 *  termination response; `renewal_status` does not. */
function bucketBadge(x: Pick<UpcomingRenewal, 'bucket' | 'runningUnsigned'>): { label: string; tone: BadgeTone } {
  // Counted under Notice Sent, but named for what it is: the new term is already
  // running without a signature or a confirmed payment.
  if (x.runningUnsigned) return { label: 'Running, not signed', tone: 'amber' };
  const b = RENEWAL_BUCKETS.find(k => k.key === (x.bucket ?? 'noticeDue'));
  return { label: b?.label ?? 'Notice due', tone: b?.tone ?? 'amber' };
}

interface DrillRow {
  key: string | number;
  title: string;
  subtitle?: string;
  href?: string;
  badges?: { label: string; tone: BadgeTone }[];
  /** The row's money, rendered in its OWN right-aligned column rather than
   *  glued onto the end of `title`. Amounts appended to a name cannot line up,
   *  so a list of them can only be read one row at a time — which is what made
   *  the Receivables drill-down unscannable. */
  amount?: string;
}
interface DrillState {
  title: string;
  note?: string;
  loading?: boolean;
  groups: { label?: string; rows: DrillRow[] }[];
  /** A custom section rendered in place of the row list — for a drill-down whose
   *  records carry a measure worth plotting rather than just naming (vacancy
   *  duration). A drill supplies `panel` OR `groups`, not both: two renderings
   *  of the same six records in one dialog is not a richer dialog. */
  panel?: React.ReactNode;
  /** The headline figure, stated once and large. */
  headline?: string;
  /** The headline broken into its parts — shown as a row of figures under it.
   *  These used to be buried mid-sentence in `note` ("AED 122,550 already
   *  collected · AED 223,625 still outstanding — none of it past due"), where
   *  the three numbers the dialog exists to separate were prose. */
  summary?: { label: string; value: string; tone?: 'green' | 'amber' | 'red' }[];
}

/** A cheque behind one of the two arrears KPIs. `kind` says which — the tiles
 *  drill into the same array, filtered. */
interface ArrearsCheque {
  id: number;
  contractId: number;
  amount: number;
  dueDate: string | null;
  chequeNumber: string | null;
  kind: 'overdue' | 'bounced';
  customer: string | null;
  unitLabel: string | null;
  buildingName: string | null;
  /** >0 only on a bounce PART made good — the remainder is still owed. */
  coveredAmount: number;
  /** `locked_at IS NOT NULL` on the cheque's lease — which of the two contract
   *  surfaces the row opens. Server-decided; the client cannot see `locked_at`.
   *  Optional so an older payload falls back to the register rather than 404ing. */
  locked?: boolean;
}

/** A cheque behind the Receivables KPI. `state` splits the headline into the
 *  three things it actually contains — see `receivablesSplit`. */
interface ReceivableCheque {
  id: number;
  contractId: number;
  amount: number;
  dueDate: string | null;
  chequeNumber: string | null;
  state: 'collected' | 'overdue' | 'due';
  customer: string | null;
  unitLabel: string | null;
  buildingName: string | null;
  /** Which contract surface the row opens — see ArrearsCheque.locked. */
  locked?: boolean;
}

interface FinancialSummary {
  receivablesInRange: number;
  /** collected + overdue + due === receivablesInRange. */
  receivablesSplit: Record<'collected' | 'overdue' | 'due', { amount: number; count: number }>;
  receivableCheques: ReceivableCheque[];
  overdueOrBounced: number;
  /** The two halves of it, reported separately — a cheque whose date has passed
   *  and a cheque the bank refused are different problems. */
  overdueCount: number;
  overdueAmount: number;
  bouncedCount: number;
  bouncedAmount: number;
  /** The rows behind both arrears tiles, stamped with which one they belong to. */
  arrearsCheques: ArrearsCheque[];
  depositsHeld: number;
  /** How many contracts that held money sits across. */
  depositsHeldCount: number;
  /** Contracted annual rent of the earning leases (one per unit) and how many
   *  there are — the rent roll. A live snapshot: it does NOT follow the range
   *  tabs, and it is deliberately not the same figure as `receivablesInRange`
   *  (see the Annual Rent tile). Sums to Leases by Year across all its years. */
  annualRentRoll: number;
  earningLeases: number;
  rangeStart: string;
  rangeEnd: string;
  chartData: Array<{ m: string; receivable: number; collected: number }>;
}

interface UpcomingRenewal {
  contractId: number;
  unitLabel: string;
  tenantName: string | null;
  /** The EXPIRING term. `startDate` is optional because older payloads only
   *  carried the end date. */
  startDate?: string | null;
  endDate: string;
  /** The term that was OFFERED — the renewal record's own dates. Null until a
   *  renewal exists (notice due / vacating). */
  renewalStartDate?: string | null;
  renewalEndDate?: string | null;
  daysUntilEnd: number;
  /** The day that puts the row in its month: the renewal's due date, or — for a
   *  unit already renewed, a renewal running but not signed, or a new customer —
   *  the day its term started. The API decides it the same way Renewal Plan -
   *  Yearly and the Upcoming Renewals report do. Older payloads omit it. */
  placedOn?: string;
  placedBy?: 'due' | 'start';
  /** A renewal whose term has begun but is neither activated nor paid for. */
  runningUnsigned?: boolean;
  renewalStatus: string | null;
  /** The offer has actually gone out and is waiting on the customer — the API
   *  decides this (it can see `renewalAccepted`, which is not sent to us). */
  offerSent?: boolean;
  /** Which of the four states this lease is in. */
  bucket?: RenewalBucket;
  /** Where the renewal work actually is — the API resolves the successor and
   *  whether it has been blessed into the register (it can see `locked_at`).
   *  Older payloads omit both, so the row falls back to the expiring lease. */
  openContractId?: number;
  openIn?: ContractSurface;
}

/** `/reports/manager-time-per-day` — sessionised working time, not a timesheet. */
interface ManagerTimeData {
  windowDays: number;
  idleCapMinutes: number;
  managers: Array<{
    userId: number;
    name: string;
    /** Averaged over days they were ACTIVE, not over the whole window. */
    avgMinutesPerDay: number;
    activeDays: number;
    totalMinutes: number;
    pageViews: number;
    /** Works for more than one landlord — page views carry no landlord scope,
     *  so their reading time is counted on each landlord's dashboard. */
    sharedAcrossLandlords: boolean;
    lastActive: string | null;
  }>;
}

interface ActivityItem {
  kind: 'payment' | 'viewing' | 'contract';
  tone: 'good' | 'warn' | 'info';
  title: string;
  subtitle: string;
  at: string;
  href?: string;
}

interface DashboardExtras {
  upcomingRenewals: UpcomingRenewal[];
  /** Counts per renewal state. A PARTITION — the four sum to the list length,
   *  which is what lets them be read as a breakdown of the headline. */
  renewalBuckets?: Record<RenewalBucket, number>;
  recentActivity: ActivityItem[];
}

/** The four states a lease coming up for renewal can be in. Decided server-side
 *  (see renewal-bucket.ts) because the call needs the termination response and a
 *  successor-lease lookup, neither of which is in this payload. */
type RenewalBucket = 'renewed' | 'noticeSent' | 'noticeDue' | 'newCustomer' | 'vacating';

/** Display order and copy. `noticeDue` is the only bucket that is the LANDLORD's
 *  own next action, so it is the one tinted as work; Notice Sent is a wait on
 *  the customer, and renewed/vacating are settled outcomes. */
const RENEWAL_BUCKETS: Array<{
  key: RenewalBucket; label: string; hint: string; tone: BadgeTone;
}> = [
  // "Renewed", not "Renewing" — the outcome, not the activity. A lease whose
  // successor is issued and only waiting to commence has finished its renewal
  // cycle; "Renewing" read as work still in progress, which is what Notice Sent
  // is waiting on. "Notice Sent" pairs with "Notice due" so the two halves of
  // the same step read as one, and matches the Operations board's own lane name.
  { key: 'renewed',    label: 'Renewed',     hint: 'agreed — starts at term end',  tone: 'green' },
  { key: 'noticeSent', label: 'Notice Sent', hint: 'awaiting the customer',        tone: 'indigo' },
  { key: 'noticeDue',  label: 'Notice due',  hint: 'nobody asked yet — your move', tone: 'amber' },
  // A new customer's first lease starting in the window. The card counts renewals
  // the Renewal Plan way (decided 14 Sep 2026), which places such a unit by the
  // term that starts; customers who are leaving count as vacant, not here.
  { key: 'newCustomer', label: 'New customer', hint: 'a first lease starting',     tone: 'gray' },
  // Declined before any termination was started: still a let unit, so still in
  // the count. The tile shows only when there is one.
  { key: 'vacating',    label: 'Declined',     hint: 'said no — start the termination', tone: 'red' },
];

/** One thing a manager did, from the audit trail. `at` is when they did it and
 *  `generatedAt` is when the server read the feed — ages are measured against
 *  the server's clock, not the browser's, so a skewed laptop cannot make an
 *  action look older or newer than it was. */
interface FeedEntry {
  id: number;
  at: string;
  /** Earliest time in a collapsed run — the row reads "09:11\u201309:14" rather
   *  than pretending three saves happened at one instant. */
  firstAt: string;
  /** Asia/Dubai calendar day, decided server-side so the browser's zone cannot
   *  file a 1am action under yesterday. */
  day: string;
  label: string;
  /** The tinted tag on the row \u2014 Contracts, Payments, Session\u2026 */
  category: string;
  /** >1 when the row stands for a run of the same action on the same record.
   *  The API folds those so a burst of sign-ins cannot BE a manager's column. */
  repeats?: number;
  why: string | null;
  /** Field-level diff behind the row, for the click-through. Null when the
   *  action captured none \u2014 most do not. */
  changes: Array<{ field: string; from: string | null; to: string | null }> | null;
  subject: string | null;
  contractId: number | null;
  leadId: number | null;
}
/** One manager's own slice. Every roster member is present whether or not they
 *  have done anything recently — a manager who has been quiet is a thing the
 *  landlord needs to see, and dropping the empty ones hides exactly that. */
interface ManagerLane {
  userId: number;
  name: string | null;
  lastAt: string | null;
  /** Actions per Dubai day across ALL of that day's rows — including the ones
   *  the per-day cap left out, so a capped day still reports its real total.
   *  CHANGES only; pages opened are counted in `dayViews`. */
  dayTotals: Array<{ day: string; count: number }>;
  /** Pages opened per Dubai day. Deliberately NOT folded into `dayTotals`:
   *  reading a page is not work delivered, and adding the two would let a busy
   *  reader outrank a manager who actually moved leases. Optional so the panel
   *  survives a payload from a build that predates the reading side. */
  dayViews?: Array<{ day: string; count: number }>;
  entries: FeedEntry[];
}
interface ManagerFeed {
  generatedAt: string;
  /** Every Dubai calendar day in the window, newest first, INCLUDING the days
   *  nobody touched — this is what makes the panel date-by-date rather than a
   *  list of whichever dates survived a row limit. */
  window: string[];
  managers: ManagerLane[];
}

/** The feed covers the CURRENT day only — what each manager has done today, not
 *  a week of history. The window mechanism stays at 1 rather than being removed:
 *  it is what still puts today's heading on a manager who has done nothing yet,
 *  so an idle manager reads as "no activity today" instead of vanishing from the
 *  panel. The Manager Operations report is where the back-days live. */
const FEED_DAYS = 1;

/** How often the live feed re-reads. 5s is what the landlord asked for and what
 *  the endpoint was built to survive: one LIMITed indexed query, no window
 *  functions, no board. Polling `reports/activity-log` at this rate instead
 *  would put the heaviest read in the product on a loop. */
const FEED_POLL_MS = 5_000;

/** Every link on this page leaves it. The dashboard is a monitoring surface —
 *  the landlord checks a figure, opens the record behind it, and comes back to
 *  the next figure — so following one must not cost the range, the renewal
 *  horizon or the scroll position that was set to read it. `rel` travels with
 *  `target` always: a bare _blank hands the opened page `window.opener`. */
const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;


function fmtAed(n: number) {
  // TWO decimals in the abbreviations, and the trailing zero is kept.
  //
  // One decimal was already a fix — .toFixed(0) turned AED 1,500 into "2K" — but
  // it still cost real precision at the top of the scale, where a tenth of a
  // million is 100,000: the portfolio's 9,852,000 read "9.9M" and 7,101,420 read
  // "7.1M", so the two headline figures on the Rent vs Market card were each up
  // to 50,000 away from the number the reports beside them state.
  //
  // `.replace(/\.0$/, '')` is deliberately gone with it. Trimming "7.10M" to
  // "7.1M" would put a one-decimal figure next to a two-decimal one in the same
  // row of tiles and make them look like different precisions of the same thing.
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(2)}K`;
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE, month: 'short', day: 'numeric' });
}

/** "4 months", "1y 2m" — days stop meaning anything past a couple of quarters.
 *  The cut is at 90 days, not 60, so that a list of vacancies is comparable:
 *  most real ones sit inside a quarter, and mixing "67 days" against "2 months"
 *  in the same sorted column makes the reader convert units to rank two rows. */
function fmtDuration(days: number) {
  if (days < 1) return 'today';
  if (days < 90) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}m` : `${years} year${years === 1 ? '' : 's'}`;
}

/** Bar colour for a vacancy of this length. 30 and 90 days are the thresholds
 *  the vacancy is judged on — under a month is turnover, past a quarter it is a
 *  letting problem — and the duration is written beside every bar, so the tint
 *  is a second reading of severity and never the only one.
 *
 *  Neutral / amber / red, never the primary green: green is "Occupied" on the
 *  donut this list belongs to, and a green vacancy bar would read as the
 *  opposite of what it measures. */
function vacancyFill(days: number): string {
  return days >= 90 ? '#dc2626' : days >= 30 ? '#d97706' : 'var(--neutral-400)';
}

function fmtDayMonthYear(ymd: string) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, {
    timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** "How long they've been empty" — the vacant units as a duration measure
 *  rather than a list of names. Bars are one series (days empty) scaled to the
 *  longest one and sorted worst-first, so the ranking is the point and reading
 *  an axis is not required; the duration, the date it went empty and the money
 *  it has cost sit on the row beside each bar. */
function VacancyBars({ units, totals, manager }: {
  units: UnitRow[];
  totals?: VacancyTotals;
  manager?: { rp: number };
}) {
  const longest = totals?.longestDaysVacant || Math.max(1, ...units.map(u => u.daysVacant ?? 0));
  return (
    <div className="px-2 pb-1">
      <div className="flex items-baseline justify-between px-1 pt-1 pb-3">
        <h4 className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)]">
          How long they&apos;ve been empty
        </h4>
        {totals && totals.lostIncome > 0 && (
          <span className="text-[11.5px] font-semibold text-[var(--neutral-700)] tabular-nums">
            {fmtAed(totals.lostIncome)} foregone
          </span>
        )}
      </div>
      <div className="space-y-1">
        {units.map(u => {
          const days = u.daysVacant ?? 0;
          const pct = Math.max(4, Math.round((days / longest) * 100));
          const fill = vacancyFill(days);
          const label = u.number ? `Unit ${u.number}` : (u.name ?? `Unit ${u.id}`);
          const inner = (
            <>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-semibold text-[var(--neutral-900)] truncate">
                  {label}
                  <span className="font-normal text-[var(--neutral-400)]"> · {u.building ?? '—'}</span>
                </span>
                <span className="flex-shrink-0 flex items-baseline gap-2">
                  <span className="tabular-nums text-[var(--neutral-700)]">{fmtDuration(days)}</span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: DRILL_TONE[u.listingStatus === 'published' ? 'green' : 'amber'].bg,
                      color: DRILL_TONE[u.listingStatus === 'published' ? 'green' : 'amber'].fg,
                    }}
                  >
                    {u.listingStatus === 'published' ? 'Published' : `Not listed · ${u.listingStatus}`}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2.5">
                <div className="flex-1 h-1.5 rounded-full bg-[var(--base-200)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: fill }} />
                </div>
                {/* Since-when and the cost, on the row the bar belongs to. A unit
                    with no rent on file is not a free vacancy — it says so
                    rather than showing AED 0. */}
                <span className="flex-shrink-0 text-[11px] tabular-nums text-[var(--neutral-400)]">
                  {u.basis === 'never-leased' ? 'never let' : `since ${u.vacantSince ? fmtDayMonthYear(u.vacantSince) : '—'}`}
                  {' · '}
                  {u.rentBasis == null ? 'no rent set' : `−${fmtAed(u.lostIncome ?? 0)}`}
                </span>
              </div>
            </>
          );
          // Both portals navigate now. The row used to be dead in the manager
          // portal because the old standalone unit page was an RP-only route;
          // the destination is the Units workspace, which the manager portal
          // renders too, so there is no RP-only surface left to dead-end on.
          return <Link key={u.id} href={unitHref(u.id, manager)} {...NEW_TAB} className="block px-3 py-2.5 rounded-lg hover:bg-[var(--base-100)]">{inner}</Link>;
        })}
      </div>
    </div>
  );
}

// The by-building unit grouping (unitGroups / unitDrillRow / AVAIL_TONE) went
// with the two drills it served: Units now links to the Units page, and the
// vacant drill renders VacancyBars, which carries each unit's building on its
// own row. The Units page is where a grouped, filterable unit list belongs.

/** Renewal horizons, same set as the Upcoming Renewals report (lease-expiry), so
 *  a landlord who checks the tile against the report is comparing like with like.
 *  Kept in sync with RENEWAL_WINDOWS in the backend contracts controller. */
const RENEWAL_WINDOWS = [30, 60, 90, 180, 365] as const;
type RenewalWindow = (typeof RENEWAL_WINDOWS)[number];

type RangePreset =
  | 'this_month' | 'last_month' | 'last_3m' | 'last_6m'
  | 'next_month' | 'next_3m' | 'next_6m'
  | 'this_year' | 'all_time';

/** Backward, then forward, then the two whole-book ranges. The forward presets
 *  matter on a PDC book: most of the rent is already written as post-dated
 *  cheques, so "what is coming" is as real a figure as "what has come". */
const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_3m',    label: 'Last 3M' },
  { key: 'last_6m',    label: 'Last 6M' },
  { key: 'next_month', label: 'Next Month' },
  { key: 'next_3m',    label: 'Next 3M' },
  { key: 'next_6m',    label: 'Next 6M' },
  { key: 'this_year',  label: 'This Year' },
  { key: 'all_time',   label: 'All Time' },
];

/**
 * Every preset is a WHOLE number of calendar months, so the Receivables KPI is
 * the same money the Cash Management report shows for those months.
 *
 * These ranges used to end TODAY. "This Month" therefore reported the rent that
 * had fallen due so far — on 4 August it read AED 120,550 against a real August
 * receivable of AED 346,175, and it would have read a different figure every
 * morning until the 31st. Rent falls due on a cheque date, not on the date you
 * happen to open the dashboard: a month's receivable is the whole month, and the
 * part still ahead of today is exactly the part worth looking at.
 */
function presetToDates(preset: RangePreset): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const y = now.getFullYear();
  const m = now.getMonth();
  /** Day 0 of next month = the last day of month `mm`. */
  const monthEnd = (yy: number, mm: number) => fmt(new Date(yy, mm + 1, 0));

  switch (preset) {
    case 'this_month':
      return { from: fmt(new Date(y, m, 1)), to: monthEnd(y, m) };
    case 'last_month':
      return { from: fmt(new Date(y, m - 1, 1)), to: monthEnd(y, m - 1) };
    case 'last_3m':
      return { from: fmt(new Date(y, m - 2, 1)), to: monthEnd(y, m) };
    case 'last_6m':
      return { from: fmt(new Date(y, m - 5, 1)), to: monthEnd(y, m) };
    // Forward ranges start NEXT month, mirroring the backward ones which end
    // with THIS one — so no preset double-counts the current month against its
    // neighbour, and "Next 3M" is three whole months you have not billed yet.
    case 'next_month':
      return { from: fmt(new Date(y, m + 1, 1)), to: monthEnd(y, m + 1) };
    case 'next_3m':
      return { from: fmt(new Date(y, m + 1, 1)), to: monthEnd(y, m + 3) };
    case 'next_6m':
      return { from: fmt(new Date(y, m + 1, 1)), to: monthEnd(y, m + 6) };
    case 'this_year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'all_time':
      // Cash Management imposes no window at all — it runs from the earliest to
      // the latest cheque on the book. Bracket the book rather than clamp it, so
      // post-dated cheques years out are inside "All Time" too.
      return { from: '2000-01-01', to: '2100-12-31' };
  }
}

export function RpDashboardHome({ manager }: { manager?: { rp: number } }) {
  const { user } = useAuth();
  // `name` is gone with the greeting it fed — nothing else on this page uses it.
  // Manager mode: reuse the landlord-scoped /manager/* endpoints (?rp=) and link
  // into the manager portal. Fee-rules nudge is RP-only.
  const rpQ = manager ? `rp=${manager.rp}&` : '';
  const contractBase = manager ? '/dashboard/manager/contracts' : '/rental-provider/dashboard/contracts';
    // The pages the Properties and Units tiles hand off to — the same destinations
  // the sidebar's Properties / Units entries point at, manager routes included,
  // so the tile and the nav item never land somewhere different.
  const leadsBase = manager ? '/dashboard/manager/leads' : '/rental-provider/dashboard/leads';
  const propertiesHref = manager ? `/dashboard/manager/properties?rp=${manager.rp}` : '/rental-provider/dashboard/portfolio';
  const unitsHref = manager ? `/dashboard/manager/units?rp=${manager.rp}` : '/rental-provider/dashboard/units';
  const customersHref = manager ? `/dashboard/manager/tenants?rp=${manager.rp}` : '/rental-provider/dashboard/tenants';
  /** Active Leases opens the LEASES register, not Customers — the tile counts
   *  tenancies, so the page it opens must be the one that lists tenancies. The
   *  sidebar files that register under "Leases" at the /orders route. */
  const leasesHref = manager ? `/dashboard/manager/contracts?rp=${manager.rp}` : '/rental-provider/dashboard/orders';
  /** Managers are administered from the landlord's own settings — there is no
   *  manager-portal equivalent, and a manager has no business managing the list
   *  of managers, so the tile does not link in that portal. */
  const managersHref = manager ? null : '/rental-provider/dashboard/settings?tab=team';
  /** Rent vs Market opens the report the two figures come from. The manager
   *  portal has no per-slug report routes — its hub takes the report inline on
   *  ?slug= — so the two portals reach it by different means rather than one of
   *  them landing on a 404. */
  const rentVsMarketHref = manager
    ? `/dashboard/manager/reports?rp=${manager.rp}&slug=rent-vs-market`
    : '/rental-provider/dashboard/reports/rent-vs-market';
  /**
   * SCRUM-737 — Receivables is OFF this dashboard (CEO feedback, 11 Aug 2026).
   * Hidden rather than deleted: the card, its period select, the cheque
   * drill-down behind it and the report link are all still here and correct, so
   * putting it back is this one line. The figure itself is not gone from the
   * platform — Cash Management (`rent-receivable`) is the same money on the same
   * basis, month by month, and remains under Reports.
   *
   * The month-by-month Receivables vs Collected bars the ticket also names went
   * earlier, for their own reasons (see the Money section note below); the API
   * still returns `chartData`, which nothing now reads.
   */
  const SHOW_RECEIVABLES = false;

  /** Receivables → Cash Management (report slug `rent-receivable`). Same money,
   *  same basis — the card is the headline, the report is the working. */
  const cashManagementHref = manager
    ? `/dashboard/manager/reports?rp=${manager.rp}&slug=rent-receivable`
    : '/rental-provider/dashboard/reports/rent-receivable';
  /** "View all N renewals" opens the Renewal pipeline in Operations, not a list
   *  overlay. The overlay could only name the leases; the pipeline is where the
   *  renewal is actually worked, stage by stage. The per-bucket tiles above it
   *  still drill, because those are a filtered slice the pipeline has no tab for. */
  const renewalsPipelineHref = manager
    ? `/dashboard/manager/operations?rp=${manager.rp}&tab=renewal`
    : '/rental-provider/dashboard/operations?tab=renewal';
  /** Deposits Held → the Security Deposits report, which is where HELD_DEPOSIT_SQL
   *  (the figure on the card) is broken down property by property. */
  const depositsHref = manager
    ? `/dashboard/manager/reports?rp=${manager.rp}&slug=security-deposits`
    : '/rental-provider/dashboard/reports/security-deposits';
  // No mapHref: it rewrote the old Recent Activity feed's RP-portal paths into
  // the manager namespace, and that feed is gone. The live feed builds its own
  // links from `contractBase`, which is already the right portal's.
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [fin, setFin] = useState<FinancialSummary | null>(null);
  const [extras, setExtras] = useState<DashboardExtras | null>(null);
  const [selectedRange, setSelectedRange] = useState<RangePreset>('this_month');
  const [renewalWindow, setRenewalWindow] = useState<RenewalWindow>(90);
  const [feeRulesConfigured, setFeeRulesConfigured] = useState<boolean | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  // Per-fetch loading + error tracking so each section can show its own state.
  // NOTE: setState only happens in the catch/then path (post-await) to keep the
  // react-hooks/set-state-in-effect rule happy.
  const [feed,        setFeed]        = useState<ManagerFeed | null>(null);
  const [feedErr,     setFeedErr]     = useState<string | null>(null);
  const [timePerDay,  setTimePerDay]  = useState<ManagerTimeData | null>(null);
  const [statsErr,    setStatsErr]    = useState<string | null>(null);
  const [finErr,      setFinErr]      = useState<string | null>(null);
  const [extrasErr,   setExtrasErr]   = useState<string | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);

  const fetchStats = useCallback(async (preset: RangePreset, signal?: AbortSignal) => {
    const { from, to } = presetToDates(preset);
    try {
      const r = await fetch(`/api/${manager ? 'manager/dashboard-stats' : 'properties/dashboard-stats'}?${rpQ}from=${from}&to=${to}`, { credentials: 'include', signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data && typeof data.totalUnits === 'number') {
        setStats(data);
        setStatsErr(null);
      } else {
        throw new Error('Malformed response');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setStatsErr((e as Error).message || 'Failed to load portfolio stats');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpQ]);

  const fetchFinancial = useCallback(async (preset: RangePreset, signal?: AbortSignal) => {
    const { from, to } = presetToDates(preset);
    try {
      const r = await fetch(`/api/${manager ? 'manager/financial-summary' : 'contracts/financial-summary'}?${rpQ}from=${from}&to=${to}`, { credentials: 'include', signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data && typeof data.receivablesInRange === 'number') {
        setFin(data);
        setFinErr(null);
      } else {
        throw new Error('Malformed response');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setFinErr((e as Error).message || 'Failed to load financials');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpQ]);

  const fetchExtras = useCallback(async (preset: RangePreset, win: RenewalWindow, signal?: AbortSignal) => {
    const { from, to } = presetToDates(preset);
    try {
      const r = await fetch(`/api/${manager ? 'manager/dashboard-extras' : 'contracts/dashboard-extras'}?${rpQ}from=${from}&to=${to}&window=${win}`, { credentials: 'include', signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: DashboardExtras = await r.json();
      if (data && Array.isArray(data.recentActivity)) {
        setExtras(data);
        setExtrasErr(null);
      } else {
        throw new Error('Malformed response');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setExtrasErr((e as Error).message || 'Failed to load activity');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpQ]);

  const fetchFeed = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch(`/api/${manager ? 'manager/manager-activity' : 'reports/manager-activity'}?${rpQ}days=${FEED_DAYS}&perDay=20`, { credentials: 'include', signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: ManagerFeed = await r.json();
      if (!data || !Array.isArray(data.managers)) throw new Error('Malformed response');
      setFeed(data);
      setFeedErr(null);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // A failed POLL must not blank the feed: it re-fires in 5 seconds, and
      // replacing twelve good rows with an error banner on one dropped request
      // would make the panel flicker between working and broken. The error is
      // only shown while there is nothing to show.
      setFeedErr((e as Error).message || 'Failed to load activity');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpQ]);

  const fetchFeeRules = useCallback(async (signal?: AbortSignal) => {
    if (manager) return; // fee-rules nudge is RP-only
    try {
      const r = await fetch('/api/fee-rules/configured', { credentials: 'include', signal });
      if (!r.ok) return;
      const d: { configured: boolean } = await r.json();
      setFeeRulesConfigured(d.configured);
    } catch { /* fee-rules nudge is best-effort, ignore */ }
  }, []);

  // Re-fire range-scoped fetches whenever the user picks a different range.
  useEffect(() => {
    const ac = new AbortController();
    fetchStats(selectedRange, ac.signal);
    fetchFinancial(selectedRange, ac.signal);
    fetchExtras(selectedRange, renewalWindow, ac.signal);
    return () => ac.abort();
  }, [selectedRange, renewalWindow, fetchStats, fetchFinancial, fetchExtras]);

  useEffect(() => {
    const ac = new AbortController();
    fetchFeeRules(ac.signal);
    return () => ac.abort();
  }, [fetchFeeRules]);

  // The live feed, on its own timer — it is not range-scoped (an activity feed
  // showing "last month" is not live) so it never re-fires on a range change.
  //
  // The poll pauses while the tab is hidden and re-reads the moment it comes
  // back: a dashboard left open overnight would otherwise fire ~17,000 requests
  // at nobody, and browsers throttle background timers unevenly anyway, so the
  // feed would come back stale by an unknown amount rather than by 5 seconds.
  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => { void fetchFeed(ac.signal); }, FEED_POLL_MS);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      void fetchFeed(ac.signal);
      start();
    };
    void fetchFeed(ac.signal);
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      ac.abort();
    };
  }, [fetchFeed]);

  // Manager working time — a 30-day aggregate, so it is fetched ONCE and not
  // put on the feed's 5-second poll: the number cannot move meaningfully within
  // a session, and polling it would triple the dashboard's query load to redraw
  // the same figure. Landlord-only, like the other manager-performance reads
  // (the manager portal 403s them by design), so it is skipped in manager mode.
  useEffect(() => {
    if (manager) return;
    const ac = new AbortController();
    fetch('/api/reports/manager-time-per-day?days=30', { credentials: 'include', signal: ac.signal })
      .then(r => (r.ok ? r.json() : null))
      .then((d: ManagerTimeData | null) => { if (d && Array.isArray(d.managers)) setTimePerDay(d); })
      .catch(() => { /* the panel simply does not render */ });
    return () => ac.abort();
  }, [manager]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchStats(selectedRange),
        fetchFinancial(selectedRange),
        fetchExtras(selectedRange, renewalWindow),
        fetchFeeRules(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [selectedRange, renewalWindow, fetchStats, fetchFinancial, fetchExtras, fetchFeeRules]);

  const occupied         = stats?.occupied ?? 0;
  const available        = stats?.available ?? 0;
  const totalUnits       = stats?.totalUnits ?? 0;
  const totalProperties  = stats?.totalProperties ?? 0;
  const totalCustomers   = stats?.totalCustomers ?? 0;
  const activeLeases     = stats?.activeLeases ?? 0;
  const totalManagers    = stats?.totalManagers ?? 0;
  const occupancyRate    = stats?.occupancyRate ?? 0;
  // Until the figures arrive the tiles read "…", never 0 — a slow load must not
  // look like an empty portfolio.
  const statsReady       = stats != null;
  const shown            = (n: number) => (statsReady ? String(n) : '…');
  const renewalsList     = extras?.upcomingRenewals ?? [];
  const units            = stats?.units ?? [];
  // Vacancy roll-up. Absent on an older payload — every read of it is guarded so
  // the dashboard degrades to the plain counts rather than rendering "0 days".
  const vacancyTotals    = stats?.vacancy;
  const rentPos          = stats?.rentPositioning;
  /** Every unit's rental value, no occupancy filter — the Market side of the
   *  Rent vs Market card, and the same figure Rent vs Asking leads with. NOT
   *  `rentPos.asking`, which is the narrower like-for-like subtotal over let
   *  units only; the two differ by the asking price of unlet stock. */
  const marketRent       = stats?.marketRent ?? null;
  /** How far the earning book sits below what the portfolio is priced at, as a
   *  share of that price. Computed here rather than read off `rentPos.gapPct`,
   *  which divides by the narrower asking total and so reports a smaller gap. */
  const marketGapPct     = marketRent && marketRent > 0 && rentPos
    ? ((marketRent - rentPos.contracted) / marketRent) * 100
    : null;
  // The empty units, worst first — this is the list the Vacancy panel renders
  // and the order it is judged in: longest empty, then most money foregone.
  // Plain derivation, not useMemo: `units` is rebuilt from `stats` on every
  // render, so memoising on it would recompute every time anyway.
  const vacantUnits      = units
    .filter(u => u.availability === 'available')
    .sort((a, b) => (b.daysVacant ?? 0) - (a.daysVacant ?? 0) || (b.lostIncome ?? 0) - (a.lostIncome ?? 0));
  const [drill, setDrill] = useState<DrillState | null>(null);

  // Drill-down openers — KPI tiles show the records behind the number.
  //
  // Both halves of the donut open. Vacant opens what is costing money; Occupied
  // opens what is earning it, sorted by the term ending soonest — a 107-row list
  // is only worth having if the rows that need doing are at the top, and on an
  // occupied unit that is the lease about to expire (or already lapsed).
  const drillOccupied = () => {
    // Soonest-ending first, lapsed terms above everything. Building order would
    // put a lease that expired last month below one running for another year
    // purely on the building's name, and on a list this long that row is never
    // found. A unit with no end date on file sorts last rather than first — an
    // unknown is not urgent.
    const rows = units
      .filter(u => u.availability === 'occupied')
      .sort((a, b) => (a.daysToEnd ?? Number.POSITIVE_INFINITY) - (b.daysToEnd ?? Number.POSITIVE_INFINITY));
    // A term that has not started yet is not a term running out — the unit reads
    // occupied because an incoming lease is signed, and counting it as lapsed or
    // as "ends within 90 days" would put a renewal task on a tenancy that has
    // not begun.
    const incoming = (u: UnitRow) => (u.daysToStart ?? 0) > 0;
    const lapsed = rows.filter(u => !incoming(u) && (u.daysToEnd ?? 1) < 0).length;
    const soon = rows.filter(u => !incoming(u) && (u.daysToEnd ?? 1) >= 0 && (u.daysToEnd ?? 1) <= 90).length;
    const starting = rows.filter(incoming).length;
    setDrill({
      title: `Occupied units · ${rows.length}`,
      note: [
        'Sorted by the term ending soonest.',
        lapsed ? `${lapsed} ${lapsed === 1 ? 'term has' : 'terms have'} already lapsed — the unit is still occupied, so ${lapsed === 1 ? 'that renewal is' : 'those renewals are'} overdue.` : '',
        soon ? `${soon} more ${soon === 1 ? 'ends' : 'end'} within 90 days.` : '',
        starting ? `${starting} ${starting === 1 ? 'unit is held for a signed tenancy that has' : 'units are held for signed tenancies that have'} not started yet.` : '',
      ].filter(Boolean).join(' '),
      groups: [{
        rows: rows.map(u => {
          const d = u.daysToEnd;
          const s = u.daysToStart;
          const notStarted = incoming(u);
          return {
            key: u.id,
            title: u.number ? `Unit ${u.number}` : (u.name ?? `Unit ${u.id}`),
            subtitle: [
              u.tenant ?? 'No customer on the lease',
              u.building,
              // An incoming tenancy is dated by when it BEGINS. Leading with the
              // 2027 end date of a lease nobody has moved into yet reads as a
              // term already running.
              notStarted && u.startsOn ? `starts ${fmtDayMonthYear(u.startsOn)}`
                : u.endsOn ? `ends ${fmtDayMonthYear(u.endsOn)}` : 'no end date on file',
            ].filter(Boolean).join(' · '),
            // The lease is what an occupied row is about; with no lease on it,
            // the unit itself is. Both portals resolve, so neither is a dead row.
            href: u.contractId != null ? `${contractBase}/${u.contractId}/v2`
              : unitHref(u.id, manager),
            badges: notStarted ? [{ label: `starts in ${fmtDuration(s as number)}`, tone: 'indigo' as BadgeTone }]
              : d == null ? [{ label: 'no term', tone: 'gray' as BadgeTone }]
              : d < 0 ? [{ label: `lapsed ${Math.abs(d)}d`, tone: 'red' as BadgeTone }]
              : d <= 30 ? [{ label: `${d}d left`, tone: 'red' as BadgeTone }]
              : d <= 90 ? [{ label: `${d}d left`, tone: 'amber' as BadgeTone }]
              : [{ label: `${fmtDuration(d)} left`, tone: 'green' as BadgeTone }],
          };
        }),
      }],
    });
  };
  const drillAvailable = () => {
    const published = vacantUnits.filter(u => u.listingStatus === 'published').length;
    // The lost-income total is a sum over the units that HAVE a rent to value —
    // say how many did not rather than let the total pass for the whole list.
    const unpriced = vacantUnits.filter(u => u.rentBasis == null).length;
    const vacancyNote = vacancyTotals
      ? `Empty for ${fmtDuration(vacancyTotals.avgDaysVacant)} on average · ${fmtAed(vacancyTotals.lostIncome)} of rent foregone so far${unpriced ? ` (${unpriced === 1 ? '1 unit has no rent set and counts' : `${unpriced} units have no rent set and count`} as 0)` : ''}.`
      : '';
    setDrill({
      title: `Vacant units · ${vacantUnits.length}`,
      note: [
        `${published} published in public listings · ${vacantUnits.length - published} not listed (draft / pending) — only published units appear publicly.`,
        vacancyNote,
      ].filter(Boolean).join(' '),
      // A panel, not the usual building-grouped rows. Grouping by building put
      // the six-month void below a unit that came free last week whenever the
      // buildings sorted that way, and a vacancy list is read worst-first or it
      // is not read at all. The building each unit sits in is on its own row,
      // which is all the grouping was buying.
      groups: [],
      panel: <VacancyBars units={vacantUnits} totals={vacancyTotals} manager={manager} />,
    });
  };
  // No drillAllUnits: the Units tile links to the Units page now, which is that
  // list with filtering and actions instead of 113 names in a read-only overlay.
  /** One renewal state's leases. Same rows as the full drill, filtered — the
   *  bucket tile is the number, so opening it has to show exactly what it
   *  counted, not the whole list scrolled to somewhere near it. */
  const drillRenewalBucket = (bucket: RenewalBucket) => drillRenewals(bucket);
  const drillRenewals = (bucket?: RenewalBucket) => {
    const meta = RENEWAL_BUCKETS.find(b => b.key === bucket);
    const list = (extras?.upcomingRenewals ?? [])
      .filter(r => !bucket || (r.bucket ?? 'noticeDue') === bucket)
      .slice().sort((a, b) => (a.placedOn ?? '').localeCompare(b.placedOn ?? '') || a.daysUntilEnd - b.daysUntilEnd);
    // "Days left" as a highlighted badge on the right, by urgency.
    const daysBadge = (n: number): { label: string; tone: BadgeTone } =>
      n <= 0 ? { label: `expired ${Math.abs(n)}d`, tone: 'red' }
      : n <= 30 ? { label: `${n}d left`, tone: 'red' }
      : n <= 60 ? { label: `${n}d left`, tone: 'amber' }
      : { label: `${n}d left`, tone: 'green' };
    // THE TERM ON THE ROW IS THE ONE BEING OFFERED, not the one running out.
    //
    // A notice on Room-10 offers 1 Sep 2026 → 31 Aug 2027; the lease it replaces
    // runs 1 Sep 2025 → 31 Aug 2026. Where no renewal record exists yet there is
    // only the expiring term to show, and it is labelled as such. A term that
    // began in the window IS the new term, and says which kind it is.
    const termDay = (iso: string) =>
      new Date(iso).toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
    const term = (x: UpcomingRenewal) => {
      if (x.placedBy === 'start') {
        const kind = x.bucket === 'newCustomer' ? 'New lease' : x.runningUnsigned ? 'Running, not signed' : 'Renewed';
        return `${kind} ${termDay(x.startDate ?? x.placedOn ?? x.endDate)} → ${termDay(x.endDate)}`;
      }
      return x.renewalStartDate && x.renewalEndDate
        ? `Renews ${termDay(x.renewalStartDate)} → ${termDay(x.renewalEndDate)}`
        : x.startDate
          ? `Current term ${termDay(x.startDate)} → ${termDay(x.endDate)}`
          : `Current term ends ${termDay(x.endDate)}`;
    };
    // GROUPED BY THE MONTH THE API PLACED EACH ROW IN — the month its renewal
    // falls due, or the month its term started for a unit already renewed, a
    // renewal running but not signed, or a new customer. The same months as
    // Renewal Plan - Yearly and the Upcoming Renewals report. An older payload
    // without `placedOn` falls back to the renewal's start, then to end + 1 day.
    // Date arithmetic on the date PART only: these are 'YYYY-MM-DD' strings and a
    // local-time Date would shift the day, hence the month.
    const nextDay = (iso: string) => {
      const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    const monthKey = (x: UpcomingRenewal) =>
      (x.placedOn ?? x.renewalStartDate ?? nextDay(x.endDate)).slice(0, 7);
    const byMonth = new Map<string, UpcomingRenewal[]>();
    for (const x of list) {
      const key = monthKey(x);
      const arr = byMonth.get(key) ?? [];
      arr.push(x); byMonth.set(key, arr);
    }
    const groups = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, items]) => ({
        // Mid-month at noon UTC, so no browser time zone can name the wrong month.
        label: `Renewals in ${new Date(`${key}-15T12:00:00Z`).toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE, month: 'long', year: 'numeric' })} · ${items.length}`,
        rows: items.map(x => ({
          key: x.contractId,
          title: x.unitLabel,
          subtitle: `${term(x)} · ${x.tenantName ?? 'Customer'}`,
          // Opens the record that HAS the work: a lease not yet set up goes to
          // Operations, anything set up goes to its lease page.
          href: contractHref(x.openContractId ?? x.contractId, x.openIn ?? 'lease', manager),
          // The row's badge is its tile, the one clicked to reach it. Days left
          // only on a term coming to its end — a term that has just begun has
          // nothing falling due.
          badges: x.placedBy === 'start' ? [bucketBadge(x)] : [bucketBadge(x), daysBadge(x.daysUntilEnd)],
        })),
      }));
    const span = `this month + next ${renewalWindow} days`;
    setDrill({
      title: `${meta ? meta.label : 'Renewals'} · ${list.length} — ${span}`,
      note: !list.length
        ? `No renewals this month or in the next ${renewalWindow} days.`
        : `${meta ? `${meta.hint.charAt(0).toUpperCase()}${meta.hint.slice(1)} — ` : ''}grouped by renewal month, the same months as Renewal Plan - Yearly. Each let unit is listed once; a unit whose termination has started counts as vacant.`,
      groups,
    });
  };
  /** The Receivables KPI, opened up. The headline is rent FALLING DUE in the
   *  range — money already banked and money still to come, in one figure — so
   *  the drill-down leads with that split rather than listing 20 cheques and
   *  leaving the reader to add them up. */
  const drillReceivables = () => {
    if (!fin) return;
    const split = fin.receivablesSplit;
    const SECTIONS = [
      { state: 'overdue'   as const, label: 'Overdue',     tone: 'red'   as BadgeTone },
      { state: 'due'       as const, label: 'Not yet due', tone: 'gray'  as BadgeTone },
      { state: 'collected' as const, label: 'Collected',   tone: 'green' as BadgeTone },
    ];
    const outstanding = split.overdue.amount + split.due.amount;
    const fmt = (n: number) => `AED ${n.toLocaleString()}`;
    const day = (iso: string | null) => iso
      ? new Date(iso).toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: '2-digit' })
      : '—';
    setDrill({
      // Title, headline and split are three separate things now. They were one
      // run-on title plus a three-line paragraph, so the figures a landlord opens
      // this for — how much is in, how much is not, how much is late — had to be
      // read out of prose.
      title: `Receivables · ${rangeLabel}`,
      headline: fmt(fin.receivablesInRange),
      summary: [
        { label: 'Collected', value: fmt(split.collected.amount), tone: 'green' as const },
        { label: 'Outstanding', value: fmt(outstanding), tone: 'amber' as const },
        // Past due always shows, even at zero: nothing late is the good news a
        // landlord came to check, and a missing box does not say it.
        { label: 'Past due', value: fmt(split.overdue.amount), tone: split.overdue.amount > 0 ? 'red' as const : undefined },
      ],
      note: `Rent falling due ${day(fin.rangeStart)} – ${day(fin.rangeEnd)} · cleared + pending, bounces reported separately — the same basis as Cash Management.`,
      // Empty sections are dropped rather than shown as a bare heading with
      // nothing under it — the summary above already states every figure.
      groups: SECTIONS.filter(s => split[s.state].count > 0).map(s => ({
        label: `${s.label} · ${split[s.state].count} cheque${split[s.state].count === 1 ? '' : 's'} · ${fmt(split[s.state].amount)}`,
        rows: fin.receivableCheques.filter(c => c.state === s.state).map(c => ({
          key: c.id,
          // Name alone. The amount is its own column and the state is the section
          // heading — the per-row badge repeated that heading on every single line.
          title: c.customer ?? 'Customer',
          subtitle: `${c.unitLabel ? `${c.unitLabel} · ` : ''}${c.buildingName ?? ''} · due ${day(c.dueDate)}${c.chequeNumber ? ` · #${c.chequeNumber}` : ''}`,
          amount: fmt(c.amount),
          // Same rule as the arrears rows — the lease's own surface.
          href: contractHref(c.contractId, c.locked === false ? 'operations' : 'lease', manager),
        })),
      })),
    });
  };
  /**
   * Overdue and Bounced open SEPARATE lists.
   *
   * Both tiles used to call one function that fetched /contracts/receivables and
   * filtered to status='overdue' — so they showed identical rows, and that
   * endpoint does not distinguish the two states anyway (it folds a bounce into
   * 'overdue' and reported 12 against these tiles' 13). The rows now come from
   * `fin.arrearsCheques`, built by the same query as the counts, so each list is
   * exactly the tile that opened it.
   */
  const drillArrears = (kind: 'overdue' | 'bounced') => () => {
    if (!fin) return;
    const rows = fin.arrearsCheques.filter(c => c.kind === kind);
    const fmt = (n: number) => `AED ${n.toLocaleString()}`;
    const day = (iso: string | null) => iso
      ? new Date(iso).toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: '2-digit' })
      : '—';
    const today = new Date();
    const daysLate = (iso: string | null) => {
      if (!iso) return null;
      const d = Math.floor((today.getTime() - new Date(iso).getTime()) / 86_400_000);
      return d > 0 ? d : null;
    };
    const total = rows.reduce((n, c) => n + c.amount, 0);
    const overdue = kind === 'overdue';
    setDrill({
      title: overdue ? 'Overdue' : 'Bounced',
      headline: fmt(total),
      summary: [
        { label: 'Cheques', value: String(rows.length) },
        { label: overdue ? 'Oldest' : 'Largest', value: overdue
          ? `${Math.max(0, ...rows.map(c => daysLate(c.dueDate) ?? 0))} days`
          : fmt(Math.max(0, ...rows.map(c => c.amount))) },
        { label: 'Total', value: fmt(total), tone: overdue ? 'amber' : 'red' },
      ],
      note: overdue
        ? 'Rent cheques whose date has passed and which have not cleared. Not refused by the bank — chase the payment.'
        : 'Cheques the bank refused that are still to chase. Two kinds are excluded: one replaced in full (its replacement is counted instead) and one already carried by a final settlement, where the landlord has proposed how it resolves.',
      groups: [{
        rows: rows.map(c => {
          const late = daysLate(c.dueDate);
          return {
            key: c.id,
            title: c.customer ?? 'Customer',
            subtitle: `${c.unitLabel ? `${c.unitLabel} · ` : ''}${c.buildingName ?? ''} · due ${day(c.dueDate)}`
              + `${c.chequeNumber ? ` · #${c.chequeNumber}` : ''}`
              + `${late ? ` · ${late} day${late === 1 ? '' : 's'} late` : ''}`
              // A part-replaced bounce: say what came back, or the row reads as
              // the whole face value being outstanding.
              + `${c.coveredAmount > 0 ? ` · ${fmt(c.coveredAmount)} already recovered` : ''}`,
            amount: fmt(c.amount),
            // The lease's OWN surface, not a hard-coded register route. An
            // unpaid cheque on a lease still in setup is worked in Operations,
            // and sending it to /contracts/{id}/v2 landed the reader on the
            // trimmed read-only record — the exact failure contractHref exists
            // to stop (see lib/contractHref.ts).
            // `undefined` (an older payload) keeps the register route it always
            // used, so the link degrades to the previous behaviour rather than
            // to a wrong guess.
            href: contractHref(c.contractId, c.locked === false ? 'operations' : 'lease', manager),
          };
        }),
      }],
    });
  };
  const drillOverdue = drillArrears('overdue');
  const drillBounced = drillArrears('bounced');

  const rangeLabel = RANGE_PRESETS.find(r => r.key === selectedRange)?.label ?? '';

  const gaugePct = useMemo(() => Math.min(100, Math.max(0, occupancyRate)), [occupancyRate]);
  const dashLen = 2 * Math.PI * 40;

  return (
    <div className="p-6 sm:p-8 max-w-[1320px] mx-auto space-y-6">
      {/* Hero */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        {/* Eyebrow only. The greeting and the standfirst under it are gone: they
            cost roughly 120px at the top of a monitoring page, every visit, to
            say the landlord's own name and describe what a dashboard is. The
            figures start higher up the screen now.
            `name` is still resolved — the shell and other surfaces use it. */}
        <div className="min-w-[260px] flex-1">
          {/* An h1, not an eyebrow. When the "Welcome, <name>" heading went, this
              11px uppercase label was all that remained at the top — and the page
              was left with no h1 at all, which is a real problem for anyone
              navigating by headings, not just a visual one.
              Sized to the sibling pages (Reports is text-2xl) so the portal's
              titles match, and title case rather than uppercase: letter-spaced
              caps are for a label above a heading, not for the heading. */}
          <h1 className="text-2xl font-bold tracking-tight text-[var(--primary-dark)]">
            Portfolio Overview
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            title="Refresh all dashboard data"
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-[var(--neutral-700)] bg-white border border-[var(--base-200)] hover:border-[var(--neutral-500)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
          {/* No List Property / New Contract here. This page is a read of the
              portfolio, and both actions start a flow that belongs to the page
              that owns it — listing from Properties, a contract from Contracts —
              which is one click away and where the landlord ends up anyway. */}
        </div>
      </header>

      {/* The range tab strip that used to run across the whole page is gone; the
          period now lives INSIDE the Receivables card, which is the only thing on
          this page it has ever changed.
          A full-width filter above everything promises to scope everything. It
          did not: occupancy, deposits, renewals and the activity feed are all
          live figures, so five of the six things below a tab labelled "Last 3M"
          simply ignored it. A control that visibly fails to filter most of what
          sits under it reads as broken, and it cost this page a whole "Right now"
          section explaining that the tabs did not apply. Put the period on the
          card it belongs to and the question does not arise. */}

      {/* Error banner — shows when any range-scoped fetch fails */}
      {(statsErr || finErr || extrasErr) && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-red-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-900">Some data didn&apos;t load</p>
            <p className="text-[12px] text-red-700 mt-0.5">
              {[statsErr && 'portfolio stats', finErr && 'financials', extrasErr && 'activity']
                .filter(Boolean).join(', ')} failed to refresh.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      {/* Fee rules setup nudge */}
      {feeRulesConfigured === false && !nudgeDismissed && (
        <div className="flex items-center gap-4 bg-white border border-amber-200 border-l-4 border-l-amber-400 rounded-2xl px-5 py-4 shadow-sm">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
            <Percent size={16} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[var(--neutral-900)]">Set up your fee rules</p>
            <p className="text-[13px] text-[var(--neutral-500)] mt-0.5 leading-snug">
              Configure admin fees, Contract Registration, commission, and security deposits so they auto-fill on every new contract.
            </p>
          </div>
          <Link
            href="/rental-provider/dashboard/settings"
            {...NEW_TAB}
            className="flex-shrink-0 inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors"
          >
            Configure
          </Link>
          <button
            onClick={() => setNudgeDismissed(true)}
            aria-label="Dismiss"
            className="flex-shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[var(--neutral-400)] hover:bg-[var(--base-100)] hover:text-[var(--neutral-900)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Section 1: THE PORTFOLIO ──────────────────────────────────────────
          What the landlord HAS, first: buildings, units, customers and the
          managers running them. Money follows underneath, then arrears.
          This strip used to sit below the money row. Opening on Receivables put a
          period-scoped figure above everything, which is the narrower question —
          the size of the book does not change with a dropdown, and it is the
          thing every other figure on the page is a fraction of.
          Deposits Held was here too and has moved down to the money row. */}
      <section className="space-y-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-bold tracking-[0.14em] uppercase text-[var(--neutral-400)]">
            Portfolio
          </h2>
          {/* "Right now · live — no period applies to these" was written to
              contrast with the range tabs that used to run across the page. Those
              are gone, and at the TOP of the page the caption now warns about a
              period the reader has not met yet. Say what the row is instead. */}
          <span className="text-[11px] text-[var(--neutral-400)]">what the portfolio is made of, and who runs it</span>
        </div>
        {/* All five on ONE row from `lg` up — the strip is a single statement of
            what the portfolio is made of, and wrapping it split that in half.
            Captions are gone with it: five labelled figures side by side read
            faster without a sentence under each. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* Deposits is NOT here. It moved up to the Money row, beside
              Receivables and Rent vs Market, so the portfolio's three money
              figures sit together — it spent too long filed among Properties and
              Units, which reads as "how big is the portfolio" rather than "what
              are we holding". */}
        {/* Both counts go to the page that owns the records rather than opening a
            dialog listing them: a landlord who clicks "9 Properties" wants the
            portfolio, where the buildings can actually be worked on, and the
            same list in a read-only overlay was a dead end one step short of it.
            The Units drill-down that used to open here listed all 113 with no
            way to filter or act — the Units page is that list, done properly. */}
        <KpiCard
          icon={<Building2 size={12} />}
          label="Properties"
          value={shown(totalProperties)}
          href={propertiesHref}
        />
        {/* No occupied/vacant split here — the Occupancy Rate donut below states
            it three ways already (the percentage, "107 of 113 units let", and
            the legend), and repeating it in the strip made the same number the
            answer to two different questions. This card is the portfolio's SIZE;
            how much of it is let is the donut's job. Maintenance and reserved
            are named only when they exist, because those are the units the
            occupied/vacant reading silently leaves out. */}
        <KpiCard
          icon={<DoorOpen size={12} />}
          label="Units"
          value={shown(totalUnits)}
          href={unitsHref}
        />
        {/* Who the portfolio is run WITH, next to what it is made of. Both link
            to the page that owns the records, like Properties and Units.
            Overdue / Bounced used to close this row and has moved to its own
            Arrears row below the money — it is not a fact about the portfolio's
            size, it is work outstanding. */}
        <KpiCard
          icon={<Users size={12} />}
          label="Customers"
          value={shown(totalCustomers)}
          href={customersHref}
        />
        {/* People and tenancies are DIFFERENT counts and are shown as two tiles
            for that reason: a customer holding three units is one customer and
            three leases. Reading one figure as the other is what made the
            Customers page look like it disagreed with this dashboard. Both come
            from LIVE_LEASE_TIPS_SQL, so they cannot drift from that page. */}
        <KpiCard
          icon={<FileText size={12} />}
          label="Active Leases"
          value={shown(activeLeases)}
          href={leasesHref}
        />
        <KpiCard
          icon={<UserCog size={12} />}
          label="Managers"
          value={shown(totalManagers)}
          href={managersHref ?? undefined}
        />
        </div>
      </section>

      {/* ── Section 2: THE MONEY ─────────────────────────────────────────────
          Everything the range tabs above actually change, and nothing else.
          Receivables is the one figure that moves with the range. Rent vs Market
          sits beside it because the two are the portfolio's money read two ways
          — cash falling due now, and what the let stock earns against what it
          asks — but only the first follows the tabs, so each card says which it
          is on its own label.
          The month-by-month Receivables vs Collected bars were here and were
          removed: they replotted the same headline the card already states,
          split the same two ways, and "This Month" left them a single pair of
          bars with nothing to compare. They used to be separated by two rows of tiles that do
          NOT move with the range (occupancy, deposits held, arrears), which put
          "This Month" above a set of live snapshots and implied it filtered
          them. It never did; the numbers simply did not change when the tab did,
          which reads as a broken filter rather than a mislabelled section. */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-bold tracking-[0.14em] uppercase text-[var(--neutral-400)]">
            Money
          </h2>
          <span className="text-[11px] text-[var(--neutral-400)]">what the let stock earns against what it asks, and what is being held</span>
        </div>
        {/* Column count follows the flag: with Receivables hidden the row is two
            cards, and a three-column grid would leave a hole where it stood. */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4${SHOW_RECEIVABLES ? ' lg:grid-cols-3' : ''}`}>
        {/* Hero KPI — Receivables (dark). The headline is rent FALLING DUE in the
            range, so money already banked is inside it; the split below says how
            much, and clicking through lists the cheques on both sides of it.
            Hidden by SHOW_RECEIVABLES — see the flag for why and how to restore. */}
        {SHOW_RECEIVABLES && (
        <div
          {...clickableProps(fin ? drillReceivables : undefined)}
          className={`relative overflow-hidden rounded-2xl p-5 text-white bg-gradient-to-br from-[#14201c] via-[#1d2c27] to-[#22332d] shadow-sm${fin ? ' cursor-pointer hover:shadow-md hover:brightness-110 transition-all' : ''}`}
        >
          {/* min-h matches the other two cards' header rows. The period select
              is taller than a bare label, and without a shared floor it pushed
              this card's figure a few pixels below the ones beside it — three
              headline numbers in a row that do not sit on one line read as
              sloppy long before anyone works out why. */}
          <div className="flex items-center gap-2 min-h-[28px] text-[11px] font-bold tracking-[0.12em] uppercase text-white/70">
            <DirhamSign size={12} className="text-[#7be1c2]" />
            Receivables
            {/* The whole card is a button into the cheques behind the figure, so
                the select swallows its own clicks and keys — otherwise choosing a
                period would also throw the drill-down open over the answer.
                colorScheme dark keeps the native option list legible; without it
                the menu renders light-on-light against this card. */}
            <span
              className="ml-auto flex items-center gap-2"
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
            >
              <select
                aria-label="Receivables period"
                value={selectedRange}
                onChange={e => setSelectedRange(e.target.value as RangePreset)}
                style={{ colorScheme: 'dark' }}
                className="bg-white/10 border border-white/25 text-white rounded-md pl-2 pr-1 py-1 text-[11px] font-bold uppercase tracking-[0.08em] cursor-pointer hover:bg-white/20 focus:outline-none focus:ring-1 focus:ring-white/40 transition-colors"
              >
                {RANGE_PRESETS.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              {/* No eye here. The card is plainly clickable and the period
                  selector beside it already draws the pointer; a second affordance
                  in the same corner just crowded the dropdown. */}
            </span>
          </div>
          {/* Same 30px as the other two. At 42px this card shouted over the row
              — and the three are peers now, not a hero and two footnotes. */}
          <div className="mt-2 text-[30px] font-bold leading-none tracking-tight tabular-nums">
            {fin ? fmtAed(fin.receivablesInRange) : (finErr ? '—' : '…')}
          </div>
          {/* Two figures, one word each, one per line — so the two amounts stack
              and can be compared at a glance instead of being read along a
              sentence. The line carried "of which … collected", "still
              outstanding" and a "past due" clause; the qualifiers said nothing
              the labels do not, and past due is now its own tile in the Arrears
              row directly below, with both the money and the count. */}
          {fin ? (
            <div className="mt-2 space-y-1 text-[12.5px]">
              <div className="flex items-baseline gap-2">
                <span className="tabular-nums font-semibold text-white/85">{fmtAed(fin.receivablesSplit.collected.amount)}</span>
                <span className="text-white/55">Collected</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="tabular-nums font-semibold text-white/85">
                  {fmtAed(fin.receivablesSplit.overdue.amount + fin.receivablesSplit.due.amount)}
                </span>
                <span className="text-white/55">Outstanding</span>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-white/55 mt-2">{finErr ? 'Not available' : 'Loading…'}</p>
          )}
          {/* Straight into the report this figure IS. Receivables and Cash
              Management are the same money on the same basis (cheque due date,
              earning leases) — the card is the headline, the report is the
              month-by-month working. Stops its own clicks so it opens the report
              rather than the card's cheque drill-down underneath it. */}
          <Link
            href={cashManagementHref}
            onClick={e => e.stopPropagation()}
            className="relative z-10 mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#7be1c2] hover:text-white transition-colors"
          >
            Open report <ArrowUpRight size={13} />
          </Link>
          <ArrowUpRight size={56} className="absolute -right-3 -bottom-3 text-white/5" />
        </div>
        )}

        {/* Rent vs Market — one card, because the two figures only mean anything
            against each other.
            The two sides are ASYMMETRIC, and deliberately so (landlord's call,
            5 Aug): Market is `marketRent`, every unit's rental value with no
            occupancy filter, while Annual rent is the earning leases only
            (EARNING_LEASE_IDS_SQL) — the platform's one 7.1M. The difference is
            therefore the whole opportunity, under-renting and unlet stock
            together, and the sub-line says as much rather than letting it read as
            under-renting alone.
            This card used to run like-for-like (asking on the LET units only,
            9.1M) and so disagreed with Rent vs Asking, which ran wide. One of the
            two had to move; the wide reading won, and both now state 9.85M. */}
        <Link
          href={rentVsMarketHref}
          {...NEW_TAB}
          className="block bg-white rounded-2xl p-5 shadow-sm border border-[var(--base-200)] hover:border-[var(--neutral-400)] hover:shadow-md transition-all"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] inline-flex items-center gap-1.5 min-h-[28px]">
                <span className="text-[var(--primary-dark)]"><TrendingUp size={12} /></span>
                Rent vs Market
                {/* Arrow, not an eye: this LEAVES the page for Rent vs Asking —
                    the same convention the Properties and Units tiles use, so a
                    card never looks like it will do the thing it will not. */}
                <ArrowUpRight size={12} className="text-[var(--neutral-400)]" />
              </div>
              <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                <span className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-[var(--neutral-900)]">
                  {rentPos ? fmtAed(rentPos.contracted) : (statsErr ? '—' : '…')}
                </span>
                <span className="text-[13px] text-[var(--neutral-400)] tabular-nums">
                  {marketRent != null ? `of ${fmtAed(marketRent)} market` : ''}
                </span>
              </div>
              {/* No sub-line. The card carries the two figures, the gap and the
                  link, and nothing else.
                  Two lines have lived here and both are gone by choice. The first
                  editorialised ("Studios are 63% below asking · 95 of 103 let
                  units under their own price") — a verdict on the landlord's
                  pricing with no room for the reasons a unit sits under asking on
                  purpose. The second named the two populations, because Market
                  price counts EVERY unit while Annual rent counts only earning
                  leases, so part of the 27.92% is unlet stock rather than
                  under-renting. That distinction is real and now lives only in
                  Rent vs Asking, which the card links to — its "What the
                  difference is made of" panel splits the gap into the two halves
                  in full. */}
            </div>
            {marketGapPct != null && (
              <div className="text-right flex-shrink-0">
                {/* Smaller than the money beside it. At 22px in amber this read
                    as the card's headline, competing with the AED figure that
                    actually is one — the percentage is a derived annotation on
                    those two numbers, and now looks like one.
                    Direction is carried by an arrow AND the colour, never colour
                    alone: red-vs-green is invisible to the commonest form of
                    colour blindness, and this is the one figure on the card that
                    says whether the news is good. */}
                <div className={`flex items-center justify-end gap-1 text-[15px] font-bold tabular-nums leading-none ${marketGapPct > 0 ? 'text-[#dc2626]' : 'text-[var(--primary-dark)]'}`}>
                  {marketGapPct > 0
                    ? <TrendingDown size={14} className="shrink-0" />
                    : <TrendingUp size={14} className="shrink-0" />}
                  {marketGapPct > 0 ? '−' : '+'}{Math.abs(marketGapPct).toFixed(2)}%
                </div>
                <div className="text-[9.5px] text-[var(--neutral-400)] mt-0.5">
                  {marketGapPct > 0 ? 'below market' : 'above market'}
                </div>
              </div>
            )}
          </div>
        </Link>

        {/* Deposits — the third money card, and the only one that is not the
            landlord's own money. It was a small tile two sections down among
            Properties and Units, which filed cash held against a customer's
            tenancy under "how big is the portfolio".
            Live like Rent vs Market, not range-driven like Receivables — the
            section caption says which is which, since all three now sit in one
            row and nothing else distinguishes them.
            The figure comes from HELD_DEPOSIT_SQL, the platform's one deposit
            rule, so it agrees with the Deposit Register exactly — and the whole
            card opens the Security Deposits report, where that same figure is
            broken out property by property. */}
        <Link href={depositsHref} className="bg-white rounded-2xl p-5 shadow-sm border border-[var(--base-200)] cursor-pointer hover:border-[var(--neutral-400)] hover:shadow-md transition-all">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] inline-flex items-center gap-1.5 min-h-[28px]">
                <span className="text-[var(--primary-dark)]"><ShieldCheck size={12} /></span>
                Deposits Held
                <ArrowUpRight size={12} className="text-[var(--neutral-400)] ml-1" />
              </div>
              <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                <span className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-[var(--neutral-900)]">
                  {fin ? fmtAed(fin.depositsHeld) : (finErr ? '—' : '…')}
                </span>
              </div>
              {/* The lease count sits UNDER the amount, on the caption line the
                  other money cards use, rather than trailing it on the baseline. */}
              {fin && (
                <p className="text-[12.5px] text-[var(--neutral-500)] mt-1.5 tabular-nums">
                  across {fin.depositsHeldCount} leases
                </p>
              )}
            </div>
          </div>
        </Link>
        </div>
      </section>

      {/* ── Section 3: ARREARS ────────────────────────────────────────────────
          The two halves of what used to be one "Overdue / Bounced 13" tile in the
          portfolio row. They are different problems and are worked differently:
          an overdue cheque is rent whose date has passed and may simply not have
          been banked, while a bounce is a cheque the bank refused — a customer
          conversation, often a penalty, sometimes a replacement already in hand.
          A single count told the landlord neither, and filed both under "how big
          is the portfolio". Money is on each now, because 6 cheques and 7 cheques
          say nothing about which matters more. */}
      <section className="space-y-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-bold tracking-[0.14em] uppercase text-[var(--neutral-400)]">
            Arrears
          </h2>
          <span className="text-[11px] text-[var(--neutral-400)]">still to chase &mdash; excludes anything replaced or already on a settlement</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KpiCard
            icon={<Clock size={12} />}
            label="Overdue"
            value={fin ? fmtAed(fin.overdueAmount) : (finErr ? '—' : '…')}
            sub={fin ? `${fin.overdueCount} cheque${fin.overdueCount === 1 ? '' : 's'} past their date` : 'past due cheques'}
            tone={(fin?.overdueCount ?? 0) > 0 ? 'warn' : 'default'}
            onClick={drillOverdue}
          />
          <KpiCard
            icon={<AlertTriangle size={12} />}
            label="Bounced"
            value={fin ? fmtAed(fin.bouncedAmount) : (finErr ? '—' : '…')}
            sub={fin ? `${fin.bouncedCount} cheque${fin.bouncedCount === 1 ? '' : 's'} the bank refused` : 'returned cheques'}
            tone={(fin?.bouncedCount ?? 0) > 0 ? 'warn' : 'default'}
            onClick={drillBounced}
          />
        </div>
      </section>


      {/* ── Section 4: OCCUPANCY & RENEWALS ───────────────────────────────
          The same live state as the strip above, at the size these two need:
          a donut and a four-bucket renewal board do not fit in a tile. Split
          out of "Right now" when the strip moved to the top of the page — one
          section cannot both open the page and sit under the money. */}
      <section className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">
        {/* Gauge */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-[var(--base-200)]">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-base font-bold text-[var(--neutral-900)]">Occupancy Rate</h3>
              {/* The denominator, named. "Across all units in your portfolio"
                  described the scope without ever saying what it was, so the
                  percentage had no total to be read against. */}
              <p className="text-xs text-[var(--neutral-400)] mt-0.5">
                {totalUnits ? `${occupied} of ${totalUnits} units let` : 'Across all units in your portfolio'}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center py-4">
            <div className="relative w-[200px] h-[200px]">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="var(--base-200)" strokeWidth="12" />
                <circle
                  cx="50" cy="50" r="40" fill="none"
                  stroke="var(--primary)" strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={`${(gaugePct / 100) * dashLen} ${dashLen}`}
                  style={{ transition: 'stroke-dasharray .6s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[36px] font-bold tracking-tight text-[var(--neutral-900)] tabular-nums leading-none">{statsReady ? `${occupancyRate}%` : '…'}</span>
                <span className="text-xs text-[var(--neutral-400)] mt-1.5">Occupancy</span>
              </div>
            </div>
          </div>
          <div className="flex justify-center gap-6 text-[13px] text-[var(--neutral-700)] font-medium">
{/* Occupied is the donut's other segment and has to be named, but it is a
                label only — the vacant units are the ones worth opening. */}
            <button type="button" onClick={drillOccupied} className="flex items-center gap-2 hover:underline cursor-pointer"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)]" />Occupied {statsReady ? occupied : '…'}</button>
            <button type="button" onClick={drillAvailable} className="flex items-center gap-2 hover:underline cursor-pointer"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--base-200)]" />Vacant {statsReady ? available : '…'}</button>
          </div>
          {/* How long each of those vacant units has been empty, and what it has
              cost, lives one click away — the "Vacant N" legend and the Vacant
              tile both open it. The card itself stays the rate. */}
        </div>
          <RenewalsCard
            list={renewalsList}
            buckets={extras?.renewalBuckets}
            loading={!extras}
            error={extrasErr}
            onRetry={() => fetchExtras(selectedRange, renewalWindow)}
            windowDays={renewalWindow}
            onWindowChange={setRenewalWindow}
            allHref={renewalsPipelineHref}
            onDrillBucket={drillRenewalBucket}
          />
        </div>
      </section>

      {/* ── Section 5: MANAGERS ───────────────────────────────────────────────
          The board already renders one column per manager; what it lacked was a
          section heading, so it read as a loose panel at the foot of the page
          rather than the last row of a structured dashboard. The count here is
          the same `totalManagers` the Managers tile at the top states.

          Live manager activity.
          Recent Activity and Upcoming Renewals both stood here and are gone.
          Recent Activity was a range-scoped digest of contracts and payments —
          the same records the Receivables and Renewals figures above already
          state, retold as a list. Upcoming Renewals repeated the Renewals KPI's
          own rows one card lower, with the same horizon and the same five
          leases; the tile opens them.
          What replaces both is the thing no other panel on this page says: what
          the people running the portfolio are doing right now. */}
      <section className="space-y-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-bold tracking-[0.14em] uppercase text-[var(--neutral-400)]">
            Managers
          </h2>
          <span className="text-[11px] text-[var(--neutral-400)]">
            {totalManagers === 0 ? 'nobody has access to this portfolio' : `${totalManagers} with access · what they are doing today`}
          </span>
          {/* The Team page is the full picture — status, trend, breakdown,
              per-person figures over a period. Landlord-only, like this
              section's data; the manager portal has no counterpart. */}
          {!manager && (
            <Link href="/rental-provider/dashboard/team" className="ml-auto text-[11px] font-semibold text-[var(--primary-dark)] hover:underline inline-flex items-center gap-1">
              Team page <ArrowUpRight size={11} />
            </Link>
          )}
        </div>
        <ManagerTimePerDay data={timePerDay} />
        <LiveActivity feed={feed} error={feedErr} onRetry={fetchFeed} contractBase={contractBase} leadsBase={leadsBase} />
      </section>

      <DrillDown drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

function clickableProps(onClick?: () => void) {
  if (!onClick) return {};
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
  };
}

/** A headline KPI tile. Give it `href` to navigate to the page that owns the
 *  records (Properties → the portfolio, Units → the units list) or `onClick` to
 *  open a drill-down over them — the arrow vs the eye in the corner is which one
 *  it is, so a tile never looks like it will do the thing it does not do. */
function KpiCard({ icon, label, value, sub, tone = 'default', onClick, href }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Optional — the portfolio strip runs without captions; the Arrears row keeps
   *  them, because an arrears figure is meaningless without saying what it counts. */
  sub?: string;
  tone?: 'default' | 'warn';
  onClick?: () => void;
  href?: string;
}) {
  const interactive = !!(href || onClick);
  const inner = (
    <>
      <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] inline-flex items-center gap-1.5">
        <span className={tone === 'warn' ? 'text-amber-600' : 'text-[var(--primary-dark)]'}>{icon}</span>
        {label}
        {href
          ? <ArrowUpRight size={12} className="text-[var(--neutral-400)] ml-auto" />
          : onClick && <Eye size={11} className="text-[var(--neutral-400)] ml-auto" />}
      </div>
      <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-[var(--neutral-900)]">{value}</div>
      {sub && <div className="text-[12.5px] text-[var(--neutral-400)] font-medium">{sub}</div>}
    </>
  );
  const cls = `bg-white rounded-2xl p-5 shadow-sm border border-[var(--base-200)] flex flex-col gap-2${interactive ? ' cursor-pointer hover:border-[var(--neutral-400)] hover:shadow-md transition-all' : ''}`;
  return href
    ? <Link href={href} {...NEW_TAB} className={cls}>{inner}</Link>
    : <div {...clickableProps(onClick)} className={cls}>{inner}</div>;
}

function KpiMini({ label, value, sub, tone = 'default', onClick, control }: {
  label: string;
  value: string;
  sub: string;
  tone?: 'default' | 'danger';
  onClick?: () => void;
  /** A small input in the tile header (e.g. a horizon picker). Its clicks and
   *  keystrokes are stopped here so using the control never also opens the
   *  tile's drill-down — the whole tile is a button. */
  control?: React.ReactNode;
}) {
  return (
    <div
      {...clickableProps(onClick)}
      className={`bg-white rounded-xl p-4 shadow-sm border border-[var(--base-200)]${onClick ? ' cursor-pointer hover:border-[var(--neutral-400)] hover:shadow-md transition-all' : ''}`}
    >
      <div className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] flex items-center gap-1.5">
        {label}
        {control && (
          <span className="ml-auto" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {control}
          </span>
        )}
        {onClick && <Eye size={10} className={`text-[var(--neutral-400)]${control ? '' : ' ml-auto'}`} />}
      </div>
      <div className={`text-[22px] font-bold tracking-tight mt-1.5 tabular-nums ${tone === 'danger' ? 'text-red-600' : 'text-[var(--neutral-900)]'}`}>{value}</div>
      <div className="text-[11.5px] text-[var(--neutral-400)] mt-0.5">{sub}</div>
    </div>
  );
}

const DRILL_TONE: Record<BadgeTone, { bg: string; fg: string }> = {
  green:  { bg: '#dcfce7', fg: '#166534' },
  amber:  { bg: '#fef3c7', fg: '#92400e' },
  red:    { bg: '#fee2e2', fg: '#991b1b' },
  indigo: { bg: '#e0e7ff', fg: '#3730a3' },
  gray:   { bg: '#f3f4f6', fg: '#374151' },
};

function DrillDown({ drill, onClose }: { drill: DrillState | null; onClose: () => void }) {
  if (!drill) return null;
  const total = drill.groups.reduce((s, g) => s + g.rows.length, 0);
  const renderRow = (r: DrillRow) => {
    const inner = (
      <>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-[var(--neutral-900)] truncate">{r.title}</p>
          {r.subtitle && <p className="text-[11.5px] text-[var(--neutral-400)] truncate">{r.subtitle}</p>}
        </div>
        {r.badges?.map((b, bi) => (
          <span key={bi} className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: DRILL_TONE[b.tone].bg, color: DRILL_TONE[b.tone].fg }}>{b.label}</span>
        ))}
        {/* Its own column, tabular — so the amounts form a readable stack
            instead of ending each name at a different place. */}
        {r.amount && (
          <span className="text-[13px] font-bold tabular-nums text-[var(--neutral-900)] shrink-0 text-right">{r.amount}</span>
        )}
      </>
    );
    return r.href
      ? <Link key={r.key} href={r.href} {...NEW_TAB} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-[var(--base-100)]">{inner}</Link>
      : <div key={r.key} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg">{inner}</div>;
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,18,14,0.5)' }} onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl border border-[var(--base-200)]" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-[var(--base-200)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[var(--neutral-900)]">{drill.title}</h3>
              {/* The headline sits on its own line at full size. It used to be
                  welded to the title ("Receivables · This Month — AED 346,175"),
                  where the figure the dialog is about read as part of a label. */}
              {drill.headline && (
                <p className="text-[28px] font-bold tracking-tight tabular-nums text-[var(--neutral-900)] leading-none mt-1.5">{drill.headline}</p>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--neutral-400)] hover:text-[var(--neutral-900)] shrink-0"><X size={18} /></button>
          </div>
          {/* The split, as figures. Three boxes with a label each beat one
              sentence carrying three numbers — which is what this was. */}
          {drill.summary && drill.summary.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-4">
              {drill.summary.map(sItem => (
                <div key={sItem.label} className="rounded-xl border border-[var(--base-200)] bg-[var(--base-100)] px-3 py-2">
                  <div className="text-[10px] font-bold tracking-[0.1em] uppercase text-[var(--neutral-400)]">{sItem.label}</div>
                  <div className={`text-[15px] font-bold tabular-nums mt-0.5 ${
                    sItem.tone === 'green' ? 'text-[#15803d]'
                    : sItem.tone === 'red' ? 'text-[#dc2626]'
                    : sItem.tone === 'amber' ? 'text-[#b45309]'
                    : 'text-[var(--neutral-900)]'}`}>{sItem.value}</div>
                </div>
              ))}
            </div>
          )}
          {/* Method, not money — small, last, and skippable. */}
          {drill.note && <p className="text-[11px] text-[var(--neutral-400)] mt-3 leading-snug">{drill.note}</p>}
        </div>
        <div className="overflow-y-auto p-3">
          {drill.loading ? (
            <p className="text-sm text-[var(--neutral-400)] text-center py-8">Loading…</p>
          ) : drill.panel ? (
            drill.panel
          ) : total === 0 ? (
            <p className="text-sm text-[var(--neutral-400)] text-center py-8">Nothing to show.</p>
          ) : drill.groups.map((g, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-2' : ''}>
              {/* A real divider, not a faint caption. The sections ARE the
                  division the reader is looking for. */}
              {g.label && (
                <p className="text-[11px] font-bold tracking-[0.1em] uppercase text-[var(--neutral-700)] bg-[var(--base-100)] rounded-lg px-3 py-2 mb-1 mt-2 sticky top-0 z-10">{g.label}</p>
              )}
              {g.rows.map(renderRow)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-6 text-center">
      <AlertTriangle size={20} className="text-red-500 mx-auto mb-2" />
      <p className="text-sm text-[var(--neutral-700)] font-semibold">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--neutral-700)] bg-white border border-[var(--base-200)] hover:border-[var(--neutral-500)] cursor-pointer"
      >
        <RefreshCw size={12} /> Try again
      </button>
    </div>
  );
}

function ActivitySkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[32px_1fr_60px] gap-3 items-center py-3 border-b border-[var(--base-200)] last:border-0">
          <div className="w-8 h-8 rounded-full bg-[var(--base-100)] animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3 bg-[var(--base-100)] rounded animate-pulse w-3/4" />
            <div className="h-2.5 bg-[var(--base-100)] rounded animate-pulse w-1/2" />
          </div>
          <div className="h-2.5 bg-[var(--base-100)] rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/** Activity category chip tint. Same palette and same grouping as the Manager
 *  Operations report's "Manager activity" section, because this
 *  panel is that section: a landlord who reads both should not have to learn
 *  two colour systems for one vocabulary. */
const CATEGORY_TINT: Record<string, string> = {
  Leads: 'bg-[#e0f2fe] text-[#0369a1]', Customers: 'bg-[#e0f2fe] text-[#0369a1]',
  Signature: 'bg-[#ede9fe] text-[#5b21b6]',
  Termination: 'bg-[#fee2e2] text-[#b91c1c]', Settlement: 'bg-[#fee2e2] text-[#b91c1c]',
  Payments: 'bg-[#fef3c7] text-[#92400e]', Registration: 'bg-[#fef3c7] text-[#92400e]',
  Properties: 'bg-[#d8f2e8] text-[#1a7a5a]', Units: 'bg-[#d8f2e8] text-[#1a7a5a]', Listings: 'bg-[#d8f2e8] text-[#1a7a5a]',
  Contracts: 'bg-[#d1f0ea] text-[#0f766e]', Inspection: 'bg-[#d1f0ea] text-[#0f766e]', Renewal: 'bg-[#d1f0ea] text-[#0f766e]',
  Documents: 'bg-[#eef2f7] text-[#475569]',
  Team: 'bg-[#f3eefe] text-[#6d28d9]', Templates: 'bg-[#f3eefe] text-[#6d28d9]', AMC: 'bg-[#f3eefe] text-[#6d28d9]', Settings: 'bg-[#f3eefe] text-[#6d28d9]',
  Viewing: 'bg-[#f4f3ef] text-[#9b9890]', Session: 'bg-[#eef2f7] text-[#475569]',
};
const categoryTint = (c: string) => CATEGORY_TINT[c] ?? 'bg-[#f4f3ef] text-[#6b6860]';
const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AE', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
/** 'YYYY-MM-DD' → 'Tue, 4 Aug 2026'. The string is ALREADY a Dubai calendar day,
 *  so it is read back as UTC — re-interpreting it in the viewer's zone is what
 *  would shift the header off the day the rows were grouped under. */
const fmtDayHeading = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AE', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

/** Upcoming renewals, split into the four states a lease can be in.
 *
 *  The four are a PARTITION — they sum to the headline, which is what makes them
 *  readable as a breakdown of it rather than four overlapping filters. That is
 *  also why the headline changed meaning: it used to count renewals with work
 *  OUTSTANDING (accepted renewals and agreed terminations were filtered out of
 *  the list entirely), and under that rule "Renewed" and "Vacating" could only
 *  ever be zero — the rows that define them were the ones being excluded.
 *
 *  `noticeDue` is the only bucket that is the landlord's OWN next action, so it
 *  is the one that reads as work; Notice Sent is a wait on the customer, and the
 *  other two are settled. Every bucket renders even at 0 — a missing tile reads
 *  as "not measured", a 0 reads as "none", and those are different answers. */
function RenewalsCard({ list, buckets, loading, error, onRetry, windowDays, onWindowChange, allHref, onDrillBucket }: {
  list: UpcomingRenewal[];
  buckets?: Record<RenewalBucket, number>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  windowDays: RenewalWindow;
  onWindowChange: (w: RenewalWindow) => void;
  /** Operations → Renewal tab, with the portal's own prefix already applied. */
  allHref: string;
  onDrillBucket: (b: RenewalBucket) => void;
}) {
  // Fall back to counting the list when the API predates `renewalBuckets`, so
  // the card degrades to the right numbers rather than to four zeroes.
  const counts = buckets ?? list.reduce((acc, r) => {
    const k = r.bucket ?? 'noticeDue';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, { renewed: 0, noticeSent: 0, noticeDue: 0, newCustomer: 0, vacating: 0 } as Record<RenewalBucket, number>);
  const total = RENEWAL_BUCKETS.reduce((n, b) => n + (counts[b.key] ?? 0), 0);
  // Declined is rare and has no tile until it happens; its units are still in the
  // total, which is what keeps the card equal to the Renewal Plan.
  const tiles = RENEWAL_BUCKETS.filter(b => b.key !== 'vacating' || (counts.vacating ?? 0) > 0);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-[var(--base-200)] flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="text-base font-bold text-[var(--neutral-900)]">Upcoming Renewals</h3>
          <p className="text-xs text-[var(--neutral-400)] mt-0.5">
            {loading
              ? 'Loading…'
              : `${total} renewal${total === 1 ? '' : 's'} this month and the next ${windowDays} days`}
          </p>
        </div>
        <select
          value={windowDays}
          onChange={e => onWindowChange(Number(e.target.value) as RenewalWindow)}
          aria-label="Renewal horizon"
          className="text-[10.5px] font-bold tracking-normal uppercase text-[var(--neutral-500)] bg-[var(--base-100)] border border-[var(--base-200)] rounded-md pl-1.5 pr-0.5 py-1 cursor-pointer hover:border-[var(--neutral-400)] focus:outline-none focus:border-[var(--primary)]"
        >
          {RENEWAL_WINDOWS.map(w => <option key={w} value={w}>{w} days</option>)}
        </select>
      </div>

      {error && loading ? (
        <SectionError message="Couldn't load renewals." onRetry={onRetry} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {tiles.map(b => {
              const n = counts[b.key] ?? 0;
              const t = DRILL_TONE[b.tone];
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => n > 0 && onDrillBucket(b.key)}
                  disabled={n === 0}
                  className={`text-left rounded-xl border border-[var(--base-200)] px-3 py-3 transition-all${n > 0 ? ' cursor-pointer hover:border-[var(--neutral-400)] hover:shadow-sm' : ' opacity-60 cursor-default'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: t.fg }} />
                    <span className="text-[10.5px] font-bold tracking-[0.08em] uppercase text-[var(--neutral-400)] truncate">{b.label}</span>
                  </div>
                  <div className="text-[26px] font-bold tracking-tight tabular-nums leading-none mt-1.5 text-[var(--neutral-900)]">
                    {loading ? '…' : n}
                  </div>
                  <div className="text-[11px] text-[var(--neutral-400)] mt-1 leading-snug">{b.hint}</div>
                </button>
              );
            })}
          </div>
          {/* One stacked bar of the same four, so the shape of the pipeline is
              readable without comparing four numbers. Segments carry a 2px gap
              and the same colours as the tiles above them. */}
          {total > 0 && (
            <div className="flex gap-[2px] mt-4 h-2">
              {tiles.map(b => {
                const n = counts[b.key] ?? 0;
                if (!n) return null;
                return (
                  <div
                    key={b.key}
                    className="rounded-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${(n / total) * 100}%`, background: DRILL_TONE[b.tone].fg }}
                    title={`${b.label} ${n}`}
                  />
                );
              })}
            </div>
          )}
          {/* The renewals live in the Operations Renewal pipeline; that is where
              they get worked, so the link goes there rather than to a read-only
              list of the same leases. With none due there is nothing to open,
              so the line stays plain text. */}
          {total === 0 ? (
            <span className="mt-4 text-xs font-semibold text-[var(--neutral-700)] opacity-50 self-start">
              No renewals this month or in the next {windowDays} days
            </span>
          ) : (
            <Link
              href={allHref}
              className="mt-4 text-xs font-semibold text-[var(--neutral-700)] hover:underline self-start cursor-pointer"
            >
              View all {total} renewals
            </Link>
          )}
        </>
      )}
    </div>
  );
}

/** Minutes as "1h 03m" / "48m" — an average day is read in hours, and a bare
 *  minute count in the hundreds has to be divided in the reader's head. */
function fmtMins(n: number): string {
  const m = Math.max(0, Math.round(n));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/**
 * How much time each manager puts into this portfolio on a working day.
 *
 * Sits directly above the live feed and answers the question the feed cannot:
 * the feed says WHAT they are doing, this says HOW MUCH. Both read the same
 * audit trail, so a manager present in one is present in the other.
 *
 * The figure is SESSIONISED from the spacing of everything they did — pages
 * opened AND changes made — with any gap over the server's idle cap dropped.
 * There is no timer in the product. Counting only the changes measured half the
 * real time, because most of a manager's day is reading: a contract compared, an
 * Operations board worked through, a unit checked.
 *
 * It is still a floor — phone calls and anything off-platform are invisible, and
 * a day with one single event measures zero. The footnote says so on screen
 * rather than leaving a manager looking idle when they were not, because this
 * figure will be read as a performance number whether or not it is one.
 *
 * Bars are scaled to the busiest manager, not to a fixed ceiling — there is no
 * such thing as a target number of minutes, so the only honest comparison is
 * between the people on this roster.
 */
function ManagerTimePerDay({ data }: { data: ManagerTimeData | null }) {
  if (!data || data.managers.length === 0) return null;
  const peak = Math.max(...data.managers.map(m => m.avgMinutesPerDay), 1);
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-[var(--base-200)]">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--neutral-400)] inline-flex items-center gap-1.5">
          <Clock size={12} className="text-[var(--primary-dark)]" />
          Time on your portfolio
        </div>
        <span className="text-[11px] text-[var(--neutral-400)]">
          average per working day · last {data.windowDays} days
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {data.managers.map(m => (
          <div key={m.userId} className="flex items-center gap-3">
            <div className="w-[38%] min-w-0">
              <div className="text-[13px] font-semibold text-[var(--neutral-900)] truncate">{m.name}</div>
              <div className="text-[11px] text-[var(--neutral-400)]">
                {m.activeDays === 0
                  ? 'no activity in this window'
                  : `${m.activeDays} active ${m.activeDays === 1 ? 'day' : 'days'} · ${fmtMins(m.totalMinutes)} total · ${m.pageViews.toLocaleString()} pages`}
              </div>
              {/* Their reading time cannot be split between landlords, so it is
                  counted here in full and on the other landlord's dashboard
                  too — better said than silently overstated. */}
              {m.sharedAcrossLandlords && (
                <div className="text-[10.5px] text-[var(--neutral-400)] italic mt-0.5">
                  also manages another portfolio — reading time is not split
                </div>
              )}
            </div>
            <div className="flex-1 h-2 rounded-full bg-[var(--base-200)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--primary-dark)]"
                style={{ width: `${Math.round((m.avgMinutesPerDay / peak) * 100)}%` }}
              />
            </div>
            <div className="w-[68px] text-right text-[14px] font-bold tabular-nums text-[var(--neutral-900)]">
              {fmtMins(m.avgMinutesPerDay)}
            </div>
          </div>
        ))}
      </div>

      {/* Says what the number is not. Without this it reads as a timesheet. */}
      <p className="mt-4 pt-3 border-t border-[var(--base-200)] text-[11px] text-[var(--neutral-400)] leading-relaxed">
        Measured from the gaps between the pages they opened and the changes they made, with breaks over {data.idleCapMinutes} minutes
        excluded — so it is a floor, not a timesheet. Phone calls and anything done off the platform do not appear.
      </p>
    </div>
  );
}

/** Live manager activity — what the people running this portfolio are doing,
 *  re-read every 5 seconds.
 *
 *  Laid out as the Manager Operations report's "Manager activity" section:
 *  one block per manager, rows under the day they happened on,
 *  each row time · category · action · ×N · record, and clicking one opens what
 *  actually changed. The difference between the two is the window, not the
 *  shape — this one is always the last N actions and refreshes itself.
 *
 *  Ages are computed against the feed's OWN `generatedAt`, not the browser
 *  clock: the panel claims to be live, and a laptop a few minutes out of sync
 *  would quietly make every row lie about when it happened. `generatedAt` moves
 *  with each poll, so the ages advance on their own without a second timer.
 *
 *  A poll that fails leaves the last good rows on screen (see fetchFeed) — the
 *  error only takes the panel when there is nothing to show. */
function LiveActivity({ feed, error, onRetry, contractBase, leadsBase }: {
  feed: ManagerFeed | null;
  error: string | null;
  onRetry: () => void;
  contractBase: string;
  leadsBase: string;
}) {
  const [detail, setDetail] = useState<{ entry: FeedEntry; who: string } | null>(null);
  // Never Date.now() here: it is impure in render, and there is no fallback to
  // need — with no feed there are no rows whose age could be asked for.
  const now = feed ? new Date(feed.generatedAt).getTime() : 0;
  const ago = (iso: string) => {
    const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return relativeTime(iso);
  };
  const openHref = (e: FeedEntry) =>
    e.contractId != null ? `${contractBase}/${e.contractId}/v2`
    : e.leadId != null ? `${leadsBase}/${e.leadId}`
    : null;
  // Read through a fallback rather than off `feed` directly: this panel polls an
  // endpoint of its own, so during a deploy it can be handed a payload from the
  // previous build. An unguarded `feed.managers.length` turns that into a
  // render crash that takes the whole dashboard down, not one quiet panel.
  const lanes = feed?.managers ?? [];
  // Named `feedWindow`, never `window`: a bare `window` in this scope shadows the
  // browser global, and the shadowing is silent — it reads fine right up until
  // someone adds a `window.` call below it.
  const feedWindow = feed?.window ?? [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[var(--base-200)] overflow-hidden">
      <div className="px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[15px] font-bold text-[var(--neutral-900)]">Manager activity</h3>
          {/* The dot is the only thing that says the panel is live, so it is
              paired with the word — a pulsing dot alone is decoration. */}
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.1em] uppercase text-[var(--neutral-400)]">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-[var(--primary)] opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-[var(--primary)]" />
            </span>
            Live
          </span>
        </div>
        <span className="text-xs text-[var(--neutral-400)]">Your managers, today — pages opened and changes made · refreshes every 5s · click a row to see what changed</span>
      </div>
      {error && !feed ? (
        <div className="px-6 pb-6"><SectionError message="Couldn't load manager activity." onRetry={onRetry} /></div>
      ) : !feed ? (
        <div className="px-6 pb-6"><ActivitySkeleton /></div>
      ) : lanes.length === 0 ? (
        <p className="px-6 pb-8 text-sm text-[var(--neutral-400)] text-center">
          No managers on this portfolio yet — invite one and their work appears here as they do it.
        </p>
      ) : (
// Side by side, one column per manager, busiest on the left. Stacked,
        // the second manager sat below the fold and the two were never in view
        // together -- which is the only way a landlord can compare them. The
        // columns drop to one under `lg`, where side-by-side would squeeze each
        // row past the point its action text survives.
        <div className={`grid ${lanes.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
          {lanes.map((m, mi) => {
            // The day comes from the window the API returns, not from the days
            // the rows land on: grouping off the rows means a manager with
            // nothing today has no day at all, and their column silently
            // disappears instead of reading "no activity".
            const byDay = new Map<string, FeedEntry[]>();
            for (const e of m.entries) {
              const arr = byDay.get(e.day) ?? [];
              arr.push(e);
              byDay.set(e.day, arr);
            }
            const totalFor = new Map(m.dayTotals?.map(d => [d.day, d.count]) ?? []);
            const viewsFor = new Map(m.dayViews?.map(d => [d.day, d.count]) ?? []);
            const days = feedWindow.map(day => ({
              day,
              rows: byDay.get(day) ?? [],
              // The day's REAL total, not the number of rows shown: a day capped
              // at 10 still says 34 happened.
              total: totalFor.get(day) ?? 0,
              // Pages opened that day, counted beside the actions and never
              // inside them — opening a page is not work delivered.
              views: viewsFor.get(day) ?? 0,
            }));
            const actions = m.dayTotals?.reduce((s, d) => s + d.count, 0) ?? 0;
            const pages = m.dayViews?.reduce((s, d) => s + d.count, 0) ?? 0;
            return (
              // The divider between columns is a left border on all but the
              // first, so it appears only where two columns actually meet.
              <div key={m.userId} className={`border-t border-[var(--base-200)] min-w-0${mi > 0 ? ' lg:border-l' : ''}`}>
                <div className="px-5 py-2.5 bg-[var(--base-100)]/60 flex items-baseline justify-between gap-2 flex-wrap">
                  <h4 className="text-[13px] font-bold text-[var(--neutral-900)] truncate">{m.name ?? `Manager #${m.userId}`}</h4>
                  {/* Today's count, and — when today is empty but they have
                      acted before — when that was. "0 actions" alone cannot tell
                      a manager who is idle today from one who has never worked
                      here, and those are different problems. */}
                  {/* Pages read sit beside the actions, never added to them: a
                      manager can open forty pages and change nothing, and those
                      are two different days. Reading alone still counts as
                      present, so a day with only views says so rather than
                      falling through to "nothing today". */}
                  <span className="text-[11px] text-[var(--neutral-400)] tabular-nums shrink-0">
                    {actions > 0
                      ? `${actions} action${actions === 1 ? '' : 's'}${pages > 0 ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''} today · last ${ago(m.lastAt!)}`
                      : pages > 0
                      ? `${pages} page${pages === 1 ? '' : 's'} read today · no changes`
                      : m.lastAt ? `nothing today · last seen ${ago(m.lastAt)}` : 'nothing yet'}
                  </span>
                </div>
                {days.map(({ day, rows, total, views }) => (
                  <div key={day}>
                    <div className="px-5 py-1.5 border-t border-[var(--base-200)] flex items-baseline justify-between gap-2">
                      <span className={`text-[11.5px] font-bold ${total || views ? 'text-[var(--neutral-700)]' : 'text-[var(--neutral-400)]'}`}>{fmtDayHeading(day)}</span>
                      <span className="text-[11px] text-[var(--neutral-400)] tabular-nums shrink-0">
                        {[
                          total ? `${total} action${total === 1 ? '' : 's'}` : null,
                          views ? `${views} page${views === 1 ? '' : 's'}` : null,
                        ].filter(Boolean).join(' · ') || 'no activity'}
                      </span>
                    </div>
                    {/* A day with nothing on it still gets its heading and says
                        so — a blank day is a fact about the manager, and hiding
                        it makes the remaining dates look contiguous. */}
                    {rows.length === 0 && (
                      <p className="px-5 py-2 text-[11.5px] text-[var(--neutral-400)] border-t border-[var(--base-200)]/60">—</p>
                    )}
                    {/* When the cap trimmed the day, say what is not on screen
                        rather than letting 10 of 34 read as the whole day. The
                        two sides are capped separately, so they are reported
                        separately — "10 of 34" against a merged list would be
                        true of neither. */}
                    {(() => {
                      const shownActions = rows.filter(e => e.category !== 'Viewing').reduce((s, e) => s + (e.repeats ?? 1), 0);
                      const shownViews = rows.filter(e => e.category === 'Viewing').reduce((s, e) => s + (e.repeats ?? 1), 0);
                      const trimmed = [
                        total > shownActions ? `${shownActions} of ${total} actions` : null,
                        views > shownViews ? `${shownViews} of ${views} pages` : null,
                      ].filter(Boolean);
                      return trimmed.length ? (
                        <p className="px-5 pt-1.5 text-[11px] text-[var(--neutral-400)]">
                          showing the latest {trimmed.join(' · ')}
                        </p>
                      ) : null;
                    })()}
                    {rows.map(e => {
                      const to = openHref(e);
                      const n = e.repeats ?? 1;
                      return (
                        <div key={e.id} className="px-5 py-2 flex items-start gap-2 border-t border-[var(--base-200)]/60 hover:bg-[var(--base-100)]/50">
                          <button
                            type="button"
                            onClick={() => setDetail({ entry: e, who: m.name ?? `Manager #${m.userId}` })}
                            title="See what changed"
                            className="flex-1 min-w-0 text-left cursor-pointer"
                          >
                            {/* Two lines in a half-width column: what happened on
                                the first, what it happened to on the second. On
                                one line the record name is the part that gets
                                truncated away, and it is the part that says
                                WHICH lease this was. */}
                            <div className="flex items-center gap-2 min-w-0">
                              {/* A collapsed run spans a range, so it says so — a
                                  single stamp would put three saves at one instant. */}
                              <span className="text-[11px] text-[var(--neutral-400)] tabular-nums shrink-0 whitespace-nowrap">
                                {n > 1 ? `${fmtClock(e.firstAt)}–${fmtClock(e.at)}` : fmtClock(e.at)}
                              </span>
                              <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${categoryTint(e.category)}`}>{e.category}</span>
                              <span className="text-[13px] text-[var(--neutral-900)] font-medium truncate">{e.label}</span>
                              {n > 1 && (
                                <span className="inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums bg-[var(--base-200)] text-[var(--neutral-700)] shrink-0" title={`${n} times`}>×{n}</span>
                              )}
                            </div>
                            {(e.subject || e.why) && (
                              <div className="mt-0.5 text-[11.5px] truncate">
                                {e.subject && <span className="text-[var(--neutral-500)]">{e.subject}</span>}
                                {e.why && <span className="text-[#b45309]">{e.subject ? ' — ' : ''}{e.why}</span>}
                              </div>
                            )}
                          </button>
                          {to && (
                            <Link href={to} {...NEW_TAB} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary-dark)] hover:underline shrink-0 mt-0.5">
                              Open <ArrowUpRight size={11} />
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* What actually changed, for one row. */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,18,14,0.5)' }} onClick={() => setDetail(null)} role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl border border-[var(--base-200)]" onClick={ev => ev.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 p-5 border-b border-[var(--base-200)]">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-[var(--neutral-900)]">{detail.entry.label}</h3>
                <p className="text-xs text-[var(--neutral-500)] mt-1 leading-snug">
                  {detail.who} · {fmtDayHeading(detail.entry.day)} at {fmtClock(detail.entry.at)}
                  {(detail.entry.repeats ?? 1) > 1 && ` · ${detail.entry.repeats} times from ${fmtClock(detail.entry.firstAt)}`}
                  {detail.entry.subject && ` · ${detail.entry.subject}`}
                </p>
              </div>
              <button type="button" onClick={() => setDetail(null)} aria-label="Close" className="text-[var(--neutral-400)] hover:text-[var(--neutral-900)] shrink-0"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto p-5">
              {/* Most actions capture no diff. Saying so is the honest answer —
                  an empty table would read as "nothing changed". A page view is
                  the one row where that sentence would be misleading rather than
                  merely thin: nothing was changed because nothing was meant to
                  be, so it says what it actually was. */}
              {detail.entry.category === 'Viewing' ? (
                <p className="text-sm text-[var(--neutral-500)] text-center py-6">
                  Opened this page{(detail.entry.repeats ?? 1) > 1 ? ` ${detail.entry.repeats} times` : ''} — nothing was changed.
                </p>
              ) : !detail.entry.changes?.length ? (
                <p className="text-sm text-[var(--neutral-400)] text-center py-6">
                  This action recorded no field-level changes.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {detail.entry.changes.map((c, i) => (
                    <div key={i} className="grid grid-cols-[120px_1fr] gap-3 items-baseline">
                      <span className="text-[12px] font-semibold text-[var(--neutral-500)] truncate">{c.field}</span>
                      <span className="text-[13px] text-[var(--neutral-900)] break-words">
                        <span className="text-[var(--neutral-400)] line-through">{c.from ?? '—'}</span>
                        <span className="mx-1.5 text-[var(--neutral-400)]">→</span>
                        <span className="font-semibold">{c.to ?? '—'}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/** RP route entry point — the landlord's own dashboard home. */
export default function RentalProviderDashboard() {
  return <RpDashboardHome />;
}
